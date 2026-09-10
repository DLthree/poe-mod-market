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

// shared/economy.ts on poe.re builds `<base>/<category>/eco_<league>_<type>.json`
// and does not encode the league, so the space in "Runes of Aldur" arrives
// percent-encoded by fetch. The server decodes it; this function does not.
//
// The category and the type are the kind's own key and label, so the tablet
// path is exactly what it has always been and a second kind needs no new rule.
export const economyPath = (league, kind) =>
  `${kind.key}/eco_${league}_${kind.label}.json`

// The database file is per league — lib/paths.mjs dbPath(league) — so there is
// nothing here from another league to filter out. `observation` is the surface
// phase 2 is allowed to read, and it already carries the collecting request's
// timestamp as `observed_at`.
//
// SCOPED TO THIS KIND'S TYPES, and that is not a detail. One league is one
// database, so a jewel pass and a tablet pass write into the same file. Taking
// the newest row of the whole database made the tablet page report "collected
// 20 minutes ago" twenty minutes after a JEWEL sweep, while the tablet prices
// it was showing were a day old. The staleness line is the one thing on the
// page whose whole job is to say how much to trust the numbers beside it.
//
// This is also the more honest number in the other direction: a 429 or an empty
// response archives a call but produces no listing, so this is when we last
// actually got data for this kind rather than when we last spoke to GGG.
const newestObservation = (db, kind) => {
  const holes = kind.types.map(() => '?').join(',')
  return db.prepare(
    `SELECT max(observed_at) AS at FROM observation WHERE type IN (${holes})`
  ).get(...kind.types)?.at ?? null
}

const emptyCell = (type, rarity) => ({
  type, rarity, floor: null, currency: null, typical: null, listings: 0, sellers: 0
})

// GGG spells a rarity in title case on an item, and a snapshot records it the
// same way so it reads like the rows inside it. poe.re and our own trade-url
// both use lower case, so the file stays lower case and only the lookup is
// converted.
const asStored = (rarity) => rarity[0].toUpperCase() + rarity.slice(1)

export function economyFile (db, { league, kind, lookbackHours, config, textFor,
                                   now = Date.now() }) {
  const cells = []
  const mods = []
  for (const type of kind.types) {
    for (const rarity of kind.rarities) {
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
        // What the cell's own modifiers cost. The bands are measured
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
          // The two measurements, kept apart on purpose. `affixRatio` is what
          // it is worth against a blank tablet; `fewSamples` is how much
          // evidence stands behind that. The page derives its colour from the
          // first via lib/bands.mjs and reports the second beside it.
          affixRatio: m.affixRatio,
          fewSamples: m.fewSamples,
          // `floor` and `currency` above are exactly what GGG sent. `adds` and
          // `affixRatio` are comparisons, and this says when one of them leaned
          // on the approximate rate table rather than on the server's own price
          // ordering.
          assumedRate: m.assumedRate,
          label: m.label
        })
      }
    }
  }

  return {
    league,
    // Which market this file describes. A page that loaded the wrong one would
    // render a grid of dashes and read as a collection fault; naming the kind
    // lets it refuse instead.
    kind: kind.key,
    syncedAt: newestObservation(db, kind),
    // The thresholds travel with the data because the page, not the build, now
    // decides what colour a row is. Publishing them keeps that rule in one
    // place: change config.json, rebuild, and every existing row is reread
    // under the new thresholds without re-collecting anything.
    walk: {
      minListings: config.walk.minListings,
      minSellers: config.walk.minSellers,
      minAdds: config.walk.minAdds,
      midVsBlank: config.walk.midVsBlank,
      highVsBlank: config.walk.highVsBlank
    },
    // The page orders the tablet grid by what a blank one costs, and those
    // prices are not all in one currency, so it needs the same rate the build
    // used. Published for the same reason the walk thresholds are: two copies
    // of a number the page and the build both apply is two numbers.
    exchange: config.exchange,
    tradeWindow: config.tradeWindow,
    cells,
    mods
  }
}
