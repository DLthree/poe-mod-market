// PHASE 2. The three payloads the page reads, and the paths it reads them from.
//
// THE POINT OF THIS FILE: the page must not know whether a server is answering
// it. GitHub Pages serves files and nothing else, so every URL the page fetches
// has to be a relative path that can exist as a file on disk. The dev server
// computes these live at the same paths; `steps/build-site.mjs` writes them out
// as files. One code path in the browser, and a local page that is the same
// page as the published one.
//
// A league name goes into a file name, so it is encoded once, here, and both
// the writer and the server use this function rather than encoding their own.
import { economyFile } from './economy.mjs'
import { buildFragments } from './regex-keys.mjs'

// Percent-encoding is not enough: a league name can hold a space, and a colon
// is legal in a URL but not in a Windows file name. Lower case with dashes is
// stable, readable in a URL bar, and safe on every filesystem.
export const slug = (league) =>
  String(league).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export const PATHS = {
  leagues: 'data/leagues.json',
  economy: (league) => `data/eco-${slug(league)}.json`,
  fragments: (league) => `data/fragments-${slug(league)}.json`
}

/**
 * The league index the page boots from.
 * @param {{league: string, snapshots: number, newestSnapshot: string}[]} held
 * @param {string} fallback - The league to open when nothing else says.
 */
export function leaguesFile (held, fallback) {
  const names = held.map(l => l.league)
  const leagues = names.includes(fallback) ? names : [fallback, ...names].filter(Boolean)
  return { leagues, default: leagues.includes(fallback) ? fallback : leagues[0] ?? null }
}

/**
 * Both per-league payloads, from one database. No network call.
 * @returns {{economy: object, fragments: Record<string, string>}}
 */
export function leagueFiles (db, { league, lookbackHours, config, textFor, now }) {
  const economy = economyFile(db, { league, lookbackHours, config, textFor, now })
  const texts = {}
  for (const m of economy.mods) texts[m.statId] = textFor(m.statId)
  return { economy, fragments: buildFragments(texts) }
}
