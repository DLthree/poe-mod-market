import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRADE_WINDOWS, validateTradeWindow, pricesIncludeCorrupted } from '../lib/poe2.mjs'

// ONE RULE, TWO READERS. lib/summary.mjs drops corrupted rows from the cells this
// returns false for, and lib/item-kinds.mjs excludes them from the search for the
// same cells. Two copies of that rule drifted: the search collected corrupted
// listings, the summary discarded them, and the trade link opened a market whose
// cheap end the published price had excluded — while calling itself exact.
test('a rare is priced with its corrupted listings, a magic or normal is not', () => {
  assert.equal(pricesIncludeCorrupted('rare'), true)
  assert.equal(pricesIncludeCorrupted('magic'), false)
  assert.equal(pricesIncludeCorrupted('normal'), false)
})

// The database spells a rarity as GGG does, "Rare"; a query option is lower case.
// Both readers pass what they hold, so this must not care.
test('the corrupted rule does not care how the rarity is spelled', () => {
  for (const r of ['Rare', 'rare', 'RARE']) assert.equal(pricesIncludeCorrupted(r), true, r)
  for (const r of ['Magic', 'magic', 'Normal']) assert.equal(pricesIncludeCorrupted(r), false, r)
})

test('every value docs/two-windows.md lists as valid passes', () => {
  for (const v of TRADE_WINDOWS) assert.doesNotThrow(() => validateTradeWindow(v))
})

test('a misspelt tradeWindow fails fast, naming the bad value and the valid ones', () => {
  assert.throws(() => validateTradeWindow('3day'), (e) => {
    assert.match(e.message, /3day/)
    for (const v of TRADE_WINDOWS) assert.match(e.message, new RegExp(v))
    return true
  })
})

test('a missing tradeWindow fails fast rather than silently dropping the filter', () => {
  assert.throws(() => validateTradeWindow(undefined), /tradeWindow/)
})
