import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bandOf } from '../lib/bands.mjs'

const walk = { midVsBlank: 1.5, highVsBlank: 2.1, minAdds: 10 }

test('a band comes from the ratio alone', () => {
  assert.equal(bandOf({ affixRatio: 3.0, adds: 100 }, walk), 'high')
  assert.equal(bandOf({ affixRatio: 1.6, adds: 100 }, walk), 'mid')
  assert.equal(bandOf({ affixRatio: 1.2, adds: 100 }, walk), 'low')
})

// "At least", so a ratio landing exactly on a threshold is inside it. Stated
// because real floors land on round multiples of the blank constantly.
test('a ratio exactly on a threshold is in that band', () => {
  assert.equal(bandOf({ affixRatio: 2.1, adds: 100 }, walk), 'high')
  assert.equal(bandOf({ affixRatio: 1.5, adds: 100 }, walk), 'mid')
})

// THE ABSOLUTE COMPANION, unchanged in meaning: a ratio against a junk floor is
// trivially cleared. It now demotes to `low` rather than to "cannot say",
// because falling short of real money IS a measurement.
test('a modifier that adds no real money is low however good the ratio', () => {
  assert.equal(bandOf({ affixRatio: 30, adds: 2 }, walk), 'low')
  assert.equal(bandOf({ affixRatio: 30, adds: 10 }, walk), 'high', 'exactly the companion')
})

// The whole point of the split. Sample size is evidence, not value, so it must
// not reach this function at all — a caller passing it in gets ignored.
test('the sample size does not change the band', () => {
  const dear = { affixRatio: 18.3, adds: 104 }
  assert.equal(bandOf({ ...dear, listings: 6, sellers: 2, fewSamples: true }, walk), 'high')
  assert.equal(bandOf({ ...dear, listings: 200, sellers: 90, fewSamples: false }, walk), 'high')
})

// null is now reserved for "we cannot say", and nothing else.
test('no ratio means no band, which is not the same as low', () => {
  assert.equal(bandOf({ affixRatio: null, adds: null }, walk), null, 'unpriced')
  assert.equal(bandOf({ affixRatio: undefined, adds: 5 }, walk), null, 'absent')
  assert.equal(bandOf({ affixRatio: 4, adds: null }, walk), null,
    'a ratio with no comparable delta cannot clear the companion')
})
