import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { computeCustomerHealth } from '@/calc/customerHealth'
import { ChartCard } from '@/components/common/ChartCard'
import { DataTable } from '@/components/common/DataTable'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { formatCurrency, formatCurrencyPrecise, formatNumber, formatPercent } from '@/lib/money'

export function CustomerIntelligence() {
  const {
    data,
    filters,
    healthWeights,
    setHealthWeights,
    pushDrill,
    navigateToEntity,
    navigateWithContext,
    highlightCustomerId,
    setHighlightCustomerId,
  } = useApp()
  const [selectedId, setSelectedId] = useState<string | null>(highlightCustomerId)

  const rows = useMemo(
    () => computeCustomerHealth(data, filters, healthWeights),
    [data, filters, healthWeights],
  )
  const selected = rows.find((r) => r.customerId === (selectedId ?? highlightCustomerId)) ?? null

  const selectCustomer = (customerId: string, customerName: string) => {
    setSelectedId(customerId)
    setHighlightCustomerId(customerId)
    pushDrill({ level: 'customer', id: customerId, label: customerName })
    navigateToEntity('customer', customerId, customerName)
  }

  const normalizedWeights = useMemo(() => {
    const sum =
      healthWeights.volumeTrend +
      healthWeights.deliveryPerformance +
      healthWeights.profitability +
      healthWeights.paymentBehavior +
      healthWeights.customerIssues
    return sum
  }, [healthWeights])

  const detail = useMemo(() => {
    if (!selected) return null
    const cust = data.customers.find((c) => c.customer_id === selected.customerId)!
    const contracts = data.contracts.filter((c) => c.customer_id === selected.customerId)
    const volumeTrend = data.dates
      .map((d) => d.date_key.slice(0, 7))
      .filter((p) => p >= filters.startPeriod && p <= filters.endPeriod)
      .map((period) => ({
        period,
        volume: data.shipments.filter(
          (s) => s.customer_id === selected.customerId && s.ship_date.startsWith(period),
        ).length,
        revenue: data.billingLines
          .filter(
            (b) =>
              b.customer_id === selected.customerId &&
              b.accounting_period === period &&
              !b.is_duplicate,
          )
          .reduce((a, b) => a + b.net_amount, 0),
      }))
    const exceptions = data.exceptions.filter((e) => e.customer_id === selected.customerId)
    const payments = data.payments.filter((p) => p.customer_id === selected.customerId)
    const forecasts = data.forecasts.filter(
      (f) => f.customer_id === selected.customerId && f.scenario === 'Base' && f.forecast_type === 'Existing',
    )
    return { cust, contracts, volumeTrend, exceptions, payments, forecasts }
  }, [selected, data, filters])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Customer Intelligence</h2>
          <p className="text-xs text-ink-muted">
            Value, health, and revenue-at-risk. Loss probabilities are labeled scenario assumptions — not
            calibrated churn models.
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
          onClick={() => exportToCsv('customer_performance.csv', rows.map((r) => ({ ...r })))}
        >
          Export Customer Performance
        </button>
      </div>

      <ChartCard
        title="Health Score Weights"
        subtitle="Initial business assumptions — not validated against historical churn outcomes. Missing metrics default to 50."
      >
        <div className="grid gap-3 sm:grid-cols-5">
          {(
            [
              ['volumeTrend', 'Volume Trend 30%'],
              ['deliveryPerformance', 'Delivery 25%'],
              ['profitability', 'Profitability 20%'],
              ['paymentBehavior', 'Payment 15%'],
              ['customerIssues', 'Issues 10%'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="text-xs">
              <span className="flex justify-between font-medium">
                <span>{label.split(' ')[0]}</span>
                <span className="font-mono">{Math.round(healthWeights[key] * 100)}%</span>
              </span>
              <input
                type="range"
                min={0.05}
                max={0.5}
                step={0.01}
                value={healthWeights[key]}
                className="mt-2 w-full accent-brand-700"
                onChange={(e) => {
                  const next = { ...healthWeights, [key]: Number(e.target.value) }
                  const sum =
                    next.volumeTrend +
                    next.deliveryPerformance +
                    next.profitability +
                    next.paymentBehavior +
                    next.customerIssues
                  setHealthWeights({
                    volumeTrend: next.volumeTrend / sum,
                    deliveryPerformance: next.deliveryPerformance / sum,
                    profitability: next.profitability / sum,
                    paymentBehavior: next.paymentBehavior / sum,
                    customerIssues: next.customerIssues / sum,
                  })
                }}
              />
            </label>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-muted">
          Weights auto-normalize to 100% on change. Raw slider sum ≈ {Math.round(normalizedWeights * 100)}%.
        </p>
      </ChartCard>

      <div className="grid gap-3 lg:grid-cols-3">
        <ChartCard
          title="Customer Risk Matrix"
          subtitle="Bubble = revenue; X = health; Y = margin"
          businessQuestion="Which accounts combine low health with weak margin?"
          formula="Health 0–100 (weighted); CM% from net billing − variable cost"
          source="computeCustomerHealth"
        >
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                <XAxis type="number" dataKey="healthScore" name="Health" domain={[0, 100]} tick={{ fontSize: 10 }} />
                <YAxis
                  type="number"
                  dataKey="contributionMargin"
                  name="CM%"
                  tick={{ fontSize: 10 }}
                  unit="%"
                />
                <ZAxis type="number" dataKey="revenue" range={[40, 280]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  formatter={(v, name) =>
                    name === 'revenue' ? formatCurrency(Number(v)) : String(v)
                  }
                  labelFormatter={(_, p) => (p?.[0]?.payload as { customerName?: string })?.customerName ?? ''}
                />
                <Scatter
                  data={rows.filter((r) => r.contributionMargin != null)}
                  fill="#00A86B"
                  onClick={(d) => {
                    const row = d as unknown as { customerId?: string; customerName?: string }
                    if (row.customerId) {
                      selectCustomer(row.customerId, row.customerName ?? row.customerId)
                    }
                  }}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard title="Health Distribution" businessQuestion="Is the portfolio polarized or clustered?">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { band: '<40', count: rows.filter((r) => r.healthScore < 40).length },
                  { band: '40-54', count: rows.filter((r) => r.healthScore >= 40 && r.healthScore < 55).length },
                  { band: '55-69', count: rows.filter((r) => r.healthScore >= 55 && r.healthScore < 70).length },
                  { band: '70-84', count: rows.filter((r) => r.healthScore >= 70 && r.healthScore < 85).length },
                  { band: '85+', count: rows.filter((r) => r.healthScore >= 85).length },
                ]}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                <XAxis dataKey="band" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#123C35" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard title="Top Revenue at Risk" subtitle="Scenario assumed loss — not booked">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[...rows].sort((a, b) => b.revenueAtRisk - a.revenueAtRisk).slice(0, 8)}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) =>
                    Math.abs(Number(v)) < 1000
                      ? `$${Math.round(Number(v))}`
                      : `$${(Number(v) / 1000).toFixed(1)}k`
                  }
                />
                <YAxis type="category" dataKey="customerName" width={100} tick={{ fontSize: 9 }} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Bar
                  dataKey="revenueAtRisk"
                  radius={[0, 4, 4, 0]}
                  onClick={(d) => {
                    const row = d as unknown as { customerId?: string; customerName?: string }
                    if (row.customerId) selectCustomer(row.customerId, row.customerName ?? row.customerId)
                  }}
                >
                  {[...rows]
                    .sort((a, b) => b.revenueAtRisk - a.revenueAtRisk)
                    .slice(0, 8)
                    .map((r) => (
                      <Cell
                        key={r.customerId}
                        fill={
                          r.customerId === (selectedId ?? highlightCustomerId)
                            ? '#123C35'
                            : r.healthScore < 55
                              ? '#C44536'
                              : '#E58A2B'
                        }
                      />
                    ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <ChartCard title="Customer Scorecard" subtitle="Click a row to open Customer 360 Detail Drawer">
        <DataTable
          rows={rows.map((r) => ({ ...r, id: r.customerId }))}
          rowKey={(r) => r.customerId}
          onRowClick={(r) => selectCustomer(r.customerId, r.customerName)}
          columns={[
            { key: 'name', header: 'Customer', render: (r) => r.customerName, sortValue: (r) => r.customerName },
            { key: 'seg', header: 'Segment', render: (r) => r.segment },
            {
              key: 'rev',
              header: 'Revenue',
              align: 'right',
              render: (r) => formatCurrency(r.revenue, true),
              sortValue: (r) => r.revenue,
            },
            {
              key: 'vol',
              header: 'Volume',
              align: 'right',
              render: (r) => formatNumber(r.volume),
              sortValue: (r) => r.volume,
            },
            {
              key: 'growth',
              header: 'Rev Growth Rate %',
              align: 'right',
              render: (r) => formatPercent(r.revenueGrowth),
              sortValue: (r) => r.revenueGrowth ?? -999,
            },
            {
              key: 'cm',
              header: 'CM %',
              align: 'right',
              render: (r) => formatPercent(r.contributionMargin),
              sortValue: (r) => r.contributionMargin ?? -999,
            },
            {
              key: 'rpp',
              header: 'Rev/Pkg',
              align: 'right',
              render: (r) => (r.revenuePerPackage != null ? formatCurrencyPrecise(r.revenuePerPackage) : '—'),
            },
            {
              key: 'del',
              header: 'Delivery',
              align: 'right',
              render: (r) => formatPercent(r.deliveryPerformance),
            },
            {
              key: 'health',
              header: 'Health / Band',
              align: 'right',
              render: (r) => (
                <span className={r.healthScore < 70 ? 'text-danger font-semibold' : ''}>
                  {r.healthScore} · {r.healthBand}
                </span>
              ),
              sortValue: (r) => r.healthScore,
            },
            {
              key: 'conf',
              header: 'Confidence',
              render: (r) => `${r.confidence} (${r.dataCompleteness}%)`,
            },
            {
              key: 'rar',
              header: 'Scenario RaR',
              align: 'right',
              render: (r) => formatCurrency(r.scenarioRevenueAtRisk, true),
              sortValue: (r) => r.scenarioRevenueAtRisk,
            },
          ]}
        />
      </ChartCard>

      {selected && detail && (
        <ChartCard
          title={`${selected.customerName} — Drill-down`}
          subtitle={`Health ${selected.healthScore} · Assumed loss ${formatPercent(selected.assumedLossProbability * 100)} (scenario)`}
          action={
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="text-xs text-brand-700"
                onClick={() =>
                  navigateWithContext('/unit-economics', {
                    customerId: selected.customerId,
                    highlightCustomerId: selected.customerId,
                  })
                }
              >
                Unit Economics
              </button>
              <button
                type="button"
                className="text-xs text-brand-700"
                onClick={() =>
                  navigateWithContext('/forecasting', {
                    customerId: selected.customerId,
                    highlightCustomerId: selected.customerId,
                  })
                }
              >
                Forecast
              </button>
              <button
                type="button"
                className="text-xs text-brand-700"
                onClick={() =>
                  navigateWithContext('/reconciliation', {
                    customerId: selected.customerId,
                    highlightCustomerId: selected.customerId,
                  })
                }
              >
                Reconciliation
              </button>
              <button type="button" className="text-xs text-ink-muted" onClick={() => setSelectedId(null)}>
                Close
              </button>
            </div>
          }
        >
          <div className="grid gap-4 lg:grid-cols-2 text-xs">
            <div>
              <p className="font-semibold text-ink">Contract</p>
              <ul className="mt-1 text-ink-muted">
                {detail.contracts.map((c) => (
                  <li key={c.contract_id}>
                    {c.contract_id} v{c.version} · {c.pricing_model} · commitment {c.volume_commitment} · terms{' '}
                    {c.payment_terms_days}d · {c.start_date}→{c.end_date}
                  </li>
                ))}
              </ul>
              <p className="mt-3 font-semibold text-ink">Health Drivers</p>
              <ul className="mt-1 list-disc pl-4 text-ink-muted">
                <li>Volume score {selected.volumeScore}</li>
                <li>Delivery score {selected.deliveryPerformance != null ? Math.round(selected.deliveryPerformance) : 50}</li>
                <li>Profit score {selected.profitScore}</li>
                <li>Payment score {selected.paymentScore}</li>
                <li>Issues score {selected.issueScore}</li>
              </ul>
              <p className="mt-3 font-semibold text-ink">Signals</p>
              <ul className="mt-1 list-disc pl-4 text-ink-muted">
                {selected.drivers.length ? selected.drivers.map((d) => <li key={d}>{d}</li>) : <li>None</li>}
              </ul>
              <p className="mt-3 font-semibold text-ink">Recommended Actions</p>
              <ul className="mt-1 list-disc pl-4 text-ink-muted">
                {selected.recommendedActions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-semibold text-ink mb-2">Volume & Revenue Trend</p>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={detail.volumeTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="period" tick={{ fontSize: 9 }} />
                    <YAxis yAxisId="l" tick={{ fontSize: 9 }} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9 }} />
                    <Tooltip />
                    <Bar yAxisId="l" dataKey="volume" fill="#93c5fd" name="Volume" />
                    <Bar yAxisId="r" dataKey="revenue" fill="#2563eb" name="Revenue" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-3 font-semibold text-ink">Billing Exceptions ({detail.exceptions.length})</p>
              <ul className="mt-1 max-h-24 overflow-auto text-ink-muted">
                {detail.exceptions.slice(0, 8).map((e) => (
                  <li key={e.exception_id}>
                    {e.exception_type}: {formatCurrencyPrecise(e.financial_impact)} · {e.status}
                  </li>
                ))}
              </ul>
              <p className="mt-3 font-semibold text-ink">Payments</p>
              <ul className="mt-1 max-h-20 overflow-auto text-ink-muted">
                {detail.payments.slice(0, 6).map((p) => (
                  <li key={p.payment_id}>
                    {p.payment_date}: {formatCurrencyPrecise(p.amount)} via {p.method}
                  </li>
                ))}
              </ul>
              <p className="mt-3 font-semibold text-ink">Forward Forecast (Base)</p>
              <ul className="mt-1 text-ink-muted">
                {detail.forecasts.slice(-3).map((f) => (
                  <li key={f.forecast_id}>
                    {f.accounting_period}: {formatCurrencyPrecise(f.forecast_recognized)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </ChartCard>
      )}
    </div>
  )
}
