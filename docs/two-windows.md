# The two windows

There are two time windows in the tablet pricing pipeline. They sit on different
axes, they filter different columns, and they answer different questions. Neither
replaces the other.

This document exists because they were confused for each other on 2026-08-30, and
the confusion survived a spec, a plan, a commit and two code reviews before the
user caught it.

---

## Window A — the trade window

**Question it answers:** how old may a listing be on the market before we refuse
to collect it?

- **Filters:** GGG's `indexed` timestamp, which is when the seller listed the item.
- **Where it is set:** `config.json`, `tradeWindow`. A trade-site option string.
- **Where it acts:** in the search body we POST to GGG, at
  `filters.trade_filters.filters.indexed.option`. Built in `lib/sweep.mjs`.
- **Valid values:** `1day`, `3days`, `1week`, `2weeks`, `1month`, `2months`.
  Read out of the exiled-exchange-2 checkout on 2026-08-30.
- **Default:** `3days`. The trade site offers this for free, so it costs us
  nothing to ask for it.

Its effect is that every row entering the archive was fresh at the moment we
fetched it. It is a filter on what we are willing to collect.

`lib/trade-url.mjs` carries the same filter, so a trade link shows the same slice
of the market we priced. Without that, the link shows a wider one and the
comparison misleads.

## Window B — the lookback window

**Question it answers:** how far back through our own archive do we read?

- **Filters:** `observed_at`, which is our own request's timestamp — when we
  fetched the row.
- **Where it is set:** `config.json`, `lookbackHours`.
- **Where it acts:** `readListings` in `lib/pools.mjs`, `WHERE observed_at >= ?`.
  Every caller of `readListings` passes it. Since 2026-08-31 it also acts in
  `latestSnapshot` and `listSnapshots` in `lib/snapshots.mjs`, as
  `WHERE taken_at >= ?`. `taken_at` is the same axis as `observed_at` — our own
  clock — so this is one window under two readers, not a third window. Without
  it, "the newest snapshot" has no age bound and last month's answer publishes
  as today's.
- **Default:** 72 hours. It may sensibly be one day or a hundred days.

Its effect is to choose how many past sweeps get merged into one pool. We keep a
historical archive of listings that were new-ish when collected; this window says
how much of that history to look at.

Because it is our clock, not the market's, it can never make a stale listing
fresh. It can only decide whether an old *observation* is included.

---

## Why they are not the same thing

Measured against the live database on 2026-08-30, before window A existed:

```
distinct listings held            : 4404
pass a 72h lookback (observed_at) : 4404
  ...but POSTED over 72h ago      : 705  (16.0% of them)

market age (indexed)   min 4.4h  median 25.0h  max 1880.3h
when WE fetched it     min 4.3h  median 4.9h  max 31.4h
```

Every row had been fetched within 31 hours, so every row passed a 72-hour
lookback. Their ages on the market ran to 1880 hours — 78 days. Sixteen percent
were older than 72 hours and were included anyway.

Those old rows are in the archive because **window A did not exist**. We never
asked GGG to exclude them. Widening window B from 48 to 72 changed nothing, and
could not have: there was nothing in our own request history between 48 and 72
hours old to admit.

## The failure mode to avoid

Setting window B and believing you have set window A.

That reads as "we are pricing against the last three days of the market" when it
actually means "we are reading the last three days of our own sweeps", and those
sweeps may contain listings from months ago. Prices then come from items nobody
has bought in weeks.

The reverse mistake is milder but real: setting window A and believing it bounds
how much history you read. It does not. A row collected 100 days ago was fresh
when collected and stays in the archive until window B excludes it.

## A third setting, unrelated to both

`config.json` has `floor.windowHours`, currently 24. It belongs to the floor
strategy and is read by `lib/floor.mjs`. It is not either of the windows above,
and renaming it changes how every floor is computed. Leave it alone.

---

## Status

Window B has existed throughout, under the name `windowHours`.

Window A, and the rename of `windowHours` to `lookbackHours`, land together in
the commit "Separate the trade window from the lookback window". Before that
commit, no search we sent carried an `indexed` filter.

**One consequence of turning window A on.** Each search returns fewer listings,
because GGG drops the old ones. Thin cells get thinner. `Overseer Tablet Normal`
held 14 listings against a `minListings` of 12, and 93% of them are corrupted, so
it may fall below the threshold. That is the correct outcome, not a loss.
