import { money, safeDiv, sumMoney } from '@/lib/money'
import type { DataStore, ForecastScenarioParams, GlobalFilters } from '@/types'
import { computeRecognizedRevenue } from './recognizedRevenue'

export const DEFAULT_SCENARIO_PARAMS: Record<
  'Base' | 'Upside' | 'Downside',
  ForecastScenarioParams
> = {
  Base: {
    volumeGrowth: 0,
    avgRateChange: 0,
    churnRate: 0.02,
    surchargeRate: 0.1,
    creditRate: 0.03,
  },
  Upside: {
    volumeGrowth: 0.08,
    avgRateChange: 0.03,
    churnRate: 0.01,
    surchargeRate: 0.11,
    creditRate: 0.025,
  },
  Downside: {
    volumeGrowth: -0.1,
    avgRateChange: -0.03,
    churnRate: 0.06,
    surchargeRate: 0.09,
    creditRate: 0.045,
  },
}

export interface ForecastResult {
  scenario: 'Base' | 'Upside' | 'Downside'
  existingRevenue: number
  pipelineRevenue: number
  totalExpected: number
  byPeriod: Array<{
    period: string
    existing: number
    pipeline: number
    total: number
    volume: number
  }>
  params: ForecastScenarioParams
}

export function computeDriverForecast(
  data: DataStore,
  filters: GlobalFilters,
  scenario: 'Base' | 'Upside' | 'Downside',
  params: ForecastScenarioParams,
): ForecastResult {
  // Apply live parameter adjustments on top of stored scenario forecasts
  const existingRows = data.forecasts.filter(
    (f) =>
      f.scenario === scenario &&
      f.forecast_type === 'Existing' &&
      f.accounting_period >= filters.startPeriod &&
      f.accounting_period <= filters.endPeriod &&
      (filters.customerIds.length === 0 ||
        (f.customer_id != null && filters.customerIds.includes(f.customer_id))),
  )

  const pipelineRows = data.forecasts.filter(
    (f) =>
      f.scenario === scenario &&
      f.forecast_type === 'Pipeline' &&
      f.accounting_period >= filters.startPeriod &&
      f.accounting_period <= filters.endPeriod,
  )

  const baseParams = DEFAULT_SCENARIO_PARAMS[scenario]
  const volAdj = 1 + (params.volumeGrowth - baseParams.volumeGrowth)
  const rateAdj = 1 + (params.avgRateChange - baseParams.avgRateChange)
  const churnAdj = 1 - Math.max(0, params.churnRate - baseParams.churnRate)
  const surchargeAdj =
    baseParams.surchargeRate === 0 ? 1 : params.surchargeRate / baseParams.surchargeRate
  const creditAdj = baseParams.creditRate === 0 ? 1 : params.creditRate / baseParams.creditRate

  const periods = [...new Set([...existingRows, ...pipelineRows].map((r) => r.accounting_period))].sort()

  const byPeriod = periods.map((period) => {
    const ex = existingRows.filter((r) => r.accounting_period === period)
    const pl = pipelineRows.filter((r) => r.accounting_period === period)

    let existing = 0
    let volume = 0
    ex.forEach((r) => {
      const vol = Math.round(r.forecast_volume * volAdj * churnAdj)
      const rate = money(r.forecast_avg_rate * rateAdj)
      const surcharges = money(r.forecast_surcharges * volAdj * churnAdj * surchargeAdj)
      const credits = money(r.forecast_credits * volAdj * churnAdj * creditAdj)
      const net = money(vol * rate + surcharges - credits)
      existing += money(net * 0.98)
      volume += vol
    })

    // Pipeline only for future periods not already in existing customer set — stored separately
    const pipeline = sumMoney(
      pl.map((r) => {
        const vol = Math.round(r.forecast_volume * volAdj)
        const rate = money(r.forecast_avg_rate * rateAdj)
        const surcharges = money(r.forecast_surcharges * surchargeAdj * volAdj)
        const credits = money(r.forecast_credits * creditAdj * volAdj)
        return money((vol * rate + surcharges - credits) * 0.9)
      }),
    )

    return {
      period,
      existing: money(existing),
      pipeline,
      total: money(existing + pipeline),
      volume,
    }
  })

  const existingRevenue = sumMoney(byPeriod.map((p) => p.existing))
  const pipelineRevenue = sumMoney(byPeriod.map((p) => p.pipeline))

  return {
    scenario,
    existingRevenue,
    pipelineRevenue,
    totalExpected: money(existingRevenue + pipelineRevenue),
    byPeriod,
    params,
  }
}

export interface ForecastAccuracy {
  mae: number | null
  rmse: number | null
  wape: number | null
  bias: number | null
  variance: number | null
  points: Array<{ period: string; actual: number; forecast: number; error: number }>
}

export function evaluateForecastAccuracy(
  data: DataStore,
  filters: GlobalFilters,
  scenario: 'Base' | 'Upside' | 'Downside' = 'Base',
): ForecastAccuracy {
  const periods = [
    ...new Set(
      data.dates
        .map((d) => d.date_key.slice(0, 7))
        .filter((p) => p >= filters.startPeriod && p <= filters.endPeriod),
    ),
  ].sort()

  let points = periods.map((period) => {
    const actual = computeRecognizedRevenue(data, {
      ...filters,
      startPeriod: period,
      endPeriod: period,
    }).amount
    const forecast = sumMoney(
      data.forecasts
        .filter(
          (f) =>
            f.scenario === scenario &&
            f.forecast_type === 'Existing' &&
            f.accounting_period === period &&
            (filters.customerIds.length === 0 ||
              (f.customer_id != null && filters.customerIds.includes(f.customer_id))),
        )
        .map((f) => f.forecast_recognized),
    )
    return { period, actual, forecast, error: money(actual - forecast) }
  })

  // Only periods with Existing forecast rows are comparable (no forecast ≠ forecast of $0)
  const fcPeriods = new Set(
    data.forecasts
      .filter((f) => f.scenario === scenario && f.forecast_type === 'Existing')
      .map((f) => f.accounting_period),
  )
  points = points.filter((p) => fcPeriods.has(p.period))
  const n = points.length
  if (n === 0) {
    return { mae: null, rmse: null, wape: null, bias: null, variance: null, points }
  }

  const absErrors = points.map((p) => Math.abs(p.error))
  const mae = money(sumMoney(absErrors) / n)
  const rmse = money(Math.sqrt(sumMoney(points.map((p) => p.error * p.error)) / n))
  const sumAbsActual = sumMoney(points.map((p) => Math.abs(p.actual)))
  const wape = sumAbsActual === 0 ? null : money((sumMoney(absErrors) / sumAbsActual) * 100)
  const bias = money(sumMoney(points.map((p) => p.error)) / n)
  const meanActual = sumMoney(points.map((p) => p.actual)) / n
  const variance =
    meanActual === 0
      ? null
      : money(sumMoney(points.map((p) => (p.actual - p.forecast) ** 2)) / n)

  return { mae, rmse, wape, bias, variance, points }
}

export function forecastFormulas() {
  return {
    mae: 'MAE = mean(|Actual − Forecast|)',
    rmse: 'RMSE = sqrt(mean((Actual − Forecast)^2))',
    wape: 'WAPE = sum(|Actual − Forecast|) / sum(|Actual|) × 100; undefined if sum(|Actual|)=0',
    bias: 'Bias = mean(Actual − Forecast); positive = under-forecast',
    driver:
      'Forecast Net Billing = Forecast Billable Volume × Forecast Avg Base Rate + Expected Surcharges − Expected Credits',
  }
}

export { safeDiv }
