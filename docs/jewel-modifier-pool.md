# The jewel modifier pool, from the game's own data

Extracted 2026-09-10 from Path of Exile 2 patch `4.5.5.1.6`. The result is
`vendor/poe2-jewel-mods.json`. It costs no rate allowance and it needs no trade
request.

**This answers the blocker in `docs/TODO.md`.** The list of modifiers each jewel
base can roll is now a local file.

## The answer

| base | attribute tag | modifiers | prefixes | suffixes |
|---|---|---|---|---|
| Ruby | `strjewel` | 50 | 29 | 21 |
| Emerald | `dexjewel` | 74 | 30 | 44 |
| Sapphire | `intjewel` | 58 | 23 | 35 |

182 base-and-modifier pairs in total. The three pools barely overlap. Only two
modifiers roll on all three bases. Emerald has 61 modifiers that neither of the
other two can roll.

**A full jewel sweep that asks every rollable modifier costs 182 searches per
rarity.** A full tablet pass costs about 520. So the complete question is
affordable, and the one-time discovery pass costed in `docs/TODO.md` at seven
six-hour windows is no longer needed. Do not run it.

## How the data was obtained

Exiled Exchange 2 does not read the game itself. Its Python parser shells out to
`pathofexile-dat`, which is an npm package. So the extraction runs on node, and
the missing Python is not a problem.

**Python is not installed on this machine.** Node is. The steps below use node
only.

1. Read the game version from the client log. The line names the patch web root:

   ```
   C:\Program Files (x86)\Grinding Gear Games\Path of Exile 2\logs\LatestClient.txt
   Web root: https://patch-poe2.poecdn.com/4.5.5.1.6/
   ```

2. In an empty directory, install the extractor and write a `config.json`:

   ```
   npm install pathofexile-dat@15.2.0
   ```

   The config names the patch, the language and the tables. `Mods`, `Tags`,
   `BaseItemTypes`, `ItemClasses` and `Stats` are enough. The `Mods` columns that
   matter are `Id`, `Domain`, `Name`, `GenerationType`, `Level`, `SpawnWeight_Tags`,
   `SpawnWeight_Values` and `Stat1` to `Stat6`.

3. Run the extractor. It writes `tables/English/*.json`:

   ```
   node ./node_modules/pathofexile-dat/dist/cli/run.js
   ```

The whole run took about a minute and cached 113 MB of game bundles.

### Why the local install is not the source

`pathofexile-dat` reads a loose `Bundles2` directory. A Steam install has one.
**The install here is the standalone one, and it packs the bundles inside
`Content.ggpk`**, which that loader cannot open. So the config names the patch
instead, and the tool downloads the few bundles it needs from GGG's patch CDN.

The patch CDN is not the trade API. It has no bearing on the trade rate
allowance.

## How a base's pool is decided

Every jewel affix sits in mod domain **11**. The item domain is 1 and holds
nothing for jewels. That is the one thing that is easy to get wrong.

Each modifier carries a list of tags and a parallel list of spawn weights. The
first tag that the base also carries decides the weight. A weight above zero
means the base can roll the modifier.

Three facts make this simple here:

- **Every weight in the jewel domain is 1.** The tag decides membership. No
  modifier is rarer than another on a base it can roll.
- **Every positive weight sits on an attribute tag**: `strjewel`, `dexjewel`,
  `intjewel` or their radius equivalents. There is no `default` catch-all, so
  nothing rolls on a base by falling through.
- **57 jewel modifiers carry no positive weight anywhere.** They are disabled and
  cannot roll at all.

Base tags come from `BaseItemTypes`. Ruby is `strjewel`, Emerald is `dexjewel`,
Sapphire is `intjewel`. Diamond and Timeless carry all three and reach all 160
enabled modifiers, but both are tagged `not_for_sale`.

## Joining to trade stat ids

The game names a stat `maximum_energy_shield_+%`. The trade API names it
`explicit.stat_2482852589`. The two do not compute from each other.

**`HASH32` in the `Stats` table is not the trade id.** That was checked. The
trade id derives from the stat text, not from the stat row.

`vendor/ee2-stats.ndjson` carries both: its `id` field is the game stat id, and
`trade.ids` holds the trade ids by domain. Joining on the game stat id resolves
**173 of the 182 pairs**.

The nine that do not resolve all share a wording with another game stat. Exiled
Exchange 2 keeps one record per wording and files it under the OTHER stat's id,
so the join misses them. Its record for "#% increased Attack Speed" is filed
under `local_attack_speed_+%`, the weapon stat, while a jewel rolls the global
`attack_speed_+%`.

Six were settled by evidence. Our own archive holds 1930 collected jewel
listings, and a hash that appears on a jewel is the global variant, because a
jewel is not a weapon. The other three carry a wording only one trade stat has.

| game stat | trade stat id | settled by |
|---|---|---|
| `physical_damage_reduction_rating_+%` | `explicit.stat_2866361420` | archive, 8 jewels |
| `attack_speed_+%` | `explicit.stat_681332047` | archive, 51 jewels |
| `evasion_rating_+%` | `explicit.stat_2106365538` | archive, 82 jewels |
| `block_chance_+%` | `explicit.stat_4147897060` | archive, 62 jewels |
| `maximum_energy_shield_+%` | `explicit.stat_2482852589` | archive, 21 jewels |
| `maximum_mana_%_gained_on_kill` | `explicit.stat_1604736568` | archive, 2 jewels |
| `base_movement_velocity_+%` | `explicit.stat_2250533757` | only wording |
| `base_chance_to_daze_%` | `explicit.stat_1949833742` | only wording |
| `shield_armour_evasion_energy_shield_+%` | `explicit.stat_2523933828` | only wording |

Each entry in the pool file records which of the two settled it, in
`tradeIdSource`. Reapply this table after a re-extraction.

## The desecrated exclusion, and the trap in it

Every jewel search now carries one extra stat group, from `kind.pinned` in
`lib/item-kinds.mjs`. It excludes items carrying a desecrated modifier, so a
jewel price means one thing.

**The group type must be `not`.** The obvious shape is an `and` group holding
`pseudo.pseudo_number_of_desecrated_mods` at a maximum of zero. That matches
NOTHING. An item with no desecrated modifier carries no such pseudo stat, so the
comparison fails for every ordinary jewel. A full pass built that way would
report an empty market and would look exactly like a working sweep.

Probed 2026-09-10, five searches against Forbidden Rites:

| search | without exclusion | with `not` group |
|---|---|---|
| blank Emerald rare | 10000 | 10000 |
| Emerald rare, increased Attack Speed | — | 10000 |
| Emerald rare, increased maximum Energy Shield | 22 | 0 |

The last row is the pool proving itself. Emerald cannot roll that modifier, and
once the desecrated items are gone there is nothing left.

The archive holds no desecrated rows at all, from any earlier pass. Those items
are dear, and every pass keeps only the ten cheapest of a cell, so none ever
reached the sample. Nothing collected before today is contaminated.

## What the cheap run does and does not check

`node steps/collect.mjs --kind jewel` runs the test set in `config.json`. It uses
the hashes listed there and **never calls the kind's vocabulary**, so it cannot
show that a jewel now reads this pool. Only a `--full` run does that.
`tests/sweep.test.mjs` checks the choice instead.

## What must be redone after a patch

The pool changes when GGG changes it. Re-run the three steps above with the new
patch number from the client log. Nothing else in the repo needs to change.
