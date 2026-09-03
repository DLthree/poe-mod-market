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
node cli.mjs update                EVERY cell, then rebuild   (~1 hour, ~390 searches)
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
```

Use `--rarities` when only part of the data is stale: re-asking about rares that are a few
hours old spends 200 searches to learn what you already know. After collecting this way,
rebuild the derived table with `node steps/build-mod-table.mjs`.

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

Bands, against the floor of a blank tablet of the same kind:

| band | rule | on the page |
|---|---|---|
| high | at least 2.1x the blank floor | copper, bold, ticked by default |
| mid | at least 1.5x | plain white |

Both need at least 12 listings from 5 distinct sellers, **and** the modifier must add at
least 10 exalted over a blank tablet. Set all of it in `config.json` under `walk`.

That last one is the absolute companion, and it exists because a ratio against a junk
floor is trivially cleared: where a blank tablet costs 1 exalted, 2.1x it is 2.1 exalted,
and a modifier "worth twice the tablet" is worth about nothing. It only bites where the
blank is cheap — it took Irradiated rare from 6 high modifiers to 0 and Overseer magic
from 24 to 10, and changed nothing on Abyss, Breach, Ritual or Temple.

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
  `lib/poe2.mjs`) and every search pins it at `min: 10`. It has to be asked of GGG: a
  fetched item reports `magnitudes: {min: 10, max: 10}` whatever it has left, and the real
  count is only in the printed line.
- **No `collapse`.** It folds a seller's duplicate listings server-side, discarding data
  the archive exists to keep.
- **`indexed`, the trade window.** How old a listing may be on the market before GGG will
  return it. Not the same axis as `lookbackHours`, which bounds how far back through our
  own archive we read — `docs/two-windows.md` before touching either.

Nothing here converts a currency or holds an exchange rate. The server ranks exalted
against divine itself when it sorts by price, and that ordering is stored as `rank`.

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
