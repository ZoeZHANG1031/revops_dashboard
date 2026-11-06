import { METRO_DEFINITIONS, projectUs } from '@/data/metros'
import {
  filterBillingLines,
  filterBillingLinesIncludingDuplicates,
  filterCosts,
  filterExceptions,
  filterShipments,
  listHistoricalPeriods,
  priorPeriodRange,
} from '@/lib/filters'
import { createCalcMemo, filterCacheKey } from '@/lib/memoCalc'
import { pkgs } from '@/lib/pricing'
import { money, pct, sumMoney } from '@/lib/money'
import type { DataStore, GlobalFilters, RegionCode, ServiceType } from '@/types'
import { assessDuplicateBilling } from './duplicateBilling'
import { computeRecognizedRevenue, type RecognizedRevenueResult } from './recognizedRevenue'

export type BubbleMetric = 'shipments' | 'revenue' | 'contribution'
export type BubbleColorMetric = 'contributionMargin' | 'relativeMargin' | 'growth' | 'exceptions'
export type ServiceMixMetric = 'shipments' | 'netBilling' | 'contribution'
export type TrendMetric =
  | 'shipments'
  | 'netBilling'
  | 'recognized'
  | 'rpp'
  | 'contributionMargin'

const VARIABLE_COST_TYPES = new Set([
  'DSP Delivery',
  'Sorting',
  'Linehaul',
  'Redelivery',
  'Claims',
  'Other Variable',
])

export interface ScopeCompare {
  label: string
  periodLabel: string
  isFiltered: boolean
  company: {
    activeCustomers: number
    shipments: number
    netBilling: number
    recognized: RecognizedRevenueResult
  }
  selected: {
    activeCustomers: number
    shipments: number
    netBilling: number
    recognized: RecognizedRevenueResult
    shareOfCustomers: number | null
    shareOfShipments: number | null
    shareOfNetBilling: number | null
  }
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
  activeCustomers: number
  revenuePerPackage: number | null
  contributionMargin: number | null
  shipmentGrowth: number | null
  /** Contribution $ = Net Billing − shipment-attributed variable cost */
  contribution: number
  /** Exceptions linked to a shipment in this metro (detected_date in range) */
  exceptionCount: number
  /** exceptionCount / shipments × 100; null when no shipments */
  exceptionRate: number | null
  source: string
}

export interface ConcentrationBlock {
  top1: number | null
  top3: number | null
  top5: number | null
  hhi: number | null
  activeCustomerCount: number
  note: string
}

export interface ServicePortfolioRow {
  serviceType: ServiceType
  shipments: number
  billedPackages: number
  netBilling: number
  variableCost: number
  contributionProfit: number
  contributionMargin: number | null
  revenuePerPackage: number | null
  costPerPackage: number | null
  contributionPerPackage: number | null
  shipmentShare: number | null
  revenueShare: number | null
  contributionShare: number | null
  costCoverageNote: string
}

export interface BusinessInsight {
  id: string
  finding: string
  evidence: string
  possibleDrivers: string
  recommendedNextStep: string
  /** @deprecated use finding — kept for older UI bindings */
  text: string
  actionLabel?: string
  actionPath?: string
  actionExtras?: {
    customerId?: string
    region?: string
    serviceType?: string
    exceptionType?: string
    metro?: string
  }
  financialImpact: number
  severity: number
  changeMagnitude: number
  confidence: number
  actionability: number
  rankScore: number
}

export interface DataQualityCheck {
  id: string
  label: string
  issueCount: number
  checkedCount: number
  severity: 'Healthy' | 'Warning' | 'Critical' | 'Not Evaluated'
  affectedMetrics: string[]
  detailHint: string
  financialImpact: number | null
  investigatePath?: string
  investigateExtras?: {
    exceptionType?: string
    exceptionStatus?: string
  }
}

export interface ServiceMixMeta {
  /** Shares always use parent scope (date/customer/region/metro, all services). */
  comparisonScopeNote: string
  selectedServiceFilter: ServiceType | null
  selectedServicePerformance: ServicePortfolioRow | null
  shareSumShipments: number
  shareSumRevenue: number
  shareSumContribution: number
}

export interface CompanyOverviewModel {
  periodLabel: string
  scope: ScopeCompare
  scale: {
    activeCustomers: number
    activeDefinition: string
    shipmentVolume: number
    netBilling: number
    recognized: RecognizedRevenueResult
    revenuePerPackage: number | null
    contributionMargin: number | null
    contributionProfit: number
    activeMetroMarkets: number
    serviceTypesInPeriod: number
    avgDailyShipments: number | null
    deliverySuccessRate: number | null
    activeDspPartners: number | null
    /** Stations with shipments in the period */
    activeStations: number
    /** Monthly package capacity of active stations (daily capacity × 30) */
    monthlyCapacity: number
    /** Packages per month ÷ monthly capacity of active stations */
    networkUtilization: number | null
    unavailable: { label: string; reason: string }[]
  }
  metros: MetroFootprintRow[]
  segments: {
    segment: 'Enterprise' | 'Mid-Market' | 'SMB'
    customers: number
    customerShare: number | null
    revenue: number
    revenueShare: number | null
    /** Net Billing − customer-attributed variable cost */
    contribution: number
    contributionShare: number | null
  }[]
  concentration: ConcentrationBlock
  topCustomers: {
    customerId: string
    customerName: string
    segment: string
    industry: string
    region: RegionCode
    revenue: number
    revenueShare: number | null
    contributionMargin: number | null
  }[]
  industries: {
    industry: string
    customers: number
    revenue: number
    revenueShare: number | null
  }[]
  services: ServicePortfolioRow[]
  monthly: {
    period: string
    shipments: number
    recognizedRevenue: number
    recognizedDisplay: RecognizedRevenueResult['display']
    netBilling: number
    revenuePerPackage: number | null
    /** (Net Billing − variable cost) / Net Billing by accounting_period; null if no billing */
    contributionMargin: number | null
  }[]
  growth: {
    comparable: boolean
    priorLabel: string | null
    currentLabel: string
    shipmentGrowth: number | null
    netBillingGrowth: number | null
    rppGrowth: number | null
    activeCustomerGrowth: number | null
    recognizedGrowth: number | null
    recognizedDisplay: RecognizedRevenueResult['display']
    note: string
    narrative: string
    newCustomerRevenue: number
    existingCustomerRevenue: number
    newShare: number | null
    regionalConcentration: { region: RegionCode; revenue: number; share: number | null }[]
  }
  insights: BusinessInsight[]
  topInsights: BusinessInsight[]
  dataQuality: DataQualityCheck[]
  serviceMixMeta: ServiceMixMeta
  analysisSummary: {
    whatHappened: string
    why: string
    financialImpact: string
    whatNext: string
  }
  sharedCheck: { recognizedRevenue: number; netBilledRevenue: number }
}

const companyOverviewMemo = createCalcMemo<CompanyOverviewModel>(32)

function activeCustomerIds(data: DataStore, filters: GlobalFilters): Set<string> {
  const ids = new Set<string>()
  filterShipments(data, filters).forEach((s) => ids.add(s.customer_id))
  filterBillingLines(data, filters).forEach((l) => ids.add(l.customer_id))
  return ids
}

function variableCostTotal(data: DataStore, filters: GlobalFilters): number {
  return sumMoney(
    filterCosts(data, filters)
      .filter((c) => VARIABLE_COST_TYPES.has(c.cost_type))
      .map((c) => c.amount),
  )
}

function emptyFilters(base: GlobalFilters): GlobalFilters {
  return { ...base, customerIds: [], regions: [], metros: [], serviceTypes: [] }
}

export function computeCompanyOverview(data: DataStore, filters: GlobalFilters): CompanyOverviewModel {
  const key = filterCacheKey(filters)
  const cached = companyOverviewMemo.get(data, key)
  if (cached) return cached
  return companyOverviewMemo.set(data, key, computeCompanyOverviewFresh(data, filters))
}

function computeCompanyOverviewFresh(data: DataStore, filters: GlobalFilters): CompanyOverviewModel {
  const periodLabel = `${filters.startPeriod} → ${filters.endPeriod}`
  const companyFilters = emptyFilters(filters)
  const isCompanyScope =
    filters.customerIds.length === 0 &&
    filters.regions.length === 0 &&
    (filters.metros?.length ?? 0) === 0 &&
    filters.serviceTypes.length === 0

  const selectedRec = computeRecognizedRevenue(data, filters)
  const companyRec = isCompanyScope
    ? selectedRec
    : computeRecognizedRevenue(data, companyFilters)

  const shipments = filterShipments(data, filters)
  const lines = filterBillingLines(data, filters)
  const companyShips = isCompanyScope ? shipments : filterShipments(data, companyFilters)
  const companyLines = isCompanyScope ? lines : filterBillingLines(data, companyFilters)
  const activeIds = new Set<string>()
  shipments.forEach((s) => activeIds.add(s.customer_id))
  lines.forEach((l) => activeIds.add(l.customer_id))
  const companyActive = isCompanyScope ? activeIds : new Set<string>()
  if (!isCompanyScope) {
    companyShips.forEach((s) => companyActive.add(s.customer_id))
    companyLines.forEach((l) => companyActive.add(l.customer_id))
  }

  const netBilledRevenue = sumMoney(lines.map((l) => l.net_amount))
  const companyNetBilling = isCompanyScope
    ? netBilledRevenue
    : sumMoney(companyLines.map((l) => l.net_amount))
  // Packages, not rows: each lot / billing line carries package_count
  const billedPackages = pkgs(lines)
  const shipmentPkgs = pkgs(shipments)
  const selectedCostsEarly = filterCosts(data, filters)
  const varCost = sumMoney(
    selectedCostsEarly.filter((c) => VARIABLE_COST_TYPES.has(c.cost_type)).map((c) => c.amount),
  )
  const contributionProfit = money(netBilledRevenue - varCost)
  const contributionMargin = pct(contributionProfit, netBilledRevenue)
  const revenuePerPackage = billedPackages ? money(netBilledRevenue / billedPackages) : null

  const daySpan =
    (() => {
      const [ys, ms] = filters.startPeriod.split('-').map(Number)
      const [ye, me] = filters.endPeriod.split('-').map(Number)
      const start = new Date(ys, ms - 1, 1)
      const end = new Date(ye, me, 0)
      return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
    })()

  const delivered = pkgs(shipments.filter((s) => s.delivery_status === 'Delivered'))
  const deliverySuccessRate = shipmentPkgs ? pct(delivered, shipmentPkgs) : null
  const dspIds = new Set(shipments.map((s) => s.dsp_id).filter(Boolean))
  const activeStationIds = new Set(shipments.map((s) => s.station_id))
  const monthlyCapacity = (data.stations ?? [])
    .filter((st) => activeStationIds.has(st.station_id))
    .reduce((a, st) => a + st.capacity_daily * 30, 0)
  const monthsInRange = Math.max(
    1,
    (Number(filters.endPeriod.slice(0, 4)) - Number(filters.startPeriod.slice(0, 4))) * 12 +
      Number(filters.endPeriod.slice(5, 7)) -
      Number(filters.startPeriod.slice(5, 7)) +
      1,
  )

  const scope: ScopeCompare = {
    label: filters.regions[0] || filters.serviceTypes[0] || filters.customerIds[0] || 'All',
    periodLabel,
    isFiltered:
      filters.regions.length > 0 ||
      filters.metros.length > 0 ||
      filters.serviceTypes.length > 0 ||
      filters.customerIds.length > 0,
    company: {
      activeCustomers: companyActive.size,
      shipments: pkgs(companyShips),
      netBilling: companyNetBilling,
      recognized: companyRec,
    },
    selected: {
      activeCustomers: activeIds.size,
      shipments: shipmentPkgs,
      netBilling: netBilledRevenue,
      recognized: selectedRec,
      shareOfCustomers: pct(activeIds.size, companyActive.size),
      shareOfShipments: pct(shipmentPkgs, pkgs(companyShips)),
      shareOfNetBilling: pct(netBilledRevenue, companyNetBilling),
    },
  }

  // Metro aggregation (single pass; prior growth also single pass)
  const metroAgg = new Map<
    string,
    {
      shipments: number
      revenue: number
      region: RegionCode
      customers: Set<string>
      varCost: number
      billedPkgs: number
    }
  >()
  const ensureMetro = (metro: string, region: RegionCode) => {
    let cur = metroAgg.get(metro)
    if (!cur) {
      cur = {
        shipments: 0,
        revenue: 0,
        region,
        customers: new Set<string>(),
        varCost: 0,
        billedPkgs: 0,
      }
      metroAgg.set(metro, cur)
    }
    return cur
  }
  for (const s of shipments) {
    const cur = ensureMetro(s.metro, s.region)
    cur.shipments += s.package_count
    cur.customers.add(s.customer_id)
  }
  const shipMetro = new Map(shipments.map((s) => [s.shipment_id, s.metro]))
  const shipRegion = new Map(shipments.map((s) => [s.shipment_id, s.region]))
  for (const l of lines) {
    const metro = shipMetro.get(l.shipment_id)
    if (!metro) continue
    const cur = ensureMetro(metro, shipRegion.get(l.shipment_id) ?? l.region)
    cur.revenue += l.net_amount
    cur.billedPkgs += l.package_count
  }
  const selectedCosts = selectedCostsEarly
  for (const c of selectedCosts) {
    if (!VARIABLE_COST_TYPES.has(c.cost_type) || !c.shipment_id) continue
    const metro = shipMetro.get(c.shipment_id)
    if (!metro) continue
    const cur = metroAgg.get(metro)
    if (!cur) continue
    cur.varCost += c.amount
  }

  // Exceptions per metro and packages in exception-affected lots (rate = affected pkgs ÷ pkgs)
  const metroExceptions = new Map<string, number>()
  const metroExceptionPkgs = new Map<string, number>()
  const lotPkgs = new Map(shipments.map((s) => [s.shipment_id, s.package_count]))
  const seenLot = new Set<string>()
  for (const e of filterExceptions(data, filters)) {
    if (!e.shipment_id) continue
    const metro = shipMetro.get(e.shipment_id)
    if (!metro) continue
    metroExceptions.set(metro, (metroExceptions.get(metro) ?? 0) + 1)
    if (!seenLot.has(e.shipment_id)) {
      seenLot.add(e.shipment_id)
      metroExceptionPkgs.set(metro, (metroExceptionPkgs.get(metro) ?? 0) + (lotPkgs.get(e.shipment_id) ?? 0))
    }
  }

  const prior = priorPeriodRange(filters)
  const hist = listHistoricalPeriods(data)
  const priorComparable = Boolean(hist[0] && prior.startPeriod >= hist[0])
  const priorMetroCounts = new Map<string, number>()
  if (priorComparable) {
    const priorFilters: GlobalFilters = { ...filters, ...prior }
    for (const s of filterShipments(data, priorFilters)) {
      priorMetroCounts.set(s.metro, (priorMetroCounts.get(s.metro) ?? 0) + s.package_count)
    }
  }

  const metros: MetroFootprintRow[] = METRO_DEFINITIONS.map((d) => {
    const agg =
      metroAgg.get(d.metro) ?? {
        shipments: 0,
        revenue: 0,
        region: d.region,
        customers: new Set<string>(),
        varCost: 0,
        billedPkgs: 0,
      }
    const { x, y } = projectUs(d.lon, d.lat)
    const billedPkgs = agg.billedPkgs
    const revenue = money(agg.revenue)
    const varCost = money(agg.varCost)
    const metroRpp = billedPkgs ? money(revenue / billedPkgs) : null
    const cm = pct(money(revenue - varCost), revenue)

    let shipmentGrowth: number | null = null
    if (priorComparable) {
      const priorShips = priorMetroCounts.get(d.metro) ?? 0
      shipmentGrowth =
        priorShips === 0 ? null : ((agg.shipments - priorShips) / priorShips) * 100
    }

    return {
      metro: d.metro,
      region: d.region,
      lat: d.lat,
      lon: d.lon,
      x,
      y,
      shipments: agg.shipments,
      revenue,
      activeCustomers: agg.customers.size,
      revenuePerPackage: metroRpp,
      contributionMargin: cm,
      shipmentGrowth,
      contribution: money(revenue - varCost),
      exceptionCount: metroExceptions.get(d.metro) ?? 0,
      exceptionRate: agg.shipments
        ? ((metroExceptionPkgs.get(d.metro) ?? 0) / agg.shipments) * 100
        : null,
      source: d.source,
    }
  }).filter((m) => m.shipments > 0 || m.revenue > 0)

  const custRev = new Map<string, number>()
  const custVar = new Map<string, number>()
  for (const l of lines) {
    custRev.set(l.customer_id, money((custRev.get(l.customer_id) ?? 0) + l.net_amount))
  }
  for (const c of selectedCosts) {
    if (!VARIABLE_COST_TYPES.has(c.cost_type) || !c.customer_id) continue
    custVar.set(c.customer_id, (custVar.get(c.customer_id) ?? 0) + c.amount)
  }
  const totalCustRev = sumMoney([...custRev.values()])

  const segmentBase = (['Enterprise', 'Mid-Market', 'SMB'] as const).map((segment) => {
    const ids = new Set(data.customers.filter((c) => c.segment === segment).map((c) => c.customer_id))
    const revenue = sumMoney([...custRev.entries()].filter(([id]) => ids.has(id)).map(([, v]) => v))
    const vc = sumMoney([...custVar.entries()].filter(([id]) => ids.has(id)).map(([, v]) => v))
    return {
      segment,
      customers: [...activeIds].filter((id) => ids.has(id)).length,
      revenue,
      contribution: money(revenue - vc),
    }
  })
  const totalSegCustomers = segmentBase.reduce((a, s) => a + s.customers, 0)
  const totalSegContribution = sumMoney(segmentBase.map((s) => Math.max(0, s.contribution)))
  const segments = segmentBase.map((s) => ({
    ...s,
    customerShare: pct(s.customers, totalSegCustomers),
    revenueShare: pct(s.revenue, totalCustRev),
    // Share of positive contribution pool; negative-contribution segments show 0 share
    contributionShare: pct(Math.max(0, s.contribution), totalSegContribution),
  }))

  const ranked = [...custRev.entries()].sort((a, b) => b[1] - a[1])
  const shareOf = (n: number) => {
    if (totalCustRev === 0) return null
    return pct(sumMoney(ranked.slice(0, n).map(([, v]) => v)), totalCustRev)
  }
  const shares = ranked.map(([, v]) => (totalCustRev === 0 ? 0 : v / totalCustRev))
  const hhi = shares.length ? shares.reduce((a, s) => a + s * s, 0) : null

  const concentration: ConcentrationBlock = {
    top1: shareOf(1),
    top3: shareOf(3),
    top5: shareOf(5),
    hhi,
    activeCustomerCount: activeIds.size,
    note:
      activeIds.size <= 5 && shareOf(5) != null && shareOf(5)! >= 99.9
        ? `Top 5 = 100% is expected with only ${activeIds.size} active customers in scope — not by itself a concentration anomaly.`
        : 'Shares use Net Billing. HHI = Σ(share²) on 0–1 decimal shares.',
  }

  const topCustomers = ranked.slice(0, 10).map(([customerId, revenue]) => {
    const c = data.customers.find((x) => x.customer_id === customerId)!
    const vc = custVar.get(customerId) ?? 0
    return {
      customerId,
      customerName: c.customer_name,
      segment: c.segment,
      industry: c.industry,
      region: c.region,
      revenue,
      revenueShare: pct(revenue, totalCustRev),
      contributionMargin: pct(money(revenue - vc), revenue),
    }
  })

  const indMap = new Map<string, { customers: Set<string>; revenue: number }>()
  for (const [customerId, revenue] of custRev) {
    const c = data.customers.find((x) => x.customer_id === customerId)
    if (!c) continue
    const cur = indMap.get(c.industry) ?? { customers: new Set(), revenue: 0 }
    cur.customers.add(customerId)
    cur.revenue = money(cur.revenue + revenue)
    indMap.set(c.industry, cur)
  }
  const industries = [...indMap.entries()]
    .map(([industry, v]) => ({
      industry,
      customers: v.customers.size,
      revenue: v.revenue,
      revenueShare: pct(v.revenue, totalCustRev),
    }))
    .sort((a, b) => b.revenue - a.revenue)

  // Service mix: parent = all services in same date/customer/region/metro (never service-narrow denominator)
  const mixParentFilters: GlobalFilters = { ...filters, serviceTypes: [] }
  const mixParentShips =
    filters.serviceTypes.length === 0 ? shipments : filterShipments(data, mixParentFilters)
  const mixParentLines =
    filters.serviceTypes.length === 0 ? lines : filterBillingLines(data, mixParentFilters)
  const mixParentCosts =
    filters.serviceTypes.length === 0 ? selectedCosts : filterCosts(data, mixParentFilters)

  type SvcAcc = {
    shipments: number
    billed: Set<string>
    billedPkgs: number
    net: number
    varCost: number
    costShips: Set<string>
  }
  const svcAcc = new Map<ServiceType, SvcAcc>()
  const emptySvc = (): SvcAcc => ({
    shipments: 0,
    billed: new Set(),
    billedPkgs: 0,
    net: 0,
    varCost: 0,
    costShips: new Set(),
  })
  for (const st of ['Standard', 'Economy', 'Express', 'SameDay'] as ServiceType[]) {
    svcAcc.set(st, emptySvc())
  }
  for (const s of mixParentShips) {
    const acc = svcAcc.get(s.service_type)
    if (acc) acc.shipments += s.package_count
  }
  for (const l of mixParentLines) {
    const acc = svcAcc.get(l.service_type)
    if (!acc) continue
    acc.net += l.net_amount
    acc.billed.add(l.shipment_id)
    acc.billedPkgs += l.package_count
  }
  const mixShipService = new Map(mixParentShips.map((s) => [s.shipment_id, s.service_type]))
  for (const c of mixParentCosts) {
    if (!VARIABLE_COST_TYPES.has(c.cost_type)) continue
    const st =
      c.service_type ?? (c.shipment_id ? mixShipService.get(c.shipment_id) : undefined)
    if (!st) continue
    const acc = svcAcc.get(st)
    if (!acc) continue
    acc.varCost += c.amount
    if (c.shipment_id) acc.costShips.add(c.shipment_id)
  }
  const mixParentNet = money(
    [...svcAcc.values()].reduce((a, v) => a + v.net, 0),
  )
  const mixParentContrib = money(
    mixParentNet - [...svcAcc.values()].reduce((a, v) => a + v.varCost, 0),
  )

  const services: ServicePortfolioRow[] = (
    ['Standard', 'Economy', 'Express', 'SameDay'] as ServiceType[]
  ).map((serviceType) => {
    const acc = svcAcc.get(serviceType)!
    const billed = acc.billedPkgs
    const netBilling = money(acc.net)
    const variableCost = money(acc.varCost)
    const contrib = money(netBilling - variableCost)
    const coverage =
      billed === 0
        ? 'No billed packages'
        : acc.costShips.size < acc.billed.size
          ? `Cost rows cover ${acc.costShips.size}/${acc.billed.size} billed lots — CPP uses attributable cost ÷ billed packages (coverage incomplete).`
          : 'Cost coverage aligned to billed packages in filter.'
    return {
      serviceType,
      shipments: acc.shipments,
      billedPackages: billed,
      netBilling,
      variableCost,
      contributionProfit: contrib,
      contributionMargin: pct(contrib, netBilling),
      revenuePerPackage: billed ? money(netBilling / billed) : null,
      costPerPackage: billed ? money(variableCost / billed) : null,
      contributionPerPackage: billed ? money(contrib / billed) : null,
      shipmentShare: pct(acc.shipments, pkgs(mixParentShips)),
      revenueShare: pct(netBilling, mixParentNet),
      contributionShare: pct(contrib, mixParentContrib),
      costCoverageNote: coverage,
    }
  })

  const selectedServiceFilter = filters.serviceTypes[0] ?? null
  const selectedServicePerformance =
    selectedServiceFilter != null
      ? services.find((s) => s.serviceType === selectedServiceFilter) ?? null
      : null
  const shareSumShipments = sumMoney(services.map((s) => s.shipmentShare ?? 0))
  const shareSumRevenue = sumMoney(services.map((s) => s.revenueShare ?? 0))
  const shareSumContribution = sumMoney(services.map((s) => s.contributionShare ?? 0))
  const serviceMixMeta: ServiceMixMeta = {
    comparisonScopeNote: selectedServiceFilter
      ? `Service Mix shares use parent scope (all services · same date/customer/region/metro). Selected service filter = ${selectedServiceFilter} — see Selected Service Performance.`
      : 'Service Mix shares = each service ÷ all services in current date/customer/region/metro scope.',
    selectedServiceFilter,
    selectedServicePerformance,
    shareSumShipments,
    shareSumRevenue,
    shareSumContribution,
  }

  const endIdx = hist.indexOf(filters.endPeriod)
  const trendMonths =
    endIdx >= 0 ? hist.slice(Math.max(0, endIdx - 11), endIdx + 1) : hist.slice(-12)
  const trendStart = trendMonths[0] ?? filters.startPeriod
  const trendEnd = trendMonths[trendMonths.length - 1] ?? filters.endPeriod
  const trendFilters: GlobalFilters = { ...filters, startPeriod: trendStart, endPeriod: trendEnd }
  const trendShips = filterShipments(data, trendFilters)
  const trendLines = filterBillingLines(data, trendFilters)
  const trendRec = computeRecognizedRevenue(data, trendFilters)
  const varByMonth = new Map<string, number>()
  for (const c of filterCosts(data, trendFilters)) {
    if (!VARIABLE_COST_TYPES.has(c.cost_type)) continue
    varByMonth.set(c.accounting_period, (varByMonth.get(c.accounting_period) ?? 0) + c.amount)
  }

  const shipsByMonth = new Map<string, number>()
  for (const s of trendShips) {
    const p = s.ship_date.slice(0, 7)
    shipsByMonth.set(p, (shipsByMonth.get(p) ?? 0) + s.package_count)
  }
  const billByMonth = new Map<string, { net: number; billed: number }>()
  for (const l of trendLines) {
    const cur = billByMonth.get(l.accounting_period) ?? { net: 0, billed: 0 }
    cur.net += l.net_amount
    cur.billed += l.package_count
    billByMonth.set(l.accounting_period, cur)
  }
  const recByMonth = new Map<string, number>()
  for (const r of trendRec.rows) {
    recByMonth.set(r.accounting_period, (recByMonth.get(r.accounting_period) ?? 0) + r.amount)
  }

  const monthly = trendMonths.map((period) => {
    const mBillAcc = billByMonth.get(period)
    const mBill = money(mBillAcc?.net ?? 0)
    const mBilled = mBillAcc?.billed ?? 0
    const mRecAmt = money(recByMonth.get(period) ?? 0)
    const mRecDisplay: RecognizedRevenueResult['display'] =
      trendRec.display === 'no_records' && (recByMonth.get(period) == null)
        ? 'no_records'
        : mRecAmt === 0
          ? trendRec.rows.some((r) => r.accounting_period === period)
            ? 'zero'
            : 'no_records'
          : 'value'
    return {
      period,
      shipments: shipsByMonth.get(period) ?? 0,
      recognizedRevenue: mRecAmt,
      recognizedDisplay: mRecDisplay,
      netBilling: mBill,
      revenuePerPackage: mBilled ? money(mBill / mBilled) : null,
      contributionMargin: mBill
        ? pct(money(mBill - (varByMonth.get(period) ?? 0)), mBill)
        : null,
    }
  })

  let shipmentGrowth: number | null = null
  let netBillingGrowth: number | null = null
  let rppGrowth: number | null = null
  let activeCustomerGrowth: number | null = null
  let recognizedGrowth: number | null = null
  let note =
    'Growth = (Current − Prior comparable window) / Prior. Equal-length windows via priorPeriodRange.'
  if (!priorComparable) {
    note =
      'Comparable prior period falls before available synthetic history — growth rates unavailable (not fabricated).'
  } else {
    const priorFilters: GlobalFilters = { ...filters, ...prior }
    const priorShipsList = filterShipments(data, priorFilters)
    const priorLines = filterBillingLines(data, priorFilters)
    const priorRec = computeRecognizedRevenue(data, priorFilters)
    const priorNet = sumMoney(priorLines.map((l) => l.net_amount))
    const priorActive = new Set<string>()
    priorShipsList.forEach((s) => priorActive.add(s.customer_id))
    priorLines.forEach((l) => priorActive.add(l.customer_id))
    const priorBilled = pkgs(priorLines)
    const priorRpp = priorBilled ? priorNet / priorBilled : null
    shipmentGrowth =
      pkgs(priorShipsList) === 0
        ? null
        : ((shipmentPkgs - pkgs(priorShipsList)) / pkgs(priorShipsList)) * 100
    netBillingGrowth =
      priorNet === 0 ? null : ((netBilledRevenue - priorNet) / priorNet) * 100
    rppGrowth =
      priorRpp == null || priorRpp === 0 || revenuePerPackage == null
        ? null
        : ((revenuePerPackage - priorRpp) / priorRpp) * 100
    activeCustomerGrowth =
      priorActive.size === 0 ? null : ((activeIds.size - priorActive.size) / priorActive.size) * 100
    recognizedGrowth =
      priorRec.display === 'no_records' || selectedRec.display === 'no_records'
        ? null
        : priorRec.amount === 0
          ? null
          : ((selectedRec.amount - priorRec.amount) / priorRec.amount) * 100
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

  const regionMap = new Map<RegionCode, number>()
  for (const l of lines) {
    regionMap.set(l.region, money((regionMap.get(l.region) ?? 0) + l.net_amount))
  }
  const regionalConcentration = [...regionMap.entries()]
    .map(([region, revenue]) => ({
      region,
      revenue,
      share: pct(revenue, totalCustRev),
    }))
    .sort((a, b) => b.revenue - a.revenue)

  let narrative = 'Insufficient comparable history for automatic growth narrative.'
  if (
    shipmentGrowth != null &&
    netBillingGrowth != null &&
    rppGrowth != null
  ) {
    if (shipmentGrowth > netBillingGrowth + 1 && rppGrowth < 0) {
      narrative =
        'Shipment growth exceeds Net Billing growth and Revenue per Package declined — review customer mix, service mix, and pricing.'
    } else if (netBillingGrowth > shipmentGrowth + 1 && rppGrowth > 0) {
      narrative =
        'Net Billing is outpacing shipment growth with rising Revenue per Package — favorable rate or mix shift.'
    } else if (shipmentGrowth > 0 && netBillingGrowth > 0) {
      narrative = 'Both shipment volume and Net Billing are growing on the comparable prior window.'
    } else if (shipmentGrowth < 0 && netBillingGrowth < 0) {
      narrative = 'Both shipment volume and Net Billing declined vs the comparable prior window.'
    } else {
      narrative =
        'Shipment and Net Billing growth diverge modestly — inspect service and customer mix for drivers.'
    }
  }

  const topMetro = [...metros].sort((a, b) => b.revenue - a.revenue)[0]
  const bestService = [...services]
    .filter((s) => s.contributionMargin != null)
    .sort((a, b) => (b.contributionMargin ?? -999) - (a.contributionMargin ?? -999))[0]
  const lowCmHighVol = [...metros]
    .filter((m) => m.shipments > 0 && (m.contributionMargin ?? 100) < 25)
    .sort((a, b) => b.shipments - a.shipments)[0]

  const insights: BusinessInsight[] = []

  const rank = (partial: Omit<BusinessInsight, 'rankScore' | 'text'> & { text?: string }): BusinessInsight => {
    const rankScore =
      partial.financialImpact * 0.35 +
      partial.severity * 20 +
      partial.changeMagnitude * 0.15 +
      partial.confidence * 15 +
      partial.actionability * 18
    return {
      ...partial,
      text: partial.text ?? partial.finding,
      rankScore,
    }
  }

  if (
    shipmentGrowth != null &&
    netBillingGrowth != null &&
    rppGrowth != null &&
    shipmentGrowth > netBillingGrowth + 1 &&
    rppGrowth < 0
  ) {
    const gapPts = shipmentGrowth - netBillingGrowth
    insights.push(
      rank({
        id: 'rev-trails-shipments',
        finding: 'Shipment growth exceeds Net Billing growth',
        evidence: `Shipments ${shipmentGrowth.toFixed(1)}%; Net Billing ${netBillingGrowth.toFixed(1)}%; RPP ${rppGrowth.toFixed(1)}%.`,
        possibleDrivers: 'Price changes, customer mix, service mix, or credits — not confirmed root causes.',
        recommendedNextStep: 'Investigate Price–Volume–Mix on Revenue Lifecycle',
        actionLabel: 'Investigate Pricing & Service Mix',
        actionPath: '/lifecycle',
        financialImpact: Math.abs(netBilledRevenue * (rppGrowth / 100)),
        severity: 4,
        changeMagnitude: Math.abs(gapPts),
        confidence: priorComparable ? 0.85 : 0.4,
        actionability: 0.9,
      }),
    )
  }

  if (topMetro) {
    insights.push(
      rank({
        id: 'top-metro',
        finding: `${topMetro.metro} leads selected Net Billing`,
        evidence: `${topMetro.metro} (${topMetro.region}): ${topMetro.shipments} shipments · Net Billing $${topMetro.revenue.toFixed(0)} · CM ${topMetro.contributionMargin?.toFixed(1) ?? 'n/a'}%.`,
        possibleDrivers: 'Metro volume share, local rate cards, or DSP cost structure.',
        recommendedNextStep: 'Analyze Unit Economics for this metro/region',
        actionLabel: 'Analyze Profitability',
        actionPath: '/unit-economics',
        actionExtras: { region: topMetro.region, metro: topMetro.metro },
        financialImpact: topMetro.revenue,
        severity: 2,
        changeMagnitude: topMetro.shipmentGrowth != null ? Math.abs(topMetro.shipmentGrowth) : 5,
        confidence: 0.9,
        actionability: 0.8,
      }),
    )
  }

  if (concentration.top5 != null && concentration.activeCustomerCount > 0) {
    insights.push(
      rank({
        id: 'concentration',
        finding: `Top 5 customers = ${concentration.top5.toFixed(1)}% of Net Billing`,
        evidence: `${concentration.activeCustomerCount} active accounts in scope. ${concentration.note}`,
        possibleDrivers: 'Enterprise contract concentration or limited active customer base in filter.',
        recommendedNextStep: 'Open Customer Intelligence for health and revenue-at-risk',
        actionLabel: 'Investigate Customers',
        actionPath: '/customers',
        financialImpact: netBilledRevenue * ((concentration.top5 ?? 0) / 100),
        severity: (concentration.top5 ?? 0) > 70 ? 4 : 2,
        changeMagnitude: concentration.top5 ?? 0,
        confidence: 0.95,
        actionability: 0.85,
      }),
    )
  }

  if (bestService && bestService.contributionMargin != null) {
    insights.push(
      rank({
        id: 'best-service',
        finding: `${bestService.serviceType} has the highest contribution margin among services`,
        evidence: `CM ${bestService.contributionMargin.toFixed(1)}% · Net Billing $${bestService.netBilling.toFixed(0)} · RPP ${bestService.revenuePerPackage?.toFixed(2) ?? 'n/a'}.`,
        possibleDrivers: 'Rate card structure, surcharge mix, or lower variable cost per package.',
        recommendedNextStep: 'Review Service Unit Economics',
        actionLabel: 'Review Service Economics',
        actionPath: '/unit-economics',
        actionExtras: { serviceType: bestService.serviceType },
        financialImpact: bestService.contributionProfit,
        severity: 1,
        changeMagnitude: bestService.contributionMargin,
        confidence: 0.8,
        actionability: 0.7,
      }),
    )
  }

  if (lowCmHighVol) {
    insights.push(
      rank({
        id: 'low-cm-metro',
        finding: `${lowCmHighVol.metro} combines high volume with low contribution margin`,
        evidence: `${lowCmHighVol.shipments} packages · CM ${lowCmHighVol.contributionMargin?.toFixed(1)}%.`,
        possibleDrivers: 'Elevated DSP/redelivery cost, soft RPP, or adverse service mix — suspected.',
        recommendedNextStep: 'Inspect cost drivers then simulate improvement in Forecasting',
        actionLabel: 'Inspect Cost Drivers',
        actionPath: '/unit-economics',
        actionExtras: { region: lowCmHighVol.region, metro: lowCmHighVol.metro },
        financialImpact: Math.abs(
          (lowCmHighVol.revenue * (25 - (lowCmHighVol.contributionMargin ?? 0))) / 100,
        ),
        severity: 5,
        changeMagnitude: Math.abs(25 - (lowCmHighVol.contributionMargin ?? 0)),
        confidence: 0.7,
        actionability: 0.95,
      }),
    )
  }

  const dataQuality = buildDataQuality(data, filters, selectedRec, {
    ships: shipments,
    lines,
    costs: selectedCosts,
  })
  const dupCheck = dataQuality.find((q) => q.id === 'duplicate-billing')
  if (dupCheck && dupCheck.issueCount > 0) {
    insights.push(
      rank({
        id: 'dup-billing',
        finding: `${dupCheck.issueCount} exact duplicate billing lines flagged`,
        evidence: `Confirmed exposure $${(dupCheck.financialImpact ?? 0).toFixed(0)} (flagged clones only).`,
        possibleDrivers: 'Billing engine re-rating; same shipment + charge fingerprint cloned.',
        recommendedNextStep: 'Open Reconciliation Duplicate Billing detail',
        actionLabel: 'Review Exceptions',
        actionPath: '/reconciliation',
        actionExtras: { exceptionType: 'Duplicate Billing' },
        financialImpact: dupCheck.financialImpact ?? 0,
        severity: 4,
        changeMagnitude: dupCheck.issueCount,
        confidence: 0.95,
        actionability: 1,
      }),
    )
  }

  insights.push(
    rank({
      id: 'growth-narrative',
      finding: narrative,
      evidence: priorComparable
        ? `Comparable window ${prior.startPeriod} → ${prior.endPeriod} vs ${periodLabel}.`
        : 'Comparable prior window unavailable in synthetic history.',
      possibleDrivers: 'Volume, rate, mix, and credit dynamics — confirmation requires drill-down.',
      recommendedNextStep: priorComparable
        ? 'Compare growth drivers on Executive Overview'
        : 'Widen date range once more history is available',
      actionLabel: priorComparable ? 'Monitor on Executive' : undefined,
      actionPath: priorComparable ? '/executive' : undefined,
      financialImpact: Math.abs(netBilledRevenue * ((netBillingGrowth ?? 0) / 100)),
      severity: 2,
      changeMagnitude: Math.abs(netBillingGrowth ?? 0),
      confidence: priorComparable ? 0.75 : 0.3,
      actionability: 0.5,
    }),
  )

  insights.sort((a, b) => b.rankScore - a.rankScore)
  const topInsights = insights.slice(0, 3)

  const analysisSummary = {
    whatHappened: topInsights[0]?.finding ?? narrative,
    why: topInsights[0]?.possibleDrivers ?? 'Insufficient evidence for a confirmed driver.',
    financialImpact: topInsights[0]
      ? `Primary insight financial weight ≈ $${topInsights[0].financialImpact.toFixed(0)} (impact score, not guaranteed recovery).`
      : 'N/A',
    whatNext: topInsights[0]?.recommendedNextStep ?? 'Explore Business Questions for guided paths.',
  }

  return {
    periodLabel,
    scope,
    scale: {
      activeCustomers: activeIds.size,
      activeDefinition:
        'Distinct customers with ≥1 shipment (ship_date) OR ≥1 non-duplicate billing line (accounting_period) in Selected Scope',
      shipmentVolume: shipmentPkgs,
      netBilling: netBilledRevenue,
      recognized: selectedRec,
      revenuePerPackage,
      contributionMargin,
      contributionProfit,
      activeMetroMarkets: new Set(shipments.map((s) => s.metro)).size,
      serviceTypesInPeriod: new Set(shipments.map((s) => s.service_type)).size,
      avgDailyShipments: money(shipmentPkgs / daySpan),
      deliverySuccessRate,
      activeDspPartners: dspIds.size > 0 ? dspIds.size : null,
      activeStations: activeStationIds.size,
      monthlyCapacity,
      networkUtilization: monthlyCapacity ? pct(shipmentPkgs / monthsInRange, monthlyCapacity) : null,
      unavailable: [],
    },
    metros,
    segments,
    concentration,
    topCustomers,
    industries,
    services,
    serviceMixMeta,
    monthly,
    growth: {
      comparable: priorComparable,
      priorLabel: priorComparable ? `${prior.startPeriod} → ${prior.endPeriod}` : null,
      currentLabel: periodLabel,
      shipmentGrowth,
      netBillingGrowth,
      rppGrowth,
      activeCustomerGrowth,
      recognizedGrowth,
      recognizedDisplay: selectedRec.display,
      note,
      narrative,
      newCustomerRevenue,
      existingCustomerRevenue,
      newShare: pct(newCustomerRevenue, money(newCustomerRevenue + existingCustomerRevenue)),
      regionalConcentration,
    },
    insights,
    topInsights,
    analysisSummary,
    dataQuality,
    sharedCheck: {
      recognizedRevenue: selectedRec.amount,
      netBilledRevenue: netBilledRevenue,
    },
  }
}

function buildDataQuality(
  data: DataStore,
  filters: GlobalFilters,
  recognized: RecognizedRevenueResult,
  prefetched?: {
    ships: ReturnType<typeof filterShipments>
    lines: ReturnType<typeof filterBillingLines>
    costs: ReturnType<typeof filterCosts>
  },
): DataQualityCheck[] {
  const ships = prefetched?.ships ?? filterShipments(data, filters)
  const lines = prefetched?.lines ?? filterBillingLines(data, filters)
  const allLines = filterBillingLinesIncludingDuplicates(data, filters)
  const dup = assessDuplicateBilling(data, filters)
  const missingCustShip = ships.filter((s) => !s.customer_id).length
  const missingShipId = lines.filter((l) => !l.shipment_id).length
  const shipIds = new Set(data.shipments.map((s) => s.shipment_id))
  const unmatchedBilling = lines.filter((l) => !shipIds.has(l.shipment_id)).length
  const metroCatalog = new Set(METRO_DEFINITIONS.map((d) => d.metro))
  const missingMetroCoord = [...new Set(ships.map((s) => s.metro))].filter(
    (m) => !metroCatalog.has(m),
  ).length
  const rateIds = new Set(data.rateCards.map((r) => r.rate_card_id))
  const unmatchedRates = lines.filter((l) => !rateIds.has(l.rate_card_id)).length
  const costs = (prefetched?.costs ?? filterCosts(data, filters)).filter((c) =>
    VARIABLE_COST_TYPES.has(c.cost_type),
  )
  const billed = new Set(lines.map((l) => l.shipment_id))
  const costShips = new Set(costs.map((c) => c.shipment_id).filter(Boolean))
  let missingCost = 0
  billed.forEach((id) => {
    if (!costShips.has(id)) missingCost++
  })
  const invalidPeriods = data.revenueRecognition.filter((r) => !/^\d{4}-\d{2}$/.test(r.accounting_period))
    .length

  const checks: DataQualityCheck[] = [
    {
      id: 'missing-customer',
      label: 'Missing Customer IDs on Shipments',
      issueCount: missingCustShip,
      checkedCount: ships.length,
      severity: missingCustShip === 0 ? 'Healthy' : missingCustShip / Math.max(1, ships.length) > 0.01 ? 'Critical' : 'Warning',
      affectedMetrics: ['Active Customers', 'Customer Portfolio'],
      detailHint: 'fact_shipment.customer_id',
      financialImpact: null,
    },
    {
      id: 'missing-shipment-on-billing',
      label: 'Missing Shipment IDs on Billing Lines',
      issueCount: missingShipId,
      checkedCount: lines.length,
      severity: missingShipId === 0 ? 'Healthy' : 'Critical',
      affectedMetrics: ['Net Billing attribution', 'Metro map'],
      detailHint: 'fact_billing_line.shipment_id',
      financialImpact: null,
    },
    {
      id: 'unmatched-billing',
      label: 'Unmatched Billing Lines (no shipment)',
      issueCount: unmatchedBilling,
      checkedCount: lines.length,
      severity: unmatchedBilling === 0 ? 'Healthy' : 'Critical',
      affectedMetrics: ['Net Billing', 'Traceability'],
      detailHint: 'Open Reconciliation',
      financialImpact: null,
      investigatePath: '/reconciliation',
    },
    {
      id: 'duplicate-billing',
      label: 'Exact Duplicate Billing Lines',
      issueCount: dup.exactCount,
      checkedCount: allLines.length,
      severity: dup.exactCount === 0 ? 'Healthy' : dup.exactCount > 10 ? 'Critical' : 'Warning',
      affectedMetrics: ['Gross vs Net Billing', 'Confirmed Overbilling'],
      detailHint: `Exact duplicates = identical charge fingerprint + is_duplicate flag. Confirmed exposure $${dup.confirmedExposure.toFixed(0)}. Legitimate multi-charge rows are not counted as duplicates.`,
      financialImpact: dup.confirmedExposure,
      investigatePath: '/reconciliation',
      investigateExtras: { exceptionType: 'Duplicate Billing' },
    },
    {
      id: 'missing-recognition',
      label: 'Missing Recognition in Selection',
      issueCount: recognized.display === 'no_records' ? 1 : 0,
      checkedCount: 1,
      severity:
        recognized.display === 'no_records'
          ? filters.regions.length || filters.serviceTypes.length || filters.metros.length
            ? 'Warning'
            : 'Critical'
          : 'Healthy',
      affectedMetrics: ['Recognized Revenue'],
      detailHint: recognized.note,
      financialImpact: null,
      investigatePath: '/lifecycle',
    },
    {
      id: 'invalid-period',
      label: 'Invalid Accounting Periods',
      issueCount: invalidPeriods,
      checkedCount: data.revenueRecognition.length,
      severity: invalidPeriods === 0 ? 'Healthy' : 'Critical',
      affectedMetrics: ['Date filters'],
      detailHint: 'YYYY-MM required',
      financialImpact: null,
    },
    {
      id: 'metro-coords',
      label: 'Missing Metro Coordinates',
      issueCount: missingMetroCoord,
      checkedCount: new Set(ships.map((s) => s.metro)).size,
      severity: missingMetroCoord === 0 ? 'Healthy' : 'Warning',
      affectedMetrics: ['Geographic Footprint'],
      detailHint: 'METRO_DEFINITIONS catalog',
      financialImpact: null,
    },
    {
      id: 'unmatched-rate',
      label: 'Unmatched Rate Cards on Billing',
      issueCount: unmatchedRates,
      checkedCount: lines.length,
      severity: unmatchedRates === 0 ? 'Healthy' : 'Critical',
      affectedMetrics: ['Pricing Trace'],
      detailHint: 'dim_rate_card.rate_card_id',
      financialImpact: null,
    },
    {
      id: 'missing-var-cost',
      label: 'Billed Shipments without Variable Cost',
      issueCount: missingCost,
      checkedCount: billed.size,
      severity:
        missingCost === 0
          ? 'Healthy'
          : missingCost / Math.max(1, billed.size) > 0.2
            ? 'Warning'
            : 'Healthy',
      affectedMetrics: ['Contribution Margin', 'CPP'],
      detailHint: 'fact_cost linked by shipment_id',
      financialImpact: null,
      investigatePath: '/unit-economics',
    },
  ]
  return checks
}
