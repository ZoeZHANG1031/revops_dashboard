import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
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
import { filterShipments } from '@/lib/filters'
import {
  computeLifecycleStages,
  STATUS_RULE,
  type LifecycleDetail,
  type LifecycleMonth,
  type LifecycleUnit,
} from '@/calc/lifecycleStages'
import { computeTraceability } from '@/calc/kpis'
import { computeOperationalPipeline, computeSalesPipeline } from '@/calc/lifecycle'
import { computeCohortConversions } from '@/calc/salesCohort'
import { StatTile } from '@/components/common/StatTile'
import { ChartCard } from '@/components/common/ChartCard'
import { DataTable } from '@/components/common/DataTable'
import {
  InteractiveBusinessFlow,
  type FlowGap,
  type FlowStage,
} from '@/components/common/InteractiveBusinessFlow'
import { Collapsible } from '@/components/common/Collapsible'
import { DrilldownLink } from '@/components/common/DrilldownLink'
import { ModuleSubNav } from '@/components/layout/ModuleSubNav'
import { PageHeader } from '@/components/common/PageHeader'
import { REVENUE_PERFORMANCE_NAV } from '@/lib/icons'
import { TraceabilityChain } from '@/components/common/TraceabilityChain'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { PALETTE } from '@/lib/icons'
import { formatCurrency, formatCurrencyPrecise, formatNumber, formatPercent } from '@/lib/money'
import type { FactException } from '@/types'

export function RevenueLifecycle() {
  const { data, filters, scenario, navigateToEntity, navigateWithContext, openCustomer360, openEntity } = useApp()
  const [pipeMetric, setPipeMetric] = useState<'value' | 'count'>('value')
  const sales = useMemo(() => computeSalesPipeline(data), [data])
  const cohort = useMemo(() => computeCohortConversions(data), [data])
  const ops = useMemo(() => computeOperationalPipeline(data, filters), [data, filters])
  // Selected Revenue Record — arriving with openEntity=recognition pre-selects the lineage
  const [selectedRev, setSelectedRev] = useState<string | null>(() =>
    openEntity?.entityType === 'recognition' ? openEntity.entityId : null,
  )
  useEffect(() => {
    if (openEntity?.entityType === 'recognition') {
      document.getElementById('revenue-traceability')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [openEntity])
  const [stageKey, setStageKey] = useState<string | null>(null)
  const [showAllRates, setShowAllRates] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)

  const activeRates = useMemo(() => {
    const today = data.meta.snapshot_label.slice(0, 10) || '2024-11-05'
    const active = data.rateCards.filter(
      (r) => r.effective_from <= today && r.effective_to >= today,
    )
    return showAllRates ? data.rateCards : active
  }, [data, showAllRates])

  const stageRecords = useMemo(() => {
    if (!stageKey) return []
    // Shared filter helper — honors date, customer, region, metro and service filters
    const ships = filterShipments(data, filters)
    const billedIds = new Set(
      data.billingLines
        .filter((b) => !b.is_duplicate)
        .map((b) => b.shipment_id),
    )
    if (stageKey === 'billable') return ships.filter((s) => s.billable).slice(0, 40)
    if (stageKey === 'billed') return ships.filter((s) => billedIds.has(s.shipment_id)).slice(0, 40)
    if (stageKey === 'missing_billing')
      return ships.filter((s) => s.billable && !billedIds.has(s.shipment_id)).slice(0, 40)
    if (stageKey === 'shipments') return ships.slice(0, 40)
    return ships.slice(0, 40)
  }, [stageKey, data, filters])

  const headerRev = useMemo(
    () =>
      data.revenueRecognition.filter(
        (r) =>
          r.billing_line_id === null &&
          r.accounting_period >= filters.startPeriod &&
          r.accounting_period <= filters.endPeriod &&
          (filters.customerIds.length === 0 || filters.customerIds.includes(r.customer_id)),
      ),
    [data, filters],
  )

  const trace = selectedRev ? computeTraceability(data, selectedRev) : null

  const lifecycle = useMemo(
    () => computeLifecycleStages(data, filters, scenario),
    [data, filters, scenario],
  )
  const fmtVal = (v: number | null, unit: LifecycleUnit) =>
    v == null
      ? 'N/A'
      : unit === 'money'
        ? formatCurrency(v, true)
        : unit === 'percent'
          ? formatPercent(v)
          : formatNumber(v)

  const toggleFocus = (id: string) => setFocusId((cur) => (cur === id ? null : id))

  const lifecycleFlow: FlowStage[] = lifecycle.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    activity: n.activity,
    metricLabel: n.metricLabel,
    metricValue: fmtVal(n.value, n.unit),
    available: true,
    status: n.status,
    statusLabel: n.statusLabel,
    exceptionCount: n.openExceptions,
    onClick: () => toggleFocus(n.id),
  }))
  const lifecycleGaps: FlowGap[] = lifecycle.gaps.map((g) => ({
    id: g.id,
    label: g.label,
    value: fmtVal(g.value, g.unit),
    tone: g.tone,
    title: g.title,
    onClick: () => toggleFocus(g.id),
  }))
  const focus = focusId ? lifecycle.details[focusId as keyof typeof lifecycle.details] : null

  // Computed insights
  const hotStage = [...lifecycle.nodes].sort((a, b) => b.openExceptions - a.openExceptions)[0]
  const alertGap = lifecycle.gaps.find((g) => g.tone === 'alert') ?? lifecycle.gaps.find((g) => g.tone === 'watch')
  const flowInsight = hotStage
    ? `${hotStage.label} carries the most open exceptions (${formatNumber(hotStage.openExceptions)})${
        alertGap ? `; ${alertGap.label} at ${fmtVal(alertGap.value, alertGap.unit)} needs attention` : ''
      }.`
    : null
  const openStock = sales.stageStock.filter((st) => !st.stage.startsWith('Closed'))
  const biggestOpen = [...openStock].sort((a, b) => b.value - a.value)[0]
  const pipeInsight = biggestOpen
    ? `${formatCurrency(sales.pipelineValue, true)} open pipeline (${formatCurrency(sales.weightedPipeline, true)} weighted); most value sits in ${biggestOpen.stage}. Win rate ${formatPercent(sales.winRate)}.`
    : null

  return (
    <div className="space-y-5">
      <ModuleSubNav items={REVENUE_PERFORMANCE_NAV} />
      <PageHeader
        path="/lifecycle"
        scope="Commercial pipeline → contract activation → operational lifecycle · TCV ≠ revenue · Net Billing ≠ Recognized ≠ Cash"
        actions={
          <>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
              onClick={() => navigateWithContext('/sales-compensation')}
            >
              Sales Compensation
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
              onClick={() =>
                exportToCsv(
                  'lifecycle_stages.csv',
                  lifecycleFlow.map((s) => ({
                    stage: s.label,
                    metric: s.metricValue,
                    activity: s.activity,
                    period: `${filters.startPeriod}_${filters.endPeriod}`,
                    disclaimer: 'Synthetic aggregate',
                  })),
                )
              }
            >
              Export Stages
            </button>
          </>
        }
      />

      <ChartCard
        icon="revenue"
        title="Operational Revenue Lifecycle"
        emphasis
        insight={flowInsight}
        businessQuestion="Where does value stall between contract and cash?"
        subtitle="Click a stage or a between-stage indicator for source, logic, trend and exceptions"
        recommendedAction={STATUS_RULE}
        formula="Each stage uses its own date basis — differences are classified (timing / unbilled / adjustment / AR / recoverable), never netted as loss"
        source="dim_contract, fact_shipment, fact_billing_line, fact_revenue_recognition, fact_invoice, fact_payment, fact_exception"
        timeBasis={`${filters.startPeriod} → ${filters.endPeriod}`}
      >
        <InteractiveBusinessFlow
          stages={lifecycleFlow}
          gaps={lifecycleGaps}
          selectedId={focusId}
          size="large"
          title=""
          subtitle=""
        />
        {focus && (
          <LifecycleDetailPanel
            detail={focus}
            months={lifecycle.months}
            exceptions={lifecycle.openExceptions.filter((e) => focus.exceptionTypes.includes(e.exception_type))}
            customerName={(id) => data.customers.find((c) => c.customer_id === id)?.customer_name ?? id}
            fmtVal={fmtVal}
            onClose={() => setFocusId(null)}
            onReconciliation={(exceptionType) =>
              navigateWithContext('/reconciliation', {
                exceptionType,
                exceptionStatus: 'Open',
                sourcePage: '/lifecycle',
                toast: `From Lifecycle · ${focus.title}`,
              })
            }
            onException={(e) =>
              navigateWithContext('/reconciliation', {
                exceptionType: e.exception_type,
                exceptionStatus: e.status,
                customerId: e.customer_id,
                openEntity: { entityType: 'exception', entityId: e.exception_id, label: e.exception_type },
                sourcePage: '/lifecycle',
              })
            }
            onCustomer={(customerId) => openCustomer360(customerId)}
            onShipment={(id) => navigateToEntity('shipment', id, id)}
            onShowRecords={
              focus.id === 'shipment'
                ? () => setStageKey('shipments')
                : focus.id === 'gap_shipment_rating'
                  ? () => setStageKey('missing_billing')
                  : focus.id === 'billing'
                    ? () => setStageKey('billed')
                    : undefined
            }
          />
        )}
      </ChartCard>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <Stat label="Pipeline Value" value={formatCurrency(sales.pipelineValue, true)} />
        <Stat label="Weighted Pipeline" value={formatCurrency(sales.weightedPipeline, true)} hint="Value × Win % · ≠ revenue" />
        <Stat label="Win Rate" value={formatPercent(sales.winRate)} />
        <Stat
          label="Avg Sales Cycle"
          value={sales.salesCycleLength != null ? `${sales.salesCycleLength} days` : '—'}
        />
        <Stat
          label="Pipeline Coverage"
          value={formatPercent(sales.pipelineCoverage)}
          hint={sales.pipelineCoverageNote}
        />
        <Stat
          label="Past-due close"
          value={formatNumber(sales.pastDueClose)}
          hint="Open opps with expected start before as-of"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          icon="salesPipeline"
          title="Commercial Pipeline · Lead → Closed Won"
          insight={pipeInsight}
          subtitle="Current stage stock (independent snapshot, not a cascading funnel). Closed Won feeds contract activation → Operational lifecycle."
          businessQuestion="Where does open pipeline sit today, and what closed?"
          formula="Weighted = Opportunity Value × Win Probability (bookings potential ≠ revenue)"
          source="fact_opportunity"
          action={
            <div className="flex gap-1" role="tablist" aria-label="Pipeline metric">
              {(['value', 'count'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={pipeMetric === k}
                  onClick={() => setPipeMetric(k)}
                  className={`rounded-md px-2 py-1 text-[13px] ${pipeMetric === k ? 'bg-forest text-white' : 'border border-[#dce6df] text-ink-muted'}`}
                >
                  {k === 'value' ? 'Pipeline Value' : 'Opportunity Count'}
                </button>
              ))}
            </div>
          }
        >
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sales.stageStock} layout="vertical" margin={{ left: 4, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 12 }}
                  allowDecimals={false}
                  tickFormatter={(v) => (pipeMetric === 'value' ? `$${(Number(v) / 1000).toFixed(0)}k` : String(v))}
                />
                <YAxis type="category" dataKey="stage" width={86} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(v, name) => [pipeMetric === 'value' ? formatCurrencyPrecise(Number(v)) : formatNumber(Number(v)), String(name)]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar isAnimationActive={false} dataKey={pipeMetric === 'value' ? 'value' : 'count'} name={pipeMetric === 'value' ? 'Stage value' : 'Opportunities'} radius={[0, 4, 4, 0]}>
                  {sales.stageStock.map((st) => (
                    <Cell
                      key={st.stage}
                      fill={st.stage === 'Closed Won' ? PALETTE.positive : st.stage === 'Closed Lost' ? PALETTE.muted : PALETTE.brand}
                    />
                  ))}
                </Bar>
                {pipeMetric === 'value' && <Bar isAnimationActive={false} dataKey="weighted" name="Weighted (open only meaningful)" fill={PALETTE.forecastLight} radius={[0, 4, 4, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-ink-muted">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: PALETTE.brand }} />Open stages</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: PALETTE.positive }} />Closed Won</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: PALETTE.muted }} />Closed Lost</span>
          </div>
          <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            Stage stock ratios are <strong>not</strong> conversion rates. Cohort conversions below come from
            opportunity stage-history events ({formatNumber(data.opportunityStageEvents.length)} events).
          </div>
          <div className="mt-3">
            <p className="text-xs font-semibold text-ink mb-1">Cohort conversions (from stage events)</p>
            <div className="grid grid-cols-2 gap-2 text-[13px]">
              {cohort.conversions.map((c) => (
                <div key={`${c.from}-${c.to}`} className="rounded bg-[#f5f8f5] px-2 py-1.5">
                  <div className="flex justify-between font-medium">
                    <span>
                      {c.from} → {c.to}
                    </span>
                    <span className="font-mono">{formatPercent(c.rate)}</span>
                  </div>
                  <p className="text-ink-muted">
                    {c.reachedTo}/{c.enteredFrom} opps · Win rate {formatPercent(cohort.winRate)} · Cycle{' '}
                    {cohort.avgSalesCycleDays ?? '—'}d
                  </p>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Closed Won logos: {sales.newCustomerAcquisition} · Open expected monthly revenue:{' '}
            {formatCurrency(sales.expectedMonthlyRevenue, true)} · Expected volume:{' '}
            {formatNumber(sales.expectedMonthlyVolume)} pkgs/mo
          </p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold text-ink">Stage aging (open stock)</p>
              <DataTable
                rows={sales.stageAging.map((r) => ({ ...r, id: r.stage }))}
                rowKey={(r) => r.stage}
                searchable={false}
                defaultPageSize={25}
                columns={[
                  { key: 's', header: 'Stage', render: (r) => r.stage },
                  {
                    key: 'n',
                    header: 'Opps',
                    align: 'right',
                    render: (r) => formatNumber(r.count),
                    sortValue: (r) => r.count,
                  },
                  {
                    key: 'a',
                    header: 'Avg days',
                    align: 'right',
                    render: (r) => (r.avgDays == null ? '—' : String(r.avgDays)),
                    sortValue: (r) => r.avgDays ?? -1,
                  },
                  {
                    key: 'm',
                    header: 'Median',
                    align: 'right',
                    render: (r) => (r.medianDays == null ? '—' : String(r.medianDays)),
                  },
                  {
                    key: 'st',
                    header: 'Stalled ≥45d',
                    align: 'right',
                    render: (r) => formatNumber(r.stalledCount),
                    sortValue: (r) => r.stalledCount,
                  },
                ]}
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-ink">Win / loss by segment</p>
              <DataTable
                rows={sales.winLossBySegment.map((r) => ({ ...r, id: r.segment }))}
                rowKey={(r) => r.segment}
                searchable={false}
                defaultPageSize={25}
                columns={[
                  { key: 's', header: 'Segment', render: (r) => r.segment },
                  {
                    key: 'w',
                    header: 'Win rate',
                    align: 'right',
                    render: (r) => formatPercent(r.winRate),
                    sortValue: (r) => r.winRate ?? -1,
                  },
                  {
                    key: 'won',
                    header: 'Won',
                    align: 'right',
                    render: (r) => formatNumber(r.won),
                  },
                  {
                    key: 'lost',
                    header: 'Lost',
                    align: 'right',
                    render: (r) => formatNumber(r.lost),
                  },
                  {
                    key: 'avg',
                    header: 'Avg won deal',
                    align: 'right',
                    render: (r) => (r.avgDeal == null ? '—' : formatCurrency(r.avgDeal, true)),
                  },
                ]}
              />
            </div>
          </div>
          <p className="mt-2 text-[12px] text-ink-muted">
            Target for coverage: {formatCurrency(sales.remainingSalesTarget, true)} (synthetic remaining
            bookings target — not a CRM quota table).
          </p>
        </ChartCard>

        <ChartCard
          icon="shipments"
          title="Operational Stage Records"
          subtitle="Same-unit conversions only (count→count, $→$). Click a stage to list underlying records."
        >
          <ol className="space-y-2">
            {ops.stages.map((s, i) => (
              <li key={s.key}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs hover:bg-brand-50 ${
                    stageKey === s.key ? 'bg-brand-50 ring-1 ring-brand-200' : 'bg-slate-50'
                  }`}
                  onClick={() => {
                    setStageKey(stageKey === s.key ? null : s.key)
                    if (s.key === 'billable' || s.key === 'billed' || s.key.includes('bill')) {
                      /* keep local stage list */
                    }
                  }}
                >
                  <span className="font-medium text-ink">
                    {i + 1}. {s.label}
                  </span>
                  <span className="font-mono text-brand-800">
                    {s.unit === 'money' ? formatCurrency(s.value, true) : formatNumber(s.value)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="mt-2 text-[13px] text-brand-700 hover:underline"
            onClick={() => {
              setStageKey('missing_billing')
              navigateWithContext('/reconciliation', {
                exceptionType: 'Missing Billing',
                exceptionStatus: 'Open',
              })
            }}
          >
            Investigate Billable → Billed gap (Missing Billing)
          </button>
          <div className="mt-3 space-y-1.5">
            {ops.conversions.map((c) => (
              <div key={c.from} className="flex items-start justify-between gap-2 text-xs">
                <div>
                  <p className="font-medium text-ink">{c.from}</p>
                  <p className="text-ink-muted">{c.leakage}</p>
                </div>
                <span className="font-mono">{formatPercent(c.rate)}</span>
              </div>
            ))}
          </div>
          {stageKey && stageRecords.length > 0 && (
            <div className="mt-3 rounded-lg border border-[#dce6df] p-2">
              <p className="mb-1 text-[13px] font-semibold text-ink">
                Stage records · {stageKey} ({stageRecords.length})
              </p>
              <DataTable
                rows={stageRecords.map((s) => ({ ...s, id: s.shipment_id }))}
                rowKey={(r) => r.shipment_id}
                onRowClick={(r) => navigateToEntity('shipment', r.shipment_id, r.shipment_id)}
                columns={[
                  { key: 'id', header: 'Shipment', render: (r) => r.shipment_id },
                  { key: 'cust', header: 'Customer', render: (r) => r.customer_id },
                  { key: 'svc', header: 'Service', render: (r) => r.service_type },
                  { key: 'date', header: 'Ship Date', render: (r) => r.ship_date },
                  { key: 'st', header: 'Status', render: (r) => r.delivery_status },
                ]}
              />
            </div>
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="Pricing Rules in Force"
        subtitle="Default: currently effective versions only. Match ship_date to effective window — not latest."
        action={
          <button
            type="button"
            className="text-xs text-brand-700"
            onClick={() => setShowAllRates((v) => !v)}
          >
            {showAllRates ? 'Show active only' : 'Show all versions'}
          </button>
        }
      >
        <DataTable
          rows={activeRates.slice(0, 40).map((r) => ({ ...r, id: r.rate_card_id }))}
          rowKey={(r) => r.rate_card_id}
          onRowClick={(r) => navigateToEntity('rate_card', r.rate_card_id, r.rate_card_id)}
          columns={[
            { key: 'id', header: 'Rate Card', render: (r) => r.rate_card_id },
            { key: 'con', header: 'Contract', render: (r) => r.contract_id },
            { key: 'svc', header: 'Service', render: (r) => r.service_type },
            { key: 'reg', header: 'Region', render: (r) => r.region },
            {
              key: 'base',
              header: 'Base',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.base_rate),
              sortValue: (r) => r.base_rate,
            },
            {
              key: 'fuel',
              header: 'Fuel %',
              align: 'right',
              render: (r) => formatPercent(r.fuel_surcharge_pct * 100),
            },
            { key: 'ver', header: 'Ver', render: (r) => String(r.version) },
            {
              key: 'eff',
              header: 'Effective',
              render: (r) => `${r.effective_from} → ${r.effective_to}`,
            },
          ]}
        />
      </ChartCard>

      <ChartCard
        id="revenue-traceability"
        icon="traceability"
        title="Revenue Traceability"
        businessQuestion="Can every recognized dollar be traced to a shipment and rate card?"
        subtitle="Select a recognition record, then click a node: Recognition → GL → Invoice → Billing Line → Shipment → Rate Card"
      >
        {trace ? (
          <div className="mb-3">
            <TraceabilityChain trace={trace} onOpenRecord={(type, id) => navigateToEntity(type, id, id)} />
            <div className="mt-1.5 flex justify-end">
              <DrilldownLink to="/customers" label="Customer 360" onClick={() => openCustomer360(trace.header.customer_id)} />
            </div>
          </div>
        ) : (
          <p className="mb-3 rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-ink-muted">
            Select a recognition record below to see its lineage.
          </p>
        )}
        <DataTable
          rows={headerRev.map((r) => ({ ...r, id: r.rev_rec_id }))}
          rowKey={(r) => r.rev_rec_id}
          selectedKey={selectedRev}
          onRowClick={(r) => setSelectedRev(selectedRev === r.rev_rec_id ? null : r.rev_rec_id)}
          columns={[
            { key: 'id', header: 'Rev Rec ID', render: (r) => r.rev_rec_id },
            {
              key: 'cust',
              header: 'Customer',
              render: (r) =>
                data.customers.find((c) => c.customer_id === r.customer_id)?.customer_name ?? r.customer_id,
            },
            { key: 'period', header: 'Period', render: (r) => r.accounting_period },
            { key: 'type', header: 'Type', render: (r) => r.recognition_type },
            {
              key: 'amt',
              header: 'Amount',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.amount),
              sortValue: (r) => r.amount,
            },
            { key: 'inv', header: 'Invoice', render: (r) => r.invoice_id ?? '—' },
          ]}
        />

        {trace && (
          <Collapsible title="Raw lineage text" subtitle="All linked records as text (auxiliary view)">
          <div className="space-y-3 text-xs">
            <p className="font-semibold text-ink">
              Trace for {trace.header.rev_rec_id} · {formatCurrencyPrecise(trace.header.amount)}
            </p>
            <TraceBlock title="GL Entries" rows={trace.gl.map((g) => `${g.gl_entry_id} ${g.account_name}: Dr ${g.debit} / Cr ${g.credit}`)} />
            <TraceBlock
              title="Invoice"
              rows={
                trace.invoice
                  ? [
                      `${trace.invoice.invoice_id} net ${formatCurrencyPrecise(trace.invoice.net_amount)} (${trace.invoice.status})`,
                    ]
                  : ['—']
              }
            />
            <TraceBlock
              title="Billing Lines"
              rows={trace.billingLines.map(
                (b) =>
                  `${b!.billing_line_id} · ${b!.shipment_id} · net ${formatCurrencyPrecise(b!.net_amount)} = base ${b!.base_charge} + fuel ${b!.fuel_surcharge} + remote ${b!.remote_surcharge} − disc ${b!.discounts} − credits ${b!.credits}`,
              )}
            />
            <TraceBlock
              title="Shipments"
              rows={trace.shipments.map(
                (s) =>
                  `${s!.shipment_id} · ${s!.service_type} · ${s!.region} Z${s!.zone} · ${s!.weight_lbs} lb · ${s!.delivery_status}`,
              )}
            />
            <TraceBlock
              title="Rate Cards"
              rows={trace.rateCards.map(
                (r) =>
                  `${r!.rate_card_id} v${r!.version} base ${r!.base_rate} /lb ${r!.per_lb_rate} fuel ${(r!.fuel_surcharge_pct * 100).toFixed(1)}% (${r!.effective_from}→${r!.effective_to})`,
              )}
            />
          </div>
        </Collapsible>
        )}
      </ChartCard>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <StatTile label={label} value={value} hint={hint} />
}

function TraceBlock({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div>
      <p className="font-semibold text-brand-900">{title}</p>
      <ul className="mt-1 max-h-28 overflow-auto font-mono text-xs text-ink-muted">
        {rows.slice(0, 12).map((r) => (
          <li key={r}>{r}</li>
        ))}
        {rows.length > 12 && <li>… +{rows.length - 12} more</li>}
      </ul>
    </div>
  )
}

function LifecycleDetailPanel({
  detail,
  months,
  exceptions,
  customerName,
  fmtVal,
  onClose,
  onReconciliation,
  onException,
  onCustomer,
  onShowRecords,
  onShipment,
}: {
  onShipment?: (shipmentId: string) => void
  detail: LifecycleDetail
  months: LifecycleMonth[]
  exceptions: FactException[]
  customerName: (id: string) => string
  fmtVal: (v: number | null, unit: LifecycleUnit) => string
  onClose: () => void
  onReconciliation: (exceptionType: string | null) => void
  onException: (e: FactException) => void
  onCustomer: (customerId: string) => void
  onShowRecords?: () => void
}) {
  const SERIES: Record<LifecycleDetail['trendKeys'][number], { name: string; color: string; money: boolean }> = {
    shipments: { name: 'Shipments', color: '#123C35', money: false },
    billable: { name: 'Billable', color: '#00A86B', money: false },
    netBilling: { name: 'Net Billing', color: '#123C35', money: true },
    recognized: { name: 'Recognized', color: '#00A86B', money: true },
    cash: { name: 'Cash collected', color: '#E58A2B', money: true },
  }
  const moneyTrend = detail.trendKeys.some((k) => SERIES[k].money)
  const openImpact = exceptions.reduce((a, e) => a + e.financial_impact, 0)
  const ranked = [...exceptions].sort((a, b) => b.financial_impact - a.financial_impact)
  const reasons = [...exceptions.reduce((m, e) => {
    const cur = m.get(e.exception_type) ?? { type: e.exception_type, n: 0, amt: 0 }
    cur.n += 1
    cur.amt += e.financial_impact
    m.set(e.exception_type, cur)
    return m
  }, new Map<string, { type: string; n: number; amt: number }>()).values()].sort((a, b) => b.amt - a.amt)
  return (
    <div className="mt-3 rounded-xl border border-forest/20 bg-[#f7faf8] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Stage detail</p>
          <h4 className="text-sm font-semibold text-ink">{detail.title}</h4>
          <p className="text-[13px] font-medium text-forest-muted">Q: {detail.question}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {onShowRecords && (
            <button type="button" className="rounded-md border border-[#dce6df] bg-white px-2 py-1 text-[13px]" onClick={onShowRecords}>
              List records ↓
            </button>
          )}
          <button
            type="button"
            className="rounded-md bg-forest px-2 py-1 text-[13px] text-white hover:bg-forest-muted"
            onClick={() => onReconciliation(detail.exceptionTypes[0] ?? null)}
          >
            Open in Reconciliation →
          </button>
          <button type="button" aria-label="Close stage detail" className="rounded-md p-1 text-ink-muted hover:bg-white" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {detail.kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-[#dce6df] bg-white px-2.5 py-2">
            <p className="text-xs font-semibold uppercase text-ink-muted">{k.label}</p>
            <p className="font-mono text-base font-semibold text-ink" title={k.unit === 'money' && k.value != null ? formatCurrencyPrecise(k.value) : undefined}>
              {fmtVal(k.value, k.unit)}
            </p>
            {k.note && <p className="text-xs text-ink-muted">{k.note}</p>}
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-[13px] font-semibold text-ink">Trend in scope</p>
          {detail.trendKeys.length === 0 || months.length < 2 ? (
            <p className="rounded-lg border border-dashed border-[#c5d5cb] px-3 py-6 text-center text-[13px] text-ink-muted">
              {detail.trendKeys.length === 0 ? 'No monthly series for this stage' : 'Insufficient history — widen the date range for a trend'}
            </p>
          ) : (
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={months}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                  <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => (moneyTrend ? `$${(Number(v) / 1000).toFixed(0)}k` : formatNumber(Number(v)))}
                  />
                  <Tooltip formatter={(v) => (moneyTrend ? formatCurrencyPrecise(Number(v)) : formatNumber(Number(v)))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {detail.trendKeys.map((k, i) => (
                    <Line isAnimationActive={false}
                      key={k}
                      type="monotone"
                      dataKey={k}
                      name={SERIES[k].name}
                      stroke={SERIES[k].color}
                      strokeWidth={2}
                      strokeDasharray={i > 0 ? '5 3' : undefined}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className="space-y-1 rounded-lg border border-[#dce6df] bg-white p-2.5 text-[13px] text-ink-muted">
          <p>
            <span className="font-semibold text-ink">Source: </span>
            {detail.source}
          </p>
          <p>
            <span className="font-semibold text-ink">Logic: </span>
            <span className="font-mono">{detail.logic}</span>
          </p>
          <p className="rounded bg-amber-50 px-2 py-1 text-amber-900">
            <span className="font-semibold">Caveat: </span>
            {detail.caveat}
          </p>
          <p>
            <span className="font-semibold text-ink">Exception rules mapped: </span>
            {detail.exceptionTypes.join(', ') || '—'}
          </p>
        </div>
      </div>

      {reasons.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="font-semibold text-ink">Main exception reasons:</span>
          {reasons.slice(0, 4).map((r) => (
            <button
              key={r.type}
              type="button"
              onClick={() => onReconciliation(r.type)}
              className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-900 hover:border-amber-400"
            >
              {r.type} · {r.n} · {formatCurrency(r.amt, true)}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3">
        <p className="mb-1 text-[13px] font-semibold text-ink">
          Open / investigating exceptions · {formatNumber(exceptions.length)} · {formatCurrency(openImpact, true)}{' '}
          <span className="font-normal text-ink-muted">(unconfirmed — not booked recovery)</span>
        </p>
        <DataTable
          rows={ranked.slice(0, 8).map((e) => ({ ...e, id: e.exception_id }))}
          rowKey={(r) => r.exception_id}
          onRowClick={onException}
          emptyMessage="No open exceptions mapped to this stage in the current scope"
          columns={[
            { key: 'id', header: 'Exception', render: (r) => r.exception_id },
            { key: 't', header: 'Type', render: (r) => r.exception_type },
            {
              key: 'c',
              header: 'Customer',
              render: (r) =>
                r.customer_id ? (
                  <button
                    type="button"
                    className="text-brand-700 hover:underline"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      onCustomer(r.customer_id!)
                    }}
                  >
                    {customerName(r.customer_id)}
                  </button>
                ) : (
                  '—'
                ),
            },
            {
              key: 'sh',
              header: 'Source',
              render: (r) =>
                r.shipment_id && onShipment ? (
                  <button
                    type="button"
                    className="font-mono text-brand-700 hover:underline"
                    title="Open shipment → rate card"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      onShipment(r.shipment_id!)
                    }}
                  >
                    {r.shipment_id}
                  </button>
                ) : (
                  (r.invoice_id ?? '—')
                ),
            },
            { key: 'sev', header: 'Severity', render: (r) => r.severity },
            { key: 'st', header: 'Status', render: (r) => r.status },
            { key: 'imp', header: 'Impact', align: 'right', render: (r) => formatCurrencyPrecise(r.financial_impact) },
          ]}
        />
      </div>
    </div>
  )
}
