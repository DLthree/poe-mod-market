// `cli.mjs update` exists because getting a refresh wrong was easy:
// `steps/collect.mjs --only pools` reads as "every pool" and silently means "the
// one-type test set", because --full is what widens the scope. These tests pin
// the two properties that make one command safe - it covers everything, and it
// stops rather than leaving half-updated data behind.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../lib/db.mjs'
import { recordRequest } from '../lib/archive.mjs'
import { dbPath, cacheDir, modTablePath } from '../lib/paths.mjs'
import { sampleListing } from './helpers.mjs'
import { ITEM_KINDS } from '../lib/item-kinds.mjs'

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
    assert.equal(existsSync(modTablePath(LEAGUE, 'tablet', dir)), false, 'no table before')
    const out = run(dir, ['--offline'])
    assert.equal(existsSync(modTablePath(LEAGUE, 'tablet', dir)), true, 'table written')
    const db = openDb(dbPath(LEAGUE, dir))
    assert.equal(db.prepare('SELECT count(*) n FROM listing').get().n, 20)
    db.close()
    assert.match(out, /replay the archive/)
    assert.match(out, /rebuild the tablet modifier table/)
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
    assert.equal(existsSync(modTablePath(LEAGUE, 'tablet', dir)), false,
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

// The threshold reaches the collector or the pass is a full one wearing a quick
// one's name, and the difference is about ninety minutes of rate allowance.
test('a quick refresh passes the configured ratio down to the collector', () => {
  const dir = seeded()
  try {
    const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)))
    const out = run(dir, ['--dry-run', '--quick'])
    assert.match(out, new RegExp(`--min-ratio ${config.quick.minRatio}`))
    assert.match(out, /collect\.mjs/)
    assert.doesNotMatch(run(dir, ['--dry-run']), /--min-ratio/,
      'a normal update must not narrow itself')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Both of these mean a different collection or none, so silently preferring one
// would spend the wrong hour.
test('a quick refresh refuses to combine with pools-only or offline', () => {
  const dir = seeded()
  try {
    for (const other of ['--pools-only', '--offline']) {
      assert.throws(() => run(dir, ['--dry-run', '--quick', other]), /status 2|Command failed/)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// The front door has to reach both markets or it is the front door to one of
// them. Every assertion here runs through --dry-run, so nothing collects.
test('update collects the kind it is asked for, and tablet when it is not', () => {
  const dir = seeded()
  try {
    assert.match(run(dir, ['--dry-run']), /--kind tablet/,
      'the default has to be explicit in the plan, not implied by its absence')
    assert.match(run(dir, ['--dry-run', '--kind', 'jewel']), /--kind jewel/)
    assert.match(run(dir, ['--dry-run', '--kind', 'jewel']), /every jewel cell/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Refused before a plan is printed, so nothing ever reads "collect every
// tablets cell" and then does something else.
test('update refuses an unknown kind and names the ones that exist', () => {
  const dir = seeded()
  try {
    let out = ''
    assert.throws(() => run(dir, ['--dry-run', '--kind', 'tablets']), (e) => {
      out = String(e.stderr || '') + String(e.stdout || '')
      return true
    })
    assert.match(out, /Unknown item kind "tablets"/)
    assert.match(out, /tablet, jewel/)
    assert.doesNotMatch(out, /collect every/, 'no plan may be printed for a kind that failed')
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
    assert.equal(existsSync(modTablePath(LEAGUE, 'tablet', dir)), false, 'no table written')
    const db = openDb(dbPath(LEAGUE, dir))
    assert.equal(db.prepare('SELECT count(*) n FROM request').get().n, before)
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// NEVER import steps/collect.mjs to check it loads: it runs on import and
// starts a real collection. These spawn it with arguments it must refuse, so
// the process exits before it ever constructs a client.
const collect = (args) => spawnSync('node',
  [join(process.cwd(), 'steps', 'collect.mjs'), ...args], { encoding: 'utf8' })

test('an unknown kind is refused before anything is searched', () => {
  const r = collect(['--kind', 'tablets'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /Unknown item kind "tablets"/)
  assert.match(r.stderr, /tablet, jewel/)
  assert.match(r.stderr, /Nothing has run/)
})

// The type list is the KIND's, so a tablet name under --kind jewel is a mistake
// worth catching before it spends a search on a market that cannot answer.
test('a type belonging to another kind is refused', () => {
  const r = collect(['--kind', 'jewel', '--full', '--i-mean-it', '--types', 'Breach Tablet'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /Unknown jewel type "Breach Tablet"/)
  assert.match(r.stderr, /Emerald, Ruby, Sapphire/)
})

// A kind with no test set cannot run the cheap default, and steps/collect.mjs
// refuses rather than falling through to a full pass. That refusal cannot be
// provoked from the real config any more, because every kind now has a set —
// which is the property actually worth holding, and it is checkable without
// spawning anything or spending a search.
test('every registered kind has a usable test set', () => {
  const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'))
  for (const [key, kind] of Object.entries(ITEM_KINDS)) {
    const set = config.testSet?.[key]
    assert.ok(set, `config.json has no testSet.${key}, so that kind has no cheap run`)
    assert.ok(set.affixes?.length, `testSet.${key} names no modifier`)
    for (const t of set.types) {
      assert.ok(kind.types.includes(t), `testSet.${key} names ${t}, which is not a ${key}`)
    }
    for (const r of set.rarities) {
      assert.ok(kind.rarities.includes(r),
        `testSet.${key} names rarity ${r}, which ${key} does not trade`)
    }
  }
})
