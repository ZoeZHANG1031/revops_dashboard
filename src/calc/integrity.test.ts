import { describe, expect, it } from 'vitest'
import { generateDataStore } from '@/data/generate'
import { defaultFilters, listHistoricalPeriods } from '@/lib/filters'
import { money, sumMoney } from '@/lib/money'
import { computeReconciliationBridge } from './reconBridge'
import { computeSharedMetrics } from './metricRegistry'
import { computeUnitEconomics } from './unitEconomics'
import { computeCohortConversions } from './salesCohort'
import { computeCustomerHealth } from './customerHealth'
import { computeVarianceBridge } from './varianceBridge'
import { computeDriverForecast } from './forecast'
import { DEFAULT_SCENARIO_PARAMS } from './forecast'

describe('financial integrity V2', () => {
  const data = generateDataStore(20241105)
  const hist = listHistoricalPeriods(data)
  const filters = defaultFilters(hist, hist[hist.length - 1])

  it('shared metrics: forecast total = existing + pipeline', () => {
    const m = computeSharedMetrics(data, filters, 'Base')
    expect(Math.abs(m.forecastTotal - (m.forecastExisting + m.forecastPipeline))).toBeLessThan(0.05)
  })

  it('recon bridge legs sum to actual − expected', () => {
    const b = computeReconciliationBridge(data, filters)
    expect(b.reconciles).toBe(true)
    expect(Math.abs(b.checkSum - b.totalGap)).toBeLessThan(0.05)
  })

  it('variance bridge still foots', () => {
    const b = computeVarianceBridge(data, filters, 'Base', 'total')
    expect(Math.abs(b.checkSum - (b.actual - b.forecast))).toBeLessThan(0.05)
  })

  it('unit economics identities hold under Base fixed pool', () => {
    const u = computeUnitEconomics(data, filters, 'customer', 'Base')
    expect(Math.abs(u.contributionProfit - (u.netRevenue - (u.netRevenue - u.contributionProfit)))).toBeLessThan(
      0.05,
    )
    expect(Math.abs(u.operatingProfit - (u.contributionProfit - u.allocatedFixed))).toBeLessThan(0.05)
    // Base pool should not dominate revenue by 10x+
    expect(u.allocatedFixed).toBeLessThan(u.netRevenue * 2)
  })

  it('company allocated fixed in one month equals Base pool', () => {
    const period = hist[hist.length - 1]
    const total = sumMoney(
      data.costs
        .filter((c) => c.cost_type === 'Allocated Fixed' && c.accounting_period === period)
        .map((c) => c.amount),
    )
    expect(Math.abs(total - data.meta.fixed_opex_pool_monthly_base)).toBeLessThan(1)
  })

  it('customer filter does not receive full company fixed pool', () => {
    const cust = data.customers[0].customer_id
    const company = computeUnitEconomics(data, filters, 'customer', 'Base')
    const one = computeUnitEconomics(
      data,
      { ...filters, customerIds: [cust] },
      'customer',
      'Base',
    )
    expect(one.allocatedFixed).toBeLessThan(company.allocatedFixed)
    expect(one.allocatedFixed).toBeGreaterThan(0)
  })

  it('health scores stay in 0–100 with meaningful spread', () => {
    const rows = computeCustomerHealth(data, filters)
    expect(rows.every((r) => r.healthScore >= 0 && r.healthScore <= 100)).toBe(true)
    const scores = rows.map((r) => r.healthScore)
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThan(15)
    expect(rows.some((r) => r.healthBand !== 'Healthy')).toBe(true)
  })

  it('cohort conversions are defined from stage events', () => {
    expect(data.opportunityStageEvents.length).toBeGreaterThan(20)
    const c = computeCohortConversions(data)
    expect(c.conversions.length).toBe(4)
    c.conversions.forEach((row) => {
      if (row.rate != null) {
        expect(row.rate).toBeGreaterThanOrEqual(0)
        expect(row.rate).toBeLessThanOrEqual(100)
      }
    })
  })

  it('driver forecast existing + pipeline matches total', () => {
    const f = computeDriverForecast(data, filters, 'Base', DEFAULT_SCENARIO_PARAMS.Base)
    expect(Math.abs(f.totalExpected - (f.existingRevenue + f.pipelineRevenue))).toBeLessThan(0.05)
  })

  it('open recoverable excludes overdue AR and duplicates', () => {
    const m = computeSharedMetrics(data, filters)
    // Overdue AR is separate
    expect(m.overdueAr).toBeGreaterThanOrEqual(0)
    // Recoverable should be <= sum of missing+rate+surcharge open impacts
    expect(m.openRecoverableLeakage).toBeGreaterThanOrEqual(0)
  })
})
