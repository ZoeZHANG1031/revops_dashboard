/**
 * Synthetic Sales Compensation slice — linked to existing customers, contracts,
 * opportunities, invoices and credit memos. Does not mutate revenue/cost facts.
 *
 * Eligible Revenue ≠ Recognized Revenue. Quota basis is Eligible Revenue (Net Billing
 * attributed to the account owner). Acquisition commission uses Closed Won bookings TCV.
 */
import type {
  DimCompensationPlan,
  DimCustomer,
  DimSalesRep,
  FactCommissionAuditException,
  FactCommissionEligibility,
  FactCommissionLedger,
  FactCommissionPayment,
  FactCompensationPlanVersion,
  FactCreditMemo,
  FactInvoice,
  FactOpportunity,
  FactSalesQuota,
  RegionCode,
} from '@/types'
import { SeededRng } from './rng'

const r2 = (v: number) => Math.round(v * 100) / 100
function pad(n: number, width = 4): string {
  return String(n).padStart(width, '0')
}
function addMonths(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function periodsFrom(start: string, end: string): string[] {
  const out: string[] = []
  for (let p = start; p <= end; p = addMonths(p, 1)) out.push(p)
  return out
}

const PLAN_ASSUMPTION =
  'Synthetic Assumption — illustrative commission policy for demo only; not a real carrier sales plan.'

const TEAMS = ['Enterprise Hunt', 'Enterprise Farm', 'Mid-Market', 'SMB Growth'] as const
const MANAGERS = ['Dir. Sales West', 'Dir. Sales Central', 'Dir. Sales East', 'VP Sales'] as const

export interface CompensationSlice {
  salesReps: DimSalesRep[]
  compensationPlans: DimCompensationPlan[]
  compensationPlanVersions: FactCompensationPlanVersion[]
  salesQuotas: FactSalesQuota[]
  commissionEligibility: FactCommissionEligibility[]
  commissionLedger: FactCommissionLedger[]
  commissionPayments: FactCommissionPayment[]
  commissionAuditExceptions: FactCommissionAuditException[]
}

export interface CompensationGenerateInput {
  seed: number
  historyStart: string
  historyEnd: string
  asOfDate: string
  accountOwners: string[]
  customers: DimCustomer[]
  opportunities: FactOpportunity[]
  invoices: FactInvoice[]
  creditMemos: FactCreditMemo[]
  /** Active contract id by customer (optional) */
  contractByCustomer: Map<string, string>
}

function pickVersion(
  versions: FactCompensationPlanVersion[],
  period: string,
): FactCompensationPlanVersion {
  const day = `${period}-15`
  const hit = versions.find(
    (v) => v.effective_from <= day && (v.effective_to == null || v.effective_to >= day),
  )
  return hit ?? versions[versions.length - 1]
}

function acceleratorMult(version: FactCompensationPlanVersion, attainmentPct: number): number {
  const tiers = [...version.accelerator_tiers].sort(
    (a, b) => a.from_attainment_pct - b.from_attainment_pct,
  )
  // Marginal: apply highest matching band multiplier to the whole period earned
  // (demo simplification — documented in calc_notes)
  let mult = 1
  for (const t of tiers) {
    if (attainmentPct >= t.from_attainment_pct) mult = t.rate_multiplier
  }
  return mult
}

/**
 * Pure commission line math — shared by generator and simulator.
 */
export function computeLineCommission(args: {
  basis: number
  baseRate: number
  acceleratorMult: number
  capRemaining: number | null
}): { earned: number; appliedMult: number } {
  const raw = r2(args.basis * args.baseRate * args.acceleratorMult)
  if (args.capRemaining == null) return { earned: raw, appliedMult: args.acceleratorMult }
  const earned = r2(Math.min(raw, Math.max(0, args.capRemaining)))
  return { earned, appliedMult: args.acceleratorMult }
}

export function generateCompensationSlice(input: CompensationGenerateInput): CompensationSlice {
  const rng = new SeededRng((input.seed ^ 0xc0ffee) >>> 0)
  const periods = periodsFrom(input.historyStart, input.historyEnd)
  const regions: RegionCode[] = ['West', 'Central', 'East']

  // ---- Sales reps from account owners ----
  const salesReps: DimSalesRep[] = input.accountOwners.map((name, i) => ({
    rep_id: `REP-${pad(i + 1, 2)}`,
    rep_name: name,
    team: TEAMS[i % TEAMS.length],
    territory_region: regions[i % regions.length],
    manager_name: MANAGERS[i % MANAGERS.length],
    status: 'Active',
    hire_date: `2023-${String((i % 12) + 1).padStart(2, '0')}-15`,
    synthetic: true,
  }))
  const repByName = new Map(salesReps.map((r) => [r.rep_name, r]))
  const custRep = new Map<string, DimSalesRep>()
  for (const c of input.customers) {
    const rep = repByName.get(c.account_owner) ?? salesReps[0]
    custRep.set(c.customer_id, rep)
  }

  // ---- Plans + versions (v1 before 2026-01, v2 thereafter) ----
  const compensationPlans: DimCompensationPlan[] = [
    {
      plan_id: 'PLAN-AE-STD',
      plan_name: 'Account Executive Standard',
      description: 'New logo + expansion + residual eligible revenue with quota accelerators',
      synthetic: true,
      synthetic_assumption: PLAN_ASSUMPTION,
    },
  ]
  const v1: FactCompensationPlanVersion = {
    plan_version_id: 'PLAN-AE-STD-v1',
    plan_id: 'PLAN-AE-STD',
    version_label: 'v1 (through 2025)',
    effective_from: `${input.historyStart}-01`,
    effective_to: '2025-12-31',
    quota_basis: 'Eligible Revenue',
    new_acquisition_rate: 0.04,
    expansion_rate: 0.025,
    revenue_rate: 0.008,
    margin_incentive_rate: 0,
    margin_cm_threshold_pct: 20,
    new_customer_bonus: 1500,
    expansion_bonus_pct: 0,
    clawback_credit_rate: 0.5,
    commission_cap: null,
    accelerator_tiers: [
      { from_attainment_pct: 0, to_attainment_pct: 100, rate_multiplier: 1 },
      { from_attainment_pct: 100, to_attainment_pct: 120, rate_multiplier: 1.25 },
      { from_attainment_pct: 120, to_attainment_pct: null, rate_multiplier: 1.5 },
    ],
    synthetic: true,
    synthetic_assumption: PLAN_ASSUMPTION,
  }
  const v2: FactCompensationPlanVersion = {
    plan_version_id: 'PLAN-AE-STD-v2',
    plan_id: 'PLAN-AE-STD',
    version_label: 'v2 (2026+)',
    effective_from: '2026-01-01',
    effective_to: null,
    quota_basis: 'Eligible Revenue',
    new_acquisition_rate: 0.045,
    expansion_rate: 0.03,
    revenue_rate: 0.009,
    margin_incentive_rate: 0.002,
    margin_cm_threshold_pct: 18,
    new_customer_bonus: 2000,
    expansion_bonus_pct: 0.005,
    clawback_credit_rate: 0.6,
    commission_cap: null,
    accelerator_tiers: [
      { from_attainment_pct: 0, to_attainment_pct: 100, rate_multiplier: 1 },
      { from_attainment_pct: 100, to_attainment_pct: 120, rate_multiplier: 1.25 },
      { from_attainment_pct: 120, to_attainment_pct: null, rate_multiplier: 1.5 },
    ],
    synthetic: true,
    synthetic_assumption: PLAN_ASSUMPTION,
  }
  const compensationPlanVersions = [v1, v2]
  const versionById = new Map(compensationPlanVersions.map((v) => [v.plan_version_id, v]))

  // ---- Net billing by customer × period (invoice net — Eligible Revenue source) ----
  const netByCustPeriod = new Map<string, number>()
  for (const inv of input.invoices) {
    const k = `${inv.customer_id}|${inv.accounting_period}`
    netByCustPeriod.set(k, r2((netByCustPeriod.get(k) ?? 0) + inv.net_amount))
  }
  const creditsByCustPeriod = new Map<string, number>()
  const invPeriod = new Map(input.invoices.map((i) => [i.invoice_id, i.accounting_period]))
  for (const cm of input.creditMemos) {
    if (!cm.invoice_id) continue
    const period = invPeriod.get(cm.invoice_id)
    if (!period) continue
    const cid = input.invoices.find((i) => i.invoice_id === cm.invoice_id)?.customer_id
    if (!cid) continue
    const k = `${cid}|${period}`
    creditsByCustPeriod.set(k, r2((creditsByCustPeriod.get(k) ?? 0) + cm.amount))
  }

  // Closed Won opps by customer
  const wonByCustomer = new Map<string, FactOpportunity[]>()
  for (const o of input.opportunities) {
    if (o.stage !== 'Closed Won' || !o.customer_id || !o.closed_date) continue
    const list = wonByCustomer.get(o.customer_id) ?? []
    list.push(o)
    wonByCustomer.set(o.customer_id, list)
  }

  // ---- Eligibility events ----
  const commissionEligibility: FactCommissionEligibility[] = []
  let eligSeq = 1
  const pushElig = (
    row: Omit<FactCommissionEligibility, 'eligibility_id' | 'synthetic'>,
  ): FactCommissionEligibility => {
    const e: FactCommissionEligibility = {
      ...row,
      eligibility_id: `ELIG-${pad(eligSeq++, 5)}`,
      synthetic: true,
    }
    commissionEligibility.push(e)
    return e
  }

  for (const period of periods) {
    const version = pickVersion(compensationPlanVersions, period)
    for (const c of input.customers) {
      if (c.status === 'Prospect') continue
      const rep = custRep.get(c.customer_id)!
      const contractId = input.contractByCustomer.get(c.customer_id) ?? null
      const net = netByCustPeriod.get(`${c.customer_id}|${period}`) ?? 0
      const prior = netByCustPeriod.get(`${c.customer_id}|${addMonths(period, -12)}`) ?? 0
      const won = (wonByCustomer.get(c.customer_id) ?? []).filter(
        (o) => o.closed_date!.slice(0, 7) === period,
      )

      // New Acquisition — Closed Won bookings (TCV), not recognized revenue
      for (const o of won) {
        pushElig({
          rep_id: rep.rep_id,
          period,
          customer_id: c.customer_id,
          opportunity_id: o.opportunity_id,
          contract_id: contractId,
          eligibility_type: 'New Acquisition',
          basis_amount: o.opportunity_value,
          basis_label: 'Closed Won opportunity_value (bookings TCV)',
          plan_version_id: version.plan_version_id,
          notes: 'Acquisition commission on bookings — not period Net Billing / Recognized Revenue',
        })
        if (version.new_customer_bonus > 0) {
          pushElig({
            rep_id: rep.rep_id,
            period,
            customer_id: c.customer_id,
            opportunity_id: o.opportunity_id,
            contract_id: contractId,
            eligibility_type: 'Bonus',
            basis_amount: version.new_customer_bonus,
            basis_label: 'One-time new customer bonus (flat)',
            plan_version_id: version.plan_version_id,
            notes: 'Flat bonus — basis equals payout before accelerator',
          })
        }
      }

      // Expansion — positive YoY Net Billing delta only
      const expansion = Math.max(0, net - prior)
      if (expansion > 50 && prior > 0) {
        pushElig({
          rep_id: rep.rep_id,
          period,
          customer_id: c.customer_id,
          opportunity_id: null,
          contract_id: contractId,
          eligibility_type: 'Expansion',
          basis_amount: expansion,
          basis_label: 'YoY positive Net Billing delta (invoice net)',
          plan_version_id: version.plan_version_id,
          notes: 'Expansion ≠ full Net Billing; only growth over prior-year same month',
        })
      }

      // Residual Revenue commission on eligible Net Billing (exclude acquisition closed month double-pay on same $)
      // Use net billing when customer is active; skip if churned before period
      const churned =
        c.churn_date && c.churn_date.slice(0, 7) < period
      if (!churned && net > 0) {
        // Exclude portion already covered as expansion from residual to limit double count:
        // residual basis = net − expansion (floor 0)
        const residual = r2(Math.max(0, net - expansion))
        if (residual > 0) {
          pushElig({
            rep_id: rep.rep_id,
            period,
            customer_id: c.customer_id,
            opportunity_id: null,
            contract_id: contractId,
            eligibility_type: 'Revenue',
            basis_amount: residual,
            basis_label: 'Eligible Net Billing residual (invoice net − expansion delta)',
            plan_version_id: version.plan_version_id,
            notes: 'Eligible Revenue ≠ Recognized Revenue; uses invoice Net Billing date basis',
          })
        }
      }

      // Clawback — credit memos
      const credits = creditsByCustPeriod.get(`${c.customer_id}|${period}`) ?? 0
      if (credits > 0 && version.clawback_credit_rate > 0) {
        pushElig({
          rep_id: rep.rep_id,
          period,
          customer_id: c.customer_id,
          opportunity_id: null,
          contract_id: contractId,
          eligibility_type: 'Clawback',
          basis_amount: -r2(credits * version.clawback_credit_rate),
          basis_label: `Credit memo × clawback rate ${version.clawback_credit_rate}`,
          plan_version_id: version.plan_version_id,
          notes: 'Clawback reduces earned commission; not a new revenue charge',
        })
      }
    }
  }

  // ---- Quotas: Eligible Revenue per rep-period (sum of Revenue + Expansion bases) ----
  const eligibleRevByRepPeriod = new Map<string, number>()
  for (const e of commissionEligibility) {
    if (e.eligibility_type !== 'Revenue' && e.eligibility_type !== 'Expansion') continue
    const k = `${e.rep_id}|${e.period}`
    eligibleRevByRepPeriod.set(k, r2((eligibleRevByRepPeriod.get(k) ?? 0) + Math.max(0, e.basis_amount)))
  }

  const salesQuotas: FactSalesQuota[] = []
  let qSeq = 1
  for (const rep of salesReps) {
    for (const period of periods) {
      const version = pickVersion(compensationPlanVersions, period)
      const actual = eligibleRevByRepPeriod.get(`${rep.rep_id}|${period}`) ?? 0
      // Quota ~ 90–115% of typical actual with seeded stretch so attainment varies
      const stretch = 0.88 + rng.next() * 0.3
      const quota = r2(Math.max(actual * stretch, 25_000))
      salesQuotas.push({
        quota_id: `QUOTA-${pad(qSeq++)}`,
        rep_id: rep.rep_id,
        period,
        quota_amount: quota,
        quota_basis: version.quota_basis,
        plan_version_id: version.plan_version_id,
        synthetic: true,
      })
    }
  }
  const quotaMap = new Map(salesQuotas.map((q) => [`${q.rep_id}|${q.period}`, q]))

  // Attainment → accelerator per rep-period
  const attainByRepPeriod = new Map<string, number>()
  for (const q of salesQuotas) {
    const actual = eligibleRevByRepPeriod.get(`${q.rep_id}|${q.period}`) ?? 0
    const pct = q.quota_amount > 0 ? (actual / q.quota_amount) * 100 : 0
    attainByRepPeriod.set(`${q.rep_id}|${q.period}`, pct)
  }

  // ---- Ledger ----
  const commissionLedger: FactCommissionLedger[] = []
  let ledSeq = 1
  const earnedByRepPeriod = new Map<string, number>()

  for (const e of commissionEligibility) {
    const version = versionById.get(e.plan_version_id)!
    const attain = attainByRepPeriod.get(`${e.rep_id}|${e.period}`) ?? 0
    const mult =
      e.eligibility_type === 'Clawback' || e.eligibility_type === 'Bonus'
        ? 1
        : acceleratorMult(version, attain)
    let baseRate = 0
    if (e.eligibility_type === 'New Acquisition') baseRate = version.new_acquisition_rate
    else if (e.eligibility_type === 'Expansion')
      baseRate = version.expansion_rate + version.expansion_bonus_pct
    else if (e.eligibility_type === 'Revenue') baseRate = version.revenue_rate
    else if (e.eligibility_type === 'Bonus') baseRate = 1 // flat amount already in basis
    else if (e.eligibility_type === 'Clawback') baseRate = 1 // basis already signed

    const { earned } = computeLineCommission({
      basis: e.basis_amount,
      baseRate,
      acceleratorMult: mult,
      capRemaining: null,
    })

    // Approval / pay lifecycle (deterministic)
    const ageMonths =
      periods.indexOf(input.historyEnd) - periods.indexOf(e.period)
    let approval_status: FactCommissionLedger['approval_status'] = 'Pending'
    let approved_amount = 0
    let paid_amount = 0
    if (ageMonths >= 1 || e.period < input.historyEnd) {
      approval_status = 'Approved'
      approved_amount = earned
    }
    if (ageMonths >= 2) {
      paid_amount = approved_amount
    } else if (ageMonths === 1 && approval_status === 'Approved') {
      // latest approved month partially unpaid
      paid_amount = r2(approved_amount * (rng.next() > 0.35 ? 1 : 0))
    }

    const row: FactCommissionLedger = {
      ledger_id: `CL-${pad(ledSeq++, 5)}`,
      eligibility_id: e.eligibility_id,
      rep_id: e.rep_id,
      period: e.period,
      customer_id: e.customer_id,
      opportunity_id: e.opportunity_id,
      contract_id: e.contract_id,
      eligibility_type: e.eligibility_type,
      basis_amount: e.basis_amount,
      base_rate: baseRate,
      accelerator_mult: mult,
      commission_earned: earned,
      plan_version_id: e.plan_version_id,
      approval_status,
      approved_amount,
      paid_amount,
      payment_id: null,
      calc_notes: `plan=${version.version_label}; attainment=${attain.toFixed(1)}%; mult=${mult}; Eligible≠Recognized`,
      synthetic: true,
    }
    commissionLedger.push(row)
    const rk = `${e.rep_id}|${e.period}`
    earnedByRepPeriod.set(rk, r2((earnedByRepPeriod.get(rk) ?? 0) + earned))
  }

  // ---- Payments (aggregate approved paid lines by rep × period) ----
  const commissionPayments: FactCommissionPayment[] = []
  let paySeq = 1
  const payGroups = new Map<string, FactCommissionLedger[]>()
  for (const L of commissionLedger) {
    if (L.paid_amount <= 0) continue
    const k = `${L.rep_id}|${L.period}`
    const list = payGroups.get(k) ?? []
    list.push(L)
    payGroups.set(k, list)
  }
  for (const [k, lines] of payGroups) {
    const [rep_id, period] = k.split('|')
    const amount = r2(lines.reduce((a, L) => a + L.paid_amount, 0))
    const payment_id = `CPAY-${pad(paySeq++)}`
    const status =
      lines.every((L) => L.paid_amount >= L.approved_amount - 0.01)
        ? 'Paid'
        : 'Partial'
    commissionPayments.push({
      payment_id,
      rep_id,
      period,
      amount,
      paid_date: `${addMonths(period, 1)}-20`,
      status,
      ledger_ids: lines.map((L) => L.ledger_id),
      synthetic: true,
    })
    for (const L of lines) L.payment_id = payment_id
  }

  // ---- Intentional audit exceptions (injected for demo) ----
  const commissionAuditExceptions: FactCommissionAuditException[] = []
  let audSeq = 1
  const pushAudit = (
    row: Omit<FactCommissionAuditException, 'audit_id' | 'is_confirmed_loss' | 'synthetic'>,
  ) => {
    commissionAuditExceptions.push({
      ...row,
      audit_id: `CAUD-${pad(audSeq++)}`,
      is_confirmed_loss: false,
      synthetic: true,
    })
  }

  // 1) Duplicate Commission — clone a paid revenue line amount as "extra" variance
  const dupSrc = commissionLedger.find(
    (L) => L.eligibility_type === 'Revenue' && L.paid_amount > 100 && L.period <= '2026-08',
  )
  if (dupSrc) {
    pushAudit({
      audit_type: 'Duplicate Commission',
      rep_id: dupSrc.rep_id,
      customer_id: dupSrc.customer_id,
      ledger_id: dupSrc.ledger_id,
      payment_id: dupSrc.payment_id,
      opportunity_id: dupSrc.opportunity_id,
      period: dupSrc.period,
      expected_amount: dupSrc.commission_earned,
      actual_amount: r2(dupSrc.commission_earned * 2),
      difference: dupSrc.commission_earned,
      root_cause: 'Same eligibility event referenced on two payment batches (injected demo exception)',
      suggested_owner: 'Finance',
      status: 'Open',
      resolution_notes: '',
      recommended_action: 'Reverse duplicate payment; reconcile ledger ↔ payment',
      detected_date: input.asOfDate,
      financial_impact: dupSrc.commission_earned,
    })
  }

  // 2) Overpayment — payment > approved
  const overSrc = commissionLedger.find(
    (L) => L.approval_status === 'Approved' && L.paid_amount > 0 && L.period === '2026-07',
  )
  if (overSrc) {
    const expected = overSrc.approved_amount
    const actual = r2(expected * 1.12)
    pushAudit({
      audit_type: 'Overpayment',
      rep_id: overSrc.rep_id,
      customer_id: overSrc.customer_id,
      ledger_id: overSrc.ledger_id,
      payment_id: overSrc.payment_id,
      opportunity_id: null,
      period: overSrc.period,
      expected_amount: expected,
      actual_amount: actual,
      difference: r2(actual - expected),
      root_cause: 'Paid amount exceeds approved commission (injected demo exception)',
      suggested_owner: 'Finance',
      status: 'Investigating',
      resolution_notes: '',
      recommended_action: 'Confirm payroll feed; claw back overpayment if confirmed',
      detected_date: input.asOfDate,
      financial_impact: r2(actual - expected),
    })
  }

  // 3) Underpayment
  const underSrc = commissionLedger.find(
    (L) =>
      L.approval_status === 'Approved' &&
      L.paid_amount > 0 &&
      L.paid_amount < L.approved_amount &&
      L.period <= '2026-09',
  )
  if (underSrc) {
    pushAudit({
      audit_type: 'Underpayment',
      rep_id: underSrc.rep_id,
      customer_id: underSrc.customer_id,
      ledger_id: underSrc.ledger_id,
      payment_id: underSrc.payment_id,
      opportunity_id: null,
      period: underSrc.period,
      expected_amount: underSrc.approved_amount,
      actual_amount: underSrc.paid_amount,
      difference: r2(underSrc.paid_amount - underSrc.approved_amount),
      root_cause: 'Partial payout without open hold reason (injected / lifecycle residual)',
      suggested_owner: 'Finance',
      status: 'Open',
      resolution_notes: '',
      recommended_action: 'Release remaining approved balance or document hold',
      detected_date: input.asOfDate,
      financial_impact: r2(underSrc.approved_amount - underSrc.paid_amount),
    })
  }

  // 4) Incorrect Rate — wrong plan version band
  const rateSrc = commissionLedger.find(
    (L) => L.eligibility_type === 'New Acquisition' && L.period >= '2026-01',
  )
  if (rateSrc) {
    const correct = versionById.get('PLAN-AE-STD-v2')!
    const wrongRate = v1.new_acquisition_rate
    const expected = r2(
      rateSrc.basis_amount * correct.new_acquisition_rate * rateSrc.accelerator_mult,
    )
    const actual = r2(rateSrc.basis_amount * wrongRate * rateSrc.accelerator_mult)
    pushAudit({
      audit_type: 'Wrong Plan Version',
      rep_id: rateSrc.rep_id,
      customer_id: rateSrc.customer_id,
      ledger_id: rateSrc.ledger_id,
      payment_id: rateSrc.payment_id,
      opportunity_id: rateSrc.opportunity_id,
      period: rateSrc.period,
      expected_amount: expected,
      actual_amount: actual,
      difference: r2(actual - expected),
      root_cause: 'Acquisition deal priced with v1 rate after v2 effective date (injected)',
      suggested_owner: 'Sales',
      status: 'Open',
      resolution_notes: '',
      recommended_action: 'Reprice with PLAN-AE-STD-v2; adjust ledger',
      detected_date: input.asOfDate,
      financial_impact: Math.abs(r2(actual - expected)),
    })
  }

  // 5) Clawback Not Applied
  const clawElig = commissionEligibility.find(
    (e) => e.eligibility_type === 'Clawback' && e.period <= '2026-09',
  )
  if (clawElig) {
    pushAudit({
      audit_type: 'Clawback Not Applied',
      rep_id: clawElig.rep_id,
      customer_id: clawElig.customer_id,
      ledger_id: commissionLedger.find((L) => L.eligibility_id === clawElig.eligibility_id)?.ledger_id ?? null,
      payment_id: null,
      opportunity_id: null,
      period: clawElig.period,
      expected_amount: clawElig.basis_amount,
      actual_amount: 0,
      difference: -clawElig.basis_amount,
      root_cause: 'Credit memo clawback eligibility exists but payroll feed omitted (injected)',
      suggested_owner: 'Finance',
      status: 'Investigating',
      resolution_notes: '',
      recommended_action: 'Apply clawback adjustment on next commission cycle',
      detected_date: input.asOfDate,
      financial_impact: Math.abs(clawElig.basis_amount),
    })
  }

  // 6) Incorrect Sales Rep Assignment
  const misCust = input.customers.find((c) => c.segment === 'Enterprise')
  if (misCust) {
    const wrongRep = salesReps.find((r) => r.rep_name !== misCust.account_owner) ?? salesReps[0]
    const rightRep = custRep.get(misCust.customer_id)!
    const sample = commissionLedger.find(
      (L) => L.customer_id === misCust.customer_id && L.eligibility_type === 'Revenue',
    )
    if (sample) {
      pushAudit({
        audit_type: 'Incorrect Sales Rep Assignment',
        rep_id: wrongRep.rep_id,
        customer_id: misCust.customer_id,
        ledger_id: sample.ledger_id,
        payment_id: null,
        opportunity_id: null,
        period: sample.period,
        expected_amount: sample.commission_earned,
        actual_amount: sample.commission_earned,
        difference: 0,
        root_cause: `Commission credited to ${wrongRep.rep_name}; account owner is ${rightRep.rep_name} (injected)`,
        suggested_owner: 'Sales',
        status: 'Open',
        resolution_notes: '',
        recommended_action: 'Reassign ledger to correct rep; no net P&L change if transfer only',
        detected_date: input.asOfDate,
        financial_impact: 0,
      })
    }
  }

  // silence unused
  void quotaMap
  void earnedByRepPeriod

  return {
    salesReps,
    compensationPlans,
    compensationPlanVersions,
    salesQuotas,
    commissionEligibility,
    commissionLedger,
    commissionPayments,
    commissionAuditExceptions,
  }
}
