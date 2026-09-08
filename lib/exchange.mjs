// PHASE 2. One approximate rate table, and the smallest thing that can be done
// with it.
//
// THE RULE THIS FILE DOES NOT BREAK: no stored price is converted. A listing
// keeps the amount and currency GGG sent, and a floor still comes from the rank
// GGG's own price ordering gave it — the server compares exalted against divine
// with a rate we do not hold, and that ordering is exact where this table is a
// guess.
//
// The guess buys back one thing only. A modifier priced in divine on a cell
// whose blank tablet is priced in exalted could not be compared to it at all,
// so eleven of the dearest modifiers in Forbidden Rites published as "cannot
// say" and went uncoloured — the exact failure the band split was meant to end.
// Comparing them needs a rate. Nothing else here does.
//
// Every published row that leans on this carries `assumedRate`, because a
// number resting on a standing guess and a number resting on GGG's own ordering
// should not read the same.

/**
 * One price as a number of exalted, or null when no rate is known for it.
 *
 * Null rather than a fallback of 1: an unknown currency silently treated as
 * exalted would put a mirror-priced listing at the cheap end of a cell.
 *
 * @param {number|null} amount
 * @param {string|null} currency
 * @param {object} rates Currency name to worth in exalted.
 * @returns {number|null}
 */
export function inExalted (amount, currency, rates) {
  if (amount === null || amount === undefined) return null
  const rate = rates?.[currency]
  if (!(rate > 0)) return null
  return amount * rate
}

/**
 * Fails a rate table that would quietly produce wrong numbers.
 *
 * Exalted must be exactly 1 because it is the unit everything else is quoted
 * in; anything else makes every ratio in the file wrong by that factor while
 * still looking like a price.
 *
 * @param {object} rates
 */
export function validateExchange (rates) {
  if (!rates || typeof rates !== 'object') {
    throw new Error('config.json needs an `exchange` table of currency to worth in exalted.')
  }
  if (rates.exalted !== 1) {
    throw new Error(
      `config.exchange.exalted must be exactly 1, got ${JSON.stringify(rates.exalted)}. ` +
      'It is the unit every other rate is quoted in.')
  }
  for (const [name, value] of Object.entries(rates)) {
    if (!(value > 0)) {
      throw new Error(
        `config.exchange.${name} must be a positive number, got ${JSON.stringify(value)}. ` +
        'Remove the currency instead of setting it to zero: a missing rate means ' +
        '"cannot compare", which is a real answer, and zero means "worth nothing".')
    }
  }
}
