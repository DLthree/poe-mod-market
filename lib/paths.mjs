import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'

// The repo lives on the WSL share and is reached over SMB from Windows node.
// SQLite cannot run there at all: every journal mode, and even a bare CREATE
// TABLE, fails with "database is locked". So generated data goes to local disk.
//
// Nothing here is precious — the database is regenerable and already ignored by
// git — but the path must be stable, so it is one function rather than a
// literal repeated in three CLIs.
//
// Override with TABLET_DATA_DIR, or --data on any CLI.
export function dataDir (override = null) {
  const base = override ||
    process.env.TABLET_DATA_DIR ||
    join(process.env.LOCALAPPDATA || process.env.XDG_DATA_HOME || homedir() || tmpdir(),
      'poe2-tablet-price')
  mkdirSync(base, { recursive: true })
  return base
}

export const dbPath = (league, override = null) => join(dataDir(override), `${league}.db`)
export const cacheDir = (override = null) => {
  const d = join(dataDir(override), 'cache')
  mkdirSync(d, { recursive: true })
  return d
}
// ONE TABLE PER LEAGUE AND KIND. It was one per league, and a jewel run then
// overwrote the tablet table with a walk over both kinds mixed together — the
// diagnostic named a league and quietly meant whichever kind ran last.
export const modTablePath = (league, kind, override = null) =>
  join(dataDir(override), `mod-table-${league}-${kind}.json`)
