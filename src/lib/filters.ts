import type {
  DataStore,
  FactBillingLine,
  FactCost,
  FactException,
  FactInvoice,
  FactRevenueRecognition,
  FactShipment,
  GlobalFilters,
  RegionCode,
  ServiceType,
} from '@/types'

export function periodInRange(period: string, start: string, end: string): boolean {
  return period >= start && period <= end
}

export function matchesCustomer(customerId: string | null | undefined, filters: GlobalFilters): boolean {
  if (filters.customerIds.length === 0) return true
  if (!customerId) return false
  return filters.customerIds.includes(customerId)
}

export function matchesRegion(region: RegionCode | null | undefined, filters: GlobalFilters): boolean {
  if (filters.regions.length === 0) return true
  if (!region) return false
  return filters.regions.includes(region)
}

export function matchesService(service: ServiceType | null | undefined, filters: GlobalFilters): boolean {
  if (filters.serviceTypes.length === 0) return true
  if (!service) return false
  return filters.serviceTypes.includes(service)
}

export function filterShipments(data: DataStore, filters: GlobalFilters): FactShipment[] {
  return data.shipments.filter((s) => {
    const period = s.ship_date.slice(0, 7)
    return (
      periodInRange(period, filters.startPeriod, filters.endPeriod) &&
      matchesCustomer(s.customer_id, filters) &&
      matchesRegion(s.region, filters) &&
      matchesService(s.service_type, filters)
    )
  })
}

export function filterBillingLines(data: DataStore, filters: GlobalFilters): FactBillingLine[] {
  return data.billingLines.filter((b) => {
    return (
      periodInRange(b.accounting_period, filters.startPeriod, filters.endPeriod) &&
      matchesCustomer(b.customer_id, filters) &&
      matchesRegion(b.region, filters) &&
      matchesService(b.service_type, filters) &&
      !b.is_duplicate
    )
  })
}

export function filterBillingLinesIncludingDuplicates(
  data: DataStore,
  filters: GlobalFilters,
): FactBillingLine[] {
  return data.billingLines.filter((b) => {
    return (
      periodInRange(b.accounting_period, filters.startPeriod, filters.endPeriod) &&
      matchesCustomer(b.customer_id, filters) &&
      matchesRegion(b.region, filters) &&
      matchesService(b.service_type, filters)
    )
  })
}

export function filterInvoices(data: DataStore, filters: GlobalFilters): FactInvoice[] {
  return data.invoices.filter(
    (i) =>
      periodInRange(i.accounting_period, filters.startPeriod, filters.endPeriod) &&
      matchesCustomer(i.customer_id, filters),
  )
}

export function filterRevenue(data: DataStore, filters: GlobalFilters): FactRevenueRecognition[] {
  return data.revenueRecognition.filter((r) => {
    if (!periodInRange(r.accounting_period, filters.startPeriod, filters.endPeriod)) return false
    if (!matchesCustomer(r.customer_id, filters)) return false
    if (filters.regions.length || filters.serviceTypes.length) {
      const shipment = r.shipment_id
        ? data.shipments.find((s) => s.shipment_id === r.shipment_id)
        : null
      const billing = r.billing_line_id
        ? data.billingLines.find((b) => b.billing_line_id === r.billing_line_id)
        : null
      const region = shipment?.region ?? billing?.region
      const service = shipment?.service_type ?? billing?.service_type
      if (!matchesRegion(region, filters)) return false
      if (!matchesService(service, filters)) return false
    }
    return true
  })
}

export function filterCosts(data: DataStore, filters: GlobalFilters): FactCost[] {
  return data.costs.filter((c) => {
    return (
      periodInRange(c.accounting_period, filters.startPeriod, filters.endPeriod) &&
      matchesCustomer(c.customer_id, filters) &&
      matchesRegion(c.region, filters) &&
      matchesService(c.service_type, filters)
    )
  })
}

export function filterExceptions(data: DataStore, filters: GlobalFilters): FactException[] {
  return data.exceptions.filter((e) => {
    if (!matchesCustomer(e.customer_id, filters)) return false
    const period = e.detected_date.slice(0, 7)
    return periodInRange(period, filters.startPeriod, filters.endPeriod)
  })
}

export function defaultFilters(periods: string[], historicalEnd?: string): GlobalFilters {
  const sorted = [...periods].sort()
  // Prefer last historical month as end so Actual KPIs are populated by default
  const histEnd = historicalEnd && sorted.includes(historicalEnd)
    ? historicalEnd
    : sorted.filter((p) => p <= (historicalEnd ?? '2025-10')).pop() ?? sorted[sorted.length - 1] ?? '2025-10'
  const histPeriods = sorted.filter((p) => p <= histEnd)
  const end = histPeriods[histPeriods.length - 1] ?? histEnd
  const startIdx = Math.max(0, histPeriods.length - 3)
  return {
    startPeriod: histPeriods[startIdx] ?? end,
    endPeriod: end,
    customerIds: [],
    regions: [],
    serviceTypes: [],
    snapshot: 'Latest Synthetic Snapshot',
  }
}

export function priorPeriodRange(filters: GlobalFilters): { startPeriod: string; endPeriod: string } {
  const monthsBetween = monthDiff(filters.startPeriod, filters.endPeriod) + 1
  const priorEnd = addMonths(filters.startPeriod, -1)
  const priorStart = addMonths(priorEnd, -(monthsBetween - 1))
  return { startPeriod: priorStart, endPeriod: priorEnd }
}

export function addMonths(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number)
  const date = new Date(y, m - 1 + delta, 1)
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  return `${yy}-${mm}`
}

export function monthDiff(start: string, end: string): number {
  const [ys, ms] = start.split('-').map(Number)
  const [ye, me] = end.split('-').map(Number)
  return (ye - ys) * 12 + (me - ms)
}

export function listPeriods(data: DataStore): string[] {
  const set = new Set<string>()
  data.dates.forEach((d) => set.add(d.date_key.slice(0, 7)))
  // Include forward forecast horizon so Forecasting can show pipeline activation
  data.forecasts.forEach((f) => set.add(f.accounting_period))
  return [...set].sort()
}

export function listHistoricalPeriods(data: DataStore): string[] {
  const set = new Set<string>()
  data.dates.forEach((d) => set.add(d.date_key.slice(0, 7)))
  return [...set].sort()
}
