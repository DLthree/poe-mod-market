// A local, read-only web view of the tablet database.
//
// THIS SERVER NEVER CALLS GGG. It opens the SQLite file, answers from it, and
// serves four static files. steps/collect.mjs holds the session and runs separately.
// That is what keeps the POESESSID out of the browser and means a future
// visitor cannot spend the rate-limit allowance.
//
// Not an entry point: cli.mjs's `serve` subcommand calls runServe() in
// process. There is no anti-drift argument for a read-only server the way
// there is for the sweep steps, so folding it in is simplest.
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { readFileSync, existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../lib/db.mjs'
import { buildIndex, textFor, vendoredEe2 } from '../lib/stat-index.mjs'
import { dbPath, cacheDir } from '../lib/paths.mjs'
import { listLeagues } from '../lib/leagues.mjs'
import { meta, mods, price } from '../lib/api.mjs'
import { buildFragments } from '../lib/regex-keys.mjs'
import { economyFile, economyPath } from '../lib/economy.mjs'
import { PATHS, leaguesFile, leagueFiles } from '../lib/site.mjs'
import { validateTradeWindow } from '../lib/poe2.mjs'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))

const USAGE = `Serve the read-only web view and economy file.

  node cli.mjs serve                 loopback only, port 8787
  node cli.mjs serve --host 0.0.0.0  reachable from the network
  node cli.mjs serve --port <n>

  --league <name>   the league the page opens with; default from config.json.
                    Every other league in the data directory is offered too.
  --data <dir>      override the data directory`

const lanAddresses = () =>
  Object.values(networkInterfaces()).flat()
    .filter(n => n && n.family === 'IPv4' && !n.internal)
    .map(n => n.address)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
}

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, {
    'Content-Type': type,
    // Local tool, and the data is public market information either way.
    'Access-Control-Allow-Origin': '*'
  })
  res.end(body)
}

const json = (res, obj) => send(res, 200, JSON.stringify(obj, null, 1))

// A league is a file name. `?league=` therefore decides which file this server
// opens, so it is answered from a list of leagues we found ourselves and never
// from the string as given: a name off that list is a 404 rather than a path.
//
// The databases are opened when first asked for and then kept. Opening all of
// them at start-up would read files the reader may never look at; re-opening
// one per request would pay for it on every click.
function makeLeagues (dataOverride, startupLeague) {
  const open = new Map()
  return {
    // Re-scanned per call, so a league whose first sweep finished while this
    // server was running appears without a restart. The league the server was
    // started with is always offered, even before that first sweep: --league is
    // what the operator asked for, not something a visitor typed.
    // What the scan found, with its counts. `known` is the same list reduced to
    // names, plus the league this server was started with.
    held () {
      return listLeagues(dataOverride)
    },
    known () {
      const found = this.held().map(l => l.league)
      return found.includes(startupLeague) ? found : [startupLeague, ...found]
    },
    db (name) {
      if (!open.has(name)) open.set(name, openDb(dbPath(name, dataOverride)))
      return open.get(name)
    }
  }
}

function makeHandleApi ({ leagues, config, defaultLeague, text }) {
  return function handleApi (url, res) {
    const q = url.searchParams
    const lookbackHours = Number(q.get('lookback') || config.lookbackHours)
    const type = q.get('type')
    const rarity = q.get('rarity')

    // What the dropdown is built from. Answered before any league is resolved,
    // because this is the request that tells the page which leagues exist.
    if (url.pathname === '/api/leagues') {
      return json(res, { leagues: leagues.known(), default: defaultLeague })
    }

    const league = q.get('league') || defaultLeague
    if (!leagues.known().includes(league)) {
      return send(res, 404, JSON.stringify({ error: `no data for league ${league}` }))
    }
    const db = leagues.db(league)
    const common = { league, lookbackHours, tradeWindow: config.tradeWindow, config }

    if (url.pathname === '/api/meta') {
      return json(res, meta(db, { league, lookbackHours }))
    }

    // One fragment per modifier, each unique against all the others, generated
    // from GGG's own wordings. Sent once and joined in the browser, because a
    // round trip per tick would make the page feel dead.
    if (url.pathname === '/api/fragments') {
      const eco = economyFile(db, { league, lookbackHours, config, textFor: text })
      const texts = {}
      for (const m of eco.mods) texts[m.statId] = text(m.statId)
      return json(res, buildFragments(texts))
    }

    // Every cell endpoint needs both, and guessing a default would quietly
    // answer a different question than the one asked.
    if (!type || !rarity) {
      return send(res, 400, JSON.stringify({ error: 'type and rarity are required' }))
    }

    if (url.pathname === '/api/mods') {
      return json(res, mods(db, { ...common, type, rarity, textFor: text }))
    }
    if (url.pathname === '/api/price') {
      const wanted = (q.get('mods') || '').split(',').map(s => s.trim()).filter(Boolean)
      return json(res, price(db, { ...common, type, rarity, mods: wanted, textFor: text }))
    }
    return send(res, 404, JSON.stringify({ error: 'no such endpoint' }))
  }
}

// The one path poe.re fetches. shared/economy.ts builds it as
// "<category>/eco_<league>_<type>.json" and does not encode the league, so the
// space in a league name arrives percent-encoded and decodeURIComponent undoes
// it. A request for a league this server was not started with is a 404 rather
// than a silent answer about a different market.
function makeHandleEconomy ({ leagues, config, text }) {
  return function handleEconomy (url, res) {
    let path
    try {
      path = decodeURIComponent(url.pathname)
    } catch {
      return false // malformed percent-encoding: fall through to the static 404
    }
    // Any league we hold, not only the one this server was started with: the
    // dropdown asks for the file by name. A league we do not hold falls through
    // to the static 404, which is what a request for another market deserves.
    const league = leagues.known().find(l => path.slice(1) === economyPath(l))
    if (league === undefined) return false
    const lookbackHours = Number(url.searchParams.get('lookback') || config.lookbackHours)
    json(res, economyFile(leagues.db(league), { league, lookbackHours, config, textFor: text }))
    return true
  }
}

// The page imports the same regex module the tests exercise, rather than
// carrying its own copy of the join. Both files are plain constants and pure
// functions with no node-only import, so a browser can load them as they are.
// A whitelist, not a directory: nothing else under lib/ is reachable.
const BROWSER_MODULES = new Set([
  '/lib/regex-keys.mjs', '/lib/poe2.mjs', '/lib/trade-url.mjs'
])

// THE STATIC SURFACE. Exactly the files `steps/build-site.mjs` writes, at
// exactly the paths the page fetches, computed live so a sweep shows up without
// a rebuild. Serving them here is what keeps the local page and the published
// one the same page: if the page can only reach data through these three names,
// it cannot come to depend on a server being there.
function makeHandleSite ({ leagues, config, defaultLeague, text }) {
  return function handleSite (url, res) {
    const path = url.pathname.replace(/^\//, '')
    const known = leagues.known()

    if (path === PATHS.leagues) {
      json(res, leaguesFile(leagues.held(), defaultLeague))
      return true
    }
    for (const league of known) {
      const wantsEconomy = path === PATHS.economy(league)
      if (!wantsEconomy && path !== PATHS.fragments(league)) continue
      const lookbackHours = Number(url.searchParams.get('lookback') || config.lookbackHours)
      const built = leagueFiles(leagues.db(league),
        { league, lookbackHours, config, textFor: text })
      json(res, wantsEconomy ? built.economy : built.fragments)
      return true
    }
    return false
  }
}

function handleModule (url, res) {
  if (!BROWSER_MODULES.has(url.pathname)) return false
  send(res, 200, readFileSync(here('..' + url.pathname)), 'text/javascript; charset=utf-8')
  return true
}

function handleStatic (url, res) {
  const name = url.pathname === '/' ? '/index.html' : url.pathname
  // normalize() collapses "..", so a request cannot climb out of web/.
  const path = join(here('.'), normalize(name))
  if (!path.startsWith(here('.')) || !existsSync(path)) {
    return send(res, 404, 'not found', 'text/plain; charset=utf-8')
  }
  send(res, 200, readFileSync(path), MIME[extname(path)] || 'application/octet-stream')
}

/**
 * Starts the read-only web view. Parses its own flags out of `argv` and never
 * calls GGG.
 * @param {string[]} argv - Flags following the `serve` subcommand.
 * @returns {import('node:http').Server|undefined} The listening server, or
 *   undefined when `--help` was given and nothing was started.
 */
export function runServe (argv) {
  if (argv.includes('--help')) {
    console.log(USAGE)
    return undefined
  }
  const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1] }
  const config = JSON.parse(readFileSync(here('../config.json'), 'utf8'))
  validateTradeWindow(config.tradeWindow)

  const league = flag('league', config.league)
  const port = Number(flag('port', 8787))
  const dataOverride = flag('data', null)
  // Loopback by default. The database is public market data and the server
  // holds no session, but reaching the whole network should still be
  // something you typed on purpose: --host 0.0.0.0.
  const host = flag('host', '127.0.0.1')

  const leagues = makeLeagues(dataOverride, league)
  // The league given on the command line is opened now rather than on the first
  // request, so a data directory this server cannot read fails at start-up
  // instead of inside a fetch the page made.
  leagues.db(league)
  const index = buildIndex(
    JSON.parse(readFileSync(join(cacheDir(dataOverride), 'stats-poe2.json'))), vendoredEe2())
  const text = (hash) => textFor(index, hash)
  const handleApi = makeHandleApi({ leagues, config, defaultLeague: league, text })
  const handleEconomy = makeHandleEconomy({ leagues, config, text })
  const handleSite = makeHandleSite({ leagues, config, defaultLeague: league, text })

  return createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`)
    try {
      if (url.pathname.startsWith('/api/')) handleApi(url, res)
      else if (handleSite(url, res)) { /* served */ }
      else if (handleEconomy(url, res)) { /* served */ }
      else if (handleModule(url, res)) { /* served */ }
      else handleStatic(url, res)
    } catch (e) {
      send(res, 500, JSON.stringify({ error: e.message }))
    }
  }).listen(port, host, function () {
    const bound = this.address().port
    console.log(`tablet-price web  http://localhost:${bound}`)
    if (host !== '127.0.0.1') {
      for (const a of lanAddresses()) console.log(`                  http://${a}:${bound}`)
      console.log(`bound to ${host}: anyone on this network can read this database.`)
    }
    console.log(`league: ${league}   database: ${dbPath(league, dataOverride)}`)
    console.log(`offering: ${leagues.known().join(', ')}`)
    console.log('read-only; this server makes no request to GGG')
  })
}
