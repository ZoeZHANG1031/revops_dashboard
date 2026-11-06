import { filterExceptions } from '@/lib/filters'
import { money, sumMoney } from '@/lib/money'
import type { DataStore, FactException, GlobalFilters } from '@/types'
import { computeCustomerHealth } from './customerHealth'
import { computeUnitEconomics } from './unitEconomics'

export type ActionCategory =
  | 'Potential Revenue Recovery'
  | 'Revenue at Risk'
  | 'Overdue Receivables'
  | 'Margin Deterioration'

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
  actionability: number
  sourceException?: FactException
}

const RECOVERY_TYPES = new Set([
  'Missing Billing',
  'Duplicate Billing',
  'Rate Mismatch',
  'Missing Surcharge',
  'Unbilled Packages',
])

export function buildActionCenter(data: DataStore, filters: GlobalFilters): ActionItem[] {
  const items: ActionItem[] = []
  const exceptions = filterExceptions(data, filters)

  exceptions.forEach((e) => {
    if (RECOVERY_TYPES.has(e.exception_type)) {
      items.push({
        id: e.exception_id,
        category: 'Potential Revenue Recovery',
        title: e.exception_type,
        financialImpact: e.financial_impact,
        isBookedLoss: false,
        severity: e.severity,
        owner: e.owner,
        status: e.status,
        rootCause: e.root_cause,
        recommendedAction: e.recommended_action,
        customerId: e.customer_id,
        actionability: e.status === 'Open' || e.status === 'Investigating' ? 3 : 1,
        sourceException: e,
      })
    } else if (e.exception_type === 'Overdue AR') {
      items.push({
        id: e.exception_id,
        category: 'Overdue Receivables',
        title: `Overdue invoice ${e.invoice_id ?? ''}`.trim(),
        financialImpact: e.financial_impact,
        isBookedLoss: false,
        severity: e.severity,
        owner: e.owner,
        status: e.status,
        rootCause: `${e.root_cause} — AR aging is a cash/liquidity issue, not a reduction to recognized revenue.`,
        recommendedAction: e.recommended_action,
        customerId: e.customer_id,
        actionability: 2,
        sourceException: e,
      })
    } else if (
      e.exception_type === 'High Risk Customer' ||
      e.exception_type === 'Volume Decline'
    ) {
      items.push({
        id: e.exception_id,
        category: 'Revenue at Risk',
        title: e.exception_type,
        financialImpact: e.financial_impact,
        isBookedLoss: false,
        severity: e.severity,
        owner: e.owner,
        status: e.status,
        rootCause: e.root_cause,
        recommendedAction: e.recommended_action,
        customerId: e.customer_id,
        actionability: 2,
        sourceException: e,
      })
    } else if (e.exception_type === 'Margin Decline') {
      items.push({
        id: e.exception_id,
        category: 'Margin Deterioration',
        title: e.exception_type,
        financialImpact: e.financial_impact,
        isBookedLoss: false,
        severity: e.severity,
        owner: e.owner,
        status: e.status,
        rootCause: e.root_cause,
        recommendedAction: e.recommended_action,
        customerId: e.customer_id,
        actionability: 2,
        sourceException: e,
      })
    }
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
      category: 'Margin Deterioration',
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
      if (items.some((i) => i.customerId === h.customerId && i.category === 'Revenue at Risk')) return
      items.push({
        id: `RAR-${h.customerId}`,
        category: 'Revenue at Risk',
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

  return items.sort((a, b) => {
    const score = (x: ActionItem) => x.actionability * 1e9 + x.financialImpact
    return score(b) - score(a)
  })
}

export function actionCategoryTotals(items: ActionItem[]) {
  const cats: ActionCategory[] = [
    'Potential Revenue Recovery',
    'Revenue at Risk',
    'Overdue Receivables',
    'Margin Deterioration',
  ]
  return cats.map((category) => ({
    category,
    count: items.filter((i) => i.category === category).length,
    impact: sumMoney(items.filter((i) => i.category === category).map((i) => i.financialImpact)),
    note:
      category === 'Overdue Receivables'
        ? 'Cash/collections exposure — not recognized revenue loss'
        : category === 'Potential Revenue Recovery'
          ? 'Actionable billing leakage / adjustment pool'
          : category === 'Revenue at Risk'
            ? 'Forward scenario exposure — not booked'
            : 'Profitability pressure vs prior half-window',
  }))
}
