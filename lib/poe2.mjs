export const API_BASE = 'https://www.pathofexile.com/api/trade2'
export const REALM = 'poe2'
export const LEAGUE_DEFAULT = 'Runes of Aldur'

// Expedition Tablet returned 0 listings on 2026-08-28; it is gone in 0.5.0.
// Unique tablets price by name, not by modifier, and are out of scope.
export const TABLET_TYPES = [
  'Abyss Tablet', 'Breach Tablet', 'Delirium Tablet', 'Irradiated Tablet',
  'Overseer Tablet', 'Ritual Tablet', 'Temple Tablet'
]

export const RARITIES = ['normal', 'magic', 'rare']

// A normal tablet carries no explicit modifier at all. That is a fact about the
// game, so asking the market what a normal tablet with a given modifier costs
// is not a thin question — it is not a question. The web view hides the
// modifier card for these, and the sweep spends nothing on them.
export const MODIFIED_RARITIES = RARITIES.filter(r => r !== 'normal')

// Every tablet carries one implicit — "Adds Abysses to a Map", and under it the
// uses it has left. The stat id is per tablet type and does not change with the
// prefix or suffix: all 340 distinct names in the archive reduce to these seven.
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
  'Irradiated Tablet': 'implicit.stat_4041853756',
  'Overseer Tablet': 'implicit.stat_3376302538',
  'Ritual Tablet': 'implicit.stat_3166002380',
  'Temple Tablet': 'implicit.stat_3035440454'
}


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

// The trade site's own options for the `indexed` filter — window A, the trade
// window. Read from the exiled-exchange-2 checkout on 2026-08-30. See
// docs/two-windows.md.
export const TRADE_WINDOWS = ['1day', '3days', '1week', '2weeks', '1month', '2months']

// A misspelt or missing tradeWindow does not fail the way most bad config
// does: JSON.stringify drops an undefined value, so the search body carries
// `"indexed":{}` and GGG answers a window-less search anyway. That still
// spends rate allowance that cannot be bought back, so this is checked before
// any request is sent rather than left to be noticed in the response.
export function validateTradeWindow (value) {
  if (!TRADE_WINDOWS.includes(value)) {
    throw new Error(
      `config.json tradeWindow is ${JSON.stringify(value)}; must be one of ` +
      `${TRADE_WINDOWS.join(', ')}.`)
  }
}
