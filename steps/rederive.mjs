#!/usr/bin/env node
// Phase 1. Rebuilds `listing` and `listing_mod` from the archived responses.
// Makes no network call: this is what "the archive is primary" buys. A parser
// fix is re-applied to every row ever collected for free.
//
// RANK IS LOST. The page offset lived in the collector, not in the response, so
// a replayed row has no `rank` and lib/floor.mjs falls back to the amount. That
// is safe while a pool is priced in one currency — the two agreed on every one
// of the first 260 rows — and it is why this is not run casually.
//
// Rank IS recoverable in principle and was not built: each fetch URL carries the
// queryId of its search, that search's archived response lists its ids in rank
// order, and a listing's rank is its position in that list.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { dbPath, cacheDir } from '../lib/paths.mjs'
import { openDb } from '../lib/db.mjs'
import { deriveAll } from '../lib/derive.mjs'
import { buildIndex, vendoredEe2 } from '../lib/stat-index.mjs'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const config = JSON.parse(readFileSync(here('../config.json'), 'utf8'))
const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1] }

const dataOverride = flag('data', null)
const league = flag('league', config.league)

const db = openDb(dbPath(league, dataOverride))
const before = db.prepare('SELECT count(*) n FROM listing').get().n
const archived = db.prepare(
  "SELECT count(*) n FROM request WHERE league = ? AND kind = 'fetch' AND status = 200"
).get(league).n

console.log(`${league}: ${before} derived rows from ${archived} archived responses`)
if (!archived) {
  console.error('Nothing archived for this league. Run "node cli.mjs update" first.')
  process.exit(1)
}

const index = buildIndex(
  JSON.parse(readFileSync(join(cacheDir(dataOverride), 'stats-poe2.json'), 'utf8')),
  vendoredEe2())

db.exec('DELETE FROM listing; DELETE FROM listing_mod')
const written = deriveAll(db, league, index)
console.log(`replayed ${written} listings`)

const nulls = db.prepare('SELECT count(*) n FROM listing_mod WHERE roll IS NULL').get().n
const negative = db.prepare(
  'SELECT count(*) n FROM listing WHERE open_prefix < 0 OR open_suffix < 0').get().n
console.log(`  modifiers with no roll: ${nulls}`)
console.log(`  negative open counts:   ${negative}`)
console.log('\nRank is null on every replayed row; see the note at the top of this file.')
console.log('Next, rebuild the table: "node cli.mjs update --offline"'
  + ' replays and rebuilds together.')
db.close()
