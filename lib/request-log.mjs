// A durable log of every call made to GGG.
//
// A request spends rate allowance that cannot be bought back, so the response it
// paid for has to survive — including the failures, which usually say more than
// the successes. lib/trade-client.mjs will not construct without an archive, and
// this is the default one: any script, however throwaway, can satisfy it in a
// line and its answers are still there tomorrow.
//
// The tablet collector passes its own sink instead, writing into the SQLite
// archive it already keeps. Both are the same contract: hand back the record
// whole, and store it whole.
//
// One gzipped line per request. A 10-item fetch is about 40 KB of JSON and a
// full pass makes hundreds, so the bodies are compressed; a day of collecting
// stays in the low megabytes.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'

const FILE = 'requests.ndjson'

/**
 * Build an archive sink for TradeClient.
 *
 * @param {string} dir Directory to append into; created if absent.
 * @param {object} [opts]
 * @param {string} [opts.label] Why these calls were made, stored on each record.
 *   A probe from six months ago is much easier to read with its question beside it.
 * @returns {(record: object) => void}
 */
export function fileArchive (dir, { label = null } = {}) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, FILE)
  return (r) => {
    const rateHeaders = {}
    if (r.headers && typeof r.headers.forEach === 'function') {
      r.headers.forEach((v, k) => {
        if (k.toLowerCase().startsWith('x-rate-limit')) rateHeaders[k.toLowerCase()] = v
      })
    }
    const row = {
      at: new Date().toISOString(),
      label,
      kind: r.kind,
      method: r.method,
      url: r.url,
      status: r.status,
      requestBody: r.requestBody ?? null,
      rateHeaders,
      // Base64 of the gzipped body. NDJSON stays one-line-per-record and
      // greppable, and the body comes back byte for byte.
      bodyGz: gzipSync(Buffer.from(String(r.text ?? ''), 'utf8')).toString('base64')
    }
    appendFileSync(path, JSON.stringify(row) + '\n')
  }
}

/** Read every archived call back, oldest first. */
export function readRequestLog (dir) {
  const path = join(dir, FILE)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => {
    const row = JSON.parse(line)
    const { bodyGz, ...rest } = row
    return { ...rest, text: gunzipSync(Buffer.from(bodyGz, 'base64')).toString('utf8') }
  })
}

/** Which log files exist under a directory, for a human going looking. */
export function requestLogFiles (dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.ndjson')).map(f => join(dir, f))
}
