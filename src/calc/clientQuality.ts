/**
 * Client Quality Intelligence — portfolio KPIs, 5-dimension health (N/A renormalize),
 * priority watchlist, and score-change attribution.
 *
 * Built on existing customerHealth / customerRisk / customerHealthV2 — does not invent
 * complaints, tickets, or CRM engagement. Relationship Signals uses renewal only when present.
 */
import { computeCustomerHealth, type CustomerHealthRow, type HealthBand } from '@/calc/customerHealth'
import { customerComparisonWindow } from '@/calc/customerComparison'
import {
  buildCustomerRiskProfile,
  type CustomerRiskProfile,
  type RiskType,
} from '@/calc/customerRisk'
import { money, sumMoney } from '@/lib/money'
import type { DataStore, GlobalFilters } from '@/types'

export type CqDimensionKey =
  | 'businessEngagement'
  | 'serviceQuality'
  | 'revenueStability'
  | 'financialHealth'
  | 'relationshipSignals'

export interface CqDimensionWeights {
  businessEngagement: number
  serviceQuality: number
  revenueStability: number
  financialHealth: number
  relationshipSignals: number
}

/** Initial design weights — Relationship often N/A and renormalized away */
export const DEFAULT_CQ_WEIGHTS: CqDimensionWeights = {
  businessEngagement: 0.3,
  serviceQuality: 0.25,
  revenueStability: 0.2,
  financialHealth: 0.15,
  relationshipSignals: 0.1,
}

export const CQ_DIMENSION_LABELS: Record<CqDimensionKey, string> = {
  businessEngagement: 'Business Engagement',
  serviceQuality: 'Service Quality',
  revenueStability: 'Revenue Stability',
  financialHealth: 'Financial Health',
  relationshipSignals: 'Relationship Signals',
}

export type ManagementPriority = 'High Priority' | 'Medium Priority' | 'Monitor' | 'Healthy'

export interface CqDimensionScore {
  key: CqDimensionKey
  label: string
  score: number | null
  configuredWeight: number
  normalizedWeight: number
  available: boolean
  signals: string[]
}

export interface ClientQualityScore {
  customerId: string
  score: number | null
  band: HealthBand | 'Insufficient Data'
  coverage: number
  lowConfidence: boolean
  dimensions: CqDimensionScore[]
  /** Legacy v1 score kept for continuity with existing Risk pages */
  legacyHealthScore: number
  legacyBand: HealthBand
}

export interface ClientQualityKpis {
  activeClients: number
  healthyClients: number
  clientsAtRisk: number
  newlyFlaggedClients: number | null
  revenueExposure: number
  clientsImproving: number | null
  avgHealthScore: number | null
  priorComparable: boolean
  priorLabel: string | null
  revenueExposureNote: string
}

export interface WatchlistRow {
  customerId: string
  customerName: string
  segment: string
  revenue: number
  revenueGrowth: number | null
  shipmentGrowth: number | null
  contributionMargin: number | null
  healthScore: number | null
  healthScoreChange: number | null
  primaryRiskSignal: string
  priority: ManagementPriority
  priorityScore: number
  recommendedNextStep: string
  scenarioRevenueAtRisk: number
  riskTypes: RiskType[]
  dataConfidence: 'High' | 'Medium' | 'Low'
}

export interface HealthAttributionStep {
  key: string
  label: string
  amount: number
}

export interface ValueRiskPoint {
  customerId: string
  customerName: string
  x: number
  y: number
  z: number
  priority: ManagementPriority
  healthScore: number | null
  revenue: number
  scenarioRaR: number
}

const AT_RISK: HealthBand[] = ['At Risk', 'Critical']

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)))
}

function scoreFromGrowth(g: number | null): number | null {
  if (g == null) return null
  return clampScore(60 + g * 1.2)
}

function daysUntilRenewal(row: CustomerHealthRow, asOf: string): number | null {
  if (!row.contractRenewalDate) return null
  const a = Date.parse(row.contractRenewalDate)
  const b = Date.parse(asOf.slice(0, 10))
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((a - b) / 86400000)
}

function relationshipScore(days: number | null): number | null {
  if (days == null) return null
  if (days < 0) return 25
  if (days <= 30) return 40
  if (days <= 90) return 58
  if (days <= 180) return 75
  return 90
}

/**
 * Map a health row into the 5-dimension CQ model.
 * Missing dimensions are null (not zero) and weights renormalize over available dims.
 */
export function scoreClientQuality(
  row: CustomerHealthRow,
  opts: { asOfDate?: string; weights?: CqDimensionWeights; minCoverage?: number } = {},
): ClientQualityScore {
  const weights = opts.weights ?? DEFAULT_CQ_WEIGHTS
  const asOf = opts.asOfDate ?? '2026-11-05'
  const minCoverage = opts.minCoverage ?? 0.4

  const eng: number | null = row.volumeScore
  const svc: number | null = row.deliveryScore
  const revStab =
    row.revenueGrowth != null && row.profitScore != null
      ? clampScore(0.55 * (scoreFromGrowth(row.revenueGrowth) ?? 55) + 0.45 * row.profitScore)
      : row.revenueGrowth != null
        ? scoreFromGrowth(row.revenueGrowth)
        : row.profitScore
  const fin =
    row.paymentScore != null && row.issueScore != null
      ? clampScore(0.55 * row.paymentScore + 0.45 * row.issueScore)
      : row.paymentScore ?? row.issueScore
  const rel = relationshipScore(daysUntilRenewal(row, asOf))

  const raw: Record<CqDimensionKey, { score: number | null; signals: string[] }> = {
    businessEngagement: {
      score: eng,
      signals: ['Shipment volume trend', 'Package activity in window'],
    },
    serviceQuality: {
      score: svc,
      signals: ['On-time delivery', 'Delivery performance score'],
    },
    revenueStability: {
      score: revStab,
      signals: ['Revenue growth (YoY window)', 'Contribution margin score'],
    },
    financialHealth: {
      score: fin,
      signals: ['Payment / AR behavior', 'Open billing exception quality'],
    },
    relationshipSignals: {
      score: rel,
      signals: rel == null ? ['Renewal date unavailable · complaints/tickets not in data'] : ['Contract renewal timing'],
    },
  }

  const keys = Object.keys(weights) as CqDimensionKey[]
  const available = keys.filter((k) => raw[k].score != null)
  const weightSum = available.reduce((a, k) => a + weights[k], 0)
  const coverage = weightSum / keys.reduce((a, k) => a + weights[k], 0)

  const dimensions: CqDimensionScore[] = keys.map((k) => ({
    key: k,
    label: CQ_DIMENSION_LABELS[k],
    score: raw[k].score,
    configuredWeight: weights[k],
    normalizedWeight: available.includes(k) && weightSum > 0 ? weights[k] / weightSum : 0,
    available: raw[k].score != null,
    signals: raw[k].signals,
  }))

  if (coverage < minCoverage || available.length === 0) {
    return {
      customerId: row.customerId,
      score: null,
      band: 'Insufficient Data',
      coverage: Math.round(coverage * 1000) / 10,
      lowConfidence: true,
      dimensions,
      legacyHealthScore: row.healthScore,
      legacyBand: row.healthBand,
    }
  }

  const score = clampScore(
    available.reduce((a, k) => a + (raw[k].score as number) * (weights[k] / weightSum), 0),
  )
  const band: HealthBand =
    score >= 85 ? 'Healthy' : score >= 70 ? 'Watchlist' : score >= 50 ? 'At Risk' : 'Critical'

  return {
    customerId: row.customerId,
    score,
    band,
    coverage: Math.round(coverage * 1000) / 10,
    lowConfidence: coverage < 0.75 || row.confidence === 'Low',
    dimensions,
    legacyHealthScore: row.healthScore,
    legacyBand: row.healthBand,
  }
}

export function attributeHealthChange(
  prior: ClientQualityScore,
  current: ClientQualityScore,
): { steps: HealthAttributionStep[]; totalChange: number | null; note: string } {
  if (prior.score == null || current.score == null) {
    return {
      steps: [],
      totalChange: null,
      note: 'Insufficient History — prior or current score unavailable (coverage / YoY window).',
    }
  }
  const start = prior.score
  const end = current.score
  const steps: HealthAttributionStep[] = [
    { key: 'prior', label: 'Prior Health Score', amount: start },
  ]
  let running = start
  for (const dim of current.dimensions) {
    const p = prior.dimensions.find((d) => d.key === dim.key)
    const priorPts =
      p?.available && p.normalizedWeight > 0 ? (p.score as number) * p.normalizedWeight : null
    const curPts =
      dim.available && dim.normalizedWeight > 0 ? (dim.score as number) * dim.normalizedWeight : null
    if (priorPts == null && curPts == null) continue
    // Coverage / weight shift when one side missing
    if (priorPts == null || curPts == null) {
      const delta = (curPts ?? 0) - (priorPts ?? 0)
      steps.push({
        key: `${dim.key}_coverage`,
        label: `${dim.label} (coverage/weight)`,
        amount: money(delta),
      })
      running = money(running + delta)
      continue
    }
    const delta = money(curPts - priorPts)
    if (Math.abs(delta) < 0.05) continue
    steps.push({ key: dim.key, label: dim.label, amount: delta })
    running = money(running + delta)
  }
  const residual = money(end - running)
  if (Math.abs(residual) >= 0.05) {
    steps.push({ key: 'residual', label: 'Weight / rounding residual', amount: residual })
  }
  steps.push({ key: 'current', label: 'Current Health Score', amount: end })
  return {
    steps,
    totalChange: money(end - start),
    note: 'Dimension contributions use normalized weights on available signals only. Residual captures weight/coverage shifts — not proven churn causality.',
  }
}

function managementPriority(
  profile: CustomerRiskProfile,
  cq: ClientQualityScore,
  scoreChange: number | null,
  maxRevenue: number,
): { priority: ManagementPriority; score: number; nextStep: string } {
  const revShare = maxRevenue > 0 ? profile.revenue / maxRevenue : 0
  const bandSev =
    cq.band === 'Critical' || profile.healthBand === 'Critical'
      ? 4
      : cq.band === 'At Risk' || profile.healthBand === 'At Risk'
        ? 3
        : cq.band === 'Watchlist' || profile.healthBand === 'Watchlist'
          ? 2
          : 1
  const deteriorate = scoreChange != null && scoreChange < -5 ? Math.min(3, Math.abs(scoreChange) / 5) : 0
  const exposure = Math.min(3, profile.scenarioRevenueAtRisk / Math.max(profile.revenue * 0.2, 1))
  const conf =
    cq.lowConfidence || profile.confidence === 'Low' ? 0.7 : profile.confidence === 'Medium' ? 0.85 : 1
  const score = money((bandSev * 25 + revShare * 35 + deteriorate * 15 + exposure * 15) * conf)

  let priority: ManagementPriority
  if (cq.band === 'Healthy' && (scoreChange == null || scoreChange >= -3) && profile.riskTypes.length === 0) {
    priority = 'Healthy'
  } else if (score >= 70 || (bandSev >= 3 && revShare >= 0.08)) {
    priority = 'High Priority'
  } else if (score >= 45 || bandSev >= 3) {
    priority = 'Medium Priority'
  } else if (bandSev >= 2 || profile.riskTypes.length > 0) {
    priority = 'Monitor'
  } else {
    priority = 'Healthy'
  }

  const primary = profile.riskTypes[0] ?? profile.topRiskDriver ?? 'Review account trajectory'
  const nextStep =
    primary === 'Volume Decline' || primary === 'Revenue Decline'
      ? 'Investigate volume / revenue trend by metro & service · confirm with AM'
      : primary === 'Operational Deterioration'
        ? 'Review delivery exceptions & DSP performance by metro'
        : primary === 'Billing Exceptions'
          ? 'Open Reconciliation for open billing exceptions'
          : primary === 'Collection Risk'
            ? 'Review overdue AR aging with Collections'
            : primary === 'Margin Compression'
              ? 'Open Unit Economics for RPP / CPP drivers'
              : primary === 'Contract Renewal Risk'
                ? 'Confirm renewal timeline with Account Management'
                : 'Review Client 360 diagnosis and evidence'

  return { priority, score, nextStep }
}

export interface ClientQualityPortfolio {
  kpis: ClientQualityKpis
  watchlist: WatchlistRow[]
  matrix: ValueRiskPoint[]
  scores: Map<string, ClientQualityScore>
  profiles: CustomerRiskProfile[]
  priorScores: Map<string, ClientQualityScore>
  comparisonLabel: string | null
}

/**
 * Portfolio Client Quality rollup for Executive + Customer Intelligence.
 */
export function computeClientQualityPortfolio(
  data: DataStore,
  filters: GlobalFilters,
  healthWeights?: Parameters<typeof computeCustomerHealth>[2],
): ClientQualityPortfolio {
  const asOf = data.meta.as_of_date
  const window = customerComparisonWindow(data, filters)
  const currentRows = computeCustomerHealth(data, filters, healthWeights)
  const profiles = currentRows.map((r) => buildCustomerRiskProfile(r, data, filters))

  const scores = new Map<string, ClientQualityScore>()
  for (const r of currentRows) {
    scores.set(r.customerId, scoreClientQuality(r, { asOfDate: asOf }))
  }

  const priorScores = new Map<string, ClientQualityScore>()
  let priorComparable = false
  if (window.prior) {
    priorComparable = true
    const priorFilters: GlobalFilters = {
      ...filters,
      startPeriod: window.prior.startPeriod,
      endPeriod: window.prior.endPeriod,
    }
    const priorRows = computeCustomerHealth(data, priorFilters, healthWeights)
    for (const r of priorRows) {
      priorScores.set(r.customerId, scoreClientQuality(r, { asOfDate: asOf }))
    }
  }

  const active = profiles.filter((p) => p.revenue !== 0 || p.volume > 0)
  const healthy = active.filter((p) => {
    const s = scores.get(p.customerId)
    return s?.band === 'Healthy' || (s?.score == null && p.healthBand === 'Healthy')
  })
  const atRisk = active.filter((p) => {
    const s = scores.get(p.customerId)
    const band = s?.band === 'Insufficient Data' ? p.healthBand : s?.band
    return band != null && AT_RISK.includes(band as HealthBand)
  })

  let newlyFlagged: number | null = null
  let improving: number | null = null
  if (priorComparable) {
    newlyFlagged = 0
    improving = 0
    for (const p of active) {
      const cur = scores.get(p.customerId)
      const prior = priorScores.get(p.customerId)
      const curRisk =
        cur?.band === 'At Risk' ||
        cur?.band === 'Critical' ||
        (cur?.band === 'Insufficient Data' && AT_RISK.includes(p.healthBand))
      const priorRisk =
        prior?.band === 'At Risk' ||
        prior?.band === 'Critical' ||
        (prior == null && false)
      if (curRisk && !priorRisk && prior != null && prior.band !== 'Insufficient Data') {
        newlyFlagged += 1
      }
      if (
        cur?.score != null &&
        prior?.score != null &&
        cur.score - prior.score >= 5
      ) {
        improving += 1
      }
    }
  }

  // Revenue Exposure = current-period revenue of at-risk bands (NOT guaranteed loss; NOT scenario RaR)
  const revenueExposure = sumMoney(atRisk.map((p) => p.revenue))
  const scored = active
    .map((p) => scores.get(p.customerId)?.score)
    .filter((s): s is number => s != null)
  const avgHealthScore =
    scored.length === 0 ? null : money(scored.reduce((a, b) => a + b, 0) / scored.length)

  const maxRevenue = Math.max(...active.map((p) => p.revenue), 1)
  const watchlist: WatchlistRow[] = active
    .map((p) => {
      const cq = scores.get(p.customerId)!
      const prior = priorScores.get(p.customerId)
      const scoreChange =
        cq.score != null && prior?.score != null ? money(cq.score - prior.score) : null
      const { priority, score, nextStep } = managementPriority(p, cq, scoreChange, maxRevenue)
      return {
        customerId: p.customerId,
        customerName: p.customerName,
        segment: p.segment,
        revenue: p.revenue,
        revenueGrowth: p.revenueGrowth,
        shipmentGrowth: p.volumeGrowth,
        contributionMargin: p.contributionMargin,
        healthScore: cq.score,
        healthScoreChange: scoreChange,
        primaryRiskSignal: p.riskTypes[0] ?? p.topRiskDriver ?? 'None',
        priority,
        priorityScore: score,
        recommendedNextStep: nextStep,
        scenarioRevenueAtRisk: p.scenarioRevenueAtRisk,
        riskTypes: p.riskTypes,
        dataConfidence: cq.lowConfidence ? 'Low' : p.confidence,
      }
    })
    .sort(
      (a, b) =>
        priorityRank(b.priority) - priorityRank(a.priority) ||
        b.priorityScore - a.priorityScore ||
        b.revenue - a.revenue,
    )

  const matrix: ValueRiskPoint[] = watchlist.map((w) => ({
    customerId: w.customerId,
    customerName: w.customerName,
    x: w.revenue,
    y: w.healthScoreChange != null ? -w.healthScoreChange : w.healthScore == null ? 0 : 100 - w.healthScore,
    z: Math.max(w.scenarioRevenueAtRisk, w.revenue * 0.05),
    priority: w.priority,
    healthScore: w.healthScore,
    revenue: w.revenue,
    scenarioRaR: w.scenarioRevenueAtRisk,
  }))

  return {
    kpis: {
      activeClients: active.length,
      healthyClients: healthy.length,
      clientsAtRisk: atRisk.length,
      newlyFlaggedClients: newlyFlagged,
      revenueExposure,
      clientsImproving: improving,
      avgHealthScore,
      priorComparable,
      priorLabel: window.prior?.label ?? null,
      revenueExposureNote:
        'Sum of current-period Net Billing for clients in At Risk / Critical bands. Not guaranteed loss; distinct from Scenario Revenue at Risk.',
    },
    watchlist,
    matrix,
    scores,
    profiles,
    priorScores,
    comparisonLabel: window.prior ? `${window.current.label} vs ${window.prior.label} (${window.basisShort})` : null,
  }
}

function priorityRank(p: ManagementPriority): number {
  switch (p) {
    case 'High Priority':
      return 4
    case 'Medium Priority':
      return 3
    case 'Monitor':
      return 2
    default:
      return 1
  }
}

export function cqInsightCards(portfolio: ClientQualityPortfolio): {
  finding: string
  evidence: string
  exposure: string
  nextStep: string
}[] {
  const { kpis, watchlist } = portfolio
  const cards: { finding: string; evidence: string; exposure: string; nextStep: string }[] = []
  const high = watchlist.filter((w) => w.priority === 'High Priority')
  if (high.length > 0) {
    const top = high[0]
    cards.push({
      finding: `${high.length} high-priority client${high.length > 1 ? 's' : ''} need attention`,
      evidence: `${top.customerName}: ${top.primaryRiskSignal}${
        top.healthScoreChange != null ? ` · health Δ ${top.healthScoreChange >= 0 ? '+' : ''}${top.healthScoreChange}` : ''
      }`,
      exposure: `Watchlist revenue ${formatCompact(high.reduce((a, w) => a + w.revenue, 0))} · Scenario RaR ${formatCompact(
        high.reduce((a, w) => a + w.scenarioRevenueAtRisk, 0),
      )}`,
      nextStep: top.recommendedNextStep,
    })
  }
  if (kpis.newlyFlaggedClients != null && kpis.newlyFlaggedClients > 0) {
    cards.push({
      finding: `${kpis.newlyFlaggedClients} newly flagged vs prior comparable window`,
      evidence: kpis.priorLabel
        ? `Entered At Risk / Critical vs ${kpis.priorLabel}`
        : 'Prior window comparison',
      exposure: `At-risk band revenue exposure ${formatCompact(kpis.revenueExposure)}`,
      nextStep: 'Open Client Risk Monitor and review first-detected drivers',
    })
  }
  if (kpis.clientsImproving != null && kpis.clientsImproving > 0) {
    cards.push({
      finding: `${kpis.clientsImproving} clients improved health ≥5 pts`,
      evidence: 'CQ score change on available dimensions (YoY window)',
      exposure: 'Positive trajectory — still verify operational sustainability',
      nextStep: 'Confirm improvements in Client 360 before de-prioritizing',
    })
  }
  if (cards.length < 3 && kpis.clientsAtRisk > 0) {
    cards.push({
      finding: `${kpis.clientsAtRisk} of ${kpis.activeClients} active clients in At Risk / Critical`,
      evidence: `Portfolio CQ · Synthetic Data`,
      exposure: kpis.revenueExposureNote,
      nextStep: 'Filter Customer Portfolio to At Risk / Critical',
    })
  }
  return cards.slice(0, 3)
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n)}`
}
