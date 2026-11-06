import { useMemo } from 'react'
import {
  computeArSnapshot,
  daysPastDue,
  invoiceOutstanding,
  isOverdueInvoice,
} from '@/calc/arSnapshot'
import { computeSharedMetrics } from '@/calc/metricRegistry'
import { ChartCard } from '@/components/common/ChartCard'
import { DataTable } from '@/components/common/DataTable'
import { PageHeader } from '@/components/common/PageHeader'
import { ModuleSubNav } from '@/components/layout/ModuleSubNav'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { REVENUE_OPS_NAV } from '@/lib/icons'
import { formatCurrency, formatCurrencyPrecise, formatPercent, money, pct, sumMoney } from '@/lib/money'

/** Collections & AR — cash ≠ recognized revenue. Reuses SharedMetrics + AR snapshot. */
export function CollectionsAR() {
  const { data, filters, scenario, navigateWithContext, openCustomer360 } = useApp()
  const m = useMemo(() => computeSharedMetrics(data, filters, scenario), [data, filters, scenario])
  const ar = useMemo(() => computeArSnapshot(data, filters), [data, filters])

  const aging = ar.aging.map((b) => ({
    id: b.key,
    label: b.label,
    invoices: b.invoices,
    amountExact: b.amount,
    overdue: b.overdue,
  }))

  /** Proxy: cash collected in window ÷ net invoices issued in window — not a single cohort conversion */
  const collectionRate = pct(m.cashCollections, m.netInvoiceAmount)

  const overdueRows = useMemo(() => {
    const paidMap = new Map<string, number>()
    for (const p of data.payments) {
      paidMap.set(p.invoice_id, money((paidMap.get(p.invoice_id) ?? 0) + p.amount))
    }
    return ar.openInvoices
      .filter((inv) => isOverdueInvoice(inv, ar.asOf, invoiceOutstanding(inv, paidMap)))
      .map((inv) => ({
        id: inv.invoice_id,
        customer:
          data.customers.find((c) => c.customer_id === inv.customer_id)?.customer_name ??
          inv.customer_id,
        customerId: inv.customer_id,
        period: inv.accounting_period,
        due: inv.due_date,
        daysPastDue: daysPastDue(inv.due_date, ar.asOf),
        net: inv.net_amount,
        outstanding: invoiceOutstanding(inv, paidMap),
      }))
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 100)
  }, [data, ar])

  // DSO proxy: AR / (Recognized / days in window) — N/A if no recognized
  const daysInWindow = Math.max(
    1,
    Math.round(
      (Date.parse(`${filters.endPeriod}-28`) - Date.parse(`${filters.startPeriod}-01`)) / 86400000,
    ) + 1,
  )
  const dso =
    m.recognizedRevenue > 0
      ? money((m.accountsReceivable / m.recognizedRevenue) * daysInWindow)
      : null

  return (
    <div className="space-y-5">
      <ModuleSubNav items={REVENUE_OPS_NAV} />
      <PageHeader
        path="/collections"
        scope={`${filters.startPeriod} → ${filters.endPeriod} · Cash ≠ Recognized · Open AR ≠ Overdue AR`}
        actions={
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
            onClick={() =>
              exportToCsv(
                'collections_ar.csv',
                overdueRows.map((r) => ({ ...r, disclaimer: 'Synthetic' })),
              )
            }
          >
            Export Overdue
          </button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Cash Collected" value={formatCurrency(m.cashCollections, true)} hint="payment_date in filter" />
        <Kpi
          label="Outstanding AR"
          value={formatCurrency(ar.outstandingAr, true)}
          hint={`As-of ${ar.asOf} · invoices with accounting_period in filter · net − payments`}
        />
        <Kpi
          label="Overdue AR"
          value={formatCurrency(ar.overdueAr, true)}
          hint="Due date < as-of (or status Overdue) among open balances"
          warn={ar.overdueAr > 0}
        />
        <Kpi
          label="Collection Rate (proxy)"
          value={collectionRate == null ? 'N/A' : formatPercent(collectionRate)}
          hint="Cash ÷ Net Invoice — not same-cohort conversion"
        />
        <Kpi
          label="DSO (proxy)"
          value={dso == null ? 'N/A' : `${Math.round(dso)}d`}
          hint="AR ÷ (Recognized / window days) — approximate, not standard DSO"
        />
        <Kpi
          label="Recognized (ref)"
          value={formatCurrency(m.recognizedRevenue, true)}
          hint="Not cash — contrast only"
        />
      </div>

      {(!ar.agingFoots || !ar.overdueFoots) && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Data Quality Warning — AR aging does not foot to Outstanding / Overdue within $0.05. Do not
          force-balance. Aging foots: {ar.agingFoots ? 'yes' : 'no'} · Overdue foots:{' '}
          {ar.overdueFoots ? 'yes' : 'no'}.
        </p>
      )}

      <ChartCard
        icon="collections"
        title="AR Aging"
        subtitle={`As-of ${ar.asOf} · Σ buckets = Outstanding AR · Overdue buckets = Overdue AR · same invoice set as SharedMetrics`}
        businessQuestion="Where does unpaid balance sit by aging bucket?"
      >
        <DataTable
          rows={aging.map((r) => ({ ...r, amount: r.amountExact }))}
          rowKey={(r) => r.id}
          searchable={false}
          columns={[
            { key: 'l', header: 'Bucket', render: (r) => r.label, sortValue: (r) => r.label },
            {
              key: 'n',
              header: 'Invoices',
              align: 'right',
              render: (r) => String(r.invoices),
              sortValue: (r) => r.invoices,
            },
            {
              key: 'a',
              header: 'Outstanding',
              align: 'right',
              render: (r) => formatCurrency(r.amountExact, true),
              sortValue: (r) => r.amountExact,
            },
          ]}
        />
        <p className="mt-2 text-[11px] text-ink-muted">
          Aging total {formatCurrency(sumMoney(aging.map((a) => a.amountExact)), true)} · Outstanding{' '}
          {formatCurrency(ar.outstandingAr, true)} · Overdue buckets{' '}
          {formatCurrency(sumMoney(aging.filter((a) => a.overdue).map((a) => a.amountExact)), true)}
        </p>
      </ChartCard>

      <ChartCard
        icon="risk"
        iconTone="risk"
        title="Overdue Invoices"
        subtitle="Click row → Customer 360 · Overdue ≠ confirmed revenue loss"
      >
        <DataTable
          rows={overdueRows}
          rowKey={(r) => r.id}
          onRowClick={(r) => openCustomer360(r.customerId)}
          columns={[
            { key: 'id', header: 'Invoice', render: (r) => r.id, sortValue: (r) => r.id },
            { key: 'c', header: 'Customer', render: (r) => r.customer, sortValue: (r) => r.customer },
            { key: 'p', header: 'Period', render: (r) => r.period, sortValue: (r) => r.period },
            { key: 'd', header: 'Due', render: (r) => r.due, sortValue: (r) => r.due },
            {
              key: 'o',
              header: 'Outstanding',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.outstanding),
              sortValue: (r) => r.outstanding,
            },
          ]}
        />
        <button
          type="button"
          className="mt-2 text-xs text-forest underline"
          onClick={() => navigateWithContext('/actions')}
        >
          Track collection actions in Action Center
        </button>
      </ChartCard>
    </div>
  )
}

function Kpi({
  label,
  value,
  hint,
  warn,
}: {
  label: string
  value: string
  hint?: string
  warn?: boolean
}) {
  return (
    <div className="rounded-xl border border-[#dce6df] bg-white px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${warn ? 'text-[#C44536]' : 'text-ink'}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-muted">{hint}</div>}
    </div>
  )
}
