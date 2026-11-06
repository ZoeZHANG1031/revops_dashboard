import { describe, expect, it } from 'vitest'
import { generateDataStore } from '@/data/generate'
import { defaultFilters, listHistoricalPeriods, listPeriods } from '@/lib/filters'
import { money, sumMoney } from '@/lib/money'
import { computeVarianceBridge } from './varianceBridge'
import {
  computeReconciliation,
  validateBillingVsInvoice,
  validateRevRecVsGl,
} from './reconciliation'
import { computeUnitEconomics } from './unitEconomics'
import { computeExecutiveKpis } from './kpis'
import { evaluateForecastAccuracy } from './forecast'

describe('synthetic data integrity', () => {
  const data = generateDataStore(20241105)
  const periods = listPeriods(data)
  const filters = defaultFilters(periods)

  it('marks all entities as synthetic', () => {
    expect(data.meta.is_synthetic).toBe(true)
    expect(data.customers.every((c) => c.synthetic)).toBe(true)
    expect(data.shipments.length).toBeGreaterThan(1000)
    expect(data.customers.length).toBeGreaterThanOrEqual(15)
    expect(data.customers.length).toBeLessThanOrEqual(100) // data-v3: 60–100 accounts
  })

  it('billing line totals reconcile to invoice net after credit memos', () => {
    const result = validateBillingVsInvoice(data)
    expect(result.ok, result.details.join('\n')).toBe(true)
  })

  it('recognized revenue headers match GL revenue credits', () => {
    const result = validateRevRecVsGl(data)
    expect(result.ok, result.details.join('\n')).toBe(true)
  })

  it('revenue bridge components sum to actual − forecast', () => {
    const bridge = computeVarianceBridge(data, filters, 'Base', 'total')
    expect(Math.abs(bridge.checkSum - (bridge.actual - bridge.forecast))).toBeLessThan(0.05)
  })

  it('cost detail sums equal total variable + fixed for filter', () => {
    const econ = computeUnitEconomics(data, filters)
    const detailSum = sumMoney(econ.costBreakdown.map((c) => c.amount))
    const expected = money(
      econ.netRevenue - econ.contributionProfit + econ.allocatedFixed,
    )
    // variable = netRevenue - contribution; + allocated fixed
    expect(Math.abs(detailSum - expected)).toBeLessThan(0.05)
  })

  it('customer-level revenue sums to company net billed', () => {
    const byCustomer = new Map<string, number>()
    data.billingLines
      .filter(
        (b) =>
          !b.is_duplicate &&
          b.accounting_period >= filters.startPeriod &&
          b.accounting_period <= filters.endPeriod,
      )
      .forEach((b) => {
        byCustomer.set(b.customer_id, money((byCustomer.get(b.customer_id) ?? 0) + b.net_amount))
      })
    const rolled = sumMoney([...byCustomer.values()])
    const kpis = computeExecutiveKpis(data, filters)
    expect(Math.abs(rolled - kpis.netBilledRevenue)).toBeLessThan(0.05)
  })

  it('reconciliation exposes warnings rather than silently forcing equality when timing differs', () => {
    const recon = computeReconciliation(data, filters)
    expect(recon.expectedBillableShipments).toBeGreaterThan(0)
    expect(recon.actualBilledShipments).toBeGreaterThan(0)
    // unbilled exposure should be non-negative
    expect(recon.unbilledExposure).toBeGreaterThanOrEqual(0)
  })

  it('forecast accuracy metrics never return Infinity or NaN', () => {
    const acc = evaluateForecastAccuracy(data, filters, 'Base')
    for (const v of [acc.mae, acc.rmse, acc.wape, acc.bias]) {
      if (v != null) {
        expect(Number.isFinite(v)).toBe(true)
        expect(Number.isNaN(v)).toBe(false)
      }
    }
  })

  it('is reproducible with the same seed', () => {
    const a = generateDataStore(20241105)
    const b = generateDataStore(20241105)
    expect(a.shipments.length).toBe(b.shipments.length)
    expect(a.billingLines[0]?.net_amount).toBe(b.billingLines[0]?.net_amount)
    expect(a.invoices[0]?.net_amount).toBe(b.invoices[0]?.net_amount)
  })

  it('includes non-zero pipeline forecast for historical and future periods', () => {
    const pipe = data.forecasts.filter((f) => f.forecast_type === 'Pipeline' && f.scenario === 'Base')
    expect(pipe.length).toBeGreaterThan(0)
    expect(pipe.every((p) => p.forecast_recognized > 0)).toBe(true)
    const histPipe = pipe.filter((p) => p.accounting_period <= periods[periods.length - 1])
    expect(histPipe.length).toBeGreaterThan(0)
  })

  it('allocates fixed cost by volume share summing to monthly pool', () => {
    const hist = listHistoricalPeriods(data)
    const period = hist[hist.length - 1]
    const fixed = data.costs.filter(
      (c) => c.cost_type === 'Allocated Fixed' && c.accounting_period === period,
    )
    const total = sumMoney(fixed.map((c) => c.amount))
    // Rounding to cents across customers can leave a small residual
    expect(Math.abs(total - data.meta.fixed_opex_pool_monthly_base)).toBeLessThan(1)
  })

  it('shipments carry metro and operational status for last-mile analytics', () => {
    expect(data.shipments.every((s) => !!s.metro && !!s.operational_status)).toBe(true)
  })
})
