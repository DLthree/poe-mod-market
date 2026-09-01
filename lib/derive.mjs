import { readResponse, requestsWithoutListings } from './archive.mjs'
import { rollsFrom, resolveStat } from './stat-index.mjs'
import { MAX_AFFIX } from './poe2.mjs'

// The item's hash arrives as "stat.explicit.stat_123". The stats table and the
// query filters both use "explicit.stat_123".
const trimHash = (h) => String(h).replace(/^stat\./, '')

// GGG spells a roll of one as a word — "spawn an additional Rare Monster",
// "Map contains an additional Rare Chest" — so the description holds no digit
// and reading numbers out of it yields nothing. Two sources still know the
// value: the matcher tables carry the number that wording stands for, and a
// magnitude whose min equals its max IS the roll.
function recoverRoll (hash, entry, index, mag) {
  const resolved = index.byMatcher ? resolveStat(index, entry.description || '') : null
  if (resolved && resolved.roll !== null && resolved.hashes.includes(hash)) return resolved.roll
  // A band of one value IS the roll.
  if (mag && Number(mag.min) === Number(mag.max)) return Number(mag.min)
  // Reaching here means the description held no digit at all, so it is the
  // singular rendering — "spawn an additional Rare Monster" against the same
  // stat's "spawn 2 additional Rare Monsters", both of which are in the archive.
  // GGG's own table writing this stat with no placeholder is the tell, and the
  // word stands for the bottom of the band.
  const table = index.byId.get(hash)
  if (table && !table.text.includes('#') && mag) return Number(mag.min)
  return null
}

function modFrom (entry, index) {
  const hash = trimHash(entry.hash)
  const detail = (entry.mods && entry.mods[0]) || null
  const mag = (detail && detail.magnitudes && detail.magnitudes[0]) || null
  let rolls = rollsFrom(index.byId.get(hash), entry.description || '')
  if (!rolls.length) {
    const recovered = recoverRoll(hash, entry, index, mag)
    if (recovered !== null) rolls = [recovered]
  }
  // GGG writes some descriptions with the sign flipped out of the number and
  // into the words: "dissipates 28% slower" against a band of -30 to -20,
  // because the stat is "#% faster". The band it sent alongside is the
  // authority, so a roll that only fits once negated IS negated.
  if (rolls.length && mag) {
    const lo = Number(mag.min)
    const hi = Number(mag.max)
    const fits = (v) => v >= lo && v <= hi
    if (!fits(rolls[0]) && fits(-rolls[0])) rolls = rolls.map(r => -r)
  }
  return {
    hash,
    roll: rolls.length ? rolls[0] : null,
    rolls: JSON.stringify(rolls),
    tier: (detail && detail.tier) || null,
    affix: (detail && detail.name) || null,
    rollMin: mag ? Number(mag.min) : null,
    rollMax: mag ? Number(mag.max) : null
  }
}

// `snapshotId` names the question this response answers. Phase 1 knows it
// because phase 1 asked it; phase 2 must never work it out from the request,
// so it is stamped on every row here instead. A replay has no snapshot and
// stamps null, which says unknown rather than "a snapshot of its own".
export function deriveRequest (db, requestId, index,
                               { rankBase = null, snapshotId = null } = {}) {
  const body = readResponse(db, requestId)
  if (!body || !Array.isArray(body.result)) return 0

  const insL = db.prepare(
    `INSERT OR IGNORE INTO listing
     (request_id, listing_id, indexed, account, price_amount, price_currency,
      price_kind, type, rarity, ilvl, rank, open_prefix, open_suffix, corrupted,
      snapshot_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const insM = db.prepare(
    `INSERT INTO listing_mod
     (request_id, listing_id, hash, roll, rolls, tier, affix, roll_min, roll_max)
     VALUES (?,?,?,?,?,?,?,?,?)`)

  // The search was sorted cheapest-first, so a listing's position in the
  // response is the server's own ranking of it. That ranking already accounts
  // for exalted against divine, which is why nothing here converts a price.
  let written = 0
  let position = -1
  for (const r of body.result) {
    position++
    if (!r || !r.item || !r.listing) continue
    const price = r.listing.price
    // A row with no price would silently join a pool and drag its floor.
    if (!price || typeof price.amount !== 'number' || !price.currency) continue

    const item = r.item
    const mods = (item.explicitMods || []).map(e => modFrom(e, index))
    // A row with any untyped modifier cannot be affix-counted. Say unknown.
    const typed = mods.length > 0 && mods.every(m => m.tier)
    const cap = MAX_AFFIX[item.rarity]
    const countable = typed && Boolean(cap)

    // `typeLine` carries the magic affixes — "Collector's Breach Tablet of the
    // Commander" — so grouping by it makes every magic tablet its own pool of
    // one. `baseType` is the clean base at every rarity.
    const type = item.baseType || item.typeLine

    const res = insL.run(requestId, r.id, r.listing.indexed,
      (r.listing.account && r.listing.account.name) || null,
      price.amount, price.currency, price.type || null,
      type, item.rarity, item.ilvl ?? null,
      rankBase === null ? null : rankBase + position,
      // Clamped: MAX_AFFIX is measured, not published, so an item can carry
      // more than it says. A negative slot count is never a fact about an item,
      // and `matches()` in walk.mjs reads these as "has an open affix".
      countable ? Math.max(0, cap.prefix - mods.filter(m => m.tier[0] === 'P').length) : null,
      countable ? Math.max(0, cap.suffix - mods.filter(m => m.tier[0] === 'S').length) : null,
      // A corrupted tablet cannot be modified again, so its open affixes are
      // not really open. Stored as 0/1 rather than left null: "not corrupted"
      // is a fact GGG sent, not an absence.
      item.corrupted ? 1 : 0,
      snapshotId)

    // Zero changes means this request already produced this listing, so its
    // modifiers are already stored too.
    if (res.changes === 0) continue
    written++
    for (const m of mods) {
      insM.run(requestId, r.id, m.hash, m.roll, m.rolls, m.tier, m.affix, m.rollMin, m.rollMax)
    }
  }
  return written
}

// Re-derives every archived response. Ranks are lost on a replay, because the
// page offset lived in the collector, not in the response. That is a fair
// trade: rank orders one page, and everything downstream falls back to the
// price when it is absent.
export function deriveAll (db, league, index) {
  let total = 0
  for (const id of requestsWithoutListings(db, league)) total += deriveRequest(db, id, index)
  return total
}
