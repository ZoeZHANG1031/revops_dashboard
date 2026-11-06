import { describe, expect, it } from 'vitest'
import { getDataStore } from '@/data/generate'
import { addMonths, defaultFilters, listHistoricalPeriods } from '@/lib/filters'
import { money } from '@/lib/money'
import { buildWaterfallModel, summarizeSteps, summarizeWaterfall } from '@/lib/waterfall'
import { computePipelineMovement } from './pipelineMovement'
import { computeVarianceBridge } from './varianceBridge'

describe('Forecast Variance Bridge — one canonical dataset', () => {
  const data = getDataStore()
  const hist = listHistoricalPeriods(data)
  const filters = defaultFilters(hist, hist[hist.length - 1])

  it('Existing Forecast + Σ signed drivers + residual = Comparable Actual', () => {
    const bridge = computeVarianceBridge(data, filters, 'Base', 'total')
    const s = summarizeSteps(bridge.items, ['forecast', 'actual'])
    expect(s.reconciles).toBe(true)
    // Residual = Actual − Forecast − Σ known drivers, computed once
    expect(Math.abs(money(bridge.actual - bridge.forecast - s.knownDrivers - s.residual))).toBeLessThan(0.05)
    const rows = buildWaterfallModel(bridge.items, ['forecast', 'actual'])
    let level = bridge.forecast
    for (const r of rows.filter((x) => x.type === 'delta')) {
      expect(r.cumulativeBefore).toBeCloseTo(level, 2)
      level += r.signedValue
      expect(r.upperBound - r.lowerBound).toBeCloseTo(Math.abs(r.signedValue), 2)
    }
    expect(level).toBeCloseTo(bridge.actual, 1)
  })

  it('header, chart footer and bridge report the SAME attribution and residual', () => {
    const bridge = computeVarianceBridge(data, filters, 'Base', 'total')
    const header = summarizeSteps(bridge.items, ['forecast', 'actual']) // BridgeAttribution (page header)
    const footer = summarizeWaterfall(buildWaterfallModel(bridge.items, ['forecast', 'actual'])) // chart footer
    expect(bridge.attributionCoverage).toBe(header.attributionCoverage)
    expect(footer).toEqual(header)
    expect(header.residual).toBe(bridge.items.find((i) => i.key === 'other')!.amount)
    // Mix is a known driver, never part of the residual
    const mix = bridge.items.find((i) => i.key === 'mix')!.amount
    expect(header.knownDrivers).toBeCloseTo(
      bridge.items.filter((i) => ['volume', 'price', 'mix', 'credits'].includes(i.key)).reduce((a, i) => a + i.amount, 0),
      2,
    )
    expect(mix).toBe(bridge.items.find((i) => i.key === 'mix')!.amount)
  })

  it('filter changes recompute every figure from the filtered snapshot and still foot', () => {
    for (const f of [
      { ...filters, customerIds: [data.customers[0].customer_id] },
      { ...filters, startPeriod: filters.endPeriod },
    ]) {
      const b = computeVarianceBridge(data, f, 'Base', 'total')
      const s = summarizeSteps(b.items, ['forecast', 'actual'])
      expect(s.reconciles).toBe(true)
      expect(b.attributionCoverage).toBe(s.attributionCoverage)
    }
  })
})

describe('Pipeline Movement — open pipeline stock', () => {
  const data = getDataStore()
  const hist = listHistoricalPeriods(data)
  const end = hist[hist.length - 1]

  it.each([
    ['last quarter', addMonths(end, -2), end],
    ['full year', addMonths(end, -11), end],
    ['single month', end, end],
  ])('%s: Closing = Opening + New − Won − Lost exactly; Won and Lost are outflows', (_n, start, finish) => {
    const mv = computePipelineMovement(data, { ...defaultFilters(hist, end), startPeriod: start, endPeriod: finish })
    const get = (k: string) => mv.steps.find((s) => s.key === k)?.amount ?? 0
    expect(get('new')).toBeGreaterThanOrEqual(0)
    expect(get('won')).toBeLessThanOrEqual(0)
    expect(get('lost')).toBeLessThanOrEqual(0)
    expect(Math.abs(money(get('opening') + get('new') + get('won') + get('lost') - get('closing')))).toBeLessThan(0.05)
    // Half-open boundaries ⇒ no unreconciled movement bar
    expect(mv.steps.some((s) => s.key === 'residual')).toBe(false)
    const s = summarizeSteps(mv.steps, ['opening', 'closing'])
    expect(s.reconciles).toBe(true)
    const rows = buildWaterfallModel(mv.steps, ['opening', 'closing'])
    for (const r of rows.filter((x) => x.id === 'won' || x.id === 'lost')) {
      if (r.signedValue !== 0) expect(r.direction).toBe('negative')
    }
  })
})
