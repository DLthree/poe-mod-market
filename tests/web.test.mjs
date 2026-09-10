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

// Two pages, one script. The kind is the only thing that differs, and it
// arrives as a data attribute rather than as a second copy of the logic.
test('every page names its kind, and the script reads it from the page', () => {
  for (const [file, key] of [['index.html', 'tablet'], ['jewels.html', 'jewel']]) {
    assert.match(read(file), new RegExp(`<body[^>]*data-kind="${key}"`), file)
    assert.match(read(file), /<script type="module" src="\.\/app\.js">/, file)
  }
  assert.match(read('app.js'), /document\.body\.dataset\.kind/)
})

// The grid, the headings and the trade link must all come from the kind. A
// literal here is a tablet assumption a jewel page would render in silence.
test('the page holds no tablet literal', () => {
  const code = read('app.js').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(code, /TABLET_TYPES/)
  assert.doesNotMatch(code, /' Tablet'/)
})

// Each page has to be reachable from the other, or the second one is published
// and never found.
test('each page links to its sibling', () => {
  assert.match(read('index.html'), /href="\.\/jewels\.html"/)
  assert.match(read('jewels.html'), /href="\.\/index\.html"/)
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
