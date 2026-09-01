// Rate-limit-aware client for GGG's official Trade API.
//
// Derived from ~/proj/tab-triage/src/trade-client.mjs (this workspace's earlier
// iteration). The header parsing and backoff logic is the same idea, but the
// limiter state now lives in lib/rate-limiter.mjs, on disk: the skill runs as a
// fresh process every invocation, so an in-memory limiter forgets everything
// between lookups and lets consecutive runs burst through GGG's window.

import { reserve, record } from './rate-limiter.mjs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export class TradeClient {
  /**
   * @param {object} opts
   * @param {(record: object) => void} opts.archive Called with every response
   *   this client receives, before it is parsed. REQUIRED — see the note above.
   */
  constructor ({ poesessid, league, archive, log = () => {},
                 apiBase = 'https://www.pathofexile.com/api/trade',
                 realm = null, referer = null }) {
    if (typeof archive !== 'function') {
      throw new TypeError(
        'TradeClient needs an `archive` function. A request to GGG spends rate ' +
        'allowance that cannot be bought back, so the response it paid for has to ' +
        'be kept. Pass fileArchive(dir) from lib/request-log.mjs, or a sink of ' +
        'your own that stores the record whole.')
    }
    this.poesessid = poesessid
    this.league = league
    this.log = log
    this.apiBase = apiBase
    this.realm = realm
    this.referer = referer || `https://www.pathofexile.com/trade/search/${league}`
    this.archive = archive
  }

  // PoE1 addresses "<league>". PoE2 addresses "poe2/<league>".
  _leagueSegment () {
    const league = encodeURIComponent(this.league)
    return this.realm ? `${this.realm}/${league}` : league
  }

  _headers (extra = {}) {
    return {
      'User-Agent': UA,
      Accept: 'application/json',
      Origin: 'https://www.pathofexile.com',
      Referer: this.referer,
      Cookie: `POESESSID=${this.poesessid}`,
      ...extra
    }
  }

  // THE CHOKEPOINT. Every response this client receives passes through here,
  // before it is parsed and whatever happens next: a 429, an HTML maintenance
  // page, a body that is not JSON at all. Each of those cost the same rate
  // allowance as a call that worked, and the failures are usually the more
  // interesting record. Archiving must not depend on the caller remembering.
  _notify (kind, url, init, res, text) {
    this.archive({
      kind,
      method: init.method || 'GET',
      url,
      requestBody: init.body ?? null,
      status: res.status,
      text,
      headers: res.headers
    })
  }

  // `kind` names the rate-limit bucket: GGG applies a separate policy per
  // endpoint, so search/fetch/exchange are tracked independently.
  async _request (kind, url, init = {}) {
    for (let attempt = 0; attempt < 6; attempt++) {
      await reserve(kind, this.log)

      const res = await fetch(url, { ...init, headers: this._headers(init.headers) })

      if (res.status === 429) {
        const retry = Number(res.headers.get('retry-after')) || 10
        await record(kind, res.headers, retry)
        this._notify(kind, url, init, res, await res.text())
        this.log(`  429 rate-limited; waiting ${retry}s (attempt ${attempt + 1})`)
        continue
      }

      await record(kind, res.headers)

      const text = await res.text()
      this._notify(kind, url, init, res, text)
      let json
      try { json = JSON.parse(text) } catch {
        throw new Error(`Non-JSON ${res.status} from ${url}: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}`)
      }
      if (json.error) throw new Error(`Trade API error ${res.status}: ${JSON.stringify(json.error)}`)
      return json
    }
    throw new Error(`Giving up after repeated 429s: ${url}`)
  }

  // POST a full trade `query` object. Returns { queryId, ids, total, url }.
  async search (query, sort = { price: 'asc' }) {
    const json = await this._request(
      'search',
      `${this.apiBase}/search/${this._leagueSegment()}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, sort }) }
    )
    return {
      queryId: json.id,
      ids: json.result || [],
      total: json.total,
      url: `${this.apiBase.replace('/api/', '/')}/search/${this._leagueSegment()}/${json.id}`
    }
  }

  // Bulk exchange ("currency for currency"). Used to convert listing prices to
  // a common unit. `have`/`want` are trade currency codes, e.g. ['chaos'].
  async exchange (have, want) {
    return this._request(
      'exchange',
      `${this.apiBase}/exchange/${this._leagueSegment()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: { status: { option: 'online' }, have, want },
          sort: { have: 'asc' },
          engine: 'new'
        })
      }
    )
  }

  // Fetch full listing data for up to 10 ids at a time.
  async fetchItems (ids, queryId) {
    const json = await this._request(
      'fetch',
      `${this.apiBase}/fetch/${ids.join(',')}?query=${queryId}`
    )
    return json.result || []
  }

  // GGG's own stat table. PoE2 only; PoE1 callers use the vendored file.
  async dataStats () {
    return this._request('data', `${this.apiBase}/data/stats`)
  }
}

export const chunk = (arr, n) => {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}
