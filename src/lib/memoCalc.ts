import type { DataStore, GlobalFilters } from '@/types'

/** Stable filter key for memoizing expensive aggregates. */
export function filterCacheKey(
  filters: GlobalFilters,
  extras: string[] = [],
): string {
  return [
    filters.startPeriod,
    filters.endPeriod,
    filters.customerIds.join(','),
    filters.regions.join(','),
    (filters.metros ?? []).join(','),
    filters.serviceTypes.join(','),
    ...extras,
  ].join('|')
}

type Entry<T> = { value: T; data: DataStore }

/**
 * Tiny LRU-ish memo keyed by (DataStore identity + filter signature).
 * Synthetic data is immutable except exception overrides (new store object).
 */
export function createCalcMemo<T>(maxEntries = 48) {
  const map = new Map<string, Entry<T>>()

  return {
    get(data: DataStore, key: string): T | undefined {
      const hit = map.get(key)
      if (!hit || hit.data !== data) return undefined
      // refresh insertion order
      map.delete(key)
      map.set(key, hit)
      return hit.value
    },
    set(data: DataStore, key: string, value: T): T {
      if (map.size >= maxEntries) {
        const oldest = map.keys().next().value
        if (oldest != null) map.delete(oldest)
      }
      map.set(key, { value, data })
      return value
    },
    clear() {
      map.clear()
    },
  }
}
