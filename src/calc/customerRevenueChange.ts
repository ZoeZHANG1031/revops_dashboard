import { filterBillingLines } from '@/lib/filters'
import { money, pct, sumMoney } from '@/lib/money'
import { pkgs } from '@/lib/pricing'
import type { DataStore, GlobalFilters } from '@/types'
import { priorPeriodRange } from '@/lib/filters'

export interface CustomerRevenueChange {
  customerId: string
  priorRevenue: number
  currentRevenue: number
  revenueChange: number
  revenueChangePct: number | null
  priorVolume: number
  currentVolume: number
  volumeChangePct: number | null
  priorRpp: number | null
  currentRpp: number | null
  rppChangePct: number | null
  /** (ΔVol) × prior RPP */
  volumeImpact: number
  /** currentVol × (ΔRPP) */
  priceImpact: number
  /** plug so volumeImpact + priceImpact + residual = revenueChange */
  residual: number
  checkSum: number
  comparable: boolean
  priorLabel: string
  currentLabel: string
  note: string
}

/**
 * Exact multiplicative decomposition for one customer:
 * ΔRevenue = Volume Impact + Price (RPP) Impact + Residual
 * Volume Impact = (V1 − V0) × RPP0
 * Price Impact = V1 × (RPP1 − RPP0)
 * Residual absorbs mix/credits timing within the period windows.
 */
export function computeCustomerRevenueChange(
  data: DataStore,
  filters: GlobalFilters,
  customerId: string,
): CustomerRevenueChange {
  const prior = priorPeriodRange(filters)
  const currentLabel = `${filters.startPeriod} → ${filters.endPeriod}`
  const priorLabel = `${prior.startPeriod} → ${prior.endPeriod}`

  const curFilters: GlobalFilters = { ...filters, customerIds: [customerId] }
  const priorFilters: GlobalFilters = { ...filters, ...prior, customerIds: [customerId] }

  const curLines = filterBillingLines(data, curFilters)
  const priorLines = filterBillingLines(data, priorFilters)

  const currentRevenue = sumMoney(curLines.map((l) => l.net_amount))
  const priorRevenue = sumMoney(priorLines.map((l) => l.net_amount))
  const currentVolume = pkgs(curLines)
  const priorVolume = pkgs(priorLines)
  const currentRpp = currentVolume > 0 ? money(currentRevenue / currentVolume) : null
  const priorRpp = priorVolume > 0 ? money(priorRevenue / priorVolume) : null

  const comparable = priorVolume > 0 && priorRevenue !== 0
  const revenueChange = money(currentRevenue - priorRevenue)
  const volumeImpact =
    priorRpp != null ? money((currentVolume - priorVolume) * priorRpp) : 0
  const priceImpact =
    currentRpp != null && priorRpp != null
      ? money(currentVolume * (currentRpp - priorRpp))
      : 0
  const residual = money(revenueChange - volumeImpact - priceImpact)

  return {
    customerId,
    priorRevenue,
    currentRevenue,
    revenueChange,
    revenueChangePct: pct(revenueChange, Math.abs(priorRevenue)),
    priorVolume,
    currentVolume,
    volumeChangePct: priorVolume > 0 ? pct(currentVolume - priorVolume, priorVolume) : null,
    priorRpp,
    currentRpp,
    rppChangePct:
      priorRpp != null && priorRpp !== 0 && currentRpp != null
        ? pct(currentRpp - priorRpp, Math.abs(priorRpp))
        : null,
    volumeImpact,
    priceImpact,
    residual,
    checkSum: money(volumeImpact + priceImpact + residual),
    comparable,
    priorLabel,
    currentLabel,
    note: comparable
      ? 'ΔRevenue = (ΔVolume × Prior RPP) + (Current Volume × ΔRPP) + Residual. Residual covers credits/mix/timing inside the windows — not forced to zero.'
      : 'Insufficient prior-window billing for a comparable volume×price decomposition (New / N/A).',
  }
}
