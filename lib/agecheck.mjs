// One prototype cell returned 30 rows about a week old, from 30 different
// accounts, while every other cell returned rows from the last 8 hours. There
// is no explanation for it. A database would absorb it as current market data
// and never flag it, so a cell far older than its peers is reported rather than
// trusted.
export function checkAge (cells, { factor = 10 } = {}) {
  if (cells.length < 3) return []
  const ages = cells.map(c => c.medianAgeHours).filter(a => Number.isFinite(a))
  if (ages.length < 3) return []
  const sorted = [...ages].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  if (!(median > 0)) return []
  return cells.filter(c => c.medianAgeHours > median * factor).map(c => c.cell)
}

export function medianAgeHours (rows, now = Date.now()) {
  if (!rows.length) return null
  const ages = rows.map(r => (now - Date.parse(r.indexed)) / 36e5).sort((a, b) => a - b)
  return ages[Math.floor(ages.length / 2)]
}
