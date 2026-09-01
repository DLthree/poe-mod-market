# A single CLI for the tablet sweep

Date: 2026-08-30. Written before implementing, for review in the morning.

## What this is for

The tablet tooling works but has no front door. There are eight executables in
`.claude/skills/tablet-price/`, and knowing which to run, in what order, with
which flags, is knowledge that lives in `SKILL.md` and in the user's head. One of
them, `collect.mjs --only pools`, silently collects a single tablet type unless
`--full` sits beside it. That trap cost an hour, and `refresh.mjs` exists only to
remove the choice.

The request: make it standalone and clean, with a progress bar, and a setting
that picks between updating the data and running the web server.

## The shape

One executable. Four subcommands.

```
tablet update              collect every cell, then rebuild        (~30 min)
tablet update --pools-only only the type x rarity baselines        (~2 min)
tablet update --offline    no collection: replay and rebuild
tablet update --dry-run    print the plan and stop

tablet serve               the read-only web view and economy file
tablet serve --host 0.0.0.0    reachable from the network

tablet price               price a tablet pasted on stdin
tablet audit               check stored rows against what GGG sent

  --league <name>   default from config.json
  --data <dir>      override the data directory
```

`update` and `serve` are the two modes the request names. `price` and `audit`
come along because they are already written and stranding them behind bare
`node` invocations would leave the front door half built.

## What moves

**Revised after review, before implementation.** This section originally said every
script folds into `commands/*.mjs` and the CLI calls all of them in process. That was
wrong for the three sweep steps, and what was actually built is below.

`refresh.mjs`'s `spawnSync` bought a real guarantee: each step is the same script a
human would run, so the orchestrator cannot drift from the thing it orchestrates.
Folding `collect.mjs`, `build-mod-table.mjs` and `rederive.mjs` into `cli.mjs` would
have given that up to get a progress bar — and the progress bar does not need it. It
lives inside the collect step and writes to stderr; `spawnSync` with `stdio: 'inherit'`
passes stderr straight through to the terminal. So `cli.mjs update` still shells out to
these three, unchanged apart from the path fixes their move required.

`web/serve.mjs`, `price-tablet.mjs` and `audit-db.mjs` are not sweep steps — they are a
server and two read-only reports, so the anti-drift argument does not apply to them.
They fold into `cli.mjs` as originally planned: each now exports one function, and the
`serve`, `price` and `audit` subcommands call it in process.

| Today | Becomes |
|---|---|
| `refresh.mjs` | folded into `cli.mjs`'s `update` subcommand |
| `collect.mjs` | moved to `steps/collect.mjs`, still run with `spawnSync` |
| `build-mod-table.mjs` | moved to `steps/build-mod-table.mjs`, still run with `spawnSync` |
| `rederive.mjs` | moved to `steps/rederive.mjs`, still run with `spawnSync` |
| `web/serve.mjs` | kept in place, exports `runServe()`, called in process |
| `price-tablet.mjs` | kept in place, exports `runPrice()`, called in process |
| `audit-db.mjs` | kept in place, exports `runAudit()`, called in process |
| — | `cli.mjs`, the only executable |

`lib/` is untouched. Every module there already takes its inputs as arguments,
which is why this is a re-front-ending rather than a rewrite.

The flag discipline in `refresh.mjs` is kept exactly, now in `cli.mjs update`: unknown
flags exit 2 having run nothing. That property was bought with a real incident where a
test invoked a flag that did not exist and started three concurrent live sweeps. An
unknown subcommand fails the same way.

## The progress bar

`lib/sweep.mjs` already takes `log` and `onCell` hooks, so nothing there changes.

The total is known before the sweep starts. Pools are types times rarities; the
affix loop is one search per modifier per type, and `affixesFor` returns that
list. So the plan is countable up front and the bar is honest rather than a
spinner pretending to be a measure.

```
collecting   [######################--------]  148/203   Breach Tablet rare
```

It writes to stderr and only when stderr is a TTY. Piped or redirected, it falls
back to the current one-line-per-cell logging, so nothing that reads the output
breaks and a log file does not fill with control characters.

Rate-limit waits are shown, because a sweep that pauses 61 seconds on a GGG
window looks identical to a hung process otherwise.

## What this does not change

- No change to `lib/`, to the phase boundary, or to any measurement.
- No change to what a sweep collects or how it is archived.
- `tests/contract.test.mjs` keeps enforcing that phase 2 makes no network call.
- No new dependency. The bar is a dozen lines of `\r` and string padding; a
  progress-bar package is not worth an entry in the attack surface.

## Extracting this to its own repository

The request raised the possibility. It is feasible, and there is one problem that
has to be solved deliberately rather than discovered.

**The rate-limit ledger.** `collect.mjs` reaches `lib/trade-client.mjs`,
`lib/rate-limiter.mjs` and `lib/request-log.mjs` at the repo root, which
`CLAUDE.md` records as deliberately shared with the price-check skill:

> The rate-limit ledger is deliberately one file: GGG counts per IP and per
> account, so two ledgers would earn a restriction.

Today that is structural. One repository, one root, one ledger file, and no way
to get it wrong. Splitting the repository splits the ledger unless both halves
point `TRADE_RATELIMIT_LEDGER` at a shared path. That environment variable
exists, so it is possible — but it converts a guarantee you cannot break into a
setting that is silent when wrong, and the penalty for being wrong is a
restriction from GGG.

The other couplings are minor by comparison: `secrets.json` at the repo root, and
`vendor/ee2-stats.ndjson` which already lives inside the skill directory.

**Recommendation: not yet.** After this refactor, extraction is a `git mv`, a
`package.json`, and a decision about the ledger. That decision is worth making
awake, and nothing is lost by making it later.
