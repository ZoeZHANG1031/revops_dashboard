import { describe, expect, it } from 'vitest'
import { getDataStore } from '@/data/generate'
import { defaultFilters, listHistoricalPeriods } from '@/lib/filters'
import { computeClientQualityPortfolio } from './clientQuality'
import { buildCustomerEvidence, DIAGNOSIS_RULES } from './customerEvidence'
import { computeCustomerHealth } from './customerHealth'
import { computePortfolioRiskKpis } from './customerRisk'
import {
  computeGrowthOpportunities,
  computeHealthMigration,
  customerHealthTrend,
  healthDistribution,
  PRICING_EXCEPTION_TYPES,
  RISK_DRIVERS,
  riskDriverDistribution,
} from './portfolioVisuals'

const data = getDataStore()
const hist = listHistoricalPeriods(data)
const filters = defaultFilters(hist, hist[hist.length - 1])
const cq = computeClientQualityPortfolio(data, filters)

describe('Phase 1 · metric consistency', () => {
  it('Executive / Client Quality at-risk count equals the Risk & Retention definition', () => {
    const active = cq.profiles.filter((p) => p.revenue !== 0 || p.volume > 0)
    expect(cq.kpis.clientsAtRisk).toBe(computePortfolioRiskKpis(active).atRiskCustomers)
    expect(cq.kpis.revenueExposure).toBeCloseTo(computePortfolioRiskKpis(active).revenueFromAtRisk, 2)
  })

  it('no Health Score is pinned at 49 by an override; override only sets the band', () => {
    for (const h of computeCustomerHealth(data, filters)) {
      expect(h.healthScore).toBe(h.inputs.weightedScore)
      if (h.inputs.override.applied) expect(h.healthBand).toBe('Critical')
    }
  })

  it('watchlist priority score equals its published factor breakdown', () => {
    for (const w of cq.watchlist) {
      const f = w.priorityFactors
      const recomputed = (f.severity + f.size + f.deterioration + f.exposure) * f.confidenceMultiplier
      expect(w.priorityScore).toBeCloseTo(recomputed, 1)
      expect(w.priorityReason.length).toBeGreaterThan(0)
    }
  })
})

describe('Phase 1 · Client 360 explanation semantics', () => {
  const rows = computeCustomerHealth(data, filters)
  const evs = rows.map((h) =>
    buildCustomerEvidence({
      data,
      filters: { ...filters, customerIds: [h.customerId] },
      customerId: h.customerId,
      health: h,
      contract: null,
      revBridge: null,
      margin: null,
    }),
  )

  it('Healthy / Watchlist clients are never explained by risk alerts ("mainly because … open")', () => {
    for (const ev of evs) {
      if (ev.health.band === 'Healthy' || ev.health.band === 'Watchlist') {
        expect(ev.conclusion).not.toMatch(/mainly because/)
      }
      expect(ev.conclusion).not.toMatch(/(Healthy|Watchlist)[^.]*because[^.]*(cases are open|overdue)/)
    }
  })

  it('negative drivers are weak components only; positive drivers are strong components only', () => {
    for (const ev of evs) {
      for (const d of ev.diagnosis.negative) {
        expect(d.score).toBeLessThan(DIAGNOSIS_RULES.negativeScore)
        expect(d.shortfall).toBeGreaterThanOrEqual(DIAGNOSIS_RULES.negativeMinShortfall)
      }
      for (const d of ev.diagnosis.positive) {
        expect(d.score).toBeGreaterThanOrEqual(DIAGNOSIS_RULES.positiveScore)
        expect(ev.diagnosis.alerts.some((a) => a.id === d.key)).toBe(false)
      }
      const keys = [...ev.diagnosis.positive, ...ev.diagnosis.negative, ...ev.diagnosis.neutral].map((d) => d.key)
      expect(new Set(keys).size).toBe(5)
    }
  })
})

describe('Phase 3 · portfolio visuals are derived, not hard-coded', () => {
  it('distribution covers every active client and sums to 100%', () => {
    const d = healthDistribution(cq.watchlist)
    expect(d.reduce((a, s) => a + s.clients, 0)).toBe(cq.watchlist.length)
    expect(d.reduce((a, s) => a + s.clientShare, 0)).toBeCloseTo(100, 5)
  })

  it('risk driver bars count each client once per signal; multi-signal clients are disclosed', () => {
    const dist = riskDriverDistribution(cq.watchlist)
    expect(dist.bars).toHaveLength(RISK_DRIVERS.length)
    for (const b of dist.bars) {
      const t = RISK_DRIVERS.find((r) => r.key === b.key)!.riskType
      expect(b.clients).toBe(cq.watchlist.filter((w) => w.riskTypes.includes(t)).length)
    }
    expect(dist.totalSignals).toBeGreaterThanOrEqual(dist.clientsWithAnySignal)
  })

  it('migration uses real prior scores by customer ID and accounts for every client', () => {
    const m = computeHealthMigration(cq)
    expect(m.available).toBe(true)
    expect(m.cells.reduce((a, c) => a + c.clients, 0)).toBe(cq.watchlist.length)
    for (const c of m.cells) {
      for (const id of c.customerIds) {
        const w = cq.watchlist.find((x) => x.customerId === id)!
        expect(w.healthBand).toBe(c.to)
        if (c.from !== 'No prior score') expect(cq.priorHealth.get(id)!.healthBand).toBe(c.from)
      }
    }
    expect(m.newlyAtRisk).toBe(cq.kpis.newlyFlaggedClients)
  })

  it('health trend recomputes the same model (last point = current Health Score)', () => {
    const h = computeCustomerHealth(data, filters)[0]
    const t = customerHealthTrend(data, filters, h.customerId, undefined, 6)
    expect(t.length).toBeGreaterThan(1)
    expect(t[t.length - 1].score).toBe(computeCustomerHealth(data, { ...filters, customerIds: [h.customerId] })[0].healthScore)
  })
})

describe('Phase 5 · growth opportunities ≠ target gap', () => {
  const opps = computeGrowthOpportunities(data, filters, cq.profiles)
  it('only Recovery / Expansion / Pricing with positive verifiable value', () => {
    expect(opps.length).toBeGreaterThan(0)
    for (const o of opps) {
      expect(['Recovery', 'Expansion', 'Pricing']).toContain(o.type)
      expect(o.value).toBeGreaterThan(0)
      expect(o.basis.length).toBeGreaterThan(0)
    }
  })
  it('recovery value equals the actual YoY Net Billing shortfall', () => {
    for (const o of opps.filter((x) => x.type === 'Recovery')) {
      const p = cq.profiles.find((x) => x.customerId === o.customerId)!
      expect(o.value).toBeCloseTo(p.priorRevenue - p.revenue, 2)
    }
  })
  it('pricing uses rate-card adherence exceptions only', () => {
    expect([...PRICING_EXCEPTION_TYPES].sort()).toEqual(['Missing Surcharge', 'Rate Mismatch'])
  })
})
