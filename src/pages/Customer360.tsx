import { useEffect, useMemo, useState } from 'react'
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
import { buildCustomerDiagnosis } from '@/calc/customerDiagnosis'
import { computeCustomerContractHealth } from '@/calc/customerContractHealth'
import { listCustomerEngagementEvents } from '@/calc/customerEngagement'
import { computeCustomerHealth } from '@/calc/customerHealth'
import {
  computeHealthV2ForCustomer,
  DEFAULT_HEALTH_V2_WEIGHTS,
} from '@/calc/customerHealthV2'
import { computeCustomerMarginDiagnosis } from '@/calc/customerMarginBridge'
import { computeCustomerRevenueBridge } from '@/calc/customerRevenueBridge'
import { buildCustomerRiskProfile, type RiskType } from '@/calc/customerRisk'
import { computeCustomerCommission } from '@/calc/salesCompensation'
import { FloatingWaterfall } from '@/components/charts/FloatingWaterfall'
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
  pct,
  sumMoney,
} from '@/lib/money'

type TabId = 'diagnosis' | 'changes' | 'why' | 'at-risk' | 'actions'

const TABS: { id: TabId; label: string }[] = [
  { id: 'diagnosis', label: 'Executive Diagnosis' },
  { id: 'changes', label: 'What Changed?' },
  { id: 'why', label: 'Why Did It Change?' },
  { id: 'at-risk', label: 'What Is at Risk?' },
  { id: 'actions', label: 'What Should We Do?' },
]

const VARIABLE = new Set([
  'DSP Delivery',
  'Sorting',
  'Linehaul',
  'Redelivery',
  'Claims',
  'Other Variable',
])

interface DemoAction {
  id: string
  title: string
  createdAt: string
  status: 'Open' | 'Done'
}

function actionsStorageKey(customerId: string) {
  return `demo-customer-actions:${customerId}`
}

function loadDemoActions(customerId: string): DemoAction[] {
  try {
    const raw = localStorage.getItem(actionsStorageKey(customerId))
    return raw ? (JSON.parse(raw) as DemoAction[]) : []
  } catch {
    return []
  }
}

function tabForDetailKey(key: string): TabId {
  if (key === 'collections' || key === 'billing') return 'at-risk'
  return 'why'
}

function RiskChips({ types }: { types: RiskType[] }) {
  if (!types.length) return <span className="text-ink-muted text-xs">None flagged</span>
  return (
    <span className="flex flex-wrap gap-1">
      {types.map((t) => (
        <span key={t} className="rounded bg-[#eef4ef] px-1.5 py-0.5 text-[11px] text-ink-muted">
          {t}
        </span>
      ))}
    </span>
  )
}

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
  const [tab, setTab] = useState<TabId>('diagnosis')
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const [newActionTitle, setNewActionTitle] = useState('')
  const [demoActions, setDemoActions] = useState<DemoAction[]>([])

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

  const profile = useMemo(
    () => (health ? buildCustomerRiskProfile(health, data, filters) : null),
    [health, data, filters],
  )

  const revBridge = useMemo(
    () => (customerId ? computeCustomerRevenueBridge(data, filters, customerId) : null),
    [data, filters, customerId],
  )

  const marginDiag = useMemo(
    () => (customerId ? computeCustomerMarginDiagnosis(data, filters, customerId) : null),
    [data, filters, customerId],
  )

  const contractHealth = useMemo(
    () => (customerId ? computeCustomerContractHealth(data, filters, customerId) : null),
    [data, filters, customerId],
  )

  const customerComp = useMemo(
    () => (customerId ? computeCustomerCommission(data, filters, customerId) : null),
    [data, filters, customerId],
  )

  const diagnosis = useMemo(() => {
    if (!health || !revBridge || !marginDiag || !profile) return null
    return buildCustomerDiagnosis(health, revBridge, marginDiag, profile.riskTypes, {
      industry: profile.industry,
    })
  }, [health, revBridge, marginDiag, profile])

  const asOf = data.meta.as_of_date ?? '2026-11-05'
  const healthV2 = useMemo(
    () =>
      health && customerId
        ? computeHealthV2ForCustomer(health, customerId, asOf, profile?.daysUntilRenewal)
        : null,
    [health, customerId, asOf, profile?.daysUntilRenewal],
  )

  const engagementEvents = useMemo(
    () => (customerId ? listCustomerEngagementEvents(customerId, asOf) : []),
    [customerId, asOf],
  )

  const ramp = useMemo(
    () => (customerId ? computeCustomerRamp(data, filters, customerId) : null),
    [data, filters, customerId],
  )

  const cust = data.customers.find((c) => c.customer_id === customerId)
  const brands = data.brands?.filter((b) => b.customer_id === customerId) ?? []
  const contracts = data.contracts.filter((c) => c.customer_id === customerId)

  const ships = useMemo(() => filterShipments(data, custFilters), [data, custFilters])
  const lines = useMemo(() => filterBillingLines(data, custFilters), [data, custFilters])
  const costs = useMemo(() => filterCosts(data, custFilters), [data, custFilters])
  const exceptions = useMemo(() => filterExceptions(data, custFilters), [data, custFilters])
  const openExceptions = exceptions.filter(
    (e) => e.status === 'Open' || e.status === 'Investigating' || e.status === 'Pending Approval',
  )

  const netBilling = sumMoney(lines.map((l) => l.net_amount))
  const shipPkgs = sumMoney(ships.map((s) => s.package_count))
  const deliveredPkgs = sumMoney(
    ships.filter((s) => s.delivery_status === 'Delivered').map((s) => s.package_count),
  )
  const onTimePkgs = sumMoney(ships.filter((s) => s.on_time).map((s) => s.package_count))
  const firstAttempt = sumMoney(
    ships.filter((s) => s.first_attempt_success).map((s) => s.package_count),
  )

  const openAr = profile?.openAr ?? 0
  const overdueAr = profile?.overdueAr ?? 0

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

  useEffect(() => {
    if (customerId) setDemoActions(loadDemoActions(customerId))
  }, [customerId])

  const persistActions = (next: DemoAction[]) => {
    if (!customerId) return
    setDemoActions(next)
    try {
      localStorage.setItem(actionsStorageKey(customerId), JSON.stringify(next))
    } catch {
      /* demo only */
    }
  }

  const addDemoAction = () => {
    const title = newActionTitle.trim()
    if (!title || !customerId) return
    const next: DemoAction[] = [
      {
        id: `ACT-${Date.now()}`,
        title,
        createdAt: new Date().toISOString().slice(0, 10),
        status: 'Open',
      },
      ...demoActions,
    ]
    persistActions(next)
    setNewActionTitle('')
  }

  if (!customerId || !cust || !health || !profile) {
    return (
      <div className="space-y-4">
        <PageHeader path="/customer-360" scope="Select a customer to open the investigation workspace" />
        <p className="text-sm text-ink-muted">No customer selected.</p>
      </div>
    )
  }

  const topDrivers = diagnosis?.topDrivers.slice(0, 3) ?? []
  const recommended = [
    ...new Set([...health.recommendedActions, ...(diagnosis ? [] : [])]),
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        path="/customer-360"
        scope="Five-layer investigation · Synthetic engagement · Health v1 + contract risk are separate scores"
        actions={
          <div className="flex flex-wrap gap-2">
            <DrilldownLink
              to="/customers"
              label="Back to Portfolio"
              onClick={() =>
                navigateWithContext('/customers', {
                  highlightCustomerId: customerId,
                  sourcePage: '/customer-360',
                })
              }
            />
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
              onClick={() =>
                exportToCsv(`customer_360_${cust.customer_id}.csv`, [
                  {
                    customer_id: cust.customer_id,
                    health: health.healthScore,
                    scenario_rar: health.scenarioRevenueAtRisk,
                    open_ar: openAr,
                    overdue_ar: overdueAr,
                    contract_risk_score: contractHealth?.contractRiskScore,
                    health_v2: healthV2?.score,
                    period: `${filters.startPeriod}_${filters.endPeriod}`,
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
        <Meta label="Segment" value={cust.segment} />
        <Meta label="Industry" value={profile.industry} />
        <Meta label="Sales Rep / Owner" value={cust.account_owner} />
        <Meta
          label="Contract renewal"
          value={
            profile.daysUntilRenewal == null
              ? '—'
              : `${profile.daysUntilRenewal}d · ${contractHealth?.renewalStatus ?? '—'}`
          }
        />
        {cust.illustrative && (
          <span className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            Illustrative · synthetic figures
          </span>
        )}
      </div>

      {customerComp && (
        <Collapsible
          title="Sales compensation (account)"
          subtitle="Eligible Revenue & commission expense for this customer — not deducted again from Contribution Margin"
        >
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi label="Sales Rep" value={customerComp.repName} />
            <Kpi label="Eligible Revenue" value={formatCurrency(customerComp.eligibleRevenue, true)} sub="Net Billing residual + expansion" />
            <Kpi label="Commission Expense" value={formatCurrency(customerComp.commissionExpense, true)} />
            <Kpi label="Blended Rate" value={formatPercent(customerComp.blendedRate)} />
            <Kpi label="Clawback / Adj" value={formatCurrency(customerComp.adjustments, true)} />
          </div>
          <button
            type="button"
            className="mt-2 text-xs text-forest underline"
            onClick={() => navigateWithContext('/sales-compensation', { customerId })}
          >
            Open Sales Compensation module
          </button>
        </Collapsible>
      )}

      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-8">
        <Kpi label="Health" value={`${health.healthScore}`} sub={health.healthBand} />
        <Kpi label="Rev growth" value={formatPercent(health.revenueGrowth)} />
        <Kpi label="CM %" value={formatPercent(health.contributionMargin)} />
        <Kpi label="Scenario RaR" value={formatCurrency(health.scenarioRevenueAtRisk, true)} warn={health.scenarioRevenueAtRisk > 0} />
        <Kpi label="Net Billing" value={formatCurrency(netBilling, true)} />
        <Kpi
          label="Open AR"
          value={formatCurrency(openAr, true)}
          sub="Unpaid balance (any status ≠ Paid)"
        />
        <Kpi
          label="Overdue AR"
          value={formatCurrency(overdueAr, true)}
          warn={overdueAr > 0}
          sub="Status = Overdue only"
        />
        <div className="rounded-lg border border-[#e1e9e4] bg-white px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Risk types</div>
          <div className="mt-1">
            <RiskChips types={profile.riskTypes} />
          </div>
        </div>
      </div>

      <p className="rounded-lg bg-[#f5f8f5] px-3 py-2 text-xs text-ink-muted">
        <strong className="text-ink">Open AR ≠ Overdue AR.</strong> Open AR is remaining balance on unpaid
        invoices; Overdue AR uses invoices marked Overdue. Collection risk rules require overdue or aging — not
        open AR alone.
      </p>

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

      {tab === 'diagnosis' && (
        <div className="space-y-4">
          <ChartCard title="Executive diagnosis" subtitle="Auto-generated from health + bridges">
            <p className="text-[13px] leading-relaxed text-ink">{diagnosis?.summary}</p>
          </ChartCard>

          <div className="grid gap-3 md:grid-cols-3">
            {topDrivers.map((d) => (
              <button
                key={d.detailKey + d.name}
                type="button"
                className={`rounded-xl border border-[#e1e9e4] bg-white p-4 text-left hover:border-brand-700/40 ${
                  detailKey === d.detailKey ? 'ring-2 ring-brand-700/30' : ''
                }`}
                onClick={() => {
                  setDetailKey(d.detailKey)
                  setTab(tabForDetailKey(d.detailKey))
                }}
              >
                <p className="text-[10px] font-semibold uppercase text-ink-muted">Risk driver</p>
                <p className="mt-1 font-semibold text-ink">{d.name}</p>
                <p className="mt-1 font-mono text-sm">{String(d.currentValue ?? '—')}</p>
                <p className="mt-1 text-xs text-ink-muted">{d.priorCompare}</p>
                <span
                  className={`mt-2 inline-block rounded px-1.5 py-0.5 text-[10px] uppercase ${
                    d.healthImpact === 'high'
                      ? 'bg-red-50 text-danger'
                      : d.healthImpact === 'medium'
                        ? 'bg-amber-50 text-warning'
                        : 'bg-[#f5f8f5] text-ink-muted'
                  }`}
                >
                  {d.healthImpact} impact
                </span>
              </button>
            ))}
          </div>

          <ChartCard title="Account structure" subtitle="Bill-to vs brands">
            <dl className="grid grid-cols-2 gap-2 text-[13px]">
              <div>
                <dt className="text-ink-muted">Bill-to</dt>
                <dd className="font-medium">{cust.customer_name}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Parent</dt>
                <dd className="font-medium">{cust.parent_account_name}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-ink-muted">Brands</dt>
                <dd className="mt-1">
                  {brands.length
                    ? brands.map((b) => (
                        <span key={b.brand_id} className="mr-1 inline-block rounded bg-[#f5f8f5] px-1.5 py-0.5 text-xs">
                          {b.brand_name}
                        </span>
                      ))
                    : 'Direct shipper'}
                </dd>
              </div>
            </dl>
          </ChartCard>
        </div>
      )}

      {tab === 'changes' && (
        <ChartCard title="Volume & Net Billing trend" subtitle={`${filters.startPeriod} → ${filters.endPeriod}`}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={volumeTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="l" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v, name) => (name === 'Net Billing' ? formatCurrencyPrecise(Number(v)) : formatNumber(Number(v)))} />
                <Legend />
                <Bar yAxisId="l" dataKey="volume" name="Packages" fill="#A8C5B5" isAnimationActive={false} />
                <Line yAxisId="r" type="monotone" dataKey="revenue" name="Net Billing" stroke="#123C35" strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {revBridge && (
            <p className="mt-2 text-xs text-ink-muted">
              Period bridge: {formatCurrency(revBridge.revenueChange, true)} ({revBridge.currentLabel} vs{' '}
              {revBridge.priorLabel})
            </p>
          )}
        </ChartCard>
      )}

      {tab === 'why' && (
        <div className="space-y-4">
          {revBridge && (
            <ChartCard
              title="Revenue driver bridge"
              subtitle={revBridge.comparable ? revBridge.note : revBridge.note}
            >
              {revBridge.comparable ? (
                <FloatingWaterfall steps={revBridge.waterfall} height={260} totalKeys={['prior', 'current']} />
              ) : (
                <p className="text-sm text-ink-muted">{revBridge.note}</p>
              )}
            </ChartCard>
          )}

          {revBridge && (
            <Collapsible title="Volume breakdown (metro / station / service)" subtitle="Largest absolute volume deltas">
              {(['metro', 'station', 'service'] as const).map((dim) => {
                const rows = revBridge.volumeBreakdown.filter((r) => r.dimension === dim).slice(0, 12)
                return (
                  <div key={dim} className="mb-3">
                    <p className="text-xs font-semibold uppercase text-ink-muted">{dim}</p>
                    <DataTable
                      rows={rows.map((r) => ({ ...r, id: r.key }))}
                      rowKey={(r) => r.key}
                      defaultPageSize={8}
                      columns={[
                        { key: 'l', header: 'Label', render: (r) => r.label },
                        { key: 'p', header: 'Prior vol', align: 'right', render: (r) => formatNumber(r.priorVolume) },
                        { key: 'c', header: 'Current vol', align: 'right', render: (r) => formatNumber(r.currentVolume) },
                        { key: 'd', header: 'Δ', align: 'right', render: (r) => formatNumber(r.volumeDelta) },
                      ]}
                      onRowClick={
                        dim === 'metro'
                          ? (r) =>
                              setFilters({
                                ...filters,
                                customerIds: [customerId],
                                metros: [r.label],
                                stations: [],
                              })
                          : undefined
                      }
                    />
                  </div>
                )
              })}
            </Collapsible>
          )}

          {marginDiag && (
            <ChartCard title="Margin driver bridge" subtitle={marginDiag.note}>
              {marginDiag.comparable ? (
                <FloatingWaterfall steps={marginDiag.waterfall} height={280} totalKeys={['prior', 'current']} />
              ) : (
                <p className="text-sm text-ink-muted">{marginDiag.note}</p>
              )}
            </ChartCard>
          )}

          {marginDiag && (
            <div className="grid gap-2 sm:grid-cols-4">
              <Kpi label="RPP" value={marginDiag.unitEconomics.rpp != null ? formatCurrencyPrecise(marginDiag.unitEconomics.rpp) : 'N/A'} />
              <Kpi label="CPP (variable)" value={marginDiag.unitEconomics.cpp != null ? formatCurrencyPrecise(marginDiag.unitEconomics.cpp) : 'N/A'} />
              <Kpi label="Contrib / pkg" value={marginDiag.unitEconomics.contributionPerPackage != null ? formatCurrencyPrecise(marginDiag.unitEconomics.contributionPerPackage) : 'N/A'} />
              <Kpi label="CM %" value={formatPercent(marginDiag.unitEconomics.contributionMarginPct)} />
            </div>
          )}

          {marginDiag && marginDiag.geoProfitability.length > 0 && (
            <ChartCard title="Geographic profitability" subtitle="Click metro to filter">
              <DataTable
                rows={marginDiag.geoProfitability.map((r) => ({ ...r, id: r.metro }))}
                rowKey={(r) => r.metro}
                columns={[
                  { key: 'm', header: 'Metro', render: (r) => r.metro },
                  { key: 's', header: 'Shipments', align: 'right', render: (r) => formatNumber(r.shipments) },
                  { key: 'r', header: 'Net billing', align: 'right', render: (r) => formatCurrency(r.netRevenue, true) },
                  { key: 'c', header: 'Contrib.', align: 'right', render: (r) => formatCurrency(r.contributionProfit, true) },
                  { key: 'cm', header: 'CM %', align: 'right', render: (r) => formatPercent(r.contributionMarginPct) },
                ]}
                onRowClick={(r) =>
                  setFilters({ ...filters, customerIds: [customerId], metros: [r.metro], stations: [] })
                }
              />
            </ChartCard>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Operational KPIs">
              <div className="grid grid-cols-2 gap-2">
                <Kpi label="Delivered %" value={formatPercent(pct(deliveredPkgs, shipPkgs))} />
                <Kpi label="On-time %" value={formatPercent(pct(onTimePkgs, shipPkgs))} />
                <Kpi label="1st attempt %" value={formatPercent(pct(firstAttempt, shipPkgs))} />
                <Kpi label="Active stations" value={formatNumber(byStation.length)} />
              </div>
            </ChartCard>
            <ChartCard title="Billing exceptions" subtitle={`${openExceptions.length} open in period`}>
              <button
                type="button"
                className="text-sm text-brand-700 underline"
                onClick={() =>
                  navigateWithContext('/reconciliation', { customerId, sourcePage: '/customer-360' })
                }
              >
                Open Reconciliation for this customer
              </button>
              <ul className="mt-2 max-h-32 overflow-auto text-xs text-ink-muted">
                {exceptions.slice(0, 6).map((e) => (
                  <li key={e.exception_id}>
                    {e.exception_type}: {formatCurrencyPrecise(e.financial_impact)} · {e.status}
                  </li>
                ))}
              </ul>
            </ChartCard>
          </div>

          {ramp && (
            <Collapsible title="Contract ramp-up" subtitle={ramp.note}>
              <div className="grid gap-2 sm:grid-cols-4">
                <Kpi label="Expected mo vol" value={formatNumber(ramp.expectedMonthlyVolume)} />
                <Kpi label="Ramp attainment" value={formatPercent(ramp.rampUpAttainment)} />
              </div>
            </Collapsible>
          )}
        </div>
      )}

      {tab === 'at-risk' && (
        <div className="space-y-4">
          {contractHealth && (
            <ChartCard
              title="Contract health"
              subtitle="Utilization vs commitment — contract risk score is separate from customer health"
            >
              <div className="mb-3 grid gap-2 sm:grid-cols-4">
                <Kpi label="Contract risk score" value={String(contractHealth.contractRiskScore)} sub="Not health score" />
                <Kpi label="Commitment util." value={formatPercent(contractHealth.commitmentUtilization)} />
                <Kpi label="Monthly commitment" value={formatNumber(contractHealth.monthlyCommitment)} />
                <Kpi label="Renewal" value={contractHealth.renewalStatus} sub={contractHealth.daysUntilRenewal != null ? `${contractHealth.daysUntilRenewal}d` : undefined} />
              </div>
              <p className="text-xs text-ink-muted">{contractHealth.note}</p>
              {contractHealth.utilizationTrend.length > 0 && (
                <div className="mt-3 h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={contractHealth.utilizationTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} unit="%" />
                      <Tooltip formatter={(v) => formatPercent(Number(v))} />
                      <Bar dataKey="utilizationPct" fill="#123C35" name="Utilization %" isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>
          )}

          <ChartCard title="Engagement timeline" subtitle="Synthetic — deterministic demo events, not CRM-backed">
            <ul className="space-y-2 text-[13px]">
              {engagementEvents.map((e) => (
                <li key={e.eventId} className="flex flex-wrap gap-2 border-b border-[#eef4ef] pb-2">
                  <span className="font-mono text-xs text-ink-muted">{e.eventDate}</span>
                  <span className="font-medium">{e.eventType}</span>
                  <span className="rounded bg-amber-50 px-1 text-[10px] text-amber-800">Synthetic</span>
                  <span className="text-ink-muted">{e.sentiment}</span>
                  <span className="w-full text-xs text-ink-muted">{e.note}</span>
                </li>
              ))}
            </ul>
          </ChartCard>

          <ChartCard title="Scenario revenue at risk" subtitle="Assumed loss × forward revenue — not booked">
            <Kpi label="Scenario RaR" value={formatCurrency(health.scenarioRevenueAtRisk, true)} warn />
            <Collapsible title="Health score v2 (experimental)" subtitle="Renormalized weights · includes engagement when available">
              {healthV2 && (
                <>
                  <p className="mb-2 text-sm">
                    Score <strong>{healthV2.score}</strong> · {healthV2.band} · completeness{' '}
                    {healthV2.dataCompleteness}%
                  </p>
                  <table className="w-full text-[13px]">
                    <thead className="text-xs uppercase text-ink-muted">
                      <tr>
                        <th className="text-left">Component</th>
                        <th className="text-right">Score</th>
                        <th className="text-right">Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.keys(DEFAULT_HEALTH_V2_WEIGHTS) as (keyof typeof DEFAULT_HEALTH_V2_WEIGHTS)[]).map(
                        (k) => (
                          <tr key={k} className="border-t border-slate-100">
                            <td className="py-1">{k}</td>
                            <td className="py-1 text-right font-mono">
                              {healthV2.components[k] == null ? 'N/A' : Math.round(healthV2.components[k]!)}
                            </td>
                            <td className="py-1 text-right font-mono">
                              {(healthV2.weightsUsed[k] * 100).toFixed(1)}%
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                  <ul className="mt-2 list-disc pl-4 text-xs text-ink-muted">
                    {healthV2.explanations.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </>
              )}
            </Collapsible>
          </ChartCard>

          <ChartCard title="Collections posture">
            <div className="grid gap-2 sm:grid-cols-2">
              <Kpi label="Open AR" value={formatCurrency(openAr, true)} sub="Any unpaid invoice balance" />
              <Kpi label="Overdue AR" value={formatCurrency(overdueAr, true)} warn sub="Overdue status only" />
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              A large Open AR with zero Overdue AR may still be within terms — do not treat Open AR as delinquency.
            </p>
          </ChartCard>
        </div>
      )}

      {tab === 'actions' && (
        <div className="space-y-4">
          <ChartCard title="Recommended actions" subtitle="From health rules + diagnosis">
            <ul className="list-disc space-y-1 pl-4 text-[13px] text-ink-muted">
              {recommended.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </ChartCard>

          <ChartCard title="Investigation links" subtitle="Preserves customer context">
            <div className="flex flex-wrap gap-2">
              <DrilldownLink to="/lifecycle" label="Lifecycle" onClick={() => navigateWithContext('/lifecycle', { customerId, sourcePage: '/customer-360' })} />
              <DrilldownLink to="/reconciliation" label="Reconciliation" onClick={() => navigateWithContext('/reconciliation', { customerId, sourcePage: '/customer-360' })} />
              <DrilldownLink to="/forecasting" label="Forecasting" onClick={() => navigateWithContext('/forecasting', { customerId, sourcePage: '/customer-360' })} />
              <DrilldownLink to="/unit-economics" label="Unit Economics" onClick={() => navigateWithContext('/unit-economics', { customerId, sourcePage: '/customer-360' })} />
              <DrilldownLink to="/actions" label="Action Center" onClick={() => navigateWithContext('/actions', { customerId, sourcePage: '/customer-360' })} />
            </div>
          </ChartCard>

          <ChartCard title="Demo action tracker" subtitle="Stored in localStorage — may clear on refresh or new browser profile">
            <div className="flex flex-wrap gap-2">
              <input
                className="filter-input min-w-[200px] flex-1 text-sm"
                placeholder="New action title…"
                value={newActionTitle}
                onChange={(e) => setNewActionTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addDemoAction()}
              />
              <button type="button" className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-medium text-white" onClick={addDemoAction}>
                Add action
              </button>
            </div>
            <ul className="mt-3 space-y-1 text-[13px]">
              {demoActions.length === 0 && <li className="text-ink-muted">No demo actions yet.</li>}
              {demoActions.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded border border-[#e1e9e4] px-2 py-1">
                  <span>{a.title}</span>
                  <span className="text-xs text-ink-muted">{a.createdAt}</span>
                </li>
              ))}
            </ul>
          </ChartCard>

          <DrilldownLink
            to="/customers"
            label="← Back to Portfolio"
            onClick={() =>
              navigateWithContext('/customers', { highlightCustomerId: customerId, sourcePage: '/customer-360' })
            }
          />
        </div>
      )}

      {contracts.length > 0 && tab === 'diagnosis' && (
        <Collapsible title="Contracts on file" subtitle={`${contracts.length} contract(s)`}>
          <ul className="text-xs text-ink-muted">
            {contracts.map((c) => (
              <li key={c.contract_id}>
                {c.contract_id} · {c.pricing_model} · {c.start_date}→{c.end_date} · {c.status}
              </li>
            ))}
          </ul>
        </Collapsible>
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
      <div className={`mt-0.5 font-mono text-sm font-semibold ${warn ? 'text-danger' : 'text-ink'}`}>{value}</div>
      {sub && <div className="text-[11px] text-ink-muted">{sub}</div>}
    </div>
  )
}
