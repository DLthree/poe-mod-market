# The floor statistic cannot price jewels

Measured 2026-09-10 on Forbidden Rites. One full jewel pass: 193 searches, 193
fetches, 1930 listings, 42 minutes. Then a four-search probe.

**The result: 187 modifiers, across all six jewel cells. None banded high. None
banded mid. All 187 banded low.**

This is not a fault in the collector or in the item-kind work. The queries are
right, the snapshots are right, and the same code prices tablets correctly in
the same run. It is a fact about the jewel market, and it means the question
this repo asks of tablets is the wrong question to ask of jewels.

## What the pass found

| cell | blank | typical | modifiers | high | mid | low |
|---|---|---|---|---|---|---|
| Emerald magic | 1 ex | 1 ex | 23 | 0 | 0 | 23 |
| Emerald rare | 1 ex | 1 ex | 64 | 0 | 0 | 64 |
| Ruby magic | 1 ex | 1 ex | 19 | 0 | 0 | 19 |
| Ruby rare | 1 ex | 1 ex | 30 | 0 | 0 | 30 |
| Sapphire magic | 4 ex | 5 ex | 18 | 0 | 0 | 18 |
| Sapphire rare | 1 ex | 1 ex | 33 | 0 | 0 | 33 |

On five of the six cells almost every modifier floors at exactly 1 exalted, adds
exactly 0, and scores exactly 1.00x. Naming a modifier does not move the price
at all.

## Why

**Supply.** Every jewel pool search reported 10000 for sale, which is the API's
own ceiling. A single-modifier search still returns thousands: 5066 listings for
one Emerald rare modifier, 9865 for another. With that many sellers, the
cheapest ten are junk priced at the floor whatever they happen to carry. The
constraint removes almost nothing.

Tablets behave the opposite way, and that is what makes the floor work there:
supply is thin enough that naming a premium modifier genuinely raises the
cheapest listing.

**The deeper reason is that a jewel's value is a conjunction.** A tablet is
worth buying for one good modifier. A jewel is worth buying when several good
modifiers land together on the same item. Every price in this repo comes from a
SINGLE-modifier search — that is stated in the README, and it is why the trade
link is a union rather than an intersection. For tablets that matches how the
item is valued. For jewels it does not.

## The roll is not the missing constraint

The obvious next idea is to ask for a high roll rather than mere presence. It
was tested, four searches, each asking for the top of the band actually observed
for that modifier:

| modifier | band | asked | for sale | cheapest three |
|---|---|---|---|---|
| Mark Skills have #% increased Skill Effect Duration | 18-32 | min 32 | 277 | 1, 1, 1 ex |
| #% increased Life Recovery from Flasks | 5-15 | min 15 | 412 | 5, 5, 5 ex |
| #% increased Damage while you have an active Charm | 10-20 | min 20 | 389 | 1, 1, 1 ex |
| #% increased Magnitude of Damaging Ailments … Critical Hits | 10-20 | min 20 | 207 | 1, 1, 3 ex |

The roll filter does what it should: supply drops from thousands to a few
hundred. **The floor does not move.** A perfectly rolled modifier on an
otherwise worthless jewel is still a worthless jewel, and several hundred
sellers are holding one.

## What Sapphire magic shows

The one cell that discriminates at all is the one with a thin sample. Sapphire
magic returned 8 listings rather than 10, its blank floors at 4 exalted, and its
modifiers spread from 5 to 12 exalted — a real 3.00x at the top. Sapphire rare
has one modifier at 8 exalted against a 1 exalted blank, which is 8.00x.

Both still band low, and correctly: `walk.minAdds` is 10 exalted and they add 8
and 7. That threshold is doing exactly the job the README describes, refusing a
large ratio over a junk baseline.

So the machinery is not broken. It is reporting, accurately, that nothing in the
cheap end of the jewel market is worth ten exalted.

## What this does not settle

Whether jewels can be priced at all by some other question. Ideas, none tested:

- **Ask for two modifiers at once.** This matches how a jewel is actually
  valued, and it is the one change that addresses the conjunction problem
  directly. It also multiplies the search count by the number of pairs worth
  asking about, which is the reason to think hard before spending on it.
- **Read a percentile rather than a floor.** The 1930 listings this pass
  archived are already enough to compute one; no new search is needed. But a
  percentile of a pool that is mostly junk describes the junk.
- **Constrain item level or corruption.** Untested, and cheap to test.

The archive keeps every listing this pass collected, so any statistic that does
not need a new question can be recomputed from it without spending anything.

## What was done about it

Nothing yet, deliberately. The collector, the registry and both pages work and
are committed. The jewel page renders what the market actually said, which is
187 rows of "1 exalted, +0". Publishing that would be a page that says nothing,
so the decision to publish, to redesign the question, or to drop jewels is left
open.
