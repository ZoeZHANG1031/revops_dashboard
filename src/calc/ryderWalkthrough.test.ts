import { describe, it, expect } from 'vitest'
import { getDataStore } from '@/data/generate'
import { defaultFilters, listHistoricalPeriods, listPeriods } from '@/lib/filters'
import { computeCustomerHealth } from '@/calc/customerHealth'
import { buildCustomerRiskProfile } from '@/calc/customerRisk'
import { computeCustomerRevenueBridge } from '@/calc/customerRevenueBridge'
import { computeCustomerMarginDiagnosis } from '@/calc/customerMarginBridge'
import { buildCustomerDiagnosis } from '@/calc/customerDiagnosis'
import { computeCustomerContractHealth } from '@/calc/customerContractHealth'
import { money } from '@/lib/money'

describe('Ryder end-to-end diagnosis', () => {
  it(
    'answers key RevOps questions from calc chain',
    () => {
      const t0 = performance.now()
      const data = getDataStore()
      const periods = listPeriods(data)
      const hist = listHistoricalPeriods(data)
      const filters = defaultFilters(periods, hist[hist.length - 1])
      const ryder = data.customers.find((c) => c.customer_name === 'Ryder')
      expect(ryder).toBeTruthy()
      const id = ryder!.customer_id

      const t1 = performance.now()
      const healthAll = computeCustomerHealth(data, filters)
      const t2 = performance.now()
      const health = healthAll.find((r) => r.customerId === id)!
      expect(health).toBeTruthy()

      const profile = buildCustomerRiskProfile(health, data, filters)
      const bridge = computeCustomerRevenueBridge(data, filters, id)
      const margin = computeCustomerMarginDiagnosis(data, filters, id)
      const contract = computeCustomerContractHealth(data, filters, id)
      const diagnosis = buildCustomerDiagnosis(health, bridge, margin, profile.riskTypes, {
        industry: profile.industry,
      })
      const t3 = performance.now()

      if (profile.openAr > 0 && profile.overdueAr === 0 && health.paymentAgingDays === 0) {
        expect(profile.riskTypes.includes('Collection Risk')).toBe(false)
      }

      expect(Math.abs(bridge.checkSum - bridge.revenueChange)).toBeLessThan(0.03)
      expect(Math.abs(margin.checkSum - margin.cpChange)).toBeLessThan(0.05)
      expect(diagnosis.summary.length).toBeGreaterThan(40)
      expect(diagnosis.topDrivers.length).toBeGreaterThan(0)
      expect(profile.financialExposure.recoverableBilling).toBeGreaterThanOrEqual(0)

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            timingsMs: {
              getData: +(t1 - t0).toFixed(1),
              healthAll: +(t2 - t1).toFixed(1),
              diagnosisChain: +(t3 - t2).toFixed(1),
            },
            customer: health.customerName,
            healthScore: health.healthScore,
            band: health.healthBand,
            revenue: health.revenue,
            revenueGrowth: health.revenueGrowth,
            cm: health.contributionMargin,
            delivery: health.deliveryPerformance,
            openAr: profile.openAr,
            overdueAr: profile.overdueAr,
            recoverableBilling: profile.financialExposure.recoverableBilling,
            riskTypes: profile.riskTypes,
            bridge: {
              comparable: bridge.comparable,
              revenueChange: bridge.revenueChange,
              volumeImpact: bridge.volumeImpact,
              serviceMix: bridge.serviceMixImpact,
              geoMix: bridge.geoMixImpact,
              price: bridge.priceImpact,
              credits: bridge.creditsImpact,
              residual: bridge.residual,
              residualShare: bridge.revenueChange
                ? money((Math.abs(bridge.residual) / Math.abs(bridge.revenueChange)) * 100)
                : null,
            },
            topVolumeDrops: bridge.volumeBreakdown
              .filter((r) => r.volumeDelta < 0)
              .sort((a, b) => a.volumeDelta - b.volumeDelta)
              .slice(0, 5),
            margin: {
              priorCP: margin.priorContributionProfit,
              currentCP: margin.currentContributionProfit,
              volume: margin.volumeImpact,
              yield: margin.yieldImpact,
              dsp: margin.dspImpact,
              sorting: margin.sortingImpact,
              linehaul: margin.linehaulImpact,
              cm: margin.unitEconomics.contributionMarginPct,
              rpp: margin.unitEconomics.rpp,
              cpp: margin.unitEconomics.cpp,
            },
            worstMetros: [...margin.geoProfitability]
              .sort((a, b) => (a.contributionMarginPct ?? 99) - (b.contributionMarginPct ?? 99))
              .slice(0, 3),
            contract: {
              utilization: contract.commitmentUtilization,
              contractRiskScore: contract.contractRiskScore,
              daysUntilRenewal: contract.daysUntilRenewal,
              monthlyCommitment: contract.monthlyCommitment,
            },
            scenarioRaR: health.scenarioRevenueAtRisk,
            summary: diagnosis.summary,
            topDrivers: diagnosis.topDrivers.slice(0, 3),
          },
          null,
          2,
        ),
      )
    },
    120000,
  )
})
