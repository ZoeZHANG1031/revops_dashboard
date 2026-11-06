import { money, sumMoney } from '@/lib/money'
import { computeRecognizedRevenue } from '@/calc/recognizedRevenue'
import type { DataStore, GlobalFilters } from '@/types'

/**
 * Point-in-time snapshot backtest: for each actual month T, use the forecast version
 * created at T−horizon+1 (horizon_months = h), not the re-computed official series.
 */
export function evaluateSnapshotBacktest(
  data: DataStore,
  filters: GlobalFilters,
  scenario: 'Base' | 'Upside' | 'Downside' = 'Base',
  horizonMonths = 1,
): {
  wape: number | null
  mae: number | null
  bias: number | null
  n: number
  label: string
  points: Array<{ period: string; actual: number; forecast: number; error: number; version: string }>
} {
  const histEnd = data.meta.history_end
  const periods = [
    ...new Set(
      data.dates
        .map((d) => d.date_key.slice(0, 7))
        .filter((p) => p >= filters.startPeriod && p <= filters.endPeriod && p <= histEnd),
    ),
  ].sort()

  const points: Array<{
    period: string
    actual: number
    forecast: number
    error: number
    version: string
  }> = []

  for (const period of periods) {
    const snaps = data.forecastSnapshots.filter(
      (f) =>
        f.scenario === scenario &&
        f.forecast_type === 'Existing' &&
        f.accounting_period === period &&
        f.horizon_months === horizonMonths &&
        (filters.customerIds.length === 0 ||
          (f.customer_id != null && filters.customerIds.includes(f.customer_id))),
    )
    if (!snaps.length) continue
    const version = snaps[0].forecast_version
    const forecast = sumMoney(snaps.map((f) => f.forecast_recognized))
    const actual = computeRecognizedRevenue(data, {
      ...filters,
      startPeriod: period,
      endPeriod: period,
    }).amount
    points.push({
      period,
      actual,
      forecast,
      error: money(actual - forecast),
      version,
    })
  }

  const n = points.length
  if (n === 0) {
    return {
      wape: null,
      mae: null,
      bias: null,
      n: 0,
      label: `Snapshot backtest h=${horizonMonths} — no overlapping versions`,
      points,
    }
  }
  const absErrors = points.map((p) => Math.abs(p.error))
  const sumAbsActual = sumMoney(points.map((p) => Math.abs(p.actual)))
  return {
    mae: money(sumMoney(absErrors) / n),
    wape: sumAbsActual === 0 ? null : money((sumMoney(absErrors) / sumAbsActual) * 100),
    bias: money(sumMoney(points.map((p) => p.error)) / n),
    n,
    label: `Official snapshot backtest · horizon=${horizonMonths} · n=${n}`,
    points,
  }
}
