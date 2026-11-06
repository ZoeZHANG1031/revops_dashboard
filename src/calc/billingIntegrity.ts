import { filterBillingLines, filterShipments } from '@/lib/filters'
import { createCalcMemo, filterCacheKey } from '@/lib/memoCalc'
import { expectedLotCharges } from '@/lib/pricing'
import type { DataStore, FactBillingLine, GlobalFilters } from '@/types'

/**
 * Lot-level billing integrity for a filter scope — single source for Expected Charges,
 * Billing Accuracy and the Reconciliation Bridge.
 *
 * Every billable lot shipped in the window starts at its expected gross (re-rated with the shared
 * rater) and ends in exactly one bucket:
 *   billed in window  → − contractual discount − credits − rate-mismatch shortfall − missing surcharge
 *   missing billing   → − discount − expected net (exception amount)
 *   billed after window → − expected gross (timing out)
 * plus lines in the window for lots shipped earlier (timing in, + net).
 * By construction: Expected Gross + Σ components = Actual Net Billing (residual = unexplained cents).
 */
export interface BillingIntegrity {
  expectedGross: number
  actualNet: number
  discounts: number
  credits: number
  rateMismatch: number
  missingSurcharge: number
  missingBilling: number
  timingOut: number
  timingIn: number
  /** Expected charges for billable lots with no effective rate card (excluded from expected) */
  unratedLots: number
  residual: number
  /** Package-weighted: eligible billable packages and those billed exactly once without rating defects */
  eligiblePackages: number
  correctlyBilledPackages: number
  billedPackages: number
}

const memo = createCalcMemo<BillingIntegrity>(64)
const r2 = (v: number) => Math.round(v * 100) / 100

const lineIndexCache = new WeakMap<FactBillingLine[], Map<string, FactBillingLine[]>>()
function linesByShipment(data: DataStore): Map<string, FactBillingLine[]> {
  let idx = lineIndexCache.get(data.billingLines)
  if (!idx) {
    idx = new Map()
    for (const b of data.billingLines) {
      const list = idx.get(b.shipment_id)
      if (list) list.push(b)
      else idx.set(b.shipment_id, [b])
    }
    lineIndexCache.set(data.billingLines, idx)
  }
  return idx
}

const defectCache = new WeakMap<object, Map<string, 'Rate Mismatch' | 'Missing Surcharge'>>()
function lineDefects(data: DataStore) {
  let m = defectCache.get(data.exceptions)
  if (!m) {
    m = new Map()
    for (const e of data.exceptions) {
      if (e.billing_line_id && (e.exception_type === 'Rate Mismatch' || e.exception_type === 'Missing Surcharge')) {
        m.set(e.billing_line_id, e.exception_type)
      }
    }
    defectCache.set(data.exceptions, m)
  }
  return m
}

export function computeBillingIntegrity(data: DataStore, filters: GlobalFilters): BillingIntegrity {
  const key = filterCacheKey(filters)
  const hit = memo.get(data, key)
  if (hit) return hit

  const inWindow = (p: string) => p >= filters.startPeriod && p <= filters.endPeriod
  const byShip = linesByShipment(data)
  const defects = lineDefects(data)
  const out = {
    expectedGross: 0, actualNet: 0, discounts: 0, credits: 0, rateMismatch: 0, missingSurcharge: 0,
    missingBilling: 0, timingOut: 0, timingIn: 0, unratedLots: 0, residual: 0,
    eligiblePackages: 0, correctlyBilledPackages: 0, billedPackages: 0,
  }
  const lotsInWindow = new Set<string>()
  for (const s of filterShipments(data, filters)) {
    if (!s.billable) continue
    lotsInWindow.add(s.shipment_id)
    const exp = expectedLotCharges(data, s)
    if (!exp) {
      out.unratedLots += 1
      continue
    }
    out.expectedGross += exp.gross
    out.eligiblePackages += s.package_count
    const lines = (byShip.get(s.shipment_id) ?? []).filter((l) => !l.is_duplicate)
    const dup = (byShip.get(s.shipment_id) ?? []).some((l) => l.is_duplicate)
    if (lines.length === 0) {
      out.discounts -= exp.discount
      out.missingBilling -= exp.expectedNet
      continue
    }
    const line = lines[0]
    out.billedPackages += s.package_count
    if (!inWindow(line.accounting_period)) {
      out.timingOut -= exp.gross
      continue
    }
    out.discounts -= line.discounts
    out.credits -= line.credits
    const shortfall = r2(exp.expectedNet - (line.base_charge + line.fuel_surcharge + line.remote_surcharge - line.discounts))
    const defect = defects.get(line.billing_line_id)
    if (defect === 'Missing Surcharge') out.missingSurcharge -= shortfall
    else if (defect === 'Rate Mismatch') out.rateMismatch -= shortfall
    else out.residual -= shortfall // should be ~0: clean lots re-rate exactly
    if (!defect && !dup) out.correctlyBilledPackages += s.package_count
  }
  for (const l of filterBillingLines(data, filters)) {
    out.actualNet += l.net_amount
    if (!lotsInWindow.has(l.shipment_id)) out.timingIn += l.net_amount // shipped before the window
  }
  const res: BillingIntegrity = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, r2(v)])) as unknown as BillingIntegrity
  // Any remaining gap (e.g. lines for lots outside the shipment filter scope) is shown, never hidden
  const explained = r2(
    res.expectedGross + res.discounts + res.credits + res.rateMismatch + res.missingSurcharge + res.missingBilling + res.timingOut + res.timingIn,
  )
  res.residual = r2(res.actualNet - explained)
  return memo.set(data, key, res)
}
