import { test } from 'node:test'
import assert from 'node:assert/strict'
import { meta, mods, price } from '../lib/api.mjs'
import { tradeUrl } from '../lib/trade-url.mjs'
import { withDb, seedCell, seedQuestion } from './helpers.mjs'

const NOW = Date.parse('2026-08-29T13:00:00Z')

const config = {
  floor: { strategy: 'nth-cheapest', n: 3 },
  walk: { minListings: 3, minSellers: 2, minLift: 2, minAdds: 0, midVsBlank: 1.5, highVsBlank: 2 }
}
const common = { league: 'L', lookbackHours: 48, config, now: NOW }

// The snapshots a sweep of this cell would leave behind, seeded straight into
// the derived tables so these tests exercise the query layer, not the parser.
const seed = (db, rows) => seedCell(db, { rows })

// JUNK  cheap filler, on everything cheap.
// MID    on cheap AND dear rows, so its own floor stays low: it must fail on lift.
// GOOD   only on dear rows, and on more of them than MID: the one real modifier.
const SAMPLE = [
  { amount: 3, account: 'a', mods: ['JUNK'] },
  { amount: 4, account: 'b', mods: ['JUNK'] },
  { amount: 5, account: 'c', mods: ['JUNK', 'MID'] },
  { amount: 6, account: 'd', mods: ['JUNK', 'MID'] },
  { amount: 7, account: 'e', mods: ['JUNK', 'MID'] },
  { amount: 40, account: 'f', mods: ['GOOD'] },
  { amount: 45, account: 'g', mods: ['GOOD'] },
  { amount: 50, account: 'h', mods: ['GOOD', 'MID'] },
  { amount: 60, account: 'i', mods: ['GOOD', 'MID'] }
]

test('meta reports the cells and how old they are', () => withDb(db => {
  seed(db, SAMPLE)
  const m = meta(db, { league: 'L', lookbackHours: 48, now: NOW })
  assert.equal(m.listings, 9)
  assert.equal(m.cells.length, 1)
  assert.equal(m.cells[0].type, 'Breach Tablet')
  assert.equal(m.cells[0].sellers, 9)
  assert.equal(m.cells[0].basis, 'our sample, not the market')
}))

test('mods gives a floor per modifier against the blank baseline',
  () => withDb(db => {
    seed(db, SAMPLE)
    const out = mods(db, { ...common, type: 'Breach Tablet', rarity: 'Rare' })
    const good = out.mods.find(m => m.hash === 'GOOD')
    assert.equal(good.matches, 4)
    assert.equal(good.floor, 50, 'third cheapest of 40/45/50/60')
    assert.ok(good.delta > 40, `delta ${good.delta}`)
    assert.equal(good.quality, 'high')
  }))

test('a modifier on cheap listings gets no band', () => withDb(db => {
  seed(db, SAMPLE)
  const out = mods(db, { ...common, type: 'Breach Tablet', rarity: 'Rare' })
  assert.equal(out.mods.find(m => m.hash === 'JUNK').quality, null)
  assert.equal(out.mods.find(m => m.hash === 'MID').quality, null,
    'MID sits on cheap rows too, so its own floor stays near the blank one')
}))

// Measured on the live sample: a filler modifier riding on dear tablets scored a
// 6.8x lift and read as valuable. The verdict must come from the walk, which
// requires a modifier to lift on rows no stronger modifier already explains.
// A modifier that never appears without a stronger one prices the same as that
// stronger one, because a search for either returns the same tablets. That is
// the correct answer, not a fault: the floor of a modifier's own search IS what
// the market charges for a tablet carrying it. Nothing here tries to work out
// WHICH modifier the buyer is paying for, and nothing needs to.
test('a modifier that only ever rides a stronger one prices the same as it',
  () => withDb(db => {
    seed(db, [
      { amount: 3, account: 'a', mods: ['JUNK'] },
      { amount: 4, account: 'b', mods: ['JUNK'] },
      { amount: 5, account: 'c', mods: ['JUNK'] },
      { amount: 20, account: 'd', mods: ['MID'] },
      { amount: 25, account: 'e', mods: ['MID'] },
      { amount: 30, account: 'f', mods: ['MID'] },
      { amount: 100, account: 'g', mods: ['GOOD', 'RIDER'] },
      { amount: 110, account: 'h', mods: ['GOOD', 'RIDER'] },
      { amount: 120, account: 'i', mods: ['GOOD', 'RIDER'] }
    ])
    const out = mods(db, { ...common, type: 'Breach Tablet', rarity: 'Rare' })
    const by = (h) => out.mods.find(m => m.hash === h)
    assert.equal(by('RIDER').floor, by('GOOD').floor, 'the same search, the same tablets')
    assert.equal(by('RIDER').quality, 'high')
    assert.equal(by('GOOD').quality, 'high')
    assert.equal(by('MID').quality, 'high', '30 against a blank tablet at 5')
    assert.equal(by('JUNK').quality, null)
  }))

// THE KNOWN COST OF MEASURING AGAINST THE BLANK TABLET, pinned so nobody meets
// it by surprise. Where the junk end of a cell is nearly free, every modifier
// on it clears both bands, including one that costs exactly what every other
// modifier on the cell costs. Delirium and Irradiated rares are the live case:
// both floor at 1 exalted.
//
// `typical` is published beside every cell for this reason — here it is 30, the
// same as the modifier said to be high quality — so a reader can see that the
// band is a statement about the blank tablet, not about the modifier.
test('on a cell with a worthless blank tablet, ordinary modifiers band high',
  () => withDb(db => {
    seed(db, [
      { amount: 1, account: 'a', mods: ['BLANKISH'] },
      { amount: 1, account: 'b', mods: ['BLANKISH'] },
      { amount: 1, account: 'c', mods: ['BLANKISH'] },
      { amount: 30, account: 'd', mods: ['FILLER'] },
      { amount: 30, account: 'e', mods: ['FILLER'] },
      { amount: 30, account: 'f', mods: ['FILLER'] },
      { amount: 30, account: 'g', mods: ['ORDINARY'] },
      { amount: 32, account: 'h', mods: ['ORDINARY'] },
      { amount: 34, account: 'i', mods: ['ORDINARY'] }
    ])
    const out = mods(db, { ...common, type: 'Breach Tablet', rarity: 'Rare' })
    const filler = out.mods.find(m => m.hash === 'FILLER')
    assert.equal(out.baseline.value, 1, 'the cheap end of the cell is junk')
    assert.equal(filler.floor, 30)
    assert.equal(filler.delta, 29, 'it really does cost 29 more than a blank tablet')
    assert.equal(filler.quality, 'high', '30 times a blank tablet that costs 1')
    assert.equal(out.typical, 30, 'and that is what every modifier here costs')

    // ...and this is the setting that answers it. The fixture above runs with
    // minAdds 0, which is the ratio alone. Raising it above what the modifier
    // actually adds withdraws the band, without touching any cell whose blank
    // is dear enough that the ratio was already the harder test.
    const strict = mods(db, {
      ...common, type: 'Breach Tablet', rarity: 'Rare',
      config: { ...config, walk: { ...config.walk, minAdds: 50 } }
    })
    assert.equal(strict.mods.find(m => m.hash === 'FILLER').quality, null,
      'it adds 29, and 29 is not 50')
  }))

test('banded modifiers sort above thin high-value ones', () => withDb(db => {
  seed(db, SAMPLE)
  const out = mods(db, { ...common, type: 'Breach Tablet', rarity: 'Rare' })
  const firstUnbanded = out.mods.findIndex(m => !m.quality)
  const lastBanded = out.mods.map(m => Boolean(m.quality)).lastIndexOf(true)
  if (firstUnbanded !== -1 && lastBanded !== -1) assert.ok(lastBanded < firstUnbanded)
}))

test('a modifier priced in another currency gets no verdict, rather than a guess',
  () => withDb(db => {
    seed(db, SAMPLE)
    seedQuestion(db, {
      statId: 'DEAR',
      idFor: (i) => `dear${i}`,
      rows: [
        { amount: 2, account: 'x', currency: 'divine', mods: ['DEAR'] },
        { amount: 3, account: 'y', currency: 'divine', mods: ['DEAR'] },
        { amount: 4, account: 'z', currency: 'divine', mods: ['DEAR'] }
      ]
    })
    const out = mods(db, { ...common, type: 'Breach Tablet', rarity: 'Rare' })
    const dear = out.mods.find(m => m.hash === 'DEAR')
    assert.equal(dear.currency, 'divine')
    assert.equal(dear.quality, null, 'incomparable is not the same as worthless')
  }))

test('price narrows as modifiers are added', () => withDb(db => {
  seed(db, SAMPLE)
  const one = price(db, { ...common, type: 'Breach Tablet', rarity: 'Rare', mods: ['GOOD'] })
  assert.equal(one.matches, 4)
  const two = price(db, { ...common, type: 'Breach Tablet', rarity: 'Rare', mods: ['GOOD', 'MID'] })
  assert.equal(two.matches, 2)
}))

test('a combination nothing carries is zero matches and a 200-shaped answer',
  () => withDb(db => {
    seed(db, SAMPLE)
    const out = price(db, {
      ...common, type: 'Breach Tablet', rarity: 'Rare', mods: ['GOOD', 'JUNK']
    })
    assert.equal(out.matches, 0)
    assert.equal(out.floor, null)
    assert.deepEqual(out.listings, [])
    assert.ok(out.trade.url, 'a zero result still links to the real market')
  }))

// The merc tool's key affordance: see the fall to zero before clicking.
test('next says how many matches survive each unticked modifier', () => withDb(db => {
  seed(db, SAMPLE)
  const out = price(db, { ...common, type: 'Breach Tablet', rarity: 'Rare', mods: ['GOOD'] })
  const byHash = new Map(out.next.map(n => [n.hash, n.matchesIfAdded]))
  assert.equal(byHash.get('MID'), 2)
  assert.equal(byHash.get('JUNK'), 0, 'a dead end is reported, not hidden')
}))

test('every payload states that its counts are a sample', () => withDb(db => {
  seed(db, SAMPLE)
  const args = { ...common, type: 'Breach Tablet', rarity: 'Rare' }
  assert.equal(mods(db, args).sample.basis, 'our sample, not the market')
  assert.equal(price(db, { ...args, mods: [] }).sample.basis, 'our sample, not the market')
}))

test('the trade link carries the market, currency and modifiers', () => {
  const { url, exact } = tradeUrl({
    league: 'Runes of Aldur', type: 'Breach Tablet', rarity: 'Rare', mods: ['a', 'b']
  })
  assert.equal(exact, true)
  const q = JSON.parse(decodeURIComponent(url.split('?q=')[1]))
  assert.equal(q.query.status.option, 'securable')
  assert.equal(q.query.filters.trade_filters.filters.price.option, 'exalted_divine')
  assert.deepEqual(q.query.stats[0].filters, [{ id: 'a' }, { id: 'b' }])
  assert.deepEqual(q.sort, { price: 'asc' })
  assert.ok(url.startsWith('https://www.pathofexile.com/trade2/search/poe2/Runes%20of%20Aldur?q='))
})

// A link to the wrong league is worse than no link; the merc tool says so too.
test('no league means no link', () => {
  assert.equal(tradeUrl({ league: null, type: 'Breach Tablet', rarity: 'Rare' }).url, null)
})

// Window A, the trade window. The link must show the same slice of the market
// we priced, from config not a hardcoded default — a non-default value here
// (1week) catches a literal '3days' left in the query.
test('the trade link carries the trade window, from config not a literal', () => {
  const { url } = tradeUrl({
    league: 'Runes of Aldur', type: 'Breach Tablet', rarity: 'Rare', mods: ['a'],
    tradeWindow: '1week'
  })
  const q = JSON.parse(decodeURIComponent(url.split('?q=')[1]))
  assert.equal(q.query.filters.trade_filters.filters.indexed.option, '1week')
})

// A ratio hides the size of the prize. "x10" on a 1 ex baseline is 9 exalted;
// "x1.4" on a 100 ex baseline is 40. The number a person acts on is the second
// one, so the payload carries the difference in currency.
test('mods gives the raw currency difference from the baseline', () => withDb(db => {
  seed(db, SAMPLE)
  const out = mods(db, { ...common, type: 'Breach Tablet', rarity: 'Rare' })
  assert.equal(out.baseline.value, 5, 'third cheapest of 3/4/5/6/7/40/45/50/60')
  const good = out.mods.find(m => m.hash === 'GOOD')
  assert.equal(good.floor, 50)
  assert.equal(good.delta, 45, 'a GOOD tablet is worth 45 exalted more than a blank one')
  assert.equal(good.currency, 'exalted')
}))

// The cheap end of this cell is exalted, so the baseline is exalted. DEAR sits
// on tablets dear enough to be priced in divine, and its own search returns
// only those. The two floors cannot be compared without an exchange rate we
// refuse to hold, so the difference is null rather than invented.
test('a difference across two currencies is null, never a converted number',
  () => withDb(db => {
    seed(db, SAMPLE)
    seedQuestion(db, {
      statId: 'DEAR',
      idFor: (i) => `dear${i}`,
      rows: [
        { amount: 2, account: 'x', currency: 'divine', mods: ['DEAR'] },
        { amount: 3, account: 'y', currency: 'divine', mods: ['DEAR'] },
        { amount: 4, account: 'z', currency: 'divine', mods: ['DEAR'] }
      ]
    })
    const out = mods(db, { ...common, type: 'Breach Tablet', rarity: 'Rare' })
    const dear = out.mods.find(m => m.hash === 'DEAR')
    assert.equal(out.baseline.currency, 'exalted')
    assert.equal(dear.currency, 'divine')
    assert.equal(dear.delta, null)
  }))

test('modifiers sort by how much currency they add', () => withDb(db => {
  seed(db, SAMPLE)
  const out = mods(db, { ...common, type: 'Breach Tablet', rarity: 'Rare' })
  const withDelta = out.mods.filter(m => m.quality && m.delta !== null).map(m => m.delta)
  assert.deepEqual(withDelta, [...withDelta].sort((a, b) => b - a))
}))

// "#% increased number of Rare Monsters" tells a reader nothing about what the
// modifier is worth rolling. The band comes from GGG's own magnitudes, widened
// to whatever the sample actually contains.
const banded = (db, rows) => {
  seed(db, rows)
  for (const [i, r] of rows.entries()) {
    for (const h of r.mods) {
      db.prepare('UPDATE listing_mod SET roll_min=?, roll_max=? WHERE listing_id=? AND hash=?')
        .run(r.band[0], r.band[1], `l${i}`, h)
    }
  }
}

test('a modifier is labelled with the band it can roll, not with a placeholder',
  () => withDb(db => {
    banded(db, SAMPLE.map(r => ({ ...r, band: [25, 35] })))
    const out = mods(db, { ...common, type: 'Breach Tablet', rarity: 'Rare',
      textFor: () => '#% increased number of Rare Monsters' })
    const good = out.mods.find(m => m.hash === 'GOOD')
    assert.equal(good.label, '25-35% increased number of Rare Monsters')
  }))

test('a band the whole sample agrees on shows as one number', () => withDb(db => {
  banded(db, SAMPLE.map(r => ({ ...r, band: [1, 1] })))
  const out = mods(db, { ...common, type: 'Breach Tablet', rarity: 'Rare',
    textFor: () => 'Map contains # additional Rare Chests' })
  assert.equal(out.mods.find(m => m.hash === 'GOOD').label,
    'Map contains 1 additional Rare Chests')
}))

test('the band spans everything the sample actually held', () => withDb(db => {
  banded(db, [
    { amount: 40, account: 'f', mods: ['GOOD'], band: [10, 20] },
    { amount: 45, account: 'g', mods: ['GOOD'], band: [30, 40] },
    { amount: 50, account: 'h', mods: ['GOOD'], band: [10, 20] }
  ])
  const out = mods(db, { ...common, type: 'Breach Tablet', rarity: 'Rare',
    textFor: () => '#% increased Quantity' })
  assert.equal(out.mods.find(m => m.hash === 'GOOD').label, '10-40% increased Quantity')
}))

test('text with no placeholder is left exactly as it is', () => withDb(db => {
  banded(db, SAMPLE.map(r => ({ ...r, band: [1, 1] })))
  const out = mods(db, { ...common, type: 'Breach Tablet', rarity: 'Rare',
    textFor: () => 'Area contains an additional Rare Chest' })
  assert.equal(out.mods.find(m => m.hash === 'GOOD').label,
    'Area contains an additional Rare Chest')
}))

test('a modifier with no band recorded falls back to its text', () => withDb(db => {
  seed(db, SAMPLE)
  const out = mods(db, { ...common, type: 'Breach Tablet', rarity: 'Rare',
    textFor: () => '#% increased Quantity' })
  assert.equal(out.mods.find(m => m.hash === 'GOOD').label, '#% increased Quantity')
}))

// GGG writes some modifiers with no placeholder at all - "spawn an additional
// Rare Monster" - while the band it sends says 1 to 3. That is the Breach
// premium, the most valuable modifier found so far, and its roll was the one
// thing the page could not show. Appended rather than substituted: there is no
// "#" to put it in, and rewriting "an" into "1-3" would be guesswork.
test('a modifier with no placeholder still shows the band it can roll', () => withDb(db => {
  banded(db, SAMPLE.map(r => ({ ...r, band: [1, 3] })))
  const out = mods(db, { ...common, type: 'Breach Tablet', rarity: 'Rare',
    textFor: () => 'Unstable Breaches spawn an additional Rare Monster' })
  assert.equal(out.mods.find(m => m.hash === 'GOOD').label,
    'Unstable Breaches spawn an additional Rare Monster (1-3)')
}))

test('a band of exactly one is not worth appending', () => withDb(db => {
  banded(db, SAMPLE.map(r => ({ ...r, band: [1, 1] })))
  const out = mods(db, { ...common, type: 'Breach Tablet', rarity: 'Rare',
    textFor: () => 'Area contains an additional Rare Chest' })
  assert.equal(out.mods.find(m => m.hash === 'GOOD').label,
    'Area contains an additional Rare Chest')
}))
