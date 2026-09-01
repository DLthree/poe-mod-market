import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildIndex, resolveStat, vendoredEe2 } from '../lib/stat-index.mjs'

const stats = JSON.parse(readFileSync(new URL('./fixtures/stats-subset.json', import.meta.url)))
const ee2 = readFileSync(new URL('./fixtures/ee2-subset.ndjson', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l))
const index = buildIndex(stats, ee2)

test('a rolled clipboard line yields its value and its band', () => {
  const r = resolveStat(index, 'Map has 33(25-35)% increased number of Rare Monsters')
  assert.deepEqual(r.hashes, ['explicit.stat_3793155082'])
  assert.equal(r.roll, 33)
  assert.deepEqual(r.bounds, { min: 25, max: 35 })
})

test('a line with no band still yields its roll', () => {
  const r = resolveStat(index, 'Map has 33% increased number of Rare Monsters')
  assert.equal(r.roll, 33)
  assert.equal(r.bounds, null)
})

// The game writes a descending band when a lower roll is the better one.
test('a descending band is normalised so min is the smaller number', () => {
  const r = resolveStat(index, 'Delirium Fog in Map dissipates 29(30-20)% slower')
  assert.ok(r.bounds.min < r.bounds.max, `got ${JSON.stringify(r.bounds)}`)
})

// The trade API has no "slower" stat at all; it is the "faster" stat negated.
test('a negated wording resolves to the positive stat with a negative roll', () => {
  const r = resolveStat(index, 'Delirium Fog in Map dissipates 29(30-20)% slower')
  assert.deepEqual(r.hashes, ['explicit.stat_3350944114'])
  assert.equal(r.negate, true)
  assert.equal(r.roll, -29)
})

// GGG's own table writes this one "... in Map (Gold Piles)"; the item does not.
test('a stat whose table text carries a trailing qualifier still resolves', () => {
  const r = resolveStat(index, '28(25-35)% increased Gold found in Map')
  assert.ok(r, 'should resolve')
  assert.ok(r.hashes.includes('explicit.stat_1276056105'), JSON.stringify(r.hashes))
  assert.equal(r.roll, 28)
})

test('a wording that covers two trade ids returns both', () => {
  const r = resolveStat(index, '28% increased Gold found in Map')
  assert.deepEqual([...r.hashes].sort(),
    ['explicit.stat_1133965702', 'explicit.stat_1276056105'])
})

// "an additional" is a roll of one written as a word. 53 of 896 stored rows
// lost their roll to this before it was handled.
test('a worded singular yields a roll of one', () => {
  const r = resolveStat(index, 'Map contains an additional Rare Chest')
  assert.deepEqual(r.hashes, ['explicit.stat_231864447'])
  assert.equal(r.roll, 1)
})

test('the plural of the same stat yields its written number', () => {
  const r = resolveStat(index, 'Map contains 2(2-3) additional Rare Chests')
  assert.deepEqual(r.hashes, ['explicit.stat_231864447'])
  assert.equal(r.roll, 2)
})

test('an unknown line resolves to null rather than guessing', () => {
  assert.equal(resolveStat(index, 'Grants Level 20 Nonsense Skill'), null)
})

test('link markup is stripped before matching', () => {
  const r = resolveStat(index, 'Map has 39% increased [Magic] Monsters')
  assert.deepEqual(r.hashes, ['explicit.stat_3873704640'])
})

// The wiring that matters: every script that reads the archive must get the
// matchers, or a roll silently goes back to null.
test('the vendored matcher table loads and covers the wordings GGG lacks', () => {
  const wired = buildIndex(stats, vendoredEe2())
  const r = resolveStat(wired, 'Delirium Fog in Map dissipates 29(30-20)% slower')
  assert.equal(r.negate, true)
  assert.equal(r.hashes[0], 'explicit.stat_3350944114')
})

// The vendored table sits outside the gitignored data/ directory on purpose.
// When it was inside, a fresh clone would have loaded an empty overlay and
// every worded roll would have gone quietly back to null.
test('the vendored matcher table is checked in and not a stub', () => {
  assert.ok(vendoredEe2().length > 1000, `only ${vendoredEe2().length} entries`)
})

// The overlay knows every WORDING; GGG's table is the authority on WHICH ID a
// listing actually carries. Measured 2026-08-30 against 2054 collected rows:
// the overlay's first id had 0 rows in all three cases below, and the id GGG's
// own table gives had 181, 747 and the rest. Wording from EE2, identity from GGG.
test('the id comes from GGG when its table knows the exact wording', () => {
  const r = resolveStat(index, '16(12-18)% increased Experience gain in Map')
  assert.equal(r.hashes[0], 'explicit.stat_57434274')
})

test('a trailing qualifier in GGG\'s table does not send us to the wrong id', () => {
  // GGG writes "#% increased Gold found in Map (Gold Piles)"; the item does not.
  const r = resolveStat(index, '28(25-35)% increased Gold found in Map')
  assert.equal(r.hashes[0], 'explicit.stat_1276056105')
})

test('the overlay never overrides an id GGG already resolves', () => {
  const r = resolveStat(index, 'Map has 94(70-100)% increased chance to contain a Summoning Circle')
  assert.equal(r.hashes[0], 'explicit.stat_267210597')
})

test('an id GGG has never heard of ranks below one it knows', () => {
  const r = resolveStat(index, 'Map has 94(70-100)% increased chance to contain a Summoning Circle')
  assert.ok(!r.hashes.slice(0, 1).includes('explicit.stat_866117935'), JSON.stringify(r.hashes))
})

// The Breach premium. EE2's table has no entry for it at all, and GGG writes it
// singular with no placeholder, so it survives only on the loose key. If the
// overlay ever shadowed that path, the highest-lift modifier found so far would
// stop resolving.
test('a stat only the loose key can reach still resolves', () => {
  const r = resolveStat(index,
    'Unstable Breaches in Map spawn 3 additional Rare Monsters when Stabilised')
  assert.deepEqual(r.hashes, ['explicit.stat_3762913035'])
  assert.equal(r.roll, 3)
})
