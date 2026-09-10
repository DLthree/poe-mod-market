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
import { kindByKey } from '../lib/item-kinds.mjs'

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

// ONE KIND PER TABLE. This read every listing in the league and wrote one file,
// so a jewel run overwrote the tablet table with a walk over both kinds at once.
// The default matches steps/collect.mjs so an old command line means what it
// always meant.
let kind
try {
  kind = kindByKey(flag('kind', 'tablet'))
} catch (err) {
  console.error(`${err.message} Nothing has run.`)
  process.exit(2)
}

const db = openDb(dbPath(league, dataOverride))
const types = new Set(kind.types)
const rows = readListings(db, { sinceMs: hours * 3600 * 1000 })
  .filter(r => types.has(r.type))
console.log(`${rows.length} ${kind.key} listings in the last ${hours}h, ` +
  `floor rule: ${strategy} (n=${n}), min lift ${minLift}x`)

const table = walk(rows, walkConfig)
const out = {
  league,
  kind: kind.key,
  generatedAt: new Date().toISOString(),
  lookbackHours: hours,
  floor: walkConfig.floor,
  ...table
}
writeFileSync(modTablePath(league, kind.key, dataOverride), JSON.stringify(out, null, 1))

const index = buildIndex(JSON.parse(readFileSync(join(cacheDir(dataOverride), 'stats-poe2.json'))), vendoredEe2())
console.log(renderTable(table, (h) => textFor(index, h)))
console.log(`\nwritten to data/mod-table-${league}-${kind.key}.json`)
db.close()
