import { test } from 'node:test'
import assert from 'node:assert/strict'
import { poolFor, POOL_BASES } from '../lib/mod-pool.mjs'

// The counts the game data reported on 2026-09-10, patch 4.5.5.1.6. They are
// asserted so that a re-extraction after a patch cannot change the market this
// repo sweeps without somebody reading the diff.
// See docs/jewel-modifier-pool.md.
const EXPECTED = { Ruby: 50, Emerald: 74, Sapphire: 58 }

test('every tradeable jewel base has the pool the game data reported', () => {
  assert.deepEqual(POOL_BASES.slice().sort(), ['Emerald', 'Ruby', 'Sapphire'])
  for (const [base, n] of Object.entries(EXPECTED)) {
    assert.equal(poolFor(base).length, n, base)
  }
})

// A vocabulary is what the sweep spends allowance on, one search per entry. A
// duplicate is a search bought twice for one answer.
test('a pool holds no duplicate stat id', () => {
  for (const base of POOL_BASES) {
    const ids = poolFor(base)
    assert.equal(new Set(ids).size, ids.length, base)
  }
})

// The sweep asks the explicit domain. A desecrated or pseudo id here would ask
// a different question under the modifier's name.
test('every entry is an explicit trade stat id', () => {
  for (const base of POOL_BASES) {
    for (const id of poolFor(base)) {
      assert.match(id, /^explicit\.stat_\d+$/, `${base}: ${id}`)
    }
  }
})

// The pool is only useful if it is TOTAL. A pool that silently drops the
// modifiers it could not resolve would look like a complete sweep and would
// quietly miss exactly the rows the observation-driven vocabulary missed.
test('no modifier is dropped for want of a trade stat id', () => {
  assert.doesNotThrow(() => POOL_BASES.forEach(poolFor))
})

// The three bases do not share a pool. Emerald is dexjewel, Ruby strjewel and
// Sapphire intjewel, and only two modifiers roll on all three.
test('the three bases carry different pools', () => {
  const [emerald, ruby] = [new Set(poolFor('Emerald')), new Set(poolFor('Ruby'))]
  const shared = [...emerald].filter(id => ruby.has(id))
  assert.ok(shared.length < 10, `Emerald and Ruby share ${shared.length} modifiers`)
})

// A base outside the pool must not read as an empty vocabulary: the sweep would
// spend a pool search, ask nothing, and record a cell that looks measured.
test('an unknown base fails loudly and names the ones that exist', () => {
  assert.throws(() => poolFor('Diamond'), (e) => {
    assert.match(e.message, /Diamond/)
    for (const b of POOL_BASES) assert.match(e.message, new RegExp(b))
    return true
  })
})
