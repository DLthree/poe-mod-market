// PHASE 2. Writes the whole site to a directory as plain files. No network call.
//
// This is the step that makes GitHub Pages possible: Pages serves files, so
// every URL the page asks for has to BE a file. The names come from
// lib/site.mjs, which is also what web/serve.mjs answers, so the built site and
// the local server are the same site rather than two that resemble each other.
//
// The database is not in the repo and cannot be, so this cannot run in CI. It
// runs here, after a sweep, and the built directory is committed. That is the
// whole deployment: no build server, no secret, nothing that can call GGG.
import { mkdirSync, writeFileSync, copyFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../lib/db.mjs'
import { dbPath, cacheDir } from '../lib/paths.mjs'
import { listLeagues } from '../lib/leagues.mjs'
import { buildIndex, textFor, vendoredEe2 } from '../lib/stat-index.mjs'
import { PATHS, leaguesFile, leagueFiles } from '../lib/site.mjs'
import { validateTradeWindow } from '../lib/poe2.mjs'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))

const USAGE = `Write the static site: the page, its modules and one JSON file per league.

  node cli.mjs build                 into site/
  node cli.mjs build --out <dir>
  node cli.mjs build --league <name> only this league (default: every league held)

  --data <dir>      override the data directory

No network call. The data comes from the archive a sweep already collected.`

// The page loads these three from /lib/ and nothing else from it. A whitelist
// rather than a copy of the directory: everything else in lib/ reads a database
// and has no business in a browser.
const BROWSER_MODULES = ['regex-keys.mjs', 'poe2.mjs', 'trade-url.mjs']

const write = (dir, path, body) => {
  const full = join(dir, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, body)
  return { path, bytes: Buffer.byteLength(body) }
}

/**
 * Builds the site into `outDir`.
 * @param {object} opts
 * @param {string[]|null} opts.leagues - Leagues to write, or null for all held.
 * @returns {{path: string, bytes: number}[]} Every file written.
 */
export function buildSite ({ outDir, config, dataOverride = null, leagues = null,
                             now = Date.now() }) {
  const held = listLeagues(dataOverride)
  const names = leagues ?? held.map(l => l.league)
  if (!names.length) {
    throw new Error(
      'No league holds a snapshot, so there is nothing to publish. ' +
      'Run `node cli.mjs update` first.')
  }

  const index = buildIndex(
    JSON.parse(readFileSync(join(cacheDir(dataOverride), 'stats-poe2.json'))), vendoredEe2())
  const text = (hash) => textFor(index, hash)
  const written = []

  // The page itself, then the three modules it imports, both copied verbatim.
  // Nothing is bundled or minified: the file the tests exercise is the file the
  // browser runs, and a build that rewrites it would break that.
  for (const f of readdirSync(here('../web'))) {
    if (f === 'serve.mjs') continue // the server is not part of the static site
    written.push(write(outDir, f, readFileSync(here(`../web/${f}`))))
  }
  for (const m of BROWSER_MODULES) {
    written.push(write(outDir, `lib/${m}`, readFileSync(here(`../lib/${m}`))))
  }

  written.push(write(outDir, PATHS.leagues,
    JSON.stringify(leaguesFile(held.filter(l => names.includes(l.league)), names[0]), null, 1)))

  for (const league of names) {
    const db = openDb(dbPath(league, dataOverride))
    try {
      const built = leagueFiles(db,
        { league, lookbackHours: config.lookbackHours, config, textFor: text, now })
      written.push(write(outDir, PATHS.economy(league), JSON.stringify(built.economy, null, 1)))
      written.push(write(outDir, PATHS.fragments(league), JSON.stringify(built.fragments, null, 1)))
    } finally {
      db.close()
    }
  }

  // Pages runs the contents of the directory through Jekyll unless told not to,
  // and Jekyll hides any file or directory whose name begins with an underscore.
  // Nothing here starts with one today; this is so nothing has to remember.
  written.push(write(outDir, '.nojekyll', ''))
  return written
}

export function runBuild (argv) {
  if (argv.includes('--help')) {
    console.log(USAGE)
    return undefined
  }
  const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1] }
  const config = JSON.parse(readFileSync(here('../config.json'), 'utf8'))
  validateTradeWindow(config.tradeWindow)

  const dataOverride = flag('data', null)
  const outDir = flag('out', here('../site'))
  const one = flag('league', null)
  const written = buildSite({
    outDir, config, dataOverride, leagues: one ? [one] : null
  })

  console.log(`built ${written.length} files into ${outDir}`)
  for (const w of written.filter(w => w.path.startsWith('data/'))) {
    console.log(`  ${w.path.padEnd(38)} ${(w.bytes / 1024).toFixed(1)} KB`)
  }
  return written
}
