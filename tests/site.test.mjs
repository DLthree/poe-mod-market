import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, existsSync, copyFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../lib/db.mjs'
import { cacheDir } from '../lib/paths.mjs'
import { slug, PATHS, leaguesFile, renderKindPage, renderIndex } from '../lib/site.mjs'
import { ITEM_KINDS, KIND_KEYS } from '../lib/item-kinds.mjs'
import { bandOf } from '../lib/bands.mjs'
import { buildSite } from '../steps/build-site.mjs'
import { seedCell } from './helpers.mjs'

const config = {
  lookbackHours: 48,
  tradeWindow: '3days',
  floor: { strategy: 'nth-cheapest', n: 3 },
  walk: { minListings: 3, minSellers: 2, minLift: 2, minAdds: 0, midVsBlank: 1.5, highVsBlank: 2.1 },
  exchange: { exalted: 1, divine: 100, chaos: 5 }
}

// A league name is put into a file name AND into a URL. Both have to survive it.
test('a league name becomes a safe file name', () => {
  assert.equal(slug('Runes of Aldur'), 'runes-of-aldur')
  assert.equal(slug('Hardcore SSF: Whatever'), 'hardcore-ssf-whatever')
  assert.equal(slug('Standard'), 'standard')
})

test('the league index names a default the list actually holds', () => {
  const held = [{ league: 'New', kinds: ['tablet'] }, { league: 'Old', kinds: [] }]
  assert.deepEqual(leaguesFile(held, 'New'), {
    leagues: ['New', 'Old'],
    default: 'New',
    // One file boots every page, so each page needs to know which leagues have
    // anything for IT. A page whose list is empty says so rather than fetching
    // a file that was never written.
    kinds: { tablet: ['New'], jewel: [] }
  })
  // The league a server was started with, before its first sweep, is still
  // offerable and still the default. It holds nothing for any kind yet.
  assert.deepEqual(leaguesFile(held, 'Fresh'), {
    leagues: ['Fresh', 'New', 'Old'],
    default: 'Fresh',
    kinds: { tablet: ['New'], jewel: [] }
  })
  assert.deepEqual(leaguesFile([], null),
    { leagues: [], default: null, kinds: { tablet: [], jewel: [] } })
})

// Both kinds take the suffix. A special case for tablets would be one more
// rule to remember, and nothing is gained: the page, its modules and its data
// are rebuilt and committed together.
test('the built site names the kind in every per-league data file', () => {
  assert.equal(PATHS.economy('Runes of Aldur', 'tablet'), 'data/eco-runes-of-aldur-tablet.json')
  assert.equal(PATHS.fragments('Runes of Aldur', 'jewel'),
    'data/fragments-runes-of-aldur-jewel.json')
})

// buildSite reads the stats cache the same way the server does, so a tmp data
// directory needs a copy of the real one.
const seedStatsCache = (dataDir, t) => {
  const real = join(cacheDir(), 'stats-poe2.json')
  if (!existsSync(real)) {
    t.skip(`no stats-poe2.json in ${cacheDir()} — run a collection first`)
    return false
  }
  mkdirSync(join(dataDir, 'cache'), { recursive: true })
  copyFileSync(real, join(dataDir, 'cache', 'stats-poe2.json'))
  return true
}

const withBuild = async (t, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'tablet-site-'))
  try {
    if (!seedStatsCache(dir, t)) return
    const db = openDb(join(dir, 'L.db'))
    seedCell(db, {
      league: 'L',
      rows: [
        { amount: 3, account: 'a', mods: ['JUNK'] },
        { amount: 4, account: 'b', mods: ['JUNK'] },
        { amount: 5, account: 'c', mods: ['JUNK'] },
        { amount: 40, account: 'd', mods: ['GOOD'] },
        { amount: 45, account: 'e', mods: ['GOOD'] },
        { amount: 50, account: 'f', mods: ['GOOD'] }
      ]
    })
    db.close()
    const out = join(dir, 'site')
    // The fixture snapshot is stamped 2026-08-29, so `now` has to be pinned
    // beside it or the 48-hour lookback puts it out of reach and the built
    // economy file comes back empty.
    const written = buildSite({
      outDir: out, config, dataOverride: dir, now: Date.parse('2026-08-29T13:00:00Z')
    })
    await fn({ out, written, dir })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ONE PAGE, ONE TEMPLATE. web/index.html and web/jewels.html were two 59-line
// files differing in five lines, every one of them derivable from the kind. A
// third kind meant a third copy, and a fix to one page silently missed the other.
test('every kind renders its own page from the one template', () => {
  for (const kind of Object.values(ITEM_KINDS)) {
    const html = renderKindPage(kind)
    assert.match(html, new RegExp(`<body[^>]*data-kind="${kind.key}"`), kind.key)
    assert.match(html, new RegExp(`<title>${kind.title}</title>`), kind.key)
    assert.match(html, /<script type="module" src="\.\/app\.js">/, kind.key)
    assert.match(html, /href="\.\/style\.css"/, kind.key)
  }
})

// Each page has to be reachable from the others, or a kind is published and
// never found. With two kinds that is one link each; the template does not care
// how many there are.
test('a kind page links to every other kind and not to itself', () => {
  for (const kind of Object.values(ITEM_KINDS)) {
    const html = renderKindPage(kind)
    assert.doesNotMatch(html, new RegExp(`href="\\./${kind.page}"`),
      `${kind.key} links to itself`)
    for (const other of Object.values(ITEM_KINDS)) {
      if (other.key === kind.key) continue
      assert.match(html, new RegExp(`href="\\./${other.page}"`),
        `${kind.key} does not link to ${other.key}`)
    }
  }
})

// No kind's page may name another kind ANYWHERE except its sibling link. That was
// the whole failure mode of two hand-kept copies: "pick a tablet type below" sat
// on the jewel page for as long as somebody forgot to change it.
test('a kind page names no other kind outside its sibling link', () => {
  for (const kind of Object.values(ITEM_KINDS)) {
    const body = renderKindPage(kind).replace(/<a class="sibling"[\s\S]*?<\/a>/g, '')
    for (const other of Object.values(ITEM_KINDS)) {
      if (other.key === kind.key) continue
      assert.doesNotMatch(body, new RegExp(other.label, 'i'),
        `the ${kind.key} page says "${other.label}"`)
      assert.doesNotMatch(body, new RegExp(other.page.replace('.', '\\.')),
        `the ${kind.key} page links to ${other.page}`)
    }
  }
})

// The root has to keep working: it is the published URL. It sends the reader to
// the first kind in the registry rather than being a third copy of a page.
test('the root points at the first kind and nowhere else', () => {
  const html = renderIndex()
  const first = ITEM_KINDS[KIND_KEYS[0]]
  assert.match(html, new RegExp(`\\./${first.page}`))
  assert.match(html, /http-equiv="refresh"/, 'a reader with no JavaScript must still arrive')
})

// THE RULE THIS FILE EXISTS FOR. GitHub Pages serves files, so every path the
// page asks for has to be one. If a name here drifts from web/app.js, the
// published page 404s while the local server still works.
test('the build writes every file the page asks for', (t) => withBuild(t, ({ out }) => {
  const pages = Object.values(ITEM_KINDS).map(k => k.page)
  for (const f of ['index.html', ...pages, 'app.js', 'style.css', '.nojekyll',
                   'lib/regex-keys.mjs', 'lib/poe2.mjs', 'lib/trade-url.mjs', 'lib/bands.mjs',
                   PATHS.leagues, PATHS.economy('L', 'tablet'), PATHS.fragments('L', 'tablet')]) {
    assert.ok(existsSync(join(out, f)), `missing ${f}`)
  }
}))

// The template is an input to the build, not an output. Publishing it would put
// an unrendered page with {{tokens}} in it on the site.
test('the template itself is not published', (t) => withBuild(t, ({ out }) => {
  assert.equal(existsSync(join(out, 'page.html')), false)
  for (const page of Object.values(ITEM_KINDS).map(k => k.page)) {
    assert.doesNotMatch(readFileSync(join(out, page), 'utf8'), /\{\{/, `${page} has an unfilled token`)
  }
}))

test('the built page fetches nothing the build did not write', (t) => withBuild(t, ({ out }) => {
  const app = readFileSync(join(out, 'app.js'), 'utf8')
  const html = readFileSync(join(out, 'index.html'), 'utf8')
  // Every relative asset the page names, resolved against the site root.
  const named = [
    ...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g),
    ...app.matchAll(/from '\.\/([^']+)'/g)
  ].map(m => m[1])
  assert.ok(named.length >= 4, `found only ${named.length} references`)
  for (const path of named) assert.ok(existsSync(join(out, path)), `page asks for ${path}`)
}))

// An absolute path works on a server rooted at / and breaks on a project page
// served from /<repo>/. This is the one mistake that cannot be caught locally.
test('nothing in the page is rooted at /', (t) => withBuild(t, ({ out }) => {
  const app = readFileSync(join(out, 'app.js'), 'utf8')
  const html = readFileSync(join(out, 'index.html'), 'utf8')
  assert.equal(html.match(/(?:src|href)="\/[^/]/g), null, 'index.html has a rooted path')
  assert.equal(app.match(/from '\/[^/]/g), null, 'app.js imports from a rooted path')
  assert.equal(app.match(/fetch\('\//g), null, 'app.js fetches a rooted path')
}))

test('the server is not part of the static site', (t) => withBuild(t, ({ out }) => {
  assert.equal(existsSync(join(out, 'serve.mjs')), false)
}))

test('the built economy file carries the bands the page paints', (t) =>
  withBuild(t, ({ out }) => {
    const eco = JSON.parse(readFileSync(join(out, PATHS.economy('L', 'tablet')), 'utf8'))
    assert.equal(eco.league, 'L')
    const good = eco.mods.find(m => m.statId === 'GOOD')
    assert.equal(bandOf(good, eco.walk), 'high', '50 against a blank tablet at 5')
    const frags = JSON.parse(readFileSync(join(out, PATHS.fragments('L', 'tablet')), 'utf8'))
    assert.ok(Object.keys(frags).length > 0, 'a fragment per modifier')
  }))

test('building with no league held says so rather than writing an empty site', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tablet-site-'))
  try {
    assert.throws(() => buildSite({ outDir: join(dir, 'site'), config, dataOverride: dir }),
      /nothing to publish/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
