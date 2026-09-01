import { countDistinct } from './numbers.mjs'
import { makeFloor, lift as liftOf } from './floor.mjs'

export function candidatesFor (rows) {
  const seen = new Map()
  for (const row of rows) {
    for (const m of row.mods || []) if (!seen.has(m.hash)) seen.set(m.hash, m.affix || null)
  }
  const out = [...seen].map(([hash, affix]) => ({ key: `mod:${hash}`, kind: 'mod', hash, affix }))
  // These cannot be queried, but they cost nothing: the rows are already here.
  out.push({ key: 'openPrefix', kind: 'openPrefix' })
  out.push({ key: 'openSuffix', kind: 'openSuffix' })
  return out
}

export function matches (candidate, row) {
  // A null open-affix count is unknown and must never count as an open affix.
  if (candidate.kind === 'openPrefix') return row.openPrefix > 0
  if (candidate.kind === 'openSuffix') return row.openSuffix > 0
  return (row.mods || []).some(m => m.hash === candidate.hash)
}

// `min` is reported. `floor` is what the thresholds test, and which rule
// produces it lives entirely in lib/floor.mjs.
export function statFor (rows, floor, now) {
  const f = floor(rows, now)
  return {
    min: f.min,
    floor: f.value,
    currency: f.currency,
    setAside: f.setAside,
    basis: f.basis,
    strategy: f.strategy,
    listings: rows.length,
    sellers: countDistinct(rows.map(r => r.account))
  }
}

const passes = (s, lift, config) =>
  s.listings >= config.minListings &&
  s.sellers >= config.minSellers &&
  lift >= config.minLift

function poolFor (rows, config, floor, now) {
  const candidates = candidatesFor(rows)
  // Sets, not arrays: the accept loop asks "is this row claimed?" for every
  // candidate-row pair, and a real pool holds thousands of rows.
  const hits = new Map(candidates.map(c => [c.key, new Set(rows.filter(r => matches(c, r)))]))

  let accepted = []
  let baseline = statFor(rows, floor, now)

  for (let round = 0; round < 3; round++) {
    if (!baseline.floor) break

    const ranked = candidates
      .map(c => ({ c, s: statFor([...hits.get(c.key)], floor, now) }))
      .filter(x => x.s.floor !== null)
      .map(x => ({ ...x, lift: liftOf(x.s, baseline) }))
      // A candidate priced in a currency the baseline does not use cannot be
      // ranked against it. Say so rather than invent a rate.
      .filter(x => x.lift !== null)
      // Best lift first; on a tie the more specific candidate — the one on
      // fewer listings — goes first, because it better explains the price.
      .sort((a, b) => b.lift - a.lift || a.s.listings - b.s.listings)

    // A candidate must lift on rows no accepted candidate already explains.
    // That is what stops a modifier inheriting the value of one it sits beside.
    const claimed = new Set()
    const next = []
    for (const { c } of ranked) {
      const alone = [...hits.get(c.key)].filter(r => !claimed.has(r))
      const s = statFor(alone, floor, now)
      if (s.floor === null) continue
      const lift = liftOf(s, baseline)
      if (lift === null || !passes(s, lift, config)) continue
      next.push({ ...c, ...s, lift })
      for (const r of alone) claimed.add(r)
    }

    const settled = next.length === accepted.length &&
      next.every((e, i) => e.key === accepted[i].key)
    accepted = next

    // The baseline is "carries no meaningful modifier", so it excludes every row
    // an accepted candidate matches, not only the rows it claimed.
    const meaningful = new Set()
    for (const e of accepted) for (const r of hits.get(e.key)) meaningful.add(r)
    const baseRows = rows.filter(r => !meaningful.has(r))
    baseline = statFor(baseRows.length ? baseRows : rows, floor, now)

    if (settled) break
  }

  return { type: rows[0].type, rarity: rows[0].rarity, baseline, meaningful: accepted }
}

export function walk (rows, config, { floor = null, now = Date.now() } = {}) {
  const rule = floor || makeFloor(config.floor)
  const groups = new Map()
  for (const r of rows) {
    const key = `${r.type}|${r.rarity}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  const pools = []
  for (const g of groups.values()) {
    if (g.length >= config.minListings) pools.push(poolFor(g, config, rule, now))
  }
  return { pools, floorStrategy: rule.strategy }
}
