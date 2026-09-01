import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellSummary } from '../lib/summary.mjs'
import { withDb, seedCell, seedQuestion } from './helpers.mjs'

const NOW = Date.parse('2026-08-29T13:00:00Z')
const config = {
  floor: { strategy: 'nth-cheapest', n: 3 },
  walk: { minListings: 3, minSellers: 2, minLift: 2, midVsBlank: 1.5, highVsBlank: 2 }
}
const cell = { league: 'L', type: 'Breach Tablet', rarity: 'Rare' }
const common = { ...cell, lookbackHours: 48, config, now: NOW }

const row = (amount, mods, account, over = {}) => ({ amount, mods, account, ...over })

// JUNK sits on the cheap rows, GOOD only on the dear ones.
const SAMPLE = [
  row(3, ['JUNK'], 'a'), row(4, ['JUNK'], 'b'), row(5, ['JUNK'], 'c'),
  row(40, ['GOOD'], 'f'), row(45, ['GOOD'], 'g'),
  row(50, ['GOOD'], 'h'), row(60, ['GOOD'], 'i')
]

test('cellSummary gives a baseline and a floor per modifier', () => withDb(db => {
  seedCell(db, { rows: SAMPLE })
  const out = cellSummary(db, common)
  assert.equal(out.baseline.value, 5, 'third cheapest of the whole cell')
  const good = out.mods.find(m => m.hash === 'GOOD')
  assert.equal(good.matches, 4)
  assert.equal(good.sellers, 4)
  assert.equal(good.floor, 50, 'third cheapest of 40/45/50/60')
  assert.equal(good.delta, 45, '50 minus the baseline 5')
  assert.equal(good.quality, 'high')
}))

// The whole point of the change: a modifier's floor comes from the search that
// asked about that modifier, and from nothing else. JUNK sits on the cheap rows
// only, so its own search returns them and it floors where the cell floors.
test('a modifier is priced from its own question, not from the cell', () => withDb(db => {
  seedCell(db, { rows: SAMPLE })
  const out = cellSummary(db, common)
  const junk = out.mods.find(m => m.hash === 'JUNK')
  assert.equal(junk.floor, 5)
  assert.equal(junk.delta, 0)
  assert.equal(junk.quality, null, 'it adds nothing over a blank tablet')
}))

// The cheap end of this cell is exalted, so the baseline is. DEAR sits on
// tablets dear enough to be priced in divine, and its own search returns only
// those. Two currencies cannot be compared without a rate we refuse to hold.
test('cellSummary gives no delta across two currencies', () => withDb(db => {
  seedCell(db, { rows: SAMPLE })
  seedQuestion(db, {
    statId: 'DEAR',
    idFor: (i) => `dear${i}`,
    rows: [
      row(2, ['DEAR'], 'x', { currency: 'divine' }),
      row(3, ['DEAR'], 'y', { currency: 'divine' }),
      row(4, ['DEAR'], 'z', { currency: 'divine' })
    ]
  })
  const out = cellSummary(db, common)
  assert.equal(out.baseline.currency, 'exalted')
  const dear = out.mods.find(m => m.hash === 'DEAR')
  assert.equal(dear.currency, 'divine')
  assert.equal(dear.delta, null, 'divine floor against an exalted baseline')
  assert.equal(dear.quality, null, 'incomparable is not the same as worthless')
}))

test('cellSummary puts the observed roll band into the label', () => withDb(db => {
  seedCell(db, {
    rows: [
      row(10, ['BAND'], 'a', { band: [25, 30] }),
      row(11, ['BAND'], 'b', { band: [28, 35] }),
      row(12, ['BAND'], 'c', { band: [28, 35] })
    ]
  })
  const textFor = () => '#% increased number of Rare Monsters'
  const out = cellSummary(db, { ...common, textFor })
  const band = out.mods.find(m => m.hash === 'BAND')
  assert.equal(band.label, '25-35% increased number of Rare Monsters',
    'the widest band the sample held, not the first one seen')
}))

// A modifier nobody spent a search on cannot be priced: we hold no answer to
// "what does one carrying it cost?". Dropping it would hide how common it is,
// so it is reported with its count and no floor at all.
test('a modifier seen but never asked about is reported without a price',
  () => withDb(db => {
    seedQuestion(db, {
      rows: [row(3, ['SEEN'], 'a'), row(4, ['SEEN'], 'b'), row(5, ['SEEN'], 'c')]
    })
    const out = cellSummary(db, common)
    const seen = out.mods.find(m => m.hash === 'SEEN')
    assert.equal(seen.matches, 3, 'the count still says how common it is')
    assert.equal(seen.floor, null)
    assert.equal(seen.delta, null)
    assert.equal(seen.priced, false)
    assert.equal(seen.quality, null)
  }))

// Window B, the lookback. taken_at is our own clock, the same axis as
// observed_at, so an answer older than the window is not read at all. Without
// it "the newest snapshot" has no age bound and last month's price publishes as
// today's. See docs/two-windows.md.
test('a snapshot older than the lookback is not read', () => withDb(db => {
  seedCell(db, { rows: SAMPLE, takenAt: '2026-08-20T12:00:00Z' })
  const out = cellSummary(db, common)
  assert.equal(out.baseline.value, null)
  assert.equal(out.sample.listings, 0)
  assert.deepEqual(out.mods, [])
}))

test('the newest answer to a question wins', () => withDb(db => {
  seedCell(db, { rows: SAMPLE, takenAt: '2026-08-28T12:00:00Z', idFor: (i) => `old${i}` })
  seedCell(db, {
    rows: [row(80, ['GOOD'], 'p'), row(90, ['GOOD'], 'q'), row(99, ['GOOD'], 'r')],
    takenAt: '2026-08-29T12:00:00Z',
    idFor: (i) => `new${i}`
  })
  const out = cellSummary(db, common)
  assert.equal(out.baseline.value, 99, 'the newer, thinner snapshot')
  assert.equal(out.mods.find(m => m.hash === 'GOOD').floor, 99)
}))

// The two bands, against a blank tablet that floors at 5. Every modifier here
// has three rows and three sellers, so nothing below turns on the sample gate.
const BANDS = [
  row(3, [], 'a'), row(4, [], 'b'), row(5, [], 'c'),
  row(6, ['UNDER'], 'd'), row(6, ['UNDER'], 'e'), row(7, ['UNDER'], 'f'),
  row(7.5, ['ON_MID'], 'g'), row(7.5, ['ON_MID'], 'h'), row(7.5, ['ON_MID'], 'i'),
  row(7, ['MID'], 'j'), row(7, ['MID'], 'k'), row(8, ['MID'], 'l'),
  row(10, ['ON_HIGH'], 'm'), row(10, ['ON_HIGH'], 'n'), row(10, ['ON_HIGH'], 'o'),
  row(10, ['HIGH'], 'p'), row(11, ['HIGH'], 'q'), row(12, ['HIGH'], 'r')
]

test('a modifier is banded by what it costs against a blank tablet', () => withDb(db => {
  seedCell(db, { rows: BANDS })
  const out = cellSummary(db, common)
  const band = (h) => out.mods.find(m => m.hash === h).quality
  assert.equal(out.baseline.value, 5, 'third cheapest of the whole cell')
  assert.equal(band('UNDER'), null, '7 is 1.4x the blank')
  assert.equal(band('MID'), 'mid', '8 is 1.6x')
  assert.equal(band('HIGH'), 'high', '12 is 2.4x')
}))

// A band is "at least", so a modifier landing exactly on one is in it. Stated
// because 1.5 and 2.0 are round numbers a real floor lands on often.
test('a modifier exactly on a band is in it', () => withDb(db => {
  seedCell(db, { rows: BANDS })
  const out = cellSummary(db, common)
  const band = (h) => out.mods.find(m => m.hash === h).quality
  assert.equal(band('ON_MID'), 'mid', 'exactly 1.5x')
  assert.equal(band('ON_HIGH'), 'high', 'exactly 2.0x')
}))

test('high sorts above mid, and mid above the unbanded', () => withDb(db => {
  seedCell(db, { rows: BANDS })
  const order = cellSummary(db, common).mods.map(m => m.quality)
  const rank = { high: 2, mid: 1 }
  const ranks = order.map(q => rank[q] ?? 0)
  assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a), order.join(','))
}))

// Two listings from one seller at ten times the blank is not a market price,
// whatever the ratio says.
test('a modifier with too thin a sample gets no band', () => withDb(db => {
  seedCell(db, {
    rows: [
      row(3, [], 'a'), row(4, [], 'b'), row(5, [], 'c'),
      row(50, ['THIN'], 'z'), row(60, ['THIN'], 'z')
    ]
  })
  const thin = cellSummary(db, common).mods.find(m => m.hash === 'THIN')
  assert.ok(thin.floor >= 50, 'it really is dear')
  assert.equal(thin.quality, null, 'two listings from one seller say nothing')
}))

// A missing band would compare against NaN and quietly call everything
// unbanded, which reads as "nothing here is worth anything".
test('a missing or inverted band is a fault, not a verdict', () => withDb(db => {
  seedCell(db, { rows: BANDS })
  const walk = { minListings: 3, minSellers: 2, minLift: 2 }
  assert.throws(
    () => cellSummary(db, { ...common, config: { ...config, walk: { ...walk, midVsBlank: 1.5 } } }),
    /highVsBlank must be a positive number/)
  assert.throws(
    () => cellSummary(db, {
      ...common,
      config: { ...config, walk: { ...walk, midVsBlank: 2.5, highVsBlank: 2 } }
    }),
    /below midVsBlank/)
}))

// A corrupted normal or magic tablet is not the plain tablet the cell prices.
// The live case: the newest Overseer normal snapshot held two rows, both
// corrupted, at 89 and 100 exalted, and that was the published price of a blank
// Overseer tablet.
test('a corrupted normal tablet is not priced as a blank one', () => withDb(db => {
  seedCell(db, {
    rarity: 'Normal',
    rows: [
      row(89, [], 'a', { corrupted: 1 }), row(100, [], 'b', { corrupted: 1 }),
      row(3, [], 'c'), row(4, [], 'd'), row(5, [], 'e')
    ]
  })
  const out = cellSummary(db, { ...common, rarity: 'Normal' })
  assert.equal(out.sample.listings, 3, 'the two corrupted rows are not in the sample')
  assert.equal(out.baseline.value, 5, 'third cheapest of 3/4/5, not of 3/4/5/89/100')
}))

test('a normal cell holding only corrupted tablets has no price at all', () => withDb(db => {
  seedCell(db, {
    rarity: 'Normal',
    rows: [row(89, [], 'a', { corrupted: 1 }), row(100, [], 'b', { corrupted: 1 })]
  })
  const out = cellSummary(db, { ...common, rarity: 'Normal' })
  assert.equal(out.sample.listings, 0)
  assert.equal(out.baseline.value, null, 'a gap the grid shows as a gap')
}))

// Rare is left alone: a corrupted rare carries the same modifiers a buyer
// searches for, and 88 of 4460 rare rows in the live archive are corrupted.
test('a corrupted rare is still part of the rare market', () => withDb(db => {
  seedCell(db, {
    rows: [row(3, [], 'a', { corrupted: 1 }), row(4, [], 'b'), row(5, [], 'c')]
  })
  const out = cellSummary(db, common)
  assert.equal(out.sample.listings, 3)
  assert.equal(out.baseline.value, 5)
}))

test('a cell with no snapshot at all has no baseline and no modifiers', () => withDb(db => {
  const out = cellSummary(db, common)
  assert.equal(out.baseline.value, null)
  assert.equal(out.takenAt, null)
  assert.deepEqual(out.mods, [])
}))
