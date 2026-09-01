import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../lib/db.mjs'
import { recordRequest, readResponse, requestsWithoutListings } from '../lib/archive.mjs'
import { withDb } from './helpers.mjs'

const call = (over = {}) => ({
  at: '2026-08-29T12:00:00Z',
  league: 'L',
  kind: 'fetch',
  cell: 'Breach Tablet|rare',
  method: 'GET',
  url: 'https://example/fetch/a',
  requestBody: null,
  status: 200,
  text: JSON.stringify({ result: [{ id: 'abc' }] }),
  headers: new Headers({ 'x-rate-limit-ip': '5:10:60', 'content-type': 'application/json' }),
  ...over
})

test('the three tables and the observation view exist', () => withDb(db => {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
    .all().map(r => r.name)
  for (const t of ['request', 'listing', 'listing_mod', 'snapshot', 'observation']) {
    assert.ok(names.includes(t), `${t} missing from ${names.join(',')}`)
  }
}))

test('opening an existing database again does not wipe it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tablet-'))
  const path = join(dir, 't.db')
  const a = openDb(path)
  recordRequest(a, call())
  a.close()
  const b = openDb(path)
  assert.equal(b.prepare('SELECT count(*) n FROM request').get().n, 1)
  b.close()
  rmSync(dir, { recursive: true, force: true })
})

test('a response comes back identical after storage', () => withDb(db => {
  const id = recordRequest(db, call())
  assert.deepEqual(readResponse(db, id), { result: [{ id: 'abc' }] })
}))

test('the stored body is compressed, not raw text', () => withDb(db => {
  const big = JSON.stringify({ result: Array.from({ length: 200 }, () => ({ id: 'x'.repeat(64) })) })
  const id = recordRequest(db, call({ text: big }))
  const blob = db.prepare('SELECT response_body b FROM request WHERE id=?').get(id).b
  assert.ok(blob.length < big.length / 2, `${blob.length} should be well under ${big.length}`)
}))

test('only the rate-limit headers are kept', () => withDb(db => {
  const id = recordRequest(db, call())
  const kept = JSON.parse(db.prepare('SELECT rate_headers h FROM request WHERE id=?').get(id).h)
  assert.ok('x-rate-limit-ip' in kept)
  assert.ok(!('content-type' in kept))
}))

test('a failed request is archived too, so the failure is not lost', () => withDb(db => {
  const id = recordRequest(db, call({ status: 429, text: '{"error":{"code":8}}' }))
  assert.equal(db.prepare('SELECT status s FROM request WHERE id=?').get(id).s, 429)
  assert.deepEqual(readResponse(db, id), { error: { code: 8 } })
}))

test('the cell label is stored, because it is why the call was made', () => withDb(db => {
  const id = recordRequest(db, call())
  assert.equal(db.prepare('SELECT cell c FROM request WHERE id=?').get(id).c, 'Breach Tablet|rare')
}))

test('a non-JSON body reads back as null rather than throwing', () => withDb(db => {
  const id = recordRequest(db, call({ text: '<html>cloudflare</html>' }))
  assert.equal(readResponse(db, id), null)
}))

test('only successful fetches await derivation', () => withDb(db => {
  const ok = recordRequest(db, call())
  recordRequest(db, call({ status: 429 }))
  recordRequest(db, call({ kind: 'search' }))
  recordRequest(db, call({ league: 'other' }))
  assert.deepEqual(requestsWithoutListings(db, 'L'), [ok])
}))

test('a derived request is not offered for derivation again', () => withDb(db => {
  const id = recordRequest(db, call())
  db.prepare(`INSERT INTO listing
    (request_id,listing_id,indexed,price_amount,price_currency,type,rarity)
    VALUES (?, 'abc', 't', 1, 'divine', 'Breach Tablet', 'Rare')`).run(id)
  assert.deepEqual(requestsWithoutListings(db, 'L'), [])
}))

test('the same listing in two requests is two rows', () => withDb(db => {
  const r1 = recordRequest(db, call())
  const r2 = recordRequest(db, call())
  const l = db.prepare(`INSERT INTO listing
    (request_id,listing_id,indexed,price_amount,price_currency,type,rarity)
    VALUES (?,?, 't', 1, 'divine', 'Breach Tablet', 'Rare')`)
  l.run(r1, 'abc')
  l.run(r2, 'abc')
  assert.equal(db.prepare('SELECT count(*) n FROM listing').get().n, 2)
}))

// The live database was made before snapshot_id existed, and openDb has to add
// the column in place: the archive it would otherwise be rebuilt from lives in
// the same file. Dropping the index first is what a real old database looks
// like — neither the column nor the index over it was ever there.
test('a database made before snapshot_id existed gains it on reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tablet-'))
  const path = join(dir, 't.db')
  const a = openDb(path)
  a.exec('DROP INDEX IF EXISTS listing_snapshot')
  a.exec('ALTER TABLE listing DROP COLUMN snapshot_id')
  recordRequest(a, call())
  a.close()
  const b = openDb(path)
  const cols = b.prepare('PRAGMA table_info(listing)').all().map(c => c.name)
  assert.ok(cols.includes('snapshot_id'), cols.join(','))
  assert.equal(b.prepare('SELECT count(*) n FROM request').get().n, 1)
  b.close()
  rmSync(dir, { recursive: true, force: true })
})
