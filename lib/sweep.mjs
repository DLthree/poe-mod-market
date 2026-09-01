import { deriveRequest } from './derive.mjs'
import { USES_IMPLICIT } from './poe2.mjs'

const chunk = (arr, n) => {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// The three settings that took two prototypes to find:
//   securable  the market tab, where the buyer clicks and it is theirs. The
//              `online` book is a different and much smaller set of listings
//              with no overlap at all, and most of it is not even a buyout.
//   price asc  the statistic is a floor, so the cheap end is the sample we want.
//
// Deliberately NOT set, and each cost a measurement to learn:
//
//   price: divine   would hide every listing below one divine. Thousands of
//                   tablets sit at exactly 1 divine, so the cheapest sample of
//                   every modifier came back identical and no modifier could be
//                   told from any other. Without it the same two cells read
//                   100-200 exalted and 3-30 exalted.
//
// `exalted_divine` IS set: it drops the junk currencies (alch, aug, transmute,
// vaal, mirror) without hiding the sub-divine range. The server then orders the
// two remaining currencies against each other itself, which is why this skill
// holds no exchange rate of its own and converts nothing.
//   collapse        would fold one seller's duplicate listings into a single
//                   row, discarding data the archive exists to keep. Seller
//                   weighting belongs in lib/floor.mjs, where it can change
//                   without re-collecting.
// `indexed` is window A, the trade window: how old a listing may be on the
// market before we refuse to collect it. See docs/two-windows.md. It is
// threaded in from config, never hardcoded, so every cell asks the same
// question of GGG that config.json says to ask.
// A part-used tablet is a different item at a different price, and it sits at
// the cheap end where the floor is read. The cheapest rare Delirium and rare
// Irradiated listings in the archive are 1 exalted with two or three uses left,
// on cells whose whole price is 1 exalted.
//
// Ten is full. Some tablets carry more — a modifier grants them — and `min`
// keeps those, which is right: they are worth more, not less.
const MIN_USES = 10

// The uses filter is its own stat group, exactly as the trade site builds it.
// Group 0 stays empty for affixQuery to fill, so a modifier search and the uses
// filter never contend for the same slot.
const usesGroup = (type) => ({
  type: 'and',
  filters: [{ id: USES_IMPLICIT[type], value: { min: MIN_USES }, disabled: false }]
})

const base = (type, rarity, tradeWindow) => {
  // An unknown type would silently drop the filter and collect part-used
  // tablets under a question that says they were excluded.
  if (!USES_IMPLICIT[type]) {
    throw new Error(
      `No uses implicit known for ${JSON.stringify(type)}. ` +
      'Add it to USES_IMPLICIT in lib/poe2.mjs; it is the stat id of the ' +
      '"Adds ... to a Map" line that carries the uses remaining.')
  }
  return {
    status: { option: 'securable' },
    type,
    filters: {
      type_filters: { filters: { rarity: { option: rarity } } },
      trade_filters: {
        filters: {
          price: { option: 'exalted_divine' },
          indexed: { option: tradeWindow }
        }
      }
    },
    stats: [{ type: 'and', filters: [] }, usesGroup(type)]
  }
}

export const SORT = { price: 'asc' }

export const poolQuery = (type, rarity, tradeWindow) => base(type, rarity, tradeWindow)

// Affix cells are measured on rare tablets only. Named once, because the
// snapshot of an affix search has to record the same rarity the search asked
// for, and two literals would drift apart.
export const AFFIX_RARITY = 'rare'

// No `value` on the filter means "this modifier at any roll", which is what the
// MVP asks for.
export const affixQuery = (type, hash, tradeWindow) => {
  const q = base(type, AFFIX_RARITY, tradeWindow)
  q.stats[0].filters = [{ id: hash }]
  return q
}

// Loop 1 supplies the vocabulary loop 2 iterates. That is what makes the
// query-driven loop workable here: on its own it cannot enumerate its own
// cells, because it can never query a modifier it has not already seen.
export function affixesFor (db, type) {
  return db.prepare(
    `SELECT m.hash, count(*) n FROM listing_mod m
       JOIN listing l ON l.request_id = m.request_id AND l.listing_id = m.listing_id
      WHERE l.type = ? AND l.rarity = 'Rare'
      GROUP BY m.hash
      ORDER BY n DESC, m.hash`
  ).all(type).map(r => r.hash)
}

// The database stores a rarity as GGG spells it on an item — "Rare". A query
// option is lower case. One of the two has to be canonical, and it is GGG's,
// so a snapshot's rarity reads the same as the rows inside it and phase 2 needs
// no mapping to join a question to its answer.
const canonicalRarity = (r) => r[0].toUpperCase() + r.slice(1).toLowerCase()

// The question this search asked, written down so phase 2 can price that
// question from this answer alone instead of from a pool merged out of many.
// See docs/snapshot-pricing.md.
function openSnapshot (db, { league, type, rarity, statId, takenAt }) {
  const res = db.prepare(
    `INSERT INTO snapshot (league, type, rarity, stat_id, taken_at)
     VALUES (?,?,?,?,?)`
  ).run(league, type, canonicalRarity(rarity), statId, takenAt)
  return Number(res.lastInsertRowid)
}

// A snapshot is an ANSWER, so a question that was not fully answered leaves
// none. TradeClient throws on a non-JSON body, on an error field, and after
// repeated 429s, and any of those ends the sweep with a cell part collected.
// A half-filled snapshot left behind would be the most recent answer to its
// question and would shadow the last good one.
//
// This is what lets an empty snapshot mean one thing only: the market held
// nothing for that question at that instant.
//
// The rows already written stay, with their stamp removed. They are true
// observations and the archive keeps every response regardless; they simply
// join the history that predates snapshots, which no reader prices from.
function discardSnapshot (db, snapshotId) {
  db.prepare('UPDATE listing SET snapshot_id = NULL WHERE snapshot_id = ?').run(snapshotId)
  db.prepare('DELETE FROM snapshot WHERE id = ?').run(snapshotId)
}

async function runCell ({ client, db, index, query, perCell, question }) {
  const takenAt = new Date().toISOString()
  const res = await client.search(query, SORT)
  const snapshotId = openSnapshot(db, { ...question, takenAt })
  let listings = 0
  let fetches = 0
  const lastId = () => db.prepare('SELECT max(id) m FROM request').get().m
  const pages = chunk(res.ids.slice(0, perCell), 10)
  try {
    for (const [page, ids] of pages.entries()) {
      const before = lastId()
      await client.fetchItems(ids, res.queryId)
      fetches++
      const after = lastId()
      // The search was sorted cheapest-first and the fetch preserves that
      // order, so the position in the id list IS the server's own
      // cross-currency rank.
      if (after !== before) {
        listings += deriveRequest(db, after, index, { rankBase: page * 10, snapshotId })
      }
    }
  } catch (err) {
    discardSnapshot(db, snapshotId)
    throw err
  }
  return { total: res.total, listings, fetches }
}

export async function sweepPools ({ client, db, index, league, types, rarities, perCell,
                                    tradeWindow, log = () => {}, onCell = () => {} }) {
  let searches = 0; let fetches = 0; let listings = 0
  for (const type of types) {
    for (const rarity of rarities) {
      const cell = `${type}|${rarity}`
      onCell(cell)
      const r = await runCell({ client, db, index, perCell,
        query: poolQuery(type, rarity, tradeWindow),
        question: { league, type, rarity, statId: null } })
      searches++; fetches += r.fetches; listings += r.listings
      log(`  ${cell}: ${r.total} for sale, kept ${r.listings}`)
    }
  }
  return { searches, fetches, listings }
}

export async function sweepAffixes ({ client, db, index, league, types, perCell,
                                      tradeWindow, affixes = null,
                                      log = () => {}, onCell = () => {} }) {
  let searches = 0; let fetches = 0; let listings = 0
  for (const type of types) {
    const hashes = affixes || affixesFor(db, type)
    for (const hash of hashes) {
      const cell = `${type}|${AFFIX_RARITY}|${hash}`
      onCell(cell)
      const r = await runCell({ client, db, index, perCell,
        query: affixQuery(type, hash, tradeWindow),
        question: { league, type, rarity: AFFIX_RARITY, statId: hash } })
      searches++; fetches += r.fetches; listings += r.listings
      log(`  ${cell}: ${r.total} for sale, kept ${r.listings}`)
    }
  }
  return { searches, fetches, listings }
}
