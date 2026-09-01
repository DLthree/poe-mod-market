import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { plain } from './text.mjs'

const NUM = String.raw`([+-]?\d+(?:\.\d+)?)`

// A template is "Map has #% increased number of Rare Monsters". Turning it into
// a regex is how a rolled number is read back out of a listing's description.
function templateToRegex (text) {
  const escaped = plain(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('^' + escaped.split('#').join(NUM) + '$', 'i')
}

// Key used to look a clipboard line up: the template with its numbers removed.
function textKey (text) {
  return plain(text).replace(/[+-]?\d+(?:\.\d+)?/g, '#').trim().toLowerCase()
}

// GGG's stats table and the game's item text do not always agree. The stats
// entry for explicit.stat_3762913035 reads "Unstable Breaches in Map spawn an
// additional Rare Monster when Stabilised" — singular, and with no placeholder
// at all — while a listing carrying it reads "...spawn 3 additional Rare
// Monsters...". A strict key misses that pair entirely, so a second, looser key
// treats "a"/"an" as a number and strips word-final "s" from both sides.
function looseKey (text) {
  return plain(text)
    .toLowerCase()
    .replace(/[+-]?\d+(?:\.\d+)?/g, '#')
    .replace(/\ban\b|\ba\b/g, '#')
    .replace(/s\b/g, '')
    .replace(/[^a-z#% ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Exiled Exchange 2 ships one entry per *stat*, each carrying every wording the
// game uses for it. That is what GGG's own table lacks: the trade table has no
// "dissipates #% slower" at all, only "#% faster", and no "increased Gold found
// in Map" without the "(Gold Piles)" qualifier. A matcher can also carry
// `negate` (the wording is the stat with its sign flipped) or `value` (the
// wording spells its roll as a word, as in "an additional Rare Chest").
const matcherKey = (s) => plain(s).toLowerCase().replace(/\s+/g, ' ').trim()

// One stat can cover more than one trade id — 23 of EE2's 1936 do. Keep them
// all; picking one silently drops listings that carry the other.
function tradeIdsOf (entry) {
  const ids = (entry.trade && entry.trade.ids) || {}
  return ids.explicit || ids.implicit || []
}

export function buildIndex (statsJson, ee2 = null) {
  const byId = new Map()
  const byText = new Map()
  const byLoose = new Map()
  // GGG qualifies some of its own wordings where the item text does not: the
  // table says "#% increased Gold found in Map (Gold Piles)" and the tablet says
  // "#% increased Gold found in Map". Keyed without the qualifier the pair meets,
  // and it meets on GGG's own id rather than on a guess.
  const unqualified = []
  for (const group of statsJson.result || []) {
    for (const entry of group.entries || []) {
      if (!byId.has(entry.id)) {
        byId.set(entry.id, {
          id: entry.id,
          text: plain(entry.text),
          re: templateToRegex(entry.text)
        })
      }
      const key = textKey(entry.text)
      if (!byText.has(key)) byText.set(key, entry.id)
      const loose = looseKey(entry.text)
      if (!byLoose.has(loose)) byLoose.set(loose, entry.id)
      const bare = plain(entry.text).replace(/\s*\([^)]*\)\s*$/, '')
      if (bare !== plain(entry.text)) unqualified.push([textKey(bare), entry.id])
    }
  }
  // Added last so a qualified wording never shadows an exact one.
  const byUnqualified = new Map()
  for (const [key, id] of unqualified) {
    if (!byText.has(key) && !byUnqualified.has(key)) byUnqualified.set(key, id)
  }

  const byMatcher = new Map()
  for (const entry of ee2 || []) {
    const hashes = tradeIdsOf(entry)
    if (!hashes.length) continue
    for (const m of entry.matchers || []) {
      const key = matcherKey(m.string)
      if (byMatcher.has(key)) continue
      byMatcher.set(key, { hashes, negate: Boolean(m.negate), value: m.value })
    }
  }
  return { byId, byText, byLoose, byUnqualified, byMatcher }
}

// A rolled value, optionally followed by the band the game prints beside it:
// "33(25-35)%". The band is inside the same match, so its own digits are
// consumed here and never mistaken for a second rolled value.
const VALUE = /([+-]?\d+(?:\.\d+)?)(?:\(\s*([+-]?\d+(?:\.\d+)?)\s*-\s*([+-]?\d+(?:\.\d+)?)\s*\))?/g

export function splitRolls (line) {
  const values = []
  const template = plain(line).replace(VALUE, (_, value, min, max) => {
    values.push({
      roll: Number(value),
      min: min === undefined ? null : Number(min),
      max: max === undefined ? null : Number(max)
    })
    return '#'
  })
  return { template, values }
}

/**
 * Resolve one line of game item text to the trade stats it can be searched by.
 *
 * @param {object} index Built by buildIndex.
 * @param {string} line One modifier line, as the game writes it.
 * @returns {{hashes: string[], roll: number|null, bounds: object|null,
 *            negate: boolean}|null} Null when the line matches no known stat.
 */
export function resolveStat (index, line) {
  // The template, not the raw line: "33(25-35)%" would otherwise key as
  // "#(#-#)%" and match nothing in either table.
  const { template, values } = splitRolls(line)
  const key = textKey(template)

  // The overlay is consulted for MEANING — whether this wording is the stat
  // negated, and what number a worded roll stands for. Its ids are only a
  // fallback. Measured over 2054 collected rows: where the two disagreed, the
  // overlay's first id appeared on no listing at all and GGG's appeared on
  // hundreds. EE2's table is generated from a game dump some months old and
  // carries ids that tablets do not use.
  const matched = index.byMatcher && index.byMatcher.get(matcherKey(template))
  const negate = Boolean(matched && matched.negate)
  const worded = matched ? matched.value ?? null : null

  const known = (h) => index.byId.has(h)
  const own = index.byText.get(key) ||
    (index.byUnqualified && index.byUnqualified.get(key)) || null

  let hashes
  if (own) {
    hashes = [own, ...(matched ? matched.hashes.filter(h => h !== own) : [])]
  } else if (matched) {
    // Nothing exact from GGG. Take the overlay's list, but rank an id GGG has
    // heard of above one it has not.
    hashes = [...matched.hashes].sort((a, b) => (known(b) ? 1 : 0) - (known(a) ? 1 : 0))
  } else {
    const loose = hashFor(index, template)
    if (!loose) return null
    hashes = [loose]
  }

  const first = values[0]
  let roll = first ? first.roll : worded
  let bounds = first && first.min !== null ? { min: first.min, max: first.max } : null
  if (negate) {
    if (roll !== null && roll !== undefined) roll = -roll
    if (bounds) bounds = { min: -bounds.min, max: -bounds.max }
  }
  // The game prints a descending band when the lower roll is the better one.
  if (bounds && bounds.min > bounds.max) bounds = { min: bounds.max, max: bounds.min }

  return { hashes, roll: roll ?? null, bounds, negate }
}

export function rollsFrom (entry, description) {
  if (!entry) return []
  const desc = plain(description).trim()
  const m = entry.re.exec(desc)
  if (m) return m.slice(1).map(Number)
  // The template carried no placeholder, or worded the line differently. The
  // numbers in the item's own text are still the rolls.
  return (desc.match(/[+-]?\d+(?:\.\d+)?/g) || []).map(Number)
}

export function hashFor (index, line) {
  return index.byText.get(textKey(line)) ||
    (index.byLoose ? index.byLoose.get(looseKey(line)) : null) ||
    null
}

// Display text for a stat id, for a table a human reads.
export function textFor (index, hash) {
  const e = index.byId.get(hash)
  return e ? e.text : hash
}

// Exiled Exchange 2's generated stat table, vendored under data/. MIT, from
// Kvan7/Exiled-Exchange-2 at acc7653 (2026-06-20). It is an overlay, never a
// replacement: GGG's own table carries stats EE2 has never seen, and EE2
// carries wordings GGG's table omits. Each covers the other's gaps.
export function vendoredEe2 () {
  const path = fileURLToPath(new URL('../vendor/ee2-stats.ndjson', import.meta.url))
  // Returning an empty overlay would be silent and expensive: every worded roll
  // goes back to null and every negated wording stops resolving, with no error.
  if (!existsSync(path)) {
    throw new Error(`Missing the vendored matcher table at ${path}. ` +
      'Copy dataParser/output/en/stats.ndjson from a Exiled-Exchange-2 checkout.')
  }
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
}

export async function loadIndex ({ client, cacheDir, refresh = false }) {
  mkdirSync(cacheDir, { recursive: true })
  const path = join(cacheDir, 'stats-poe2.json')
  if (!refresh && existsSync(path)) {
    return buildIndex(JSON.parse(readFileSync(path, 'utf8')), vendoredEe2())
  }
  const json = await client.dataStats()
  writeFileSync(path, JSON.stringify(json))
  return buildIndex(json, vendoredEe2())
}
