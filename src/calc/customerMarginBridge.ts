import { filterBillingLines, filterCosts, shipmentMetro } from '@/lib/filters'
import { customerComparisonWindow } from './customerComparison'
import { createCalcMemo, filterCacheKey } from '@/lib/memoCalc'
import { pkgs } from '@/lib/pricing'
import { money, pct, sumMoney } from '@/lib/money'
import type { DataStore, GlobalFilters } from '@/types'
import type { WaterfallStep } from '@/components/charts/FloatingWaterfall'

const DSP = 'DSP Delivery'
const SORT = 'Sorting'
const LINE = 'Linehaul'
const OTHER_VARS = new Set(['Redelivery', 'Claims', 'Other Variable'])

export interface GeoProfitRow {
  metro: string
  shipments: number
  netRevenue: number
  variableCost: number
  contributionProfit: number
  contributionMarginPct: number | null
  rpp: number | null
  cpp: number | null
}

export interface CustomerMarginDiagnosis {
  customerId: string
  priorContributionProfit: number
  currentContributionProfit: number
  cpChange: number
  priorVolume: number
  currentVolume: number
  volumeImpact: number
  yieldImpact: number
  dspImpact: number
  sortingImpact: number
  linehaulImpact: number
  otherVarImpact: number
  mixResidual: number
  checkSum: number
  comparable: boolean
  priorLabel: string
  currentLabel: string
  waterfall: WaterfallStep[]
  unitEconomics: {
    rpp: number | null
    cpp: number | null
    contributionPerPackage: number | null
    contributionMarginPct: number | null
  }
  geoProfitability: GeoProfitRow[]
  note: string
}

const marginMemo = createCalcMemo<CustomerMarginDiagnosis>(32)

type CostBucket = 'dsp' | 'sorting' | 'linehaul' | 'other'

function bucketType(costType: string): CostBucket | null {
  if (costType === DSP) return 'dsp'
  if (costType === SORT) return 'sorting'
  if (costType === LINE) return 'linehaul'
  if (OTHER_VARS.has(costType)) return 'other'
  return null
}

function sumVarCosts(costs: ReturnType<typeof filterCosts>): Record<CostBucket, number> {
  const out: Record<CostBucket, number> = { dsp: 0, sorting: 0, linehaul: 0, other: 0 }
  for (const c of costs) {
    const b = bucketType(c.cost_type)
    if (b) out[b] += c.amount
  }
  return {
    dsp: money(out.dsp),
    sorting: money(out.sorting),
    linehaul: money(out.linehaul),
    other: money(out.other),
  }
}

function totalVar(costs: Record<CostBucket, number>): number {
  return money(costs.dsp + costs.sorting + costs.linehaul + costs.other)
}

function cppBucket(costs: Record<CostBucket, number>, vol: number): Record<CostBucket, number> {
  if (vol <= 0) return { dsp: 0, sorting: 0, linehaul: 0, other: 0 }
  return {
    dsp: costs.dsp / vol,
    sorting: costs.sorting / vol,
    linehaul: costs.linehaul / vol,
    other: costs.other / vol,
  }
}

function buildGeoTable(
  data: DataStore,
  lines: ReturnType<typeof filterBillingLines>,
  costs: ReturnType<typeof filterCosts>,
): GeoProfitRow[] {
  const metroIdx = new Map(data.shipments.map((s) => [s.shipment_id, s.metro]))
  const byMetro = new Map<string, { vol: number; net: number; cost: number }>()

  for (const l of lines) {
    const metro = shipmentMetro(data, l.shipment_id, metroIdx) ?? 'UNKNOWN'
    const cur = byMetro.get(metro) ?? { vol: 0, net: 0, cost: 0 }
    cur.vol += l.package_count
    cur.net += l.net_amount
    byMetro.set(metro, cur)
  }
  for (const c of costs) {
    const b = bucketType(c.cost_type)
    if (!b) continue
    const metro = shipmentMetro(data, c.shipment_id, metroIdx) ?? 'UNKNOWN'
    const cur = byMetro.get(metro) ?? { vol: 0, net: 0, cost: 0 }
    cur.cost += c.amount
    byMetro.set(metro, cur)
  }

  return [...byMetro.entries()]
    .map(([metro, v]) => {
      const cp = money(v.net - v.cost)
      return {
        metro,
        shipments: v.vol,
        netRevenue: money(v.net),
        variableCost: money(v.cost),
        contributionProfit: cp,
        contributionMarginPct: pct(cp, v.net),
        rpp: v.vol ? money(v.net / v.vol) : null,
        cpp: v.vol ? money(v.cost / v.vol) : null,
      }
    })
    .sort((a, b) => b.contributionProfit - a.contributionProfit)
}

/**
 * Contribution-profit bridge prior → current window for one customer.
 */
export function computeCustomerMarginDiagnosis(
  data: DataStore,
  filters: GlobalFilters,
  customerId: string,
): CustomerMarginDiagnosis {
  const key = filterCacheKey({ ...filters, customerIds: [customerId] }, ['custMarginBridge'])
  const cached = marginMemo.get(data, key)
  if (cached) return cached
  return marginMemo.set(data, key, computeCustomerMarginDiagnosisFresh(data, filters, customerId))
}

function computeCustomerMarginDiagnosisFresh(
  data: DataStore,
  filters: GlobalFilters,
  customerId: string,
): CustomerMarginDiagnosis {
  // Shared comparison window (same months prior year) — identical to Health Score and revenue bridge
  const win = customerComparisonWindow(data, filters)
  const prior = win.prior ?? { startPeriod: '0000-00', endPeriod: '0000-00' }
  const priorLabel = win.prior ? `${win.prior.startPeriod} → ${win.prior.endPeriod}` : 'N/A (before history)'
  const currentLabel = `${filters.startPeriod} → ${filters.endPeriod}`

  const curF: GlobalFilters = { ...filters, customerIds: [customerId] }
  const priorF: GlobalFilters = { ...filters, ...prior, customerIds: [customerId] }

  const curLines = filterBillingLines(data, curF)
  const priorLines = filterBillingLines(data, priorF)
  const curCosts = filterCosts(data, curF).filter((c) => bucketType(c.cost_type))
  const priorCosts = filterCosts(data, priorF).filter((c) => bucketType(c.cost_type))

  const R0 = sumMoney(priorLines.map((l) => l.net_amount))
  const R1 = sumMoney(curLines.map((l) => l.net_amount))
  const V0 = pkgs(priorLines)
  const V1 = pkgs(curLines)
  const C0 = sumMoney(priorCosts.map((c) => c.amount))
  const C1 = sumMoney(curCosts.map((c) => c.amount))

  const priorCP = money(R0 - C0)
  const currentCP = money(R1 - C1)
  const cpChange = money(currentCP - priorCP)
  const comparable = V0 > 0 && (R0 !== 0 || C0 !== 0)

  const rpp0 = V0 > 0 ? R0 / V0 : 0
  const rpp1 = V1 > 0 ? R1 / V1 : 0
  const cpp0 = V0 > 0 ? C0 / V0 : 0
  const cpp1 = V1 > 0 ? C1 / V1 : 0

  const volumeImpact = comparable ? money((V1 - V0) * (rpp0 - cpp0)) : 0
  const yieldImpact = comparable ? money(V1 * (rpp1 - rpp0)) : 0

  const b0 = sumVarCosts(priorCosts)
  const b1 = sumVarCosts(curCosts)
  const cpp0b = cppBucket(b0, V0)
  const cpp1b = cppBucket(b1, V1)

  const dspImpact = comparable ? money(-V1 * (cpp1b.dsp - cpp0b.dsp)) : 0
  const sortingImpact = comparable ? money(-V1 * (cpp1b.sorting - cpp0b.sorting)) : 0
  const linehaulImpact = comparable ? money(-V1 * (cpp1b.linehaul - cpp0b.linehaul)) : 0
  const otherVarImpact = comparable ? money(-V1 * (cpp1b.other - cpp0b.other)) : 0

  const explained = money(
    volumeImpact + yieldImpact + dspImpact + sortingImpact + linehaulImpact + otherVarImpact,
  )
  const mixResidual = money(cpChange - explained)
  const checkSum = money(explained + mixResidual)

  const waterfall: WaterfallStep[] = [
    { key: 'prior', label: 'Prior Contribution Profit', amount: priorCP },
    { key: 'volume', label: 'Volume Impact', amount: volumeImpact },
    { key: 'yield', label: 'Yield (RPP) Impact', amount: yieldImpact },
    { key: 'dsp', label: 'DSP Cost Impact', amount: dspImpact },
    { key: 'sorting', label: 'Sorting Cost Impact', amount: sortingImpact },
    { key: 'linehaul', label: 'Linehaul Cost Impact', amount: linehaulImpact },
    { key: 'other', label: 'Other Variable Cost Impact', amount: otherVarImpact },
    { key: 'residual', label: 'Mix & Residual', amount: mixResidual },
    { key: 'current', label: 'Current Contribution Profit', amount: currentCP },
  ]

  return {
    customerId,
    priorContributionProfit: priorCP,
    currentContributionProfit: currentCP,
    cpChange,
    priorVolume: V0,
    currentVolume: V1,
    volumeImpact,
    yieldImpact,
    dspImpact,
    sortingImpact,
    linehaulImpact,
    otherVarImpact,
    mixResidual,
    checkSum,
    comparable,
    priorLabel,
    currentLabel,
    waterfall,
    unitEconomics: {
      rpp: V1 ? money(R1 / V1) : null,
      cpp: V1 ? money(C1 / V1) : null,
      contributionPerPackage: V1 ? money((R1 - C1) / V1) : null,
      contributionMarginPct: pct(currentCP, R1),
    },
    geoProfitability: buildGeoTable(data, curLines, curCosts),
    note: comparable
      ? 'CP bridge: volume × prior unit margin, yield on RPP, signed variable CPP deltas on current volume, residual plug.'
      : 'Insufficient prior activity for margin bridge.',
  }
}
