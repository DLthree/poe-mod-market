#!/usr/bin/env node
// Phase 2. Reads the database and works out which modifiers raise the floor.
// Makes no network call, so it is free to re-run as often as you like.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { dbPath, cacheDir, modTablePath } from '../lib/paths.mjs'
import { openDb } from '../lib/db.mjs'
import { readListings } from '../lib/pools.mjs'
import { walk } from '../lib/walk.mjs'
import { buildIndex, textFor, vendoredEe2 } from '../lib/stat-index.mjs'
import { renderTable } from '../lib/report.mjs'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const config = JSON.parse(readFileSync(here('../config.json'), 'utf8'))
const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1] }
const dataOverride = flag("data", null)

const league = flag('league', config.league)
const hours = Number(flag('hours', config.lookbackHours))
// Iterating the heuristic costs nothing: the data is already collected.
const strategy = flag('floor', config.floor.strategy)
const n = Number(flag('floor-n', config.floor.n))
const minLift = Number(flag('min-lift', config.walk.minLift))

const walkConfig = {
  ...config.walk,
  minLift,
  floor: { ...config.floor, strategy, n }
}

const db = openDb(dbPath(league, dataOverride))
const rows = readListings(db, { sinceMs: hours * 3600 * 1000 })
console.log(`${rows.length} listings in the last ${hours}h, floor rule: ${strategy} (n=${n}), min lift ${minLift}x`)

const table = walk(rows, walkConfig)
const out = {
  league,
  generatedAt: new Date().toISOString(),
  lookbackHours: hours,
  floor: walkConfig.floor,
  ...table
}
writeFileSync(modTablePath(league, dataOverride), JSON.stringify(out, null, 1))

const index = buildIndex(JSON.parse(readFileSync(join(cacheDir(dataOverride), 'stats-poe2.json'))), vendoredEe2())
console.log(renderTable(table, (h) => textFor(index, h)))
console.log(`\nwritten to data/mod-table-${league}.json`)
db.close()
