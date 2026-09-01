const ago = (h) => (h == null ? '?' : h < 48 ? `${h}h` : `${Math.round(h / 24)}d`)
// Prices are raw and never converted. A number without its currency would be a
// silent lie the moment a pool is priced in divine.
const SHORT = { exalted: 'ex', divine: 'div', chaos: 'ch' }
const money = (n, cur) =>
  (n == null ? '—' : `${Number(n).toFixed(n < 10 ? 1 : 0)} ${SHORT[cur] || cur || '?'}`)
const name = (c) => c.affix || c.hash || c.kind

export function renderPriced (out, tablet, { limit = 12, now = Date.now() } = {}) {
  const e = out.estimate
  const lines = [`${tablet.rarity} ${tablet.type} — ${out.matched.length} meaningful modifier(s)`]
  for (const c of out.matched) lines.push(`  ${name(c)}`)
  if (!out.matched.length) lines.push('  (none — this is the baseline pool)')

  const label = out.matched.length ? out.matched.map(name).join(', ') : 'baseline'
  lines.push('')
  lines.push(`  pool      ${out.pool.type} x ${out.pool.rarity} x {${label}}`)
  lines.push(`  cheapest  ${money(e.min, e.currency)}        ` +
    `${e.listings} listings · ${e.sellers} sellers`)
  lines.push(`  floor     ${money(e.floor, e.currency)}        rule: ${e.strategy}`)
  lines.push(`  based on  ${e.basis.map(b => `${money(b.amount, b.currency)} (${ago(b.ageHours)})`).join('   ')}`)

  // A floor that stands several deep is a price. A lone low row is a mistake.
  if (e.min != null && e.floor != null && e.min < e.floor / 5) {
    lines.push('  note      the cheapest sits far below the rest — treat it as a mispriced')
    lines.push('            listing, not the market floor')
  }

  lines.push('')
  lines.push('   #  price          listed')
  for (const [i, r] of out.comparables.slice(0, limit).entries()) {
    const h = Math.round((now - Date.parse(r.indexed)) / 36e5)
    lines.push(`  ${String(i + 1).padStart(2)}  ${money(r.amount, r.currency).padEnd(12)}  ${ago(h).padStart(5)}`)
  }
  if (out.comparables.length > limit) {
    lines.push(`      … ${out.comparables.length - limit} more`)
  }
  for (const w of tablet.warnings || []) lines.push(`\n  warning: ${w}`)
  return lines.join('\n')
}

export function renderDeclined (out, tablet) {
  return [
    `${tablet.rarity} ${tablet.type} — ${out.matched.length} meaningful modifiers`,
    ...out.matched.map(c => `  ${name(c)}`),
    '',
    `  ${out.reason}.`,
    '  Run again with --query for a filled-in trade search.'
  ].join('\n')
}

export function renderUnknown (out, tablet) {
  return [
    `${tablet.rarity} ${tablet.type} — no answer`,
    `  ${out.reason}`,
    '  Collect more listings, or price this one by hand.'
  ].join('\n')
}

// The modifier table, for a human deciding whether the walk found anything real.
export function renderTable (table, textFor) {
  const lines = []
  for (const p of table.pools) {
    lines.push(`\n${p.type} ${p.rarity}`)
    lines.push(`  baseline  floor ${money(p.baseline.floor, p.baseline.currency)}  cheapest ${money(p.baseline.min, p.baseline.currency)}` +
      `  ${p.baseline.listings} listings · ${p.baseline.sellers} sellers`)
    if (!p.meaningful.length) {
      lines.push('  (no modifier cleared the thresholds)')
      continue
    }
    for (const e of p.meaningful) {
      const suspect = e.min != null && e.floor != null && e.min < e.floor / 5 ? '  (!)' : ''
      // The difference, not the ratio: "x10" on a 1 ex baseline is 9 exalted and
      // "x1.4" on a 100 ex baseline is 40, and only the second is worth a detour.
      const adds = e.floor - p.baseline.floor
      lines.push(`  floor ${money(e.floor, e.currency).padStart(10)}  ` +
        `${(adds > 0 ? '+' : '') + money(adds, e.currency)}`.padStart(10) + '  ' +
        `${String(e.listings).padStart(4)}/${String(e.sellers).padStart(3)}  ` +
        `${textFor(e.hash || e.kind)}${suspect}`)
    }
  }
  return lines.join('\n')
}
