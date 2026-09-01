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
// Ours is exact today: every filter is a plain "has this modifier" stat filter,
// which the trade API expresses directly. `exact` exists so that stops being
// silently assumed the moment a roll band or an exclusion is added.
//
// Do NOT reach for `not: true` inside a stat group to express an exclusion. The
// merc tool measured it: the API accepts it, returns 200 and a plausible count,
// and silently ignores it — a filter that reads as working while returning the
// opposite of what was asked.

const SITE = 'https://www.pathofexile.com/trade2/search'
const REALM = 'poe2'

export function tradeUrl ({ league, type, rarity, mods = [], tradeWindow }) {
  if (!league || !type) return { url: null, exact: false, reason: 'no league or type' }

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
        }
      },
      stats: [{ type: 'and', filters: mods.map(hash => ({ id: hash })) }]
    },
    sort: { price: 'asc' }
  }

  const url = `${SITE}/${REALM}/${encodeURIComponent(league)}` +
    `?q=${encodeURIComponent(JSON.stringify(query))}`

  return { url, exact: true, query }
}
