// What the trade API is, and what a rarity is. Everything that is particular
// to one ITEM KIND — its base types, the filters its searches pin, its affix
// caps — lives in lib/item-kinds.mjs instead.
export const API_BASE = 'https://www.pathofexile.com/api/trade2'
export const REALM = 'poe2'

export const RARITIES = ['normal', 'magic', 'rare']

// A normal tablet carries no explicit modifier at all. That is a fact about the
// game, so asking the market what a normal tablet with a given modifier costs
// is not a thin question — it is not a question. The web view hides the
// modifier card for these, and the sweep spends nothing on them.
export const MODIFIED_RARITIES = RARITIES.filter(r => r !== 'normal')

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
