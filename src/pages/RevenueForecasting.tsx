import { useMemo, useState } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  computeDriverForecast,
  DEFAULT_SCENARIO_PARAMS,
  evaluateForecastAccuracy,
  forecastFormulas,
} from '@/calc/forecast'
import {
  buildForwardTrendSeries,
  computeCustomerTargetGaps,
  computeForwardOverview,
  computeForwardRiskRows,
  computeGapClosurePlan,
  computeScenarioComparison,
  forecastCompositionWaterfall,
  type HorizonPreset,
} from '@/calc/forwardForecast'
import { evaluateSnapshotBacktest } from '@/calc/forecastBacktest'
import { forecastComparability } from '@/calc/forecastScope'
import { computeRecognizedRevenue } from '@/calc/recognizedRevenue'
import { PageHeader } from '@/components/common/PageHeader'
import { ModuleSubNav } from '@/components/layout/ModuleSubNav'
import { InfoTip } from '@/components/common/StatusIndicator'
import { FORECASTING_NAV, PALETTE } from '@/lib/icons'
import { computeVarianceBridge } from '@/calc/varianceBridge'
import { forecastCommissionExpense } from '@/calc/salesCompensation'
import { FloatingWaterfall } from '@/components/charts/FloatingWaterfall'
import { BridgeAttribution } from '@/components/charts/BridgeAttribution'
import { summarizeSteps } from '@/lib/waterfall'
import { StatTile } from '@/components/common/StatTile'
import { ChartCard } from '@/components/common/ChartCard'
import { Collapsible } from '@/components/common/Collapsible'
import { DataTable } from '@/components/common/DataTable'
import { useApp } from '@/context/AppContext'
import { addMonths } from '@/lib/filters'
import { exportToCsv } from '@/lib/export'
import { formatCurrency, formatCurrencyPrecise, formatPercent } from '@/lib/money'

const SCENARIOS = ['Base', 'Upside', 'Downside'] as const
const HORIZONS: HorizonPreset[] = [3, 6, 12]

export type ForecastFocus = 'outlook' | 'scenarios' | 'accuracy' | 'gap'

export function RevenueForecasting({ focus = 'outlook' }: { focus?: ForecastFocus }) {
  const showOutlook = focus === 'outlook'
  const showScenarios = focus === 'scenarios'
  const showAccuracy = focus === 'accuracy'
  const showGap = focus === 'gap'
  const pagePath =
    focus === 'scenarios'
      ? '/forecasting/scenarios'
      : focus === 'accuracy'
        ? '/forecasting/accuracy'
        : focus === 'gap'
          ? '/forecasting/gap'
          : '/forecasting'

  const {
    data,
    filters,
    scenario,
    setScenario,
    scenarioParams,
    setScenarioParams,
    openEntityDrawer,
    navigateWithContext,
    highlightCustomerId,
    openCustomer360,
  } = useApp()
  const [horizonMonths, setHorizonMonths] = useState<HorizonPreset>(3)
  const [viewMode, setViewMode] = useState<'company' | 'customer'>('company')
  const [investigateBy, setInvestigateBy] = useState<'customer' | 'month'>('customer')
  const [seriesMode, setSeriesMode] = useState<'existing' | 'pipeline' | 'total'>('existing')

  const focusCustomerId =
    viewMode === 'customer' ? filters.customerIds[0] ?? highlightCustomerId ?? null : null
  const planningFilters = useMemo(() => {
    if (!focusCustomerId) return filters
    return { ...filters, customerIds: [focusCustomerId] }
  }, [filters, focusCustomerId])

  const { overview, forward } = useMemo(
    () => computeForwardOverview(data, planningFilters, scenario, scenarioParams, horizonMonths),
    [data, planningFilters, scenario, scenarioParams, horizonMonths],
  )

  const targetGaps = useMemo(
    () =>
      computeCustomerTargetGaps(
        data,
        planningFilters,
        scenario,
        scenarioParams,
        overview.horizon,
      ),
    [data, planningFilters, scenario, scenarioParams, overview.horizon],
  )

  const trendSeries = useMemo(
    () =>
      buildForwardTrendSeries(
        data,
        planningFilters,
        scenarioParams,
        overview.horizon,
        6,
        scenario,
      ),
    [data, planningFilters, scenarioParams, overview.horizon, scenario],
  )

  const trendChartData = useMemo(
    () =>
      trendSeries.map((p) => ({
        ...p,
        range:
          p.upside != null && p.downside != null
            ? [Math.min(p.downside, p.upside), Math.max(p.downside, p.upside)]
            : null,
        gap:
          p.kind === 'forecast' && p.base != null && p.target != null
            ? p.base - p.target
            : null,
      })),
    [trendSeries],
  )

  const scenarioComparison = useMemo(
    () =>
      computeScenarioComparison(
        data,
        planningFilters,
        scenario,
        scenarioParams,
        horizonMonths,
      ),
    [data, planningFilters, scenario, scenarioParams, horizonMonths],
  )

  const scenarioLineStyle = (sc: 'Base' | 'Upside' | 'Downside') => {
    const active = scenario === sc
    return {
      strokeWidth: active ? 2.75 : 1.5,
      opacity: active ? 1 : 0.32,
    }
  }

  const riskRows = useMemo(
    () =>
      computeForwardRiskRows(
        data,
        planningFilters,
        scenario,
        scenarioParams,
        overview.horizon,
      ).slice(0, 15),
    [data, planningFilters, scenario, scenarioParams, overview.horizon],
  )

  const gapClosure = useMemo(
    () => computeGapClosurePlan(forward, overview, targetGaps, riskRows),
    [forward, overview, targetGaps, riskRows],
  )

  const compositionSteps = useMemo(() => forecastCompositionWaterfall(forward), [forward])

  const gapInsights = useMemo(() => {
    if (!targetGaps.length) return null
    const neg = [...targetGaps].sort((a, b) => a.gap - b.gap)[0]
    const pos = [...targetGaps].sort((a, b) => b.gap - a.gap)[0]
    const lines: string[] = []
    if (neg && neg.gap < 0) {
      lines.push(
        `Largest shortfall vs target: ${neg.name} (${formatCurrency(neg.gap, true)}).`,
      )
    }
    if (pos && pos.gap > 0) {
      lines.push(
        `Largest upside vs target: ${pos.name} (+${formatCurrency(pos.gap, true)}).`,
      )
    }
    return lines.length ? lines.join(' ') : null
  }, [targetGaps])

  const growthOpportunities = useMemo(() => {
    const healthyBands = new Set(['Healthy', 'Watchlist'])
    return targetGaps
      .filter((r) => r.gap > 0)
      .map((r) => {
        const risk = riskRows.find((x) => x.customerId === r.id)
        return { ...r, healthBand: risk?.healthBand ?? '—' }
      })
      .filter((r) => healthyBands.has(r.healthBand))
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 5)
  }, [targetGaps, riskRows])

  // —— Historical / global filter scope (diagnostics) ——
  const forecast = useMemo(
    () => computeDriverForecast(data, filters, scenario, scenarioParams),
    [data, filters, scenario, scenarioParams],
  )
  const accuracy = useMemo(
    () => evaluateForecastAccuracy(data, filters, scenario),
    [data, filters, scenario],
  )
  const bridge = useMemo(
    () => computeVarianceBridge(data, filters, scenario, 'total'),
    [data, filters, scenario],
  )
  const formulas = forecastFormulas()

  const snapshotBacktest = useMemo(() => {
    const histEnd = data.meta.history_end
    const backStart = addMonths(histEnd, -5)
    return evaluateSnapshotBacktest(
      data,
      { ...filters, startPeriod: backStart, endPeriod: histEnd },
      scenario,
      1,
    )
  }, [data, filters, scenario])

  const scenarioRuns = useMemo(
    () =>
      Object.fromEntries(
        SCENARIOS.map((sc) => [
          sc,
          computeDriverForecast(data, filters, sc, sc === scenario ? scenarioParams : DEFAULT_SCENARIO_PARAMS[sc]),
        ]),
      ) as Record<(typeof SCENARIOS)[number], ReturnType<typeof computeDriverForecast>>,
    [data, filters, scenario, scenarioParams],
  )
  const actualByPeriod = useMemo(
    () => new Map(accuracy.points.filter((p) => p.actual !== 0).map((p) => [p.period, p.actual])),
    [accuracy],
  )
  const scenarioData = useMemo(() => {
    const pick = (p: { existing: number; pipeline: number; total: number }) =>
      seriesMode === 'existing' ? p.existing : seriesMode === 'pipeline' ? p.pipeline : p.total
    const periods = [...new Set(SCENARIOS.flatMap((sc) => scenarioRuns[sc].byPeriod.map((p) => p.period)))].sort()
    return periods.map((period) => {
      const v = (sc: (typeof SCENARIOS)[number]) => {
        const row = scenarioRuns[sc].byPeriod.find((p) => p.period === period)
        return row ? pick(row) : null
      }
      const up = v('Upside')
      const down = v('Downside')
      return {
        period,
        actual: seriesMode === 'pipeline' ? null : (actualByPeriod.get(period) ?? null),
        base: v('Base'),
        upside: up,
        downside: down,
        range: up != null && down != null ? [Math.min(up, down), Math.max(up, down)] : null,
      }
    })
  }, [scenarioRuns, seriesMode, actualByPeriod])

  const fcScope = useMemo(() => forecastComparability(data, filters, scenario), [data, filters, scenario])
  const isComparable = fcScope.comparable
  const comparable = isComparable ? accuracy.points.filter((p) => p.actual !== 0) : []
  const sumActual = comparable.reduce((a, p) => a + p.actual, 0)
  const sumFcst = comparable.reduce((a, p) => a + p.forecast, 0)
  const variance = comparable.length ? sumActual - sumFcst : null
  const variancePct = variance != null && sumFcst !== 0 ? (variance / Math.abs(sumFcst)) * 100 : null
  const forecastAccuracy = accuracy.wape != null ? Math.max(0, 100 - accuracy.wape) : null
  const residualAmt = bridge.items.find((i) => i.key === 'other')?.amount ?? 0
  const bridgeAbs = bridge.items
    .filter((i) => i.key !== 'forecast' && i.key !== 'actual')
    .reduce((a, i) => a + Math.abs(i.amount), 0)
  const residualQuality = bridgeAbs === 0 ? null : 100 - (Math.abs(residualAmt) / bridgeAbs) * 100
  const worstMonth = [...accuracy.points].sort((a, b) => Math.abs(b.error) - Math.abs(a.error))[0]
  const accuracyInsight =
    isComparable && accuracy.wape != null
      ? `WAPE ${formatPercent(accuracy.wape)} across ${accuracy.points.length} months; bias ${formatCurrency(accuracy.bias ?? 0, true)}/mo means the forecast ${(accuracy.bias ?? 0) >= 0 ? 'under' : 'over'}-states revenue.${worstMonth ? ` Largest miss: ${worstMonth.period} (${worstMonth.error >= 0 ? '+' : '−'}${formatCurrency(Math.abs(worstMonth.error), true)}).` : ''}`
      : (fcScope.reason ?? null)
  const decompInsight =
    isComparable && residualQuality != null
      ? `Known drivers explain ${formatPercent(residualQuality)} of the movement; ${formatCurrency(residualAmt, true)} remains unexplained.`
      : null

  const byCustomer = useMemo(() => {
    const actual = new Map<string, number>()
    for (const r of computeRecognizedRevenue(data, fcScope.comparableFilters).rows) {
      actual.set(r.customer_id, (actual.get(r.customer_id) ?? 0) + r.amount)
    }
    const fc = new Map<string, number>()
    for (const f of data.forecasts) {
      if (
        f.scenario !== scenario ||
        f.forecast_type !== 'Existing' ||
        !f.customer_id ||
        f.accounting_period < filters.startPeriod ||
        f.accounting_period > filters.endPeriod ||
        (filters.customerIds.length > 0 && !filters.customerIds.includes(f.customer_id))
      )
        continue
      fc.set(f.customer_id, (fc.get(f.customer_id) ?? 0) + f.forecast_recognized)
    }
    const ids = new Set([...actual.keys(), ...fc.keys()])
    return [...ids]
      .map((id) => {
        const a = Math.round((actual.get(id) ?? 0) * 100) / 100
        const f = Math.round((fc.get(id) ?? 0) * 100) / 100
        return {
          id,
          name: data.customers.find((c) => c.customer_id === id)?.customer_name ?? id,
          actual: a,
          forecast: f,
          variance: Math.round((a - f) * 100) / 100,
          variancePct: f === 0 ? null : ((a - f) / Math.abs(f)) * 100,
          hasForecast: fc.has(id),
        }
      })
      .sort((x, y) => Math.abs(y.variance) - Math.abs(x.variance))
  }, [data, filters, scenario, fcScope])

  const chartData = useMemo(() => {
    const byPeriod = new Map<string, { period: string; actual?: number; forecast?: number; existing?: number; pipeline?: number }>()
    accuracy.points.forEach((p) => {
      byPeriod.set(p.period, { period: p.period, actual: p.actual, forecast: p.forecast })
    })
    forecast.byPeriod.forEach((p) => {
      const cur = byPeriod.get(p.period) ?? { period: p.period }
      cur.existing = p.existing
      cur.pipeline = p.pipeline
      cur.forecast = p.total
      byPeriod.set(p.period, cur)
    })
    return [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period))
  }, [accuracy, forecast])

  const focusCustomerName = focusCustomerId
    ? data.customers.find((c) => c.customer_id === focusCustomerId)?.customer_name
    : null

  const commissionExpenseFc = useMemo(
    () => forecastCommissionExpense(data, planningFilters, scenario),
    [data, planningFilters, scenario],
  )

  const applyWhatIf = (patch: Partial<typeof scenarioParams>) => {
    setScenarioParams({ ...scenarioParams, ...patch })
  }

  return (
    <div className="space-y-5">
      <ModuleSubNav items={FORECASTING_NAV} />
      <PageHeader
        path={pagePath}
        scope={`${overview.horizon.label} · ${scenario} · Total Business = Existing + Pipeline`}
        actions={
          <>
            {SCENARIOS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScenario(s)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  scenario === s
                    ? 'bg-brand-700 text-white'
                    : 'border border-slate-200 bg-white text-ink hover:bg-slate-50'
                }`}
              >
                {s}
              </button>
            ))}
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
              onClick={() => {
                const rows = scenarioComparison.flatMap((row) => {
                  const params =
                    row.scenario === scenario ? scenarioParams : DEFAULT_SCENARIO_PARAMS[row.scenario]
                  const run = computeDriverForecast(
                    data,
                    {
                      ...planningFilters,
                      startPeriod: overview.horizon.forecastStart,
                      endPeriod: overview.horizon.forecastEnd,
                    },
                    row.scenario,
                    params,
                  )
                  return run.byPeriod.map((p) => ({
                    scenario: row.scenario,
                    horizon: overview.horizon.label,
                    history_end: overview.horizon.historyEnd,
                    forecast_start: overview.horizon.forecastStart,
                    as_of: data.meta.as_of_date,
                    date_basis: 'Recognition / Forecast accounting_period',
                    volume_growth: params.volumeGrowth,
                    avg_rate_change: params.avgRateChange,
                    churn_rate: params.churnRate,
                    surcharge_rate: params.surchargeRate,
                    credit_rate: params.creditRate,
                    period: p.period,
                    existing: p.existing,
                    pipeline: p.pipeline,
                    total: p.total,
                    volume: p.volume,
                    revenue_target_window: row.revenueTarget,
                    gap_to_target_window: row.gapToTarget,
                    disclaimer: 'Synthetic',
                  }))
                })
                exportToCsv('forward_forecast_scenarios.csv', rows)
              }}
            >
              Export Forecast
            </button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#dce6df] bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase text-ink-muted">Horizon</span>
          {HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHorizonMonths(h)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                horizonMonths === h
                  ? 'bg-brand-700 text-white'
                  : 'border border-slate-200 bg-white text-ink hover:bg-slate-50'
              }`}
            >
              Next {h}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase text-ink-muted">View</span>
          {(['company', 'customer'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setViewMode(v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize ${
                viewMode === v
                  ? 'bg-forest text-white'
                  : 'border border-slate-200 bg-white text-ink hover:bg-slate-50'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-muted">
          Forward window: <strong>{overview.horizon.label}</strong> · Scenario buttons highlight KPIs / drivers —
          chart keeps all three scenarios visible
        </p>
      </div>

      <div className="rounded-xl border border-[#dce6df] bg-[#f7faf8] px-4 py-3 text-xs text-ink-muted">
        <p className="font-semibold text-ink">Forecast time logic</p>
        <ul className="mt-1.5 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          <li>
            Historical Actual Period: complete months through <strong>{overview.horizon.historyEnd}</strong>
          </li>
          <li>
            As-of Date: <strong>{data.meta.as_of_date}</strong>
          </li>
          <li>
            Forecast Start: <strong>{overview.horizon.forecastStart}</strong>
          </li>
          <li>
            Forecast Horizon: <strong>{overview.horizon.forecastStart} → {overview.horizon.forecastEnd}</strong>
          </li>
          <li>
            Target Period: same forward months as Forecast (Synthetic Management Plan)
          </li>
          <li>
            {overview.horizon.forecastStart} status:{' '}
            <strong>Full-Month Projected Revenue</strong> — no Month-to-Date Actual in store for this month
            (history ends {overview.horizon.historyEnd}). Not Remaining-Month overlay.
          </li>
        </ul>
      </div>

      {viewMode === 'customer' && focusCustomerName && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-xs text-ink">
          Customer planning focus: <strong>{focusCustomerName}</strong> — forward forecast and gaps reflect this
          account (Existing customer forecast vs customer targets; pipeline stays company-level when filtered).
        </div>
      )}
      {viewMode === 'customer' && !focusCustomerId && (
        <p className="text-xs text-ink-muted">
          Select a customer in global filters or highlight a customer to emphasize account-level forward forecast.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Forecast Revenue (Total)"
          value={formatCurrency(overview.forecastRevenue, true)}
          hint={`Existing ${formatCurrency(overview.existingForecast, true)} + Pipeline ${formatCurrency(overview.pipelineForecast, true)} · ${scenario} scenario`}
        />
        <Stat
          label="Revenue Target"
          value={formatCurrency(overview.revenueTarget, true)}
          hint="Synthetic Management Plan · forward months only"
        />
        <Stat
          label="Forecast Gap"
          value={`${overview.forecastGap >= 0 ? '+' : ''}${formatCurrency(overview.forecastGap, true)}`}
          hint={
            overview.forecastGapPct != null
              ? `${overview.forecastGapPct >= 0 ? '+' : ''}${overview.forecastGapPct.toFixed(1)}% vs target`
              : 'Target is zero in scope'
          }
          tone={
            overview.forecastGap >= 0
              ? 'good'
              : overview.forecastGapPct != null && overview.forecastGapPct < -5
                ? 'bad'
                : 'warn'
          }
        />
        <Stat
          label="Forecast Attainment"
          value={overview.forecastAttainment == null ? 'N/A' : formatPercent(overview.forecastAttainment)}
          hint="Forecast ÷ Revenue Target"
          tone={
            overview.forecastAttainment == null
              ? undefined
              : overview.forecastAttainment >= 100
                ? 'good'
                : overview.forecastAttainment >= 95
                  ? 'warn'
                  : 'bad'
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Stat
          label="Scenario Revenue at Risk"
          value={formatCurrency(overview.scenarioRevenueAtRisk, true)}
          hint="Scenario exposure from health model — not confirmed loss"
        />
        <Stat
          label="Forecast CM%"
          value={formatPercent(overview.forecastContributionMargin)}
          hint={`Contribution profit ${formatCurrency(overview.forecastContributionProfit, true)} · run-rate from recent history`}
        />
        <div className="rounded-xl border border-[#dce6df] bg-[#f5f8f5] px-3 py-2.5">
          <p className="text-xs font-semibold uppercase text-ink-muted">Forecast Confidence</p>
          <p className="mt-1 text-[13px] text-ink">
            Historical WAPE {formatPercent(overview.historicalWape)} · Data completeness{' '}
            {overview.dataCompleteness}% · {overview.method}
          </p>
          <p className="mt-1 text-xs text-ink-muted inline-flex items-center">
            Not a statistical confidence interval
            <InfoTip text="Confidence strip summarizes historical error and coverage — not a fitted prediction interval." />
          </p>
        </div>
      </div>

      <ChartCard
        icon="forecast"
        iconTone="forecast"
        title="Revenue Forecast Trend"
        businessQuestion="How does the forward outlook compare to plan after recent actuals?"
        subtitle={`${overview.horizon.label} · Actual (solid) → Base / Upside / Downside (dashed) · Selected scenario emphasized · Assumption band ≠ confidence interval`}
        insight={`Selected: ${scenario}. Historical Actual does not change when switching scenarios. Visual anchor at ${overview.horizon.historyEnd} connects Actual to Forecast without adding to forecast totals.`}
      >
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trendChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as (typeof trendChartData)[0]
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                      <p className="font-semibold">{row.period}</p>
                      {row.isVisualAnchor && (
                        <p className="text-ink-muted">Visual anchor (Actual) — not double-counted in forecast</p>
                      )}
                      {row.kind === 'actual' && row.actual != null && (
                        <p>Actual Recognized: {formatCurrencyPrecise(row.actual)}</p>
                      )}
                      {(row.kind === 'forecast' || row.isVisualAnchor) && (
                        <>
                          {row.base != null && <p>Base: {formatCurrencyPrecise(row.base)}</p>}
                          {row.upside != null && <p>Upside: {formatCurrencyPrecise(row.upside)}</p>}
                          {row.downside != null && <p>Downside: {formatCurrencyPrecise(row.downside)}</p>}
                          {row.target != null && <p>Target: {formatCurrencyPrecise(row.target)}</p>}
                          {row.gap != null && (
                            <p>
                              Base gap vs target: {row.gap >= 0 ? '+' : ''}
                              {formatCurrencyPrecise(row.gap)}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine
                x={overview.horizon.forecastStart}
                stroke={PALETTE.brand}
                strokeDasharray="4 4"
                label={{ value: 'Forecast Start', position: 'insideTopLeft', fontSize: 11 }}
              />
              <Area
                isAnimationActive={false}
                type="monotone"
                dataKey="range"
                name="Upside–Downside band (assumption)"
                fill={PALETTE.forecast}
                fillOpacity={0.12}
                stroke="none"
                connectNulls={false}
              />
              <Line
                isAnimationActive={false}
                type="monotone"
                dataKey="actual"
                name="Historical Actual"
                stroke={PALETTE.brand}
                strokeWidth={2.5}
                dot={false}
                connectNulls={false}
              />
              <Line
                isAnimationActive={false}
                type="monotone"
                dataKey="base"
                name="Base Forecast"
                stroke={PALETTE.forecast}
                strokeWidth={scenarioLineStyle('Base').strokeWidth}
                strokeOpacity={scenarioLineStyle('Base').opacity}
                strokeDasharray="5 4"
                dot={false}
                connectNulls
              />
              <Line
                isAnimationActive={false}
                type="monotone"
                dataKey="upside"
                name="Upside Forecast"
                stroke={PALETTE.positive}
                strokeWidth={scenarioLineStyle('Upside').strokeWidth}
                strokeOpacity={scenarioLineStyle('Upside').opacity}
                strokeDasharray="4 3"
                dot={false}
                connectNulls
              />
              <Line
                isAnimationActive={false}
                type="monotone"
                dataKey="downside"
                name="Downside Forecast"
                stroke={PALETTE.watch}
                strokeWidth={scenarioLineStyle('Downside').strokeWidth}
                strokeOpacity={scenarioLineStyle('Downside').opacity}
                strokeDasharray="4 3"
                dot={false}
                connectNulls
              />
              <Line
                isAnimationActive={false}
                type="monotone"
                dataKey="target"
                name="Revenue Target"
                stroke="#64748b"
                strokeWidth={1.5}
                strokeDasharray="2 3"
                dot={false}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Forecast months shown: {overview.horizon.months.join(', ') || '—'}. Band is an assumption range across
          Upside–Downside drivers — not a statistical confidence interval.
        </p>
      </ChartCard>

      <ChartCard
        icon="scenario"
        iconTone="forecast"
        title="Scenario Comparison Summary"
        subtitle="Same forward horizon and Revenue Target window · values from Scenario Engine"
        businessQuestion="How do Base, Upside, and Downside differ versus the same plan?"
      >
        <DataTable
          rows={scenarioComparison.map((r) => ({ ...r, id: r.scenario }))}
          rowKey={(r) => r.scenario}
          searchable={false}
          columns={[
            {
              key: 'scenario',
              header: 'Scenario',
              render: (r) => (
                <span className={r.scenario === scenario ? 'font-semibold text-forest' : undefined}>
                  {r.scenario}
                  {r.scenario === scenario ? ' · selected' : ''}
                </span>
              ),
              sortValue: (r) => r.scenario,
            },
            {
              key: 'fc',
              header: 'Forecast Revenue',
              align: 'right',
              render: (r) => formatCurrency(r.forecastRevenue, true),
              sortValue: (r) => r.forecastRevenue,
            },
            {
              key: 'tgt',
              header: 'Revenue Target',
              align: 'right',
              render: (r) =>
                r.revenueTarget > 0 ? formatCurrency(r.revenueTarget, true) : 'N/A',
              sortValue: (r) => r.revenueTarget,
            },
            {
              key: 'gap',
              header: 'Gap to Target',
              align: 'right',
              render: (r) =>
                r.revenueTarget > 0
                  ? `${r.gapToTarget >= 0 ? '+' : ''}${formatCurrency(r.gapToTarget, true)}`
                  : 'N/A',
              sortValue: (r) => r.gapToTarget,
            },
            {
              key: 'att',
              header: 'Target Attainment %',
              align: 'right',
              render: (r) =>
                r.targetAttainmentPct == null ? 'N/A' : formatPercent(r.targetAttainmentPct),
              sortValue: (r) => r.targetAttainmentPct ?? -1,
            },
            {
              key: 'cm',
              header: 'Forecast CM %',
              align: 'right',
              render: (r) =>
                r.forecastCmPct == null ? 'N/A' : formatPercent(r.forecastCmPct),
              sortValue: (r) => r.forecastCmPct ?? -1,
            },
            {
              key: 'rar',
              header: 'Revenue at Risk',
              align: 'right',
              render: (r) => formatCurrency(r.revenueAtRisk, true),
              sortValue: (r) => r.revenueAtRisk,
            },
          ]}
        />
      </ChartCard>

      {(showGap || showOutlook) && (
      <ChartCard
        icon="actions"
        title="What Would Close the Gap?"
        subtitle={`Selected scenario: ${scenario} · Independent levers — do not sum`}
        businessQuestion="What volume, price, or pipeline moves would close Forecast vs Target?"
      >
        {gapClosure.onOrAboveTarget ? (
          <p className="text-sm text-ink">
            Selected scenario is on or above target for this horizon — no shortfall to close (
            gap {formatCurrency(overview.forecastGap, true)}).
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink">
              Shortfall vs Target: <strong>{formatCurrency(gapClosure.shortfall, true)}</strong>
              {gapClosure.avgRevenuePerShipment != null && (
                <span className="text-ink-muted">
                  {' '}
                  · Avg Existing $/shipment {formatCurrencyPrecise(gapClosure.avgRevenuePerShipment)} · Forward
                  Existing volume {Math.round(gapClosure.forecastVolume).toLocaleString()} pkgs
                </span>
              )}
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Mini
                label="Shipment Volume Needed"
                value={
                  gapClosure.volumeNeeded == null
                    ? 'N/A'
                    : `+${Math.round(gapClosure.volumeNeeded).toLocaleString()} pkgs`
                }
                tip={
                  gapClosure.volumeLiftPct == null
                    ? 'Insufficient volume basis'
                    : `≈ ${formatPercent(gapClosure.volumeLiftPct)} lift on Existing volume`
                }
              />
              <Mini
                label="Avg $/Shipment Lift"
                value={
                  gapClosure.rateLiftAbsolute == null
                    ? 'N/A'
                    : `+${formatCurrencyPrecise(gapClosure.rateLiftAbsolute)}`
                }
                tip={
                  gapClosure.rateLiftPct == null
                    ? undefined
                    : `≈ ${formatPercent(gapClosure.rateLiftPct)} on current avg rate`
                }
              />
              <Mini
                label="Incremental New Customer Rev"
                value={
                  gapClosure.incrementalNewCustomerRevenue == null
                    ? 'N/A'
                    : formatCurrency(gapClosure.incrementalNewCustomerRevenue, true)
                }
                tip={`After current Pipeline ${formatCurrency(overview.pipelineForecast, true)}`}
              />
              <Mini
                label="Scenario Revenue Exposure (protect)"
                value={formatCurrency(overview.scenarioRevenueAtRisk, true)}
                tip="Preventing RaR keeps the gap from widening — Hypothesis"
              />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-ink-muted">
                  Expansion potential (Hypothesis)
                </p>
                {gapClosure.expansionCandidates.length === 0 ? (
                  <p className="text-xs text-ink-muted">No under-target customers in scope.</p>
                ) : (
                  <ul className="space-y-1 text-xs text-ink">
                    {gapClosure.expansionCandidates.map((c) => (
                      <li key={c.customerId}>
                        <button
                          type="button"
                          className="text-forest underline"
                          onClick={() => openCustomer360(c.customerId)}
                        >
                          {c.name}
                        </button>
                        : gap {formatCurrency(c.gapVsTarget, true)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-ink-muted">
                  Churn / RaR that may widen gap (Hypothesis)
                </p>
                {gapClosure.churnRiskWideners.length === 0 ? (
                  <p className="text-xs text-ink-muted">No Scenario Revenue Exposure rows in scope.</p>
                ) : (
                  <ul className="space-y-1 text-xs text-ink">
                    {gapClosure.churnRiskWideners.map((c) => (
                      <li key={c.customerId}>
                        <button
                          type="button"
                          className="text-forest underline"
                          onClick={() => openCustomer360(c.customerId)}
                        >
                          {c.name}
                        </button>
                        : RaR {formatCurrency(c.revenueAtRisk, true)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-ink-muted">
              {gapClosure.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        )}
      </ChartCard>
      )}

      {(showGap || showOutlook) && (
      <ChartCard
        icon="customers"
        iconTone="customer"
        title="Forecast vs Target"
        businessQuestion="Who is above or below the Synthetic Management Plan in the forward window?"
        subtitle="Existing customer forecast vs customer-level targets · Pipeline excluded from customer rows"
        insight={gapInsights ?? undefined}
      >
        <p className="mb-2 text-xs text-ink-muted">
          Portfolio forward gap: {formatCurrency(overview.forecastGap, true)}
          {overview.forecastGapPct != null ? ` (${overview.forecastGapPct >= 0 ? '+' : ''}${overview.forecastGapPct.toFixed(1)}%)` : ''}{' '}
          · Existing {formatCurrency(overview.existingForecast, true)} · Pipeline{' '}
          {formatCurrency(overview.pipelineForecast, true)}
        </p>
        <DataTable
          rows={targetGaps}
          rowKey={(r) => r.id}
          onRowClick={(r) => openCustomer360(r.id)}
          columns={[
            { key: 'n', header: 'Customer', render: (r) => r.name, sortValue: (r) => r.name },
            {
              key: 'f',
              header: 'Forecast',
              align: 'right',
              render: (r) => formatCurrency(r.forecast, true),
              sortValue: (r) => r.forecast,
            },
            {
              key: 't',
              header: 'Target',
              align: 'right',
              render: (r) => formatCurrency(r.target, true),
              sortValue: (r) => r.target,
            },
            {
              key: 'g',
              header: 'Gap',
              align: 'right',
              sortValue: (r) => r.gap,
              render: (r) => (
                <span className={r.gap >= 0 ? 'text-success' : 'text-danger'}>
                  {r.gap >= 0 ? '+' : ''}
                  {formatCurrency(r.gap, true)}
                  {r.gapPct != null ? ` (${r.gapPct >= 0 ? '+' : ''}${r.gapPct.toFixed(1)}%)` : ''}
                </span>
              ),
            },
          ]}
        />
      </ChartCard>
      )}

      <ChartCard
        icon="forecast"
        iconTone="forecast"
        title="Forecast Composition"
        subtitle="Existing + Pipeline + Adjustments = Total Forecast Revenue (forward window)"
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-4">
          <Mini label="Existing" value={formatCurrency(overview.existingForecast, true)} />
          <Mini label="Pipeline" value={formatCurrency(overview.pipelineForecast, true)} />
          <Mini label="Adjustments" value={formatCurrency(overview.adjustments, true)} />
          <Mini
            label="Total"
            value={formatCurrency(overview.forecastRevenue, true)}
            warn={!overview.compositionOk}
            tip={overview.compositionOk ? 'Composition reconciles within $0.05' : 'Composition mismatch — review driver forecast'}
          />
        </div>
        <FloatingWaterfall steps={compositionSteps} height={220} totalKeys={['existing', 'total']} />
        {overview.pipelineForecast === 0 && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950">
            New Pipeline Forecast is $0 for the forward horizon. Confirm pipeline activations overlap{' '}
            {overview.horizon.forecastStart} → {overview.horizon.forecastEnd}.
          </div>
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ChartCard
            icon="customers"
            iconTone="customer"
            title="Revenue Risk & Growth"
            businessQuestion="Where is scenario revenue at risk, and where is healthy upside to target?"
            subtitle="Top 15 customers by scenario revenue at risk · forward Existing forecast"
          >
            <DataTable
              rows={riskRows}
              rowKey={(r) => r.customerId}
              onRowClick={(r) => openCustomer360(r.customerId)}
              columns={[
                { key: 'n', header: 'Customer', render: (r) => r.customerName },
                {
                  key: 'fr',
                  header: 'Forecast Rev',
                  align: 'right',
                  render: (r) => formatCurrency(r.forecastRevenue, true),
                  sortValue: (r) => r.forecastRevenue,
                },
                {
                  key: 'rar',
                  header: 'RaR',
                  align: 'right',
                  render: (r) => formatCurrency(r.revenueAtRisk, true),
                  sortValue: (r) => r.revenueAtRisk,
                },
                { key: 'd', header: 'Main Driver', render: (r) => r.mainDriver },
                { key: 'c', header: 'Confidence', render: (r) => r.confidence },
                { key: 'h', header: 'Health', render: (r) => `${r.healthBand} (${r.healthScore})` },
              ]}
            />
            {growthOpportunities.length > 0 ? (
              <ul className="mt-3 list-disc pl-5 text-xs text-ink-muted">
                {growthOpportunities.map((g) => (
                  <li key={g.id}>
                    {g.name}: +{formatCurrency(g.gap, true)} vs target ({g.healthBand}) — upside from target gap,
                    not incremental pipeline.
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-ink-muted">
                No rule-based growth opportunities: need positive target gap and Healthy/Stable health band.
              </p>
            )}
          </ChartCard>
        </div>
      </div>

      {(showScenarios || showOutlook) && (
      <>
      <ChartCard
        icon="scenario"
        iconTone="forecast"
        title="Scenario Drivers"
        subtitle="Adjust parameters — forward KPIs and charts update live. Formula: Vol × Rate + Surcharges − Credits"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Slider
            label="Volume Growth"
            value={scenarioParams.volumeGrowth}
            min={-0.2}
            max={0.2}
            step={0.01}
            format={(v) => formatPercent(v * 100)}
            onChange={(v) => setScenarioParams({ ...scenarioParams, volumeGrowth: v })}
          />
          <Slider
            label="Avg Rate Change"
            value={scenarioParams.avgRateChange}
            min={-0.1}
            max={0.1}
            step={0.01}
            format={(v) => formatPercent(v * 100)}
            onChange={(v) => setScenarioParams({ ...scenarioParams, avgRateChange: v })}
          />
          <Slider
            label="Customer Churn"
            value={scenarioParams.churnRate}
            min={0}
            max={0.15}
            step={0.005}
            format={(v) => formatPercent(v * 100)}
            onChange={(v) => setScenarioParams({ ...scenarioParams, churnRate: v })}
          />
          <Slider
            label="Surcharge Rate"
            value={scenarioParams.surchargeRate}
            min={0.05}
            max={0.2}
            step={0.005}
            format={(v) => formatPercent(v * 100)}
            onChange={(v) => setScenarioParams({ ...scenarioParams, surchargeRate: v })}
          />
          <Slider
            label="Credit Rate"
            value={scenarioParams.creditRate}
            min={0.01}
            max={0.1}
            step={0.005}
            format={(v) => formatPercent(v * 100)}
            onChange={(v) => setScenarioParams({ ...scenarioParams, creditRate: v })}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-[13px] text-ink-muted font-mono">{formulas.driver}</p>
          <button
            type="button"
            className="rounded-md border border-[#dce6df] px-2 py-1 text-[13px]"
            onClick={() => setScenarioParams(DEFAULT_SCENARIO_PARAMS[scenario])}
          >
            Reset Scenario Drivers
          </button>
          <span className="text-xs text-ink-muted">
            Historical Actual series is never overwritten by scenario sliders.
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border border-[#dce6df] bg-white px-2 py-1 text-xs"
            onClick={() =>
              applyWhatIf({ volumeGrowth: scenarioParams.volumeGrowth + 0.08 })
            }
          >
            What-if: Volume +8%
          </button>
          <button
            type="button"
            className="rounded-md border border-[#dce6df] bg-white px-2 py-1 text-xs"
            onClick={() =>
              applyWhatIf({ avgRateChange: scenarioParams.avgRateChange + 0.03 })
            }
          >
            What-if: Rate +3%
          </button>
          <button
            type="button"
            className="rounded-md border border-[#dce6df] bg-white px-2 py-1 text-xs"
            onClick={() =>
              applyWhatIf({ churnRate: Math.max(0, scenarioParams.churnRate - 0.02) })
            }
          >
            What-if: Churn −2pp
          </button>
          <span className="self-center text-xs text-ink-muted">
            What-if Scenario — not validated causal effect
          </span>
        </div>
      </ChartCard>

      <ChartCard
        icon="scenario"
        iconTone="forecast"
        title="Scenario Comparison"
        businessQuestion="How wide is the range between Downside and Upside assumptions?"
        subtitle={`Shaded band = Downside → Upside scenario assumptions (not a statistical confidence interval) · grain: ${
          seriesMode === 'existing' ? 'Existing' : seriesMode === 'pipeline' ? 'Pipeline' : 'Total Business'
        } · ${scenario} uses live sliders · global filter window`}
        action={
          <select
            className="filter-input"
            value={seriesMode}
            onChange={(e) => setSeriesMode(e.target.value as typeof seriesMode)}
          >
            <option value="existing">Existing Customer Forecast</option>
            <option value="pipeline">Pipeline Forecast</option>
            <option value="total">Total Business Forecast</option>
          </select>
        }
      >
        <div className="mb-2 grid grid-cols-3 gap-2 text-[13px]">
          {SCENARIOS.map((sc) => {
            const r = scenarioRuns[sc]
            const val = seriesMode === 'existing' ? r.existingRevenue : seriesMode === 'pipeline' ? r.pipelineRevenue : r.totalExpected
            return (
              <button
                key={sc}
                type="button"
                onClick={() => setScenario(sc)}
                className={`rounded-lg border px-2 py-1.5 text-left ${
                  scenario === sc ? 'border-forest bg-brand-50' : 'border-[#dce6df] bg-white hover:border-brand-300'
                }`}
              >
                <p className="text-xs font-semibold uppercase text-ink-muted">{sc}</p>
                <p className="font-mono font-semibold">{formatCurrency(val, true)}</p>
              </button>
            )
          })}
        </div>
        {scenarioData.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-xs text-ink-muted">
            No forecast rows in the selected window — extend the To period into the forecast horizon.
          </p>
        ) : (
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={scenarioData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(v, name) =>
                    Array.isArray(v)
                      ? [`${formatCurrencyPrecise(Number(v[0]))} – ${formatCurrencyPrecise(Number(v[1]))}`, String(name)]
                      : [formatCurrencyPrecise(Number(v)), String(name)]
                  }
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area isAnimationActive={false} type="monotone" dataKey="range" name="Downside–Upside range (assumption)" fill={PALETTE.forecast} fillOpacity={0.12} stroke="none" />
                <Line isAnimationActive={false} type="monotone" dataKey="upside" name="Upside" stroke={PALETTE.forecastLight} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                <Line isAnimationActive={false} type="monotone" dataKey="base" name="Base" stroke={PALETTE.forecast} strokeWidth={2} dot={false} />
                <Line isAnimationActive={false} type="monotone" dataKey="downside" name="Downside" stroke={PALETTE.forecastLight} strokeWidth={1.5} strokeDasharray="2 3" dot={false} />
                {seriesMode === 'existing' && isComparable && (
                  <Line isAnimationActive={false} type="monotone" dataKey="actual" name="Actual Recognized" stroke="#123C35" strokeWidth={2.5} dot={false} connectNulls={false} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>
      </>
      )}

      {(showOutlook) && (
      <Collapsible
        title="Forward Commission Expense (estimate)"
        subtitle="Existing Forecast Net Billing × plan revenue_rate — separate from COGS; do not double-subtract in Profitability"
        defaultOpen={false}
      >
        <p className="mb-2 text-xs text-ink-muted">
          Incremental sales-comp cost view only. Not included in Contribution Margin. Synthetic plan rates.
        </p>
        {commissionExpenseFc.length === 0 ? (
          <p className="text-sm text-ink-muted">Not Available — no forward Existing forecast rows in scope.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="text-ink-muted">
                  <th className="py-1 pr-4">Period</th>
                  <th className="py-1 pr-4">Forecast Net Billing</th>
                  <th className="py-1 pr-4">Est. Commission</th>
                  <th className="py-1">Rate</th>
                </tr>
              </thead>
              <tbody>
                {commissionExpenseFc.map((r) => (
                  <tr key={r.period} className="border-t border-[#e1e9e4]">
                    <td className="py-1.5 pr-4 font-mono">{r.period}</td>
                    <td className="py-1.5 pr-4 font-mono">{formatCurrency(r.forecastEligibleProxy, true)}</td>
                    <td className="py-1.5 pr-4 font-mono">{formatCurrency(r.estimatedCommission, true)}</td>
                    <td className="py-1.5 font-mono">{(r.rateUsed * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button
          type="button"
          className="mt-2 text-xs text-forest underline"
          onClick={() => navigateWithContext('/sales-compensation')}
        >
          Open Sales Compensation & Plan Simulator
        </button>
      </Collapsible>
      )}

      {(showAccuracy || showOutlook) && (
      <Collapsible
        title="Forecast Performance & Diagnostics"
        subtitle={showAccuracy ? "Historical Actual vs Forecast — primary analysis on this page" : "Historical Actual vs Forecast — secondary to forward planning"}
        defaultOpen={showAccuracy}
      >
        <div className="space-y-5 pt-2">
          {!isComparable && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-950">
              <strong>Variance & accuracy not evaluated:</strong> {fcScope.reason}
            </div>
          )}
          {isComparable && fcScope.note && <p className="text-[13px] text-ink-muted">{fcScope.note}</p>}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Stat
              label="Existing Customer Forecast"
              value={formatCurrency(forecast.existingRevenue, true)}
              hint={`Pipeline ${formatCurrency(forecast.pipelineRevenue, true)} · Total Business ${formatCurrency(forecast.totalExpected, true)} · filter window`}
            />
            <Stat
              label="Forecast Variance"
              value={variance == null ? 'N/A' : formatCurrency(variance, true)}
              hint={
                variance == null
                  ? isComparable
                    ? 'No periods with recorded actuals in range'
                    : 'Not comparable in this scope'
                  : `${variancePct == null ? '' : `${variancePct >= 0 ? '+' : ''}${variancePct.toFixed(1)}% · `}Comparable actual − Existing (${comparable.length} mo)`
              }
              tone={variance == null ? undefined : variance >= 0 ? 'good' : variancePct != null && variancePct < -5 ? 'bad' : 'warn'}
            />
            <Stat
              label="WAPE"
              value={!isComparable ? 'N/A' : formatPercent(accuracy.wape)}
              hint={`Accuracy score (internal, 100 − WAPE): ${!isComparable || forecastAccuracy == null ? 'N/A' : formatPercent(forecastAccuracy)} — not a probability`}
              tone={!isComparable || accuracy.wape == null ? undefined : accuracy.wape <= 5 ? 'good' : accuracy.wape <= 10 ? 'warn' : 'bad'}
            />
            <Stat
              label="MAE · RMSE"
              value={!isComparable || accuracy.mae == null ? 'N/A' : formatCurrency(accuracy.mae, true)}
              hint={`RMSE ${!isComparable || accuracy.rmse == null ? 'N/A' : formatCurrency(accuracy.rmse, true)} · Bias ${!isComparable || accuracy.bias == null ? 'N/A' : `${formatCurrency(accuracy.bias, true)}/mo (${accuracy.bias >= 0 ? 'under' : 'over'}-forecast)`}`}
            />
            <Stat
              label="Unexplained Residual"
              value={!isComparable ? 'N/A' : formatCurrency(residualAmt, true)}
              hint={!isComparable ? 'Not comparable' : `${formatPercent(bridge.forecast === 0 ? null : (residualAmt / Math.abs(bridge.forecast)) * 100)} of Existing forecast · not forced to zero`}
              tone={!isComparable ? undefined : residualQuality != null && residualQuality < 70 ? 'warn' : 'good'}
            />
          </div>

          <p className="rounded-lg border border-[#dce6df] bg-[#f5f8f5] px-3 py-2 text-xs text-ink-muted">
            <strong>Snapshot backtest (last 6 actual months):</strong> {snapshotBacktest.label}
            {snapshotBacktest.wape != null
              ? ` · WAPE ${formatPercent(snapshotBacktest.wape)} · MAE ${formatCurrency(snapshotBacktest.mae ?? 0, true)} · n=${snapshotBacktest.n}`
              : ` · n=${snapshotBacktest.n}`}
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              icon="forecast"
              iconTone="forecast"
              title="Actual vs Forecast Trend"
              businessQuestion="Are actuals tracking the forecast we committed to?"
              subtitle={
                seriesMode === 'existing'
                  ? isComparable
                    ? 'Actual Recognized vs Existing Customer Forecast (same customer scope)'
                    : 'Actual hidden — not comparable in this scope'
                  : seriesMode === 'pipeline'
                    ? 'Pipeline = new-logo revenue only — no comparable actual series'
                    : 'Total Business = Existing + Pipeline · actuals are not tagged new vs existing, so no comparable actual is plotted'
              }
              action={
                <select
                  className="filter-input"
                  value={seriesMode}
                  onChange={(e) => setSeriesMode(e.target.value as typeof seriesMode)}
                >
                  <option value="existing">Existing Customer Forecast</option>
                  <option value="pipeline">Pipeline Forecast</option>
                  <option value="total">Total Business Forecast</option>
                </select>
              }
            >
              <div className="mb-2 flex flex-wrap gap-2 text-[13px]">
                <span className="rounded bg-[#f5f8f5] px-2 py-1">
                  {seriesMode === 'existing' && isComparable
                    ? `WAPE ${formatPercent(accuracy.wape)} · Bias ${formatCurrency(accuracy.bias ?? 0, true)}/mo`
                    : 'Accuracy: N/A for this grain'}
                </span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v) => formatCurrencyPrecise(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {seriesMode === 'existing' && isComparable && (
                      <Line isAnimationActive={false} type="monotone" dataKey="actual" name="Actual Recognized" stroke={PALETTE.brand} strokeWidth={2.5} dot={false} />
                    )}
                    {seriesMode === 'existing' && (
                      <Line isAnimationActive={false} type="monotone" dataKey="existing" name="Existing Forecast" stroke={PALETTE.forecast} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                    )}
                    {seriesMode === 'pipeline' && (
                      <Line isAnimationActive={false} type="monotone" dataKey="pipeline" name="Pipeline Forecast" stroke={PALETTE.forecastLight} strokeWidth={2} strokeDasharray="4 4" dot={false} />
                    )}
                    {seriesMode === 'total' && (
                      <Line isAnimationActive={false} type="monotone" dataKey="forecast" name="Total Business Forecast" stroke={PALETTE.forecast} strokeWidth={2} dot={false} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard
              icon="accuracy"
              iconTone="forecast"
              title="Forecast Error by Month"
              insight={accuracyInsight}
              formula={`${formulas.wape} · ${formulas.mae} · ${formulas.rmse} · ${formulas.bias}`}
              businessQuestion="How far off is the forecast, and is it biased?"
              subtitle={`Months with an Existing forecast only (${accuracy.points.length}) · safe denominators`}
            >
              {!isComparable ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-xs text-ink-muted">{fcScope.reason}</p>
              ) : (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={accuracy.points} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} vertical={false} />
                      <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${Number(v) < 0 ? '−' : ''}$${(Math.abs(Number(v)) / 1000).toFixed(1)}k`} />
                      <ReferenceLine y={0} stroke="#9bb0a8" />
                      <Tooltip formatter={(v) => [formatCurrencyPrecise(Number(v)), 'Actual − Forecast']} />
                      <Bar isAnimationActive={false} dataKey="error" name="Actual − Forecast" radius={[4, 4, 0, 0]}>
                        {accuracy.points.map((pt) => (
                          <Cell key={pt.period} fill={pt.error >= 0 ? PALETTE.forecast : PALETTE.forecastLight} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <p className="mt-2 text-xs text-ink-muted">
                Total Business accuracy is not computed: actuals are not tagged as existing vs new-logo, so there is no comparable actual.
              </p>
            </ChartCard>
          </div>

          <ChartCard
            icon="customers"
            iconTone="customer"
            title="Forecast Variance by Customer"
            businessQuestion="Which customers drive the miss or beat vs Existing forecast?"
            subtitle="Comparable actual − Existing forecast · ranked by |variance| · click → Customer 360"
          >
            {!isComparable ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-xs text-ink-muted">{fcScope.reason}</p>
            ) : (
              <DataTable
                rows={byCustomer.slice(0, 10)}
                rowKey={(r) => r.id}
                onRowClick={(r) => openCustomer360(r.id)}
                columns={[
                  { key: 'n', header: 'Customer', render: (r) => r.name },
                  { key: 'a', header: 'Actual', align: 'right', render: (r) => formatCurrency(r.actual, true), sortValue: (r) => r.actual },
                  { key: 'f', header: 'Fcst', align: 'right', render: (r) => (r.hasForecast ? formatCurrency(r.forecast, true) : 'No fcst') },
                  {
                    key: 'v',
                    header: 'Var',
                    align: 'right',
                    sortValue: (r) => r.variance,
                    render: (r) => (
                      <span className={r.variance >= 0 ? 'text-success' : 'text-danger'}>
                        {r.variance >= 0 ? '+' : ''}
                        {formatCurrency(r.variance, true)}
                        {r.variancePct != null ? ` (${r.variancePct >= 0 ? '+' : ''}${r.variancePct.toFixed(1)}%)` : ''}
                      </span>
                    ),
                  },
                ]}
              />
            )}
            <p className="mt-2 text-xs text-ink-muted">
              By Service / By Metro: <strong>N/A</strong> — forecasts are stored at customer × period grain only;
              allocating them by actual mix would fabricate a forecast.
            </p>
          </ChartCard>

          <ChartCard
            icon="forecast"
            iconTone="forecast"
            title="Forecast Variance Decomposition"
            emphasis
            insight={decompInsight}
            subtitle="Forecast + Volume + Price + Mix + Credits + Unexplained Residual = Comparable Actual"
            businessQuestion="How much of the variance do known drivers explain?"
            formula="Σ impacts must equal Actual − Forecast within $0.05"
            source="computeVarianceBridge"
            timeBasis={`${filters.startPeriod} → ${filters.endPeriod}`}
          >
            {!isComparable ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-xs text-ink-muted">{fcScope.reason}</p>
            ) : (
              <>
                <BridgeAttribution
                  summary={summarizeSteps(bridge.items, ['forecast', 'actual'])}
                  forecastBase={bridge.forecast}
                  note={bridge.attributionNote}
                />
                <FloatingWaterfall
                  steps={bridge.items.map((i) =>
                    i.key === 'other'
                      ? { ...i, label: 'Unexplained Residual', shortLabel: 'Residual' }
                      : i,
                  )}
                  height={260}
                  totalKeys={['forecast', 'actual']}
                  summaryMode="footing"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="text-ink-muted">Investigate by:</span>
                  {(['customer', 'month'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setInvestigateBy(d)}
                      className={`rounded-md px-2 py-0.5 ${investigateBy === d ? 'bg-forest text-white' : 'border border-[#dce6df]'}`}
                    >
                      {d === 'customer' ? 'Customer' : 'Month'}
                    </button>
                  ))}
                  <span className="text-xs text-ink-muted">Service / Metro not supported — forecast has no such grain.</span>
                </div>
                {investigateBy === 'month' ? (
                  <DataTable
                    rows={accuracy.points.map((p) => ({ ...p, id: p.period }))}
                    rowKey={(r) => r.period}
                    columns={[
                      { key: 'p', header: 'Month', render: (r) => r.period },
                      { key: 'a', header: 'Actual', align: 'right', render: (r) => formatCurrencyPrecise(r.actual) },
                      { key: 'f', header: 'Existing Fcst', align: 'right', render: (r) => formatCurrencyPrecise(r.forecast) },
                      { key: 'e', header: 'Variance', align: 'right', render: (r) => formatCurrencyPrecise(r.error), sortValue: (r) => r.error },
                    ]}
                  />
                ) : (
                  <DataTable
                    rows={byCustomer.slice(0, 10)}
                    rowKey={(r) => r.id}
                    onRowClick={(r) => openCustomer360(r.id)}
                    columns={[
                      { key: 'n', header: 'Customer', render: (r) => r.name },
                      { key: 'a', header: 'Actual', align: 'right', render: (r) => formatCurrencyPrecise(r.actual) },
                      { key: 'f', header: 'Existing Fcst', align: 'right', render: (r) => formatCurrencyPrecise(r.forecast) },
                      { key: 'v', header: 'Variance', align: 'right', render: (r) => formatCurrencyPrecise(r.variance), sortValue: (r) => r.variance },
                    ]}
                  />
                )}
                <Collapsible title="Bridge components" subtitle="Signed amounts">
                  <DataTable
                    rows={bridge.items.filter((i) => i.key !== 'forecast' && i.key !== 'actual').map((i) => ({ ...i, id: i.key }))}
                    rowKey={(r) => r.key}
                    onRowClick={(r) =>
                      openEntityDrawer({
                        entityType: 'kpi',
                        entityId: 'forecast_variance_existing',
                        label: r.label,
                        actions: [
                          {
                            label: 'Open customer intelligence',
                            onClick: () =>
                              highlightCustomerId
                                ? openCustomer360(highlightCustomerId)
                                : navigateWithContext('/customers', { sourcePage: '/forecasting' }),
                          },
                        ],
                      })
                    }
                    columns={[
                      { key: 'label', header: 'Component', render: (r) => r.label },
                      {
                        key: 'amt',
                        header: 'Impact',
                        align: 'right',
                        render: (r) => formatCurrencyPrecise(r.amount),
                        sortValue: (r) => r.amount,
                      },
                    ]}
                  />
                </Collapsible>
                <p className="mt-2 text-xs text-ink-muted">
                  Check: Σ impacts {formatCurrencyPrecise(bridge.checkSum)} vs gap{' '}
                  {formatCurrencyPrecise(bridge.actual - bridge.forecast)}
                  {Math.abs(bridge.checkSum - (bridge.actual - bridge.forecast)) < 0.05
                    ? ' · ✓ reconciled'
                    : ' · ⚠ Data Quality Warning'}
                </p>
                {(() => {
                  const other = bridge.items.find((i) => i.key === 'other')
                  if (!other || Math.abs(other.amount) < 1) return null
                  const share =
                    bridge.forecast === 0 ? null : (Math.abs(other.amount) / Math.abs(bridge.forecast)) * 100
                  return (
                    <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-950">
                      <strong>Unexplained Forecast Residual (Other Adjustments):</strong>{' '}
                      {formatCurrencyPrecise(other.amount)}
                      {share != null ? ` (${share.toFixed(1)}% of Existing Forecast)` : ''}. Includes activation
                      timing, recognition cut-off, unmodeled fees, and recon differences — not forced to zero.
                    </p>
                  )
                })()}
                <p className="mt-2 text-[13px] text-ink-muted">
                  Scope: bridge compares <strong>Actual Recognized</strong> to <strong>Existing Customer Forecast</strong>{' '}
                  only. Pipeline is excluded from this bridge by design.
                </p>
              </>
            )}
          </ChartCard>
        </div>
      </Collapsible>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'good' | 'warn' | 'bad'
}) {
  return <StatTile label={label} value={value} hint={hint} tone={tone} />
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <label className="text-xs">
      <span className="flex justify-between font-medium text-ink">
        <span>{label}</span>
        <span className="font-mono text-brand-800">{format(value)}</span>
      </span>
      <input
        type="range"
        className="mt-2 w-full accent-brand-700"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function Mini({ label, value, tip, warn }: { label: string; value: string; tip?: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 ${warn ? 'border-amber-200 bg-amber-50' : 'border-[#dce6df] bg-white'}`}>
      <p className="flex items-center text-xs font-semibold uppercase text-ink-muted">
        {label}
        {tip && <InfoTip text={tip} />}
      </p>
      <p className="font-mono text-sm font-semibold text-ink">{value}</p>
    </div>
  )
}
