import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ITEM_KINDS, KIND_KEYS, kindByKey, kindOfType, TABLET_TYPES, USES_IMPLICIT, MIN_USES
} from '../lib/item-kinds.mjs'

test('every kind names itself with the key it is filed under', () => {
  for (const [key, kind] of Object.entries(ITEM_KINDS)) assert.equal(kind.key, key)
  assert.deepEqual(KIND_KEYS, Object.keys(ITEM_KINDS))
})

// kindOfType is a reverse map, and lib/derive.mjs reads a kind's affix caps
// through it. Two kinds claiming one type name would apply one kind's caps to
// the other kind's item, silently and one row at a time.
test('no type name is claimed by two kinds', () => {
  const seen = new Set()
  for (const kind of Object.values(ITEM_KINDS)) {
    for (const type of kind.types) {
      assert.ok(!seen.has(type), `${type} is claimed by more than one kind`)
      seen.add(type)
    }
  }
})

test('every type of every kind finds its way back to that kind', () => {
  for (const kind of Object.values(ITEM_KINDS)) {
    for (const type of kind.types) assert.equal(kindOfType(type), kind, type)
  }
  assert.equal(kindOfType('Nonexistent Tablet'), null)
})

// A mistyped kind must not fall back to tablets and collect the wrong market.
test('an unknown kind fails loudly and names the ones that exist', () => {
  assert.throws(() => kindByKey('tablets'), (e) => {
    assert.match(e.message, /tablets/)
    for (const k of KIND_KEYS) assert.match(e.message, new RegExp(k))
    return true
  })
})

test('the tablet kind still holds the eight types', () => {
  assert.equal(ITEM_KINDS.tablet.types, TABLET_TYPES)
  assert.equal(TABLET_TYPES.length, 8)
})

// The three bases the 2026-09-09 probe sampled. Across the three rare cells it
// saw 120 modifiers of which 110 were distinct, and exactly one appeared on all
// three, so these are three vocabularies and not one.
test('the jewel kind holds the three bases and no measured affix caps', () => {
  assert.deepEqual(ITEM_KINDS.jewel.types, ['Emerald', 'Ruby', 'Sapphire'])
  assert.equal(ITEM_KINDS.jewel.maxAffix, null,
    'unmeasured, and null is what makes lib/derive.mjs store "unknown" rather than a guess')
})

// The grid labels a row with this. A tablet type reads better without the word
// repeated down the column; a jewel base is already the whole name.
test('each kind shortens its own type names for the grid', () => {
  assert.equal(ITEM_KINDS.tablet.short('Breach Tablet'), 'Breach')
  assert.equal(ITEM_KINDS.jewel.short('Emerald'), 'Emerald')
})

// The filter the trade site itself uses for uses remaining. A `min` on it is
// how a search says "not part-used", and it cannot be recovered afterwards: a
// fetched item reports magnitude 10 whatever it has left.
test('a tablet pins its uses implicit and reports nothing missing', () => {
  for (const type of ITEM_KINDS.tablet.types) {
    const { groups, missing } = ITEM_KINDS.tablet.pinned(type)
    assert.deepEqual(missing, [], type)
    assert.deepEqual(groups, [{
      type: 'and',
      filters: [{ id: USES_IMPLICIT[type], value: { min: MIN_USES }, disabled: false }]
    }], type)
  }
})

// A jewel has no uses to filter on. That is not a shortfall, and the trade link
// must not report itself inexact for lacking a filter jewels do not have.
test('a jewel pins nothing and reports nothing missing', () => {
  for (const type of ITEM_KINDS.jewel.types) {
    assert.deepEqual(ITEM_KINDS.jewel.pinned(type), { groups: [], missing: [] }, type)
  }
})

test('a tablet type with no known uses implicit pins nothing and says why', () => {
  const { groups, missing } = ITEM_KINDS.tablet.pinned('Nonexistent Tablet')
  assert.deepEqual(groups, [], 'no half-built group carrying an undefined id')
  assert.equal(missing.length, 1)
  assert.match(missing[0], /part-used/)
})
