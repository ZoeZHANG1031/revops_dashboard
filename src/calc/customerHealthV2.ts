import type { CustomerHealthRow } from '@/calc/customerHealth'
import { engagementRiskSignal } from '@/calc/customerEngagement'

export interface HealthV2Weights {
  revenueTrend: number
  volumeUtilization: number
  contributionMargin: number
  delivery: number
  billingQuality: number
  collections: number
  contractRenewal: number
  engagement: number
}

export const DEFAULT_HEALTH_V2_WEIGHTS: HealthV2Weights = {
  revenueTrend: 0.18,
  volumeUtilization: 0.14,
  contributionMargin: 0.16,
  delivery: 0.14,
  billingQuality: 0.12,
  collections: 0.1,
  contractRenewal: 0.08,
  engagement: 0.08,
}

export interface HealthV2Components {
  revenueTrend: number | null
  volumeUtilization: number | null
  contributionMargin: number | null
  delivery: number | null
  billingQuality: number | null
  collections: number | null
  contractRenewal: number | null
  engagement: number | null
}

export interface HealthV2Result {
  score: number
  band: 'Healthy' | 'Watchlist' | 'At Risk' | 'Critical'
  dataCompleteness: number
  weightsUsed: Record<keyof HealthV2Weights, number>
  components: HealthV2Components
  explanations: string[]
}

function band(score: number): HealthV2Result['band'] {
  if (score >= 85) return 'Healthy'
  if (score >= 70) return 'Watchlist'
  if (score >= 50) return 'At Risk'
  return 'Critical'
}

function contractRenewalComponent(daysUntil: number | null): number | null {
  if (daysUntil == null) return null
  if (daysUntil < 0) return 25
  if (daysUntil <= 30) return 40
  if (daysUntil <= 90) return 58
  if (daysUntil <= 180) return 75
  return 90
}

export function componentsFromHealthRow(
  row: CustomerHealthRow,
  extras?: { engagementScore?: number | null; daysUntilRenewal?: number | null },
): HealthV2Components {
  const days =
    extras?.daysUntilRenewal ??
    (row.contractRenewalDate
      ? Math.round(
          (Date.parse(row.contractRenewalDate) -
            Date.parse(new Date().toISOString().slice(0, 10))) /
            86400000,
        )
      : null)

  const engagement =
    extras?.engagementScore != null
      ? extras.engagementScore
      : null

  return {
    revenueTrend: row.revenueGrowth != null ? Math.max(0, Math.min(100, 60 + row.revenueGrowth * 1.2)) : null,
    volumeUtilization: row.volumeScore,
    contributionMargin: row.profitScore,
    delivery: row.deliveryScore,
    billingQuality: row.issueScore,
    collections: row.paymentScore,
    contractRenewal: contractRenewalComponent(days),
    engagement,
  }
}

/** Renormalize weights over observed components only; engagement omitted when null. */
export function computeHealthV2(
  components: HealthV2Components,
  weights: HealthV2Weights = DEFAULT_HEALTH_V2_WEIGHTS,
): HealthV2Result {
  const keys = Object.keys(weights) as (keyof HealthV2Weights)[]
  const observed = keys.filter((k) => components[k] != null)
  const weightSum = observed.reduce((a, k) => a + weights[k], 0)
  const weightsUsed = {} as Record<keyof HealthV2Weights, number>
  keys.forEach((k) => {
    weightsUsed[k] = observed.includes(k) ? weights[k] / (weightSum || 1) : 0
  })

  let score = 0
  observed.forEach((k) => {
    score += (components[k] as number) * weightsUsed[k]
  })

  const dataCompleteness = Math.round((observed.length / keys.length) * 100)

  return {
    score: Math.round(score),
    band: band(score),
    dataCompleteness,
    weightsUsed,
    components,
    explanations: explainHealthV2(components, weightsUsed),
  }
}

export function explainHealthV2(
  components: HealthV2Components,
  weightsUsed: Record<keyof HealthV2Weights, number>,
): string[] {
  const lines: string[] = []
  ;(Object.keys(components) as (keyof HealthV2Components)[]).forEach((k) => {
    const v = components[k]
    if (v == null) {
      lines.push(`${k}: N/A (excluded from weight renormalization)`)
      return
    }
    const w = weightsUsed[k]
    lines.push(`${k}: ${Math.round(v)} × ${(w * 100).toFixed(1)}% weight`)
  })
  return lines
}

export function computeHealthV2ForCustomer(
  row: CustomerHealthRow,
  customerId: string,
  asOfDate: string,
  daysUntilRenewal?: number | null,
): HealthV2Result {
  const engagement = engagementRiskSignal(customerId, asOfDate)
  const components = componentsFromHealthRow(row, {
    engagementScore: engagement,
    daysUntilRenewal,
  })
  return computeHealthV2(components)
}
