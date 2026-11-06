import { describe, expect, it } from 'vitest'
import { generateDataStore } from '@/data/generate'
import { defaultFilters, listHistoricalPeriods } from '@/lib/filters'
import { computeArSnapshot } from './arSnapshot'
import { computeSharedMetrics } from './metricRegistry'
import { runDataValidation } from './dataValidation'
import { computeSalesPipeline } from './lifecycle'
import { computeReconciliationBridge } from './reconBridge'

describe('AR / recon / pipeline integrity (final optimization)', () => {
  const data = generateDataStore(20241105)
  const hist = listHistoricalPeriods(data)
  const filters = defaultFilters(hist, hist[hist.length - 1])

  it('aging foots to outstanding and overdue; matches SharedMetrics', () => {
    const ar = computeArSnapshot(data, filters)
    const m = computeSharedMetrics(data, filters, 'Base')
    expect(ar.agingFoots).toBe(true)
    expect(ar.overdueFoots).toBe(true)
    expect(Math.abs(m.accountsReceivable - ar.outstandingAr)).toBeLessThan(0.05)
    expect(Math.abs(m.overdueAr - ar.overdueAr)).toBeLessThan(0.05)
    expect(ar.overdueAr).toBeLessThanOrEqual(ar.outstandingAr + 0.05)
  })

  it('reconciliation bridge foots and exposes A/B/C/D classes', () => {
    const b = computeReconciliationBridge(data, filters)
    expect(b.reconciles).toBe(true)
    expect(b.classTotals).toBeDefined()
    expect(b.items.every((i) => i.diffClass)).toBe(true)
    expect(b.gapPctOfExpected).not.toBeNull()
  })

  it('segment win/loss rolls up to overall closed deals', () => {
    const s = computeSalesPipeline(data)
    const seg = s.winLossBySegment.reduce((a, r) => a + r.won + r.lost, 0)
    expect(seg).toBe((s.closedWonCount ?? 0) + (s.closedLostCount ?? 0))
    expect(s.closedDealWinRate).toBe(s.winRate)
  })

  it('cross-module validation has no Fail on core identities', () => {
    const checks = runDataValidation(data, filters, 'Base')
    const fails = checks.filter((c) => c.status === 'Fail')
    expect(fails).toEqual([])
  })
})
