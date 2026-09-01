import { test } from 'node:test'
import assert from 'node:assert/strict'
import { economyFile, economyPath } from '../lib/economy.mjs'
import { withDb, seedCell } from './helpers.mjs'

const NOW = Date.parse('2026-08-29T13:00:00Z')
const config = {
  floor: { strategy: 'nth-cheapest', n: 3 },
  walk: { minListings: 3, minSellers: 2, minLift: 2, midVsBlank: 1.5, highVsBlank: 2 }
}
const opts = { league: 'L', lookbackHours: 48, config, now: NOW }

const seed = (db, rows, at = '2026-08-29T12:00:00Z') =>
  seedCell(db, { rows, takenAt: at, idFor: (i) => `${at}-l${i}` })

const SAMPLE = [
  { amount: 3, account: 'a', mods: ['JUNK'] },
  { amount: 4, account: 'b', mods: ['JUNK'] },
  { amount: 5, account: 'c', mods: ['JUNK'] },
  { amount: 40, account: 'f', mods: ['GOOD'] },
  { amount: 45, account: 'g', mods: ['GOOD'] },
  { amount: 50, account: 'h', mods: ['GOOD'] },
  { amount: 60, account: 'i', mods: ['GOOD'] }
]

test('economyPath matches what shared/economy.ts asks for', () => {
  assert.equal(economyPath('Runes of Aldur'), 'tablet/eco_Runes of Aldur_Tablet.json')
})

test('a populated cell carries its floor and both counts', () => withDb(db => {
  seed(db, SAMPLE)
  const out = economyFile(db, { ...opts })
  const cell = out.cells.find(c => c.type === 'Breach Tablet' && c.rarity === 'rare')
  assert.equal(cell.floor, 5, 'third cheapest of the whole cell')
  assert.equal(cell.currency, 'exalted')
  assert.equal(cell.listings, 7)
  assert.equal(cell.sellers, 7)
}))

test('rarity is emitted lower case even though the database stores it capitalised',
  () => withDb(db => {
    seed(db, SAMPLE)
    const out = economyFile(db, { ...opts })
    assert.ok(out.cells.every(c => c.rarity === c.rarity.toLowerCase()))
    assert.ok(out.mods.every(m => m.rarity === m.rarity.toLowerCase()))
  }))

test('every type and rarity gets a line, so a gap reads as a gap', () => withDb(db => {
  seed(db, SAMPLE)
  const out = economyFile(db, { ...opts })
  assert.equal(out.cells.length, 21, 'seven types times three rarities')
  const empty = out.cells.find(c => c.type === 'Abyss Tablet' && c.rarity === 'normal')
  assert.equal(empty.floor, null)
  assert.equal(empty.listings, 0)
  assert.equal(empty.sellers, 0)
}))

test('a modifier line carries its own floor and what it adds', () => withDb(db => {
  seed(db, SAMPLE)
  const out = economyFile(db, { ...opts })
  const good = out.mods.find(m => m.statId === 'GOOD')
  assert.equal(good.type, 'Breach Tablet')
  assert.equal(good.rarity, 'rare')
  assert.equal(good.floor, 50)
  assert.equal(good.adds, 45)
  assert.equal(good.currency, 'exalted')
  assert.equal(good.listings, 4)
  assert.equal(good.sellers, 4)
  assert.equal(good.quality, 'high')
}))

test('syncedAt is the newest of several seeded observations', () => withDb(db => {
  seed(db, SAMPLE, '2026-08-29T09:00:00Z')
  seed(db, SAMPLE, '2026-08-29T12:30:00Z')
  const out = economyFile(db, { ...opts })
  assert.equal(out.syncedAt, '2026-08-29T12:30:00Z')
}))

test('minListings is carried so the page need not hold our config', () => withDb(db => {
  seed(db, SAMPLE)
  const out = economyFile(db, { ...opts })
  assert.equal(out.minListings, 3)
}))

test('tradeWindow is carried, from config, so a trade link matches our slice', () => withDb(db => {
  seed(db, SAMPLE)
  const out = economyFile(db, { ...opts, config: { ...config, tradeWindow: '1week' } })
  assert.equal(out.tradeWindow, '1week')
}))

// A key-name denylist, not a value check: it cannot see what a key holds, only
// what a key is called. If a future change adds an order book back into this
// file under one of these names, this is what stops it. Extend the list rather
// than weakening it.
const ROW_KEYS = [
  'account', 'accounts', 'seller', 'sellers_list', 'listingId', 'listing_id',
  'id', 'indexed', 'amount', 'price', 'whisper', 'note', 'listings_detail',
  'rank', 'openPrefix', 'open_prefix', 'openSuffix', 'open_suffix', 'roll',
  'rolls', 'affix', 'hash'
]

const walkKeys = (node, seen = []) => {
  if (Array.isArray(node)) { for (const v of node) walkKeys(v, seen); return seen }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) { seen.push(k); walkKeys(v, seen) }
  }
  return seen
}

test('the file carries no row data under any key', () => withDb(db => {
  seed(db, SAMPLE)
  const out = economyFile(db, { ...opts })
  const keys = new Set(walkKeys(out))
  for (const banned of ROW_KEYS) {
    assert.ok(!keys.has(banned), `"${banned}" is row data and must not be emitted`)
  }
}))

test('sellers and listings are integers, never lists', () => withDb(db => {
  seed(db, SAMPLE)
  const out = economyFile(db, { ...opts })
  for (const line of [...out.cells, ...out.mods]) {
    assert.equal(typeof line.listings, 'number', 'listings must be a count')
    assert.equal(typeof line.sellers, 'number', 'sellers must be a count')
    assert.ok(Number.isInteger(line.listings))
    assert.ok(Number.isInteger(line.sellers))
  }
}))

// A band a reader cannot check is a band a reader has to trust. The bands are
// measured against `floor`, the blank tablet, and `typical` — the median floor
// of the cell's own priced modifiers — says what the rest of the list costs. On
// a cell whose blank tablet is nearly free the two numbers are what tells a
// reader that "high" means the tablet is cheap, not that the modifier is good.
test('every cell line carries the numbers its bands can be read against',
  () => withDb(db => {
    seed(db, SAMPLE)
    const out = economyFile(db, { ...opts })
    assert.ok(out.cells.every(c => 'typical' in c), 'including the empty ones')
    const cell = out.cells.find(c => c.type === 'Breach Tablet' && c.rarity === 'rare')
    assert.equal(typeof cell.typical, 'number')
    const banded = out.mods.filter(m => m.rarity === 'rare' && m.quality)
    assert.ok(banded.every(m => m.floor >= 1.5 * cell.floor),
      'nothing is banded below the blank tablet it was judged against')
  }))
