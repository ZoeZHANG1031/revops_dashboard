import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { computeCustomerRamp } from '@/calc/contractActivation'
import { computeCustomerHealth } from '@/calc/customerHealth'
import { computeCustomerRevenueChange } from '@/calc/customerRevenueChange'
import { forecastComparability } from '@/calc/forecastScope'
import { computeRecognizedRevenue } from '@/calc/recognizedRevenue'
import { ChartCard } from '@/components/common/ChartCard'
import { Collapsible } from '@/components/common/Collapsible'
import { DataTable } from '@/components/common/DataTable'
import { DrilldownLink } from '@/components/common/DrilldownLink'
import { PageHeader } from '@/components/common/PageHeader'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { filterCosts, filterExceptions, filterShipments, filterBillingLines } from '@/lib/filters'
import {
  formatCurrency,
  formatCurrencyPrecise,
  formatNumber,
  formatPercent,
  money,
  pct,
  sumMoney,
} from '@/lib/money'

type TabId = 'overview' | 'revenue' | 'operations' | 'profitability' | 'contracts' | 'billing' | 'risk'

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'operations', label: 'Operations' },
  { id: 'profitability', label: 'Profitability' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'billing', label: 'Billing' },
  { id: 'risk', label: 'Risk' },
]

const VARIABLE = new Set([
  'DSP Delivery',
  'Sorting',
  'Linehaul',
  'Redelivery',
  'Claims',
  'Other Variable',
])

export function Customer360() {
  const {
    data,
    filters,
    setFilters,
    healthWeights,
    navigateWithContext,
    highlightCustomerId,
    setHighlightCustomerId,
  } = useApp()
  const [tab, setTab] = useState<TabId>('overview')

  const customerId =
    filters.customerIds[0] ?? highlightCustomerId ?? data.customers[0]?.customer_id ?? null

  const selectCustomer = (id: string) => {
    setFilters({ ...filters, customerIds: id ? [id] : [] })
    setHighlightCustomerId(id || null)
  }

  const custFilters = useMemo(
    () =>
      customerId
        ? { ...filters, customerIds: [customerId] }
        : { ...filters, customerIds: [] as string[] },
    [filters, customerId],
  )

  const health = useMemo(
    () => (customerId ? computeCustomerHealth(data, custFilters, healthWeights)[0] : null),
    [data, custFilters, healthWeights, customerId],
  )
  const revChange = useMemo(
    () => (customerId ? computeCustomerRevenueChange(data, filters, customerId) : null),
    [data, filters, customerId],
  )
  const ramp = useMemo(
    () => (customerId ? computeCustomerRamp(data, filters, customerId) : null),
    [data, filters, customerId],
  )

  const cust = data.customers.find((c) => c.customer_id === customerId)
  const brands = data.brands?.filter((b) => b.customer_id === customerId) ?? []
  const contracts = data.contracts.filter((c) => c.customer_id === customerId)
  const rateCards = data.rateCards.filter((r) =>
    contracts.some((c) => c.contract_id === r.contract_id),
  )

  const ships = useMemo(() => filterShipments(data, custFilters), [data, custFilters])
  const lines = useMemo(() => filterBillingLines(data, custFilters), [data, custFilters])
  const costs = useMemo(() => filterCosts(data, custFilters), [data, custFilters])
  const exceptions = useMemo(() => filterExceptions(data, custFilters), [data, custFilters])
  const recognized = useMemo(() => computeRecognizedRevenue(data, custFilters), [data, custFilters])

  const netBilling = sumMoney(lines.map((l) => l.net_amount))
  const pkgs = sumMoney(lines.map((l) => l.package_count))
  const shipPkgs = sumMoney(ships.map((s) => s.package_count))
  const varCost = sumMoney(costs.filter((c) => VARIABLE.has(c.cost_type)).map((c) => c.amount))
  const contribution = money(netBilling - varCost)
  const cm = pct(contribution, netBilling)
  const deliveredPkgs = sumMoney(
    ships.filter((s) => s.delivery_status === 'Delivered').map((s) => s.package_count),
  )
  const onTimePkgs = sumMoney(ships.filter((s) => s.on_time).map((s) => s.package_count))
  const firstAttempt = sumMoney(
    ships.filter((s) => s.first_attempt_success).map((s) => s.package_count),
  )
  const metros = new Set(ships.map((s) => s.metro)).size
  const services = [...new Set(ships.map((s) => s.service_type))]

  const invoices = data.invoices.filter(
    (i) =>
      i.customer_id === customerId &&
      i.accounting_period >= filters.startPeriod &&
      i.accounting_period <= filters.endPeriod,
  )
  const payments = data.payments.filter((p) => p.customer_id === customerId)
  const paidByInvoice = new Map<string, number>()
  for (const p of payments) paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + p.amount)
  const openAr = invoices
    .filter((i) => i.status !== 'Paid')
    .reduce((a, i) => a + Math.max(0, i.net_amount - (paidByInvoice.get(i.invoice_id) ?? 0)), 0)
  const overdueAr = invoices.filter((i) => i.status === 'Overdue').reduce((a, i) => a + i.net_amount, 0)

  const volumeTrend = useMemo(() => {
    const periods = data.dates
      .map((d) => d.date_key.slice(0, 7))
      .filter((p) => p >= filters.startPeriod && p <= filters.endPeriod)
    return periods.map((period) => ({
      period,
      volume: data.shipments
        .filter((s) => s.customer_id === customerId && s.ship_date.startsWith(period))
        .reduce((a, s) => a + s.package_count, 0),
      revenue: data.billingLines
        .filter(
          (b) =>
            b.customer_id === customerId && b.accounting_period === period && !b.is_duplicate,
        )
        .reduce((a, b) => a + b.net_amount, 0),
    }))
  }, [data, customerId, filters.startPeriod, filters.endPeriod])

  const costByType = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of costs) {
      if (!VARIABLE.has(c.cost_type)) continue
      m.set(c.cost_type, (m.get(c.cost_type) ?? 0) + c.amount)
    }
    return [...m.entries()]
      .map(([type, amount]) => ({ type, amount: money(amount) }))
      .sort((a, b) => b.amount - a.amount)
  }, [costs])

  const byMetro = useMemo(() => {
    const rev = new Map<string, number>()
    const vol = new Map<string, number>()
    const shipMetro = new Map(ships.map((s) => [s.shipment_id, s.metro]))
    for (const s of ships) vol.set(s.metro, (vol.get(s.metro) ?? 0) + s.package_count)
    for (const l of lines) {
      const metro = shipMetro.get(l.shipment_id) ?? 'Unknown'
      rev.set(metro, (rev.get(metro) ?? 0) + l.net_amount)
    }
    return [...new Set([...rev.keys(), ...vol.keys()])]
      .map((metro) => ({
        metro,
        revenue: money(rev.get(metro) ?? 0),
        volume: vol.get(metro) ?? 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [ships, lines])

  const byStation = useMemo(() => {
    const vol = new Map<string, number>()
    for (const s of ships) vol.set(s.station_id, (vol.get(s.station_id) ?? 0) + s.package_count)
    return [...vol.entries()]
      .map(([station_id, volume]) => {
        const st = data.stations.find((x) => x.station_id === station_id)
        return {
          station_id,
          station_name: st?.station_name ?? station_id,
          metro: st?.metro ?? '',
          volume,
        }
      })
      .sort((a, b) => b.volume - a.volume)
  }, [ships, data.stations])

  const scope = useMemo(
    () =>
      customerId
        ? forecastComparability(
            data,
            { ...filters, regions: [], metros: [], stations: [], serviceTypes: [], customerIds: [customerId] },
            'Base',
          )
        : null,
    [data, filters, customerId],
  )
  const fcAmt =
    scope?.comparable && customerId
      ? data.forecasts
          .filter(
            (f) =>
              f.customer_id === customerId &&
              f.scenario === 'Base' &&
              f.forecast_type === 'Existing' &&
              scope.periods.includes(f.accounting_period),
          )
          .reduce((a, f) => a + f.forecast_recognized, 0)
      : 0
  const actualAmt = scope?.comparable
    ? computeRecognizedRevenue(data, scope.comparableFilters).amount
    : null
  const forecastVariance =
    actualAmt == null || !scope?.comparable || fcAmt === 0 ? null : actualAmt - fcAmt

  if (!customerId || !cust) {
    return (
      <div className="space-y-4">
        <PageHeader path="/customer-360" scope="Select a customer to open the investigation workspace" />
        <p className="text-sm text-ink-muted">No customer selected.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        path="/customer-360"
        scope="Single-customer investigation · Synthetic data · Health is rule-based, not a churn model"
        actions={
          <div className="flex flex-wrap gap-2">
            <DrilldownLink
              to="/customers"
              label="Portfolio"
              onClick={() => navigateWithContext('/customers', { sourcePage: '/customer-360' })}
            />
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
              onClick={() =>
                exportToCsv(`customer_360_${cust.customer_id}.csv`, [
                  {
                    customer_id: cust.customer_id,
                    customer_name: cust.customer_name,
                    parent: cust.parent_account_name,
                    segment: cust.segment,
                    industry: cust.industry,
                    status: cust.lifecycle_status ?? cust.status,
                    net_billing: netBilling,
                    recognized: recognized.amount,
                    contribution: contribution,
                    cm,
                    open_ar: openAr,
                    overdue_ar: overdueAr,
                    health: health?.healthScore ?? null,
                    period: `${filters.startPeriod}_${filters.endPeriod}`,
                    disclaimer: 'Synthetic',
                  },
                ])
              }
            >
              Export Summary
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[#e1e9e4] bg-white px-4 py-3">
        <label className="text-xs font-semibold text-ink-muted">
          Customer
          <select
            className="filter-input mt-0.5 min-w-[220px] block"
            value={customerId}
            onChange={(e) => selectCustomer(e.target.value)}
          >
            {data.customers.map((c) => (
              <option key={c.customer_id} value={c.customer_id}>
                {c.customer_name}
                {c.illustrative ? ' (Illustrative)' : ''}
              </option>
            ))}
          </select>
        </label>
        <Meta label="Parent" value={cust.parent_account_name} />
        <Meta label="Segment" value={cust.segment} />
        <Meta label="Industry" value={cust.industry} />
        <Meta label="Type" value={cust.customer_type ?? '—'} />
        <Meta label="Status" value={String(cust.lifecycle_status ?? cust.status)} />
        <Meta label="Owner" value={cust.account_owner} />
        <Meta
          label="Contract"
          value={
            contracts[0]
              ? `${contracts[0].start_date.slice(0, 7)} → ${contracts[0].end_date.slice(0, 7)}`
              : '—'
          }
        />
        <Meta label="Metros" value={String(metros)} />
        <Meta label="Services" value={services.join(', ') || '—'} />
        {cust.illustrative && (
          <span className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            Illustrative account · all figures synthetic
          </span>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-8">
        <Kpi label="Net Billing" value={formatCurrency(netBilling, true)} />
        <Kpi label="Recognized" value={formatCurrency(recognized.amount, true)} />
        <Kpi label="Shipments" value={formatNumber(shipPkgs)} />
        <Kpi label="Rev / Pkg" value={pkgs ? formatCurrencyPrecise(netBilling / pkgs) : 'N/A'} />
        <Kpi label="Contribution" value={formatCurrency(contribution, true)} />
        <Kpi label="CM %" value={formatPercent(cm)} />
        <Kpi label="Open AR" value={formatCurrency(openAr, true)} warn={overdueAr > 0} />
        <Kpi
          label="Health"
          value={health ? `${health.healthScore}` : 'N/A'}
          sub={health?.healthBand}
        />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[#e1e9e4] pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${
              tab === t.id ? 'bg-brand-700 text-white' : 'text-ink-muted hover:bg-[#f5f8f5]'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Volume & Net Billing" subtitle="Selected period">
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={volumeTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="l" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="l" dataKey="volume" name="Packages" fill="#A8C5B5" isAnimationActive={false} />
                  <Line
                    yAxisId="r"
                    type="monotone"
                    dataKey="revenue"
                    name="Net Billing"
                    stroke="#123C35"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
          <ChartCard title="Account structure" subtitle="Bill-to vs brands (no double count)">
            <dl className="grid grid-cols-2 gap-2 text-[13px]">
              <div>
                <dt className="text-ink-muted">Bill-to / Contracting</dt>
                <dd className="font-medium">{cust.customer_name}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Parent account</dt>
                <dd className="font-medium">{cust.parent_account_name}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-ink-muted">Downstream brands / merchants</dt>
                <dd className="mt-1">
                  {brands.length
                    ? brands.map((b) => (
                        <span
                          key={b.brand_id}
                          className="mr-1 inline-block rounded bg-[#f5f8f5] px-1.5 py-0.5 text-xs"
                        >
                          {b.brand_name}
                        </span>
                      ))
                    : 'Direct shipper (no separate brand layer)'}
                </dd>
              </div>
            </dl>
            {health && (
              <ul className="mt-3 list-disc pl-4 text-[13px] text-ink-muted">
                {health.recommendedActions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </ChartCard>
        </div>
      )}

      {tab === 'revenue' && (
        <div className="space-y-4">
          {revChange && (
            <ChartCard
              title="Revenue change decomposition"
              subtitle={`${revChange.currentLabel} vs prior ${revChange.priorLabel}`}
            >
              {!revChange.comparable ? (
                <p className="text-sm text-ink-muted">{revChange.note}</p>
              ) : (
                <>
                  <div className="mb-3 grid gap-2 sm:grid-cols-4">
                    <Kpi
                      label="Δ Net Billing"
                      value={formatCurrency(revChange.revenueChange, true)}
                      sub={formatPercent(revChange.revenueChangePct)}
                      warn={revChange.revenueChange < 0}
                    />
                    <Kpi
                      label="Volume impact"
                      value={formatCurrency(revChange.volumeImpact, true)}
                      sub={formatPercent(revChange.volumeChangePct)}
                    />
                    <Kpi
                      label="RPP / price impact"
                      value={formatCurrency(revChange.priceImpact, true)}
                      sub={formatPercent(revChange.rppChangePct)}
                    />
                    <Kpi label="Residual" value={formatCurrency(revChange.residual, true)} />
                  </div>
                  <p className="text-[12px] text-ink-muted">{revChange.note}</p>
                  <p className="text-[11px] font-mono text-ink-muted">
                    check: volume + price + residual = {formatCurrencyPrecise(revChange.checkSum)} (Δ{' '}
                    {formatCurrencyPrecise(revChange.revenueChange)})
                  </p>
                </>
              )}
            </ChartCard>
          )}
          {ramp && (
            <ChartCard title="Contract ramp-up" subtitle={ramp.note}>
              <div className="grid gap-2 sm:grid-cols-4">
                <Kpi label="Expected mo vol" value={formatNumber(ramp.expectedMonthlyVolume)} />
                <Kpi
                  label="First-month vol"
                  value={ramp.firstMonthVolume == null ? 'N/A' : formatNumber(ramp.firstMonthVolume)}
                />
                <Kpi
                  label="Ramp-up attainment"
                  value={ramp.rampUpAttainment == null ? 'N/A' : formatPercent(ramp.rampUpAttainment)}
                  warn={(ramp.rampUpAttainment ?? 100) < 80}
                />
                <Kpi
                  label="Potential vol gap"
                  value={ramp.potentialVolumeGap == null ? 'N/A' : formatNumber(ramp.potentialVolumeGap)}
                  sub="Not booked loss"
                />
              </div>
            </ChartCard>
          )}
          <ChartCard title="Revenue by Metro" subtitle="Net Billing attribution via shipment metro">
            <DataTable
              rows={byMetro.map((r) => ({ ...r, id: r.metro }))}
              rowKey={(r) => r.metro}
              columns={[
                { key: 'm', header: 'Metro', render: (r) => r.metro, sortValue: (r) => r.metro },
                {
                  key: 'v',
                  header: 'Packages',
                  align: 'right',
                  render: (r) => formatNumber(r.volume),
                  sortValue: (r) => r.volume,
                },
                {
                  key: 'r',
                  header: 'Net Billing',
                  align: 'right',
                  render: (r) => formatCurrency(r.revenue, true),
                  sortValue: (r) => r.revenue,
                },
              ]}
              onRowClick={(r) =>
                setFilters({
                  ...filters,
                  customerIds: [customerId],
                  metros: [r.metro],
                  stations: [],
                })
              }
            />
            <p className="mt-2 text-xs text-ink-muted">
              Forecast variance (Existing, comparable):{' '}
              {forecastVariance == null ? 'N/A' : formatCurrency(forecastVariance, true)}
            </p>
          </ChartCard>
        </div>
      )}

      {tab === 'operations' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Delivery performance">
            <div className="grid grid-cols-2 gap-2">
              <Kpi label="Delivered %" value={formatPercent(pct(deliveredPkgs, shipPkgs))} />
              <Kpi label="On-time %" value={formatPercent(pct(onTimePkgs, shipPkgs))} />
              <Kpi label="1st attempt %" value={formatPercent(pct(firstAttempt, shipPkgs))} />
              <Kpi label="Active stations" value={formatNumber(byStation.length)} />
            </div>
          </ChartCard>
          <ChartCard title="Station volume" subtitle="Click to set Station filter">
            <DataTable
              rows={byStation.map((r) => ({ ...r, id: r.station_id }))}
              rowKey={(r) => r.station_id}
              defaultPageSize={25}
              columns={[
                {
                  key: 'n',
                  header: 'Station',
                  render: (r) => r.station_name,
                  sortValue: (r) => r.station_name,
                },
                { key: 'm', header: 'Metro', render: (r) => r.metro },
                {
                  key: 'v',
                  header: 'Packages',
                  align: 'right',
                  render: (r) => formatNumber(r.volume),
                  sortValue: (r) => r.volume,
                },
              ]}
              onRowClick={(r) =>
                setFilters({
                  ...filters,
                  customerIds: [customerId],
                  metros: r.metro ? [r.metro] : filters.metros,
                  stations: [r.station_id],
                })
              }
            />
          </ChartCard>
        </div>
      )}

      {tab === 'profitability' && (
        <ChartCard
          title="Variable cost stack"
          subtitle={`Net Billing ${formatCurrency(netBilling, true)} − Variable ${formatCurrency(varCost, true)} = Contribution ${formatCurrency(contribution, true)}`}
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={costByType}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="type" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatCurrencyPrecise(Number(v))} />
                <Bar dataKey="amount" fill="#123C35" name="Variable cost" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <DrilldownLink
            to="/unit-economics"
            label="Open Unit Economics for this customer"
            onClick={() =>
              navigateWithContext('/unit-economics', {
                customerId,
                highlightCustomerId: customerId,
                sourcePage: '/customer-360',
              })
            }
          />
        </ChartCard>
      )}

      {tab === 'contracts' && (
        <ChartCard title="Contracts & rate cards" subtitle="Rate cards matched by shipment date in generator">
          <DataTable
            rows={contracts.map((c) => ({ ...c, id: c.contract_id }))}
            rowKey={(r) => r.contract_id}
            columns={[
              { key: 'id', header: 'Contract', render: (r) => r.contract_id },
              { key: 'v', header: 'Ver', render: (r) => String(r.version), align: 'right' },
              { key: 'm', header: 'Pricing', render: (r) => r.pricing_model },
              {
                key: 'd',
                header: 'Effective',
                render: (r) => `${r.start_date} → ${r.end_date}`,
              },
              { key: 's', header: 'Status', render: (r) => r.status },
            ]}
          />
          <p className="mt-2 text-xs text-ink-muted">{rateCards.length} rate card versions on file</p>
        </ChartCard>
      )}

      {tab === 'billing' && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <Kpi label="Net Billing" value={formatCurrency(netBilling, true)} />
            <Kpi label="Recognized" value={formatCurrency(recognized.amount, true)} />
            <Kpi label="Open AR" value={formatCurrency(openAr, true)} />
            <Kpi label="Overdue AR" value={formatCurrency(overdueAr, true)} warn={overdueAr > 0} />
          </div>
          <ChartCard title="Invoices in period">
            <DataTable
              rows={invoices.map((i) => ({ ...i, id: i.invoice_id }))}
              rowKey={(r) => r.invoice_id}
              columns={[
                { key: 'id', header: 'Invoice', render: (r) => r.invoice_id },
                { key: 'p', header: 'Period', render: (r) => r.accounting_period },
                {
                  key: 'n',
                  header: 'Net',
                  align: 'right',
                  render: (r) => formatCurrencyPrecise(r.net_amount),
                  sortValue: (r) => r.net_amount,
                },
                { key: 's', header: 'Status', render: (r) => r.status },
                { key: 'd', header: 'Due', render: (r) => r.due_date },
              ]}
              onRowClick={(r) =>
                navigateWithContext('/reconciliation', {
                  customerId,
                  openEntity: { entityType: 'invoice', entityId: r.invoice_id, label: r.invoice_id },
                  sourcePage: '/customer-360',
                })
              }
            />
          </ChartCard>
        </div>
      )}

      {tab === 'risk' && health && (
        <ChartCard title="Health & risk" subtitle="Rule-based score · assumed loss is a scenario parameter">
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            <Kpi label="Health score" value={String(health.healthScore)} sub={health.healthBand} />
            <Kpi label="Data completeness" value={`${health.dataCompleteness}%`} />
            <Kpi
              label="Scenario RaR"
              value={formatCurrency(health.scenarioRevenueAtRisk, true)}
              warn={health.scenarioRevenueAtRisk > 0}
            />
          </div>
          <Collapsible title="Score components" subtitle="Weights are configurable assumptions">
            <ul className="space-y-1 text-[13px] text-ink-muted">
              {health.drivers.map((d) => (
                <li key={d}>• {d}</li>
              ))}
              {!health.drivers.length && <li>No critical drivers flagged</li>}
            </ul>
          </Collapsible>
          <p className="mt-3 text-xs text-ink-muted">
            Open exceptions in period: {exceptions.length} ·{' '}
            <button
              type="button"
              className="text-brand-700 underline"
              onClick={() =>
                navigateWithContext('/reconciliation', {
                  customerId,
                  sourcePage: '/customer-360',
                })
              }
            >
              Open Reconciliation
            </button>
          </p>
        </ChartCard>
      )}
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs">
      <div className="font-semibold text-ink-muted">{label}</div>
      <div className="max-w-[160px] truncate font-medium text-ink" title={value}>
        {value}
      </div>
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  warn,
}: {
  label: string
  value: string
  sub?: string
  warn?: boolean
}) {
  return (
    <div className="rounded-lg border border-[#e1e9e4] bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-sm font-semibold ${warn ? 'text-danger' : 'text-ink'}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-ink-muted">{sub}</div>}
    </div>
  )
}
