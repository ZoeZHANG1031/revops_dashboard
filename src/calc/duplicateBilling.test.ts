import { describe, expect, it } from 'vitest'
import { assessDuplicateBilling } from '@/calc/duplicateBilling'
import { computeCompanyOverview } from '@/calc/companyOverview'
import { getDataStore } from '@/data/generate'
import { defaultFilters, listHistoricalPeriods, listPeriods } from '@/lib/filters'

describe('duplicate billing classification', () => {
  const data = getDataStore()
  const periods = listPeriods(data)
  const hist = listHistoricalPeriods(data)
  const filters = defaultFilters(periods, hist[hist.length - 1])

  it('classifies flagged clones as Exact Duplicate with confirmed exposure', () => {
    const result = assessDuplicateBilling(data, filters)
    expect(result.exactCount).toBeGreaterThan(0)
    expect(result.confirmedExposure).toBeGreaterThan(0)
    const exact = result.assessments.filter((a) => a.classification === 'Exact Duplicate')
    expect(exact.length).toBe(result.exactCount)
    for (const a of exact) {
      expect(a.isFlaggedDuplicate).toBe(true)
      expect(a.pairedLineId).toBeTruthy()
      expect(a.exposure).toBe(a.netAmount)
    }
  })

  it('data quality duplicate check uses exact count not multi-charge shipment count', () => {
    const overview = computeCompanyOverview(data, filters)
    const dupCheck = overview.dataQuality.find((q) => q.id === 'duplicate-billing')
    expect(dupCheck).toBeTruthy()
    const assessed = assessDuplicateBilling(data, filters)
    expect(dupCheck!.issueCount).toBe(assessed.exactCount)
    expect(dupCheck!.financialImpact).toBe(assessed.confirmedExposure)
    expect(dupCheck!.investigatePath).toBe('/reconciliation')
    expect(dupCheck!.investigateExtras?.exceptionType).toBe('Duplicate Billing')
  })
})
