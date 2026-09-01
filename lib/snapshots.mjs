// PHASE 2 BOUNDARY.
//
// A snapshot is one QUESTION and the answer GGG gave to it at one instant:
// "what does a Breach rare floor at?", or "what does a Breach rare carrying
// this modifier floor at?". This file reads the `snapshot` and `listing`
// tables and nothing else. It never learns that a question was once an HTTP
// search — that is phase 1's business, and tests/contract.test.mjs fails the
// build if it leaks in here.
//
// Why questions rather than pools: `rank` is a listing's position within the
// ONE search that returned it, and every search numbers its own results from
// zero. Merging several into one heap stacks every rank-0 row at the front in
// no price order at all. Measured on Overseer rare, fed by 29 separate
// searches, the third cheapest row read 150 exalted where the live market said
// 10. Inside a snapshot, rank order IS price order.
//
// See docs/snapshot-pricing.md.
import { hydrate } from './pools.mjs'

// Cheapest first. Inside one snapshot that is exactly rank order: the search
// was sorted by price, and GGG ranked exalted against divine itself using a
// rate we do not hold. The amount is the fallback for a row with no rank, and
// unranked rows sort last rather than in front of ranked ones.
//
// "rank" is quoted because SQLite also has a window function of that name.
const ORDERED = `SELECT * FROM listing WHERE snapshot_id = ?
                  ORDER BY "rank" IS NULL, "rank", price_amount`

// The newest snapshot of one question, or null when the question has never
// been asked. `stat_id IS ?` rather than `= ?`, because the baseline question
// stores null there and null never equals anything.
//
// An EMPTY snapshot is a real answer and comes back with no rows, not as null:
// phase 1 discards the snapshot of any question it failed to answer, so the
// only way to store an empty one is a market that held nothing.
//
// `since` is window B, the lookback: how far back through our own archive we
// are willing to read. `taken_at` is our own clock, the same axis as
// `observed_at`, so this is the same window under a different reader. Without
// it "the newest snapshot" has no age bound at all and a month-old answer
// would be published as today's. See docs/two-windows.md.
export function latestSnapshot (db, { league, type, rarity, statId = null, since = null }) {
  const snap = db.prepare(
    `SELECT id, taken_at FROM snapshot
      WHERE league = ? AND type = ? AND rarity = ? AND stat_id IS ?
        AND taken_at >= ?
      ORDER BY taken_at DESC, id DESC
      LIMIT 1`).get(league, type, rarity, statId, since ?? '0000-01-01T00:00:00Z')
  if (!snap) return null
  return {
    id: snap.id,
    takenAt: snap.taken_at,
    rows: hydrate(db, db.prepare(ORDERED).all(snap.id))
  }
}

// Every question ever asked in this league, newest first, with how deep its
// answer was. This is the vocabulary a caller iterates: it cannot enumerate
// the modifiers of a cell on its own, because it can only price a modifier
// somebody already asked about.
export function listSnapshots (db, { league, since = null }) {
  return db.prepare(
    `SELECT s.type AS type, s.rarity AS rarity, s.stat_id AS statId,
            s.taken_at AS takenAt, count(l.listing_id) AS depth
       FROM snapshot s LEFT JOIN listing l ON l.snapshot_id = s.id
      WHERE s.league = ? AND s.taken_at >= ?
      GROUP BY s.id
      ORDER BY s.taken_at DESC, s.id DESC`).all(league, since ?? '0000-01-01T00:00:00Z')
}
