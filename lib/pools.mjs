// PHASE 2 BOUNDARY.
//
// This file and everything downstream of it read the `observation` view and the
// `listing_mod` table, and nothing else. Which collector produced a row — a
// sweep, a stream, a query walk — is not phase 2's business. That is the whole
// point of the boundary, and tests/contract.test.mjs fails the build if it is
// broken.
//
// NOTHING HERE CONVERTS A CURRENCY, and that is deliberate.
//
// The standing query asks for `exalted_divine` and sorts cheapest-first, so the
// server has already ranked exalted against divine using its own rates. A
// listing's `rank` is where the server put it. Holding our own exchange rate
// would mean guessing at a number GGG already computed — and the guess was
// wrong: read from the bulk exchange the book was mostly scam offers, and the
// median of it disagreed with the server's own ordering by 2.5x.
//
// So prices stay raw, in the currency they were listed in, and comparisons
// happen within one currency. See lib/floor.mjs.

// ONLY ROWS THAT BELONG TO A SNAPSHOT ARE READ.
//
// The archive holds 13795 rows collected before snapshots existed, and they are
// kept: a parser fix is still re-applied to them, and they are the record of
// what the market held. But they carry no question and no usable rank, so
// reading them mixes two kinds of data in one pile — which is the fault that
// made every published price wrong in the first place.
//
// Nothing is deleted. Unstamped rows are history, and history is not priced.
export function readListings (db, { sinceMs = null, now = new Date() } = {}) {
  const cutoff = sinceMs === null
    ? '0000-01-01T00:00:00Z'
    : new Date(now.getTime() - sinceMs).toISOString()

  // One row per listing: the newest observation of it wins, so a re-list at a
  // new price replaces the old price rather than joining it.
  const rows = db.prepare(
    `SELECT o.rowid_req AS request_id, o.listing_id, o.indexed, o.account,
            o.price_amount, o.price_currency, o.rank, o.type, o.rarity,
            o.open_prefix, o.open_suffix
       FROM (SELECT request_id AS rowid_req, listing_id, indexed, account,
                    price_amount, price_currency, rank, type, rarity,
                    open_prefix, open_suffix, observed_at,
                    row_number() OVER (PARTITION BY listing_id ORDER BY observed_at DESC,
                                       request_id DESC) AS rn
               FROM observation
              WHERE observed_at >= ? AND snapshot_id IS NOT NULL) o
      WHERE o.rn = 1`
  ).all(cutoff)

  return hydrate(db, rows)
}

// The row shape every reader downstream consumes: one listing with its
// modifiers attached. Two readers build it — a merged window above, and one
// snapshot in lib/snapshots.mjs — so it is written once, here. Every floor
// rule reads these field names, and two copies of them would drift.
export function hydrate (db, rows) {
  // roll_min/roll_max are the band GGG sent alongside the roll. They are what
  // lets a modifier be shown as "25-35% increased ..." rather than "#% ...".
  const modsFor = db.prepare(
    `SELECT hash, roll, affix, roll_min AS rollMin, roll_max AS rollMax
       FROM listing_mod WHERE request_id = ? AND listing_id = ?`)

  return rows.map(r => ({
    listingId: r.listing_id,
    indexed: r.indexed,
    account: r.account,
    amount: r.price_amount,
    currency: r.price_currency,
    rank: r.rank,
    type: r.type,
    rarity: r.rarity,
    corrupted: r.corrupted === 1,
    openPrefix: r.open_prefix,
    openSuffix: r.open_suffix,
    mods: modsFor.all(r.request_id, r.listing_id)
  }))
}
