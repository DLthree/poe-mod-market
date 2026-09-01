import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readListings } from '../lib/pools.mjs'
import { countDistinct, median } from '../lib/numbers.mjs'
import { withDb, sampleListing } from './helpers.mjs'
import { recordRequest } from '../lib/archive.mjs'
import { deriveRequest } from '../lib/derive.mjs'
import { buildIndex } from '../lib/stat-index.mjs'
import { readFileSync } from 'node:fs'

const stats = JSON.parse(readFileSync(new URL('./fixtures/stats-subset.json', import.meta.url)))

// Every seeded row belongs to a snapshot, because that is the only kind of row
// readListings will look at. A row with no snapshot is history, not data.
function seed (db, { at, listingId, amount, indexed = '2026-08-29T11:00:00Z', mods = [],
                     snapshot = true }) {
  const id = Number(db.prepare(
    `INSERT INTO request (at,league,kind,method,url,status,response_body)
     VALUES (?, 'L','fetch','GET','u',200,X'00')`).run(at).lastInsertRowid)
  const snap = snapshot
    ? Number(db.prepare(
      `INSERT INTO snapshot (league,type,rarity,stat_id,taken_at)
       VALUES ('L','Breach Tablet','Rare',NULL,?)`).run(at).lastInsertRowid)
    : null
  db.prepare(`INSERT INTO listing
    (request_id,listing_id,indexed,account,price_amount,price_currency,type,rarity,
     open_prefix,open_suffix,snapshot_id)
    VALUES (?,?,?,'A#1',?, 'divine','Breach Tablet','Rare',1,0,?)`)
    .run(id, listingId, indexed, amount, snap)
  for (const h of mods) {
    db.prepare(`INSERT INTO listing_mod (request_id,listing_id,hash,roll,affix)
                VALUES (?,?,?,3,'x')`).run(id, listingId, h)
  }
  return id
}

const NOW = new Date('2026-08-29T13:00:00Z')

test('a listing comes back with its price and its modifiers', () => withDb(db => {
  seed(db, { at: '2026-08-29T12:00:00Z', listingId: 'a', amount: 5, mods: ['h1', 'h2'] })
  const rows = readListings(db, { now: NOW })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].amount, 5)
  assert.equal(rows[0].type, 'Breach Tablet')
  assert.deepEqual(rows[0].mods.map(m => m.hash).sort(), ['h1', 'h2'])
}))

test('the same listing seen twice yields one row, and the newer wins', () => withDb(db => {
  seed(db, { at: '2026-08-29T10:00:00Z', listingId: 'a', amount: 5 })
  seed(db, { at: '2026-08-29T12:00:00Z', listingId: 'a', amount: 9 })
  const rows = readListings(db, { now: NOW })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].amount, 9)
}))

test('the newer observation wins whichever order it was inserted', () => withDb(db => {
  seed(db, { at: '2026-08-29T12:00:00Z', listingId: 'a', amount: 9 })
  seed(db, { at: '2026-08-29T10:00:00Z', listingId: 'a', amount: 5 })
  assert.equal(readListings(db, { now: NOW })[0].amount, 9)
}))

test('two different listings stay two rows', () => withDb(db => {
  seed(db, { at: '2026-08-29T12:00:00Z', listingId: 'a', amount: 5 })
  seed(db, { at: '2026-08-29T12:00:00Z', listingId: 'b', amount: 7 })
  assert.equal(readListings(db, { now: NOW }).length, 2)
}))

test('a row outside the window is left out', () => withDb(db => {
  seed(db, { at: '2026-08-20T12:00:00Z', listingId: 'a', amount: 5 })
  const rows = readListings(db, { sinceMs: 48 * 3600 * 1000, now: NOW })
  assert.equal(rows.length, 0)
}))

test('open affix counts survive the read, including unknown', () => withDb(db => {
  seed(db, { at: '2026-08-29T12:00:00Z', listingId: 'a', amount: 5 })
  const [row] = readListings(db, { now: NOW })
  assert.equal(row.openPrefix, 1)
  assert.equal(row.openSuffix, 0)
}))

test('the price and currency come back raw, never converted', () => withDb(db => {
  seed(db, { at: '2026-08-29T12:00:00Z', listingId: 'a', amount: 2 })
  const [row] = readListings(db, { now: NOW })
  assert.equal(row.amount, 2)
  assert.equal(row.currency, 'divine')
}))

test('an empty database reads as no rows, not an error', () => withDb(db => {
  assert.deepEqual(readListings(db, { now: NOW }), [])
}))

test('distinct counts sellers, not listings, and ignores unknown ones', () => {
  assert.equal(countDistinct(['a', 'b', 'a', 'a']), 2)
  assert.equal(countDistinct(['a', null, null]), 1)
})

test('the median of an even list averages the middle pair', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5)
  assert.equal(median([]), null)
})

// The page shows what a modifier can roll, so the band GGG sent with each
// listing has to survive the read. Without it "#% increased number of Rare
// Monsters" is all the reader gets, and "#" is not a number anyone can act on.
test('a modifier row carries the roll band GGG sent with it', () => withDb(db => {
  const id = recordRequest(db, {
    at: '2026-08-30T12:00:00Z', league: 'L', kind: 'fetch', cell: 'c',
    method: 'GET', url: 'u', status: 200,
    text: JSON.stringify({ result: [sampleListing()] }), headers: new Headers()
  })
  const snap = Number(db.prepare(
    `INSERT INTO snapshot (league,type,rarity,stat_id,taken_at)
     VALUES ('L','Breach Tablet','Rare',NULL,'2026-08-30T12:00:00Z')`).run().lastInsertRowid)
  deriveRequest(db, id, buildIndex(stats), { snapshotId: snap })
  const [row] = readListings(db)
  const invasion = row.mods.find(m => m.hash === 'explicit.stat_3762913035')
  assert.equal(invasion.rollMin, 1)
  assert.equal(invasion.rollMax, 3)
}))

// The archive holds thousands of rows collected before snapshots existed. They
// are kept, and a parser fix still reaches them, but they carry no question and
// no usable rank. Reading them would mix two kinds of data in one pile, which is
// the fault that made every published price wrong.
test('a row that belongs to no snapshot is history, and is not read', () => withDb(db => {
  seed(db, { at: '2026-08-29T12:00:00Z', listingId: 'legacy', amount: 1, snapshot: false })
  seed(db, { at: '2026-08-29T12:00:00Z', listingId: 'current', amount: 50 })
  const rows = readListings(db, { now: NOW })
  assert.deepEqual(rows.map(r => r.listingId), ['current'])
  assert.equal(db.prepare('SELECT count(*) n FROM listing').get().n, 2,
    'both rows are still in the database')
}))
