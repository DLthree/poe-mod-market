# Working in this repo

Read `README.md` first. It is the spec and it is accurate. This file holds only the
errors an agent makes here that a human does not.

## Before you spend rate allowance

**`node cli.mjs update` is a FULL PASS.** It uses most of a six-hour allowance against
GGG. There is no confirmation prompt: `update` passes `--full --i-mean-it` to the collect
step itself. `update` takes no `--full` flag and exits 2 if you give it one.

The cheap run is `node steps/collect.mjs`. It asks the test set and takes less than a
minute. **Run it first** after any change to the query or the sweep. Read what came back
before you start a full pass that can collect the wrong thing.

**A request cannot be bought back.** Never run two collections at the same time. The
rate-limit ledger is one file on purpose, because GGG counts per IP and per account. Two
sweeps against one ledger will earn a restriction.

`node steps/collect.mjs --full --i-mean-it --rarities magic` refreshes one rarity. Use
`--rarities` or `--types` when only part of the data is stale.

**Disable sleep before a long unattended pass.** Windows suspends the machine and the
pass stops. There is no error, and it looks like a hang. Set both timeouts to zero, and
restore them after:

```
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
```

**Back up the archive after every sweep:** `pwsh ./backup-data.ps1`. It copies the data
directory to `%USERPROFILE%\Backups\poe2-tablet-price\<timestamp>` and verifies every
file by SHA256. Stop node first. The script refuses to copy while node holds the
databases open.

## Running anything at all

**Use the PowerShell tool, and Windows node.** This repo is on the WSL share, but there
is no node inside WSL. Bash here is Git Bash on Windows. Use Bash to read files and to
run git. Use PowerShell to start or stop the server.

**Git Bash cannot `mkdir` a new UNC root.** Use PowerShell to create a directory under
`\\wsl.localhost\`.

**Never `import()` a step to check that it loads.** `steps/collect.mjs` runs on import
and starts a real collection. That error has spent real searches.

**Do not compare `request.at` with `datetime('now')`.** SQLite returns
`YYYY-MM-DD HH:MM:SS` and `at` is ISO with a `T`. `'T'` is greater than a space, so every
row from today compares greater and the window matches all rows. Compute the bound in JS
and pass it as a parameter.

## The database

**It is not in this repo and cannot be.** SQLite cannot run on the WSL share. Every
journal mode fails, and a bare `CREATE TABLE` fails, with "database is locked". The
database is in `%LOCALAPPDATA%\poe2-tablet-price\`. A script that opens a relative path
creates an empty database on the share and then fails.

That directory also holds small leftovers from tests. **Do not treat every `*.db` file as
a league.** `lib/leagues.mjs` lists a league only if it holds a snapshot under its own
name.

## Item kinds

**All data particular to an item kind is in `lib/item-kinds.mjs`:** the base types, the
filters a search pins, the affix caps and the page labels. `lib/poe2.mjs` holds only what
the trade API is and what a rarity is. A new kind needs no change outside the registry
and the places that name a kind by key.

**Both phases call `kind.pinned(type)`.** The sweep throws if a filter is missing,
because a search that drops a filter asks a different question from the one it records.
The trade link degrades and reports why. `exact` on a link means the link carries every
group the sweep pinned.

`--kind` on `steps/collect.mjs` defaults to tablet, so every command above means what it
always meant. `config.json` keys `testSet` by kind. A kind with no test set refuses the
cheap run. It does not fall through to a full pass.

## The phase boundary

Phase 1 collects and archives. Phase 2 reads the derived tables and makes no network
call. `tests/contract.test.mjs` treats **any unlisted module in `lib/` as phase 2** and
fails it if it names the request table or touches a client. Add a new phase-1 module to
that EXEMPT list deliberately.

**Every call to GGG is archived, and `TradeClient` will not construct without an
`archive` function.** For a throwaway probe, use `fileArchive(dir, { label })` from
`lib/request-log.mjs`.

**Every price comes from the snapshot of the search that asked for it.** Do not merge
rows from different searches to answer one question. `rank` is a position in one search,
so a merge puts all the rank-0 rows first and not in price order.
`docs/snapshot-pricing.md` has the measurement.

## Verifying

Run `node --test "tests/*.test.mjs"`. All tests must pass. Then, for any change to what
is published:

- `node cli.mjs audit` after a sweep.
- `node cli.mjs build`, then confirm that `site/data/` changed.
- **Restart the server after a change under `lib/`.** Node holds modules in memory.
  Static files are read again for each request, so HTML, CSS and `app.js` need no
  restart. A stale server serves old logic over new rows.

**If a sweep reports that a whole market is worthless, suspect the sampling.** The
measurements can all be correct and the conclusion still wrong, because the sweep never
asked about the dear modifiers. `docs/jewel-vocabulary-bias.md` has the example.

**A CSS fault shipped here once**, because every check replayed data only. The modifier
card never hid, because `.card` sets `display:flex`, and an author rule wins against the
browser rule for `[hidden]`. No check in node can find that.

**`agent-browser` is blocked.** Deny rules in `.claude/settings.json` stop it, because
its first `open` after installation gave no output for more than two hours. Do not remove
the deny rules to try it again. That file records what is known and what must be found
out first. For a visual check, run `node cli.mjs serve` and ask the user to look. Both
pages were screenshotted once and are correct. If a change is visual and you did not look
at it, say so.

## Publishing

`site/` is committed, and a push that touches it deploys to
https://dlthree.github.io/poe-mod-market/ . **CI does not build.** It cannot, because the
archive is not in the repo, so the build runs here and the output is committed. Nothing
in CI can reach GGG, and no secret belongs there.

`.gitignore` patterns must stay anchored. An unanchored `data/` also matched `site/data/`
and kept the published JSON out of the first commit. `tests/gitignore.test.mjs` asks git
directly, so that cannot occur again.

## Handoffs

**Write them in `docs/handoffs/`, not in the OS temp directory.** Two were written to
`%TEMP%` before this rule and were almost lost. `docs/handoffs/README.md` gives the
naming and the content.

A handoff says what the next session is FOR. Put durable facts in a document of their
own and refer to it by path. A fact that lives only in a handoff is read once and then
lost.

## Conventions

- **Write replies in ASD-STE100 (Simplified Technical English).** Short sentences, active
  voice, one idea in each sentence. No jargon and no invented terms.
- Scripts do mechanical work. **A person judges item value. Do not write a scoring
  script.**
- `secrets.json` holds the live POESESSID. It is gitignored and must never be printed.
  Seller account names are in the collected data and must not be published. The economy
  file holds none, and `tests/economy.test.mjs` keeps that true.
