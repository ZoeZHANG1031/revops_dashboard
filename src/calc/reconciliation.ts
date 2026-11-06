import {
  filterBillingLines,
  filterBillingLinesIncludingDuplicates,
  filterInvoices,
  filterShipments,
} from '@/lib/filters'
import { money, pct, sumMoney } from '@/lib/money'
import type { DataStore, FactException, GlobalFilters } from '@/types'
import { computeRecognizedRevenue } from './recognizedRevenue'

export interface ReconciliationSummary {
  expectedBillableShipments: number
  actualBilledShipments: number
  expectedCharges: number
  actualCharges: number
  netInvoiceAmount: number
  recognizedRevenue: number
  unbilledExposure: number
  billingAccuracy: number | null
  reconciliationDifference: number
  layers: {
    operations: { shipments: number; billable: number }
    pricing: { expectedCharges: number }
    billing: { lines: number; netAmount: number; duplicates: number }
    finance: { recognized: number; glRevenue: number; invoiceNet: number }
  }
  warnings: string[]
}

export function computeReconciliation(
  data: DataStore,
  filters: GlobalFilters,
): ReconciliationSummary {
  const shipments = filterShipments(data, filters)
  const billable = shipments.filter((s) => s.billable)
  const lines = filterBillingLines(data, filters)
  const allLines = filterBillingLinesIncludingDuplicates(data, filters)
  const duplicates = allLines.filter((l) => l.is_duplicate)
  const invoices = filterInvoices(data, filters)

  const billedShipmentIds = new Set(lines.map((l) => l.shipment_id))
  const missing = billable.filter((s) => !billedShipmentIds.has(s.shipment_id))

  // Expected charges from rate cards for billable shipments
  let expectedCharges = 0
  billable.forEach((s) => {
    const card = data.rateCards.find(
      (r) =>
        r.contract_id === s.contract_id &&
        r.service_type === s.service_type &&
        r.region === s.region &&
        r.effective_from <= s.ship_date &&
        r.effective_to >= s.ship_date,
    )
    if (!card) return
    let base = card.base_rate + s.weight_lbs * card.per_lb_rate
    base = base * (1 + (s.zone - 1) * 0.08 * card.zone_multiplier)
    const fuel = (base) * card.fuel_surcharge_pct
    const remote = s.is_remote ? card.remote_surcharge : 0
    expectedCharges += base + fuel + remote
  })
  expectedCharges = money(expectedCharges)

  const actualCharges = sumMoney(lines.map((l) => l.net_amount))
  const netInvoiceAmount = sumMoney(invoices.map((i) => i.net_amount))
  const recognizedRevenue = computeRecognizedRevenue(data, filters).amount

  const glRevenue = sumMoney(
    data.generalLedger
      .filter(
        (g) =>
          g.account_code === '4000' &&
          g.accounting_period >= filters.startPeriod &&
          g.accounting_period <= filters.endPeriod &&
          (filters.customerIds.length === 0 ||
            (g.customer_id != null && filters.customerIds.includes(g.customer_id))),
      )
      .map((g) => g.credit - g.debit),
  )

  const unbilledExposure = sumMoney(
    data.exceptions
      .filter((e) => {
        if (e.exception_type !== 'Missing Billing') return false
        if (!e.shipment_id) return false
        return missing.some((m) => m.shipment_id === e.shipment_id)
      })
      .map((e) => e.expected_amount),
  )

  // Fallback: compute from missing if exception list incomplete for filter
  const unbilled =
    unbilledExposure ||
    money(
      missing.reduce((acc, s) => {
        const exc = data.exceptions.find(
          (e) => e.shipment_id === s.shipment_id && e.exception_type === 'Missing Billing',
        )
        return acc + (exc?.expected_amount ?? 0)
      }, 0),
    )

  const billingAccuracy = pct(lines.length, billable.length)
  const reconciliationDifference = money(actualCharges - expectedCharges)

  const warnings: string[] = []
  const invoiceVsBilling = money(
    netInvoiceAmount -
      sumMoney(lines.filter((l) => l.invoice_id).map((l) => l.net_amount)) +
      sumMoney(
        data.creditMemos
          .filter(
            (c) =>
              c.accounting_period >= filters.startPeriod &&
              c.accounting_period <= filters.endPeriod &&
              (filters.customerIds.length === 0 || filters.customerIds.includes(c.customer_id)),
          )
          .map((c) => c.amount),
      ),
  )
  // Invoice net should ≈ billing net − credit memos
  const billingNet = sumMoney(lines.map((l) => l.net_amount))
  const creditMemos = sumMoney(
    data.creditMemos
      .filter(
        (c) =>
          c.accounting_period >= filters.startPeriod &&
          c.accounting_period <= filters.endPeriod &&
          (filters.customerIds.length === 0 || filters.customerIds.includes(c.customer_id)),
      )
      .map((c) => c.amount),
  )
  const expectedInvoice = money(billingNet - creditMemos)
  if (Math.abs(money(netInvoiceAmount - expectedInvoice)) > 1) {
    warnings.push(
      `Data Quality Warning: Invoice net (${netInvoiceAmount}) differs from billing−credits (${expectedInvoice}) by ${money(netInvoiceAmount - expectedInvoice)}.`,
    )
  }
  if (Math.abs(money(recognizedRevenue - glRevenue)) > 1) {
    warnings.push(
      `Data Quality Warning: Recognized revenue (${recognizedRevenue}) differs from GL revenue credits (${glRevenue}) by ${money(recognizedRevenue - glRevenue)}.`,
    )
  }
  void invoiceVsBilling

  return {
    expectedBillableShipments: billable.length,
    actualBilledShipments: billedShipmentIds.size,
    expectedCharges,
    actualCharges,
    netInvoiceAmount,
    recognizedRevenue,
    unbilledExposure: unbilled,
    billingAccuracy,
    reconciliationDifference,
    layers: {
      operations: { shipments: shipments.length, billable: billable.length },
      pricing: { expectedCharges },
      billing: {
        lines: lines.length,
        netAmount: actualCharges,
        duplicates: duplicates.length,
      },
      finance: {
        recognized: recognizedRevenue,
        glRevenue,
        invoiceNet: netInvoiceAmount,
      },
    },
    warnings,
  }
}

export function classifyExceptionNature(exc: FactException): {
  category: 'Revenue Leakage' | 'Contract Adjustment' | 'Timing Difference' | 'Unverified Anomaly'
  note: string
} {
  if (exc.exception_type === 'Timing Difference') {
    return { category: 'Timing Difference', note: 'Accounting cut-off; not leakage.' }
  }
  if (exc.exception_type === 'Credit Memo Adjustment' || exc.status === 'Accepted') {
    return { category: 'Contract Adjustment', note: 'Documented commercial/accounting adjustment.' }
  }
  if (
    exc.exception_type === 'Missing Billing' ||
    exc.exception_type === 'Duplicate Billing' ||
    exc.exception_type === 'Rate Mismatch' ||
    exc.exception_type === 'Missing Surcharge'
  ) {
    return { category: 'Revenue Leakage', note: 'Potential preventable revenue leakage.' }
  }
  return { category: 'Unverified Anomaly', note: 'Requires investigation before classification.' }
}

export function validateBillingVsInvoice(data: DataStore): { ok: boolean; details: string[] } {
  const details: string[] = []
  let ok = true
  data.invoices.forEach((inv) => {
    const lines = data.billingLines.filter((b) => b.invoice_id === inv.invoice_id && !b.is_duplicate)
    const lineNet = sumMoney(lines.map((l) => l.net_amount))
    const credits = sumMoney(
      data.creditMemos.filter((c) => c.invoice_id === inv.invoice_id).map((c) => c.amount),
    )
    const expected = money(lineNet - credits)
    if (Math.abs(money(expected - inv.net_amount)) > 0.02) {
      ok = false
      details.push(`${inv.invoice_id}: expected ${expected}, invoice ${inv.net_amount}`)
    }
  })
  return { ok, details }
}

export function validateRevRecVsGl(data: DataStore): { ok: boolean; details: string[] } {
  const details: string[] = []
  let ok = true
  const headers = data.revenueRecognition.filter((r) => r.billing_line_id === null)
  headers.forEach((h) => {
    const gl = sumMoney(
      data.generalLedger
        .filter((g) => g.rev_rec_id === h.rev_rec_id && g.account_code === '4000')
        .map((g) => g.credit - g.debit),
    )
    if (Math.abs(money(gl - h.amount)) > 0.02) {
      ok = false
      details.push(`${h.rev_rec_id}: rev ${h.amount}, gl ${gl}`)
    }
  })
  return { ok, details }
}
