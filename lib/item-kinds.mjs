import { RARITIES, pricesIncludeCorrupted } from './poe2.mjs'

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

// NOT STAT GROUPS. These are the trade site's own Any/Yes/No switches, and they
// live in query.filters.misc_filters. So `pinned` returns them apart from
// `groups`, and both callers merge the object into the query's own filters.
//
// ONE misc_filters OBJECT, however many switches. Two of them building their own
// would mean the second overwrote the first.
const miscFilters = (filters) =>
  Object.keys(filters).length ? { misc_filters: { filters } } : {}

// WHICH cells exclude corrupted items is lib/poe2.mjs pricesIncludeCorrupted,
// shared with lib/summary.mjs. That sharing is the point: until 2026-09-10 only
// the summary knew the rule, so a magic search collected corrupted listings, the
// summary discarded them, and the trade link opened a market whose cheap end the
// published price had excluded — while calling itself exact. On Sapphire magic the
// blank cell published 4 exalted with a 2-exalted corrupted listing at the top of
// the link.
const notCorrupted = (rarity) => pricesIncludeCorrupted(rarity)
  ? {}
  : { corrupted: { option: 'false' } }

// The site shows this as "Desecrated: No", and GGG's own /data/filters lists it
// beside Corrupted. Probed 2026-09-10 on Emerald rare with increased maximum
// Energy Shield: Any 24, No 0, Yes 24. No and Yes partition the Any result, so it
// is applied and not merely accepted — which had to be checked, because a
// `not: true` inside a stat group returns 200 and a plausible count and does
// nothing at all.
//
// An earlier attempt used a `not` stat group over
// `pseudo.pseudo_number_of_desecrated_mods`. It worked, and this is simpler and
// symmetric with corrupted. What did NOT work, and is the trap worth keeping: an
// `and` group holding that count at max 0 matched NOTHING, because an item with
// no desecrated modifier carries no such pseudo stat to compare against.
const notDesecrated = () => ({ desecrated: { option: 'false' } })

// A caller that forgets the rarity would price a magic cell by a rare cell's
// rules and spend allowance on listings the summary then throws away. There is no
// safe default, so there is no default.
const needRarity = (kind, rarity) => {
  if (!rarity) {
    throw new Error(
      `${kind}.pinned needs a rarity, got ${JSON.stringify(rarity)}. It decides ` +
      'whether the search excludes corrupted listings, and lib/summary.mjs drops ' +
      'them from every cell except rare. Without it the search and the summary ' +
      'would price different markets.')
  }
  return rarity
}

export const ITEM_KINDS = {
  tablet: {
    key: 'tablet',
    // GGG's own singular. lib/economy.mjs puts it in the path poe.re fetches,
    // so it is not free to change.
    label: 'Tablet',
    plural: 'Tablets',
    title: 'Tablet prices',
    // The page this kind is published at. lib/site.mjs renders one page per kind
    // from web/page.html, and the root redirects to the FIRST kind listed here.
    page: 'tablets.html',
    types: TABLET_TYPES,
    // PLAINEST FIRST. `rarities[0]` is the blank form of this kind: the one the
    // grid sorts on and the one a reader compares everything else against.
    // A kind only lists a rarity its market actually trades, because every one
    // listed costs a search per type on every pass.
    rarities: RARITIES,
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
    pinned (type, rarity) {
      // No desecrated switch: a tablet is not desecrated, and a filter nothing
      // asks for is a filter nobody has measured.
      const filters = miscFilters(notCorrupted(needRarity('tablet', rarity)))
      const id = USES_IMPLICIT[type]
      if (!id) {
        return {
          groups: [],
          filters,
          missing: [`no uses implicit known for ${type}; the search includes part-used tablets`]
        }
      }
      return { groups: [usesGroup(id)], filters, missing: [] }
    },
    // THE SECOND SEAM. Where loop 2 gets the modifiers it asks about.
    //
    // A tablet reads what it has already seen, and that is sound for this kind:
    // tablet supply is thin enough that the cheapest listings of a cell still
    // carry its premium modifiers.
    //
    // BOTH SOURCES ARE HANDED IN, and that is not ceremony. web/app.js imports
    // this file, so it must pull in neither the database nor lib/mod-pool.mjs,
    // which reads a file with node:fs and cannot load in a browser. Importing it
    // here broke the page build, and tests/web.test.mjs caught it.
    vocabulary: (type, rarity, { observed }) => observed(type, rarity)
  },
  jewel: {
    key: 'jewel',
    label: 'Jewel',
    plural: 'Jewels',
    title: 'Jewel prices',
    page: 'jewels.html',
    // Measured 2026-09-09 over 6 searches and 18 fetches. The three bases do
    // NOT share a modifier pool: 120 modifiers across the three rare cells were
    // 110 distinct, and exactly one appeared on all three. Magic overlap was
    // 4%. So each base needs its own vocabulary and its own searches, and they
    // cannot be folded into one type carrying a base attribute.
    //
    // VERIFIED against the trade API on 2026-09-10: all three names are
    // accepted as a `type`, and each reported 10000 for sale at magic and at
    // rare, which is the API's own ceiling rather than a real count.
    types: ['Emerald', 'Ruby', 'Sapphire'],
    // NO JEWEL TRADES AT NORMAL. Measured 2026-09-10, one search per base:
    // Emerald, Ruby and Sapphire each returned 0 for sale, against 10000 at
    // both other rarities. Listing normal here would spend three searches a
    // pass on a market that does not exist and publish a column of dashes.
    //
    // Magic is therefore this kind's blank form, and it is what the grid sorts
    // on. Every cell measured floors at 1 exalted, so the ratio against a blank
    // jewel is trivially cleared and `walk.minAdds` is what actually separates
    // these rows. That is the cheap-baseline effect the README documents.
    rarities: ['magic', 'rare'],
    // A jewel base name is already the whole name.
    short: (type) => type,
    // STILL UNMEASURED, deliberately. 30 rare and 28 magic jewels from the
    // cheap end showed at most 2 prefixes and 2 suffixes on one item, but that
    // is a floor from a thin and biased sample, not a cap: the tablet numbers
    // took 3540 items to settle. A cap set too low clamps a real open slot to
    // zero, and lib/derive.mjs applies it at COLLECTION time, so a wrong value
    // is baked into every row a pass writes.
    //
    // Null is not a placeholder. lib/derive.mjs reads it as "we do not know how
    // many affix slots this kind has" and stores null open-affix counts, which
    // lib/walk.mjs already reads as unknown rather than as an open affix.
    // Nothing the page publishes uses these counts; only the mod-table
    // diagnostic does.
    maxAffix: null,
    // A jewel carries no implicit with a charge on it. What it does carry is a
    // second market inside its own: see NO_DESECRATED above. Nothing is missing,
    // so `exact` on a jewel trade link stays true, and the link opens the same
    // market the price was read from.
    pinned: (type, rarity) => ({
      groups: [],
      filters: miscFilters({
        ...notCorrupted(needRarity('jewel', rarity)),
        ...notDesecrated()
      }),
      missing: []
    }),
    // A jewel CANNOT read its vocabulary from what it has seen. Loop 1 keeps the
    // cheapest listings, and a modifier that is scarce on a base — which is what
    // makes it dear there — never reaches the cheap end. A full pass measured 187
    // cells and said nothing about a modifier worth divines.
    // See docs/jewel-vocabulary-bias.md.
    //
    // So it asks the game instead. `observed` is ignored on purpose: the pool is
    // what the base CAN roll, which is the question the archive cannot answer.
    // The rarity is ignored for the same reason — a base rolls one pool, and the
    // rarity only limits how many modifiers land on one item.
    vocabulary: (type, rarity, { pool }) => pool(type)
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
