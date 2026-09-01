// The page. It fetches two things and never calls GGG.
//
//   the economy file   what every tablet and modifier floors at
//   /api/fragments     one short regex fragment per modifier
//
// The regex is joined by lib/regex-keys.mjs, the same module the tests
// exercise. The browser loads it from /lib/ rather than the page carrying its
// own copy of the join, because two copies of a rule drift.
// Every path here is RELATIVE, and that is not a style choice. GitHub Pages
// serves this page from /poe-mod-market/, not from the root, so an absolute
// "/lib/..." would reach for the wrong host directory. The dev server answers
// the same relative paths, so the local page is the published page.
import { tabletRegex } from './lib/regex-keys.mjs'
import { TABLET_TYPES, RARITIES } from './lib/poe2.mjs'
import { tradeUrl } from './lib/trade-url.mjs'

const $ = (s) => document.querySelector(s)
const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}
const short = { exalted: 'ex', divine: 'div', chaos: 'ch' }
const money = (n, cur) => (n === null || n === undefined
  ? '—'
  : `${Number(n) < 10 ? Number(n).toFixed(1) : Math.round(n)} ${short[cur] || cur || '?'}`)

const state = {
  eco: null,
  fragments: {},
  type: null,
  rarity: null,
  ticked: new Set(),
  mode: 'any',
  search: ''
}

const cellOf = (type, rarity) =>
  state.eco.cells.find(c => c.type === type && c.rarity === rarity)

const modsOf = (type, rarity) =>
  state.eco.mods.filter(m => m.type === type && m.rarity === rarity)

// One index file naming every league, then two files per league. All three are
// plain JSON on disk when published, and computed at the same paths by the dev
// server. lib/site.mjs owns the names; this has to agree with it.
const slug = (league) =>
  String(league).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const PATHS = {
  leagues: 'data/leagues.json',
  economy: (league) => `data/eco-${slug(league)}.json`,
  fragments: (league) => `data/fragments-${slug(league)}.json`
}

const getJson = async (path) => {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${res.status} for ${path}`)
  return res.json()
}

async function boot () {
  // The league is not a constant: a new one arrives every few months and the
  // page must not need a rebuild of anything but its data to show it.
  const { leagues, default: started } = await getJson(PATHS.leagues)
  const picker = $('#league')
  picker.replaceChildren()
  for (const name of leagues) {
    const opt = el('option', null, name)
    opt.value = name
    picker.append(opt)
  }
  picker.value = leagues.includes(started) ? started : leagues[0]
  picker.addEventListener('change', () => {
    loadLeague(picker.value).catch(fail)
  })
  await loadLeague(picker.value)
}

async function loadLeague (league) {
  const [eco, fragments] = await Promise.all([
    getJson(PATHS.economy(league)),
    getJson(PATHS.fragments(league))
  ])
  state.eco = eco
  state.league = eco.league
  state.tradeWindow = eco.tradeWindow
  state.fragments = fragments
  // Another league is another market. The tablet you had chosen may not be
  // priced there at all, and a tick carried over would be a tick on a price
  // nobody quoted.
  state.type = null
  state.rarity = null
  state.ticked.clear()
  state.search = ''
  $('#search').value = ''
  renderMeta()
  renderGrid()
  render()
}

const fail = (err) => { $('#meta').textContent = `could not load: ${err.message}` }

// How stale the prices are is the question a reader actually has. The wall
// clock instant answers a different one, so it becomes the tooltip.
function ago (iso, now = Date.now()) {
  const mins = Math.round((now - Date.parse(iso)) / 60000)
  if (!Number.isFinite(mins)) return null
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return `${Math.round(hours / 24)} days ago`
}

// The league is named by the dropdown beside this line, so it is not repeated
// here.
function renderMeta () {
  const at = state.eco.syncedAt
  const when = at && ago(at)
  $('#meta').textContent = `collected ${when || '—'}`
  $('#meta').title = at ? at.slice(0, 19).replace('T', ' ') + ' UTC' : ''
}

// Dearest first, by what a blank one costs. A tablet kind whose plain form is
// dear is the kind worth picking up at all, so that is the order the grid reads
// in. A kind we hold no plain price for sorts last rather than at either
// extreme: it is unknown, not free and not priceless.
const byBlankPrice = (a, b) => {
  const price = (type) => cellOf(type, 'normal')?.floor
  return (price(b) ?? -Infinity) - (price(a) ?? -Infinity)
}

// Rare first, because that is the market. Normal last: a blank tablet is the
// number the bands are measured against, not the thing anyone is shopping for.
const COLUMNS = [...RARITIES].reverse()

// One square per tablet type and rarity. The floor is the price of a blank one,
// so it says what the kind is worth before any modifier is considered.
function renderGrid () {
  const grid = $('#grid')
  grid.replaceChildren()
  const head = el('div', 'grid-row head')
  head.append(el('span', 'grid-label', ''))
  for (const r of COLUMNS) head.append(el('span', 'grid-head', r))
  grid.append(head)

  for (const type of [...TABLET_TYPES].sort(byBlankPrice)) {
    const row = el('div', 'grid-row')
    row.append(el('span', 'grid-label', type.replace(' Tablet', '')))
    for (const rarity of COLUMNS) {
      const cell = cellOf(type, rarity)
      const thin = cell && cell.listings > 0 && cell.listings < state.eco.minListings
      const btn = el('button', 'square')
      btn.type = 'button'
      if (!cell || cell.floor === null) {
        btn.classList.add('empty')
        btn.append(el('span', 'price', '—'))
        btn.disabled = true
      } else {
        btn.append(el('span', 'price', money(cell.floor, cell.currency)))
        btn.append(el('span', 'sub', thin ? `${cell.listings} listings` : `${cell.sellers} sellers`))
        if (thin) {
          btn.classList.add('thin')
          btn.title = `only ${cell.listings} listings — too thin a sample to trust`
        }
        btn.addEventListener('click', () => select(type, rarity))
      }
      if (type === state.type && rarity === state.rarity) btn.classList.add('on')
      row.append(btn)
    }
    grid.append(row)
  }
}

// Choosing a kind ticks the high quality modifiers on it, so you land on a
// working search and untick what you disagree with, rather than starting from
// nothing. Mid quality is shown but not ticked: on the dear cells it is most of
// the list, and a filter that keeps most of the list is not a filter.
function select (type, rarity) {
  state.type = type
  state.rarity = rarity
  state.ticked = new Set(
    modsOf(type, rarity).filter(m => m.quality === 'high').map(m => m.statId))
  state.search = ''
  $('#search').value = ''
  renderGrid()
  render()
}

function render () {
  const card = $('#mods-card')
  if (!state.type) { card.hidden = true; renderResult(); return }
  // A normal tablet carries no modifier, so the card would be an empty list
  // under a filter box and a bar nothing can clear. The test is the row count,
  // not the rarity, so a magic tablet we have collected nothing for behaves the
  // same way.
  const all = modsOf(state.type, state.rarity)
  if (!all.length) { card.hidden = true; renderResult(); return }
  card.hidden = false

  const cell = cellOf(state.type, state.rarity)
  $('#mods-title').textContent = `${state.type} · ${state.rarity}`
  // The two numbers the verdicts are measured against, kept reachable as a
  // tooltip rather than as a paragraph above the list.
  $('#mods-title').title =
    `blank ${money(cell.floor, cell.currency)} · ` +
    `typical modifier ${money(cell.typical, cell.currency)}`

  const list = $('#mods')
  list.replaceChildren()
  const needle = state.search.trim().toLowerCase()
  const rows = all.filter(m => !needle || m.label.toLowerCase().includes(needle))

  for (const m of rows) {
    const cls = 'mod' + (m.quality ? ` ${m.quality}` : '') + (m.floor === null ? ' unpriced' : '')
    const row = el('label', cls)
    const box = el('input')
    box.type = 'checkbox'
    box.checked = state.ticked.has(m.statId)
    box.disabled = !state.fragments[m.statId]
    box.addEventListener('change', () => {
      if (box.checked) state.ticked.add(m.statId)
      else state.ticked.delete(m.statId)
      renderResult()
    })
    row.append(box)
    row.append(el('span', 'mod-price', money(m.floor, m.currency)))
    row.append(el('span', 'mod-adds', m.adds === null || m.adds === undefined
      ? '—'
      : `${m.adds > 0 ? '+' : ''}${Math.round(m.adds)}`))
    // Why the row is coloured, in the one place that does not add a line to the
    // page: what it costs against a blank tablet of this kind.
    if (m.quality) row.title = `${(m.floor / cell.floor).toFixed(2)}x a blank tablet`
    row.append(el('span', 'mod-label', m.label))
    row.append(el('span', 'mod-n', `${m.listings}/${m.sellers}`))
    if (!state.fragments[m.statId]) row.append(el('span', 'tag', 'no fragment'))
    list.append(row)
  }
  if (!rows.length) list.append(el('p', 'hint', 'nothing matches that filter'))
  renderResult()
}

function renderResult () {
  const out = $('#regex')
  const warn = $('#warn')
  // A prompt is not output. Both prompts are grey, so an empty box never reads
  // as a search string you could paste.
  const placeholder = (text) => {
    out.textContent = text
    out.classList.add('placeholder')
  }
  if (!state.type) {
    placeholder('pick a tablet type below')
    $('#count').textContent = '0 / 250'
    warn.hidden = true
    return
  }
  const { regex, unkeyed } = tabletRegex({
    statIds: [...state.ticked],
    fragments: state.fragments,
    mode: state.mode
  })
  if (regex) {
    out.textContent = regex
    out.classList.remove('placeholder')
  } else {
    placeholder('nothing ticked')
  }
  const n = regex.length
  $('#count').textContent = `${n} / 250`
  $('#count').classList.toggle('over', n > 250)

  // A modifier we cannot express is said out loud. A search that quietly means
  // less than it looks like is the worst thing this page could do.
  if (unkeyed.length) {
    warn.hidden = false
    const many = unkeyed.length > 1
    warn.textContent =
      `${unkeyed.length} ticked modifier${many ? 's have' : ' has'} no fragment ` +
      'and cannot be searched for.'
  } else if (n > 250) {
    warn.hidden = false
    warn.textContent = 'Over the stash search limit. Untick the modifiers you care least about.'
  } else {
    warn.hidden = true
  }

  // The same slice of the market the prices came from, built on this side
  // because the trade site takes its query as a URL parameter.
  const link = tradeUrl({
    league: state.league,
    type: state.type,
    rarity: state.rarity,
    mods: [...state.ticked],
    tradeWindow: state.tradeWindow
  })
  const trade = $('#trade')
  if (link.url) {
    trade.href = link.url
    trade.removeAttribute('aria-disabled')
  } else {
    trade.removeAttribute('href')
    trade.setAttribute('aria-disabled', 'true')
  }
}

// navigator.clipboard exists only in a secure context: HTTPS, or localhost. The
// server binds 0.0.0.0 on request, so the page reached by LAN IP has no
// clipboard API at all and the old handler reported "Copy failed" for something
// the reader could do nothing about. Two fallbacks, in order.
function execCommandCopy (text) {
  const box = el('textarea')
  box.value = text
  box.setAttribute('readonly', '')
  // Off-screen but focusable: display:none cannot be selected.
  box.style.cssText = 'position:fixed;top:-1000px;opacity:0'
  document.body.append(box)
  box.select()
  try {
    return document.execCommand('copy')
  } finally {
    box.remove()
  }
}

// Last resort: put the search in the reader's selection so Ctrl+C finishes the
// job, and say that rather than reporting a failure.
function selectResult () {
  const range = document.createRange()
  range.selectNodeContents($('#regex'))
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
}

$('#copy').addEventListener('click', async () => {
  const text = $('#regex').textContent
  const say = (msg, ms) => {
    $('#copy').textContent = msg
    setTimeout(() => { $('#copy').textContent = 'Copy' }, ms)
  }
  try {
    await navigator.clipboard.writeText(text)
    return say('Copied', 1200)
  } catch { /* no API here, or the write was refused: try the old way */ }
  try {
    if (execCommandCopy(text)) return say('Copied', 1200)
  } catch { /* execCommand is gone in some browsers */ }
  selectResult()
  say('Press Ctrl+C', 2600)
})

// Clear empties the ticks and the filter. It does NOT put the default ticks
// back: choosing a tablet type already does that, and a button that returns you
// to where you started is a second way to do nothing. It is called Clear rather
// than Reset because emptying is all it does.
$('#clear').addEventListener('click', () => {
  state.ticked.clear()
  state.search = ''
  $('#search').value = ''
  render()
})

$('#search').addEventListener('input', (e) => {
  state.search = e.target.value
  render()
})

for (const radio of document.querySelectorAll('input[name=mode]')) {
  radio.addEventListener('change', () => {
    state.mode = radio.value
    renderResult()
  })
}

boot().catch(fail)
