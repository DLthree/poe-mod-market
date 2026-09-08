// PHASE 2. Chooses which modifiers a quick pass should re-ask. It reads the
// derived tables through cellSummary and makes no network call, which is why it
// belongs here and not beside the sweep: "which questions are worth asking
// again" is a judgement about data we already hold.
//
// A quick pass is a REFRESH, not a smaller full pass. It re-asks the modifiers
// the last pass already measured at or above a ratio, so it cannot discover a
// modifier that has become valuable since — that one still reads at its old
// floor until a full pass. A modifier nobody has ever asked about is invisible
// to it entirely, because it has no ratio to compare.
//
// What a quick pass DOES keep honest is the baseline. Every pool is re-asked in
// full, so the blank tablet price is current; the floors above it are then at
// most `lookbackHours` old, exactly as they are after `--rarities magic` or any
// other partial pass. That bound is the reason this is safe to publish.
import { cellSummary } from './summary.mjs'

// The database stores a rarity as GGG spells it on an item; a query option is
// lower case. Same rule as the sweep's, for the same reason.
const canonicalRarity = (r) => r[0].toUpperCase() + r.slice(1).toLowerCase()

/**
 * The modifiers of one cell whose last measured ratio reaches `minRatio`.
 *
 * Dearest first, so a pass that is interrupted has spent its allowance on the
 * modifiers that matter most rather than on whatever came alphabetically.
 *
 * @param {object} db Open archive.
 * @param {object} opts League, cell, threshold and the summary's own inputs.
 * @returns {string[]} Stat ids, ordered by ratio descending.
 */
export function quickAffixes (db, { league, type, rarity, minRatio, lookbackHours,
                                    config, textFor, now = Date.now() }) {
  if (!(Number(minRatio) > 0)) {
    throw new Error(
      `quickAffixes needs a positive minRatio, got ${JSON.stringify(minRatio)}. ` +
      'Zero or missing would re-ask every modifier at full-pass cost while ' +
      'reporting itself as a quick one.')
  }
  const cell = cellSummary(db, {
    league, type, rarity: canonicalRarity(rarity), lookbackHours, config, textFor, now
  })
  return cell.mods
    .filter(m => m.affixRatio !== null && m.affixRatio >= Number(minRatio))
    .sort((a, b) => b.affixRatio - a.affixRatio)
    .map(m => m.hash)
}
