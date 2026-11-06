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
  unpaid: number
  avgQuotaAttainmentPct: number | null
  commissionCostPctOfEligible: number | null
  eligibleRevenue: number
  openAuditExceptions: number
  openAuditExposure: number
}

export function computeCompKpis(
  data: DataStore,
  filters: GlobalFilters,
  local: CompLocalFilters = { repIds: [], teams: [] },
): CompKpis {
  const ledger = filterCommissionLedger(data, filters, local)
  const earned = sumMoney(ledger.map((L) => L.commission_earned))
  const approved = sumMoney(ledger.map((L) => L.approved_amount))
  const paid = sumMoney(ledger.map((L) => L.paid_amount))
  const unpaid = money(Math.max(0, approved - paid))

  const eligibleRevenue = sumMoney(
    ledger
      .filter((L) => L.eligibility_type === 'Revenue' || L.eligibility_type === 'Expansion')
      .map((L) => Math.max(0, L.basis_amount)),
  )

  // Attainment: average across rep×period in window with quota
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
  for (const q of quotas) {
    const actual = eligibleByRepPeriod.get(`${q.rep_id}|${q.period}`) ?? 0
    if (q.quota_amount > 0) attainments.push((actual / q.quota_amount) * 100)
  }
  const avgQuotaAttainmentPct =
    attainments.length > 0
      ? money(attainments.reduce((a, b) => a + b, 0) / attainments.length)
      : null

  const audits = filterCommissionAudits(data, filters, local).filter(
    (a) => a.status === 'Open' || a.status === 'Investigating',
  )

  return {
    earned,
    approved,
    paid,
    unpaid,
    avgQuotaAttainmentPct,
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
  winRate: number | null
  avgSalesCycle: number | null
  openAudits: number
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
        winRate: null,
        avgSalesCycle: null,
        openAudits: 0,
      }
      byRep.set(repId, row)
    }
    return row
  }

  for (const L of ledger) {
    const row = ensure(L.rep_id)
    row.earned = money(row.earned + L.commission_earned)
    row.approved = money(row.approved + L.approved_amount)
    row.paid = money(row.paid + L.paid_amount)
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
    if (o.stage === 'Closed Won') st.won++
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
  }

  const audits = filterCommissionAudits(data, filters, local)
  for (const a of audits) {
    if (a.status !== 'Open' && a.status !== 'Investigating') continue
    ensure(a.rep_id).openAudits++
  }

  for (const row of byRep.values()) {
    row.quotaAttainmentPct = pct(row.eligibleRevenue, row.quota)
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

export interface SimulatorResult {
  disclaimer: string
  currentPayout: number
  proposedPayout: number
  delta: number
  currentCostPct: number | null
  proposedCostPct: number | null
  eligibleRevenue: number
  /** Contribution after commission — illustrative; does not rewrite Unit Economics */
  contributionAfterCommissionCurrent: number | null
  contributionAfterCommissionProposed: number | null
  byRep: {
    repId: string
    repName: string
    current: number
    proposed: number
    delta: number
  }[]
  winners: string[]
  losers: string[]
}

/**
 * Historical backtest of proposed plan vs current ledger earned.
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

  // Attainment from eligible revenue vs quotas
  const eligRevRP = new Map<string, number>()
  for (const e of elig) {
    if (e.eligibility_type !== 'Revenue' && e.eligibility_type !== 'Expansion') continue
    const k = `${e.rep_id}|${e.period}`
    eligRevRP.set(k, money((eligRevRP.get(k) ?? 0) + Math.max(0, e.basis_amount)))
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

  const proposedByRep = new Map<string, number>()
  let proposedTotal = 0
  const capLeft = new Map<string, number | null>()

  for (const e of elig) {
    const attain = attainRP.get(`${e.rep_id}|${e.period}`) ?? 0
    const mult =
      e.eligibility_type === 'Clawback' || e.eligibility_type === 'Bonus'
        ? 1
        : simAccelerator(params, attain)

    let baseRate = 0
    let basis = e.basis_amount
    if (e.eligibility_type === 'New Acquisition') baseRate = params.newAcquisitionRate
    else if (e.eligibility_type === 'Expansion')
      baseRate = params.expansionRate + params.expansionBonusPct
    else if (e.eligibility_type === 'Revenue') baseRate = params.baseRevenueRate
    else if (e.eligibility_type === 'Bonus') {
      // Replace flat bonus with sim param when original was new-customer bonus
      basis = params.newCustomerBonus
      baseRate = 1
    } else if (e.eligibility_type === 'Clawback') {
      // Re-scale clawback from original credit basis using sim clawback rate
      // Original basis = -credits * oldRate → recover credits and reapply
      const version = pickVersion(data, e.period)
      const credits =
        version.clawback_credit_rate > 0
          ? Math.abs(e.basis_amount) / version.clawback_credit_rate
          : 0
      basis = -money(credits * params.clawbackCreditRate)
      baseRate = 1
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

    proposedTotal = money(proposedTotal + earned)
    proposedByRep.set(e.rep_id, money((proposedByRep.get(e.rep_id) ?? 0) + earned))
  }

  // Optional margin kicker (demo): add rate × contribution when provided
  if (params.marginIncentiveRate > 0 && contributionProfit != null && contributionProfit > 0) {
    const kicker = money(contributionProfit * params.marginIncentiveRate)
    proposedTotal = money(proposedTotal + kicker)
  }

  const currentByRep = new Map<string, number>()
  for (const L of ledger) {
    currentByRep.set(L.rep_id, money((currentByRep.get(L.rep_id) ?? 0) + L.commission_earned))
  }
  const currentPayout = sumMoney(ledger.map((L) => L.commission_earned))

  const repIds = new Set([...currentByRep.keys(), ...proposedByRep.keys()])
  const byRep = [...repIds].map((repId) => {
    const rep = data.salesReps.find((r) => r.rep_id === repId)
    const current = currentByRep.get(repId) ?? 0
    const proposed = proposedByRep.get(repId) ?? 0
    return {
      repId,
      repName: rep?.rep_name ?? repId,
      current,
      proposed,
      delta: money(proposed - current),
    }
  }).sort((a, b) => b.delta - a.delta)

  return {
    disclaimer:
      'Historical backtest on the same Eligible Revenue / Bookings events. Does not overwrite Paid history. Hypothetical plan change ≠ guaranteed future sales growth.',
    currentPayout,
    proposedPayout: proposedTotal,
    delta: money(proposedTotal - currentPayout),
    currentCostPct: pct(currentPayout, eligibleRevenue),
    proposedCostPct: pct(proposedTotal, eligibleRevenue),
    eligibleRevenue,
    contributionAfterCommissionCurrent:
      contributionProfit != null ? money(contributionProfit - currentPayout) : null,
    contributionAfterCommissionProposed:
      contributionProfit != null ? money(contributionProfit - proposedTotal) : null,
    byRep,
    winners: byRep.filter((r) => r.delta > 0).slice(0, 5).map((r) => r.repName),
    losers: byRep.filter((r) => r.delta < 0).slice(-5).reverse().map((r) => r.repName),
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
  }
}
