import { useMemo } from 'react'
import { computeCustomerHealth } from '@/calc/customerHealth'
import { ChartCard } from '@/components/common/ChartCard'
import { DataTable } from '@/components/common/DataTable'
import { PageHeader } from '@/components/common/PageHeader'
import { ModuleSubNav } from '@/components/layout/ModuleSubNav'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { CUSTOMER_NAV } from '@/lib/icons'
import { formatCurrency, formatPercent } from '@/lib/money'

/** Risk & Retention — rule-based health, not a validated churn probability. */
export function CustomerRiskRetention() {
  const { data, filters, healthWeights, openCustomer360, navigateWithContext } = useApp()
  const rows = useMemo(() => {
    return computeCustomerHealth(data, filters, healthWeights)
      .filter((h) => h.healthBand === 'At Risk' || h.healthBand === 'Critical' || h.healthScore < 60)
      .sort((a, b) => a.healthScore - b.healthScore || b.scenarioRevenueAtRisk - a.scenarioRevenueAtRisk)
  }, [data, filters, healthWeights])

  return (
    <div className="space-y-5">
      <ModuleSubNav items={CUSTOMER_NAV} />
      <PageHeader
        path="/customers/risk"
        scope={`${filters.startPeriod} → ${filters.endPeriod} · Rule-based Health Score ≠ churn probability`}
        actions={
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
            onClick={() =>
              exportToCsv(
                'customer_risk.csv',
                rows.map((r) => ({
                  customer: r.customerName,
                  health: r.healthScore,
                  band: r.healthBand,
                  rev_growth: r.revenueGrowth,
                  cm: r.contributionMargin,
                  rar: r.scenarioRevenueAtRisk,
                  drivers: r.drivers.join('; '),
                  disclaimer: 'Synthetic · rule score',
                })),
              )
            }
          >
            Export
          </button>
        }
      />

      <p className="rounded-lg border border-[#dce6df] bg-[#f7faf8] px-3 py-2 text-xs text-ink-muted">
        Health Score is a weighted rule model (see Customer 360 breakdown). It is <strong>not</strong> a
        validated ML churn probability. Scenario Revenue at Risk is exposure under a band stress factor — not booked
        loss.
      </p>

      <ChartCard
        icon="risk"
        iconTone="risk"
        title="At-Risk & Critical Customers"
        subtitle="Sorted by health score · click → Customer 360 Risk Drivers"
        businessQuestion="Which accounts need retention attention first?"
      >
        <DataTable
          rows={rows.map((r) => ({ ...r, id: r.customerId }))}
          rowKey={(r) => r.customerId}
          onRowClick={(r) => openCustomer360(r.customerId)}
          columns={[
            {
              key: 'n',
              header: 'Customer',
              render: (r) => r.customerName,
              sortValue: (r) => r.customerName,
              searchValue: (r) => r.customerName,
            },
            {
              key: 'h',
              header: 'Health',
              align: 'right',
              render: (r) => `${r.healthScore} · ${r.healthBand}`,
              sortValue: (r) => r.healthScore,
            },
            {
              key: 'g',
              header: 'Rev Growth',
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
              key: 'rar',
              header: 'Scenario Revenue Exposure',
              align: 'right',
              render: (r) => formatCurrency(r.scenarioRevenueAtRisk, true),
              sortValue: (r) => r.scenarioRevenueAtRisk,
            },
            {
              key: 'd',
              header: 'Drivers',
              render: (r) => r.drivers.slice(0, 3).join(', ') || '—',
            },
          ]}
        />
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <button type="button" className="text-forest underline" onClick={() => navigateWithContext('/actions')}>
            Open Action Center
          </button>
          <button
            type="button"
            className="text-forest underline"
            onClick={() => navigateWithContext('/forecasting/gap')}
          >
            Revenue Gap Analysis
          </button>
        </div>
      </ChartCard>
    </div>
  )
}
