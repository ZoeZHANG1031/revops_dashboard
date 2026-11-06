import { filterBillingLines, filterCosts, filterExceptions, filterShipments } from '@/lib/filters'
import { createCalcMemo, filterCacheKey } from '@/lib/memoCalc'
import { pkgs } from '@/lib/pricing'
import { money, pct, sumMoney } from '@/lib/money'
import type { DataStore, FactBillingLine, FactException, FactShipment, GlobalFilters } from '@/types'

const healthMemo = createCalcMemo<CustomerHealthRow[]>(48)

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

const VARIABLE = new Set([
  'DSP Delivery',
  'Sorting',
  'Linehaul',
  'Redelivery',
  'Claims',
  'Other Variable',
])

type Agg = {
  lines: FactBillingLine[]
  ships: FactShipment[]
  varCost: number
  claimsCost: number
  net: number
  linePkgs: number
  shipPkgs: number
  delivered: number
  onTime: number
  periods: Set<string>
}

function emptyAgg(): Agg {
  return {
    lines: [],
    ships: [],
    varCost: 0,
    claimsCost: 0,
    net: 0,
    linePkgs: 0,
    shipPkgs: 0,
    delivered: 0,
    onTime: 0,
    periods: new Set(),
  }
}

export function computeCustomerHealth(
  data: DataStore,
  filters: GlobalFilters,
  weights: HealthWeights = DEFAULT_HEALTH_WEIGHTS,
): CustomerHealthRow[] {
  const key = filterCacheKey(filters, [
    `w:${weights.volumeTrend},${weights.deliveryPerformance},${weights.profitability},${weights.paymentBehavior},${weights.customerIssues}`,
  ])
  const cached = healthMemo.get(data, key)
  if (cached) return cached
  return healthMemo.set(data, key, computeCustomerHealthFresh(data, filters, weights))
}

function computeCustomerHealthFresh(
  data: DataStore,
  filters: GlobalFilters,
  weights: HealthWeights,
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
  const customerSet = new Set(customers.map((c) => c.customer_id))

  // Single pass over scoped facts (no per-customer re-filter)
  const scope: GlobalFilters = { ...filters, customerIds: [] }
  const byCust = new Map<string, Agg>()
  const ensure = (id: string) => {
    let a = byCust.get(id)
    if (!a) {
      a = emptyAgg()
      byCust.set(id, a)
    }
    return a
  }

  for (const l of filterBillingLines(data, scope)) {
    if (!customerSet.has(l.customer_id)) continue
    const a = ensure(l.customer_id)
    a.lines.push(l)
    a.net += l.net_amount
    a.linePkgs += l.package_count
  }
  for (const s of filterShipments(data, scope)) {
    if (!customerSet.has(s.customer_id)) continue
    const a = ensure(s.customer_id)
    a.ships.push(s)
    a.shipPkgs += s.package_count
    a.periods.add(s.ship_date.slice(0, 7))
    if (s.delivery_status === 'Delivered') a.delivered += s.package_count
    if (s.on_time) a.onTime += s.package_count
  }
  for (const c of filterCosts(data, scope)) {
    if (!c.customer_id || !customerSet.has(c.customer_id) || !VARIABLE.has(c.cost_type)) continue
    const a = ensure(c.customer_id)
    a.varCost += c.amount
    if (c.cost_type === 'Claims') a.claimsCost += c.amount
  }

  const priorRev = new Map<string, number>()
  const priorShipPkgs = new Map<string, number>()
  const histStart = data.meta.history_start ?? '0000-00'
  const py = priorYear(filters)
  if (py.startPeriod >= histStart) {
    const priorScope: GlobalFilters = { ...py, customerIds: [] }
    for (const l of filterBillingLines(data, priorScope)) {
      if (!customerSet.has(l.customer_id)) continue
      priorRev.set(l.customer_id, (priorRev.get(l.customer_id) ?? 0) + l.net_amount)
    }
    for (const s of filterShipments(data, priorScope)) {
      if (!customerSet.has(s.customer_id)) continue
      priorShipPkgs.set(s.customer_id, (priorShipPkgs.get(s.customer_id) ?? 0) + s.package_count)
    }
  }

  const issuesByCust = new Map<string, FactException[]>()
  for (const e of filterExceptions(data, scope)) {
    if (!e.customer_id || !customerSet.has(e.customer_id)) continue
    if (
      e.status === 'Resolved' ||
      e.status === 'Accepted' ||
      e.status === 'Rejected' ||
      e.exception_type === 'Overdue AR'
    )
      continue
    const list = issuesByCust.get(e.customer_id) ?? []
    list.push(e)
    issuesByCust.set(e.customer_id, list)
  }

  const invoicesByCust = new Map<string, typeof data.invoices>()
  for (const i of data.invoices) {
    if (!customerSet.has(i.customer_id)) continue
    if (i.accounting_period < filters.startPeriod || i.accounting_period > filters.endPeriod) continue
    const list = invoicesByCust.get(i.customer_id) ?? []
    list.push(i)
    invoicesByCust.set(i.customer_id, list)
  }

  const contractByCust = new Map<string, string>()
  for (const c of data.contracts) {
    if (!contractByCust.has(c.customer_id)) contractByCust.set(c.customer_id, c.end_date)
  }

  const next3 = (() => {
    const [y, m] = filters.endPeriod.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + 3, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })()
  const futureByCust = new Map<string, number>()
  for (const f of data.forecasts) {
    if (
      !f.customer_id ||
      !customerSet.has(f.customer_id) ||
      f.scenario !== 'Base' ||
      f.forecast_type !== 'Existing' ||
      f.accounting_period <= filters.endPeriod ||
      f.accounting_period > next3
    )
      continue
    futureByCust.set(f.customer_id, (futureByCust.get(f.customer_id) ?? 0) + f.forecast_recognized)
  }

  const asOf = Date.parse(data.meta.as_of_date ?? '2026-11-05')
  const totalBits = 5

  const rows: CustomerHealthRow[] = customers.map((cust) => {
    const a = byCust.get(cust.customer_id) ?? emptyAgg()
    const revenue = money(a.net)
    const volume = a.linePkgs
    const contribution = money(revenue - a.varCost)
    const contributionMargin = pct(contribution, revenue)
    const revenuePerPackage = volume ? money(revenue / volume) : null

    let revenueGrowth: number | null = null
    let priorRevenue = money(priorRev.get(cust.customer_id) ?? 0)
    let observedBits = 0
    let volumeScore = 55
    let volumeObserved = false
    const priorPkgs = priorShipPkgs.get(cust.customer_id) ?? 0
    const curPkgs = a.shipPkgs
    const comparable = priorRevenue > 0 && priorRevenue >= revenue * 0.25 && priorPkgs > 0
    if (comparable) {
      revenueGrowth = money(((revenue - priorRevenue) / Math.abs(priorRevenue)) * 100)
      const g = scoreFromGrowth(((curPkgs - priorPkgs) / priorPkgs) * 100)
      volumeScore = g.score
      volumeObserved = g.observed
    }
    if (volumeObserved) observedBits++

    const shipPkgs = a.shipPkgs
    const deliveryPerformance = shipPkgs === 0 ? null : money((a.onTime / shipPkgs) * 100)
    const d = scoreFromDelivery(deliveryPerformance)
    const deliveryScore = d.score
    if (d.observed) observedBits++

    const p = scoreFromMargin(contributionMargin)
    const profitScore = p.score
    if (p.observed) observedBits++

    const invoices = invoicesByCust.get(cust.customer_id) ?? []
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
              return acc + Math.max(0, (asOf - due) / 86400000)
            }, 0) / overdue.length,
          )
        : 0
    }

    const issues = issuesByCust.get(cust.customer_id) ?? []
    const issueImpact = sumMoney(issues.map((e) => e.financial_impact))
    const disputeShare = revenue > 0 ? (issueImpact / revenue) * 100 : 0
    const issueScore = clampScore(100 - Math.min(100, disputeShare * 12 + issues.length * 3))
    if (shipPkgs > 0 || issues.length > 0) observedBits++

    const claimsRate = shipPkgs === 0 ? null : money((a.claimsCost / shipPkgs) * 1000)

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
    const expectedFutureRevenue = money(futureByCust.get(cust.customer_id) ?? 0)
    const future =
      expectedFutureRevenue || money((revenue / Math.max(1, a.periods.size || 1)) * 3)
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
    const topRiskDriver = [...driverScores].sort((x, y) => x.score - y.score)[0]?.name ?? 'None'

    const recommendedActions: string[] = []
    if (healthScore < 50) recommendedActions.push('Executive retention QBR')
    if (volumeScore < 50) recommendedActions.push('Share-of-wallet / competitive win-back')
    if (paymentScore < 55) recommendedActions.push('Collections + credit policy review')
    if (issueScore < 55) recommendedActions.push('Clear open billing exceptions')
    if (profitScore < 50) recommendedActions.push('Repricing or zone mix review')
    if (recommendedActions.length === 0) recommendedActions.push('Maintain cadence; monitor leading indicators')

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
      deliveryPerformance: shipPkgs === 0 ? null : money((a.delivered / shipPkgs) * 100),
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
      contractRenewalDate: contractByCust.get(cust.customer_id) ?? null,
    }
  })

  return rows.sort((a, b) => b.revenue - a.revenue)
}
