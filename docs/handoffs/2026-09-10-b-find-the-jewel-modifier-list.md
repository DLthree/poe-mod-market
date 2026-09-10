# Handoff: find the jewel modifier list

Written 2026-09-10. Replaces `2026-09-10-a-jewel-page-beside-the-tablet-page.md`,
which is spent: its four steps are all done.

Repo: `\\wsl.localhost\Ubuntu\root\proj\poe-mod-market`, branch
**`generalise-item-kinds`**, 18 commits ahead of `main`, tree clean, **nothing
pushed**. 349 tests pass.

**Read first, in this order.** Do not re-derive what they already say.

1. `CLAUDE.md` — the traps, including the two added this session.
2. `docs/jewel-vocabulary-bias.md` — why the jewel numbers are wrong. This is
   the whole problem.
3. `docs/TODO.md` — the three items, with costs already worked out.
4. `README.md` — the spec, accurate, now covering both item kinds.

## What the next session is for

**Get the list of modifiers a PoE2 jewel can roll, per base.** That is the
blocker; everything else about jewels works.

**The literature search is largely already done, and it found a local answer.
Read "The lead" below before searching the web for anything.** The short version:
the game's own mod table is on this machine, it is free, and it needs no trade
requests at all.

## The problem in one paragraph

`affixesFor` in `lib/sweep.mjs` builds loop 2's vocabulary from modifiers loop 1
already saw, and loop 1 keeps the CHEAPEST listings per cell. A jewel modifier is
dear precisely when it is RARE on that base, so it never reaches the cheap end
and is never asked about. Measured: `#% increased maximum Energy Shield` has 19
listings on Emerald rare from 1 to 60 divine, against a 1-exalted blank, and the
full 193-search pass reported nothing about it. Tablets escape this because their
supply is thin enough that the cheap end still carries the premium modifiers.

## Ruled out already — do not repeat these

Each cost real time or real searches this session.

- **The sibling projects under `../` are PoE1.** `poe.re/poe/src/generated/GeneratedJewel.ts`,
  `tab-triage/out/jewels.mjs`, `claude-poe-stash-helper/attic/jewels.mjs`. All
  describe Abyss jewels, Cluster jewels, Corrupted Blood, Critical Strike
  Multiplier. Two read a local stash dump, not a mod pool.
- **GGG's `/data/stats` has no item association.** Already cached at
  `%LOCALAPPDATA%\poe2-tablet-price\cache\stats-poe2.json`. 3042 explicit stats
  across every item class. Brute force is 18252 searches, 31 six-hour windows.
- **`vendor/ee2-stats.ndjson`** (Exiled Exchange 2) carries stat text, matchers
  and trade ids, but no item-class association either.
- **Sorting the pool query `price: desc` does not surface valuable modifiers.**
  One search, tested. The ten dearest Emerald rares are 1000-4030 divine and
  carry the same junk as the 1-exalted ones. Zero new vocabulary. Those are
  ask-price listings, not value.
- **Cross-seeding one cell's vocabulary from another** mostly wastes searches: of
  six such modifiers asked of Emerald rare, four returned 0 for sale (the base
  cannot roll them) and two were common at 1-5 exalted.

## The lead: the mod table is on this machine

Investigated 2026-09-10. Every claim below was verified by looking, except the
last one, which is explicitly untested.

**1. The RePoE checkout exists but is PoE1.** `C:\Users\loffr\dev\repoe\` holds
`mods.json` (34 MB) and `stat_translations.json` (12 MB). It is PoE1: 808
occurrences of "Critical Strike Chance" against 1 of "Critical Hit Chance", and
its jewel spawn tags are `abyss_jewel`, `affliction_jewel` and
`expansion_jewel_*` — Abyss and Cluster jewels, neither of which exists in PoE2.
No Emerald, Ruby or Sapphire. `augmented.json`, which `tab-triage` reads, is not
there any more. **Dead end, do not revisit.**

**2. There is an Exiled Exchange 2 checkout, and it is PoE2.**
`C:\Users\loffr\dev\exiled-exchange-2\`. Its
`renderer/public/data/en/items.ndjson` already answers half the question:

| base | tags |
|---|---|
| Emerald | `jewel`, `dexjewel` |
| Ruby | `jewel`, `strjewel` |
| Sapphire | `jewel`, `intjewel` |

**This explains the whole Energy Shield result.** Energy Shield is an
intelligence stat, so it is native to Sapphire (`intjewel`) — common there and
worth 1-2 exalted. On Emerald (`dexjewel`) it is off-attribute, therefore rare,
therefore 1 to 60 divine. The attribute tag is the thing that predicts value.

**3. The missing half is the `Mods` table, and EE2's parser already reads it.**
`dataParser/data/vendor/config.json` lists the game tables it pulls — `Mods`,
`Tags`, `BaseItemTypes`, `Stats` and others — and names the columns
`SpawnWeight_Tags` and `SpawnWeight_Values`. That is exactly the RePoE shape:
per-modifier spawn weights keyed by the tags above. `dataParser/data/vendor/tables/`
is EMPTY in the checkout, so the parser extracts them rather than shipping them.

**4. It extracts them from a local game install, and the game is installed.**
The config's default source path is a Steam install. The real install on this
machine is the standalone one:

```
C:\Program Files (x86)\Grinding Gear Games\Path of Exile 2\Content.ggpk   (153 GB)
```

The Steam path exists but holds only `logs`, so point the parser at the GGG path.

**5. UNTESTED: that the parser actually runs here.** `dataParser/README.md` says
`python ./src/main.py` from the `dataParser` folder, with `--help` for options
and a `--main-repo-path` default that needs changing. Nobody has tried it. Python
availability, dependencies, and whether it emits the mod pool in a usable form
are all unknown. **That is the first thing to find out, and it costs no rate
allowance.**

### Why this matters

If the parser works, the jewel modifier pool per base comes out of a local file,
free, offline, repeatable after every patch, and with spawn weights that say how
rare each modifier is on each base. Rarity is what predicts price here. That is
strictly better than anything the trade API can tell us.

### Fallbacks, in order

1. Read `Content.ggpk` with another tool if EE2's parser will not run.
   `dataParser/src/` shows how it is done and is worth reading first.
2. Web sources, still unchecked: poe2db.tw, poe.ninja PoE2 endpoints, EE2
   upstream releases (its published data may include what the local checkout
   does not).
3. Last resort, costed in `docs/TODO.md`: a one-time discovery pass over the
   trade API, exploiting the fact that **`total` comes back free with every search
   and 0 for sale definitively means a base cannot roll a modifier.** About 3042
   searches against one cell, then the few hundred survivors against the other
   five. Roughly seven six-hour windows. Only do this if 1 and 2 both fail.

## Rate allowance, as of writing

14 searches and 8 fetches used in the trailing six hours, against caps of 600 and
1000. Effectively a clean slate. Today's jewel work spent about 230 searches in
total.

**A tablet pass and a jewel pass do not fit in one six-hour window.** A full
tablet pass is about 520 searches.

## State of the work

Step 1 of the previous handoff (generalise to item kinds) is complete: registry
in `lib/item-kinds.mjs`, `pinned(type)` as the query seam, one page per kind, one
economy file per league and kind. Design in `docs/item-kinds-design.md`, plan in
`docs/item-kinds-plan.md`, both committed.

The jewel sweep ran and its 1930 listings are archived. `site/data/eco-forbidden-rites-jewel.json`
is committed and is **explicitly not fit to publish** — it reports a 1-exalted
market while 60-divine Emerald rares are listed. The README carries that warning
in a blockquote. Tablets are unaffected and were verified byte-identical to what
`main` published, apart from a new `kind` field.

**Nothing is pushed.** A push to `main` touching `site/` deploys to
https://dlthree.github.io/poe-mod-market/ . That decision is the user's.

## Things this session got wrong, so you can avoid the same

- **I published a confident conclusion that was false.** I wrote that the jewel
  market is collapsed at 1 exalted and the floor statistic cannot price jewels.
  Every measurement was right and the conclusion was still wrong, because of
  which questions were never asked. The user's domain knowledge caught it. That
  document is retracted; `docs/jewel-vocabulary-bias.md` replaces it. **When a
  sweep reports that an entire market is worthless, suspect the sampling.**
- **I concluded `agent-browser` was broken when it was only slow.** See below.

## Environment

- **`agent-browser` is now BLOCKED** by deny rules in `.claude/settings.json`,
  at the user's instruction, until someone works out why cold start is so slow.
  The first `open` after install produced nothing for over two hours and looked
  exactly like a hang; retrying stranded 24 chrome.exe processes. Warm calls
  return in seconds. Untested hypothesis in the settings file: the WSL SMB share.
  **Do not remove the deny rules to "just try it".** If a visual check is needed,
  run `node cli.mjs serve` and ask the user to look.
- Both pages HAVE been screenshotted and look right — the first time in this
  repo's life. `CLAUDE.md` no longer claims otherwise.
- **Sleep is restored to 60 minutes on AC and 10 on DC.** Disable it before any
  long unattended pass: `powercfg /change standby-timeout-ac 0` and the DC
  equivalent.
- Archive backed up and SHA256-verified to
  `C:\Users\loffr\Backups\poe2-tablet-price\2026-09-10T085432Z` (17 files,
  127 MB). Re-run `backup-data.ps1` from the session scratchpad after any sweep.

## The other strong idea, from the user

**Price a modifier alone, on a magic jewel.** A magic jewel holds at most one
prefix and one suffix, so one carrying exactly one modifier and nothing else is
the purest reading of what that modifier is worth on that base. A rare's price is
a conjunction and a single-modifier search on a rare asks a question nobody
prices; a magic jewel with one mod does not have that problem.

Written up with what is already in place and what must be checked first in
`docs/TODO.md`. It is orthogonal to the vocabulary problem: it makes each
measurement cleaner, it does not help discover which modifiers to measure. Both
are needed.

## Suggested skills

Call these with the Skill tool.

- **`mattpocock-skills:research`** — but scoped narrowly, and NOT as a web
  search first. The primary source is already identified and is local: the game's
  own `Mods` table. Use this skill only if the parser route fails, and capture
  whatever is learned as a Markdown file in the repo either way.
- **`superpowers:systematic-debugging`** — the realistic opening move, because
  step 5 above is "get someone else's Python data parser to run on this machine",
  which is a debugging task rather than a research one.
- **`superpowers:brainstorming`** — after the research lands, before any code.
  Choosing between a published pool and a self-run discovery pass changes the
  collector's design, so it is architectural.
- **`superpowers:writing-plans`** then **`superpowers:executing-plans`** — if the
  answer is a discovery pass, because that spends real allowance and wants the
  same task-by-task discipline the item-kind work used.
- **`superpowers:verification-before-completion`** — before claiming any jewel
  number is trustworthy. This session shipped a wrong conclusion; that is the
  failure mode to guard.

## Warnings worth repeating

- Never run two collections at once. One rate-limit ledger, on purpose.
- Never `import()` a step to check it loads. `steps/collect.mjs` collects on
  import.
- Use the PowerShell tool and Windows node. The database cannot live on the WSL
  share.
- **No heredocs in the Bash tool.** This session used them three times against an
  explicit instruction; one created a commit whose message was the word
  "placeholder", which had to be amended.
- `secrets.json` holds a live POESESSID, is gitignored, must never be printed.
  Seller account names must never reach the published files;
  `tests/economy.test.mjs` is what keeps that true.
