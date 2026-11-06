import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { computeCustomerHealth, type HealthBand } from '@/calc/customerHealth'
import { StatTile } from '@/components/common/StatTile'
import { ChartCard } from '@/components/common/ChartCard'
import { Collapsible } from '@/components/common/Collapsible'
import { DataTable } from '@/components/common/DataTable'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { forecastComparability } from '@/calc/forecastScope'
import { computeRecognizedRevenue } from '@/calc/recognizedRevenue'
import { DrilldownLink } from '@/components/common/DrilldownLink'
import { shortLabel } from '@/lib/labels'
import { PageHeader } from '@/components/common/PageHeader'
import { InfoTip } from '@/components/common/StatusIndicator'
import { PALETTE } from '@/lib/icons'
import { filterExceptions } from '@/lib/filters'
import { formatCurrency, formatCurrencyPrecise, formatNumber, formatPercent } from '@/lib/money'

export function CustomerIntelligence() {
  const {
    data,
    filters,
    healthWeights,
    setHealthWeights,
    pushDrill,
    navigateWithContext,
    highlightCustomerId,
    setHighlightCustomerId,
  } = useApp()
  const [selectedId, setSelectedId] = useState<string | null>(highlightCustomerId)

  const allRows = useMemo(
    () => computeCustomerHealth(data, filters, healthWeights),
    [data, filters, healthWeights],
  )
  // Region / metro / service context (e.g. from a map click): show only customers active in that scope
  const dimensional =
    filters.regions.length > 0 || filters.metros.length > 0 || filters.serviceTypes.length > 0
  const rows = useMemo(
    () => (dimensional ? allRows.filter((r) => r.revenue !== 0 || r.volume > 0) : allRows),
    [allRows, dimensional],
  )
  const portfolio = useMemo(() => {
    const total = rows.reduce((a, r) => a + Math.max(0, r.revenue), 0)
    const shares = rows.map((r) => (total === 0 ? 0 : Math.max(0, r.revenue) / total)).sort((a, b) => b - a)
    const top = (n: number) => (total === 0 ? null : shares.slice(0, n).reduce((a, x) => a + x, 0) * 100)
    const hhi = total === 0 ? null : shares.reduce((a, x) => a + x * x, 0)
    const rar = rows.reduce((a, r) => a + r.scenarioRevenueAtRisk, 0)
    const atRisk = rows.filter((r) => r.healthBand === 'At Risk' || r.healthBand === 'Critical')
    const bandRar = (['Critical', 'At Risk', 'Watchlist', 'Healthy'] as HealthBand[]).map((band) => ({
      band,
      customers: rows.filter((r) => r.healthBand === band).length,
      rar: Math.round(rows.filter((r) => r.healthBand === band).reduce((a, r) => a + r.scenarioRevenueAtRisk, 0) * 100) / 100,
      revenue: Math.round(rows.filter((r) => r.healthBand === band).reduce((a, r) => a + r.revenue, 0) * 100) / 100,
    }))
    return {
      total,
      top1: top(1),
      top3: top(3),
      top5: top(5),
      hhi,
      rar,
      atRiskCount: atRisk.length,
      atRiskRevenue: atRisk.reduce((a, r) => a + r.revenue, 0),
      bandRar,
      growthAvailable: rows.some((r) => r.revenueGrowth != null),
    }
  }, [rows])
  const activeId = selectedId ?? highlightCustomerId
  // Customer 360 resolves from the full portfolio so it opens even when a metro/region scope hides the row
  const selected =
    rows.find((r) => r.customerId === activeId) ?? allRows.find((r) => r.customerId === activeId) ?? null
  const selectedOutOfScope = Boolean(selected && !rows.some((r) => r.customerId === selected.customerId))

  const selectCustomer = (customerId: string, customerName: string) => {
    setSelectedId(customerId)
    setHighlightCustomerId(customerId)
    pushDrill({ level: 'customer', id: customerId, label: customerName })
    requestAnimationFrame(() =>
      document.getElementById('customer-360')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    )
  }
  useEffect(() => {
    if (highlightCustomerId) setSelectedId(highlightCustomerId)
  }, [highlightCustomerId])
  useEffect(() => {
    if (highlightCustomerId)
      requestAnimationFrame(() => document.getElementById('customer-360')?.scrollIntoView({ block: 'start' }))
    // only on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reference lines: company CM (revenue-weighted) and segment median growth (N/A excluded, never zero-filled)
  const companyCm = useMemo(() => {
    const rev = rows.reduce((a, r) => a + r.revenue, 0)
    const contrib = rows.reduce((a, r) => a + (r.contributionMargin == null ? 0 : (r.revenue * r.contributionMargin) / 100), 0)
    return rev === 0 ? null : (contrib / rev) * 100
  }, [rows])
  const segmentMedians = useMemo(() => {
    const med = (xs: number[]) => {
      if (!xs.length) return null
      const v = [...xs].sort((a, b) => a - b)
      const m = Math.floor(v.length / 2)
      return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
    }
    return (['Enterprise', 'Mid-Market', 'SMB'] as const).map((seg, i) => ({
      segment: seg,
      color: PALETTE.segment[i],
      median: med(rows.filter((r) => r.segment === seg && r.revenueGrowth != null).map((r) => r.revenueGrowth!)),
    }))
  }, [rows])

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
    const custFilters = { ...filters, customerIds: [selected.customerId] }
    const exceptions = filterExceptions(data, custFilters)
    const openExceptions = exceptions.filter(
      (e) => e.status === 'Open' || e.status === 'Investigating' || e.status === 'Pending Approval',
    )
    const payments = data.payments.filter((p) => p.customer_id === selected.customerId)
    const paidByInvoice = new Map<string, number>()
    for (const p of payments) paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + p.amount)
    const invoices = data.invoices.filter(
      (i) =>
        i.customer_id === selected.customerId &&
        i.accounting_period >= filters.startPeriod &&
        i.accounting_period <= filters.endPeriod,
    )
    const openAr = invoices
      .filter((i) => i.status !== 'Paid')
      .reduce((a, i) => a + Math.max(0, i.net_amount - (paidByInvoice.get(i.invoice_id) ?? 0)), 0)
    const overdueAr = invoices.filter((i) => i.status === 'Overdue').reduce((a, i) => a + i.net_amount, 0)
    const forecasts = data.forecasts.filter(
      (f) => f.customer_id === selected.customerId && f.scenario === 'Base' && f.forecast_type === 'Existing',
    )
    // Forecast variance on the comparable window (customer grain, forecast periods only)
    const scope = forecastComparability(data, { ...filters, regions: [], metros: [], serviceTypes: [], customerIds: [selected.customerId] }, 'Base')
    const fcInWindow = forecasts.filter((f) => scope.periods.includes(f.accounting_period))
    const fcAmt = fcInWindow.reduce((a, f) => a + f.forecast_recognized, 0)
    const recRows = computeRecognizedRevenue(data, scope.comparableFilters).rows
    const actualAmt = scope.comparable ? recRows.reduce((a, r) => a + r.amount, 0) : null
    const forecastVariance = actualAmt == null || fcInWindow.length === 0 ? null : actualAmt - fcAmt
    const latestRec = computeRecognizedRevenue(data, custFilters)
      .rows.filter((r) => r.billing_line_id === null)
      .sort((a, b) => b.accounting_period.localeCompare(a.accounting_period))[0]
    return {
      cust,
      contracts,
      volumeTrend,
      exceptions,
      openExceptions,
      payments,
      forecasts,
      openAr,
      overdueAr,
      forecastVariance,
      forecastVariancePct: forecastVariance == null || fcAmt === 0 ? null : (forecastVariance / Math.abs(fcAmt)) * 100,
      latestRecId: latestRec?.rev_rec_id ?? null,
    }
  }, [selected, data, filters])

  // Computed insights
  const belowCm = companyCm == null ? [] : rows.filter((r) => r.contributionMargin != null && r.contributionMargin < companyCm)
  const shrinking = rows.filter((r) => r.revenueGrowth != null && r.revenueGrowth < 0)
  const both = belowCm.filter((r) => r.revenueGrowth != null && r.revenueGrowth < 0)
  const matrixInsight = portfolio.growthAvailable
    ? `${belowCm.length} of ${rows.length} customers run below company CM${companyCm != null ? ` (${companyCm.toFixed(1)}%)` : ''}; ${shrinking.length} are shrinking${both.length ? ` — ${both.map((r) => r.customerName).slice(0, 2).join(', ')}${both.length > 2 ? ` +${both.length - 2}` : ''} are both` : ''}.`
    : `Revenue growth N/A (insufficient history) — ${belowCm.length} of ${rows.length} customers run below company CM.`
  const topBand = [...portfolio.bandRar].sort((a, b) => b.rar - a.rar)[0]
  const rarInsight =
    topBand && portfolio.rar > 0
      ? `${topBand.band} accounts carry ${formatPercent((topBand.rar / portfolio.rar) * 100)} of scenario revenue at risk (${formatCurrency(topBand.rar, true)} across ${topBand.customers} customers).`
      : null

  const matrixRows = rows.filter(
    (r) => r.contributionMargin != null && (portfolio.growthAvailable ? r.revenueGrowth != null : true),
  )

  return (
    <div className="space-y-5">
      <PageHeader
        path="/customers"
        scope="Health is an assumption-weighted score · loss probabilities are scenarios, not churn models"
        actions={
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
            onClick={() => exportToCsv('customer_performance.csv', rows.map((r) => ({ ...r })))}
          >
            Export Customer Performance
          </button>
        }
      />

      {dimensional && (
        <p className="rounded-lg bg-[#f5f8f5] px-3 py-1.5 text-[13px] text-ink-muted">
          Scoped to customers with activity in{' '}
          <strong className="text-ink">
            {[...filters.metros, ...filters.regions, ...filters.serviceTypes].join(' · ')}
          </strong>{' '}
          ({rows.length} of {allRows.length}). Clear the filter chip above to see the full portfolio.
        </p>
      )}

      {/* Level 1 — portfolio status */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <PortfolioStat label="Customers in scope" value={formatNumber(rows.length)} hint={`${formatCurrency(portfolio.total, true)} Net Billing`} />
        <PortfolioStat
          label="Top-3 Concentration"
          value={formatPercent(portfolio.top3)}
          hint={`Top-1 ${formatPercent(portfolio.top1)} · HHI ${portfolio.hhi != null ? portfolio.hhi.toFixed(3) : '—'}`}
          tone={portfolio.top3 == null ? undefined : portfolio.top3 > 60 ? 'bad' : portfolio.top3 > 40 ? 'warn' : 'good'}
        />
        <PortfolioStat
          label="At Risk / Critical"
          value={formatNumber(portfolio.atRiskCount)}
          hint={`${formatCurrency(portfolio.atRiskRevenue, true)} revenue in these accounts`}
          tone={portfolio.atRiskCount === 0 ? 'good' : 'warn'}
        />
        <PortfolioStat
          label="Scenario Revenue at Risk"
          value={formatCurrency(portfolio.rar, true)}
          hint="Assumed loss × expected revenue — not booked"
          tone={portfolio.rar > 0 ? 'warn' : 'good'}
        />
      </div>

      <Collapsible
        title="Health Score Weights"
        subtitle="Initial business assumptions — not validated against historical churn outcomes. Missing metrics default to neutral scores."
      >
        <div className="grid gap-4 sm:grid-cols-5">
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
        <p className="mt-2 text-[13px] text-ink-muted">
          Weights auto-normalize to 100% on change. Raw slider sum ≈ {Math.round(normalizedWeights * 100)}%.
        </p>
      </Collapsible>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          icon="risk"
          iconTone="customer"
          title="Customer Portfolio Risk Matrix"
          emphasis
          insight={matrixInsight}
          subtitle={`Bubble = revenue · color = health band${portfolio.growthAvailable ? ' · growth N/A customers excluded (not zero-filled)' : ''} · click a bubble → Customer 360`}
          businessQuestion="Which accounts combine soft growth with weak margin?"
          formula="Growth from half-window comparison; CM% = (Net Billing − var cost) / Net Billing"
          source="computeCustomerHealth"
        >
          {rows.filter((r) => r.revenueGrowth != null && r.contributionMargin != null).length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Insufficient history for Revenue Growth — showing health × margin fallback below. Growth axis
              requires comparable prior window.
            </p>
          ) : null}
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 16, bottom: 18, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                <XAxis
                  type="number"
                  dataKey={
                    rows.some((r) => r.revenueGrowth != null) ? 'revenueGrowth' : 'healthScore'
                  }
                  name={rows.some((r) => r.revenueGrowth != null) ? 'Growth %' : 'Health'}
                  tick={{ fontSize: 12 }}
                  unit={rows.some((r) => r.revenueGrowth != null) ? '%' : ''}
                  label={{
                    value: rows.some((r) => r.revenueGrowth != null) ? 'Revenue growth % (late vs early half)' : 'Health score (growth N/A)',
                    position: 'insideBottom',
                    offset: -12,
                    fontSize: 12,
                    fill: '#4a635e',
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="contributionMargin"
                  name="CM%"
                  tick={{ fontSize: 12 }}
                  unit="%"
                  width={48}
                  label={{ value: 'Contribution margin %', angle: -90, position: 'insideLeft', offset: 10, fontSize: 12, fill: '#4a635e' }}
                />
                <ZAxis type="number" dataKey="revenue" range={[40, 280]} />
                {companyCm != null && (
                  <ReferenceLine
                    y={companyCm}
                    stroke={PALETTE.brandMid}
                    strokeDasharray="4 3"
                    label={{ value: `Company CM ${companyCm.toFixed(1)}%`, position: 'insideTopRight', fontSize: 12, fill: PALETTE.brandMid }}
                  />
                )}
                {portfolio.growthAvailable &&
                  segmentMedians
                    .filter((sm) => sm.median != null)
                    .map((sm) => (
                      <ReferenceLine
                        key={sm.segment}
                        x={sm.median!}
                        stroke={sm.color}
                        strokeDasharray="3 3"
                        label={{ value: `${sm.segment} median`, position: 'insideBottomLeft', angle: -90, fontSize: 12, fill: sm.color }}
                      />
                    ))}
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  wrapperStyle={{ zIndex: 50 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const r = payload[0].payload as (typeof matrixRows)[number]
                    return (
                      <div className="rounded-lg border border-[#dce6df] bg-white px-3 py-2 text-[13px] shadow-md">
                        <p className="font-semibold text-ink">{r.customerName}</p>
                        <p className="text-ink-muted">{r.segment} · {r.healthBand} ({r.healthScore})</p>
                        <p className="font-mono">Revenue {formatCurrencyPrecise(r.revenue)}</p>
                        <p className="font-mono">CM {formatPercent(r.contributionMargin)} · Growth {r.revenueGrowth == null ? 'N/A' : formatPercent(r.revenueGrowth)}</p>
                      </div>
                    )
                  }}
                />
                <Scatter isAnimationActive={false}
                  data={matrixRows}
                  fill="#00A86B"
                  cursor="pointer"
                  onClick={(d) => {
                    const row = d as unknown as { customerId?: string; customerName?: string }
                    if (row.customerId) {
                      selectCustomer(row.customerId, row.customerName ?? row.customerId)
                    }
                  }}
                >
                  {matrixRows.map((r) => (
                    <Cell
                      key={r.customerId}
                      fill={BAND_COLOR[r.healthBand]}
                      stroke={r.customerId === (selectedId ?? highlightCustomerId) ? '#123C35' : '#fff'}
                      strokeWidth={r.customerId === (selectedId ?? highlightCustomerId) ? 2.5 : 1}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink-muted">
            {(Object.keys(BAND_COLOR) as HealthBand[]).map((b) => (
              <span key={b} className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: BAND_COLOR[b] }} />
                {b}
              </span>
            ))}
          </div>
        </ChartCard>
        <ChartCard
          icon="risk"
          iconTone="customer"
          title="Revenue at Risk by Health Band"
          insight={rarInsight}
          businessQuestion="Where is forward revenue exposed, and how concentrated is it?"
          subtitle="Scenario RaR (assumed loss × expected revenue) — not booked loss"
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={portfolio.bandRar} layout="vertical" margin={{ left: 4, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(1)}k`} />
                <YAxis type="category" dataKey="band" width={70} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(v, _n, item) => {
                    const p = item?.payload as { customers?: number; revenue?: number } | undefined
                    return [`${formatCurrencyPrecise(Number(v))} · ${p?.customers ?? 0} customers · rev ${formatCurrency(p?.revenue ?? 0, true)}`, 'Scenario RaR']
                  }}
                />
                <Bar isAnimationActive={false} dataKey="rar" radius={[0, 4, 4, 0]}>
                  {portfolio.bandRar.map((b) => (
                    <Cell key={b.band} fill={BAND_COLOR[b.band]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard icon="health" iconTone="customer" title="Health Distribution" businessQuestion="Is the portfolio polarized or clustered?">
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
                <XAxis dataKey="band" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Bar isAnimationActive={false} dataKey="count" fill="#123C35" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard icon="risk" iconTone="customer" title="Top Revenue at Risk" subtitle="Scenario assumed loss — not booked">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[...rows].sort((a, b) => b.revenueAtRisk - a.revenueAtRisk).slice(0, 8)}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) =>
                    Math.abs(Number(v)) < 1000
                      ? `$${Math.round(Number(v))}`
                      : `$${(Number(v) / 1000).toFixed(1)}k`
                  }
                />
                <YAxis type="category" dataKey="customerName" width={136} tick={{ fontSize: 12 }} tickFormatter={(v) => shortLabel(String(v), 18)} interval={0} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Bar isAnimationActive={false}
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

      <ChartCard icon="customers" iconTone="customer" title="Customer Scorecard" subtitle="Click a row to open Customer 360">
        <DataTable
          rows={rows.map((r) => ({ ...r, id: r.customerId }))}
          rowKey={(r) => r.customerId}
          selectedKey={selectedId ?? highlightCustomerId}
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
              header: 'Data completeness',
              render: (r) => `${r.dataCompleteness}% (${r.confidence})`,
              sortValue: (r) => r.dataCompleteness,
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
          id="customer-360"
          icon="customers"
          iconTone="customer"
          title={`Customer 360 · ${selected.customerName}`}
          subtitle={`${selected.segment} · ${selected.region} · Health ${selected.healthScore} (${selected.healthBand})${selectedOutOfScope ? ' · not active in the current region/metro/service scope — showing period totals' : ''}`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <DrilldownLink
                to="/unit-economics"
                label="Profitability"
                onClick={() => navigateWithContext('/unit-economics', { customerId: selected.customerId, highlightCustomerId: selected.customerId, sourcePage: '/customers' })}
              />
              <DrilldownLink
                to="/forecasting"
                label="Forecast"
                onClick={() => navigateWithContext('/forecasting', { customerId: selected.customerId, highlightCustomerId: selected.customerId, sourcePage: '/customers' })}
              />
              <DrilldownLink
                to="/reconciliation"
                label="Exceptions"
                onClick={() => navigateWithContext('/reconciliation', { customerId: selected.customerId, highlightCustomerId: selected.customerId, sourcePage: '/customers' })}
              />
              <DrilldownLink
                to="/lifecycle"
                label="Revenue Traceability"
                onClick={() =>
                  navigateWithContext('/lifecycle', {
                    customerId: selected.customerId,
                    highlightCustomerId: selected.customerId,
                    openEntity: detail.latestRecId
                      ? { entityType: 'recognition', entityId: detail.latestRecId, label: detail.latestRecId }
                      : null,
                    sourcePage: '/customers',
                  })
                }
              />
              <button type="button" className="text-xs text-ink-muted hover:text-ink" onClick={() => { setSelectedId(null); setHighlightCustomerId(null) }}>
                Close
              </button>
            </div>
          }
        >
          <div className="mb-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-9">
            <Tile label="Revenue" value={formatCurrency(selected.revenue, true)} title={formatCurrencyPrecise(selected.revenue)} />
            <Tile label="Billed pkgs" value={formatNumber(selected.volume)} />
            <Tile label="Rev growth" value={selected.revenueGrowth == null ? 'N/A' : formatPercent(selected.revenueGrowth)} />
            <Tile label="CM %" value={formatPercent(selected.contributionMargin)} />
            <Tile label="Delivered %" value={formatPercent(selected.deliveryPerformance)} />
            <Tile label="Open AR" value={formatCurrency(detail.openAr, true)} warn={detail.overdueAr > 0} sub={`Overdue ${formatCurrency(detail.overdueAr, true)}`} />
            <Tile label="Open exceptions" value={formatNumber(detail.openExceptions.length)} warn={detail.openExceptions.length > 0} sub={formatCurrency(detail.openExceptions.reduce((a, e) => a + e.financial_impact, 0), true)} />
            <Tile label="Revenue at Risk" value={formatCurrency(selected.scenarioRevenueAtRisk, true)} sub="Scenario" warn={selected.scenarioRevenueAtRisk > 0} />
            <Tile
              label="Forecast variance"
              value={detail.forecastVariance == null ? 'N/A' : formatCurrency(detail.forecastVariance, true)}
              sub={detail.forecastVariancePct == null ? 'vs Existing fcst' : `${detail.forecastVariancePct >= 0 ? '+' : ''}${detail.forecastVariancePct.toFixed(1)}% vs Existing`}
              warn={detail.forecastVariance != null && detail.forecastVariance < 0}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2 text-xs">
            <div>
              <p className="font-semibold text-ink mb-2">Shipment & Revenue Trend</p>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={detail.volumeTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                    <YAxis yAxisId="l" tick={{ fontSize: 12 }} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v, name) => (name === 'Net Billing' ? formatCurrencyPrecise(Number(v)) : formatNumber(Number(v)))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar isAnimationActive={false} yAxisId="l" dataKey="volume" fill="#A8C5B5" name="Shipments" />
                    <Line isAnimationActive={false} yAxisId="r" type="monotone" dataKey="revenue" stroke="#123C35" strokeWidth={2} name="Net Billing" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-3 font-semibold text-ink">Contract</p>
              <ul className="mt-1 text-ink-muted">
                {detail.contracts.map((c) => (
                  <li key={c.contract_id}>
                    {c.contract_id} v{c.version} · {c.pricing_model} · commitment {formatNumber(c.volume_commitment)} · terms{' '}
                    {c.payment_terms_days}d · {c.start_date}→{c.end_date} · {c.status}
                  </li>
                ))}
              </ul>
              <p className="mt-3 font-semibold text-ink">Signals (possible drivers)</p>
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
              <Collapsible
                title={`Health Score ${selected.healthScore} · ${selected.healthBand}`}
                subtitle={`Data completeness ${selected.dataCompleteness}% · expand for components, weights, formula`}
              >
                <table className="w-full text-[13px]">
                  <thead className="text-xs uppercase text-ink-muted">
                    <tr>
                      <th className="text-left">Component</th>
                      <th className="text-right">Current data</th>
                      <th className="text-right">Score</th>
                      <th className="text-right">Weight</th>
                      <th className="text-right">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['Revenue performance', 'Half-window shipment volume trend', selected.volumeScore, healthWeights.volumeTrend],
                      ['Contribution margin', `CM ${formatPercent(selected.contributionMargin)}`, selected.profitScore, healthWeights.profitability],
                      ['Delivery performance', `On-time basis · delivered ${formatPercent(selected.deliveryPerformance)}`, selected.deliveryScore, healthWeights.deliveryPerformance],
                      ['Billing quality', `${selected.billingExceptionCount} unresolved exceptions`, selected.issueScore, healthWeights.customerIssues],
                      ['Collections', `${selected.paymentAgingDays}d avg overdue age`, selected.paymentScore, healthWeights.paymentBehavior],
                    ].map(([label, raw, score, w]) => (
                      <tr key={String(label)} className="border-t border-slate-100">
                        <td className="py-1">{label}</td>
                        <td className="py-1 text-right text-ink-muted">{raw}</td>
                        <td className={`py-1 text-right font-mono ${Number(score) < 50 ? 'text-danger' : ''}`}>{score}</td>
                        <td className="py-1 text-right font-mono">{Math.round(Number(w) * 100)}%</td>
                        <td className="py-1 text-right font-mono">{(Number(score) * Number(w)).toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 font-mono text-xs text-ink-muted">
                  Health = Σ(component score × normalized weight), clamped 0–100
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  Customer engagement: <strong>N/A</strong> — no engagement data in this dataset (not imputed).
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  Bands: ≥85 Healthy · ≥70 Watchlist · ≥50 At Risk · &lt;50 Critical. Component score &lt;50–55 flags a driver.
                  Assumed loss {formatPercent(selected.assumedLossProbability * 100)} (scenario, not a churn model).
                </p>
                <dl className="mt-2 grid grid-cols-3 gap-1 text-xs">
                  <div className="rounded bg-[#f5f8f5] px-1.5 py-1">
                    <dt className="text-ink-muted">Health score</dt>
                    <dd className="font-mono font-semibold">{selected.healthScore}</dd>
                  </div>
                  <div className="rounded bg-[#f5f8f5] px-1.5 py-1">
                    <dt className="flex items-center text-ink-muted">
                      Data completeness
                      <InfoTip text="Share of the 5 components backed by observed data (others use neutral defaults). This is field coverage — not model confidence." />
                    </dt>
                    <dd className="font-mono font-semibold">{selected.dataCompleteness}%</dd>
                  </div>
                  <div className="rounded bg-[#f5f8f5] px-1.5 py-1">
                    <dt className="flex items-center text-ink-muted">
                      Model confidence
                      <InfoTip text="Weights are business assumptions and have not been back-tested against churn outcomes, so no statistical confidence is claimed." />
                    </dt>
                    <dd className="font-semibold">Not validated</dd>
                  </div>
                </dl>
              </Collapsible>
              <p className="mt-3 font-semibold text-ink">Billing Exceptions in period ({detail.exceptions.length})</p>
              <ul className="mt-1 max-h-24 overflow-auto text-ink-muted">
                {detail.exceptions.slice(0, 8).map((e) => (
                  <li key={e.exception_id}>
                    <button
                      type="button"
                      className="text-left hover:text-brand-700 hover:underline"
                      onClick={() =>
                        navigateWithContext('/reconciliation', {
                          customerId: selected.customerId,
                          exceptionType: e.exception_type,
                          exceptionStatus: null,
                          openEntity: { entityType: 'exception', entityId: e.exception_id, label: e.exception_type },
                          sourcePage: '/customers',
                        })
                      }
                    >
                      {e.exception_type}: {formatCurrencyPrecise(e.financial_impact)} · {e.status}
                    </button>
                  </li>
                ))}
                {detail.exceptions.length === 0 && <li>None in period</li>}
              </ul>
              <p className="mt-3 font-semibold text-ink">Recent Payments</p>
              <ul className="mt-1 max-h-20 overflow-auto text-ink-muted">
                {detail.payments.slice(0, 6).map((p) => (
                  <li key={p.payment_id}>
                    {p.payment_date}: {formatCurrencyPrecise(p.amount)} via {p.method}
                  </li>
                ))}
              </ul>
              <p className="mt-3 font-semibold text-ink">Forward Forecast (Base, Existing)</p>
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

const BAND_COLOR: Record<HealthBand, string> = {
  Healthy: '#00A86B',
  Watchlist: '#7CB342',
  'At Risk': '#E58A2B',
  Critical: '#C44536',
}

function PortfolioStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'good' | 'warn' | 'bad'
}) {
  return <StatTile label={label} value={value} hint={hint} tone={tone} />
}

function Tile({ label, value, sub, warn, title }: { label: string; value: string; sub?: string; warn?: boolean; title?: string }) {
  return (
    <div className="rounded-lg border border-[#dce6df] bg-white px-2 py-1.5" title={title}>
      <p className="text-xs font-semibold uppercase text-ink-muted">{label}</p>
      <p className={`font-mono text-sm font-semibold ${warn ? 'text-warning' : 'text-ink'}`}>{value}</p>
      {sub && <p className="text-xs text-ink-muted">{sub}</p>}
    </div>
  )
}
