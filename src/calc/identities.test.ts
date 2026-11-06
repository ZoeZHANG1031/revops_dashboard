import { describe, expect, it } from 'vitest'
import { actionCategoryTotals, buildActionCenter } from '@/calc/actionCenter'
import { rollupExceptionsByRootCause } from '@/calc/actionRollup'
import { EXCEPTION_REGISTRY, exposureByClass, isOpenException } from '@/calc/exceptionRegistry'
import { computeDriverForecast, DEFAULT_SCENARIO_PARAMS } from '@/calc/forecast'
import { computeSharedMetrics } from '@/calc/metricRegistry'
import { computeReconciliationBridge } from '@/calc/reconBridge'
import { computeCostDrivers, computeUnitEconomics } from '@/calc/unitEconomics'
import { computeVarianceBridge } from '@/calc/varianceBridge'
import { getDataStore } from '@/data/generate'
import {
  defaultFilters,
  filterBillingLines,
  filterExceptions,
  listHistoricalPeriods,
  listPeriods,
} from '@/lib/filters'

/** Section 13 — financial identities and cross-page consistency */
describe('financial identities & consistency', { timeout: 60000 }, () => {
  const data = getDataStore()
  const hist = listHistoricalPeriods(data)
  const base = defaultFilters(listPeriods(data), hist[hist.length - 1])
  const metro = data.shipments[0].metro
  const scopes = {
    company: base,
    metro: { ...base, metros: [metro], regions: [data.shipments[0].region] },
    service: { ...base, serviceTypes: ['Economy' as const] },
  }
  const close = (a: number, b: number, tol = 0.05) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)

  for (const [name, f] of Object.entries(scopes)) {
    describe(name, () => {
      const m = computeSharedMetrics(data, f)
      const lines = filterBillingLines(data, f)

      it('Net Billing = Gross − Discounts − Credits', () => {
        const gross = lines.reduce((a, l) => a + l.base_charge + l.fuel_surcharge + l.remote_surcharge, 0)
        const disc = lines.reduce((a, l) => a + l.discounts + l.credits, 0)
        close(m.netBilledRevenue, gross - disc, 0.5)
        close(m.grossBillings, gross, 0.5)
      })

      it('Contribution, CM and Operating Profit identities', () => {
        close(m.contributionProfit, m.netBilledRevenue - m.variableCost)
        if (m.netBilledRevenue !== 0) close(m.contributionMargin!, (m.contributionProfit / m.netBilledRevenue) * 100, 0.01)
        close(m.operatingProfit, m.contributionProfit - m.allocatedFixed)
        const ue = computeUnitEconomics(data, f)
        close(ue.contributionProfit, m.contributionProfit)
        close(ue.operatingProfit, ue.contributionProfit - ue.allocatedFixed)
      })

      it('Customer / Service / Metro revenue roll up to Net Billing', () => {
        for (const dim of ['customer', 'service', 'metro'] as const) {
          const rows = computeUnitEconomics(data, f, dim).byDimension
          close(rows.reduce((a, r) => a + r.revenue, 0), m.netBilledRevenue, 0.5)
        }
      })

      it('Cost breakdown = variable + allocated fixed; cost drivers reconcile', () => {
        const ue = computeUnitEconomics(data, f)
        const total = ue.costBreakdown.reduce((a, c) => a + c.amount, 0)
        close(total, m.variableCost + ue.allocatedFixed, 0.5)
        const co = computeCostDrivers(data, f, 'company')[0]
        if (co) close((co.totalCostPerPackage ?? 0) * co.packages, m.variableCost, co.packages * 0.006)
      })

      it('Exception counts by status sum to total; open exposure by type = by class', () => {
        const ex = filterExceptions(data, f)
        const byStatus = new Map<string, number>()
        ex.forEach((e) => byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + 1))
        expect([...byStatus.values()].reduce((a, b) => a + b, 0)).toBe(ex.length)
        const byClass = exposureByClass(ex)
        const byType = ex.filter(isOpenException).reduce((a, e) => a + e.financial_impact, 0)
        close(Object.values(byClass).reduce((a, c) => a + c.amount, 0), byType, 0.5)
      })

      it('Recoverable exposure is identical on Executive, Reconciliation and KPI', () => {
        const ex = filterExceptions(data, f)
        const recon = exposureByClass(ex)['Recoverable Billing Exposure'].amount
        const exec = actionCategoryTotals(buildActionCenter(data, f)).find((c) => c.category === 'Recoverable Billing Exposure')!.impact
        const rollup = rollupExceptionsByRootCause(data, f).reduce((a, r) => a + r.recoverable, 0)
        close(recon, m.openRecoverableLeakage)
        close(exec, m.openRecoverableLeakage)
        close(rollup, m.openRecoverableLeakage)
      })

      it('Reconciliation bridge components sum to Actual − Expected', () => {
        const b = computeReconciliationBridge(data, f)
        expect(b.reconciles).toBe(true)
      })
    })
  }

  it('Duplicate Billing is a billing correction, never recoverable revenue', () => {
    expect(EXCEPTION_REGISTRY['Duplicate Billing'].recoverable).toBe(false)
    expect(buildActionCenter(data, base).some((i) => i.category === 'Recoverable Billing Exposure' && i.title === 'Duplicate Billing')).toBe(false)
  })

  it('Total Forecast = Existing + Pipeline', () => {
    const m = computeSharedMetrics(data, base)
    close(m.forecastTotal, m.forecastExisting + m.forecastPipeline)
    const fc = computeDriverForecast(data, base, 'Base', DEFAULT_SCENARIO_PARAMS.Base)
    close(fc.totalExpected, fc.existingRevenue + fc.pipelineRevenue)
  })

  it('Forecast Variance = Comparable Actual − Comparable Forecast; bridge foots', () => {
    const m = computeSharedMetrics(data, base)
    expect(m.forecastComparable).toBe(true)
    close(m.forecastVarianceExisting, m.comparableActual - m.forecastExisting)
    const b = computeVarianceBridge(data, base, 'Base', 'total')
    close(b.checkSum, b.actual - b.forecast)
    close(b.actual - b.forecast, m.forecastVarianceExisting)
  })

  it('Dimensional filters make forecast variance non-comparable (no false miss)', () => {
    const m = computeSharedMetrics(data, scopes.metro)
    expect(m.forecastComparable).toBe(false)
    expect(m.forecastComparableReason).toMatch(/customer × month grain/)
  })

  it('A window starting before forecasts exist compares only forecast months', () => {
    const firstFc = data.forecasts.map((f) => f.accounting_period).sort()[0]
    expect(firstFc > hist[0]).toBe(true) // history starts before the first forecast month
    const early = { ...base, startPeriod: hist[0], endPeriod: hist[hist.length - 1] }
    const m = computeSharedMetrics(data, early)
    const exact = computeSharedMetrics(data, { ...early, startPeriod: firstFc })
    expect(m.forecastComparable).toBe(true)
    close(m.comparableActual, exact.comparableActual, 0.5)
    close(m.forecastVarianceExisting, exact.forecastVarianceExisting, 0.5)
  })
})
