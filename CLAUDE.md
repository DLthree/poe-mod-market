# Working in this repo

Read `README.md` first — it is accurate and it is the spec. This file is only the things
an agent gets wrong here that a human would not.

## Before you spend rate allowance

**`node cli.mjs update` is a FULL PASS.** About an hour, ~390 searches, most of a day's
allowance against GGG. There is no confirmation prompt: `update` passes `--full
--i-mean-it` to the collect step itself. It takes no `--full` flag and exits 2 if given
one.

The cheap run is `node steps/collect.mjs` — the ten-modifier test set, under a minute.
**Run it first** after any change to the query or the sweep, and check what came back,
before spending an hour on a pass that might be collecting the wrong thing.

**A request cannot be bought back.** Never run two collections at once: the rate-limit
ledger is one file on purpose, because GGG counts per IP and per account, and two
sweeps racing it will earn a restriction.

`node steps/collect.mjs --full --i-mean-it --rarities magic` refreshes one rarity. Use it
when only part of the data is stale.

## Running anything at all

**Use the PowerShell tool, and Windows node.** This repo lives on the WSL share, but
there is no node inside WSL. Bash here is Git Bash on Windows: fine for reading files
and for git, but use PowerShell to start or stop the server.

**Git Bash cannot `mkdir` a new UNC root.** Creating a directory under
`\\wsl.localhost\` needs PowerShell.

**Never `import()` a step to "check it loads".** `steps/collect.mjs` runs on import and
will start a real collection. That mistake cost 14 searches on 2026-09-01.

**Do not query `request.at` against `datetime('now')`.** SQLite returns
`YYYY-MM-DD HH:MM:SS` and `at` is ISO with a `T`; `'T' > ' '`, so every row from today
compares greater and the window silently matches everything. Compute the bound in JS and
pass it as a parameter.

## The database

**It is not in this repo and cannot be.** SQLite cannot run on the WSL share — every
journal mode, and even a bare `CREATE TABLE`, fails with "database is locked". It lives
in `%LOCALAPPDATA%\poe2-tablet-price\`. A script that opens a relative path will create
an empty database on the share and then fail.

That directory also holds small leftovers from testing. **Never treat every `*.db` as a
league**: `lib/leagues.mjs` lists a league only if it holds a snapshot under its own
name.

## The phase boundary

Phase 1 collects and archives; phase 2 reads the derived tables and makes no network
call. `tests/contract.test.mjs` assumes **any unlisted module in `lib/` is phase 2** and
fails it for naming the request table or touching a client. A new phase-1 module has to
be added to that EXEMPT list, deliberately.

**Every call to GGG is archived, and `TradeClient` will not construct without an
`archive` function.** For a throwaway probe use `fileArchive(dir, { label })` from
`lib/request-log.mjs`.

**Every price comes from the snapshot of the search that asked for it.** Do not merge
rows from different searches to answer a question: `rank` is a position within one
search, so a merge stacks every rank-0 row at the front in no price order.
`docs/snapshot-pricing.md` has the measurement.

## Verifying

`node --test "tests/*.test.mjs"` — 278 pass. Then, for anything that changes what is
published:

- `node cli.mjs audit` after a sweep.
- `node cli.mjs build` and check `site/data/` actually changed.
- **Restart the server after changing anything under `lib/`.** Node holds modules in
  memory; static files are re-read per request, so HTML, CSS and `app.js` do not need it.
  A stale server serving pre-change logic over new rows has cost real time here.

**There is no browser automation installed, so no agent has seen this page render.**
Every check is a data-level replay. That is exactly how a CSS fault shipped once: the
modifier card never hid, because `.card` sets `display:flex` and an author rule beats the
browser's own `[hidden]` rule. If a change is visual, say plainly that it has not been
looked at.

## Publishing

`site/` is committed, and a push touching it deploys to
https://dlthree.github.io/poe-mod-market/ . **CI does not build** — it cannot, the
archive is not in the repo — so the build runs here and the output is committed. Nothing
in CI can reach GGG and no secret belongs there.

`.gitignore` patterns must stay anchored. An unanchored `data/` also matched `site/data/`
and silently kept the published JSON out of the first commit; `tests/gitignore.test.mjs`
asks git directly so that cannot recur.

## Conventions

- **Write replies in ASD-STE100 (Simplified Technical English).** Short sentences, active
  voice, one idea per sentence. No jargon, metaphors or invented terms.
- Scripts do mechanical work. **Item value is brain work — no scoring script.**
- `secrets.json` holds the live POESESSID, is gitignored, and is never printed. Seller
  account names appear in collected data and must not be published; the economy file
  carries none, and `tests/economy.test.mjs` is what keeps that true.
