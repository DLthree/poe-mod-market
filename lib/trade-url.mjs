// A trade-site link built entirely on this side. The site accepts the query as
// a URL parameter, so no request to GGG is needed to produce a clickable search.
//
// Borrowed from the mercenary price-check tool, which does the same thing and
// documents two things worth keeping:
//
//   - No league means no link. Falling back to a hardcoded league silently
//     searches a wrong, eventually dead, league — worse than a disabled button.
//   - Track whether the link carries EVERYTHING the page filters on. Theirs
//     cannot express a support exclusion, so their link returns listings the
//     page excluded, and they say so rather than pretending.
//
// OURS IS EXACT WHEN IT CARRIES EVERY GROUP THE SWEEP PINNED. That is the rule,
// and it is not "carries a uses filter": a jewel has no uses to filter on and
// its link is exact anyway. The kind decides what is pinned, in
// lib/item-kinds.mjs, and lib/sweep.mjs asks the same function — because a
// price here is the price of a FULL tablet, and a link without that filter
// opens a search whose cheap end is part-used tablets the prices above it
// excluded. It shipped that way until 2026-09-07.
//
// The modifier group is the one place this link deliberately differs from the
// collection query: "1 of" rather than "all of". See modGroup below.
//
// `exact` exists so that stops being silently assumed the moment a roll band or
// an exclusion is added.
//
// Do NOT reach for `not: true` inside a stat group to express an exclusion. The
// merc tool measured it: the API accepts it, returns 200 and a plausible count,
// and silently ignores it — a filter that reads as working while returning the
// opposite of what was asked.

const SITE = 'https://www.pathofexile.com/trade2/search'
const REALM = 'poe2'

// "1 of", not "all of". Ticking three modifiers does not mean "find me one
// tablet carrying all three" — that tablet usually does not exist, and the link
// opened on an empty market. It means "find me the tablets worth picking up",
// which is the union of the searches the prices came from: each price on this
// page is a single-modifier search, so no price ever described a conjunction.
//
// The trade site spells that as a `count` group with a minimum. One is the
// floor of useful; raising it is a different question and nothing asks it yet.
const MIN_MATCHING_MODS = 1

const modGroup = (mods) => mods.length
  ? { type: 'count', filters: mods.map(hash => ({ id: hash })), value: { min: MIN_MATCHING_MODS } }
  : { type: 'and', filters: [] }

export function tradeUrl ({ league, kind, type, rarity, mods = [], tradeWindow }) {
  // The kind decides which filters this link must carry, so a call without one
  // cannot know what it is meant to pin. Better no link than a link that opens
  // a wider market than the price measured.
  if (!league || !kind || !type) {
    return { url: null, exact: false, reason: 'no league, kind or type' }
  }

  // A type the kind holds no pinned filter for still gets a link, because a
  // search of the right item at the wrong depth beats no search. It does not
  // get to call itself exact.
  // The rarity reaches here as the database spells it, "Magic". The query option
  // is lower case, and the kind's own rules do not care either way.
  const { groups, filters: pinnedFilters, missing } = kind.pinned(type, rarity)

  const query = {
    query: {
      status: { option: 'securable' },
      type,
      filters: {
        type_filters: { filters: { rarity: { option: String(rarity).toLowerCase() } } },
        trade_filters: {
          filters: {
            price: { option: 'exalted_divine' },
            indexed: { option: tradeWindow }
          }
        },
        // Everything the kind pins that is not a stat group — today, the
        // corrupted exclusion on a magic or normal cell. lib/summary.mjs drops
        // those rows from the price, so a link that showed them would put a
        // listing at the top that the number above it excluded. It did.
        ...pinnedFilters
      },
      stats: [modGroup(mods), ...groups]
    },
    sort: { price: 'asc' }
  }

  const url = `${SITE}/${REALM}/${encodeURIComponent(league)}` +
    `?q=${encodeURIComponent(JSON.stringify(query))}`

  if (missing.length) return { url, exact: false, query, reason: missing.join('; ') }
  return { url, exact: true, query }
}
