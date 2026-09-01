// PHASE 2. The summary of one cell: what a blank tablet of it floors at, and
// what each modifier on it floors at.
//
// EVERY NUMBER COMES FROM THE SNAPSHOT OF THE SEARCH THAT ASKED FOR IT. The
// baseline is the answer to "what does a blank tablet of this cell floor at?".
// A modifier's floor is the answer to "what does one carrying this modifier
// floor at?". Nothing else contributes to either.
//
// Until 2026-08-31 this took a merged pool of rows and grouped it by modifier.
// That dragged in rows from searches asking about something else, and because
// rank numbers each search from zero, the merge stacked every rank-0 row at the
// front in no price order. A modifier config.json labels expected filler read
// +149 exalted where the live market said +5. See docs/snapshot-pricing.md.
import { makeFloor } from './floor.mjs'
import { latestSnapshot, listSnapshots } from './snapshots.mjs'
import { countDistinct, median } from './numbers.mjs'

// WHAT A MODIFIER IS MEASURED AGAINST.
//
// The blank tablet: the cheapest one of its kind, carrying nothing. A modifier
// is judged by what it multiplies that price by, in two bands from config.json:
//
//   high   at least walk.highVsBlank (2.1) times the blank floor
//   mid    at least walk.midVsBlank  (1.5) times the blank floor
//
// Both need a real sample behind them — walk.minListings and walk.minSellers —
// so a modifier seen three times cannot earn a band on a coincidence.
//
// Known consequence: this is a ratio against the junk end of the cell, so where
// the blank tablet is worth about nothing the bands are easy to clear. Delirium
// and Irradiated rares both floor at 1 exalted, and a 2 exalted modifier on
// them is "high" while the whole tablet is worth 2 exalted. `typical` below is
// published beside every cell for exactly that reason: it says what the rest of
// the list costs, so a band can be read against its own cell.
const typicalFloor = (mods, currency) => {
  const floors = mods
    .filter(m => m.floor !== null && m.floor > 0 && m.currency === currency)
    .map(m => m.floor)
  return floors.length ? median(floors) : null
}

// "#% increased number of Rare Monsters" says nothing about whether the modifier
// is worth rolling for. The band GGG sends with every listing does, so the
// placeholder is filled with what the sample actually held: "25-35% increased
// number of Rare Monsters". Widest observed band, not the first one seen — two
// tiers of the same modifier sit in one pool.
function labelFor (text, hits, hash) {
  let lo = null
  let hi = null
  for (const row of hits) {
    for (const m of row.mods) {
      if (m.hash !== hash || m.rollMin == null || m.rollMax == null) continue
      lo = lo === null ? m.rollMin : Math.min(lo, m.rollMin)
      hi = hi === null ? m.rollMax : Math.max(hi, m.rollMax)
    }
  }
  if (lo === null) return text
  const band = lo === hi ? String(lo) : `${lo}-${hi}`
  if (String(text).includes('#')) return text.replace('#', band)
  // GGG writes some modifiers with no placeholder at all — "spawn an additional
  // Rare Monster" against a band of 1 to 3, which is the Breach premium. The
  // band is appended rather than substituted, because rewriting "an" into "1-3"
  // would be guessing at grammar. A band of exactly one adds nothing.
  return lo === hi ? text : `${text} (${band})`
}

const affixOf = (hits, hash) => {
  for (const row of hits) {
    for (const m of row.mods) if (m.hash === hash) return m.affix
  }
  return null
}

const ageHours = (row, now) => (now - Date.parse(row.indexed)) / 36e5

// A corrupted normal or magic tablet is not the plain tablet this cell is meant
// to price. Corruption is a separate thing a buyer pays for, and on a cell with
// only a handful of listings it is the whole cell: the newest Overseer normal
// snapshot held exactly two rows, both corrupted, at 89 and 100 exalted, and
// that was the published price of a blank Overseer tablet.
//
// Rare is left alone. A corrupted rare carries the same modifiers a buyer is
// searching for, and 88 of 4460 rare rows are corrupted — they are part of that
// market, not an artefact of it.
const CORRUPTIBLE = new Set(['Rare'])
const plain = (rows, rarity) =>
  CORRUPTIBLE.has(rarity) ? rows : rows.filter(r => !r.corrupted)

// Every count here is a count of OUR SAMPLE, never of the market. It is said in
// a field rather than only in the page, because a programmatic consumer cannot
// read a label that lives in HTML.
export function sampleOf (rows, now) {
  return {
    listings: rows.length,
    sellers: countDistinct(rows.map(r => r.account)),
    medianAgeHours: rows.length ? Number(median(rows.map(r => ageHours(r, now))).toFixed(1)) : null,
    basis: 'our sample, not the market'
  }
}

export function floorOf (rows, floor, now) {
  const f = floor(rows, now)
  return {
    value: f.value,
    currency: f.currency,
    cheapest: f.min,
    cheapestCurrency: f.minCurrency,
    strategy: f.strategy,
    setAside: f.setAside,
    basis: f.basis
  }
}

// A modifier with no floor at all. It was seen on the cell but never asked
// about, so we hold no answer to "what does one carrying it cost?". It is
// reported rather than dropped: a missing line reads as a page bug, and the
// count still says how common the modifier is.
const unpriced = (hash, hits, text) => ({
  hash,
  affix: affixOf(hits, hash),
  text,
  label: labelFor(text, hits, hash),
  matches: hits.length,
  sellers: countDistinct(hits.map(r => r.account)),
  floor: null,
  cheapest: null,
  currency: null,
  delta: null,
  quality: null,
  priced: false
})

// Which band a modifier lands in, or null when there is nothing to compare: no
// price of its own, a baseline in another currency, a blank tablet that floors
// at nothing, or too thin a sample to say anything at all.
function qualityOf (m, baseline, bands, walk) {
  if (!m.priced || m.floor === null || m.currency !== baseline.currency) return null
  if (!(baseline.value > 0)) return null
  if (m.matches < walk.minListings || m.sellers < walk.minSellers) return null
  const ratio = m.floor / baseline.value
  if (ratio >= bands.high) return 'high'
  if (ratio >= bands.mid) return 'mid'
  return null
}

const RANK = { high: 2, mid: 1 }

// The modifiers to report on a cell: every one somebody spent a search on, and
// every one merely SEEN on the cell's own listings. The second set cannot be
// priced, because we never asked, but dropping it would hide how common a
// modifier is.
function modifiersFor (db, { league, type, rarity, since }, baselineRows) {
  const asked = new Set()
  for (const s of listSnapshots(db, { league, since })) {
    if (s.type === type && s.rarity === rarity && s.statId !== null) asked.add(s.statId)
  }
  const seen = new Map()
  for (const row of baselineRows) {
    for (const m of row.mods) {
      if (asked.has(m.hash)) continue
      if (!seen.has(m.hash)) seen.set(m.hash, [])
      seen.get(m.hash).push(row)
    }
  }
  return { asked: [...asked], seen }
}

export function cellSummary (db, { league, type, rarity, lookbackHours, config, textFor,
                                   now = Date.now() }) {
  const floor = makeFloor(config.floor)
  const since = lookbackHours == null
    ? null
    : new Date(now - lookbackHours * 3600 * 1000).toISOString()
  const base = latestSnapshot(db, { league, type, rarity, since })
  const baseRows = plain(base ? base.rows : [], rarity)
  const baseline = floorOf(baseRows, floor, now)
  const textOf = (hash) => (textFor ? textFor(hash) : hash)

  const { asked, seen } = modifiersFor(db, { league, type, rarity, since }, baseRows)
  const out = []
  for (const hash of asked) {
    const snap = latestSnapshot(db, { league, type, rarity, statId: hash, since })
    const hits = plain(snap ? snap.rows : [], rarity)
    const f = floorOf(hits, floor, now)
    const sellers = countDistinct(hits.map(r => r.account))
    // What the modifier is WORTH, in the currency it is priced in. A ratio
    // hides the size of the prize: "x10" on a 1 ex baseline is 9 exalted, while
    // "x1.4" on a 100 ex baseline is 40. Never converted, so two currencies
    // give null rather than an invented number.
    const delta = (f.value > 0 && baseline.value > 0 && f.currency === baseline.currency)
      ? Number((f.value - baseline.value).toFixed(2))
      : null
    const text = textOf(hash)
    out.push({
      hash,
      affix: affixOf(hits, hash),
      text,
      label: labelFor(text, hits, hash),
      matches: hits.length,
      sellers,
      floor: f.value,
      cheapest: f.cheapest,
      currency: f.currency,
      delta,
      quality: null,
      priced: true
    })
  }
  for (const [hash, hits] of seen) out.push(unpriced(hash, hits, textOf(hash)))

  const bands = { mid: config.walk.midVsBlank, high: config.walk.highVsBlank }
  // An absent band would compare against NaN and every modifier would come back
  // unbanded with nothing to show for it. A missing setting is a fault, not a
  // verdict of "nothing here is worth anything".
  for (const [name, value] of Object.entries(bands)) {
    if (!(value > 0)) {
      throw new Error(
        `config.walk.${name}VsBlank must be a positive number, ` +
        `got ${JSON.stringify(value)}. It is how many times the floor of a blank ` +
        `tablet a modifier must cost to be called ${name} quality.`)
    }
  }
  if (bands.high < bands.mid) {
    throw new Error(
      `config.walk.highVsBlank (${bands.high}) is below midVsBlank (${bands.mid}), ` +
      'so no modifier could ever be high quality without also being mid.')
  }
  const typical = typicalFloor(out, baseline.currency)
  for (const m of out) m.quality = qualityOf(m, baseline, bands, config.walk)

  // Best band first, then by what it adds. Sorting on the number alone floats
  // cells with three rows to the top, where they read as the headline finding.
  const rank = (m) => RANK[m.quality] ?? 0
  out.sort((a, b) =>
    rank(b) - rank(a) ||
    (b.delta ?? -Infinity) - (a.delta ?? -Infinity) ||
    b.matches - a.matches)

  return {
    baseline,
    mods: out,
    // What the rest of this cell's modifiers cost: the median floor of every
    // one we have a price for. The bands are not measured against it — they are
    // measured against the blank tablet — but a band means little without it. A
    // "high" modifier on a cell whose typical modifier costs the same is a
    // statement about how cheap the blank tablet is.
    typical,
    sample: sampleOf(baseRows, now),
    takenAt: base ? base.takenAt : null
  }
}
