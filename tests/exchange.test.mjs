// The rate table is a standing guess, so what it refuses matters as much as
// what it converts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inExalted, validateExchange } from '../lib/exchange.mjs'
import { readFileSync } from 'node:fs'

const RATES = { exalted: 1, divine: 100, chaos: 5 }

test('a price is stated as a number of exalted', () => {
  assert.equal(inExalted(4, 'divine', RATES), 400)
  assert.equal(inExalted(3, 'chaos', RATES), 15)
  assert.equal(inExalted(38, 'exalted', RATES), 38)
})

// A fallback of 1 would price a mirror at one exalted and sort it to the cheap
// end of its cell, where the floor is read.
test('a currency with no rate gives null, never a fallback of one', () => {
  assert.equal(inExalted(2, 'mirror', RATES), null)
  assert.equal(inExalted(2, null, RATES), null)
  assert.equal(inExalted(2, 'divine', undefined), null)
})

test('no price gives no number', () => {
  assert.equal(inExalted(null, 'divine', RATES), null)
  assert.equal(inExalted(undefined, 'divine', RATES), null)
})

// Exalted is the unit. Anything else there multiplies every ratio in the
// published file by that factor while each one still looks like a price.
test('exalted must be exactly one', () => {
  assert.throws(() => validateExchange({ exalted: 2, divine: 100 }), /exactly 1/)
  assert.throws(() => validateExchange({ divine: 100 }), /exactly 1/)
  assert.throws(() => validateExchange(null), /exchange/)
})

// Zero says "worth nothing", which is a claim. Absent says "cannot compare",
// which is the truth when we do not know. They must not be spelled the same.
test('a zero or negative rate is refused rather than read as unknown', () => {
  assert.throws(() => validateExchange({ exalted: 1, divine: 0 }), /positive number/)
  assert.throws(() => validateExchange({ exalted: 1, divine: -5 }), /positive number/)
  validateExchange(RATES)
})

// The shipped config has to pass its own validator, or every build fails on a
// file nobody looked at.
test('the config in this repo is a valid rate table', () => {
  const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)))
  validateExchange(config.exchange)
  assert.ok(config.exchange.divine > config.exchange.exalted, 'a divine is worth more')
})
