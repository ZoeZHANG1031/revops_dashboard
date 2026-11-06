/** Period-partition indexes keyed by the source array identity (built once per store). */

type PeriodIndex<T> = Map<string, T[]>

const cache = new WeakMap<object, PeriodIndex<unknown>>()

function getOrBuild<T extends object>(
  rows: T[],
  periodOf: (row: T) => string,
): PeriodIndex<T> {
  const hit = cache.get(rows as object)
  if (hit) return hit as PeriodIndex<T>
  const idx: PeriodIndex<T> = new Map()
  for (const row of rows) {
    const p = periodOf(row)
    const list = idx.get(p)
    if (list) list.push(row)
    else idx.set(p, [row])
  }
  cache.set(rows as object, idx as PeriodIndex<unknown>)
  return idx
}

/** Collect rows whose period key falls in [start, end] inclusive (YYYY-MM lexicographic). */
export function rowsInPeriodRange<T extends object>(
  rows: T[],
  start: string,
  end: string,
  periodOf: (row: T) => string,
): T[] {
  const idx = getOrBuild(rows, periodOf)
  const out: T[] = []
  for (const [p, list] of idx) {
    if (p < start || p > end) continue
    for (const row of list) out.push(row)
  }
  return out
}

export function clearPeriodIndexCacheForTests(): void {
  // WeakMap entries drop with GC; nothing to clear for production.
}
