import { money, sumMoney } from '@/lib/money'
import { filterBillingLinesIncludingDuplicates } from '@/lib/filters'
import type { DataStore, GlobalFilters } from '@/types'
import { computeBillingIntegrity } from './billingIntegrity'
import { computeSharedMetrics } from './metricRegistry'

export interface ReconBridgeItem {
  key: string
  label: string
  amount: number
  note: string
}

/**
 * Expected Charges (gross, ship-date basis) → signed components → Actual Net Billing (billing period).
 * Components are built lot by lot (see billingIntegrity), so the bridge closes exactly; any
 * remaining difference is shown as "Other / Unexplained" and never forced to zero.
 */
export function computeReconciliationBridge(data: DataStore, filters: GlobalFilters) {
  const m = computeSharedMetrics(data, filters)
  const bi = computeBillingIntegrity(data, filters)
  const expected = m.expectedCharges
  const actual = m.netBilledRevenue
  const totalGap = money(actual - expected)
  const duplicates = sumMoney(
    filterBillingLinesIncludingDuplicates(data, filters)
      .filter((b) => b.is_duplicate)
      .map((b) => b.net_amount),
  )
  const timing = money(bi.timingOut + bi.timingIn)

  const items: ReconBridgeItem[] = [
    { key: 'expected', label: 'Expected Charges', amount: expected, note: 'Billable lots shipped in window, re-rated at the effective rate card (gross, before discount)' },
    { key: 'discounts', label: 'Valid Contractual Discounts', amount: bi.discounts, note: 'Volume-tier discounts per contract' },
    { key: 'credits', label: 'Approved Credits', amount: bi.credits, note: 'SLA / failed-attempt / goodwill credits on billing lines' },
    {
      key: 'timing',
      label: 'Timing Differences',
      amount: timing,
      note: `Billed after window ${money(bi.timingOut)} · billed in window for earlier shipments +${money(bi.timingIn)} (ship date vs billing period)`,
    },
    { key: 'missing', label: 'Missing Billing', amount: bi.missingBilling, note: 'Billable lots with no billing line — potential leakage (unconfirmed)' },
    { key: 'rate', label: 'Rate Card Mismatch', amount: bi.rateMismatch, note: 'Billed below the effective rate-card version' },
    { key: 'surcharge', label: 'Missing Surcharges', amount: bi.missingSurcharge, note: 'Fuel surcharge omitted in rating' },
    {
      key: 'duplicate',
      label: 'Duplicate Billing (excluded from net)',
      amount: 0,
      note: `${money(duplicates)} of duplicate lines exist but are excluded from Net Billing — refund risk, not recoverable revenue`,
    },
    { key: 'unresolved', label: 'Other / Unexplained', amount: bi.residual, note: 'Residual after known categories — investigate; not forced to zero' },
    { key: 'actual', label: 'Actual Net Charges', amount: actual, note: 'Non-duplicate billing lines in billing period' },
  ]

  const checkSum = money(items.filter((i) => i.key !== 'expected' && i.key !== 'actual').reduce((a, i) => a + i.amount, 0))

  return {
    expected,
    actual,
    totalGap,
    items,
    checkSum,
    reconciles: Math.abs(checkSum - totalGap) < 0.05,
    openLeakage: money(-(bi.missingBilling + bi.rateMismatch + bi.missingSurcharge)),
  }
}
