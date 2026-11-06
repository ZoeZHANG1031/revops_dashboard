import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { WrapTick } from '@/components/charts/WrapTick'
import { rollupExceptionsByRootCause } from '@/calc/actionRollup'
import {
  classifyExceptionNature,
  computeReconciliation,
} from '@/calc/reconciliation'
import { computeReconciliationBridge } from '@/calc/reconBridge'
import { EXCEPTION_REGISTRY, exposureByClass, isOpenException } from '@/calc/exceptionRegistry'
import { PageHeader } from '@/components/common/PageHeader'
import { InfoTip, StatusIndicator } from '@/components/common/StatusIndicator'
import { FloatingWaterfall } from '@/components/charts/FloatingWaterfall'
import { ChartCard } from '@/components/common/ChartCard'
import { Collapsible } from '@/components/common/Collapsible'
import { DataTable } from '@/components/common/DataTable'
import { useApp } from '@/context/AppContext'
import { filterExceptions } from '@/lib/filters'
import { exportToCsv } from '@/lib/export'
import { formatCurrency, formatCurrencyPrecise, formatNumber, formatPercent } from '@/lib/money'
import type { ExceptionStatus, ExceptionType, FactException } from '@/types'

const OPEN_STATUSES = new Set<ExceptionStatus>(['Open', 'Investigating', 'Pending Approval'])
const ALL_TYPES: ExceptionType[] = [
  'Missing Billing',
  'Unbilled Packages',
  'Duplicate Billing',
  'Rate Mismatch',
  'Missing Surcharge',
  'Timing Difference',
  'Credit Memo Adjustment',
  'Invoice GL Mismatch',
  'Customer Mapping Error',
  'Missing Shipment ID',
  'Overdue AR',
  'Volume Decline',
  'Margin Decline',
  'High Risk Customer',
]
const ALL_STATUSES: ExceptionStatus[] = [
  'Open',
  'Investigating',
  'Pending Approval',
  'Resolved',
  'Rejected',
  'Accepted',
]
/** Explicit tolerance rule for reconciliation status (|Actual − Expected| ÷ Expected) */
const TOLERANCE = { reconciled: 0.5, review: 2 }

export function RevenueReconciliation() {
  const {
    data,
    filters,
    localFilters,
    setLocalFilters,
    navigateToEntity,
    navigateWithContext,
    updateExceptionStatus,
    openEntity,
    openCustomer360,
  } = useApp()
  const [bridgeModeChoice, setBridgeMode] = useState<'full' | 'components' | null>(null)
  const typeFilter = (localFilters.exceptionType as ExceptionType | null) ?? ''
  const statusFilter = (localFilters.exceptionStatus as ExceptionStatus | null) ?? ''
  const setTypeFilter = (v: ExceptionType | '') =>
    setLocalFilters((prev) => ({ ...prev, exceptionType: v || null }))
  const setStatusFilter = (v: ExceptionStatus | '') =>
    setLocalFilters((prev) => ({ ...prev, exceptionStatus: v || null }))
  // Arriving with a specific exception (e.g. from Executive / Lifecycle) pre-opens its trace
  const [traceId, setTraceId] = useState<string | null>(() =>
    openEntity?.entityType === 'exception' ? openEntity.entityId : null,
  )
  const custName = useMemo(
    () => new Map(data.customers.map((c) => [c.customer_id, c.customer_name])),
    [data.customers],
  )
  const shipById = useMemo(
    () => new Map(data.shipments.map((sh) => [sh.shipment_id, sh])),
    [data.shipments],
  )

  const recon = useMemo(() => computeReconciliation(data, filters), [data, filters])
  const bridge = useMemo(() => computeReconciliationBridge(data, filters), [data, filters])
  const rollups = useMemo(() => rollupExceptionsByRootCause(data, filters), [data, filters])
  const scopedExceptions = useMemo(() => filterExceptions(data, filters), [data, filters])
  const exceptions = useMemo(() => {
    return scopedExceptions.filter((e) => {
      if (typeFilter && e.exception_type !== typeFilter) return false
      if (statusFilter && e.status !== statusFilter) return false
      return true
    })
  }, [scopedExceptions, typeFilter, statusFilter])

  // Segmentations use the local type/status selection so chart ↔ table stay consistent
  const openInView = exceptions.filter((e) => OPEN_STATUSES.has(e.status))
  const groupImpact = (key: (e: FactException) => string) => {
    const m = new Map<string, { key: string; impact: number; cases: number }>()
    for (const e of openInView) {
      const k = key(e)
      const cur = m.get(k) ?? { key: k, impact: 0, cases: 0 }
      cur.impact += e.financial_impact
      cur.cases += 1
      m.set(k, cur)
    }
    return [...m.values()]
      .map((x) => ({ ...x, impact: Math.round(x.impact * 100) / 100 }))
      .sort((a, b) => b.impact - a.impact)
  }
  const byReason = groupImpact((e) => e.exception_type)
  const byCustomer = groupImpact((e) => e.customer_id ?? '—').slice(0, 8)
  const byService = groupImpact((e) =>
    e.shipment_id ? (shipById.get(e.shipment_id)?.service_type ?? 'Unmapped') : 'Invoice / customer-level',
  )
  const statusCounts = ALL_STATUSES.map((st) => ({
    status: st,
    count: scopedExceptions.filter(
      (e) => e.status === st && (!typeFilter || e.exception_type === typeFilter),
    ).length,
  }))
  const traced = traceId ? exceptions.find((e) => e.exception_id === traceId) ?? null : null

  const diffPct =
    recon.expectedCharges === 0
      ? null
      : (Math.abs(recon.reconciliationDifference) / Math.abs(recon.expectedCharges)) * 100
  const reconStatus =
    diffPct == null
      ? { label: 'Not evaluated', tone: 'text-ink-muted', note: 'No expected charges in scope' }
      : diffPct <= TOLERANCE.reconciled
        ? { label: 'Reconciled', tone: 'text-success', note: `Within ±${TOLERANCE.reconciled}% tolerance` }
        : diffPct <= TOLERANCE.review
          ? { label: 'Variance — Review', tone: 'text-warning', note: `${diffPct.toFixed(2)}% of expected (≤ ${TOLERANCE.review}%)` }
          : { label: 'Out of Tolerance', tone: 'text-danger', note: `${diffPct.toFixed(2)}% of expected (> ${TOLERANCE.review}%)` }
  const exposure = exposureByClass(scopedExceptions)
  const registryRows = (Object.values(EXCEPTION_REGISTRY)).map((d) => {
    const list = scopedExceptions.filter((e) => e.exception_type === d.type)
    const open = list.filter(isOpenException)
    return {
      ...d,
      id: d.typeId,
      total: list.length,
      open: open.length,
      resolved: list.filter((e) => e.status === 'Resolved').length,
      openExposure: Math.round(open.reduce((a, e) => a + e.financial_impact, 0) * 100) / 100,
    }
  })
  // Small gaps get flattened by a large starting bar — default to components-only below 15% of expected
  const smallGap = diffPct != null && diffPct < 15
  const bridgeMode = bridgeModeChoice ?? (smallGap ? 'components' : 'full')
  const bridgeSteps =
    bridgeMode === 'full'
      ? bridge.items.map((i) => ({ key: i.key, label: i.label, amount: i.amount }))
      : bridge.items
          .filter((i) => i.key !== 'expected' && i.key !== 'actual')
          .map((i) => ({ key: i.key, label: i.label, amount: i.amount }))
  const hasLocal = Boolean(typeFilter || statusFilter)

  // Computed insights
  const bridgeComps = bridge.items.filter((i) => i.key !== 'expected' && i.key !== 'actual')
  const bigComp = [...bridgeComps].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0]
  const bridgeInsight = bigComp
    ? `Gap ${bridge.totalGap >= 0 ? '+' : '−'}${formatCurrency(Math.abs(bridge.totalGap), true)} (${diffPct == null ? 'N/A' : `${diffPct.toFixed(1)}%`} of expected). Largest component: ${bigComp.label} ${bigComp.amount >= 0 ? '+' : '−'}${formatCurrency(Math.abs(bigComp.amount), true)}; leakage-like items ≈ ${formatCurrency(bridge.openLeakage, true)}.`
    : null
  const reasonTotal = byReason.reduce((a, r) => a + r.impact, 0)
  const reasonInsight = byReason[0]
    ? `${byReason[0].key} is ${formatPercent(reasonTotal ? (byReason[0].impact / reasonTotal) * 100 : null)} of open exposure (${byReason[0].cases} cases). Exposure classes differ — see cards above.`
    : null
  const custTotal = byCustomer.reduce((a, r) => a + r.impact, 0)
  const custInsight = byCustomer[0]
    ? `${custName.get(byCustomer[0].key) ?? byCustomer[0].key} holds ${formatCurrency(byCustomer[0].impact, true)} — ${formatPercent(custTotal ? (byCustomer[0].impact / custTotal) * 100 : null)} of the top-8 exposure.`
    : null
  const clearLocal = () => setLocalFilters((prev) => ({ ...prev, exceptionType: null, exceptionStatus: null }))

  const volumeMatrix = [
    { metric: 'Total Shipments', value: recon.layers.operations.shipments },
    { metric: 'Billable Shipments', value: recon.layers.operations.billable },
    { metric: 'Billed Shipments', value: recon.actualBilledShipments },
    { metric: 'Billing Lines', value: recon.layers.billing.lines },
  ]
  const dollarMatrix = [
    { metric: 'Expected Charges', value: recon.layers.pricing.expectedCharges },
    { metric: 'Net Billing', value: recon.layers.billing.netAmount },
    { metric: 'Invoice Net', value: recon.layers.finance.invoiceNet },
    { metric: 'Recognized Revenue', value: recon.layers.finance.recognized },
    { metric: 'GL Revenue', value: recon.layers.finance.glRevenue },
  ]


  return (
    <div className="space-y-5">
      <PageHeader
        path="/reconciliation"
        scope={`${filters.startPeriod} → ${filters.endPeriod} · unconfirmed ≠ recoverable`}
        actions={
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
            onClick={() => exportToCsv('billing_exceptions.csv', exceptions.map((e) => ({ ...e })))}
          >
            Export Exceptions CSV
          </button>
        }
      />

      {recon.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <p className="font-semibold">Data Quality Warning</p>
          <ul className="mt-1 list-disc pl-4">
            {recon.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Level 1 — status and five separate concepts (never added together) */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="flex items-center text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Reconciliation Status
            <InfoTip text={`|Actual Net Billing − Expected| ÷ Expected: ≤${TOLERANCE.reconciled}% Reconciled · ≤${TOLERANCE.review}% Review · otherwise Out of Tolerance`} />
          </p>
          <div className="mt-1.5">
            <StatusIndicator
              tone={reconStatus.label === 'Reconciled' ? 'good' : reconStatus.label === 'Variance — Review' ? 'watch' : reconStatus.label === 'Out of Tolerance' ? 'critical' : 'unavailable'}
              label={reconStatus.label}
            />
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            {reconStatus.note} · bridge {bridge.reconciles ? 'foots' : 'does not foot'}
          </p>
        </div>
        <ConceptCard
          label="Reconciliation Difference"
          value={formatCurrency(recon.reconciliationDifference, true)}
          note="Actual Net Billing − Expected"
          tip={`Exact ${formatCurrencyPrecise(recon.reconciliationDifference)}. Includes valid discounts, credits and timing — not leakage by itself.`}
        />
        <ConceptCard
          label="Billing Exceptions"
          value={formatNumber(scopedExceptions.length)}
          note={`${formatNumber(scopedExceptions.filter(isOpenException).length)} open / investigating / pending`}
          tip="All exception rows in scope (shared filter used by every page)."
        />
        <ConceptCard
          label="Recoverable Exposure"
          value={formatCurrency(exposure['Recoverable Billing Exposure'].amount, true)}
          note={`${exposure['Recoverable Billing Exposure'].cases} open · unconfirmed`}
          tip="Open Missing Billing, Unbilled, Rate Mismatch, Missing Surcharge — could be re-billed once validated."
          tone="watch"
        />
        <ConceptCard
          label="Collections Exposure"
          value={formatCurrency(exposure['Collections Exposure'].amount, true)}
          note={`${exposure['Collections Exposure'].cases} overdue · cash, not revenue`}
          tip="Open Overdue AR exceptions. Cash timing — never a reduction of recognized revenue."
        />
        <ConceptCard
          label="Customer Revenue Risk"
          value={formatCurrency(exposure['Customer Revenue Risk'].amount, true)}
          note={`${exposure['Customer Revenue Risk'].cases} flagged · forward risk`}
          tip="Exception-flagged at-risk customers (scenario, not booked). Full scenario RaR lives on Customer Intelligence."
          onClick={() => navigateWithContext('/customers', { sourcePage: '/reconciliation' })}
        />
      </div>
      <p className="text-xs text-ink-muted">
        These five figures measure different things and are not additive. Billing Correction (duplicate billing, refund risk):{' '}
        {formatCurrency(exposure['Billing Correction'].amount, true)} · Timing / adjustment: {formatCurrency(exposure['Timing / Adjustment'].amount, true)}.
      </p>

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5 text-[13px]">
        <Chip label="Expected Charges" value={formatCurrency(recon.expectedCharges, true)} />
        <Chip label="Actual Net Billing" value={formatCurrency(recon.actualCharges, true)} />
        <Chip label="Unbilled Exposure" value={formatCurrency(recon.unbilledExposure, true)} />
        <Chip label="Billing Accuracy" value={formatPercent(recon.billingAccuracy)} />
        <Chip label="Recognized Revenue" value={formatCurrency(recon.recognizedRevenue, true)} note="Different date basis" />
      </div>

      {/* Level 2 — Bridge + reasons */}
      <div className="grid gap-4">
        <div>
          <ChartCard
            icon="reconciliation"
            title="Reconciliation Bridge"
            emphasis
            insight={bridgeInsight}
            subtitle={`Expected → signed components → Actual · gap ${formatCurrencyPrecise(bridge.totalGap)}`}
            action={
              <div className="flex gap-1" role="tablist" aria-label="Bridge view">
                {(['full', 'components'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={bridgeMode === mode}
                    onClick={() => setBridgeMode(mode)}
                    className={`rounded-md px-2 py-1 text-[13px] ${bridgeMode === mode ? 'bg-forest text-white' : 'border border-[#dce6df] text-ink-muted'}`}
                  >
                    {mode === 'full' ? 'Full Bridge' : 'Variance Components Only'}
                  </button>
                ))}
              </div>
            }
            businessQuestion="How much of the gap is leakage vs valid discounts, credits and timing?"
            formula="Expected + Σ components = Actual Net Charges"
            source="computeReconciliationBridge"
            timeBasis={`${filters.startPeriod} → ${filters.endPeriod}`}
          >
            <FloatingWaterfall
              steps={bridgeSteps}
              height={300}
              totalKeys={bridgeMode === 'full' ? ['expected', 'actual'] : []}
              tickFormat={bridgeMode === 'full' ? undefined : (v) => `${v < 0 ? '−' : ''}$${(Math.abs(v) / 1000).toFixed(1)}k`}
            />
            <p className="mt-2 text-xs text-ink-muted">
              {bridge.reconciles ? '✓ Bridge reconciles.' : '⚠ Residual does not foot — see Unresolved.'} Leakage-like
              components ≈ {formatCurrency(bridge.openLeakage, true)} (unconfirmed; ≠ total variance).
            </p>
            <Collapsible title="Bridge components" subtitle="Signed amounts and notes">
              <DataTable
                rows={bridge.items.filter((i) => i.key !== 'expected' && i.key !== 'actual').map((i) => ({ ...i, id: i.key }))}
                rowKey={(r) => r.key}
                columns={[
                  { key: 'l', header: 'Component', render: (r) => r.label },
                  { key: 'a', header: 'Signed Impact', align: 'right', render: (r) => formatCurrencyPrecise(r.amount) },
                  { key: 'n', header: 'Note', render: (r) => r.note },
                ]}
              />
            </Collapsible>
          </ChartCard>
        </div>
      </div>

      {/* Level 3 — Segmentation: reason · customer · service */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
            icon="exceptions"
            iconTone="risk"
            title="Difference by Reason"
            insight={reasonInsight}
            subtitle="Open exposure by exception type · click a bar to filter the detail"
            businessQuestion="Which exception rules carry the most open exposure?"
          >
            <RankedBars
              rows={byReason.map((r) => ({ key: r.key, label: r.key, impact: r.impact, cases: r.cases }))}
              selectedKey={typeFilter || null}
              onSelect={(k) => setTypeFilter(typeFilter === k ? '' : (k as ExceptionType))}
            />
          </ChartCard>
        <ChartCard
          icon="customers"
          iconTone="customer"
          title="Difference by Customer"
          insight={custInsight}
          subtitle="Top 8 by open exposure · click → Customer 360"
          businessQuestion="Which customers hold the most unresolved exposure?"
        >
          <RankedBars
            rows={byCustomer.map((r) => ({ key: r.key, label: custName.get(r.key) ?? r.key, impact: r.impact, cases: r.cases }))}
            onSelect={(k) => {
              if (k === '—') return
              openCustomer360(k)
            }}
          />
        </ChartCard>
        <ChartCard
          icon="shipments"
          title="Difference by Service"
          subtitle="Shipment-linked exceptions by service; invoice-level shown separately"
          businessQuestion="Is exposure concentrated in a service line?"
        >
          <RankedBars
            rows={byService.map((r) => ({ key: r.key, label: r.key, impact: r.impact, cases: r.cases }))}
          />
        </ChartCard>
      </div>

      {/* Level 4 — Evidence */}
      <ChartCard
        icon="exceptions"
        iconTone="risk"
        title="Exception Detail"
        emphasis
        subtitle="Source Record → Calculation → Exception Rule → Financial Impact → Status"
        businessQuestion="What exactly is wrong, and who is resolving it?"
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              className="filter-input"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as ExceptionType | '')}
              aria-label="Exception type"
            >
              <option value="">All types</option>
              {ALL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {hasLocal && (
              <button type="button" className="rounded-md border border-[#dce6df] px-2 py-1 text-[13px]" onClick={clearLocal}>
                Clear Local Filters
              </button>
            )}
          </div>
        }
      >
        <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="Status filter">
          <StatusChip label="All" count={statusCounts.reduce((a, c) => a + c.count, 0)} active={!statusFilter} onClick={() => setStatusFilter('')} />
          {statusCounts
            .filter((c) => c.count > 0 || ['Open', 'Investigating', 'Resolved'].includes(c.status))
            .map((c) => (
              <StatusChip
                key={c.status}
                label={c.status}
                count={c.count}
                active={statusFilter === c.status}
                onClick={() => setStatusFilter(statusFilter === c.status ? '' : c.status)}
              />
            ))}
        </div>

        {traced && (
          <TraceChain
            e={traced}
            customer={traced.customer_id ? custName.get(traced.customer_id) ?? traced.customer_id : null}
            onClose={() => setTraceId(null)}
            onOpenRecord={() => navigateToEntity('exception', traced.exception_id, traced.exception_type)}
            onCustomer={traced.customer_id ? () => openCustomer360(traced.customer_id!) : undefined}
            onSource={(type, id) => navigateToEntity(type, id, id)}
          />
        )}

        <Collapsible
          title={`Exception records (${formatNumber(exceptions.length)})`}
          subtitle="Click a row to trace it · status editable inline"
          defaultOpen={hasLocal || openEntity?.entityType === 'exception'}
        >
          <DataTable
            rows={exceptions.map((e) => ({ ...e, id: e.exception_id }))}
            rowKey={(r) => r.exception_id}
            selectedKey={traceId}
            onRowClick={(r) => setTraceId(traceId === r.exception_id ? null : r.exception_id)}
            columns={[
              { key: 'id', header: 'Exception ID', render: (r) => r.exception_id },
              { key: 'type', header: 'Type', render: (r) => r.exception_type },
              { key: 'cust', header: 'Customer', render: (r) => (r.customer_id ? custName.get(r.customer_id) ?? r.customer_id : '—') },
              { key: 'src', header: 'Source', render: (r) => r.shipment_id ?? r.invoice_id ?? r.billing_line_id ?? '—' },
              {
                key: 'diff',
                header: 'Difference',
                align: 'right',
                render: (r) => formatCurrencyPrecise(r.difference),
                sortValue: (r) => r.difference,
              },
              {
                key: 'imp',
                header: 'Impact',
                align: 'right',
                render: (r) => formatCurrencyPrecise(r.financial_impact),
                sortValue: (r) => r.financial_impact,
              },
              { key: 'nature', header: 'Nature', render: (r) => classifyExceptionNature(r).category },
              { key: 'sev', header: 'Severity', render: (r) => r.severity },
              { key: 'owner', header: 'Owner', render: (r) => r.owner },
              {
                key: 'status',
                header: 'Status',
                render: (r) => (
                  <select
                    className="filter-input py-0.5 text-xs"
                    value={r.status}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateExceptionStatus(r.exception_id, e.target.value as ExceptionStatus)}
                  >
                    {ALL_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                ),
              },
            ]}
          />
        </Collapsible>
      </ChartCard>

      <Collapsible
        title="Exception Registry"
        subtitle="One definition per exception type — used by Executive, Lifecycle, Reconciliation and Customer 360. Counts reflect current filters."
      >
        <DataTable
          rows={registryRows}
          rowKey={(r) => r.typeId}
          selectedKey={typeFilter ? EXCEPTION_REGISTRY[typeFilter]?.typeId : null}
          onRowClick={(r) => setTypeFilter(typeFilter === r.type ? '' : r.type)}
          columns={[
            { key: 'id', header: 'Type ID', render: (r) => <span className="font-mono text-xs">{r.typeId}</span> },
            { key: 't', header: 'Type', render: (r) => r.type },
            { key: 'd', header: 'Definition', render: (r) => r.definition },
            { key: 'rule', header: 'Detection rule', render: (r) => <span className="font-mono text-xs">{r.detectionRule}</span> },
            { key: 'src', header: 'Source', render: (r) => r.sourceData },
            { key: 'imp', header: 'Impact logic', render: (r) => r.impactLogic },
            { key: 'rec', header: 'Recoverability', render: (r) => r.recoverability },
            { key: 'cls', header: 'Exposure class', render: (r) => r.exposureClass },
            { key: 'own', header: 'Default owner', render: (r) => r.defaultOwner },
            { key: 'n', header: 'Open / Total', align: 'right', render: (r) => `${r.open} / ${r.total}`, sortValue: (r) => r.total },
            { key: 'x', header: 'Open exposure', align: 'right', render: (r) => formatCurrencyPrecise(r.openExposure), sortValue: (r) => r.openExposure },
          ]}
        />
        <p className="mt-2 text-xs text-ink-muted">
          Scope rule: detected_date in range · customer filter · shipment-linked exceptions also follow Region / Metro / Service;
          invoice-level ones (e.g. Overdue AR) follow customer only. Σ Total = {formatNumber(registryRows.reduce((a, r) => a + r.total, 0))} ={' '}
          {formatNumber(scopedExceptions.length)} Billing Exceptions above.
        </p>
      </Collapsible>

      <Collapsible title="Layer reconciliation detail" subtitle="Package and dollar layers, root-cause rollup">
        <div className="space-y-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Volume Reconciliation (packages)"
              subtitle="Package counts only — separate axis from dollars"
              businessQuestion="Are billable packages becoming billed lines?"
              formula="Billed shipments / Billable shipments = billing accuracy numerator/denominator"
              source="fact_shipment, fact_billing_line"
              timeBasis={`${filters.startPeriod} → ${filters.endPeriod}`}
            >
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={volumeMatrix}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                    <XAxis dataKey="metric" tick={<WrapTick maxChars={11} />} interval={0} height={44} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatNumber(Number(v))} />
                    <Tooltip formatter={(v) => formatNumber(Number(v))} />
                    <Bar isAnimationActive={false} dataKey="value" name="Packages / lines" fill="#123C35" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                Duplicates excluded from billed totals: {recon.layers.billing.duplicates} flagged lines.
              </p>
            </ChartCard>
            <ChartCard
              title="Dollar Layers (USD)"
              subtitle="Different date bases — compare, do not subtract as loss"
              businessQuestion="Do expected charges, billings, invoices, and GL revenue align?"
              formula="Expected Charges → Net Billing → Invoice Net → Recognized / GL"
              source="dim_rate_card, fact_billing_line, fact_invoice, fact_revenue_recognition, fact_general_ledger"
              timeBasis={`${filters.startPeriod} → ${filters.endPeriod}`}
            >
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dollarMatrix}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                    <XAxis dataKey="metric" tick={<WrapTick maxChars={11} />} interval={0} height={44} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v) => formatCurrencyPrecise(Number(v))} />
                    <Bar isAnimationActive={false} dataKey="value" name="USD" fill="#00A86B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>
          <DataTable
            rows={rollups.map((r) => ({ ...r, id: r.rootCauseKey }))}
            rowKey={(r) => r.rootCauseKey}
            selectedKey={typeFilter || null}
            onRowClick={(r) => setTypeFilter(typeFilter === r.exceptionType ? '' : (r.exceptionType as ExceptionType))}
            columns={[
              { key: 't', header: 'Type', render: (r) => r.exceptionType },
              { key: 'c', header: 'Cases', align: 'right', render: (r) => formatNumber(r.cases) },
              { key: 'o', header: 'Open Exposure', align: 'right', render: (r) => formatCurrencyPrecise(r.openExposure) },
              { key: 'r', header: 'Recoverable', align: 'right', render: (r) => formatCurrencyPrecise(r.recoverable) },
              { key: 'own', header: 'Owner', render: (r) => r.owner },
              { key: 'recov', header: 'Recoverability', render: (r) => r.recoverability },
            ]}
          />
        </div>
      </Collapsible>
    </div>
  )
}

function Chip({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-[#dce6df] bg-white px-2.5 py-1.5">
      <p className="text-xs font-semibold uppercase text-ink-muted">{label}</p>
      <p className="font-mono text-sm font-semibold text-ink">{value}</p>
      {note && <p className="text-xs text-ink-muted">{note}</p>}
    </div>
  )
}

function StatusChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[13px] transition-colors ${
        active ? 'bg-forest text-white' : 'border border-[#dce6df] bg-white text-ink-muted hover:text-ink'
      }`}
    >
      {label} <span className="font-mono">{count}</span>
    </button>
  )
}

/** Horizontal ranked bars (CSS) — exact amounts on hover */
function RankedBars({
  rows,
  selectedKey,
  onSelect,
}: {
  rows: { key: string; label: string; impact: number; cases: number }[]
  selectedKey?: string | null
  onSelect?: (key: string) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs text-ink-muted">
        No open exposure for current filters
      </div>
    )
  }
  const max = Math.max(...rows.map((r) => Math.abs(r.impact)), 1)
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => {
        const selected = selectedKey === r.key
        return (
          <li key={r.key}>
            <button
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(r.key)}
              title={`${r.label}: ${formatCurrencyPrecise(r.impact)} · ${r.cases} open cases`}
              className={`group w-full rounded-md px-1.5 py-1 text-left text-[13px] transition-colors ${
                onSelect ? 'hover:bg-brand-50' : 'cursor-default'
              } ${selected ? 'bg-brand-50 ring-1 ring-forest/30' : ''}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-ink">{r.label}</span>
                <span className="shrink-0 font-mono text-ink">
                  {formatCurrency(r.impact, true)} <span className="text-ink-muted">· {r.cases}</span>
                </span>
              </div>
              <div className="mt-0.5 h-2 rounded bg-[#eef3f0]">
                <div
                  className={`h-2 rounded ${selected ? 'bg-forest' : 'bg-forest/70 group-hover:bg-forest'}`}
                  style={{ width: `${Math.max(2, (Math.abs(r.impact) / max) * 100)}%` }}
                />
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function TraceChain({
  e,
  customer,
  onClose,
  onOpenRecord,
  onCustomer,
  onSource,
}: {
  e: FactException
  customer: string | null
  onClose: () => void
  onOpenRecord: () => void
  onCustomer?: () => void
  onSource?: (type: 'shipment' | 'billing_line' | 'invoice', id: string) => void
}) {
  const nature = classifyExceptionNature(e)
  const steps = [
    {
      k: 'Source Record',
      v: [e.shipment_id && `Shipment ${e.shipment_id}`, e.billing_line_id && `Line ${e.billing_line_id}`, e.invoice_id && `Invoice ${e.invoice_id}`]
        .filter(Boolean)
        .join(' · ') || (customer ? `Customer ${customer}` : '—'),
    },
    {
      k: 'Calculation',
      v: `Expected ${formatCurrencyPrecise(e.expected_amount)} − Actual ${formatCurrencyPrecise(e.actual_amount)} = ${formatCurrencyPrecise(e.difference)}`,
    },
    { k: 'Exception Rule', v: e.trigger_rule },
    { k: 'Financial Impact', v: `${formatCurrencyPrecise(e.financial_impact)} · ${nature.category}` },
    { k: 'Status', v: `${e.status} · ${e.owner}${e.resolution_notes ? ` · ${e.resolution_notes}` : ''}` },
  ]
  return (
    <div className="mb-3 rounded-xl border border-forest/20 bg-[#f7faf8] p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Trace · {e.exception_id}</p>
          <p className="text-xs font-semibold text-ink">
            {e.exception_type}
            {customer ? ` · ${customer}` : ''}
          </p>
          <p className="text-xs text-ink-muted">{nature.note} Root cause: {e.root_cause}</p>
        </div>
        <div className="flex gap-1.5">
          {onCustomer && (
            <button type="button" className="rounded-md border border-[#dce6df] bg-white px-2 py-1 text-[13px]" onClick={onCustomer}>
              Customer 360 →
            </button>
          )}
          <button type="button" className="rounded-md bg-forest px-2 py-1 text-[13px] text-white" onClick={onOpenRecord}>
            Open record
          </button>
          <button type="button" className="rounded-md px-2 py-1 text-[13px] text-ink-muted hover:bg-white" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      <ol className="grid gap-1.5 md:grid-cols-5">
        {steps.map((st, i) => (
          <li key={st.k} className="rounded-lg border border-[#dce6df] bg-white px-2 py-1.5 text-[13px]">
            <p className="text-xs font-semibold uppercase text-brand-600">
              {i + 1}. {st.k}
            </p>
            <p className="mt-0.5 break-words font-mono text-xs text-ink">{st.v}</p>
          </li>
        ))}
      </ol>
      {onSource && (e.shipment_id || e.billing_line_id || e.invoice_id) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-ink-muted">Open source record:</span>
          {e.shipment_id && (
            <button type="button" className="rounded border border-[#dce6df] bg-white px-1.5 py-0.5 font-mono hover:border-brand-400" onClick={() => onSource('shipment', e.shipment_id!)}>
              Shipment {e.shipment_id}
            </button>
          )}
          {e.billing_line_id && (
            <button type="button" className="rounded border border-[#dce6df] bg-white px-1.5 py-0.5 font-mono hover:border-brand-400" onClick={() => onSource('billing_line', e.billing_line_id!)}>
              Line {e.billing_line_id}
            </button>
          )}
          {e.invoice_id && (
            <button type="button" className="rounded border border-[#dce6df] bg-white px-1.5 py-0.5 font-mono hover:border-brand-400" onClick={() => onSource('invoice', e.invoice_id!)}>
              Invoice {e.invoice_id}
            </button>
          )}
        </div>
      )}
      <p className="mt-2 text-xs text-ink-muted">Recommended: {e.recommended_action}</p>
    </div>
  )
}

function ConceptCard({
  label,
  value,
  note,
  tip,
  tone,
  onClick,
}: {
  label: string
  value: string
  note: string
  tip: string
  tone?: 'watch'
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`rounded-xl border border-l-4 border-slate-200 bg-white p-3 text-left shadow-sm ${
        tone === 'watch' ? 'border-l-warning' : 'border-l-slate-200'
      } ${onClick ? 'transition-colors hover:border-brand-300' : ''}`}
    >
      <p className="flex items-center text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {label}
        <InfoTip text={tip} />
      </p>
      <p className="mt-1 font-mono text-lg font-semibold text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{note}</p>
    </Tag>
  )
}
