# Handoff: a jewel page beside the tablet page

> **SPENT.** All four steps were completed on 2026-09-10. Replaced by
> `2026-09-10-b-find-the-jewel-modifier-list.md`. Kept for its measurements and
> its ruled-out list. Note that its cost estimate for a jewel pass was wrong: it
> quoted a 346-search floor from a Chao1 bound, and the first real pass cost 193,
> because loop 2 can only ask about modifiers loop 1 has already seen. That same
> limitation turned out to be the reason the jewel numbers are untrustworthy —
> see `docs/jewel-vocabulary-bias.md`.

Written 2026-09-10. Repo: `\\wsl.localhost\Ubuntu\root\proj\poe-mod-market`, branch `main`,
clean except the rate-limit cache. Live site: https://dlthree.github.io/poe-mod-market/

**Read first, in this order:** `CLAUDE.md` (the traps an agent hits here), then `README.md`
(the spec, and accurate). Do not re-derive anything they already say. This file is only what
is not yet written down anywhere.

## What the next session is for

Build a second page, a sibling to the tablet page, tracking three jewel bases: Emerald,
Ruby, Sapphire.

The user gave the order of work verbatim:

> step 1 will be to generalize what we already have with tablets - so that we can reuse
> that code as much as possible; step 1.5 is to sample some data with a few queries to
> gather test data; step 2 will be to build out the page; step 3 is to do the jewel sweep

Step 1 is a refactor, not a feature. Nothing about jewels should be built until the tablet
code is general enough to carry both. Step 3 is the only step that spends real rate
allowance, and it is last on purpose.

## What is already measured about jewels

A probe on 2026-09-09 spent 6 searches and 18 fetches. It sampled the 30 cheapest listings
of each base at each rarity and counted distinct explicit modifiers. These numbers are the
reason the plan looks the way it does, so do not re-spend requests to rediscover them.

| cell | distinct mods in 30 items | seen exactly once | Chao1 lower bound |
|---|---|---|---|
| Emerald rare | 48 | 22 | 78 |
| Ruby rare | 34 | 8 | 38 |
| Sapphire rare | 38 | 8 | 40 |
| Emerald magic | 35 | 25 | 70 |
| Ruby magic | 29 | 17 | 58 |
| Sapphire magic | 25 | 15 | 53 |

Every base showed "10000 for sale", which is the API's reported ceiling, so market depth is
not a constraint.

**The three bases do not share a modifier pool.** Across the three rare cells, 120 modifiers
were seen and 110 were distinct. Exactly one appeared on all three. Magic overlap was 4%.
So each base needs its own vocabulary and its own searches; they cannot be folded into one
item type with a base attribute.

**Cost estimate for a full jewel pass:** 346 searches is a hard floor (9 pool searches plus
337 modifier searches from the Chao1 bounds). Plan for 400-700. The sample was small and
biased to the cheap end, because searches sort by price ascending, so the modifiers people
actually pay for are under-represented.

**Time estimate:** 4.5 searches a minute sustained, measured on two real passes. So 346
searches is about 1h20m and 600 is about 2h15m. Crossing 600 adds six hours, not minutes.

The probe's archived responses were written to a session scratchpad that will not survive.
The table above is the record.

## The rate limits, which now shape every decision

Read from GGG's own headers, stored in `.claude/skills/price-check/data/.cache/ratelimit.json`.

- **search, per IP:** 5/10s, 15/60s, 30/300s, **600/21600s**
- **fetch, per IP:** 12/4s, 16/12s, 50/300s, **1000/21600s**

At `perCell` 10 each cell costs exactly one search and one fetch (verified: 492 fetches for
493 searches). The 30-per-300s search rule sets the pace; the fetch rules are not binding.

**The six-hour search cap is the thing that bites.** A full tablet pass is 525 searches
against a ceiling of 600. On 2026-09-08 a pass met the cap and parked for six hours mid-run,
turning 135 minutes of work into 495 minutes of wall clock. A jewel pass and a tablet pass
cannot share a six-hour window.

If a pass is killed partway, `steps/collect.mjs --full --i-mean-it --types "<name>"` finishes
the missing cells without re-running the rest. That flag was added for exactly this.

Also observed: after a long idle gap the limiter's stored state goes stale, and the first
burst of searches can earn a 429 and a short server restriction. It self-corrected in about
a minute and cost nothing, but it is real.

## Where the tablet code will need to generalise

Nothing here is decided. It is what a first read suggests, offered so the design session does
not start from zero. Challenge it.

- `lib/poe2.mjs` holds `TABLET_TYPES`, `RARITIES`, `MODIFIED_RARITIES`, `USES_IMPLICIT`,
  `MAX_AFFIX`. This is the item-kind knowledge, and it is the natural seam.
- `USES_IMPLICIT` is tablet-only. Jewels have no uses implicit, so the query builder in
  `lib/sweep.mjs` must stop assuming one exists. `lib/trade-url.mjs` already returns
  `exact: false` with a reason for a type it holds no uses implicit for, which is the
  behaviour a jewel needs, but a jewel is not "inexact" in the same sense. Decide
  deliberately rather than inheriting it.
- `MAX_AFFIX` (prefix/suffix caps, used by `lib/derive.mjs` for open-affix counting) was
  measured on tablets and will be wrong for jewels.
- `lib/economy.mjs` writes one file per league at `eco_<league>_Tablet.json` with `TYPE`
  hardcoded. A second item kind needs a second file, not a second league.
- `steps/build-site.mjs` copies a whitelist of `lib/` modules into `site/lib/`. Any new
  shared module has to be added there or the page silently 404s it.
- `tests/contract.test.mjs` treats any unlisted module in `lib/` as phase 2 and fails it for
  touching the request table or a client. A new phase-1 module must be added to `EXEMPT`
  deliberately.
- The band rule (`lib/bands.mjs`) and the currency comparison (`lib/exchange.mjs`) are
  already item-agnostic and should need no change.

## Current configuration, and why

`config.json` is the single source of truth. Values that were argued over recently:

- `league: "Forbidden Rites"`. A new league needs only this line.
- `perCell: 10`. It is the fetch bill, not a quality setting. See the note in the file.
- `walk.minListings: 8`, `walk.minSellers: 2`. Both must stay below `perCell`, or every row
  in the file is flagged as thinly evidenced.
- `exchange: { exalted: 1, divine: 200, chaos: 15 }`. A standing guess that drifts. It is
  used for the ratio, the added amount and the sort order, and never to convert a stored
  price. Rows that lean on it carry `assumedRate`.

## Open items carried forward

1. **No browser has ever rendered this page.** There is no browser automation in the repo,
   so every check so far has been a data-level replay. This repo has shipped a CSS fault
   that way before. A jewel page is a large visual change; do not report it as working on
   data checks alone. The `agent-browser` skill is available and would close this gap.
2. **A rate-editing panel in the UI was designed and declined.** The user chose "Not now" on
   2026-09-09. The design is in the conversation history: a shared derivation module so the
   page and the build apply one rule, an unlabelled header button, a slide-open panel, and
   per-league browser storage. Do not rebuild it unasked, but the "shared derivation" half of
   that design overlaps with step 1 here and may be worth revisiting.
3. **Overseer magic reads oddly and is not a bug.** 31 of its 32 modifiers band high because
   its blank tablet halved to 17 exalted while its typical modifier held at 45. This is the
   cheap-baseline effect the README documents. Expect the same shape on any jewel cell whose
   cheap end is junk.

## Recent commits, for context

```
6057d7e  Publish the first pass collected ten listings deep
731daea  Let a pass be narrowed to one tablet kind
4f6d7ca  Keep ten listings a search, and move the thin thresholds under it
1045240  Publish a full sweep at the raised rate
9988cf6  Compare across currencies with an approximate rate, and sort on it
```

Each commit message carries the measurement behind its change. `git show <sha>` is faster
than re-deriving.

## Suggested skills

Call these with the Skill tool.

- **`superpowers:brainstorming`** — first, before any code. Step 1 is architectural: it
  changes interfaces several modules depend on. Do not skip to implementation.
- **`mattpocock-skills:codebase-design`** — for step 1 specifically. Deciding where the seam
  between "item kind" and "the machinery" goes is the whole of that step.
- **`superpowers:writing-plans`** — after the design is agreed, to turn it into an
  implementation plan.
- **`superpowers:test-driven-development`** — the repo has 313 tests and they are load
  bearing. Step 1.5 exists to produce fixtures; use them.
- **`agent-browser:agent-browser`** — for step 2, to actually look at the page. See open
  item 1.
- **`superpowers:verification-before-completion`** — before claiming any step is done,
  especially step 3, which is expensive and hard to repeat.

## Warnings worth repeating even though CLAUDE.md says them

- Never run two collections at once. One rate-limit ledger, on purpose.
- Never `import()` a step to check it loads. `steps/collect.mjs` starts collecting on import.
- Use the PowerShell tool and Windows node. The database cannot live on the WSL share.
- `secrets.json` holds a live session cookie, is gitignored, and must never be printed.
  Seller account names appear in collected data and must never reach the published file;
  `tests/economy.test.mjs` is what keeps that true.
- Before any unattended pass: `powercfg /change standby-timeout-ac 0` and the DC equivalent.
  Restore to 60 and 10 afterwards. Machine sleep once cost 37 hours.
