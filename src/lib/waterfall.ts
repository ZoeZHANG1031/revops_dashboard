/**
 * Canonical waterfall (bridge) model — the ONLY source for chart geometry, labels, tooltips,
 * connector lines, header/footer summaries and exports.
 *
 *   delta:  cumulativeAfter = cumulativeBefore + signedValue
 *           lowerBound = min(before, after), upperBound = max(before, after)
 *   total:  a full cumulative level drawn from 0 (lowerBound = min(0, v), upperBound = max(0, v))
 *
 * Start + Σ signed deltas = End must hold; any gap is reported, never hidden.
 */

export interface WaterfallStep {
  key: string
  label: string
  amount: number
  /** Optional override; honored only when respectStepColors is set */
  color?: string
  /** Compact X-axis label; full label stays in the tooltip */
  shortLabel?: string
  note?: string
  /** Explicitly mark a residual / unexplained component (otherwise detected from key/label) */
  isResidual?: boolean
}

export type WaterfallRowType = 'start' | 'delta' | 'subtotal' | 'end'
export type WaterfallDirection = 'positive' | 'negative' | 'neutral'
export type WaterfallScaleMode = 'variance' | 'full'

export interface WaterfallRow {
  id: string
  label: string
  shortLabel: string
  type: WaterfallRowType
  signedValue: number
  cumulativeBefore: number
  cumulativeAfter: number
  lowerBound: number
  upperBound: number
  direction: WaterfallDirection
  isResidual: boolean
  sourceMetric: string
  note?: string
  color?: string
}

export interface WaterfallSummary {
  start: number | null
  end: number | null
  /** Σ signed deltas between the first and last total */
  deltaSum: number
  /** Σ signed residual deltas (computed once, here) */
  residual: number
  /** Σ signed non-residual (known driver) deltas */
  knownDrivers: number
  /** start + Σ deltas − end (should be 0) */
  footingGap: number | null
  reconciles: boolean
  /** |known drivers| ÷ (|known drivers| + |residual|) × 100 */
  attributionCoverage: number | null
}

export const WATERFALL_COLORS = {
  start: '#123C35', // dark green
  end: '#059669', // emerald
  subtotal: '#2E6B5E',
  positive: '#2F9E6B', // green
  negative: '#C44536', // red
  residual: '#E58A2B', // orange (direction still shown by position + sign)
  zero: '#9bb0a8',
} as const

const RESIDUAL_KEYS = new Set(['other', 'residual', 'unexplained', 'unresolved', 'plug'])
const EPS = 1e-9
const r2 = (v: number) => Math.round(v * 100) / 100

export function isResidualStep(step: Pick<WaterfallStep, 'key' | 'label' | 'isResidual'>): boolean {
  if (step.isResidual != null) return step.isResidual
  if (RESIDUAL_KEYS.has(step.key)) return true
  const l = step.label.toLowerCase()
  return l.includes('residual') || l.includes('unexplained')
}

export function buildWaterfallModel(steps: WaterfallStep[], totalKeys: string[]): WaterfallRow[] {
  const isTotal = (k: string) => totalKeys.includes(k)
  let level = 0
  return steps.map((step, i) => {
    const shortLabel = step.shortLabel ?? step.label
    if (isTotal(step.key)) {
      const first = steps.findIndex((s) => isTotal(s.key)) === i
      const last = [...steps].reverse().findIndex((s) => isTotal(s.key)) === steps.length - 1 - i
      level = step.amount
      return {
        id: step.key,
        label: step.label,
        shortLabel,
        type: first ? 'start' : last ? 'end' : 'subtotal',
        signedValue: step.amount,
        cumulativeBefore: 0,
        cumulativeAfter: step.amount,
        lowerBound: Math.min(0, step.amount),
        upperBound: Math.max(0, step.amount),
        direction: Math.abs(step.amount) < EPS ? 'neutral' : step.amount > 0 ? 'positive' : 'negative',
        isResidual: false,
        sourceMetric: step.key,
        note: step.note,
        color: step.color,
      }
    }
    const before = level
    const after = before + step.amount
    level = after
    return {
      id: step.key,
      label: step.label,
      shortLabel,
      type: 'delta',
      signedValue: step.amount,
      cumulativeBefore: before,
      cumulativeAfter: after,
      lowerBound: Math.min(before, after),
      upperBound: Math.max(before, after),
      direction: Math.abs(step.amount) < EPS ? 'neutral' : step.amount > 0 ? 'positive' : 'negative',
      isResidual: isResidualStep(step),
      sourceMetric: step.key,
      note: step.note,
      color: step.color,
    }
  })
}

export function summarizeWaterfall(rows: WaterfallRow[]): WaterfallSummary {
  const totals = rows.filter((r) => r.type !== 'delta')
  const startRow = totals[0]
  const endRow = totals[totals.length - 1]
  const startIdx = startRow ? rows.indexOf(startRow) : -1
  const endIdx = endRow ? rows.indexOf(endRow) : -1
  // Deltas after the last subtotal before end only reconcile against end when no subtotal resets;
  // reconcile against the last total preceding them, segment by segment.
  let gap = 0
  let level: number | null = null
  for (const r of rows) {
    if (r.type === 'delta') {
      if (level != null) level += r.signedValue
      continue
    }
    if (level != null && r.type !== 'start') gap += level - r.signedValue
    level = r.signedValue
  }
  const deltas = rows.filter((r, i) => r.type === 'delta' && i > startIdx && (endIdx < 0 || i < endIdx))
  const residual = r2(deltas.filter((r) => r.isResidual).reduce((a, r) => a + r.signedValue, 0))
  const known = r2(deltas.filter((r) => !r.isResidual).reduce((a, r) => a + r.signedValue, 0))
  const knownAbs = deltas.filter((r) => !r.isResidual).reduce((a, r) => a + Math.abs(r.signedValue), 0)
  const residAbs = deltas.filter((r) => r.isResidual).reduce((a, r) => a + Math.abs(r.signedValue), 0)
  const footingGap = startRow && endRow && startRow !== endRow ? r2(gap) : null
  return {
    start: startRow?.signedValue ?? null,
    end: endRow && endRow !== startRow ? endRow.signedValue : null,
    deltaSum: r2(deltas.reduce((a, r) => a + r.signedValue, 0)),
    residual,
    knownDrivers: known,
    footingGap,
    reconciles: footingGap != null && Math.abs(footingGap) < 0.05,
    attributionCoverage:
      knownAbs + residAbs === 0 ? null : Math.round((knownAbs / (knownAbs + residAbs)) * 1000) / 10,
  }
}

/** Convenience for callers that only need the summary (page headers, footers, exports) */
export function summarizeSteps(steps: WaterfallStep[], totalKeys: string[]): WaterfallSummary {
  return summarizeWaterfall(buildWaterfallModel(steps, totalKeys))
}

/**
 * Y-axis domain. Full scale always includes 0. Variance focus zooms to the band of cumulative
 * levels (totals are then clipped at the axis floor and the axis is flagged as truncated).
 * The domain never alters row values — only what is visible.
 */
export function waterfallDomain(
  rows: WaterfallRow[],
  mode: WaterfallScaleMode,
): { domain: [number, number]; truncated: boolean } {
  if (!rows.length) return { domain: [0, 1], truncated: false }
  const levels = rows.flatMap((r) => (r.type === 'delta' ? [r.cumulativeBefore, r.cumulativeAfter] : [r.cumulativeAfter]))
  let lo = Math.min(...levels)
  let hi = Math.max(...levels)
  if (mode === 'full') {
    lo = Math.min(0, lo)
    hi = Math.max(0, hi)
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.08
    return { domain: [lo < 0 ? lo - pad : 0, hi > 0 ? hi + pad : 0], truncated: false }
  }
  const span = hi - lo
  const pad = Math.max(span * 0.18, Math.abs(hi) * 0.01, 1)
  let min = lo - pad
  let max = hi + pad
  // If zero is within (or close to) the band, include it — no need to truncate
  if (lo <= 0 && hi >= 0) return { domain: [lo - pad, hi + pad], truncated: false }
  if (lo > 0 && min <= 0) min = 0
  if (hi < 0 && max >= 0) max = 0
  return { domain: [min, max], truncated: min > 0 || max < 0 }
}

/** Visible pixel span of a row after clipping to the plot (used by renderer and tests) */
export function clipToDomain(lower: number, upper: number, domain: [number, number]): [number, number] | null {
  const a = Math.max(lower, domain[0])
  const b = Math.min(upper, domain[1])
  if (b < a) return null
  return [a, b]
}

export function rowFill(r: WaterfallRow, respectStepColors = false): string {
  if (respectStepColors && r.color) return r.color
  if (r.type === 'start') return WATERFALL_COLORS.start
  if (r.type === 'end') return WATERFALL_COLORS.end
  if (r.type === 'subtotal') return WATERFALL_COLORS.subtotal
  if (r.isResidual) return WATERFALL_COLORS.residual
  if (r.direction === 'positive') return WATERFALL_COLORS.positive
  if (r.direction === 'negative') return WATERFALL_COLORS.negative
  return WATERFALL_COLORS.zero
}

/** Axis tick formatter whose precision follows the visible span (avoids duplicate "$18M, $18M" ticks) */
export function axisTickFormatter(domain: [number, number]): (v: number) => string {
  const span = Math.abs(domain[1] - domain[0])
  const mag = Math.max(Math.abs(domain[0]), Math.abs(domain[1]))
  return (v: number) => {
    const sign = v < 0 ? '−' : ''
    const a = Math.abs(v)
    if (mag >= 1_000_000) {
      const d = span < 2_000_000 ? 2 : span < 20_000_000 ? 1 : 0
      return `${sign}$${(a / 1_000_000).toFixed(d)}M`
    }
    if (mag >= 1_000) {
      const d = span < 2_000 ? 2 : span < 20_000 ? 1 : 0
      return `${sign}$${(a / 1_000).toFixed(d)}K`
    }
    return `${sign}$${a.toFixed(span < 20 ? 2 : 0)}`
  }
}

/** Compact money for bar labels: $1.49M, $481K, $300K */
export function formatBridgeMoney(value: number): string {
  const sign = value < 0 ? '−' : ''
  const a = Math.abs(value)
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)}M`
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(a >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`
  return `${sign}$${Math.round(a)}`
}

export function signedLabel(r: WaterfallRow, fmt: (v: number) => string): string {
  if (r.type !== 'delta') return fmt(r.signedValue)
  if (Math.abs(r.signedValue) < EPS) return fmt(0)
  return `${r.signedValue > 0 ? '+' : '−'}${fmt(Math.abs(r.signedValue))}`
}

/** Rows for CSV export — same numbers the chart draws */
export function waterfallExportRows(rows: WaterfallRow[]) {
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    type: r.type,
    signed_value: r2(r.signedValue),
    cumulative_before: r2(r.cumulativeBefore),
    cumulative_after: r2(r.cumulativeAfter),
    lower_bound: r2(r.lowerBound),
    upper_bound: r2(r.upperBound),
    direction: r.direction,
    is_residual: r.isResidual,
    source_metric: r.sourceMetric,
  }))
}
