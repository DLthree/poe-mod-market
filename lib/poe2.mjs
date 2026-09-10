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

// WHETHER A CELL'S PRICE INCLUDES CORRUPTED LISTINGS. This is a fact about what
// a rarity means, which is why it lives here rather than beside either reader.
//
// A corrupted normal or magic item is not the plain item the cell prices.
// Corruption is a separate thing a buyer pays for, and on a thin cell it is the
// whole cell: the newest Overseer normal snapshot held exactly two rows, both
// corrupted, at 89 and 100 exalted, and that was the published price of a blank
// Overseer tablet.
//
// A rare is left alone. A corrupted rare carries the same modifiers a buyer is
// searching for, and 88 of 4460 rare rows in the archive are corrupted — they are
// part of that market, not an artefact of it.
//
// TWO READERS, AND THEY DRIFTED. lib/summary.mjs drops the rows; lib/item-kinds.mjs
// keeps them out of the search. Until 2026-09-10 only the first did, so every
// magic and normal cell spent allowance on listings it then discarded, and the
// trade link opened a market whose cheap end the published price had excluded
// while reporting itself exact. Measured on Sapphire magic: the blank cell
// published 4 exalted with a 2-exalted corrupted listing at the top of the link.
const KEEPS_CORRUPTED = new Set(['rare'])
export const pricesIncludeCorrupted = (rarity) =>
  KEEPS_CORRUPTED.has(String(rarity).toLowerCase())

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
