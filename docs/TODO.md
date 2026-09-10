# TODO

Wanted, not built. Each entry says what it is for and what is already known
about the cost, so nobody re-derives that.

## Run a full jewel pass on the pool

**Built, tested, and not yet run.** The jewel sweep now takes loop 2's vocabulary
from `vendor/poe2-jewel-mods.json` rather than from what it has already seen, and
every jewel search excludes desecrated items. `docs/jewel-modifier-pool.md` has
the method and the two traps.

What is left is to spend the allowance and look at the result.

| | |
|---|---|
| Emerald, Ruby and Sapphire at rare | 182 searches |
| the same at magic | 182 searches |
| loop 1 pools | 6 searches |
| **a full jewel pass** | **about 370 searches** |

That fits one six-hour window of 600. It does NOT fit beside a full tablet pass,
which is about 520.

**Do not run the one-time discovery pass this file used to describe.** It was
costed at seven six-hour windows. The game data answers the same question for
nothing.

### What to look at when it lands

- **The four modifiers the archive has never seen on an Emerald**:
  increased Magnitude of Ailments you inflict, increased Daze Buildup, Damaging
  Ailments deal damage faster, increased Movement Speed. Only 4 of Emerald's 74
  were missing from the old vocabulary, so the bias was narrower than it looked.
  If these four price like the rest, the pool bought less than expected.
- **Whether the floor still separates rows.** Every jewel cell measured before
  floored at 1 exalted. The pool adds questions; it does not by itself make the
  answers differ.

### One thing the pool settles

**Every enabled jewel modifier carries spawn weight 1.** The game reports no
rarity gradient inside a base. A modifier either rolls on a base or it does not.
So spawn weight cannot rank candidates, and `total` for sale is still the only
scarcity signal available.

### What has been ruled out, so nobody repeats it

- **The sibling projects are PoE1.** `poe.re/poe/src/generated/GeneratedJewel.ts`,
  `tab-triage/out/jewels.mjs` and `claude-poe-stash-helper/attic/jewels.mjs` all
  describe Abyss jewels, Cluster jewels, Corrupted Blood and Critical Strike
  Multiplier. Checked 2026-09-10.
- **The RePoE checkout at `C:\Users\loffr\dev\repoe\` is PoE1.** Its jewel spawn
  tags are `abyss_jewel`, `affliction_jewel` and `expansion_jewel_*`. No Emerald,
  Ruby or Sapphire.
- **GGG's `/data/stats` has no item association.** 3042 explicit stats covering
  every item class, and nothing that says which a jewel can roll.
- **Exiled Exchange 2's own data does not carry spawn weights.** Its parser asks
  the `Mods` table for ids, stats and generation type only. `SpawnWeight_Tags`
  appears once in its config, under the `Words` table.
- **Sorting the pool query price-descending does not help.** The ten dearest
  Emerald rares cost 1000 to 4030 divine, carry the same junk as the 1-exalted
  ones, and contributed zero new vocabulary.

## Re-collect the tablet magic and normal cells

Every magic and normal search now excludes corrupted listings, because
`lib/summary.mjs` has always dropped them from those cells and the search did
not. `tests/query-parity.test.mjs` holds the rule now.

**Snapshots taken before 2026-09-10 asked a different question.** They hold
corrupted rows, and the summary filters them out on the way to the page, so the
published number is right either way. What changed is the SAMPLE: a corrupted row
took one of the ten kept slots and was then discarded, so those cells priced from
eight or nine listings. A pass fixes that; nothing is wrong until then.

Jewels get this for free on their next full pass. Tablets need a pass of their
own, about 520 searches.

## Price a modifier ALONE, on a magic jewel

**This may be the best measurement available, and it addresses the objection
that sank the first jewel conclusion.**

A rare jewel's price is a conjunction: it is worth buying when several good
modifiers land together, so a single-modifier search on a rare asks a question
nobody prices. A magic jewel holds at most one prefix and one suffix. So a
**magic jewel carrying exactly one modifier and nothing else** is the purest
possible reading of what that modifier is worth on that base, with nothing else
contributing to the price.

The search shape wanted is "has modifier X, and empty modifiers: 1" — the
modifier plus one empty affix slot.

What is already in place:

- `lib/derive.mjs` already stores `open_prefix` and `open_suffix` per listing, so
  the count can be read back off collected rows without any new request.
- `lib/walk.mjs` already treats open affixes as candidates and reads a null count
  as unknown rather than as an open slot.
- Magic is the plainest rarity jewels trade, so it is already the kind's blank
  form and the baseline the grid sorts on.

What has to be checked first:

1. **Whether the trade API can filter on empty affix count at all.** If it can,
   this is a query change and nothing more. If it cannot, the filter has to
   happen on our side, which means collecting more listings per cell and keeping
   only the single-modifier ones — a different and dearer shape.
2. **The magic affix cap for jewels**, which is currently `null` on purpose. 28
   magic jewels showed at most 1 prefix and 1 suffix, but that is a thin sample
   from the cheap end. "Exactly one modifier" is only well defined once the cap
   is known.

Do not conflate this with the vocabulary problem above. This makes each
measurement cleaner; it does not help discover WHICH modifiers to measure. Both
are needed.

## Store `total` on the snapshot

Free, and nothing above can be analysed without it. `runCell` in `lib/sweep.mjs`
already reads `res.total` and logs it; no column keeps it. Every archived search
response holds it, so old passes can be back-filled without a request.

It also looks like the value signal on jewels: 0 for sale means the base cannot
roll it, 10-20 means dear, 1000+ means common and cheap.

## Price history per cell

A view of how a cell and its modifiers have moved over time, for both kinds.
The archive already holds it — every snapshot is stamped `taken_at` and nothing
is ever deleted — so this needs no new collection at all, only a reader and a
page. Phase 2 work by definition.

## Pull the exchange rates automatically

`config.exchange` is a standing guess that drifts, currently 150 exalted to a
divine and 10 to a chaos. It is used for the ratio, the added amount and the
sort order, never to convert a stored price, and every row that leans on it
carries `assumedRate`.

Fetching chaos:exalted and divine:exalted would remove the drift. Note what the
sweep comments already record: reading the BULK EXCHANGE for this was tried and
was wrong, because the book is mostly scam offers and its median disagreed with
the server's own price ordering by 2.5x. So the source matters, and the obvious
one has already failed once.
