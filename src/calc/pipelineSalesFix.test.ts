import { describe, expect, it } from 'vitest'
import { generateDataStore } from '@/data/generate'
import { computeSalesPipeline } from './lifecycle'
import { DEMO_STAGE_AGE, DEMO_STAGE_WIN_PROB } from './pipelineDemoConfig'
import { topOpenOpportunities } from './pipelineMovement'
import { money, sumMoney } from '@/lib/money'

describe('Sales Pipeline demo fixes', () => {
  const data = generateDataStore()
  const sales = computeSalesPipeline(data)
  const open = data.opportunities.filter((o) => !o.stage.startsWith('Closed'))
  const closedWon = data.opportunities.filter((o) => o.stage === 'Closed Won')
  const closedLost = data.opportunities.filter((o) => o.stage === 'Closed Lost')

  it('Gross / Weighted stage footings match KPI totals', () => {
    expect(sales.openGrossFoots).toBe(true)
    expect(sales.openWeightedFoots).toBe(true)
    expect(sales.pipelineValue).toBe(
      sumMoney(open.map((o) => o.opportunity_value)),
    )
    expect(sales.weightedPipeline).toBe(
      sumMoney(open.map((o) => money(o.opportunity_value * o.win_probability))),
    )
  })

  it('stage labels match value-weighted opp probabilities from demo config', () => {
    for (const o of open) {
      expect(o.win_probability).toBe(DEMO_STAGE_WIN_PROB[o.stage])
    }
    for (const s of sales.stageStock.filter((x) => !x.stage.startsWith('Closed'))) {
      if (!s.count) continue
      const expected = s.value > 0 ? s.weighted / s.value : DEMO_STAGE_WIN_PROB[s.stage]
      expect(Math.abs((s.avgWinProb ?? 0) - expected)).toBeLessThan(0.001)
      expect(s.labelProbPct).toBe(Math.round(expected * 100))
    }
  })

  it('Stage Age uses stage entry; medians stay in demo bands with some overdue', () => {
    let overdueTotal = 0
    for (const a of sales.stageAging) {
      overdueTotal += a.overdueCount
      expect(a.medianDays).not.toBeNull()
      expect(a.medianDays!).toBeLessThan(80)
      // Median should usually sit near normal band (not ~100d)
      const band = DEMO_STAGE_AGE[a.stage]
      expect(a.medianDays!).toBeLessThanOrEqual(band.overdueMax + 5)
    }
    expect(overdueTotal).toBeGreaterThan(0)
    expect(overdueTotal / open.length).toBeGreaterThanOrEqual(0.05)
    expect(overdueTotal / open.length).toBeLessThanOrEqual(0.45)
  })

  it('segments cover all Won+Lost; Lost not dumped into Unknown', () => {
    const segClosed = sales.winLossBySegment.reduce((a, r) => a + r.won + r.lost, 0)
    expect(segClosed).toBe(closedWon.length + closedLost.length)
    const unknown = sales.winLossBySegment.find((s) => s.segment === 'Unknown')
    expect(unknown?.n ?? 0).toBe(0)
    for (const seg of ['Enterprise', 'Mid-Market', 'SMB'] as const) {
      const row = sales.winLossBySegment.find((s) => s.segment === seg)!
      expect(row.won + row.lost).toBeGreaterThan(0)
      // Not all 100% win with lost present overall
    }
    expect(closedLost.length).toBeGreaterThan(0)
    expect(sales.winLossBySegment.some((s) => s.lost > 0 && s.segment !== 'Unknown')).toBe(true)
  })

  it('preserves opportunity count/value totals shape and date consistency', () => {
    expect(data.opportunities.length).toBe(open.length + closedWon.length + closedLost.length)
    for (const o of data.opportunities) {
      expect(o.expected_start_date >= o.expected_close_date).toBe(true)
      expect(o.segment).toMatch(/Enterprise|Mid-Market|SMB/)
      const evs = data.opportunityStageEvents
        .filter((e) => e.opportunity_id === o.opportunity_id)
        .sort((a, b) => a.event_date.localeCompare(b.event_date))
      expect(evs.length).toBeGreaterThan(0)
      expect(evs[0].event_date >= o.created_date).toBe(true)
      for (let i = 1; i < evs.length; i++) {
        expect(evs[i].event_date >= evs[i - 1].event_date).toBe(true)
      }
      if (!o.closed_date) {
        expect(evs.every((e) => e.event_date <= data.meta.as_of_date)).toBe(true)
      }
    }
  })

  it('top open opps expose demo next steps and expected close', () => {
    const top = topOpenOpportunities(data, data.meta.as_of_date, 5)
    expect(top.length).toBeGreaterThan(0)
    for (const t of top) {
      expect(t.nextStep.length).toBeGreaterThan(0)
      expect(t.expectedClose).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(t.owner.length).toBeGreaterThan(0)
    }
  })

  it('coverage uses near-term weighted vs independent demo target', () => {
    expect(sales.remainingSalesTarget).toBe(18_000_000)
    expect(sales.coverageMult).not.toBeNull()
    expect(sales.nearTermWeighted).toBeGreaterThanOrEqual(0)
  })
})
