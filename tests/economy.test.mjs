import { test } from 'node:test'
import assert from 'node:assert/strict'
import { economyFile, economyPath } from '../lib/economy.mjs'
import { RARITIES } from '../lib/poe2.mjs'
import { ITEM_KINDS } from '../lib/item-kinds.mjs'
import { bandOf } from '../lib/bands.mjs'
import { withDb, seedCell } from './helpers.mjs'

// Derived, never a literal: the claim is "one line per type per rarity", which
// is a relationship. Writing the product as a number made this test fail for
// the right reason but the wrong cause the day Expedition Tablet came back.
const EVERY_CELL = ITEM_KINDS.tablet.types.length * RARITIES.length

const NOW = Date.parse('2026-08-29T13:00:00Z')
const config = {
  floor: { strategy: 'nth-cheapest', n: 3 },
  walk: { minListings: 3, minSellers: 2, minLift: 2, minAdds: 0, midVsBlank: 1.5, highVsBlank: 2 },
  exchange: { exalted: 1, divine: 100, chaos: 5 }
}
const opts = { league: 'L', kind: ITEM_KINDS.tablet, lookbackHours: 48, config, now: NOW }

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

// A page that loaded the wrong file would render an empty grid and read as a
// collection fault. Naming the kind in the file lets it refuse instead.
test('the economy file names the kind it describes', () => withDb(db => {
  assert.equal(economyFile(db, { ...opts }).kind, 'tablet')
}))

// A kind is a closed list of types, and the file covers all of them whether or
// not anything was collected for them. A missing line would read as a page
// fault rather than as a gap.
test('the file covers every type of its kind and no other', () => withDb(db => {
  const out = economyFile(db, { ...opts, kind: ITEM_KINDS.jewel })
  assert.deepEqual([...new Set(out.cells.map(c => c.type))].sort(),
    ['Emerald', 'Ruby', 'Sapphire'])
  assert.equal(out.cells.length,
    ITEM_KINDS.jewel.types.length * ITEM_KINDS.jewel.rarities.length)
  assert.deepEqual(out.mods, [], 'nothing has been collected for jewels')
}))

// ONE LEAGUE IS ONE DATABASE, so a jewel pass and a tablet pass write into the
// same file. Taking the newest row of the whole database made the tablet page
// report "collected 20 minutes ago" twenty minutes after a JEWEL sweep, while
// the tablet prices it was showing were a day old. `syncedAt` is the one line
// on the page whose whole job is to say how much to trust the numbers, so it
// has to mean "this kind", not "this file".
test('how stale a file is, is measured against its own kind only', () => withDb(db => {
  seedCell(db, { type: 'Breach Tablet', rarity: 'Rare',
    takenAt: '2026-09-09T12:00:00Z', rows: [{ amount: 5, account: 'a', mods: ['A'] }] })
  seedCell(db, { type: 'Emerald', rarity: 'Rare',
    takenAt: '2026-09-10T08:00:00Z', idFor: (i) => `j${i}`,
    rows: [{ amount: 1, account: 'b', mods: ['B'] }] })

  assert.equal(economyFile(db, { ...opts }).syncedAt, '2026-09-09T12:00:00Z',
    'the tablet file must not be freshened by a jewel sweep')
  assert.equal(economyFile(db, { ...opts, kind: ITEM_KINDS.jewel }).syncedAt,
    '2026-09-10T08:00:00Z')
}))

// A kind nothing has been collected for has no staleness to report, and null
// says that. A borrowed timestamp from the other kind would read as fresh data.
test('a kind with nothing collected reports no sync time at all', () => withDb(db => {
  seedCell(db, { type: 'Breach Tablet', rarity: 'Rare',
    takenAt: '2026-09-09T12:00:00Z', rows: [{ amount: 5, account: 'a', mods: ['A'] }] })
  assert.equal(economyFile(db, { ...opts, kind: ITEM_KINDS.jewel }).syncedAt, null)
}))

// A rarity a kind's market does not trade costs a search per type on every
// pass and publishes a column of dashes. No jewel trades at normal, measured
// 2026-09-10: 0 for sale on all three bases against 10000 at both others.
test('the file carries only the rarities its kind actually trades', () => withDb(db => {
  const jewel = economyFile(db, { ...opts, kind: ITEM_KINDS.jewel })
  assert.deepEqual([...new Set(jewel.cells.map(c => c.rarity))], ['magic', 'rare'])
  const tablet = economyFile(db, { ...opts })
  assert.deepEqual([...new Set(tablet.cells.map(c => c.rarity))], RARITIES)
}))

test('economyPath matches what shared/economy.ts asks for', () => {
  assert.equal(economyPath('Runes of Aldur', ITEM_KINDS.tablet),
    'tablet/eco_Runes of Aldur_Tablet.json')
  assert.equal(economyPath('Runes of Aldur', ITEM_KINDS.jewel),
    'jewel/eco_Runes of Aldur_Jewel.json')
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
  assert.equal(out.cells.length, EVERY_CELL, 'every tablet type times every rarity')
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
  assert.equal(good.affixRatio, 10, '50 over a blank tablet at 5')
  assert.equal(good.fewSamples, false)
  // The published shape is exactly what bandOf takes, with no adapting.
  assert.equal(bandOf(good, out.walk), 'high')
}))

test('syncedAt is the newest of several seeded observations', () => withDb(db => {
  seed(db, SAMPLE, '2026-08-29T09:00:00Z')
  seed(db, SAMPLE, '2026-08-29T12:30:00Z')
  const out = economyFile(db, { ...opts })
  assert.equal(out.syncedAt, '2026-08-29T12:30:00Z')
}))

// The page paints the colours now, so it needs every number the rule uses. A
// missing one would not throw in the browser, it would compare against
// undefined, come out false, and quietly paint the whole list one colour.
test('the walk thresholds are carried so the page need not hold our config',
  () => withDb(db => {
    seed(db, SAMPLE)
    const out = economyFile(db, { ...opts })
    assert.deepEqual(out.walk, {
      minListings: 3, minSellers: 2, minAdds: 0, midVsBlank: 1.5, highVsBlank: 2
    })
  }))

// The page orders the tablet grid by what a blank one costs and those prices
// are not all in one currency, so it applies the rate itself. Two copies of the
// number would be two numbers.
test('the rate table is carried so the page and the build cannot disagree',
  () => withDb(db => {
    seed(db, SAMPLE)
    const out = economyFile(db, { ...opts })
    assert.deepEqual(out.exchange, config.exchange)
  }))

// A price is exactly what the market said; a comparison may rest on a guess.
// The file has to keep those apart or a reader cannot tell which is which.
test('a modifier says whether its comparison leaned on the rate table',
  () => withDb(db => {
    seed(db, SAMPLE)
    const mods = economyFile(db, { ...opts }).mods
    assert.ok(mods.length)
    for (const m of mods) assert.equal(typeof m.assumedRate, 'boolean')
    assert.ok(mods.every(m => m.assumedRate === false),
      'this fixture is priced in exalted throughout')
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
    const banded = out.mods.filter(m =>
      m.rarity === 'rare' && ['mid', 'high'].includes(bandOf(m, out.walk)))
    assert.ok(banded.every(m => m.floor >= 1.5 * cell.floor),
      'nothing is banded below the blank tablet it was judged against')
  }))
