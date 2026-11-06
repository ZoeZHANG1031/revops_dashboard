import { describe, expect, it } from 'vitest'
import { computeCompanyOverview } from '@/calc/companyOverview'
import { getDataStore } from '@/data/generate'
import { defaultFilters, listHistoricalPeriods, listPeriods } from '@/lib/filters'

describe('service mix shares', () => {
  const data = getDataStore()
  const periods = listPeriods(data)
  const hist = listHistoricalPeriods(data)
  const filters = defaultFilters(periods, hist[hist.length - 1])

  it('share values stay in 0–100 and sum ≈ 100% with no service filter', () => {
    const overview = computeCompanyOverview(data, filters)
    for (const s of overview.services) {
      expect(s.revenueShare).not.toBeNull()
      expect(s.revenueShare!).toBeGreaterThanOrEqual(0)
      expect(s.revenueShare!).toBeLessThanOrEqual(100.05)
      expect(Number.isFinite(s.revenueShare!)).toBe(true)
    }
    expect(overview.serviceMixMeta.shareSumRevenue).toBeGreaterThan(99)
    expect(overview.serviceMixMeta.shareSumRevenue).toBeLessThan(101)
    expect(overview.serviceMixMeta.shareSumShipments).toBeGreaterThan(99)
    expect(overview.serviceMixMeta.shareSumShipments).toBeLessThan(101)
  })

  it('Economy service filter does not inflate other-service shares above 100%', () => {
    const economy = { ...filters, serviceTypes: ['Economy' as const] }
    const overview = computeCompanyOverview(data, economy)
    expect(overview.serviceMixMeta.selectedServiceFilter).toBe('Economy')
    expect(overview.serviceMixMeta.selectedServicePerformance).not.toBeNull()
    for (const s of overview.services) {
      expect(s.revenueShare ?? 0).toBeLessThanOrEqual(100.05)
      expect(s.shipmentShare ?? 0).toBeLessThanOrEqual(100.05)
      expect(Number.isFinite(s.revenueShare ?? 0)).toBe(true)
    }
    expect(overview.serviceMixMeta.shareSumRevenue).toBeGreaterThan(99)
    expect(overview.serviceMixMeta.shareSumRevenue).toBeLessThan(101)
  })

  it('empty data does not produce NaN/Infinity shares', () => {
    const emptyPeriod = {
      ...filters,
      startPeriod: '2099-01',
      endPeriod: '2099-01',
    }
    const overview = computeCompanyOverview(data, emptyPeriod)
    for (const s of overview.services) {
      if (s.revenueShare != null) {
        expect(Number.isFinite(s.revenueShare)).toBe(true)
      }
    }
  })
})
