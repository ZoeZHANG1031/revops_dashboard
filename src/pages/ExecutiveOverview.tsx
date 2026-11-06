import { useMemo, useState } from 'react'
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
import { rollupExceptionsByRootCause } from '@/calc/actionRollup'
import { buildExecutiveInsight } from '@/calc/executiveInsight'
import { monthlyRevenueSeries } from '@/calc/kpis'
import {
  computeDeliveryPerformanceImpact,
  computeGeographicProfitability,
  computeShipmentToRevenueFlow,
} from '@/calc/logistics'
import { computeSharedMetrics } from '@/calc/metricRegistry'
import { computeVarianceBridge } from '@/calc/varianceBridge'
import { FloatingWaterfall } from '@/components/charts/FloatingWaterfall'
import { ChartCard } from '@/components/common/ChartCard'
import { Collapsible } from '@/components/common/Collapsible'
import { DataTable } from '@/components/common/DataTable'
import { KpiCard } from '@/components/common/KpiCard'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { formatCurrency, formatCurrencyPrecise, formatNumber, formatPercent } from '@/lib/money'

export function ExecutiveOverview() {
  const { data, filters, scenario, navigateWithContext, openEntityDrawer, navigateToEntity } = useApp()
  const [bridgeGroup, setBridgeGroup] = useState<'total' | 'customer' | 'region' | 'service' | 'month'>(
    'total',
  )
  const [geoDim, setGeoDim] = useState<'metro' | 'zone' | 'service'>('metro')
  const [expandedCause, setExpandedCause] = useState<string | null>(null)

  const kpiActions = (kpiId: string, path: string, extras: Parameters<typeof navigateWithContext>[1] = {}) => [
    {
      label: 'View Breakdown',
      onClick: () => navigateWithContext(path, extras),
    },
    {
      label: 'Trace Source',
      onClick: () =>
        openEntityDrawer({
          entityType: 'kpi',
          entityId: kpiId,
          label: kpiId,
          actions: [
            {
              label: 'Open related page',
              onClick: () => navigateWithContext(path, extras),
            },
          ],
        }),
    },
    {
      label: 'Investigate Exceptions',
      onClick: () =>
        navigateWithContext('/reconciliation', {
          exceptionType: extras?.exceptionType ?? null,
          exceptionStatus: 'Open',
        }),
    },
  ]

  const m = useMemo(() => computeSharedMetrics(data, filters, scenario), [data, filters, scenario])
  const insight = useMemo(() => buildExecutiveInsight(data, filters, scenario), [data, filters, scenario])
  const series = useMemo(() => monthlyRevenueSeries(data, filters), [data, filters])
  const bridge = useMemo(
    () => computeVarianceBridge(data, filters, scenario, bridgeGroup),
    [data, filters, scenario, bridgeGroup],
  )
  const rollups = useMemo(() => rollupExceptionsByRootCause(data, filters), [data, filters])
  const delivery = useMemo(() => computeDeliveryPerformanceImpact(data, filters), [data, filters])
  const geo = useMemo(
    () => computeGeographicProfitability(data, filters, geoDim),
    [data, filters, geoDim],
  )
  const flow = useMemo(() => computeShipmentToRevenueFlow(data, filters), [data, filters])
  const expanded = rollups.find((r) => r.rootCauseKey === expandedCause)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-600">
            Revenue Intelligence Platform · Independent Synthetic Demo
          </p>
          <h2 className="text-lg font-semibold text-ink">Executive Revenue Command Center</h2>
        </div>
        <button
          type="button"
          className="rounded-lg bg-forest px-3 py-1.5 text-xs font-medium text-white hover:bg-forest-muted"
          onClick={() =>
            exportToCsv('revenue_summary.csv', [
              {
                ...m,
                start: filters.startPeriod,
                end: filters.endPeriod,
                scenario,
              },
            ])
          }
        >
          Export Summary
        </button>
      </div>

      {/* Compact Executive Decision Brief */}
      <section className="insight-hero px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-lime">
              Executive Decision Brief
            </p>
            <h3 className="mt-0.5 text-base font-semibold leading-snug text-white">{insight.headline}</h3>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              insight.severity === 'critical'
                ? 'bg-red-500/20 text-red-100'
                : insight.severity === 'watch'
                  ? 'bg-amber-400/20 text-amber-100'
                  : 'bg-lime/20 text-lime'
            }`}
          >
            {insight.severity.toUpperCase()}
          </span>
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          {insight.signals.map((s) => (
            <p key={s} className="rounded-lg bg-black/15 px-2.5 py-1.5 text-[11px] text-white/90">
              {s}
            </p>
          ))}
        </div>
        <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-lime-soft list-decimal pl-4">
          {insight.recommendedActions.map((a) => (
            <li key={a} className="max-w-md">
              {a}
            </li>
          ))}
        </ol>
      </section>

      {/* Primary KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          kpiId="recognized_revenue"
          value={m.recognizedRevenue}
          size="primary"
          actions={kpiActions('recognized_revenue', '/lifecycle')}
          scopeNote="Recognition accounting_period"
        />
        <KpiCard
          kpiId="contribution_margin"
          value={m.contributionMargin ?? 0}
          format="percent"
          size="primary"
          levelThresholds={{ good: 28, warn: 22 }}
          actions={kpiActions('contribution_margin', '/unit-economics')}
        />
        <KpiCard
          kpiId="open_recoverable_leakage"
          value={m.openRecoverableLeakage}
          size="primary"
          polarity="lower_better"
          levelThresholds={{ good: 500, warn: 2000 }}
          actions={kpiActions('open_recoverable_leakage', '/reconciliation', {
            exceptionStatus: 'Open',
          })}
          scopeNote="Open / Investigating recoverable types only"
        />
        <KpiCard
          kpiId="forecast_variance_existing"
          value={m.forecastVarianceExisting}
          size="primary"
          actions={kpiActions('forecast_variance_existing', '/forecasting')}
          scopeNote="Existing customers — not Total Business Forecast"
        />
        <KpiCard
          kpiId="overdue_ar"
          value={m.overdueAr}
          size="primary"
          polarity="lower_better"
          levelThresholds={{ good: 1000, warn: 5000 }}
          actions={kpiActions('overdue_ar', '/reconciliation', { exceptionType: 'Overdue AR' })}
          scopeNote="Collections exposure ≠ booked revenue loss"
        />
        <KpiCard
          kpiId="contribution_profit"
          value={m.contributionProfit}
          size="primary"
          actions={kpiActions('contribution_profit', '/unit-economics')}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          kpiId="net_billed_revenue"
          value={m.netBilledRevenue}
          actions={kpiActions('net_billed_revenue', '/reconciliation')}
        />
        <KpiCard
          kpiId="unbilled_exposure"
          value={m.unbilledExposure}
          polarity="lower_better"
          levelThresholds={{ good: 500, warn: 3000 }}
          actions={kpiActions('unbilled_exposure', '/reconciliation', {
            exceptionType: 'Missing Billing',
            exceptionStatus: 'Open',
          })}
        />
        <KpiCard
          kpiId="scenario_revenue_at_risk"
          value={m.scenarioRevenueAtRisk}
          polarity="lower_better"
          actions={kpiActions('scenario_revenue_at_risk', '/customers')}
          scopeNote="Scenario assumption — not calibrated churn"
        />
        <KpiCard
          kpiId="cash_collections"
          value={m.cashCollections}
          actions={kpiActions('cash_collections', '/reconciliation')}
          scopeNote="Cash ≠ recognized revenue"
        />
        <KpiCard
          kpiId="billing_accuracy"
          value={m.billingAccuracy ?? 0}
          format="percent"
          levelThresholds={{ good: 98, warn: 95 }}
          actions={kpiActions('billing_accuracy', '/reconciliation')}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-4 text-[11px]">
        <Chip label="Bookings TCV" value={formatCurrency(m.bookingsTcv, true)} note="≠ revenue" />
        <Chip label="Existing Forecast" value={formatCurrency(m.forecastExisting, true)} note="backtest anchor" />
        <Chip label="Pipeline Forecast" value={formatCurrency(m.forecastPipeline, true)} note="not in Actual" />
        <Chip label="Total Business Forecast" value={formatCurrency(m.forecastTotal, true)} note="Existing+Pipeline" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="Actual Recognized vs Existing Customer Forecast"
          businessQuestion="Are we tracking the Existing plan (not Total Business Forecast)?"
          formula="Recognized header vs Existing forecast_recognized"
          source="fact_revenue_recognition, fact_forecast (Existing)"
          timeBasis={`${filters.startPeriod} → ${filters.endPeriod}`}
        >
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Legend />
                <Line type="monotone" dataKey="recognized" name="Actual Recognized" stroke="#123C35" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="forecast" name="Existing Forecast" stroke="#E58A2B" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                <Line type="monotone" dataKey="billed" name="Net Billings" stroke="#00A86B" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="Revenue Variance Bridge (vs Existing Forecast)"
          subtitle={`Σ ${formatCurrencyPrecise(bridge.checkSum)} = Actual − Existing Forecast ${formatCurrencyPrecise(bridge.actual - bridge.forecast)}`}
          businessQuestion="What drove beat/miss vs Existing plan?"
          formula="Volume+Price+Mix+Credits+Other = Actual−Existing Forecast"
          source="computeVarianceBridge"
          timeBasis={`${filters.startPeriod} → ${filters.endPeriod}`}
          action={
            <select
              className="filter-input"
              value={bridgeGroup}
              onChange={(e) => setBridgeGroup(e.target.value as typeof bridgeGroup)}
            >
              <option value="total">Company</option>
              <option value="customer">By Customer</option>
              <option value="region">By Region</option>
              <option value="service">By Service</option>
              <option value="month">By Month</option>
            </select>
          }
        >
          <FloatingWaterfall steps={bridge.items} height={240} />
        </ChartCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <ChartCard title="Delivery → Revenue Impact" businessQuestion="How do failures hit credits, claims, retention?">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Mini label="OTD" value={formatPercent(delivery.otdRate)} />
            <Mini label="First Attempt" value={formatPercent(delivery.firstAttemptSuccess)} />
            <Mini label="Failed" value={formatPercent(delivery.failedDeliveryRate)} warn />
            <Mini label="Claims Cost" value={formatCurrency(delivery.claimsCost, true)} warn />
          </div>
          <ul className="mt-2 list-disc pl-4 text-[11px] text-ink-muted">
            {delivery.explanation.slice(0, 3).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </ChartCard>
        <ChartCard title="Shipment → Revenue Flow" businessQuestion="Physical vs commercial drop-offs?">
          <ol className="space-y-1 text-xs">
            {flow.stages.map((s) => (
              <li key={s.key} className="flex justify-between rounded bg-[#f5f8f5] px-2 py-1">
                <span>
                  {s.label} <span className="text-[10px] text-ink-muted">{s.kind}</span>
                </span>
                <span className="font-mono">{formatNumber(s.count)}</span>
              </li>
            ))}
          </ol>
        </ChartCard>
        <ChartCard
          title="Geographic Profitability"
          action={
            <select className="filter-input" value={geoDim} onChange={(e) => setGeoDim(e.target.value as typeof geoDim)}>
              <option value="metro">Metro</option>
              <option value="zone">Zone</option>
              <option value="service">Service</option>
            </select>
          }
        >
          <DataTable
            rows={geo.slice(0, 6).map((g) => ({ ...g, id: g.key }))}
            rowKey={(r) => r.key}
            onRowClick={(r) =>
              navigateWithContext('/unit-economics', {
                region: geoDim === 'service' ? null : r.label.includes(' ') ? null : r.label,
              })
            }
            columns={[
              { key: 'l', header: geoDim, render: (r) => r.label },
              { key: 'rev', header: 'Rev', align: 'right', render: (r) => formatCurrency(r.revenue, true) },
              { key: 'cm', header: 'CM%', align: 'right', render: (r) => formatPercent(r.contributionMargin) },
            ]}
          />
        </ChartCard>
      </div>

      {/* Action Center — root cause rollup */}
      <ChartCard
        title="Action Center — by Root Cause"
        subtitle="Priority = actionability × open exposure × severity × age. Overdue AR ≠ booked revenue loss. Duplicates ≠ recoverable revenue."
        businessQuestion="What should Billing / Finance / Sales do this week?"
        action={
          <button
            type="button"
            className="text-xs text-brand-700"
            onClick={() => exportToCsv('action_rollup.csv', rollups.map(({ exceptions, ...r }) => r))}
          >
            Export
          </button>
        }
      >
        <DataTable
          rows={rollups.map((r) => ({ ...r, id: r.rootCauseKey }))}
          rowKey={(r) => r.rootCauseKey}
          onRowClick={(r) => setExpandedCause(expandedCause === r.rootCauseKey ? null : r.rootCauseKey)}
          columns={[
            { key: 'type', header: 'Root Cause / Type', render: (r) => r.exceptionType },
            { key: 'cases', header: 'Cases', align: 'right', render: (r) => formatNumber(r.cases), sortValue: (r) => r.cases },
            {
              key: 'open',
              header: 'Open Exposure',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.openExposure),
              sortValue: (r) => r.openExposure,
            },
            {
              key: 'rec',
              header: 'Recoverable',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.recoverable),
              sortValue: (r) => r.recoverable,
            },
            { key: 'sev', header: 'Severity', render: (r) => r.severity },
            { key: 'owner', header: 'Owner', render: (r) => r.owner },
            { key: 'age', header: 'Avg Age (d)', align: 'right', render: (r) => String(r.avgAgeDays) },
            { key: 'act', header: 'Action', render: (r) => r.action },
          ]}
        />
        {expanded && (
          <div className="mt-3 rounded-lg border border-[#dce6df] bg-[#f5f8f5] p-3">
            <p className="text-xs font-semibold text-ink">
              {expanded.exceptionType} detail · {expanded.recoverability}
            </p>
            <DataTable
              rows={expanded.exceptions.slice(0, 25).map((e) => ({ ...e, id: e.exception_id }))}
              rowKey={(r) => r.exception_id}
              onRowClick={(r) => {
                navigateToEntity('exception', r.exception_id, r.exception_type)
                navigateWithContext('/reconciliation', {
                  exceptionType: r.exception_type,
                  exceptionStatus: r.status,
                  customerId: r.customer_id,
                  openEntity: {
                    entityType: 'exception',
                    entityId: r.exception_id,
                    label: r.exception_type,
                  },
                })
              }}
              columns={[
                { key: 'id', header: 'Exception', render: (r) => r.exception_id },
                { key: 'cust', header: 'Customer', render: (r) => r.customer_id ?? '—' },
                { key: 'ship', header: 'Shipment', render: (r) => r.shipment_id ?? '—' },
                {
                  key: 'imp',
                  header: 'Impact',
                  align: 'right',
                  render: (r) => formatCurrencyPrecise(r.financial_impact),
                },
                { key: 'st', header: 'Status', render: (r) => r.status },
                { key: 'rule', header: 'Trigger', render: (r) => <span className="font-mono text-[10px]">{r.trigger_rule}</span> },
              ]}
            />
          </div>
        )}
      </ChartCard>

      <Collapsible title="Exposure definition legend" subtitle="Why Action Center ≠ Unbilled ≠ Scenario RaR">
        <ul className="space-y-1 text-xs text-ink-muted">
          <li>
            <strong className="text-ink">Open Recoverable Leakage:</strong> Missing Billing / Rate Mismatch /
            Missing Surcharge still Open or Investigating.
          </li>
          <li>
            <strong className="text-ink">Unbilled Exposure:</strong> Missing-billing expected amounts (may include
            resolved depending on filter exceptions list) — see metric registry.
          </li>
          <li>
            <strong className="text-ink">Scenario Revenue at Risk:</strong> Forward revenue × assumed loss from
            health bands — not confirmed loss / not churn model.
          </li>
          <li>
            <strong className="text-ink">Overdue AR:</strong> Collections exposure only.
          </li>
        </ul>
      </Collapsible>
    </div>
  )
}

function Chip({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card-surface px-3 py-2">
      <p className="text-[10px] font-semibold uppercase text-ink-muted">{label}</p>
      <p className="font-mono text-sm font-semibold">{value}</p>
      <p className="text-[10px] text-ink-muted">{note}</p>
    </div>
  )
}

function Mini({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-[#f5f8f5] px-2 py-1.5">
      <p className="text-[10px] text-ink-muted">{label}</p>
      <p className={`font-mono text-sm font-semibold ${warn ? 'text-warning' : ''}`}>{value}</p>
    </div>
  )
}
