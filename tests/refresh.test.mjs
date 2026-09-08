// A quick pass spends its allowance on the modifiers the last pass already
// measured as worth something. These tests pin what it selects and, just as
// importantly, what it silently cannot see.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quickAffixes } from '../lib/refresh.mjs'
import { withDb, seedCell } from './helpers.mjs'

const NOW = Date.parse('2026-08-29T13:00:00Z')
const config = {
  floor: { strategy: 'nth-cheapest', n: 3 },
  walk: { minListings: 3, minSellers: 2, minLift: 2, minAdds: 0, midVsBlank: 1.5, highVsBlank: 2 },
  exchange: { exalted: 1, divine: 100, chaos: 5 }
}
const common = { league: 'L', type: 'Breach Tablet', rarity: 'rare',
  lookbackHours: 48, config, now: NOW }

// A blank tablet at 10 exalted, and three modifiers at 3.0x, 1.6x and 1.1x of
// it. Four sellers each, so nothing is thrown out for a thin sample — this file
// is about the ratio and nothing else.
const seed = (db) => seedCell(db, {
  rows: [
    ...['A', 'B', 'C', 'D'].map(a => ({ account: a, amount: 10 })),
    ...['E', 'F', 'G', 'H'].map(a => ({ account: a, amount: 30, mods: ['explicit.hi'] })),
    ...['I', 'J', 'K', 'L'].map(a => ({ account: a, amount: 16, mods: ['explicit.mid'] })),
    ...['M', 'N', 'O', 'P'].map(a => ({ account: a, amount: 11, mods: ['explicit.low'] }))
  ]
})

test('the threshold keeps the modifiers at or above it and drops the rest', () => withDb(db => {
  seed(db)
  assert.deepEqual(quickAffixes(db, { ...common, minRatio: 1.5 }),
    ['explicit.hi', 'explicit.mid'])
  assert.deepEqual(quickAffixes(db, { ...common, minRatio: 2 }), ['explicit.hi'])
}))

// A pass that runs out of allowance halfway should have spent it on the
// modifiers that matter most, not on whatever came back first.
test('the selection is dearest first', () => withDb(db => {
  seed(db)
  assert.deepEqual(quickAffixes(db, { ...common, minRatio: 1 }),
    ['explicit.hi', 'explicit.mid', 'explicit.low'])
}))

// The threshold is inclusive, the same way the bands are. 1.6 exactly is in.
test('a modifier sitting exactly on the threshold is kept', () => withDb(db => {
  seed(db)
  assert.ok(quickAffixes(db, { ...common, minRatio: 1.6 }).includes('explicit.mid'))
}))

// THE LIMIT THIS FUNCTION HAS, WRITTEN DOWN AS A TEST.
//
// A modifier with no ratio at all is invisible to a quick pass and will not be
// re-asked; it keeps its old floor until a full pass. Since config.exchange
// arrived that means a currency the rate table has no entry for, not merely a
// different one from the baseline's.
test('a modifier with no comparable ratio is invisible to a quick pass', () => withDb(db => {
  seedCell(db, {
    rows: [
      ...['A', 'B', 'C', 'D'].map(a => ({ account: a, amount: 10 })),
      ...['E', 'F', 'G', 'H'].map(a => ({
        account: a, amount: 40, currency: 'mirror', mods: ['explicit.odd']
      }))
    ]
  })
  assert.deepEqual(quickAffixes(db, { ...common, minRatio: 1 }), [])
}))

// And the counterpart: a divine modifier on an exalted cell IS selected now,
// which is most of the point. Before the rate table these were the dearest
// modifiers in the league and no pass re-asked about any of them.
test('a modifier priced in divine on an exalted cell is selected', () => withDb(db => {
  seedCell(db, {
    rows: [
      ...['A', 'B', 'C', 'D'].map(a => ({ account: a, amount: 10 })),
      ...['E', 'F', 'G', 'H'].map(a => ({
        account: a, amount: 40, currency: 'divine', mods: ['explicit.divine']
      }))
    ]
  })
  assert.deepEqual(quickAffixes(db, { ...common, minRatio: 1.5 }), ['explicit.divine'])
}))

// Zero or missing would quietly select everything, which is a full pass wearing
// a quick pass's name and about two hours of allowance.
test('a missing or zero threshold is refused rather than treated as no limit', () => withDb(db => {
  seed(db)
  for (const bad of [undefined, null, 0, -1, 'x']) {
    assert.throws(() => quickAffixes(db, { ...common, minRatio: bad }), /positive minRatio/)
  }
}))

// The archive spells a rarity as GGG does on an item; a query option is lower
// case. Callers pass the query's spelling, so both have to land on the same
// snapshot or a quick pass selects nothing and reports it as "nothing worth
// re-asking".
test('the rarity is canonicalised, so either spelling finds the cell', () => withDb(db => {
  seed(db)
  assert.deepEqual(quickAffixes(db, { ...common, rarity: 'rare', minRatio: 2 }),
    quickAffixes(db, { ...common, rarity: 'Rare', minRatio: 2 }))
  assert.equal(quickAffixes(db, { ...common, rarity: 'RARE', minRatio: 2 }).length, 1)
}))
