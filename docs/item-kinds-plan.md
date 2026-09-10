# Item Kinds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every tablet-specific fact into one registry of item kinds, register jewels dormant, and change no published number.

**Architecture:** A new `lib/item-kinds.mjs` holds one object per kind: its base types, its display labels, its affix caps, and `pinned(type)`, which returns the extra trade-API stat groups every search of that kind must carry. The sweep and the trade link both call `pinned`, so the collection query and the published link cannot disagree. Everything else in `lib/` already takes a type and a rarity as parameters and does not change.

**Tech Stack:** Node 24 or newer, `node:sqlite`, `node:test`. No dependencies. Plain ES modules, no build step, no bundler.

**Spec:** `docs/item-kinds-design.md`

## Global Constraints

- **Branch:** `generalise-item-kinds`. It exists and is checked out.
- **313 tests pass today.** Every task ends with `node --test "tests/*.test.mjs"` green. A task that leaves a test red is not finished.
- **Use the PowerShell tool and Windows node.** There is no node inside WSL. Git Bash is fine for reading files and for git.
- **Never `import()` a step to check it loads.** `steps/collect.mjs` runs on import and starts a real collection.
- **No network call anywhere in this plan.** No task sends a search. Step 1 spends no rate allowance.
- **Replace, do not deprecate.** No re-export shims, no aliases, no dual formats. When a name moves, the old one is deleted.
- **Write comments the way this repo does.** A constant that was measured carries the measurement. Move existing comments with the code they explain; do not summarise them away.
- **Restart the server after changing anything under `lib/`.** Node holds modules in memory.
- **`lib/item-kinds.mjs` must stay phase 2.** It may not name a database table, import `archive.mjs`, `derive.mjs` or `sweep.mjs`, or mention `TradeClient` or `client.`. `tests/contract.test.mjs` checks this on every run and needs no EXEMPT entry if the rule holds.
- **Commit after every task.** End commit messages with:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LGGViMMmuVyMJbxn7LLT4m
```

---

### Task 1: Make the two browser-module whitelists agree

`web/serve.mjs` whitelists three modules. `web/app.js` imports five. `/lib/bands.mjs` and `/lib/exchange.mjs` fall through to `handleStatic`, which serves only from `web/`, and return 404. The local page cannot boot today, while the published page can, because `steps/build-site.mjs` copies all five. This is an independent bug and it lands first.

**Files:**
- Modify: `web/serve.mjs:170-172`
- Test: `tests/web.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: a test that later tasks rely on. Any task adding a `./lib/` import to `web/app.js` must add that module to both whitelists or this test fails.

- [ ] **Step 1: Write the failing test**

Append to `tests/web.test.mjs`:

```js
// THE PAGE MUST BE THE SAME PAGE, served or published. The dev server
// whitelists the modules a browser may load from lib/, and steps/build-site.mjs
// copies its own list into site/lib/. Two hand-kept lists drift, and they had:
// serve.mjs named three while app.js imported five, so /lib/bands.mjs and
// /lib/exchange.mjs 404ed and the local page could not boot at all. The
// published page worked, which is the exact inversion of the rule.
//
// Neither list is the authority. The page's own import statements are.
const importedModules = () => {
  const src = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
  return new Set([...src.matchAll(/from\s+'\.\/lib\/([\w-]+\.mjs)'/g)].map(m => m[1]))
}

test('the dev server serves every lib module the page imports', () => {
  const src = readFileSync(new URL('../web/serve.mjs', import.meta.url), 'utf8')
  const listed = new Set(
    [...src.matchAll(/'\/lib\/([\w-]+\.mjs)'/g)].map(m => m[1]))
  assert.deepEqual(listed, importedModules(),
    'web/serve.mjs BROWSER_MODULES must equal what web/app.js imports')
})

test('the build copies every lib module the page imports', () => {
  const src = readFileSync(new URL('../steps/build-site.mjs', import.meta.url), 'utf8')
  const block = src.match(/BROWSER_MODULES\s*=\s*\[([\s\S]*?)\]/)
  assert.ok(block, 'steps/build-site.mjs must declare BROWSER_MODULES as an array')
  const listed = new Set([...block[1].matchAll(/'([\w-]+\.mjs)'/g)].map(m => m[1]))
  assert.deepEqual(listed, importedModules(),
    'steps/build-site.mjs BROWSER_MODULES must equal what web/app.js imports')
})
```

- [ ] **Step 2: Run it and watch the first one fail**

Run: `node --test tests/web.test.mjs`
Expected: FAIL. The serve list holds three names, the page imports five. The build test passes already.

- [ ] **Step 3: Fix the whitelist**

In `web/serve.mjs`, replace the `BROWSER_MODULES` set:

```js
// A whitelist, not a directory: nothing else under lib/ is reachable.
// tests/web.test.mjs holds this equal to what web/app.js actually imports, and
// equal to the list steps/build-site.mjs copies. Two hand-kept lists drift, and
// these two did: this one named three modules while the page imported five, so
// the served page 404ed on bands.mjs and exchange.mjs and could not boot.
const BROWSER_MODULES = new Set([
  '/lib/regex-keys.mjs', '/lib/poe2.mjs', '/lib/trade-url.mjs',
  '/lib/bands.mjs', '/lib/exchange.mjs'
])
```

- [ ] **Step 4: Run the whole suite**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS, 315 tests.

- [ ] **Step 5: Commit**

```bash
git add web/serve.mjs tests/web.test.mjs
git commit -F <message file>
```

Subject: `Serve every lib module the page imports`. Body: state that the served page 404ed on two modules while the published one worked, and that the page's own imports are now the authority for both lists.

---

### Task 2: The registry, as a pure move

Create the registry and move the four tablet constants into it. **No signature changes and no behaviour changes.** Every consumer imports the same names from a different file. This makes the move provable on its own before anything is rewired.

**Files:**
- Create: `lib/item-kinds.mjs`
- Create: `tests/item-kinds.test.mjs`
- Modify: `lib/poe2.mjs` (delete the four constants and their comments)
- Modify: `lib/sweep.mjs:2`, `lib/derive.mjs:3`, `lib/trade-url.mjs:31`, `lib/economy.mjs:13`, `steps/collect.mjs:12`, `web/app.js:14`
- Modify: `web/serve.mjs`, `steps/build-site.mjs` (both whitelists)
- Modify: `tests/sweep.test.mjs:6`, `tests/derive.test.mjs:8`, `tests/api.test.mjs:7`, `tests/economy.test.mjs:4`, `tests/serve.test.mjs:11`, `tests/gitignore.test.mjs:35`

**Interfaces:**
- Consumes: Task 1's whitelist test.
- Produces:
  - `ITEM_KINDS` — `{ tablet: Kind, jewel: Kind }`
  - `Kind` — `{ key, label, plural, title, types: string[], short: (type) => string, maxAffix: object|null }`. The `pinned` method arrives in Task 3.
  - `KIND_KEYS: string[]`
  - `kindByKey(key) => Kind` — throws on an unknown key
  - `kindOfType(type) => Kind|null`
  - `TABLET_TYPES: string[]`, `USES_IMPLICIT: object`, `MIN_USES: 10`, `MAX_AFFIX: object` — moved verbatim, still exported, deleted from `lib/poe2.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/item-kinds.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ITEM_KINDS, KIND_KEYS, kindByKey, kindOfType, TABLET_TYPES } from '../lib/item-kinds.mjs'

test('every kind names itself with the key it is filed under', () => {
  for (const [key, kind] of Object.entries(ITEM_KINDS)) assert.equal(kind.key, key)
  assert.deepEqual(KIND_KEYS, Object.keys(ITEM_KINDS))
})

// kindOfType is a reverse map, and lib/derive.mjs reads a kind's affix caps
// through it. Two kinds claiming one type name would apply one kind's caps to
// the other kind's item, silently and per row.
test('no type name is claimed by two kinds', () => {
  const seen = new Set()
  for (const kind of Object.values(ITEM_KINDS)) {
    for (const type of kind.types) {
      assert.ok(!seen.has(type), `${type} is claimed by more than one kind`)
      seen.add(type)
    }
  }
})

test('every type of every kind finds its way back to that kind', () => {
  for (const kind of Object.values(ITEM_KINDS)) {
    for (const type of kind.types) assert.equal(kindOfType(type), kind, type)
  }
  assert.equal(kindOfType('Nonexistent Tablet'), null)
})

// A mistyped kind must not fall back to tablets and collect the wrong market.
test('an unknown kind fails loudly and names the ones that exist', () => {
  assert.throws(() => kindByKey('tablets'), (e) => {
    assert.match(e.message, /tablets/)
    for (const k of KIND_KEYS) assert.match(e.message, new RegExp(k))
    return true
  })
})

test('the tablet kind still holds the eight types', () => {
  assert.equal(ITEM_KINDS.tablet.types, TABLET_TYPES)
  assert.equal(TABLET_TYPES.length, 8)
})

// The three bases the 2026-09-09 probe sampled. Across the three rare cells it
// saw 120 modifiers of which 110 were distinct and exactly one appeared on all
// three, so these are three vocabularies and not one.
test('the jewel kind holds the three bases and no measured affix caps', () => {
  assert.deepEqual(ITEM_KINDS.jewel.types, ['Emerald', 'Ruby', 'Sapphire'])
  assert.equal(ITEM_KINDS.jewel.maxAffix, null,
    'unmeasured, and null is what makes lib/derive.mjs store "unknown" rather than a guess')
})

// The grid labels a row with this. A tablet type reads better without the word
// repeated down the column; a jewel base is already the whole name.
test('each kind shortens its own type names for the grid', () => {
  assert.equal(ITEM_KINDS.tablet.short('Breach Tablet'), 'Breach')
  assert.equal(ITEM_KINDS.jewel.short('Emerald'), 'Emerald')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/item-kinds.test.mjs`
Expected: FAIL, cannot find module `../lib/item-kinds.mjs`.

- [ ] **Step 3: Create the registry**

Create `lib/item-kinds.mjs`. Move the comment blocks from `lib/poe2.mjs:4-14` (the type list), `:24-44` (the uses implicit), `:46-57` (`MIN_USES`) and `:60-72` (`MAX_AFFIX`) with the constants they explain. Do not rewrite them.

```js
// PHASE 2 by tests/contract.test.mjs, and that is deliberate. This file holds
// pure data and pure functions: it names no table and constructs no client, so
// BOTH phases may import it and a new item kind needs no EXEMPT entry.
//
// ONE KIND IS ONE OBJECT. Everything that differs between a tablet and a jewel
// is a field here. Everything else in lib/ takes a type and a rarity as
// parameters and does not care which kind they came from — which is why
// summary, floor, walk, bands, exchange and snapshots are untouched by jewels.

// <keep the Expedition Tablet comment from lib/poe2.mjs verbatim>
export const TABLET_TYPES = [
  'Abyss Tablet', 'Breach Tablet', 'Delirium Tablet', 'Expedition Tablet',
  'Irradiated Tablet', 'Overseer Tablet', 'Ritual Tablet', 'Temple Tablet'
]

// <keep the uses-implicit comment from lib/poe2.mjs verbatim>
export const USES_IMPLICIT = {
  'Abyss Tablet': 'implicit.stat_2369421690',
  'Breach Tablet': 'implicit.stat_2219129443',
  'Delirium Tablet': 'implicit.stat_3879011313',
  'Expedition Tablet': 'implicit.stat_1714888636',
  'Irradiated Tablet': 'implicit.stat_4041853756',
  'Overseer Tablet': 'implicit.stat_3376302538',
  'Ritual Tablet': 'implicit.stat_3166002380',
  'Temple Tablet': 'implicit.stat_3035440454'
}

// <keep the part-used comment from lib/poe2.mjs verbatim>
export const MIN_USES = 10

// <keep the 2026-08-30 measurement comment from lib/poe2.mjs verbatim>
export const MAX_AFFIX = {
  Magic: { prefix: 1, suffix: 1 },
  Rare: { prefix: 3, suffix: 3 }
}

export const ITEM_KINDS = {
  tablet: {
    key: 'tablet',
    // GGG's own singular. lib/economy.mjs puts it in the path poe.re fetches,
    // so it is not free to change.
    label: 'Tablet',
    plural: 'Tablets',
    title: 'Tablet prices',
    types: TABLET_TYPES,
    // The grid puts the kind in its heading, so repeating " Tablet" down every
    // row of the column says nothing.
    short: (type) => type.replace(' Tablet', ''),
    maxAffix: MAX_AFFIX
  },
  jewel: {
    key: 'jewel',
    label: 'Jewel',
    plural: 'Jewels',
    title: 'Jewel prices',
    // Measured 2026-09-09 over 6 searches and 18 fetches. The three bases do
    // NOT share a modifier pool: 120 modifiers across the three rare cells were
    // 110 distinct, and exactly one appeared on all three. Magic overlap was
    // 4%. So each base needs its own vocabulary and its own searches, and they
    // cannot be folded into one type with a base attribute.
    //
    // THESE NAMES ARE NOT YET VERIFIED against the strings the trade API
    // accepts as a `type`. If GGG spells them differently every jewel search
    // returns nothing while looking like it worked. One search settles it, and
    // it must happen in step 1.5 before any full pass.
    types: ['Emerald', 'Ruby', 'Sapphire'],
    // A jewel base name is already the whole name.
    short: (type) => type,
    // UNMEASURED. Null is not a placeholder: lib/derive.mjs reads it as "we do
    // not know how many affix slots this kind has", stores null open-affix
    // counts, and lib/walk.mjs already reads a null count as unknown rather
    // than as an open affix. A guess here would publish a fact nobody measured.
    // Step 1.5 measures it from listings it has already fetched.
    maxAffix: null
  }
}

export const KIND_KEYS = Object.keys(ITEM_KINDS)

/**
 * The kind filed under `key`.
 * @param {string} key One of KIND_KEYS.
 * @returns {object} The kind.
 * @throws If the key is unknown. A mistyped kind must never fall back to
 *   tablets: the fallback would collect and publish the wrong market.
 */
export function kindByKey (key) {
  const kind = ITEM_KINDS[key]
  if (!kind) {
    throw new Error(
      `Unknown item kind ${JSON.stringify(key)}. Known: ${KIND_KEYS.join(', ')}.`)
  }
  return kind
}

// Built once, and building it throws on a duplicate. An ambiguous type name
// would make kindOfType return whichever kind happened to be declared last,
// and lib/derive.mjs would apply that kind's affix caps to the other kind's
// items — silently, and one row at a time.
const BY_TYPE = new Map()
for (const kind of Object.values(ITEM_KINDS)) {
  for (const type of kind.types) {
    if (BY_TYPE.has(type)) {
      throw new Error(
        `Item type ${JSON.stringify(type)} is claimed by both ` +
        `${BY_TYPE.get(type).key} and ${kind.key}. A type belongs to one kind.`)
    }
    BY_TYPE.set(type, kind)
  }
}

/**
 * The kind that claims a base type, or null.
 * @param {string} type A `baseType` as GGG spells it on an item.
 * @returns {object|null} The kind, or null when no kind claims it. Null is a
 *   real answer: lib/derive.mjs stores unknown rather than guessing.
 */
export const kindOfType = (type) => BY_TYPE.get(type) ?? null
```

- [ ] **Step 4: Delete the moved constants from `lib/poe2.mjs`**

Remove `TABLET_TYPES`, `USES_IMPLICIT`, `MIN_USES`, `MAX_AFFIX` and their comment blocks. `lib/poe2.mjs` keeps `API_BASE`, `REALM`, `RARITIES`, `MODIFIED_RARITIES`, `TRADE_WINDOWS` and `validateTradeWindow`. No re-export.

- [ ] **Step 5: Repoint every importer**

Change the import source only. No call site changes.

| file | was | now |
|---|---|---|
| `lib/sweep.mjs:2` | `USES_IMPLICIT, MIN_USES, MODIFIED_RARITIES` from `poe2.mjs` | `MODIFIED_RARITIES` from `poe2.mjs`; `USES_IMPLICIT, MIN_USES` from `item-kinds.mjs` |
| `lib/derive.mjs:3` | `MAX_AFFIX` from `poe2.mjs` | `MAX_AFFIX` from `item-kinds.mjs` |
| `lib/trade-url.mjs:31` | `USES_IMPLICIT, MIN_USES` from `poe2.mjs` | same names from `item-kinds.mjs` |
| `lib/economy.mjs:13` | `TABLET_TYPES, RARITIES` from `poe2.mjs` | `RARITIES` from `poe2.mjs`; `TABLET_TYPES` from `item-kinds.mjs` |
| `steps/collect.mjs:12` | `... TABLET_TYPES ...` from `poe2.mjs` | `TABLET_TYPES` from `item-kinds.mjs`, rest unchanged |
| `web/app.js:14` | `TABLET_TYPES, RARITIES` from `./lib/poe2.mjs` | `RARITIES` from `./lib/poe2.mjs`; `TABLET_TYPES` from `./lib/item-kinds.mjs` |

Same edit in the six test files listed above.

- [ ] **Step 6: Add the new module to both whitelists**

`steps/build-site.mjs:36-37`:

```js
const BROWSER_MODULES = ['regex-keys.mjs', 'poe2.mjs', 'item-kinds.mjs', 'trade-url.mjs',
  'bands.mjs', 'exchange.mjs']
```

`web/serve.mjs`, the set from Task 1, gains `'/lib/item-kinds.mjs'`.

Add `'site/lib/item-kinds.mjs'` to the published-path list in `tests/gitignore.test.mjs:35`.

- [ ] **Step 7: Run the whole suite**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS, 322 tests. Task 1's two whitelist tests are what catch a missed entry in step 6.

- [ ] **Step 8: Commit**

```bash
git add lib/item-kinds.mjs lib/poe2.mjs lib/sweep.mjs lib/derive.mjs lib/trade-url.mjs lib/economy.mjs steps/collect.mjs steps/build-site.mjs web/app.js web/serve.mjs tests/
git commit -F <message file>
```

Subject: `Move the item knowledge into a registry of kinds`. Body: state that this is a move with no signature or behaviour change, that jewels are registered with unmeasured affix caps and unverified type names, and that the registry is phase 2 because it holds only data.

---

### Task 3: `pinned`, and the query seam

The one real decision in this work. `pinned(type)` returns the extra stat groups a search of that kind must carry, and the reasons any are missing. `lib/sweep.mjs` and `lib/trade-url.mjs` both call it, which is what keeps the collection query and the published link asking for the same item.

**Files:**
- Modify: `lib/item-kinds.mjs` (add `pinned` to both kinds)
- Modify: `lib/sweep.mjs:42-94, 181-233`
- Modify: `lib/trade-url.mjs:31-95`
- Modify: `steps/collect.mjs` (pass the kind to the sweeps)
- Test: `tests/item-kinds.test.mjs`, `tests/sweep.test.mjs`, `tests/api.test.mjs`

**Interfaces:**
- Consumes: `ITEM_KINDS`, `kindByKey` from Task 2.
- Produces:
  - `kind.pinned(type) => { groups: object[], missing: string[] }`
  - `poolQuery(kind, type, rarity, tradeWindow) => object`
  - `affixQuery(kind, type, hash, tradeWindow, rarity) => object`
  - `sweepPools({ client, db, index, kind, league, types, rarities, perCell, tradeWindow, log, onCell })`
  - `sweepAffixes({ ...same..., chooseAffixes })`
  - `tradeUrl({ league, kind, type, rarity, mods, tradeWindow }) => { url, exact, query?, reason? }`

- [ ] **Step 1: Write the failing tests**

Append to `tests/item-kinds.test.mjs`:

```js
import { MIN_USES, USES_IMPLICIT } from '../lib/item-kinds.mjs'

// The filter the trade site itself uses for uses remaining. A `min` on it is
// how a search says "not part-used", and it cannot be recovered afterwards: a
// fetched item reports magnitude 10 whatever it has left.
test('a tablet pins its uses implicit and reports nothing missing', () => {
  for (const type of ITEM_KINDS.tablet.types) {
    const { groups, missing } = ITEM_KINDS.tablet.pinned(type)
    assert.deepEqual(missing, [], type)
    assert.deepEqual(groups, [{
      type: 'and',
      filters: [{ id: USES_IMPLICIT[type], value: { min: MIN_USES }, disabled: false }]
    }], type)
  }
})

// A jewel has no uses to filter on. That is not a shortfall, and the trade link
// must not report itself inexact for it.
test('a jewel pins nothing and reports nothing missing', () => {
  for (const type of ITEM_KINDS.jewel.types) {
    assert.deepEqual(ITEM_KINDS.jewel.pinned(type), { groups: [], missing: [] }, type)
  }
})

test('a tablet type with no known uses implicit pins nothing and says why', () => {
  const { groups, missing } = ITEM_KINDS.tablet.pinned('Nonexistent Tablet')
  assert.deepEqual(groups, [], 'no half-built group carrying an undefined id')
  assert.equal(missing.length, 1)
  assert.match(missing[0], /part-used/)
})
```

Append to `tests/sweep.test.mjs`:

```js
import { ITEM_KINDS } from '../lib/item-kinds.mjs'

const TABLET = ITEM_KINDS.tablet
const JEWEL = ITEM_KINDS.jewel

// THE GOLDEN QUERY. Every other test here checks one field. This checks the
// whole body, because the thing that must not change during a refactor is the
// question GGG is asked — and a search cannot be bought back to find out
// afterwards. If this fails, the refactor changed the market being priced.
test('the tablet pool query is byte-for-byte what it has always been', () => {
  assert.deepEqual(poolQuery(TABLET, 'Breach Tablet', 'rare', '3days'), {
    status: { option: 'securable' },
    type: 'Breach Tablet',
    filters: {
      type_filters: { filters: { rarity: { option: 'rare' } } },
      trade_filters: {
        filters: {
          price: { option: 'exalted_divine' },
          indexed: { option: '3days' }
        }
      }
    },
    stats: [
      { type: 'and', filters: [] },
      {
        type: 'and',
        filters: [{ id: 'implicit.stat_2219129443', value: { min: 10 }, disabled: false }]
      }
    ]
  })
})

test('the tablet affix query is byte-for-byte what it has always been', () => {
  const q = affixQuery(TABLET, 'Breach Tablet', 'explicit.stat_1', '3days', 'rare')
  assert.deepEqual(q.stats, [
    { type: 'and', filters: [{ id: 'explicit.stat_1' }] },
    {
      type: 'and',
      filters: [{ id: 'implicit.stat_2219129443', value: { min: 10 }, disabled: false }]
    }
  ])
})

// A jewel has no implicit to pin, so its query carries the modifier group and
// nothing else. A stray empty group here would be a filter GGG reads as a
// constraint nothing satisfies.
test('a jewel query carries the modifier group and no implicit filter', () => {
  const pool = poolQuery(JEWEL, 'Emerald', 'rare', '3days')
  assert.equal(pool.type, 'Emerald')
  assert.deepEqual(pool.stats, [{ type: 'and', filters: [] }])
  const affix = affixQuery(JEWEL, 'Emerald', 'explicit.stat_1', '3days', 'rare')
  assert.deepEqual(affix.stats, [{ type: 'and', filters: [{ id: 'explicit.stat_1' }] }])
})
```

Append to `tests/api.test.mjs`:

```js
// A jewel pins nothing, carries nothing, and is therefore exact. Before this
// rule, `exact` meant "carries a uses implicit", which would have reported
// every jewel link as defective for lacking a filter jewels do not have.
test('a jewel link is exact, because it carries everything the sweep pinned', () => {
  const { url, exact } = tradeUrl({
    league: 'Runes of Aldur', kind: ITEM_KINDS.jewel, type: 'Emerald',
    rarity: 'Rare', mods: ['a'], tradeWindow: '3days'
  })
  assert.equal(exact, true)
  const q = JSON.parse(decodeURIComponent(url.split('?q=')[1]))
  assert.equal(q.query.stats.length, 1, 'the modifier group and nothing else')
})

test('the jewel link asks for the same item the jewel sweep would price', () => {
  const { url } = tradeUrl({
    league: 'Runes of Aldur', kind: ITEM_KINDS.jewel, type: 'Emerald',
    rarity: 'Rare', mods: ['a'], tradeWindow: '3days'
  })
  const q = JSON.parse(decodeURIComponent(url.split('?q=')[1]))
  const swept = affixQuery(ITEM_KINDS.jewel, 'Emerald', 'a', '3days', 'Rare')
  assert.deepEqual(q.query.stats.slice(1), swept.stats.slice(1))
  assert.equal(q.query.type, swept.type)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/item-kinds.test.mjs tests/sweep.test.mjs tests/api.test.mjs`
Expected: FAIL. `pinned` is not a function; `poolQuery` receives a kind where it expects a type.

- [ ] **Step 3: Add `pinned` to the registry**

In `lib/item-kinds.mjs`, above `ITEM_KINDS`:

```js
// The same shape the trade site builds, as its own stat group so the modifier
// group and this one never contend for a slot.
const usesGroup = (statId) => ({
  type: 'and',
  filters: [{ id: statId, value: { min: MIN_USES }, disabled: false }]
})
```

On the tablet kind:

```js
    // THE SEAM. What every search of this kind pins beyond the modifier group,
    // and the reason for anything it cannot pin.
    //
    // lib/sweep.mjs and lib/trade-url.mjs both call this, and that is the whole
    // point: a price here is the price of a FULL tablet, so a link that omits
    // the uses filter opens a market whose cheap end the price excluded. It
    // shipped that way until 2026-09-07. One function, two callers, no drift.
    //
    // The callers treat `missing` differently on purpose. The sweep throws,
    // because a search that quietly drops a filter spends allowance that cannot
    // be bought back on a question other than the one it recorded. The link
    // degrades and says so, because a search of the right item at the wrong
    // depth beats no search.
    pinned (type) {
      const id = USES_IMPLICIT[type]
      if (!id) {
        return {
          groups: [],
          missing: [`no uses implicit known for ${type}; the search includes part-used tablets`]
        }
      }
      return { groups: [usesGroup(id)], missing: [] }
    }
```

On the jewel kind:

```js
    // A jewel carries no implicit with a charge on it, so there is nothing to
    // pin and nothing missing. `exact` on a jewel trade link is therefore true:
    // the link carries everything the sweep did.
    pinned: () => ({ groups: [], missing: [] })
```

- [ ] **Step 4: Rewire `lib/sweep.mjs`**

Delete the local `usesGroup` (`:42-45`) and the `USES_IMPLICIT`/`MIN_USES` import. Replace `base` (`:47-70`):

```js
const base = (kind, type, rarity, tradeWindow) => {
  const { groups, missing } = kind.pinned(type)
  // A search that silently drops a filter collects a different item under a
  // question that says it excluded one, and it spends allowance to do it.
  if (missing.length) {
    throw new Error(
      `No uses implicit known for ${JSON.stringify(type)}. ` +
      `${missing.join('; ')}. Add it to USES_IMPLICIT in lib/item-kinds.mjs; ` +
      'it is the stat id of the "Adds ... to a Map" line that carries the ' +
      'uses remaining. Nothing has been searched.')
  }
  return {
    status: { option: 'securable' },
    type,
    filters: {
      type_filters: { filters: { rarity: { option: rarity } } },
      trade_filters: {
        filters: {
          price: { option: 'exalted_divine' },
          indexed: { option: tradeWindow }
        }
      }
    },
    // Group 0 stays empty for affixQuery to fill, so a modifier search and a
    // pinned filter never contend for the same slot.
    stats: [{ type: 'and', filters: [] }, ...groups]
  }
}
```

Keep the message opening with `No uses implicit known for "..."`: `tests/sweep.test.mjs` matches that wording, and the test is the one that caught this test silently passing when Expedition Tablet came back.

Then `poolQuery = (kind, type, rarity, tradeWindow) => base(kind, type, rarity, tradeWindow)` and `affixQuery = (kind, type, hash, tradeWindow, rarity)`, keeping the existing rarity guard unchanged. `sweepPools` and `sweepAffixes` take `kind` in their options object and pass it into `poolQuery`/`affixQuery`.

- [ ] **Step 5: Rewire `lib/trade-url.mjs`**

Delete the local `usesGroup` and the `USES_IMPLICIT`/`MIN_USES` import; import nothing from `item-kinds.mjs`, since the kind arrives as an argument. Replace the body:

```js
export function tradeUrl ({ league, kind, type, rarity, mods = [], tradeWindow }) {
  if (!league || !kind || !type) {
    return { url: null, exact: false, reason: 'no league, kind or type' }
  }

  const { groups, missing } = kind.pinned(type)

  const query = {
    query: {
      status: { option: 'securable' },
      type,
      filters: {
        type_filters: { filters: { rarity: { option: String(rarity).toLowerCase() } } },
        trade_filters: {
          filters: {
            price: { option: 'exalted_divine' },
            indexed: { option: tradeWindow }
          }
        }
      },
      stats: [modGroup(mods), ...groups]
    },
    sort: { price: 'asc' }
  }

  const url = `${SITE}/${REALM}/${encodeURIComponent(league)}` +
    `?q=${encodeURIComponent(JSON.stringify(query))}`

  // EXACT MEANS: this link carries every group the sweep pinned. It is not
  // "carries a uses implicit" — a jewel has none to carry and is exact anyway.
  // A tablet type we hold no implicit for is not, and says why.
  if (missing.length) return { url, exact: false, query, reason: missing.join('; ') }
  return { url, exact: true, query }
}
```

Update the header comment: the modifier group is still the one deliberate difference from the collection query, and `exact` now tracks the pinned groups rather than the uses implicit specifically.

- [ ] **Step 6: Pass the kind through `steps/collect.mjs`**

Add `import { ITEM_KINDS } from '../lib/item-kinds.mjs'` and pass `kind: ITEM_KINDS.tablet` to both `sweepPools` and `sweepAffixes`. Task 7 makes the kind a flag; here it is the literal that keeps behaviour identical.

- [ ] **Step 7: Update the existing call sites in the tests**

`tests/sweep.test.mjs`: every `poolQuery(t, r)` becomes `poolQuery(TABLET, t, r)`, every `affixQuery(t, h, w, r)` becomes `affixQuery(TABLET, t, h, w, r)`, and every `sweepPools`/`sweepAffixes` options object gains `kind: TABLET`. The unknown-type test keeps its regex.

`tests/api.test.mjs`: every `tradeUrl({...})` gains `kind: ITEM_KINDS.tablet`, and the no-league test keeps returning a null url. The `affixQuery` call at `:278` gains the kind.

- [ ] **Step 8: Run the whole suite**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS, 330 tests.

- [ ] **Step 9: Commit**

Subject: `Let each kind pin its own query filters`. Body: state that the sweep and the trade link now call one function, that a search throws on a missing filter while a link degrades and says so, and that `exact` now means the link carries every group the sweep pinned, so a jewel link is exact.

---

### Task 4: Count affixes by kind

**Files:**
- Modify: `lib/derive.mjs:3, 95, 108-112`
- Test: `tests/derive.test.mjs`

**Interfaces:**
- Consumes: `kindOfType` from Task 2.
- Produces: no signature change. `deriveRequest` behaves as before for tablets and stores null open-affix counts for a kind with no measured caps.

- [ ] **Step 1: Write the failing test**

Append to `tests/derive.test.mjs`:

```js
import { kindOfType, ITEM_KINDS } from '../lib/item-kinds.mjs'

// A kind whose affix caps nobody has measured must say unknown, not guess.
// lib/walk.mjs already reads a null open-affix count as unknown rather than as
// an open affix, so null is the honest answer and it is safe downstream.
// Jewels are in this state until step 1.5 measures them.
test('an item of a kind with no measured affix caps stores unknown open affixes', async () => {
  assert.equal(ITEM_KINDS.jewel.maxAffix, null, 'the fixture depends on this')
  await withDb(async (db) => {
    const requestId = seedResponse(db, [rareItemOfType('Emerald')])
    deriveRequest(db, requestId, index)
    const row = db.prepare(
      'SELECT open_prefix p, open_suffix s FROM listing WHERE type = ?').get('Emerald')
    assert.equal(row.p, null)
    assert.equal(row.s, null)
  })
})

// A base type no kind claims is the same answer for the same reason. It also
// says the registry is the authority: an item we cannot place is not quietly
// given the tablet caps because it happened to be rare.
test('a base type no kind claims stores unknown open affixes', async () => {
  assert.equal(kindOfType('Wandering Trinket'), null, 'the fixture must stay unclaimed')
  await withDb(async (db) => {
    const requestId = seedResponse(db, [rareItemOfType('Wandering Trinket')])
    deriveRequest(db, requestId, index)
    const row = db.prepare(
      'SELECT open_prefix p, open_suffix s FROM listing WHERE type = ?').get('Wandering Trinket')
    assert.equal(row.p, null)
    assert.equal(row.s, null)
  })
})
```

Build `rareItemOfType(baseType)` and `seedResponse` from the fixture helpers already in `tests/derive.test.mjs`. Copy the shape of the existing rare-tablet fixture and change only `baseType`, keeping one prefix and one suffix with real `tier` values so `typed` is true. The point of the test is that a typed item still stores null, which proves the cap lookup and not the tier check is doing the work.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/derive.test.mjs`
Expected: FAIL. Both rows store `2` and `2`: the global `MAX_AFFIX.Rare` is applied to every item regardless of kind.

- [ ] **Step 3: Look the caps up by kind**

Replace the `MAX_AFFIX` import with `kindOfType`. Move the `const type = ...` line above the cap lookup, since the cap now depends on it, and replace `:95`:

```js
    // `typeLine` carries the magic affixes — "Collector's Breach Tablet of the
    // Commander" — so grouping by it makes every magic tablet its own pool of
    // one. `baseType` is the clean base at every rarity.
    const type = item.baseType || item.typeLine
    // The caps are per KIND and were measured per kind. A kind with none
    // measured, and a base type no kind claims, both yield no cap, and the
    // columns below store null: unknown, which lib/walk.mjs already reads as
    // "not an open affix". Guessing here would publish a fact nobody measured.
    const cap = kindOfType(type)?.maxAffix?.[item.rarity] ?? null
```

Delete the later duplicate `const type = ...` line. `countable` and the two clamped expressions are unchanged.

- [ ] **Step 4: Run the whole suite**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS, 332 tests. `tests/derive.test.mjs:69-70` still passes: a Breach Tablet is claimed by the tablet kind, whose caps are the same object as before.

- [ ] **Step 5: Commit**

Subject: `Count open affixes against the item's own kind`. Body: state that a kind with no measured caps and a base type no kind claims both store unknown, and that this is what lets jewels be derived honestly before step 1.5.

---

### Task 5: One economy file per kind

**Files:**
- Modify: `lib/economy.mjs:12-21, 44-56`
- Test: `tests/economy.test.mjs`

**Interfaces:**
- Consumes: `ITEM_KINDS` from Task 2.
- Produces:
  - `economyFile(db, { league, kind, lookbackHours, config, textFor, now }) => object`, the returned object gaining a `kind` field holding `kind.key`
  - `economyPath(league, kind) => string`

- [ ] **Step 1: Write the failing test**

In `tests/economy.test.mjs`, change `opts` to carry `kind: ITEM_KINDS.tablet`, change `EVERY_CELL` to `ITEM_KINDS.tablet.types.length * RARITIES.length`, and rewrite the path test:

```js
import { ITEM_KINDS } from '../lib/item-kinds.mjs'

// poe.re's shared/economy.ts builds "<category>/eco_<league>_<type>.json" and
// does not encode the league. The tablet path must not move: something else
// fetches it.
test('economyPath matches what shared/economy.ts asks for', () => {
  assert.equal(economyPath('Runes of Aldur', ITEM_KINDS.tablet),
    'tablet/eco_Runes of Aldur_Tablet.json')
  assert.equal(economyPath('Runes of Aldur', ITEM_KINDS.jewel),
    'jewel/eco_Runes of Aldur_Jewel.json')
})

// A page that loaded the wrong file would render an empty grid and look like a
// collection fault. Naming the kind in the file lets it refuse instead.
test('the economy file names the kind it describes', () => withDb(db => {
  assert.equal(economyFile(db, { ...opts }).kind, 'tablet')
}))

// A kind is a closed list of types, and the file covers all of them whether or
// not anything was collected. A missing line would read as a page fault.
test('the file covers every type of its kind and no other', () => withDb(db => {
  const out = economyFile(db, { ...opts, kind: ITEM_KINDS.jewel })
  assert.deepEqual([...new Set(out.cells.map(c => c.type))].sort(),
    ['Emerald', 'Ruby', 'Sapphire'])
  assert.equal(out.cells.length, ITEM_KINDS.jewel.types.length * RARITIES.length)
  assert.deepEqual(out.mods, [], 'nothing is collected for jewels yet')
}))
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/economy.test.mjs`
Expected: FAIL. `economyPath` takes one argument, and the file has no `kind` field.

- [ ] **Step 3: Take the kind as a parameter**

Replace the `CATEGORY`/`TYPE` constants and the path:

```js
// shared/economy.ts on poe.re builds `<base>/<category>/eco_<league>_<type>.json`
// and does not encode the league, so the space in "Runes of Aldur" arrives
// percent-encoded by fetch. The server decodes it; this function does not.
//
// The category and the type are the kind's own key and label, so the tablet
// path is exactly what it has always been and a second kind needs no new rule.
export const economyPath = (league, kind) =>
  `${kind.key}/eco_${league}_${kind.label}.json`
```

`economyFile` takes `kind`, iterates `kind.types` instead of `TABLET_TYPES`, and returns `kind: kind.key` alongside `league`. Drop the `TABLET_TYPES` import. Update the file's header comment: one line per cell and per modifier, for one kind.

- [ ] **Step 4: Update `web/serve.mjs:158`**

`economyPath(l)` becomes `economyPath(l, ITEM_KINDS.tablet)`, and the `economyFile` call in that handler gains `kind: ITEM_KINDS.tablet`. This is the poe.re compatibility path and it stays tablet-only: nothing has asked it for jewels.

- [ ] **Step 5: Run the whole suite**

Run: `node --test "tests/*.test.mjs"`
Expected: FAIL in `tests/site.test.mjs` and `tests/serve.test.mjs` only, because `leagueFiles` still calls `economyFile` without a kind. Task 6 fixes those. Confirm `tests/economy.test.mjs` passes.

- [ ] **Step 6: Do not commit yet**

Task 6 completes this change. Committing a red suite would break the plan's own rule, so these two tasks share one commit, made at the end of Task 6.

---

### Task 6: Kind in the published paths and the league index

**Files:**
- Modify: `lib/site.mjs:21-47`
- Modify: `lib/leagues.mjs:27-56`
- Modify: `steps/build-site.mjs:78-91`
- Modify: `web/serve.mjs` (`makeHandleSite`)
- Test: `tests/site.test.mjs`, `tests/leagues.test.mjs`, `tests/serve.test.mjs`, `tests/gitignore.test.mjs`

**Interfaces:**
- Consumes: `economyFile` from Task 5, `kindOfType`/`KIND_KEYS`/`ITEM_KINDS` from Task 2.
- Produces:
  - `PATHS.economy(league, kindKey) => string`, `PATHS.fragments(league, kindKey) => string`
  - `leagueFiles(db, { league, kind, lookbackHours, config, textFor, now })`
  - `leaguesFile(held, fallback) => { leagues, default, kinds: Record<string, string[]> }`
  - `listLeagues(override) => { league, snapshots, newestSnapshot, kinds: string[] }[]`

- [ ] **Step 1: Write the failing tests**

`tests/leagues.test.mjs` — the existing deep-equal at `:35` gains the field, and one new test:

```js
assert.deepEqual(listLeagues(dir), [
  { league: 'Runes of Aldur', snapshots: 2, newestSnapshot: '2026-08-31T23:59:18Z',
    kinds: ['tablet'] }
])
```

```js
// A league is not one market any more. The jewel page must not offer a league
// that holds only tablets: it would fetch a file that does not exist and 404
// where it should say nothing has been collected.
test('a league reports which kinds it actually holds', () =>
  withDir((dir) => {
    const db = openDb(join(dir, 'Mixed.db'))
    for (const type of ['Breach Tablet', 'Emerald']) {
      db.prepare('INSERT INTO snapshot (league,type,rarity,stat_id,taken_at) VALUES (?,?,?,?,?)')
        .run('Mixed', type, 'Rare', null, '2026-09-10T00:00:00Z')
    }
    // A snapshot of a type no kind claims must not invent a kind.
    db.prepare('INSERT INTO snapshot (league,type,rarity,stat_id,taken_at) VALUES (?,?,?,?,?)')
      .run('Mixed', 'Wandering Trinket', 'Rare', null, '2026-09-10T00:00:00Z')
    db.close()
    assert.deepEqual(listLeagues(dir)[0].kinds, ['jewel', 'tablet'])
  }))
```

`tests/site.test.mjs` — the league index gains the per-kind lists:

```js
test('the league index names a default the list actually holds', () => {
  const held = [{ league: 'New', kinds: ['tablet'] }, { league: 'Old', kinds: [] }]
  assert.deepEqual(leaguesFile(held, 'New'), {
    leagues: ['New', 'Old'],
    default: 'New',
    // One file boots both pages, so each page needs to know which leagues have
    // anything for IT. A page whose list is empty says so instead of 404ing.
    kinds: { tablet: ['New'], jewel: [] }
  })
  assert.deepEqual(leaguesFile([], null),
    { leagues: [], default: null, kinds: { tablet: [], jewel: [] } })
})

test('the built site names the kind in every data file', () => {
  assert.equal(PATHS.economy('Runes of Aldur', 'tablet'), 'data/eco-runes-of-aldur-tablet.json')
  assert.equal(PATHS.fragments('Runes of Aldur', 'jewel'), 'data/fragments-runes-of-aldur-jewel.json')
})
```

Update the two build assertions at `:87` and `:120-124` to pass `'tablet'`.

`tests/serve.test.mjs` — `PATHS.economy('M')` becomes `PATHS.economy('M', 'tablet')`, same for fragments, and `TABLET_TYPES` at `:77` becomes `ITEM_KINDS.tablet.types`.

`tests/gitignore.test.mjs:36` — pass `'tablet'` to both.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/leagues.test.mjs tests/site.test.mjs`
Expected: FAIL. `listLeagues` returns no `kinds`, `leaguesFile` returns no `kinds`, `PATHS.economy` ignores its second argument.

- [ ] **Step 3: Report kinds from `lib/leagues.mjs`**

In `summarise`, after the snapshot count, read the distinct types and map them:

```js
    // Which markets this file actually holds. Derived from the snapshots
    // themselves rather than stored, because a snapshot already names its type
    // and a second source of the same fact would drift. A type no kind claims
    // contributes no kind: it is history, not a market we publish.
    const types = db.prepare('SELECT DISTINCT type FROM snapshot WHERE league = ?').all(league)
    const kinds = [...new Set(types.map(t => kindOfType(t.type)?.key).filter(Boolean))].sort()
    return { league, snapshots: Number(row.snapshots), newestSnapshot: row.newest, kinds }
```

Import `kindOfType`. Keep the whole function inside its existing try/catch: an old database without the column must still be skipped rather than take the list down.

- [ ] **Step 4: Put the kind in the paths and the index**

`lib/site.mjs`:

```js
// A league name and a kind key both go into a file name. Both kinds take the
// suffix: a special case for tablets would be one more rule to remember, and
// the page, its modules and its data are rebuilt and committed together.
export const PATHS = {
  leagues: 'data/leagues.json',
  economy: (league, kind) => `data/eco-${slug(league)}-${kind}.json`,
  fragments: (league, kind) => `data/fragments-${slug(league)}-${kind}.json`
}
```

`leaguesFile(held, fallback)` keeps its current `leagues` and `default` logic and adds:

```js
  // One index file boots both pages, so it says which leagues each kind has
  // anything for. Without this the jewel page would offer a league that holds
  // only tablets and then fetch a file that was never written.
  const kinds = Object.fromEntries(KIND_KEYS.map(key =>
    [key, held.filter(l => (l.kinds || []).includes(key)).map(l => l.league)]))
```

`leagueFiles(db, { league, kind, ... })` passes the kind to `economyFile`.

- [ ] **Step 5: Write one pair of files per league and kind**

In `steps/build-site.mjs`, replace the per-league loop:

```js
  for (const league of names) {
    const db = openDb(dbPath(league, dataOverride))
    try {
      // Only the kinds this league actually holds. Writing an empty file for a
      // kind nothing was collected for would publish a page's worth of dashes
      // as though it were a measurement.
      const heldKinds = held.find(l => l.league === league)?.kinds ?? []
      for (const key of heldKinds) {
        const kind = kindByKey(key)
        const built = leagueFiles(db,
          { league, kind, lookbackHours: config.lookbackHours, config, textFor: text, now })
        written.push(write(outDir, PATHS.economy(league, key),
          JSON.stringify(built.economy, null, 1)))
        written.push(write(outDir, PATHS.fragments(league, key),
          JSON.stringify(built.fragments, null, 1)))
      }
    } finally {
      db.close()
    }
  }
```

- [ ] **Step 6: Answer the same paths from the server**

In `makeHandleSite`, replace the per-league match with a per-league, per-kind one, using `leagues.held()` to know which kinds a league has, and 404 through for a kind it does not hold. Keep the `lookback` query parameter behaviour.

- [ ] **Step 7: Run the whole suite**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS, 336 tests.

- [ ] **Step 8: Commit Tasks 5 and 6 together**

```bash
git add lib/economy.mjs lib/site.mjs lib/leagues.mjs steps/build-site.mjs web/serve.mjs tests/
git commit -F <message file>
```

Subject: `Publish one economy file per league and kind`. Body: state the file name change, that the poe.re path is unchanged, that a league now reports which kinds it holds so a page cannot offer a market it has no data for, and that the two tasks share a commit because the suite is red between them.

---

### Task 7: Collect one kind at a time

**Files:**
- Modify: `steps/collect.mjs:12, 42-57, 88-93`
- Modify: `config.json` (`testSet` keyed by kind)
- Test: `tests/update.test.mjs`

**Interfaces:**
- Consumes: `kindByKey`, `KIND_KEYS` from Task 2; the sweep signatures from Task 3.
- Produces: `node steps/collect.mjs --kind <key>`, defaulting to `tablet`. Every command line in `README.md` keeps its current meaning.

- [ ] **Step 1: Key the test set by kind**

In `config.json`, wrap the current `testSet` body under a `tablet` key and update the `_testSet` note to say the set is per kind and that the jewel set is written in step 1.5:

```json
  "_testSet": "One type and ten modifiers per KIND, so the walk can be iterated without spending a day's rate allowance. Run with the default (no --full); pick the kind with --kind. High-value, mid and filler modifiers are all present on purpose: a walk that cannot separate them is not working. The jewel set is written in step 1.5, once one search has confirmed the base type names GGG accepts.",
  "testSet": {
    "tablet": { "types": ["Breach Tablet"], "rarities": [...], "affixes": [...] }
  },
```

- [ ] **Step 2: Write the failing test**

Append to `tests/update.test.mjs`, following the existing pattern there for running the step with `--help` or a refusing flag so that **no collection starts**:

```js
// Never import a step to check it loads: steps/collect.mjs runs on import and
// starts a real collection. These spawn it with arguments it must refuse, so
// the process exits before it constructs a client.
const collect = (args) => spawnSync(process.execPath,
  [here('../steps/collect.mjs'), ...args], { encoding: 'utf8' })

test('an unknown kind is refused before anything is searched', () => {
  const r = collect(['--kind', 'tablets'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /Unknown item kind "tablets"/)
  assert.match(r.stderr, /tablet, jewel/)
  assert.match(r.stderr, /Nothing has run/)
})

// The type list is the KIND's, so a tablet name under --kind jewel is a
// mistake worth catching before it spends a search on an empty market.
test('a type belonging to another kind is refused', () => {
  const r = collect(['--kind', 'jewel', '--types', 'Breach Tablet'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /Breach Tablet/)
  assert.match(r.stderr, /Emerald, Ruby, Sapphire/)
})

// A kind with no test set cannot run the cheap default, and saying so beats
// running a full pass by surprise.
test('a kind with no test set refuses the cheap run and says why', () => {
  const r = collect(['--kind', 'jewel'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /no test set/i)
  assert.match(r.stderr, /config\.json/)
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test tests/update.test.mjs`
Expected: FAIL. `--kind` is an unrecognised flag and is ignored, so the tablet test set runs.

- [ ] **Step 4: Add the flag**

In `steps/collect.mjs`, after the config is read and before anything constructs a client:

```js
// Which item kind this pass collects. The default keeps every command line in
// README.md meaning exactly what it meant before there were two kinds.
const kindKey = flag('kind', 'tablet')
let kind
try {
  kind = kindByKey(kindKey)
} catch (err) {
  console.error(`${err.message} Nothing has run.`)
  process.exit(2)
}

// The test set is per kind. A kind with none cannot run the cheap default, and
// falling through to a full pass would spend most of a day's allowance on a
// flag the caller did not type.
const testSet = config.testSet?.[kindKey] ?? null
if (!full && !testSet) {
  console.error(
    `config.json holds no test set for ${kindKey}, so there is no cheap run for it. ` +
    `Add testSet.${kindKey}, or ask for a full pass with --full --i-mean-it. ` +
    'Nothing has run.')
  process.exit(2)
}
```

Replace `TABLET_TYPES` with `kind.types` in the default and in the validation, and update the error to name the kind:

```js
const unknownTypes = types.filter(t => !kind.types.includes(t))
if (unknownTypes.length) {
  console.error(`Unknown ${kindKey} type ${unknownTypes.map(t => JSON.stringify(t)).join(', ')}. ` +
    `Known: ${kind.types.join(', ')}. Nothing has run.`)
  process.exit(2)
}
```

Pass `kind` to `sweepPools` and `sweepAffixes` in place of the literal from Task 3, and name the kind in the opening log line.

- [ ] **Step 5: Run the whole suite**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS, 339 tests.

- [ ] **Step 6: Prove the default is unchanged, without collecting**

Run: `node steps/collect.mjs --kind jewel`
Expected: exit 2, the "no test set" message, no search.

Do **not** run the bare `node steps/collect.mjs` here. It is a real collection of about 13 searches, and Task 3's golden query test already proves the tablet query is unchanged. It is listed in Task 9 as an optional final check.

- [ ] **Step 7: Commit**

Subject: `Collect one item kind at a time`. Body: state that the default is tablet so no documented command line changes meaning, and that a kind with no test set refuses the cheap run rather than falling through to a full pass.

---

### Task 8: One page per kind

**Files:**
- Modify: `web/app.js:13-14, 53-68, 140-194, 205-235, 287-300`
- Modify: `web/index.html:6, 9, 12, 21`
- Create: `web/jewels.html`
- Modify: `web/style.css` (the sibling link only)
- Modify: `lib/regex-keys.mjs:109-133` (`tabletRegex` becomes `stashRegex`)
- Test: `tests/regex-keys.test.mjs`, `tests/web.test.mjs`

**Interfaces:**
- Consumes: `kindByKey` from Task 2, `tradeUrl` from Task 3, `PATHS` and the league index from Task 6.
- Produces: `stashRegex({ statIds, fragments, mode })`, same return shape as `tabletRegex`. The old name is deleted.

- [ ] **Step 1: Rename `tabletRegex`**

In `lib/regex-keys.mjs`, rename the function to `stashRegex` and adjust its comment: nothing in it was ever tablet-specific, and it now serves two kinds. Replace every occurrence in `tests/regex-keys.test.mjs` and in `web/app.js`. No alias.

Run: `node --test tests/regex-keys.test.mjs`
Expected: PASS.

- [ ] **Step 2: Write the failing test**

Append to `tests/web.test.mjs`:

```js
// Two pages, one script. The kind is the only thing that differs, and it
// arrives as a data attribute rather than as a second copy of the logic.
test('every page names its kind, and the script reads it from the page', () => {
  for (const [file, key] of [['index.html', 'tablet'], ['jewels.html', 'jewel']]) {
    assert.match(read(file), new RegExp(`<body[^>]*data-kind="${key}"`), file)
    assert.match(read(file), /<script type="module" src="\.\/app\.js">/, file)
  }
  assert.match(read('app.js'), /document\.body\.dataset\.kind/)
})

// The grid, the headings and the trade link must all come from the kind. A
// literal here is a tablet assumption that a jewel page would render silently.
test('the page holds no tablet literal', () => {
  const code = read('app.js').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(code, /TABLET_TYPES/)
  assert.doesNotMatch(code, /' Tablet'/)
})
```

Run: `node --test tests/web.test.mjs`
Expected: FAIL. There is no `jewels.html`, and `app.js` still imports `TABLET_TYPES`.

- [ ] **Step 3: Read the kind in `web/app.js`**

Replace the import at `:14` and add the lookup near the top of the module, above `state`:

```js
import { RARITIES } from './lib/poe2.mjs'
import { kindByKey } from './lib/item-kinds.mjs'
import { stashRegex } from './lib/regex-keys.mjs'

// Two pages load this file. Which one is saying so on its own <body>, because
// the alternative is two copies of everything below.
const kind = kindByKey(document.body.dataset.kind)
```

Then:

- `PATHS.economy` and `PATHS.fragments` take `kind.key`.
- `boot` reads its league list from `index.kinds[kind.key]` rather than `index.leagues`, and when that list is empty it sets `#meta` to `no ${kind.plural.toLowerCase()} collected yet` and returns without fetching anything.
- `loadLeague` asserts `eco.kind === kind.key` and fails loudly through `fail` if not, rather than rendering an empty grid that reads as a collection fault.
- `renderGrid` iterates `[...kind.types].sort(byBlankPrice)` and labels with `kind.short(type)`.
- `renderResult`'s placeholder becomes `pick a ${kind.label.toLowerCase()} below`.
- `render`'s call to `tradeUrl` gains `kind`.
- `$('#mods-title')` and the document title come from `kind.title` where they are set in script; the static heading is in the HTML.

- [ ] **Step 4: Give each page its kind**

`web/index.html`: `<body data-kind="tablet">`, and add the sibling link inside `header.bar`:

```html
  <a class="sibling" href="./jewels.html">Jewels &rarr;</a>
```

Create `web/jewels.html` as a copy of `index.html` with four differences: `<title>Jewel prices</title>`, `<body data-kind="jewel">`, `<h1>Jewel prices</h1>`, and the sibling link reading `<a class="sibling" href="./index.html">&larr; Tablets</a>`. Everything else, including the result bar and both cards, is identical.

Add a `.sibling` rule to `web/style.css` matching the existing `.ghost` link treatment in the bar.

- [ ] **Step 5: Run the whole suite**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS, 341 tests. `steps/build-site.mjs` copies every file in `web/` except the server, so `jewels.html` needs no entry anywhere.

- [ ] **Step 6: Commit**

Subject: `Give each item kind its own page, on one script`. Body: state that the kind arrives as a data attribute, that a page with no collected league says so rather than fetching a file that was never written, and that `tabletRegex` is now `stashRegex` because nothing in it was tablet-specific.

---

### Task 9: Verify, and say plainly what was not verified

**Files:**
- Modify: `audit-db.mjs`
- Modify: `CLAUDE.md` (the test count)
- Modify: `README.md` (the published file names, `--kind`, the second page)
- Modify: `site/` (rebuilt output)
- Test: `tests/*.test.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: a committed `site/` that the live URL will serve.

- [ ] **Step 1: Have the audit name a base type no kind claims**

`node cli.mjs audit` already compares stored rows against what GGG sent. Add one check to `runAudit`: read `SELECT DISTINCT type FROM listing`, map through `kindOfType`, and report any that come back null.

```js
// Task 4 made a base type no kind claims store unknown open-affix counts. That
// is the honest answer, and it is also silent — one row at a time, with nothing
// on screen. This is where it becomes visible.
const unclaimed = db.prepare('SELECT DISTINCT type FROM listing').all()
  .map(r => r.type).filter(t => !kindOfType(t))
if (unclaimed.length) {
  console.log(`\n${unclaimed.length} base type(s) no item kind claims: ${unclaimed.join(', ')}`)
  console.log('  Their open-affix counts are stored as unknown. Add them to ' +
    'ITEM_KINDS in lib/item-kinds.mjs, or leave them as history.')
}
```

- [ ] **Step 2: Run the audit against the real archive**

Run: `node cli.mjs audit`
Expected: no unclaimed base types. If any appear, stop and report them before rebuilding: it means the registry does not cover data already collected, and Task 4 changed those rows' meaning.

- [ ] **Step 3: Prove the tablet numbers did not move**

Build into a scratch directory and compare against what is committed:

```
node cli.mjs build --out <scratch>
```

Then compare `<scratch>/data/eco-forbidden-rites-tablet.json` against the committed `site/data/eco-forbidden-rites.json`, and the two fragments files likewise. **The only permitted difference is the new `"kind": "tablet"` field.** Any other difference means the refactor changed a published number, and it must be explained before anything is committed.

- [ ] **Step 4: Rebuild the site and remove the stale files**

```
node cli.mjs build
```

Then delete the two files the old names left behind. `steps/build-site.mjs` does not clean its output directory, and a stale `eco-forbidden-rites.json` beside the new one is a file nothing fetches and everything trips over:

```bash
git rm site/data/eco-forbidden-rites.json site/data/fragments-forbidden-rites.json
```

Confirm `site/lib/item-kinds.mjs` and `site/jewels.html` are present, and that `git status` shows the renames and no other surprise.

- [ ] **Step 5: Look at both pages in a browser**

Start the server with the PowerShell tool, then use the `agent-browser` skill to open `http://127.0.0.1:8787/` and `http://127.0.0.1:8787/jewels.html`.

```
node cli.mjs serve
```

Check, and report what was actually seen:

- the tablet page renders its grid and its modifier list as before
- choosing a cell still ticks the high band and fills the search box
- the jewel page loads, says no jewels are collected yet, and does not error
- the browser console is clean on both, which is the check that would have caught the whitelist bug Task 1 fixed

**If the browser cannot be driven, say so plainly and do not report the pages as working.** This repo has shipped a CSS fault through data-level replay before: `.card` sets `display:flex`, and an author rule beats the browser's own `[hidden]` rule.

Stop the server before continuing.

- [ ] **Step 6: Correct the documentation**

`CLAUDE.md` says the suite is 278 tests. It was 313 before this work. Set it to whatever `node --test "tests/*.test.mjs"` actually reports now, and change the two references to `lib/poe2.mjs` under The phase boundary if they name a moved constant.

`README.md`: the three published file names now carry a kind, `steps/collect.mjs` takes `--kind`, and there are two pages. Describe what the code does now. Do not describe the move.

- [ ] **Step 7: Run everything one last time**

```
node --test "tests/*.test.mjs"
```

Expected: PASS. Record the count.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -F <message file>
```

Subject: `Republish the tablet data under its kind`. Body: state that the tablet economy content is unchanged apart from the new `kind` field, that the stale files are removed, what the audit found, and **whether a browser was actually used and what was seen**.

---

## Self-review

**Spec coverage.** Every section of `docs/item-kinds-design.md` has a task: the registry and the moved constants in Task 2, `pinned` and the new `exact` rule in Task 3, the affix caps in Task 4, the economy file in Task 5, the published paths and the league index in Task 6, `--kind` and the config in Task 7, the two pages and `stashRegex` in Task 8, the whitelist bug in Task 1, and the audit, the docs and the browser check in Task 9. The spec's out-of-scope list is carried into the jewel kind's own comment, so the unverified base type names travel with the code that would fail on them.

**Type consistency.** `pinned` returns `{ groups, missing }` in Tasks 3, 5 and 8 alike. `PATHS.economy` takes a kind KEY, a string, while `economyPath` and `economyFile` take a kind OBJECT. That asymmetry is deliberate and worth stating: `PATHS` is imported by the browser, where a path is built from the key already in hand, whereas `economyFile` needs the types and the label. `kindByKey` is the bridge, and Tasks 6 and 8 both use it.

**Known gap.** The plan proves the tablet query is unchanged with a golden test rather than with a live search. That is the right trade, and Task 9 step 3 is the second, independent check: the published numbers must not move.
