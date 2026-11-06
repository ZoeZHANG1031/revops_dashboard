/**
 * Executive Command Center — Financial Performance + Client Intelligence + Management Actions.
 *
 * Section 1 — KPIs: Recognized Revenue · Contribution Margin · Clients at Risk · Revenue Exposure
 * Section 2 — Financial: Actual vs Forecast | Forecast Variance Bridge
 * Section 3 — Client Health: Portfolio distribution · Top 5 priorities
 * Section 4 — Top 3 Management Actions
 *
 * Full Client Quality detail lives on /customers — this page stays a 30-second command view.
 */
import { useDeferredValue, useMemo, useState } from 'react'
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
import {
  ACTION_PRIORITY_RULE,
  actionCategoryTotals,
  buildActionCenter,
  groupActionsByRootCause,
} from '@/calc/actionCenter'
import { computeClientQualityPortfolio } from '@/calc/clientQuality'
import { buildTopBusinessIssues } from '@/calc/executiveIssues'
import { monthlyRevenueSeries } from '@/calc/kpis'
import { computeSharedMetrics } from '@/calc/metricRegistry'
import { healthDistribution } from '@/calc/portfolioVisuals'
import { computeVarianceBridge } from '@/calc/varianceBridge'
import { BridgeAttribution } from '@/components/charts/BridgeAttribution'
import { FloatingWaterfall } from '@/components/charts/FloatingWaterfall'
import { ChartCard } from '@/components/common/ChartCard'
import { PageHeader } from '@/components/common/PageHeader'
import {
  HealthDistributionChart,
  InsightList,
  KpiStrip,
  PriorityRankChart,
  type InsightItem,
} from '@/components/revops/PortfolioVisuals'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { PALETTE } from '@/lib/icons'
import { formatCurrency, formatCurrencyPrecise, formatNumber, formatPercent } from '@/lib/money'
import { summarizeSteps } from '@/lib/waterfall'

export function ExecutiveOverview() {
  const { data, filters, scenario, healthWeights, navigateWithContext, openCustomer360 } = useApp()
  const deferredFilters = useDeferredValue(filters)
  const [bridgeGroup, setBridgeGroup] = useState<'total' | 'customer' | 'month'>('total')

  const m = useMemo(() => computeSharedMetrics(data, filters, scenario), [data, filters, scenario])
  const cq = useMemo(
    () => computeClientQualityPortfolio(data, deferredFilters, healthWeights),
    [data, deferredFilters, healthWeights],
  )
  const issues = useMemo(() => buildTopBusinessIssues(data, filters, scenario, m), [data, filters, scenario, m])
  const series = useMemo(() => monthlyRevenueSeries(data, filters), [data, filters])
  const distribution = useMemo(() => healthDistribution(cq.watchlist), [cq.watchlist])
  const bridge = useMemo(
    () => computeVarianceBridge(data, filters, scenario, bridgeGroup),
    [data, filters, scenario, bridgeGroup],
  )
  const bridgeSummary = useMemo(
    () => summarizeSteps(bridge.items, ['forecast', 'actual']),
    [bridge.items],
  )
  const actions = useMemo(() => buildActionCenter(data, deferredFilters), [data, deferredFilters])
  const groups = useMemo(() => groupActionsByRootCause(actions), [actions])
  const classTotals = useMemo(
    () => actionCategoryTotals(actions, { fullScenarioRevenueAtRisk: m.scenarioRevenueAtRisk }),
    [actions, m.scenarioRevenueAtRisk],
  )

  const k = cq.kpis
  const top5 = cq.watchlist.filter((w) => w.priority !== 'Healthy').slice(0, 5)
  const comparable = m.forecastComparable
  const varPct =
    !comparable || m.forecastExisting === 0
      ? null
      : (m.forecastVarianceExisting / Math.abs(m.forecastExisting)) * 100
  const forecastStatus = !comparable
    ? 'Not comparable'
    : varPct == null
      ? 'Insufficient baseline'
      : varPct >= 0
        ? 'On Track / Ahead'
        : varPct > -5
          ? 'Watch'
          : 'Behind'
  const cm = m.contributionMargin ?? 0
  const atRiskShare = distribution
    .filter((d) => d.band === 'At Risk' || d.band === 'Critical')
    .reduce((a, d) => a + d.revenueShare, 0)
  const lastPt = series[series.length - 1]

  const openPortfolio = (focus?: string) =>
    navigateWithContext('/customers', {
      sourcePage: '/executive',
      customerId: null,
      portfolioFocus: focus ?? null,
      toast: focus ? `Client Quality · ${focus}` : 'From Executive · Client Quality',
    })

  // ---- Top 3 Management Actions: Client · Revenue/Forecast · Billing/Collections/Margin
  const insights: InsightItem[] = []
  const lead = top5[0]
  if (lead) {
    insights.push({
      id: 'client-retention',
      tone: lead.healthBand === 'Critical' || lead.healthBand === 'At Risk' ? 'risk' : 'watch',
      title: `Client retention · ${lead.customerName}`,
      detail: `${lead.healthBand} · health ${lead.healthScore ?? 'N/A'}${
        lead.healthScoreChange != null
          ? ` (${lead.healthScoreChange >= 0 ? '+' : ''}${lead.healthScoreChange})`
          : ''
      } · ${formatCurrency(lead.revenue, true)} revenue.`,
      evidence: [
        `Finding: ${lead.primaryRiskSignal}`,
        `Evidence: ${lead.priorityReason}`,
        `Business impact: ${formatCurrency(lead.revenue, true)} in-window revenue · Scenario RaR ${formatCurrency(lead.scenarioRevenueAtRisk, true)} (not confirmed loss)`,
        `Next step: ${lead.recommendedNextStep}`,
      ],
      action: { label: 'Open Client 360', onClick: () => openCustomer360(lead.customerId) },
    })
  }

  if (comparable && Math.abs(m.forecastVarianceExisting) > 0) {
    const ahead = m.forecastVarianceExisting >= 0
    const topDriver = [...bridge.items]
      .filter((i) => !['forecast', 'actual', 'other'].includes(i.key))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0]
    insights.push({
      id: 'revenue-forecast',
      tone: ahead ? 'neutral' : 'watch',
      title: `Revenue performance · ${ahead ? 'ahead of' : 'behind'} Existing Customer Forecast`,
      detail: `${formatCurrency(m.forecastVarianceExisting, true)} (${formatPercent(varPct)}) · Actual ${formatCurrency(m.recognizedRevenue, true)}.`,
      evidence: [
        `Finding: Cumulative variance vs Existing Customer Forecast (≠ approved budget)`,
        topDriver
          ? `Evidence: Largest known driver ${topDriver.label} (${topDriver.amount >= 0 ? '+' : '−'}${formatCurrency(Math.abs(topDriver.amount), true)})`
          : 'Evidence: Bridge drivers under current filters',
        bridgeSummary.attributionCoverage != null
          ? `Attribution coverage ${bridgeSummary.attributionCoverage.toFixed(1)}% · Residual ${formatCurrency(bridgeSummary.residual, true)}`
          : 'Attribution N/A',
        'Next step: Open Revenue Gap / Forecast Accuracy for account-level variance',
      ],
      action: {
        label: 'Open Forecast / Gap',
        onClick: () =>
          navigateWithContext('/forecasting/gap', {
            sourcePage: '/executive',
            toast: 'From Executive · Forecast variance',
          }),
      },
    })
  }

  const billingIssue =
    issues.find((i) => /billing|leak|reconcil|collect|ar|margin/i.test(`${i.title} ${i.id}`)) ??
    issues.find((i) => i.severity === 'critical' || i.severity === 'watch')
  const overdueClass = classTotals.find((c) => /collection|overdue|ar/i.test(c.category))
  const leakageClass = classTotals.find((c) => /billing|leak|recover/i.test(c.category))
  const marginGroup = groups.find((g) => /margin/i.test(g.category + g.rootCause))
  if (billingIssue || overdueClass || leakageClass || marginGroup || m.openRecoverableLeakage > 0) {
    const impact =
      billingIssue?.financialImpact ??
      leakageClass?.impact ??
      overdueClass?.impact ??
      marginGroup?.impact ??
      m.openRecoverableLeakage
    insights.push({
      id: 'billing-collections-margin',
      tone:
        (billingIssue?.severity === 'critical' || (impact ?? 0) > 50000) ? 'risk' : 'watch',
      title: billingIssue?.title ??
        (m.openRecoverableLeakage > 0
          ? 'Billing / collections · open recoverable exposure'
          : 'Margin / collections watch'),
      detail: `${formatCurrency(impact ?? m.openRecoverableLeakage, true)} · ${
        billingIssue?.recommendedAction ?? 'Review Reconciliation and Collections queues'
      }.`,
      evidence: [
        `Finding: ${billingIssue?.evidence ?? `Open recoverable leakage ${formatCurrency(m.openRecoverableLeakage, true)} · Overdue AR ${formatCurrency(m.overdueAr, true)}`}`,
        billingIssue?.impactNote ??
          'Overdue AR is cash collection exposure — not booked loss. Recoverable leakage is unconfirmed.',
        `Business impact: ${formatCurrency(impact ?? 0, true)} under current filters`,
        `Next step: ${billingIssue?.recommendedAction ?? 'Open Reconciliation / Collections with current filters'}`,
        ACTION_PRIORITY_RULE,
      ].filter(Boolean),
      action: {
        label: billingIssue?.navigate.path?.includes('collection')
          ? 'Open Collections'
          : billingIssue?.navigate.path?.includes('unit')
            ? 'Open Unit Economics'
            : 'Open Reconciliation',
        onClick: () =>
          navigateWithContext(billingIssue?.navigate.path ?? '/reconciliation', {
            ...(billingIssue?.navigate.extras ?? { exceptionStatus: 'Open' }),
            sourcePage: '/executive',
          }),
      },
    })
  }

  return (
    <div className="space-y-5">
      <PageHeader
        path="/executive"
        scope={`Financial + Client Intelligence · ${filters.startPeriod} → ${filters.endPeriod} · ${scenario} · Synthetic Data`}
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-[#dce6df] bg-white px-3 py-1.5 text-xs font-medium"
              onClick={() => openPortfolio()}
            >
              Client Quality
            </button>
            <button
              type="button"
              className="rounded-lg bg-forest px-3 py-1.5 text-xs font-medium text-white hover:bg-forest-muted"
              onClick={() =>
                exportToCsv('executive_summary.csv', [
                  {
                    start: filters.startPeriod,
                    end: filters.endPeriod,
                    scenario,
                    recognized_revenue: m.recognizedRevenue,
                    contribution_margin: m.contributionMargin,
                    clients_at_risk: k.clientsAtRisk,
                    revenue_exposure: k.revenueExposure,
                    existing_forecast: m.forecastExisting,
                    forecast_variance: comparable ? m.forecastVarianceExisting : null,
                    synthetic: true,
                  },
                ])
              }
            >
              Export Summary
            </button>
          </div>
        }
      />

      {/* Section 1 — Executive KPIs */}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        Section 1 · Executive KPIs
      </p>
      <KpiStrip
        items={[
          {
            label: 'Recognized Revenue',
            value: formatCurrency(m.recognizedRevenue, true),
            sub: comparable
              ? `${m.forecastVarianceExisting >= 0 ? '+' : '−'}${formatCurrency(Math.abs(m.forecastVarianceExisting), true)} · ${formatPercent(varPct)} vs Existing Forecast`
              : (m.forecastComparableReason ?? 'Forecast not comparable'),
            tip: 'Recognized revenue in the selected accounting window. Comparison uses Existing Customer Forecast — not an approved company budget.',
            tone: !comparable ? 'neutral' : (varPct ?? 0) >= 0 ? 'neutral' : 'watch',
            onClick: () =>
              navigateWithContext('/lifecycle', { sourcePage: '/executive', toast: 'From Executive · Recognized Revenue' }),
          },
          {
            label: 'Contribution Margin',
            value: formatPercent(cm),
            sub: `Contribution ${formatCurrency(m.contributionProfit, true)} · ≠ Operating Profit`,
            tip: 'Contribution margin = contribution profit ÷ net billing (variable costs only). Not operating profit after fixed opex.',
            tone: cm >= 28 ? 'neutral' : cm >= 22 ? 'watch' : 'risk',
            onClick: () =>
              navigateWithContext('/unit-economics', {
                sourcePage: '/executive',
                toast: 'From Executive · Contribution Margin',
              }),
          },
          {
            label: 'Clients at Risk',
            value: formatNumber(k.clientsAtRisk),
            sub: `${k.activeClients ? ((k.clientsAtRisk / k.activeClients) * 100).toFixed(0) : 0}% of ${formatNumber(k.activeClients)} active`,
            tip: 'Clients in At Risk or Critical health bands under current filters. Click to open Client Quality filtered to those bands.',
            tone: k.clientsAtRisk > 0 ? 'risk' : 'neutral',
            onClick: () => openPortfolio('band:At Risk'),
          },
          {
            label: 'Revenue Exposure',
            value: formatCurrency(k.revenueExposure, true),
            sub: `${atRiskShare.toFixed(0)}% of portfolio revenue · income exposure ≠ expected loss`,
            tip: k.revenueExposureNote,
            tone: k.revenueExposure > 0 ? 'watch' : 'neutral',
            onClick: () => openPortfolio('band:At Risk'),
          },
        ]}
      />

      {/* Section 2 — Financial Performance */}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        Section 2 · Financial Performance
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Actual vs Existing Customer Forecast"
          subtitle={
            comparable
              ? `Actual ${formatCurrency(m.recognizedRevenue, true)} · Forecast ${formatCurrency(m.forecastExisting, true)} · Variance ${formatCurrency(m.forecastVarianceExisting, true)} (${formatPercent(varPct)}) · ${forecastStatus}`
              : (m.forecastComparableReason ?? 'Forecast not comparable in this scope')
          }
          formula="Monthly recognized revenue vs Existing Customer Forecast. Existing Forecast ≠ approved budget."
          footer={
            <div className="flex flex-wrap gap-3 text-[12px]">
              <button
                type="button"
                className="font-medium text-forest underline"
                onClick={() => navigateWithContext('/forecasting', { sourcePage: '/executive' })}
              >
                Revenue Forecast
              </button>
              <button
                type="button"
                className="font-medium text-forest underline"
                onClick={() => navigateWithContext('/forecasting/accuracy', { sourcePage: '/executive' })}
              >
                Forecast Accuracy
              </button>
            </div>
          }
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={PALETTE.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  width={52}
                  tickFormatter={(v) => formatCurrency(Number(v), true)}
                />
                <Tooltip formatter={(v, n) => [formatCurrencyPrecise(Number(v)), String(n)]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  isAnimationActive={false}
                  type="linear"
                  dataKey="recognized"
                  name="Actual (recognized)"
                  stroke={PALETTE.brand}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                {comparable && (
                  <Line
                    isAnimationActive={false}
                    type="linear"
                    dataKey="forecast"
                    name="Existing forecast"
                    stroke={PALETTE.forecast}
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {comparable && lastPt?.forecast ? (
            <p className="mt-1 text-[11px] text-ink-muted">
              Latest {lastPt.label}: actual {formatCurrency(lastPt.recognized, true)} vs forecast{' '}
              {formatCurrency(lastPt.forecast, true)} (
              {formatPercent(((lastPt.recognized - lastPt.forecast) / Math.abs(lastPt.forecast)) * 100)})
            </p>
          ) : null}
        </ChartCard>

        <ChartCard
          title="Forecast Variance Bridge"
          subtitle="Volume · Price · Mix · Credits · Residual → Comparable Actual"
          formula="Existing Forecast + signed drivers + residual = Actual. Residual is retained — never forced to zero."
          action={
            <select
              className="filter-input"
              value={bridgeGroup}
              onChange={(e) => setBridgeGroup(e.target.value as typeof bridgeGroup)}
              aria-label="Bridge grouping"
            >
              <option value="total">Company</option>
              <option value="customer">By Customer</option>
              <option value="month">By Month</option>
            </select>
          }
          footer={
            <button
              type="button"
              className="text-[12px] font-medium text-forest underline"
              onClick={() =>
                navigateWithContext('/forecasting/gap', {
                  sourcePage: '/executive',
                  toast: 'From Executive · Variance Bridge',
                })
              }
            >
              Open Revenue Gap Analysis
            </button>
          }
        >
          {!comparable ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-xs text-ink-muted">
              {m.forecastComparableReason}
            </p>
          ) : (
            <>
              <BridgeAttribution
                summary={bridgeSummary}
                forecastBase={bridge.forecast}
                note={bridge.attributionNote}
              />
              <FloatingWaterfall
                steps={bridge.items.map((i) =>
                  i.key === 'other'
                    ? { ...i, label: 'Unexplained Residual', shortLabel: 'Residual', isResidual: true }
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
                height={220}
                totalKeys={['forecast', 'actual']}
                summaryMode="footing"
                filterSummary={`Scenario ${scenario} · ${filters.startPeriod}→${filters.endPeriod}`}
                onStepClick={(key) => {
                  if (key === 'forecast' || key === 'actual') return
                  navigateWithContext('/forecasting/gap', {
                    sourcePage: '/executive',
                    toast: `Variance driver · ${key}`,
                  })
                }}
              />
            </>
          )}
        </ChartCard>
      </div>

      {/* Section 3 — Client Health & Exposure (compact; detail on Client Quality) */}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        Section 3 · Client Health &amp; Exposure
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Portfolio Health Distribution"
          subtitle="Share of clients and revenue by Risk Band · click a band → Client Quality filter"
          formula="Bands from Health Score (≥85 Healthy · ≥70 Watchlist · ≥50 At Risk · <50 Critical)."
        >
          <HealthDistributionChart
            slices={distribution}
            onSelectBand={(band) => openPortfolio(`band:${band}`)}
          />
        </ChartCard>

        <ChartCard
          title="Top 5 Management Priorities"
          subtitle="Value × severity × deterioration × exposure · not churn probability"
          formula="Priority ranking aid for account attention — full watchlist on Client Quality."
          footer={
            <button type="button" className="text-[12px] font-medium text-forest underline" onClick={() => openPortfolio()}>
              Full watchlist on Client Quality
            </button>
          }
        >
          {top5.length ? (
            <PriorityRankChart rows={top5} onSelect={openCustomer360} />
          ) : (
            <p className="py-6 text-center text-sm text-ink-muted">
              No elevated-priority clients under current filters.
            </p>
          )}
        </ChartCard>
      </div>

      {/* Section 4 — Management Actions */}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        Section 4 · Management Actions
      </p>
      <ChartCard
        title="Top 3 Management Actions"
        subtitle="Client retention · Revenue / forecast · Billing / collections / margin · expand for evidence"
        footer={
          <div className="flex flex-wrap gap-3 text-[12px]">
            <button
              type="button"
              className="font-medium text-forest underline"
              onClick={() => navigateWithContext('/actions', { sourcePage: '/executive' })}
            >
              Action Center
            </button>
            <button
              type="button"
              className="font-medium text-forest underline"
              onClick={() => openPortfolio()}
            >
              Client Quality
            </button>
          </div>
        }
      >
        <InsightList items={insights.slice(0, 3)} />
      </ChartCard>
    </div>
  )
}
