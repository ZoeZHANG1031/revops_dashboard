import { describe, expect, it } from 'vitest'
import {
  buildForwardTrendSeries,
  computeForwardOverview,
  computeGapClosurePlan,
  computeScenarioComparison,
  resolveForwardHorizon,
  sumCompanyTargets,
} from '@/calc/forwardForecast'
import { evaluateSnapshotBacktest } from '@/calc/forecastBacktest'
import { DEFAULT_SCENARIO_PARAMS } from '@/calc/forecast'
import { getDataStore } from '@/data/generate'
import { addMonths, defaultFilters, listHistoricalPeriods, listPeriods } from '@/lib/filters'
import { money } from '@/lib/money'

describe('forward forecast planning', () => {
  const data = getDataStore()
  const periods = listPeriods(data)
  const hist = listHistoricalPeriods(data)
  const filters = defaultFilters(periods, hist[hist.length - 1])

  it(
    'forward composition Existing+Pipeline+Adj ≈ Total',
    () => {
      const { overview } = computeForwardOverview(
        data,
        filters,
        'Base',
        DEFAULT_SCENARIO_PARAMS.Base,
        3,
      )
      const sum = money(
        overview.existingForecast + overview.pipelineForecast + overview.adjustments,
      )
      expect(Math.abs(sum - overview.forecastRevenue)).toBeLessThan(0.05)
      expect(overview.compositionOk).toBe(true)
    },
    120_000,
  )

  it(
    'gap equals forecast minus target',
    () => {
      const { overview } = computeForwardOverview(
        data,
        filters,
        'Base',
        DEFAULT_SCENARIO_PARAMS.Base,
        6,
      )
      expect(money(overview.forecastGap)).toBe(
        money(overview.forecastRevenue - overview.revenueTarget),
      )
    },
    120_000,
  )

  it(
    'horizon starts after history_end',
    () => {
      const horizon = resolveForwardHorizon(data, 3)
      expect(horizon.forecastStart).toBe(addMonths(data.meta.history_end, 1))
      expect(horizon.historyEnd).toBe(data.meta.history_end)
      for (const p of horizon.months) {
        expect(p > data.meta.history_end).toBe(true)
      }
    },
    120_000,
  )

  it(
    'targets exist for forward months',
    () => {
      const horizon = resolveForwardHorizon(data, 12)
      const targetSum = sumCompanyTargets(data, horizon.months)
      expect(targetSum).toBeGreaterThan(0)
      const covered = horizon.months.filter((p) =>
        data.revenueTargets.some((t) => t.target_scope === 'Company' && t.period === p),
      )
      expect(covered.length).toBeGreaterThan(0)
    },
    120_000,
  )

  it(
    'snapshot backtest returns n>=0',
    () => {
      const histEnd = data.meta.history_end
      const backStart = addMonths(histEnd, -5)
      const bt = evaluateSnapshotBacktest(
        data,
        { ...filters, startPeriod: backStart, endPeriod: histEnd },
        'Base',
        1,
      )
      expect(bt.n).toBeGreaterThanOrEqual(0)
    },
    120_000,
  )

  it(
    'customer filter excludes company-wide pipeline',
    () => {
      const ryder = data.customers.find((c) => c.customer_name === 'Ryder')
      expect(ryder).toBeTruthy()
      const { overview: company } = computeForwardOverview(
        data,
        filters,
        'Base',
        DEFAULT_SCENARIO_PARAMS.Base,
        3,
      )
      const { overview: cust } = computeForwardOverview(
        data,
        { ...filters, customerIds: [ryder!.customer_id] },
        'Base',
        DEFAULT_SCENARIO_PARAMS.Base,
        3,
      )
      expect(company.pipelineForecast).toBeGreaterThan(0)
      expect(cust.pipelineForecast).toBe(0)
      expect(cust.forecastRevenue).toBe(cust.existingForecast)
    },
    120_000,
  )

  it(
    'trend series anchors last actual to scenario lines without fabricating history',
    () => {
      const horizon = resolveForwardHorizon(data, 3)
      const series = buildForwardTrendSeries(
        data,
        filters,
        DEFAULT_SCENARIO_PARAMS.Base,
        horizon,
        6,
        'Base',
      )
      const anchor = series.find((p) => p.isVisualAnchor)
      expect(anchor).toBeTruthy()
      expect(anchor!.period).toBe(horizon.historyEnd)
      expect(anchor!.actual).toBeGreaterThan(0)
      expect(anchor!.base).toBe(anchor!.actual)
      expect(anchor!.upside).toBe(anchor!.actual)
      expect(anchor!.downside).toBe(anchor!.actual)
      const forecastPts = series.filter((p) => p.kind === 'forecast')
      expect(forecastPts.map((p) => p.period)).toEqual(horizon.months)
      expect(forecastPts.every((p) => p.base != null && p.upside != null && p.downside != null)).toBe(
        true,
      )
      // Anchor must not inflate forward totals
      const { overview } = computeForwardOverview(
        data,
        filters,
        'Base',
        DEFAULT_SCENARIO_PARAMS.Base,
        3,
      )
      const sumFc = money(forecastPts.reduce((a, p) => a + (p.base ?? 0), 0))
      expect(Math.abs(sumFc - overview.forecastRevenue)).toBeLessThan(0.05)
    },
    120_000,
  )

  it(
    'scenario comparison shares target window; actuals invariant',
    () => {
      const rows = computeScenarioComparison(
        data,
        filters,
        'Base',
        DEFAULT_SCENARIO_PARAMS.Base,
        3,
      )
      expect(rows).toHaveLength(3)
      expect(new Set(rows.map((r) => r.revenueTarget)).size).toBe(1)
      expect(rows[0].forecastRevenue).not.toBe(rows[1].forecastRevenue)
      const horizon = resolveForwardHorizon(data, 3)
      const a = buildForwardTrendSeries(
        data,
        filters,
        DEFAULT_SCENARIO_PARAMS.Base,
        horizon,
        6,
        'Base',
      )
      const b = buildForwardTrendSeries(
        data,
        filters,
        DEFAULT_SCENARIO_PARAMS.Upside,
        horizon,
        6,
        'Upside',
      )
      const actualA = a.filter((p) => p.kind === 'actual').map((p) => p.actual)
      const actualB = b.filter((p) => p.kind === 'actual').map((p) => p.actual)
      expect(actualA).toEqual(actualB)
    },
    120_000,
  )

  it(
    'gap closure returns levers when shortfall exists',
    () => {
      const { overview, forward } = computeForwardOverview(
        data,
        filters,
        'Downside',
        DEFAULT_SCENARIO_PARAMS.Downside,
        3,
      )
      const plan = computeGapClosurePlan(forward, overview, [], [])
      if (overview.forecastGap < 0) {
        expect(plan.onOrAboveTarget).toBe(false)
        expect(plan.shortfall).toBeGreaterThan(0)
        expect(plan.assumptions.length).toBeGreaterThan(0)
      } else {
        expect(plan.onOrAboveTarget).toBe(true)
      }
    },
    120_000,
  )
})
