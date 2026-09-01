// PHASE 2. Turns chosen modifiers into a PoE2 stash-search string.
//
// The stash search takes quoted terms separated by spaces, and an item must
// match every term. Inside one term, `|` is a choice. Both selection modes fall
// out of that syntax:
//
//   match all   "ndo" "wh"      two terms, both must match
//   match any   "ndo|wh"        one term, either half matches
//
// A FRAGMENT is a short piece of a modifier's own wording, chosen so that no
// other modifier we know matches it. `ndo` means "Map has # additional random
// Modifier" because nothing else on a tablet says "ndo".
//
// SEARCHING IGNORES CASE, so everything here is lower case.
//
// WHY WE GENERATE THESE RATHER THAN BORROW THEM. poe.re ships a table of 81
// fragments. Measured against GGG's current wordings on 2026-08-31, 12 of the 76
// we could use were wrong: 4 matched more than one modifier and 8 matched
// nothing at all, because their table was generated from older wordings — GGG
// says "an additional Shrine" where the table expects "additional Shrines". A
// fragment that matches nothing silently hides a keeper; one that matches two
// silently lets junk through. Neither shows up on the page.
//
// Generating from GGG's own text costs about 240 ms for 70 modifiers, cannot go
// stale, and settles the licence question by not arising.

// The game shows a rolled value where our text shows `#`. Every comparison uses
// a stand-in roll on BOTH sides: a fragment holding `\d+` compared against texts
// that still carry `#` would look unique against everything, trivially and
// wrongly.
const norm = (text) => text.replace(/#/g, '7')
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Candidates, shortest first.
//
// A plain run is a piece of the wording between two rolls. It can never span a
// roll, because our text has a placeholder there and the item has a number.
//
// An anchored run pins the start or end of the line. `ic$` separates the
// modifier ENDING in "Magic" from the one that merely contains the word.
//
// A bridged run crosses the roll with a digit class, and is the last resort.
// "Area contains # additional Azmeri Spirit" cannot be told from "Areas with
// Powerful Map Bosses contain an additional Azmeri Spirit" by any contiguous
// run — they end in the same three words — but only one has a number in it.
// THE ORDER IS THE POINT. The stash search is not a full regex engine, so a
// fragment needing no operator at all beats a shorter one that needs one. Plain
// runs are exhausted at every length, then anchored, and only then a bridge.
// Measured: bridging competing at equal length stole three wins from plain runs
// and put `\d+` in three fragments where one was enough.
function * candidates (text) {
  const lower = text.toLowerCase()
  const runs = lower.split('#').filter(r => r.trim().length > 1)
  const parts = lower.split('#')
  const MAX = 40

  for (let len = 2; len <= MAX; len++) {
    for (const run of runs) {
      for (let i = 0; i + len <= run.length; i++) yield esc(run.slice(i, i + len))
    }
  }
  for (let len = 2; len <= MAX; len++) {
    for (const run of runs) {
      if (run.length < len) continue
      yield '^' + esc(run.slice(0, len))
      yield esc(run.slice(run.length - len)) + '$'
    }
  }
  for (let len = 2; len <= MAX; len++) {
    for (let i = 0; i + 1 < parts.length; i++) {
      const left = parts[i]
      const right = parts[i + 1]
      if (left.length < len || right.length < len) continue
      yield esc(left.slice(left.length - len)) + '\\d+' + esc(right.slice(0, len))
    }
  }
}

// THE ONE RULE: a fragment must match its own modifier and no other.
//
// Checking it against its own text is what makes anchors safe. `^%` looks unique
// against every other modifier and matches nothing at all, its own text
// included, so this rule throws it out.
export function fragmentFor (text, others) {
  const rest = others.map(norm)
  const own = norm(text)
  for (const frag of candidates(text)) {
    const re = new RegExp(frag, 'i')
    if (!re.test(own)) continue
    if (rest.some(o => re.test(o))) continue
    return frag
  }
  return null
}

// A fragment for every modifier, each unique against all the others.
//
// `texts` is `{ statId: wording }`. The result is `{ statId: fragment }`, with a
// null for any modifier no fragment can separate — reported, never dropped.
export function buildFragments (texts) {
  const ids = Object.keys(texts)
  const out = {}
  for (const id of ids) {
    out[id] = fragmentFor(texts[id], ids.filter(o => o !== id).map(o => texts[o]))
  }
  return out
}

// The search is the modifiers and nothing else.
//
// Match any is ONE term holding an alternation: "a|b|c". No group around it —
// the quotes already bound the term, and a group would only spend characters.
// Match all is one term each, and the search requires every term.
//
// No modifier chosen means no search. There is deliberately no clause for the
// tablet type or its rarity: you are looking at one type's modifier list, and
// its fragments are already particular to it.
//
// `unkeyed` is returned rather than swallowed. A modifier we cannot express is
// a fact the reader needs, and a search that quietly means less than it looks
// like is the worst outcome on this page.
export function tabletRegex ({ statIds = [], fragments = {}, mode = 'any' }) {
  const keyed = []
  const unkeyed = []
  for (const id of statIds) {
    if (fragments[id]) keyed.push(fragments[id])
    else unkeyed.push(id)
  }
  if (keyed.length === 0) return { regex: '', unkeyed }
  const regex = mode === 'all'
    ? keyed.map(k => `"${k}"`).join(' ')
    : `"${keyed.join('|')}"`
  return { regex, unkeyed }
}
