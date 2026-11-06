/**
 * AR snapshot helpers — Outstanding / Overdue / Aging share one invoice population.
 * Balance = invoice.net_amount − payments allocated (never negative).
 * Date basis: as-of for overdue & aging days; invoice set from filterInvoices (accounting_period).
 */
import { filterInvoices } from '@/lib/filters'
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
  outstandingAr: number
  overdueAr: number
  aging: ArAgingBucket[]
  openInvoices: FactInvoice[]
  /** Aging sum must equal outstanding within tolerance */
  agingFoots: boolean
  /** Overdue buckets sum vs overdueAr */
  overdueFoots: boolean
}

function paidByInvoice(data: DataStore): Map<string, number> {
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

export function isOverdueInvoice(inv: FactInvoice, asOf: string, outstanding: number): boolean {
  if (outstanding <= 0.005) return false
  if (inv.status === 'Overdue') return true
  return daysPastDue(inv.due_date, asOf) > 0
}

/**
 * Open invoices in the shared filter window (accounting_period) with remaining balance.
 * Aligns Collections aging with SharedMetrics accountsReceivable / overdueAr.
 */
export function computeArSnapshot(data: DataStore, filters: GlobalFilters): ArSnapshot {
  const asOf = data.meta.as_of_date
  const paidMap = paidByInvoice(data)
  const invoices = filterInvoices(data, filters)
  const openInvoices = invoices.filter((inv) => {
    if (inv.status === 'Paid') return false
    return invoiceOutstanding(inv, paidMap) > 0.005
  })

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
    outstandingAr,
    overdueAr,
    aging,
    openInvoices,
    agingFoots: Math.abs(agingSum - outstandingAr) < 0.05,
    overdueFoots: Math.abs(overdueBucketSum - overdueAr) < 0.05,
  }
}
