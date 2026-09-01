#!/usr/bin/env node
// Phase 1. Collects tablet listings into the SQLite archive.
//
// The default is the TEST SET: one tablet type and ten modifiers. A full pass
// costs about an hour and most of a day's rate allowance, so it needs --full
// AND --i-mean-it. Nothing here runs a full pass by accident.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dbPath, cacheDir } from '../lib/paths.mjs'
import { createProgress } from '../lib/progress.mjs'
import { TradeClient } from '../lib/trade-client.mjs'
import { API_BASE, REALM, TABLET_TYPES, RARITIES, validateTradeWindow } from '../lib/poe2.mjs'
import { loadIndex, textFor } from '../lib/stat-index.mjs'
import { openDb } from '../lib/db.mjs'
import { recordRequest } from '../lib/archive.mjs'
import { sweepPools, sweepAffixes, affixesFor } from '../lib/sweep.mjs'
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

const testSet = config.testSet
const types = full ? TABLET_TYPES : testSet.types
const rarities = full ? RARITIES : testSet.rarities
const affixes = full ? null : testSet.affixes.map(a => a.hash)

console.log(full
  ? `FULL PASS: ${types.length} types x ${rarities.length} rarities`
  : `test set: ${types.join(', ')} x ${rarities.join('/')}, ${affixes.length} modifiers`)

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
  add(await sweepPools({ client, db, index, league, types, rarities, perCell,
    tradeWindow: config.tradeWindow, log: useBar ? () => {} : (m) => console.log(m), onCell }))
  activeBar = null
}

if (only !== 'pools') {
  console.log('\nloop 2 — one search per modifier, on rares')
  let affixTotal = 0
  for (const type of types) {
    const hashes = affixes || affixesFor(db, type)
    console.log(`  ${type}: ${hashes.length} modifiers`)
    affixTotal += hashes.length
  }
  activeBar = useBar ? createProgress({ label: 'collecting', total: affixTotal }) : null
  add(await sweepAffixes({ client, db, index, league, types, perCell, affixes,
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
