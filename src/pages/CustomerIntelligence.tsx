/**
 * Client Quality — three visual zones:
 *   A. Client Health × Revenue matrix   B. Risk driver distribution   C. Health migration
 * Selecting a band / driver / migration cell focuses the watchlist below (Top 10 by default).
 */
import { X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { computeClientQualityPortfolio, type WatchlistRow } from '@/calc/clientQuality'
import type { HealthBand } from '@/calc/customerHealth'
import type { CustomerRiskProfile, RiskType } from '@/calc/customerRisk'
import {
  BANDS,
  computeHealthMigration,
  riskDriverDistribution,
  riskTypeForDriver,
  RISK_DRIVERS,
  type MigrationCell,
  type RiskDriverKey,
} from '@/calc/portfolioVisuals'
import { ChartCard } from '@/components/common/ChartCard'
import { Collapsible } from '@/components/common/Collapsible'
import { DataTable } from '@/components/common/DataTable'
import { PageHeader } from '@/components/common/PageHeader'
import { ModuleSubNav } from '@/components/layout/ModuleSubNav'
import {
  BandBadge,
  HealthRevenueMatrix,
  KpiStrip,
  MigrationHeatmap,
  MigrationSummary,
  RiskDriverChart,
  Toggle,
  type BubbleSize,
} from '@/components/revops/PortfolioVisuals'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { CUSTOMER_NAV } from '@/lib/icons'
import { formatCurrency, formatCurrencyPrecise, formatNumber, formatPercent } from '@/lib/money'

type Focus =
  | { kind: 'band'; band: HealthBand }
  | { kind: 'driver'; key: RiskDriverKey }
  | { kind: 'cell'; from: string; to: string; ids: string[] }
  | { kind: 'worsened' }
  | null

function parseFocus(raw: string | null): Focus {
  if (!raw) return null
  if (raw === 'migration') return { kind: 'worsened' }
  const [kind, val] = raw.split(':')
  if (kind === 'band' && BANDS.includes(val as HealthBand)) return { kind: 'band', band: val as HealthBand }
  if (kind === 'driver' && RISK_DRIVERS.some((d) => d.key === val)) return { kind: 'driver', key: val as RiskDriverKey }
  return null
}

function focusLabel(f: Focus): string {
  if (!f) return ''
  if (f.kind === 'band') return f.band === 'At Risk' ? 'At Risk + Critical' : f.band
  if (f.kind === 'driver') return RISK_DRIVERS.find((d) => d.key === f.key)!.label
  if (f.kind === 'cell') return `${f.from} → ${f.to}`
  return 'Worsened vs prior'
}

export function CustomerIntelligence() {
  const { data, filters, healthWeights, setHealthWeights, openCustomer360, highlightCustomerId } = useApp()
  const [params] = useSearchParams()
  const [focus, setFocus] = useState<Focus>(() => parseFocus(params.get('focus')))
  const [bubble, setBubble] = useState<BubbleSize>('contributionProfit')
  const [driverMetric, setDriverMetric] = useState<'clients' | 'revenue'>('clients')
  const [migrationMetric, setMigrationMetric] = useState<'clients' | 'revenue'>('clients')
  const [columnView, setColumnView] = useState<ColumnView>('overview')

  useEffect(() => {
    const f = parseFocus(params.get('focus'))
    if (f) setFocus(f)
    if (params.get('focus') === 'migration')
      requestAnimationFrame(() => document.getElementById('cq-migration')?.scrollIntoView({ block: 'start' }))
  }, [params])

  const cq = useMemo(() => computeClientQualityPortfolio(data, filters, healthWeights), [data, filters, healthWeights])
  const rows = cq.watchlist
  const drivers = useMemo(() => riskDriverDistribution(rows), [rows])
  const migration = useMemo(() => computeHealthMigration(cq), [cq])
  const profileById = useMemo(() => new Map(cq.profiles.map((p) => [p.customerId, p])), [cq.profiles])

  const focused = useMemo(() => {
    if (!focus) return rows.filter((r) => r.priority !== 'Healthy')
    if (focus.kind === 'band')
      return rows.filter((r) =>
        focus.band === 'At Risk' ? r.healthBand === 'At Risk' || r.healthBand === 'Critical' : r.healthBand === focus.band,
      )
    if (focus.kind === 'driver') {
      const t: RiskType = riskTypeForDriver(focus.key)
      return rows.filter((r) => r.riskTypes.includes(t))
    }
    if (focus.kind === 'cell') return rows.filter((r) => focus.ids.includes(r.customerId))
    const rank: Record<HealthBand, number> = { Healthy: 0, Watchlist: 1, 'At Risk': 2, Critical: 3 }
    return rows.filter((r) => r.priorHealthBand && rank[r.healthBand] > rank[r.priorHealthBand])
  }, [rows, focus])

  const k = cq.kpis
  const totalRar = rows.reduce((a, r) => a + r.scenarioRevenueAtRisk, 0)
  const topDriver = [...drivers.bars].sort((a, b) => b.clients - a.clients)[0]
  const quadrant = rows.filter(
    (r) => (r.healthBand === 'At Risk' || r.healthBand === 'Critical') && r.revenue >= median(rows.map((x) => x.revenue)),
  )

  const exportRows = (list: WatchlistRow[]) =>
    exportToCsv(
      'client_quality_watchlist.csv',
      list.map((r) => ({
        customer_id: r.customerId,
        customer: r.customerName,
        segment: r.segment,
        revenue: r.revenue,
        revenue_growth_pct: r.revenueGrowth,
        shipment_growth_pct: r.shipmentGrowth,
        cm_pct: r.contributionMargin,
        health_score: r.healthScore,
        health_change: r.healthScoreChange,
        risk_band: r.healthBand,
        prior_risk_band: r.priorHealthBand,
        override_reason: r.overrideReason,
        risk_signals: r.riskTypes.join('; '),
        priority: r.priority,
        priority_score: r.priorityScore,
        priority_reason: r.priorityReason,
        scenario_revenue_exposure: r.scenarioRevenueAtRisk,
        next_step: r.recommendedNextStep,
        focus: focusLabel(focus) || 'non-healthy',
      })),
    )

  const scorecardColumns = useMemo(() => columnsForView(columnView), [columnView])

  return (
    <div className="space-y-5">
      <ModuleSubNav items={CUSTOMER_NAV} />
      <PageHeader
        path="/customers"
        title="Client Quality"
        scope={cq.comparisonLabel ?? `${filters.startPeriod} → ${filters.endPeriod}`}
        actions={
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
            onClick={() => exportRows(rows)}
          >
            Export all clients
          </button>
        }
      />

      <KpiStrip
        items={[
          {
            label: 'Clients at Risk',
            value: `${formatNumber(k.clientsAtRisk)} / ${formatNumber(k.activeClients)}`,
            sub: `${formatCurrency(k.revenueExposure, true)} revenue exposure`,
            tip: `${k.revenueExposureNote}`,
            tone: k.clientsAtRisk > 0 ? 'risk' : 'neutral',
            onClick: () => setFocus({ kind: 'band', band: 'At Risk' }),
          },
          {
            label: 'Worsened Band',
            value: migration.available ? formatNumber(migration.worsened) : 'N/A',
            sub: migration.available ? `${migration.improved} improved · vs ${migration.priorLabel}` : 'No prior window',
            tip: 'Clients whose Risk Band is worse than their own band in the same months prior year (real prior scores by customer ID).',
            tone: migration.worsened > 0 ? 'risk' : 'neutral',
            onClick: () => setFocus({ kind: 'worsened' }),
          },
          {
            label: 'Clients with a Risk Signal',
            value: formatNumber(drivers.clientsWithAnySignal),
            sub: `${drivers.clientsWithMultipleSignals} with 2+ signals`,
            tip: 'Clients matching at least one of the six rule-based signals. One client can match several.',
          },
          {
            label: 'Scenario Revenue at Risk',
            value: formatCurrency(totalRar, true),
            sub: 'Stress estimate · not a forecast',
            tip: 'Σ forward Base Existing forecast (next 3 months) × band stress factor (Critical 40% · At Risk 22% · Watchlist 10% · Healthy 3%). A demo stress assumption — not an expected loss.',
          },
        ]}
      />

      {/* A · Health × Revenue */}
      <ChartCard
        title="Which large clients are unhealthy?"
        subtitle={
          quadrant.length
            ? `${quadrant.length} At Risk / Critical client${quadrant.length === 1 ? '' : 's'} sit in the upper half of revenue — bottom-right of the chart`
            : 'No At Risk / Critical client in the upper half of revenue'
        }
        formula="X = current-window Net Billing (log scale) · Y = Health Score (raw, 0–100) · color = Risk Band · bubble = contribution profit or scenario exposure. Dashed lines: 70 (Watchlist floor) and 50 (At Risk floor)."
        action={
          <select
            className="filter-input text-xs"
            value={bubble}
            onChange={(e) => setBubble(e.target.value as BubbleSize)}
            aria-label="Bubble size"
          >
            <option value="contributionProfit">Bubble: Contribution profit</option>
            <option value="scenarioRevenueAtRisk">Bubble: Scenario exposure</option>
          </select>
        }
      >
        <HealthRevenueMatrix rows={rows} sizeBy={bubble} onSelect={openCustomer360} selectedId={highlightCustomerId} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* B · Risk drivers */}
        <ChartCard
          title="What is driving client risk?"
          subtitle={`${drivers.totalSignals} signals across ${drivers.clientsWithAnySignal} clients — one client can trigger several${topDriver?.clients ? ` · most common: ${topDriver.label}` : ''}`}
          formula={RISK_DRIVERS.map((d) => `${d.label}: ${d.rule}`).join(' · ')}
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
            active={focus?.kind === 'driver' ? focus.key : null}
            onSelect={(key) => setFocus(focus?.kind === 'driver' && focus.key === key ? null : { kind: 'driver', key })}
          />
          <p className="mt-1 text-[11px] text-ink-muted">Bars are not additive: revenue is counted once per signal a client triggers.</p>
        </ChartCard>

        {/* C · Migration */}
        <ChartCard
          id="cq-migration"
          title="Is portfolio health getting better or worse?"
          subtitle={migration.available ? <MigrationSummary m={migration} /> : 'No prior comparable window under current filters'}
          formula="Each client’s Risk Band now vs its Risk Band computed with the same model on the same months prior year (customer ID match). Orange outline = moved to a worse band. Click a cell to list those clients."
          action={
            <Toggle
              value={migrationMetric}
              onChange={setMigrationMetric}
              options={[
                ['clients', 'Clients'],
                ['revenue', 'Revenue'],
              ]}
            />
          }
        >
          {migration.available ? (
            <MigrationHeatmap
              migration={migration}
              metric={migrationMetric}
              activeCell={focus?.kind === 'cell' ? focus : null}
              onSelectCell={(c: MigrationCell) =>
                setFocus(
                  focus?.kind === 'cell' && focus.from === c.from && focus.to === c.to
                    ? null
                    : { kind: 'cell', from: c.from, to: c.to, ids: c.customerIds },
                )
              }
            />
          ) : (
            <p className="py-6 text-center text-sm text-ink-muted">Insufficient history for migration.</p>
          )}
        </ChartCard>
      </div>

      {/* Watchlist */}
      <ChartCard
        title={focus ? `Clients · ${focusLabel(focus)}` : 'Priority watchlist'}
        subtitle={`${focused.length} client${focused.length === 1 ? '' : 's'} · ranked by management priority · click a row for Client 360`}
        formula="Priority = (band severity + size vs largest client + health deterioration + scenario exposure) × data-confidence. Hover the Priority cell for each client’s breakdown."
        action={
          <div className="flex items-center gap-2">
            {focus && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full border border-forest/30 bg-brand-50 px-2 py-0.5 text-xs font-medium text-forest"
                onClick={() => setFocus(null)}
              >
                {focusLabel(focus)} <X size={12} />
              </button>
            )}
            <button type="button" className="text-xs font-medium text-forest underline" onClick={() => exportRows(focused)}>
              Export
            </button>
          </div>
        }
      >
        <DataTable
          rows={focused}
          rowKey={(r) => r.customerId}
          selectedKey={highlightCustomerId}
          onRowClick={(r) => openCustomer360(r.customerId)}
          defaultPageSize={10}
          pageSizeOptions={[10, 25, 50]}
          emptyMessage="No clients match this focus"
          columns={[
            {
              key: 'n',
              header: 'Client',
              render: (r) => <span className="font-medium text-ink">{r.customerName}</span>,
              sortValue: (r) => r.customerName,
              searchValue: (r) => r.customerName,
            },
            {
              key: 'band',
              header: 'Risk Band',
              render: (r) => <BandBadge band={r.healthBand} title={r.overrideReason ?? undefined} />,
              sortValue: (r) => BANDS.indexOf(r.healthBand),
            },
            {
              key: 'h',
              header: 'Health',
              align: 'right',
              render: (r) => (
                <span className="font-mono">
                  {r.healthScore}
                  {r.healthScoreChange != null && (
                    <span className={`ml-1 text-[11px] ${r.healthScoreChange < 0 ? 'text-danger' : 'text-ink-muted'}`}>
                      {r.healthScoreChange >= 0 ? '+' : ''}
                      {r.healthScoreChange}
                    </span>
                  )}
                </span>
              ),
              sortValue: (r) => r.healthScore ?? -1,
            },
            {
              key: 'rev',
              header: 'Revenue',
              align: 'right',
              render: (r) => <span title={formatCurrencyPrecise(r.revenue)}>{formatCurrency(r.revenue, true)}</span>,
              sortValue: (r) => r.revenue,
            },
            {
              key: 'g',
              header: 'Rev YoY',
              align: 'right',
              render: (r) => formatPercent(r.revenueGrowth),
              sortValue: (r) => r.revenueGrowth ?? -999,
            },
            {
              key: 'sig',
              header: 'Top signal',
              render: (r) =>
                r.riskTypes.length ? (
                  <span title={r.riskTypes.join(', ')}>
                    {r.riskTypes[0]}
                    {r.riskTypes.length > 1 && <span className="text-ink-muted"> +{r.riskTypes.length - 1}</span>}
                  </span>
                ) : (
                  <span className="text-ink-muted">—</span>
                ),
            },
            {
              key: 'p',
              header: 'Priority',
              align: 'right',
              render: (r) => (
                <span className="font-mono" title={r.priorityReason}>
                  {r.priorityScore.toFixed(0)}
                </span>
              ),
              sortValue: (r) => r.priorityScore,
            },
          ]}
        />
      </ChartCard>

      <Collapsible title="Full customer scorecard" subtitle="Every metric by client · switch column views · searchable">
        <div className="mb-2 flex justify-end">
          <select
            className="rounded border border-[#dce6df] bg-white px-2 py-1 text-xs"
            value={columnView}
            onChange={(e) => setColumnView(e.target.value as ColumnView)}
            aria-label="Column view"
          >
            {COLUMN_VIEWS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <DataTable
          rows={cq.profiles.filter((p) => focused.some((f) => f.customerId === p.customerId) || !focus)}
          rowKey={(r: CustomerRiskProfile) => r.customerId}
          selectedKey={highlightCustomerId}
          onRowClick={(r) => openCustomer360(r.customerId)}
          defaultPageSize={10}
          pageSizeOptions={[10, 25, 50, 100]}
          columns={scorecardColumns}
        />
        {profileById.size === 0 && <p className="text-xs text-ink-muted">No customers in scope.</p>}
      </Collapsible>

      <Collapsible
        title="Health Score weights"
        subtitle="Demo business assumptions — not validated against churn outcomes. Changing weights recomputes every chart."
      >
        <div className="grid gap-4 sm:grid-cols-5">
          {(
            [
              ['volumeTrend', 'Volume'],
              ['deliveryPerformance', 'Delivery'],
              ['profitability', 'Profitability'],
              ['paymentBehavior', 'Payment'],
              ['customerIssues', 'Billing'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="text-xs">
              <span className="flex justify-between font-medium">
                <span>{label}</span>
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
                    next.volumeTrend + next.deliveryPerformance + next.profitability + next.paymentBehavior + next.customerIssues
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
        <p className="mt-2 text-[12px] text-ink-muted">Weights auto-normalize to 100%.</p>
      </Collapsible>
    </div>
  )
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

type ColumnView = 'overview' | 'revenue' | 'profitability' | 'operations' | 'billing' | 'retention'

const COLUMN_VIEWS: { id: ColumnView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'revenue', label: 'Revenue & Growth' },
  { id: 'profitability', label: 'Profitability' },
  { id: 'operations', label: 'Operations' },
  { id: 'billing', label: 'Billing & Collections' },
  { id: 'retention', label: 'Retention & Risk' },
]

function RiskChips({ types }: { types: RiskType[] }) {
  if (!types.length) return <span className="text-ink-muted">—</span>
  return (
    <span className="flex max-w-[200px] flex-wrap gap-0.5">
      {types.slice(0, 3).map((t) => (
        <span key={t} className="rounded bg-[#eef4ef] px-1 py-0.5 text-[10px] text-ink-muted">
          {t}
        </span>
      ))}
      {types.length > 3 ? <span className="text-[10px] text-ink-muted">+{types.length - 3}</span> : null}
    </span>
  )
}

type ScoreCol = {
  key: string
  header: string
  align?: 'left' | 'right'
  render: (r: CustomerRiskProfile) => ReactNode
  sortValue?: (r: CustomerRiskProfile) => string | number
}

function columnsForView(view: ColumnView): ScoreCol[] {
  const base: ScoreCol[] = [
    { key: 'name', header: 'Customer', render: (r) => r.customerName, sortValue: (r) => r.customerName },
    { key: 'seg', header: 'Segment', render: (r) => r.segment },
  ]
  const byView: Record<ColumnView, ScoreCol[]> = {
    overview: [
      { key: 'ind', header: 'Industry', render: (r) => r.industry },
      {
        key: 'rev',
        header: 'Revenue',
        align: 'right',
        render: (r) => formatCurrency(r.revenue, true),
        sortValue: (r) => r.revenue,
      },
      {
        key: 'growth',
        header: 'Rev Growth %',
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
      { key: 'risk', header: 'Risk Types', render: (r) => <RiskChips types={r.riskTypes} /> },
      {
        key: 'rar',
        header: 'Scenario Revenue Exposure',
        align: 'right',
        render: (r) => formatCurrency(r.scenarioRevenueAtRisk, true),
        sortValue: (r) => r.scenarioRevenueAtRisk,
      },
      {
        key: 'renew',
        header: 'Days to Renewal',
        align: 'right',
        render: (r) => (r.daysUntilRenewal == null ? '—' : formatNumber(r.daysUntilRenewal)),
        sortValue: (r) => r.daysUntilRenewal ?? 9999,
      },
    ],
    revenue: [
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
        key: 'vg',
        header: 'Volume Growth %',
        align: 'right',
        render: (r) => formatPercent(r.volumeGrowth),
        sortValue: (r) => r.volumeGrowth ?? -999,
      },
      {
        key: 'growth',
        header: 'Rev Growth %',
        align: 'right',
        render: (r) => formatPercent(r.revenueGrowth),
        sortValue: (r) => r.revenueGrowth ?? -999,
      },
      {
        key: 'rpp',
        header: 'Rev/Pkg',
        align: 'right',
        render: (r) => (r.revenuePerPackage != null ? formatCurrencyPrecise(r.revenuePerPackage) : '—'),
      },
      {
        key: 'prior',
        header: 'Prior Rev',
        align: 'right',
        render: (r) => formatCurrency(r.priorRevenue, true),
        sortValue: (r) => r.priorRevenue,
      },
    ],
    profitability: [
      {
        key: 'contrib',
        header: 'Contribution $',
        align: 'right',
        render: (r) => formatCurrency(r.contributionProfit, true),
        sortValue: (r) => r.contributionProfit,
      },
      {
        key: 'cm',
        header: 'CM %',
        align: 'right',
        render: (r) => formatPercent(r.contributionMargin),
        sortValue: (r) => r.contributionMargin ?? -999,
      },
      {
        key: 'car',
        header: 'Contrib. at Risk',
        align: 'right',
        render: (r) => formatCurrency(r.financialExposure.contributionAtRisk, true),
        sortValue: (r) => r.financialExposure.contributionAtRisk,
      },
      {
        key: 'prof',
        header: 'Profit Score',
        align: 'right',
        render: (r) => String(r.profitScore),
        sortValue: (r) => r.profitScore,
      },
    ],
    operations: [
      {
        key: 'vol',
        header: 'Volume',
        align: 'right',
        render: (r) => formatNumber(r.volume),
        sortValue: (r) => r.volume,
      },
      {
        key: 'del',
        header: 'Delivery %',
        align: 'right',
        render: (r) => formatPercent(r.deliveryPerformance),
      },
      {
        key: 'dscore',
        header: 'Delivery Score',
        align: 'right',
        render: (r) => String(r.deliveryScore),
        sortValue: (r) => r.deliveryScore,
      },
      {
        key: 'util',
        header: 'Commitment Util.',
        align: 'right',
        render: (r) => formatPercent(r.commitmentUtilization),
        sortValue: (r) => r.commitmentUtilization ?? -999,
      },
    ],
    billing: [
      {
        key: 'open',
        header: 'Open AR',
        align: 'right',
        render: (r) => formatCurrency(r.openAr, true),
        sortValue: (r) => r.openAr,
      },
      {
        key: 'od',
        header: 'Overdue AR',
        align: 'right',
        render: (r) => formatCurrency(r.overdueAr, true),
        sortValue: (r) => r.overdueAr,
      },
      {
        key: 'exc',
        header: 'Open Exceptions',
        align: 'right',
        render: (r) => formatNumber(r.billingExceptionCount),
        sortValue: (r) => r.billingExceptionCount,
      },
      {
        key: 'pay',
        header: 'Payment Score',
        align: 'right',
        render: (r) => String(r.paymentScore),
        sortValue: (r) => r.paymentScore,
      },
      {
        key: 'age',
        header: 'Avg Overdue Age (d)',
        align: 'right',
        render: (r) => formatNumber(r.paymentAgingDays),
        sortValue: (r) => r.paymentAgingDays,
      },
    ],
    retention: [
      {
        key: 'health',
        header: 'Health / Band',
        render: (r) => `${r.healthScore} · ${r.healthBand}`,
        sortValue: (r) => r.healthScore,
      },
      { key: 'risk', header: 'Risk Types', render: (r) => <RiskChips types={r.riskTypes} /> },
      {
        key: 'rar',
        header: 'Scenario Revenue Exposure',
        align: 'right',
        render: (r) => formatCurrency(r.scenarioRevenueAtRisk, true),
        sortValue: (r) => r.scenarioRevenueAtRisk,
      },
      {
        key: 'renew',
        header: 'Days to Renewal',
        align: 'right',
        render: (r) => (r.daysUntilRenewal == null ? '—' : formatNumber(r.daysUntilRenewal)),
        sortValue: (r) => r.daysUntilRenewal ?? 9999,
      },
      {
        key: 'loss',
        header: 'Assumed Loss %',
        align: 'right',
        render: (r) => formatPercent(r.assumedLossProbability * 100),
        sortValue: (r) => r.assumedLossProbability,
      },
    ],
  }
  return [...base, ...byView[view]]
}

