import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
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
import { REVENUE_OPS_NAV } from '@/lib/icons'
import { TraceabilityChain } from '@/components/common/TraceabilityChain'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { formatAxisMoney, formatCurrency, formatCurrencyPrecise, formatNumber, formatPercent } from '@/lib/money'
import type { FactException } from '@/types'
import { SalesPipelinePanel } from '@/components/revops/SalesPipelinePanel'
import {
  LifecycleComplementCharts,
  PriorityExceptionStrip,
} from '@/components/revops/LifecycleComplementCharts'
import { OneLineInsight } from '@/components/revops/CompactKpi'
import { isOpenException } from '@/calc/exceptionRegistry'

export type LifecycleFocus = 'all' | 'pipeline' | 'lifecycle' | 'collections'

export function RevenueLifecycle({ pageFocus = 'lifecycle' }: { pageFocus?: LifecycleFocus }) {
  const showPipeline = pageFocus === 'all' || pageFocus === 'pipeline'
  const showOps = pageFocus === 'all' || pageFocus === 'lifecycle'
  const pagePath = pageFocus === 'pipeline' ? '/pipeline' : '/lifecycle'
  const {
    data,
    filters,
    scenario,
    asOfDate,
    localFilters,
    setLocalFilters,
    navigateToEntity,
    navigateWithContext,
    openCustomer360,
    openEntity,
  } = useApp()
  const sales = useMemo(
    () => (showPipeline ? computeSalesPipeline(data, asOfDate) : null),
    [showPipeline, data, asOfDate],
  )
  const cohort = useMemo(
    () => (showPipeline ? computeCohortConversions(data) : null),
    [showPipeline, data],
  )
  const ops = useMemo(
    () => (showOps ? computeOperationalPipeline(data, filters, asOfDate) : null),
    [showOps, data, filters, asOfDate],
  )
  const selectedStage = localFilters.pipelineStage
  const setSelectedStage = (stage: string | null) =>
    setLocalFilters((prev) => ({ ...prev, pipelineStage: stage }))

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
  const [showFullTraceTable, setShowFullTraceTable] = useState(false)

  const activeRates = useMemo(() => {
    if (!showOps) return []
    const today = data.meta.snapshot_label.slice(0, 10) || '2024-11-05'
    const active = data.rateCards.filter(
      (r) => r.effective_from <= today && r.effective_to >= today,
    )
    return showAllRates ? data.rateCards : active
  }, [showOps, data, showAllRates])

  const stageRecords = useMemo(() => {
    if (!showOps || !stageKey) return []
    const ships = filterShipments(data, filters)
    const billedIds = new Set(
      data.billingLines.filter((b) => !b.is_duplicate).map((b) => b.shipment_id),
    )
    if (stageKey === 'billable') return ships.filter((s) => s.billable).slice(0, 40)
    if (stageKey === 'billed') return ships.filter((s) => billedIds.has(s.shipment_id)).slice(0, 40)
    if (stageKey === 'missing_billing')
      return ships.filter((s) => s.billable && !billedIds.has(s.shipment_id)).slice(0, 40)
    if (stageKey === 'shipments') return ships.slice(0, 40)
    return ships.slice(0, 40)
  }, [showOps, stageKey, data, filters])

  const headerRev = useMemo(() => {
    if (!showOps) return []
    return data.revenueRecognition.filter(
      (r) =>
        r.billing_line_id === null &&
        r.accounting_period >= filters.startPeriod &&
        r.accounting_period <= filters.endPeriod &&
        (filters.customerIds.length === 0 || filters.customerIds.includes(r.customer_id)),
    )
  }, [showOps, data, filters])

  const traceCoverage = useMemo(() => {
    if (!showOps) return { sample: 0, linked: 0, missing: 0, pct: null as number | null }
    // Lightweight coverage: invoice link presence only (full chain on selected record)
    const sample = headerRev.slice(0, 80)
    let linked = 0
    let missing = 0
    for (const r of sample) {
      if (r.invoice_id) linked++
      else missing++
    }
    return {
      sample: sample.length,
      linked,
      missing,
      pct: sample.length ? (linked / sample.length) * 100 : null,
    }
  }, [showOps, headerRev])

  const trace = selectedRev ? computeTraceability(data, selectedRev) : null

  const lifecycle = useMemo(
    () => (showOps ? computeLifecycleStages(data, filters, scenario, asOfDate) : null),
    [showOps, data, filters, scenario, asOfDate],
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

  const lifecycleFlow: FlowStage[] = (lifecycle?.nodes ?? []).map((n) => ({
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
  const lifecycleGaps: FlowGap[] = (lifecycle?.gaps ?? []).map((g) => ({
    id: g.id,
    label: g.label,
    value: fmtVal(g.value, g.unit),
    tone: g.tone,
    title: g.title,
    onClick: () => toggleFocus(g.id),
  }))
  const focus =
    focusId && lifecycle ? lifecycle.details[focusId as keyof typeof lifecycle.details] : null

  const unbilledPkgs = ops?.unbilled.unbilledPackages ?? 0
  const unbilledAmt = ops?.unbilled.ratedAmount ?? 0
  const unbilledOldest = ops?.unbilled.oldestDays
  const hotStage = lifecycle
    ? [...lifecycle.nodes]
        .filter((n) => n.openExceptions > 0)
        .sort((a, b) => b.openExceptions - a.openExceptions)[0]
    : null
  const alertGap = lifecycle
    ? lifecycle.gaps.find((g) => g.tone === 'alert') ??
      lifecycle.gaps.find((g) => g.tone === 'watch')
    : null
  const flowInsight =
    unbilledPkgs > 0
      ? `${formatNumber(unbilledPkgs)} unbilled billable packages${
          unbilledAmt > 0 ? ` · ${formatCurrency(unbilledAmt, true)} rated` : ''
        }${unbilledOldest != null ? ` · oldest ${unbilledOldest}d since shipment` : ''}.`
      : hotStage
        ? `${hotStage.label}: ${formatNumber(hotStage.openExceptions)} open exceptions${
            alertGap ? ` · ${alertGap.label} ${fmtVal(alertGap.value, alertGap.unit)}` : ''
          }.`
        : alertGap
          ? `${alertGap.label} ${fmtVal(alertGap.value, alertGap.unit)}.`
          : null

  const openExc = (lifecycle?.openExceptions ?? []).filter(isOpenException)
  const overdue = openExc.filter((e) => e.exception_type === 'Overdue AR')
  const accuracyIssues = openExc.filter((e) =>
    ['Rate Mismatch', 'Duplicate Billing', 'Missing Surcharge'].includes(e.exception_type),
  )
  const priorityItems = [
    {
      id: 'accuracy',
      label: 'Billing line defects',
      value: `${formatNumber(accuracyIssues.length)} · ${formatCurrency(
        accuracyIssues.reduce((a, e) => a + e.financial_impact, 0),
        true,
      )}`,
      tone: accuracyIssues.length ? ('watch' as const) : undefined,
    },
    {
      id: 'overdue',
      label: 'Overdue AR (as-of)',
      value: `${formatNumber(overdue.length)} · ${formatCurrency(
        overdue.reduce((a, e) => a + e.financial_impact, 0),
        true,
      )}`,
      tone: overdue.length ? ('alert' as const) : undefined,
    },
  ].filter((p) => !p.value.startsWith('0 ·'))

  const previewRev = headerRev.slice(0, 5)

  return (
    <div className="w-full max-w-none space-y-4">
      <ModuleSubNav items={REVENUE_OPS_NAV} />
      <PageHeader
        path={pagePath}
        scope={
          pageFocus === 'pipeline'
            ? 'TCV ≠ revenue · Cohort ≠ stage stock'
            : `Activity ${filters.startPeriod}→${filters.endPeriod} · As-of ${asOfDate.slice(0, 10)} · Net ≠ Recognized ≠ Cash ≠ AR`
        }
        actions={
          <>
            {showPipeline && (
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
                onClick={() => navigateWithContext('/sales-compensation')}
              >
                Sales Compensation
              </button>
            )}
            {showOps && (
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
            )}
          </>
        }
      />

      {showPipeline && sales && cohort && (
        <SalesPipelinePanel
          sales={sales}
          cohort={cohort}
          eventCount={data.opportunityStageEvents.length}
          selectedStage={selectedStage}
          onSelectStage={setSelectedStage}
          data={data}
          filters={filters}
          asOfDate={asOfDate}
          onOpenOpportunity={(id) => navigateToEntity('opportunity', id, id)}
        />
      )}

      {showOps && (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            Performance flow · Contract → Cash
          </p>
          <ChartCard
            icon="revenue"
            title="Operational Revenue Lifecycle"
            emphasis
            insight={flowInsight}
            subtitle={`Contracts · packages · USD — not one funnel · click node · ${STATUS_RULE}`}
            timeBasis={`Activity ${filters.startPeriod}→${filters.endPeriod} · As-of ${asOfDate.slice(0, 10)}`}
          >
            <p className="mb-2 text-[10px] text-ink-muted" title={ops?.dateBasisNote}>
              Activity vs as-of · Unbilled & AR use as-of · other stages use period activity
            </p>
            <InteractiveBusinessFlow
              stages={lifecycleFlow}
              gaps={lifecycleGaps}
              selectedId={focusId}
              size="dense"
              title=""
              subtitle=""
            />
            {focus && (
              <LifecycleDetailPanel
                detail={focus}
                months={lifecycle?.months ?? []}
                exceptions={(lifecycle?.openExceptions ?? []).filter((e) =>
                  focus.exceptionTypes.includes(e.exception_type),
                )}
                customerName={(id) =>
                  data.customers.find((c) => c.customer_id === id)?.customer_name ?? id
                }
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
                    openEntity: {
                      entityType: 'exception',
                      entityId: e.exception_id,
                      label: e.exception_type,
                    },
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

          {priorityItems.length > 0 && (
            <PriorityExceptionStrip
              items={priorityItems}
              onSelect={(id) => {
                if (id === 'accuracy') {
                  navigateWithContext('/reconciliation', {
                    exceptionType: 'Rate Mismatch',
                    exceptionStatus: 'Open',
                    sourcePage: '/lifecycle',
                  })
                } else {
                  navigateWithContext('/reconciliation', {
                    exceptionType: 'Overdue AR',
                    exceptionStatus: 'Open',
                    sourcePage: '/lifecycle',
                  })
                }
              }}
            />
          )}

          {ops && lifecycle && (
            <LifecycleComplementCharts
              ops={ops}
              months={lifecycle.months}
              onOpenCustomer={(id) => openCustomer360(id)}
              onOpenUnbilledLot={(id) => navigateToEntity('shipment', id, id)}
              onInvestigateUnbilled={() =>
                navigateWithContext('/reconciliation', {
                  exceptionType: 'Missing Billing',
                  exceptionStatus: 'Open',
                  sourcePage: '/lifecycle',
                  toast: 'From Lifecycle · Unbilled billable packages',
                })
              }
              onFilterCustomer={(id) => openCustomer360(id)}
            />
          )}

          {stageKey && stageRecords.length > 0 && (
            <ChartCard
              title={`Stage records · ${stageKey}`}
              subtitle={`${stageRecords.length} rows · click to open shipment`}
              action={
                <button
                  type="button"
                  className="text-[11px] text-forest underline"
                  onClick={() => setStageKey(null)}
                >
                  Clear
                </button>
              }
            >
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
            </ChartCard>
          )}

          <Collapsible title="Pricing Rules in Force" subtitle="Effective versions · match ship_date window">
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                className="text-xs text-brand-700"
                onClick={() => setShowAllRates((v) => !v)}
              >
                {showAllRates ? 'Show active only' : 'Show all versions'}
              </button>
            </div>
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
          </Collapsible>

          <ChartCard
            id="revenue-traceability"
            icon="traceability"
            title="Revenue Traceability"
            businessQuestion="Can recognized dollars be traced to shipment and rate card?"
            subtitle={
              traceCoverage.sample > 0
                ? `Invoice link coverage (sample): ${formatPercent(traceCoverage.pct)} (${formatNumber(traceCoverage.linked)} / ${formatNumber(traceCoverage.sample)} headers) · ${formatNumber(traceCoverage.missing)} missing invoice_id · full chain runs only on selected record`
                : 'No recognition headers in current filters'
            }
          >
            {headerRev.length === 0 ? (
              <p className="text-sm text-ink-muted">No matching recognition records.</p>
            ) : (
              <>
                <OneLineInsight>
                  Select a record to open Recognition → GL → Invoice → Billing Line → Shipment → Rate
                  Card. Missing links are labeled in the chain.
                </OneLineInsight>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {previewRev.map((r) => (
                    <button
                      key={r.rev_rec_id}
                      type="button"
                      onClick={() =>
                        setSelectedRev(selectedRev === r.rev_rec_id ? null : r.rev_rec_id)
                      }
                      className={`rounded-md border px-2 py-1 text-[11px] font-mono ${
                        selectedRev === r.rev_rec_id
                          ? 'border-forest bg-brand-50 text-forest'
                          : 'border-[#dce6df] text-ink-muted hover:border-brand-400'
                      }`}
                    >
                      {r.rev_rec_id} · {formatCurrency(r.amount, true)}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="rounded-md border border-[#dce6df] px-2 py-1 text-[11px] text-ink-muted"
                    onClick={() => setShowFullTraceTable((v) => !v)}
                  >
                    {showFullTraceTable ? 'Hide full table' : `All ${formatNumber(headerRev.length)} records`}
                  </button>
                </div>

                {trace ? (
                  <div className="mt-3">
                    <TraceabilityChain
                      trace={trace}
                      onOpenRecord={(type, id) => navigateToEntity(type, id, id)}
                    />
                    <div className="mt-1.5 flex justify-end">
                      <DrilldownLink
                        to="/customers"
                        label="Customer 360"
                        onClick={() => openCustomer360(trace.header.customer_id)}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-ink-muted">No record selected.</p>
                )}

                {showFullTraceTable && (
                  <div className="mt-3">
                    <DataTable
                      rows={headerRev.map((r) => ({ ...r, id: r.rev_rec_id }))}
                      rowKey={(r) => r.rev_rec_id}
                      selectedKey={selectedRev}
                      onRowClick={(r) =>
                        setSelectedRev(selectedRev === r.rev_rec_id ? null : r.rev_rec_id)
                      }
                      columns={[
                        { key: 'id', header: 'Rev Rec ID', render: (r) => r.rev_rec_id },
                        {
                          key: 'cust',
                          header: 'Customer',
                          render: (r) =>
                            data.customers.find((c) => c.customer_id === r.customer_id)
                              ?.customer_name ?? r.customer_id,
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
                  </div>
                )}

                {trace && (
                  <Collapsible
                    title="Raw lineage text"
                    subtitle="Auxiliary text dump of linked records"
                  >
                    <div className="space-y-3 text-xs">
                      <p className="font-semibold text-ink">
                        Trace for {trace.header.rev_rec_id} ·{' '}
                        {formatCurrencyPrecise(trace.header.amount)}
                      </p>
                      <TraceBlock
                        title="GL Entries"
                        rows={trace.gl.map(
                          (g) =>
                            `${g.gl_entry_id} ${g.account_name}: Dr ${g.debit} / Cr ${g.credit}`,
                        )}
                      />
                      <TraceBlock
                        title="Invoice"
                        rows={
                          trace.invoice
                            ? [
                                `${trace.invoice.invoice_id} net ${formatCurrencyPrecise(trace.invoice.net_amount)} (${trace.invoice.status})`,
                              ]
                            : ['— missing link']
                        }
                      />
                      <TraceBlock
                        title="Billing Lines"
                        rows={
                          trace.billingLines.length
                            ? trace.billingLines.map(
                                (b) =>
                                  `${b!.billing_line_id} · ${b!.shipment_id} · net ${formatCurrencyPrecise(b!.net_amount)}`,
                              )
                            : ['— missing link']
                        }
                      />
                      <TraceBlock
                        title="Shipments"
                        rows={
                          trace.shipments.length
                            ? trace.shipments.map(
                                (s) =>
                                  `${s!.shipment_id} · ${s!.service_type} · ${s!.region} · ${s!.delivery_status}`,
                              )
                            : ['— missing link']
                        }
                      />
                      <TraceBlock
                        title="Rate Cards"
                        rows={
                          trace.rateCards.length
                            ? trace.rateCards.map(
                                (r) =>
                                  `${r!.rate_card_id} v${r!.version} base ${r!.base_rate} (${r!.effective_from}→${r!.effective_to})`,
                              )
                            : ['— missing link']
                        }
                      />
                    </div>
                  </Collapsible>
                )}
              </>
            )}
          </ChartCard>
        </>
      )}
    </div>
  )
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
  const SERIES: Record<
    LifecycleDetail['trendKeys'][number],
    { name: string; color: string; money: boolean }
  > = {
    shipments: { name: 'Shipments', color: '#123C35', money: false },
    billable: { name: 'Billable', color: '#00A86B', money: false },
    netBilling: { name: 'Net Billing', color: '#123C35', money: true },
    recognized: { name: 'Recognized', color: '#00A86B', money: true },
    cash: { name: 'Cash collected', color: '#E58A2B', money: true },
  }
  const moneyTrend = detail.trendKeys.some((k) => SERIES[k].money)
  const openImpact = exceptions.reduce((a, e) => a + e.financial_impact, 0)
  const ranked = [...exceptions].sort((a, b) => b.financial_impact - a.financial_impact)
  const reasons = [
    ...exceptions
      .reduce((m, e) => {
        const cur = m.get(e.exception_type) ?? { type: e.exception_type, n: 0, amt: 0 }
        cur.n += 1
        cur.amt += e.financial_impact
        m.set(e.exception_type, cur)
        return m
      }, new Map<string, { type: string; n: number; amt: number }>())
      .values(),
  ].sort((a, b) => b.amt - a.amt)
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
            <button
              type="button"
              className="rounded-md border border-[#dce6df] bg-white px-2 py-1 text-[13px]"
              onClick={onShowRecords}
            >
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
          <button
            type="button"
            aria-label="Close stage detail"
            className="rounded-md p-1 text-ink-muted hover:bg-white"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {detail.kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-[#dce6df] bg-white px-2.5 py-2">
            <p className="text-xs font-semibold uppercase text-ink-muted">{k.label}</p>
            <p
              className="font-mono text-base font-semibold text-ink"
              title={
                k.unit === 'money' && k.value != null ? formatCurrencyPrecise(k.value) : undefined
              }
            >
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
              {detail.trendKeys.length === 0
                ? 'No monthly series for this stage'
                : 'Insufficient history — widen the date range for a trend'}
            </p>
          ) : (
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={months}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                  <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) =>
                      moneyTrend ? formatAxisMoney(Number(v)) : formatNumber(Number(v))
                    }
                  />
                  <Tooltip
                    formatter={(v) =>
                      moneyTrend ? formatCurrencyPrecise(Number(v)) : formatNumber(Number(v))
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {detail.trendKeys.map((k, i) => (
                    <Line
                      isAnimationActive={false}
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
          Open exceptions · {formatNumber(exceptions.length)} · {formatCurrency(openImpact, true)}
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
            {
              key: 'imp',
              header: 'Impact',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.financial_impact),
            },
          ]}
        />
      </div>
    </div>
  )
}
