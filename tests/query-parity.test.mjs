import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ITEM_KINDS } from '../lib/item-kinds.mjs'
import { poolQuery, affixQuery, SORT } from '../lib/sweep.mjs'
import { tradeUrl } from '../lib/trade-url.mjs'

// THE DRIFT GUARD. The sweep query and the trade-button query are two separate
// literals in two files, and they have drifted twice.
//
//   2026-09-07  the link omitted the tablet uses filter, so it opened a market
//               whose cheap end was part-used tablets the prices had excluded.
//   2026-09-10  neither asked about corrupted items, but lib/summary.mjs dropped
//               them from every magic and normal cell. On Sapphire magic the
//               published blank was 4 exalted with a 2-exalted corrupted listing
//               at the top of the link.
//
// Reading the two files side by side is what missed both. This compares them.
//
// A `pinned` addition that only one caller merges fails here, whatever shape it
// has: a stat group, a misc filter, or something not yet invented.

const WINDOW = '3days'
const HASH = 'explicit.stat_681332047'

// Every leaf of an object as a "path = value" string, so two queries can be
// compared by set difference and the difference names the field.
function leaves (value, path = '') {
  if (value === null || typeof value !== 'object') return [`${path} = ${JSON.stringify(value)}`]
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`))
  return Object.keys(value).sort()
    .flatMap(k => leaves(value[k], path ? `${path}.${k}` : k))
}

// The modifier group is the ONE deliberate difference. The sweep asks a single
// modifier with an `and` group; the link asks "1 of these" with a `count` group,
// because each price on the page came from its own single-modifier search and no
// price ever described a conjunction.
const outsideModGroup = (paths) => paths.filter(p => !p.startsWith('stats[0]'))

const cells = Object.values(ITEM_KINDS).flatMap(
  kind => kind.types.flatMap(type => kind.rarities.map(rarity => ({ kind, type, rarity }))))

test('there is a cell to check for every kind, type and rarity', () => {
  assert.equal(cells.length, 8 * 3 + 3 * 2)
})

for (const { kind, type, rarity } of cells) {
  test(`the button opens what the sweep priced: ${kind.key} ${type} ${rarity}`, () => {
    const swept = affixQuery(kind, type, HASH, WINDOW, rarity)
    const link = tradeUrl({ league: 'L', kind, type, rarity, mods: [HASH], tradeWindow: WINDOW })
    assert.ok(link.url, `no link: ${link.reason}`)
    assert.equal(link.exact, true, 'a link that carries everything must say so')

    const a = new Set(leaves(swept))
    const b = new Set(leaves(link.query.query))
    assert.deepEqual(outsideModGroup([...a].filter(p => !b.has(p))), [],
      'the sweep asks for something the button does not')
    assert.deepEqual(outsideModGroup([...b].filter(p => !a.has(p))), [],
      'the button asks for something the sweep did not')
    assert.deepEqual(link.query.sort, SORT, 'the floor is read off the cheap end')
  })
}

// The page links a cell heading as well as a modifier row, and that link carries
// no modifier at all. It must still match the blank-cell search the baseline came
// from, group for group.
for (const { kind, type, rarity } of cells) {
  test(`the button opens what the blank cell priced: ${kind.key} ${type} ${rarity}`, () => {
    const swept = poolQuery(kind, type, rarity, WINDOW)
    const link = tradeUrl({ league: 'L', kind, type, rarity, mods: [], tradeWindow: WINDOW })
    assert.deepEqual(new Set(leaves(link.query.query)), new Set(leaves(swept)))
  })
}
