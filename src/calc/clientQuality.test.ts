import { describe, expect, it } from 'vitest'
import { generateDataStore } from '@/data/generate'
import { defaultFilters, listHistoricalPeriods } from '@/lib/filters'
import {
  attributeHealthChange,
  computeClientQualityPortfolio,
  DEFAULT_CQ_WEIGHTS,
  scoreClientQuality,
} from './clientQuality'
import { computeCustomerHealth } from './customerHealth'

describe('Client Quality Intelligence', () => {
  const data = generateDataStore()
  const hist = listHistoricalPeriods(data)
  const filters = defaultFilters(hist, hist[hist.length - 1])

  it('scores are 0–100 or null; missing relationship does not count as zero', () => {
    const rows = computeCustomerHealth(data, filters)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows.slice(0, 25)) {
      const cq = scoreClientQuality(row, { asOfDate: data.meta.as_of_date })
      if (cq.score != null) {
        expect(cq.score).toBeGreaterThanOrEqual(0)
        expect(cq.score).toBeLessThanOrEqual(100)
      }
      const rel = cq.dimensions.find((d) => d.key === 'relationshipSignals')!
      if (!rel.available) {
        expect(rel.score).toBeNull()
        expect(rel.normalizedWeight).toBe(0)
        const availW = cq.dimensions.filter((d) => d.available).reduce((a, d) => a + d.normalizedWeight, 0)
        expect(availW).toBeCloseTo(1, 5)
      }
    }
  })

  it('configured weights sum to 1', () => {
    const sum = Object.values(DEFAULT_CQ_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 9)
  })

  it('portfolio KPIs are dynamic and exposure is not scenario RaR', () => {
    const p = computeClientQualityPortfolio(data, filters)
    expect(p.kpis.activeClients).toBeGreaterThan(0)
    expect(p.kpis.clientsAtRisk).toBeLessThanOrEqual(p.kpis.activeClients)
    expect(p.kpis.healthyClients + p.kpis.clientsAtRisk).toBeLessThanOrEqual(p.kpis.activeClients + p.profiles.length)
    expect(p.kpis.revenueExposureNote.toLowerCase()).toContain('not guaranteed')
    // Newly flagged / improving are null when no prior, else non-negative
    if (!p.kpis.priorComparable) {
      expect(p.kpis.newlyFlaggedClients).toBeNull()
      expect(p.kpis.clientsImproving).toBeNull()
    } else {
      expect(p.kpis.newlyFlaggedClients).toBeGreaterThanOrEqual(0)
      expect(p.kpis.clientsImproving).toBeGreaterThanOrEqual(0)
    }
  })

  it('watchlist priority is not a pure ascending health sort', () => {
    const p = computeClientQualityPortfolio(data, filters)
    const elevated = p.watchlist.filter((w) => w.priority !== 'Healthy')
    if (elevated.length < 2) return
    // First row should be High/Medium before lower priorities
    const rank = (x: string) =>
      x === 'High Priority' ? 4 : x === 'Medium Priority' ? 3 : x === 'Monitor' ? 2 : 1
    for (let i = 1; i < Math.min(elevated.length, 8); i++) {
      expect(rank(elevated[i - 1].priority)).toBeGreaterThanOrEqual(rank(elevated[i].priority))
    }
  })

  it('health attribution reconciles to total change when both scores exist', () => {
    const p = computeClientQualityPortfolio(data, filters)
    const withPrior = [...p.scores.entries()].find(([id, cur]) => {
      const prior = p.priorScores.get(id)
      return cur.score != null && prior?.score != null
    })
    if (!withPrior) return
    const [id, cur] = withPrior
    const prior = p.priorScores.get(id)!
    const attr = attributeHealthChange(prior, cur)
    expect(attr.totalChange).not.toBeNull()
    const start = attr.steps.find((s) => s.key === 'prior')!.amount
    const end = attr.steps.find((s) => s.key === 'current')!.amount
    const mid = attr.steps
      .filter((s) => s.key !== 'prior' && s.key !== 'current')
      .reduce((a, s) => a + s.amount, 0)
    expect(Math.abs(start + mid - end)).toBeLessThan(0.15)
    expect(Math.abs((attr.totalChange ?? 0) - (end - start))).toBeLessThan(0.05)
  })

  it('does not invent complaints or support tickets in relationship signals', () => {
    const row = computeCustomerHealth(data, filters)[0]
    const cq = scoreClientQuality(row, { asOfDate: data.meta.as_of_date })
    const rel = cq.dimensions.find((d) => d.key === 'relationshipSignals')!
    expect(rel.signals.join(' ').toLowerCase()).not.toMatch(/complaint|support ticket/)
    if (!rel.available) {
      expect(rel.signals.join(' ').toLowerCase()).toMatch(/not in data|unavailable/)
    }
  })
})
