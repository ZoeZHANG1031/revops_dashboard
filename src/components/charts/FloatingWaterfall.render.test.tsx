import { fireEvent, render } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildWaterfallModel, waterfallDomain, type WaterfallStep } from '@/lib/waterfall'
import { FloatingWaterfall } from './FloatingWaterfall'

/**
 * Rendered-geometry test: give the chart a real size in jsdom, then check every drawn bar against
 * the chart's own linear Y scale (recovered from two bars). Bar bottom/top must equal the
 * canonical lower/upper bounds (subject only to clipping).
 */
beforeAll(() => {
  globalThis.ResizeObserver = class {
    cb: ResizeObserverCallback
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb
    }
    observe(el: Element) {
      this.cb([{ target: el, contentRect: { width: 800, height: 320 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 320 })
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ width: 800, height: 320, top: 0, left: 0, right: 800, bottom: 320, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
})

function drawnBars(container: HTMLElement) {
  return [...container.querySelectorAll('rect[data-row]')].map((el) => ({
    id: el.getAttribute('data-row')!,
    lower: Number(el.getAttribute('data-lower')),
    upper: Number(el.getAttribute('data-upper')),
    top: Number(el.getAttribute('y')),
    bottom: Number(el.getAttribute('y')) + Number(el.getAttribute('height')),
  }))
}

/** Recover the linear pixel scale from two delta bars and verify all bars against it */
function checkGeometry(container: HTMLElement, steps: WaterfallStep[], totalKeys: string[], mode: 'variance' | 'full') {
  const bars = drawnBars(container)
  const rows = buildWaterfallModel(steps, totalKeys)
  const { domain } = waterfallDomain(rows, mode)
  expect(bars.length).toBeGreaterThan(0)
  // Linear map: px = a + b·value, from the first bar's (clipped) lower/upper
  const clip = (v: number) => Math.min(Math.max(v, domain[0]), domain[1])
  const ref = bars.find((b) => clip(b.upper) - clip(b.lower) > 0)!
  const b = (ref.top - ref.bottom) / (clip(ref.upper) - clip(ref.lower))
  const a = ref.bottom - b * clip(ref.lower)
  for (const bar of bars) {
    const row = rows.find((r) => r.id === bar.id)!
    expect(bar.lower).toBeCloseTo(row.lowerBound, 4)
    expect(bar.upper).toBeCloseTo(row.upperBound, 4)
    expect(bar.bottom).toBeCloseTo(a + b * clip(row.lowerBound), 0)
    // top may be widened to ≥1px for tiny bars
    expect(Math.min(bar.top, bar.bottom - 1)).toBeLessThanOrEqual(a + b * clip(row.upperBound) + 0.6)
    if (row.type === 'delta') {
      // visible height = |signedValue| (no clipping for deltas inside the band)
      expect(Math.abs(bar.bottom - bar.top)).toBeCloseTo(Math.max(1, Math.abs(b * (clip(row.upperBound) - clip(row.lowerBound)))), 0)
    }
  }
  return bars
}

const forecastBridge: WaterfallStep[] = [
  { key: 'forecast', label: 'Existing Customer Forecast', amount: 16_940_000 },
  { key: 'volume', label: 'Volume Impact', amount: -300_000 },
  { key: 'price', label: 'Price Impact', amount: 1_490_000 },
  { key: 'mix', label: 'Customer / Service Mix Impact', amount: 80_000 },
  { key: 'credits', label: 'Credits Impact', amount: 371_038 },
  { key: 'other', label: 'Unexplained Residual', amount: -481_038 },
  { key: 'actual', label: 'Actual Recognized Revenue', amount: 18_100_000 },
]

describe('FloatingWaterfall rendered geometry', () => {
  it('variance focus: delta bars float between cumulative levels (not from the axis floor)', () => {
    const { container, getByText } = render(<FloatingWaterfall steps={forecastBridge} totalKeys={['forecast', 'actual']} />)
    expect(getByText('Axis truncated')).toBeTruthy()
    const bars = checkGeometry(container, forecastBridge, ['forecast', 'actual'], 'variance')
    const volume = bars.find((x) => x.id === 'volume')!
    const forecast = bars.find((x) => x.id === 'forecast')!
    // Volume (−$300K) is a short bar hanging below the forecast level — far shorter than the total
    expect(volume.bottom - volume.top).toBeLessThan((forecast.bottom - forecast.top) / 2)
    expect(volume.top).toBeCloseTo(forecast.top, 0)
  })

  it('full scale: totals span from zero; same values', () => {
    const { container, getByText } = render(<FloatingWaterfall steps={forecastBridge} totalKeys={['forecast', 'actual']} />)
    fireEvent.click(getByText('Full scale'))
    checkGeometry(container, forecastBridge, ['forecast', 'actual'], 'full')
  })

  it('connectors and signed labels are drawn', () => {
    const { container } = render(<FloatingWaterfall steps={forecastBridge} totalKeys={['forecast', 'actual']} />)
    expect(container.querySelectorAll('.waterfall-layer line').length).toBeGreaterThanOrEqual(forecastBridge.length - 1)
    const labels = [...container.querySelectorAll('.waterfall-layer text')].map((t) => t.textContent)
    expect(labels).toContain('−$300K')
    expect(labels).toContain('+$1.49M')
    expect(labels).toContain('−$481K')
  })

  it('crossing zero renders without truncation', () => {
    const steps: WaterfallStep[] = [
      { key: 'start', label: 'Start', amount: 30_000 },
      { key: 'drop', label: 'Drop', amount: -80_000 },
      { key: 'rise', label: 'Rise', amount: 20_000 },
      { key: 'end', label: 'End', amount: -30_000 },
    ]
    const { container, queryByText } = render(<FloatingWaterfall steps={steps} totalKeys={['start', 'end']} />)
    expect(queryByText('Axis truncated')).toBeNull()
    checkGeometry(container, steps, ['start', 'end'], 'variance')
  })
})
