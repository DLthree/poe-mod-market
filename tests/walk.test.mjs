import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walk } from '../lib/walk.mjs'
import { makeFloor, STRATEGIES } from '../lib/floor.mjs'
import { handRows } from './fixtures/hand-rows.mjs'

const config = {
  minListings: 12,
  minSellers: 5,
  minLift: 3,
  floor: { strategy: 'nth-cheapest', n: 3 }
}
const pool = (over = {}) => walk(handRows(), { ...config, ...over }).pools[0]
const keys = (p) => p.meaningful.map(e => e.key)

test('a modifier that raises the floor is meaningful', () => {
  assert.ok(keys(pool()).includes('mod:VALUE'), keys(pool()).join(' '))
})

test('a second modifier that lifts above the first is also meaningful', () => {
  assert.ok(keys(pool()).includes('mod:SHADOW'), keys(pool()).join(' '))
})

test('a worthless rider is not meaningful, because it sits on cheap tablets too', () => {
  assert.ok(!keys(pool()).includes('mod:RIDER'), keys(pool()).join(' '))
})

test('a high floor held by two sellers fails the seller threshold', () => {
  assert.ok(!keys(pool()).includes('mod:THIN'), keys(pool()).join(' '))
})

test('filler is not meaningful', () => {
  assert.ok(!keys(pool()).includes('mod:JUNK'), keys(pool()).join(' '))
})

// The load-bearing test. Switching the tested statistic back to the plain
// minimum fails here, which is the point.
test('one dumped listing does not hide a valuable modifier', () => {
  const p = pool()
  assert.ok(keys(p).includes('mod:OUTLIER'), keys(p).join(' '))
  const e = p.meaningful.find(x => x.key === 'mod:OUTLIER')
  assert.equal(e.min, 1, 'the reported minimum is the real cheapest listing')
  assert.equal(e.floor, 40, 'the tested floor is the third-cheapest')
  assert.deepEqual(e.basis.map(b => b.amount), [1, 40, 40])
})

test('the plain-minimum strategy does hide it, which is why it is not the default', () => {
  const p = pool({ floor: { strategy: 'cheapest' } })
  assert.ok(!keys(p).includes('mod:OUTLIER'),
    'with strategy=cheapest the dumped listing suppresses the modifier')
})

test('the baseline excludes every row carrying a meaningful modifier', () => {
  assert.equal(pool().baseline.min, 1)
})

test('every entry carries its listing count and its seller count', () => {
  const p = pool()
  assert.ok(p.meaningful.length > 0)
  for (const e of p.meaningful) {
    assert.ok(e.listings >= config.minListings, e.key)
    assert.ok(e.sellers >= config.minSellers, e.key)
  }
})

test('open-affix candidates no row satisfies are not meaningful', () => {
  assert.ok(!keys(pool()).includes('openPrefix'))
  assert.ok(!keys(pool()).includes('openSuffix'))
})

test('the walk records which floor rule produced its numbers', () => {
  assert.equal(walk(handRows(), config).floorStrategy, 'nth-cheapest')
  assert.equal(
    walk(handRows(), { ...config, floor: { strategy: 'nth-cheapest-seller', n: 3 } })
      .floorStrategy,
    'nth-cheapest-seller')
})

test('swapping the floor rule needs no change outside floor.mjs', () => {
  for (const strategy of Object.keys(STRATEGIES)) {
    const out = walk(handRows(), { ...config, floor: { strategy, n: 3, windowHours: 24 } })
    assert.equal(out.pools.length, 1, strategy)
    assert.equal(out.floorStrategy, strategy)
  }
})

test('an unknown floor rule fails loudly rather than silently defaulting', () => {
  assert.throws(() => makeFloor({ strategy: 'wishful' }), /Unknown floor strategy/)
})

// Currencies are never converted. A pool priced in divine cannot be ranked
// against one priced in exalted, and the answer is to say so.
test('a pool keeps its dominant currency and counts what it set aside', () => {
  const rows = handRows()
  rows.push({
    listingId: 'd1', indexed: '2026-08-29T11:00:00Z', account: 'dv#1',
    amount: 2, currency: 'divine', rank: null,
    type: 'Breach Tablet', rarity: 'Rare', openPrefix: 0, openSuffix: 0,
    mods: [{ hash: 'JUNK', roll: 1, affix: 'JUNK' }]
  })
  const p = walk(rows, config).pools[0]
  assert.equal(p.baseline.currency, 'exalted')
  assert.equal(p.baseline.setAside, 1, 'the divine row is set aside, never converted')
})

test('a lift is not computed across currencies', async () => {
  const { lift } = await import('../lib/floor.mjs')
  assert.equal(lift({ floor: 2, currency: 'divine' }, { floor: 20, currency: 'exalted' }), null)
  assert.equal(lift({ floor: 40, currency: 'exalted' }, { floor: 20, currency: 'exalted' }), 2)
})

test('one seller holding the whole cheap end is discounted by the seller rule', () => {
  const rows = handRows()
  // Three dumped listings from ONE account. nth-cheapest sees a floor of 1;
  // nth-cheapest-seller counts that account once and looks past it.
  for (let i = 0; i < 3; i++) {
    rows.push({
      listingId: `dump${i}`, indexed: '2026-08-29T11:00:00Z', account: 'dumper#1', amount: 1, currency: 'exalted', rank: null,
      type: 'Breach Tablet', rarity: 'Rare', openPrefix: 0, openSuffix: 0,
      mods: [{ hash: 'VALUE', roll: 1, affix: 'VALUE' }]
    })
  }
  const plain = walk(rows, { ...config, floor: { strategy: 'nth-cheapest', n: 3 } })
  const perSeller = walk(rows, { ...config, floor: { strategy: 'nth-cheapest-seller', n: 3 } })
  const find = (o) => o.pools[0].meaningful.find(e => e.key === 'mod:VALUE')
  assert.equal(find(plain), undefined, 'three dumps from one account bury the modifier')
  assert.ok(find(perSeller), 'counting the account once recovers it')
})
