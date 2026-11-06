import { useMemo } from 'react'
import { computeSharedMetrics } from '@/calc/metricRegistry'
import { computeUnitEconomics } from '@/calc/unitEconomics'
import { ChartCard } from '@/components/common/ChartCard'
import { DataTable } from '@/components/common/DataTable'
import { PageHeader } from '@/components/common/PageHeader'
import { ModuleSubNav } from '@/components/layout/ModuleSubNav'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { ACTION_NAV } from '@/lib/icons'
import { formatCurrency, formatPercent } from '@/lib/money'

/**
 * Ad-hoc Analysis — reuses global filters + shared calcs; no parallel metric engine.
 */
export function AdHocAnalysis() {
  const { data, filters, scenario, navigateWithContext, openCustomer360 } = useApp()
  const m = useMemo(() => computeSharedMetrics(data, filters, scenario), [data, filters, scenario])
  const byCust = useMemo(
    () => computeUnitEconomics(data, filters, 'customer', 'Base').byDimension,
    [data, filters],
  )

  return (
    <div className="space-y-5">
      <ModuleSubNav items={ACTION_NAV} />
      <PageHeader
        path="/adhoc"
        scope={`${filters.startPeriod} → ${filters.endPeriod} · Uses global filters · same metric registry`}
        actions={
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
            onClick={() =>
              exportToCsv(
                'adhoc_customer_margin.csv',
                byCust.map((r) => ({
                  key: r.key,
                  label: r.label,
                  net: r.revenue,
                  contribution: r.revenue - r.variableCost,
                  cm: r.margin,
                  period: `${filters.startPeriod}_${filters.endPeriod}`,
                  disclaimer: 'Synthetic',
                })),
              )
            }
          >
            Export Customer Cut
          </button>
        }
      />

      <p className="rounded-lg border border-[#dce6df] bg-[#f7faf8] px-3 py-2 text-xs text-ink-muted">
        Adjust <strong>Global Filters</strong> (date, customer, region, metro, service) to reshape this view.
        Metrics match Portfolio / Profitability under the same filters — no separate calculation path.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Mini label="Net Billing" value={formatCurrency(m.netBilledRevenue, true)} />
        <Mini label="Recognized" value={formatCurrency(m.recognizedRevenue, true)} />
        <Mini label="Cash" value={formatCurrency(m.cashCollections, true)} />
        <Mini
          label="CM %"
          value={m.contributionMargin == null ? 'N/A' : formatPercent(m.contributionMargin)}
        />
      </div>

      <ChartCard
        icon="dataQuality"
        title="Customer contribution cut"
        subtitle="Unit economics by customer under current filters · click → Customer 360"
      >
        <DataTable
          rows={byCust.map((r) => ({ ...r, id: r.key }))}
          rowKey={(r) => r.key}
          onRowClick={(r) => openCustomer360(r.key)}
          columns={[
            {
              key: 'l',
              header: 'Customer',
              render: (r) => r.label,
              sortValue: (r) => r.label,
              searchValue: (r) => r.label,
            },
            {
              key: 'n',
              header: 'Net Billing',
              align: 'right',
              render: (r) => formatCurrency(r.revenue, true),
              sortValue: (r) => r.revenue,
            },
            {
              key: 'c',
              header: 'Contribution',
              align: 'right',
              render: (r) => formatCurrency(r.revenue - r.variableCost, true),
              sortValue: (r) => r.revenue - r.variableCost,
            },
            {
              key: 'cm',
              header: 'CM %',
              align: 'right',
              render: (r) => formatPercent(r.margin),
              sortValue: (r) => r.margin ?? -999,
            },
          ]}
        />
      </ChartCard>

      <div className="flex flex-wrap gap-3 text-xs">
        <button type="button" className="text-forest underline" onClick={() => navigateWithContext('/customers')}>
          Customer Portfolio
        </button>
        <button
          type="button"
          className="text-forest underline"
          onClick={() => navigateWithContext('/profitability/customer')}
        >
          Customer Profitability
        </button>
        <button type="button" className="text-forest underline" onClick={() => navigateWithContext('/forecasting')}>
          Revenue Forecast
        </button>
      </div>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#dce6df] bg-white px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase text-ink-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</div>
    </div>
  )
}
