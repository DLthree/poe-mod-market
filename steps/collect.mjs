#!/usr/bin/env node
// Phase 1. Collects listings of ONE ITEM KIND into the SQLite archive.
//
// `--kind` picks the kind and defaults to tablet, so every command line in
// README.md means what it always meant. The default scope is the TEST SET for
// that kind: one type and ten modifiers. A full pass costs about an hour and
// most of a day's rate allowance, so it needs --full AND --i-mean-it. Nothing
// here runs a full pass by accident.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dbPath, cacheDir } from '../lib/paths.mjs'
import { createProgress } from '../lib/progress.mjs'
import { TradeClient } from '../lib/trade-client.mjs'
import { API_BASE, REALM, RARITIES, MODIFIED_RARITIES, validateTradeWindow } from '../lib/poe2.mjs'
import { kindByKey } from '../lib/item-kinds.mjs'
import { loadIndex, textFor } from '../lib/stat-index.mjs'
import { openDb } from '../lib/db.mjs'
import { recordRequest } from '../lib/archive.mjs'
import { sweepPools, sweepAffixes, affixesFor } from '../lib/sweep.mjs'
import { quickAffixes } from '../lib/refresh.mjs'
import { checkAge, medianAgeHours } from '../lib/agecheck.mjs'
import { readListings } from '../lib/pools.mjs'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const config = JSON.parse(readFileSync(here('../config.json'), 'utf8'))
validateTradeWindow(config.tradeWindow)
const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1] }
const dataOverride = flag("data", null)
const has = (n) => argv.includes(`--${n}`)

const league = flag('league', config.league)
const perCell = Number(flag('per-cell', config.perCell))
const only = flag('only', null) // pools | affixes
const full = has('full')

if (full && !has('i-mean-it')) {
  console.error(
    'A full pass is roughly 300 searches and 300 fetches, about an hour, and most\n' +
    "of the day's rate allowance. Re-run with --full --i-mean-it to confirm.\n" +
    'Without --full this runs the test set from config.json.')
  process.exit(1)
}

// Which ITEM KIND this pass collects. The default keeps every command line in
// README.md meaning exactly what it meant before there were two kinds.
const kindKey = flag('kind', 'tablet')
let kind
try {
  kind = kindByKey(kindKey)
} catch (err) {
  console.error(`${err.message} Nothing has run.`)
  process.exit(2)
}

// The test set is per kind. A kind with none cannot run the cheap default, and
// falling through to a full pass would spend most of a day's allowance on a
// flag the caller never typed.
const testSet = config.testSet?.[kindKey] ?? null
if (!full && !testSet) {
  console.error(
    `config.json holds no test set for ${kindKey}, so there is no cheap run for it. ` +
    `Add testSet.${kindKey}, or ask for a full pass with --full --i-mean-it. ` +
    'Nothing has run.')
  process.exit(2)
}

// `--types "Temple Tablet"` narrows a pass to one type of the kind, the same
// lever as --rarities and for the same reason. A pass that stops partway leaves
// one cell short, and re-running the whole thing to collect it spends 500
// searches to buy 30.
const askedTypes = flag('types', null)
const types = askedTypes
  ? askedTypes.split(',').map(t => t.trim()).filter(Boolean)
  : (full ? kind.types : testSet.types)
const unknownTypes = types.filter(t => !kind.types.includes(t))
if (unknownTypes.length) {
  console.error(`Unknown ${kindKey} type ${unknownTypes.map(t => JSON.stringify(t)).join(', ')}. ` +
    `Known: ${kind.types.join(', ')}. Nothing has run.`)
  process.exit(2)
}

// A quick pass re-asks only the modifiers the LAST pass measured at this ratio
// or better. It refreshes; it cannot discover. See lib/refresh.mjs.
const minRatio = flag('min-ratio', null)
if (minRatio !== null && !full) {
  console.error(
    '--min-ratio narrows a full pass and means nothing without --full: the test ' +
    'set is ten named modifiers, not a measured one. Nothing has run.')
  process.exit(2)
}
if (minRatio !== null && !(Number(minRatio) > 0)) {
  console.error(`--min-ratio must be a positive number, got ${JSON.stringify(minRatio)}. ` +
    'Nothing has run.')
  process.exit(2)
}

// `--rarities magic` narrows a pass to one rarity. It exists because a sweep
// costs an hour of allowance that cannot be bought back: when the rare data is
// hours old and only magic is missing, re-asking about rares spends 200
// searches to learn what we already know.
const asked = flag('rarities', null)
const rarities = asked ? asked.split(',').map(r => r.trim()).filter(Boolean)
  : (full ? RARITIES : testSet.rarities)
const unknown = rarities.filter(r => !RARITIES.includes(r))
if (unknown.length) {
  console.error(`Unknown rarity ${unknown.map(r => JSON.stringify(r)).join(', ')}. ` +
    `Known: ${RARITIES.join(', ')}. Nothing has run.`)
  process.exit(2)
}

console.log(full
  ? (minRatio === null
      ? `FULL PASS: ${kindKey} — ${types.length} types x ${rarities.join('/')}`
      : `QUICK PASS: every baseline, plus the modifiers last measured at ${minRatio}x or better`)
  : `test set: ${kindKey} — ${types.join(', ')} x ${rarities.join('/')}, ` +
    `${testSet.affixes.length} modifiers`)

const secrets = JSON.parse(readFileSync(here('../secrets.json'), 'utf8'))
const db = openDb(dbPath(league, dataOverride))

// The cell label is set immediately before each call and read by the hook, so
// every archived row records why it was made.
let cell = null

// The bar only draws when stderr is a real terminal — piped or redirected, a
// carriage-return bar would fill a log file with control characters, so this
// falls back to the plain one-line-per-cell logging instead. `activeBar` is
// set for the life of one loop, so a rate-limit wait outside a loop (loading
// the stat index, say) still reaches the console directly.
const useBar = process.stderr.isTTY === true
let activeBar = null

const client = new TradeClient({
  poesessid: secrets.POESESSID,
  league,
  apiBase: API_BASE,
  realm: REALM,
  referer: `https://www.pathofexile.com/trade2/search/${REALM}/${encodeURIComponent(league)}`,
  log: (m) => (activeBar ? activeBar.log(m) : console.log(m)),
  // The collector keeps its own archive, in the SQLite file it already owns.
  archive: (r) => recordRequest(db, { ...r, at: new Date().toISOString(), league, cell })
})
const onCell = (c) => { cell = c; if (activeBar) activeBar.tick(c) }

const index = await loadIndex({ client, cacheDir: cacheDir(dataOverride) })

// The quick plan is built BEFORE loop 1, from the ratios the last pass left
// behind. Building it after would measure against baselines this pass has just
// refreshed, which is a different question, and it would already have spent the
// pool searches by the time it discovered it had nothing to ask about.
const quickPlan = minRatio === null ? null : new Map()
if (quickPlan) {
  for (const type of types) {
    for (const rarity of rarities.filter(r => MODIFIED_RARITIES.includes(r))) {
      quickPlan.set(`${type}|${rarity}`, quickAffixes(db, {
        league, type, rarity, minRatio, lookbackHours: config.lookbackHours, config
      }))
    }
  }
  const total = [...quickPlan.values()].reduce((n, h) => n + h.length, 0)
  if (total === 0) {
    console.error(
      `No modifier in this league has ever been measured at ${minRatio}x or better, ` +
      'so a quick pass would collect baselines and nothing else.\n' +
      'Run a full pass first: node cli.mjs update. Nothing has run.')
    db.close()
    process.exit(2)
  }
}

const started = Date.now()
let out = { searches: 0, fetches: 0, listings: 0 }
const add = (r) => {
  out = {
    searches: out.searches + r.searches,
    fetches: out.fetches + r.fetches,
    listings: out.listings + r.listings
  }
}

if (only !== 'affixes') {
  console.log('\nloop 1 — pools by type and rarity')
  activeBar = useBar
    ? createProgress({ label: 'collecting', total: types.length * rarities.length })
    : null
  add(await sweepPools({ client, db, index, kind, league, types, rarities, perCell,
    tradeWindow: config.tradeWindow, log: useBar ? () => {} : (m) => console.log(m), onCell }))
  activeBar = null
}

if (only !== 'pools') {
  // Every rarity loop 1 collected, not just rare. A modifier can only be priced
  // on the rarity it was asked about, and until 2026-09-01 nothing asked about
  // magic at all, so 91 of 297 modifier lines carried no floor. Normal is
  // skipped: a normal tablet carries no modifier, so there is no question.
  console.log(`\nloop 2 — one search per modifier, on ${rarities.join('/')}`)

  // One decision, made once. The plan below is printed, counted for the bar and
  // then swept, so what the run promises and what it spends cannot disagree.
  const testSetHashes = full ? null : testSet.affixes.map(a => a.hash)
  const chooseAffixes = (type, rarity) =>
    quickPlan?.get(`${type}|${rarity}`) ?? testSetHashes ?? affixesFor(db, type, rarity)

  let affixTotal = 0
  for (const type of types) {
    // The same rarity rule sweepAffixes applies, or the plan and the progress
    // bar promise searches that will never run.
    for (const rarity of rarities.filter(r => MODIFIED_RARITIES.includes(r))) {
      const hashes = chooseAffixes(type, rarity)
      if (hashes.length) console.log(`  ${type} ${rarity}: ${hashes.length} modifiers`)
      affixTotal += hashes.length
    }
  }
  activeBar = useBar ? createProgress({ label: 'collecting', total: affixTotal }) : null
  add(await sweepAffixes({ client, db, index, kind, league, types, rarities, perCell, chooseAffixes,
    tradeWindow: config.tradeWindow, log: useBar ? () => {} : (m) => console.log(m), onCell }))
  activeBar = null
}

console.log(`\n${out.searches} searches, ${out.fetches} fetches, ${out.listings} listings, ` +
  `${Math.round((Date.now() - started) / 1000)}s`)

// A cell far older than its peers is a fault, not data. Report it loudly.
const rows = readListings(db, { sinceMs: config.lookbackHours * 3600 * 1000 })
const byCell = new Map()
for (const r of rows) {
  const key = `${r.type}|${r.rarity}`
  if (!byCell.has(key)) byCell.set(key, [])
  byCell.get(key).push(r)
}
const ages = [...byCell].map(([c, rs]) => ({ cell: c, medianAgeHours: medianAgeHours(rs) }))
const stale = checkAge(ages, config.ageCheck)
console.log('\ncell ages (median hours):')
for (const a of ages) console.log(`  ${a.cell.padEnd(28)} ${a.medianAgeHours?.toFixed(1)}`)
if (stale.length) {
  console.log(`\nWARNING stale cells: ${stale.join(', ')}`)
  console.log('  These are far older than their peers. Do not trust them; re-collect.')
}

if (!full) {
  console.log('\ntest-set modifiers collected:')
  for (const a of (testSet.affixes || [])) {
    const n = db.prepare(
      `SELECT count(DISTINCT l.listing_id) n FROM listing_mod m
         JOIN listing l ON l.request_id = m.request_id AND l.listing_id = m.listing_id
        WHERE m.hash = ?`).get(a.hash).n
    console.log(`  ${String(n).padStart(4)}  ${textFor(index, a.hash)}`)
  }
}

db.close()
