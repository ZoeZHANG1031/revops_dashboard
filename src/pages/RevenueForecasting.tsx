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
import { forecastComparability } from '@/calc/forecastScope'
import { computeRecognizedRevenue } from '@/calc/recognizedRevenue'
import { PageHeader } from '@/components/common/PageHeader'
import { InfoTip } from '@/components/common/StatusIndicator'
import { PALETTE } from '@/lib/icons'
import { computeVarianceBridge } from '@/calc/varianceBridge'
import { FloatingWaterfall } from '@/components/charts/FloatingWaterfall'
import { StatTile } from '@/components/common/StatTile'
import { ChartCard } from '@/components/common/ChartCard'
import { Collapsible } from '@/components/common/Collapsible'
import { DataTable } from '@/components/common/DataTable'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { formatCurrency, formatCurrencyPrecise, formatPercent } from '@/lib/money'

const SCENARIOS = ['Base', 'Upside', 'Downside'] as const

export function RevenueForecasting() {
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
  const [investigateBy, setInvestigateBy] = useState<'customer' | 'month'>('customer')

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
  const [seriesMode, setSeriesMode] = useState<'existing' | 'pipeline' | 'total'>('existing')

  // Scenario comparison — stored default assumptions per scenario; active scenario uses live sliders
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

  // Comparable scope: customer-grain forecast periods only; dimensional filters → not comparable
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

  return (
    <div className="space-y-5">
      <PageHeader
        path="/forecasting"
        scope={`Total Business = Existing Customer + New Pipeline · ${scenario}`}
        actions={
          <>
          {(['Base', 'Upside', 'Downside'] as const).map((s) => (
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
            onClick={() =>
              exportToCsv(
                'forecast_results.csv',
                forecast.byPeriod.map((p) => ({ scenario, ...p, ...scenarioParams })),
              )
            }
          >
            Export Forecast
          </button>
          </>
        }
      />
      {!isComparable && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-950">
          <strong>Variance & accuracy not evaluated:</strong> {fcScope.reason}
        </div>
      )}
      {isComparable && fcScope.note && <p className="text-[13px] text-ink-muted">{fcScope.note}</p>}

      {/* Level 1 — accuracy and residual first */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label="Existing Customer Forecast"
          value={formatCurrency(forecast.existingRevenue, true)}
          hint={`Pipeline ${formatCurrency(forecast.pipelineRevenue, true)} · Total Business ${formatCurrency(forecast.totalExpected, true)}`}
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
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <span className="font-semibold text-ink">Methods</span>
        <span className="inline-flex items-center">Existing = run-rate driver<InfoTip text="Deterministic: prior-month volume × rate per customer, adjusted by scenario multipliers." /></span>
        <span className="inline-flex items-center">Pipeline = weighted CRM<InfoTip text="Open opportunities × win probability + new-logo activations; customer_id is null so no double count." /></span>
        <span className="inline-flex items-center">Scenarios = assumptions<InfoTip text="Base / Upside / Downside multipliers — not probabilities, not confidence intervals." /></span>
        <span className="inline-flex items-center">Statistical forecast: N/A<InfoTip text="No statistically fitted model or validated confidence interval exists in this dataset." /></span>
      </p>
      {forecast.pipelineRevenue === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950">
          New Pipeline Forecast is $0 for the current filter window. Extend the <strong>To</strong> period into
          the forward horizon (e.g. include months after last actuals) or ensure the selected range overlaps
          pipeline activation months. Pipeline is stored separately from Existing to avoid double-counting.
        </div>
      )}
      {forecast.pipelineRevenue > 0 && (
        <p className="text-xs text-ink-muted">
          Pipeline includes weighted open opportunities + synthetic new-logo activation ramp for the selected
          periods — never merged into Existing customer IDs.
        </p>
      )}

      <ChartCard
        icon="scenario"
        iconTone="forecast"
        title="Scenario Drivers"
        subtitle="Adjust parameters — KPIs and charts update live. Formula: Vol × Rate + Surcharges − Credits"
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
      </ChartCard>

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
                  <Tooltip
                    formatter={(v) => [formatCurrencyPrecise(Number(v)), 'Actual − Forecast']}
                  />
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

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ChartCard
            icon="scenario"
            iconTone="forecast"
            title="Scenario Comparison"
            businessQuestion="How wide is the range between Downside and Upside assumptions?"
            subtitle={`Shaded band = Downside → Upside scenario assumptions (not a statistical confidence interval) · grain: ${
              seriesMode === 'existing' ? 'Existing' : seriesMode === 'pipeline' ? 'Pipeline' : 'Total Business'
            } · ${scenario} uses live sliders`}
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
        </div>
        <div className="lg:col-span-2">
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
        </div>
      </div>

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
        {(() => {
          const other = bridge.items.find((i) => i.key === 'other')?.amount ?? 0
          const comps = bridge.items.filter((i) => i.key !== 'forecast' && i.key !== 'actual')
          const known = comps.filter((i) => i.key !== 'other').reduce((a, i) => a + i.amount, 0)
          const absAll = comps.reduce((a, i) => a + Math.abs(i.amount), 0)
          const quality = absAll === 0 ? null : 100 - (Math.abs(other) / absAll) * 100
          return (
            <div className="mb-2 grid gap-2 text-[13px] sm:grid-cols-4">
              <Mini label="Unexplained residual" value={formatCurrencyPrecise(other)} warn={quality != null && quality < 70} />
              <Mini label="Residual ÷ forecast" value={formatPercent(bridge.forecast === 0 ? null : (other / Math.abs(bridge.forecast)) * 100)} />
              <Mini label="Known driver contribution" value={formatCurrencyPrecise(known)} />
              <Mini
                label="Attribution quality"
                value={quality == null ? 'N/A' : formatPercent(quality)}
                tip="100 − |residual| ÷ Σ|components|. Measures how well drivers explain the gap — separate from forecast accuracy."
                warn={quality != null && quality < 70}
              />
            </div>
          )
        })()}
        <FloatingWaterfall steps={bridge.items.map((i) => (i.key === 'other' ? { ...i, label: 'Unexplained Residual' } : i))} height={260} />
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
