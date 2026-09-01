import { gzipSync, gunzipSync } from 'node:zlib'

// A 10-item fetch is about 40 KB and a full pass makes hundreds of them, so the
// body is gzipped. It is stored whole and never trimmed: the parsed tables are
// derived from this, so a parser fix must be re-appliable without re-querying.
export function recordRequest (db, { at, league, kind, cell = null, method, url,
                                     requestBody = null, status, text, headers }) {
  const rate = {}
  if (headers && typeof headers.forEach === 'function') {
    headers.forEach((v, k) => {
      if (k.toLowerCase().startsWith('x-rate-limit')) rate[k.toLowerCase()] = v
    })
  }
  const res = db.prepare(
    `INSERT INTO request (at, league, kind, cell, method, url, request_body,
                          status, response_body, rate_headers)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(at, league, kind, cell, method, url, requestBody, status,
    gzipSync(Buffer.from(text, 'utf8')), JSON.stringify(rate))
  return Number(res.lastInsertRowid)
}

export function readResponse (db, requestId) {
  const row = db.prepare('SELECT response_body b FROM request WHERE id = ?').get(requestId)
  if (!row) return null
  try {
    return JSON.parse(gunzipSync(Buffer.from(row.b)).toString('utf8'))
  } catch {
    return null
  }
}

// Every archived fetch that has not yet been turned into listing rows. This is
// what makes a parser fix cheap: delete from listing, and every stored response
// is replayed without a single new request.
export function requestsWithoutListings (db, league) {
  return db.prepare(
    `SELECT id FROM request
      WHERE league = ? AND kind = 'fetch' AND status = 200
        AND id NOT IN (SELECT DISTINCT request_id FROM listing)
      ORDER BY id`
  ).all(league).map(r => r.id)
}
