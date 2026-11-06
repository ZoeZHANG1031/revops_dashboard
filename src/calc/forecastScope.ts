import type { DataStore, GlobalFilters } from '@/types'

export interface ForecastComparability {
  /** False when actual and forecast cannot be scoped identically */
  comparable: boolean
  reason: string | null
  /** Periods in the filter window that have Existing forecast rows */
  periods: string[]
  /** Filters restricted to forecast periods — use for the "comparable actual" */
  comparableFilters: GlobalFilters
  /** Explains a partial-period restriction (still comparable) */
  note: string | null
}

/**
 * Existing forecasts are stored at customer × accounting_period grain only.
 * - Region / Metro / Service filters cannot be applied to forecast rows → not comparable.
 * - Periods without forecast rows are excluded from the comparable actual (never compared to 0).
 */
export function forecastComparability(
  data: DataStore,
  filters: GlobalFilters,
  scenario: 'Base' | 'Upside' | 'Downside' = 'Base',
): ForecastComparability {
  const periods = [
    ...new Set(
      data.forecasts
        .filter(
          (f) =>
            f.scenario === scenario &&
            f.forecast_type === 'Existing' &&
            f.accounting_period >= filters.startPeriod &&
            f.accounting_period <= filters.endPeriod,
        )
        .map((f) => f.accounting_period),
    ),
  ].sort()

  const dimensional =
    filters.regions.length > 0 || (filters.metros?.length ?? 0) > 0 || filters.serviceTypes.length > 0
  const comparableFilters: GlobalFilters = periods.length
    ? { ...filters, startPeriod: periods[0], endPeriod: periods[periods.length - 1] }
    : filters

  if (dimensional) {
    return {
      comparable: false,
      reason:
        'Forecasts are stored at customer × month grain — Region / Metro / Service filters cannot be applied to the forecast, so variance is not comparable.',
      periods,
      comparableFilters,
      note: null,
    }
  }
  if (periods.length === 0) {
    const first = data.forecasts.filter((f) => f.forecast_type === 'Existing').map((f) => f.accounting_period).sort()[0]
    return {
      comparable: false,
      reason: `No Existing forecast for the selected periods${first ? ` (forecasts start ${first})` : ''}.`,
      periods,
      comparableFilters,
      note: null,
    }
  }
  const partial = periods[0] !== filters.startPeriod || periods[periods.length - 1] !== filters.endPeriod
  return {
    comparable: true,
    reason: null,
    periods,
    comparableFilters,
    note: partial
      ? `Compared on forecast periods only (${periods[0]} → ${periods[periods.length - 1]}); other months have no forecast.`
      : null,
  }
}
