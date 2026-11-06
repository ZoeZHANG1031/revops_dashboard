import { describe, expect, it } from 'vitest'
import { computeCompanyOverview } from '@/calc/companyOverview'
import { computeSharedMetrics } from '@/calc/metricRegistry'
import { METRO_DEFINITIONS } from '@/data/metros'
import { getDataStore } from '@/data/generate'
import { defaultFilters, listHistoricalPeriods, listPeriods } from '@/lib/filters'
import { sumMoney } from '@/lib/money'

describe('company overview', { timeout: 60000 }, () => {
  const data = getDataStore()
  const periods = listPeriods(data)
  const hist = listHistoricalPeriods(data)
  const filters = defaultFilters(periods, hist[hist.length - 1])

  it('matches shared recognized revenue and net billing under same filters', () => {
    const overview = computeCompanyOverview(data, filters)
    const shared = computeSharedMetrics(data, filters)
    expect(Math.abs(overview.sharedCheck.recognizedRevenue - shared.recognizedRevenue)).toBeLessThan(
      0.05,
    )
    expect(Math.abs(overview.sharedCheck.netBilledRevenue - shared.netBilledRevenue)).toBeLessThan(
      0.05,
    )
  })

  it('uses explicit metro catalog coordinates (not random)', () => {
    const overview = computeCompanyOverview(data, filters)
    expect(overview.metros.length).toBeGreaterThan(0)
    for (const m of overview.metros) {
      const def = METRO_DEFINITIONS.find((d) => d.metro === m.metro)
      expect(def).toBeTruthy()
      expect(m.lat).toBe(def!.lat)
      expect(m.lon).toBe(def!.lon)
    }
  })

  it('computes concentration and HHI on 0–1 shares', () => {
    const overview = computeCompanyOverview(data, filters)
    expect(overview.concentration.hhi).not.toBeNull()
    expect(overview.concentration.hhi!).toBeGreaterThan(0)
    expect(overview.concentration.hhi!).toBeLessThanOrEqual(1)
    if (overview.concentration.top5 != null) {
      expect(overview.concentration.top5).toBeGreaterThan(0)
      expect(overview.concentration.top5).toBeLessThanOrEqual(100)
    }
  })

  it('service RPP uses net billing / billed packages', () => {
    const overview = computeCompanyOverview(data, filters)
    for (const s of overview.services) {
      if (s.billedPackages > 0) {
        expect(s.revenuePerPackage).toBeCloseTo(s.netBilling / s.billedPackages, 2)
      } else {
        expect(s.revenuePerPackage).toBeNull()
      }
    }
  })

  it('region shares of net billing sum to ~100% of selected', () => {
    const overview = computeCompanyOverview(data, filters)
    const sum = sumMoney(overview.growth.regionalConcentration.map((r) => r.revenue))
    expect(Math.abs(sum - overview.scale.netBilling)).toBeLessThan(0.05)
  })

  it('West selection shows company vs selected scope and non-empty recognized', () => {
    const west = { ...filters, regions: ['West' as const] }
    const overview = computeCompanyOverview(data, west)
    expect(overview.scope.isFiltered).toBe(true)
    expect(overview.scope.company.netBilling).toBeGreaterThan(overview.scope.selected.netBilling)
    expect(overview.scale.recognized.display).not.toBe('no_records')
    expect(overview.scale.recognized.amount).toBeGreaterThan(0)
  })

  it('data quality monitor returns severity for each check', () => {
    const overview = computeCompanyOverview(data, filters)
    expect(overview.dataQuality.length).toBeGreaterThan(5)
    overview.dataQuality.forEach((q) => {
      expect(['Healthy', 'Warning', 'Critical']).toContain(q.severity)
    })
  })
})
