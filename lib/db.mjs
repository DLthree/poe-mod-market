import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// `request` is the primary record: every call that reached GGG, with its
// complete response. `listing` and `listing_mod` are DERIVED from it, so a
// parser fix can be re-applied to every row ever collected without re-querying
// a market that costs about an hour per pass.
//
// `observation` is the only surface phase 2 is allowed to read. It exists so
// phase 2 never names `request`, and therefore never learns which collector
// produced a row. tests/contract.test.mjs enforces that.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS request (
  id            INTEGER PRIMARY KEY,
  at            TEXT    NOT NULL,
  league        TEXT    NOT NULL,
  kind          TEXT    NOT NULL,
  cell          TEXT,
  method        TEXT    NOT NULL,
  url           TEXT    NOT NULL,
  request_body  TEXT,
  status        INTEGER NOT NULL,
  response_body BLOB    NOT NULL,
  rate_headers  TEXT
);
CREATE INDEX IF NOT EXISTS request_at ON request (league, at);

CREATE TABLE IF NOT EXISTS listing (
  request_id     INTEGER NOT NULL REFERENCES request(id),
  listing_id     TEXT    NOT NULL,
  indexed        TEXT    NOT NULL,
  account        TEXT,
  price_amount   REAL    NOT NULL,
  price_currency TEXT    NOT NULL,
  price_kind     TEXT,
  type           TEXT    NOT NULL,
  rarity         TEXT    NOT NULL,
  ilvl           INTEGER,
  rank           INTEGER,
  open_prefix    INTEGER,
  open_suffix    INTEGER,
  corrupted      INTEGER,
  snapshot_id    INTEGER,
  PRIMARY KEY (request_id, listing_id)
);
CREATE INDEX IF NOT EXISTS listing_cell ON listing (type, rarity);
CREATE INDEX IF NOT EXISTS listing_id_ix ON listing (listing_id);

CREATE TABLE IF NOT EXISTS listing_mod (
  request_id INTEGER NOT NULL,
  listing_id TEXT    NOT NULL,
  hash       TEXT    NOT NULL,
  roll       REAL,
  rolls      TEXT,
  tier       TEXT,
  affix      TEXT,
  roll_min   REAL,
  roll_max   REAL
);
CREATE INDEX IF NOT EXISTS listing_mod_ix ON listing_mod (request_id, listing_id);
CREATE INDEX IF NOT EXISTS listing_mod_hash ON listing_mod (hash);

-- A snapshot is one QUESTION and the answer GGG gave to it at one instant:
-- the cheapest listings for a type, a rarity and at most one modifier, in the
-- order the server itself ranked them. stat_id is null for the baseline
-- question, "what does a blank tablet of this cell floor at?".
--
-- It describes what a set of rows MEANS, not the mechanics of fetching them,
-- which is why phase 2 may read it while the request table stays out of reach.
--
-- Merging snapshots into one pool is what made every published price wrong:
-- rank numbers each search from zero, so a merge stacks every rank-0 row at
-- the front in no price order at all. See docs/snapshot-pricing.md.
CREATE TABLE IF NOT EXISTS snapshot (
  id       INTEGER PRIMARY KEY,
  league   TEXT    NOT NULL,
  type     TEXT    NOT NULL,
  rarity   TEXT    NOT NULL,
  stat_id  TEXT,
  taken_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS snapshot_question
  ON snapshot (league, type, rarity, stat_id, taken_at);

CREATE VIEW IF NOT EXISTS observation AS
  SELECT l.*, r.at AS observed_at
    FROM listing l JOIN request r ON r.id = l.request_id;
`

export function openDb (path) {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  // WAL needs shared memory the host filesystem must provide. The database
  // lives on the WSL share, reached over SMB from Windows node, where WAL
  // fails outright with "database is locked". Ask for it, and fall back to the
  // default rollback journal when the filesystem cannot do it.
  try {
    db.exec('PRAGMA journal_mode = WAL')
  } catch {
    db.exec('PRAGMA journal_mode = TRUNCATE')
  }
  db.exec(SCHEMA)
  addMissingColumns(db)
  db.exec(POST_INDEXES)
  return db
}

// CREATE TABLE IF NOT EXISTS leaves an existing table alone, so a new column has
// to be added by hand. The derived tables could be dropped and replayed instead,
// but the archive they are replayed FROM lives in the same file, so dropping is
// the one thing that cannot be undone. Adding is.
const ADDED = [
  ['listing', 'corrupted', 'INTEGER'],
  ['listing', 'snapshot_id', 'INTEGER']
]

// Indexes over columns ADDED may have just created. They cannot sit in SCHEMA:
// on a database made before the column existed, CREATE INDEX would run first
// and fail.
const POST_INDEXES = `
CREATE INDEX IF NOT EXISTS listing_snapshot ON listing (snapshot_id);
`

function addMissingColumns (db) {
  for (const [table, column, type] of ADDED) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
}
