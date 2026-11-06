import { describe, expect, it } from 'vitest'
import { buildTopBusinessIssues } from '@/calc/executiveIssues'
import { computeSharedMetrics } from '@/calc/metricRegistry'
import { computeVarianceBridge } from '@/calc/varianceBridge'
import { getDataStore } from '@/data/generate'
import { defaultFilters, listHistoricalPeriods, listPeriods } from '@/lib/filters'

describe('executive visual upgrade metrics', { timeout: 60000 }, () => {
  const data = getDataStore()
  const periods = listPeriods(data)
  const hist = listHistoricalPeriods(data)
  const filters = defaultFilters(periods, hist[hist.length - 1])

  it('primary executive KPIs match shared metrics', () => {
    const m = computeSharedMetrics(data, filters, 'Base')
    expect(Number.isFinite(m.recognizedRevenue)).toBe(true)
    expect(Number.isFinite(m.forecastVarianceExisting)).toBe(true)
    expect(m.contributionMargin == null || Number.isFinite(m.contributionMargin)).toBe(true)
    expect(m.openRecoverableLeakage).toBeGreaterThanOrEqual(0)
    expect(m.overdueAr).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(m.contributionProfit)).toBe(true)
  })

  it('variance bridge telescopes to actual − existing forecast', () => {
    const bridge = computeVarianceBridge(data, filters, 'Base', 'total')
    expect(Math.abs(bridge.checkSum - (bridge.actual - bridge.forecast))).toBeLessThan(0.05)
    const other = bridge.items.find((i) => i.key === 'other')
    expect(other).toBeTruthy()
  })

  it('top business issues are rule-based with navigate targets', () => {
    const issues = buildTopBusinessIssues(data, filters, 'Base')
    expect(issues).toHaveLength(3)
    expect(issues.map((i) => i.id).sort()).toEqual(['ar', 'forecast', 'leakage'])
    for (const issue of issues) {
      expect(['healthy', 'watch', 'critical']).toContain(issue.severity)
      expect(issue.navigate.path).toBeTruthy()
      expect(issue.evidence.length).toBeGreaterThan(10)
    }
  })
})
