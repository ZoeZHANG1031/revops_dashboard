import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { computeUnitEconomics } from '@/calc/unitEconomics'
import { ChartCard } from '@/components/common/ChartCard'
import { DataTable } from '@/components/common/DataTable'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { formatCurrency, formatCurrencyPrecise, formatNumber, formatPercent } from '@/lib/money'

export function UnitEconomics() {
  const {
    data,
    filters,
    highlightCustomerId,
    setHighlightCustomerId,
    navigateToEntity,
    openEntityDrawer,
  } = useApp()
  const [dimension, setDimension] = useState<
    'customer' | 'region' | 'service' | 'month' | 'dsp' | 'zone'
  >('customer')
  const [fixedScenario, setFixedScenario] = useState<'Base' | 'Downside'>('Base')
  const [selectedDimKey, setSelectedDimKey] = useState<string | null>(highlightCustomerId)

  const econ = useMemo(
    () => computeUnitEconomics(data, filters, dimension, fixedScenario),
    [data, filters, dimension, fixedScenario],
  )

  const trend = useMemo(() => {
    const periods = data.dates
      .map((d) => d.date_key.slice(0, 7))
      .filter((p) => p >= filters.startPeriod && p <= filters.endPeriod)
    return periods.map((period) => {
      const slice = computeUnitEconomics(
        data,
        { ...filters, startPeriod: period, endPeriod: period },
        'customer',
      )
      return {
        period,
        revenue: slice.netRevenue,
        variableCost: slice.netRevenue - slice.contributionProfit,
        contribution: slice.contributionProfit,
        rpp: slice.revenuePerPackage,
        cpp: slice.variableCostPerPackage,
      }
    })
  }, [data, filters])

  const unprofitable = econ.byDimension.filter((d) => (d.margin ?? 0) < 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Unit Economics & Profitability</h2>
          <p className="text-xs text-ink-muted">
            Explains profit per package. Claims appear in cost — not double-counted as revenue credits here
            when already netted in billing.
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
          onClick={() =>
            exportToCsv('cost_profitability.csv', [
              {
                net_revenue: econ.netRevenue,
                contribution_profit: econ.contributionProfit,
                contribution_margin: econ.contributionMargin,
                operating_profit: econ.operatingProfit,
                rpp: econ.revenuePerPackage,
                cpp: econ.variableCostPerPackage,
              },
              ...econ.byDimension,
            ])
          }
        >
          Export Cost & Profitability
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Revenue / Package" value={econ.revenuePerPackage != null ? formatCurrencyPrecise(econ.revenuePerPackage) : '—'} />
        <Stat label="Variable Cost / Package" value={econ.variableCostPerPackage != null ? formatCurrencyPrecise(econ.variableCostPerPackage) : '—'} />
        <button type="button" className="text-left" onClick={() => openEntityDrawer({ entityType: 'kpi', entityId: 'contribution_margin', label: 'Contribution Margin' })}>
          <Stat label="Contribution Profit" value={formatCurrency(econ.contributionProfit, true)} />
        </button>
        <Stat label="Contribution Margin" value={formatPercent(econ.contributionMargin)} hint="Contribution view — before fixed allocation" />
        <Stat label="Operating Profit" value={formatCurrency(econ.operatingProfit, true)} hint="Fully allocated view — not incremental customer P&L" />
        <Stat label="Billable Packages" value={formatNumber(econ.billablePackages)} />
        <Stat label="Net Revenue" value={formatCurrency(econ.netRevenue, true)} hint="Net billing basis for unit economics" />
        <Stat label="Allocated Fixed" value={formatCurrency(econ.allocatedFixed, true)} hint="Share of company fixed pool" />
      </div>

      <div
        className={`rounded-xl border px-4 py-3 text-xs ${
          econ.fixedAllocation.contributionCoversFixed
            ? 'border-brand-200 bg-brand-50 text-forest'
            : 'border-amber-200 bg-amber-50 text-amber-950'
        }`}
      >
        <p className="font-semibold">Fixed cost allocation basis</p>
        <p className="mt-1">{econ.fixedAllocation.basis}</p>
        <p className="mt-1 opacity-90">{econ.fixedAllocation.poolNote}</p>
        {!econ.fixedAllocation.contributionCoversFixed && (
          <p className="mt-2 font-medium">
            Contribution {formatCurrency(econ.contributionProfit, true)} does not cover allocated fixed{' '}
            {formatCurrency(econ.allocatedFixed, true)} in this filter — high CM can coexist with negative
            operating profit when density is thin relative to the shared pool.
          </p>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Revenue & Cost Trends">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Legend />
                <Line type="monotone" dataKey="revenue" name="Net Revenue" stroke="#2563eb" strokeWidth={2} />
                <Line type="monotone" dataKey="variableCost" name="Variable Cost" stroke="#dc2626" strokeWidth={2} />
                <Line type="monotone" dataKey="contribution" name="Contribution" stroke="#0d9488" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Cost Structure" subtitle="Per-package and total">
          <DataTable
            rows={econ.costBreakdown.map((c) => ({ ...c, id: c.type }))}
            rowKey={(r) => r.type}
            onRowClick={(r) => {
              const sample = data.costs.find((c) => c.cost_type === r.type)
              if (sample) navigateToEntity('cost', sample.cost_id, r.type)
              else
                openEntityDrawer({
                  entityType: 'kpi',
                  entityId: 'contribution_margin',
                  label: r.type,
                })
            }}
            columns={[
              { key: 'type', header: 'Cost Type', render: (r) => r.type },
              {
                key: 'amt',
                header: 'Amount',
                align: 'right',
                render: (r) => formatCurrencyPrecise(r.amount),
                sortValue: (r) => r.amount,
              },
              {
                key: 'pp',
                header: 'Per Package',
                align: 'right',
                render: (r) => (r.perPackage != null ? formatCurrencyPrecise(r.perPackage) : '—'),
              },
            ]}
          />
        </ChartCard>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-ink">Fixed cost scenario:</span>
        {(['Base', 'Downside'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFixedScenario(s)}
            className={`rounded-lg px-3 py-1.5 font-medium ${
              fixedScenario === s ? 'bg-forest text-white' : 'border border-[#dce6df] bg-white'
            }`}
          >
            {s} pool ${s === 'Base' ? data.meta.fixed_opex_pool_monthly_base : data.meta.fixed_opex_pool_monthly_downside}/mo
          </button>
        ))}
      </div>

      <ChartCard
        title={econ.volumeProfitParadox.title}
        subtitle="Title is data-driven. Contribution ≠ Operating Profit after fixed absorption."
      >
        <div className="grid gap-3 sm:grid-cols-4 text-xs mb-3">
          <div className="rounded-lg bg-[#f5f8f5] p-3">
            <p className="text-ink-muted">Volume change</p>
            <p className="font-mono text-lg font-semibold">{formatPercent(econ.volumeProfitParadox.volumeChangePct)}</p>
          </div>
          <div className="rounded-lg bg-[#f5f8f5] p-3">
            <p className="text-ink-muted">Contribution profit Δ</p>
            <p className="font-mono text-lg font-semibold">
              {formatPercent(econ.volumeProfitParadox.contributionProfitChangePct)}
            </p>
          </div>
          <div className="rounded-lg bg-[#f5f8f5] p-3">
            <p className="text-ink-muted">Operating profit Δ</p>
            <p className="font-mono text-lg font-semibold">
              {formatPercent(econ.volumeProfitParadox.operatingProfitChangePct)}
            </p>
          </div>
          <div className="rounded-lg bg-amber-50 p-3 text-amber-900">
            <p className="font-semibold">Notes</p>
            <ul className="mt-1 list-disc pl-4">
              {econ.volumeProfitParadox.explanation.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={econ.profitBridge}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={0} angle={-15} textAnchor="end" height={70} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <Bar dataKey="amount" fill="#00A86B" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 text-xs">
        <Stat label="Var Cost / Delivered" value={econ.unitCosts.costPerDelivered != null ? formatCurrencyPrecise(econ.unitCosts.costPerDelivered) : '—'} />
        <Stat label="Var Cost / Billable" value={econ.unitCosts.costPerBillable != null ? formatCurrencyPrecise(econ.unitCosts.costPerBillable) : '—'} />
        <Stat label="DSP / Package" value={econ.unitCosts.dspPerPackage != null ? formatCurrencyPrecise(econ.unitCosts.dspPerPackage) : '—'} />
        <Stat label="Claims / 1k pkgs" value={econ.unitCosts.claimsPerThousand != null ? formatCurrencyPrecise(econ.unitCosts.claimsPerThousand) : '—'} />
        <Stat label="Failed incremental cost" value={formatCurrency(econ.unitCosts.failedIncrementalCost, true)} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="Revenue vs Cost per Package"
          subtitle="Bubble size = packages"
          action={
            <select
              className="rounded-md border border-slate-200 px-2 py-1 text-xs"
              value={dimension}
              onChange={(e) => setDimension(e.target.value as typeof dimension)}
            >
              {['customer', 'region', 'service', 'month', 'dsp', 'zone'].map((d) => (
                <option key={d} value={d}>
                  By {d}
                </option>
              ))}
            </select>
          }
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  type="number"
                  dataKey="rpp"
                  name="RPP"
                  tick={{ fontSize: 10 }}
                  unit="$"
                />
                <YAxis
                  type="number"
                  dataKey="cpp"
                  name="CPP"
                  tick={{ fontSize: 10 }}
                  unit="$"
                />
                <ZAxis type="number" dataKey="packages" range={[40, 300]} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Scatter
                  data={econ.byDimension.filter((d) => d.rpp != null && d.cpp != null)}
                  fill="#2563eb"
                  onClick={(d) => {
                    const row = d as unknown as { key?: string; label?: string }
                    if (!row.key) return
                    setSelectedDimKey(row.key)
                    if (dimension === 'customer') {
                      setHighlightCustomerId(row.key)
                      navigateToEntity('customer', row.key, row.label ?? row.key)
                    }
                  }}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Contribution Margin by Dimension">
          <DataTable
            rows={econ.byDimension.slice(0, 15).map((d) => ({ ...d, id: d.key }))}
            rowKey={(r) => r.key}
            onRowClick={(r) => {
              setSelectedDimKey(r.key)
              if (dimension === 'customer') {
                setHighlightCustomerId(r.key)
                navigateToEntity('customer', r.key, r.label)
              }
            }}
            columns={[
              {
                key: 'label',
                header: 'Dimension',
                render: (r) => (
                  <span className={r.key === (selectedDimKey ?? highlightCustomerId) ? 'font-semibold text-forest' : ''}>
                    {r.label}
                  </span>
                ),
              },
              {
                key: 'rev',
                header: 'Revenue',
                align: 'right',
                render: (r) => formatCurrency(r.revenue, true),
                sortValue: (r) => r.revenue,
              },
              {
                key: 'm',
                header: 'Margin',
                align: 'right',
                render: (r) => (
                  <span className={(r.margin ?? 0) < 0 ? 'text-danger font-semibold' : ''}>
                    {formatPercent(r.margin)}
                  </span>
                ),
                sortValue: (r) => r.margin ?? -999,
              },
              {
                key: 'rpp',
                header: 'RPP',
                align: 'right',
                render: (r) => (r.rpp != null ? formatCurrencyPrecise(r.rpp) : '—'),
              },
              {
                key: 'cpp',
                header: 'CPP',
                align: 'right',
                render: (r) => (r.cpp != null ? formatCurrencyPrecise(r.cpp) : '—'),
              },
            ]}
          />
        </ChartCard>
      </div>

      <ChartCard title="Unprofitable Segments" subtitle="Negative contribution margin">
        <DataTable
          rows={unprofitable.map((d) => ({ ...d, id: d.key }))}
          rowKey={(r) => r.key}
          emptyMessage="No unprofitable segments in current filters"
          columns={[
            { key: 'label', header: 'Segment', render: (r) => r.label },
            {
              key: 'rev',
              header: 'Revenue',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.revenue),
            },
            {
              key: 'cost',
              header: 'Variable Cost',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.variableCost),
            },
            {
              key: 'm',
              header: 'Margin',
              align: 'right',
              render: (r) => formatPercent(r.margin),
            },
          ]}
        />
      </ChartCard>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold text-ink">{value}</p>
      {hint && <p className="mt-1 text-[10px] text-ink-muted">{hint}</p>}
    </div>
  )
}
