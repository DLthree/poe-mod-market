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
  walk: { minListings: 3, minSellers: 2, minLift: 2, minAdds: 0, midVsBlank: 1.5, highVsBlank: 2 }
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
// A modifier priced in a currency the blank tablet is not has no ratio at all,
// so a quick pass cannot see it and will not re-ask about it. It keeps its old
// floor until a full pass. That is the trade, and it is why --quick is a
// refresh and not a cheaper full pass.
test('a modifier with no comparable ratio is invisible to a quick pass', () => withDb(db => {
  seedCell(db, {
    rows: [
      ...['A', 'B', 'C', 'D'].map(a => ({ account: a, amount: 10 })),
      // Dearer than the blank rows by raw amount, so the baseline stays
      // exalted: the baseline is the cheapest tablet of any kind, and a cheap
      // divine number would take it over and make the currencies agree again.
      ...['E', 'F', 'G', 'H'].map(a => ({
        account: a, amount: 40, currency: 'divine', mods: ['explicit.divine']
      }))
    ]
  })
  assert.deepEqual(quickAffixes(db, { ...common, minRatio: 1 }), [])
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
