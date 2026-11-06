import { formatCurrency, formatPercent } from '@/lib/money'
import type { DataStore, GlobalFilters } from '@/types'
import { computeSharedMetrics, type SharedMetrics } from './metricRegistry'
import { rollupExceptionsByRootCause } from './actionRollup'
import { computeCustomerHealth } from './customerHealth'

export interface ExecutiveInsight {
  headline: string
  signals: string[]
  recommendedActions: string[]
  severity: 'healthy' | 'watch' | 'critical'
}

/** Compact Executive Decision Brief — filter-aware, no hardcoded story. */
export function buildExecutiveInsight(
  data: DataStore,
  filters: GlobalFilters,
  scenario: 'Base' | 'Upside' | 'Downside' = 'Base',
  precomputed?: SharedMetrics,
): ExecutiveInsight {
  const m = precomputed ?? computeSharedMetrics(data, filters, scenario)
  const rollups = rollupExceptionsByRootCause(data, filters)
  const health = computeCustomerHealth(data, filters)
  const atRisk = health.filter((h) => h.healthBand === 'At Risk' || h.healthBand === 'Critical').length

  const varPct =
    m.forecastExisting === 0
      ? null
      : (m.forecastVarianceExisting / Math.abs(m.forecastExisting)) * 100

  const topRollup = rollups[0]

  const signals = [
    `Recognized ${formatCurrency(m.recognizedRevenue, true)} vs Existing Forecast ${formatCurrency(m.forecastExisting, true)} (${formatCurrency(m.forecastVarianceExisting, true)}; ${formatPercent(varPct)})`,
    `CM ${formatPercent(m.contributionMargin)} · Contrib ${formatCurrency(m.contributionProfit, true)} · OP ${formatCurrency(m.operatingProfit, true)} after allocated fixed`,
    `Open recoverable leakage ${formatCurrency(m.openRecoverableLeakage, true)} · Overdue AR ${formatCurrency(m.overdueAr, true)} (cash, not booked loss) · Scenario RaR ${formatCurrency(m.scenarioRevenueAtRisk, true)}`,
  ]

  const recommendedActions: string[] = []
  if (m.openRecoverableLeakage > 500) {
    recommendedActions.push(
      `Billing: clear ${topRollup?.exceptionType ?? 'rating'} queue — open recoverable ~${formatCurrency(m.openRecoverableLeakage, true)}`,
    )
  }
  if (m.overdueAr > 0) {
    recommendedActions.push(
      `Finance: collect overdue AR ${formatCurrency(m.overdueAr, true)} — liquidity, not revenue loss`,
    )
  }
  if (atRisk > 0) {
    recommendedActions.push(`Sales: retention QBRs for ${atRisk} At-Risk/Critical accounts (scenario RaR)`)
  }
  if (m.forecastVarianceExisting < 0) {
    recommendedActions.push('RevOps: own Existing-forecast bridge (volume/price/mix/credits)')
  }
  if (recommendedActions.length === 0) {
    recommendedActions.push('Maintain run-rate; monitor bridge and root-cause queues weekly')
  }

  let severity: ExecutiveInsight['severity'] = 'healthy'
  if (
    (varPct != null && varPct < -5) ||
    atRisk >= 3 ||
    m.scenarioRevenueAtRisk > m.recognizedRevenue * 0.15 ||
    m.openRecoverableLeakage > m.recognizedRevenue * 0.05
  ) {
    severity = 'critical'
  } else if (
    (varPct != null && varPct < 0) ||
    m.openRecoverableLeakage > 0 ||
    atRisk >= 1 ||
    (m.contributionMargin ?? 100) < 25 ||
    m.overdueAr > 0
  ) {
    severity = 'watch'
  }

  const headline =
    m.forecastVarianceExisting >= 0 && m.openRecoverableLeakage > 0
      ? 'Actual revenue is ahead of Existing Customer Forecast, but leakage and receivables still need action.'
      : m.forecastVarianceExisting < 0
        ? 'Actual revenue is behind Existing Customer Forecast — prioritize variance owners and recovery queues.'
        : severity === 'healthy'
          ? 'Revenue trajectory is on track versus Existing forecast with contained open exposures.'
          : 'Mixed signals — protect margin, close recoverable gaps, and watch at-risk accounts.'

  return {
    headline,
    signals: signals.slice(0, 3),
    recommendedActions: recommendedActions.slice(0, 3),
    severity,
  }
}
