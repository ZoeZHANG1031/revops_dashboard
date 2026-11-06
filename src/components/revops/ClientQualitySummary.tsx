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
import {
  cqInsightCards,
  type ClientQualityPortfolio,
  type ManagementPriority,
  type WatchlistRow,
} from '@/calc/clientQuality'
import { ChartCard } from '@/components/common/ChartCard'
import { DataTable } from '@/components/common/DataTable'
import { InfoTip } from '@/components/common/StatusIndicator'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/money'

const PRIORITY_COLOR: Record<ManagementPriority, string> = {
  'High Priority': '#C44536',
  'Medium Priority': '#E58A2B',
  Monitor: '#6B7C85',
  Healthy: '#2F9E6B',
}

function KpiTile({
  label,
  value,
  sub,
  tip,
  warn,
  onClick,
}: {
  label: string
  value: string
  sub?: string
  tip: string
  warn?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className={`rounded-xl border px-3 py-2.5 text-left transition ${
        onClick ? 'hover:border-brand-400 hover:bg-brand-50/40' : ''
      } ${warn ? 'border-amber-200 bg-amber-50/40' : 'border-[#dce6df] bg-white'}`}
    >
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
        <InfoTip text={tip} />
      </p>
      <p className={`mt-1 font-mono text-xl font-semibold tabular-nums ${warn ? 'text-amber-900' : 'text-ink'}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-ink-muted">{sub}</p>}
    </button>
  )
}

export function ClientQualitySummary({
  portfolio,
  onOpenPortfolio,
  onOpenCustomer,
  showMatrix = true,
  showWatchlist = true,
  watchlistLimit = 8,
  title = 'Client Quality Executive Summary',
}: {
  portfolio: ClientQualityPortfolio
  onOpenPortfolio: (filter?: string) => void
  onOpenCustomer: (customerId: string) => void
  showMatrix?: boolean
  showWatchlist?: boolean
  watchlistLimit?: number
  title?: string
}) {
  const { kpis, watchlist, matrix } = portfolio
  const insights = cqInsightCards(portfolio)
  const topWatch = watchlist
    .filter((w) => w.priority !== 'Healthy')
    .slice(0, watchlistLimit)

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            Client Quality Intelligence · Synthetic Data
          </p>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <p className="text-[12px] text-ink-muted">
            Monitor → Detect → Explain → Quantify exposure → Investigate ·{' '}
            {portfolio.comparisonLabel ?? 'Prior comparable window unavailable'}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-[#dce6df] bg-white px-2.5 py-1 text-xs font-medium text-brand-700 hover:border-brand-400"
          onClick={() => onOpenPortfolio()}
        >
          Open Customer Portfolio
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile
          label="Active Clients"
          value={formatNumber(kpis.activeClients)}
          sub="Revenue or shipments in window"
          tip="Customers with non-zero Net Billing or shipment volume under current filters."
          onClick={() => onOpenPortfolio()}
        />
        <KpiTile
          label="Healthy Clients"
          value={formatNumber(kpis.healthyClients)}
          tip="CQ band Healthy (or legacy Healthy when CQ coverage insufficient)."
          onClick={() => onOpenPortfolio('healthy')}
        />
        <KpiTile
          label="Clients at Risk"
          value={formatNumber(kpis.clientsAtRisk)}
          tip="At Risk + Critical bands under the Client Quality / legacy health model."
          warn={kpis.clientsAtRisk > 0}
          onClick={() => onOpenPortfolio('at_risk')}
        />
        <KpiTile
          label="Newly Flagged"
          value={kpis.newlyFlaggedClients == null ? 'Insufficient History' : formatNumber(kpis.newlyFlaggedClients)}
          sub={kpis.priorLabel ? `vs ${kpis.priorLabel}` : undefined}
          tip="Entered At Risk/Critical vs same months prior year. Not shown as 0 when prior window missing."
          warn={(kpis.newlyFlaggedClients ?? 0) > 0}
          onClick={() => onOpenPortfolio('at_risk')}
        />
        <KpiTile
          label="Revenue Exposure"
          value={formatCurrency(kpis.revenueExposure, true)}
          tip={kpis.revenueExposureNote}
          warn={kpis.revenueExposure > 0}
          onClick={() => onOpenPortfolio('at_risk')}
        />
        <KpiTile
          label="Clients Improving"
          value={kpis.clientsImproving == null ? 'Insufficient History' : formatNumber(kpis.clientsImproving)}
          tip="CQ score up ≥5 pts vs prior YoY window on available dimensions."
          onClick={() => onOpenPortfolio()}
        />
      </div>

      {insights.length > 0 && (
        <div className="grid gap-2 lg:grid-cols-3">
          {insights.map((c) => (
            <div key={c.finding} className="rounded-xl border border-[#dce6df] bg-[#f7faf8] px-3 py-2.5">
              <p className="text-[11px] font-semibold text-ink">{c.finding}</p>
              <p className="mt-1 text-[11px] text-ink-muted">
                <span className="font-medium text-ink">Evidence · </span>
                {c.evidence}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-muted">
                <span className="font-medium text-ink">Exposure · </span>
                {c.exposure}
              </p>
              <p className="mt-0.5 text-[11px] text-forest">
                <span className="font-medium">Next · </span>
                {c.nextStep}
              </p>
            </div>
          ))}
        </div>
      )}

      {showWatchlist && (
        <ChartCard
          title="Priority Client Watchlist"
          subtitle="Sorted by management priority (value × severity × deterioration × exposure × confidence) — not churn probability"
          insight={
            topWatch[0]
              ? `Top: ${topWatch[0].customerName} · ${topWatch[0].priority} · ${topWatch[0].primaryRiskSignal}`
              : 'No elevated-priority clients under current filters'
          }
        >
          {topWatch.length === 0 ? (
            <p className="py-6 text-center text-xs text-ink-muted">No watchlist rows for current filters</p>
          ) : (
            <DataTable
              rows={topWatch}
              rowKey={(r) => r.customerId}
              searchable={false}
              defaultPageSize={watchlistLimit}
              onRowClick={(r) => onOpenCustomer(r.customerId)}
              columns={watchlistColumns()}
            />
          )}
        </ChartCard>
      )}

      {showMatrix && (
        <ChartCard
          title="Client Value × Risk Matrix"
          subtitle="X = current revenue · Y = health deterioration (or inverted score) · bubble = scenario RaR · color = priority"
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Revenue"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => formatCurrency(Number(v), true)}
                  label={{ value: 'Revenue contribution', position: 'insideBottom', offset: -2, fontSize: 10 }}
                  height={36}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Risk"
                  tick={{ fontSize: 10 }}
                  label={{ value: 'Deterioration / risk', angle: -90, position: 'insideLeft', fontSize: 10 }}
                  width={48}
                />
                <ZAxis type="number" dataKey="z" range={[40, 280]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null
                    const r = payload[0].payload as (typeof matrix)[0]
                    return (
                      <div className="rounded-lg border border-[#dce6df] bg-white px-2.5 py-1.5 text-xs shadow">
                        <p className="font-semibold">{r.customerName}</p>
                        <p>
                          Revenue {formatCurrency(r.revenue, true)} · Health{' '}
                          {r.healthScore == null ? 'N/A' : r.healthScore}
                        </p>
                        <p>
                          Scenario RaR {formatCurrency(r.scenarioRaR, true)} · {r.priority}
                        </p>
                      </div>
                    )
                  }}
                />
                <Scatter
                  data={matrix}
                  cursor="pointer"
                  onClick={(d) => {
                    const id = (d as { customerId?: string }).customerId
                    if (id) onOpenCustomer(id)
                  }}
                >
                  {matrix.map((m) => (
                    <Cell key={m.customerId} fill={PRIORITY_COLOR[m.priority]} fillOpacity={0.75} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-ink-muted">
            {(Object.keys(PRIORITY_COLOR) as ManagementPriority[]).map((p) => (
              <span key={p} className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: PRIORITY_COLOR[p] }} />
                {p}
              </span>
            ))}
          </div>
        </ChartCard>
      )}
    </section>
  )
}

function watchlistColumns() {
  return [
    {
      key: 'name',
      header: 'Client',
      render: (r: WatchlistRow) => <span className="font-medium text-ink">{r.customerName}</span>,
      sortValue: (r: WatchlistRow) => r.customerName,
    },
    { key: 'seg', header: 'Segment', render: (r: WatchlistRow) => r.segment },
    {
      key: 'rev',
      header: 'Revenue',
      align: 'right' as const,
      render: (r: WatchlistRow) => formatCurrency(r.revenue, true),
      sortValue: (r: WatchlistRow) => r.revenue,
    },
    {
      key: 'rg',
      header: 'Rev Δ',
      align: 'right' as const,
      render: (r: WatchlistRow) => formatPercent(r.revenueGrowth),
      sortValue: (r: WatchlistRow) => r.revenueGrowth ?? -999,
    },
    {
      key: 'sg',
      header: 'Ship Δ',
      align: 'right' as const,
      render: (r: WatchlistRow) => formatPercent(r.shipmentGrowth),
      sortValue: (r: WatchlistRow) => r.shipmentGrowth ?? -999,
    },
    {
      key: 'cm',
      header: 'CM %',
      align: 'right' as const,
      render: (r: WatchlistRow) => formatPercent(r.contributionMargin),
      sortValue: (r: WatchlistRow) => r.contributionMargin ?? -999,
    },
    {
      key: 'hs',
      header: 'Health',
      align: 'right' as const,
      render: (r: WatchlistRow) =>
        r.healthScore == null ? (
          <span className="text-ink-muted">N/A</span>
        ) : (
          <span className="font-mono">{r.healthScore}</span>
        ),
      sortValue: (r: WatchlistRow) => r.healthScore ?? -1,
    },
    {
      key: 'hsc',
      header: 'Health Δ',
      align: 'right' as const,
      render: (r: WatchlistRow) =>
        r.healthScoreChange == null ? (
          <span className="text-ink-muted">Insuf.</span>
        ) : (
          <span className={r.healthScoreChange < 0 ? 'text-rose-700' : 'text-emerald-700'}>
            {r.healthScoreChange >= 0 ? '+' : ''}
            {r.healthScoreChange}
          </span>
        ),
      sortValue: (r: WatchlistRow) => r.healthScoreChange ?? -999,
    },
    {
      key: 'risk',
      header: 'Primary Risk',
      render: (r: WatchlistRow) => r.primaryRiskSignal,
    },
    {
      key: 'pri',
      header: 'Priority',
      render: (r: WatchlistRow) => (
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{
            background: `${PRIORITY_COLOR[r.priority]}22`,
            color: PRIORITY_COLOR[r.priority],
          }}
        >
          {r.priority}
        </span>
      ),
      sortValue: (r: WatchlistRow) => r.priorityScore,
    },
    {
      key: 'next',
      header: 'Next Step',
      render: (r: WatchlistRow) => <span className="text-[11px] text-ink-muted">{r.recommendedNextStep}</span>,
    },
  ]
}

/** Compact dimension bars for Client 360 */
export function ClientQualityDimensionBars({
  portfolioScore,
  onSelectDimension,
}: {
  portfolioScore: import('@/calc/clientQuality').ClientQualityScore
  onSelectDimension?: (key: string) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          CQ Score{' '}
          {portfolioScore.score == null ? (
            <span className="text-ink-muted">Insufficient Data</span>
          ) : (
            <span className="font-mono">{portfolioScore.score}</span>
          )}
          <span className="ml-2 text-xs font-normal text-ink-muted">
            {portfolioScore.band} · coverage {portfolioScore.coverage}%
            {portfolioScore.lowConfidence ? ' · Low Confidence' : ''}
          </span>
        </p>
        <p className="text-[10px] text-ink-muted">
          Legacy health {portfolioScore.legacyHealthScore} ({portfolioScore.legacyBand}) · not churn probability
        </p>
      </div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={portfolioScore.dimensions.map((d) => ({
              ...d,
              display: d.score ?? 0,
              na: d.score == null,
            }))}
            margin={{ left: 8, right: 16 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 10 }} />
            <Tooltip
              formatter={(v, _n, ctx) => {
                const row = ctx?.payload as { na?: boolean; score?: number | null; signals?: string[] }
                if (row?.na) return ['Not Available', 'Score']
                return [String(v), 'Score']
              }}
              labelFormatter={(l) => String(l)}
            />
            <Bar
              dataKey="display"
              radius={[0, 3, 3, 0]}
              cursor={onSelectDimension ? 'pointer' : undefined}
              onClick={(d) => {
                const key = (d as { key?: string }).key
                if (key && onSelectDimension) onSelectDimension(key)
              }}
            >
              {portfolioScore.dimensions.map((d) => (
                <Cell key={d.key} fill={d.score == null ? '#dce6df' : d.score >= 70 ? '#2F9E6B' : d.score >= 50 ? '#E58A2B' : '#C44536'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="grid gap-1 text-[10px] text-ink-muted sm:grid-cols-2">
        {portfolioScore.dimensions.map((d) => (
          <li key={d.key}>
            <button
              type="button"
              className="text-left hover:text-forest hover:underline"
              onClick={() => onSelectDimension?.(d.key)}
            >
              {d.label}: {d.score == null ? 'N/A' : d.score} · wt{' '}
              {(d.normalizedWeight * 100).toFixed(0)}%
              {d.score == null ? ' (excluded)' : ''}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
