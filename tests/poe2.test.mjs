import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRADE_WINDOWS, validateTradeWindow } from '../lib/poe2.mjs'

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
