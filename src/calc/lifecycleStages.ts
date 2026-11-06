import { filterBillingLines, filterExceptions, filterShipments } from '@/lib/filters'
import { pkgs } from '@/lib/pricing'
import { rowsInPeriodRange } from '@/lib/periodIndex'
import { money, pct, sumMoney } from '@/lib/money'
import type { DataStore, ExceptionType, FactException, GlobalFilters } from '@/types'
import { computeRecognizedRevenue } from './recognizedRevenue'
import { computeSharedMetrics } from './metricRegistry'

export type LifecycleNodeId =
  | 'contract'
  | 'shipment'
  | 'rating'
  | 'billing'
  | 'recognition'
  | 'collection'

export type LifecycleGapId =
  | 'gap_contract_shipment'
  | 'gap_shipment_rating'
  | 'gap_rating_billing'
  | 'gap_billing_recognition'
  | 'gap_recognition_collection'

export type LifecycleTone = 'ok' | 'watch' | 'alert' | 'neutral'
export type LifecycleUnit = 'money' | 'count' | 'percent'

export interface LifecycleKpi {
  label: string
  value: number | null
  unit: LifecycleUnit
  note?: string
}

export interface LifecycleDetail {
  id: LifecycleNodeId | LifecycleGapId
  title: string
  question: string
  source: string
  logic: string
  /** Explicit caveat about what this number is NOT */
  caveat: string
  kpis: LifecycleKpi[]
  exceptionTypes: ExceptionType[]
  /** Which monthly series to chart for this node / gap */
  trendKeys: ('shipments' | 'billable' | 'netBilling' | 'recognized' | 'cash')[]
}

export interface LifecycleNode {
  id: LifecycleNodeId
  label: string
  activity: string
  metricLabel: string
  value: number
  unit: LifecycleUnit
  openExceptions: number
  status: LifecycleTone
  statusLabel: string
}

export interface LifecycleGap {
  id: LifecycleGapId
  label: string
  value: number | null
  unit: LifecycleUnit
  tone: LifecycleTone
  title: string
}

export interface LifecycleMonth {
  period: string
  shipments: number
  billable: number
  netBilling: number
  recognized: number
  cash: number
}

/** Exception types mapped to the lifecycle stage where they originate */
export const STAGE_EXCEPTION_TYPES: Record<LifecycleNodeId, ExceptionType[]> = {
  contract: ['Customer Mapping Error'],
  shipment: ['Missing Shipment ID'],
  rating: ['Rate Mismatch', 'Missing Surcharge'],
  billing: ['Missing Billing', 'Unbilled Packages', 'Duplicate Billing'],
  recognition: ['Timing Difference', 'Credit Memo Adjustment', 'Invoice GL Mismatch'],
  collection: ['Overdue AR'],
}

export const STATUS_RULE =
  'Stage status: no open/investigating exceptions → Clear; any open High/Critical → Alert; otherwise Watch.'

function isOpen(e: FactException) {
  return e.status === 'Open' || e.status === 'Investigating' || e.status === 'Pending Approval'
}

function stageStatus(open: FactException[]): { status: LifecycleTone; statusLabel: string } {
  if (open.length === 0) return { status: 'ok', statusLabel: 'Clear' }
  if (open.some((e) => e.severity === 'Critical' || e.severity === 'High'))
    return { status: 'alert', statusLabel: 'Alert' }
  return { status: 'watch', statusLabel: 'Watch' }
}

export function computeLifecycleStages(
  data: DataStore,
  filters: GlobalFilters,
  scenario: 'Base' | 'Upside' | 'Downside' = 'Base',
) {
  const m = computeSharedMetrics(data, filters, scenario)
  const shipments = filterShipments(data, filters)
  const lines = filterBillingLines(data, filters)
  const exceptions = filterExceptions(data, filters)
  const open = exceptions.filter(isOpen)
  const openBy = (types: ExceptionType[]) => open.filter((e) => types.includes(e.exception_type))

  const customerScoped = filters.customerIds.length > 0
  // Contracts effective at the end of the window (contracts are versioned over time)
  const asOf = `${filters.endPeriod}-28`
  const activeContracts = data.contracts.filter(
    (c) =>
      c.start_date <= asOf &&
      c.end_date >= asOf &&
      (!customerScoped || filters.customerIds.includes(c.customer_id)),
  )
  const contractedCustomers = new Set(activeContracts.map((c) => c.customer_id))
  const shippingCustomers = new Set(shipments.map((s) => s.customer_id))
  const contractedShipping = [...contractedCustomers].filter((c) => shippingCustomers.has(c)).length

  const billable = shipments.filter((s) => s.billable)
  // Billed set uses ALL non-duplicate billing lines (any period) so cross-period billing is a timing
  // difference, not "unbilled".
  const everBilled = new Set<string>()
  for (const b of data.billingLines) if (!b.is_duplicate) everBilled.add(b.shipment_id)
  const unbilledShipments = pkgs(billable.filter((s) => !everBilled.has(s.shipment_id)))
  const billedInPeriodPkgs = pkgs(lines)

  const discounts = sumMoney(lines.map((l) => l.discounts))
  const credits = sumMoney(lines.map((l) => l.credits))
  const recognized = m.recognizedRevenue
  const billingRecognitionDiff = money(m.netBilledRevenue - recognized)
  const timingExceptionImpact = sumMoney(
    exceptions.filter((e) => e.exception_type === 'Timing Difference').map((e) => e.financial_impact),
  )
  const creditMemoImpact = sumMoney(
    exceptions
      .filter((e) => e.exception_type === 'Credit Memo Adjustment')
      .map((e) => e.financial_impact),
  )

  const node = (
    id: LifecycleNodeId,
    label: string,
    activity: string,
    metricLabel: string,
    value: number,
    unit: LifecycleUnit,
  ): LifecycleNode => {
    const o = openBy(STAGE_EXCEPTION_TYPES[id])
    return { id, label, activity, metricLabel, value, unit, openExceptions: o.length, ...stageStatus(o) }
  }

  const nodes: LifecycleNode[] = [
    node('contract', 'Contract', 'Active agreements', 'Active contracts (TCV ≠ revenue)', activeContracts.length, 'count'),
    node('shipment', 'Shipment', 'Physical volume', 'Packages shipped (ship_date)', pkgs(shipments), 'count'),
    node('rating', 'Rating', 'Rate-card charges', 'Gross rated charges', m.grossBillings, 'money'),
    node('billing', 'Billing', 'Net commercial bill', 'Net Billing', m.netBilledRevenue, 'money'),
    node('recognition', 'Recognition', 'Booked revenue', 'Recognized Revenue', recognized, 'money'),
    node('collection', 'Collection', 'Cash application', 'Cash collected (payment_date)', m.cashCollections, 'money'),
  ]

  const unbilledShare = pct(unbilledShipments, pkgs(billable))
  const gaps: LifecycleGap[] = [
    {
      id: 'gap_contract_shipment',
      label: 'Contracted shipping',
      value: pct(contractedShipping, contractedCustomers.size),
      unit: 'percent',
      tone: 'neutral',
      title: 'Share of customers with an Active contract that shipped in the period',
    },
    {
      id: 'gap_shipment_rating',
      label: 'Unbilled billable',
      value: unbilledShipments,
      unit: 'count',
      tone:
        unbilledShipments === 0 ? 'ok' : (unbilledShare ?? 0) > 2 ? 'alert' : 'watch',
      title: 'Billable shipments with no non-duplicate billing line in any period',
    },
    {
      id: 'gap_rating_billing',
      label: 'Billing accuracy',
      value: m.billingAccuracy,
      unit: 'percent',
      tone:
        m.billingAccuracy == null
          ? 'neutral'
          : m.billingAccuracy >= 98
            ? 'ok'
            : m.billingAccuracy >= 95
              ? 'watch'
              : 'alert',
      title: 'Billed / billable shipments; discounts, credits and rating exceptions explain Rated → Net',
    },
    {
      id: 'gap_billing_recognition',
      label: 'Billing − Recognized',
      value: billingRecognitionDiff,
      unit: 'money',
      tone: 'neutral',
      title: 'Different date bases (billing vs recognition period) — timing/adjustment, not leakage',
    },
    {
      id: 'gap_recognition_collection',
      label: 'Overdue AR',
      value: m.overdueAr,
      unit: 'money',
      tone: m.overdueAr === 0 ? 'ok' : m.overdueAr > 5000 ? 'alert' : 'watch',
      title: 'Overdue invoices — collections exposure, not revenue loss or bad debt',
    },
  ]

  const details: Record<LifecycleNodeId | LifecycleGapId, LifecycleDetail> = {
    contract: {
      id: 'contract',
      title: 'Contract',
      question: 'How much contracted business is active?',
      source: 'dim_contract (status = Active)',
      logic: 'COUNT(contracts WHERE status = Active); Bookings TCV = Σ contract value over term',
      caveat: 'Bookings TCV is multi-period contract value — never current-period revenue.',
      kpis: [
        { label: 'Active contracts', value: activeContracts.length, unit: 'count' },
        { label: 'Contracted customers', value: contractedCustomers.size, unit: 'count' },
        { label: 'Bookings TCV', value: m.bookingsTcv, unit: 'money', note: '≠ revenue' },
        { label: 'Weighted pipeline', value: m.weightedPipeline, unit: 'money', note: 'Not booked' },
      ],
      exceptionTypes: STAGE_EXCEPTION_TYPES.contract,
      trendKeys: [],
    },
    shipment: {
      id: 'shipment',
      title: 'Shipment',
      question: 'How much physical volume did we move?',
      source: 'fact_shipment (ship_date in range)',
      logic: 'COUNT(shipments); Billable = shipments where billable = true',
      caveat: 'Shipments ≠ billed packages; non-billable failures are not leakage.',
      kpis: [
        { label: 'Packages shipped', value: pkgs(shipments), unit: 'count' },
        { label: 'Billable packages', value: pkgs(billable), unit: 'count' },
        { label: 'Billable rate', value: pct(pkgs(billable), pkgs(shipments)), unit: 'percent' },
      ],
      exceptionTypes: STAGE_EXCEPTION_TYPES.shipment,
      trendKeys: ['shipments', 'billable'],
    },
    rating: {
      id: 'rating',
      title: 'Rating',
      question: 'Did we price shipments correctly against the rate card?',
      source: 'fact_billing_line × dim_rate_card (effective on ship_date)',
      logic: 'Gross rated = Σ(base + fuel + remote); Expected = rate card applied to billable shipments',
      caveat: 'Expected vs Rated gap includes timing and rating exceptions — validate before recovery.',
      kpis: [
        { label: 'Gross rated charges', value: m.grossBillings, unit: 'money' },
        { label: 'Expected charges', value: m.expectedCharges, unit: 'money' },
        { label: 'Net − Expected', value: m.reconciliationVariance, unit: 'money', note: 'Reconciliation variance' },
      ],
      exceptionTypes: STAGE_EXCEPTION_TYPES.rating,
      trendKeys: [],
    },
    billing: {
      id: 'billing',
      title: 'Billing',
      question: 'How much did we bill, net of discounts and credits?',
      source: 'fact_billing_line (is_duplicate = false, accounting_period)',
      logic: 'Net Billing = Σ(base + fuel + remote − discounts − credits)',
      caveat: 'Net Billing (billing period) ≠ Recognized Revenue (recognition period).',
      kpis: [
        { label: 'Net Billing', value: m.netBilledRevenue, unit: 'money' },
        { label: 'Billed packages', value: billedInPeriodPkgs, unit: 'count', note: '≠ shipments' },
        { label: 'Discounts + credits', value: money(discounts + credits), unit: 'money' },
        { label: 'Unbilled exposure', value: m.unbilledExposure, unit: 'money', note: 'Missing / unbilled exceptions' },
      ],
      exceptionTypes: STAGE_EXCEPTION_TYPES.billing,
      trendKeys: ['netBilling'],
    },
    recognition: {
      id: 'recognition',
      title: 'Recognition',
      question: 'How much revenue did we book in the accounting period?',
      source: 'fact_revenue_recognition (header rows, accounting_period) → GL',
      logic: 'Recognized = Σ recognition header amount in period',
      caveat: 'Difference to Net Billing is a date-basis/timing difference unless an exception proves leakage.',
      kpis: [
        { label: 'Recognized Revenue', value: recognized, unit: 'money' },
        { label: 'Existing forecast', value: m.forecastExisting, unit: 'money' },
        { label: 'Variance vs Existing', value: m.forecastVarianceExisting, unit: 'money' },
      ],
      exceptionTypes: STAGE_EXCEPTION_TYPES.recognition,
      trendKeys: ['netBilling', 'recognized'],
    },
    collection: {
      id: 'collection',
      title: 'Collection',
      question: 'Are customers paying on time?',
      source: 'fact_payment (payment_date) · fact_invoice (status, due_date)',
      logic: 'Cash = Σ payments in period; AR = Σ max(0, invoice net − paid) for unpaid invoices; Overdue = status Overdue',
      caveat: 'Cash − Recognized is a timing difference; Overdue AR is not bad debt or revenue loss.',
      kpis: [
        { label: 'Cash collected', value: m.cashCollections, unit: 'money' },
        { label: 'Open AR', value: m.accountsReceivable, unit: 'money' },
        { label: 'Overdue AR', value: m.overdueAr, unit: 'money' },
      ],
      exceptionTypes: STAGE_EXCEPTION_TYPES.collection,
      trendKeys: ['recognized', 'cash'],
    },
    gap_contract_shipment: {
      id: 'gap_contract_shipment',
      title: 'Contract → Shipment',
      question: 'Are contracted customers actually shipping?',
      source: 'dim_contract × fact_shipment',
      logic: 'Contracted customers with ≥1 shipment ÷ contracted customers',
      caveat: 'Non-shipping accounts may be ramping or seasonal — Possible Driver, not confirmed churn.',
      kpis: [
        { label: 'Contracted customers', value: contractedCustomers.size, unit: 'count' },
        { label: 'Of which shipping', value: contractedShipping, unit: 'count' },
        { label: 'Shipping rate', value: pct(contractedShipping, contractedCustomers.size), unit: 'percent' },
      ],
      exceptionTypes: ['Volume Decline', 'Customer Mapping Error'],
      trendKeys: ['shipments'],
    },
    gap_shipment_rating: {
      id: 'gap_shipment_rating',
      title: 'Shipment → Billing',
      question: 'Which billable shipments never reached a bill?',
      source: 'fact_shipment (billable) anti-join fact_billing_line',
      logic: 'Unbilled = billable shipments with no non-duplicate billing line in any period',
      caveat: 'Cross-period billing is a timing difference and is excluded from Unbilled.',
      kpis: [
        { label: 'Billable packages', value: pkgs(billable), unit: 'count' },
        { label: 'Unbilled packages', value: unbilledShipments, unit: 'count' },
        { label: 'Unbilled share', value: unbilledShare, unit: 'percent' },
        { label: 'Unbilled exposure', value: m.unbilledExposure, unit: 'money', note: 'From exceptions' },
      ],
      exceptionTypes: ['Missing Billing', 'Unbilled Packages', 'Rate Mismatch', 'Missing Surcharge'],
      trendKeys: ['shipments', 'billable'],
    },
    gap_rating_billing: {
      id: 'gap_rating_billing',
      title: 'Rating → Billing',
      question: 'How accurate is billing, and what reduces rated charges?',
      source: 'fact_billing_line',
      logic: 'Billing accuracy = billed ÷ billable; Rated − Net = discounts + credits',
      caveat: 'Contractual discounts and credits are adjustments, not leakage.',
      kpis: [
        { label: 'Billing accuracy', value: m.billingAccuracy, unit: 'percent' },
        { label: 'Discounts', value: discounts, unit: 'money' },
        { label: 'Credits', value: credits, unit: 'money' },
        { label: 'Open recoverable leakage', value: m.openRecoverableLeakage, unit: 'money', note: 'Unconfirmed' },
      ],
      exceptionTypes: ['Rate Mismatch', 'Missing Surcharge', 'Duplicate Billing'],
      trendKeys: ['netBilling'],
    },
    gap_billing_recognition: {
      id: 'gap_billing_recognition',
      title: 'Billing → Recognition',
      question: 'Why does Net Billing differ from Recognized Revenue?',
      source: 'fact_billing_line vs fact_revenue_recognition',
      logic: 'Difference = Net Billing (billing period) − Recognized (recognition period)',
      caveat: 'Two date bases — classified as timing / adjustment, never as leakage without an exception.',
      kpis: [
        { label: 'Net Billing − Recognized', value: billingRecognitionDiff, unit: 'money' },
        { label: 'Timing Difference exceptions', value: timingExceptionImpact, unit: 'money' },
        { label: 'Credit memo adjustments', value: creditMemoImpact, unit: 'money' },
      ],
      exceptionTypes: ['Timing Difference', 'Credit Memo Adjustment', 'Invoice GL Mismatch'],
      trendKeys: ['netBilling', 'recognized'],
    },
    gap_recognition_collection: {
      id: 'gap_recognition_collection',
      title: 'Recognition → Collection',
      question: 'How much recognized revenue is still unpaid or overdue?',
      source: 'fact_invoice (status) · fact_payment',
      logic: 'Overdue AR = Σ invoice net where status = Overdue; Open AR = unpaid balance',
      caveat: 'Cash − Recognized is timing; Overdue AR is collections exposure, not bad debt.',
      kpis: [
        { label: 'Recognized', value: recognized, unit: 'money' },
        { label: 'Cash collected', value: m.cashCollections, unit: 'money' },
        { label: 'Open AR', value: m.accountsReceivable, unit: 'money' },
        { label: 'Overdue AR', value: m.overdueAr, unit: 'money' },
      ],
      exceptionTypes: ['Overdue AR'],
      trendKeys: ['recognized', 'cash'],
    },
  }

  return { nodes, gaps, details, openExceptions: open, months: lifecycleMonthly(data, filters) }
}

function lifecycleMonthly(data: DataStore, filters: GlobalFilters): LifecycleMonth[] {
  const periods = new Map<string, LifecycleMonth>()
  const get = (p: string) => {
    let cur = periods.get(p)
    if (!cur) {
      cur = { period: p, shipments: 0, billable: 0, netBilling: 0, recognized: 0, cash: 0 }
      periods.set(p, cur)
    }
    return cur
  }
  for (const s of filterShipments(data, filters)) {
    const cur = get(s.ship_date.slice(0, 7))
    cur.shipments += s.package_count
    if (s.billable) cur.billable += s.package_count
  }
  for (const l of filterBillingLines(data, filters)) get(l.accounting_period).netBilling += l.net_amount
  for (const r of computeRecognizedRevenue(data, filters).rows) get(r.accounting_period).recognized += r.amount
  const payments = rowsInPeriodRange(data.payments, filters.startPeriod, filters.endPeriod, (p) =>
    p.payment_date.slice(0, 7),
  )
  for (const p of payments) {
    if (filters.customerIds.length && !filters.customerIds.includes(p.customer_id)) continue
    get(p.payment_date.slice(0, 7)).cash += p.amount
  }
  return [...periods.values()]
    .filter((x) => x.period >= filters.startPeriod && x.period <= filters.endPeriod)
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((x) => ({
      ...x,
      netBilling: money(x.netBilling),
      recognized: money(x.recognized),
      cash: money(x.cash),
    }))
}
