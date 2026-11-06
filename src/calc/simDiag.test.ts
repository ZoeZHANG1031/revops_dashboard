import { describe, it, expect } from 'vitest'
import { getDataStore } from '../data/generate'
import { defaultFilters, listHistoricalPeriods } from '../lib/filters'
import {
  computeCompKpis,
  computeCommissionStatusBreakdown,
  currentPlanAsSimParams,
  simulatePlanChange,
  UNASSIGNED_COMMISSION_REP_ID,
} from './salesCompensation'
import { money } from '../lib/money'
import { computeUnitEconomics } from './unitEconomics'

describe('sim / status integrity', () => {
  it('margin kicker is unassigned and Σ rep delta = total delta', () => {
    const data = getDataStore()
    const hist = listHistoricalPeriods(data)
    const filters = defaultFilters(hist, hist[hist.length - 1])
    const contrib = computeUnitEconomics(data, filters).contributionProfit
    const base = currentPlanAsSimParams(data)
    const r0 = simulatePlanChange(data, filters, base, { repIds: [], teams: [] }, contrib)
    expect(Math.abs(r0.delta)).toBeLessThan(0.05)
    expect(Math.abs(r0.delta - r0.sumRepDelta)).toBeLessThan(0.02)
    expect(r0.byRep.some((r) => r.repId === UNASSIGNED_COMMISSION_REP_ID)).toBe(true)

    const r1 = simulatePlanChange(
      data,
      filters,
      { ...base, baseRevenueRate: base.baseRevenueRate * 1.2 },
      { repIds: [], teams: [] },
      contrib,
    )
    expect(Math.abs(r1.delta - r1.sumRepDelta)).toBeLessThan(0.02)
    expect(r1.byRep.filter((r) => !r.unassigned && r.delta !== 0).length).toBeGreaterThan(0)
  })

  it('status bridge: pending + approved unpaid + paid + rejected reconcile to lifecycle', () => {
    const data = getDataStore()
    const hist = listHistoricalPeriods(data)
    const filters = defaultFilters(hist, hist[hist.length - 1])
    const k = computeCompKpis(data, filters)
    const br = computeCommissionStatusBreakdown(data, filters)
    const pending = br.find((b) => b.status === 'Pending Approval')!.amount
    const approvedUnpaid = br.find((b) => b.status === 'Approved Unpaid')!.amount
    const paid = br.find((b) => b.status === 'Paid')!.amount
    expect(Math.abs(pending - k.pendingApproval)).toBeLessThan(0.02)
    expect(Math.abs(approvedUnpaid - k.approvedUnpaid)).toBeLessThan(0.02)
    expect(Math.abs(paid - k.paid)).toBeLessThan(0.02)
    expect(Math.abs(k.approvedUnpaid - money(Math.max(0, k.approved - k.paid)))).toBeLessThan(0.05)
    // Earned ≈ pending + approved (rejected separate); approved covers paid+unpaid
    expect(money(k.pendingApproval + k.approved + k.rejected)).toBeCloseTo(k.earned, 1)
  })
})
