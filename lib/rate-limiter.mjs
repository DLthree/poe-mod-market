// Cross-process rate limiter for the GGG trade API.
//
// The limiter has to outlive the process: the skill is invoked as a fresh
// `node price-check.mjs` every time, and an in-memory limiter resets to "no
// requests yet" on each run. Three lookups in a row would then burst straight
// through GGG's window and earn a restriction. So the ledger lives on disk and
// every invocation reads it, reserves its slot, and writes back.
//
// How GGG's headers work. Each endpoint has a policy with several *nested*
// windows per scope, sent on every response:
//
//   X-Rate-Limit-Ip:        5:10:60,15:60:300,30:300:1800,600:21600:3600
//   X-Rate-Limit-Ip-State:  1:10:0,3:60:0,12:300:0,45:21600:0
//                           ^hits ^period_s ^restricted_for_s
//
// The server's -State counters are the source of truth — they include traffic
// this process never saw (a concurrent run, or you browsing the trade site in a
// browser). So a window is judged as "hits the server last reported, plus the
// requests we have made since that report". Do NOT try to reconstruct the
// server's count as synthetic local timestamps: the 6-hour counter is routinely
// in the dozens, and stamping those into the ledger makes every *shorter*
// window look exhausted. (That bug cost a 3-minute stall on the second run.)

import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, closeSync, unlinkSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

// Deliberately ONE file for both skills: GGG counts per IP and per account, so
// a second ledger would let two tools burst through the same window and earn a
// restriction. TRADE_RATELIMIT_LEDGER exists only so a test can point somewhere
// else — a test that reserves against the shared ledger waits on real windows
// and spends allowance that a collection running alongside it needs.
const DEFAULT_LEDGER =
  fileURLToPath(new URL('../.claude/skills/price-check/data/.cache/ratelimit.json', import.meta.url))

// Read per call, never captured at import time: ESM hoists every import above
// the statements in the importing file, so a test that sets the variable after
// its imports would otherwise be too late and would reserve against the real
// ledger anyway.
export const ledgerPath = () => process.env.TRADE_RATELIMIT_LEDGER || DEFAULT_LEDGER
const lockPath = () => ledgerPath() + '.lock'

const SCOPES = ['ip', 'account', 'client']
const SAFETY_MS = 250        // pad every computed wait; clocks and travel time disagree
const COLD_SPACING_MS = 350  // floor before any rules have been learned
const STALE_LOCK_MS = 15000  // a lock older than this belonged to a process that died
const MAX_LEDGER = 200

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const now = () => Date.now()

// ── lock ──────────────────────────────────────────────────────────────────────
// openSync(..., 'wx') fails if the file exists, which makes it an atomic
// test-and-set on both Windows and Linux.
async function withLock (fn) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      mkdirSync(dirname(lockPath()), { recursive: true })
      closeSync(openSync(lockPath(), 'wx'))
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try {
        if (now() - statSync(lockPath()).mtimeMs > STALE_LOCK_MS) unlinkSync(lockPath())
      } catch { /* someone else cleaned it up */ }
      await sleep(50)
      continue
    }
    try { return await fn() } finally {
      try { unlinkSync(lockPath()) } catch { /* already gone */ }
    }
  }
  // Never block the actual work on a stuck lock — degrade to unsynchronised.
  return fn()
}

// ── ledger ────────────────────────────────────────────────────────────────────
function read () {
  try { return JSON.parse(readFileSync(ledgerPath(), 'utf8')) } catch { return {} }
}

function write (ledger) {
  try {
    mkdirSync(dirname(ledgerPath()), { recursive: true })
    writeFileSync(ledgerPath(), JSON.stringify(ledger))
  } catch { /* the limiter still works in-process if the disk says no */ }
}

function bucketFor (ledger, key) {
  const b = (ledger[key] ??= {})
  b.rules ??= {}
  b.state ??= {}
  b.requests ??= []
  b.penaltyUntil ??= 0
  b.policy ??= null
  return b
}

function parseTriples (value) {
  if (!value) return null
  return value.split(',').map(part => part.split(':').map(Number))
    .filter(r => r.length >= 2 && r.every(Number.isFinite))
}

function longestPeriod (bucket) {
  let longest = 60
  for (const scope of SCOPES) {
    for (const [, period] of bucket.rules[scope] ?? []) longest = Math.max(longest, period)
  }
  return longest
}

/**
 * How long this bucket says we must wait before the next request, in ms.
 * Zero means go now.
 *
 * Returns { wait, reason } so the caller can say *which* window is full.
 */
function waitMs (bucket, at = now()) {
  let wait = Math.max(0, (bucket.penaltyUntil ?? 0) - at)
  let reason = wait > 0 ? 'server restriction in effect' : null

  const consider = (ms, why) => {
    if (ms > wait) { wait = ms; reason = why }
  }

  for (const scope of SCOPES) {
    const rules = bucket.rules[scope] ?? []
    const states = bucket.state[scope] ?? []

    for (let i = 0; i < rules.length; i++) {
      const [maxHits, period] = rules[i]
      if (!(maxHits > 0) || !(period > 0)) continue
      const st = states[i]

      if (st && Number.isFinite(st.hits) && Number.isFinite(st.observedAt)) {
        // Server's count at observation time, plus what we sent since — but only
        // counting requests that are still inside *this* window. Without the
        // second bound, a reservation whose record() never landed (a killed
        // process) would be charged against a 4-second window for hours.
        const windowStart = at - period * 1000
        const since = bucket.requests.filter(t => t > st.observedAt && t > windowStart).length
        // An observation older than the window itself describes a window that
        // has already rolled over; its count no longer applies.
        const observed = (at - st.observedAt >= period * 1000) ? 0 : st.hits
        if (observed + since >= maxHits) {
          // Conservative: wait for the whole observed window to roll past.
          consider(st.observedAt + period * 1000 - at, `${scope} ${maxHits}/${period}s`)
        }
      } else {
        // No server observation yet — fall back to our own sliding window.
        const windowStart = at - period * 1000
        const inWindow = bucket.requests.filter(t => t > windowStart).sort((a, b) => a - b)
        if (inWindow.length >= maxHits) {
          consider(inWindow[inWindow.length - maxHits] + period * 1000 - at, `${scope} ${maxHits}/${period}s`)
        }
      }
    }
  }

  // Cold start: no rules learned yet, so just don't hammer.
  if (!Object.keys(bucket.rules).length && bucket.requests.length) {
    const since = at - bucket.requests[bucket.requests.length - 1]
    consider(COLD_SPACING_MS - since, 'cold-start spacing')
  }

  return { wait: wait > 0 ? wait + SAFETY_MS : 0, reason }
}

function prune (bucket, at = now()) {
  const cutoff = at - longestPeriod(bucket) * 1000 - 1000
  bucket.requests = bucket.requests.filter(t => t > cutoff).slice(-MAX_LEDGER)
}

/**
 * Wait until this endpoint's window has room, then reserve a slot.
 * The reservation is written before the request goes out, so a second process
 * starting mid-flight sees it and waits.
 */
export async function reserve (key, log = () => {}) {
  for (;;) {
    const { wait, reason } = await withLock(async () => {
      const ledger = read()
      const bucket = bucketFor(ledger, key)
      prune(bucket)
      const verdict = waitMs(bucket)
      if (verdict.wait > 0) return verdict
      bucket.requests.push(now())   // reserve before releasing the lock
      write(ledger)
      return verdict
    })
    if (!wait) return
    log(`  rate limit: waiting ${(wait / 1000).toFixed(1)}s — ${key} ${reason} is full`)
    await sleep(wait)
  }
}

/**
 * Fold a response's rate-limit headers back into the ledger.
 * `retryAfterSecs` is set when the response was a 429.
 */
export async function record (key, headers, retryAfterSecs = 0) {
  await withLock(async () => {
    const ledger = read()
    const bucket = bucketFor(ledger, key)
    const at = now()

    bucket.policy = headers.get('x-rate-limit-policy') ?? bucket.policy

    for (const scope of SCOPES) {
      const rules = parseTriples(headers.get(`x-rate-limit-${scope}`))
      if (rules) bucket.rules[scope] = rules

      const state = parseTriples(headers.get(`x-rate-limit-${scope}-state`))
      if (!state) continue

      bucket.state[scope] = state.map(([hits, period, restrictSecs]) => {
        if (restrictSecs > 0) {
          bucket.penaltyUntil = Math.max(bucket.penaltyUntil, at + restrictSecs * 1000)
        }
        return { hits, period, observedAt: at }
      })
    }

    if (retryAfterSecs > 0) {
      bucket.penaltyUntil = Math.max(bucket.penaltyUntil, at + retryAfterSecs * 1000)
    }

    prune(bucket, at)
    write(ledger)
  })
}

/** Human-readable snapshot, for --rate-status. */
export function status () {
  const ledger = read()
  const at = now()
  const out = []
  for (const [key, raw] of Object.entries(ledger)) {
    const bucket = bucketFor({ [key]: raw }, key)
    const { wait, reason } = waitMs(bucket, at)
    out.push(`  ${key}  (${bucket.policy ?? 'policy unknown'})`)
    for (const scope of SCOPES) {
      const rules = bucket.rules[scope] ?? []
      if (!rules.length) continue
      const states = bucket.state[scope] ?? []
      const cols = rules.map(([max, period], i) => {
        const st = states[i]
        const windowStart = at - period * 1000
        let used
        if (st) {
          const since = bucket.requests.filter(t => t > st.observedAt && t > windowStart).length
          used = ((at - st.observedAt >= period * 1000) ? 0 : st.hits) + since
        } else {
          used = bucket.requests.filter(t => t > windowStart).length
        }
        return `${used}/${max} per ${period}s`
      })
      out.push(`    ${scope.padEnd(8)} ${cols.join('   ')}`)
    }
    if ((bucket.penaltyUntil ?? 0) > at) {
      out.push(`    RESTRICTED for another ${Math.ceil((bucket.penaltyUntil - at) / 1000)}s`)
    }
    out.push(`    next request ${wait > 0 ? `in ${(wait / 1000).toFixed(1)}s (${reason} full)` : 'allowed now'}`)
  }
  return out.length ? out.join('\n') : '  (no requests recorded yet)'
}
