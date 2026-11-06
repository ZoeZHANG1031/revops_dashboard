import type { CustomerHealthRow } from '@/calc/customerHealth'
import type { CustomerMarginDiagnosis } from '@/calc/customerMarginBridge'
import type { CustomerRevenueBridge } from '@/calc/customerRevenueBridge'
import type { RiskType } from '@/calc/customerRisk'
import { money } from '@/lib/money'

export interface DiagnosisDriver {
  name: string
  currentValue: number | string | null
  priorCompare: string
  healthImpact: 'high' | 'medium' | 'low'
  detailKey: string
}

export interface CustomerDiagnosis {
  summary: string
  topDrivers: DiagnosisDriver[]
}

function impactFromScore(score: number): DiagnosisDriver['healthImpact'] {
  if (score < 45) return 'high'
  if (score < 60) return 'medium'
  return 'low'
}

export function buildCustomerDiagnosis(
  healthRow: CustomerHealthRow,
  revBridge: CustomerRevenueBridge,
  margin: CustomerMarginDiagnosis,
  riskTypes: RiskType[],
  extras?: { industry?: string },
): CustomerDiagnosis {
  const name = healthRow.customerName
  const industry = extras?.industry ?? healthRow.segment

  const healthComponents = [
    { name: 'Volume trend', score: healthRow.volumeScore, key: 'volume' },
    { name: 'Delivery', score: healthRow.deliveryScore, key: 'delivery' },
    { name: 'Profitability', score: healthRow.profitScore, key: 'margin' },
    { name: 'Payment / collections', score: healthRow.paymentScore, key: 'collections' },
    { name: 'Billing quality', score: healthRow.issueScore, key: 'billing' },
  ].sort((a, b) => a.score - b.score)

  const bridgeImpacts = [
    { name: 'Revenue volume', amount: revBridge.volumeImpact, key: 'rev_volume' },
    { name: 'Revenue price/mix', amount: revBridge.priceImpact + revBridge.serviceMixImpact + revBridge.geoMixImpact, key: 'rev_price_mix' },
    { name: 'Credits', amount: revBridge.creditsImpact, key: 'credits' },
    { name: 'Margin volume', amount: margin.volumeImpact, key: 'margin_volume' },
    { name: 'Margin yield', amount: margin.yieldImpact, key: 'margin_yield' },
    { name: 'Variable cost (DSP)', amount: margin.dspImpact, key: 'dsp' },
  ]
    .filter((b) => b.amount < 0)
    .sort((a, b) => a.amount - b.amount)

  const weakest = healthComponents.slice(0, 3)
  const negativeBridge = bridgeImpacts.slice(0, 3)

  const topDrivers: DiagnosisDriver[] = []

  for (const w of weakest) {
    topDrivers.push({
      name: w.name,
      currentValue: w.score,
      priorCompare: 'Health sub-score (0–100)',
      healthImpact: impactFromScore(w.score),
      detailKey: w.key,
    })
  }
  for (const b of negativeBridge) {
    if (topDrivers.length >= 6) break
    topDrivers.push({
      name: b.name,
      currentValue: money(b.amount),
      priorCompare: 'Period-over-period bridge impact',
      healthImpact: Math.abs(b.amount) > 50_000 ? 'high' : 'medium',
      detailKey: b.key,
    })
  }

  // Prefer delivered-% signal for narrative (score uses on-time internally)
  const deliveredPct = healthRow.deliveryPerformance
  const deliveryHealthy =
    (deliveredPct != null && deliveredPct >= 96) || healthRow.deliveryScore >= 70
  const commercialWeak =
    healthRow.profitScore < 55 ||
    healthRow.volumeScore < 55 ||
    (healthRow.revenueGrowth != null && healthRow.revenueGrowth < -5)
  const billingWeak = healthRow.issueScore < 55

  const riskSnippet =
    riskTypes.length > 0 ? ` Active risk tags: ${riskTypes.slice(0, 4).join(', ')}.` : ''

  let priority = ''
  if (deliveryHealthy && commercialWeak) {
    priority =
      deliveredPct != null
        ? ` Delivery completion remains solid at ${deliveredPct.toFixed(1)}%, so prioritize commercial revenue, pricing/yield, and billing factors before assuming network quality is the root cause.`
        : ' Delivery remains relatively stable, so prioritize commercial repricing, volume retention, and billing resolution over network interventions.'
  } else if (billingWeak && !commercialWeak) {
    priority = ' Focus on billing integrity and collections while volume and margin hold.'
  } else if (!deliveryHealthy) {
    priority = ' Operational performance is a leading concern alongside commercial metrics.'
  }

  const growthText =
    healthRow.revenueGrowth != null
      ? ` Revenue is ${healthRow.revenueGrowth >= 0 ? 'up' : 'down'} ${Math.abs(healthRow.revenueGrowth).toFixed(1)}% vs the prior comparable window.`
      : ' Revenue trend is not comparable to prior period.'

  const marginText =
    healthRow.contributionMargin != null
      ? ` Contribution margin is ${healthRow.contributionMargin.toFixed(1)}%.`
      : ''

  const summary =
    `${name} (${industry}) is in the ${healthRow.healthBand} band with health score ${healthRow.healthScore}.${growthText}${marginText}` +
    ` Weakest pillars are ${weakest.map((w) => w.name.toLowerCase()).join(', ')}.` +
    priority +
    riskSnippet

  return {
    summary,
    topDrivers: topDrivers.slice(0, 6),
  }
}
