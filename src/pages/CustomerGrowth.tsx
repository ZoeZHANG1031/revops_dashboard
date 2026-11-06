import { useMemo } from 'react'
import {
  computeCustomerTargetGaps,
  computeForwardOverview,
  resolveForwardHorizon,
} from '@/calc/forwardForecast'
import { computeCustomerHealth } from '@/calc/customerHealth'
import { DEFAULT_SCENARIO_PARAMS } from '@/calc/forecast'
import { ChartCard } from '@/components/common/ChartCard'
import { DataTable } from '@/components/common/DataTable'
import { PageHeader } from '@/components/common/PageHeader'
import { ModuleSubNav } from '@/components/layout/ModuleSubNav'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { CUSTOMER_NAV } from '@/lib/icons'
import { formatCurrency, formatPercent } from '@/lib/money'

/** Growth Opportunities — Hypothesis ranking from target gaps + health. */
export function CustomerGrowth() {
  const { data, filters, scenario, scenarioParams, healthWeights, openCustomer360 } = useApp()
  const horizon = useMemo(() => resolveForwardHorizon(data, 3), [data])
  const { overview } = useMemo(
    () =>
      computeForwardOverview(
        data,
        filters,
        scenario,
        scenario === 'Base' ? scenarioParams : DEFAULT_SCENARIO_PARAMS[scenario],
        3,
      ),
    [data, filters, scenario, scenarioParams],
  )
  const gaps = useMemo(
    () =>
      computeCustomerTargetGaps(
        data,
        filters,
        scenario,
        scenario === 'Base' ? scenarioParams : DEFAULT_SCENARIO_PARAMS[scenario],
        horizon,
      ),
    [data, filters, scenario, scenarioParams, horizon],
  )
  const health = useMemo(
    () => new Map(computeCustomerHealth(data, filters, healthWeights).map((h) => [h.customerId, h])),
    [data, filters, healthWeights],
  )

  const opportunities = useMemo(() => {
    return gaps
      .map((g) => {
        const h = health.get(g.id)
        return {
          ...g,
          healthBand: h?.healthBand ?? '—',
          healthScore: h?.healthScore ?? null,
          hypothesis:
            g.gap > 0
              ? 'Above target — defend / expand further (Hypothesis)'
              : 'Below target — volume or pricing recovery (Hypothesis)',
        }
      })
      .filter((g) => g.healthBand === 'Healthy' || g.healthBand === 'Watchlist' || g.gap > 0)
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
      .slice(0, 40)
  }, [gaps, health])

  return (
    <div className="space-y-5">
      <ModuleSubNav items={CUSTOMER_NAV} />
      <PageHeader
        path="/customers/growth"
        scope={`${overview.horizon.label} · ${scenario} · Opportunities are Hypothesis rankings`}
        actions={
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
            onClick={() =>
              exportToCsv(
                'growth_opportunities.csv',
                opportunities.map((o) => ({
                  customer: o.name,
                  forecast: o.forecast,
                  target: o.target,
                  gap: o.gap,
                  health: o.healthBand,
                  note: o.hypothesis,
                  disclaimer: 'Synthetic · Hypothesis',
                })),
              )
            }
          >
            Export
          </button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Mini label="Forward Forecast" value={formatCurrency(overview.forecastRevenue, true)} />
        <Mini label="Revenue Target" value={formatCurrency(overview.revenueTarget, true)} />
        <Mini
          label="Portfolio Gap"
          value={`${overview.forecastGap >= 0 ? '+' : ''}${formatCurrency(overview.forecastGap, true)}`}
        />
      </div>

      <ChartCard
        icon="customers"
        iconTone="customer"
        title="Growth & Expansion Candidates"
        subtitle="Target gap × health band · not a causal guarantee of incremental bookings"
        businessQuestion="Where can existing accounts grow or recover toward plan?"
      >
        <DataTable
          rows={opportunities}
          rowKey={(r) => r.id}
          onRowClick={(r) => openCustomer360(r.id)}
          columns={[
            {
              key: 'n',
              header: 'Customer',
              render: (r) => r.name,
              sortValue: (r) => r.name,
              searchValue: (r) => r.name,
            },
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
              render: (r) => (
                <span className={r.gap >= 0 ? 'text-success' : 'text-danger'}>
                  {r.gap >= 0 ? '+' : ''}
                  {formatCurrency(r.gap, true)}
                  {r.gapPct != null ? ` (${formatPercent(r.gapPct)})` : ''}
                </span>
              ),
              sortValue: (r) => r.gap,
            },
            {
              key: 'h',
              header: 'Health',
              render: (r) => `${r.healthBand}${r.healthScore != null ? ` (${r.healthScore})` : ''}`,
            },
            { key: 'note', header: 'Opportunity type', render: (r) => r.hypothesis },
          ]}
        />
      </ChartCard>
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
