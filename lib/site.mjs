// PHASE 2. The three payloads the page reads, and the paths it reads them from.
//
// THE POINT OF THIS FILE: the page must not know whether a server is answering
// it. GitHub Pages serves files and nothing else, so every URL the page fetches
// has to be a relative path that can exist as a file on disk. The dev server
// computes these live at the same paths; `steps/build-site.mjs` writes them out
// as files. One code path in the browser, and a local page that is the same
// page as the published one.
//
// A league name goes into a file name, so it is encoded once, here, and both
// the writer and the server use this function rather than encoding their own.
import { readFileSync } from 'node:fs'
import { economyFile } from './economy.mjs'
import { buildFragments } from './regex-keys.mjs'
import { KIND_KEYS, ITEM_KINDS } from './item-kinds.mjs'

// Percent-encoding is not enough: a league name can hold a space, and a colon
// is legal in a URL but not in a Windows file name. Lower case with dashes is
// stable, readable in a URL bar, and safe on every filesystem.
export const slug = (league) =>
  String(league).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// A league name and a kind key both go into a file name. BOTH kinds take the
// suffix: a special case for tablets would be one more rule to remember, and
// the page, its modules and its data are rebuilt and committed together.
export const PATHS = {
  leagues: 'data/leagues.json',
  economy: (league, kind) => `data/eco-${slug(league)}-${kind}.json`,
  fragments: (league, kind) => `data/fragments-${slug(league)}-${kind}.json`
}

// ONE TEMPLATE, ONE PAGE PER KIND. web/index.html and web/jewels.html were two
// 59-line files differing in five lines, and every one of those five followed
// from the kind. A third kind meant a third copy, and a fix to one page missed
// the other in silence.
//
// The template is read here rather than held as a string, because HTML belongs in
// an .html file where an editor can see it. web/page.html is an INPUT: the build
// must not publish it.
const TEMPLATE = () =>
  readFileSync(new URL('../web/page.html', import.meta.url), 'utf8')

// Files under web/ that are INPUTS, not part of the site. steps/build-site.mjs
// skips them and web/serve.mjs refuses to serve them, from this one list: a
// template served locally but never published is exactly the local-only page
// this repo exists not to have.
export const NOT_PUBLISHED = new Set(['serve.mjs', 'page.html'])

// The arrow points the way the registry is ordered, so with two kinds each page
// reads exactly as the hand-written pair did.
function siblingLinks (kind) {
  const keys = KIND_KEYS
  const here = keys.indexOf(kind.key)
  return keys
    .filter(k => k !== kind.key)
    .map(k => {
      const other = ITEM_KINDS[k]
      const arrow = '<span aria-hidden="true" class="ext">'
      return keys.indexOf(k) < here
        ? `<a class="sibling" href="./${other.page}">${arrow}←</span> ${other.plural}</a>`
        : `<a class="sibling" href="./${other.page}">${other.plural} ${arrow}→</span></a>`
    })
    .join('\n  ')
}

/**
 * The page for one kind, from the one template.
 * @param {object} kind From lib/item-kinds.mjs.
 * @returns {string} Complete HTML, with every token filled.
 */
export function renderKindPage (kind) {
  return TEMPLATE()
    .replace(/\{\{title\}\}/g, kind.title)
    .replace(/\{\{kind\}\}/g, kind.key)
    .replace(/\{\{siblings\}\}/g, siblingLinks(kind))
    .replace(/\{\{prompt\}\}/g, `pick a ${kind.label.toLowerCase()} below`)
}

/**
 * The root. It is the published URL, so it has to keep working, and it sends the
 * reader to the first kind in the registry rather than being a third copy of a
 * page. The meta refresh is what carries a reader with no JavaScript.
 * @returns {string} Complete HTML.
 */
export function renderIndex () {
  const first = ITEM_KINDS[KIND_KEYS[0]]
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=./${first.page}">
<title>${first.title}</title>
<link rel="canonical" href="./${first.page}">
</head>
<body>
<p><a href="./${first.page}">${first.title}</a></p>
</body>
</html>
`
}

/**
 * The league index the page boots from.
 * @param {{league: string, snapshots: number, newestSnapshot: string,
 *          kinds: string[]}[]} held
 * @param {string} fallback - The league to open when nothing else says.
 */
export function leaguesFile (held, fallback) {
  const names = held.map(l => l.league)
  const leagues = names.includes(fallback) ? names : [fallback, ...names].filter(Boolean)
  // One index file boots every page, so it says which leagues each kind has
  // anything for. Without this a page would offer a league that holds only the
  // other kind, and then fetch a file that was never written.
  const kinds = Object.fromEntries(KIND_KEYS.map(key =>
    [key, held.filter(l => (l.kinds || []).includes(key)).map(l => l.league)]))
  return {
    leagues,
    default: leagues.includes(fallback) ? fallback : leagues[0] ?? null,
    kinds
  }
}

/**
 * Both per-league payloads, for one kind, from one database. No network call.
 * @returns {{economy: object, fragments: Record<string, string>}}
 */
export function leagueFiles (db, { league, kind, lookbackHours, config, textFor, now }) {
  const economy = economyFile(db, { league, kind, lookbackHours, config, textFor, now })
  const texts = {}
  for (const m of economy.mods) texts[m.statId] = textFor(m.statId)
  return { economy, fragments: buildFragments(texts) }
}
