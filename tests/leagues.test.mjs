import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../lib/db.mjs'
import { listLeagues } from '../lib/leagues.mjs'

// A database file per league, named after it. The data directory also collects
// leftovers, so these tests are mostly about what must NOT appear.
const seed = (dir, file, rows) => {
  const db = openDb(join(dir, file))
  for (const [league, takenAt] of rows) {
    db.prepare('INSERT INTO snapshot (league,type,rarity,stat_id,taken_at) VALUES (?,?,?,?,?)')
      .run(league, 'Breach Tablet', 'Rare', null, takenAt)
  }
  db.close()
}

const withDir = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'tablet-leagues-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('a league is listed with its snapshot count and its newest snapshot', () =>
  withDir((dir) => {
    seed(dir, 'Runes of Aldur.db', [
      ['Runes of Aldur', '2026-08-30T10:00:00Z'],
      ['Runes of Aldur', '2026-08-31T23:59:18Z']
    ])
    assert.deepEqual(listLeagues(dir), [
      { league: 'Runes of Aldur', snapshots: 2, newestSnapshot: '2026-08-31T23:59:18Z' }
    ])
  }))

// Runes.db and ServeTest4.db sit beside the real database and are 4 KB each.
// Listing *.db would offer two leagues that can show nothing.
test('a database holding no snapshot is not a league', () =>
  withDir((dir) => {
    seed(dir, 'Real.db', [['Real', '2026-08-31T00:00:00Z']])
    seed(dir, 'ServeTest4.db', [])
    assert.deepEqual(listLeagues(dir).map(l => l.league), ['Real'])
  }))

// The file name is what dbPath() will build again to serve the league, so a
// database whose snapshots name a different league would be opened and then
// answer nothing.
test('snapshots under another name do not count', () =>
  withDir((dir) => {
    seed(dir, 'Renamed.db', [['Standard', '2026-08-31T00:00:00Z']])
    assert.deepEqual(listLeagues(dir), [])
  }))

test('newest first, so the league to default to is the first one', () =>
  withDir((dir) => {
    seed(dir, 'Old.db', [['Old', '2026-07-01T00:00:00Z']])
    seed(dir, 'New.db', [['New', '2026-08-31T00:00:00Z']])
    assert.deepEqual(listLeagues(dir).map(l => l.league), ['New', 'Old'])
  }))

// One unreadable file must not take the whole dropdown with it.
test('a file that is not a database is skipped, not thrown', () =>
  withDir((dir) => {
    seed(dir, 'Real.db', [['Real', '2026-08-31T00:00:00Z']])
    writeFileSync(join(dir, 'broken.db'), 'this is not sqlite')
    writeFileSync(join(dir, 'notes.txt'), 'nor is this')
    assert.deepEqual(listLeagues(dir).map(l => l.league), ['Real'])
  }))

test('an empty data directory lists nothing', () =>
  withDir((dir) => {
    assert.deepEqual(listLeagues(dir), [])
  }))
