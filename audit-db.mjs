// Throwaway audit of what phase 1 actually stored. Reads the database only; no
// network call. Every check compares a derived column against something GGG
// itself sent, so a disagreement is our bug, not a market fact.
//
// Not an entry point: cli.mjs's `audit` subcommand calls runAudit() in
// process. There is no anti-drift argument for a read-only report the way
// there is for the sweep steps, so folding it in is simplest.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dbPath } from './lib/paths.mjs'
import { openDb } from './lib/db.mjs'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))

const USAGE = `Check stored rows against what GGG itself sent. No network call.

  node cli.mjs audit

  --league <name>   default from config.json
  --data <dir>      override the data directory`

/**
 * Audits the tablet database: every check compares a derived column against
 * something GGG itself sent, so a disagreement is our bug, not a market fact.
 * @param {string[]} argv - Flags following the `audit` subcommand.
 */
export function runAudit (argv) {
  if (argv.includes('--help')) {
    console.log(USAGE)
    return
  }
  const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1] }
  const config = JSON.parse(readFileSync(here('./config.json'), 'utf8'))
  const db = openDb(dbPath(flag('league', config.league), flag('data', null)))

  const q = (sql, ...a) => db.prepare(sql).all(...a)
  const head = (s) => console.log(`\n== ${s}`)
  const table = (rows) => {
    for (const r of rows) console.log('   ' + Object.values(r).map(v => String(v ?? '-')).join('  |  '))
  }

  head('size')
  table(q(`SELECT
  (SELECT count(*) FROM request) requests,
  (SELECT count(*) FROM listing) listings,
  (SELECT count(DISTINCT listing_id) FROM listing) distinct_listings,
  (SELECT count(*) FROM listing_mod) mods`))

  head('requests by kind and status')
  table(q('SELECT kind, status, count(*) n FROM request GROUP BY kind, status ORDER BY n DESC'))

  head('cells stored, by type and rarity')
  table(q('SELECT type, rarity, count(*) n, count(DISTINCT account) sellers FROM listing GROUP BY type, rarity ORDER BY n DESC'))

  head('price currencies')
  table(q('SELECT price_currency, price_kind, count(*) n, min(price_amount) lo, max(price_amount) hi FROM listing GROUP BY price_currency, price_kind ORDER BY n DESC'))

  // GGG sends the roll band in `magnitudes`. If our extracted roll sits outside
  // its own band, the regex in rollsFrom() missed and the number fallback lied.
  head('rolls outside the band GGG sent (should be 0)')
  const bad = q(`SELECT hash, roll, roll_min, roll_max, count(*) n FROM listing_mod
   WHERE roll_min IS NOT NULL AND roll IS NOT NULL AND (roll < roll_min OR roll > roll_max)
   GROUP BY hash, roll, roll_min, roll_max ORDER BY n DESC LIMIT 25`)
  console.log(`   ${bad.length ? bad.reduce((s, r) => s + r.n, 0) + ' rows' : 'none'}`)
  table(bad)

  head('modifiers with no roll, no band, or no tier')
  table(q(`SELECT
  (SELECT count(*) FROM listing_mod WHERE roll IS NULL) no_roll,
  (SELECT count(*) FROM listing_mod WHERE roll_min IS NULL) no_band,
  (SELECT count(*) FROM listing_mod WHERE tier IS NULL) no_tier,
  (SELECT count(*) FROM listing_mod WHERE affix IS NULL) no_affix`))

  head('rolls holding more than one number (fallback grabbed extra)')
  table(q(`SELECT hash, rolls, count(*) n FROM listing_mod
   WHERE rolls LIKE '%,%' GROUP BY hash, rolls ORDER BY n DESC LIMIT 15`))

  head('affix counts against the cap, by rarity')
  table(q(`SELECT rarity, open_prefix, open_suffix, count(*) n FROM listing
   GROUP BY rarity, open_prefix, open_suffix ORDER BY rarity, n DESC`))

  head('listings carrying no modifier at all, by rarity')
  table(q(`SELECT rarity, count(*) n FROM listing l
   WHERE NOT EXISTS (SELECT 1 FROM listing_mod m
     WHERE m.request_id = l.request_id AND m.listing_id = l.listing_id)
   GROUP BY rarity`))

  head('rank: present, and does it agree with price order inside a request')
  table(q('SELECT count(*) total, sum(rank IS NULL) no_rank FROM listing'))
  let inversions = 0
  for (const { request_id: rid } of q('SELECT DISTINCT request_id FROM listing WHERE rank IS NOT NULL')) {
    const rows = q('SELECT rank, price_amount, price_currency FROM listing WHERE request_id = ? ORDER BY rank', rid)
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].price_currency === rows[i - 1].price_currency &&
          rows[i].price_amount < rows[i - 1].price_amount) inversions++
    }
  }
  console.log(`   same-currency price inversions along rank: ${inversions}`)

  head('the same listing seen in more than one request, priced differently')
  table(q(`SELECT listing_id, count(DISTINCT price_amount || price_currency) prices, count(*) seen
   FROM listing GROUP BY listing_id HAVING prices > 1 ORDER BY seen DESC LIMIT 10`))

  head('top modifiers stored, on rares')
  table(q(`SELECT m.hash, count(*) n, count(DISTINCT l.account) sellers
   FROM listing_mod m JOIN listing l
     ON l.request_id = m.request_id AND l.listing_id = m.listing_id
   WHERE l.rarity = 'Rare' GROUP BY m.hash ORDER BY n DESC LIMIT 15`))

  head('collection window')
  table(q('SELECT min(at) first, max(at) last FROM request'))

  db.close()
}
