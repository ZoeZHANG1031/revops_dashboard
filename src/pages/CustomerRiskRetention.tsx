/**
 * Risk & Retention — visual-first. Rule-based Health Score, not a validated churn probability.
 * Raw Health Score, Risk Band and Override Reason are shown as separate fields.
 */
import { useMemo, useState } from 'react'
import { computeClientQualityPortfolio, type WatchlistRow } from '@/calc/clientQuality'
import { BANDS, computeHealthMigration, riskDriverDistribution } from '@/calc/portfolioVisuals'
import { ChartCard } from '@/components/common/ChartCard'
import { Collapsible } from '@/components/common/Collapsible'
import { DataTable } from '@/components/common/DataTable'
import { PageHeader } from '@/components/common/PageHeader'
import { ModuleSubNav } from '@/components/layout/ModuleSubNav'
import {
  BandBadge,
  KpiStrip,
  MigrationHeatmap,
  MigrationSummary,
  PriorityRankChart,
  RiskDriverChart,
  Toggle,
} from '@/components/revops/PortfolioVisuals'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { CUSTOMER_NAV } from '@/lib/icons'
import { formatCurrency, formatCurrencyPrecise, formatNumber, formatPercent } from '@/lib/money'

const isAtRisk = (r: WatchlistRow) => r.healthBand === 'At Risk' || r.healthBand === 'Critical'

export function CustomerRiskRetention() {
  const { data, filters, healthWeights, openCustomer360, navigateWithContext, highlightCustomerId } = useApp()
  const [exposureMetric, setExposureMetric] = useState<'revenue' | 'scenarioRevenueAtRisk'>('revenue')
  const [driverMetric, setDriverMetric] = useState<'clients' | 'revenue'>('clients')

  const cq = useMemo(() => computeClientQualityPortfolio(data, filters, healthWeights), [data, filters, healthWeights])
  const atRisk = useMemo(
    () => cq.watchlist.filter(isAtRisk).sort((a, b) => b.priorityScore - a.priorityScore),
    [cq.watchlist],
  )
  const drivers = useMemo(() => riskDriverDistribution(atRisk), [atRisk])
  const migration = useMemo(() => computeHealthMigration(cq), [cq])
  const byExposure = useMemo(
    () => [...atRisk].sort((a, b) => b[exposureMetric] - a[exposureMetric]).slice(0, 10),
    [atRisk, exposureMetric],
  )
  const top5 = atRisk.slice(0, 5)
  const rar = atRisk.reduce((a, r) => a + r.scenarioRevenueAtRisk, 0)
  const overrides = atRisk.filter((r) => r.overrideReason).length
  const topShare =
    cq.kpis.revenueExposure > 0 && byExposure[0] && exposureMetric === 'revenue'
      ? (byExposure[0].revenue / cq.kpis.revenueExposure) * 100
      : null

  const exportRows = () =>
    exportToCsv(
      'customer_risk.csv',
      atRisk.map((r) => ({
        customer_id: r.customerId,
        customer: r.customerName,
        raw_health_score: r.healthScore,
        risk_band: r.healthBand,
        override_reason: r.overrideReason ?? '',
        prior_risk_band: r.priorHealthBand ?? '',
        health_change: r.healthScoreChange,
        revenue: r.revenue,
        rev_growth_pct: r.revenueGrowth,
        cm_pct: r.contributionMargin,
        scenario_revenue_exposure: r.scenarioRevenueAtRisk,
        risk_signals: r.riskTypes.join('; '),
        next_step: r.recommendedNextStep,
        disclaimer: 'Synthetic · rule score ≠ churn probability',
      })),
    )

  return (
    <div className="space-y-5">
      <ModuleSubNav items={CUSTOMER_NAV} />
      <PageHeader
        path="/customers/risk"
        scope={`${filters.startPeriod} → ${filters.endPeriod} · rule-based Health Score ≠ churn probability`}
        actions={
          <button type="button" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium" onClick={exportRows}>
            Export
          </button>
        }
      />

      <KpiStrip
        items={[
          {
            label: 'At Risk / Critical',
            value: formatNumber(atRisk.length),
            sub: `${atRisk.filter((r) => r.healthBand === 'Critical').length} Critical · ${overrides} by override`,
            tip: 'Risk Band At Risk (score 50–69) or Critical (score < 50, or an override rule such as packages ≤ −30% YoY).',
            tone: atRisk.length ? 'risk' : 'neutral',
          },
          {
            label: 'Revenue Exposure',
            value: formatCurrency(cq.kpis.revenueExposure, true),
            sub: 'Current revenue of these clients',
            tip: cq.kpis.revenueExposureNote,
          },
          {
            label: 'Scenario Revenue at Risk',
            value: formatCurrency(rar, true),
            sub: 'Stress estimate · not expected loss',
            tip: 'Forward 3-month Base Existing forecast × band stress factor (Critical 40%, At Risk 22%). Demo assumption, not a validated churn probability.',
          },
          {
            label: 'Newly At Risk',
            value: migration.available ? formatNumber(migration.newlyAtRisk) : 'N/A',
            sub: migration.available ? `${formatCurrency(migration.newlyAtRiskRevenue, true)} · vs ${migration.priorLabel}` : 'No prior window',
            tip: 'Healthy / Watchlist in the same months prior year → At Risk / Critical now.',
            tone: migration.newlyAtRisk > 0 ? 'risk' : 'neutral',
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartCard
          title="Where is at-risk revenue concentrated?"
          subtitle={
            topShare != null
              ? `${byExposure[0].customerName} alone is ${topShare.toFixed(0)}% of at-risk revenue · top ${byExposure.length} shown`
              : `Top ${byExposure.length} At Risk / Critical clients · click a bar for Client 360`
          }
          formula="Revenue = current-window Net Billing. Scenario RaR = forward forecast × band stress factor. Bar color = Risk Band."
          action={
            <Toggle
              value={exposureMetric}
              onChange={setExposureMetric}
              options={[
                ['revenue', 'Revenue'],
                ['scenarioRevenueAtRisk', 'Scenario RaR'],
              ]}
            />
          }
        >
          {byExposure.length ? (
            <PriorityRankChart rows={byExposure} valueKey={exposureMetric} onSelect={openCustomer360} selectedId={highlightCustomerId} />
          ) : (
            <p className="py-6 text-center text-sm text-ink-muted">No At Risk / Critical clients under current filters.</p>
          )}
        </ChartCard>

        <ChartCard
          title="Which signals do at-risk clients share?"
          subtitle={`${drivers.clientsWithMultipleSignals} of ${atRisk.length} at-risk clients trigger 2+ signals — bars are not additive`}
          action={
            <Toggle
              value={driverMetric}
              onChange={setDriverMetric}
              options={[
                ['clients', 'Clients'],
                ['revenue', 'Revenue'],
              ]}
            />
          }
        >
          <RiskDriverChart
            bars={drivers.bars}
            metric={driverMetric}
            onSelect={(key) =>
              navigateWithContext('/customers', { sourcePage: '/customers/risk', customerId: null, portfolioFocus: `driver:${key}` })
            }
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ChartCard title="Top 5 at-risk clients" subtitle="Ranked by management priority · click to investigate">
          <ol className="divide-y divide-[#eef3f0]">
            {top5.map((r, i) => (
              <li key={r.customerId}>
                <button
                  type="button"
                  className="flex w-full items-start gap-3 py-2 text-left hover:bg-brand-50/40"
                  onClick={() => openCustomer360(r.customerId)}
                >
                  <span className="mt-0.5 font-mono text-xs font-semibold text-ink-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{r.customerName}</span>
                      <BandBadge band={r.healthBand} title={r.overrideReason ?? undefined} />
                      <span className="font-mono text-xs text-ink-muted">
                        {r.healthScore}
                        {r.healthScoreChange != null ? ` (${r.healthScoreChange >= 0 ? '+' : ''}${r.healthScoreChange})` : ''}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-ink-muted">
                      {formatCurrency(r.revenue, true)} · {r.riskTypes[0] ?? 'weak score, no single rule'}
                      {r.overrideReason ? ' · override' : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {top5.length === 0 && <li className="py-4 text-sm text-ink-muted">None under current filters.</li>}
          </ol>
        </ChartCard>

        <ChartCard
          title="Are clients moving into risk?"
          subtitle={migration.available ? <MigrationSummary m={migration} /> : 'No prior comparable window'}
          formula="Risk Band now vs the same model on the same months prior year, matched by customer ID."
        >
          {migration.available ? (
            <MigrationHeatmap
              migration={migration}
              onSelectCell={(c) => {
                if (c.customerIds.length === 1) openCustomer360(c.customerIds[0])
                else navigateWithContext('/customers', { sourcePage: '/customers/risk', customerId: null, portfolioFocus: 'migration' })
              }}
            />
          ) : (
            <p className="py-6 text-center text-sm text-ink-muted">Insufficient history.</p>
          )}
        </ChartCard>
      </div>

      <Collapsible title="All At Risk / Critical clients" subtitle={`${atRisk.length} rows · raw score, risk band and override reason as separate fields`}>
        <DataTable
          rows={atRisk}
          rowKey={(r) => r.customerId}
          selectedKey={highlightCustomerId}
          onRowClick={(r) => openCustomer360(r.customerId)}
          defaultPageSize={10}
          pageSizeOptions={[10, 25, 50]}
          columns={[
            { key: 'n', header: 'Customer', render: (r) => r.customerName, sortValue: (r) => r.customerName, searchValue: (r) => r.customerName },
            { key: 'h', header: 'Raw Health Score', align: 'right', render: (r) => <span className="font-mono">{r.healthScore}</span>, sortValue: (r) => r.healthScore ?? -1 },
            { key: 'b', header: 'Risk Band', render: (r) => <BandBadge band={r.healthBand} />, sortValue: (r) => BANDS.indexOf(r.healthBand) },
            {
              key: 'o',
              header: 'Override Reason',
              render: (r) => (r.overrideReason ? <span className="text-[12px]">{r.overrideReason}</span> : <span className="text-ink-muted">—</span>),
            },
            { key: 'g', header: 'Rev YoY', align: 'right', render: (r) => formatPercent(r.revenueGrowth), sortValue: (r) => r.revenueGrowth ?? -999 },
            { key: 'cm', header: 'CM %', align: 'right', render: (r) => formatPercent(r.contributionMargin), sortValue: (r) => r.contributionMargin ?? -999 },
            {
              key: 'rar',
              header: 'Scenario RaR',
              align: 'right',
              render: (r) => <span title={formatCurrencyPrecise(r.scenarioRevenueAtRisk)}>{formatCurrency(r.scenarioRevenueAtRisk, true)}</span>,
              sortValue: (r) => r.scenarioRevenueAtRisk,
            },
            { key: 'd', header: 'Signals', render: (r) => r.riskTypes.join(', ') || '—' },
          ]}
        />
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <button type="button" className="text-forest underline" onClick={() => navigateWithContext('/actions')}>
            Open Action Center
          </button>
          <button type="button" className="text-forest underline" onClick={() => navigateWithContext('/forecasting/gap')}>
            Revenue Gap Analysis
          </button>
        </div>
      </Collapsible>
    </div>
  )
}
