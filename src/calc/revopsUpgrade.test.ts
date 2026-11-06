import { describe, expect, it } from 'vitest'
import { computeCustomerRevenueChange } from '@/calc/customerRevenueChange'
import { computeVarianceBridge } from '@/calc/varianceBridge'
import { getDataStore } from '@/data/generate'
import { defaultFilters, listHistoricalPeriods, listPeriods } from '@/lib/filters'
import { money } from '@/lib/money'

describe('revops upgrade P0 calcs', () => {
  const data = getDataStore()
  const periods = listPeriods(data)
  const hist = listHistoricalPeriods(data)
  const filters = defaultFilters(periods, hist[hist.length - 1])

  it('variance bridge telescopes and exposes attribution quality fields', () => {
    const b = computeVarianceBridge(data, filters, 'Base', 'total')
    expect(money(b.checkSum)).toBe(money(b.actual - b.forecast))
    expect(b.attributionCoverage == null || Number.isFinite(b.attributionCoverage)).toBe(true)
    expect(typeof b.attributionQualityWarning).toBe('boolean')
    expect(b.attributionNote.length).toBeGreaterThan(10)
  })

  it('customer revenue change volume+price+residual equals Δ revenue when comparable', () => {
    const cust = data.customers[0]?.customer_id
    expect(cust).toBeTruthy()
    const d = computeCustomerRevenueChange(data, filters, cust!)
    if (d.comparable) {
      expect(money(d.checkSum)).toBe(money(d.revenueChange))
      expect(money(d.volumeImpact + d.priceImpact + d.residual)).toBe(money(d.revenueChange))
    } else {
      expect(d.note.toLowerCase()).toContain('insufficient')
    }
  })
})
