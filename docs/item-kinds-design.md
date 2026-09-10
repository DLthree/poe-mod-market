# Generalising the tablet code to a second item kind

Written 2026-09-10. This is step 1 of four. The order is the user's:

> step 1 will be to generalize what we already have with tablets - so that we
> can reuse that code as much as possible; step 1.5 is to sample some data with
> a few queries to gather test data; step 2 will be to build out the page; step
> 3 is to do the jewel sweep

Step 1 sends no search. It spends no rate allowance and changes no published
number. What it changes is where the item knowledge lives.

## What is already general, and what is not

The archive is kind-agnostic today. `listing.type` is a plain string and the
`snapshot` table records a question as league, type, rarity and stat id. Nothing
in the schema says "tablet". `lib/summary.mjs`, `lib/floor.mjs`, `lib/walk.mjs`,
`lib/bands.mjs`, `lib/exchange.mjs` and `lib/snapshots.mjs` take a type and a
rarity as parameters and hold no tablet knowledge at all. None of them change.

The tablet knowledge sits in exactly six places:

| file | what it assumes |
|---|---|
| `lib/poe2.mjs` | the eight type names, the uses implicit, the affix caps |
| `lib/sweep.mjs` | every search pins a uses implicit, and refuses a type without one |
| `lib/trade-url.mjs` | a link is exact only if it carries a uses implicit |
| `lib/derive.mjs` | one affix cap table applies to every item, keyed by rarity alone |
| `lib/economy.mjs` | one file per league, over `TABLET_TYPES` |
| `web/app.js` | the grid iterates `TABLET_TYPES`, and labels trim " Tablet" |

## The registry

A new file, `lib/item-kinds.mjs`. It holds one object per kind and nothing else.

It is pure data and pure functions. It names no table and constructs no client,
so `tests/contract.test.mjs` files it as phase 2 with no entry in the EXEMPT
list. That is the reason it is a separate file rather than a section of
`lib/sweep.mjs`: phase 1 and phase 2 both need it, and only a file that touches
neither the database nor the network can be imported by both.

`TABLET_TYPES`, `USES_IMPLICIT`, `MIN_USES` and `MAX_AFFIX` move here out of
`lib/poe2.mjs`, with the comments recording how each was measured. They are
deleted from `poe2.mjs`, which keeps the API constants, the rarities and the
trade window. There is no re-export and no shim.

```js
export const ITEM_KINDS = {
  tablet: {
    key: 'tablet',
    label: 'Tablet',            // GGG's own singular; the poe.re path uses it
    plural: 'Tablets',
    title: 'Tablet prices',
    types: [ /* the eight */ ],
    short: (type) => type.replace(' Tablet', ''),
    maxAffix: { Magic: { prefix: 1, suffix: 1 }, Rare: { prefix: 3, suffix: 3 } },
    pinned (type) { /* the uses filter, or the reason there is none */ }
  },
  jewel: {
    key: 'jewel',
    label: 'Jewel',
    plural: 'Jewels',
    title: 'Jewel prices',
    types: ['Emerald', 'Ruby', 'Sapphire'],
    short: (type) => type,
    maxAffix: null,             // UNMEASURED. Step 1.5 measures it.
    pinned: () => ({ groups: [], missing: [] })
  }
}
```

Two lookups come with it. `kindByKey(key)` throws with the known keys listed,
because a mistyped kind must not fall back to tablets and collect the wrong
market. `kindOfType(type)` is a reverse map built once at load, and building it
throws if two kinds claim the same type name. An ambiguous type would make
`lib/derive.mjs` apply one kind's affix caps to another kind's item, and it
would do it silently.

### `pinned` is the seam

`pinned(type)` returns the extra stat groups every search of that kind must
carry, and a list of reasons any are missing:

```js
{ groups: [ /* trade-API stat groups */ ], missing: [ /* human-readable */ ] }
```

A tablet returns the uses filter at `MIN_USES`. A jewel returns nothing and
reports nothing missing. A tablet type absent from `USES_IMPLICIT` returns no
groups and one reason.

Both `lib/sweep.mjs` and `lib/trade-url.mjs` call it. That is the point. The
price of a tablet is the price of a full one, so a link that omits the uses
filter opens a market whose cheap end the price excluded. The repo shipped that
fault until 2026-09-07. One function, called by both, is what stops it
recurring for a second item kind.

The two callers treat `missing` differently, and that difference is deliberate:

- **The sweep throws.** A search that quietly drops a filter spends allowance
  that cannot be bought back, on a question that is not the one recorded.
- **The link degrades.** A search of the right item at the wrong depth beats no
  search. It reports `exact: false` and says why.

### What `exact` now means

Today `exact` is false when the type has no uses implicit. That reads as "a
jewel link is defective", which is wrong: a jewel has no uses to filter on.

The new rule: **a link is exact when it carries every group the sweep pinned.**
A jewel pins nothing, carries nothing, and is exact. A tablet type missing from
the table is still inexact, with the reason unchanged.

## What each file becomes

The six rows above are where the assumption lives. Two more files change because
they carry a path or a league list that now has to name a kind.

**`lib/sweep.mjs`.** `poolQuery` and `affixQuery` take a kind as their first
argument. `base` calls `kind.pinned(type)` and throws when anything is missing.
The empty modifier group stays at `stats[0]` so `affixQuery` can fill it, and
the pinned groups follow it. `sweepPools` and `sweepAffixes` take the kind and
pass it down.

**`lib/trade-url.mjs`.** `tradeUrl` takes a kind alongside the type. No league,
no kind or no type still returns a null url.

**`lib/derive.mjs`.** `MAX_AFFIX[item.rarity]` becomes
`kindOfType(type)?.maxAffix?.[item.rarity]`, where `type` is the `baseType` the
row already stores. A kind with no measured caps yields no cap, `countable`
stays false, and the open-affix columns store null. `lib/walk.mjs` already reads
a null count as unknown rather than as an open affix, so a jewel is honest
before step 1.5 measures it.

This is a behaviour change worth stating plainly: a base type no kind claims now
stores null open-affix counts where it used to get the tablet caps by rarity.
That is the honest answer, and the archive should hold no such type. The
verification below checks it rather than assuming it.

**`lib/economy.mjs`.** `economyFile` takes a kind and iterates `kind.types`. The
`CATEGORY` and `TYPE` constants become `kind.key` and `kind.label`, so
`economyPath('Runes of Aldur', tablet)` still returns
`tablet/eco_Runes of Aldur_Tablet.json` and poe.re sees no change. The file
gains a `kind` field, so a page can refuse a file for the wrong kind rather than
render an empty grid.

**`lib/site.mjs` and `lib/leagues.mjs`.** Paths gain the kind, below.
`listLeagues` reports which kinds a league holds, read from
`SELECT DISTINCT type FROM snapshot` and mapped through `kindOfType`. Without
it the jewel page would offer a league in its dropdown and then fetch a file
that does not exist.

**`web/app.js`.** Covered under The page.

## What gets published

| file | now | after |
|---|---|---|
| economy | `data/eco-<league>.json` | `data/eco-<league>-<kind>.json` |
| fragments | `data/fragments-<league>.json` | `data/fragments-<league>-<kind>.json` |

Both kinds take the suffix. A special case for tablets would be one more rule to
remember and it buys nothing: the page, its modules and its data are rebuilt and
committed together.

`steps/build-site.mjs` does not clean its output directory, so the two old files
are deleted from `site/data` by hand in the same commit. A stale
`eco-forbidden-rites.json` left beside the new one is a file nothing fetches and
everything trips over.

`data/leagues.json` gains a per-kind index, so one file still boots both pages:

```json
{ "leagues": ["Forbidden Rites"],
  "default": "Forbidden Rites",
  "kinds": { "tablet": ["Forbidden Rites"], "jewel": [] } }
```

`config.json` keys `testSet` by kind. The jewel entry is written in step 1.5,
not here. `steps/collect.mjs` gains `--kind`, defaulting to tablet, so every
command line in `README.md` means exactly what it meant before.

## The page

`web/app.js` reads its kind from `document.body.dataset.kind` and looks it up in
the registry. The grid iterates `kind.types` rather than an imported constant,
labels rows with `kind.short(type)`, and takes its heading and its empty-state
prompt from the kind. Iterating the kind rather than the economy file's own rows
is deliberate: a type collected nothing for still gets a row of dashes, which
`emptyCell` already exists to support, and a missing row would read as a page
fault instead.

`index.html` sets `data-kind="tablet"`. A new `jewels.html` sets
`data-kind="jewel"` and differs in that attribute, its title and the direction
of the link to its sibling. Both load the same `app.js`.
`steps/build-site.mjs` copies every file in `web/` except the server, so the new
page needs no entry anywhere.

> **Superseded 2026-09-10.** Two hand-written pages became two hand-maintained
> copies of one 59-line file, and every difference between them followed from the
> kind. There is now ONE template, `web/page.html`, and `lib/site.mjs` renders one
> page per kind: `tablets.html` and `jewels.html`, with `index.html` as a root that
> points at the first kind in the registry. `README.md` describes what is there
> now.

When `leagues.json` lists no league for a kind, the page says so and renders an
empty grid. That is what `jewels.html` shows until step 3.

`tabletRegex` in `lib/regex-keys.mjs` becomes `stashRegex`. Nothing in it was
ever tablet-specific: it joins fragments into a stash search. The old name is
deleted, not aliased.

## A bug this fixes

`web/serve.mjs` whitelists three browser modules. `web/app.js` imports five.
`/lib/bands.mjs` and `/lib/exchange.mjs` fall through to `handleStatic`, which
serves only from `web/`, and return 404. **The local page cannot boot today.**
The published page works, because `steps/build-site.mjs` copies all five.

That is the exact inversion of the rule the repo states: the local page is meant
to be the published page. It survived because `tests/serve.test.mjs` never asks
for those two paths, and because no browser has ever rendered this page.

Step 1 adds a sixth module to both lists, so it fixes this and adds the test
that keeps the two lists in step: read `web/app.js`, extract its `./lib/`
imports, and assert both whitelists equal that set.

## Tests

New file, `tests/item-kinds.test.mjs`:

- no type name is claimed by two kinds
- `kindOfType` round-trips every type of every kind
- `kindByKey` throws on an unknown key and names the known ones
- every tablet type pins its uses implicit at `MIN_USES` and reports nothing missing
- a jewel pins no group and reports nothing missing
- a tablet type absent from `USES_IMPLICIT` reports one reason and no group

New guards elsewhere:

- **A golden query.** The tablet pool query and the tablet affix query serialize
  to a literal checked into the test. This is what proves the refactor did not
  change the question GGG is asked, and it proves it without spending a search.
- A jewel pool query carries one stat group, the empty modifier group, and no
  implicit filter.
- A jewel trade link is exact. An unknown tablet type is not.
- An item whose kind has no measured affix caps stores null open-affix counts.
- The browser-module whitelist test described above.

Edited for the new signatures: `sweep`, `derive`, `economy`, `site`, `serve`,
`leagues`, `poe2`, `web`, `update`.

## Verifying

In order. Nothing here calls GGG except the last step, which is optional.

1. `node --test "tests/*.test.mjs"`. The 313 that pass today must still pass,
   plus the new ones.
2. `node cli.mjs build --out <scratch>` and compare the tablet economy content
   against the committed `site/data` file. **It must be identical apart from the
   file name.** This is the strongest evidence the refactor changed nothing, and
   it is free.
3. Check the archive holds no base type the registry does not claim, and add
   that check to `node cli.mjs audit`, which already exists to compare stored
   rows against what GGG sent.
4. `node cli.mjs serve`, then load both pages **in a browser**. The
   `agent-browser` skill is available and this repo has shipped a CSS fault
   through data-level replay before. A change that adds a page is not reported
   as working until it has been looked at.
5. Optionally `node steps/collect.mjs`, the ten-modifier test set, under a
   minute. The golden query test already covers what this would prove.

`CLAUDE.md` states the suite as 278 tests. It is 313 today, before any of this.
That line is corrected in the same commit.

## Out of scope

Step 1 sends no search, collects no jewel data, measures no jewel affix caps and
writes no jewel test set.

**Step 1.5 must confirm the jewel base type names before anything else.** This
document states them as `Emerald`, `Ruby` and `Sapphire`, taken from the
handoff. Those were not verified against the strings the trade API accepts as a
`type`. If GGG spells them differently, every jewel search returns nothing while
looking like it worked. One search settles it, and it must happen before any
full pass.

Step 1.5 also measures `maxAffix` for each jewel base, from listings it has
already fetched, and writes `config.testSet.jewel`.

### What step 1.5 actually found

Added 2026-09-10, after nine searches. This section is the outcome; everything above it is
the design as agreed.

- **The three base type names are right.** `Emerald`, `Ruby` and `Sapphire` are all
  accepted as a `type`, and each reported 10000 for sale at magic and at rare, which is the
  API's own ceiling rather than a count. The risk this section was written to flag did not
  materialise.
- **No jewel trades at normal.** Zero for sale on all three bases. That was not anticipated
  anywhere above, and it made the rarity list a property of the kind rather than a
  constant: a kind lists only the rarities its market trades, ordered plainest first, and
  `rarities[0]` is the blank form the grid sorts on. For a jewel that is magic.
- **The affix caps stay null.** Thirty rare and 28 magic jewels showed at most two prefixes
  and two suffixes, but that is a floor from a thin sample at the cheap end, not a cap. The
  tablet numbers took 3540 items to settle, and `lib/derive.mjs` applies a cap at
  COLLECTION time, so a wrong one is baked into every row a pass writes. Nothing the page
  publishes reads these counts; only the mod-table diagnostic does.
- **A full jewel pass is far cheaper than estimated.** This document repeated the handoff's
  346-search hard floor, taken from a Chao1 bound on the true vocabulary. The real cost of
  the first pass is 193 searches, because loop 2 can only ask about modifiers loop 1 has
  already seen, and a ten-deep pool sample of six cells yields 187. The Chao1 number is
  what a *converged* sweep would cost across repeated passes, not what the first one does.

The rate-editing panel declined on 2026-09-09 stays declined. Its shared
derivation idea overlaps with this work only in that both put one rule in one
place, and this document already does that.
