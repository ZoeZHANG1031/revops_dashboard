import { ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment, useDeferredValue, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ACTION_PRIORITY_RULE,
  actionCategoryTotals,
  buildActionCenter,
  groupActionsByRootCause,
  type ActionGroup,
  type ActionItem,
} from '@/calc/actionCenter'
import { buildTopBusinessIssues } from '@/calc/executiveIssues'
import { evaluateForecastAccuracy } from '@/calc/forecast'
import { sumCompanyTargets } from '@/calc/forwardForecast'
import { monthlyRevenueSeries } from '@/calc/kpis'
import {
  computeDeliveryPerformanceImpact,
  computeGeographicProfitability,
  computeShipmentToRevenueFlow,
} from '@/calc/logistics'
import { computeSharedMetrics } from '@/calc/metricRegistry'
import { computeVarianceBridge } from '@/calc/varianceBridge'
import { FloatingWaterfall } from '@/components/charts/FloatingWaterfall'
import { BridgeAttribution } from '@/components/charts/BridgeAttribution'
import { summarizeSteps } from '@/lib/waterfall'
import { ChartCard } from '@/components/common/ChartCard'
import { Collapsible } from '@/components/common/Collapsible'
import { DataTable } from '@/components/common/DataTable'
import { DrilldownLink } from '@/components/common/DrilldownLink'
import { IssueCard } from '@/components/common/IssueCard'
import { KpiCard } from '@/components/common/KpiCard'
import { PageHeader } from '@/components/common/PageHeader'
import { InfoTip, StatusIndicator } from '@/components/common/StatusIndicator'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { addMonths, monthDiff } from '@/lib/filters'
import { PALETTE } from '@/lib/icons'
import { formatCurrency, formatCurrencyPrecise, formatNumber, formatPercent } from '@/lib/money'

type GroupSort = 'priority' | 'impact' | 'urgency' | 'confidence' | 'owner'
const CONF_RANK = { High: 3, Medium: 2, Low: 1 } as const

export function ExecutiveOverview() {
  const { data, filters, scenario, navigateWithContext, openEntityDrawer, openCustomer360 } = useApp()
  const [bridgeGroup, setBridgeGroup] = useState<'total' | 'customer' | 'month'>('total')
  const [geoDim, setGeoDim] = useState<'metro' | 'zone' | 'service'>('metro')
  const [groupSort, setGroupSort] = useState<GroupSort>('priority')
  const [openGroup, setOpenGroup] = useState<string | null>(null)

  const deferredFilters = useDeferredValue(filters)
  const m = useMemo(() => computeSharedMetrics(data, filters, scenario), [data, filters, scenario])
  const issues = useMemo(() => buildTopBusinessIssues(data, filters, scenario, m), [data, filters, scenario, m])
  const series = useMemo(() => monthlyRevenueSeries(data, filters), [data, filters])
  const bridge = useMemo(
    () => computeVarianceBridge(data, filters, scenario, bridgeGroup),
    [data, filters, scenario, bridgeGroup],
  )
  const accuracy = useMemo(() => evaluateForecastAccuracy(data, filters, scenario), [data, filters, scenario])
  const actions = useMemo(() => buildActionCenter(data, deferredFilters), [data, deferredFilters])
  const groups = useMemo(() => groupActionsByRootCause(actions), [actions])
  const classTotals = useMemo(
    () => actionCategoryTotals(actions, { fullScenarioRevenueAtRisk: m.scenarioRevenueAtRisk }),
    [actions, m.scenarioRevenueAtRisk],
  )
  const delivery = useMemo(() => computeDeliveryPerformanceImpact(data, deferredFilters), [data, deferredFilters])
  const geo = useMemo(
    () => computeGeographicProfitability(data, deferredFilters, geoDim),
    [data, deferredFilters, geoDim],
  )
  const flow = useMemo(() => computeShipmentToRevenueFlow(data, deferredFilters), [data, deferredFilters])
  const windowMonths = useMemo(() => {
    const n = monthDiff(filters.startPeriod, filters.endPeriod) + 1
    return Array.from({ length: n }, (_, i) => addMonths(filters.startPeriod, i))
  }, [filters.startPeriod, filters.endPeriod])
  const companyTargetInWindow = useMemo(() => sumCompanyTargets(data, windowMonths), [data, windowMonths])
  const hasCompanyTargets = useMemo(
    () => data.revenueTargets.some((t) => t.target_scope === 'Company' && windowMonths.includes(t.period)),
    [data.revenueTargets, windowMonths],
  )
  const revenueVsTargetPct =
    hasCompanyTargets && companyTargetInWindow !== 0
      ? ((m.recognizedRevenue - companyTargetInWindow) / Math.abs(companyTargetInWindow)) * 100
      : null

  const comparable = m.forecastComparable
  const varPct =
    !comparable || m.forecastExisting === 0 ? null : (m.forecastVarianceExisting / Math.abs(m.forecastExisting)) * 100
  const forecastStatus = !comparable
    ? 'Not comparable'
    : varPct == null
      ? 'Insufficient baseline'
      : varPct >= 0
        ? 'On Track / Ahead'
        : varPct > -5
          ? 'Watch'
          : 'Behind'

  // Driver attribution quality — separate from forecast accuracy
  // One canonical summary for header, chart footer, tooltip and insight text
  const bridgeSummary = summarizeSteps(bridge.items, ['forecast', 'actual'])
  const residual = bridgeSummary.residual
  const residualShare = bridgeSummary.attributionCoverage == null ? null : 100 - bridgeSummary.attributionCoverage
  const bridgeUi = bridge.items

  const sortedGroups = useMemo(() => {
    const g = [...groups]
    const by: Record<GroupSort, (a: ActionGroup, b: ActionGroup) => number> = {
      priority: (a, b) => b.priorityScore - a.priorityScore || b.impact - a.impact,
      impact: (a, b) => b.impact - a.impact,
      urgency: (a, b) => b.urgency - a.urgency || b.impact - a.impact,
      confidence: (a, b) => CONF_RANK[b.confidence] - CONF_RANK[a.confidence] || b.impact - a.impact,
      owner: (a, b) => a.owner.localeCompare(b.owner) || b.impact - a.impact,
    }
    return g.sort(by[groupSort])
  }, [groups, groupSort])

  // ---- Computed insights (current filters; no hard-coded conclusions) ----
  const lastPt = series[series.length - 1]
  const trendInsight = !comparable
    ? m.forecastComparableReason
    : lastPt && lastPt.forecast
      ? `${lastPt.label}: actual ${formatCurrency(lastPt.recognized, true)} vs Existing forecast ${formatCurrency(lastPt.forecast, true)} (${lastPt.recognized >= lastPt.forecast ? '+' : ''}${formatPercent(((lastPt.recognized - lastPt.forecast) / Math.abs(lastPt.forecast)) * 100)}). Period total ${forecastStatus.toLowerCase()}.`
      : null
  const drivers = bridge.items.filter((i) => !['forecast', 'actual', 'other'].includes(i.key))
  const topDriver = [...drivers].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0]
  const bridgeInsight =
    comparable && topDriver
      ? `Largest known driver: ${topDriver.label} (${topDriver.amount >= 0 ? '+' : '−'}${formatCurrency(Math.abs(topDriver.amount), true)}); unexplained residual ${formatCurrency(residual, true)} = ${residualShare == null ? 'N/A' : `${residualShare.toFixed(1)}%`} of driver movement.`
      : null
  const topGroup = sortedGroups[0]
  const actionInsight = topGroup
    ? `Start with ${topGroup.rootCause}: ${formatNumber(topGroup.cases)} open case${topGroup.cases === 1 ? '' : 's'}, ${formatCurrency(topGroup.impact, true)} ${topGroup.category.toLowerCase()}, suggested owner ${topGroup.owner}.`
    : null

  const drillItem = (r: ActionItem) => {
    if (r.category === 'Customer Revenue Risk' && r.customerId) {
      openCustomer360(r.customerId)
      return
    }
    if (r.category === 'Margin Pressure') {
      navigateWithContext('/unit-economics', { sourcePage: '/executive' })
      return
    }
    navigateWithContext('/reconciliation', {
      exceptionType: r.sourceException?.exception_type ?? null,
      exceptionStatus: null,
      openEntity: r.sourceException
        ? { entityType: 'exception', entityId: r.sourceException.exception_id, label: r.title }
        : null,
      sourcePage: '/executive',
    })
  }
  const drillGroup = (g: ActionGroup) => {
    if (g.category === 'Margin Pressure') return navigateWithContext('/unit-economics', { sourcePage: '/executive' })
    if (g.category === 'Customer Revenue Risk') return navigateWithContext('/customers', { sourcePage: '/executive' })
    navigateWithContext('/reconciliation', {
      exceptionType: g.items[0]?.sourceException?.exception_type ?? null,
      exceptionStatus: 'Open',
      sourcePage: '/executive',
    })
  }

  const kpiActions = (kpiId: string, path: string, extras: Parameters<typeof navigateWithContext>[1] = {}) => [
    { label: 'View breakdown', onClick: () => navigateWithContext(path, { ...extras, sourcePage: '/executive' }) },
    {
      label: 'Trace source',
      onClick: () => openEntityDrawer({ entityType: 'kpi', entityId: kpiId, label: kpiId }),
    },
  ]

  const EXPOSURE_NOTES: Record<string, string> = {
    'Recoverable Billing Exposure': 'Open under-billing that could be re-billed · Exposure ≠ Confirmed Loss',
    'Collections Exposure': 'Overdue invoices — cash timing · Overdue AR ≠ Revenue Leakage',
    'Customer Revenue Risk': 'Full portfolio Scenario Revenue Exposure · At Risk ≠ Guaranteed Loss · actions show sample',
    'Billing Correction': 'Duplicate billing — refund risk, not revenue',
    'Margin Pressure': 'Contribution shortfall signal',
    'Compensation Audit': 'Commission calc / pay variance — investigation only',
  }

  return (
    <div className="space-y-5">
      <PageHeader
        path="/executive"
        scope={`${filters.startPeriod} → ${filters.endPeriod} · ${scenario}`}
        actions={
          <button
            type="button"
            className="rounded-lg bg-forest px-3 py-1.5 text-xs font-medium text-white hover:bg-forest-muted"
            onClick={() =>
              exportToCsv('revenue_summary.csv', [{ ...m, start: filters.startPeriod, end: filters.endPeriod, scenario }])
            }
          >
            Export Summary
          </button>
        }
      />

      <nav className="flex flex-wrap gap-2 text-xs" aria-label="Analysis paths">
        <span className="self-center font-semibold uppercase tracking-wide text-ink-muted">Analyze</span>
        {(
          [
            ['Revenue → Gap → Customers', '/forecasting'],
            ['Billing Leakage', '/lifecycle'],
            ['Profitability', '/unit-economics'],
            ['Sales Pipeline', '/pipeline'],
            ['Action Center', '/actions'],
          ] as const
        ).map(([label, path]) => (
          <button
            key={path + label}
            type="button"
            className="rounded-lg border border-[#dce6df] bg-white px-2.5 py-1 font-medium text-brand-700 hover:border-brand-400 hover:bg-brand-50"
            onClick={() => navigateWithContext(path, { sourcePage: '/executive' })}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Level 1 — three headline KPIs */}
      <section className="grid gap-4 md:grid-cols-3">
        <KpiCard
          kpiId="recognized_revenue"
          value={m.recognizedRevenue}
          size="primary"
          absoluteChange={comparable ? m.forecastVarianceExisting : null}
          priorDelta={varPct}
          baselineLabel={comparable ? 'vs Existing Customer Forecast' : undefined}
          statusLabel={forecastStatus}
          sparkline={series.map((s) => s.recognized)}
          actions={kpiActions('recognized_revenue', '/lifecycle')}
          scopeNote={comparable ? undefined : m.forecastComparableReason ?? undefined}
        />
        <KpiCard
          kpiId="contribution_margin"
          value={m.contributionMargin ?? 0}
          format="percent"
          size="primary"
          levelThresholds={{ good: 28, warn: 22 }}
          statusLabel={(m.contributionMargin ?? 0) >= 28 ? 'Healthy' : (m.contributionMargin ?? 0) >= 22 ? 'Watch' : 'Pressure'}
          actions={kpiActions('contribution_margin', '/unit-economics')}
          scopeNote={`Contribution ${formatCurrency(m.contributionProfit, true)} · ≠ Operating Profit`}
        />
        <KpiCard
          kpiId="open_recoverable_leakage"
          value={m.openRecoverableLeakage}
          size="primary"
          polarity="lower_better"
          levelThresholds={{ good: 500, warn: 2000 }}
          statusLabel={m.openRecoverableLeakage > 2000 ? 'Act' : m.openRecoverableLeakage > 500 ? 'Watch' : 'Low'}
          actions={kpiActions('open_recoverable_leakage', '/reconciliation', { exceptionStatus: 'Open' })}
          scopeNote="Open / investigating recoverable types · unconfirmed"
        />
      </section>

      {/* Layer 1b — secondary context (compact) */}
      <section className="grid gap-2 text-[12px] sm:grid-cols-3 xl:grid-cols-6">
        <SummaryChip
          label="Revenue vs Target"
          value={hasCompanyTargets ? formatCurrency(m.recognizedRevenue, true) : 'No Approved Target'}
          note={
            hasCompanyTargets
              ? `Target ${formatCurrency(companyTargetInWindow, true)} (${formatPercent(revenueVsTargetPct)})`
              : 'Existing Forecast ≠ company budget'
          }
          tip="Company revenue targets in scope only — never treat Existing Customer Forecast as approved budget"
        />
        <SummaryChip
          label="Forecast Variance"
          value={comparable ? formatCurrency(m.forecastVarianceExisting, true) : 'N/A'}
          note={comparable ? `${formatPercent(varPct)} vs Existing` : 'Not comparable'}
          tip={comparable ? (m.forecastComparableNote ?? 'Comparable actual − Existing Customer Forecast') : (m.forecastComparableReason ?? '')}
          onClick={() => navigateWithContext('/forecasting', { sourcePage: '/executive' })}
        />
        <SummaryChip
          label="Overdue AR"
          value={formatCurrency(m.overdueAr, true)}
          note="Cash · ≠ revenue loss"
          tip="Σ net of invoices with status Overdue in scope"
          onClick={() => navigateWithContext('/reconciliation', { exceptionType: 'Overdue AR', exceptionStatus: 'Open', sourcePage: '/executive' })}
        />
        <SummaryChip
          label="Billing Accuracy"
          value={formatPercent(m.billingAccuracy)}
          note="Line accuracy"
          tip="Correctly billed packages ÷ eligible billable packages"
          onClick={() => navigateWithContext('/lifecycle', { sourcePage: '/executive' })}
        />
        <SummaryChip label="Net Billing" value={formatCurrency(m.netBilledRevenue, true)} note="Billing period" tip="Σ billing_line.net_amount (non-duplicate)" />
        <SummaryChip label="Cash Collections" value={formatCurrency(m.cashCollections, true)} note="≠ Recognized" tip="Σ payments by payment_date" />
      </section>

      {/* Layer 2 — What changed? */}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">What changed?</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          icon="forecast"
          iconTone="forecast"
          title="Actual vs Existing Customer Forecast"
          emphasis
          insight={trendInsight}
          subtitle={`${filters.startPeriod} → ${filters.endPeriod} · Existing Forecast ≠ approved budget`}
          timeBasis={`${filters.startPeriod} → ${filters.endPeriod}`}
        >
          {!comparable && (
            <p className="mb-2 rounded-lg bg-amber-50 px-3 py-1.5 text-[13px] text-amber-900">{m.forecastComparableReason}</p>
          )}
          <div className="mb-2 flex flex-wrap gap-2 text-[13px]">
            <Pill label="Actual" value={formatCurrency(m.recognizedRevenue, true)} />
            <Pill label="Existing Fcst" value={formatCurrency(m.forecastExisting, true)} />
            <Pill label="Variance" value={comparable ? `${formatCurrency(m.forecastVarianceExisting, true)} (${formatPercent(varPct)})` : 'N/A'} strong />
            <Pill
              label="Accuracy"
              value={comparable && accuracy.wape != null ? `WAPE ${formatPercent(accuracy.wape)}` : 'N/A'}
              tip="WAPE = Σ|Actual − Forecast| ÷ Σ|Actual| on months with an Existing forecast"
            />
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => formatCurrencyPrecise(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line isAnimationActive={false} type="linear" dataKey="recognized" name="Actual Recognized" stroke={PALETTE.brand} strokeWidth={2.5} dot={false} />
                {comparable && (
                  <Line isAnimationActive={false} type="linear" dataKey="forecast" name="Existing Forecast" stroke={PALETTE.forecast} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          icon="forecast"
          iconTone="forecast"
          title="Forecast Variance Bridge"
          emphasis
          insight={bridgeInsight}
          subtitle="Volume · Price · Mix · Credits · Residual → Comparable Actual"
          action={
            <select className="filter-input" value={bridgeGroup} onChange={(e) => setBridgeGroup(e.target.value as typeof bridgeGroup)} aria-label="Bridge grouping">
              <option value="total">Company</option>
              <option value="customer">By Customer</option>
              <option value="month">By Month</option>
            </select>
          }
        >
          {!comparable ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-xs text-ink-muted">
              {m.forecastComparableReason}
            </p>
          ) : (
            <>
              <BridgeAttribution summary={bridgeSummary} forecastBase={bridge.forecast} note={bridge.attributionNote} />
              <FloatingWaterfall
                steps={bridgeUi.map((i) =>
                  i.key === 'other'
                    ? { ...i, label: 'Unexplained Residual', shortLabel: 'Residual' }
                    : i.key === 'forecast'
                      ? { ...i, shortLabel: 'Forecast' }
                      : i.key === 'actual'
                        ? { ...i, shortLabel: 'Actual' }
                        : i.key === 'volume'
                          ? { ...i, shortLabel: 'Volume' }
                          : i.key === 'price'
                            ? { ...i, shortLabel: 'Price' }
                            : i.key === 'mix'
                              ? { ...i, shortLabel: 'Mix' }
                              : i.key === 'credits'
                                ? { ...i, shortLabel: 'Credits' }
                                : i,
                )}
                height={240}
                totalKeys={['forecast', 'actual']}
                summaryMode="footing"
                filterSummary={`Scenario ${scenario} · ${filters.startPeriod}→${filters.endPeriod}`}
              />
            </>
          )}
        </ChartCard>
      </div>

      {/* Layer 3 — Why / exposure (classes never summed) */}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        Why it matters · exposure by class{' '}
        <InfoTip text="Classes have different economics (re-billable, cash timing, forward scenario risk, refund risk). Never add them into one loss number." />
      </p>
      <ChartCard
        title="Financial Exposure by Class"
        subtitle="Ranked · click a bar to open the matching queue · not additive"
        insight={
          classTotals.filter((c) => c.impact > 0).sort((a, b) => b.impact - a.impact)[0]
            ? `Largest class: ${
                classTotals.filter((c) => c.impact > 0).sort((a, b) => b.impact - a.impact)[0].category
              } · ${formatCurrency(
                classTotals.filter((c) => c.impact > 0).sort((a, b) => b.impact - a.impact)[0].impact,
                true,
              )}`
            : null
        }
      >
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={[...classTotals].filter((c) => c.impact > 0).sort((a, b) => a.impact - b.impact)}
              layout="vertical"
              margin={{ left: 8, right: 48, top: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(Number(v), true)} />
              <YAxis
                type="category"
                dataKey="category"
                width={128}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => String(v).replace(' Exposure', '').replace(' Revenue Risk', ' RaR')}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null
                  const r = payload[0].payload as (typeof classTotals)[0]
                  return (
                    <div className="max-w-xs rounded border border-[#dce6df] bg-white px-2 py-1.5 text-xs shadow">
                      <div className="font-semibold">{r.category}</div>
                      <div>{formatCurrencyPrecise(r.impact)}</div>
                      <div className="text-ink-muted">{formatNumber(r.count)} items</div>
                      <div className="mt-1 text-[10px] text-ink-muted">{EXPOSURE_NOTES[r.category]}</div>
                    </div>
                  )
                }}
              />
              <Bar
                dataKey="impact"
                radius={[0, 4, 4, 0]}
                cursor="pointer"
                isAnimationActive={false}
                onClick={(d) => {
                  const cat = (d as { category?: string })?.category
                  if (cat === 'Margin Pressure') navigateWithContext('/unit-economics', { sourcePage: '/executive' })
                  else if (cat === 'Customer Revenue Risk') navigateWithContext('/customers', { sourcePage: '/executive' })
                  else if (cat === 'Collections Exposure')
                    navigateWithContext('/reconciliation', {
                      exceptionType: 'Overdue AR',
                      exceptionStatus: 'Open',
                      sourcePage: '/executive',
                    })
                  else navigateWithContext('/reconciliation', { exceptionStatus: 'Open', sourcePage: '/executive' })
                }}
              >
                {[...classTotals]
                  .filter((c) => c.impact > 0)
                  .sort((a, b) => a.impact - b.impact)
                  .map((c) => (
                    <Cell
                      key={c.category}
                      fill={
                        c.category === 'Recoverable Billing Exposure' || c.category === 'Collections Exposure'
                          ? '#E58A2B'
                          : c.category === 'Billing Correction' || c.category === 'Compensation Audit'
                            ? '#C44536'
                            : PALETTE.brandMid
                      }
                    />
                  ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* Top Business Issues */}
      <section>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Top business issues · severity order
        </p>
        <div className="grid gap-2 md:grid-cols-3">
          {issues.map((issue) => (
            <IssueCard
              key={issue.id}
              title={issue.title}
              severity={issue.severity}
              financialImpact={issue.financialImpact}
              evidence={issue.evidence}
              suggestedOwner={issue.suggestedOwner}
              recommendedAction={issue.recommendedAction}
              impactNote={issue.impactNote}
              drillLabel={issue.navigate.path === '/forecasting' ? 'Open Forecasting' : 'Open Reconciliation'}
              onInvestigate={() =>
                navigateWithContext(issue.navigate.path, {
                  ...issue.navigate.extras,
                  sourcePage: '/executive',
                  toast: issue.recommendedAction,
                })
              }
            />
          ))}
        </div>
      </section>

      {/* Layer 4 — What should we do? Top 3 then full table */}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">What should we do?</p>
      <section className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-3">
          {sortedGroups.slice(0, 3).map((g, idx) => (
            <div
              key={g.key}
              className="rounded-xl border border-[#dce6df] bg-white p-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="rounded bg-[#123C35] px-1.5 py-0.5 text-[10px] font-bold text-white">
                  #{idx + 1}
                </span>
                <StatusIndicator
                  tone={g.urgency === 3 ? 'critical' : g.urgency === 2 ? 'watch' : 'neutral'}
                  label={g.urgency === 3 ? 'High' : g.urgency === 2 ? 'Medium' : 'Low'}
                />
              </div>
              <p className="mt-2 text-sm font-semibold text-ink">{g.rootCause}</p>
              <p className="text-[11px] text-ink-muted">{g.category}</p>
              <p className="mt-2 font-mono text-lg font-semibold text-ink" title={formatCurrencyPrecise(g.impact)}>
                {formatCurrency(g.impact, true)}
              </p>
              <p className="text-[10px] text-ink-muted">
                Exposure · {formatNumber(g.cases)} cases · Confidence {g.confidence}
                {g.confidence !== 'High' ? ' · Pending Validation' : ''}
              </p>
              <p className="mt-2 text-[12px] text-ink">
                <span className="text-ink-muted">Owner · </span>
                {g.owner}
              </p>
              <p className="mt-1 text-[12px] leading-snug text-ink">{g.recommendedAction}</p>
              <button
                type="button"
                className="mt-3 text-[12px] font-medium text-forest underline"
                onClick={() => drillGroup(g)}
              >
                Open detail
              </button>
            </div>
          ))}
          {sortedGroups.length === 0 && (
            <p className="col-span-full rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-ink-muted">
              No actionable exceptions under current filters.
            </p>
          )}
        </div>
      </section>

      {/* Full Action Priority table */}
      <ChartCard
        icon="actions"
        title="Action Priority"
        emphasis
        insight={actionInsight}
        formula={ACTION_PRIORITY_RULE}
        subtitle="Full queue · priority score = impact + urgency + confidence + actionability · owners suggested"
        businessQuestion="What should Billing / Finance / Sales do this week?"
        action={
          <label className="flex items-center gap-1 text-[13px] text-ink-muted">
            Sort
            <select className="filter-input" value={groupSort} onChange={(e) => setGroupSort(e.target.value as GroupSort)}>
              <option value="priority">Priority</option>
              <option value="impact">Impact</option>
              <option value="urgency">Urgency</option>
              <option value="confidence">Confidence</option>
              <option value="owner">Owner</option>
            </select>
          </label>
        }
      >
        {sortedGroups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-xs text-ink-muted">
            <p>No actionable exceptions under current filters.</p>
            <button
              type="button"
              className="mt-2 font-medium text-brand-700 underline"
              onClick={() => navigateWithContext('/actions', { sourcePage: '/executive' })}
            >
              Open Action Center
            </button>
          </div>
        ) : (
          <div className="overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-[13px]">
              <thead className="bg-[#f7faf8] text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-2 py-2" />
                  <th className="px-2 py-2">Issue (root cause)</th>
                  <th className="px-2 py-2">Exposure class</th>
                  <th className="px-2 py-2 text-right">Cases</th>
                  <th className="px-2 py-2 text-right">Impact</th>
                  <th className="px-2 py-2">Urgency</th>
                  <th className="px-2 py-2">Confidence</th>
                  <th className="px-2 py-2">Suggested owner</th>
                  <th className="px-2 py-2">Recommended action</th>
                  <th className="px-2 py-2 text-right">Priority</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {sortedGroups.slice(0, 10).map((g) => {
                  const open = openGroup === g.key
                  return (
                    <Fragment key={g.key}>
                      <tr
                        className={`cursor-pointer border-t border-slate-100 hover:bg-brand-50/50 ${open ? 'bg-brand-50' : ''}`}
                        onClick={() => setOpenGroup(open ? null : g.key)}
                        aria-expanded={open}
                      >
                        <td className="px-2 py-2 text-ink-muted">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td className="px-2 py-2.5 text-sm font-semibold text-ink">{g.rootCause}</td>
                        <td className="px-2 py-2 text-ink-muted">{g.category}</td>
                        <td className="px-2 py-2 text-right font-mono">{formatNumber(g.cases)}</td>
                        <td className="px-2 py-2.5 text-right font-mono text-sm font-semibold" title={formatCurrencyPrecise(g.impact)}>{formatCurrency(g.impact, true)}</td>
                        <td className="px-2 py-2">
                          <StatusIndicator tone={g.urgency === 3 ? 'critical' : g.urgency === 2 ? 'watch' : 'neutral'} label={g.urgency === 3 ? 'High' : g.urgency === 2 ? 'Medium' : 'Low'} />
                        </td>
                        <td className="px-2 py-2">{g.confidence}</td>
                        <td className="px-2 py-2">{g.owner}</td>
                        <td className="px-2 py-2 text-ink-muted">{g.recommendedAction}</td>
                        <td className="px-2 py-2 text-right font-mono font-semibold">{g.priorityScore}/12</td>
                        <td className="px-2 py-2">
                          <DrilldownLink
                            to={g.category === 'Margin Pressure' ? '/unit-economics' : g.category === 'Customer Revenue Risk' ? '/customers' : '/reconciliation'}
                            label="Open"
                            onClick={() => drillGroup(g)}
                          />
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-[#f7faf8]">
                          <td colSpan={11} className="px-3 py-2">
                            <DataTable
                              rows={g.items.slice(0, 20).map((i) => ({ ...i, id: i.id }))}
                              rowKey={(r) => r.id}
                              onRowClick={drillItem}
                              columns={[
                                { key: 'id', header: 'Record', render: (r) => r.sourceException?.exception_id ?? r.id },
                                { key: 't', header: 'Detail', render: (r) => r.title },
                                {
                                  key: 'c',
                                  header: 'Customer',
                                  render: (r) =>
                                    r.customerId ? (data.customers.find((c) => c.customer_id === r.customerId)?.customer_name ?? r.customerId) : '—',
                                },
                                { key: 'st', header: 'Status', render: (r) => r.status },
                                { key: 'sev', header: 'Severity', render: (r) => r.severity },
                                { key: 'imp', header: 'Impact', align: 'right', render: (r) => formatCurrencyPrecise(r.financialImpact), sortValue: (r) => r.financialImpact },
                              ]}
                            />
                            {g.items.length > 20 && (
                              <p className="mt-1 text-xs text-ink-muted">Showing 20 of {g.items.length} — open the destination page for all records.</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      {/* Level 3 — operational context (collapsed) */}
      <Collapsible title="Operational context" subtitle="Delivery impact · shipment → revenue flow · geographic profitability">
        <div className="grid gap-4 lg:grid-cols-3">
          <ChartCard icon="delivery" title="Delivery → Revenue Impact" businessQuestion="How do failures hit credits & claims?">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Mini label="On-time" value={formatPercent(delivery.otdRate)} />
              <Mini label="First attempt" value={formatPercent(delivery.firstAttemptSuccess)} />
              <Mini label="Failed" value={formatPercent(delivery.failedDeliveryRate)} />
              <Mini label="Claims cost" value={formatCurrency(delivery.claimsCost, true)} />
            </div>
          </ChartCard>
          <ChartCard icon="shipments" title="Shipment → Revenue Flow" businessQuestion="Physical vs commercial drop-offs?">
            <ol className="space-y-1 text-xs">
              {flow.stages.map((s) => (
                <li key={s.key} className="flex justify-between rounded bg-[#f5f8f5] px-2 py-1">
                  <span>
                    {s.label} <span className="text-xs text-ink-muted">{s.kind}</span>
                  </span>
                  <span className="font-mono">{formatNumber(s.count)}</span>
                </li>
              ))}
            </ol>
          </ChartCard>
          <ChartCard
            icon="geography"
            title="Geographic Profitability"
            action={
              <select className="filter-input" value={geoDim} onChange={(e) => setGeoDim(e.target.value as typeof geoDim)} aria-label="Geo dimension">
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
                  metro: geoDim === 'metro' ? r.label : undefined,
                  serviceType: geoDim === 'service' ? (r.label as 'Standard') : undefined,
                  sourcePage: '/executive',
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
      </Collapsible>
    </div>
  )
}

function SummaryChip({
  label,
  value,
  note,
  tip,
  onClick,
}: {
  label: string
  value: string
  note: string
  tip?: string
  onClick?: () => void
}) {
  const body = (
    <>
      <p className="flex items-center text-xs font-semibold uppercase text-ink-muted">
        {label}
        {tip && <InfoTip text={tip} />}
      </p>
      <p className="font-mono text-sm font-semibold text-ink">{value}</p>
      <p className="text-xs text-ink-muted">{note}</p>
    </>
  )
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-[#dce6df] bg-white px-2.5 py-1.5 text-left transition-colors hover:border-brand-400 hover:bg-brand-50"
    >
      {body}
    </button>
  ) : (
    <div className="rounded-lg border border-[#dce6df] bg-white px-2.5 py-1.5">{body}</div>
  )
}

function Pill({ label, value, strong, tip }: { label: string; value: string; strong?: boolean; tip?: string }) {
  return (
    <span className={`inline-flex items-center rounded bg-[#f5f8f5] px-2 py-1 ${strong ? 'font-semibold' : ''}`}>
      <span className="text-ink-muted">{label}&nbsp;</span>
      <span className="font-mono">{value}</span>
      {tip && <InfoTip text={tip} />}
    </span>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#f5f8f5] px-2 py-1.5">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="font-mono text-sm font-semibold">{value}</p>
    </div>
  )
}
