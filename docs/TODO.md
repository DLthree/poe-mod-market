# TODO

Wanted, not built. Each entry says what it is for and what is already known
about the cost, so nobody re-derives that.

## Pull the modifier list, on request

**The blocker for jewels.** `lib/sweep.mjs` builds loop 2's vocabulary from the
modifiers loop 1 already saw, and loop 1 keeps the CHEAPEST listings, so a
modifier that is rare on a base is never asked about — which is the very thing
that makes it dear. `docs/jewel-vocabulary-bias.md` has the measurement:
maximum Energy Shield is worth 1 to 60 divine on Emerald rare and the full pass
said nothing about it.

### The lead, found 2026-09-10

**The game's own modifier table is on this machine.** Exiled Exchange 2's data
parser reads the `Mods` and `Tags` tables straight out of a PoE2 install, and
names the columns `SpawnWeight_Tags` and `SpawnWeight_Values` — per-modifier
spawn weights keyed by item tag, which is exactly the shape wanted.

- Parser: `C:\Users\loffr\dev\exiled-exchange-2\dataParser`, run as
  `python ./src/main.py` from that folder. Its `data/vendor/tables/` is empty,
  so it extracts rather than ships the tables.
- Game data: `C:\Program Files (x86)\Grinding Gear Games\Path of Exile 2\Content.ggpk`,
  153 GB. The parser's config defaults to a Steam path; the Steam directory here
  holds only logs, so it must be pointed at the GGG one.
- **Untested: whether the parser runs here at all.** That is the first thing to
  find out and it costs no rate allowance.

**Half the answer is already extracted.** EE2's
`renderer/public/data/en/items.ndjson` tags the three bases: Emerald is
`dexjewel`, Ruby is `strjewel`, Sapphire is `intjewel`. That alone explains the
Energy Shield measurement — Energy Shield is an intelligence stat, so it is
native and cheap on Sapphire and off-attribute, rare and dear on Emerald. **The
attribute tag is what predicts price.**

If this route works, the pool comes from a local file: free, offline, repeatable
after each patch, and carrying rarity weights the trade API cannot report.

### What has been ruled out, so nobody repeats it

- **The sibling projects are PoE1.** `poe.re/poe/src/generated/GeneratedJewel.ts`,
  `tab-triage/out/jewels.mjs` and `claude-poe-stash-helper/attic/jewels.mjs` all
  describe Abyss jewels, Cluster jewels, Corrupted Blood and Critical Strike
  Multiplier. Checked 2026-09-10.
- **The RePoE checkout at `C:\Users\loffr\dev\repoe\` is PoE1.** Its `mods.json`
  holds 808 occurrences of "Critical Strike Chance" against 1 of "Critical Hit
  Chance", and its jewel spawn tags are `abyss_jewel`, `affliction_jewel` and
  `expansion_jewel_*`. No Emerald, Ruby or Sapphire.
- **GGG's `/data/stats` has no item association.** It is already cached, and it
  holds 3042 explicit stats covering every item class in the game. Nothing in it
  says which ones a jewel can roll.
- **Sorting the pool query price-descending does not help.** One search per cell,
  tested 2026-09-10: the ten dearest Emerald rares cost 1000 to 4030 divine and
  carry exactly the same junk modifiers as the 1-exalted ones, contributing ZERO
  new vocabulary. The dear end is ask-price listings, not value. The valuable
  middle is invisible from both ends of the sort.

What is left. **A search returns `total` for free, and 0 for sale is a definitive
answer that a base cannot roll a modifier.** So discovery is affordable as a
ONE-TIME pass whose result is durable until a patch changes the pool:

| step | cost |
|---|---|
| ask all 3042 explicit stats of ONE cell | 3042 searches, about 5 six-hour windows |
| ask the survivors (a few hundred) of the other five cells | roughly 1000 searches |

Store the result as a checked-in per-kind modifier pool, and the normal sweep
then reads that instead of bootstrapping from what it happened to see.

**Only do that if the local route above fails.** Still unchecked as a middle
option: poe2db.tw, poe.ninja's PoE2 endpoints, and Exiled Exchange 2's published
releases, whose shipped data may include what its source checkout does not.

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
