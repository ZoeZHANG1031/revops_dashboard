import { describe, expect, it } from 'vitest'
import {
  buildWaterfallModel,
  clipToDomain,
  isResidualStep,
  rowFill,
  summarizeSteps,
  summarizeWaterfall,
  WATERFALL_COLORS,
  waterfallDomain,
  waterfallExportRows,
  type WaterfallStep,
} from './waterfall'

const FT = ['forecast', 'actual']

/** Start + Σ signed deltas = End, and every delta bar spans [min(before,after), max(before,after)] */
function assertCanonical(steps: WaterfallStep[], totalKeys: string[]) {
  const rows = buildWaterfallModel(steps, totalKeys)
  const s = summarizeWaterfall(rows)
  expect(s.reconciles).toBe(true)
  let level = 0
  for (const r of rows) {
    if (r.type === 'delta') {
      expect(r.cumulativeBefore).toBeCloseTo(level, 6)
      expect(r.cumulativeAfter).toBeCloseTo(r.cumulativeBefore + r.signedValue, 6)
      expect(r.lowerBound).toBeCloseTo(Math.min(r.cumulativeBefore, r.cumulativeAfter), 6)
      expect(r.upperBound).toBeCloseTo(Math.max(r.cumulativeBefore, r.cumulativeAfter), 6)
      expect(r.upperBound - r.lowerBound).toBeCloseTo(Math.abs(r.signedValue), 6)
      level = r.cumulativeAfter
    } else {
      expect(r.lowerBound).toBe(Math.min(0, r.signedValue))
      expect(r.upperBound).toBe(Math.max(0, r.signedValue))
      level = r.signedValue
    }
  }
  return { rows, s }
}

describe('canonical waterfall model', () => {
  it('1. positive deltas', () => {
    const { rows } = assertCanonical(
      [
        { key: 'forecast', label: 'Forecast', amount: 100 },
        { key: 'a', label: 'A', amount: 20 },
        { key: 'b', label: 'B', amount: 5 },
        { key: 'actual', label: 'Actual', amount: 125 },
      ],
      FT,
    )
    expect(rows[1]).toMatchObject({ lowerBound: 100, upperBound: 120, direction: 'positive' })
    expect(rows[2]).toMatchObject({ lowerBound: 120, upperBound: 125 })
  })

  it('2. negative deltas move down from the running total (never from zero)', () => {
    const { rows } = assertCanonical(
      [
        { key: 'gross', label: 'Gross', amount: 1000 },
        { key: 'discounts', label: 'Discounts', amount: -200 },
        { key: 'credits', label: 'Credits', amount: -50 },
        { key: 'net', label: 'Net', amount: 750 },
      ],
      ['gross', 'net'],
    )
    expect(rows[1]).toMatchObject({ cumulativeBefore: 1000, cumulativeAfter: 800, lowerBound: 800, upperBound: 1000, direction: 'negative' })
    expect(rows[2]).toMatchObject({ lowerBound: 750, upperBound: 800 })
    expect(rowFill(rows[1])).toBe(WATERFALL_COLORS.negative)
  })

  it('3. mixed positive and negative deltas (forecast bridge shape)', () => {
    const steps: WaterfallStep[] = [
      { key: 'forecast', label: 'Existing Customer Forecast', amount: 16_940_000 },
      { key: 'volume', label: 'Volume Impact', amount: -300_000 },
      { key: 'price', label: 'Price Impact', amount: 1_490_000 },
      { key: 'mix', label: 'Customer / Service Mix Impact', amount: 80_000 },
      { key: 'credits', label: 'Credits Impact', amount: 371_038 },
      { key: 'other', label: 'Unexplained Residual', amount: -481_038 },
      { key: 'actual', label: 'Actual Recognized Revenue', amount: 18_100_000 },
    ]
    const { rows, s } = assertCanonical(steps, FT)
    expect(rows.find((r) => r.id === 'volume')!.direction).toBe('negative')
    // Mix is a business driver, not residual
    expect(rows.find((r) => r.id === 'mix')!.isResidual).toBe(false)
    expect(rowFill(rows.find((r) => r.id === 'mix')!)).toBe(WATERFALL_COLORS.positive)
    expect(rows.find((r) => r.id === 'other')!.isResidual).toBe(true)
    expect(s.residual).toBe(-481_038)
  })

  it('4. zero deltas are neutral and keep the running total', () => {
    const { rows } = assertCanonical(
      [
        { key: 'forecast', label: 'F', amount: 50 },
        { key: 'z', label: 'Zero', amount: 0 },
        { key: 'actual', label: 'A', amount: 50 },
      ],
      FT,
    )
    expect(rows[1]).toMatchObject({ direction: 'neutral', lowerBound: 50, upperBound: 50 })
  })

  it('5. negative totals are drawn from zero downwards', () => {
    const { rows } = assertCanonical(
      [
        { key: 'start', label: 'Start', amount: -40 },
        { key: 'x', label: 'X', amount: -10 },
        { key: 'end', label: 'End', amount: -50 },
      ],
      ['start', 'end'],
    )
    expect(rows[0]).toMatchObject({ lowerBound: -40, upperBound: 0, type: 'start' })
    expect(rows[2]).toMatchObject({ lowerBound: -50, upperBound: 0, type: 'end' })
  })

  it('6. cumulative values crossing zero', () => {
    const { rows } = assertCanonical(
      [
        { key: 'start', label: 'Start', amount: 30 },
        { key: 'drop', label: 'Drop', amount: -80 },
        { key: 'rise', label: 'Rise', amount: 20 },
        { key: 'end', label: 'End', amount: -30 },
      ],
      ['start', 'end'],
    )
    expect(rows[1]).toMatchObject({ lowerBound: -50, upperBound: 30 })
    expect(rows[2]).toMatchObject({ lowerBound: -50, upperBound: -30 })
    const { domain, truncated } = waterfallDomain(rows, 'variance')
    expect(truncated).toBe(false)
    expect(domain[0]).toBeLessThanOrEqual(-50)
    expect(domain[1]).toBeGreaterThanOrEqual(30)
  })

  it('7. variance focus truncates the axis but never changes values; totals are clipped', () => {
    const steps: WaterfallStep[] = [
      { key: 'forecast', label: 'F', amount: 16_940_000 },
      { key: 'v', label: 'V', amount: -300_000 },
      { key: 'p', label: 'P', amount: 1_490_000 },
      { key: 'actual', label: 'A', amount: 18_130_000 },
    ]
    const rows = buildWaterfallModel(steps, FT)
    const before = JSON.stringify(rows)
    const { domain, truncated } = waterfallDomain(rows, 'variance')
    expect(truncated).toBe(true)
    expect(domain[0]).toBeGreaterThan(0)
    expect(domain[0]).toBeLessThan(16_640_000)
    // Delta bars stay fully inside the visible band — exact geometry
    const vis = clipToDomain(rows[1].lowerBound, rows[1].upperBound, domain)!
    expect(vis).toEqual([16_640_000, 16_940_000])
    // Totals are clipped at the floor, never re-based
    expect(clipToDomain(rows[0].lowerBound, rows[0].upperBound, domain)![0]).toBe(domain[0])
    expect(JSON.stringify(rows)).toBe(before)
  })

  it('8. full scale includes zero and shows complete totals', () => {
    const rows = buildWaterfallModel(
      [
        { key: 'forecast', label: 'F', amount: 900 },
        { key: 'v', label: 'V', amount: 100 },
        { key: 'actual', label: 'A', amount: 1000 },
      ],
      FT,
    )
    const { domain, truncated } = waterfallDomain(rows, 'full')
    expect(truncated).toBe(false)
    expect(domain[0]).toBe(0)
    expect(clipToDomain(rows[0].lowerBound, rows[0].upperBound, domain)).toEqual([0, 900])
    // Switching modes never changes the summary
    expect(summarizeWaterfall(rows)).toEqual(summarizeSteps(
      [
        { key: 'forecast', label: 'F', amount: 900 },
        { key: 'v', label: 'V', amount: 100 },
        { key: 'actual', label: 'A', amount: 1000 },
      ],
      FT,
    ))
  })

  it('9. residual is computed once and drives attribution', () => {
    const s = summarizeSteps(
      [
        { key: 'forecast', label: 'F', amount: 1000 },
        { key: 'volume', label: 'Volume', amount: 300 },
        { key: 'price', label: 'Price', amount: -100 },
        { key: 'other', label: 'Unexplained Residual', amount: -100 },
        { key: 'actual', label: 'A', amount: 1100 },
      ],
      FT,
    )
    expect(s.residual).toBe(-100)
    expect(s.knownDrivers).toBe(200)
    expect(s.attributionCoverage).toBe(80) // (300+100) / (300+100+100)
    expect(s.reconciles).toBe(true)
  })

  it('reports (does not hide) a bridge that does not foot', () => {
    const s = summarizeSteps(
      [
        { key: 'forecast', label: 'F', amount: 100 },
        { key: 'v', label: 'V', amount: 10 },
        { key: 'actual', label: 'A', amount: 120 },
      ],
      FT,
    )
    expect(s.reconciles).toBe(false)
    expect(s.footingGap).toBe(-10)
  })

  it('subtotal segments foot independently (profit bridge)', () => {
    const { rows, s } = assertCanonical(
      [
        { key: 'start', label: 'Start CP', amount: 100 },
        { key: 'volume', label: 'Volume', amount: 20 },
        { key: 'mix', label: 'Mix & Unexplained Residual', amount: -5 },
        { key: 'end_contrib', label: 'End CP', amount: 115 },
        { key: 'fixed', label: 'Fixed', amount: -40 },
        { key: 'end_op', label: 'End OP', amount: 75 },
      ],
      ['start', 'end_contrib', 'end_op'],
    )
    expect(rows[3].type).toBe('subtotal')
    expect(rows[4]).toMatchObject({ cumulativeBefore: 115, cumulativeAfter: 75 })
    expect(isResidualStep({ key: 'mix', label: 'Mix & Unexplained Residual' })).toBe(true)
    expect(s.reconciles).toBe(true)
  })

  it('export rows carry exactly the chart geometry', () => {
    const rows = buildWaterfallModel(
      [
        { key: 'forecast', label: 'F', amount: 10 },
        { key: 'v', label: 'V', amount: -3 },
        { key: 'actual', label: 'A', amount: 7 },
      ],
      FT,
    )
    const ex = waterfallExportRows(rows)
    expect(ex[1]).toMatchObject({ signed_value: -3, cumulative_before: 10, cumulative_after: 7, lower_bound: 7, upper_bound: 10, direction: 'negative' })
  })
})
