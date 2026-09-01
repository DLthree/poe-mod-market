import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The page is not rendered by any test here, so these guard the one class of
// fault that node cannot see at all: the logic runs, the data is right, and the
// screen still shows the wrong thing.
//
// It has happened once. `card.hidden = true` ran on every normal tablet, and
// the card stayed on screen, because `.card` sets display:flex and ANY author
// rule that sets display beats the browser's own `[hidden] { display: none }` —
// an author sheet wins over the user-agent sheet whatever the specificity.
const read = (name) => readFileSync(new URL(`../web/${name}`, import.meta.url), 'utf8')

test('the page hides things with the hidden property', () => {
  // If this ever stops being true, the rule below is guarding nothing and the
  // test that follows would pass while meaning nothing.
  assert.match(read('app.js'), /\.hidden = true/)
})

test('the stylesheet makes [hidden] win over any display rule', () => {
  const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = css.match(/\[hidden\]\s*\{[^}]*\}/)
  assert.ok(rule, 'style.css must carry a [hidden] rule')
  assert.match(rule[0], /display:\s*none\s*!important/,
    'without !important an author display rule keeps a hidden element on screen')
})
