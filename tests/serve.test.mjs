import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync, copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cacheDir } from '../lib/paths.mjs'
import { openDb } from '../lib/db.mjs'

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url))

// Reads the port the server prints, so the test never guesses one and two runs
// cannot collide.
// child.kill() is async on Windows; rmSync-ing the tmpdir before the process
// has actually released its SQLite file lock fails with EPERM.
const stopServer = (child) => new Promise((resolve) => {
  child.once('exit', resolve)
  child.kill()
})

const startServer = (dataDir) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath,
    [cli, 'serve', '--league', 'L', '--port', '0', '--data', dataDir],
    { env: { ...process.env, TRADE_RATELIMIT_LEDGER: join(dataDir, 'ledger.json') } })
  let out = ''
  const onData = (b) => {
    out += String(b)
    const m = out.match(/http:\/\/localhost:(\d+)/)
    if (m) { child.stdout.off('data', onData); resolve({ child, port: Number(m[1]) }) }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', (b) => reject(new Error(String(b))))
  setTimeout(() => reject(new Error(`server did not start: ${out}`)), 10000).unref()
})

// serve.mjs reads stats-poe2.json from cacheDir(dataOverride) at module scope,
// so a fresh --data tmpdir needs a copy of the real one or the server throws
// before it ever listens. Locate the real one through the same cacheDir() the
// application uses — not a hardcoded path — and skip cleanly when a machine
// has never run a collection.
const seedStatsCache = (dataDir, t) => {
  const realCache = cacheDir()
  const realStats = join(realCache, 'stats-poe2.json')
  if (!existsSync(realStats)) {
    t.skip(`no stats-poe2.json in ${realCache} — run a collection first`)
    return false
  }
  const dir = join(dataDir, 'cache')
  mkdirSync(dir, { recursive: true })
  copyFileSync(realStats, join(dir, 'stats-poe2.json'))
  return true
}

// A league the server was not started with, holding one snapshot, so it is a
// real entry in the dropdown rather than one of the empty leftovers.
const seedLeague = (dataDir, league) => {
  const db = openDb(join(dataDir, `${league}.db`))
  db.prepare('INSERT INTO snapshot (league,type,rarity,stat_id,taken_at) VALUES (?,?,?,?,?)')
    .run(league, 'Breach Tablet', 'Rare', null, '2026-08-31T00:00:00Z')
  db.close()
}

test('the economy file is served at the path poe.re asks for', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tablet-serve-'))
  if (!seedStatsCache(dir, t)) { rmSync(dir, { recursive: true, force: true }); return }
  const { child, port } = await startServer(dir)
  try {
    const url = `http://127.0.0.1:${port}/${encodeURI('tablet/eco_L_Tablet.json')}`
    const res = await fetch(url)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    const body = await res.json()
    assert.equal(body.league, 'L')
    assert.equal(body.cells.length, 21)
    assert.ok(Array.isArray(body.mods))
  } finally {
    await stopServer(child)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a request for another league is not served', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tablet-serve-'))
  if (!seedStatsCache(dir, t)) { rmSync(dir, { recursive: true, force: true }); return }
  const { child, port } = await startServer(dir)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/tablet/eco_Other_Tablet.json`)
    assert.equal(res.status, 404)
  } finally {
    await stopServer(child)
    rmSync(dir, { recursive: true, force: true })
  }
})

// decodeURIComponent throws URIError on a lone "%", which used to escape
// handleEconomy's try/catch-free path and turn a bad request into a 500.
test('a malformed percent-encoded path is a 404, not a 500', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tablet-serve-'))
  if (!seedStatsCache(dir, t)) { rmSync(dir, { recursive: true, force: true }); return }
  const { child, port } = await startServer(dir)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/%`)
    assert.equal(res.status, 404)
  } finally {
    await stopServer(child)
    rmSync(dir, { recursive: true, force: true })
  }
})

// What the dropdown is built from. "L" is the league the server was started
// with and holds nothing yet; "M" holds a snapshot; "ServeTest4" is the shape
// of the 4 KB leftovers that sit beside the real database.
test('the league list offers what is held, plus the one it was started with', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tablet-serve-'))
  if (!seedStatsCache(dir, t)) { rmSync(dir, { recursive: true, force: true }); return }
  seedLeague(dir, 'M')
  openDb(join(dir, 'ServeTest4.db')).close()
  const { child, port } = await startServer(dir)
  try {
    const body = await fetch(`http://127.0.0.1:${port}/api/leagues`).then(r => r.json())
    assert.equal(body.default, 'L')
    assert.deepEqual([...body.leagues].sort(), ['L', 'M'])
  } finally {
    await stopServer(child)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('another league we hold is served, and answers under its own name', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tablet-serve-'))
  if (!seedStatsCache(dir, t)) { rmSync(dir, { recursive: true, force: true }); return }
  seedLeague(dir, 'M')
  const { child, port } = await startServer(dir)
  try {
    const eco = await fetch(`http://127.0.0.1:${port}/${encodeURI('tablet/eco_M_Tablet.json')}`)
    assert.equal(eco.status, 200)
    assert.equal((await eco.json()).league, 'M')
    const meta = await fetch(`http://127.0.0.1:${port}/api/meta?league=M`)
    assert.equal((await meta.json()).league, 'M')
  } finally {
    await stopServer(child)
    rmSync(dir, { recursive: true, force: true })
  }
})

// `league` decides which FILE is opened, so it is answered from the list of
// leagues we found and never from the string as given.
test('a league name we do not hold opens no file', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tablet-serve-'))
  if (!seedStatsCache(dir, t)) { rmSync(dir, { recursive: true, force: true }); return }
  const { child, port } = await startServer(dir)
  try {
    for (const name of ['Other', '../../elsewhere', 'L/../Other']) {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/meta?league=${encodeURIComponent(name)}`)
      assert.equal(res.status, 404, name)
    }
    assert.equal(existsSync(join(dir, 'Other.db')), false)
  } finally {
    await stopServer(child)
    rmSync(dir, { recursive: true, force: true })
  }
})
