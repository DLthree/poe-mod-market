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
node cli.mjs update                collect the test set, then rebuild   (under a minute)
node cli.mjs update --pools-only   only the type x rarity baselines     (~2 min)
node cli.mjs update --full         every cell                           (~1 hour)
node cli.mjs serve                 the read-only web view, port 8787
node cli.mjs audit                 check stored rows against what GGG sent
node --test "tests/*.test.mjs"
```

`node cli.mjs update` defaults to a ten-modifier test set so the pipeline can be exercised
without spending a day's rate allowance. A full pass is roughly 330 searches.

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

Both need at least 12 listings from 5 distinct sellers. Set them in `config.json` under
`walk`.

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
