/**
 * Forward-looking forecast helpers for the Forecasting page.
 * Horizon is independent of the global historical date filter used for Actuals/backtests.
 */
import { computeCustomerHealth } from '@/calc/customerHealth'
import {
  computeDriverForecast,
  DEFAULT_SCENARIO_PARAMS,
  evaluateForecastAccuracy,
  type ForecastResult,
} from '@/calc/forecast'
import { addMonths, monthDiff } from '@/lib/filters'
import { money, pct, sumMoney } from '@/lib/money'
import type {
  DataStore,
  ForecastScenarioParams,
  GlobalFilters,
} from '@/types'

export type HorizonPreset = 3 | 6 | 12

export interface ForwardHorizon {
  historyEnd: string
  forecastStart: string
  forecastEnd: string
  months: string[]
  label: string
}

export function resolveForwardHorizon(
  data: DataStore,
  months: HorizonPreset | number,
): ForwardHorizon {
  const historyEnd = data.meta.history_end
  const forecastStart = addMonths(historyEnd, 1)
  const n = Math.max(1, Math.min(12, Math.round(months)))
  const forecastEnd = addMonths(forecastStart, n - 1)
  const all = [
    ...new Set(data.forecasts.map((f) => f.accounting_period).filter((p) => p > historyEnd)),
  ].sort()
  const monthsList = all.filter((p) => p >= forecastStart && p <= forecastEnd)
  // If stored forecasts don't cover the full preset, use what exists
  const end = monthsList.length ? monthsList[monthsList.length - 1] : forecastEnd
  return {
    historyEnd,
    forecastStart,
    forecastEnd: end,
    months: monthsList.length ? monthsList : periodsBetween(forecastStart, end),
    label: `Next ${n} Months (${forecastStart} → ${end})`,
  }
}

function periodsBetween(start: string, end: string): string[] {
  const out: string[] = []
  let cur = start
  while (cur <= end) {
    out.push(cur)
    cur = addMonths(cur, 1)
  }
  return out
}

export function forwardFilters(
  base: GlobalFilters,
  horizon: ForwardHorizon,
): GlobalFilters {
  return {
    ...base,
    startPeriod: horizon.forecastStart,
    endPeriod: horizon.forecastEnd,
  }
}

export interface ForwardOverview {
  horizon: ForwardHorizon
  forecastRevenue: number
  existingForecast: number
  pipelineForecast: number
  adjustments: number
  revenueTarget: number
  forecastGap: number
  forecastGapPct: number | null
  forecastAttainment: number | null
  scenarioRevenueAtRisk: number
  forecastContributionProfit: number
  forecastContributionMargin: number | null
  historicalWape: number | null
  dataCompleteness: number
  method: string
  compositionOk: boolean
}

/**
 * CM run-rate from recent historical net billing − variable cost when available;
 * falls back to 24% synthetic assumption labeled in UI.
 */
function recentCmRate(data: DataStore, filters: GlobalFilters): number {
  const histEnd = data.meta.history_end
  const histStart = addMonths(histEnd, -2)
  const rows = computeCustomerHealth(data, {
    ...filters,
    startPeriod: histStart,
    endPeriod: histEnd,
    customerIds: filters.customerIds,
  })
  const rev = sumMoney(rows.map((r) => r.revenue))
  const cp = sumMoney(
    rows.map((r) =>
      r.contributionMargin == null ? 0 : money((r.revenue * r.contributionMargin) / 100),
    ),
  )
  if (rev <= 0) return 0.24
  return Math.max(0.05, Math.min(0.45, cp / rev))
}

export function sumCompanyTargets(data: DataStore, months: string[]): number {
  return sumMoney(
    data.revenueTargets
      .filter((t) => t.target_scope === 'Company' && months.includes(t.period))
      .map((t) => t.target_revenue),
  )
}

export function sumCustomerTargets(
  data: DataStore,
  months: string[],
  customerIds: string[],
): number {
  const rows = data.revenueTargets.filter(
    (t) =>
      t.target_scope === 'Customer' &&
      months.includes(t.period) &&
      t.customer_id != null &&
      (customerIds.length === 0 || customerIds.includes(t.customer_id)),
  )
  return sumMoney(rows.map((t) => t.target_revenue))
}

export function computeForwardOverview(
  data: DataStore,
  filters: GlobalFilters,
  scenario: 'Base' | 'Upside' | 'Downside',
  params: ForecastScenarioParams,
  horizonMonths: HorizonPreset | number,
): { overview: ForwardOverview; forward: ForecastResult } {
  const horizon = resolveForwardHorizon(data, horizonMonths)
  const ff = forwardFilters(filters, horizon)
  const forward = computeDriverForecast(data, ff, scenario, params)
  const adjustments = 0 // reserved — no separate adjustment layer in stored forecasts
  const compositionTotal = money(
    forward.existingRevenue + forward.pipelineRevenue + adjustments,
  )
  const compositionOk = Math.abs(compositionTotal - forward.totalExpected) < 0.05

  const target =
    filters.customerIds.length > 0
      ? sumCustomerTargets(data, horizon.months, filters.customerIds)
      : sumCompanyTargets(data, horizon.months)

  const gap = money(forward.totalExpected - target)
  const gapPct = pct(gap, target)
  const attainment = target === 0 ? null : pct(forward.totalExpected, target)

  const health = computeCustomerHealth(data, {
    ...filters,
    startPeriod: addMonths(horizon.historyEnd, -2),
    endPeriod: horizon.historyEnd,
  })
  const scenarioRevenueAtRisk = sumMoney(
    health
      .filter((r) =>
        filters.customerIds.length === 0
          ? true
          : filters.customerIds.includes(r.customerId),
      )
      .map((r) => r.scenarioRevenueAtRisk),
  )

  const cmRate = recentCmRate(data, filters)
  const forecastContributionProfit = money(forward.totalExpected * cmRate)
  const forecastContributionMargin = pct(forecastContributionProfit, forward.totalExpected)

  // Historical accuracy on last 6 actual months (not the forward window)
  const backStart = addMonths(horizon.historyEnd, -5)
  const histAcc = evaluateForecastAccuracy(
    data,
    { ...filters, startPeriod: backStart, endPeriod: horizon.historyEnd },
    scenario,
  )

  const monthsCovered = horizon.months.length
  const expectedMonths = Math.max(
    1,
    monthDiff(horizon.forecastStart, resolveForwardHorizon(data, horizonMonths).forecastEnd) + 1,
  )
  const dataCompleteness = Math.round(
    Math.min(100, (monthsCovered / expectedMonths) * 100),
  )

  return {
    forward,
    overview: {
      horizon,
      forecastRevenue: forward.totalExpected,
      existingForecast: forward.existingRevenue,
      pipelineForecast: forward.pipelineRevenue,
      adjustments,
      revenueTarget: target,
      forecastGap: gap,
      forecastGapPct: gapPct,
      forecastAttainment: attainment,
      scenarioRevenueAtRisk,
      forecastContributionProfit,
      forecastContributionMargin,
      historicalWape: histAcc.wape,
      dataCompleteness,
      method: 'Driver-based (Existing run-rate + Weighted pipeline) · Scenario assumptions',
      compositionOk,
    },
  }
}

export interface TargetGapRow {
  id: string
  name: string
  forecast: number
  target: number
  gap: number
  gapPct: number | null
  kind: 'customer' | 'period'
}

export function computeCustomerTargetGaps(
  data: DataStore,
  filters: GlobalFilters,
  scenario: 'Base' | 'Upside' | 'Downside',
  params: ForecastScenarioParams,
  horizon: ForwardHorizon,
): TargetGapRow[] {
  const ff = forwardFilters(filters, horizon)
  const forward = computeDriverForecast(data, ff, scenario, params)

  // Rebuild per-customer existing from stored forecasts with same adj as computeDriverForecast
  const baseParams = DEFAULT_SCENARIO_PARAMS[scenario]
  const volAdj = 1 + (params.volumeGrowth - baseParams.volumeGrowth)
  const rateAdj = 1 + (params.avgRateChange - baseParams.avgRateChange)
  const churnAdj = 1 - Math.max(0, params.churnRate - baseParams.churnRate)
  const surchargeAdj =
    baseParams.surchargeRate === 0 ? 1 : params.surchargeRate / baseParams.surchargeRate
  const creditAdj = baseParams.creditRate === 0 ? 1 : params.creditRate / baseParams.creditRate

  const byCust = new Map<string, number>()
  for (const f of data.forecasts) {
    if (
      f.scenario !== scenario ||
      f.forecast_type !== 'Existing' ||
      !f.customer_id ||
      f.accounting_period < horizon.forecastStart ||
      f.accounting_period > horizon.forecastEnd ||
      (filters.customerIds.length > 0 && !filters.customerIds.includes(f.customer_id))
    )
      continue
    const vol = Math.round(f.forecast_volume * volAdj * churnAdj)
    const rate = money(f.forecast_avg_rate * rateAdj)
    const surcharges = money(f.forecast_surcharges * volAdj * churnAdj * surchargeAdj)
    const credits = money(f.forecast_credits * volAdj * churnAdj * creditAdj)
    const net = money((vol * rate + surcharges - credits) * 0.98)
    byCust.set(f.customer_id, money((byCust.get(f.customer_id) ?? 0) + net))
  }

  // Allocate pipeline proportionally is wrong — pipeline has null customer_id.
  // Show existing-only vs customer targets; note pipeline is company-level.
  void forward

  const rows: TargetGapRow[] = []
  for (const [cid, forecast] of byCust) {
    const target = sumCustomerTargets(data, horizon.months, [cid])
    if (target === 0 && forecast === 0) continue
    const gap = money(forecast - target)
    rows.push({
      id: cid,
      name: data.customers.find((c) => c.customer_id === cid)?.customer_name ?? cid,
      forecast,
      target,
      gap,
      gapPct: pct(gap, target),
      kind: 'customer',
    })
  }
  return rows.sort((a, b) => a.gap - b.gap)
}

export interface ForwardTrendPoint {
  period: string
  kind: 'actual' | 'forecast'
  actual: number | null
  base: number | null
  upside: number | null
  downside: number | null
  target: number | null
  existing: number | null
  pipeline: number | null
  /**
   * Last complete historical month — scenario series copy Actual here for chart continuity only.
   * Not included in forward forecast totals / Gap / Attainment.
   */
  isVisualAnchor?: boolean
}

export function buildForwardTrendSeries(
  data: DataStore,
  filters: GlobalFilters,
  params: ForecastScenarioParams,
  horizon: ForwardHorizon,
  historyMonths = 6,
  activeScenario: 'Base' | 'Upside' | 'Downside' = 'Base',
): ForwardTrendPoint[] {
  const histStart = addMonths(horizon.historyEnd, -(historyMonths - 1))
  const histFilters: GlobalFilters = {
    ...filters,
    startPeriod: histStart,
    endPeriod: horizon.historyEnd,
  }
  // Actual series is scenario-invariant (Recognized Revenue) — always Base accuracy points
  const accuracy = evaluateForecastAccuracy(data, histFilters, 'Base')
  const actualMap = new Map(accuracy.points.map((p) => [p.period, p.actual]))

  const ff = forwardFilters(filters, horizon)
  // Live sliders apply only to the selected scenario line; others stay on scenario defaults
  const paramsFor = (sc: 'Base' | 'Upside' | 'Downside') =>
    sc === activeScenario ? params : DEFAULT_SCENARIO_PARAMS[sc]
  const base = computeDriverForecast(data, ff, 'Base', paramsFor('Base'))
  const upside = computeDriverForecast(data, ff, 'Upside', paramsFor('Upside'))
  const downside = computeDriverForecast(data, ff, 'Downside', paramsFor('Downside'))

  const baseMap = new Map(base.byPeriod.map((p) => [p.period, p]))
  const upMap = new Map(upside.byPeriod.map((p) => [p.period, p]))
  const downMap = new Map(downside.byPeriod.map((p) => [p.period, p]))

  const companyTargets = new Map(
    data.revenueTargets
      .filter((t) => t.target_scope === 'Company')
      .map((t) => [t.period, t.target_revenue]),
  )
  const custTargets = new Map<string, number>()
  if (filters.customerIds.length > 0) {
    for (const t of data.revenueTargets) {
      if (
        t.target_scope === 'Customer' &&
        t.customer_id &&
        filters.customerIds.includes(t.customer_id)
      ) {
        custTargets.set(t.period, money((custTargets.get(t.period) ?? 0) + t.target_revenue))
      }
    }
  }

  const histPeriods = periodsBetween(histStart, horizon.historyEnd)
  const points: ForwardTrendPoint[] = []

  for (const period of histPeriods) {
    const actual = actualMap.get(period) ?? null
    const isAnchor = period === horizon.historyEnd && actual != null && actual > 0
    points.push({
      period,
      kind: 'actual',
      actual,
      // Visual connector only — same Actual value for all scenarios so lines meet at Forecast Start
      base: isAnchor ? actual : null,
      upside: isAnchor ? actual : null,
      downside: isAnchor ? actual : null,
      target: null,
      existing: null,
      pipeline: null,
      isVisualAnchor: isAnchor || undefined,
    })
  }
  for (const period of horizon.months) {
    const b = baseMap.get(period)
    const u = upMap.get(period)
    const d = downMap.get(period)
    points.push({
      period,
      kind: 'forecast',
      actual: null,
      base: b?.total ?? null,
      upside: u?.total ?? null,
      downside: d?.total ?? null,
      target:
        filters.customerIds.length > 0
          ? (custTargets.get(period) ?? null)
          : (companyTargets.get(period) ?? null),
      existing: b?.existing ?? null,
      pipeline: b?.pipeline ?? null,
    })
  }
  return points
}

export interface ScenarioComparisonRow {
  scenario: 'Base' | 'Upside' | 'Downside'
  forecastRevenue: number
  revenueTarget: number
  gapToTarget: number
  targetAttainmentPct: number | null
  forecastCmPct: number | null
  revenueAtRisk: number
  existingForecast: number
  pipelineForecast: number
}

/** All three scenarios on the same forward horizon / target window. */
export function computeScenarioComparison(
  data: DataStore,
  filters: GlobalFilters,
  activeScenario: 'Base' | 'Upside' | 'Downside',
  activeParams: ForecastScenarioParams,
  horizonMonths: HorizonPreset | number,
): ScenarioComparisonRow[] {
  return (['Base', 'Upside', 'Downside'] as const).map((sc) => {
    const params = sc === activeScenario ? activeParams : DEFAULT_SCENARIO_PARAMS[sc]
    const { overview } = computeForwardOverview(data, filters, sc, params, horizonMonths)
    return {
      scenario: sc,
      forecastRevenue: overview.forecastRevenue,
      revenueTarget: overview.revenueTarget,
      gapToTarget: overview.forecastGap,
      targetAttainmentPct: overview.forecastAttainment,
      forecastCmPct: overview.forecastContributionMargin,
      revenueAtRisk: overview.scenarioRevenueAtRisk,
      existingForecast: overview.existingForecast,
      pipelineForecast: overview.pipelineForecast,
    }
  })
}

export interface GapClosurePlan {
  shortfall: number
  onOrAboveTarget: boolean
  avgRevenuePerShipment: number | null
  forecastVolume: number
  volumeNeeded: number | null
  volumeLiftPct: number | null
  rateLiftAbsolute: number | null
  rateLiftPct: number | null
  /** Additional new-logo / pipeline revenue still needed after current pipeline forecast */
  incrementalNewCustomerRevenue: number | null
  expansionCandidates: { customerId: string; name: string; gapVsTarget: number; note: string }[]
  churnRiskWideners: { customerId: string; name: string; revenueAtRisk: number; note: string }[]
  assumptions: string[]
}

/**
 * Quantifies levers to close Forecast Gap vs Target using forward driver volumes / rates.
 * Non-quantifiable items are labeled Hypothesis in the UI.
 */
export function computeGapClosurePlan(
  forward: ForecastResult,
  overview: ForwardOverview,
  targetGaps: TargetGapRow[],
  riskRows: ForwardRiskRow[],
): GapClosurePlan {
  const shortfall = money(Math.max(0, -overview.forecastGap))
  const forecastVolume = sumMoney(forward.byPeriod.map((p) => p.volume))
  const existing = forward.existingRevenue
  const avgRevenuePerShipment =
    forecastVolume > 0 ? money(existing / forecastVolume) : null

  if (shortfall <= 0) {
    return {
      shortfall: 0,
      onOrAboveTarget: true,
      avgRevenuePerShipment,
      forecastVolume,
      volumeNeeded: null,
      volumeLiftPct: null,
      rateLiftAbsolute: null,
      rateLiftPct: null,
      incrementalNewCustomerRevenue: null,
      expansionCandidates: [],
      churnRiskWideners: [],
      assumptions: [
        'Selected scenario Forecast ≥ Revenue Target for the forward window — no shortfall to close.',
      ],
    }
  }

  const volumeNeeded =
    avgRevenuePerShipment != null && avgRevenuePerShipment > 0
      ? money(shortfall / avgRevenuePerShipment)
      : null
  const volumeLiftPct =
    volumeNeeded != null && forecastVolume > 0 ? pct(volumeNeeded, forecastVolume) : null
  const rateLiftAbsolute = forecastVolume > 0 ? money(shortfall / forecastVolume) : null
  const rateLiftPct =
    rateLiftAbsolute != null && avgRevenuePerShipment != null && avgRevenuePerShipment > 0
      ? pct(rateLiftAbsolute, avgRevenuePerShipment)
      : null
  const incrementalNewCustomerRevenue = money(
    Math.max(0, shortfall - forward.pipelineRevenue),
  )

  const expansionCandidates = [...targetGaps]
    .filter((r) => r.gap < 0)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 5)
    .map((r) => ({
      customerId: r.id,
      name: r.name,
      gapVsTarget: r.gap,
      note: 'Hypothesis — closing this account’s target gap would reduce portfolio shortfall if volume/price recovers.',
    }))

  const churnRiskWideners = [...riskRows]
    .filter((r) => r.revenueAtRisk > 0)
    .sort((a, b) => b.revenueAtRisk - a.revenueAtRisk)
    .slice(0, 5)
    .map((r) => ({
      customerId: r.customerId,
      name: r.customerName,
      revenueAtRisk: r.revenueAtRisk,
      note: 'Hypothesis — preventing this Scenario RaR would protect the gap from widening (not confirmed loss).',
    }))

  return {
    shortfall,
    onOrAboveTarget: false,
    avgRevenuePerShipment,
    forecastVolume,
    volumeNeeded,
    volumeLiftPct,
    rateLiftAbsolute,
    rateLiftPct,
    incrementalNewCustomerRevenue,
    expansionCandidates,
    churnRiskWideners,
    assumptions: [
      'Volume / rate levers use Existing forecast packages and Existing revenue only (pipeline kept separate).',
      'Each lever is an independent what-if — do not add Volume + Rate + New Logo together (would double-count).',
      'Expansion / churn lists are Hypothesis rankings from target gaps and health Scenario RaR — not causal guarantees.',
    ],
  }
}

export interface ForwardRiskRow {
  customerId: string
  customerName: string
  forecastRevenue: number
  revenueAtRisk: number
  mainDriver: string
  confidence: string
  healthBand: string
  healthScore: number
}

export function computeForwardRiskRows(
  data: DataStore,
  filters: GlobalFilters,
  scenario: 'Base' | 'Upside' | 'Downside',
  params: ForecastScenarioParams,
  horizon: ForwardHorizon,
): ForwardRiskRow[] {
  const ff = forwardFilters(filters, horizon)
  const baseParams = DEFAULT_SCENARIO_PARAMS[scenario]
  const volAdj = 1 + (params.volumeGrowth - baseParams.volumeGrowth)
  const rateAdj = 1 + (params.avgRateChange - baseParams.avgRateChange)
  const churnAdj = 1 - Math.max(0, params.churnRate - baseParams.churnRate)

  const fcByCust = new Map<string, number>()
  for (const f of data.forecasts) {
    if (
      f.scenario !== scenario ||
      f.forecast_type !== 'Existing' ||
      !f.customer_id ||
      f.accounting_period < horizon.forecastStart ||
      f.accounting_period > horizon.forecastEnd
    )
      continue
    if (filters.customerIds.length && !filters.customerIds.includes(f.customer_id)) continue
    const vol = Math.round(f.forecast_volume * volAdj * churnAdj)
    const rate = money(f.forecast_avg_rate * rateAdj)
    const net = money(vol * rate * 0.98)
    fcByCust.set(f.customer_id, money((fcByCust.get(f.customer_id) ?? 0) + net))
  }

  const health = computeCustomerHealth(data, {
    ...filters,
    startPeriod: addMonths(horizon.historyEnd, -2),
    endPeriod: horizon.historyEnd,
  })

  return health
    .map((h) => ({
      customerId: h.customerId,
      customerName: h.customerName,
      forecastRevenue: fcByCust.get(h.customerId) ?? 0,
      revenueAtRisk: h.scenarioRevenueAtRisk,
      mainDriver: h.topRiskDriver,
      confidence: h.confidence,
      healthBand: h.healthBand,
      healthScore: h.healthScore,
    }))
    .filter((r) => r.forecastRevenue > 0 || r.revenueAtRisk > 0)
    .sort((a, b) => b.revenueAtRisk - a.revenueAtRisk)
}

export interface ForecastBuildStep {
  key: string
  label: string
  amount: number
}

/** Transparent composition waterfall for the forward window (not Actual−Forecast). */
export function forecastCompositionWaterfall(forward: ForecastResult): ForecastBuildStep[] {
  return [
    { key: 'existing', label: 'Existing Customer Forecast', amount: forward.existingRevenue },
    { key: 'pipeline', label: 'New Pipeline Forecast', amount: forward.pipelineRevenue },
    { key: 'adj', label: 'Net Forecast Adjustments', amount: 0 },
    { key: 'total', label: 'Total Forecast Revenue', amount: forward.totalExpected },
  ]
}
