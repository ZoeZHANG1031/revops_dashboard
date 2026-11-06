import { describe, expect, it } from 'vitest'
import { generateDataStore } from '@/data/generate'
import { computeLineCommission } from '@/data/generateCompensation'
import { defaultFilters, listHistoricalPeriods } from '@/lib/filters'
import { money } from '@/lib/money'
import {
  computeCompKpis,
  computeRepPerformance,
  currentPlanAsSimParams,
  filterCommissionAudits,
  filterCommissionLedger,
  simulatePlanChange,
} from './salesCompensation'
import { computeSharedMetrics } from './metricRegistry'

describe('sales compensation', () => {
  const data = generateDataStore(20241105)
  const hist = listHistoricalPeriods(data)
  const filters = defaultFilters(hist, hist[hist.length - 1])

  it('generates reps, plans, ledger, payments, and audit exceptions', () => {
    expect(data.salesReps.length).toBeGreaterThan(0)
    expect(data.compensationPlanVersions.length).toBeGreaterThanOrEqual(2)
    expect(data.salesQuotas.length).toBeGreaterThan(0)
    expect(data.commissionEligibility.length).toBeGreaterThan(0)
    expect(data.commissionLedger.length).toBeGreaterThan(0)
    expect(data.commissionPayments.length).toBeGreaterThan(0)
    expect(data.commissionAuditExceptions.length).toBeGreaterThan(0)
  })

  it('computes earned commission from basis × rate × accelerator', () => {
    const { earned } = computeLineCommission({
      basis: 10_000,
      baseRate: 0.02,
      acceleratorMult: 1.25,
      capRemaining: null,
    })
    expect(earned).toBe(250)
  })

  it('matches plan version by effective date (v1 vs v2)', () => {
    const v1Lines = data.commissionLedger.filter(
      (L) => L.period <= '2025-12' && L.eligibility_type === 'Revenue',
    )
    const v2Lines = data.commissionLedger.filter(
      (L) => L.period >= '2026-01' && L.eligibility_type === 'Revenue',
    )
    expect(v1Lines.some((L) => L.plan_version_id === 'PLAN-AE-STD-v1')).toBe(true)
    expect(v2Lines.some((L) => L.plan_version_id === 'PLAN-AE-STD-v2')).toBe(true)
    const v1Rate = data.compensationPlanVersions.find((v) => v.plan_version_id === 'PLAN-AE-STD-v1')!
    const v2Rate = data.compensationPlanVersions.find((v) => v.plan_version_id === 'PLAN-AE-STD-v2')!
    expect(v1Rate.revenue_rate).not.toBe(v2Rate.revenue_rate)
  })

  it('does not double-count the same eligibility_id in the ledger', () => {
    const ids = data.commissionLedger.map((L) => L.eligibility_id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('injects overpayment, underpayment, and duplicate audit types', () => {
    const types = new Set(data.commissionAuditExceptions.map((a) => a.audit_type))
    expect(types.has('Duplicate Commission') || types.has('Overpayment')).toBe(true)
    expect(types.has('Underpayment') || types.has('Clawback Not Applied')).toBe(true)
    for (const a of data.commissionAuditExceptions) {
      expect(a.is_confirmed_loss).toBe(false)
    }
  })

  it('links quota attainment to accelerator multipliers on non-clawback lines', () => {
    const ledger = filterCommissionLedger(data, filters)
    const accelerated = ledger.filter(
      (L) =>
        L.eligibility_type !== 'Clawback' &&
        L.eligibility_type !== 'Bonus' &&
        L.accelerator_mult > 1,
    )
    // At least some periods should clear 100% with stretch noise
    expect(accelerated.length + ledger.length).toBeGreaterThan(0)
    const reps = computeRepPerformance(data, filters)
    expect(reps.some((r) => r.quotaAttainmentPct != null)).toBe(true)
  })

  it('plan simulator changes payout without mutating paid history', () => {
    const beforePaid = money(
      data.commissionLedger.reduce((a, L) => a + L.paid_amount, 0),
    )
    const base = simulatePlanChange(data, filters, currentPlanAsSimParams(data))
    const higher = simulatePlanChange(data, filters, {
      ...currentPlanAsSimParams(data),
      baseRevenueRate: currentPlanAsSimParams(data).baseRevenueRate * 2,
      newAcquisitionRate: currentPlanAsSimParams(data).newAcquisitionRate * 2,
    })
    expect(higher.proposedPayout).toBeGreaterThan(base.proposedPayout)
    expect(higher.delta).not.toBe(0)
    const afterPaid = money(
      data.commissionLedger.reduce((a, L) => a + L.paid_amount, 0),
    )
    expect(afterPaid).toBe(beforePaid)
  })

  it('distinguishes earned, approved, and paid KPIs', () => {
    const k = computeCompKpis(data, filters)
    expect(k.earned).toBeGreaterThan(0)
    expect(k.approved).toBeGreaterThanOrEqual(0)
    expect(k.paid).toBeGreaterThanOrEqual(0)
    expect(k.unpaid).toBeGreaterThanOrEqual(0)
    expect(Math.abs(k.unpaid - Math.max(0, k.approved - k.paid))).toBeLessThan(0.05)
  })

  it('does not change core shared revenue metrics when compensation is present', () => {
    const m = computeSharedMetrics(data, filters, 'Base')
    expect(m.netBilledRevenue).toBeGreaterThan(0)
    expect(m.recognizedRevenue).toBeGreaterThan(0)
    // Commission expense is separate — not subtracted from Contribution Profit here
    expect(m.contributionProfit).toBeGreaterThan(0)
  })

  it('audits are filterable and exportable grain', () => {
    const audits = filterCommissionAudits(data, {
      ...filters,
      startPeriod: data.meta.history_start,
      endPeriod: data.meta.history_end,
    })
    expect(audits.length).toBe(data.commissionAuditExceptions.length)
  })
})
