// The floor heuristic is expected to change. Nothing outside this file knows
// which rule ran: callers ask makeFloor(config) once and then call floor(rows)
// wherever a pool needs a number. Adding a rule means adding one entry to
// STRATEGIES and one line to config.json — no ripple.
//
// THE ROWS ARE ONE SNAPSHOT: the answer to one question at one instant, in the
// order GGG itself ranked them. That is what makes this file simple.
//
// CURRENCIES ARE NOT CONVERTED, and no longer need to be reduced away either.
// The server ranks exalted against divine itself, using a rate we do not hold,
// so a row's position already accounts for its currency. Holding our own rate
// would mean guessing at a number GGG already computes: read off the bulk
// exchange book, that guess disagreed with the server's own ordering by 2.5x,
// because most of the book is scam offers.
//
// Until 2026-08-31 this file took a majority vote on currency and discarded
// every row in the losing one, always. That was a repair for merged pools, and
// on `Overseer Tablet | Normal` it was decided by one row: three of the seven
// it discarded carried rank 0 or 1, so GGG's own sort had called them the
// cheapest in the search. The cell then reported 1 divine.
// See docs/snapshot-pricing.md.
//
// The vote survives in one place only, and `reduced` below says where and why.
//
// A strategy takes the snapshot's rows and returns the rows that DETERMINE the
// floor, cheapest first. The caller reads the last one's price as the value and
// shows the whole basis, so a reader can always see what the number rested on.

// Cheapest first. `rank` is the server's own cross-currency position within
// this snapshot and wins when present; the amount is the fallback for rows
// replayed from the archive, where the page offset was not recoverable.
// Infinity - Infinity is NaN, which silently destroys a sort, so unranked rows
// share a finite sentinel and fall through to the amount.
const UNRANKED = Number.MAX_SAFE_INTEGER
const rankOf = (r) => (typeof r.rank === 'number' ? r.rank : UNRANKED)
const byPrice = (rows) => [...rows].sort((a, b) => rankOf(a) - rankOf(b) || a.amount - b.amount)

const cheapestPerSeller = (rows) => {
  const best = new Map()
  for (const r of byPrice(rows)) {
    const key = r.account ?? `__anon:${r.listingId}`
    if (!best.has(key)) best.set(key, r)
  }
  return byPrice([...best.values()])
}

const recent = (rows, now, hours) =>
  rows.filter(r => now - Date.parse(r.indexed) <= hours * 3600e3)

// A pool every row of which carries a rank is ordered by GGG, currencies and
// all. A pool with even one unranked row is not: rows replayed from the archive
// lost the page offset they were ranked by, and then the amount is the only
// ordering left. Comparing amounts across currencies is meaningless — 1 divine
// is not cheaper than 3 exalted — so an unranked pool is reduced to its most
// common currency first and the rest are counted and set aside, never
// converted.
//
// This is why the vote could not simply be deleted with the merge: lib/api.mjs
// price() and lib/lookup.mjs still floor arbitrary filtered pools, where a rank
// is often absent. A snapshot never takes this path.
const fullyRanked = (rows) => rows.every(r => typeof r.rank === 'number')

function reduced (rows) {
  if (fullyRanked(rows)) return { used: rows, setAside: 0 }
  const tally = new Map()
  for (const r of rows) tally.set(r.currency, (tally.get(r.currency) || 0) + 1)
  let best = null
  for (const [currency, n] of tally) {
    if (!best || n > best.n) best = { currency, n }
  }
  const used = best ? rows.filter(r => r.currency === best.currency) : []
  return { used, setAside: rows.length - used.length }
}

export const STRATEGIES = {
  // The literal cheapest listing. Honest, and fragile: one seller dumping a
  // dear tablet cheap drops the floor and hides the modifier entirely.
  cheapest: (rows) => byPrice(rows).slice(0, 1),

  // The nth cheapest listing. Immune to n-1 mispriced listings.
  'nth-cheapest': (rows, { n }) => byPrice(rows).slice(0, n),

  // The nth cheapest DISTINCT SELLER, so one account holding the whole cheap
  // end counts once.
  'nth-cheapest-seller': (rows, { n }) => cheapestPerSeller(rows).slice(0, n),

  // The nth cheapest distinct seller listed inside the window.
  'nth-cheapest-seller-recent': (rows, { n, windowHours, now }) => {
    const inWindow = recent(rows, now, windowHours)
    return cheapestPerSeller(inWindow.length ? inWindow : rows).slice(0, n)
  }
}

export function makeFloor ({ strategy = 'nth-cheapest', n = 3, windowHours = 24 } = {}) {
  const rule = STRATEGIES[strategy]
  if (!rule) {
    throw new Error(
      `Unknown floor strategy "${strategy}". Known: ${Object.keys(STRATEGIES).join(', ')}`)
  }
  const floor = (rows, now = Date.now()) => {
    const empty = {
      value: null, currency: null, min: null, minCurrency: null,
      basis: [], setAside: 0, strategy
    }
    if (!rows.length) return empty

    const { used, setAside } = reduced(rows)
    if (!used.length) return empty

    const basis = rule(used, { n, windowHours, now })
    const ordered = byPrice(used)
    // The row the floor rests on carries its own currency, because the nth
    // cheapest may be priced in either one. The cheapest row carries its own
    // too: reporting one number's currency for both would be a quiet lie the
    // day they differ.
    const last = basis.length ? basis[basis.length - 1] : null
    return {
      value: last ? last.amount : null,
      currency: last ? last.currency : null,
      min: ordered[0].amount,
      minCurrency: ordered[0].currency,
      setAside,
      basis: basis.map(r => ({
        amount: r.amount,
        currency: r.currency,
        account: r.account,
        ageHours: Math.round((now - Date.parse(r.indexed)) / 36e5)
      })),
      strategy
    }
  }
  floor.strategy = strategy
  return floor
}

// Two floors are comparable only in the same currency. Returning null rather
// than a converted ratio is the point: an incomparable pair is a fact worth
// reporting, not a gap to paper over.
// Takes the stat shape produced by walk.statFor: { floor, currency }.
export function lift (candidate, baseline) {
  if (!(candidate.floor > 0) || !(baseline.floor > 0)) return null
  if (candidate.currency !== baseline.currency) return null
  return candidate.floor / baseline.floor
}
