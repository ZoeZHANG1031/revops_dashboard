import { daysBetween, periodEndDate, periodStartDate } from '@/lib/asOf'
import { filterBillingLines, filterShipments } from '@/lib/filters'
import { money, pct, sumMoney } from '@/lib/money'
import { expectedLotCharges, pkgs } from '@/lib/pricing'
import type { DataStore, FactShipment, GlobalFilters } from '@/types'
import { computeBillingIntegrity } from './billingIntegrity'
import { computeRecognizedRevenue } from './recognizedRevenue'

/** Demo aging buckets for unbilled backlog — not industry SLAs. */
export const DEMO_UNBILLED_AGE_BUCKETS = [
  { key: '0-7', label: '0–7d', min: 0, max: 7 },
  { key: '8-14', label: '8–14d', min: 8, max: 14 },
  { key: '15-30', label: '15–30d', min: 15, max: 30 },
  { key: '31+', label: '31+d', min: 31, max: Infinity },
] as const

export type OutsideEligibleReason =
  | 'Contract outside relevant date window'
  | 'Missing contract link'
  | 'Other / Unclassified'

export interface OutsideEligibleCustomer {
  customerId: string
  customerName: string
  packages: number
  reason: OutsideEligibleReason
}

/**
 * Activity-period eligibility: contracts whose date range overlaps the filter window.
 * Does NOT use status=Active at a single end-of-period day (that mixed historical shipping
 * with a point-in-time contract stock and inflated "outside eligible").
 */
export function computeActivationSet(data: DataStore, filters: GlobalFilters) {
  const winStart = periodStartDate(filters.startPeriod)
  const winEnd = periodEndDate(filters.endPeriod)
  const customerScoped = filters.customerIds.length > 0

  const eligibleContracts = data.contracts.filter(
    (c) =>
      c.start_date <= winEnd &&
      c.end_date >= winStart &&
      c.status !== 'Pending' &&
      (!customerScoped || filters.customerIds.includes(c.customer_id)),
  )
  const eligibleIds = new Set(eligibleContracts.map((c) => c.customer_id))
  const contractCount = eligibleContracts.length
  const eligibleCustomers = eligibleIds.size

  const shipments = filterShipments(data, filters)
  const pkgsByCustomer = new Map<string, number>()
  for (const s of shipments) {
    pkgsByCustomer.set(s.customer_id, (pkgsByCustomer.get(s.customer_id) ?? 0) + s.package_count)
  }
  const shippingIds = new Set(shipments.map((s) => s.customer_id))

  const activated = [...eligibleIds].filter((id) => shippingIds.has(id)).length
  const notYetActivated = Math.max(0, eligibleCustomers - activated)

  const contractsByCustomer = new Map<string, typeof data.contracts>()
  for (const c of data.contracts) {
    const list = contractsByCustomer.get(c.customer_id) ?? []
    list.push(c)
    contractsByCustomer.set(c.customer_id, list)
  }

  const outsideCustomers: OutsideEligibleCustomer[] = []
  for (const id of shippingIds) {
    if (eligibleIds.has(id)) continue
    const contracts = contractsByCustomer.get(id) ?? []
    let reason: OutsideEligibleReason
    if (contracts.length === 0) {
      reason = 'Missing contract link'
    } else {
      const overlapsWindow = contracts.some((c) => c.start_date <= winEnd && c.end_date >= winStart)
      // Evidence: has contracts but none overlap activity window, or only Pending
      reason = overlapsWindow
        ? 'Other / Unclassified'
        : 'Contract outside relevant date window'
    }
    outsideCustomers.push({
      customerId: id,
      customerName: data.customers.find((c) => c.customer_id === id)?.customer_name ?? id,
      packages: pkgsByCustomer.get(id) ?? 0,
      reason,
    })
  }
  outsideCustomers.sort((a, b) => b.packages - a.packages)

  const reasonCounts = {
    'Contract outside relevant date window': 0,
    'Missing contract link': 0,
    'Other / Unclassified': 0,
  } as Record<OutsideEligibleReason, number>
  for (const row of outsideCustomers) reasonCounts[row.reason]++

  return {
    winStart,
    winEnd,
    contractCount,
    eligibleCustomers,
    activated,
    notYetActivated,
    shippingOutsideEligible: outsideCustomers.length,
    outsideCustomers,
    reasonCounts,
    activationRate: pct(activated, eligibleCustomers),
    dateBasis: `Eligible = customers with contract overlapping ${filters.startPeriod}→${filters.endPeriod} (${winStart}–${winEnd}); Activated = eligible ∩ shipping (ship_date). Contracts counted separately (${contractCount}).`,
  }
}

/**
 * Unbilled billable packages as of a point-in-time.
 * Billed only if a non-duplicate billing line exists with billing_date ≤ asOf.
 * Age = days since ship_date (Days since shipment) — not auto-labeled Overdue.
 */
export function computeUnbilledBacklog(
  data: DataStore,
  filters: GlobalFilters,
  asOfInput?: string | null,
) {
  const asOf = (asOfInput ?? data.meta.as_of_date).slice(0, 10)
  const snapshotAsOf = data.meta.as_of_date
  const historicalLimit = asOf < snapshotAsOf

  const shipments = filterShipments(data, filters).filter((s) => s.ship_date <= asOf)
  const billable = shipments.filter((s) => s.billable)

  const billedByAsOf = new Set<string>()
  for (const b of data.billingLines) {
    if (b.is_duplicate) continue
    if (b.billing_date.slice(0, 10) <= asOf) billedByAsOf.add(b.shipment_id)
  }

  const unbilledLots = billable.filter((s) => !billedByAsOf.has(s.shipment_id))
  const unbilledPackages = pkgs(unbilledLots)

  let ratedAmount: number | null = 0
  let ratedOk = true
  for (const s of unbilledLots) {
    const exp = expectedLotCharges(data, s)
    if (!exp) {
      ratedOk = false
      continue
    }
    ratedAmount = money((ratedAmount ?? 0) + exp.expectedNet)
  }
  if (!unbilledLots.length) ratedAmount = 0
  if (!ratedOk && unbilledLots.length) {
    // Partial rating — still show amount from rateable lots, flag limit
  }

  const ages = unbilledLots.map((s) => daysBetween(s.ship_date, asOf))
  const oldestDays = ages.length ? Math.max(...ages) : null

  const buckets = DEMO_UNBILLED_AGE_BUCKETS.map((b) => {
    const lots = unbilledLots.filter((_, i) => ages[i] >= b.min && ages[i] <= b.max)
    return {
      key: b.key,
      label: b.label,
      packages: pkgs(lots),
      lots: lots.length,
    }
  })

  const byCust = new Map<string, { packages: number; amount: number; oldest: number }>()
  unbilledLots.forEach((s, i) => {
    const cur = byCust.get(s.customer_id) ?? { packages: 0, amount: 0, oldest: 0 }
    cur.packages += s.package_count
    const exp = expectedLotCharges(data, s)
    if (exp) cur.amount = money(cur.amount + exp.expectedNet)
    cur.oldest = Math.max(cur.oldest, ages[i])
    byCust.set(s.customer_id, cur)
  })
  const topCustomers = [...byCust.entries()]
    .map(([customerId, v]) => ({
      customerId,
      customerName: data.customers.find((c) => c.customer_id === customerId)?.customer_name ?? customerId,
      packages: v.packages,
      amount: v.amount,
      oldestDays: v.oldest,
    }))
    .sort((a, b) => b.packages - a.packages || b.amount - a.amount)
    .slice(0, 5)

  return {
    asOf,
    snapshotAsOf,
    historicalLimit,
    ageBasis: 'Days since shipment' as const,
    ageNote:
      'Age = as-of − ship_date. Not labeled Overdue — no contractual bill-by deadline in data. Demo buckets only.',
    billablePackagesInScope: pkgs(billable),
    unbilledPackages,
    unbilledLots: unbilledLots.length,
    ratedAmount: ratedAmount ?? 0,
    ratedPartial: !ratedOk && unbilledLots.length > 0,
    oldestDays,
    buckets,
    topCustomers,
    sampleLots: unbilledLots
      .slice()
      .sort((a, b) => a.ship_date.localeCompare(b.ship_date))
      .slice(0, 40),
    limitNote: historicalLimit
      ? `As-of ${asOf} is before snapshot ${snapshotAsOf}: only billing_date ≤ as-of counts as billed; invoice status history is not replayed.`
      : null,
  }
}

export function computeGrossToNetBridge(data: DataStore, filters: GlobalFilters) {
  const lines = filterBillingLines(data, filters)
  const gross = sumMoney(lines.map((l) => l.base_charge + l.fuel_surcharge + l.remote_surcharge))
  const discounts = sumMoney(lines.map((l) => l.discounts))
  const credits = sumMoney(lines.map((l) => l.credits))
  const net = sumMoney(lines.map((l) => l.net_amount))
  const explained = money(gross - discounts - credits)
  const residual = money(net - explained)

  const steps = [
    { key: 'gross', label: 'Gross Rated', amount: gross, shortLabel: 'Gross', kind: 'total' as const },
    {
      key: 'discounts',
      label: 'Contractual discounts',
      amount: money(-discounts),
      shortLabel: 'Discounts',
      kind: 'adj' as const,
    },
    {
      key: 'credits',
      label: 'Approved credits',
      amount: money(-credits),
      shortLabel: 'Credits',
      kind: 'adj' as const,
    },
    ...(Math.abs(residual) >= 0.05
      ? [
          {
            key: 'unexplained',
            label: 'Unexplained residual',
            amount: residual,
            shortLabel: 'Residual',
            kind: 'adj' as const,
          },
        ]
      : []),
    { key: 'net', label: 'Net Billing', amount: net, shortLabel: 'Net', kind: 'total' as const },
  ]

  const yieldComparable = lines.length > 0 && Math.abs(residual) < 0.05
  return {
    steps: steps.map(({ key, label, amount, shortLabel }) => ({ key, label, amount, shortLabel })),
    gross,
    discounts,
    credits,
    net,
    residual,
    foots: Math.abs(money(gross - discounts - credits + (Math.abs(residual) >= 0.05 ? residual : 0) - net)) < 0.05
      || Math.abs(money(gross - discounts - credits - net)) < 0.05,
    yieldComparable,
    yieldPct: yieldComparable ? pct(net, gross) : null,
    dateBasis: 'Same filtered billing lines (app filter uses accounting_period)',
    note: yieldComparable
      ? 'Net billing yield = Net ÷ Gross on the same filtered line set.'
      : 'Shown as amount bridge — residual prevents labeling a precise yield.',
  }
}

export function computeBillableSplit(data: DataStore, filters: GlobalFilters) {
  const shipments = filterShipments(data, filters)
  const total = pkgs(shipments)
  const billableLots = shipments.filter((s) => s.billable)
  const nonBillableLots = shipments.filter((s) => !s.billable)
  const billable = pkgs(billableLots)
  const nonBillable = pkgs(nonBillableLots)
  const unknown = Math.max(0, total - billable - nonBillable)

  const reasonMap = new Map<string, number>()
  for (const s of nonBillableLots) {
    let reason = 'Other / Unclassified'
    if (s.delivery_status === 'Failed') reason = 'Failed delivery (contract does not bill attempts)'
    else if (s.delivery_status === 'Returned') reason = 'Returned shipment (non-billable)'
    else if (s.delivery_status === 'Pending') reason = 'Pending delivery'
    reasonMap.set(reason, (reasonMap.get(reason) ?? 0) + s.package_count)
  }
  const nonBillableReasons = [...reasonMap.entries()]
    .map(([reason, packages]) => ({ reason, packages }))
    .sort((a, b) => b.packages - a.packages)

  return {
    total,
    billable,
    nonBillable,
    unknown,
    billablePct: pct(billable, total),
    nonBillablePct: pct(nonBillable, total),
    foots: billable + nonBillable + unknown === total,
    mutuallyExclusive: unknown === 0,
    nonBillableReasons,
    dateBasis: 'ship_date · billable flag',
  }
}

/** Median processing days for completed chains only — not a claim about open work. */
export function computeProcessCycleTimes(data: DataStore, filters: GlobalFilters, asOf: string) {
  const shipments = filterShipments(data, filters)
  const linesByShip = new Map<string, { billing_date: string; invoice_id: string | null }[]>()
  for (const b of data.billingLines) {
    if (b.is_duplicate) continue
    const list = linesByShip.get(b.shipment_id) ?? []
    list.push({ billing_date: b.billing_date, invoice_id: b.invoice_id })
    linesByShip.set(b.shipment_id, list)
  }
  const invoicePay = new Map<string, string>()
  for (const p of data.payments) {
    if (p.payment_date > asOf) continue
    const prev = invoicePay.get(p.invoice_id)
    if (!prev || p.payment_date < prev) invoicePay.set(p.invoice_id, p.payment_date)
  }
  const invoices = new Map(data.invoices.map((i) => [i.invoice_id, i]))

  const shipToInvoice: number[] = []
  const invoiceToPay: number[] = []
  let openWaitingShipInvoice = 0
  let openWaitingPay = 0

  for (const s of shipments) {
    const lines = linesByShip.get(s.shipment_id)
    if (!lines?.length) {
      if (s.billable && s.ship_date <= asOf) openWaitingShipInvoice += s.package_count
      continue
    }
    const firstBill = [...lines].sort((a, b) => a.billing_date.localeCompare(b.billing_date))[0]
    if (firstBill.billing_date <= asOf) {
      shipToInvoice.push(daysBetween(s.ship_date, firstBill.billing_date))
    }
    const invId = firstBill.invoice_id
    if (!invId) continue
    const inv = invoices.get(invId)
    if (!inv) continue
    const paid = invoicePay.get(invId)
    if (paid) invoiceToPay.push(daysBetween(inv.invoice_date, paid))
    else if (inv.invoice_date <= asOf) openWaitingPay += 1
  }

  const median = (arr: number[]) => {
    if (!arr.length) return null
    const s = [...arr].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
  }

  return {
    shipToInvoiceMedian: median(shipToInvoice),
    shipToInvoiceN: shipToInvoice.length,
    invoiceToPayMedian: median(invoiceToPay),
    invoiceToPayN: invoiceToPay.length,
    openWaitingShipInvoicePackages: openWaitingShipInvoice,
    openWaitingInvoices: openWaitingPay,
    note: 'Medians use completed links only. Open waiting age is separate — not averaged into “fast processing”.',
  }
}

export function computeOperationalPipeline(
  data: DataStore,
  filters: GlobalFilters,
  asOfInput?: string | null,
) {
  const asOf = (asOfInput ?? data.meta.as_of_date).slice(0, 10)
  const activation = computeActivationSet(data, filters)
  const billableSplit = computeBillableSplit(data, filters)
  const bridge = computeGrossToNetBridge(data, filters)
  const unbilled = computeUnbilledBacklog(data, filters, asOf)
  const cycles = computeProcessCycleTimes(data, filters, asOf)
  const integrity = computeBillingIntegrity(data, filters)
  const shipments = filterShipments(data, filters)
  const recognized = computeRecognizedRevenue(data, filters).amount
  const cash = sumMoney(
    data.payments
      .filter((p) => {
        const per = p.payment_date.slice(0, 7)
        if (per < filters.startPeriod || per > filters.endPeriod) return false
        if (filters.customerIds.length && !filters.customerIds.includes(p.customer_id)) return false
        return true
      })
      .map((p) => p.amount),
  )

  const stages = [
    {
      key: 'contracted',
      label: 'Eligible customers',
      value: activation.eligibleCustomers,
      unit: 'count' as const,
      dateBasis: activation.dateBasis,
    },
    {
      key: 'active',
      label: 'Activated (shipping)',
      value: activation.activated,
      unit: 'count' as const,
      dateBasis: 'Eligible ∩ ship_date in activity period',
    },
    {
      key: 'shipments',
      label: 'Packages shipped',
      value: billableSplit.total,
      unit: 'count' as const,
      dateBasis: 'ship_date',
    },
    {
      key: 'billable',
      label: 'Billable packages',
      value: billableSplit.billable,
      unit: 'count' as const,
      dateBasis: 'ship_date · billable flag',
    },
    {
      key: 'rated',
      label: 'Gross rated charges',
      value: bridge.gross,
      unit: 'money' as const,
      dateBasis: 'billing_period',
    },
    {
      key: 'net',
      label: 'Net billing',
      value: bridge.net,
      unit: 'money' as const,
      dateBasis: 'billing_period',
    },
    {
      key: 'recognized',
      label: 'Recognized revenue',
      value: recognized,
      unit: 'money' as const,
      dateBasis: 'accounting_period',
    },
    {
      key: 'cash',
      label: 'Cash collected',
      value: cash,
      unit: 'money' as const,
      dateBasis: 'payment_date',
    },
  ]

  const conversions = [
    {
      from: 'Contracted → Active',
      rate: activation.activationRate,
      kind: 'count_ratio' as const,
      leakage:
        activation.shippingOutsideEligible > 0
          ? `${activation.shippingOutsideEligible} shipping customers outside eligible set (excluded from rate)`
          : 'Eligible customers with no shipment in window',
      numerator: activation.activated,
      denominator: activation.eligibleCustomers,
    },
    {
      from: 'Shipments → Billable',
      rate: billableSplit.billablePct,
      kind: 'count_ratio' as const,
      leakage: 'Non-billable by rule (e.g. failed delivery when contract does not bill attempts)',
      numerator: billableSplit.billable,
      denominator: billableSplit.total,
    },
    {
      from: 'Net Billing ÷ Gross Rated (yield)',
      rate: bridge.yieldPct,
      kind: 'yield_ratio' as const,
      leakage: 'Contractual discounts + approved credits',
      numerator: bridge.net,
      denominator: bridge.gross,
    },
  ]

  return {
    stages,
    conversions,
    contractCount: activation.contractCount,
    eligibleCustomers: activation.eligibleCustomers,
    activeAmongEligible: activation.activated,
    notYetActivated: activation.notYetActivated,
    shippingOutsideEligible: activation.shippingOutsideEligible,
    activation,
    billableSplit,
    bridge,
    unbilled,
    cycles,
    billingAccuracy: pct(integrity.correctlyBilledPackages, integrity.eligiblePackages),
    billingAccuracyMeta: {
      label: 'Billing line accuracy',
      formula:
        'Σ packages in billable lots billed exactly once with no Rate Mismatch / Missing Surcharge / Duplicate ÷ Σ billable packages (ship_date in range)',
      eligiblePackages: integrity.eligiblePackages,
      correctlyBilledPackages: integrity.correctlyBilledPackages,
      dateBasis: 'ship_date for eligibility · billing defects from lines/exceptions',
    },
    cash,
    recognized,
    dateBasisNote:
      'Activity: ship_date / billing_period / accounting_period / payment_date. As-of: unbilled & open balances. Recognized − Cash ≠ Outstanding AR.',
    asOf,
  }
}

/** @deprecated use computeOperationalPipeline from this module via lifecycle.ts re-export */
export type OperationalPipeline = ReturnType<typeof computeOperationalPipeline>

export function nonBillableSample(
  data: DataStore,
  filters: GlobalFilters,
  limit = 40,
): FactShipment[] {
  return filterShipments(data, filters).filter((s) => !s.billable).slice(0, limit)
}
