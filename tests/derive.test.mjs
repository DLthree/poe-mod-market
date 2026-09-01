import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { recordRequest } from '../lib/archive.mjs'
import { deriveRequest, deriveAll } from '../lib/derive.mjs'
import { buildIndex } from '../lib/stat-index.mjs'
import { withDb, sampleListing } from './helpers.mjs'
import { MAX_AFFIX } from '../lib/poe2.mjs'

const stats = JSON.parse(readFileSync(new URL('./fixtures/stats-subset.json', import.meta.url)))
const index = buildIndex(stats)
const ee2 = readFileSync(new URL('../vendor/ee2-stats.ndjson', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l))
const ee2Index = buildIndex(stats, ee2)

const archive = (db, result) => recordRequest(db, {
  at: '2026-08-29T12:00:00Z', league: 'L', kind: 'fetch', cell: 'Breach Tablet|rare',
  method: 'GET', url: 'u', status: 200, text: JSON.stringify({ result }), headers: new Headers()
})

test('a listing and its modifiers are written', () => withDb(db => {
  const n = deriveRequest(db, archive(db, [sampleListing()]), index)
  assert.equal(n, 1)
  const row = db.prepare('SELECT * FROM listing').get()
  assert.equal(row.type, 'Breach Tablet')
  assert.equal(row.rarity, 'Rare')
  assert.equal(row.price_amount, 45)
  assert.equal(row.price_currency, 'divine')
  assert.equal(row.account, 'Someone#1')
  assert.equal(db.prepare('SELECT count(*) n FROM listing_mod').get().n, 2)
}))

test('the stat prefix is stripped so hashes match the query filter form', () => withDb(db => {
  deriveRequest(db, archive(db, [sampleListing()]), index)
  const hashes = db.prepare('SELECT hash FROM listing_mod').all().map(r => r.hash)
  assert.ok(hashes.includes('explicit.stat_3762913035'), hashes.join(' '))
  assert.ok(hashes.every(h => !h.startsWith('stat.')))
}))

test('the roll is read out of the description even without a template placeholder',
  () => withDb(db => {
    deriveRequest(db, archive(db, [sampleListing()]), index)
    const row = db.prepare('SELECT roll, rolls FROM listing_mod WHERE hash=?')
      .get('explicit.stat_3762913035')
    assert.equal(row.roll, 3)
    assert.deepEqual(JSON.parse(row.rolls), [3])
  }))

test('the full roll array is kept, not just the first value', () => withDb(db => {
  deriveRequest(db, archive(db, [sampleListing()]), index)
  const rows = db.prepare('SELECT rolls FROM listing_mod').all()
  assert.ok(rows.every(r => Array.isArray(JSON.parse(r.rolls))))
}))

test('the tier range is kept', () => withDb(db => {
  deriveRequest(db, archive(db, [sampleListing()]), index)
  const row = db.prepare('SELECT roll_min, roll_max, affix, tier FROM listing_mod WHERE hash=?')
    .get('explicit.stat_3762913035')
  assert.equal(row.roll_min, 1)
  assert.equal(row.roll_max, 3)
  assert.equal(row.affix, 'of the Invasion')
  assert.equal(row.tier, 'S1')
}))

test('open affixes are counted against the measured rare capacity', () => withDb(db => {
  deriveRequest(db, archive(db, [sampleListing()]), index)
  const row = db.prepare('SELECT open_prefix p, open_suffix s FROM listing').get()
  // The sample carries one prefix and one suffix, against MAX_AFFIX.Rare.
  assert.equal(row.p, MAX_AFFIX.Rare.prefix - 1)
  assert.equal(row.s, MAX_AFFIX.Rare.suffix - 1)
}))

test('no tier codes means open affixes are unknown, not zero', () => withDb(db => {
  const l = sampleListing()
  for (const m of l.item.explicitMods) delete m.mods[0].tier
  deriveRequest(db, archive(db, [l]), index)
  const row = db.prepare('SELECT open_prefix p, open_suffix s FROM listing').get()
  assert.equal(row.p, null)
  assert.equal(row.s, null)
}))

test('a listing with no price is not written', () => withDb(db => {
  const n = deriveRequest(db, archive(db, [sampleListing({ listing: { price: null } })]), index)
  assert.equal(n, 0)
  assert.equal(db.prepare('SELECT count(*) n FROM listing').get().n, 0)
}))

test('deriving the same request twice does not duplicate rows', () => withDb(db => {
  const id = archive(db, [sampleListing()])
  deriveRequest(db, id, index)
  deriveRequest(db, id, index)
  assert.equal(db.prepare('SELECT count(*) n FROM listing').get().n, 1)
  assert.equal(db.prepare('SELECT count(*) n FROM listing_mod').get().n, 2)
}))

// Found in the first live collection: every magic tablet became a pool of one.
test('a magic tablet is grouped by its base type, not its affixed name', () => withDb(db => {
  const l = sampleListing()
  l.item.rarity = 'Magic'
  l.item.typeLine = "Collector's Breach Tablet of the Commander"
  l.item.baseType = 'Breach Tablet'
  deriveRequest(db, archive(db, [l]), index)
  assert.equal(db.prepare('SELECT type FROM listing').get().type, 'Breach Tablet')
}))

test('an item with no baseType falls back to its typeLine', () => withDb(db => {
  const l = sampleListing()
  delete l.item.baseType
  deriveRequest(db, archive(db, [l]), index)
  assert.equal(db.prepare('SELECT type FROM listing').get().type, 'Breach Tablet')
}))

test('a modifier absent from the stat table still records its hash', () => withDb(db => {
  const l = sampleListing()
  l.item.explicitMods.push({
    description: 'Something the stats table has never heard of',
    hash: 'stat.explicit.stat_99999',
    mods: [{ name: 'Odd', tier: 'P2', magnitudes: [{ min: '1', max: '1' }] }]
  })
  deriveRequest(db, archive(db, [l]), index)
  const hashes = db.prepare('SELECT hash FROM listing_mod').all().map(r => r.hash)
  assert.ok(hashes.includes('explicit.stat_99999'))
}))

test('deriveAll replays every archived fetch that has no rows yet', () => withDb(db => {
  archive(db, [sampleListing({ id: 'a'.repeat(64) })])
  archive(db, [sampleListing({ id: 'b'.repeat(64) })])
  assert.equal(deriveAll(db, 'L', index), 2)
  assert.equal(deriveAll(db, 'L', index), 0, 'a second run has nothing left to do')
}))

// The reason the archive is primary: a parser fix is re-applied for free.
test('clearing the derived tables lets every stored response be replayed', () => withDb(db => {
  archive(db, [sampleListing()])
  deriveAll(db, 'L', index)
  db.exec('DELETE FROM listing; DELETE FROM listing_mod')
  assert.equal(deriveAll(db, 'L', index), 1)
}))

// Real gap, found 2026-08-30. GGG writes a roll of one as a word: the archive
// held "Map contains an additional Rare Chest" with no digit at all, so the
// roll came out null on 53 of 896 stored modifier rows.
const wordedRoll = () => sampleListing({
  id: 'b'.repeat(64),
  item: {
    typeLine: 'Irradiated Tablet',
    baseType: 'Irradiated Tablet',
    rarity: 'Rare',
    ilvl: 81,
    explicitMods: [{
      description: 'Map contains an additional [Rarity|Rare] Chest',
      hash: 'stat.explicit.stat_231864447',
      mods: [{ name: "Treasurer's", tier: 'P1', magnitudes: [{ min: '1', max: '1' }] }]
    }]
  }
})

test('a roll written as a word is stored as its number', () => withDb(db => {
  deriveRequest(db, archive(db, [wordedRoll()]), ee2Index)
  const row = db.prepare('SELECT roll FROM listing_mod WHERE hash=?').get('explicit.stat_231864447')
  assert.equal(row.roll, 1)
}))

test('a stored roll never falls outside the band GGG sent with it', () => withDb(db => {
  deriveRequest(db, archive(db, [wordedRoll()]), ee2Index)
  const row = db.prepare('SELECT roll, roll_min, roll_max FROM listing_mod').get()
  assert.ok(row.roll >= row.roll_min && row.roll <= row.roll_max,
    `roll ${row.roll} outside ${row.roll_min}-${row.roll_max}`)
}))

// Found 2026-08-30: one stored Breach rare carried three suffixes and the row
// went in with open_suffix = -1. A count of open affixes is a fact about an
// item, and "minus one slot" is not one.
test('a rare with more affixes than the cap never stores a negative open count',
  () => withDb(db => {
    const l = sampleListing()
    l.item.explicitMods = ['S1', 'S2', 'S3', 'P1'].map((tier, i) => ({
      description: `Map has ${10 + i}% increased number of [Rarity|Rare] Monsters`,
      hash: `stat.explicit.stat_${1000 + i}`,
      mods: [{ name: `Aff${i}`, tier, magnitudes: [{ min: '1', max: '99' }] }]
    }))
    deriveRequest(db, archive(db, [l]), index)
    const row = db.prepare('SELECT open_prefix p, open_suffix s FROM listing').get()
    assert.ok(row.s >= 0, `open_suffix was ${row.s}`)
    assert.ok(row.p >= 0, `open_prefix was ${row.p}`)
  }))

// The archive holds BOTH wordings for explicit.stat_3762913035: "spawn an
// additional Rare Monster" and "spawn 2 additional Rare Monsters". The singular
// is the roll-1 rendering. Its band is 1-3, so the min/max shortcut cannot help
// and EE2 has no entry for this stat at all — but GGG's own table writes it with
// no placeholder, which is the tell.
const wordedInvasion = () => sampleListing({
  id: 'c'.repeat(64),
  item: {
    typeLine: 'Breach Tablet',
    baseType: 'Breach Tablet',
    rarity: 'Rare',
    ilvl: 80,
    explicitMods: [{
      description: 'Unstable [ContainsBreach|Breaches] in Map spawn an additional ' +
        '[Rarity|Rare] Monster when Stabilised',
      hash: 'stat.explicit.stat_3762913035',
      mods: [{ name: 'of the Invasion', tier: 'S1', magnitudes: [{ min: '1', max: '3' }] }]
    }]
  }
})

test('a singular wording over a wider band still yields a roll of one', () => withDb(db => {
  deriveRequest(db, archive(db, [wordedInvasion()]), ee2Index)
  const row = db.prepare('SELECT roll FROM listing_mod WHERE hash=?')
    .get('explicit.stat_3762913035')
  assert.equal(row.roll, 1)
}))

// Found by audit-db.mjs on 2026-08-30, over 227 of 14267 stored rows. GGG writes
// the description positively — "dissipates 28% slower" — while the magnitudes
// carry the real band, -30 to -20, because the stat itself is "#% faster". The
// band GGG sent is the authority; the sign in the prose is not.
const negatedByBand = () => sampleListing({
  id: 'd'.repeat(64),
  item: {
    typeLine: 'Delirium Tablet',
    baseType: 'Delirium Tablet',
    rarity: 'Rare',
    ilvl: 80,
    explicitMods: [{
      description: '[ContainsDelirium|Delirium] Fog in Map dissipates 28% slower',
      hash: 'stat.explicit.stat_3350944114',
      mods: [{ name: 'of the Unending', tier: 'S1', magnitudes: [{ min: '-30', max: '-20' }] }]
    }]
  }
})

test('a roll GGG describes positively is stored inside the band GGG sent', () => withDb(db => {
  deriveRequest(db, archive(db, [negatedByBand()]), ee2Index)
  const row = db.prepare('SELECT roll, roll_min, roll_max FROM listing_mod').get()
  assert.equal(row.roll, -28)
  assert.ok(row.roll >= row.roll_min && row.roll <= row.roll_max,
    `roll ${row.roll} outside ${row.roll_min}..${row.roll_max}`)
}))

// A corrupted tablet cannot be modified again, so its open affixes are not
// really open. 2.9% of the first full pass was corrupted, and 93% of the
// Overseer normals were — white Overseer tablets cannot drop, so corruption is
// the only way they exist. The flag is in every archived response.
test('the corrupted flag is stored', () => withDb(db => {
  const l = sampleListing()
  l.item.corrupted = true
  deriveRequest(db, archive(db, [l]), index)
  assert.equal(db.prepare('SELECT corrupted FROM listing').get().corrupted, 1)
}))

test('an uncorrupted tablet is stored as such, not as unknown', () => withDb(db => {
  deriveRequest(db, archive(db, [sampleListing()]), index)
  assert.equal(db.prepare('SELECT corrupted FROM listing').get().corrupted, 0)
}))

// A snapshot is the question one search asked. The row stamps say which rows
// answered it, so phase 2 can price a question from its own answer instead of
// from a pool merged out of several. See docs/snapshot-pricing.md.
test('a listing is stamped with the snapshot it was collected in', () => withDb(db => {
  const snap = Number(db.prepare(
    `INSERT INTO snapshot (league, type, rarity, stat_id, taken_at)
     VALUES ('L','Breach Tablet','Rare',NULL,'2026-08-31T06:00:00Z')`).run().lastInsertRowid)
  deriveRequest(db, archive(db, [sampleListing()]), index, { snapshotId: snap })
  assert.equal(db.prepare('SELECT snapshot_id s FROM listing').get().s, snap)
}))

// A replay reads the archive, not the market, so it cannot know which search
// returned a row. Null says unknown, and a reader skips those rows rather than
// treating them as a snapshot of their own.
test('a listing derived without a snapshot is stamped null', () => withDb(db => {
  deriveRequest(db, archive(db, [sampleListing()]), index)
  assert.equal(db.prepare('SELECT snapshot_id s FROM listing').get().s, null)
}))
