# TODO

Wanted, not built. Each entry says what it is for and what is already known
about the cost, so nobody re-derives that.

## Use the extracted jewel modifier pool

**The blocker is gone.** `vendor/poe2-jewel-mods.json` holds the modifiers each
tradeable jewel base can roll: Ruby 50, Emerald 74, Sapphire 58. It came from the
game's own tables and cost no rate allowance. `docs/jewel-modifier-pool.md` has
the method.

What is left is to make the sweep read it.

`affixesFor(db, type, rarity)` in `lib/sweep.mjs` builds loop 2's vocabulary from
the modifiers loop 1 already saw, and loop 1 keeps the CHEAPEST listings. So a
modifier that is scarce on a base is never asked about.
`docs/jewel-vocabulary-bias.md` has the measurement.

For jewels the vocabulary should come from the pool file instead. That is 182
searches per rarity, against about 520 for a full tablet pass, so the complete
question is affordable.

**Do not run the one-time discovery pass this file used to describe.** It was
costed at seven six-hour windows. The game data answers the same question for
nothing.

### Two things the pool changes about the plan

- **Every enabled jewel modifier carries spawn weight 1.** The game reports no
  rarity gradient inside a base. A modifier either rolls on a base or it does
  not. So spawn weight cannot rank candidates, and `total` for sale is still the
  only scarcity signal available.
- **An `explicit.stat_X` search also returns desecrated modifiers.** The archived
  probe proves it. A jewel cell therefore measures two markets at once unless the
  query separates them. Decide that before publishing any jewel number.

### The join has a small hole

173 of the 182 pairs resolve to a trade stat id through `ee2-stats.ndjson`. The
nine that do not are common stats such as attack speed and evasion rating, so the
gap is in the join and not in the pool. Close it with a text match against the
stat cache and `lib/stat-index.mjs`.

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
