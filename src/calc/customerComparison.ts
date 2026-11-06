import { addMonths } from '@/lib/filters'
import type { DataStore, GlobalFilters } from '@/types'

/**
 * ONE comparison window for every customer diagnostic (Health Score, risk tags, revenue bridge,
 * margin bridge, Customer 360 evidence). Same calendar months one year earlier — avoids comparing a
 * peak season with a trough (customers with Nov–Dec peaks would otherwise show false declines).
 */
export interface CustomerComparisonWindow {
  current: { startPeriod: string; endPeriod: string; label: string }
  /** null when the prior-year window starts before available history */
  prior: { startPeriod: string; endPeriod: string; label: string } | null
  basis: 'Same months prior year'
  basisShort: 'YoY'
}

const shiftYear = (p: string) => addMonths(p, -12)

export function periodRangeLabel(start: string, end: string): string {
  const fmt = (p: string) => {
    const [y, m] = p.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  }
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`
}

export function customerComparisonWindow(
  data: Pick<DataStore, 'meta'>,
  filters: Pick<GlobalFilters, 'startPeriod' | 'endPeriod'>,
): CustomerComparisonWindow {
  const histStart = data.meta.history_start ?? '0000-00'
  const ps = shiftYear(filters.startPeriod)
  const pe = shiftYear(filters.endPeriod)
  return {
    current: {
      startPeriod: filters.startPeriod,
      endPeriod: filters.endPeriod,
      label: periodRangeLabel(filters.startPeriod, filters.endPeriod),
    },
    prior: ps >= histStart ? { startPeriod: ps, endPeriod: pe, label: periodRangeLabel(ps, pe) } : null,
    basis: 'Same months prior year',
    basisShort: 'YoY',
  }
}
