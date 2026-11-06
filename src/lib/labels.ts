/** Truncate a long label for a horizontal-bar Y axis (full text stays in tooltips) */
export function shortLabel(s: string, max = 18): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}
