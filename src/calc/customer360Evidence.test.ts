import { describe, expect, it } from 'vitest'
import { getDataStore } from '@/data/generate'
import { addMonths, defaultFilters, listHistoricalPeriods } from '@/lib/filters'
import { money } from '@/lib/money'
import type { GlobalFilters } from '@/types'
import { computeCustomerContractHealth } from './customerContractHealth'
import { listCustomerEngagementEvents } from './customerEngagement'
import { buildCustomerEvidence, recomputeWeightedScore } from './customerEvidence'
import { computeCustomerHealth } from './customerHealth'
import { computeCustomerMarginDiagnosis } from './customerMarginBridge'
import { computeCustomerRevenueBridge } from './customerRevenueBridge'
import { buildCustomerRiskProfile } from './customerRisk'

const data = getDataStore()
const hist = listHistoricalPeriods(data)
const filters = defaultFilters(hist, hist[hist.length - 1])
const asOf = data.meta.as_of_date
const ryder = data.customers.find((c) => c.customer_name === 'Ryder')!

function evidenceFor(customerId: string, f: GlobalFilters = filters) {
  const health = computeCustomerHealth(data, { ...f, customerIds: [customerId] })[0]
  const revBridge = computeCustomerRevenueBridge(data, f, customerId)
  const ev = buildCustomerEvidence({
    data,
    filters: f,
    customerId,
    health,
    contract: computeCustomerContractHealth(data, f, customerId),
    revBridge,
    margin: computeCustomerMarginDiagnosis(data, f, customerId),
  })
  return { health, revBridge, ev }
}

const sample = data.customers.filter((c) => c.status === 'Active').slice(0, 25)

describe('Customer 360 — one comparison window and one revenue field', () => {
  it('Net Billing growth equals the revenue bridge prior → current for every customer', () => {
    for (const c of sample) {
      const { health, revBridge } = evidenceFor(c.customer_id)
      if (!revBridge.comparable || health.revenueGrowth == null) continue
      expect(revBridge.priorRevenue).toBeCloseTo(health.priorRevenue, 2)
      expect(revBridge.currentRevenue).toBeCloseTo(health.revenue, 2)
      expect(money(((revBridge.currentRevenue - revBridge.priorRevenue) / revBridge.priorRevenue) * 100)).toBeCloseTo(health.revenueGrowth, 1)
      // credits are bridged once — residual is rounding only
      expect(Math.abs(revBridge.residual)).toBeLessThan(1)
    }
  })

  it('Ryder: −24.8% Net Billing and −26.9% shipped packages vs Aug–Oct 2025', () => {
    const { health, ev } = evidenceFor(ryder.customer_id)
    expect(ev.window.prior?.startPeriod).toBe('2025-08')
    expect(health.revenueGrowth).toBeCloseTo(-24.81, 1)
    expect(ev.volume.pct).toBeCloseTo(-26.92, 1)
    expect(health.healthScore).toBe(55)
    expect(health.healthBand).toBe('At Risk')
  })
})

describe('Volume evidence matches trend and breakdown', () => {
  it('monthly trend sums to the two-period totals; metro and service deltas sum to the change', () => {
    for (const c of sample.slice(0, 10)) {
      const { ev } = evidenceFor(c.customer_id)
      if (ev.volume.prior == null) continue
      const sum = (seg: string) => ev.volume.monthly.filter((m) => m.segment === seg).reduce((a, m) => a + m.packages, 0)
      expect(sum('current')).toBe(ev.volume.current)
      expect(sum('prior')).toBe(ev.volume.prior)
      expect(ev.volume.byMetro.reduce((a, r) => a + r.delta, 0)).toBe(ev.volume.change)
      expect(ev.volume.byService.reduce((a, r) => a + r.delta, 0)).toBe(ev.volume.change)
    }
  })

  it('Ryder: period-over-period decline is distinguished from recovery within the current window', () => {
    const { ev } = evidenceFor(ryder.customer_id)
    expect(ev.volume.pct!).toBeLessThan(0)
    expect(ev.volume.withinCurrent.label).toBe('Recovery within current period')
  })
})

describe('Contract utilization — one scale', () => {
  it('KPI equals Σ actual ÷ Σ monthly minimum over active months, in %', () => {
    for (const c of sample) {
      const k = computeCustomerContractHealth(data, filters, c.customer_id)
      if (k.commitmentUtilization == null) continue
      expect(k.utilizationTrend).toHaveLength(3) // Aug, Sep, Oct — no skipped month
      const act = k.utilizationTrend.filter((m) => m.expectedVolume > 0)
      const expected = (act.reduce((a, m) => a + m.actualVolume, 0) / act.reduce((a, m) => a + m.expectedVolume, 0)) * 100
      expect(k.commitmentUtilization).toBeCloseTo(expected, 1)
      expect(k.commitmentUtilization).toBeGreaterThan(5) // never a ratio printed as %
    }
  })

  it('contract risk is independent and higher = riskier', () => {
    const k = computeCustomerContractHealth(data, filters, ryder.customer_id)
    const pts = k.contractRiskRules.filter((r) => r.triggered).reduce((a, r) => a + r.points, 0)
    expect(k.contractRiskScore).toBe(Math.min(100, pts))
  })
})

describe('No future information in scoring', () => {
  it('engagement events are dated on or before the As-of Date', () => {
    for (const c of data.customers) {
      for (const e of listCustomerEngagementEvents(c.customer_id, asOf)) expect(e.eventDate <= asOf).toBe(true)
    }
  })

  it('billing cases used in the score were detected on or before the As-of Date', () => {
    for (const h of computeCustomerHealth(data, filters)) {
      for (const e of h.inputs.billingCases) expect(e.detected_date.slice(0, 10) <= asOf).toBe(true)
    }
  })
})

describe('Health Score is recomputable and tags match evidence', () => {
  const rows = computeCustomerHealth(data, filters)

  it('Σ weight × component = weighted score; override is the only other adjustment', () => {
    for (const h of rows) {
      const { ev } = evidenceFor(h.customerId)
      expect(recomputeWeightedScore(ev.health.components)).toBe(h.inputs.weightedScore)
      expect(h.healthScore).toBe(h.inputs.override.applied ? h.inputs.override.cap : h.inputs.weightedScore)
    }
  }, 120_000)

  it('Billing Exceptions tag requires open billing cases; Collection Risk requires an overdue balance', () => {
    for (const h of rows) {
      const p = buildCustomerRiskProfile(h, data, filters)
      if (p.riskTypes.includes('Billing Exceptions')) expect(h.inputs.billingCases.length).toBeGreaterThan(0)
      if (h.inputs.billingCases.length === 0) expect(p.riskTypes.includes('Billing Exceptions')).toBe(false)
      expect(p.riskTypes.includes('Collection Risk')).toBe(p.overdueAr > 0.005)
    }
  }, 120_000)

  it('portfolio (all customers) and Customer 360 (single customer) give the same score', () => {
    for (const h of rows.slice(0, 15)) {
      const single = computeCustomerHealth(data, { ...filters, customerIds: [h.customerId] })[0]
      expect(single.healthScore).toBe(h.healthScore)
      expect(single.revenueGrowth).toBe(h.revenueGrowth)
      expect(single.scenarioRevenueAtRisk).toBe(h.scenarioRevenueAtRisk)
    }
  })
})

describe('Scenario exposure and actions', () => {
  it('exposure = basis × band stress factor (reproducible)', () => {
    for (const c of sample) {
      const { ev } = evidenceFor(c.customer_id)
      expect(ev.exposure.amount).toBeCloseTo(ev.exposure.basisAmount * ev.exposure.factor, 1)
      expect(ev.exposure.validated).toBe(false)
    }
  })

  it('actions map to evidence owners; repricing is not first when price/yield is positive', () => {
    const owners: Record<string, string> = {
      volume: 'Account / Sales',
      profitability: 'Account + Finance / Pricing',
      billing: 'Billing + Account',
      payment: 'Collections',
      delivery: 'Operations',
    }
    for (const c of sample) {
      const { ev, revBridge } = evidenceFor(c.customer_id)
      expect(ev.actions.length).toBeLessThanOrEqual(3)
      for (const a of ev.actions) {
        expect(a.owner).toBe(owners[a.id])
        if (a.id === 'profitability' && revBridge.priceImpact >= 0) expect(a.title).not.toMatch(/^Review yield/)
      }
    }
    const { ev } = evidenceFor(ryder.customer_id)
    expect(ev.actions[0].id).toBe('volume')
  })

  it('evidence follows date and metro filters', () => {
    const base = evidenceFor(ryder.customer_id).ev
    const earlier = evidenceFor(ryder.customer_id, { ...filters, startPeriod: addMonths(filters.startPeriod, -3), endPeriod: addMonths(filters.endPeriod, -3) }).ev
    expect(earlier.window.current.startPeriod).not.toBe(base.window.current.startPeriod)
    expect(earlier.volume.current).not.toBe(base.volume.current)
    const metro = base.volume.byMetro[0].key
    const byMetro = evidenceFor(ryder.customer_id, { ...filters, metros: [metro] }).ev
    expect(byMetro.volume.current).toBe(base.volume.byMetro[0].current)
  })
})
