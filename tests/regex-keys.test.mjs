import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildFragments, fragmentFor, tabletRegex } from '../lib/regex-keys.mjs'

// The 70 modifiers we have ever priced, in GGG's own wording. A fragment is
// only worth anything if it separates one of these from all the others, so this
// is the set every claim below is made against.
const TEXTS = JSON.parse(
  readFileSync(new URL('./fixtures/tablet-mod-texts.json', import.meta.url), 'utf8'))
const ids = Object.keys(TEXTS)

// The game shows a rolled value where our text shows `#`.
const norm = (t) => t.replace(/#/g, '7')
const matches = (frag, text) => new RegExp(frag, 'i').test(norm(text))

const FRAGMENTS = buildFragments(TEXTS)

// THE TEST THAT MATTERS.
//
// A fragment matching two modifiers turns a search for a 200-exalted modifier
// into one that also lets junk through. A fragment matching none silently drops
// a keeper. Neither shows up on the page, so it has to show up here.
//
// This is also the measurement that retired poe.re's table: 12 of the 76
// fragments we could have borrowed fail this, 4 by matching more than one
// modifier and 8 by matching nothing at all, because it was generated against
// older wordings.
test('every fragment matches its own modifier and no other', () => {
  for (const id of ids) {
    const frag = FRAGMENTS[id]
    assert.ok(frag, `no fragment for ${TEXTS[id]}`)
    assert.ok(matches(frag, TEXTS[id]),
      `${frag} does not match its own modifier: ${TEXTS[id]}`)
    const hits = ids.filter(other => matches(frag, TEXTS[other]))
    assert.equal(hits.length, 1,
      `${frag} matches ${hits.length}: ` + hits.map(h => TEXTS[h]).join(' | '))
  }
})

test('every modifier we price gets a fragment', () => {
  const missing = ids.filter(id => !FRAGMENTS[id])
  assert.deepEqual(missing, [], missing.map(id => TEXTS[id]).join('\n'))
  assert.equal(ids.length, 70)
})

// Anchors separate the modifier ENDING in a word from the one that merely
// contains it. They are only safe because a candidate is checked against its own
// text: `^%` looks unique against every other modifier and matches nothing at
// all, its own text included.
test('an anchored fragment still matches its own modifier', () => {
  const anchored = ids.filter(id => /[\^$]/.test(FRAGMENTS[id]))
  assert.ok(anchored.length > 0, 'no anchored fragment was produced at all')
  for (const id of anchored) assert.ok(matches(FRAGMENTS[id], TEXTS[id]))
})

// Two modifiers end in the same three words and differ only by a number in the
// middle, so no contiguous run can tell them apart.
test('a modifier that only a number separates gets a digit-class fragment', () => {
  const id = ids.find(i => TEXTS[i] === 'Area contains # additional Azmeri Spirit')
  assert.ok(id, 'the fixture no longer holds that modifier')
  assert.ok(FRAGMENTS[id].includes('\\d+'),
    `expected a digit class, got ${FRAGMENTS[id]}`)
})

test('a fragment never spans the roll placeholder as a literal', () => {
  for (const id of ids) assert.ok(!FRAGMENTS[id].includes('#'))
})

// THE STASH SEARCH IS NOT A REGEX ENGINE. It accepts a small subset, and the
// only evidence for what is in that subset is what poe.re bets its product on:
// across all 81 of their tablet fragments they use `$` 10 times, `^` 4 times,
// and `\d` with `+` exactly once. Nothing else — no character class, no escaped
// bracket, no quantifier of any other kind.
//
// So a fragment here may hold letters, digits, spaces and ordinary punctuation,
// and beyond that only a leading `^`, a trailing `$`, and `\d+`. Anything else
// is a guess about an engine we cannot read the source of.
test('a fragment uses only the operators the search is known to accept', () => {
  for (const id of ids) {
    const bare = FRAGMENTS[id]
      .replace(/^\^/, '')
      .replace(/\$$/, '')
      .split('\\d+').join('')
    assert.ok(!/[\\[\]()|*+?^$]/.test(bare),
      `${FRAGMENTS[id]} uses an operator the stash search may not accept`)
  }
})

// Cheapness is the whole reason to prefer a plain run: an operator-free
// fragment cannot be refused by an engine we cannot inspect. Measured on the 70
// we hold, exactly one modifier needs the digit class, because two texts end in
// the same three words and differ only by a number.
test('almost nothing needs an operator at all', () => {
  const withOps = ids.filter(id => /[\^$]|\\d/.test(FRAGMENTS[id]))
  assert.ok(withOps.length <= 5,
    `${withOps.length} fragments need an operator: ` +
    withOps.map(id => FRAGMENTS[id]).join(' '))
  const bridged = ids.filter(id => FRAGMENTS[id].includes('\\d+'))
  assert.equal(bridged.length, 1, bridged.map(id => FRAGMENTS[id]).join(' '))
})

test('a text with nothing to separate it returns null rather than a guess', () => {
  assert.equal(fragmentFor('Area contains an additional Abyss',
    ['Area contains an additional Abyss']), null)
})

// The two selection modes ARE the stash syntax. Terms separated by spaces must
// all match; `|` inside one term is a choice. Match any is one term holding an
// alternation, with no group around it — the quotes already bound the term.
test('match any is one term, match all is one term each', () => {
  const fragments = { A: 'go', B: 'wh' }
  assert.equal(tabletRegex({ statIds: ['A', 'B'], fragments, mode: 'any' }).regex,
    '"go|wh"')
  assert.equal(tabletRegex({ statIds: ['A', 'B'], fragments, mode: 'all' }).regex,
    '"go" "wh"')
})

test('one modifier is one plain term in either mode', () => {
  const fragments = { A: 'go' }
  assert.equal(tabletRegex({ statIds: ['A'], fragments, mode: 'any' }).regex, '"go"')
  assert.equal(tabletRegex({ statIds: ['A'], fragments, mode: 'all' }).regex, '"go"')
})

// The search says nothing about the tablet type or its rarity. You are looking
// at one type's modifier list and its fragments are already particular to it.
test('nothing but the modifiers reaches the search', () => {
  const out = tabletRegex({ statIds: ['A'], fragments: { A: 'go' } })
  assert.equal(out.regex, '"go"')
})

test('no modifier chosen is an empty search', () => {
  assert.equal(tabletRegex({ statIds: [], fragments: { A: 'go' } }).regex, '')
  assert.equal(tabletRegex({}).regex, '')
})

// A modifier we cannot express is a fact the reader needs. A search that
// quietly means less than it looks like is the worst outcome on this page.
test('a modifier with no fragment is reported, never silently dropped', () => {
  const out = tabletRegex({ statIds: ['A', 'B'], fragments: { A: 'go' } })
  assert.deepEqual(out.unkeyed, ['B'])
  assert.equal(out.regex, '"go"')
})

test('every modifier unkeyed leaves an empty search and says so', () => {
  const out = tabletRegex({ statIds: ['A', 'B'], fragments: {} })
  assert.equal(out.regex, '')
  assert.deepEqual(out.unkeyed, ['A', 'B'])
})

// The whole selection has to fit the stash search box. Fragments run 2 to 18
// characters, median 3, which is why this page needs no optimiser and no slider
// to claw space back.
test('thirty modifiers at once still fit the 250-character stash limit', () => {
  const { regex } = tabletRegex({ statIds: ids.slice(0, 30), fragments: FRAGMENTS, mode: 'any' })
  assert.ok(regex.length <= 250, `${regex.length} characters: ${regex}`)
})
