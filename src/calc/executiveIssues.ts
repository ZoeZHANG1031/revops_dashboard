import { formatCurrency, formatPercent } from '@/lib/money'
import type { DataStore, GlobalFilters } from '@/types'
import { rollupExceptionsByRootCause } from './actionRollup'
import type { IssueSeverity } from '@/components/common/IssueCard'
import { computeSharedMetrics } from './metricRegistry'
import { computeVarianceBridge } from './varianceBridge'

export interface TopBusinessIssue {
  id: 'forecast' | 'leakage' | 'ar'
  title: string
  severity: IssueSeverity
  /** null when not computable in current scope */
  financialImpact: number | null
  evidence: string
  suggestedOwner: string
  recommendedAction: string
  impactNote: string
  navigate: {
    path: string
    extras?: {
      exceptionType?: string | null
      exceptionStatus?: string | null
    }
  }
}

/** Three executive issue cards — severity from explicit metric rules, not random. */
export function buildTopBusinessIssues(
  data: DataStore,
  filters: GlobalFilters,
  scenario: 'Base' | 'Upside' | 'Downside' = 'Base',
  precomputed?: ReturnType<typeof computeSharedMetrics>,
): TopBusinessIssue[] {
  const m = precomputed ?? computeSharedMetrics(data, filters, scenario)
  const bridge = computeVarianceBridge(data, filters, scenario, 'total')
  const rollups = rollupExceptionsByRootCause(data, filters)
  const topRollup = rollups[0]
  const residual = bridge.items.find((i) => i.key === 'other')?.amount ?? 0

  const varPct =
    m.forecastExisting === 0
      ? null
      : (m.forecastVarianceExisting / Math.abs(m.forecastExisting)) * 100

  const forecastSeverity: IssueSeverity = !m.forecastComparable
    ? 'unavailable'
    : varPct != null && varPct < -5
      ? 'critical'
      : varPct != null && varPct < 0
        ? 'watch'
        : 'healthy'

  const leakageSeverity: IssueSeverity =
    m.openRecoverableLeakage > m.recognizedRevenue * 0.05
      ? 'critical'
      : m.openRecoverableLeakage > 500
        ? 'watch'
        : 'healthy'

  const arSeverity: IssueSeverity =
    m.overdueAr > 5000 ? 'critical' : m.overdueAr > 0 ? 'watch' : 'healthy'

  const issues: TopBusinessIssue[] = [
    {
      id: 'forecast',
      title: 'Revenue / Forecast Risk',
      severity: forecastSeverity,
      financialImpact: m.forecastComparable ? Math.abs(m.forecastVarianceExisting) : null,
      evidence: m.forecastComparable
        ? `Comparable actual ${formatCurrency(m.comparableActual, true)} vs Existing Forecast ${formatCurrency(m.forecastExisting, true)} (${formatPercent(varPct)}). Unexplained residual ${formatCurrency(residual, true)}.`
        : (m.forecastComparableReason ?? 'Not comparable in current scope'),
      suggestedOwner: 'RevOps',
      recommendedAction: 'Investigate Existing-forecast bridge',
      impactNote: 'Variance vs Existing Customer Forecast — not Total Business Forecast',
      navigate: { path: '/forecasting' },
    },
    {
      id: 'leakage',
      title: 'Billing / Leakage Risk',
      severity: leakageSeverity,
      financialImpact: m.openRecoverableLeakage,
      evidence: topRollup
        ? `Open recoverable ${formatCurrency(m.openRecoverableLeakage, true)}. Top queue: ${topRollup.exceptionType} (${topRollup.cases} cases).`
        : `Open recoverable ${formatCurrency(m.openRecoverableLeakage, true)}.`,
      suggestedOwner: 'Billing',
      recommendedAction: 'Review open recoverable exceptions',
      impactNote: 'Potential recovery pool — not confirmed booked loss',
      navigate: {
        path: '/reconciliation',
        extras: {
          exceptionType: topRollup?.exceptionType ?? null,
          exceptionStatus: 'Open',
        },
      },
    },
    {
      id: 'ar',
      title: 'Collection / AR Risk',
      severity: arSeverity,
      financialImpact: m.overdueAr,
      evidence: `Overdue AR ${formatCurrency(m.overdueAr, true)}. Cash/liquidity exposure only.`,
      suggestedOwner: 'Finance',
      recommendedAction: 'Open overdue AR queue',
      impactNote: 'Collections exposure ≠ recognized revenue loss',
      navigate: {
        path: '/reconciliation',
        extras: { exceptionType: 'Overdue AR', exceptionStatus: 'Open' },
      },
    },
  ]
  const rank: Record<IssueSeverity, number> = { critical: 0, watch: 1, healthy: 2, unavailable: 3 }
  // Critical → Watch → Healthy → Not evaluated; ties by financial impact
  return issues.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (b.financialImpact ?? 0) - (a.financialImpact ?? 0),
  )
}
