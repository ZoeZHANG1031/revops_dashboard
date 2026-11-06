/**
 * AR snapshot — Outstanding / Overdue / Aging share one invoice population.
 * Balance = invoice.net_amount − payments with payment_date ≤ asOf (never negative).
 * Population: every invoice dated <= asOf (customer filter only). AR is a point-in-time balance, so the
 * activity period does NOT scope it - an old unpaid invoice is still owed (and is the most overdue).
 */
import { resolveAsOf, type ArBalanceMode } from '@/lib/asOf'
import { matchesCustomer } from '@/lib/filters'
import { money, sumMoney } from '@/lib/money'
import type { DataStore, FactInvoice, GlobalFilters } from '@/types'

export interface ArAgingBucket {
  key: string
  label: string
  invoices: number
  amount: number
  overdue: boolean
}

export interface ArSnapshot {
  asOf: string
  snapshotAsOf: string
  mode: ArBalanceMode
  balanceLabel: string
  note: string
  outstandingAr: number
  overdueAr: number
  aging: ArAgingBucket[]
  openInvoices: FactInvoice[]
  agingFoots: boolean
  overdueFoots: boolean
}

/** Payments applied on or before asOf (inclusive). */
export function paidByInvoiceAsOf(data: DataStore, asOf: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of data.payments) {
    if (p.payment_date.slice(0, 10) > asOf) continue
    m.set(p.invoice_id, money((m.get(p.invoice_id) ?? 0) + p.amount))
  }
  return m
}

/** @deprecated Prefer paidByInvoiceAsOf — unscoped sum uses all payments (current ledger). */
export function paidByInvoice(data: DataStore): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of data.payments) {
    m.set(p.invoice_id, money((m.get(p.invoice_id) ?? 0) + p.amount))
  }
  return m
}

export function invoiceOutstanding(
  inv: FactInvoice,
  paidMap: Map<string, number>,
): number {
  return money(Math.max(0, inv.net_amount - (paidMap.get(inv.invoice_id) ?? 0)))
}

/** Days past due as of asOf; negative = not yet due */
export function daysPastDue(dueDate: string, asOf: string): number {
  return Math.floor((Date.parse(asOf) - Date.parse(dueDate)) / 86400000)
}

/**
 * Overdue = remaining balance and due_date < asOf.
 * Does not trust current invoice.status for historical as-of (status is snapshot-time).
 */
export function isOverdueInvoice(inv: FactInvoice, asOf: string, outstanding: number): boolean {
  if (outstanding <= 0.005) return false
  return daysPastDue(inv.due_date, asOf) > 0
}

/**
 * Open invoices (any issue period) with remaining balance as of `asOf`.
 * Aligns Collections aging with SharedMetrics accountsReceivable / overdueAr when same asOf is passed.
 */
export function computeArSnapshot(
  data: DataStore,
  filters: GlobalFilters,
  asOfInput?: string | null,
): ArSnapshot {
  const resolved = resolveAsOf(data, asOfInput)
  const { asOf, snapshotAsOf, mode, balanceLabel, note } = resolved
  const paidMap = paidByInvoiceAsOf(data, asOf)

  const invoices = data.invoices.filter(
    (inv) =>
      inv.invoice_date.slice(0, 10) <= asOf &&
      inv.status !== 'Draft' &&
      (filters.customerIds.length === 0 || matchesCustomer(inv.customer_id, filters)),
  )

  const openInvoices = invoices.filter((inv) => invoiceOutstanding(inv, paidMap) > 0.005)

  const outstandingAr = sumMoney(openInvoices.map((inv) => invoiceOutstanding(inv, paidMap)))
  const overdueInvoices = openInvoices.filter((inv) =>
    isOverdueInvoice(inv, asOf, invoiceOutstanding(inv, paidMap)),
  )
  const overdueAr = sumMoney(overdueInvoices.map((inv) => invoiceOutstanding(inv, paidMap)))

  const defs = [
    { key: 'current', label: 'Current (not overdue)', min: -Infinity, max: 0, overdue: false },
    { key: '1-30', label: '1–30 days', min: 1, max: 30, overdue: true },
    { key: '31-60', label: '31–60 days', min: 31, max: 60, overdue: true },
    { key: '61-90', label: '61–90 days', min: 61, max: 90, overdue: true },
    { key: '90+', label: '90+ days', min: 91, max: Infinity, overdue: true },
  ]

  const aging: ArAgingBucket[] = defs.map((b) => {
    const rows = openInvoices.filter((inv) => {
      const days = daysPastDue(inv.due_date, asOf)
      return days >= b.min && days <= b.max
    })
    return {
      key: b.key,
      label: b.label,
      invoices: rows.length,
      amount: sumMoney(rows.map((inv) => invoiceOutstanding(inv, paidMap))),
      overdue: b.overdue,
    }
  })

  const agingSum = sumMoney(aging.map((a) => a.amount))
  const overdueBucketSum = sumMoney(aging.filter((a) => a.overdue).map((a) => a.amount))

  return {
    asOf,
    snapshotAsOf,
    mode,
    balanceLabel,
    note,
    outstandingAr,
    overdueAr,
    aging,
    openInvoices,
    agingFoots: Math.abs(agingSum - outstandingAr) < 0.05,
    overdueFoots: Math.abs(overdueBucketSum - overdueAr) < 0.05,
  }
}
