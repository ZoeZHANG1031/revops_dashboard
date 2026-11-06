import { filterBillingLines, filterCosts, filterExceptions, filterShipments, addMonths } from '@/lib/filters'
import { createCalcMemo, filterCacheKey } from '@/lib/memoCalc'
import { money, pct, sumMoney } from '@/lib/money'
import type { DataStore, ExceptionType, FactException, GlobalFilters } from '@/types'
import { invoiceOutstanding, paidByInvoiceAsOf } from './arSnapshot'
import { customerComparisonWindow } from './customerComparison'

const healthMemo = createCalcMemo<CustomerHealthRow[]>(48)

export interface HealthWeights {
  volumeTrend: number
  deliveryPerformance: number
  profitability: number
  paymentBehavior: number
  customerIssues: number
}

/** Demo configuration — not an industry standard */
export const DEFAULT_HEALTH_WEIGHTS: HealthWeights = {
  volumeTrend: 0.3,
  deliveryPerformance: 0.25,
  profitability: 0.2,
  paymentBehavior: 0.15,
  customerIssues: 0.1,
}

export type HealthBand = 'Healthy' | 'Watchlist' | 'At Risk' | 'Critical'

/** Band cut-offs (demo configuration). Higher score = healthier. */
export const HEALTH_BANDS: { band: HealthBand; min: number }[] = [
  { band: 'Healthy', min: 85 },
  { band: 'Watchlist', min: 70 },
  { band: 'At Risk', min: 50 },
  { band: 'Critical', min: 0 },
]

/** Neutral placeholder used when a component has no evidence (disclosed, never silent) */
export const HEALTH_MISSING_PLACEHOLDER = 55

/** YoY package decline at or below this % triggers the Critical override (demo configuration) */
export const HEALTH_GATE_VOLUME_DECLINE_PCT = -30
/** Score ceiling when the override fires (top of the Critical band) */
export const HEALTH_GATE_CAP = 49

/** Exception types that measure billing quality (customer-risk signals such as Volume Decline are NOT billing issues) */
export const BILLING_QUALITY_TYPES: ReadonlySet<ExceptionType> = new Set<ExceptionType>([
  'Missing Billing',
  'Unbilled Packages',
  'Rate Mismatch',
  'Missing Surcharge',
  'Duplicate Billing',
])

const OPEN_STATUSES = new Set(['Open', 'Investigating', 'Pending Approval'])

/** Scoring rules (demo configuration) — each component maps one raw metric to 0–100 */
export const HEALTH_RULES = {
  volume: 'Score = 60 + 1.2 × YoY package change % (clamped 0–100): −30% → 24, 0% → 60, +33% → 100',
  delivery: 'Score = 100 − 5 × (97 − on-time %) (clamped 0–100): 97% → 100, 94% → 85, 90% → 65',
  profitability: 'Score = 3 × (CM % − 5) (clamped 0–100): 20% → 45, 25% → 60, 35% → 90',
  payment: 'Score = 100 − 90 × overdue-invoice share + 5 × paid-invoice share (as-of; clamped)',
  billing:
    'Score = 100 − min(40, 4 × affected $ ÷ Net Billing %) − min(25, 2 × open cases) − min(20, 5 × High/Critical cases)',
} as const

export interface HealthInputs {
  priorStart: string | null
  priorEnd: string | null
  shippedPackages: number
  priorShippedPackages: number | null
  volumeGrowthPct: number | null
  onTimePct: number | null
  onTimePackages: number
  priorOnTimePct: number | null
  deliveredPct: number | null
  priorContributionMargin: number | null
  contribution: number
  priorContribution: number | null
  netBilling: number
  priorNetBilling: number | null
  invoiceCount: number
  overdueInvoiceCount: number
  paidInvoiceCount: number
  billingCases: FactException[]
  billingAffectedAmount: number
  billingAffectedPct: number | null
  billingPenalties: { amount: number; count: number; severity: number }
  oldestBillingCaseDays: number | null
  observed: { volume: boolean; delivery: boolean; profitability: boolean; payment: boolean; billing: boolean }
  /** normalized weights actually applied */
  weights: HealthWeights
  /** Σ weight × component score before any override */
  weightedScore: number
  /** share of total weight backed by observed evidence (100 = complete) */
  scoreCoverage: number
  override: { applied: boolean; rule: string | null; cap: number | null }
  exposure: { basis: 'Base Existing forecast' | 'Run-rate × 3 (no forecast)'; horizonStart: string; horizonEnd: string; amount: number }
}

export interface CustomerHealthRow {
  customerId: string
  customerName: string
  segment: string
  region: string
  /** Net Billing in the current window */
  revenue: number
  /** Net Billing in the comparison window (same months prior year) */
  priorRevenue: number
  volume: number
  /** Net Billing growth % vs same months prior year */
  revenueGrowth: number | null
  contributionMargin: number | null
  revenuePerPackage: number | null
  /** Delivered packages ÷ shipped packages (completion) — not the delivery score input */
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
  /** Scenario stress factor by band (demo assumption, NOT a validated churn probability) */
  assumedLossProbability: number
  expectedFutureRevenue: number
  /** Scenario Revenue Exposure — NOT a forecast, expected loss or confirmed loss */
  scenarioRevenueAtRisk: number
  revenueAtRisk: number
  drivers: string[]
  topRiskDriver: string
  recommendedActions: string[]
  claimsRate: number | null
  paymentAgingDays: number
  /** Open billing-quality cases (billing types only) */
  billingExceptionCount: number
  contractRenewalDate: string | null
  inputs: HealthInputs
}

/** Scenario stress factor per band (demo assumption) */
export const SCENARIO_STRESS_FACTORS: Record<HealthBand, number> = {
  Critical: 0.4,
  'At Risk': 0.22,
  Watchlist: 0.1,
  Healthy: 0.03,
}

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)))
}

export function bandFromScore(score: number): HealthBand {
  return HEALTH_BANDS.find((b) => score >= b.min)!.band
}

export function scoreFromGrowth(growthPct: number): number {
  return clampScore(60 + growthPct * 1.2)
}
export function scoreFromDelivery(otdPct: number): number {
  return clampScore(100 - (97 - otdPct) * 5)
}
export function scoreFromMargin(cm: number): number {
  return clampScore((cm - 5) * 3)
}

/** Affected $ counted once per billing line / invoice / shipment (a line can carry two exception types) */
export function dedupeBillingImpact(cases: FactException[]): number {
  const byKey = new Map<string, number>()
  for (const e of cases) {
    const k = e.billing_line_id ?? e.invoice_id ?? e.shipment_id ?? e.exception_id
    byKey.set(k, Math.max(byKey.get(k) ?? 0, Math.abs(e.financial_impact)))
  }
  return sumMoney([...byKey.values()])
}

const VARIABLE = new Set(['DSP Delivery', 'Sorting', 'Linehaul', 'Redelivery', 'Claims', 'Other Variable'])

type Agg = {
  net: number
  linePkgs: number
  shipPkgs: number
  delivered: number
  onTime: number
  varCost: number
  claimsCost: number
  periods: Set<string>
}
const emptyAgg = (): Agg => ({ net: 0, linePkgs: 0, shipPkgs: 0, delivered: 0, onTime: 0, varCost: 0, claimsCost: 0, periods: new Set() })

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

function aggregate(data: DataStore, scope: GlobalFilters, customerSet: Set<string>): Map<string, Agg> {
  const byCust = new Map<string, Agg>()
  const ensure = (id: string) => {
    let a = byCust.get(id)
    if (!a) byCust.set(id, (a = emptyAgg()))
    return a
  }
  for (const l of filterBillingLines(data, scope)) {
    if (!customerSet.has(l.customer_id)) continue
    const a = ensure(l.customer_id)
    a.net += l.net_amount
    a.linePkgs += l.package_count
  }
  for (const s of filterShipments(data, scope)) {
    if (!customerSet.has(s.customer_id)) continue
    const a = ensure(s.customer_id)
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
  return byCust
}

function computeCustomerHealthFresh(
  data: DataStore,
  filters: GlobalFilters,
  weights: HealthWeights,
): CustomerHealthRow[] {
  const weightSum =
    weights.volumeTrend + weights.deliveryPerformance + weights.profitability + weights.paymentBehavior + weights.customerIssues
  const w: HealthWeights = {
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

  const scope: GlobalFilters = { ...filters, customerIds: [] }
  const cur = aggregate(data, scope, customerSet)
  const window = customerComparisonWindow(data, filters)
  const prior = window.prior
    ? aggregate(data, { ...scope, startPeriod: window.prior.startPeriod, endPeriod: window.prior.endPeriod }, customerSet)
    : null

  const asOfIso = data.meta.as_of_date ?? '2026-11-05'
  const asOf = Date.parse(asOfIso)

  // Billing-quality cases only (open, detected in window, ≤ as-of)
  const issuesByCust = new Map<string, FactException[]>()
  for (const e of filterExceptions(data, scope)) {
    if (!e.customer_id || !customerSet.has(e.customer_id)) continue
    if (!OPEN_STATUSES.has(e.status) || !BILLING_QUALITY_TYPES.has(e.exception_type)) continue
    if (e.detected_date.slice(0, 10) > asOfIso) continue
    const list = issuesByCust.get(e.customer_id) ?? []
    list.push(e)
    issuesByCust.set(e.customer_id, list)
  }

  // Payment behaviour as of the As-of Date: invoices issued in the window plus any older invoice still overdue
  const paidAsOf = paidByInvoiceAsOf(data, asOfIso)
  const invoicesByCust = new Map<string, { overdue: number; paid: number; total: number; ageSum: number }>()
  for (const i of data.invoices) {
    if (!customerSet.has(i.customer_id) || i.status === 'Draft' || i.invoice_date.slice(0, 10) > asOfIso) continue
    const out = invoiceOutstanding(i, paidAsOf)
    const isOverdue = out > 0.005 && i.due_date.slice(0, 10) < asOfIso
    const inWindow = i.accounting_period >= filters.startPeriod && i.accounting_period <= filters.endPeriod
    if (!inWindow && !isOverdue) continue
    const s = invoicesByCust.get(i.customer_id) ?? { overdue: 0, paid: 0, total: 0, ageSum: 0 }
    s.total++
    if (isOverdue) {
      s.overdue++
      s.ageSum += Math.max(0, (asOf - Date.parse(i.due_date)) / 86400000)
    }
    if (out <= 0.005) s.paid++
    invoicesByCust.set(i.customer_id, s)
  }

  const contractByCust = new Map<string, string>()
  for (const c of data.contracts) {
    if (c.status === 'Active' || !contractByCust.has(c.customer_id)) contractByCust.set(c.customer_id, c.end_date)
  }

  // Scenario exposure basis: Base Existing forecast for the 3 months after the window
  const horizonStart = addMonths(filters.endPeriod, 1)
  const horizonEnd = addMonths(filters.endPeriod, 3)
  const futureByCust = new Map<string, number>()
  for (const f of data.forecasts) {
    if (!f.customer_id || !customerSet.has(f.customer_id) || f.scenario !== 'Base' || f.forecast_type !== 'Existing') continue
    if (f.accounting_period < horizonStart || f.accounting_period > horizonEnd) continue
    futureByCust.set(f.customer_id, (futureByCust.get(f.customer_id) ?? 0) + f.forecast_recognized)
  }

  const rows: CustomerHealthRow[] = customers.map((cust) => {
    const id = cust.customer_id
    const a = cur.get(id) ?? emptyAgg()
    const p = prior?.get(id) ?? null
    const revenue = money(a.net)
    const contribution = money(revenue - a.varCost)
    const contributionMargin = pct(contribution, revenue)
    const priorNet = p ? money(p.net) : null
    const priorContribution = p ? money(p.net - p.varCost) : null
    const priorCm = p && p.net ? pct(p.net - p.varCost, p.net) : null

    // Volume — shipped packages, same months prior year
    const priorPkgs = p?.shipPkgs ?? 0
    const comparable = priorNet != null && priorNet > 0 && priorNet >= revenue * 0.25 && priorPkgs > 0
    const revenueGrowth = comparable ? money(((revenue - priorNet!) / Math.abs(priorNet!)) * 100) : null
    const volumeGrowthPct = comparable ? money(((a.shipPkgs - priorPkgs) / priorPkgs) * 100) : null
    const volumeObserved = volumeGrowthPct != null
    const volumeScore = volumeObserved ? scoreFromGrowth(volumeGrowthPct!) : HEALTH_MISSING_PLACEHOLDER

    // Delivery — on-time % (the score input); delivered % is reported separately
    const onTimePct = a.shipPkgs ? money((a.onTime / a.shipPkgs) * 100) : null
    const priorOnTimePct = p && p.shipPkgs ? money((p.onTime / p.shipPkgs) * 100) : null
    const deliveryScore = onTimePct != null ? scoreFromDelivery(onTimePct) : HEALTH_MISSING_PLACEHOLDER

    const profitScore = contributionMargin != null ? scoreFromMargin(contributionMargin) : HEALTH_MISSING_PLACEHOLDER

    const inv = invoicesByCust.get(id)
    const paymentObserved = !!inv && inv.total > 0
    const paymentScore = paymentObserved
      ? clampScore(100 - (inv!.overdue / inv!.total) * 90 + (inv!.paid / inv!.total) * 5)
      : HEALTH_MISSING_PLACEHOLDER
    const paymentAgingDays = inv?.overdue ? Math.round(inv.ageSum / inv.overdue) : 0

    const issues = issuesByCust.get(id) ?? []
    const affected = dedupeBillingImpact(issues)
    const affectedPct = revenue > 0 ? money((affected / Math.abs(revenue)) * 100) : null
    const penalties = {
      amount: money(Math.min(40, (affectedPct ?? 0) * 4)),
      count: Math.min(25, issues.length * 2),
      severity: Math.min(20, issues.filter((e) => e.severity === 'Critical' || e.severity === 'High').length * 5),
    }
    const billingObserved = a.linePkgs > 0 || issues.length > 0
    const issueScore = billingObserved
      ? clampScore(100 - penalties.amount - penalties.count - penalties.severity)
      : HEALTH_MISSING_PLACEHOLDER
    const oldestCase = issues.length
      ? Math.max(...issues.map((e) => Math.round((asOf - Date.parse(e.detected_date)) / 86400000)))
      : null

    const observed = {
      volume: volumeObserved,
      delivery: onTimePct != null,
      profitability: contributionMargin != null,
      payment: paymentObserved,
      billing: billingObserved,
    }
    const weightedScore = clampScore(
      volumeScore * w.volumeTrend +
        deliveryScore * w.deliveryPerformance +
        profitScore * w.profitability +
        paymentScore * w.paymentBehavior +
        issueScore * w.customerIssues,
    )
    const scoreCoverage = Math.round(
      ((observed.volume ? w.volumeTrend : 0) +
        (observed.delivery ? w.deliveryPerformance : 0) +
        (observed.profitability ? w.profitability : 0) +
        (observed.payment ? w.paymentBehavior : 0) +
        (observed.billing ? w.customerIssues : 0)) *
        100,
    )

    // Override (separate from the weighted average): severe YoY volume collapse caps the score
    const severeDecline = volumeGrowthPct != null && volumeGrowthPct <= HEALTH_GATE_VOLUME_DECLINE_PCT
    const overrideApplied = severeDecline && weightedScore > HEALTH_GATE_CAP
    const healthScore = overrideApplied ? HEALTH_GATE_CAP : weightedScore
    const healthBand = bandFromScore(healthScore)

    const observedCount = Object.values(observed).filter(Boolean).length
    const dataCompleteness = clampScore((observedCount / 5) * 100)
    const confidence: CustomerHealthRow['confidence'] =
      dataCompleteness >= 80 ? 'High' : dataCompleteness >= 55 ? 'Medium' : 'Low'

    const stress = SCENARIO_STRESS_FACTORS[healthBand]
    const forecastBasis = money(futureByCust.get(id) ?? 0)
    const future = forecastBasis || money((revenue / Math.max(1, a.periods.size || 1)) * 3)
    const scenarioRevenueAtRisk = money(future * stress)

    const drivers: string[] = []
    if (overrideApplied)
      drivers.push(`Override: packages ${volumeGrowthPct!.toFixed(1)}% YoY ≤ −${Math.abs(HEALTH_GATE_VOLUME_DECLINE_PCT)}% (score capped at ${HEALTH_GATE_CAP})`)
    if (observed.volume && volumeScore < 50) drivers.push('Volume trend weak')
    if (observed.delivery && deliveryScore < 55) drivers.push('Delivery performance pressure')
    if (observed.profitability && profitScore < 50) drivers.push('Contribution margin compressed')
    if (observed.payment && paymentScore < 55) drivers.push('Payment / AR risk')
    if (observed.billing && issueScore < 55) drivers.push('Open billing exceptions')
    if (confidence === 'Low') drivers.push('Low data completeness')

    const driverScores = [
      { name: 'Volume', short: w.volumeTrend * (100 - volumeScore) },
      { name: 'Delivery', short: w.deliveryPerformance * (100 - deliveryScore) },
      { name: 'Profitability', short: w.profitability * (100 - profitScore) },
      { name: 'Payment', short: w.paymentBehavior * (100 - paymentScore) },
      { name: 'Billing quality', short: w.customerIssues * (100 - issueScore) },
    ]
    const topRiskDriver = [...driverScores].sort((x, y) => y.short - x.short)[0]?.name ?? 'None'

    // Actions follow evidence (not the band)
    const recommendedActions: string[] = []
    if (volumeGrowthPct != null && volumeGrowthPct <= -10)
      recommendedActions.push('Investigate volume loss with the account (share-of-wallet, service, pricing)')
    if (contributionMargin != null && (contributionMargin < 18 || (priorCm != null && contributionMargin <= priorCm - 5)))
      recommendedActions.push('Decompose cost per package before any repricing')
    if (inv?.overdue) recommendedActions.push('Collections follow-up on overdue invoices')
    if (observed.billing && (issueScore < 55 || issues.length >= 3)) recommendedActions.push('Resolve open billing exceptions')
    if (observed.delivery && deliveryScore < 55) recommendedActions.push('Operations review of on-time performance')
    if (recommendedActions.length === 0) recommendedActions.push('Maintain cadence; monitor leading indicators')

    return {
      customerId: id,
      customerName: cust.customer_name,
      segment: cust.segment,
      region: cust.region,
      revenue,
      priorRevenue: priorNet ?? 0,
      volume: a.linePkgs,
      revenueGrowth,
      contributionMargin,
      revenuePerPackage: a.linePkgs ? money(revenue / a.linePkgs) : null,
      deliveryPerformance: a.shipPkgs ? money((a.delivered / a.shipPkgs) * 100) : null,
      paymentScore,
      issueScore,
      volumeScore,
      profitScore,
      deliveryScore,
      healthScore,
      healthBand,
      dataCompleteness,
      confidence,
      assumedLossProbability: stress,
      expectedFutureRevenue: future,
      scenarioRevenueAtRisk,
      revenueAtRisk: scenarioRevenueAtRisk,
      drivers,
      topRiskDriver,
      recommendedActions,
      claimsRate: a.shipPkgs ? money((a.claimsCost / a.shipPkgs) * 1000) : null,
      paymentAgingDays,
      billingExceptionCount: issues.length,
      contractRenewalDate: contractByCust.get(id) ?? null,
      inputs: {
        priorStart: window.prior?.startPeriod ?? null,
        priorEnd: window.prior?.endPeriod ?? null,
        shippedPackages: a.shipPkgs,
        priorShippedPackages: p ? p.shipPkgs : null,
        volumeGrowthPct,
        onTimePct,
        onTimePackages: a.onTime,
        priorOnTimePct,
        deliveredPct: a.shipPkgs ? money((a.delivered / a.shipPkgs) * 100) : null,
        priorContributionMargin: priorCm,
        contribution,
        priorContribution,
        netBilling: revenue,
        priorNetBilling: priorNet,
        invoiceCount: inv?.total ?? 0,
        overdueInvoiceCount: inv?.overdue ?? 0,
        paidInvoiceCount: inv?.paid ?? 0,
        billingCases: issues,
        billingAffectedAmount: affected,
        billingAffectedPct: affectedPct,
        billingPenalties: penalties,
        oldestBillingCaseDays: oldestCase,
        observed,
        weights: w,
        weightedScore,
        scoreCoverage,
        override: {
          applied: overrideApplied,
          rule: overrideApplied ? `YoY packages ≤ −${Math.abs(HEALTH_GATE_VOLUME_DECLINE_PCT)}% → score capped at ${HEALTH_GATE_CAP}` : null,
          cap: overrideApplied ? HEALTH_GATE_CAP : null,
        },
        exposure: {
          basis: forecastBasis ? 'Base Existing forecast' : 'Run-rate × 3 (no forecast)',
          horizonStart,
          horizonEnd,
          amount: future,
        },
      },
    }
  })

  return rows.sort((a, b) => b.revenue - a.revenue)
}
