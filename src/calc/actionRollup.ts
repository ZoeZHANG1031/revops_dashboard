import { filterExceptions } from '@/lib/filters'
import { money, sumMoney } from '@/lib/money'
import type { DataStore, FactException, GlobalFilters, ResponsibleTeam } from '@/types'

export interface RootCauseRollup {
  rootCauseKey: string
  rootCause: string
  exceptionType: string
  cases: number
  openExposure: number
  recoverable: number
  severity: string
  owner: ResponsibleTeam
  action: string
  avgAgeDays: number
  recoverability: string
  priorityScore: number
  exceptions: FactException[]
}

const RECOVERABLE = new Set(['Missing Billing', 'Rate Mismatch', 'Missing Surcharge', 'Unbilled Packages'])

function severityRank(s: string): number {
  if (s === 'Critical') return 4
  if (s === 'High') return 3
  if (s === 'Medium') return 2
  return 1
}

export function rollupExceptionsByRootCause(
  data: DataStore,
  filters: GlobalFilters,
  asOf = '2025-11-01',
): RootCauseRollup[] {
  const exceptions = filterExceptions(data, filters)
  const map = new Map<string, FactException[]>()

  exceptions.forEach((e) => {
    const key = e.exception_type
    const list = map.get(key) ?? []
    list.push(e)
    map.set(key, list)
  })

  const rows: RootCauseRollup[] = []
  map.forEach((list, exceptionType) => {
    const open = list.filter(
      (e) =>
        e.status === 'Open' || e.status === 'Investigating' || e.status === 'Pending Approval',
    )
    const openExposure = sumMoney(open.map((e) => e.financial_impact))
    const recoverable = RECOVERABLE.has(exceptionType)
      ? sumMoney(open.map((e) => e.financial_impact))
      : exceptionType === 'Duplicate Billing'
        ? 0
        : exceptionType === 'Overdue AR'
          ? 0
          : 0

    const ages = open.map((e) => {
      const a = new Date(asOf).getTime()
      const b = new Date(e.detected_date).getTime()
      return Math.max(0, Math.round((a - b) / 86400000))
    })
    const avgAgeDays = ages.length ? Math.round(ages.reduce((x, y) => x + y, 0) / ages.length) : 0

    const topSev = [...list].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0]
    const owner = topSev?.owner ?? 'Billing'
    const action =
      exceptionType === 'Missing Billing'
        ? '补开计费 / Create billing lines from rate card'
        : exceptionType === 'Rate Mismatch'
          ? '核对合同 / Re-price with effective rate card'
          : exceptionType === 'Missing Surcharge'
            ? '修正费用 / Re-rate surcharges'
            : exceptionType === 'Overdue AR'
              ? '催收 / Collections outreach'
              : exceptionType === 'Duplicate Billing'
                ? 'Void duplicate & credit customer'
                : topSev?.recommended_action ?? 'Investigate'

    const recoverability = RECOVERABLE.has(exceptionType)
      ? 'High — rating defect'
      : exceptionType === 'Overdue AR'
        ? 'Collections — not revenue recovery'
        : exceptionType === 'Duplicate Billing'
          ? 'Refund/overcharge risk — not recoverable revenue'
          : exceptionType === 'Timing Difference'
            ? 'N/A — accounting cut-off'
            : 'Investigate'

    // Priority: actionability × open exposure × severity × age
    const actionability = RECOVERABLE.has(exceptionType) ? 3 : exceptionType === 'Overdue AR' ? 2 : 1
    const priorityScore = money(
      actionability * openExposure * (1 + severityRank(topSev?.severity ?? 'Low') * 0.25) * (1 + avgAgeDays / 60),
    )

    rows.push({
      rootCauseKey: exceptionType,
      rootCause: topSev?.root_cause ?? exceptionType,
      exceptionType,
      cases: list.length,
      openExposure,
      recoverable,
      severity: topSev?.severity ?? 'Low',
      owner,
      action,
      avgAgeDays,
      recoverability,
      priorityScore,
      exceptions: list,
    })
  })

  return rows.sort((a, b) => b.priorityScore - a.priorityScore)
}
