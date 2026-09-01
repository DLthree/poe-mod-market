// `cli.mjs update` exists because getting a refresh wrong was easy:
// `steps/collect.mjs --only pools` reads as "every pool" and silently means "the
// one-type test set", because --full is what widens the scope. These tests pin
// the two properties that make one command safe - it covers everything, and it
// stops rather than leaving half-updated data behind.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../lib/db.mjs'
import { recordRequest } from '../lib/archive.mjs'
import { dbPath, cacheDir, modTablePath } from '../lib/paths.mjs'
import { sampleListing } from './helpers.mjs'

const LEAGUE = 'RefreshTest'
const stats = JSON.parse(readFileSync(new URL('./fixtures/stats-subset.json', import.meta.url)))
const script = join(process.cwd(), 'cli.mjs')

// An archive with responses but no derived rows, which is what a replay is for.
function seeded () {
  const dir = mkdtempSync(join(tmpdir(), 'refresh-'))
  mkdirSync(cacheDir(dir), { recursive: true })
  writeFileSync(join(cacheDir(dir), 'stats-poe2.json'), JSON.stringify(stats))
  const db = openDb(dbPath(LEAGUE, dir))
  const rows = Array.from({ length: 20 }, (_, i) => sampleListing({
    id: String(i).padStart(64, '0'),
    listing: { account: { name: `S${i}` }, indexed: new Date().toISOString(),
      price: { type: 'b/o', amount: 10 + i, currency: 'exalted' } }
  }))
  recordRequest(db, { at: new Date().toISOString(), league: LEAGUE, kind: 'fetch',
    cell: 'Breach Tablet|rare', method: 'GET', url: 'u', status: 200,
    text: JSON.stringify({ result: rows }), headers: new Headers() })
  db.close()
  return dir
}

const run = (dir, args) => execFileSync('node',
  [script, 'update', '--league', LEAGUE, '--data', dir, ...args], { encoding: 'utf8' })

test('offline refresh replays the archive and rebuilds the table, with no network', () => {
  const dir = seeded()
  try {
    assert.equal(existsSync(modTablePath(LEAGUE, dir)), false, 'no table before')
    const out = run(dir, ['--offline'])
    assert.equal(existsSync(modTablePath(LEAGUE, dir)), true, 'table written')
    const db = openDb(dbPath(LEAGUE, dir))
    assert.equal(db.prepare('SELECT count(*) n FROM listing').get().n, 20)
    db.close()
    assert.match(out, /replay the archive/)
    assert.match(out, /rebuild the modifier table/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('offline refresh makes no request', () => {
  const dir = seeded()
  try {
    const before = (() => {
      const db = openDb(dbPath(LEAGUE, dir))
      const n = db.prepare('SELECT count(*) n FROM request').get().n
      db.close()
      return n
    })()
    run(dir, ['--offline'])
    const db = openDb(dbPath(LEAGUE, dir))
    assert.equal(db.prepare('SELECT count(*) n FROM request').get().n, before,
      'a replay must add no request')
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// The whole point: a step that fails must not let later steps run over
// half-updated data and report success.
test('a failing step stops the run and exits non-zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'refresh-empty-'))
  try {
    mkdirSync(cacheDir(dir), { recursive: true })
    writeFileSync(join(cacheDir(dir), 'stats-poe2.json'), JSON.stringify(stats))
    // Nothing archived, so steps/rederive.mjs refuses and the table must not be built.
    let failed = false
    try { run(dir, ['--offline']) } catch { failed = true }
    assert.equal(failed, true, 'refresh should exit non-zero')
    assert.equal(existsSync(modTablePath(LEAGUE, dir)), false,
      'the table must not be rebuilt after a failed step')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Every test below passes --offline or --dry-run AND --data. Both matter: an
// unrecognised flag used to fall through to a real 30-minute collection against
// the real database, which is how three of these tests once fired three
// concurrent live sweeps. A test must not be able to spend the rate allowance.

test('an unknown flag is refused rather than ignored', () => {
  const dir = seeded()
  try {
    let out = ''
    assert.throws(() => run(dir, ['--offline', '--pools']), (e) => {
      out = String(e.stderr || '') + String(e.stdout || '')
      return true
    })
    assert.match(out, /--pools/, 'the message should name the flag it did not know')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// steps/collect.mjs derives each response as it fetches, WITH the rank the server's
// price ordering gave it. steps/rederive.mjs deletes every derived row and replays,
// and a replay cannot restore rank - the page offset lived in the collector, not
// in the response. So replaying straight after collecting throws away the
// freshest signal there is: lib/floor.mjs prefers rank, and without it a sold
// listing from yesterday competes with a live one on price alone, and wins.
test('a normal refresh collects and rebuilds, and does not replay', () => {
  const dir = seeded()
  try {
    const out = run(dir, ['--dry-run'])
    assert.match(out, /collect\.mjs/)
    assert.match(out, /build-mod-table\.mjs/)
    assert.doesNotMatch(out, /rederive\.mjs/,
      'replaying after a collection would strip the rank it just collected')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('replaying is available on purpose, for after a parser change', () => {
  const dir = seeded()
  try {
    assert.match(run(dir, ['--dry-run', '--replay']), /rederive\.mjs/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a dry run writes nothing and makes no request', () => {
  const dir = seeded()
  try {
    const before = (() => {
      const db = openDb(dbPath(LEAGUE, dir))
      const n = db.prepare('SELECT count(*) n FROM request').get().n
      db.close()
      return n
    })()
    run(dir, ['--dry-run'])
    assert.equal(existsSync(modTablePath(LEAGUE, dir)), false, 'no table written')
    const db = openDb(dbPath(LEAGUE, dir))
    assert.equal(db.prepare('SELECT count(*) n FROM request').get().n, before)
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
