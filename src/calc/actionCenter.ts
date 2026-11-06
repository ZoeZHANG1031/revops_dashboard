import { filterExceptions } from '@/lib/filters'
import { money, sumMoney } from '@/lib/money'
import type { DataStore, FactException, GlobalFilters } from '@/types'
import { EXCEPTION_REGISTRY, isOpenException, type ExposureClass } from './exceptionRegistry'
import { computeCustomerHealth } from './customerHealth'
import { filterCommissionAudits } from './salesCompensation'
import { computeUnitEconomics } from './unitEconomics'

/** Exposure classes from the Exception Registry — never summed into one "revenue loss" */
export type ActionCategory = ExposureClass

export interface ActionItem {
  id: string
  category: ActionCategory
  title: string
  financialImpact: number
  /** true = recoverable / collectible; false = at-risk or margin; never treat overdue as lost revenue */
  isBookedLoss: boolean
  severity: string
  owner: string
  status: string
  rootCause: string
  recommendedAction: string
  customerId: string | null
  /** 1–3: open/investigating & owner-actionable = 3 */
  actionability: number
  /** 1–3 from severity (Critical/High = 3, Medium = 2, Low = 1) */
  urgency?: number
  /** Evidence strength: rule-engine exception with expected/actual = High; trend signal = Medium; derived / scenario = Low */
  confidence?: 'High' | 'Medium' | 'Low'
  /** 1–3 impact tertile within the current list */
  impactScore?: number
  /** urgency + confidence + actionability + impactScore (4–12) */
  priorityScore?: number
  sourceException?: FactException
}

export const ACTION_PRIORITY_RULE =
  'Priority = Impact tertile (1–3) + Urgency from severity (1–3) + Confidence of evidence (1–3) + Actionability (1–3); ties by $ impact.'

const CONFIDENCE_SCORE = { High: 3, Medium: 2, Low: 1 } as const

function urgencyFromSeverity(sev: string): number {
  if (sev === 'Critical' || sev === 'High') return 3
  if (sev === 'Medium') return 2
  return 1
}

function confidenceFor(item: ActionItem): 'High' | 'Medium' | 'Low' {
  if (item.category === 'Compensation Audit') return 'High' // ledger ↔ payment trace
  if (!item.sourceException) return 'Low' // derived (unit-economics paradox) or health-score scenario
  if (
    item.category === 'Recoverable Billing Exposure' ||
    item.category === 'Billing Correction' ||
    item.category === 'Collections Exposure'
  )
    return 'High'
  return 'Medium'
}

/** Exposure classes that produce actions (timing/adjustment and data quality are handled in Reconciliation) */
const ACTION_CLASSES = new Set<ExposureClass>([
  'Recoverable Billing Exposure',
  'Billing Correction',
  'Collections Exposure',
  'Customer Revenue Risk',
  'Margin Pressure',
])

export function buildActionCenter(data: DataStore, filters: GlobalFilters): ActionItem[] {
  const items: ActionItem[] = []
  const exceptions = filterExceptions(data, filters)

  exceptions.forEach((e) => {
    const def = EXCEPTION_REGISTRY[e.exception_type]
    // Only open / investigating / pending items need action — keeps exposure totals equal to Reconciliation
    if (!def || !ACTION_CLASSES.has(def.exposureClass) || !isOpenException(e)) return
    const cls = def.exposureClass
    items.push({
      id: e.exception_id,
      category: cls,
      title: cls === 'Collections Exposure' ? `Overdue invoice ${e.invoice_id ?? ''}`.trim() : e.exception_type,
      financialImpact: e.financial_impact,
      isBookedLoss: false,
      severity: e.severity,
      owner: e.owner,
      status: e.status,
      rootCause:
        cls === 'Collections Exposure'
          ? `${e.root_cause} — AR aging is a cash/liquidity issue, not a reduction to recognized revenue.`
          : e.root_cause,
      recommendedAction: e.recommended_action,
      customerId: e.customer_id,
      actionability: def.recoverable ? 3 : 2,
      sourceException: e,
    })
  })

  // Derived margin deterioration from unit economics (early→late)
  const econ = computeUnitEconomics(data, filters)
  if (
    econ.volumeProfitParadox.volumeChangePct != null &&
    econ.volumeProfitParadox.contributionProfitChangePct != null &&
    econ.volumeProfitParadox.volumeChangePct > 0 &&
    econ.volumeProfitParadox.contributionProfitChangePct < 0
  ) {
    items.push({
      id: 'DERIVED-MARGIN-PARADOX',
      category: 'Margin Pressure',
      title: 'Volume up / contribution down',
      financialImpact: money(
        Math.abs(
          (econ.contributionProfit * econ.volumeProfitParadox.contributionProfitChangePct) / 100,
        ),
      ),
      isBookedLoss: false,
      severity: 'High',
      owner: 'Pricing',
      status: 'Open',
      rootCause: econ.volumeProfitParadox.explanation.join(' '),
      recommendedAction: 'Review zone mix, DSP rates, and low-margin customer growth.',
      customerId: null,
      actionability: 3,
    })
  }

  // Health-driven RaR not already covered
  const health = computeCustomerHealth(data, filters)
  health
    .filter((h) => h.healthScore < 45)
    .slice(0, 5)
    .forEach((h) => {
      if (items.some((i) => i.customerId === h.customerId && i.category === 'Customer Revenue Risk')) return
      items.push({
        id: `RAR-${h.customerId}`,
        category: 'Customer Revenue Risk',
        title: `${h.customerName} health ${h.healthScore}`,
        financialImpact: h.revenueAtRisk,
        isBookedLoss: false,
        severity: h.healthScore < 40 ? 'Critical' : 'High',
        owner: 'Sales',
        status: 'Open',
        rootCause: `Assumed loss ${Math.round(h.assumedLossProbability * 100)}% × expected future revenue (scenario — not churn model). Drivers: ${h.drivers.join(', ') || 'composite'}`,
        recommendedAction: h.recommendedActions[0] ?? 'Retention outreach',
        customerId: h.customerId,
        actionability: 2,
      })
    })

  // Commission audit exceptions — investigation items; financial_impact ≠ booked loss
  filterCommissionAudits(data, filters)
    .filter((a) => a.status === 'Open' || a.status === 'Investigating')
    .forEach((a) => {
      items.push({
        id: a.audit_id,
        category: 'Compensation Audit',
        title: a.audit_type,
        financialImpact: a.financial_impact,
        isBookedLoss: false,
        severity: Math.abs(a.difference) > 5_000 ? 'High' : 'Medium',
        owner: a.suggested_owner,
        status: a.status,
        rootCause: `${a.root_cause} · Expected ${a.expected_amount} vs Actual ${a.actual_amount} (not confirmed P&L loss).`,
        recommendedAction: a.recommended_action,
        customerId: a.customer_id,
        actionability: 3,
        confidence: 'High',
      })
    })

  const impacts = items.map((i) => i.financialImpact).sort((a, b) => a - b)
  const q = (p: number) => impacts[Math.min(impacts.length - 1, Math.floor(p * impacts.length))] ?? 0
  const t1 = q(1 / 3)
  const t2 = q(2 / 3)
  items.forEach((i) => {
    i.urgency = urgencyFromSeverity(i.severity)
    i.confidence = confidenceFor(i)
    i.impactScore = i.financialImpact >= t2 ? 3 : i.financialImpact >= t1 ? 2 : 1
    i.priorityScore = i.impactScore + i.urgency + CONFIDENCE_SCORE[i.confidence] + i.actionability
  })

  return items.sort(
    (a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0) || b.financialImpact - a.financialImpact,
  )
}

export interface ActionGroup {
  key: string
  category: ActionCategory
  rootCause: string
  items: ActionItem[]
  cases: number
  impact: number
  urgency: number
  confidence: 'High' | 'Medium' | 'Low'
  priorityScore: number
  owner: string
  recommendedAction: string
}

/** Aggregate actions by exposure class × root-cause type (default Executive view) */
export function groupActionsByRootCause(items: ActionItem[]): ActionGroup[] {
  const map = new Map<string, ActionItem[]>()
  for (const i of items) {
    const rc = i.sourceException?.exception_type ?? i.title
    const key = `${i.category}|${i.category === 'Customer Revenue Risk' && !i.sourceException ? 'Low health score' : rc}`
    const list = map.get(key) ?? []
    list.push(i)
    map.set(key, list)
  }
  const confRank = { High: 3, Medium: 2, Low: 1 } as const
  return [...map.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
      const owners = new Map<string, number>()
      list.forEach((i) => owners.set(i.owner, (owners.get(i.owner) ?? 0) + i.financialImpact))
      const owner = [...owners.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
      const minConf = list.reduce<'High' | 'Medium' | 'Low'>(
        (acc, i) => (confRank[i.confidence ?? 'Low'] < confRank[acc] ? (i.confidence ?? 'Low') : acc),
        'High',
      )
      return {
        key,
        category: list[0].category,
        rootCause: key.split('|')[1],
        items: sorted,
        cases: list.length,
        impact: sumMoney(list.map((i) => i.financialImpact)),
        urgency: Math.max(...list.map((i) => i.urgency ?? 1)),
        confidence: minConf,
        priorityScore: Math.max(...list.map((i) => i.priorityScore ?? 0)),
        owner,
        recommendedAction: sorted[0]?.recommendedAction ?? '—',
      }
    })
    .sort((a, b) => b.priorityScore - a.priorityScore || b.impact - a.impact)
}

/** Totals per exposure class — shown side by side, never added together */
export function actionCategoryTotals(items: ActionItem[]) {
  const cats: ActionCategory[] = [
    'Recoverable Billing Exposure',
    'Collections Exposure',
    'Customer Revenue Risk',
    'Billing Correction',
    'Margin Pressure',
    'Compensation Audit',
  ]
  return cats.map((category) => ({
    category,
    count: items.filter((i) => i.category === category).length,
    impact: sumMoney(items.filter((i) => i.category === category).map((i) => i.financialImpact)),
  }))
}
