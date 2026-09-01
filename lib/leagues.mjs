// PHASE 2. Which leagues this machine actually holds prices for.
//
// The data directory is not a list of leagues. Every league is one SQLite file
// named after it — lib/paths.mjs dbPath(league) — but other .db files collect
// there too: Runes.db and ServeTest4.db are 4 KB test leftovers sitting beside
// the real database today. Offering them in a dropdown would offer two leagues
// that can show nothing.
//
// A league earns its place by holding at least one snapshot UNDER ITS OWN NAME.
// The name matters twice: it is the file name we open, and it is what every
// query filters on, so a database whose snapshots name a different league would
// open and then answer nothing.
//
// Read-only, always. This walks files the user did not ask us to touch, so it
// must not create a table, recover a journal, or leave a mark of any kind on
// one of them.
import { DatabaseSync } from 'node:sqlite'
import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { dataDir } from './paths.mjs'

const SUFFIX = '.db'

// One row, or nothing at all. Anything unreadable — a file that is not SQLite,
// a database from before the snapshot table existed, a permission refusal — is
// not a league, and must not take the rest of the list down with it.
function summarise (path, league) {
  let db = null
  try {
    db = new DatabaseSync(path, { readOnly: true })
    const row = db.prepare(
      'SELECT count(*) AS snapshots, max(taken_at) AS newest FROM snapshot WHERE league = ?')
      .get(league)
    if (!row || !row.snapshots) return null
    return { league, snapshots: Number(row.snapshots), newestSnapshot: row.newest }
  } catch {
    return null
  } finally {
    try { db?.close() } catch { /* already gone */ }
  }
}

/**
 * Lists the leagues held in a data directory, newest snapshot first.
 * @param {string|null} override - Data directory, as `--data` gives it.
 * @returns {{league: string, snapshots: number, newestSnapshot: string}[]} One
 *   entry per league that holds at least one snapshot under its own name.
 */
export function listLeagues (override = null) {
  const dir = dataDir(override)
  return readdirSync(dir)
    .filter(f => f.endsWith(SUFFIX))
    .map(f => summarise(join(dir, f), basename(f, SUFFIX)))
    .filter(Boolean)
    .sort((a, b) => (a.newestSnapshot < b.newestSnapshot ? 1 : -1))
}
