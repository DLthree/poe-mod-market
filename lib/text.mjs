// GGG writes item text with link markup: [Internal|Displayed] or [Displayed].
// The stats endpoint and the game clipboard both use the displayed form, so
// every comparison in this skill happens after plain().
export function plain (s) {
  return String(s).replace(/\[([^\]|]+)(?:\|([^\]]+))?\]/g, (_, a, b) => b || a)
}
