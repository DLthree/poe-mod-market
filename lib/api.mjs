// PHASE 2. The queries behind the web API, kept out of the HTTP layer so they
// are testable without a server and reusable from the CLI.
//
// Every count returned here is a count of OUR SAMPLE, never of the market. The
// payloads say so in a field, not only in the page, because a programmatic
// consumer cannot read a label that lives in HTML.

import { readListings } from './pools.mjs'
import { makeFloor } from './floor.mjs'
import { countDistinct } from './numbers.mjs'
import { tradeUrl } from './trade-url.mjs'
import { cellSummary, floorOf, sampleOf } from './summary.mjs'

const ageHours = (row, now) => (now - Date.parse(row.indexed)) / 36e5

const cellOf = (rows, type, rarity) =>
  rows.filter(r => r.type === type && r.rarity === rarity)

// `now` is injected by every caller that prices at a stated instant, and by
// every test. It must reach the lookback window too: without it the window is
// measured from the wall clock while the ages beside it are measured from
// `now`, and the two disagree. Found 2026-08-31, when nineteen tests began
// failing on the clock alone.
const rowsIn = (db, lookbackHours, now) =>
  readListings(db, { sinceMs: lookbackHours * 3600 * 1000, now: new Date(now) })

const hasAll = (row, mods) => mods.every(h => row.mods.some(m => m.hash === h))

export function meta (db, { league, lookbackHours, now = Date.now() }) {
  const rows = rowsIn(db, lookbackHours, now)
  const cells = new Map()
  for (const r of rows) {
    const key = `${r.type}|${r.rarity}`
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key).push(r)
  }
  return {
    league,
    lookbackHours,
    listings: rows.length,
    cells: [...cells].map(([key, rs]) => {
      const [type, rarity] = key.split('|')
      return { type, rarity, ...sampleOf(rs, now) }
    }).sort((a, b) => b.listings - a.listings)
  }
}

// The summary view: "for a Breach rare, the price of a blank one and the price
// with each modifier". Every number here is read from the snapshot of the
// search that asked for it, so this is the one payload that does NOT come from
// the merged window the rest of this file reads. See lib/summary.mjs.
export function mods (db, { league, type, rarity, lookbackHours, config, textFor,
                            now = Date.now() }) {
  const cell = cellSummary(db, { league, type, rarity, lookbackHours, config, textFor, now })
  return {
    league,
    type,
    rarity,
    sample: cell.sample,
    takenAt: cell.takenAt,
    baseline: cell.baseline,
    // What the verdicts were judged against: the median floor of the cell's
    // own priced modifiers. Without it a reader has to trust the flag.
    typical: cell.typical,
    mods: cell.mods
  }
}

// The same filtering the page does, server-side, for programmatic callers.
// Zero matches is a normal answer and returns 200.
export function price (db, { league, type, rarity, mods: wanted = [], lookbackHours, tradeWindow,
                             config, textFor, now = Date.now() }) {
  const floor = makeFloor(config.floor)
  const all = cellOf(rowsIn(db, lookbackHours, now), type, rarity)
  const hits = all.filter(r => hasAll(r, wanted))

  // For every modifier not yet chosen, how many matches survive if it is added.
  // Showing the fall to zero BEFORE the click is what keeps ticking honest.
  const nextCounts = new Map()
  for (const r of hits) {
    for (const m of r.mods) {
      if (wanted.includes(m.hash)) continue
      nextCounts.set(m.hash, (nextCounts.get(m.hash) || 0) + 1)
    }
  }
  const seen = new Set()
  for (const r of all) for (const m of r.mods) seen.add(m.hash)
  const next = [...seen]
    .filter(h => !wanted.includes(h))
    .map(h => ({ hash: h, text: textFor ? textFor(h) : h, matchesIfAdded: nextCounts.get(h) || 0 }))
    .sort((a, b) => b.matchesIfAdded - a.matchesIfAdded)

  return {
    query: { league, type, rarity, mods: wanted },
    matches: hits.length,
    sellers: countDistinct(hits.map(r => r.account)),
    floor: hits.length ? floorOf(hits, floor, now) : null,
    listings: [...hits]
      .sort((a, b) => a.amount - b.amount)
      .slice(0, 20)
      .map(r => ({
        id: r.listingId,
        amount: r.amount,
        currency: r.currency,
        account: r.account,
        ageHours: Number(ageHours(r, now).toFixed(1)),
        mods: r.mods.map(m => m.hash)
      })),
    next,
    trade: tradeUrl({ league, type, rarity, mods: wanted, tradeWindow }),
    sample: sampleOf(all, now)
  }
}
