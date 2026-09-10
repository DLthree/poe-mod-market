import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ITEM_KINDS, KIND_KEYS, kindByKey, kindOfType, TABLET_TYPES, USES_IMPLICIT, MIN_USES
} from '../lib/item-kinds.mjs'
import { poolFor } from '../lib/mod-pool.mjs'

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
    const { groups, missing } = ITEM_KINDS.tablet.pinned(type, 'rare')
    assert.deepEqual(missing, [], type)
    assert.deepEqual(groups, [{
      type: 'and',
      filters: [{ id: USES_IMPLICIT[type], value: { min: MIN_USES }, disabled: false }]
    }], type)
  }
})

// A corrupted filter is NOT a stat group. It lives in query.filters.misc_filters,
// so `pinned` has to return it separately from `groups`, and both callers merge it
// into the query's own filters.
//
// The rule is lib/poe2.mjs pricesIncludeCorrupted, shared with lib/summary.mjs so
// the search and the summary cannot disagree about what a cell prices.
test('a magic or normal cell excludes corrupted items, a rare cell does not', () => {
  const excluded = { misc_filters: { filters: { corrupted: { option: 'false' } } } }
  for (const kind of Object.values(ITEM_KINDS)) {
    for (const rarity of kind.rarities) {
      const { filters } = kind.pinned(kind.types[0], rarity)
      const where = `${kind.key} ${rarity}`
      if (rarity === 'rare') assert.deepEqual(filters, {}, where)
      else assert.deepEqual(filters, excluded, where)
    }
  }
})

// The rarity is not optional. A caller that forgets it would silently price a
// magic cell with a rare cell's rules, and the search would spend allowance on
// listings the summary then discards.
test('pinned refuses to guess the rarity', () => {
  for (const kind of Object.values(ITEM_KINDS)) {
    assert.throws(() => kind.pinned(kind.types[0]), /rarity/, kind.key)
  }
})

// A jewel has no uses to filter on, but it does have a market inside its market.
// A search for an explicit stat id also returns items carrying that stat as a
// DESECRATED modifier, which is a different crafting mechanic at a different
// price. Measured 2026-09-10: all 19 Emerald rares carrying "increased maximum
// Energy Shield" were desecrated, on a base that cannot roll it at all.
//
// Pinning the count at zero makes a jewel price mean one thing. The trade link
// calls the same function, so it opens the same market, and nothing is missing.
// THE GROUP TYPE IS `not`, AND IT WAS MEASURED. An `and` group holding the same
// count at max 0 matched NOTHING: a blank Emerald rare reported 0 for sale,
// because an item with no desecrated modifier carries no such pseudo stat for a
// comparison to succeed against. A `not` group holding it at min 1 reports 10000
// for a blank, and 0 for the Energy Shield search that reported 22 without it.
// Probed 2026-09-10, five searches.
test('a jewel excludes desecrated modifiers and reports nothing missing', () => {
  for (const type of ITEM_KINDS.jewel.types) {
    const { groups, missing } = ITEM_KINDS.jewel.pinned(type, 'rare')
    assert.deepEqual(missing, [], type)
    assert.deepEqual(groups, [{
      type: 'not',
      filters: [{
        id: 'pseudo.pseudo_number_of_desecrated_mods',
        value: { min: 1 },
        disabled: false
      }]
    }], type)
  }
})

// THE SECOND SEAM. Where a kind's loop-2 vocabulary comes from. A tablet reads
// what it has seen, because its cheap end carries its premium modifiers. A jewel
// cannot: see docs/jewel-vocabulary-bias.md.
//
// BOTH sources are passed IN rather than reached for. THE BROWSER IMPORTS THIS
// FILE, so it must not pull in lib/mod-pool.mjs, which reads a file with node:fs
// and cannot run there. tests/web.test.mjs is what caught that.
test('every kind declares where its vocabulary comes from', () => {
  for (const kind of Object.values(ITEM_KINDS)) {
    assert.equal(typeof kind.vocabulary, 'function', kind.key)
  }
})

test('this file stays safe for the browser to import', () => {
  // Comments are stripped, as tests/contract.test.mjs does, because the comments
  // here name the very imports they warn against.
  const code = readFileSync(new URL('../lib/item-kinds.mjs', import.meta.url), 'utf8')
    .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(code, /from ['"]node:/, 'a node-only import would break web/app.js')
  assert.doesNotMatch(code, /mod-pool/, 'the pool reads a file and cannot load in a browser')
})

test('a tablet takes its vocabulary from what it has already seen', () => {
  const asked = []
  const observed = (type, rarity) => { asked.push([type, rarity]); return ['explicit.stat_1'] }
  const pool = () => { throw new Error('a tablet must not read the pool') }
  const got = ITEM_KINDS.tablet.vocabulary('Breach Tablet', 'rare', { observed, pool })
  assert.deepEqual(asked, [['Breach Tablet', 'rare']])
  assert.deepEqual(got, ['explicit.stat_1'])
})

// A base rolls one pool. The rarity limits how many modifiers land on one item,
// not which ones exist, so asking rare and magic the same questions is correct
// and is the whole point of reading the pool instead of the archive.
test('a jewel takes its vocabulary from the pool, whatever the rarity', () => {
  const observed = () => { throw new Error('a jewel must not read the archive for its vocabulary') }
  const sources = { observed, pool: poolFor }
  for (const type of ITEM_KINDS.jewel.types) {
    const magic = ITEM_KINDS.jewel.vocabulary(type, 'magic', sources)
    const rare = ITEM_KINDS.jewel.vocabulary(type, 'rare', sources)
    assert.deepEqual(magic, poolFor(type), type)
    assert.deepEqual(magic, rare, type)
  }
})

// The pools differ per base, so a jewel vocabulary must not ignore the type.
test('each jewel base gets its own vocabulary', () => {
  const sources = { observed: () => { throw new Error('unused') }, pool: poolFor }
  assert.notDeepEqual(
    ITEM_KINDS.jewel.vocabulary('Emerald', 'rare', sources),
    ITEM_KINDS.jewel.vocabulary('Ruby', 'rare', sources))
})

test('a tablet type with no known uses implicit pins nothing and says why', () => {
  const { groups, missing } = ITEM_KINDS.tablet.pinned('Nonexistent Tablet', 'rare')
  assert.deepEqual(groups, [], 'no half-built group carrying an undefined id')
  assert.equal(missing.length, 1)
  assert.match(missing[0], /part-used/)
})
