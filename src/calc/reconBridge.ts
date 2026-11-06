import { money, sumMoney } from '@/lib/money'
import { filterBillingLinesIncludingDuplicates } from '@/lib/filters'
import type { DataStore, GlobalFilters } from '@/types'
import { computeBillingIntegrity } from './billingIntegrity'
import { computeSharedMetrics } from './metricRegistry'

/** Bridge difference taxonomy — do not treat all gaps as leakage */
export type ReconDiffClass =
  | 'Baseline'
  | 'Valid Commercial Adjustments'
  | 'Timing Differences'
  | 'Recoverable Billing Exceptions'
  | 'Unexplained Residual'
  | 'Informational'

export interface ReconBridgeItem {
  key: string
  label: string
  amount: number
  note: string
  diffClass: ReconDiffClass
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
    {
      key: 'expected',
      label: 'Expected Charges',
      amount: expected,
      note: 'Billable lots shipped in window, re-rated at the effective rate card (gross, before discount)',
      diffClass: 'Baseline',
    },
    {
      key: 'discounts',
      label: 'Valid Contractual Discounts',
      amount: bi.discounts,
      note: 'Volume-tier discounts per contract — NOT revenue leakage',
      diffClass: 'Valid Commercial Adjustments',
    },
    {
      key: 'credits',
      label: 'Approved Credits',
      amount: bi.credits,
      note: 'SLA / failed-attempt / goodwill credits — commercial adjustment unless disputed',
      diffClass: 'Valid Commercial Adjustments',
    },
    {
      key: 'timing',
      label: 'Timing Differences',
      amount: timing,
      note: `Billed after window ${money(bi.timingOut)} · billed in window for earlier shipments +${money(bi.timingIn)} (ship date vs billing period) — not permanent loss`,
      diffClass: 'Timing Differences',
    },
    {
      key: 'missing',
      label: 'Missing Billing',
      amount: bi.missingBilling,
      note: 'Billable lots with no billing line — Recoverable Exposure (unconfirmed)',
      diffClass: 'Recoverable Billing Exceptions',
    },
    {
      key: 'rate',
      label: 'Rate Card Mismatch',
      amount: bi.rateMismatch,
      note: 'Billed below the effective rate-card version — Recoverable Exposure (unconfirmed)',
      diffClass: 'Recoverable Billing Exceptions',
    },
    {
      key: 'surcharge',
      label: 'Missing Surcharges',
      amount: bi.missingSurcharge,
      note: 'Fuel surcharge omitted in rating — Recoverable Exposure (unconfirmed)',
      diffClass: 'Recoverable Billing Exceptions',
    },
    {
      key: 'duplicate',
      label: 'Duplicate Billing (excluded from net)',
      amount: 0,
      note: `${money(duplicates)} of duplicate lines exist but are excluded from Net Billing — Billing Correction / refund risk, not recoverable revenue`,
      diffClass: 'Informational',
    },
    {
      key: 'unresolved',
      label: 'Other / Unexplained',
      amount: bi.residual,
      note: 'Residual after known categories — investigate; never force-filled to zero',
      diffClass: 'Unexplained Residual',
    },
    {
      key: 'actual',
      label: 'Actual Net Charges',
      amount: actual,
      note: 'Non-duplicate billing lines in billing period',
      diffClass: 'Baseline',
    },
  ]

  const checkSum = money(
    items.filter((i) => i.key !== 'expected' && i.key !== 'actual').reduce((a, i) => a + i.amount, 0),
  )
  const classTotals = {
    validCommercial: sumMoney(
      items.filter((i) => i.diffClass === 'Valid Commercial Adjustments').map((i) => i.amount),
    ),
    timing: sumMoney(items.filter((i) => i.diffClass === 'Timing Differences').map((i) => i.amount)),
    recoverable: sumMoney(
      items.filter((i) => i.diffClass === 'Recoverable Billing Exceptions').map((i) => i.amount),
    ),
    unexplained: sumMoney(
      items.filter((i) => i.diffClass === 'Unexplained Residual').map((i) => i.amount),
    ),
  }

  return {
    expected,
    actual,
    totalGap,
    gapPctOfExpected: expected !== 0 ? money((totalGap / Math.abs(expected)) * 100) : null,
    items,
    checkSum,
    classTotals,
    /** Expected + signed adjustments + residual = Actual (within tolerance) */
    reconciles: Math.abs(checkSum - totalGap) < 0.05,
    openLeakage: money(-(bi.missingBilling + bi.rateMismatch + bi.missingSurcharge)),
  }
}
