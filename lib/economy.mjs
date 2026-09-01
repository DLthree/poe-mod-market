// PHASE 2. The file poe.re fetches. It makes no network call.
//
// SUMMARY ONLY. One line per cell and one line per modifier on a cell, the way
// poe.ninja publishes one line per commodity rather than the order book behind
// it. Our commodity is a modifier on a cell.
//
// No listing, price, account name, listing id or `indexed` timestamp is ever
// emitted. That is a rule, not a size optimisation: nothing in this file grows
// with how deep a sweep goes. A sweep that doubles its depth changes these
// numbers and adds no lines. tests/economy.test.mjs asserts it, because a rule
// that is only intended is a rule that drifts.
import { cellSummary } from './summary.mjs'
import { TABLET_TYPES, RARITIES } from './poe2.mjs'

const CATEGORY = 'tablet'
const TYPE = 'Tablet'

// shared/economy.ts on poe.re builds `<base>/<category>/eco_<league>_<type>.json`
// and does not encode the league, so the space in "Runes of Aldur" arrives
// percent-encoded by fetch. The server decodes it; this function does not.
export const economyPath = (league) => `${CATEGORY}/eco_${league}_${TYPE}.json`

// The database file is per league — lib/paths.mjs dbPath(league) — so there is
// nothing here from another market to filter out. `observation` is the surface
// phase 2 is allowed to read, and it already carries the collecting request's
// timestamp as `observed_at`.
//
// This is also the more honest number: a 429 or an empty response archives a
// call but produces no listing, so this is when we last actually got data
// rather than when we last spoke to GGG.
const newestObservation = (db) =>
  db.prepare('SELECT max(observed_at) AS at FROM observation').get()?.at ?? null

const emptyCell = (type, rarity) => ({
  type, rarity, floor: null, currency: null, typical: null, listings: 0, sellers: 0
})

// GGG spells a rarity in title case on an item, and a snapshot records it the
// same way so it reads like the rows inside it. poe.re and our own trade-url
// both use lower case, so the file stays lower case and only the lookup is
// converted.
const asStored = (rarity) => rarity[0].toUpperCase() + rarity.slice(1)

export function economyFile (db, { league, lookbackHours, config, textFor,
                                   now = Date.now() }) {
  const cells = []
  const mods = []
  for (const type of TABLET_TYPES) {
    for (const rarity of RARITIES) {
      const cell = cellSummary(db, {
        league, type, rarity: asStored(rarity), lookbackHours, config, textFor, now
      })
      // A cell we collected nothing for still gets a line. The overview shows a
      // gap as a gap, and a missing line would read as a page bug instead.
      if (cell.sample.listings === 0) {
        cells.push(emptyCell(type, rarity))
        continue
      }
      cells.push({
        type,
        rarity,
        floor: cell.baseline.value,
        currency: cell.baseline.currency,
        // What the cell's own modifiers cost. The quality bands are measured
        // against `floor` above and not against this, but a band read without
        // it says nothing about how good the tablet actually is.
        typical: cell.typical,
        listings: cell.sample.listings,
        sellers: cell.sample.sellers
      })
      for (const m of cell.mods) {
        mods.push({
          type,
          rarity,
          statId: m.hash,
          floor: m.floor,
          adds: m.delta,
          currency: m.currency,
          listings: m.matches,
          sellers: m.sellers,
          quality: m.quality,
          label: m.label
        })
      }
    }
  }

  return {
    league,
    syncedAt: newestObservation(db),
    minListings: config.walk.minListings,
    tradeWindow: config.tradeWindow,
    cells,
    mods
  }
}
