import { describe, expect, it } from 'vitest'
import { computeCompanyOverview } from '@/calc/companyOverview'
import { computeSharedMetrics } from '@/calc/metricRegistry'
import { computeUnitEconomics } from '@/calc/unitEconomics'
import { getDataStore } from '@/data/generate'
import { defaultFilters, listHistoricalPeriods, listPeriods } from '@/lib/filters'

describe('scope & navigation consistency', { timeout: 60000 }, () => {
  const data = getDataStore()
  const periods = listPeriods(data)
  const hist = listHistoricalPeriods(data)
  const filters = defaultFilters(periods, hist[hist.length - 1])

  it('Company Total Active Customers can exceed Selected when metro filtered', () => {
    const houston = data.shipments.find((s) => s.metro.includes('Houston'))
    expect(houston).toBeTruthy()
    const scoped = {
      ...filters,
      regions: [houston!.region],
      metros: [houston!.metro],
    }
    const overview = computeCompanyOverview(data, scoped)
    expect(overview.scope.isFiltered).toBe(true)
    expect(overview.scale.activeCustomers).toBe(overview.scope.selected.activeCustomers)
    expect(overview.scope.company.activeCustomers).toBeGreaterThanOrEqual(
      overview.scope.selected.activeCustomers,
    )
    expect(overview.scale.activeCustomers).toBeLessThan(overview.scope.company.activeCustomers)
  })

  it('Net Billing matches shared metrics under Economy filter across overview', () => {
    const economy = { ...filters, serviceTypes: ['Economy' as const] }
    const overview = computeCompanyOverview(data, economy)
    const shared = computeSharedMetrics(data, economy)
    expect(Math.abs(overview.scale.netBilling - shared.netBilledRevenue)).toBeLessThan(0.05)
  })

  it('Unit Economics inherits metro scope net billing alignment', () => {
    const metroShip = data.shipments[0]
    const scoped = {
      ...filters,
      regions: [metroShip.region],
      metros: [metroShip.metro],
    }
    const overview = computeCompanyOverview(data, scoped)
    const ue = computeUnitEconomics(data, scoped)
    expect(Math.abs(overview.scale.netBilling - ue.netRevenue)).toBeLessThan(0.05)
  })
})
