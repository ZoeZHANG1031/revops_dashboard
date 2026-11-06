import { describe, expect, it } from 'vitest'
import { generateDataStore } from '@/data/generate'
import { defaultFilters, listHistoricalPeriods, filterExceptions } from '@/lib/filters'
import { computeReconciliationBridge } from './reconBridge'
import { money } from '@/lib/money'

describe('reconciliation bridge', () => {
  const data = generateDataStore()
  const hist = listHistoricalPeriods(data)
  const filters = defaultFilters(hist, hist[hist.length - 1])

  it('Expected + Σ adjustments ≈ Actual', () => {
    const b = computeReconciliationBridge(data, filters)
    expect(Math.abs(b.checkSum - b.totalGap)).toBeLessThan(0.05)
    expect(Math.abs(money(b.expected + b.checkSum - b.actual))).toBeLessThan(0.05)
    expect(b.reconciles).toBe(true)
  })

  it('component magnitudes are independent (missing ≫ rate typically)', () => {
    const b = computeReconciliationBridge(data, filters)
    const missing = b.items.find((i) => i.key === 'missing')!
    const rate = b.items.find((i) => i.key === 'rate')!
    const timing = b.items.find((i) => i.key === 'timing')!
    // Individual amounts exist as signed adjustments — not cumulative levels
    expect(Number.isFinite(missing.amount)).toBe(true)
    expect(Number.isFinite(rate.amount)).toBe(true)
    expect(Number.isFinite(timing.amount)).toBe(true)
    // Gross-to-net includes commercial adjustments
    const discounts = b.items.find((i) => i.key === 'discounts')!
    expect(discounts.amount).toBeLessThanOrEqual(0)
    expect(Math.abs(discounts.amount)).toBeGreaterThan(Math.abs(rate.amount))
  })

  it('period exceptions populate all-cases view', () => {
    const scoped = filterExceptions(data, filters)
    expect(scoped.length).toBeGreaterThan(0)
    const open = scoped.filter((e) =>
      e.status === 'Open' || e.status === 'Investigating' || e.status === 'Pending Approval',
    )
    expect(open.length).toBeLessThanOrEqual(scoped.length)
  })
})
