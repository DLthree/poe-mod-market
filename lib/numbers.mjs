export function countDistinct (xs) {
  return new Set(xs.filter(x => x !== null && x !== undefined)).size
}

export function median (xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
