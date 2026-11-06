import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
import {
  buildCustomerRiskProfile,
  computePortfolioRiskKpis,
  type CustomerRiskProfile,
  type RiskType,
} from '@/calc/customerRisk'
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
import { ModuleSubNav } from '@/components/layout/ModuleSubNav'
import { CUSTOMER_NAV } from '@/lib/icons'
import { InfoTip } from '@/components/common/StatusIndicator'
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
  const [portfolioFilter, setPortfolioFilter] = useState<PortfolioFilter>(null)
  const [columnView, setColumnView] = useState<ColumnView>('overview')
  const [exposureAxis, setExposureAxis] = useState<ExposureAxis>('scenarioRaR')

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
  const profiles = useMemo(
    () => rows.map((row) => buildCustomerRiskProfile(row, data, filters)),
    [rows, data, filters],
  )
  const portfolioKpis = useMemo(() => computePortfolioRiskKpis(profiles), [profiles])
  const filteredProfiles = useMemo(
    () => applyPortfolioFilter(profiles, portfolioFilter),
    [profiles, portfolioFilter],
  )
  const portfolio = useMemo(() => {
    const total = profiles.reduce((a, r) => a + Math.max(0, r.revenue), 0)
    const bandRar = (['Critical', 'At Risk', 'Watchlist', 'Healthy'] as HealthBand[]).map((band) => ({
      band,
      customers: profiles.filter((r) => r.healthBand === band).length,
      rar: Math.round(profiles.filter((r) => r.healthBand === band).reduce((a, r) => a + r.scenarioRevenueAtRisk, 0) * 100) / 100,
      revenue: Math.round(profiles.filter((r) => r.healthBand === band).reduce((a, r) => a + r.revenue, 0) * 100) / 100,
    }))
    return {
      total,
      rar: portfolioKpis.scenarioRevenueAtRiskTotal,
      bandRar,
      growthAvailable: profiles.some((r) => r.revenueGrowth != null),
    }
  }, [profiles, portfolioKpis.scenarioRevenueAtRiskTotal])
  const activeId = selectedId ?? highlightCustomerId
  // Customer 360 resolves from the full portfolio so it opens even when a metro/region scope hides the row
  const allProfiles = useMemo(
    () => allRows.map((row) => buildCustomerRiskProfile(row, data, filters)),
    [allRows, data, filters],
  )
  const selected =
    profiles.find((r) => r.customerId === activeId) ??
    allProfiles.find((r) => r.customerId === activeId) ??
    null
  const selectedOutOfScope = Boolean(selected && !profiles.some((r) => r.customerId === selected.customerId))

  const selectCustomer = (customerId: string, customerName: string) => {
    setSelectedId(customerId)
    setHighlightCustomerId(customerId)
    pushDrill({ level: 'customer', id: customerId, label: customerName })
    navigateWithContext('/customer-360', {
      customerId,
      highlightCustomerId: customerId,
      sourcePage: '/customers',
    })
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
        volume: data.shipments
          .filter((s) => s.customer_id === selected.customerId && s.ship_date.startsWith(period))
          .reduce((a, s) => a + s.package_count, 0),
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

  const matrixInsight = `${filteredProfiles.length} customers in view · bubble size = revenue · Y-axis = ${EXPOSURE_LABELS[exposureAxis]}. Click a portfolio KPI above to filter the scorecard.`
  const topBand = [...portfolio.bandRar].sort((a, b) => b.rar - a.rar)[0]
  const rarInsight =
    topBand && portfolio.rar > 0
      ? `${topBand.band} accounts carry ${formatPercent((topBand.rar / portfolio.rar) * 100)} of scenario revenue at risk (${formatCurrency(topBand.rar, true)} across ${topBand.customers} customers).`
      : null

  const matrixRows = filteredProfiles.map((r) => ({
    ...r,
    exposure: r.financialExposure[exposureAxis],
  }))
  const scorecardColumns = useMemo(() => columnsForView(columnView), [columnView])

  return (
    <div className="space-y-5">
      <ModuleSubNav items={CUSTOMER_NAV} />
      <PageHeader
        path="/customers"
        title="Customer Portfolio"
        scope="Health is an assumption-weighted score · loss probabilities are scenarios, not churn models"
        actions={
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
            onClick={() =>
              exportToCsv(
                'customer_performance.csv',
                filteredProfiles.map((r) => ({
                  customerId: r.customerId,
                  customerName: r.customerName,
                  segment: r.segment,
                  industry: r.industry,
                  revenue: r.revenue,
                  revenueGrowth: r.revenueGrowth,
                  contributionMargin: r.contributionMargin,
                  healthScore: r.healthScore,
                  healthBand: r.healthBand,
                  riskTypes: r.riskTypes.join('; '),
                  scenarioRaR: r.scenarioRevenueAtRisk,
                  daysUntilRenewal: r.daysUntilRenewal,
                  openAr: r.openAr,
                  overdueAr: r.overdueAr,
                  portfolioFilter: portfolioFilter ?? 'none',
                  columnView,
                })),
              )
            }
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

      <p className="text-[13px] text-ink-muted">
        {formatNumber(profiles.length)} customers · {formatCurrency(portfolio.total, true)} net billing in scope
        {portfolioFilter ? (
          <button
            type="button"
            className="ml-2 inline-flex items-center gap-1 rounded-full border border-brand-700/30 bg-[#f5f8f5] px-2 py-0.5 text-xs font-medium text-brand-800"
            onClick={() => setPortfolioFilter(null)}
          >
            Filter: {PORTFOLIO_FILTER_LABELS[portfolioFilter]} ×
          </button>
        ) : null}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <FilterablePortfolioStat
          label="At-Risk Customers"
          value={formatNumber(portfolioKpis.atRiskCustomers)}
          hint="Health band At Risk or Critical"
          active={portfolioFilter === 'atRisk'}
          onClick={() => setPortfolioFilter(portfolioFilter === 'atRisk' ? null : 'atRisk')}
          tone={portfolioKpis.atRiskCustomers === 0 ? 'good' : 'warn'}
        />
        <FilterablePortfolioStat
          label="Revenue from At-Risk Customers"
          value={formatCurrency(portfolioKpis.revenueFromAtRisk, true)}
          hint="Current-period revenue in at-risk bands — not Scenario RaR"
          tip="NOT equal to Scenario RaR — this is current revenue of at-risk accounts"
          active={portfolioFilter === 'atRisk'}
          onClick={() => setPortfolioFilter(portfolioFilter === 'atRisk' ? null : 'atRisk')}
          tone={portfolioKpis.revenueFromAtRisk > 0 ? 'warn' : 'good'}
        />
        <FilterablePortfolioStat
          label="Contribution Profit at Risk"
          value={formatCurrency(portfolioKpis.contributionProfitAtRisk, true)}
          hint="Sum of contribution profit for at-risk bands"
          active={portfolioFilter === 'atRisk'}
          onClick={() => setPortfolioFilter(portfolioFilter === 'atRisk' ? null : 'atRisk')}
        />
        <FilterablePortfolioStat
          label="Customers with Declining Volume"
          value={formatNumber(portfolioKpis.decliningVolumeCount)}
          active={portfolioFilter === 'decliningVolume'}
          onClick={() => setPortfolioFilter(portfolioFilter === 'decliningVolume' ? null : 'decliningVolume')}
        />
        <FilterablePortfolioStat
          label="Customers with Margin Compression"
          value={formatNumber(portfolioKpis.marginCompressionCount)}
          active={portfolioFilter === 'marginCompression'}
          onClick={() => setPortfolioFilter(portfolioFilter === 'marginCompression' ? null : 'marginCompression')}
        />
        <FilterablePortfolioStat
          label="Contracts Expiring Within 90 Days"
          value={formatNumber(portfolioKpis.contractsExpiring90d)}
          active={portfolioFilter === 'contractsExpiring90'}
          onClick={() => setPortfolioFilter(portfolioFilter === 'contractsExpiring90' ? null : 'contractsExpiring90')}
          tone={portfolioKpis.contractsExpiring90d > 0 ? 'warn' : 'good'}
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
          subtitle="X = health score · Y = financial exposure · bubble = revenue · color = health band · click → Customer 360"
          businessQuestion="Which accounts combine weak health with large financial exposure?"
          formula="Exposure from buildCustomerRiskProfile · health from computeCustomerHealth"
          source="buildCustomerRiskProfile"
          action={
            <select
              className="rounded border border-[#dce6df] bg-white px-2 py-1 text-xs"
              value={exposureAxis}
              onChange={(e) => setExposureAxis(e.target.value as ExposureAxis)}
            >
              {(Object.keys(EXPOSURE_LABELS) as ExposureAxis[]).map((k) => (
                <option key={k} value={k}>
                  Y: {EXPOSURE_LABELS[k]}
                </option>
              ))}
            </select>
          }
        >
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 16, bottom: 18, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                <XAxis
                  type="number"
                  dataKey="healthScore"
                  name="Health"
                  domain={[0, 100]}
                  tick={{ fontSize: 12 }}
                  label={{
                    value: 'Health score (0–100)',
                    position: 'insideBottom',
                    offset: -12,
                    fontSize: 12,
                    fill: '#4a635e',
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="exposure"
                  name="Exposure"
                  tick={{ fontSize: 12 }}
                  width={56}
                  tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`}
                  label={{
                    value: EXPOSURE_LABELS[exposureAxis],
                    angle: -90,
                    position: 'insideLeft',
                    offset: 10,
                    fontSize: 11,
                    fill: '#4a635e',
                  }}
                />
                <ZAxis type="number" dataKey="revenue" range={[40, 280]} />
                <ReferenceLine x={50} stroke="#E58A2B" strokeDasharray="4 3" />
                <ReferenceLine x={70} stroke="#7CB342" strokeDasharray="4 3" />
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
                        <p className="font-mono">
                          {EXPOSURE_LABELS[exposureAxis]} {formatCurrencyPrecise(r.exposure)}
                        </p>
                        {r.riskTypes.length ? (
                          <p className="mt-1 text-xs text-ink-muted">{r.riskTypes.join(' · ')}</p>
                        ) : null}
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
        <ChartCard icon="risk" iconTone="customer" title="Top Revenue at Risk" subtitle="Scenario assumed loss — not booked">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[...filteredProfiles].sort((a, b) => b.scenarioRevenueAtRisk - a.scenarioRevenueAtRisk).slice(0, 8)}
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
                  dataKey="scenarioRevenueAtRisk"
                  radius={[0, 4, 4, 0]}
                  onClick={(d) => {
                    const row = d as unknown as { customerId?: string; customerName?: string }
                    if (row.customerId) selectCustomer(row.customerId, row.customerName ?? row.customerId)
                  }}
                >
                  {[...filteredProfiles]
                    .sort((a, b) => b.scenarioRevenueAtRisk - a.scenarioRevenueAtRisk)
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

      <ChartCard
        icon="customers"
        iconTone="customer"
        title="Customer Scorecard"
        subtitle={`${filteredProfiles.length} rows · click to open Customer 360`}
        action={
          <select
            className="rounded border border-[#dce6df] bg-white px-2 py-1 text-xs"
            value={columnView}
            onChange={(e) => setColumnView(e.target.value as ColumnView)}
          >
            {COLUMN_VIEWS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        }
      >
        <DataTable
          rows={filteredProfiles.map((r) => ({ ...r, id: r.customerId }))}
          rowKey={(r) => r.customerId}
          selectedKey={selectedId ?? highlightCustomerId}
          onRowClick={(r) => selectCustomer(r.customerId, r.customerName)}
          columns={scorecardColumns}
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
                to="/customer-360"
                label="Full Customer 360"
                onClick={() => selectCustomer(selected.customerId, selected.customerName)}
              />
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

type PortfolioFilter =
  | 'atRisk'
  | 'decliningVolume'
  | 'marginCompression'
  | 'contractsExpiring90'
  | null
type ColumnView = 'overview' | 'revenue' | 'profitability' | 'operations' | 'billing' | 'retention'
type ExposureAxis = keyof CustomerRiskProfile['financialExposure']

const PORTFOLIO_FILTER_LABELS: Record<Exclude<PortfolioFilter, null>, string> = {
  atRisk: 'At-Risk customers',
  decliningVolume: 'Declining volume',
  marginCompression: 'Margin compression',
  contractsExpiring90: 'Contracts expiring ≤90d',
}

const EXPOSURE_LABELS: Record<ExposureAxis, string> = {
  currentRevenue: 'Current revenue',
  scenarioRaR: 'Scenario RaR',
  recoverableBilling: 'Recoverable billing',
  contributionAtRisk: 'Contribution at risk',
}

const COLUMN_VIEWS: { id: ColumnView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'revenue', label: 'Revenue & Growth' },
  { id: 'profitability', label: 'Profitability' },
  { id: 'operations', label: 'Operations' },
  { id: 'billing', label: 'Billing & Collections' },
  { id: 'retention', label: 'Retention & Risk' },
]

function applyPortfolioFilter(rows: CustomerRiskProfile[], filter: PortfolioFilter | null) {
  if (!filter) return rows
  switch (filter) {
    case 'atRisk':
      return rows.filter((r) => r.healthBand === 'At Risk' || r.healthBand === 'Critical')
    case 'decliningVolume':
      return rows.filter((r) => r.riskTypes.includes('Volume Decline'))
    case 'marginCompression':
      return rows.filter((r) => r.riskTypes.includes('Margin Compression'))
    case 'contractsExpiring90':
      return rows.filter(
        (r) => r.daysUntilRenewal != null && r.daysUntilRenewal >= 0 && r.daysUntilRenewal <= 90,
      )
    default:
      return rows
  }
}

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
        header: 'Scenario RaR',
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
        header: 'Scenario RaR',
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

function FilterablePortfolioStat({
  label,
  value,
  hint,
  tip,
  tone,
  active,
  onClick,
}: {
  label: string
  value: string
  hint?: string
  tip?: string
  tone?: 'good' | 'warn' | 'bad'
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left transition ${active ? 'ring-2 ring-brand-700/40 rounded-xl' : ''}`}
    >
      <StatTile label={label} value={value} hint={hint} tone={tone} tip={tip} />
    </button>
  )
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
