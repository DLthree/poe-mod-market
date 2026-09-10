# The jewel sweep asks the wrong questions, and its output is wrong

Measured 2026-09-10 on Forbidden Rites. **Do not publish the jewel page. The
numbers in `eco-<league>-jewel.json` understate the market, badly.**

## What happened

A full jewel pass ran: 193 searches, 1930 listings, 42 minutes. It measured 187
modifier-cells and every single one banded low. Almost all floored at exactly 1
exalted, adding exactly 0 over a blank jewel.

The conclusion drawn from that was that the cheap end of the jewel market is
uniformly worthless and the floor statistic cannot price jewels. **That
conclusion was wrong**, and it was wrong in the most dangerous way available: the
measurements were all correct, the machinery all worked, and the answer was still
false because of which questions were never asked.

## The counter-example

`#% increased maximum Energy Shield`, asked of all six cells directly:

| cell | for sale | cheapest ten |
|---|---|---|
| Emerald magic | 0 | — |
| **Emerald rare** | **19** | **1 divine, 2, 2, 3, 3, 4, 9, 20, 35, 60 divine** |
| Ruby magic | 0 | — |
| **Ruby rare** | **10** | **2 divine, 5, 5, 50, 50, 50, 58, 70, 70, 80 divine** |
| Sapphire magic | 1409 | 3-5 exalted |
| Sapphire rare | 10000 | 1-2 exalted |

An Emerald rare blank floors at 1 exalted. `config.exchange` puts a divine at 200
exalted. So this modifier is worth on the order of 200x its blank on Emerald
rare, and the pass reported nothing about it at all.

**The sweep asked about it on Sapphire magic only.** Never on Emerald rare, never
on Ruby rare — the two cells where it is worth divines.

## Why

`affixesFor(db, type, rarity)` in `lib/sweep.mjs` builds loop 2's vocabulary
**per cell, from listings already collected for that cell**. Loop 1 collects the
`perCell` CHEAPEST listings of each cell. So a cell's vocabulary is "whatever the
ten cheapest jewels of this cell happen to carry".

Energy Shield is native to Sapphire. On Sapphire it is everywhere, so it is cheap
there and it does turn up in the cheap sample. On Emerald and Ruby it is rare —
which is exactly what makes it expensive — so it never appears among the ten
cheapest, and is therefore never asked about.

**Scarcity is what makes a jewel modifier valuable, and scarcity is what keeps it
out of a sample taken from the cheap end.** The bias selects against precisely
the rows worth finding.

This does not bite tablets in the same way. Tablet supply is thin enough that the
cheapest listings of a cell still carry its premium modifiers.

## Cross-seeding is not the fix

The obvious repair is to ask every cell about every modifier seen on any jewel
cell. Six such modifiers were asked of Emerald rare:

| for sale | modifier | cheapest |
|---|---|---|
| 0 | increased Fire Damage | cannot roll it |
| 0 | increased Chaos Damage | cannot roll it |
| 0 | increased Critical Hit Chance for Spells | cannot roll it |
| 0 | increased Melee Damage | cannot roll it |
| 1033 | increased Attack Speed | 1-3 exalted |
| 1094 | increased Cooldown Recovery Rate | 1-5 exalted |

Four are modifiers Emerald rare cannot roll at all, and two are common and
genuinely cheap. Cross-seeding would spend most of its searches on those.

## What the three probes together suggest

Untested as a rule, but it is what the numbers point at, and it is cheap to
check.

**Total-for-sale looks like the signal, and every search already returns it
free.** Across everything measured here:

| for sale | what it means | price |
|---|---|---|
| 0 | the base cannot roll it | no market |
| ~10-20 | the base rolls it rarely | 1-80 divine |
| 1000+ | common on this base | 1-5 exalted |

The dear modifiers sit in a narrow scarcity band. `res.total` comes back with
every search at no extra cost, and the archive already holds it inside every
stored search response — `runCell` in `lib/sweep.mjs` reads it and logs it, but
nothing persists it to a column.

## What to do next, undecided

1. **Store `total` on the snapshot.** It costs nothing, it is already in hand,
   and no analysis of the above can be done without it. This looks worth doing
   whatever else is decided.
2. **Seed the jewel vocabulary from GGG's stat table rather than from
   observation**, then let a first cheap pass measure `total` per modifier and
   spend the real searches only on the scarce band. Costs one search per
   candidate modifier to find out, which is the expensive part.
3. **Sample something other than the cheap end** for the vocabulary, since the
   floor still needs the cheap end but discovery does not.

## Status

The jewel collector, the item-kind registry and both pages work correctly. What
is wrong is the question loop 2 chooses, for jewels specifically.

`site/data/eco-forbidden-rites-jewel.json` is committed and is **not fit to
publish**: it reports a market of 1-exalted junk while 60-divine Emerald rares
are listed. Tablets are unaffected — their published numbers are unchanged and
were verified identical to the previous build.
