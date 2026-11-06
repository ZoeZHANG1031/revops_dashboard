/**
 * Sales Compensation analytics — earned ≠ approved ≠ paid.
 * Eligible Revenue uses invoice Net Billing attributed to account owners; never defaults
 * all Recognized Revenue to commissionable.
 */
import { computeLineCommission } from '@/data/generateCompensation'
import { matchesCustomer, periodInRange } from '@/lib/filters'
import { money, pct, sumMoney } from '@/lib/money'
import type {
  CommissionAcceleratorTier,
  DataStore,
  FactCommissionAuditException,
  FactCommissionLedger,
  FactCompensationPlanVersion,
  GlobalFilters,
} from '@/types'

export interface CompLocalFilters {
  repIds: string[]
  teams: string[]
}

export interface PlanSimParams {
  baseRevenueRate: number
  newAcquisitionRate: number
  expansionRate: number
  quotaThresholdPct: number
  acceleratorBelow: number
  accelerator100: number
  accelerator120: number
  commissionCap: number | null
  newCustomerBonus: number
  expansionBonusPct: number
  clawbackCreditRate: number
  marginIncentiveRate: number
  /** Scales quota denominator: attainment = eligible / (quota × (1 + adj/100)) */
  quotaAdjustmentPct: number
  /** Minimum contribution margin % for residual revenue eligibility; 0 = off */
  minimumMarginEligibilityPct: number
}

export const DEFAULT_SIM_PARAMS: PlanSimParams = {
  baseRevenueRate: 0.009,
  newAcquisitionRate: 0.045,
  expansionRate: 0.03,
  quotaThresholdPct: 100,
  acceleratorBelow: 1,
  accelerator100: 1.25,
  accelerator120: 1.5,
  commissionCap: null,
  newCustomerBonus: 2000,
  expansionBonusPct: 0.005,
  clawbackCreditRate: 0.6,
  marginIncentiveRate: 0,
  quotaAdjustmentPct: 0,
  minimumMarginEligibilityPct: 0,
}

function repMatches(
  data: DataStore,
  repId: string,
  local: CompLocalFilters,
): boolean {
  if (local.repIds.length && !local.repIds.includes(repId)) return false
  if (local.teams.length) {
    const rep = data.salesReps.find((r) => r.rep_id === repId)
    if (!rep || !local.teams.includes(rep.team)) return false
  }
  return true
}

export function filterCommissionLedger(
  data: DataStore,
  filters: GlobalFilters,
  local: CompLocalFilters = { repIds: [], teams: [] },
): FactCommissionLedger[] {
  return data.commissionLedger.filter((L) => {
    if (!periodInRange(L.period, filters.startPeriod, filters.endPeriod)) return false
    if (!matchesCustomer(L.customer_id, filters)) return false
    if (!repMatches(data, L.rep_id, local)) return false
    return true
  })
}

export function filterCommissionAudits(
  data: DataStore,
  filters: GlobalFilters,
  local: CompLocalFilters = { repIds: [], teams: [] },
): FactCommissionAuditException[] {
  return data.commissionAuditExceptions.filter((a) => {
    if (!periodInRange(a.period, filters.startPeriod, filters.endPeriod)) return false
    if (!matchesCustomer(a.customer_id, filters)) return false
    if (!repMatches(data, a.rep_id, local)) return false
    return true
  })
}

function pickVersion(
  data: DataStore,
  period: string,
): FactCompensationPlanVersion {
  const day = `${period}-15`
  return (
    data.compensationPlanVersions.find(
      (v) => v.effective_from <= day && (v.effective_to == null || v.effective_to >= day),
    ) ?? data.compensationPlanVersions[data.compensationPlanVersions.length - 1]
  )
}

function simAccelerator(params: PlanSimParams, attainmentPct: number): number {
  if (attainmentPct >= 120) return params.accelerator120
  if (attainmentPct >= params.quotaThresholdPct) return params.accelerator100
  return params.acceleratorBelow
}

export interface CompKpis {
  earned: number
  approved: number
  paid: number
  /** @deprecated Use approvedUnpaid — kept for smoke/compat */
  unpaid: number
  pendingApproval: number
  approvedUnpaid: number
  rejected: number
  /** Earned Commission / Eligible Revenue */
  effectiveCommissionRatePct: number | null
  /** Simple average of rep×period attainment */
  avgQuotaAttainmentPct: number | null
  /** Quota-weighted average attainment */
  weightedQuotaAttainmentPct: number | null
  attainmentBasis: 'simple_average' | 'quota_weighted'
  commissionCostPctOfEligible: number | null
  eligibleRevenue: number
  openAuditExceptions: number
  openAuditExposure: number
}

export type CommissionStatusBucket =
  | 'Pending Approval'
  | 'Approved Unpaid'
  | 'Paid'
  | 'Rejected'

export interface CommissionStatusBreakdownRow {
  status: CommissionStatusBucket
  amount: number
  entryCount: number
}

/**
 * Lifecycle bridge on the same ledger entry set (period filter = Commission Period).
 * Pending Approval = earned on Pending rows (excl. Rejected).
 * Approved Unpaid = approved − paid on Approved rows.
 * Rejected = earned on Rejected rows (excluded from Pending).
 */
export function computeCommissionStatusBreakdown(
  data: DataStore,
  filters: GlobalFilters,
  local: CompLocalFilters = { repIds: [], teams: [] },
): CommissionStatusBreakdownRow[] {
  const ledger = filterCommissionLedger(data, filters, local)
  let pending = 0
  let pendingN = 0
  let approved = 0
  let approvedUnpaidN = 0
  let paid = 0
  let paidN = 0
  let rejected = 0
  let rejectedN = 0
  for (const L of ledger) {
    if (L.approval_status === 'Rejected') {
      rejected = money(rejected + L.commission_earned)
      rejectedN++
      continue
    }
    if (L.approval_status === 'Pending') {
      pending = money(pending + L.commission_earned)
      pendingN++
      continue
    }
    // Approved — company Approved Unpaid = Σapproved − Σpaid (same as KPI)
    approved = money(approved + L.approved_amount)
    paid = money(paid + L.paid_amount)
    if (L.paid_amount > 0.005) paidN++
    if (money(Math.max(0, L.approved_amount - L.paid_amount)) > 0.005) approvedUnpaidN++
  }
  const approvedUnpaid = money(Math.max(0, approved - paid))
  return [
    { status: 'Pending Approval', amount: pending, entryCount: pendingN },
    { status: 'Approved Unpaid', amount: approvedUnpaid, entryCount: approvedUnpaidN },
    { status: 'Paid', amount: paid, entryCount: paidN },
    { status: 'Rejected', amount: rejected, entryCount: rejectedN },
  ]
}

export function computeCompKpis(
  data: DataStore,
  filters: GlobalFilters,
  local: CompLocalFilters = { repIds: [], teams: [] },
): CompKpis {
  const ledger = filterCommissionLedger(data, filters, local)
  const earned = sumMoney(ledger.map((L) => L.commission_earned))
  const approved = sumMoney(
    ledger.filter((L) => L.approval_status === 'Approved').map((L) => L.approved_amount),
  )
  const paid = sumMoney(ledger.map((L) => L.paid_amount))
  const pendingApproval = sumMoney(
    ledger
      .filter((L) => L.approval_status === 'Pending')
      .map((L) => L.commission_earned),
  )
  const rejected = sumMoney(
    ledger
      .filter((L) => L.approval_status === 'Rejected')
      .map((L) => L.commission_earned),
  )
  const approvedUnpaid = money(Math.max(0, approved - paid))
  const unpaid = approvedUnpaid

  const eligibleRevenue = sumMoney(
    ledger
      .filter((L) => L.eligibility_type === 'Revenue' || L.eligibility_type === 'Expansion')
      .map((L) => Math.max(0, L.basis_amount)),
  )

  // Attainment: simple average + quota-weighted across rep×period in window
  const quotas = data.salesQuotas.filter(
    (q) =>
      periodInRange(q.period, filters.startPeriod, filters.endPeriod) &&
      repMatches(data, q.rep_id, local),
  )
  const eligibleByRepPeriod = new Map<string, number>()
  for (const L of ledger) {
    if (L.eligibility_type !== 'Revenue' && L.eligibility_type !== 'Expansion') continue
    const k = `${L.rep_id}|${L.period}`
    eligibleByRepPeriod.set(k, money((eligibleByRepPeriod.get(k) ?? 0) + Math.max(0, L.basis_amount)))
  }
  const attainments: number[] = []
  let weightedSum = 0
  let quotaWeight = 0
  for (const q of quotas) {
    const actual = eligibleByRepPeriod.get(`${q.rep_id}|${q.period}`) ?? 0
    if (q.quota_amount > 0) {
      const a = (actual / q.quota_amount) * 100
      attainments.push(a)
      weightedSum += a * q.quota_amount
      quotaWeight += q.quota_amount
    }
  }
  const avgQuotaAttainmentPct =
    attainments.length > 0
      ? money(attainments.reduce((a, b) => a + b, 0) / attainments.length)
      : null
  const weightedQuotaAttainmentPct =
    quotaWeight > 0 ? money(weightedSum / quotaWeight) : null

  const audits = filterCommissionAudits(data, filters, local).filter(
    (a) => a.status === 'Open' || a.status === 'Investigating',
  )

  return {
    earned,
    approved,
    paid,
    unpaid,
    pendingApproval,
    approvedUnpaid,
    rejected,
    effectiveCommissionRatePct: pct(earned, eligibleRevenue),
    avgQuotaAttainmentPct,
    weightedQuotaAttainmentPct,
    attainmentBasis: 'simple_average',
    commissionCostPctOfEligible: pct(earned, eligibleRevenue),
    eligibleRevenue,
    openAuditExceptions: audits.length,
    openAuditExposure: sumMoney(audits.map((a) => a.financial_impact)),
  }
}

export interface CompTrendPoint {
  period: string
  earned: number
  approved: number
  paid: number
  eligibleRevenue: number
}

export function computeCompTrend(
  data: DataStore,
  filters: GlobalFilters,
  local: CompLocalFilters = { repIds: [], teams: [] },
): CompTrendPoint[] {
  const ledger = filterCommissionLedger(data, filters, local)
  const map = new Map<string, CompTrendPoint>()
  for (const L of ledger) {
    const cur = map.get(L.period) ?? {
      period: L.period,
      earned: 0,
      approved: 0,
      paid: 0,
      eligibleRevenue: 0,
    }
    cur.earned = money(cur.earned + L.commission_earned)
    cur.approved = money(cur.approved + L.approved_amount)
    cur.paid = money(cur.paid + L.paid_amount)
    if (L.eligibility_type === 'Revenue' || L.eligibility_type === 'Expansion') {
      cur.eligibleRevenue = money(cur.eligibleRevenue + Math.max(0, L.basis_amount))
    }
    map.set(L.period, cur)
  }
  return [...map.values()].sort((a, b) => a.period.localeCompare(b.period))
}

export interface RepPerformanceRow {
  repId: string
  repName: string
  team: string
  territory: string
  quota: number
  quotaBasis: string
  eligibleRevenue: number
  quotaAttainmentPct: number | null
  closedWonValue: number
  newCustomerRevenue: number
  expansionRevenue: number
  earned: number
  approved: number
  paid: number
  pendingApproval: number
  effectiveCommissionRatePct: number | null
  revenuePerCommissionDollar: number | null
  activeAccounts: number
  winRate: number | null
  avgSalesCycle: number | null
  avgDealSize: number | null
  openAudits: number
  appliedPlanVersions: string
}

export function computeRepPerformance(
  data: DataStore,
  filters: GlobalFilters,
  local: CompLocalFilters = { repIds: [], teams: [] },
): RepPerformanceRow[] {
  const ledger = filterCommissionLedger(data, filters, local)
  const nameById = new Map(data.salesReps.map((r) => [r.rep_id, r]))
  const custToRep = new Map(
    data.customers.map((c) => {
      const rep = data.salesReps.find((r) => r.rep_name === c.account_owner)
      return [c.customer_id, rep?.rep_id ?? ''] as const
    }),
  )

  const byRep = new Map<string, RepPerformanceRow>()
  const ensure = (repId: string) => {
    let row = byRep.get(repId)
    if (!row) {
      const rep = nameById.get(repId)
      row = {
        repId,
        repName: rep?.rep_name ?? repId,
        team: rep?.team ?? '—',
        territory: rep?.territory_region ?? '—',
        quota: 0,
        quotaBasis: 'Eligible Revenue',
        eligibleRevenue: 0,
        quotaAttainmentPct: null,
        closedWonValue: 0,
        newCustomerRevenue: 0,
        expansionRevenue: 0,
        earned: 0,
        approved: 0,
        paid: 0,
        pendingApproval: 0,
        effectiveCommissionRatePct: null,
        revenuePerCommissionDollar: null,
        activeAccounts: 0,
        winRate: null,
        avgSalesCycle: null,
        avgDealSize: null,
        openAudits: 0,
        appliedPlanVersions: '',
      }
      byRep.set(repId, row)
    }
    return row
  }

  const accountsByRep = new Map<string, Set<string>>()
  const planVersionsByRep = new Map<string, Set<string>>()
  const wonDealSizes = new Map<string, number[]>()

  for (const L of ledger) {
    const row = ensure(L.rep_id)
    row.earned = money(row.earned + L.commission_earned)
    row.approved = money(row.approved + L.approved_amount)
    row.paid = money(row.paid + L.paid_amount)
    if (L.approval_status === 'Pending') {
      row.pendingApproval = money(row.pendingApproval + L.commission_earned)
    }
    if (L.eligibility_type === 'Revenue' || L.eligibility_type === 'Expansion') {
      row.eligibleRevenue = money(row.eligibleRevenue + Math.max(0, L.basis_amount))
    }
    if (L.eligibility_type === 'Expansion') {
      row.expansionRevenue = money(row.expansionRevenue + Math.max(0, L.basis_amount))
    }
    if (L.eligibility_type === 'New Acquisition') {
      row.closedWonValue = money(row.closedWonValue + L.basis_amount)
      row.newCustomerRevenue = money(row.newCustomerRevenue + L.basis_amount)
    }
    if (L.customer_id) {
      const set = accountsByRep.get(L.rep_id) ?? new Set()
      set.add(L.customer_id)
      accountsByRep.set(L.rep_id, set)
    }
    const pv = planVersionsByRep.get(L.rep_id) ?? new Set()
    pv.add(L.plan_version_id)
    planVersionsByRep.set(L.rep_id, pv)
  }

  for (const q of data.salesQuotas) {
    if (!periodInRange(q.period, filters.startPeriod, filters.endPeriod)) continue
    if (!repMatches(data, q.rep_id, local)) continue
    const row = ensure(q.rep_id)
    row.quota = money(row.quota + q.quota_amount)
    row.quotaBasis = q.quota_basis
  }

  // Win rate / cycle from opportunities attributed via customer owner
  const oppStats = new Map<string, { won: number; lost: number; cycles: number[] }>()
  for (const o of data.opportunities) {
    if (!o.closed_date) continue
    const period = o.closed_date.slice(0, 7)
    if (!periodInRange(period, filters.startPeriod, filters.endPeriod)) continue
    let repId: string | undefined
    if (o.customer_id) {
      repId = custToRep.get(o.customer_id)
      if (filters.customerIds.length && !filters.customerIds.includes(o.customer_id)) continue
    } else {
      // Open/lost prospects: hash-assign by prospect name to keep counts non-zero
      const idx =
        Math.abs(
          [...o.prospect_name].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 0),
        ) % data.salesReps.length
      repId = data.salesReps[idx]?.rep_id
    }
    if (!repId || !repMatches(data, repId, local)) continue
    const st = oppStats.get(repId) ?? { won: 0, lost: 0, cycles: [] }
    if (o.stage === 'Closed Won') {
      st.won++
      const sizes = wonDealSizes.get(repId) ?? []
      sizes.push(o.opportunity_value)
      wonDealSizes.set(repId, sizes)
    }
    if (o.stage === 'Closed Lost') st.lost++
    if (o.sales_cycle_days != null) st.cycles.push(o.sales_cycle_days)
    oppStats.set(repId, st)
  }

  for (const [repId, st] of oppStats) {
    const row = ensure(repId)
    const closed = st.won + st.lost
    row.winRate = closed > 0 ? pct(st.won, closed) : null
    row.avgSalesCycle =
      st.cycles.length > 0
        ? money(st.cycles.reduce((a, b) => a + b, 0) / st.cycles.length)
        : null
    const deals = wonDealSizes.get(repId) ?? []
    row.avgDealSize =
      deals.length > 0 ? money(deals.reduce((a, b) => a + b, 0) / deals.length) : null
  }

  const audits = filterCommissionAudits(data, filters, local)
  for (const a of audits) {
    if (a.status !== 'Open' && a.status !== 'Investigating') continue
    ensure(a.rep_id).openAudits++
  }

  for (const row of byRep.values()) {
    row.quotaAttainmentPct = pct(row.eligibleRevenue, row.quota)
    row.effectiveCommissionRatePct = pct(row.earned, row.eligibleRevenue)
    row.revenuePerCommissionDollar =
      row.earned > 0.005 ? money(row.eligibleRevenue / row.earned) : null
    row.activeAccounts = accountsByRep.get(row.repId)?.size ?? 0
    row.appliedPlanVersions = [...(planVersionsByRep.get(row.repId) ?? [])].sort().join(', ')
  }

  return [...byRep.values()].sort((a, b) => b.earned - a.earned)
}

export interface CustomerCompSummary {
  customerId: string
  eligibleRevenue: number
  commissionExpense: number
  blendedRate: number | null
  adjustments: number
  repName: string
}

export function computeCustomerCommission(
  data: DataStore,
  filters: GlobalFilters,
  customerId: string,
): CustomerCompSummary {
  const cust = data.customers.find((c) => c.customer_id === customerId)
  const scoped: GlobalFilters = { ...filters, customerIds: [customerId] }
  const ledger = filterCommissionLedger(data, scoped)
  const eligibleRevenue = sumMoney(
    ledger
      .filter((L) => L.eligibility_type === 'Revenue' || L.eligibility_type === 'Expansion')
      .map((L) => Math.max(0, L.basis_amount)),
  )
  const commissionExpense = sumMoney(
    ledger.filter((L) => L.eligibility_type !== 'Clawback').map((L) => L.commission_earned),
  )
  const adjustments = sumMoney(
    ledger.filter((L) => L.eligibility_type === 'Clawback').map((L) => L.commission_earned),
  )
  return {
    customerId,
    eligibleRevenue,
    commissionExpense,
    blendedRate: pct(commissionExpense, eligibleRevenue),
    adjustments,
    repName: cust?.account_owner ?? '—',
  }
}

export const UNASSIGNED_COMMISSION_REP_ID = '__UNASSIGNED__'

export interface SimulatorRepImpact {
  repId: string
  repName: string
  team: string
  eligibleRevenue: number
  quotaAttainmentPct: number | null
  current: number
  proposed: number
  delta: number
  deltaPct: number | null
  primaryChangeDriver: string
  unassigned: boolean
}

export interface SimulatorWaterfallStep {
  key: string
  label: string
  amount: number
}

export interface SimulatorResult {
  disclaimer: string
  /** Alias kept for tests — Current Plan Earned Commission */
  currentPayout: number
  proposedPayout: number
  currentPlanEarned: number
  proposedPlanEarned: number
  delta: number
  unassignedCurrent: number
  unassignedProposed: number
  currentCostPct: number | null
  proposedCostPct: number | null
  eligibleRevenue: number
  /** Contribution after commission — illustrative; does not rewrite Unit Economics */
  contributionAfterCommissionCurrent: number | null
  contributionAfterCommissionProposed: number | null
  waterfall: SimulatorWaterfallStep[]
  byRep: SimulatorRepImpact[]
  winners: string[]
  losers: string[]
  sumRepDelta: number
}

function marginKicker(
  rate: number,
  contributionProfit: number | null,
): number {
  if (rate <= 0 || contributionProfit == null || contributionProfit <= 0) return 0
  return money(contributionProfit * rate)
}

/** Recompute commission on one eligibility set under a param set (no margin kicker). */
function simulateEligibilityPayout(
  data: DataStore,
  elig: DataStore['commissionEligibility'],
  attainRP: Map<string, number>,
  params: PlanSimParams,
): { total: number; byRep: Map<string, number>; byType: Map<string, number> } {
  const byRep = new Map<string, number>()
  const byType = new Map<string, number>()
  let total = 0
  const capLeft = new Map<string, number | null>()

  for (const e of elig) {
    const attain = attainRP.get(`${e.rep_id}|${e.period}`) ?? 0
    const mult =
      e.eligibility_type === 'Clawback' || e.eligibility_type === 'Bonus'
        ? 1
        : simAccelerator(params, attain)

    let baseRate = 0
    let basis = e.basis_amount
    let typeKey: string = e.eligibility_type
    if (e.eligibility_type === 'New Acquisition') {
      baseRate = params.newAcquisitionRate
      typeKey = 'Acquisition'
    } else if (e.eligibility_type === 'Expansion') {
      baseRate = params.expansionRate + params.expansionBonusPct
      typeKey = 'Expansion'
    } else if (e.eligibility_type === 'Revenue') {
      baseRate = params.baseRevenueRate
      typeKey = 'BaseRate'
    } else if (e.eligibility_type === 'Bonus') {
      basis = params.newCustomerBonus
      baseRate = 1
      typeKey = 'Bonus'
    } else if (e.eligibility_type === 'Clawback') {
      const version = pickVersion(data, e.period)
      const credits =
        version.clawback_credit_rate > 0
          ? Math.abs(e.basis_amount) / version.clawback_credit_rate
          : 0
      basis = -money(credits * params.clawbackCreditRate)
      baseRate = 1
      typeKey = 'Clawback'
    }

    const capKey = `${e.rep_id}|${e.period}`
    if (!capLeft.has(capKey)) capLeft.set(capKey, params.commissionCap)
    const { earned } = computeLineCommission({
      basis,
      baseRate,
      acceleratorMult: mult,
      capRemaining: capLeft.get(capKey) ?? null,
    })
    if (params.commissionCap != null) {
      capLeft.set(capKey, money(Math.max(0, (capLeft.get(capKey) ?? 0) - earned)))
    }

    total = money(total + earned)
    byRep.set(e.rep_id, money((byRep.get(e.rep_id) ?? 0) + earned))
    byType.set(typeKey, money((byType.get(typeKey) ?? 0) + earned))
  }

  return { total, byRep, byType }
}

function primaryDriverLabel(
  currentParams: PlanSimParams,
  proposed: PlanSimParams,
): string {
  const diffs: { label: string; mag: number }[] = [
    {
      label: 'Base Rate',
      mag: Math.abs(proposed.baseRevenueRate - currentParams.baseRevenueRate),
    },
    {
      label: 'Acquisition Rate',
      mag: Math.abs(proposed.newAcquisitionRate - currentParams.newAcquisitionRate),
    },
    {
      label: 'Expansion Rate',
      mag: Math.abs(
        proposed.expansionRate +
          proposed.expansionBonusPct -
          (currentParams.expansionRate + currentParams.expansionBonusPct),
      ),
    },
    {
      label: 'Accelerator',
      mag:
        Math.abs(proposed.accelerator100 - currentParams.accelerator100) +
        Math.abs(proposed.accelerator120 - currentParams.accelerator120),
    },
    {
      label: 'Bonus',
      mag: Math.abs(proposed.newCustomerBonus - currentParams.newCustomerBonus),
    },
    {
      label: 'Clawback',
      mag: Math.abs(proposed.clawbackCreditRate - currentParams.clawbackCreditRate),
    },
    {
      label: 'Cap',
      mag: Math.abs((proposed.commissionCap ?? 0) - (currentParams.commissionCap ?? 0)),
    },
    {
      label: 'Margin Incentive',
      mag: Math.abs(proposed.marginIncentiveRate - currentParams.marginIncentiveRate),
    },
  ]
  diffs.sort((a, b) => b.mag - a.mag)
  if (!diffs[0] || diffs[0].mag < 1e-9) return 'No change'
  return diffs[0].label
}

/**
 * Historical backtest of proposed plan vs current ledger earned.
 * Company-level margin kicker is Explicit Unassigned — never silently inflated into totals.
 * Does not overwrite paid history. Not a forecast of future sales lift.
 */
export function simulatePlanChange(
  data: DataStore,
  filters: GlobalFilters,
  params: PlanSimParams,
  local: CompLocalFilters = { repIds: [], teams: [] },
  contributionProfit: number | null = null,
): SimulatorResult {
  const ledger = filterCommissionLedger(data, filters, local)
  const elig = data.commissionEligibility.filter((e) => {
    if (!periodInRange(e.period, filters.startPeriod, filters.endPeriod)) return false
    if (!matchesCustomer(e.customer_id, filters)) return false
    if (!repMatches(data, e.rep_id, local)) return false
    return true
  })

  const eligibleRevenue = sumMoney(
    elig
      .filter((e) => e.eligibility_type === 'Revenue' || e.eligibility_type === 'Expansion')
      .map((e) => Math.max(0, e.basis_amount)),
  )

  const eligRevRP = new Map<string, number>()
  for (const e of elig) {
    if (e.eligibility_type !== 'Revenue' && e.eligibility_type !== 'Expansion') continue
    const k = `${e.rep_id}|${e.period}`
    eligRevRP.set(k, money((eligRevRP.get(k) ?? 0) + Math.max(0, e.basis_amount)))
  }
  const attainRP = new Map<string, number>()
  const quotaByRep = new Map<string, number>()
  const quotaScale = 1 + params.quotaAdjustmentPct / 100
  for (const q of data.salesQuotas) {
    if (!periodInRange(q.period, filters.startPeriod, filters.endPeriod)) continue
    if (!repMatches(data, q.rep_id, local)) continue
    const actual = eligRevRP.get(`${q.rep_id}|${q.period}`) ?? 0
    const adjQuota = q.quota_amount * quotaScale
    attainRP.set(
      `${q.rep_id}|${q.period}`,
      adjQuota > 0 ? (actual / adjQuota) * 100 : 0,
    )
    quotaByRep.set(q.rep_id, money((quotaByRep.get(q.rep_id) ?? 0) + adjQuota))
  }

  const currentParams = currentPlanAsSimParams(data)
  // Current-plan attainment uses unadjusted quotas for fair baseline
  const currentAttainRP = new Map<string, number>()
  for (const q of data.salesQuotas) {
    if (!periodInRange(q.period, filters.startPeriod, filters.endPeriod)) continue
    if (!repMatches(data, q.rep_id, local)) continue
    const actual = eligRevRP.get(`${q.rep_id}|${q.period}`) ?? 0
    currentAttainRP.set(
      `${q.rep_id}|${q.period}`,
      q.quota_amount > 0 ? (actual / q.quota_amount) * 100 : 0,
    )
  }
  const proposedSim = simulateEligibilityPayout(data, elig, attainRP, params)
  const currentPlanSim = simulateEligibilityPayout(data, elig, currentAttainRP, currentParams)

  // Ledger is source of truth for Current Plan Earned (production calc).
  const currentByRep = new Map<string, number>()
  const eligRevByRep = new Map<string, number>()
  for (const L of ledger) {
    currentByRep.set(L.rep_id, money((currentByRep.get(L.rep_id) ?? 0) + L.commission_earned))
    if (L.eligibility_type === 'Revenue' || L.eligibility_type === 'Expansion') {
      eligRevByRep.set(
        L.rep_id,
        money((eligRevByRep.get(L.rep_id) ?? 0) + Math.max(0, L.basis_amount)),
      )
    }
  }
  const ledgerCurrent = sumMoney(ledger.map((L) => L.commission_earned))

  // Margin kicker: company-level Explicit Unassigned on BOTH sides so default plan Δ = 0.
  const unassignedCurrent = marginKicker(currentParams.marginIncentiveRate, contributionProfit)
  const unassignedProposed = marginKicker(params.marginIncentiveRate, contributionProfit)

  const currentPlanEarned = money(ledgerCurrent + unassignedCurrent)
  const proposedPlanEarned = money(proposedSim.total + unassignedProposed)
  const delta = money(proposedPlanEarned - currentPlanEarned)

  const driver = primaryDriverLabel(currentParams, params)
  const repIds = new Set([...currentByRep.keys(), ...proposedSim.byRep.keys()])
  const byRep: SimulatorRepImpact[] = [...repIds].map((repId) => {
    const rep = data.salesReps.find((r) => r.rep_id === repId)
    const current = currentByRep.get(repId) ?? 0
    const proposed = proposedSim.byRep.get(repId) ?? 0
    const d = money(proposed - current)
    const eligRev = eligRevByRep.get(repId) ?? 0
    const quota = quotaByRep.get(repId) ?? 0
    return {
      repId,
      repName: rep?.rep_name ?? repId,
      team: rep?.team ?? '—',
      eligibleRevenue: eligRev,
      quotaAttainmentPct: pct(eligRev, quota),
      current,
      proposed,
      delta: d,
      deltaPct: current !== 0 ? money((d / Math.abs(current)) * 100) : d !== 0 ? 100 : 0,
      primaryChangeDriver: Math.abs(d) < 0.005 ? 'Unchanged' : driver,
      unassigned: false,
    }
  })

  if (unassignedCurrent !== 0 || unassignedProposed !== 0) {
    const d = money(unassignedProposed - unassignedCurrent)
    byRep.push({
      repId: UNASSIGNED_COMMISSION_REP_ID,
      repName: 'Company Margin Incentive (Unassigned)',
      team: '—',
      eligibleRevenue: 0,
      quotaAttainmentPct: null,
      current: unassignedCurrent,
      proposed: unassignedProposed,
      delta: d,
      deltaPct:
        unassignedCurrent !== 0
          ? money((d / Math.abs(unassignedCurrent)) * 100)
          : d !== 0
            ? 100
            : 0,
      primaryChangeDriver: Math.abs(d) < 0.005 ? 'Unchanged' : 'Margin Incentive',
      unassigned: true,
    })
  }

  byRep.sort((a, b) => b.delta - a.delta)
  const sumRepDelta = money(byRep.reduce((a, r) => a + r.delta, 0))

  // Fixed-order sequential attribution for waterfall (interaction residual last).
  const stepOrder: { key: string; label: string; apply: (p: PlanSimParams) => PlanSimParams }[] = [
    {
      key: 'base',
      label: 'Base Rate Impact',
      apply: (p) => ({ ...p, baseRevenueRate: params.baseRevenueRate }),
    },
    {
      key: 'acq',
      label: 'Acquisition Rate Impact',
      apply: (p) => ({ ...p, newAcquisitionRate: params.newAcquisitionRate }),
    },
    {
      key: 'exp',
      label: 'Expansion Rate Impact',
      apply: (p) => ({
        ...p,
        expansionRate: params.expansionRate,
        expansionBonusPct: params.expansionBonusPct,
      }),
    },
    {
      key: 'accel',
      label: 'Accelerator Impact',
      apply: (p) => ({
        ...p,
        accelerator100: params.accelerator100,
        accelerator120: params.accelerator120,
        acceleratorBelow: params.acceleratorBelow,
        quotaThresholdPct: params.quotaThresholdPct,
      }),
    },
    {
      key: 'bonus',
      label: 'Bonus Impact',
      apply: (p) => ({ ...p, newCustomerBonus: params.newCustomerBonus }),
    },
    {
      key: 'claw',
      label: 'Clawback Impact',
      apply: (p) => ({ ...p, clawbackCreditRate: params.clawbackCreditRate }),
    },
    {
      key: 'cap',
      label: 'Cap Impact',
      apply: (p) => ({ ...p, commissionCap: params.commissionCap }),
    },
  ]

  const waterfall: SimulatorWaterfallStep[] = [
    { key: 'current', label: 'Current Plan Earned', amount: currentPlanEarned },
  ]
  let runningParams = { ...currentParams }
  let runningTotal = money(currentPlanSim.total + unassignedCurrent)
  // Align starting point to ledger+kicker for display; step deltas from eligibility path
  let prevElig = currentPlanSim.total
  for (const step of stepOrder) {
    runningParams = step.apply(runningParams)
    const next = simulateEligibilityPayout(data, elig, attainRP, runningParams).total
    const stepDelta = money(next - prevElig)
    if (Math.abs(stepDelta) >= 0.005) {
      waterfall.push({ key: step.key, label: step.label, amount: stepDelta })
    }
    prevElig = next
    runningTotal = money(runningTotal + stepDelta)
  }
  const marginDelta = money(unassignedProposed - unassignedCurrent)
  if (Math.abs(marginDelta) >= 0.005) {
    waterfall.push({ key: 'margin', label: 'Margin Incentive Impact', amount: marginDelta })
    runningTotal = money(runningTotal + marginDelta)
  }
  const residual = money(proposedPlanEarned - (currentPlanEarned + money(
    waterfall.filter((w) => w.key !== 'current').reduce((a, w) => a + w.amount, 0),
  )))
  // Prefer residual that closes ledger vs eligibility baseline gap + interactions
  if (Math.abs(residual) >= 0.02) {
    waterfall.push({
      key: 'residual',
      label: 'Interaction / Ledger↔Eligibility Residual',
      amount: residual,
    })
  }
  waterfall.push({ key: 'proposed', label: 'Proposed Plan Earned', amount: proposedPlanEarned })

  return {
    disclaimer:
      'Historical backtest on the same Eligible Revenue / Bookings events. Does not overwrite Paid history. Hypothetical plan change ≠ guaranteed future sales growth. Margin incentive is company-level Unassigned.',
    currentPayout: currentPlanEarned,
    proposedPayout: proposedPlanEarned,
    currentPlanEarned,
    proposedPlanEarned,
    delta,
    unassignedCurrent,
    unassignedProposed,
    currentCostPct: pct(currentPlanEarned, eligibleRevenue),
    proposedCostPct: pct(proposedPlanEarned, eligibleRevenue),
    eligibleRevenue,
    contributionAfterCommissionCurrent:
      contributionProfit != null ? money(contributionProfit - currentPlanEarned) : null,
    contributionAfterCommissionProposed:
      contributionProfit != null ? money(contributionProfit - proposedPlanEarned) : null,
    waterfall,
    byRep,
    winners: byRep.filter((r) => !r.unassigned && r.delta > 0).slice(0, 5).map((r) => r.repName),
    losers: byRep
      .filter((r) => !r.unassigned && r.delta < 0)
      .slice(-5)
      .reverse()
      .map((r) => r.repName),
    sumRepDelta,
  }
}

/** Forward commission expense estimate from forecast eligible proxy (Existing Net Billing forecast) */
export function forecastCommissionExpense(
  data: DataStore,
  filters: GlobalFilters,
  scenario: 'Base' | 'Upside' | 'Downside',
): {
  period: string
  forecastEligibleProxy: number
  estimatedCommission: number
  rateUsed: number
  note: string
}[] {
  // Always use official forward Existing forecasts (history_end+), optionally scoped by customer.
  const rows = data.forecasts.filter((f) => {
    if (f.scenario !== scenario || f.forecast_type !== 'Existing') return false
    if (f.accounting_period <= data.meta.history_end) return false
    if (filters.customerIds.length) {
      if (!f.customer_id || !filters.customerIds.includes(f.customer_id)) return false
    }
    return true
  })

  const byPeriod = new Map<string, number>()
  for (const f of rows) {
    byPeriod.set(
      f.accounting_period,
      money((byPeriod.get(f.accounting_period) ?? 0) + f.forecast_net_billing),
    )
  }

  return [...byPeriod.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, forecastEligibleProxy]) => {
      const version = pickVersion(data, period)
      const rateUsed = version.revenue_rate
      return {
        period,
        forecastEligibleProxy,
        estimatedCommission: money(forecastEligibleProxy * rateUsed),
        rateUsed,
        note: 'Expense estimate = Forecast Net Billing (Existing) × plan revenue_rate. Separate from COGS / DSP costs — do not subtract twice in Unit Economics.',
      }
    })
}

export function attainmentDistribution(
  rows: RepPerformanceRow[],
): { bucket: string; reps: number }[] {
  const buckets = [
    { bucket: '<80%', reps: 0 },
    { bucket: '80–99%', reps: 0 },
    { bucket: '100–119%', reps: 0 },
    { bucket: '≥120%', reps: 0 },
    { bucket: 'N/A', reps: 0 },
  ]
  for (const r of rows) {
    const a = r.quotaAttainmentPct
    if (a == null) buckets[4].reps++
    else if (a < 80) buckets[0].reps++
    else if (a < 100) buckets[1].reps++
    else if (a < 120) buckets[2].reps++
    else buckets[3].reps++
  }
  return buckets
}

export function currentPlanAsSimParams(data: DataStore): PlanSimParams {
  const v =
    data.compensationPlanVersions.find((x) => x.plan_version_id === 'PLAN-AE-STD-v2') ??
    data.compensationPlanVersions[data.compensationPlanVersions.length - 1]
  const tiers: CommissionAcceleratorTier[] = v.accelerator_tiers
  const below = tiers.find((t) => t.from_attainment_pct < 100)?.rate_multiplier ?? 1
  const at100 = tiers.find((t) => t.from_attainment_pct === 100)?.rate_multiplier ?? 1.25
  const at120 = tiers.find((t) => t.from_attainment_pct === 120)?.rate_multiplier ?? 1.5
  return {
    baseRevenueRate: v.revenue_rate,
    newAcquisitionRate: v.new_acquisition_rate,
    expansionRate: v.expansion_rate,
    quotaThresholdPct: 100,
    acceleratorBelow: below,
    accelerator100: at100,
    accelerator120: at120,
    commissionCap: v.commission_cap,
    newCustomerBonus: v.new_customer_bonus,
    expansionBonusPct: v.expansion_bonus_pct,
    clawbackCreditRate: v.clawback_credit_rate,
    marginIncentiveRate: v.margin_incentive_rate,
    quotaAdjustmentPct: 0,
    minimumMarginEligibilityPct: 0,
  }
}

// ─── Independent Commission Audit (does not copy ledger.commission_earned) ───

export type TransactionAuditStatus =
  | 'Not Audited'
  | 'Passed'
  | 'Flagged'
  | 'Under Review'
  | 'Resolved'

export interface TransactionAuditRow {
  ledgerId: string
  eligibilityId: string
  repId: string
  repName: string
  customerId: string | null
  opportunityId: string | null
  contractId: string | null
  period: string
  eligibilityType: string
  eligibleRevenue: number
  planVersionId: string
  expectedCommission: number
  calculatedCommission: number
  variance: number
  auditStatus: TransactionAuditStatus
  approvalStatus: string
  paymentStatus: string
  auditDate: string | null
  reviewer: string | null
  formula: string
  exceptionIds: string[]
  ruleHits: string[]
}

export interface AuditModuleKpis {
  auditCoveragePct: number | null
  openExceptions: number
  exceptionExposure: number
  pendingApproval: number
  payoutReconciliationDiff: number
  eligibleEntries: number
  auditedEntries: number
}

/** Independent expected amount from plan version rules + eligibility basis (not ledger.earned). */
export function computeIndependentExpectedCommission(
  data: DataStore,
  L: FactCommissionLedger,
  attainPct: number,
): { expected: number; formula: string; version: FactCompensationPlanVersion } {
  const version =
    data.compensationPlanVersions.find((v) => v.plan_version_id === L.plan_version_id) ??
    pickVersion(data, L.period)
  const mult =
    L.eligibility_type === 'Clawback' || L.eligibility_type === 'Bonus'
      ? 1
      : (() => {
          const tiers = [...version.accelerator_tiers].sort(
            (a, b) => b.from_attainment_pct - a.from_attainment_pct,
          )
          const hit = tiers.find((t) => attainPct >= t.from_attainment_pct)
          return hit?.rate_multiplier ?? 1
        })()

  let baseRate = 0
  let basis = L.basis_amount
  if (L.eligibility_type === 'New Acquisition') baseRate = version.new_acquisition_rate
  else if (L.eligibility_type === 'Expansion')
    baseRate = version.expansion_rate + version.expansion_bonus_pct
  else if (L.eligibility_type === 'Revenue') baseRate = version.revenue_rate
  else if (L.eligibility_type === 'Bonus') {
    baseRate = 1
    // Prefer plan flat bonus when ledger basis matches bonus shape
    basis = version.new_customer_bonus
  } else if (L.eligibility_type === 'Clawback') {
    baseRate = 1
    basis = L.basis_amount
  }

  const { earned } = computeLineCommission({
    basis,
    baseRate,
    acceleratorMult: mult,
    capRemaining: null,
  })
  const formula = `Eligible ${basis.toFixed(2)} × Rate ${baseRate} × Accel ${mult} (plan ${version.version_label}; attain ${attainPct.toFixed(1)}%)`
  return { expected: earned, formula, version }
}

export function computeAuditModuleKpis(
  data: DataStore,
  filters: GlobalFilters,
  local: CompLocalFilters = { repIds: [], teams: [] },
): AuditModuleKpis {
  const ledger = filterCommissionLedger(data, filters, local)
  const audits = filterCommissionAudits(data, filters, local)
  const open = audits.filter((a) => a.status === 'Open' || a.status === 'Investigating')
  const ledgerIdsWithAudit = new Set(audits.map((a) => a.ledger_id).filter(Boolean) as string[])
  const auditedEntries = ledger.filter((L) => ledgerIdsWithAudit.has(L.ledger_id)).length
  const eligibleEntries = ledger.length
  const kpis = computeCompKpis(data, filters, local)

  // Approved vs sum of payments allocated to ledger in window
  const approved = kpis.approved
  const paid = kpis.paid
  const payoutReconciliationDiff = money(approved - paid - kpis.approvedUnpaid)
  // Should be ~0 when approvedUnpaid = approved − paid; surface any drift

  return {
    auditCoveragePct: eligibleEntries > 0 ? pct(auditedEntries, eligibleEntries) : null,
    openExceptions: open.length,
    exceptionExposure: sumMoney(open.map((a) => a.financial_impact)),
    pendingApproval: kpis.pendingApproval,
    payoutReconciliationDiff,
    eligibleEntries,
    auditedEntries,
  }
}

export function runCommissionTransactionAudit(
  data: DataStore,
  filters: GlobalFilters,
  local: CompLocalFilters = { repIds: [], teams: [] },
): TransactionAuditRow[] {
  const ledger = filterCommissionLedger(data, filters, local)
  const audits = filterCommissionAudits(data, filters, local)
  const auditsByLedger = new Map<string, typeof audits>()
  for (const a of audits) {
    if (!a.ledger_id) continue
    const list = auditsByLedger.get(a.ledger_id) ?? []
    list.push(a)
    auditsByLedger.set(a.ledger_id, list)
  }

  const eligRevRP = new Map<string, number>()
  for (const L of ledger) {
    if (L.eligibility_type !== 'Revenue' && L.eligibility_type !== 'Expansion') continue
    const k = `${L.rep_id}|${L.period}`
    eligRevRP.set(k, money((eligRevRP.get(k) ?? 0) + Math.max(0, L.basis_amount)))
  }
  const attainRP = new Map<string, number>()
  for (const q of data.salesQuotas) {
    if (!periodInRange(q.period, filters.startPeriod, filters.endPeriod)) continue
    const actual = eligRevRP.get(`${q.rep_id}|${q.period}`) ?? 0
    attainRP.set(
      `${q.rep_id}|${q.period}`,
      q.quota_amount > 0 ? (actual / q.quota_amount) * 100 : 0,
    )
  }

  // Duplicate eligibility detection
  const eligCounts = new Map<string, number>()
  for (const L of ledger) {
    eligCounts.set(L.eligibility_id, (eligCounts.get(L.eligibility_id) ?? 0) + 1)
  }

  const custOwner = new Map(
    data.customers.map((c) => {
      const rep = data.salesReps.find((r) => r.rep_name === c.account_owner)
      return [c.customer_id, rep?.rep_id ?? ''] as const
    }),
  )

  return ledger.map((L) => {
    const attain = attainRP.get(`${L.rep_id}|${L.period}`) ?? 0
    const { expected, formula, version } = computeIndependentExpectedCommission(data, L, attain)
    const variance = money(L.commission_earned - expected)
    const linked = auditsByLedger.get(L.ledger_id) ?? []
    const ruleHits: string[] = []

    if ((eligCounts.get(L.eligibility_id) ?? 0) > 1) ruleHits.push('Duplicate Commission')
    if (Math.abs(variance) > 1) ruleHits.push('Incorrect Rate')
    if (L.customer_id) {
      const owner = custOwner.get(L.customer_id)
      if (owner && owner !== L.rep_id) ruleHits.push('Wrong Sales Attribution')
    }
    const expectedMult =
      L.eligibility_type === 'Clawback' || L.eligibility_type === 'Bonus'
        ? 1
        : (() => {
            const tiers = [...version.accelerator_tiers].sort(
              (a, b) => b.from_attainment_pct - a.from_attainment_pct,
            )
            return tiers.find((t) => attain >= t.from_attainment_pct)?.rate_multiplier ?? 1
          })()
    if (Math.abs(L.accelerator_mult - expectedMult) > 0.001) ruleHits.push('Incorrect Accelerator')
    if (L.approval_status === 'Pending' && L.commission_earned > 0) ruleHits.push('Missing Approval')
    if (L.eligibility_type === 'Clawback' && L.commission_earned === 0) ruleHits.push('Clawback Mismatch')
    if (
      L.approval_status === 'Approved' &&
      Math.abs(L.paid_amount - L.approved_amount) > 0.5 &&
      L.paid_amount > 0
    ) {
      ruleHits.push('Payout Mismatch')
    }
    const day = `${L.period}-15`
    if (!(version.effective_from <= day && (version.effective_to == null || version.effective_to >= day))) {
      ruleHits.push('Plan Effective Date')
    }

    for (const a of linked) {
      if (!ruleHits.includes(a.audit_type)) ruleHits.push(a.audit_type)
    }

    let auditStatus: TransactionAuditStatus = 'Not Audited'
    if (linked.some((a) => a.status === 'Open' || a.status === 'Investigating')) {
      auditStatus = 'Flagged'
    } else if (linked.some((a) => a.status === 'Resolved' || a.status === 'Accepted')) {
      auditStatus = 'Resolved'
    } else if (linked.length > 0) {
      auditStatus = 'Under Review'
    } else if (ruleHits.length === 0) {
      auditStatus = 'Passed'
    } else if (ruleHits.length > 0 && Math.abs(variance) <= 1 && !ruleHits.includes('Duplicate Commission')) {
      // Soft informational hits (e.g. pending approval) without amount variance
      auditStatus = ruleHits.includes('Missing Approval') ? 'Under Review' : 'Passed'
    } else {
      auditStatus = 'Flagged'
    }

    let paymentStatus = 'Unpaid'
    if (L.paid_amount <= 0.005) paymentStatus = 'Unpaid'
    else if (L.paid_amount + 0.01 >= L.approved_amount && L.approved_amount > 0) paymentStatus = 'Paid'
    else paymentStatus = 'Partial'

    const rep = data.salesReps.find((r) => r.rep_id === L.rep_id)
    return {
      ledgerId: L.ledger_id,
      eligibilityId: L.eligibility_id,
      repId: L.rep_id,
      repName: rep?.rep_name ?? L.rep_id,
      customerId: L.customer_id,
      opportunityId: L.opportunity_id,
      contractId: L.contract_id,
      period: L.period,
      eligibilityType: L.eligibility_type,
      eligibleRevenue: Math.max(0, L.basis_amount),
      planVersionId: L.plan_version_id,
      expectedCommission: expected,
      calculatedCommission: L.commission_earned,
      variance,
      auditStatus,
      approvalStatus: L.approval_status,
      paymentStatus,
      auditDate: linked[0]?.detected_date ?? null,
      reviewer: linked[0]?.suggested_owner ?? null,
      formula,
      exceptionIds: linked.map((a) => a.audit_id),
      ruleHits,
    }
  })
}

export function filterLedgerByStatusBucket(
  data: DataStore,
  filters: GlobalFilters,
  local: CompLocalFilters,
  bucket: CommissionStatusBucket,
): FactCommissionLedger[] {
  const ledger = filterCommissionLedger(data, filters, local)
  return ledger.filter((L) => {
    if (bucket === 'Rejected') return L.approval_status === 'Rejected'
    if (bucket === 'Pending Approval') return L.approval_status === 'Pending'
    if (bucket === 'Paid') return L.paid_amount > 0.005
    if (bucket === 'Approved Unpaid') {
      return (
        L.approval_status === 'Approved' &&
        money(Math.max(0, L.approved_amount - L.paid_amount)) > 0.005
      )
    }
    return false
  })
}
