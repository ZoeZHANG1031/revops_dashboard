import { filterBillingLines, shipmentMetro } from '@/lib/filters'
import { customerComparisonWindow } from './customerComparison'
import { createCalcMemo, filterCacheKey } from '@/lib/memoCalc'
import { pkgs } from '@/lib/pricing'
import { money } from '@/lib/money'
import type { DataStore, FactBillingLine, GlobalFilters, ServiceType } from '@/types'
import type { WaterfallStep } from '@/components/charts/FloatingWaterfall'

export interface VolumeBreakdownRow {
  dimension: 'metro' | 'station' | 'service'
  key: string
  label: string
  priorVolume: number
  currentVolume: number
  volumeDelta: number
}

export interface CustomerRevenueBridge {
  customerId: string
  priorRevenue: number
  currentRevenue: number
  revenueChange: number
  priorVolume: number
  currentVolume: number
  volumeImpact: number
  serviceMixImpact: number
  geoMixImpact: number
  priceImpact: number
  creditsImpact: number
  residual: number
  checkSum: number
  comparable: boolean
  priorLabel: string
  currentLabel: string
  volumeBreakdown: VolumeBreakdownRow[]
  waterfall: WaterfallStep[]
  note: string
}

/** net = pre-credit billing (net_amount + credits); credits are bridged separately so they are not counted twice */
type CellAgg = { vol: number; net: number; credits: number }

const bridgeMemo = createCalcMemo<CustomerRevenueBridge>(32)

function cellKey(service: ServiceType, metro: string | null): string {
  return `${service}|${metro ?? 'UNKNOWN'}`
}

function aggregateCustomerLines(
  data: DataStore,
  lines: FactBillingLine[],
): {
  net: number
  credits: number
  vol: number
  byService: Map<ServiceType, CellAgg>
  byMetro: Map<string, CellAgg>
  byCell: Map<string, CellAgg>
  byStation: Map<string, CellAgg>
} {
  const metroIdx = new Map(data.shipments.map((s) => [s.shipment_id, s]))
  const byService = new Map<ServiceType, CellAgg>()
  const byMetro = new Map<string, CellAgg>()
  const byCell = new Map<string, CellAgg>()
  const byStation = new Map<string, CellAgg>()
  let net = 0
  let credits = 0

  const bump = (map: Map<string, CellAgg>, key: string, l: FactBillingLine) => {
    const cur = map.get(key) ?? { vol: 0, net: 0, credits: 0 }
    cur.vol += l.package_count
    cur.net += l.net_amount + l.credits
    cur.credits += l.credits
    map.set(key, cur)
  }

  for (const l of lines) {
    net += l.net_amount
    credits += l.credits
    const ship = l.shipment_id ? metroIdx.get(l.shipment_id) : undefined
    const metro = ship?.metro ?? shipmentMetro(data, l.shipment_id) ?? 'UNKNOWN'
    const station = ship?.station_id ?? 'UNKNOWN'
    const svc = l.service_type

    bump(byService as Map<string, CellAgg>, svc, l)
    bump(byMetro, metro, l)
    bump(byStation, station, l)
    bump(byCell, cellKey(svc, metro), l)
  }

  return {
    net: money(net),
    credits: money(credits),
    vol: pkgs(lines),
    byService,
    byMetro,
    byCell,
    byStation,
  }
}

function rpp(agg: CellAgg): number {
  return agg.vol > 0 ? agg.net / agg.vol : 0
}

function shareWeights(map: Map<string, CellAgg>, totalVol: number): Map<string, number> {
  const w = new Map<string, number>()
  if (totalVol <= 0) return w
  map.forEach((v, k) => w.set(k, v.vol / totalVol))
  return w
}

function laspeyresMix(
  w0: Map<string, number>,
  w1: Map<string, number>,
  rpp0ByKey: Map<string, number>,
  v1: number,
  fallbackRpp: number,
): number {
  let sum = 0
  const keys = new Set([...w0.keys(), ...w1.keys()])
  keys.forEach((k) => {
    const dw = (w1.get(k) ?? 0) - (w0.get(k) ?? 0)
    // New cells are valued at the prior average yield — the same fallback the price effect uses
    sum += dw * (rpp0ByKey.get(k) ?? fallbackRpp)
  })
  return money(v1 * sum)
}

function buildVolumeBreakdown(
  prior: ReturnType<typeof aggregateCustomerLines>,
  cur: ReturnType<typeof aggregateCustomerLines>,
): VolumeBreakdownRow[] {
  const rows: VolumeBreakdownRow[] = []
  const add = (
    dimension: VolumeBreakdownRow['dimension'],
    priorMap: Map<string, CellAgg>,
    curMap: Map<string, CellAgg>,
  ) => {
    const keys = new Set([...priorMap.keys(), ...curMap.keys()])
    keys.forEach((key) => {
      const p0 = priorMap.get(key)?.vol ?? 0
      const p1 = curMap.get(key)?.vol ?? 0
      rows.push({
        dimension,
        key,
        label: key,
        priorVolume: p0,
        currentVolume: p1,
        volumeDelta: money(p1 - p0),
      })
    })
  }
  add('service', prior.byService as Map<string, CellAgg>, cur.byService as Map<string, CellAgg>)
  add('metro', prior.byMetro, cur.byMetro)
  add('station', prior.byStation, cur.byStation)
  return rows.sort((a, b) => Math.abs(b.volumeDelta) - Math.abs(a.volumeDelta))
}

/**
 * Period-over-period revenue bridge for one customer:
 * prior + volume + serviceMix + geoMix + price + credits + residual = current
 */
export function computeCustomerRevenueBridge(
  data: DataStore,
  filters: GlobalFilters,
  customerId: string,
): CustomerRevenueBridge {
  const key = filterCacheKey({ ...filters, customerIds: [customerId] }, ['custRevBridge'])
  const cached = bridgeMemo.get(data, key)
  if (cached) return cached
  return bridgeMemo.set(data, key, computeCustomerRevenueBridgeFresh(data, filters, customerId))
}

function computeCustomerRevenueBridgeFresh(
  data: DataStore,
  filters: GlobalFilters,
  customerId: string,
): CustomerRevenueBridge {
  // Shared comparison window (same months prior year) — identical to Health Score revenue growth
  const win = customerComparisonWindow(data, filters)
  const priorRange = win.prior ?? { startPeriod: '0000-00', endPeriod: '0000-00' }
  const currentLabel = `${filters.startPeriod} → ${filters.endPeriod}`
  const priorLabel = win.prior ? `${win.prior.startPeriod} → ${win.prior.endPeriod}` : 'N/A (before history)'

  const curFilters: GlobalFilters = { ...filters, customerIds: [customerId] }
  const priorFilters: GlobalFilters = { ...filters, ...priorRange, customerIds: [customerId] }

  const curAgg = aggregateCustomerLines(data, filterBillingLines(data, curFilters))
  const priorAgg = aggregateCustomerLines(data, filterBillingLines(data, priorFilters))

  const priorRevenue = priorAgg.net
  const currentRevenue = curAgg.net
  const priorVolume = priorAgg.vol
  const currentVolume = curAgg.vol
  const comparable = priorVolume > 0 && priorRevenue !== 0

  const revenueChange = money(currentRevenue - priorRevenue)
  // Pre-credit yield: credits get their own bar
  const RPP0 = priorVolume > 0 ? (priorRevenue + priorAgg.credits) / priorVolume : 0

  const volumeImpact = comparable ? money((currentVolume - priorVolume) * RPP0) : 0

  const w0s = shareWeights(priorAgg.byService as Map<string, CellAgg>, priorVolume)
  const w1s = shareWeights(curAgg.byService as Map<string, CellAgg>, currentVolume)
  const rpp0Service = new Map<string, number>()
  priorAgg.byService.forEach((v, k) => rpp0Service.set(k, rpp(v)))

  const serviceMixImpact = comparable
    ? laspeyresMix(w0s, w1s, rpp0Service, currentVolume, RPP0)
    : 0

  const w0c = shareWeights(priorAgg.byCell, priorVolume)
  const w1c = shareWeights(curAgg.byCell, currentVolume)
  const rpp0Cell = new Map<string, number>()
  priorAgg.byCell.forEach((v, k) => rpp0Cell.set(k, rpp(v)))
  const mixTotal = comparable ? laspeyresMix(w0c, w1c, rpp0Cell, currentVolume, RPP0) : 0
  const geoMixImpact = money(mixTotal - serviceMixImpact)

  let priceImpact = 0
  if (comparable) {
    curAgg.byCell.forEach((v1, k) => {
      const rpp1 = rpp(v1)
      const rpp0 = rpp0Cell.get(k) ?? RPP0
      priceImpact += v1.vol * (rpp1 - rpp0)
    })
    priceImpact = money(priceImpact)
  }

  const creditsImpact = money(-(curAgg.credits - priorAgg.credits))

  const explained = money(
    volumeImpact + serviceMixImpact + geoMixImpact + priceImpact + creditsImpact,
  )
  const residual = money(revenueChange - explained)
  const checkSum = money(
    volumeImpact + serviceMixImpact + geoMixImpact + priceImpact + creditsImpact + residual,
  )

  const waterfall: WaterfallStep[] = [
    { key: 'prior', label: `Net Billing ${priorLabel}`, shortLabel: 'Prior', amount: priorRevenue },
    { key: 'volume', label: 'Volume effect (billed packages × prior yield)', shortLabel: 'Volume', amount: volumeImpact },
    { key: 'serviceMix', label: 'Service mix effect', shortLabel: 'Service mix', amount: serviceMixImpact },
    { key: 'geoMix', label: 'Geography mix effect', shortLabel: 'Geo mix', amount: geoMixImpact },
    { key: 'price', label: 'Price / yield effect', shortLabel: 'Price', amount: priceImpact },
    { key: 'credits', label: 'Credits effect', shortLabel: 'Credits', amount: creditsImpact },
    { key: 'residual', label: 'Unexplained residual', shortLabel: 'Residual', amount: residual },
    { key: 'current', label: `Net Billing ${currentLabel}`, shortLabel: 'Current', amount: currentRevenue },
  ]

  return {
    customerId,
    priorRevenue,
    currentRevenue,
    revenueChange,
    priorVolume,
    currentVolume,
    volumeImpact,
    serviceMixImpact,
    geoMixImpact,
    priceImpact,
    creditsImpact,
    residual,
    checkSum,
    comparable,
    priorLabel,
    currentLabel,
    volumeBreakdown: buildVolumeBreakdown(priorAgg, curAgg),
    waterfall,
    note: comparable
      ? 'Arithmetic attribution of Net Billing change (not a business root cause). Volume = Δ billed packages × prior pre-credit yield; mix = Laspeyres (service first, geo = cell − service); price = yield change on current packages; credits separate. Residual = rounding.'
      : 'Insufficient prior-window billing for a full mix/price bridge.',
  }
}
