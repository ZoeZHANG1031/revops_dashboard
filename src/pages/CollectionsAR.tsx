import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  computeArSnapshot,
  daysPastDue,
  invoiceOutstanding,
  isOverdueInvoice,
  paidByInvoiceAsOf,
} from '@/calc/arSnapshot'
import { computeSharedMetrics } from '@/calc/metricRegistry'
import { ChartCard } from '@/components/common/ChartCard'
import { Collapsible } from '@/components/common/Collapsible'
import { DataTable } from '@/components/common/DataTable'
import { PageHeader } from '@/components/common/PageHeader'
import { CompactKpi, OneLineInsight } from '@/components/revops/CompactKpi'
import { ModuleSubNav } from '@/components/layout/ModuleSubNav'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { PALETTE, REVENUE_OPS_NAV } from '@/lib/icons'
import {
  formatAxisMoney,
  formatCurrency,
  formatCurrencyPrecise,
  formatNumber,
  formatPercent,
  money,
  pct,
  sumMoney,
} from '@/lib/money'
import { listPeriods } from '@/lib/filters'

/** Collections & AR — cash ≠ recognized. Activity period vs As-of Date are separate. */
export function CollectionsAR() {
  const { data, filters, scenario, asOfDate, navigateWithContext, openCustomer360 } = useApp()
  const m = useMemo(
    () => computeSharedMetrics(data, filters, scenario, asOfDate),
    [data, filters, scenario, asOfDate],
  )
  const ar = useMemo(() => computeArSnapshot(data, filters, asOfDate), [data, filters, asOfDate])

  const cashByMonth = useMemo(() => {
    const periods = listPeriods(data).filter(
      (p) => p >= filters.startPeriod && p <= filters.endPeriod,
    )
    return periods.map((period) => {
      const amt = sumMoney(
        data.payments
          .filter((p) => {
            const mp = p.payment_date.slice(0, 7)
            return (
              mp === period &&
              (filters.customerIds.length === 0 || filters.customerIds.includes(p.customer_id))
            )
          })
          .map((p) => p.amount),
      )
      return { period, cash: amt }
    })
  }, [data, filters])

  /** Cash ÷ Net Billing — same calendar window, NOT same-invoice cohort recovery */
  const cashToNetBilling = pct(m.cashCollections, m.netBilledRevenue)

  const paidMap = useMemo(() => paidByInvoiceAsOf(data, ar.asOf), [data, ar.asOf])

  const overdueRows = useMemo(() => {
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
        outstanding: invoiceOutstanding(inv, paidMap),
        owner:
          data.customers.find((c) => c.customer_id === inv.customer_id)?.account_owner ??
          'Unassigned',
        status: inv.status,
      }))
      .sort((a, b) => b.outstanding - a.outstanding || b.daysPastDue - a.daysPastDue)
  }, [data, ar, paidMap])

  const topCustomers = useMemo(() => {
    const map = new Map<
      string,
      { customerId: string; name: string; amount: number; maxDays: number; invoices: number }
    >()
    for (const r of overdueRows) {
      const cur = map.get(r.customerId) ?? {
        customerId: r.customerId,
        name: r.customer,
        amount: 0,
        maxDays: 0,
        invoices: 0,
      }
      cur.amount = money(cur.amount + r.outstanding)
      cur.maxDays = Math.max(cur.maxDays, r.daysPastDue)
      cur.invoices += 1
      map.set(r.customerId, cur)
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, 8)
  }, [overdueRows])

  const actionRows = overdueRows.slice(0, 10)

  const daysInWindow = Math.max(
    1,
    Math.round(
      (Date.parse(`${filters.endPeriod}-28`) - Date.parse(`${filters.startPeriod}-01`)) / 86400000,
    ) + 1,
  )
  const dsoProxy =
    m.recognizedRevenue > 0
      ? money((m.accountsReceivable / m.recognizedRevenue) * daysInWindow)
      : null

  const agingMax = Math.max(...ar.aging.map((b) => b.amount), 1)
  const emptyOpen = ar.outstandingAr < 0.05

  return (
    <div className="w-full max-w-none space-y-4">
      <ModuleSubNav items={REVENUE_OPS_NAV} />
      <PageHeader
        path="/collections"
        scope={`Activity ${filters.startPeriod}→${filters.endPeriod} · ${ar.balanceLabel} · Cash ≠ Recognized`}
        actions={
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
            onClick={() =>
              exportToCsv(
                'collections_ar.csv',
                overdueRows.map((r) => ({ ...r, disclaimer: 'Synthetic', asOf: ar.asOf })),
              )
            }
          >
            Export Overdue
          </button>
        }
      />

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <CompactKpi
          label="Cash Collected"
          value={formatCurrency(m.cashCollections, true)}
          hint={`payment_date in ${filters.startPeriod}→${filters.endPeriod}`}
        />
        <CompactKpi
          label="Outstanding AR"
          value={formatCurrency(ar.outstandingAr, true)}
          hint={ar.balanceLabel}
          tag={ar.mode === 'current_remaining' ? 'Current' : 'As-of'}
        />
        <CompactKpi
          label="Overdue AR"
          value={formatCurrency(ar.overdueAr, true)}
          hint={`Due date < ${ar.asOf} · among open balances`}
          tag={ar.overdueAr > 0 ? 'Alert' : undefined}
        />
        <CompactKpi
          label="Cash / Net Billing"
          value={cashToNetBilling == null ? 'N/A' : formatPercent(cashToNetBilling)}
          hint="Same window · not same-invoice cohort recovery"
        />
      </div>

      <p className="text-[11px] text-ink-muted">
        {ar.note}
        {dsoProxy != null ? (
          <>
            {' '}
            · DSO proxy {Math.round(dsoProxy)}d (AR ÷ Recognized × window days — approximate, not
            formal DSO)
          </>
        ) : null}
      </p>

      {(!ar.agingFoots || !ar.overdueFoots) && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Aging does not foot within $0.05 — do not force-balance. Aging foots:{' '}
          {ar.agingFoots ? 'yes' : 'no'} · Overdue foots: {ar.overdueFoots ? 'yes' : 'no'}.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <ChartCard
            icon="collections"
            title="Cash Collected by Month"
            subtitle="payment_date · no target line (no cash target series)"
          >
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cashByMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    width={48}
                    tickFormatter={(v) => formatAxisMoney(Number(v))}
                  />
                  <Tooltip formatter={(v) => formatCurrencyPrecise(Number(v))} />
                  <Line
                    type="linear"
                    dataKey="cash"
                    name="Cash"
                    stroke={PALETTE.positive}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
        <div className="lg:col-span-5">
          <ChartCard
            icon="collections"
            title="AR Aging"
            subtitle={`As-of ${ar.asOf} · Σ buckets = Outstanding · overdue buckets = Overdue AR`}
          >
            {emptyOpen ? (
              <p className="py-6 text-center text-sm text-ink-muted">
                No open balance as of {ar.asOf} for invoices in the activity period.
              </p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ar.aging} layout="vertical" margin={{ left: 4, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => formatAxisMoney(Number(v))}
                    />
                    <YAxis type="category" dataKey="label" width={100} tick={{ fontSize: 10 }} />
                    <Tooltip
                      formatter={(v, _n, p) => [
                        formatCurrencyPrecise(Number(v)),
                        (p?.payload as { invoices?: number })?.invoices != null
                          ? `${(p!.payload as { invoices: number }).invoices} invoices`
                          : 'Outstanding',
                      ]}
                    />
                    <Bar dataKey="amount" name="Outstanding" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                      {ar.aging.map((b) => (
                        <Cell
                          key={b.key}
                          fill={b.overdue ? (b.amount / agingMax > 0.5 ? '#C44536' : '#E58A2B') : PALETTE.brandMid}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {!emptyOpen && (
              <p className="mt-1 text-[10px] text-ink-muted">
                Σ {formatCurrency(sumMoney(ar.aging.map((a) => a.amount)), true)} = Outstanding{' '}
                {formatCurrency(ar.outstandingAr, true)}
              </p>
            )}
          </ChartCard>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <ChartCard
            icon="customers"
            iconTone="customer"
            title="Top Overdue Customers"
            subtitle={`As-of ${ar.asOf} · amount · max days past due · invoice count`}
          >
            {topCustomers.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-muted">No overdue balances as of {ar.asOf}.</p>
            ) : (
              <ul className="space-y-1.5">
                {topCustomers.map((c) => (
                  <li key={c.customerId}>
                    <button
                      type="button"
                      className="flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[#f7faf8]"
                      onClick={() => openCustomer360(c.customerId)}
                    >
                      <span className="truncate font-medium text-ink">{c.name}</span>
                      <span className="shrink-0 font-mono tabular-nums text-ink">
                        {formatCurrency(c.amount, true)} · {c.maxDays}d · {c.invoices} inv
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>
        </div>
        <div className="lg:col-span-7">
          <ChartCard
            icon="risk"
            iconTone="risk"
            title="Prioritized Collection Actions"
            subtitle="Sort: outstanding amount → days overdue · Owner from account_owner (Unassigned if missing)"
          >
            {actionRows.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-sm text-ink-muted">No open overdue invoices as of {ar.asOf}.</p>
                <OneLineInsight>Cash trend above still reflects activity-period collections.</OneLineInsight>
              </div>
            ) : (
              <DataTable
                rows={actionRows}
                rowKey={(r) => r.id}
                searchable={false}
                defaultPageSize={10}
                onRowClick={(r) => openCustomer360(r.customerId)}
                columns={[
                  { key: 'c', header: 'Customer', render: (r) => r.customer },
                  { key: 'id', header: 'Invoice', render: (r) => r.id },
                  {
                    key: 'o',
                    header: 'Outstanding',
                    align: 'right',
                    render: (r) => formatCurrencyPrecise(r.outstanding),
                    sortValue: (r) => r.outstanding,
                  },
                  {
                    key: 'd',
                    header: 'Days Overdue',
                    align: 'right',
                    render: (r) => String(r.daysPastDue),
                    sortValue: (r) => r.daysPastDue,
                  },
                  { key: 'own', header: 'Owner', render: (r) => r.owner },
                  {
                    key: 'na',
                    header: 'Next Action',
                    render: () => 'Unassigned',
                  },
                  { key: 'st', header: 'Status', render: (r) => r.status },
                ]}
              />
            )}
            <button
              type="button"
              className="mt-2 text-xs text-forest underline"
              onClick={() => navigateWithContext('/actions', { sourcePage: '/collections' })}
            >
              Open Action Center →
            </button>
          </ChartCard>
        </div>
      </div>

      {!emptyOpen && (
        <Collapsible title="Aging detail table" subtitle="Same five buckets">
          <DataTable
            rows={ar.aging.map((b) => ({ ...b, id: b.key }))}
            rowKey={(r) => r.id}
            searchable={false}
            columns={[
              { key: 'l', header: 'Bucket', render: (r) => r.label },
              {
                key: 'n',
                header: 'Invoices',
                align: 'right',
                render: (r) => formatNumber(r.invoices),
              },
              {
                key: 'a',
                header: 'Outstanding',
                align: 'right',
                render: (r) => formatCurrencyPrecise(r.amount),
              },
            ]}
          />
        </Collapsible>
      )}
    </div>
  )
}
