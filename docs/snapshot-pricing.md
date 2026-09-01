# Snapshot pricing

Date: 2026-08-31. Written after a user spot-check found a filler modifier priced
at +149 exalted.

## The decision

**Every search asks exactly one question, so use its own snapshot to answer only
that question.** Never merge searches into a pool.

- A **snapshot** is one `search` request plus the `fetch` requests that follow it
  for the same cell, before that cell's next search. It is the cheapest `perCell`
  listings at one instant, in the order GGG itself ranked them.
- The **pool search** asks "what does a blank tablet of this type and rarity
  floor at?" Its snapshot answers that, and nothing else.
- Each **affix search** asks "what does a tablet of this type and rarity carrying
  this modifier floor at?" Its snapshot answers that, and nothing else.

Today the code does the opposite. It merges every search touching a cell into one
heap, then re-derives a modifier's pool by filtering on "has this modifier". That
drags in rows from searches that were asking about something else.

## Why merging is wrong

`rank` is a listing's position **within the one search that returned it**. Every
search numbers its own results from zero. `lib/floor.mjs` sorts on rank first and
falls back to price only when ranks tie, so merging stacks every rank-0 row from
every search at the front, in no price order at all.

Measured on `Overseer Tablet | rare`, which is fed by **29 distinct searches**
across 158 fetch responses:

```
BY PRICE (what a floor should use)     BY RANK (what byPrice does)
    5 ex   rank=   0                       5 ex   rank=   0
    9 ex   rank=null                      10 ex   rank=   0
    9 ex   rank=null                     150 ex   rank=   0   <- 3rd = the floor
    9 ex   rank=   7                      10 ex   rank=   1
```

Three separate rank-0 rows, priced 5, 10 and 150, each the cheapest result of a
different search. `nth-cheapest` with `n: 3` reads the last and reports 150.

The same effect runs the other way on baselines. `Abyss Tablet | rare` showed
eight 1-exalted rows in its cheapest ten, nearly all rank 0, harvested from eight
different searches at four different times — so the merged floor read 1 ex. In the
single instant of the 05:59 sweep there was **one** 1-ex Abyss rare, and the third
cheapest was **50 ex**.

**The merge manufactures a cheap end that never existed at any one moment.**

## Why a snapshot is coherent

Checked on three cells from the 2026-08-31 sweep:

```
Abyss Tablet|rare      rank: 0  1  2  3  4  5 ...
                      price: 1 39 50 50 50 58 ...    rank order == price order? YES
Overseer Tablet|rare  price: 1  1  9  9  9  9 ...    YES
Breach Tablet|rare    price: 1  1  2 15 15 20 ...    YES
```

Inside a snapshot, rank order *is* price order.

That matters most for currencies. GGG ranks exalted against divine itself, using
a rate we do not have. A snapshot preserves that ranking, so **the currency
majority vote in `lib/floor.mjs` becomes unnecessary** — see "What this replaces".

## Validation

The modifier that started this, `12-18% increased Experience gain` on rare
Overseer Tablets — a modifier `config.json` labels expected filler:

| | Floor |
|---|---|
| Merged, today | 150 ex → `adds +149`, `meaningful: true` |
| Snapshot | **10 ex** |
| Live trade API, same query, 30 minutes later | **10 ex** (1, 5, 10, 10, …) |

## What this replaces

`dominantCurrency` in `lib/floor.mjs` takes a majority vote by row count and
discards every row in the losing currency. A strict `>` means a tie is won by
whichever currency appeared first in row order.

Measured across all 21 cells: 19 are 100% exalted, so the vote is inert. It acts
on two cells and 13 rows of 5815. But on `Overseer Tablet | Normal` it is decided
by **one row** — 8 divine against 7 exalted — and among the seven it discards,
**three carried rank 0 or 1**, meaning GGG's own sort called them the cheapest in
the search. They were 89 and 100 exalted. The cell then reports 1 divine.

Every snapshot measured held exactly one currency, so within a snapshot the vote
has nothing to decide.

## What it costs

A snapshot is `perCell` rows deep, currently 20. `docs/HANDOFF.md` already pairs
this change with raising `perCell` to 100, and this is why: depth stops coming
free from merging.

`adds` still cannot be computed across currencies. If a baseline snapshot's floor
lands on an exalted listing and a modifier snapshot's lands on a divine one, the
difference is `null`. That is honest and unavoidable without an exchange rate. It
becomes rarer, not impossible.

## Alternatives, recorded rather than chosen

Both were raised by the user on 2026-08-31 and are worth keeping.

**1. A smarter merge, using same-currency listings as anchor points.** Rather than
abandoning merged pools, interleave the separate rankings by aligning them on
listings that share a currency, so the relative order of two searches' results can
be inferred. Keeps the depth that merging buys. Costs an inference step whose
error is unbounded when two searches share few anchors.

**2. Drop divine from the search entirely and operate strictly in exalted.**
The trade filter already takes a price option — `exalted_divine` today. Narrowing
it removes the cross-currency problem at the source rather than solving it. Costs
visibility of the dear end of the market, where divine pricing is normal, so the
most valuable tablets would go unpriced.

Neither is needed if snapshots work. Both are cheaper to reach for than a rewrite
if snapshots turn out to be too thin.

## Status

**Implemented 2026-08-31**, tasks 1 to 4 of
`docs/superpowers/plans/2026-08-31-snapshot-pricing.md`. Phase 1 stamps every
listing with the question it answers; phase 2 prices each question from its own
snapshot. Verified against the live API: ranks run 0 to 19 inside a snapshot and
the prices are monotonic, so rank order is price order.

Three things were decided during implementation that this document did not
anticipate.

**A cell that fails part way through leaves no snapshot.** The client throws on a
non-JSON body, on an error field, and after repeated 429s, and any of those ends
a sweep with a cell in flight. A half-filled snapshot would be the most recent
answer to its question and would shadow the last good one. The rows already
collected stay, with their stamp removed. One rule follows: an empty snapshot can
only mean the market held nothing.

**The currency vote could not be deleted outright.** Inside a snapshot it is
gone, exactly as argued above. But `lib/api.mjs` `price()` and `lib/lookup.mjs`
still floor arbitrary filtered pools of archive-replayed rows, which carry no
rank; there an amount is the only ordering left, and it means nothing across
currencies. A pool is now reduced to its most common currency **only when it is
not fully ranked**.

**`lookbackHours` bounds how old a snapshot may be.** Without it, "the newest
snapshot" had no age bound at all and last month's answer would publish as
today's. `taken_at` is our own clock, so this is window B under a new reader —
see `docs/two-windows.md`.

The alone rule in `lib/walk.mjs` is no longer applied to `meaningful`, which is
now a plain threshold on the snapshot floor. Task 6 measures the two against each
other. One case where they disagree is already recorded in `tests/api.test.mjs`:
a modifier that never appears without a stronger one is priced from its own
search, which returns exactly the tablets carrying the stronger one, so it reads
as meaningful where the alone rule vetoed it.
