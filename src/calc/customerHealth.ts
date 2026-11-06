import { filterBillingLines, filterCosts, filterExceptions, filterShipments } from '@/lib/filters'
import { pkgs } from '@/lib/pricing'
import { money, pct, sumMoney } from '@/lib/money'
import type { DataStore, GlobalFilters } from '@/types'

export interface HealthWeights {
  volumeTrend: number
  deliveryPerformance: number
  profitability: number
  paymentBehavior: number
  customerIssues: number
}

export const DEFAULT_HEALTH_WEIGHTS: HealthWeights = {
  volumeTrend: 0.3,
  deliveryPerformance: 0.25,
  profitability: 0.2,
  paymentBehavior: 0.15,
  customerIssues: 0.1,
}

export type HealthBand = 'Healthy' | 'Watchlist' | 'At Risk' | 'Critical'

export interface CustomerHealthRow {
  customerId: string
  customerName: string
  segment: string
  region: string
  revenue: number
  priorRevenue: number
  volume: number
  /** Period-over-period growth rate (%). e.g. +12.5 means +12.5% vs prior half-window */
  revenueGrowth: number | null
  contributionMargin: number | null
  revenuePerPackage: number | null
  deliveryPerformance: number | null
  paymentScore: number
  issueScore: number
  volumeScore: number
  profitScore: number
  deliveryScore: number
  healthScore: number
  healthBand: HealthBand
  dataCompleteness: number
  confidence: 'High' | 'Medium' | 'Low'
  assumedLossProbability: number
  expectedFutureRevenue: number
  /** Scenario exposure — NOT confirmed loss */
  scenarioRevenueAtRisk: number
  revenueAtRisk: number
  drivers: string[]
  topRiskDriver: string
  recommendedActions: string[]
  claimsRate: number | null
  paymentAgingDays: number
  billingExceptionCount: number
  contractRenewalDate: string | null
}

function assumedLossFromHealth(score: number): number {
  if (score < 50) return 0.4
  if (score < 70) return 0.22
  if (score < 85) return 0.1
  return 0.03
}

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)))
}

function bandFromScore(score: number): HealthBand {
  if (score >= 85) return 'Healthy'
  if (score >= 70) return 'Watchlist'
  if (score >= 50) return 'At Risk'
  return 'Critical'
}

/** Map a raw metric to 0–100 with steeper discrimination (not centered at 50). */
// Missing inputs get a neutral (not perfect) score and lower data completeness.
function scoreFromGrowth(growthPct: number | null): { score: number; observed: boolean } {
  if (growthPct == null) return { score: 55, observed: false }
  // YoY volume: −30% → 24, 0% → 60, +10% → 72, +33% → 100
  return { score: clampScore(60 + growthPct * 1.2), observed: true }
}

function scoreFromDelivery(otdPct: number | null): { score: number; observed: boolean } {
  if (otdPct == null) return { score: 55, observed: false }
  // On-time %: 97 → 100, 94 → 85, 90 → 65, 85 → 40
  return { score: clampScore(100 - (97 - otdPct) * 5), observed: true }
}

function scoreFromMargin(cm: number | null): { score: number; observed: boolean } {
  if (cm == null) return { score: 55, observed: false }
  // Contribution margin: 10% → 15, 20% → 45, 27% → 66, 35% → 90
  return { score: clampScore((cm - 5) * 3), observed: true }
}

/** Same months one year earlier (YoY comparison avoids seasonality and unequal half-windows) */
function priorYear(filters: GlobalFilters): GlobalFilters {
  const shift = (p: string) => `${Number(p.slice(0, 4)) - 1}${p.slice(4)}`
  return { ...filters, startPeriod: shift(filters.startPeriod), endPeriod: shift(filters.endPeriod) }
}

export function computeCustomerHealth(
  data: DataStore,
  filters: GlobalFilters,
  weights: HealthWeights = DEFAULT_HEALTH_WEIGHTS,
): CustomerHealthRow[] {
  const weightSum =
    weights.volumeTrend +
    weights.deliveryPerformance +
    weights.profitability +
    weights.paymentBehavior +
    weights.customerIssues
  const w = {
    volumeTrend: weights.volumeTrend / weightSum,
    deliveryPerformance: weights.deliveryPerformance / weightSum,
    profitability: weights.profitability / weightSum,
    paymentBehavior: weights.paymentBehavior / weightSum,
    customerIssues: weights.customerIssues / weightSum,
  }

  const customers =
    filters.customerIds.length > 0
      ? data.customers.filter((c) => filters.customerIds.includes(c.customer_id))
      : data.customers.filter((c) => c.status === 'Active')

  return customers
    .map((cust) => {
      const custFilters: GlobalFilters = { ...filters, customerIds: [cust.customer_id] }
      const lines = filterBillingLines(data, custFilters)
      const shipments = filterShipments(data, custFilters)
      const costs = filterCosts(data, custFilters).filter((c) =>
        ['DSP Delivery', 'Sorting', 'Linehaul', 'Redelivery', 'Claims', 'Other Variable'].includes(
          c.cost_type,
        ),
      )
      const revenue = sumMoney(lines.map((l) => l.net_amount))
      const volume = pkgs(lines)
      const varCost = sumMoney(costs.map((c) => c.amount))
      const contribution = money(revenue - varCost)
      const contributionMargin = pct(contribution, revenue)
      const revenuePerPackage = volume ? money(revenue / volume) : null

      const periods = [...new Set(shipments.map((s) => s.ship_date.slice(0, 7)))].sort()
      let revenueGrowth: number | null = null
      let priorRevenue = 0
      let observedBits = 0
      let totalBits = 5

      // Growth = YoY on the same months (needs history ≥ 12 months before the window).
      // New / ramping accounts (no or tiny comparable base) → null, shown as "New / N/A", never +100%.
      let volumeScore = 55
      let volumeObserved = false
      const histStart = data.meta.history_start ?? '0000-00'
      const py = priorYear(custFilters)
      if (py.startPeriod >= histStart) {
        const priorLines = filterBillingLines(data, py)
        const priorShips = filterShipments(data, py)
        priorRevenue = sumMoney(priorLines.map((l) => l.net_amount))
        const priorPkgs = pkgs(priorShips)
        const curPkgs = pkgs(shipments)
        const comparable = priorRevenue > 0 && priorRevenue >= revenue * 0.25 && priorPkgs > 0
        if (comparable) {
          revenueGrowth = money(((revenue - priorRevenue) / Math.abs(priorRevenue)) * 100)
          const g = scoreFromGrowth(((curPkgs - priorPkgs) / priorPkgs) * 100)
          volumeScore = g.score
          volumeObserved = g.observed
        }
      }
      if (volumeObserved) observedBits++

      const shipPkgs = pkgs(shipments)
      const delivered = pkgs(shipments.filter((s) => s.delivery_status === 'Delivered'))
      const onTime = pkgs(shipments.filter((s) => s.on_time))
      const deliveryPerformance = shipPkgs === 0 ? null : money((onTime / shipPkgs) * 100)
      const d = scoreFromDelivery(deliveryPerformance)
      const deliveryScore = d.score
      if (d.observed) observedBits++

      const p = scoreFromMargin(contributionMargin)
      const profitScore = p.score
      if (p.observed) observedBits++

      const invoices = data.invoices.filter(
        (i) =>
          i.customer_id === cust.customer_id &&
          i.accounting_period >= filters.startPeriod &&
          i.accounting_period <= filters.endPeriod,
      )
      const overdue = invoices.filter((i) => i.status === 'Overdue')
      const paid = invoices.filter((i) => i.status === 'Paid').length
      let paymentScore = 55
      let paymentAgingDays = 0
      if (invoices.length > 0) {
        observedBits++
        paymentScore = clampScore(
          100 - (overdue.length / invoices.length) * 90 + (paid / invoices.length) * 5,
        )
        paymentAgingDays = overdue.length
          ? Math.round(
              overdue.reduce((acc, inv) => {
                const due = new Date(inv.due_date).getTime()
                return acc + Math.max(0, (Date.parse(data.meta.as_of_date ?? '2026-11-05') - due) / 86400000)
              }, 0) / overdue.length,
            )
          : 0
      }

      // Billing quality: open billing disputes relative to the customer's revenue (AR is scored separately)
      const issues = filterExceptions(data, custFilters).filter(
        (e) => e.status !== 'Resolved' && e.status !== 'Accepted' && e.status !== 'Rejected' && e.exception_type !== 'Overdue AR',
      )
      const issueImpact = sumMoney(issues.map((e) => e.financial_impact))
      const disputeShare = revenue > 0 ? (issueImpact / revenue) * 100 : 0
      const issueScore = clampScore(100 - Math.min(100, disputeShare * 12 + issues.length * 3))
      if (shipPkgs > 0 || issues.length > 0) observedBits++

      // Claims cost per 1,000 packages
      const claimsCost = sumMoney(costs.filter((c) => c.cost_type === 'Claims').map((c) => c.amount))
      const claimsRate = shipPkgs === 0 ? null : money((claimsCost / shipPkgs) * 1000)

      const healthScore = clampScore(
        volumeScore * w.volumeTrend +
          deliveryScore * w.deliveryPerformance +
          profitScore * w.profitability +
          paymentScore * w.paymentBehavior +
          issueScore * w.customerIssues,
      )

      const dataCompleteness = clampScore((observedBits / totalBits) * 100)
      const confidence: CustomerHealthRow['confidence'] =
        dataCompleteness >= 80 ? 'High' : dataCompleteness >= 55 ? 'Medium' : 'Low'

      const assumedLossProbability = assumedLossFromHealth(healthScore)
      // Expected future revenue = next 3 forecast months after the window (not the whole horizon)
      const next3 = (() => {
        const [y, m] = filters.endPeriod.split('-').map(Number)
        const d = new Date(Date.UTC(y, m - 1 + 3, 1))
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      })()
      const expectedFutureRevenue = sumMoney(
        data.forecasts
          .filter(
            (f) =>
              f.customer_id === cust.customer_id &&
              f.scenario === 'Base' &&
              f.forecast_type === 'Existing' &&
              f.accounting_period > filters.endPeriod &&
              f.accounting_period <= next3,
          )
          .map((f) => f.forecast_recognized),
      )
      const future =
        expectedFutureRevenue || money((revenue / Math.max(1, periods.length || 1)) * 3)
      const scenarioRevenueAtRisk = money(future * assumedLossProbability)

      const drivers: string[] = []
      if (volumeScore < 50) drivers.push('Volume trend weak')
      if (deliveryScore < 55) drivers.push('Delivery performance pressure')
      if (profitScore < 50) drivers.push('Contribution margin compressed')
      if (paymentScore < 55) drivers.push('Payment / AR risk')
      if (issueScore < 55) drivers.push('Open billing/ops exceptions')
      if (confidence === 'Low') drivers.push('Low data completeness')

      const driverScores = [
        { name: 'Volume', score: volumeScore },
        { name: 'Delivery', score: deliveryScore },
        { name: 'Profitability', score: profitScore },
        { name: 'Payment', score: paymentScore },
        { name: 'Issues', score: issueScore },
      ]
      const topRiskDriver = [...driverScores].sort((a, b) => a.score - b.score)[0]?.name ?? 'None'

      const recommendedActions: string[] = []
      if (healthScore < 50) recommendedActions.push('Executive retention QBR')
      if (volumeScore < 50) recommendedActions.push('Share-of-wallet / competitive win-back')
      if (paymentScore < 55) recommendedActions.push('Collections + credit policy review')
      if (issueScore < 55) recommendedActions.push('Clear open billing exceptions')
      if (profitScore < 50) recommendedActions.push('Repricing or zone mix review')
      if (recommendedActions.length === 0) recommendedActions.push('Maintain cadence; monitor leading indicators')

      const contract = data.contracts.find((c) => c.customer_id === cust.customer_id)

      return {
        customerId: cust.customer_id,
        customerName: cust.customer_name,
        segment: cust.segment,
        region: cust.region,
        revenue,
        priorRevenue,
        volume,
        revenueGrowth,
        contributionMargin,
        revenuePerPackage,
        deliveryPerformance:
          shipPkgs === 0 ? null : money((delivered / shipPkgs) * 100),
        paymentScore,
        issueScore,
        volumeScore,
        profitScore,
        deliveryScore,
        healthScore,
        healthBand: bandFromScore(healthScore),
        dataCompleteness,
        confidence,
        assumedLossProbability,
        expectedFutureRevenue: future,
        scenarioRevenueAtRisk,
        revenueAtRisk: scenarioRevenueAtRisk,
        drivers,
        topRiskDriver,
        recommendedActions,
        claimsRate,
        paymentAgingDays,
        billingExceptionCount: issues.length,
        contractRenewalDate: contract?.end_date ?? null,
      }
    })
    .sort((a, b) => b.revenue - a.revenue)
}
