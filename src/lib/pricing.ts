import { metroByName } from '@/data/metros'
import type { DataStore, DimRateCard, FactShipment, RegionCode, ServiceType } from '@/types'

/**
 * Single source of truth for rating a shipment lot against a rate card.
 * Used by the synthetic generator (to bill) AND by Expected Charges / Reconciliation (to re-rate),
 * so clean lots reconcile to the cent and every difference is an explicit exception or adjustment.
 */
export interface LotCharges {
  /** List base for the lot = (base_rate + per_lb × weight) × zone factor × packages */
  base: number
  /** Volume-tier contractual discount */
  discount: number
  /** Fuel surcharge on (base − discount) */
  fuel: number
  /** Remote / residential + peak-season accessorials */
  accessorial: number
  /** base + fuel + accessorial (before discount) */
  gross: number
  /** gross − discount (expected net before credits) */
  expectedNet: number
}

const round2 = (v: number) => Math.round(v * 100) / 100

export function zoneFactor(zone: number, zoneMultiplier: number): number {
  return 1 + (zone - 1) * 0.06 * zoneMultiplier
}

/** Peak-season accessorial applies to November and December ship dates */
export function isPeakPeriod(period: string): boolean {
  const m = Number(period.slice(5, 7))
  return m === 11 || m === 12
}

export function remotePackages(metro: string, packages: number): number {
  const share = metroByName(metro)?.remote_share ?? 0
  return Math.round(packages * share)
}

export function rateLot(
  card: DimRateCard,
  lot: Pick<FactShipment, 'package_count' | 'weight_lbs' | 'zone' | 'metro' | 'ship_date'>,
  /** Customer's billable packages in the ship month — drives the volume-tier discount */
  customerMonthPackages: number,
): LotCharges {
  const perPkg = (card.base_rate + lot.weight_lbs * card.per_lb_rate) * zoneFactor(lot.zone, card.zone_multiplier)
  const base = round2(perPkg * lot.package_count)
  const discount = customerMonthPackages >= card.volume_tier_min ? round2(base * card.volume_tier_discount) : 0
  const fuel = round2((base - discount) * card.fuel_surcharge_pct)
  const peak = isPeakPeriod(lot.ship_date.slice(0, 7)) ? (card.peak_surcharge ?? 0) * lot.package_count : 0
  const accessorial = round2(remotePackages(lot.metro, lot.package_count) * card.remote_surcharge + peak)
  const gross = round2(base + fuel + accessorial)
  return { base, discount, fuel, accessorial, gross, expectedNet: round2(gross - discount) }
}

/** Rate card effective on the ship date for contract × service × region (latest version wins) */
export function buildRateCardIndex(cards: DimRateCard[]) {
  const byKey = new Map<string, DimRateCard[]>()
  for (const c of cards) {
    const k = `${c.contract_id}|${c.service_type}|${c.region}`
    const list = byKey.get(k)
    if (list) list.push(c)
    else byKey.set(k, [c])
  }
  for (const list of byKey.values()) list.sort((a, b) => b.version - a.version)
  return (contractId: string, service: ServiceType, region: RegionCode, date: string): DimRateCard | null => {
    const list = byKey.get(`${contractId}|${service}|${region}`)
    if (!list) return null
    return list.find((c) => c.effective_from <= date && c.effective_to >= date) ?? null
  }
}

const rateIndexCache = new WeakMap<DimRateCard[], ReturnType<typeof buildRateCardIndex>>()
export function rateCardLookup(data: DataStore) {
  let idx = rateIndexCache.get(data.rateCards)
  if (!idx) {
    idx = buildRateCardIndex(data.rateCards)
    rateIndexCache.set(data.rateCards, idx)
  }
  return idx
}

/** customer_id|YYYY-MM → billable packages shipped (volume-tier basis), cached per store */
const volumeCache = new WeakMap<FactShipment[], Map<string, number>>()
export function customerMonthVolume(data: DataStore): Map<string, number> {
  let m = volumeCache.get(data.shipments)
  if (!m) {
    m = new Map()
    for (const s of data.shipments) {
      if (!s.billable) continue
      const k = `${s.customer_id}|${s.ship_date.slice(0, 7)}`
      m.set(k, (m.get(k) ?? 0) + s.package_count)
    }
    volumeCache.set(data.shipments, m)
  }
  return m
}

/** Expected (re-rated) charges for one lot, or null when no effective rate card exists */
export function expectedLotCharges(data: DataStore, s: FactShipment): LotCharges | null {
  const card = rateCardLookup(data)(s.contract_id, s.service_type, s.region, s.ship_date)
  if (!card) return null
  const vol = customerMonthVolume(data).get(`${s.customer_id}|${s.ship_date.slice(0, 7)}`) ?? 0
  return rateLot(card, s, vol)
}

/** Packages represented by shipment lots or billing lines */
export function pkgs(rows: { package_count: number }[]): number {
  let n = 0
  for (const r of rows) n += r.package_count
  return n
}
