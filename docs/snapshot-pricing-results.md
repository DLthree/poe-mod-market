# Snapshot pricing: the numbers, and what needs deciding

Date: 2026-08-31. Task 5 of `docs/superpowers/plans/2026-08-31-snapshot-pricing.md`.
Read `docs/snapshot-pricing.md` first for why the old numbers were wrong.

**This is the artefact to assess. Nothing should be built on these numbers until
you have.**

---

## What ran

A full sweep at 23:19–23:58Z on 2026-08-31. It wrote **239 snapshots**, 238 of
them 20 listings deep. The one exception is `Overseer Tablet | Normal` at depth
2, which the trade window thins to almost nothing — `docs/two-windows.md`
predicted exactly that.

The comparison below runs **both algorithms over the same database**. BEFORE is
the code at `fe401af`, reading merged pools. AFTER prices each question from its
own snapshot. Every difference is the algorithm and nothing else.

## The fix works

Three cells moved the way `docs/snapshot-pricing.md` predicted from the
prototype:

| cell | before | after | the doc predicted |
|---|---:|---:|---|
| Abyss Tablet \| Rare | 1 ex | **50 ex** | 1 ex → 50 ex |
| Breach Tablet \| Rare | 1 ex | **15 ex** | a large rise |
| Overseer Tablet \| Normal | 1 divine | **100 ex** | the currency vote was deciding it |

And the modifier that started the whole investigation is dead:

| cell | modifier | before adds | after adds | verdict |
|---|---|---:|---:|---|
| Abyss \| Rare | 25-35% increased Gold found | +59 | **+0** | no longer meaningful |

`config.json` labels Gold found expected filler. Merged pools priced it at a 6.8x
lift. It now adds nothing, which is what a filler modifier should do.

## What needs deciding — 1. The floor rule is now the wrong one

**This is the most important finding, and it is new.**

Merging used to hide seller concentration. It cannot any more. Three cells are
now floored by a single account holding the cheap end of one snapshot:

```
Ritual Tablet | Rare, cheapest first:
  1e 1e 1e 1e 30e 30e 30e 49e 50e 50e 50e 50e 60e 60e ...
  the first four are ALL EXSAEVIO_#1093, listed within the hour
```

`nth-cheapest` with `n: 3` reads the third row and reports **1 exalted** for a
cell whose real body is 30 to 60. `Overseer | Rare` and `Temple | Rare` have the
same shape.

`nth-cheapest-seller` counts one account once. Swapping it costs nothing — the
rule is a seam in `lib/floor.mjs`, and rebuilding needs no new request:

| cell | depth | distinct sellers | nth-cheapest | nth-cheapest-seller |
|---|---:|---:|---:|---:|
| Abyss Tablet\|Normal | 20 | 14 | 90e | **95e** |
| Abyss Tablet\|Magic | 20 | 14 | 80e | 80e |
| Abyss Tablet\|Rare | 20 | 14 | 50e | 50e |
| Breach Tablet\|Normal | 20 | 14 | 50e | 50e |
| Breach Tablet\|Magic | 20 | 17 | 27e | 27e |
| Breach Tablet\|Rare | 20 | 18 | 15e | 15e |
| Delirium Tablet\|Normal | 20 | 12 | 24e | 24e |
| Delirium Tablet\|Magic | 20 | 17 | 3e | 3e |
| Delirium Tablet\|Rare | 20 | 18 | 1e | 1e |
| Irradiated Tablet\|Normal | 20 | 6 | 60e | 60e |
| Irradiated Tablet\|Magic | 20 | 10 | 10e | 10e |
| Irradiated Tablet\|Rare | 20 | 9 | 1e | 1e |
| Overseer Tablet\|Normal | 2 | 2 | 100e | 100e |
| Overseer Tablet\|Magic | 20 | 15 | 8e | 8e |
| Overseer Tablet\|Rare | 20 | 16 | 1e | **5e** |
| Ritual Tablet\|Normal | 20 | 19 | 200e | 200e |
| Ritual Tablet\|Magic | 20 | 14 | 120e | 120e |
| Ritual Tablet\|Rare | 20 | 14 | 1e | **49e** |
| Temple Tablet\|Normal | 20 | 13 | 38e | **40e** |
| Temple Tablet\|Magic | 20 | 17 | 34e | 34e |
| Temple Tablet\|Rare | 20 | 13 | 11e | **25e** |

It changes five cells, fixes the three broken ones, and barely moves the verdicts
elsewhere: 155 meaningful modifiers become 151.

`Delirium | Rare` stays at 1 exalted under both rules, and that is correct — all
twenty of its cheapest listings are 1 exalted across eighteen different sellers.
That cell really is worthless.

## What needs deciding — 2. `meaningful` changed, and it changed a lot

167 modifier rows moved enough to report. **50 of them changed verdict**: 41
became meaningful, 9 stopped being meaningful.

The nine that stopped are the ones you want: Gold found on Abyss rares, and six
low-value Irradiated modifiers that now add 0 or 1 exalted.

The 41 that started are the alone rule falling away. `lib/walk.mjs` vetoes a
modifier that never stands on a listing some stronger modifier does not already
explain. That rule is not applied any more, because it needs the merged pool we
removed — it cannot be run on snapshot data at all. **So this is not one rule
swapped for another; it is one whole approach for another.**

The question task 6 asks is whether that loss matters. The evidence is mixed:

- **For dropping the walk:** its main job was stopping a filler modifier from
  inheriting the floor of dear tablets. Snapshots do that job at the source, and
  Gold found is the proof.
- **Against dropping it:** a modifier that genuinely never appears without a
  stronger one is now priced from its own search, which returns exactly the
  tablets carrying the stronger one — so it reads as valuable. This is pinned as
  a test in `tests/api.test.mjs`. On Abyss rares, twelve modifiers became
  meaningful at once, which is what that looks like in bulk.

Nothing has been deleted. `steps/build-mod-table.mjs` still runs the walk, so
both numbers stay available.

## What needs deciding — 3. Magic cells lost their modifier prices

The emitted file now holds **308 modifier lines: 205 priced, 103 unpriced**.
Every unpriced one is on a magic cell.

The collector only sweeps modifiers on rares — `affixQuery` pins `rarity: rare` —
so we have never asked what a magic tablet carrying a given modifier costs.
Merged pools answered anyway, from rows collected for another question. Snapshots
will not, and report `floor: null, priced: false` instead.

That is honest, and it is a loss of published numbers. The fix, if you want one,
is to sweep modifiers on magic cells too, at the cost of more searches.

## Everything else

`Overseer Tablet | Normal` is 2 listings deep. It gets a floor of 100 exalted and
a listing count of 2, so a reader can see it is thin, but no threshold stops it
being published.

---

## Full cell floors, before and after

| cell | before | after | change |
|---|---:|---:|---|
| Abyss Tablet\|Magic | 100e | 80e | x0.80 |
| Abyss Tablet\|Normal | 90e | 90e | x1.00 |
| Abyss Tablet\|Rare | 1e | 50e | **x50.00** |
| Breach Tablet\|Magic | 20e | 27e | x1.35 |
| Breach Tablet\|Normal | 50e | 50e | x1.00 |
| Breach Tablet\|Rare | 1e | 15e | **x15.00** |
| Delirium Tablet\|Magic | 1e | 3e | x3.00 |
| Delirium Tablet\|Normal | 30e | 24e | x0.80 |
| Delirium Tablet\|Rare | 1e | 1e | x1.00 |
| Irradiated Tablet\|Magic | 9e | 10e | x1.11 |
| Irradiated Tablet\|Normal | 50e | 60e | x1.20 |
| Irradiated Tablet\|Rare | 1e | 1e | x1.00 |
| Overseer Tablet\|Magic | 4e | 8e | x2.00 |
| Overseer Tablet\|Normal | 1d | 100e | **currency changed** |
| Overseer Tablet\|Rare | 1e | 1e | x1.00 |
| Ritual Tablet\|Magic | 95e | 120e | x1.26 |
| Ritual Tablet\|Normal | 169e | 200e | x1.18 |
| Ritual Tablet\|Rare | 50e | 1e | **x0.02 — seller concentration, see above** |
| Temple Tablet\|Magic | 30e | 34e | x1.13 |
| Temple Tablet\|Normal | 40e | 38e | x0.95 |
| Temple Tablet\|Rare | 5e | 11e | x2.20 |

The full modifier table, all 167 rows, is in
`docs/snapshot-pricing-before-after.md`. It is generated, not hand-written, and
can be rebuilt from the archive at any time with no new request.
