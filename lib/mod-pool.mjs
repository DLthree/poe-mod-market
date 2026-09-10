import { readFileSync } from 'node:fs'

// PHASE 2 by tests/contract.test.mjs, and that is right: this reads one
// checked-in file and makes no request. Both phases may import it.
//
// WHAT THIS IS FOR. lib/sweep.mjs builds a vocabulary from the modifiers it has
// already seen, and it sees only the cheapest listings of a cell. On jewels that
// is fatal: a modifier that is scarce on a base never reaches the cheap end, so
// the sweep never asks about it. See docs/jewel-vocabulary-bias.md.
//
// This file is the answer. It is the modifiers the GAME says each base can roll,
// taken from GGG's own Mods table, so it owes nothing to what happened to be on
// sale. docs/jewel-modifier-pool.md has the extraction and how to redo it after
// a patch.
const POOL = JSON.parse(
  readFileSync(new URL('../vendor/poe2-jewel-mods.json', import.meta.url), 'utf8'))

export const POOL_BASES = Object.keys(POOL.bases)

/** The patch the pool was extracted from, for anything that reports provenance. */
export const POOL_PATCH = POOL.source.patch

/**
 * Every modifier a base can roll, as trade stat ids.
 *
 * The rarity is deliberately NOT a parameter. A base rolls one pool, and the
 * rarity only limits how many of them land on one item. That is the opposite of
 * the observed vocabulary in lib/sweep.mjs, which differs per rarity because it
 * reports what was seen rather than what exists.
 *
 * @param {string} base A jewel base type, as GGG spells it.
 * @returns {string[]} Explicit trade stat ids, one per modifier.
 * @throws If the base has no pool, or if any modifier in it carries no trade
 *   stat id. Both are refusals, not warnings: a short vocabulary spends a full
 *   pass looking complete while missing the rows the pool exists to find.
 */
export function poolFor (base) {
  const entry = POOL.bases[base]
  if (!entry) {
    throw new Error(
      `No modifier pool for ${JSON.stringify(base)}. Known: ${POOL_BASES.join(', ')}. ` +
      'Re-extract the pool as docs/jewel-modifier-pool.md describes; do not sweep ' +
      'a base whose modifiers are unknown.')
  }
  const unresolved = entry.mods.filter(m => !m.tradeIds.length)
  if (unresolved.length) {
    throw new Error(
      `${unresolved.length} of ${entry.mods.length} ${base} modifiers carry no trade ` +
      `stat id: ${unresolved.map(m => m.mod).join(', ')}. A pool with a hole asks ` +
      'fewer questions than it reports. Resolve them as docs/jewel-modifier-pool.md ' +
      'describes.')
  }
  return [...new Set(entry.mods.flatMap(m => m.tradeIds))]
}
