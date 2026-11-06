/** Business-direction semantics for KPI coloring (not "green = positive number"). */

export type KpiPolarity = 'higher_better' | 'lower_better' | 'neutral'

export const KPI_POLARITY: Record<string, KpiPolarity> = {
  recognized_revenue: 'higher_better',
  forecast_revenue: 'neutral',
  revenue_variance: 'higher_better',
  net_billed_revenue: 'higher_better',
  contribution_profit: 'higher_better',
  contribution_margin: 'higher_better',
  revenue_at_risk: 'lower_better',
  unbilled_exposure: 'lower_better',
  bookings: 'higher_better',
  cash_collections: 'higher_better',
  billing_accuracy: 'higher_better',
  overdue_ar: 'lower_better',
  claims_cost: 'lower_better',
  otd: 'higher_better',
  failed_delivery_rate: 'lower_better',
  open_recoverable_leakage: 'lower_better',
  scenario_revenue_at_risk: 'lower_better',
  forecast_variance_existing: 'higher_better',
}

export type SemanticTone = 'positive' | 'negative' | 'neutral' | 'warning'

/** Interpret a delta given polarity. For lower_better, a negative delta is positive. */
export function interpretDelta(
  delta: number | null | undefined,
  polarity: KpiPolarity,
): SemanticTone {
  if (delta == null || delta === 0 || polarity === 'neutral') return 'neutral'
  if (polarity === 'higher_better') return delta > 0 ? 'positive' : 'negative'
  return delta < 0 ? 'positive' : 'negative'
}

export function interpretLevel(
  value: number,
  thresholds: { good: number; warn: number },
  polarity: KpiPolarity,
): SemanticTone {
  if (polarity === 'higher_better') {
    if (value >= thresholds.good) return 'positive'
    if (value >= thresholds.warn) return 'warning'
    return 'negative'
  }
  if (polarity === 'lower_better') {
    if (value <= thresholds.good) return 'positive'
    if (value <= thresholds.warn) return 'warning'
    return 'negative'
  }
  return 'neutral'
}

export function toneTextClass(tone: SemanticTone): string {
  if (tone === 'positive') return 'text-success'
  if (tone === 'negative') return 'text-danger'
  if (tone === 'warning') return 'text-warning'
  return 'text-ink-muted'
}

export function toneBorderClass(tone: SemanticTone): string {
  if (tone === 'positive') return 'border-l-success'
  if (tone === 'negative') return 'border-l-danger'
  if (tone === 'warning') return 'border-l-warning'
  return 'border-l-brand-500'
}

export function toneBgClass(tone: SemanticTone): string {
  if (tone === 'positive') return 'bg-brand-50 text-brand-800'
  if (tone === 'negative') return 'bg-red-50 text-danger'
  if (tone === 'warning') return 'bg-amber-50 text-warning'
  return 'bg-slate-50 text-ink-muted'
}
