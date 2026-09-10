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

// THE PAGE MUST BE THE SAME PAGE, served or published. The dev server
// whitelists the modules a browser may load from lib/, and steps/build-site.mjs
// copies its own list into site/lib/. Two hand-kept lists drift, and they had:
// serve.mjs named three while app.js imported five, so /lib/bands.mjs and
// /lib/exchange.mjs 404ed and the local page could not boot at all. The
// published page worked, which is the exact inversion of the rule.
//
// Neither list is the authority. The page's own import statements are.
const importedModules = () => {
  const src = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
  return new Set([...src.matchAll(/from\s+'\.\/lib\/([\w-]+\.mjs)'/g)].map(m => m[1]))
}

test('the dev server serves every lib module the page imports', () => {
  const src = readFileSync(new URL('../web/serve.mjs', import.meta.url), 'utf8')
  const listed = new Set([...src.matchAll(/'\/lib\/([\w-]+\.mjs)'/g)].map(m => m[1]))
  assert.deepEqual(listed, importedModules(),
    'web/serve.mjs BROWSER_MODULES must equal what web/app.js imports')
})

test('the build copies every lib module the page imports', () => {
  const src = readFileSync(new URL('../steps/build-site.mjs', import.meta.url), 'utf8')
  const block = src.match(/BROWSER_MODULES\s*=\s*\[([\s\S]*?)\]/)
  assert.ok(block, 'steps/build-site.mjs must declare BROWSER_MODULES as an array')
  const listed = new Set([...block[1].matchAll(/'([\w-]+\.mjs)'/g)].map(m => m[1]))
  assert.deepEqual(listed, importedModules(),
    'steps/build-site.mjs BROWSER_MODULES must equal what web/app.js imports')
})
