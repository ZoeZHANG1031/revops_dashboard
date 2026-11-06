import { filterBillingLines, filterExceptions, filterShipments } from '@/lib/filters'
import { money, sumMoney } from '@/lib/money'
import type { DataStore, GlobalFilters } from '@/types'
import { computeSharedMetrics } from './metricRegistry'

export interface ReconBridgeItem {
  key: string
  label: string
  amount: number
  note: string
}

/**
 * Decompose Actual Net Charges − Expected Charges into signed components that sum to the gap.
 * Positive amount increases Actual relative to Expected (or reduces the shortfall).
 */
export function computeReconciliationBridge(data: DataStore, filters: GlobalFilters) {
  const m = computeSharedMetrics(data, filters)
  const expected = m.expectedCharges
  const actual = m.netBilledRevenue
  const totalGap = money(actual - expected)

  const lines = filterBillingLines(data, filters)
  const discounts = sumMoney(lines.map((l) => l.discounts))
  const credits = sumMoney(lines.map((l) => l.credits))

  const exceptions = filterExceptions(data, filters)
  const missingBilling = sumMoney(
    exceptions.filter((e) => e.exception_type === 'Missing Billing').map((e) => e.expected_amount),
  )
  const rateMismatch = sumMoney(
    exceptions
      .filter((e) => e.exception_type === 'Rate Mismatch')
      .map((e) => e.difference), // expected − actual base (positive = underbilled)
  )
  const missingSurcharge = sumMoney(
    exceptions.filter((e) => e.exception_type === 'Missing Surcharge').map((e) => e.expected_amount),
  )
  const duplicates = sumMoney(
    data.billingLines
      .filter((b) => {
        if (!b.is_duplicate) return false
        return (
          b.accounting_period >= filters.startPeriod &&
          b.accounting_period <= filters.endPeriod &&
          (filters.customerIds.length === 0 || filters.customerIds.includes(b.customer_id))
        )
      })
      .map((b) => b.net_amount),
  )

  // Timing: billable in period but billed in adjacent period (approx via ship period vs billing period)
  const shipments = filterShipments(data, filters).filter((s) => s.billable)
  let timing = 0
  shipments.forEach((s) => {
    const line = data.billingLines.find((b) => b.shipment_id === s.shipment_id && !b.is_duplicate)
    if (!line) return
    if (line.accounting_period !== s.ship_date.slice(0, 7)) {
      // if billed outside filter but shipped inside, expected includes it but actual may not (or vice versa)
      if (
        line.accounting_period < filters.startPeriod ||
        line.accounting_period > filters.endPeriod
      ) {
        timing += line.net_amount
      }
    }
  })
  timing = money(timing)

  // Signed impacts toward explaining Actual − Expected:
  // Starting at Expected, apply effects to reach Actual.
  // Discounts/credits reduce actual vs gross expected → negative
  // Missing billing means expected includes charge not in actual → negative
  // Rate mismatch underbill → negative
  // Missing surcharge → negative
  // Duplicates are excluded from actual KPI but if present inflate billing engine — not in actual net; note as separate investigated item (0 impact on this KPI gap)
  // Timing: expected in period, billed outside → negative for this period's actual

  const discountsImpact = money(-discounts)
  const creditsImpact = money(-credits)
  const missingImpact = money(-missingBilling)
  const rateImpact = money(-Math.max(0, rateMismatch))
  const surchargeImpact = money(-missingSurcharge)
  const timingImpact = money(-timing)
  const duplicateNote = money(0) // excluded from net actual by design

  const explained = money(
    discountsImpact +
      creditsImpact +
      missingImpact +
      rateImpact +
      surchargeImpact +
      timingImpact +
      duplicateNote,
  )
  const unresolved = money(totalGap - explained)

  const items: ReconBridgeItem[] = [
    { key: 'expected', label: 'Expected Charges', amount: expected, note: 'Rate-card theoretical for billable shipments' },
    {
      key: 'discounts',
      label: 'Valid Contractual Discounts',
      amount: discountsImpact,
      note: 'Volume-tier / contractual discounts on billed lines',
    },
    {
      key: 'credits',
      label: 'Approved Credits',
      amount: creditsImpact,
      note: 'Service credits on billing lines (not claims expense)',
    },
    {
      key: 'timing',
      label: 'Timing Differences',
      amount: timingImpact,
      note: 'Ship period vs billing period cut-off',
    },
    {
      key: 'missing',
      label: 'Missing Billing',
      amount: missingImpact,
      note: 'Billable shipments with no billing line (potential leakage)',
    },
    {
      key: 'rate',
      label: 'Rate Card Mismatch',
      amount: rateImpact,
      note: 'Underbill vs effective rate card',
    },
    {
      key: 'surcharge',
      label: 'Missing Surcharges',
      amount: surchargeImpact,
      note: 'Fuel/remote omitted in rating',
    },
    {
      key: 'duplicate',
      label: 'Duplicate Billing (excluded from net)',
      amount: duplicateNote,
      note: `Gross duplicate lines ${duplicates} exist but are excluded from Net Billings KPI — customer overcharge / refund risk, not recoverable revenue`,
    },
    {
      key: 'unresolved',
      label: 'Unresolved / Other Investigated',
      amount: unresolved,
      note: 'Residual after known categories — do not hide; investigate',
    },
    { key: 'actual', label: 'Actual Net Charges', amount: actual, note: 'Non-duplicate billing net' },
  ]

  const checkSum = money(
    discountsImpact +
      creditsImpact +
      timingImpact +
      missingImpact +
      rateImpact +
      surchargeImpact +
      duplicateNote +
      unresolved,
  )

  return {
    expected,
    actual,
    totalGap,
    items,
    checkSum,
    reconciles: Math.abs(checkSum - totalGap) < 0.05,
    openLeakage: money(missingBilling + Math.max(0, rateMismatch) + missingSurcharge),
  }
}
