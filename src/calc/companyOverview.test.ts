import { describe, expect, it } from 'vitest'
import { computeCompanyOverview } from '@/calc/companyOverview'
import { computeSharedMetrics } from '@/calc/metricRegistry'
import { METRO_DEFINITIONS } from '@/data/metros'
import { getDataStore } from '@/data/generate'
import { defaultFilters, listHistoricalPeriods, listPeriods } from '@/lib/filters'

describe('company overview', () => {
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
    expect(overview.scale.recognizedRevenue).toBe(overview.sharedCheck.recognizedRevenue)
    expect(overview.scale.netBilling).toBe(overview.sharedCheck.netBilledRevenue)
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

  it('top5 concentration is between 0 and 100 when revenue exists', () => {
    const overview = computeCompanyOverview(data, filters)
    if (overview.scale.netBilling > 0) {
      expect(overview.growth.top5Concentration).not.toBeNull()
      expect(overview.growth.top5Concentration!).toBeGreaterThan(0)
      expect(overview.growth.top5Concentration!).toBeLessThanOrEqual(100)
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

  it('marks DSP / facilities unavailable rather than inventing counts', () => {
    const overview = computeCompanyOverview(data, filters)
    expect(overview.scale.unavailable.some((u) => u.label.includes('DSP'))).toBe(true)
    expect(overview.scale.unavailable.some((u) => u.label.includes('Facilities'))).toBe(true)
  })
})
