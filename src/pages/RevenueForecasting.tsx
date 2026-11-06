import { useMemo } from 'react'
import {
  CartesianGrid,
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
import { computeVarianceBridge } from '@/calc/varianceBridge'
import { FloatingWaterfall } from '@/components/charts/FloatingWaterfall'
import { ChartCard } from '@/components/common/ChartCard'
import { DataTable } from '@/components/common/DataTable'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { formatCurrency, formatCurrencyPrecise, formatPercent } from '@/lib/money'

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
  } = useApp()

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Revenue Forecasting</h2>
          <p className="text-xs text-ink-muted">
            Driver-based forecast: Existing Customer + New Pipeline (no double-count of activated accounts).
          </p>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="A. Existing Customer Forecast" value={formatCurrency(forecast.existingRevenue, true)} />
        <Stat label="B. New Pipeline Forecast" value={formatCurrency(forecast.pipelineRevenue, true)} />
        <Stat label="C. Total Expected Revenue" value={formatCurrency(forecast.totalExpected, true)} />
      </div>
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
          <p className="text-[11px] text-ink-muted font-mono">{formulas.driver}</p>
          <button
            type="button"
            className="rounded-md border border-[#dce6df] px-2 py-1 text-[11px]"
            onClick={() => setScenarioParams(DEFAULT_SCENARIO_PARAMS[scenario])}
          >
            Reset Scenario Drivers
          </button>
          <span className="text-[10px] text-ink-muted">
            Historical Actual series is never overwritten by scenario sliders.
          </span>
        </div>
      </ChartCard>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Actual vs Forecast" subtitle="Existing-customer forecast evaluation on historical periods">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Legend />
                <Line type="monotone" dataKey="actual" name="Actual" stroke="#0d9488" strokeWidth={2} />
                <Line type="monotone" dataKey="forecast" name="Forecast Total" stroke="#2563eb" strokeWidth={2} />
                <Line type="monotone" dataKey="pipeline" name="Pipeline" stroke="#d97706" strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Forecast Accuracy" subtitle="Safe denominators — no Infinity/NaN when actuals are zero">
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <Acc label="MAE" value={accuracy.mae != null ? formatCurrencyPrecise(accuracy.mae) : '—'} formula={formulas.mae} />
            <Acc label="RMSE" value={accuracy.rmse != null ? formatCurrencyPrecise(accuracy.rmse) : '—'} formula={formulas.rmse} />
            <Acc label="WAPE" value={formatPercent(accuracy.wape)} formula={formulas.wape} />
            <Acc
              label="Forecast Bias"
              value={accuracy.bias != null ? formatCurrencyPrecise(accuracy.bias) : '—'}
              formula={formulas.bias}
            />
          </dl>
        </ChartCard>
      </div>

      <ChartCard
        title="Forecast Variance Decomposition"
        subtitle="Volume + Price + Mix + Credits + Other = Actual − Forecast"
        businessQuestion="Does the bridge reconcile to Actual − Forecast?"
        formula="Σ impacts must equal Actual − Forecast within $0.05"
        source="computeVarianceBridge"
        timeBasis={`${filters.startPeriod} → ${filters.endPeriod}`}
      >
        <FloatingWaterfall steps={bridge.items} height={260} />
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
                    navigateWithContext('/customers', {
                      customerId: highlightCustomerId,
                      highlightCustomerId,
                    }),
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
        <p className="mt-2 text-[11px] text-ink-muted">
          Scope: bridge compares <strong>Actual Recognized</strong> to <strong>Existing Customer Forecast</strong>{' '}
          only. Pipeline is excluded from this bridge by design.
        </p>
      </ChartCard>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold text-ink">{value}</p>
    </div>
  )
}

function Acc({ label, value, formula }: { label: string; value: string; formula: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <dt className="font-semibold text-ink">{label}</dt>
      <dd className="mt-1 font-mono text-lg">{value}</dd>
      <dd className="mt-1 font-mono text-[10px] text-ink-muted">{formula}</dd>
    </div>
  )
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
