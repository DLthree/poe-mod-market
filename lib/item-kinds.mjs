// PHASE 2 by tests/contract.test.mjs, and that is deliberate. This file holds
// pure data and pure functions: it names no table and constructs no client, so
// BOTH phases may import it and a new item kind needs no EXEMPT entry.
//
// ONE KIND IS ONE OBJECT. Everything that differs between a tablet and a jewel
// is a field here. Everything else in lib/ takes a type and a rarity as
// parameters and does not care which kind they came from — which is why
// summary, floor, walk, bands, exchange and snapshots are untouched by a
// second item kind.

// Expedition Tablet returned 0 listings on 2026-08-28 and was dropped as gone
// in 0.5.0. It is back and trading in Forbidden Rites, measured 2026-09-06.
// Presence in GGG's stat table is NOT the test — implicit.stat_1714888636 was
// in the cached table the whole time it was untradeable, because that table is
// historical. Ask the market.
//
// Unique tablets price by name, not by modifier, and are out of scope.
export const TABLET_TYPES = [
  'Abyss Tablet', 'Breach Tablet', 'Delirium Tablet', 'Expedition Tablet',
  'Irradiated Tablet', 'Overseer Tablet', 'Ritual Tablet', 'Temple Tablet'
]

// Every tablet carries one implicit — "Adds Abysses to a Map", and under it the
// uses it has left. The stat id is per tablet type and does not change with the
// prefix or suffix: all 340 distinct names in the pre-0.5.0 archive reduced to
// seven of these, before Expedition Tablet came back.
//
// This is the filter the trade site itself uses for uses remaining, so a `min`
// on it is how a search says "not part-used". It has to be asked of GGG,
// because the answer is not in what GGG sends back: a fetched item reports
// `magnitudes: {min: 10, max: 10}` whatever it has left, and the true count
// appears only in the printed line ("5 uses remaining"). Reading it from our
// own rows is therefore not an option, and filtering at collection is.
export const USES_IMPLICIT = {
  'Abyss Tablet': 'implicit.stat_2369421690',
  'Breach Tablet': 'implicit.stat_2219129443',
  'Delirium Tablet': 'implicit.stat_3879011313',
  'Expedition Tablet': 'implicit.stat_1714888636',
  'Irradiated Tablet': 'implicit.stat_4041853756',
  'Overseer Tablet': 'implicit.stat_3376302538',
  'Ritual Tablet': 'implicit.stat_3166002380',
  'Temple Tablet': 'implicit.stat_3035440454'
}

// A part-used tablet is a different item at a different price, and it sits at
// the cheap end where the floor is read. The cheapest rare Delirium and rare
// Irradiated listings in the archive are 1 exalted with two or three uses left,
// on cells whose whole price is 1 exalted.
//
// Ten is full. Some tablets carry more — a modifier grants them — and `min`
// keeps those, which is right: they are worth more, not less.
//
// It lives beside the kind rather than in the sweep because the collection
// query and the link the page hands a person have to ask for the same item.
// They did not, and the link returned part-used tablets under prices that had
// excluded them.
export const MIN_USES = 10

// Measured 2026-08-30 over 3540 rare and 154 magic tablets, across all seven
// types. The first estimate said 2 and 2 for a rare, from 20 items of one type,
// and stored open_suffix = -1 the first time a three-suffix rare turned up.
//
// Three prefixes appear on 2 items and three suffixes on 16, so both are real
// and neither is common. No rare carried more than FIVE modifiers in total, so
// these two numbers are not independent — a 2p 2s tablet has room for one more,
// not one of each. That total is not modelled: 5 is inferred from 18 items, and
// derive.mjs clamps at zero, so guessing wrong here costs nothing.
export const MAX_AFFIX = {
  Magic: { prefix: 1, suffix: 1 },
  Rare: { prefix: 3, suffix: 3 }
}

// The same shape the trade site builds, as its own stat group so the modifier
// group and this one never contend for a slot.
const usesGroup = (statId) => ({
  type: 'and',
  filters: [{ id: statId, value: { min: MIN_USES }, disabled: false }]
})

export const ITEM_KINDS = {
  tablet: {
    key: 'tablet',
    // GGG's own singular. lib/economy.mjs puts it in the path poe.re fetches,
    // so it is not free to change.
    label: 'Tablet',
    plural: 'Tablets',
    title: 'Tablet prices',
    types: TABLET_TYPES,
    // The grid puts the kind in its own heading, so repeating " Tablet" down
    // every row of the column says nothing.
    short: (type) => type.replace(' Tablet', ''),
    maxAffix: MAX_AFFIX,
    // THE SEAM. What every search of this kind pins beyond the modifier group,
    // and the reason for anything it cannot pin.
    //
    // lib/sweep.mjs and lib/trade-url.mjs both call this, and that is the whole
    // point: a price here is the price of a FULL tablet, so a link that omits
    // the uses filter opens a market whose cheap end the price excluded. It
    // shipped that way until 2026-09-07. One function, two callers, no drift.
    //
    // The two callers treat `missing` differently, on purpose. The sweep
    // THROWS, because a search that quietly drops a filter spends allowance
    // that cannot be bought back on a question other than the one it recorded.
    // The link DEGRADES and says so, because a search of the right item at the
    // wrong depth beats no search.
    pinned (type) {
      const id = USES_IMPLICIT[type]
      if (!id) {
        return {
          groups: [],
          missing: [`no uses implicit known for ${type}; the search includes part-used tablets`]
        }
      }
      return { groups: [usesGroup(id)], missing: [] }
    }
  },
  jewel: {
    key: 'jewel',
    label: 'Jewel',
    plural: 'Jewels',
    title: 'Jewel prices',
    // Measured 2026-09-09 over 6 searches and 18 fetches. The three bases do
    // NOT share a modifier pool: 120 modifiers across the three rare cells were
    // 110 distinct, and exactly one appeared on all three. Magic overlap was
    // 4%. So each base needs its own vocabulary and its own searches, and they
    // cannot be folded into one type carrying a base attribute.
    //
    // THESE NAMES ARE NOT YET VERIFIED against the strings the trade API
    // accepts as a `type`. If GGG spells them differently, every jewel search
    // returns nothing while looking like it worked. One search settles it, and
    // it must happen before any full pass.
    types: ['Emerald', 'Ruby', 'Sapphire'],
    // A jewel base name is already the whole name.
    short: (type) => type,
    // UNMEASURED. Null is not a placeholder: lib/derive.mjs reads it as "we do
    // not know how many affix slots this kind has", stores null open-affix
    // counts, and lib/walk.mjs already reads a null count as unknown rather
    // than as an open affix. A guess here would publish a fact nobody measured.
    maxAffix: null,
    // A jewel carries no implicit with a charge on it, so there is nothing to
    // pin and nothing missing. `exact` on a jewel trade link is therefore true:
    // the link carries everything the sweep carried.
    pinned: () => ({ groups: [], missing: [] })
  }
}

export const KIND_KEYS = Object.keys(ITEM_KINDS)

/**
 * The kind filed under `key`.
 * @param {string} key One of KIND_KEYS.
 * @returns {object} The kind.
 * @throws If the key is unknown. A mistyped kind must never fall back to
 *   tablets: the fallback would collect and publish the wrong market.
 */
export function kindByKey (key) {
  const kind = ITEM_KINDS[key]
  if (!kind) {
    throw new Error(
      `Unknown item kind ${JSON.stringify(key)}. Known: ${KIND_KEYS.join(', ')}.`)
  }
  return kind
}

// Built once, and building it throws on a duplicate. An ambiguous type name
// would make kindOfType return whichever kind happened to be declared last,
// and lib/derive.mjs would apply that kind's affix caps to the other kind's
// items — silently, and one row at a time.
const BY_TYPE = new Map()
for (const kind of Object.values(ITEM_KINDS)) {
  for (const type of kind.types) {
    if (BY_TYPE.has(type)) {
      throw new Error(
        `Item type ${JSON.stringify(type)} is claimed by both ` +
        `${BY_TYPE.get(type).key} and ${kind.key}. A type belongs to one kind.`)
    }
    BY_TYPE.set(type, kind)
  }
}

/**
 * The kind that claims a base type, or null.
 * @param {string} type A `baseType` as GGG spells it on an item.
 * @returns {object|null} The kind, or null when no kind claims it. Null is a
 *   real answer: lib/derive.mjs stores unknown rather than guessing.
 */
export const kindOfType = (type) => BY_TYPE.get(type) ?? null
