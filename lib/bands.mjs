// PHASE 2, and the only place the high/mid/low rule lives.
//
// This is a pure function over two numbers a modifier already carries, so the
// page derives the colour itself and the published file stays a record of
// measurements rather than a record of verdicts. Change a threshold in
// config.json and the meaning of every existing row changes with it, without a
// re-collection and without a stale opinion baked into the JSON.
//
// It runs in the browser as well as here — steps/build-site.mjs copies it into
// site/lib/ — so it must not import anything that touches a database.
//
// WHAT IS DELIBERATELY ABSENT: the sample size. How many listings and how many
// sellers stand behind a price is EVIDENCE, and evidence is not value. Folding
// it in here is exactly the bug this module was split out to fix: a modifier at
// 18x the blank tablet on four sellers came out indistinguishable from one at
// 1.1x on ninety, because both were called null. Early in a league the rare
// modifiers are the interesting ones and they are precisely the ones with thin
// evidence. Callers that care read `fewSamples`, which says nothing about worth.

/**
 * Which band a modifier's price falls in, or null when there is nothing to say.
 *
 * @param {{affixRatio: number|null, adds: number|null}} mod - A modifier as the
 *   economy file publishes it. `affixRatio` is its floor over the floor of a
 *   blank tablet of the same type and rarity; `adds` is the same comparison as
 *   a difference, in the cell's own currency. Both are null when the two cannot
 *   be compared at all — the modifier is unpriced, or priced in a currency the
 *   blank tablet is not.
 * @param {{midVsBlank: number, highVsBlank: number, minAdds: number}} walk -
 *   The thresholds, from config.json.
 * @returns {'high'|'mid'|'low'|null} null means "cannot say", never "worthless".
 */
export function bandOf ({ affixRatio, adds }, walk) {
  if (affixRatio === null || affixRatio === undefined) return null
  if (adds === null || adds === undefined) return null

  // A ratio against a junk floor is trivially cleared: where a blank tablet
  // costs 1 exalted, 2.1x it is 2.1 exalted, and a modifier "worth twice the
  // tablet" is worth about nothing. Falling short of real money is a
  // measurement, so it lands in `low` rather than back in "cannot say".
  if (adds < walk.minAdds) return 'low'

  if (affixRatio >= walk.highVsBlank) return 'high'
  if (affixRatio >= walk.midVsBlank) return 'mid'
  return 'low'
}
