import { filterBillingLines, filterCosts, filterShipments } from '@/lib/filters'
import { money, pct, sumMoney } from '@/lib/money'
import type { DataStore, GlobalFilters, OperationalStatus } from '@/types'
import { computeCustomerHealth } from './customerHealth'

export interface DeliveryPerformanceImpact {
  otdRate: number | null
  firstAttemptSuccess: number | null
  failedDeliveryRate: number | null
  lossRate: number | null
  claimsCost: number
  creditCost: number
  revenueImpactFromFailures: number
  atRiskCustomersLinked: number
  explanation: string[]
  byService: Array<{
    service: string
    otd: number | null
    failedRate: number | null
    revenue: number
    claims: number
  }>
}

export function computeDeliveryPerformanceImpact(
  data: DataStore,
  filters: GlobalFilters,
): DeliveryPerformanceImpact {
  const shipments = filterShipments(data, filters)
  const n = shipments.length
  const delivered = shipments.filter((s) => s.delivery_status === 'Delivered')
  const failed = shipments.filter((s) => s.delivery_status === 'Failed' || s.delivery_status === 'Returned')
  const otd = shipments.filter((s) => s.on_time).length
  const fas = shipments.filter((s) => s.first_attempt_success).length
  const lost = shipments.filter((s) => s.delivery_status === 'Returned').length

  const claimsCost = sumMoney(
    filterCosts(data, filters)
      .filter((c) => c.cost_type === 'Claims')
      .map((c) => c.amount),
  )
  const creditCost = sumMoney(filterBillingLines(data, filters).map((b) => b.credits))

  // Estimated revenue impact: failed non-billable + credits + claims (cost, not double-counted as revenue)
  const failedNonBillable = failed.filter((s) => !s.billable)
  const avgRate =
    filterBillingLines(data, filters).length > 0
      ? money(
          sumMoney(filterBillingLines(data, filters).map((b) => b.net_amount)) /
            filterBillingLines(data, filters).length,
        )
      : 7
  const revenueImpactFromFailures = money(
    failedNonBillable.length * avgRate + creditCost,
  )

  const health = computeCustomerHealth(data, filters)
  const atRiskCustomersLinked = health.filter(
    (h) =>
      h.healthScore < 55 &&
      ((h.deliveryPerformance ?? 100) < 95 || h.drivers.some((d) => d.includes('Delivery'))),
  ).length

  const services = [...new Set(shipments.map((s) => s.service_type))]
  const byService = services.map((service) => {
    const subset = shipments.filter((s) => s.service_type === service)
    const rev = sumMoney(
      filterBillingLines(data, { ...filters, serviceTypes: [service] }).map((b) => b.net_amount),
    )
    const claims = sumMoney(
      filterCosts(data, { ...filters, serviceTypes: [service] })
        .filter((c) => c.cost_type === 'Claims')
        .map((c) => c.amount),
    )
    return {
      service,
      otd: pct(subset.filter((s) => s.on_time).length, subset.length),
      failedRate: pct(
        subset.filter((s) => s.delivery_status === 'Failed' || s.delivery_status === 'Returned').length,
        subset.length,
      ),
      revenue: rev,
      claims,
    }
  })

  const explanation: string[] = []
  const failedRate = pct(failed.length, n)
  if ((failedRate ?? 0) > 4) {
    explanation.push(
      `Failed/returned rate ${failedRate}% reduces billable conversion and drives SLA credits.`,
    )
  }
  if (claimsCost > 0) {
    explanation.push(
      `Claims cost ${claimsCost.toFixed(0)} hits contribution profit directly (expense), separate from billing credits.`,
    )
  }
  if (atRiskCustomersLinked > 0) {
    explanation.push(
      `${atRiskCustomersLinked} at-risk customers show delivery-linked health pressure — retention risk, not recognized loss yet.`,
    )
  }
  if (explanation.length === 0) {
    explanation.push('Delivery KPIs are within normal bands for the filtered window.')
  }

  return {
    otdRate: pct(otd, n),
    firstAttemptSuccess: pct(fas, n),
    failedDeliveryRate: failedRate,
    lossRate: pct(lost, n),
    claimsCost,
    creditCost,
    revenueImpactFromFailures,
    atRiskCustomersLinked,
    explanation,
    byService,
  }
}

export interface GeoProfitRow {
  key: string
  label: string
  dimension: 'metro' | 'zone' | 'service'
  revenue: number
  packages: number
  dspCost: number
  contributionMargin: number | null
  rpp: number | null
}

export function computeGeographicProfitability(
  data: DataStore,
  filters: GlobalFilters,
  dimension: 'metro' | 'zone' | 'service' = 'metro',
): GeoProfitRow[] {
  const lines = filterBillingLines(data, filters)
  const map = new Map<
    string,
    { label: string; revenue: number; packages: number; dspCost: number }
  >()

  lines.forEach((l) => {
    const ship = data.shipments.find((s) => s.shipment_id === l.shipment_id)
    let key = ''
    let label = ''
    if (dimension === 'metro') {
      key = ship?.metro ?? `${l.region}-Unknown`
      label = key
    } else if (dimension === 'zone') {
      key = `${l.region}-Z${ship?.zone ?? '?'}`
      label = key
    } else {
      key = l.service_type
      label = l.service_type
    }
    const cur = map.get(key) ?? { label, revenue: 0, packages: 0, dspCost: 0 }
    cur.revenue += l.net_amount
    cur.packages += 1
    map.set(key, cur)
  })

  filterCosts(data, filters)
    .filter((c) => c.cost_type === 'DSP Delivery')
    .forEach((c) => {
      const ship = c.shipment_id
        ? data.shipments.find((s) => s.shipment_id === c.shipment_id)
        : null
      let key = ''
      if (dimension === 'metro') key = ship?.metro ?? `${c.region}-Unknown`
      else if (dimension === 'zone') key = `${c.region}-Z${ship?.zone ?? '?'}`
      else key = c.service_type ?? 'NA'
      const cur = map.get(key)
      if (cur) cur.dspCost += c.amount
    })

  // Variable costs approx for margin: use DSP + share of other variable via package ratio is complex;
  // compute contribution using line revenue − shipment variable costs linked to those packages
  return [...map.entries()]
    .map(([key, v]) => {
      // Pull other variable costs for shipments in this bucket
      const shipIds = new Set(
        lines
          .filter((l) => {
            const ship = data.shipments.find((s) => s.shipment_id === l.shipment_id)
            if (dimension === 'metro') return (ship?.metro ?? `${l.region}-Unknown`) === key
            if (dimension === 'zone') return `${l.region}-Z${ship?.zone ?? '?'}` === key
            return l.service_type === key
          })
          .map((l) => l.shipment_id),
      )
      const varCost = sumMoney(
        filterCosts(data, filters)
          .filter(
            (c) =>
              c.shipment_id != null &&
              shipIds.has(c.shipment_id) &&
              ['DSP Delivery', 'Sorting', 'Linehaul', 'Redelivery', 'Claims', 'Other Variable'].includes(
                c.cost_type,
              ),
          )
          .map((c) => c.amount),
      )
      const cm = pct(v.revenue - varCost, v.revenue)
      return {
        key,
        label: v.label,
        dimension,
        revenue: money(v.revenue),
        packages: v.packages,
        dspCost: money(v.dspCost),
        contributionMargin: cm,
        rpp: v.packages ? money(v.revenue / v.packages) : null,
      }
    })
    .sort((a, b) => b.revenue - a.revenue)
}

export interface ShipmentRevenueFlow {
  stages: Array<{
    key: string
    label: string
    count: number
    kind: 'physical' | 'commercial'
    note: string
  }>
  conversions: Array<{ from: string; to: string; rate: number | null }>
}

export function computeShipmentToRevenueFlow(
  data: DataStore,
  filters: GlobalFilters,
): ShipmentRevenueFlow {
  const shipments = filterShipments(data, filters)
  const lines = filterBillingLines(data, filters)
  const billedIds = new Set(lines.map((l) => l.shipment_id))

  const countStatus = (statuses: OperationalStatus[]) =>
    shipments.filter((s) => statuses.includes(s.operational_status)).length

  // Cumulative funnel semantics for physical flow:
  // Accepted = all shipments that entered network
  // Sorted = progressed past accept (everything except still-only-accepted — we model all as at least Sorted once manifested)
  const accepted = shipments.length
  const sorted = shipments.filter((s) =>
    ['Sorted', 'Out for Delivery', 'Delivered', 'Failed', 'Returned'].includes(s.operational_status),
  ).length
  const ofd = shipments.filter((s) =>
    ['Out for Delivery', 'Delivered', 'Failed', 'Returned'].includes(s.operational_status),
  ).length
  const delivered = countStatus(['Delivered'])
  const billable = shipments.filter((s) => s.billable).length
  const billed = billedIds.size

  const stages = [
    {
      key: 'accepted',
      label: 'Accepted',
      count: accepted,
      kind: 'physical' as const,
      note: 'Physical: intake into last-mile network',
    },
    {
      key: 'sorted',
      label: 'Sorted',
      count: sorted,
      kind: 'physical' as const,
      note: 'Physical: facility sort complete',
    },
    {
      key: 'ofd',
      label: 'Out for Delivery',
      count: ofd,
      kind: 'physical' as const,
      note: 'Physical: with DSP for attempt',
    },
    {
      key: 'delivered',
      label: 'Delivered',
      count: delivered,
      kind: 'physical' as const,
      note: 'Physical: successful delivery outcome',
    },
    {
      key: 'billable',
      label: 'Billable',
      count: billable,
      kind: 'commercial' as const,
      note: 'Commercial: contract allows charging (may include some failed per rules)',
    },
    {
      key: 'billed',
      label: 'Billed',
      count: billed,
      kind: 'commercial' as const,
      note: 'Commercial: billing line exists (excludes duplicates)',
    },
  ]

  const conversions = [
    { from: 'Accepted', to: 'Sorted', rate: pct(sorted, accepted) },
    { from: 'Sorted', to: 'Out for Delivery', rate: pct(ofd, sorted) },
    { from: 'Out for Delivery', to: 'Delivered', rate: pct(delivered, ofd) },
    { from: 'Accepted', to: 'Billable', rate: pct(billable, accepted) },
    { from: 'Billable', to: 'Billed', rate: pct(billed, billable) },
  ]

  return { stages, conversions }
}
