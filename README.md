# poe-mod-market

Prices Path of Exile 2 Precursor Tablets against the official trade API, and turns the
result into a stash search you can paste into the game.

The question it answers is "which modifiers on which tablets are worth money, and how do I
find them in my stash". It collects live listings into a SQLite archive, one search per
question, then reports what every tablet type and every modifier floors at.

No dependencies. Node 24 or newer, for `node:sqlite`.

## Two phases, with a database between them

- **Phase 1 collects.** `steps/collect.mjs` searches the trade API and archives every
  request together with its complete response.
- **Phase 2 analyses.** `lib/summary.mjs` and everything downstream read the database and
  make no network call at all.

Phase 2 does not know which collector filled the database, so a different collector is a
drop-in replacement. `tests/contract.test.mjs` enforces that as a rule about the source.

**Every price comes from the snapshot of the search that asked for it.** Phase 1 records
the question each search asked and stamps every listing row with it; phase 2 prices that
question from those rows alone. Merging pools priced things wrongly in both directions —
`docs/snapshot-pricing.md` has the account.

## Running it

```
node cli.mjs update                EVERY cell, then rebuild  (~2 hours, ~460 searches)
node cli.mjs update --quick        baselines + the modifiers already worth 1.5x
                                                             (~35 min, ~135 searches)
node cli.mjs update --pools-only   only the type x rarity baselines        (~2 min)
node cli.mjs serve                 the read-only web view, port 8787
node cli.mjs audit                 check stored rows against what GGG sent
node cli.mjs build                 write the static site into site/
node --test "tests/*.test.mjs"
```

**`node cli.mjs update` is the full pass.** It passes `--full --i-mean-it` to the collect
step for you, so there is no confirmation to type and no cheap default hiding behind it:
it spends about an hour and most of a day's rate allowance. `update` takes no `--full`
flag and exits 2 if given one.

The cheap run is the collect step directly — one tablet type and ten modifiers, about 13
searches and under a minute:

```
node steps/collect.mjs                                        the test set
node steps/collect.mjs --full --i-mean-it                     every cell
node steps/collect.mjs --full --i-mean-it --rarities magic    one rarity  (181 searches)
node steps/collect.mjs --full --i-mean-it --types "Temple Tablet"    one tablet kind
```

Use `--rarities` or `--types` when only part of the data is stale: re-asking about rares
that are a few hours old spends 200 searches to learn what you already know, and a pass
that stops one cell short should not cost 500 searches to finish. Both take a comma
separated list and refuse a name the game cannot supply. After collecting this way,
rebuild the derived table with `node steps/build-mod-table.mjs`.

**GGG counts searches and fetches separately, and both caps matter.** An IP may make 600
searches and 1000 fetches in any six hours. A full pass is about 520 searches, and at
`perCell` 10 about 520 fetches, so searches are the binding limit and two full passes
inside one six-hour window will not fit. A pass that runs into the cap does not fail: the
limiter parks until the window rolls, which on 2026-09-08 meant a six-hour pause in the
middle of a run.

### The quick pass

`node cli.mjs update --quick` re-asks every baseline and only those modifiers the last
pass already measured at `quick.minRatio` or better. On Forbidden Rites that is 24 pool
searches plus 111 modifier searches, about a sixth of a full pass.

**It refreshes; it cannot discover.** A modifier that was cheap yesterday and is dear
today is not in the selection, so it keeps its old floor until a full pass. One nobody has
ever asked about is invisible to it, because it has no ratio to compare. That is the whole
trade, and `tests/refresh.test.mjs` pins it as a test rather than a footnote.

What keeps the published numbers honest is that **every baseline is re-asked in full**.
The floors above them are then at most `lookbackHours` old, which is the same bound that
already applies after `--rarities` or any other partial pass — phase 2 reads the newest
snapshot of each question inside that window and nothing older.

The threshold is 1.5 rather than the 2.1 high band on purpose. The modifiers worth
watching are the ones near the line, not the ones already over it.

**The database is not in this repo.** It goes to `%LOCALAPPDATA%\poe2-tablet-price\` on
Windows, or the equivalent under `XDG_DATA_HOME`. Override with `--data` or
`TABLET_DATA_DIR`.

**Collection needs a session cookie.** Put it in `secrets.json` at the repo root, which is
gitignored:

```json
{ "POESESSID": "..." }
```

Search and fetch do not strictly need it, but a dead cookie fails quietly, so keep it
fresh. Nothing in phase 2 or in the web view reads it, and the server never holds it.

## The web view

`node cli.mjs serve` opens a page that reads two things and calls GGG for neither: the
economy file and one regex fragment per modifier. Pick a tablet type, and the modifiers
worth money are already ticked; the box at the top is the stash search, under the game's
250-character limit.

The trade link asks for **any one** of the ticked modifiers, not all of them. A tablet
carrying every modifier you ticked usually does not exist, and it is not what any price
here measured: each price is a single-modifier search, so the link is their union.

### Two measurements, kept apart

Every modifier carries two numbers that answer two different questions, and the whole
point is that neither one is allowed to speak for the other.

`affixRatio` is what it is **worth**: its floor over the floor of a blank tablet of the
same type and rarity. `fewSamples` is how much **evidence** stands behind that price:
true below 8 listings or 2 distinct sellers.

Both thresholds sit below `perCell`, the 10 listings one search keeps, so the flag means
the market held few listings and not that we only looked at a few. They were 12 and 5 when
a search kept 20; a threshold above the cap would flag every row in the file.

Bands come from `affixRatio` alone, in `lib/bands.mjs`, which the page imports and
applies itself:

| band | rule | on the page |
|---|---|---|
| high | at least 2.1x the blank floor | copper, bold, ticked by default |
| mid | at least 1.5x | plain white |
| low | below that, or adds under 10 exalted | dim grey |
| none | no comparable price at all | dim grey, italic |

`low` and `none` are different answers. `low` means we measured it and it is not worth
much. `none` means we cannot say: the modifier is unpriced, or priced in a currency
`config.exchange` holds no rate for, so no ratio exists. Set the thresholds in
`config.json` under `walk`; they are published in the economy file so the page and the
build cannot disagree.

`adds` is stated in exalted whatever the two sides were quoted in, because the 10 exalted
minimum below is a threshold in exalted and a number that changed unit per cell could not
be compared to it. On the divine-priced Expedition cells it used to be a divine number, so
a modifier adding one divine failed a ten-exalted test it clears a hundred times over.

**A thin sample never changes a band.** It once did, and that was a real bug: a Delirium
rare modifier at 18x the blank tablet on four sellers came out identical to filler at
1.1x on ninety, because both were called unbanded. Early in a league the genuinely rare
modifiers are precisely the ones with thin evidence, so suppressing them hid the rows
worth finding. The evidence is now reported beside the price, as a dotted listing count
with the numbers on hover, and it is yours to judge.

The modifier list sorts by **price in exalted, dearest first** — never by band. Prices in
a currency with no rate sort after the ones that can be placed, and unpriced modifiers
last, because ranking them on a raw number that means something else is how the list came
to look alphabetically sorted. Exalted rather than the raw amount for the same reason: on
the amount alone a one-divine modifier read as cheaper than a thirty-eight-exalted one.

The 10 exalted minimum is the absolute companion, and it exists because a ratio against a
junk floor is trivially cleared: where a blank tablet costs 1 exalted, 2.1x it is 2.1
exalted, and a modifier "worth twice the tablet" is worth about nothing. It only bites
where the blank is cheap — it took Irradiated rare from 6 high modifiers to 0 and Overseer
magic from 24 to 10, and changed nothing on Abyss, Breach, Ritual or Temple. Falling short
of it lands a modifier in `low`, because that is a measurement, not an absence of one.

2.1 rather than a round 2.0 because prices cluster on round multiples of the blank floor:
34 modifiers floored at exactly 2.00x, two dozen of them on one cell.

## Publishing it

The page is static. It fetches three JSON files and no API at all, so it can be
served from anywhere that serves files:

```
data/leagues.json              which leagues exist, and which to open
data/eco-<league>.json         every cell and every modifier, summarised
data/fragments-<league>.json   one regex fragment per modifier
```

`node cli.mjs build` writes those, the page, and the three modules the page
imports, into `site/`. Every path in the page is relative, so the same files work
at a domain root and under `/poe-mod-market/`.

Live at **https://dlthree.github.io/poe-mod-market/**. The whole deploy loop:

```
node cli.mjs update                        collect everything    (~1 hour)
node cli.mjs audit                         check it against what GGG sent
node cli.mjs build                         write site/
git add site && git commit && git push     deploys itself
```

`.github/workflows/pages.yml` uploads `site/` to GitHub Pages on any push that
touches it. **It does not build.** The build reads the SQLite archive, which is
not in this repo and cannot be, so the build runs on the machine that holds the
archive and `site/` is committed. Nothing in CI can reach GGG, and no secret is
configured there.

Pages is already enabled with **GitHub Actions** as the source. If it is ever
reset, `configure-pages` fails with "Please verify that the repository has Pages
enabled" — that is what it means, and the fix is the repository's Settings →
Pages, not the workflow.

`node cli.mjs serve` answers those same three paths, computed live from the
database, so the local page is the published page rather than something that
resembles it. `tests/site.test.mjs` holds that line: it fails if the page asks
for a file the build does not write, or if any path is rooted at `/`.

## What the query asks for, and why

Each setting cost a measurement:

- **`securable`, never `online`.** Two different markets with no overlapping listings.
  `securable` is about 20x larger and every row is a real buyout.
- **`exalted_divine`, never a single currency.** Filtering to `divine` hides everything
  below one divine, and thousands of tablets sit at exactly one divine.
- **A full tablet only.** Every tablet carries an implicit — "Adds Abysses to a Map" —
  with its uses remaining underneath. The stat id is per tablet type (`USES_IMPLICIT` in
  `lib/poe2.mjs`) and every search pins it at `min: 10` — as does the trade link the page
  hands you, so it opens the same market the price came from. It has to be asked of GGG: a
  fetched item reports `magnitudes: {min: 10, max: 10}` whatever it has left, and the real
  count is only in the printed line.
- **No `collapse`.** It folds a seller's duplicate listings server-side, discarding data
  the archive exists to keep.
- **`indexed`, the trade window.** How old a listing may be on the market before GGG will
  return it. Not the same axis as `lookbackHours`, which bounds how far back through our
  own archive we read — `docs/two-windows.md` before touching either.

**No stored price is ever converted.** A listing keeps the amount and currency GGG sent,
and a floor comes from the `rank` the server's own price ordering gave it — GGG compares
exalted against divine with a rate we do not hold, and that ordering is exact.

`config.json` does hold one approximate table, under `exchange`, and it buys back exactly
one thing: comparing a modifier to a baseline quoted in a different currency. Before it,
the eleven dearest modifiers in Forbidden Rites published as "cannot say" and went
uncoloured, which is the failure the band split exists to prevent. `affixRatio`, `adds`
and the order of the list use it; nothing else does, and every row that leaned on it
carries `assumedRate` so a number resting on a standing guess does not read the same as
one resting on GGG's ordering. A currency the table has no entry for is still refused
rather than assumed to be worth one exalted.

## Rate limits

`lib/rate-limiter.mjs` keeps one ledger on disk, because GGG counts per IP and per
account: two ledgers would earn a restriction. Set `TRADE_RATELIMIT_LEDGER` only in tests,
so a test run never reserves a real slot.

**Every call to GGG is archived, and `TradeClient` will not construct without an `archive`
function.** A request spends allowance that cannot be bought back, so the response it paid
for has to survive — including 429s and non-JSON error bodies.

## Credits

`vendor/ee2-stats.ndjson` is [Exiled Exchange 2](https://github.com/Kvan7/Exiled-Exchange-2)'s
generated stat table (MIT), used as an overlay on GGG's own `/data/stats`: each holds
wordings and ids the other lacks, so both are loaded. See `vendor/PROVENANCE.md`.

Not affiliated with or endorsed by Grinding Gear Games.
