import { filterBillingLinesIncludingDuplicates } from '@/lib/filters'
import { money, sumMoney } from '@/lib/money'
import type { DataStore, FactBillingLine, GlobalFilters } from '@/types'

export type DuplicateClass =
  | 'Exact Duplicate'
  | 'Potential Duplicate'
  | 'Legitimate Multi-Charge'
  | 'Reversal / Adjustment'

export interface DuplicateAssessment {
  billingLineId: string
  shipmentId: string
  customerId: string
  classification: DuplicateClass
  isFlaggedDuplicate: boolean
  chargeFingerprint: string
  netAmount: number
  pairedLineId: string | null
  exposure: number
  reason: string
  exceptionId: string | null
}

function fingerprint(b: FactBillingLine): string {
  // Synthetic lines are single net charge per shipment; duplicate clones share amounts.
  return [
    b.shipment_id,
    b.service_type,
    b.rate_card_id,
    b.base_charge.toFixed(2),
    b.fuel_surcharge.toFixed(2),
    b.remote_surcharge.toFixed(2),
    b.discounts.toFixed(2),
    b.credits.toFixed(2),
  ].join('|')
}

/**
 * Classify billing lines that share a shipment_id.
 * Flagged is_duplicate clones of an identical fingerprint = Exact Duplicate.
 * Same shipment with different charge components would be Legitimate Multi-Charge
 * (current generator rarely emits multi-component lines as separate rows).
 */
export function assessDuplicateBilling(
  data: DataStore,
  filters: GlobalFilters,
): {
  assessments: DuplicateAssessment[]
  exactCount: number
  potentialCount: number
  legitimateMultiCount: number
  confirmedExposure: number
  suspectedExposure: number
} {
  const lines = filterBillingLinesIncludingDuplicates(data, filters)
  const byShip = new Map<string, FactBillingLine[]>()
  for (const l of lines) {
    const list = byShip.get(l.shipment_id) ?? []
    list.push(l)
    byShip.set(l.shipment_id, list)
  }

  const assessments: DuplicateAssessment[] = []
  let exactCount = 0
  let potentialCount = 0
  let legitimateMultiCount = 0
  let confirmedExposure = 0
  let suspectedExposure = 0

  for (const [shipmentId, group] of byShip) {
    if (group.length < 2) continue
    const fps = new Map<string, FactBillingLine[]>()
    for (const l of group) {
      const fp = fingerprint(l)
      const g = fps.get(fp) ?? []
      g.push(l)
      fps.set(fp, g)
    }

    for (const [fp, clones] of fps) {
      if (clones.length === 1) {
        // Different fingerprint on same shipment → legitimate multi-charge components
        if (group.length > 1 && fps.size > 1) {
          legitimateMultiCount += 1
          assessments.push({
            billingLineId: clones[0].billing_line_id,
            shipmentId,
            customerId: clones[0].customer_id,
            classification: 'Legitimate Multi-Charge',
            isFlaggedDuplicate: clones[0].is_duplicate,
            chargeFingerprint: fp,
            netAmount: clones[0].net_amount,
            pairedLineId: null,
            exposure: 0,
            reason: 'Distinct charge fingerprint on same shipment — not treated as overbilling',
            exceptionId: null,
          })
        }
        continue
      }

      // Keep first as original (prefer non-flagged), rest as duplicates
      const ordered = [...clones].sort((a, b) => Number(a.is_duplicate) - Number(b.is_duplicate))
      const original = ordered[0]
      for (const dup of ordered.slice(1)) {
        const exc = data.exceptions.find(
          (e) =>
            e.exception_type === 'Duplicate Billing' &&
            (e.billing_line_id === dup.billing_line_id || e.shipment_id === shipmentId),
        )
        const confirmed = dup.is_duplicate
        const classification: DuplicateClass = confirmed ? 'Exact Duplicate' : 'Potential Duplicate'
        if (confirmed) {
          exactCount += 1
          confirmedExposure = money(confirmedExposure + dup.net_amount)
        } else {
          potentialCount += 1
          suspectedExposure = money(suspectedExposure + dup.net_amount)
        }
        assessments.push({
          billingLineId: dup.billing_line_id,
          shipmentId,
          customerId: dup.customer_id,
          classification,
          isFlaggedDuplicate: dup.is_duplicate,
          chargeFingerprint: fp,
          netAmount: dup.net_amount,
          pairedLineId: original.billing_line_id,
          exposure: dup.net_amount,
          reason: confirmed
            ? 'Identical charge fingerprint + is_duplicate flag — confirmed clone of original line'
            : 'Identical charge fingerprint without flag — suspected duplicate',
          exceptionId: exc?.exception_id ?? null,
        })
      }
    }

    // Same shipment, multiple different fingerprints (no clone groups)
    if (fps.size > 1 && [...fps.values()].every((g) => g.length === 1)) {
      // already counted legitimate above
    }
  }

  return {
    assessments: assessments.filter((a) => a.classification !== 'Legitimate Multi-Charge' || a.isFlaggedDuplicate),
    exactCount,
    potentialCount,
    legitimateMultiCount,
    confirmedExposure: sumMoney(
      assessments.filter((a) => a.classification === 'Exact Duplicate').map((a) => a.exposure),
    ),
    suspectedExposure: sumMoney(
      assessments.filter((a) => a.classification === 'Potential Duplicate').map((a) => a.exposure),
    ),
  }
}
