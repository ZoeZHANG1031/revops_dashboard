import { describe, expect, it } from 'vitest'
import { buildActionCenter } from '@/calc/actionCenter'
import { computeCompanyOverview } from '@/calc/companyOverview'
import { computeLifecycleStages } from '@/calc/lifecycleStages'
import { computeSharedMetrics } from '@/calc/metricRegistry'
import { computeUnitEconomics } from '@/calc/unitEconomics'
import { getDataStore } from '@/data/generate'
import { defaultFilters, filterExceptions, listHistoricalPeriods, listPeriods } from '@/lib/filters'

describe('visual upgrade calculations', { timeout: 60000 }, () => {
  const data = getDataStore()
  const periods = listPeriods(data)
  const hist = listHistoricalPeriods(data)
  const filters = defaultFilters(periods, hist[hist.length - 1])
  const shipById = new Map(data.shipments.map((s) => [s.shipment_id, s]))

  it('lifecycle stage values reuse shared metric definitions (no redefinition)', () => {
    const m = computeSharedMetrics(data, filters)
    const lc = computeLifecycleStages(data, filters)
    const v = (id: string) => lc.nodes.find((n) => n.id === id)!.value
    expect(v('billing')).toBeCloseTo(m.netBilledRevenue, 2)
    expect(v('recognition')).toBeCloseTo(m.recognizedRevenue, 2)
    expect(v('collection')).toBeCloseTo(m.cashCollections, 2)
    expect(v('rating')).toBeCloseTo(m.grossBillings, 2)
    const gap = lc.gaps.find((g) => g.id === 'gap_billing_recognition')!
    // Billing − Recognition difference is shown as a neutral timing gap, never as leakage
    expect(gap.tone).toBe('neutral')
    expect(gap.value).toBeCloseTo(m.netBilledRevenue - m.recognizedRevenue, 2)
  })

  it('lifecycle monthly series sums back to stage totals', () => {
    const m = computeSharedMetrics(data, filters)
    const lc = computeLifecycleStages(data, filters)
    const sum = (k: 'netBilling' | 'recognized' | 'cash') => lc.months.reduce((a, x) => a + x[k], 0)
    expect(sum('netBilling')).toBeCloseTo(m.netBilledRevenue, 0)
    expect(sum('recognized')).toBeCloseTo(m.recognizedRevenue, 0)
    expect(sum('cash')).toBeCloseTo(m.cashCollections, 0)
  })

  it('shipment-linked exceptions honor metro scope; invoice-level stay customer-scoped', () => {
    const metro = data.shipments[0].metro
    const scoped = { ...filters, metros: [metro] }
    const all = filterExceptions(data, filters)
    const sub = filterExceptions(data, scoped)
    expect(sub.length).toBeLessThanOrEqual(all.length)
    for (const e of sub) {
      if (e.shipment_id && shipById.has(e.shipment_id)) {
        expect(shipById.get(e.shipment_id)!.metro).toBe(metro)
      }
    }
    const invoiceLevel = (xs: typeof all) => xs.filter((e) => !e.shipment_id).length
    expect(invoiceLevel(sub)).toBe(invoiceLevel(all))
  })

  it('zone dimension attributes variable cost (previously always 0)', () => {
    const econ = computeUnitEconomics(data, filters, 'zone')
    const zoneCost = econ.byDimension.reduce((a, d) => a + d.variableCost, 0)
    expect(zoneCost).toBeGreaterThan(0)
  })

  it('metro dimension revenue reconciles to scope Net Billing', () => {
    const econ = computeUnitEconomics(data, filters, 'metro')
    const rev = econ.byDimension.reduce((a, d) => a + d.revenue, 0)
    expect(rev).toBeCloseTo(econ.netRevenue, 0)
  })

  it('segment shares are real shares summing to ~100%', () => {
    const o = computeCompanyOverview(data, filters)
    const sum = (k: 'customerShare' | 'revenueShare' | 'contributionShare') =>
      o.segments.reduce((a, s) => a + (s[k] ?? 0), 0)
    expect(sum('customerShare')).toBeCloseTo(100, 0)
    expect(sum('revenueShare')).toBeCloseTo(100, 0)
    expect(sum('contributionShare')).toBeCloseTo(100, 0)
    for (const m of o.metros) {
      if (m.exceptionRate != null) expect(m.exceptionRate).toBeGreaterThanOrEqual(0)
      // contributionMargin is a display % rounded to 0.01pt → allow half a step of revenue
      if (m.contributionMargin != null)
        expect(Math.abs(m.contribution - (m.revenue * m.contributionMargin) / 100)).toBeLessThanOrEqual(
          Math.abs(m.revenue) * 0.00005 + 0.5,
        )
    }
  })

  it('action priority score is explicit and ordered', () => {
    const items = buildActionCenter(data, filters)
    expect(items.length).toBeGreaterThan(0)
    for (const i of items) {
      expect(i.priorityScore).toBe(
        (i.impactScore ?? 0) +
          (i.urgency ?? 0) +
          ({ High: 3, Medium: 2, Low: 1 } as const)[i.confidence!] +
          i.actionability,
      )
      // Derived / scenario items never claim High confidence
      if (!i.sourceException) expect(i.confidence).toBe('Low')
    }
    for (let k = 1; k < items.length; k++) {
      expect(items[k - 1].priorityScore!).toBeGreaterThanOrEqual(items[k].priorityScore!)
    }
  })
})
