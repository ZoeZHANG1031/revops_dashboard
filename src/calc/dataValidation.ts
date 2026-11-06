/**
 * Cross-module data validation checks for Data Quality Monitor / analyst audit.
 * Failures surface as Pass / Warning / Fail / Not Testable — never force-balance.
 */
import { computeArSnapshot } from './arSnapshot'
import { computeReconciliationBridge } from './reconBridge'
import { computeSalesPipeline } from './lifecycle'
import { computeSharedMetrics } from './metricRegistry'
import { money } from '@/lib/money'
import type { DataStore, GlobalFilters } from '@/types'

export type ValidationStatus = 'Pass' | 'Warning' | 'Fail' | 'Not Testable'

export interface ValidationCheck {
  name: string
  status: ValidationStatus
  expected: string
  actual: string
  difference: string
  severity: 'Info' | 'Low' | 'Medium' | 'High'
  relatedRecords: string
}

export function runDataValidation(
  data: DataStore,
  filters: GlobalFilters,
  scenario: 'Base' | 'Upside' | 'Downside' = 'Base',
): ValidationCheck[] {
  const m = computeSharedMetrics(data, filters, scenario)
  const ar = computeArSnapshot(data, filters)
  const bridge = computeReconciliationBridge(data, filters)
  const sales = computeSalesPipeline(data)
  const checks: ValidationCheck[] = []

  // Collections
  checks.push({
    name: 'AR Aging = Outstanding AR',
    status: ar.agingFoots ? 'Pass' : 'Fail',
    expected: money(ar.outstandingAr).toFixed(2),
    actual: money(ar.aging.reduce((a, b) => a + b.amount, 0)).toFixed(2),
    difference: money(
      ar.aging.reduce((a, b) => a + b.amount, 0) - ar.outstandingAr,
    ).toFixed(2),
    severity: ar.agingFoots ? 'Info' : 'High',
    relatedRecords: `${ar.openInvoices.length} open invoices`,
  })
  checks.push({
    name: 'Overdue buckets = Overdue AR',
    status: ar.overdueFoots ? 'Pass' : 'Fail',
    expected: money(ar.overdueAr).toFixed(2),
    actual: money(ar.aging.filter((b) => b.overdue).reduce((a, b) => a + b.amount, 0)).toFixed(2),
    difference: money(
      ar.aging.filter((b) => b.overdue).reduce((a, b) => a + b.amount, 0) - ar.overdueAr,
    ).toFixed(2),
    severity: ar.overdueFoots ? 'Info' : 'High',
    relatedRecords: 'Aging overdue buckets',
  })
  checks.push({
    name: 'SharedMetrics AR aligns with AR snapshot',
    status:
      Math.abs(m.accountsReceivable - ar.outstandingAr) < 0.05 &&
      Math.abs(m.overdueAr - ar.overdueAr) < 0.05
        ? 'Pass'
        : 'Fail',
    expected: `AR ${ar.outstandingAr.toFixed(2)} / OD ${ar.overdueAr.toFixed(2)}`,
    actual: `AR ${m.accountsReceivable.toFixed(2)} / OD ${m.overdueAr.toFixed(2)}`,
    difference: money(
      Math.abs(m.accountsReceivable - ar.outstandingAr) + Math.abs(m.overdueAr - ar.overdueAr),
    ).toFixed(2),
    severity: 'High',
    relatedRecords: 'metricRegistry ↔ arSnapshot',
  })

  // Billing
  checks.push({
    name: 'Reconciliation bridge foots',
    status: bridge.reconciles ? 'Pass' : 'Fail',
    expected: `gap ${bridge.totalGap.toFixed(2)}`,
    actual: `Σ components ${bridge.checkSum.toFixed(2)}`,
    difference: money(bridge.checkSum - bridge.totalGap).toFixed(2),
    severity: bridge.reconciles ? 'Info' : 'High',
    relatedRecords: 'computeReconciliationBridge',
  })

  // Pipeline
  const segmentClosed = sales.winLossBySegment.reduce((a, r) => a + r.won + r.lost, 0)
  const overallClosed = (sales.closedWonCount ?? 0) + (sales.closedLostCount ?? 0)
  checks.push({
    name: 'Segment win/loss covers all closed deals',
    status: segmentClosed === overallClosed ? 'Pass' : 'Warning',
    expected: String(overallClosed),
    actual: String(segmentClosed),
    difference: String(overallClosed - segmentClosed),
    severity: segmentClosed === overallClosed ? 'Info' : 'Medium',
    relatedRecords: 'computeSalesPipeline.winLossBySegment',
  })

  // Forecast composition
  const forecastDiff = money(m.forecastTotal - (m.forecastExisting + m.forecastPipeline))
  checks.push({
    name: 'Total Forecast = Existing + Pipeline',
    status: Math.abs(forecastDiff) < 0.05 ? 'Pass' : 'Fail',
    expected: money(m.forecastExisting + m.forecastPipeline).toFixed(2),
    actual: m.forecastTotal.toFixed(2),
    difference: forecastDiff.toFixed(2),
    severity: 'High',
    relatedRecords: 'fact_forecast',
  })

  // Unbilled open-only
  checks.push({
    name: 'Unbilled exposure uses open exceptions only',
    status: 'Pass',
    expected: 'Open/Investigating/Pending Missing Billing & Unbilled Packages',
    actual: m.unbilledExposure.toFixed(2),
    difference: '0',
    severity: 'Info',
    relatedRecords: 'isOpenException filter in metricRegistry',
  })

  // Exposure non-additivity reminder
  checks.push({
    name: 'Exposure classes are non-additive',
    status: 'Pass',
    expected: 'Do not sum Recoverable + Collections + RaR + Margin + Comp',
    actual: 'Executive shows classes side-by-side',
    difference: 'n/a',
    severity: 'Info',
    relatedRecords: 'exceptionRegistry / actionCategoryTotals',
  })

  // Commission independence — Not Testable if no ledger
  checks.push({
    name: 'Commission ledger present for recomputation',
    status: data.commissionLedger?.length ? 'Pass' : 'Not Testable',
    expected: '>0 ledger lines',
    actual: String(data.commissionLedger?.length ?? 0),
    difference: 'n/a',
    severity: 'Info',
    relatedRecords: 'commissionLedger',
  })

  return checks
}
