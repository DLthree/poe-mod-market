import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../lib/db.mjs'

// Awaits the callback before closing. A synchronous finally would close the
// database while an async test was still using it.
export async function withDb (fn) {
  const dir = mkdtempSync(join(tmpdir(), 'tablet-'))
  const db = openDb(join(dir, 't.db'))
  try {
    return await fn(db)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

// Seeds the snapshots a real sweep would leave behind for a set of rows: one
// answering "what does a blank tablet of this cell floor at?", and one per
// modifier answering "what does one carrying this modifier floor at?". Each
// snapshot gets its own request, because each came from its own search, and
// the rows inside it are ranked cheapest-first the way GGG returns them.
//
// A fixture that writes listings alone has nothing for phase 2 to price: every
// number now comes from the snapshot of the search that asked for it.
// One question and the rows that answered it, ranked in the order given. The
// caller supplies them cheapest-first, the way GGG returns a price-sorted
// search — including across currencies, which is the ordering we cannot
// compute ourselves and therefore must state in a fixture.
export function seedQuestion (db, { league = 'L', type = 'Breach Tablet', rarity = 'Rare',
                                    statId = null, takenAt = '2026-08-29T12:00:00Z',
                                    idFor = (i) => `l${i}`, rows = [] }) {
  const snap = Number(db.prepare(
    'INSERT INTO snapshot (league,type,rarity,stat_id,taken_at) VALUES (?,?,?,?,?)')
    .run(league, type, rarity, statId, takenAt).lastInsertRowid)
  const req = Number(db.prepare(
    `INSERT INTO request (at,league,kind,method,url,status,response_body)
     VALUES (?,?,'fetch','GET','u',200,X'00')`).run(takenAt, league).lastInsertRowid)
  for (const [i, r] of rows.entries()) {
    const id = r.listingId || idFor(i)
    db.prepare(`INSERT INTO listing
      (request_id,listing_id,indexed,account,price_amount,price_currency,type,rarity,
       "rank",open_prefix,open_suffix,corrupted,snapshot_id)
      VALUES (?,?,?,?,?,?,?,?,?,0,0,?,?)`).run(
      req, id, r.indexed || '2026-08-29T11:00:00Z', r.account,
      r.amount, r.currency || 'exalted', r.type || type, r.rarity || rarity, i,
      r.corrupted ? 1 : 0, snap)
    for (const h of (r.mods || [])) {
      db.prepare(`INSERT INTO listing_mod
        (request_id,listing_id,hash,roll,affix,roll_min,roll_max) VALUES (?,?,?,1,?,?,?)`)
        .run(req, id, h, h, r.band ? r.band[0] : null, r.band ? r.band[1] : null)
    }
  }
}

export function seedCell (db, { league = 'L', type = 'Breach Tablet', rarity = 'Rare',
                                takenAt = '2026-08-29T12:00:00Z', idFor = (i) => `l${i}`,
                                rows = [] }) {
  const withIds = rows.map((r, i) => ({ ...r, listingId: r.listingId || idFor(i) }))
  const cheapestFirst = [...withIds].sort((a, b) => a.amount - b.amount)
  const shared = { league, type, rarity, takenAt }

  seedQuestion(db, { ...shared, statId: null, rows: cheapestFirst })
  for (const hash of new Set(withIds.flatMap(r => r.mods || []))) {
    seedQuestion(db, {
      ...shared, statId: hash, rows: cheapestFirst.filter(r => (r.mods || []).includes(hash))
    })
  }
}

// A fetch result shaped exactly like the ones GGG returns, so tests exercise
// the real field paths rather than an idealised approximation.
export const sampleListing = (over = {}) => ({
  id: over.id || 'a'.repeat(64),
  listing: {
    indexed: '2026-08-29T11:00:00Z',
    account: { name: 'Someone#1' },
    price: { type: 'b/o', amount: 45, currency: 'divine' },
    ...over.listing
  },
  item: {
    typeLine: 'Breach Tablet',
    baseType: 'Breach Tablet',
    rarity: 'Rare',
    ilvl: 80,
    explicitMods: [
      {
        description: 'Unstable [ContainsBreach|Breaches] in Map spawn 3 additional ' +
          '[Rarity|Rare] Monsters when Stabilised',
        hash: 'stat.explicit.stat_3762913035',
        mods: [{ name: 'of the Invasion', tier: 'S1', magnitudes: [{ min: '1', max: '3' }] }]
      },
      {
        description: 'Map has 30% increased number of [Rarity|Rare] Monsters',
        hash: 'stat.explicit.stat_3793155082',
        mods: [{ name: 'Brimming', tier: 'P1', magnitudes: [{ min: '25', max: '35' }] }]
      }
    ],
    ...over.item
  }
})
