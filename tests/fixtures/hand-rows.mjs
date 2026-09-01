// A hand-built pool of Rare Breach Tablets. Prices are divine.
//
// Every count and price below is chosen so that exactly one rule decides each
// outcome. Do not change a number without re-checking every assertion in
// walk.test.mjs and lookup.test.mjs.
//
//   VALUE    genuinely worth money. Appears alone (20 at 25d) and beside SHADOW.
//   SHADOW   also worth money, and only ever appears with VALUE.
//   RIDER    worthless. It sits on the dear tablets, but on cheap ones too, so
//            its own floor is low. A floor statistic is naturally robust here.
//   THIN     high floor, but two sellers hold all of it.
//   JUNK     filler. No lift.
//   OUTLIER  worth money, but ONE seller dumped it at 1 divine. Its minimum is
//            1 and its third-cheapest is 40. This is the row that proves the
//            tested statistic cannot be the plain minimum.
let n = 0
const row = (ex, mods, seller, over = {}) => ({
  listingId: `r${++n}`,
  indexed: '2026-08-29T11:00:00Z',
  account: seller,
  amount: ex,
  currency: 'exalted',
  rank: null,
  type: 'Breach Tablet',
  rarity: 'Rare',
  openPrefix: 0,
  openSuffix: 0,
  mods: mods.map(h => ({ hash: h, roll: 1, affix: h })),
  ...over
})
const many = (rows, count, make) => { for (let i = 0; i < count; i++) rows.push(make(i)) }

export function handRows () {
  const rows = []
  many(rows, 20, i => row(1, ['JUNK'], `j${i}`))
  many(rows, 20, i => row(25, ['VALUE'], `v${i}`))
  many(rows, 14, i => row(30, ['VALUE', 'SHADOW', 'RIDER'], `s${i}`))
  many(rows, 14, i => row(1, ['RIDER'], `r${i}`))
  many(rows, 14, i => row(50, ['THIN'], `t${i % 2}`))
  rows.push(row(1, ['OUTLIER'], 'x0'))
  many(rows, 13, i => row(40, ['OUTLIER'], `x${i + 1}`))
  return rows
}
