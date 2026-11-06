import { METRO_DEFINITIONS, projectUs } from '@/data/metros'
import {
  filterBillingLines,
  filterRevenue,
  filterShipments,
  listHistoricalPeriods,
  priorPeriodRange,
} from '@/lib/filters'
import { money, pct, sumMoney } from '@/lib/money'
import type { DataStore, GlobalFilters, RegionCode, ServiceType } from '@/types'
import { computeSharedMetrics } from './metricRegistry'

export type BubbleMetric = 'shipments' | 'revenue'

export interface CompanyScaleKpis {
  periodLabel: string
  activeCustomers: number
  activeCustomerDefinition: string
  shipmentVolume: number
  recognizedRevenue: number
  netBilling: number
  activeMetroMarkets: number
  serviceTypesInPeriod: number
  unavailable: { label: string; reason: string }[]
}

export interface MetroFootprintRow {
  metro: string
  region: RegionCode
  lat: number
  lon: number
  x: number
  y: number
  shipments: number
  revenue: number
  source: string
}

export interface SegmentPortfolioRow {
  segment: 'Enterprise' | 'Mid-Market' | 'SMB'
  customers: number
  revenue: number
  revenueShare: number | null
}

export interface CustomerRankRow {
  customerId: string
  customerName: string
  segment: string
  industry: string
  region: RegionCode
  revenue: number
  revenueShare: number | null
}

export interface IndustryRow {
  industry: string
  customers: number
  revenue: number
  revenueShare: number | null
}

export interface ServicePortfolioRow {
  serviceType: ServiceType
  shipments: number
  billedPackages: number
  netBilling: number
  revenuePerPackage: number | null
  revenueShare: number | null
}

export interface MonthlyTrendRow {
  period: string
  shipments: number
  recognizedRevenue: number
  netBilling: number
}

export interface GrowthBlock {
  comparable: boolean
  priorLabel: string | null
  currentLabel: string
  shipmentGrowth: number | null
  recognizedGrowth: number | null
  netBillingGrowth: number | null
  note: string
  newCustomerRevenue: number
  existingCustomerRevenue: number
  newShare: number | null
  top5Concentration: number | null
  regionalConcentration: { region: RegionCode; revenue: number; share: number | null }[]
  hhiNote: string
}

export interface CompanyOverviewModel {
  scale: CompanyScaleKpis
  metros: MetroFootprintRow[]
  segments: SegmentPortfolioRow[]
  topCustomers: CustomerRankRow[]
  industries: IndustryRow[]
  services: ServicePortfolioRow[]
  monthly: MonthlyTrendRow[]
  growth: GrowthBlock
  sharedCheck: {
    recognizedRevenue: number
    netBilledRevenue: number
  }
}

/**
 * Active customer = distinct customer_id with ≥1 shipment OR ≥1 non-duplicate billing line
 * in the filter window (ship_date / billing accounting_period).
 */
export function computeCompanyOverview(data: DataStore, filters: GlobalFilters): CompanyOverviewModel {
  const shared = computeSharedMetrics(data, filters)
  const shipments = filterShipments(data, filters)
  const lines = filterBillingLines(data, filters)
  const periodLabel = `${filters.startPeriod} → ${filters.endPeriod}`

  const activeIds = new Set<string>()
  shipments.forEach((s) => activeIds.add(s.customer_id))
  lines.forEach((l) => activeIds.add(l.customer_id))

  const metrosInPeriod = new Set(shipments.map((s) => s.metro))
  const servicesInPeriod = new Set(shipments.map((s) => s.service_type))

  const scale: CompanyScaleKpis = {
    periodLabel,
    activeCustomers: activeIds.size,
    activeCustomerDefinition:
      'Distinct customers with ≥1 shipment (ship_date in range) OR ≥1 non-duplicate billing line (accounting_period in range)',
    shipmentVolume: shipments.length,
    recognizedRevenue: shared.recognizedRevenue,
    netBilling: shared.netBilledRevenue,
    activeMetroMarkets: metrosInPeriod.size,
    serviceTypesInPeriod: servicesInPeriod.size,
    unavailable: [
      {
        label: 'DSP Count',
        reason: 'DSP IDs exist on shipments but no dim_dsp master for unique network capacity',
      },
      {
        label: 'Facilities / Stations',
        reason: 'Not modeled in synthetic data store',
      },
    ],
  }

  const metroAgg = new Map<string, { shipments: number; revenue: number; region: RegionCode }>()
  for (const s of shipments) {
    const cur = metroAgg.get(s.metro) ?? { shipments: 0, revenue: 0, region: s.region }
    cur.shipments += 1
    metroAgg.set(s.metro, cur)
  }
  // Revenue by metro via shipment → billing (avoid JOIN fan-out: sum lines grouped by shipment metro)
  const shipMetro = new Map(shipments.map((s) => [s.shipment_id, s.metro]))
  for (const l of lines) {
    const metro = shipMetro.get(l.shipment_id)
    if (!metro) continue
    const cur = metroAgg.get(metro)
    if (!cur) continue
    cur.revenue = money(cur.revenue + l.net_amount)
  }

  const metros: MetroFootprintRow[] = METRO_DEFINITIONS.map((d) => {
    const agg = metroAgg.get(d.metro) ?? { shipments: 0, revenue: 0, region: d.region }
    const { x, y } = projectUs(d.lon, d.lat)
    return {
      metro: d.metro,
      region: d.region,
      lat: d.lat,
      lon: d.lon,
      x,
      y,
      shipments: agg.shipments,
      revenue: agg.revenue,
      source: d.source,
    }
  }).filter((m) => m.shipments > 0 || m.revenue > 0)

  const custRev = new Map<string, number>()
  for (const l of lines) {
    custRev.set(l.customer_id, money((custRev.get(l.customer_id) ?? 0) + l.net_amount))
  }
  const totalCustRev = sumMoney([...custRev.values()])

  const segments: SegmentPortfolioRow[] = (['Enterprise', 'Mid-Market', 'SMB'] as const).map(
    (segment) => {
      const custs = data.customers.filter((c) => c.segment === segment)
      const ids = new Set(custs.map((c) => c.customer_id))
      const revenue = sumMoney(
        [...custRev.entries()].filter(([id]) => ids.has(id)).map(([, v]) => v),
      )
      const activeInSeg = [...activeIds].filter((id) => ids.has(id)).length
      return {
        segment,
        customers: activeInSeg,
        revenue,
        revenueShare: pct(revenue, totalCustRev),
      }
    },
  )

  const topCustomers: CustomerRankRow[] = [...custRev.entries()]
    .map(([customerId, revenue]) => {
      const c = data.customers.find((x) => x.customer_id === customerId)!
      return {
        customerId,
        customerName: c.customer_name,
        segment: c.segment,
        industry: c.industry,
        region: c.region,
        revenue,
        revenueShare: pct(revenue, totalCustRev),
      }
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)

  const indMap = new Map<string, { customers: Set<string>; revenue: number }>()
  for (const [customerId, revenue] of custRev) {
    const c = data.customers.find((x) => x.customer_id === customerId)
    if (!c) continue
    const cur = indMap.get(c.industry) ?? { customers: new Set<string>(), revenue: 0 }
    cur.customers.add(customerId)
    cur.revenue = money(cur.revenue + revenue)
    indMap.set(c.industry, cur)
  }
  const industries: IndustryRow[] = [...indMap.entries()]
    .map(([industry, v]) => ({
      industry,
      customers: v.customers.size,
      revenue: v.revenue,
      revenueShare: pct(v.revenue, totalCustRev),
    }))
    .sort((a, b) => b.revenue - a.revenue)

  const servicesList: ServiceType[] = ['Standard', 'Economy', 'Express', 'SameDay']
  const totalNet = shared.netBilledRevenue
  const services: ServicePortfolioRow[] = servicesList.map((serviceType) => {
    const svcShips = shipments.filter((s) => s.service_type === serviceType)
    const svcLines = lines.filter((l) => l.service_type === serviceType)
    const billedPackages = new Set(svcLines.map((l) => l.shipment_id)).size
    const netBilling = sumMoney(svcLines.map((l) => l.net_amount))
    return {
      serviceType,
      shipments: svcShips.length,
      billedPackages,
      netBilling,
      revenuePerPackage: billedPackages ? money(netBilling / billedPackages) : null,
      revenueShare: pct(netBilling, totalNet),
    }
  })

  const hist = listHistoricalPeriods(data)
  const monthsInFilter = hist.filter(
    (p) => p >= filters.startPeriod && p <= filters.endPeriod,
  )
  // Prefer showing a longer trend window for context (up to 12 months ending at filter end)
  const endIdx = hist.indexOf(filters.endPeriod)
  const trendMonths =
    endIdx >= 0
      ? hist.slice(Math.max(0, endIdx - 11), endIdx + 1)
      : monthsInFilter

  const monthly: MonthlyTrendRow[] = trendMonths.map((period) => {
    const monthFilters: GlobalFilters = {
      ...filters,
      startPeriod: period,
      endPeriod: period,
    }
    const mShips = filterShipments(data, monthFilters)
    const mRec = sumMoney(
      filterRevenue(data, monthFilters)
        .filter((r) => r.billing_line_id === null)
        .map((r) => r.amount),
    )
    const mBill = sumMoney(filterBillingLines(data, monthFilters).map((l) => l.net_amount))
    return {
      period,
      shipments: mShips.length,
      recognizedRevenue: mRec,
      netBilling: mBill,
    }
  })

  const prior = priorPeriodRange(filters)
  const histStart = hist[0]
  const comparable =
    Boolean(histStart) && prior.startPeriod >= histStart! && prior.endPeriod >= histStart!
  let shipmentGrowth: number | null = null
  let recognizedGrowth: number | null = null
  let netBillingGrowth: number | null = null
  let note =
    'Growth = (Current − Prior comparable window) / Prior. Windows have equal month length via priorPeriodRange.'
  if (!comparable) {
    note =
      'Comparable prior period falls before available synthetic history — growth rates unavailable (not fabricated).'
  } else {
    const priorFilters: GlobalFilters = { ...filters, ...prior }
    const priorShared = computeSharedMetrics(data, priorFilters)
    const priorShips = filterShipments(data, priorFilters).length
    const curShips = shipments.length
    shipmentGrowth =
      priorShips === 0 ? null : ((curShips - priorShips) / priorShips) * 100
    recognizedGrowth =
      priorShared.recognizedRevenue === 0
        ? null
        : ((shared.recognizedRevenue - priorShared.recognizedRevenue) /
            priorShared.recognizedRevenue) *
          100
    netBillingGrowth =
      priorShared.netBilledRevenue === 0
        ? null
        : ((shared.netBilledRevenue - priorShared.netBilledRevenue) /
            priorShared.netBilledRevenue) *
          100
  }

  const periodStartDate = `${filters.startPeriod}-01`
  let newCustomerRevenue = 0
  let existingCustomerRevenue = 0
  for (const [customerId, revenue] of custRev) {
    const c = data.customers.find((x) => x.customer_id === customerId)
    if (!c) continue
    if (c.acquired_date >= periodStartDate) newCustomerRevenue = money(newCustomerRevenue + revenue)
    else existingCustomerRevenue = money(existingCustomerRevenue + revenue)
  }
  const newShare = pct(newCustomerRevenue, money(newCustomerRevenue + existingCustomerRevenue))

  const top5 = [...custRev.values()].sort((a, b) => b - a).slice(0, 5)
  const top5Concentration = pct(sumMoney(top5), totalCustRev)

  const regionMap = new Map<RegionCode, number>()
  for (const l of lines) {
    regionMap.set(l.region, money((regionMap.get(l.region) ?? 0) + l.net_amount))
  }
  const regionalConcentration = ([...regionMap.entries()] as [RegionCode, number][])
    .map(([region, revenue]) => ({
      region,
      revenue,
      share: pct(revenue, totalCustRev),
    }))
    .sort((a, b) => b.revenue - a.revenue)

  return {
    scale,
    metros,
    segments,
    topCustomers,
    industries,
    services,
    monthly,
    growth: {
      comparable,
      priorLabel: comparable ? `${prior.startPeriod} → ${prior.endPeriod}` : null,
      currentLabel: periodLabel,
      shipmentGrowth,
      recognizedGrowth,
      netBillingGrowth,
      note,
      newCustomerRevenue,
      existingCustomerRevenue,
      newShare,
      top5Concentration,
      regionalConcentration,
      hhiNote:
        'Top 5 Concentration = SUM(net_billing of top 5 customers) / SUM(net_billing). Net billing basis — not recognized revenue.',
    },
    sharedCheck: {
      recognizedRevenue: shared.recognizedRevenue,
      netBilledRevenue: shared.netBilledRevenue,
    },
  }
}
