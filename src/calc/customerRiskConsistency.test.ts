import { describe, expect, it } from 'vitest'
import { computeCustomerRevenueBridge } from '@/calc/customerRevenueBridge'
import { computeCustomerMarginDiagnosis } from '@/calc/customerMarginBridge'
import {
  buildCustomerRiskProfile,
  classifyCustomerRisksWithAr,
  computePortfolioRiskKpis,
} from '@/calc/customerRisk'
import { computeCustomerHealth } from '@/calc/customerHealth'
import { computeHealthV2, DEFAULT_HEALTH_V2_WEIGHTS, componentsFromHealthRow } from '@/calc/customerHealthV2'
import { buildCustomerDiagnosis } from '@/calc/customerDiagnosis'
import { engagementRiskSignal } from '@/calc/customerEngagement'
import { getDataStore } from '@/data/generate'
import { defaultFilters, listHistoricalPeriods, listPeriods } from '@/lib/filters'
import { money } from '@/lib/money'

describe('customer risk & bridge consistency', () => {
  const data = getDataStore()
  const periods = listPeriods(data)
  const hist = listHistoricalPeriods(data)
  const filters = defaultFilters(periods, hist[hist.length - 1])

  const ryder = data.customers.find((c) => c.customer_name === 'Ryder')
  const ryderId = ryder?.customer_id

  it(
    'revenue bridge telescopes for Ryder',
    () => {
      expect(ryderId).toBeTruthy()
      const b = computeCustomerRevenueBridge(data, filters, ryderId!)
      if (b.comparable) {
        expect(money(b.checkSum)).toBe(money(b.revenueChange))
        expect(
          money(
            b.volumeImpact +
              b.serviceMixImpact +
              b.geoMixImpact +
              b.priceImpact +
              b.creditsImpact +
              b.residual,
          ),
        ).toBe(money(b.revenueChange))
        expect(Math.abs(b.revenueChange - b.checkSum)).toBeLessThanOrEqual(0.02)
      }
      expect(b.waterfall.some((s) => s.key === 'prior')).toBe(true)
      expect(b.waterfall.some((s) => s.key === 'current')).toBe(true)
    },
    120_000,
  )

  it(
    'margin bridge telescopes for Ryder',
    () => {
      expect(ryderId).toBeTruthy()
      const m = computeCustomerMarginDiagnosis(data, filters, ryderId!)
      if (m.comparable) {
        expect(money(m.checkSum)).toBe(money(m.cpChange))
        expect(
          money(
            m.volumeImpact +
              m.yieldImpact +
              m.dspImpact +
              m.sortingImpact +
              m.linehaulImpact +
              m.otherVarImpact +
              m.mixResidual,
          ),
        ).toBe(money(m.cpChange))
      }
    },
    120_000,
  )

  it('Collection Risk only when overdue AR or aging — not open AR alone', () => {
    const rows = computeCustomerHealth(data, filters)
    const sample = rows[0]
    expect(sample).toBeTruthy()

    const withOpenOnly = classifyCustomerRisksWithAr(sample!, {
      overdueAr: 0,
      openAr: 500_000,
      asOf: data.meta.as_of_date,
    })
    expect(withOpenOnly.includes('Collection Risk')).toBe(false)

    const withOverdue = classifyCustomerRisksWithAr(
      { ...sample!, paymentAgingDays: 0 },
      { overdueAr: 1, asOf: data.meta.as_of_date },
    )
    expect(withOverdue.includes('Collection Risk')).toBe(true)
  })

  it('portfolio revenueFromAtRisk differs from scenario RaR total', () => {
    const health = computeCustomerHealth(data, filters)
    const profiles = health.map((h) => buildCustomerRiskProfile(h, data, filters))
    const kpis = computePortfolioRiskKpis(profiles)
    expect(kpis.revenueFromAtRisk).toBeGreaterThanOrEqual(0)
    expect(kpis.scenarioRevenueAtRiskTotal).toBeGreaterThanOrEqual(0)
    if (kpis.atRiskCustomers > 0) {
      expect(typeof kpis.revenueFromAtRisk).toBe('number')
      expect(typeof kpis.scenarioRevenueAtRiskTotal).toBe('number')
    }
  })

  it('health v2 weights normalize to 1 among observed components', () => {
    const row = computeCustomerHealth(data, filters)[0]!
    const components = componentsFromHealthRow(row, {
      engagementScore: engagementRiskSignal(row.customerId, data.meta.as_of_date),
    })
    const result = computeHealthV2(components)
    const sum = Object.values(result.weightsUsed).reduce((a, b) => a + b, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(0.001)

    const defaultSum = Object.values(DEFAULT_HEALTH_V2_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(Math.abs(defaultSum - 1)).toBeLessThan(0.001)
  })

  it(
    'diagnosis non-empty for Ryder',
    () => {
      expect(ryderId).toBeTruthy()
      const health = computeCustomerHealth(data, filters).find((h) => h.customerId === ryderId)
      expect(health).toBeTruthy()
      const rev = computeCustomerRevenueBridge(data, filters, ryderId!)
      const margin = computeCustomerMarginDiagnosis(data, filters, ryderId!)
      const profile = buildCustomerRiskProfile(health!, data, filters, {
        engagementScore: engagementRiskSignal(ryderId!, data.meta.as_of_date),
      })
      const dx = buildCustomerDiagnosis(health!, rev, margin, profile.riskTypes, {
        industry: profile.industry,
      })
      expect(dx.summary.length).toBeGreaterThan(40)
      expect(dx.summary.toLowerCase()).not.toContain('hardcode')
      expect(dx.topDrivers.length).toBeGreaterThan(0)
      expect(dx.summary).toContain('Ryder')
    },
    120_000,
  )
})
