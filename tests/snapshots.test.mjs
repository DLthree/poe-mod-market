import { test } from 'node:test'
import assert from 'node:assert/strict'
import { latestSnapshot, listSnapshots } from '../lib/snapshots.mjs'
import { withDb } from './helpers.mjs'

// Seeds one answered question straight into the derived tables, so these tests
// exercise the reader rather than the collector.
function seed (db, { league = 'L', type = 'Breach Tablet', rarity = 'Rare', statId = null,
                     takenAt = '2026-08-31T06:00:00Z', rows = [] }) {
  const snap = Number(db.prepare(
    'INSERT INTO snapshot (league,type,rarity,stat_id,taken_at) VALUES (?,?,?,?,?)')
    .run(league, type, rarity, statId, takenAt).lastInsertRowid)
  const req = Number(db.prepare(
    `INSERT INTO request (at,league,kind,method,url,status,response_body)
     VALUES (?,?,'fetch','GET','u',200,X'00')`).run(takenAt, league).lastInsertRowid)
  for (const [i, r] of rows.entries()) {
    db.prepare(`INSERT INTO listing
      (request_id,listing_id,indexed,account,price_amount,price_currency,type,rarity,
       "rank",open_prefix,open_suffix,snapshot_id)
      VALUES (?,?,?,?,?,?,?,?,?,0,0,?)`).run(
      req, `s${snap}-l${i}`, r.indexed || '2026-08-31T05:00:00Z', r.account ?? `acc${i}`,
      r.amount, r.currency || 'exalted', type, rarity, r.rank === undefined ? i : r.rank, snap)
    for (const h of (r.mods || [])) {
      db.prepare(`INSERT INTO listing_mod
        (request_id,listing_id,hash,roll,affix,roll_min,roll_max) VALUES (?,?,?,1,?,1,3)`)
        .run(req, `s${snap}-l${i}`, h, h)
    }
  }
  return snap
}

const question = { league: 'L', type: 'Breach Tablet', rarity: 'Rare' }

// Inside one snapshot, rank order IS price order: the search was sorted by
// price and GGG ranked the currencies against each other itself. The reader
// must hand the rows over in that order and not re-sort them.
test('the rows of a snapshot come back in rank order', () => withDb(db => {
  seed(db, { rows: [
    { amount: 50, rank: 2 }, { amount: 1, rank: 0 }, { amount: 39, rank: 1 }
  ] })
  const snap = latestSnapshot(db, question)
  assert.deepEqual(snap.rows.map(r => r.amount), [1, 39, 50])
}))

// A row replayed from the archive has no rank. It is still a real listing, but
// the server's ordering of it was not recoverable, so it goes last rather than
// in front of rows whose position GGG actually gave us.
test('a row with no rank sorts after the ranked rows', () => withDb(db => {
  seed(db, { rows: [{ amount: 40, rank: 0 }, { amount: 2, rank: null }] })
  assert.deepEqual(latestSnapshot(db, question).rows.map(r => r.amount), [40, 2])
}))

test('the newest snapshot of a question wins', () => withDb(db => {
  seed(db, { takenAt: '2026-08-30T06:00:00Z', rows: [{ amount: 1 }] })
  seed(db, { takenAt: '2026-08-31T06:00:00Z', rows: [{ amount: 50 }, { amount: 60 }] })
  const snap = latestSnapshot(db, question)
  assert.equal(snap.takenAt, '2026-08-31T06:00:00Z')
  assert.deepEqual(snap.rows.map(r => r.amount), [50, 60])
}))

test('a question nobody has asked returns null', () => withDb(db => {
  seed(db, { rows: [{ amount: 1 }] })
  assert.equal(latestSnapshot(db, { ...question, type: 'Ritual Tablet' }), null)
  assert.equal(latestSnapshot(db, { ...question, rarity: 'Magic' }), null)
  assert.equal(latestSnapshot(db, { ...question, statId: 'explicit.stat_1' }), null)
}))

// The baseline question stores null in stat_id, and null never equals anything
// in SQL. Reading it with `=` would return nothing at all.
test('the baseline question and a modifier question are different questions',
  () => withDb(db => {
    seed(db, { rows: [{ amount: 9 }] })
    seed(db, { statId: 'explicit.stat_1', rows: [{ amount: 140 }] })
    assert.deepEqual(latestSnapshot(db, question).rows.map(r => r.amount), [9])
    assert.deepEqual(
      latestSnapshot(db, { ...question, statId: 'explicit.stat_1' }).rows.map(r => r.amount),
      [140])
  }))

// Phase 1 discards the snapshot of any question it failed to answer, so an
// empty one can only mean the market held nothing for that question. That is
// an answer, and it must not read as "never asked".
test('an empty snapshot is an answer, not an absence', () => withDb(db => {
  seed(db, { rows: [] })
  const snap = latestSnapshot(db, question)
  assert.notEqual(snap, null)
  assert.deepEqual(snap.rows, [])
}))

test('each row carries its modifiers', () => withDb(db => {
  seed(db, { rows: [{ amount: 5, mods: ['explicit.stat_1', 'explicit.stat_2'] }] })
  const [row] = latestSnapshot(db, question).rows
  assert.deepEqual(row.mods.map(m => m.hash), ['explicit.stat_1', 'explicit.stat_2'])
  assert.equal(row.mods[0].rollMin, 1)
  assert.equal(row.mods[0].rollMax, 3)
}))

test('a row keeps the fields every floor rule reads', () => withDb(db => {
  seed(db, { rows: [{ amount: 5, currency: 'divine', account: 'Someone#1' }] })
  const [row] = latestSnapshot(db, question).rows
  assert.equal(row.amount, 5)
  assert.equal(row.currency, 'divine')
  assert.equal(row.account, 'Someone#1')
  assert.equal(row.type, 'Breach Tablet')
  assert.equal(row.rarity, 'Rare')
  assert.ok(row.indexed)
}))

test('listSnapshots reports every question and how deep its answer was',
  () => withDb(db => {
    seed(db, { takenAt: '2026-08-31T06:00:00Z', rows: [{ amount: 1 }, { amount: 2 }] })
    seed(db, { takenAt: '2026-08-31T07:00:00Z', statId: 'explicit.stat_1', rows: [] })
    const all = listSnapshots(db, { league: 'L' })
    assert.deepEqual(all.map(s => [s.statId, s.depth]),
      [['explicit.stat_1', 0], [null, 2]])
  }))

test('listSnapshots holds one league only', () => withDb(db => {
  seed(db, { rows: [{ amount: 1 }] })
  seed(db, { league: 'Other', rows: [{ amount: 1 }] })
  assert.equal(listSnapshots(db, { league: 'L' }).length, 1)
}))
