import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeFloor } from '../lib/floor.mjs'

const NOW = Date.parse('2026-08-31T12:00:00Z')
const nth3 = makeFloor({ strategy: 'nth-cheapest', n: 3 })

let n = 0
const row = (amount, over = {}) => ({
  listingId: `l${++n}`,
  indexed: '2026-08-31T06:00:00Z',
  account: `acc${n}`,
  amount,
  currency: 'exalted',
  rank: n - 1,
  ...over
})

// The rows of a snapshot arrive in the order GGG ranked them, and that order
// already accounts for exalted against divine using a rate we do not hold.
test('rank decides the order, not the amount', () => {
  const f = nth3([
    { ...row(50), rank: 0 }, { ...row(60), rank: 1 }, { ...row(1, { currency: 'divine' }), rank: 2 }
  ], NOW)
  assert.equal(f.value, 1, 'the third RANKED row, not the cheapest number')
  assert.equal(f.currency, 'divine')
})

// The vote that used to run here discarded every row in the losing currency.
// On one live cell it threw away three rows GGG had ranked cheapest.
test('a fully ranked pool keeps every row, whatever its currency', () => {
  n = 0
  const f = nth3([row(5), row(9, { currency: 'divine' }), row(12), row(20)], NOW)
  assert.equal(f.setAside, 0)
  assert.equal(f.basis.length, 3)
})

test('the floor reports the currency of the row it landed on', () => {
  n = 0
  const f = nth3([row(5), row(9), row(2, { currency: 'divine' })], NOW)
  assert.equal(f.value, 2)
  assert.equal(f.currency, 'divine')
})

// Reporting one currency for both numbers would be a quiet lie the day they
// differ, and the day they differ is the day the number matters.
test('the cheapest row carries its own currency', () => {
  n = 0
  const f = nth3([row(1, { currency: 'divine' }), row(39), row(50)], NOW)
  assert.equal(f.min, 1)
  assert.equal(f.minCurrency, 'divine')
  assert.equal(f.value, 50)
  assert.equal(f.currency, 'exalted')
})

// A row replayed from the archive lost the page offset it was ranked by. The
// amount is then the only ordering left, and it means nothing across
// currencies, so the pool is reduced to its most common one first.
test('an unranked pool is reduced to its most common currency', () => {
  n = 0
  const rows = [
    row(3, { rank: null }), row(4, { rank: null }), row(5, { rank: null }),
    row(1, { rank: null, currency: 'divine' }), row(2, { rank: null, currency: 'divine' })
  ]
  const f = nth3(rows, NOW)
  assert.equal(f.currency, 'exalted', 'three exalted rows against two divine')
  assert.equal(f.setAside, 2, 'the divine rows are counted, never converted')
  assert.equal(f.value, 5)
})

// One unranked row is enough: the pool no longer has an ordering from GGG.
test('a pool is only trusted whole when every row carries a rank', () => {
  n = 0
  const rows = [row(3), row(4), row(5), row(1, { rank: null, currency: 'divine' })]
  assert.equal(nth3(rows, NOW).setAside, 1)
})

test('an empty pool has no floor and no currency', () => {
  const f = nth3([], NOW)
  assert.equal(f.value, null)
  assert.equal(f.currency, null)
  assert.equal(f.min, null)
  assert.deepEqual(f.basis, [])
})

// The reported number is the nth, and the basis shows every row it rested on.
// Being able to see them is what made the merged-pool bug findable at all.
test('the basis shows the rows the number rested on', () => {
  n = 0
  const f = nth3([row(5), row(9), row(50), row(60)], NOW)
  assert.deepEqual(f.basis.map(b => b.amount), [5, 9, 50])
  assert.equal(f.value, 50)
})

// One seller holding the whole cheap end counts once, and swapping the rule
// costs nothing downstream: nothing outside floor.mjs knows which ran.
test('a seller rule counts one seller once, inside a snapshot too', () => {
  n = 0
  const rows = [
    { ...row(1), account: 'dumper' }, { ...row(2), account: 'dumper' },
    { ...row(3), account: 'dumper' }, { ...row(40), account: 'b' },
    { ...row(45), account: 'c' }
  ]
  const seller = makeFloor({ strategy: 'nth-cheapest-seller', n: 3 })
  assert.equal(seller(rows, NOW).value, 45)
  assert.equal(nth3(rows, NOW).value, 3, 'the plain rule reads all three dumps')
})

test('an unknown strategy fails loudly rather than defaulting', () => {
  assert.throws(() => makeFloor({ strategy: 'wishful' }), /Unknown floor strategy/)
})
