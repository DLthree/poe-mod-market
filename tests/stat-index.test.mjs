import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildIndex, rollsFrom, hashFor, textFor } from '../lib/stat-index.mjs'

const stats = JSON.parse(readFileSync(new URL('./fixtures/stats-subset.json', import.meta.url)))
const index = buildIndex(stats)

test('an entry is reachable by its id', () => {
  const e = index.byId.get('explicit.stat_3762913035')
  assert.ok(e, 'stat_3762913035 should be in the fixture')
  assert.match(e.text, /Unstable/)
})

test('the rolled number comes back out of a description', () => {
  const e = index.byId.get('explicit.stat_3762913035')
  const desc = 'Unstable [ContainsBreach|Breaches] in Map spawn 3 additional ' +
    '[Rarity|Rare] Monsters when Stabilised'
  assert.deepEqual(rollsFrom(e, desc), [3])
})

test('a percentage roll comes back out too', () => {
  const e = index.byId.get('explicit.stat_2778285247')
  assert.deepEqual(rollsFrom(e, '44% increased Quantity of Hiveblood found in Map'), [44])
})

test('a description with no numbers yields no rolls', () => {
  const e = index.byId.get('explicit.stat_2778285247')
  assert.deepEqual(rollsFrom(e, 'something else entirely'), [])
})

// Real mismatch, found 2026-08-29. GGG's stats table writes this one singular
// and with no placeholder; the item text writes it plural and with a number.
test('a stat whose table text has no placeholder still yields its roll', () => {
  const e = index.byId.get('explicit.stat_3762913035')
  assert.ok(!e.text.includes('#'), 'the fixture must keep the placeholder-free wording')
  assert.deepEqual(
    rollsFrom(e, 'Unstable Breaches in Map spawn 3 additional Rare Monsters when Stabilised'),
    [3])
})

test('a plural item line resolves to a singular table entry', () => {
  assert.equal(
    hashFor(index, 'Unstable Breaches in Map spawn 3 additional Rare Monsters when Stabilised'),
    'explicit.stat_3762913035')
})

test('a clipboard line resolves to its stat id', () => {
  assert.equal(hashFor(index, 'Map has 30% increased number of Rare Monsters'),
    'explicit.stat_3793155082')
})

test('an unknown line resolves to null rather than guessing', () => {
  assert.equal(hashFor(index, 'Grants Level 20 Nonsense Skill'), null)
})

test('a hash renders as readable text, and an unknown one as itself', () => {
  assert.match(textFor(index, 'explicit.stat_3762913035'), /Unstable/)
  assert.equal(textFor(index, 'explicit.stat_nope'), 'explicit.stat_nope')
})
