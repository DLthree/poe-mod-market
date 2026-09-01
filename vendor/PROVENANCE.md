# What is in this directory

## `ee2-stats.ndjson` — Exiled Exchange 2, MIT

Generated stat table from `Kvan7/Exiled-Exchange-2` at `acc7653`. MIT licensed,
so the data may be used and redistributed with attribution. It is an **overlay**
on GGG's own `/api/trade2/data/stats`: each holds wordings and ids the other
lacks, so both are loaded. See `lib/stat-index.mjs`.

## Nothing from poe.re, and why

`github.com/veiset/poe.re` ships a table of 81 short regex fragments for tablet
modifiers. On 2026-08-31 we vendored 76 of them as a placeholder, with the owner
of this repository accepting the licence risk for local use, and then measured
them against GGG's current wordings.

**Twelve of the 76 were wrong for us:**

- 4 matched more than one modifier. `iles` matches both "Gold Piles" and "Rogue
  Exiles"; `a s` matches three.
- 8 matched nothing at all. Their table expects "additional Shrines" where GGG
  now says "an additional Shrine".

Their table was generated against older wordings, and it could not know about the
four modifiers it does not carry — one of which is the Overseer boss modifier at
200 exalted, the most valuable single thing in our sweep.

A fragment that matches nothing silently hides a keeper. One that matches two
silently lets junk through. Neither shows up on the page.

So `lib/regex-keys.mjs` generates every fragment from GGG's own stat text
instead. It produces 70 of 70 with no collisions in about 240 ms, cannot go
stale, and settles the licence question by not raising it. **That repository
carries no licence — read it to learn from, take nothing out of it.**
