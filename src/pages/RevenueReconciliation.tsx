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
import { rollupExceptionsByRootCause } from '@/calc/actionRollup'
import {
  classifyExceptionNature,
  computeReconciliation,
} from '@/calc/reconciliation'
import { computeReconciliationBridge } from '@/calc/reconBridge'
import { FloatingWaterfall } from '@/components/charts/FloatingWaterfall'
import { ChartCard } from '@/components/common/ChartCard'
import { DataTable } from '@/components/common/DataTable'
import { useApp } from '@/context/AppContext'
import { filterExceptions } from '@/lib/filters'
import { exportToCsv } from '@/lib/export'
import { formatCurrency, formatCurrencyPrecise, formatNumber, formatPercent } from '@/lib/money'
import type { ExceptionStatus, ExceptionType } from '@/types'

export function RevenueReconciliation() {
  const { data, filters, localFilters, setLocalFilters, navigateToEntity, updateExceptionStatus } =
    useApp()
  const typeFilter = (localFilters.exceptionType as ExceptionType | null) ?? ''
  const statusFilter = (localFilters.exceptionStatus as ExceptionStatus | null) ?? ''
  const setTypeFilter = (v: ExceptionType | '') =>
    setLocalFilters((prev) => ({ ...prev, exceptionType: v || null }))
  const setStatusFilter = (v: ExceptionStatus | '') =>
    setLocalFilters((prev) => ({ ...prev, exceptionStatus: v || null }))
  const [expandedCause, setExpandedCause] = useState<string | null>(null)

  const recon = useMemo(() => computeReconciliation(data, filters), [data, filters])
  const bridge = useMemo(() => computeReconciliationBridge(data, filters), [data, filters])
  const rollups = useMemo(() => rollupExceptionsByRootCause(data, filters), [data, filters])
  const exceptions = useMemo(() => {
    return filterExceptions(data, filters).filter((e) => {
      if (typeFilter && e.exception_type !== typeFilter) return false
      if (statusFilter && e.status !== statusFilter) return false
      return true
    })
  }, [data, filters, typeFilter, statusFilter])

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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Revenue Reconciliation</h2>
          <p className="text-xs text-ink-muted">
            Cross-system check: Operations (TMS) → Pricing (Rate Cards) → Billing → Finance (ERP/GL).
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
          onClick={() =>
            exportToCsv(
              'billing_exceptions.csv',
              exceptions.map((e) => ({ ...e })),
            )
          }
        >
          Export Exceptions CSV
        </button>
      </div>

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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Metric
          label="Expected Billable Shipments"
          value={formatNumber(recon.expectedBillableShipments)}
        />
        <Metric label="Actual Billed Shipments" value={formatNumber(recon.actualBilledShipments)} />
        <Metric label="Expected Charges" value={formatCurrency(recon.expectedCharges, true)} />
        <Metric label="Actual Charges (Net)" value={formatCurrency(recon.actualCharges, true)} />
        <Metric label="Net Invoice Amount" value={formatCurrency(recon.netInvoiceAmount, true)} />
        <Metric label="Recognized Revenue" value={formatCurrency(recon.recognizedRevenue, true)} />
        <Metric label="Unbilled Exposure" value={formatCurrency(recon.unbilledExposure, true)} />
        <Metric label="Billing Accuracy" value={formatPercent(recon.billingAccuracy)} />
        <Metric
          label="Reconciliation Difference"
          value={formatCurrency(recon.reconciliationDifference, true)}
          hint="Actual net charges − expected rate-card charges"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="Volume Reconciliation (packages)"
          subtitle="Package counts only — separate axis from dollars"
          businessQuestion="Are billable packages becoming billed lines?"
          formula="Billed shipments / Billable shipments = billing accuracy numerator/denominator"
          source="fact_shipment, fact_billing_line"
          timeBasis={`${filters.startPeriod} → ${filters.endPeriod}`}
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumeMatrix}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                <XAxis dataKey="metric" tick={{ fontSize: 9 }} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatNumber(Number(v))} />
                <Tooltip formatter={(v) => formatNumber(Number(v))} />
                <Bar dataKey="value" name="Packages / lines" fill="#123C35" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Duplicates excluded from billed totals: {recon.layers.billing.duplicates} flagged lines.
          </p>
        </ChartCard>

        <ChartCard
          title="Dollar Reconciliation (USD)"
          subtitle="Money amounts only — never mixed with package counts"
          businessQuestion="Do expected charges, billings, invoices, and GL revenue align?"
          formula="Compare Expected Charges → Net Billing → Invoice Net → Recognized / GL"
          source="dim_rate_card, fact_billing_line, fact_invoice, fact_revenue_recognition, fact_general_ledger"
          timeBasis={`${filters.startPeriod} → ${filters.endPeriod}`}
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dollarMatrix}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                <XAxis dataKey="metric" tick={{ fontSize: 9 }} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Bar dataKey="value" name="USD" fill="#00A86B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Invoice vs billing differences may reflect credit memos or timing — see exception classification.
          </p>
        </ChartCard>

      </div>

      <ChartCard
        title="Dollar Reconciliation Bridge"
        subtitle={`Actual − Expected = ${formatCurrencyPrecise(bridge.totalGap)}. All signed legs must sum to this gap.`}
        businessQuestion="How much of the gap is leakage vs valid discounts/credits/timing?"
        formula="Expected + Σ components = Actual Net Charges"
        source="computeReconciliationBridge"
      >
        <FloatingWaterfall
          steps={bridge.items.map((i) => ({ key: i.key, label: i.label, amount: i.amount }))}
          height={280}
        />
        <p className="mt-2 text-xs text-ink-muted">
          {bridge.reconciles ? '✓ Bridge reconciles.' : '⚠ Residual does not foot — see Unresolved.'} Open
          leakage-like components ≈ {formatCurrency(bridge.openLeakage, true)} (not equal to total variance).
        </p>
        <DataTable
          rows={bridge.items.filter((i) => i.key !== 'expected' && i.key !== 'actual').map((i) => ({ ...i, id: i.key }))}
          rowKey={(r) => r.key}
          columns={[
            { key: 'l', header: 'Component', render: (r) => r.label },
            {
              key: 'a',
              header: 'Signed Impact',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.amount),
            },
            { key: 'n', header: 'Note', render: (r) => r.note },
          ]}
        />
      </ChartCard>

      <ChartCard title="Exception Rollup by Root Cause" subtitle="Click to expand detail; Resolved excluded from open exposure">
        <DataTable
          rows={rollups.map((r) => ({ ...r, id: r.rootCauseKey }))}
          rowKey={(r) => r.rootCauseKey}
          onRowClick={(r) => setExpandedCause(expandedCause === r.rootCauseKey ? null : r.rootCauseKey)}
          columns={[
            { key: 't', header: 'Type', render: (r) => r.exceptionType },
            { key: 'c', header: 'Cases', align: 'right', render: (r) => formatNumber(r.cases) },
            {
              key: 'o',
              header: 'Open Exposure',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.openExposure),
            },
            {
              key: 'r',
              header: 'Recoverable',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.recoverable),
            },
            { key: 'own', header: 'Owner', render: (r) => r.owner },
            { key: 'recov', header: 'Recoverability', render: (r) => r.recoverability },
          ]}
        />
        {expandedCause && (
          <div className="mt-3 text-xs text-ink-muted">
            Showing detail for {expandedCause}. Trigger rules visible per row below in full exception table.
          </div>
        )}
      </ChartCard>

      <ChartCard title="Layer Snapshot" subtitle="Counts and dollars kept in separate fields">
        <dl className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
          <div className="rounded-lg bg-[#f5f8f5] p-3">
            <dt className="font-semibold text-ink">Operations</dt>
            <dd className="mt-1 text-ink-muted">
              Shipments {formatNumber(recon.layers.operations.shipments)} · Billable{' '}
              {formatNumber(recon.layers.operations.billable)}
            </dd>
          </div>
          <div className="rounded-lg bg-[#f5f8f5] p-3">
            <dt className="font-semibold text-ink">Pricing</dt>
            <dd className="mt-1 text-ink-muted">
              Expected {formatCurrency(recon.layers.pricing.expectedCharges, true)}
            </dd>
          </div>
          <div className="rounded-lg bg-[#f5f8f5] p-3">
            <dt className="font-semibold text-ink">Billing</dt>
            <dd className="mt-1 text-ink-muted">
              Lines {formatNumber(recon.layers.billing.lines)} · Net{' '}
              {formatCurrency(recon.layers.billing.netAmount, true)}
            </dd>
          </div>
          <div className="rounded-lg bg-[#f5f8f5] p-3">
            <dt className="font-semibold text-ink">Finance</dt>
            <dd className="mt-1 text-ink-muted">
              Recognized {formatCurrency(recon.layers.finance.recognized, true)} · GL{' '}
              {formatCurrency(recon.layers.finance.glRevenue, true)}
            </dd>
          </div>
        </dl>
      </ChartCard>

      <ChartCard
        title="Exception Management"
        subtitle="Rule-engine root causes with leakage vs timing classification"
        action={
          <div className="flex gap-2">
            <select
              className="rounded-md border border-slate-200 px-2 py-1 text-xs"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as ExceptionType | '')}
            >
              <option value="">All types</option>
              {[
                'Missing Billing',
                'Duplicate Billing',
                'Rate Mismatch',
                'Missing Surcharge',
                'Timing Difference',
                'Overdue AR',
                'Volume Decline',
                'High Risk Customer',
              ].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-slate-200 px-2 py-1 text-xs"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ExceptionStatus | '')}
            >
              <option value="">All statuses</option>
              {[
                'Open',
                'Investigating',
                'Pending Approval',
                'Resolved',
                'Rejected',
                'Accepted',
              ].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <DataTable
          rows={exceptions.map((e) => ({ ...e, id: e.exception_id }))}
          rowKey={(r) => r.exception_id}
          onRowClick={(r) => navigateToEntity('exception', r.exception_id, r.exception_type)}
          columns={[
            { key: 'id', header: 'Exception ID', render: (r) => r.exception_id },
            { key: 'cust', header: 'Customer', render: (r) => r.customer_id ?? '—' },
            { key: 'ship', header: 'Shipment', render: (r) => r.shipment_id ?? '—' },
            { key: 'inv', header: 'Invoice', render: (r) => r.invoice_id ?? '—' },
            {
              key: 'exp',
              header: 'Expected',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.expected_amount),
              sortValue: (r) => r.expected_amount,
            },
            {
              key: 'act',
              header: 'Actual',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.actual_amount),
              sortValue: (r) => r.actual_amount,
            },
            {
              key: 'diff',
              header: 'Difference',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.difference),
              sortValue: (r) => r.difference,
            },
            { key: 'root', header: 'Root Cause', render: (r) => r.root_cause },
            {
              key: 'rule',
              header: 'Trigger Rule',
              render: (r) => <span className="font-mono text-[10px]">{r.trigger_rule}</span>,
            },
            {
              key: 'nature',
              header: 'Nature',
              render: (r) => classifyExceptionNature(r).category,
            },
            { key: 'owner', header: 'Owner', render: (r) => r.owner },
            {
              key: 'status',
              header: 'Status',
              render: (r) => (
                <select
                  className="filter-input py-0.5 text-[10px]"
                  value={r.status}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    updateExceptionStatus(r.exception_id, e.target.value as ExceptionStatus)
                  }
                >
                  {[
                    'Open',
                    'Investigating',
                    'Pending Approval',
                    'Resolved',
                    'Rejected',
                    'Accepted',
                  ].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ),
            },
            { key: 'notes', header: 'Resolution Notes', render: (r) => r.resolution_notes || '—' },
          ]}
        />
      </ChartCard>
    </div>
  )
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold text-ink">{value}</p>
      {hint && <p className="mt-1 text-[10px] text-ink-muted">{hint}</p>}
    </div>
  )
}
