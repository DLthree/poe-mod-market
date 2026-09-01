import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildIndex } from '../lib/stat-index.mjs'
import { poolQuery, affixQuery, sweepPools, sweepAffixes, affixesFor } from '../lib/sweep.mjs'
import { TABLET_TYPES, USES_IMPLICIT } from '../lib/poe2.mjs'
import { checkAge, medianAgeHours } from '../lib/agecheck.mjs'
import { recordRequest } from '../lib/archive.mjs'
import { withDb, sampleListing } from './helpers.mjs'

const stats = JSON.parse(readFileSync(new URL('./fixtures/stats-subset.json', import.meta.url)))
const index = buildIndex(stats)

function fakeClient () {
  const c = {
    queries: [], sorts: [], archived: 0,
    async search (query, sort) {
      c.queries.push(query); c.sorts.push(sort)
      return { queryId: 'q', ids: ['i1', 'i2', 'i3'], total: 500, url: 'u' }
    },
    async fetchItems (ids) { return ids.map(id => sampleListing({ id: id.padEnd(64, '0') })) }
  }
  return c
}

// The client archives through its onResponse hook. The fake has no hook, so the
// tests wire archiving the same way steps/collect.mjs does, via the db directly.
function archivingClient (db) {
  const c = fakeClient()
  const inner = c.fetchItems
  c.fetchItems = async (ids, qid) => {
    const result = await inner(ids, qid)
    recordRequest(db, {
      at: new Date().toISOString(), league: 'L', kind: 'fetch', cell: null,
      method: 'GET', url: 'u', status: 200,
      text: JSON.stringify({ result }), headers: new Headers()
    })
    return result
  }
  return c
}

test('the pool query asks for securable and pins nothing else', () => {
  const q = poolQuery('Breach Tablet', 'rare')
  assert.equal(q.status.option, 'securable')
  assert.equal(q.filters.type_filters.filters.rarity.option, 'rare')
  assert.deepEqual(q.stats[0].filters, [])
})

// Measured 2026-08-29: filtering to `divine` hid every listing below one divine,
// and thousands sit at exactly 1 divine, so every modifier read the same floor.
// `exalted_divine` keeps the cheap end and lets the SERVER rank the two
// currencies, which is why this skill holds no exchange rate.
test('the pool query asks for exalted_divine, not a single currency', () => {
  const q = poolQuery('Breach Tablet', 'rare')
  assert.equal(q.filters.trade_filters.filters.price.option, 'exalted_divine')
})

test('the pool query does not collapse, so the archive keeps every listing', () => {
  const q = poolQuery('Breach Tablet', 'rare')
  assert.equal(q.filters.trade_filters?.filters?.collapse, undefined)
})

test('the affix query pins the modifier at any roll', () => {
  const q = affixQuery('Breach Tablet', 'explicit.stat_3793155082')
  assert.deepEqual(q.stats[0].filters, [{ id: 'explicit.stat_3793155082' }])
  assert.equal(q.filters.type_filters.filters.rarity.option, 'rare')
})

// A part-used tablet is a different item at a different price and it sits at
// the cheap end, where the floor is read. The count cannot be recovered from
// what GGG sends back — a fetched item reports magnitude 10 whatever it has
// left — so if the search does not ask, we never learn it.
test('every query asks for a full tablet', () => {
  for (const type of TABLET_TYPES) {
    const expected = [{ id: USES_IMPLICIT[type], value: { min: 10 }, disabled: false }]
    assert.deepEqual(poolQuery(type, 'rare').stats[1].filters, expected, type)
    assert.deepEqual(poolQuery(type, 'normal').stats[1].filters, expected, type)
    assert.deepEqual(affixQuery(type, 'explicit.stat_1').stats[1].filters, expected, type)
  }
})

// Group 0 belongs to the modifier search. If the uses filter took that slot,
// affixQuery would overwrite it and quietly collect part-used tablets under a
// question that says it excluded them.
test('the uses filter does not take the slot the modifier search uses', () => {
  const q = affixQuery('Breach Tablet', 'explicit.stat_3793155082')
  assert.deepEqual(q.stats[0].filters, [{ id: 'explicit.stat_3793155082' }])
  assert.equal(q.stats[1].filters[0].id, USES_IMPLICIT['Breach Tablet'])
  assert.equal(q.stats.length, 2)
})

test('a tablet type with no known uses implicit fails loudly', () => {
  assert.throws(() => poolQuery('Expedition Tablet', 'rare'),
    /No uses implicit known for "Expedition Tablet"/)
})

test('every search sorts cheapest first, because the statistic is a floor',
  async () => withDb(async db => {
    const client = archivingClient(db)
    await sweepPools({ client, db, index, league: 'L', types: ['Breach Tablet'],
      rarities: ['rare'], perCell: 3 })
    assert.deepEqual(client.sorts[0], { price: 'asc' })
  }))

test('one search runs per type and rarity', async () => withDb(async db => {
  const client = archivingClient(db)
  const out = await sweepPools({ client, db, index, league: 'L',
    types: ['Breach Tablet', 'Ritual Tablet'], rarities: ['magic', 'rare'], perCell: 3 })
  assert.equal(client.queries.length, 4)
  assert.equal(out.searches, 4)
}))

// Window A, the trade window: how old a listing may be on the market before we
// refuse to collect it. It comes from config, not a hardcoded default — a
// non-default value here (1week) catches a literal '3days' left in the body.
test('the search body carries the trade window, from config not a literal',
  async () => withDb(async db => {
    const client = archivingClient(db)
    await sweepPools({ client, db, index, league: 'L', types: ['Breach Tablet'],
      rarities: ['rare'], perCell: 3, tradeWindow: '1week' })
    assert.equal(client.queries[0].filters.trade_filters.filters.indexed.option, '1week')
  }))

test('the sweep archives and derives in one pass', async () => withDb(async db => {
  const client = archivingClient(db)
  const out = await sweepPools({ client, db, index, league: 'L', types: ['Breach Tablet'],
    rarities: ['rare'], perCell: 3 })
  assert.equal(out.listings, 3)
  assert.equal(db.prepare('SELECT count(*) n FROM listing').get().n, 3)
}))

test('the cell label is reported before each search', async () => withDb(async db => {
  const client = archivingClient(db)
  const seen = []
  await sweepPools({ client, db, index, league: 'L', types: ['Breach Tablet'],
    rarities: ['magic', 'rare'], perCell: 3, onCell: (c) => seen.push(c) })
  assert.deepEqual(seen, ['Breach Tablet|magic', 'Breach Tablet|rare'])
}))

test('the affix vocabulary comes out of what has already been collected',
  async () => withDb(async db => {
    const client = archivingClient(db)
    await sweepPools({ client, db, index, league: 'L', types: ['Breach Tablet'],
      rarities: ['rare'], perCell: 3 })
    assert.deepEqual(affixesFor(db, 'Breach Tablet').sort(),
      ['explicit.stat_3762913035', 'explicit.stat_3793155082'])
  }))

test('an explicit affix list overrides what was collected', async () => withDb(async db => {
  const client = archivingClient(db)
  const seen = []
  await sweepAffixes({ client, db, index, league: 'L', types: ['Breach Tablet'], perCell: 3,
    affixes: ['explicit.stat_9'], onCell: (c) => seen.push(c) })
  assert.deepEqual(seen, ['Breach Tablet|rare|explicit.stat_9'])
}))

test('a cell an order of magnitude older than its peers is reported', () => {
  assert.deepEqual(checkAge([
    { cell: 'a', medianAgeHours: 3 }, { cell: 'b', medianAgeHours: 4 },
    { cell: 'c', medianAgeHours: 5 }, { cell: 'stale', medianAgeHours: 170 }
  ], { factor: 10 }), ['stale'])
})

test('cells that merely differ are all kept', () => {
  assert.deepEqual(checkAge([
    { cell: 'a', medianAgeHours: 1 }, { cell: 'b', medianAgeHours: 6 },
    { cell: 'c', medianAgeHours: 12 }
  ], { factor: 10 }), [])
})

test('fewer than three cells cannot be judged, so none is reported', () => {
  assert.deepEqual(checkAge([
    { cell: 'a', medianAgeHours: 1 }, { cell: 'b', medianAgeHours: 500 }
  ], { factor: 10 }), [])
})

test('the median age of a set of rows is measured in hours', () => {
  const now = Date.parse('2026-08-29T12:00:00Z')
  const rows = [
    { indexed: '2026-08-29T11:00:00Z' },
    { indexed: '2026-08-29T10:00:00Z' },
    { indexed: '2026-08-29T09:00:00Z' }
  ]
  assert.equal(medianAgeHours(rows, now), 2)
})

// --- snapshots ---------------------------------------------------------------
//
// A snapshot is the question one search asked, and the answer GGG gave at that
// one instant. Merging several of them into a pool is what made every published
// price wrong: `rank` numbers each search from zero, so a merge stacks every
// rank-0 row at the front in no price order. See docs/snapshot-pricing.md.

const snapshots = (db) => db.prepare('SELECT * FROM snapshot ORDER BY id').all()

test('a pool sweep opens one snapshot per cell', async () => withDb(async db => {
  const client = archivingClient(db)
  await sweepPools({ client, db, index, league: 'L', types: ['Breach Tablet'],
    rarities: ['magic', 'rare'], perCell: 3 })
  const rows = snapshots(db)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(r => r.rarity), ['Magic', 'Rare'])
  assert.ok(rows.every(r => r.type === 'Breach Tablet' && r.league === 'L'))
}))

test('a baseline snapshot asks about no modifier', async () => withDb(async db => {
  const client = archivingClient(db)
  await sweepPools({ client, db, index, league: 'L', types: ['Breach Tablet'],
    rarities: ['rare'], perCell: 3 })
  assert.equal(snapshots(db)[0].stat_id, null)
}))

test('an affix snapshot records the modifier it asked about', async () => withDb(async db => {
  const client = archivingClient(db)
  await sweepAffixes({ client, db, index, league: 'L', types: ['Breach Tablet'],
    perCell: 3, affixes: ['explicit.stat_9'] })
  const [row] = snapshots(db)
  assert.equal(row.stat_id, 'explicit.stat_9')
  assert.equal(row.rarity, 'Rare')
}))

// A snapshot's rarity must read the same as the rarity on the rows inside it,
// or phase 2 needs a mapping table to join a question to its answer. The query
// option is lower case and GGG writes an item in title case. GGG wins.
test('a snapshot records rarity as the listing rows spell it', async () => withDb(async db => {
  const client = archivingClient(db)
  await sweepPools({ client, db, index, league: 'L', types: ['Breach Tablet'],
    rarities: ['rare'], perCell: 3 })
  const snap = snapshots(db)[0]
  const listed = db.prepare('SELECT DISTINCT rarity r FROM listing').all().map(x => x.r)
  assert.deepEqual(listed, [snap.rarity])
}))

test('every listing a sweep writes is stamped with its snapshot',
  async () => withDb(async db => {
    const client = archivingClient(db)
    await sweepPools({ client, db, index, league: 'L', types: ['Breach Tablet'],
      rarities: ['rare'], perCell: 3 })
    const id = snapshots(db)[0].id
    const rows = db.prepare('SELECT snapshot_id s FROM listing').all()
    assert.equal(rows.length, 3)
    assert.ok(rows.every(r => r.s === id), JSON.stringify(rows))
  }))

// An empty snapshot row from a search that never answered would still be the
// most recent answer to its question, and would shadow the good older one.
test('a search that fails opens no snapshot', async () => withDb(async db => {
  const client = archivingClient(db)
  client.search = async () => { throw new Error('429') }
  await assert.rejects(() => sweepPools({ client, db, index, league: 'L',
    types: ['Breach Tablet'], rarities: ['rare'], perCell: 3 }))
  assert.equal(snapshots(db).length, 0)
}))

// A snapshot is an answer. A question that was not fully answered leaves none,
// so the last good snapshot stays the most recent answer to it.
test('a cell that fails part way through leaves no snapshot',
  async () => withDb(async db => {
    const client = archivingClient(db)
    client.search = async () => ({
      queryId: 'q', total: 500, url: 'u',
      ids: Array.from({ length: 15 }, (_, i) => `i${i}`)
    })
    const ok = client.fetchItems
    let calls = 0
    client.fetchItems = async (ids, qid) => {
      if (++calls > 1) throw new Error('Non-JSON 503 from GGG: maintenance')
      return ok(ids, qid)
    }
    await assert.rejects(() => sweepPools({ client, db, index, league: 'L',
      types: ['Breach Tablet'], rarities: ['rare'], perCell: 15 }))
    assert.equal(snapshots(db).length, 0)
  }))

// They are true observations and the archive kept the response either way, so
// they join the history that predates snapshots rather than being thrown away.
test('rows collected before a failure stay, with their stamp removed',
  async () => withDb(async db => {
    const client = archivingClient(db)
    client.search = async () => ({
      queryId: 'q', total: 500, url: 'u',
      ids: Array.from({ length: 15 }, (_, i) => `i${i}`)
    })
    const ok = client.fetchItems
    let calls = 0
    client.fetchItems = async (ids, qid) => {
      if (++calls > 1) throw new Error('Non-JSON 503 from GGG: maintenance')
      return ok(ids, qid)
    }
    await assert.rejects(() => sweepPools({ client, db, index, league: 'L',
      types: ['Breach Tablet'], rarities: ['rare'], perCell: 15 }))
    const rows = db.prepare('SELECT snapshot_id s FROM listing').all()
    assert.equal(rows.length, 10, 'the first page was collected')
    assert.ok(rows.every(r => r.s === null), JSON.stringify(rows))
  }))

// The other half of the same rule: because a failure leaves nothing behind, an
// empty snapshot can only mean the market held nothing for that question.
test('a search that finds nothing still leaves a snapshot', async () => withDb(async db => {
  const client = archivingClient(db)
  client.search = async () => ({ queryId: 'q', ids: [], total: 0, url: 'u' })
  await sweepPools({ client, db, index, league: 'L', types: ['Breach Tablet'],
    rarities: ['rare'], perCell: 3 })
  assert.equal(snapshots(db).length, 1)
  assert.equal(db.prepare('SELECT count(*) n FROM listing').get().n, 0)
}))
