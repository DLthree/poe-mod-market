# Handoffs

One file per session boundary, newest last. They live here rather than in the
OS temp directory, which is where they used to go and where they were one
`%TEMP%` sweep away from being lost.

**Naming:** `YYYY-MM-DD-<letter>-<what the next session is for>.md`. The letter
orders several handoffs written on one day.

**A handoff is not a spec.** It says what the next session is FOR, what has
already been ruled out, and what it will cost. Everything durable belongs in a
document of its own — `docs/TODO.md`, a design doc, or a comment beside the code
it explains — and the handoff references it by path. A fact that only exists in
a handoff will be read once and then never again.

**Spent handoffs stay.** They are the record of what was tried and why, and
their "ruled out" sections are the most expensive content in this directory:
each entry cost searches, time, or both. Do not delete one because its work is
done. Say at the top that it is spent and which file replaced it.

| file | for | state |
|---|---|---|
| `2026-09-10-a-jewel-page-beside-the-tablet-page.md` | generalise the tablet code to a second item kind, then sweep jewels | **spent** — all four steps done |
| `2026-09-10-b-find-the-jewel-modifier-list.md` | find the modifiers a PoE2 jewel can roll, per base | current |
