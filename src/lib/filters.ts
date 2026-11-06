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
import { rowsInPeriodRange } from '@/lib/periodIndex'

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

export function matchesMetro(metro: string | null | undefined, filters: GlobalFilters): boolean {
  if (!filters.metros || filters.metros.length === 0) return true
  if (!metro) return false
  return filters.metros.includes(metro)
}

/** Resolve metro for a billing/cost row via shipment join when needed. */
export function shipmentMetro(
  data: DataStore,
  shipmentId: string | null | undefined,
  index?: Map<string, string>,
): string | null {
  if (!shipmentId) return null
  if (index) return index.get(shipmentId) ?? null
  return data.shipments.find((s) => s.shipment_id === shipmentId)?.metro ?? null
}

function metroIndexIfNeeded(data: DataStore, filters: GlobalFilters): Map<string, string> | null {
  if (!filters.metros || filters.metros.length === 0) return null
  return new Map(data.shipments.map((s) => [s.shipment_id, s.metro]))
}

export function filterShipments(data: DataStore, filters: GlobalFilters): FactShipment[] {
  const scoped = rowsInPeriodRange(
    data.shipments,
    filters.startPeriod,
    filters.endPeriod,
    (s) => s.ship_date.slice(0, 7),
  )
  const hasCust = filters.customerIds.length > 0
  const hasRegion = filters.regions.length > 0
  const hasMetro = (filters.metros?.length ?? 0) > 0
  const hasService = filters.serviceTypes.length > 0
  if (!hasCust && !hasRegion && !hasMetro && !hasService) return scoped
  return scoped.filter((s) => {
    return (
      matchesCustomer(s.customer_id, filters) &&
      matchesRegion(s.region, filters) &&
      matchesMetro(s.metro, filters) &&
      matchesService(s.service_type, filters)
    )
  })
}

export function filterBillingLines(data: DataStore, filters: GlobalFilters): FactBillingLine[] {
  const metroIdx = metroIndexIfNeeded(data, filters)
  const needMetro = metroIdx != null
  const scoped = rowsInPeriodRange(
    data.billingLines,
    filters.startPeriod,
    filters.endPeriod,
    (b) => b.accounting_period,
  )
  return scoped.filter((b) => {
    return (
      matchesCustomer(b.customer_id, filters) &&
      matchesRegion(b.region, filters) &&
      matchesService(b.service_type, filters) &&
      !b.is_duplicate &&
      (!needMetro ||
        matchesMetro(shipmentMetro(data, b.shipment_id, metroIdx ?? undefined), filters))
    )
  })
}

export function filterBillingLinesIncludingDuplicates(
  data: DataStore,
  filters: GlobalFilters,
): FactBillingLine[] {
  const metroIdx = metroIndexIfNeeded(data, filters)
  const needMetro = metroIdx != null
  const scoped = rowsInPeriodRange(
    data.billingLines,
    filters.startPeriod,
    filters.endPeriod,
    (b) => b.accounting_period,
  )
  return scoped.filter((b) => {
    return (
      matchesCustomer(b.customer_id, filters) &&
      matchesRegion(b.region, filters) &&
      matchesService(b.service_type, filters) &&
      (!needMetro ||
        matchesMetro(shipmentMetro(data, b.shipment_id, metroIdx ?? undefined), filters))
    )
  })
}

export function filterInvoices(data: DataStore, filters: GlobalFilters): FactInvoice[] {
  const scoped = rowsInPeriodRange(
    data.invoices,
    filters.startPeriod,
    filters.endPeriod,
    (i) => i.accounting_period,
  )
  if (filters.customerIds.length === 0) return scoped
  return scoped.filter((i) => matchesCustomer(i.customer_id, filters))
}

export function filterRevenue(data: DataStore, filters: GlobalFilters): FactRevenueRecognition[] {
  const dimensional = filters.regions.length > 0 || filters.serviceTypes.length > 0 || (filters.metros?.length ?? 0) > 0
  const shipById = dimensional
    ? new Map(data.shipments.map((s) => [s.shipment_id, s] as const))
    : null
  const billById = dimensional
    ? new Map(data.billingLines.map((b) => [b.billing_line_id, b] as const))
    : null
  const metroIdx = metroIndexIfNeeded(data, filters)

  const scoped = rowsInPeriodRange(
    data.revenueRecognition,
    filters.startPeriod,
    filters.endPeriod,
    (r) => r.accounting_period,
  )
  return scoped.filter((r) => {
    if (!matchesCustomer(r.customer_id, filters)) return false
    if (dimensional) {
      const shipment = r.shipment_id ? shipById!.get(r.shipment_id) : undefined
      const billing = r.billing_line_id ? billById!.get(r.billing_line_id) : undefined
      const region = shipment?.region ?? billing?.region
      const service = shipment?.service_type ?? billing?.service_type
      const metro =
        shipment?.metro ??
        (billing ? shipmentMetro(data, billing.shipment_id, metroIdx ?? undefined) : null)
      if (!matchesRegion(region, filters)) return false
      if (!matchesService(service, filters)) return false
      if (!matchesMetro(metro, filters)) return false
    }
    return true
  })
}

export function filterCosts(data: DataStore, filters: GlobalFilters): FactCost[] {
  const metroIdx = metroIndexIfNeeded(data, filters)
  const needMetro = metroIdx != null
  const scoped = rowsInPeriodRange(
    data.costs,
    filters.startPeriod,
    filters.endPeriod,
    (c) => c.accounting_period,
  )
  const hasCust = filters.customerIds.length > 0
  const hasRegion = filters.regions.length > 0
  const hasService = filters.serviceTypes.length > 0
  if (!hasCust && !hasRegion && !needMetro && !hasService) return scoped
  return scoped.filter((c) => {
    return (
      matchesCustomer(c.customer_id, filters) &&
      matchesRegion(c.region, filters) &&
      matchesService(c.service_type, filters) &&
      (!needMetro ||
        matchesMetro(shipmentMetro(data, c.shipment_id, metroIdx ?? undefined), filters))
    )
  })
}

export function filterExceptions(data: DataStore, filters: GlobalFilters): FactException[] {
  const scoped = rowsInPeriodRange(
    data.exceptions,
    filters.startPeriod,
    filters.endPeriod,
    (e) => e.detected_date.slice(0, 7),
  )
  const dimensional =
    filters.regions.length > 0 || filters.serviceTypes.length > 0 || (filters.metros?.length ?? 0) > 0
  if (filters.customerIds.length === 0 && !dimensional) return scoped
  const shipById = dimensional ? shipmentIndex(data) : null
  return scoped.filter((e) => {
    if (!matchesCustomer(e.customer_id, filters)) return false
    if (!dimensional || !e.shipment_id) {
      // Invoice / customer-level exceptions (e.g. Overdue AR) follow invoice scoping: customer only
      return true
    }
    const s = shipById!.get(e.shipment_id)
    if (!s) return true
    return (
      matchesRegion(s.region, filters) &&
      matchesMetro(s.metro, filters) &&
      matchesService(s.service_type, filters)
    )
  })
}

const shipmentIndexCache = new WeakMap<DataStore['shipments'], Map<string, FactShipment>>()
function shipmentIndex(data: DataStore): Map<string, FactShipment> {
  let idx = shipmentIndexCache.get(data.shipments)
  if (!idx) {
    idx = new Map(data.shipments.map((s) => [s.shipment_id, s]))
    shipmentIndexCache.set(data.shipments, idx)
  }
  return idx
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
    metros: [],
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
