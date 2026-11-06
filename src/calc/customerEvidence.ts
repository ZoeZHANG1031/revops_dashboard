/**
 * Customer 360 evidence chain — one place that turns the Health Score inputs into:
 *   risk evidence (prior / current / change / trigger / score impact),
 *   a recomputable score explanation, the scenario exposure formula, and evidence-matched actions.
 *
 * Three things are kept separate on purpose:
 *   Arithmetic attribution (revenue bridge) · Business root cause (needs evidence outside this data) ·
 *   Risk scoring (which rules fired).
 */
import { computeArSnapshot, invoiceOutstanding, isOverdueInvoice, paidByInvoiceAsOf } from '@/calc/arSnapshot'
import {
  HEALTH_BANDS,
  HEALTH_GATE_BAND,
  HEALTH_GATE_VOLUME_DECLINE_PCT,
  HEALTH_MISSING_PLACEHOLDER,
  HEALTH_RULES,
  SCENARIO_STRESS_FACTORS,
  type CustomerHealthRow,
} from '@/calc/customerHealth'
import { customerComparisonWindow, type CustomerComparisonWindow } from '@/calc/customerComparison'
import type { CustomerContractHealth } from '@/calc/customerContractHealth'
import type { CustomerMarginDiagnosis } from '@/calc/customerMarginBridge'
import type { CustomerRevenueBridge } from '@/calc/customerRevenueBridge'
import { RISK_RULES } from '@/calc/customerRisk'
import { addMonths, filterShipments } from '@/lib/filters'
import { formatCurrency, formatNumber, money, sumMoney } from '@/lib/money'
import type { DataStore, FactException, FactInvoice, GlobalFilters } from '@/types'

export interface EvidenceLink {
  label: string
  path: string
  extras: Record<string, string | null>
}

export type ComponentKey = 'volume' | 'delivery' | 'profitability' | 'payment' | 'billing'

export interface HealthComponentRow {
  key: ComponentKey
  name: string
  rawMetric: string
  comparison: string
  rule: string
  score: number
  observed: boolean
  /** normalized weight 0–1 */
  weight: number
  /** weight × score (points of the 100-point total) */
  contribution: number
  /** weight × (100 − score) — points this component takes away from 100 */
  shortfall: number
  sources: EvidenceLink[]
}

export interface RiskEvidenceRow {
  id: ComponentKey
  risk: string
  status: 'Confirmed' | 'Needs investigation'
  prior: string
  current: string
  change: string
  trigger: string
  scoreImpact: number
  link: EvidenceLink
}

export interface EvidenceAction {
  id: ComponentKey
  title: string
  problem: string
  evidence: string
  nextStep: string
  owner: string
  priority: 'High' | 'Medium' | 'Low'
  priorityRationale: string
  /** Suggested follow-up date — not an assigned due date */
  followUpBy: string
  successMeasure: string
  financialImpact: string
  evidenceCompleteness: 'Complete' | 'Partial'
  link: EvidenceLink
}

export interface MonthlyPoint {
  period: string
  packages: number
  netBilling: number
  segment: 'prior' | 'current' | 'gap'
}

export interface DimensionDelta {
  key: string
  prior: number
  current: number
  delta: number
}

/** One health component classified by its actual score contribution */
export interface DiagnosisDriver {
  key: ComponentKey
  name: string
  score: number
  /** Points this component takes off 100 (weight × (100 − score)) */
  shortfall: number
  /** Points this component adds above a neutral 60 (weight × (score − 60)); negative = drag */
  netEffect: number
  detail: string
}

/**
 * Semantically separated diagnosis. Only `negative` drivers may be described as
 * the reason a score is low; only `positive` drivers as the reason it is high.
 * `alerts` are rule-based risk flags — reported, never cited as a cause of health.
 */
export interface CustomerDiagnosis {
  positive: DiagnosisDriver[]
  negative: DiagnosisDriver[]
  neutral: DiagnosisDriver[]
  alerts: { id: ComponentKey; label: string; detail: string }[]
  overrideReason: string | null
  headline: string
  /** Single recommended next action (top evidence-backed action) */
  nextAction: string | null
}

/** Component score thresholds for driver classification (demo configuration) */
export const DIAGNOSIS_RULES = {
  /** score ≥ this → positive driver */
  positiveScore: 80,
  /** score < this AND shortfall ≥ negativeMinShortfall → negative driver */
  negativeScore: 60,
  negativeMinShortfall: 3,
  neutralAnchor: 60,
} as const

export interface CustomerEvidence {
  window: CustomerComparisonWindow
  asOf: string
  conclusion: string
  diagnosis: CustomerDiagnosis
  health: {
    score: number
    band: CustomerHealthRow['healthBand']
    scoreBand: CustomerHealthRow['scoreBand']
    weightedScore: number
    coverage: number
    provisional: boolean
    override: CustomerHealthRow['inputs']['override']
    components: HealthComponentRow[]
    bandRule: string
    missingRule: string
  }
  revenue: { field: 'Net Billing'; prior: number | null; current: number; change: number | null; pct: number | null }
  volume: {
    prior: number | null
    current: number
    change: number | null
    pct: number | null
    monthly: MonthlyPoint[]
    withinCurrent: { first: number; last: number; pct: number | null; label: 'Recovery within current period' | 'Further decline within current period' | 'Flat within current period' | 'N/A' }
    byMetro: DimensionDelta[]
    byService: DimensionDelta[]
  }
  margin: {
    priorCm: number | null
    currentCm: number | null
    changePts: number | null
    priorContribution: number | null
    currentContribution: number
    contributionChange: number | null
    floorPct: number
    dropRulePts: number
    triggered: string[]
  }
  billing: {
    cases: FactException[]
    affectedAmount: number
    affectedPct: number | null
    denominator: number
    oldestCaseDays: number | null
    triggered: string[]
  }
  payment: {
    openAr: number
    overdueAr: number
    overdueInvoices: { invoice: FactInvoice; outstanding: number; daysPastDue: number }[]
    oldestDaysPastDue: number | null
    statusMismatches: number
  }
  delivery: {
    onTimePct: number | null
    priorOnTimePct: number | null
    deliveredPct: number | null
    latePackages: number
    targetPct: number
  }
  exposure: {
    label: 'Scenario Revenue Exposure'
    basis: string
    basisAmount: number
    horizon: string
    factor: number
    factorRule: string
    amount: number
    formula: string
    validated: false
  }
  risks: RiskEvidenceRow[]
  allRisks: RiskEvidenceRow[]
  actions: EvidenceAction[]
}

const pctChange = (prior: number | null, cur: number) =>
  prior == null || prior === 0 ? null : money(((cur - prior) / Math.abs(prior)) * 100)
const signed = (v: number, fmt: (x: number) => string) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}`
const sPct = (v: number | null, d = 1) => (v == null ? 'N/A' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`)
const r1 = (v: number) => Math.round(v * 10) / 10
/** Typographic minus for thresholds (−10, not -10) */
const thr = (v: number) => (v < 0 ? `−${Math.abs(v)}` : `${v}`)
const fmtM = (v: number) => formatCurrency(v, true)

function addDays(iso: string, d: number) {
  return new Date(Date.parse(iso) + d * 86400000).toISOString().slice(0, 10)
}

function deltas(prior: Map<string, number>, cur: Map<string, number>): DimensionDelta[] {
  const keys = new Set([...prior.keys(), ...cur.keys()])
  return [...keys]
    .map((k) => ({ key: k, prior: prior.get(k) ?? 0, current: cur.get(k) ?? 0, delta: (cur.get(k) ?? 0) - (prior.get(k) ?? 0) }))
    .sort((a, b) => a.delta - b.delta)
}

export function buildCustomerEvidence(args: {
  data: DataStore
  filters: GlobalFilters
  customerId: string
  health: CustomerHealthRow
  contract: CustomerContractHealth | null
  revBridge: CustomerRevenueBridge | null
  margin: CustomerMarginDiagnosis | null
}): CustomerEvidence {
  const { data, filters, customerId, health: h, revBridge } = args
  const inp = h.inputs
  const asOf = data.meta.as_of_date ?? '2026-11-05'
  const win = customerComparisonWindow(data, filters)
  const cf: GlobalFilters = { ...filters, customerIds: [customerId] }
  const custLink = (label: string, path: string, extra: Record<string, string | null> = {}): EvidenceLink => ({
    label,
    path,
    extras: { customerId, sourcePage: '/customer-360', ...extra },
  })
  const cmpLabel = win.prior ? `${win.current.label} vs ${win.prior.label}` : `${win.current.label} (no prior-year data)`

  // ---- Volume: shipped packages per ship month (same population as the Health Score)
  const monthly: MonthlyPoint[] = []
  const byMetroCur = new Map<string, number>()
  const byMetroPrior = new Map<string, number>()
  const bySvcCur = new Map<string, number>()
  const bySvcPrior = new Map<string, number>()
  const rangeStart = win.prior?.startPeriod ?? win.current.startPeriod
  const shipsAll = filterShipments(data, { ...cf, startPeriod: rangeStart, endPeriod: win.current.endPeriod })
  const pkgByMonth = new Map<string, number>()
  for (const s of shipsAll) {
    const m = s.ship_date.slice(0, 7)
    pkgByMonth.set(m, (pkgByMonth.get(m) ?? 0) + s.package_count)
    const inCur = m >= win.current.startPeriod && m <= win.current.endPeriod
    const inPrior = !!win.prior && m >= win.prior.startPeriod && m <= win.prior.endPeriod
    if (inCur) {
      byMetroCur.set(s.metro, (byMetroCur.get(s.metro) ?? 0) + s.package_count)
      bySvcCur.set(s.service_type, (bySvcCur.get(s.service_type) ?? 0) + s.package_count)
    } else if (inPrior) {
      byMetroPrior.set(s.metro, (byMetroPrior.get(s.metro) ?? 0) + s.package_count)
      bySvcPrior.set(s.service_type, (bySvcPrior.get(s.service_type) ?? 0) + s.package_count)
    }
  }
  const netByMonth = new Map<string, number>()
  for (const l of data.billingLines) {
    if (l.customer_id !== customerId || l.is_duplicate) continue
    if (l.accounting_period < rangeStart || l.accounting_period > win.current.endPeriod) continue
    netByMonth.set(l.accounting_period, (netByMonth.get(l.accounting_period) ?? 0) + l.net_amount)
  }
  for (let p = rangeStart; p <= win.current.endPeriod; p = addMonths(p, 1)) {
    monthly.push({
      period: p,
      packages: pkgByMonth.get(p) ?? 0,
      netBilling: money(netByMonth.get(p) ?? 0),
      segment:
        p >= win.current.startPeriod ? 'current' : win.prior && p <= win.prior.endPeriod ? 'prior' : 'gap',
    })
  }
  const curMonths = monthly.filter((m) => m.segment === 'current')
  const first = curMonths[0]?.packages ?? 0
  const last = curMonths[curMonths.length - 1]?.packages ?? 0
  const withinPct = curMonths.length > 1 && first > 0 ? money(((last - first) / first) * 100) : null
  const withinLabel =
    withinPct == null
      ? 'N/A'
      : withinPct > 2
        ? 'Recovery within current period'
        : withinPct < -2
          ? 'Further decline within current period'
          : 'Flat within current period'
  const volPrior = inp.priorShippedPackages
  const volCur = inp.shippedPackages
  const volChange = volPrior == null ? null : volCur - volPrior

  // ---- Payment as of the As-of Date (same snapshot as Collections)
  const ar = computeArSnapshot(data, cf)
  const paid = paidByInvoiceAsOf(data, ar.asOf)
  const overdueInvoices = ar.openInvoices
    .filter((i) => isOverdueInvoice(i, ar.asOf, invoiceOutstanding(i, paid)))
    .map((i) => ({
      invoice: i,
      outstanding: invoiceOutstanding(i, paid),
      daysPastDue: Math.floor((Date.parse(ar.asOf) - Date.parse(i.due_date)) / 86400000),
    }))
    .sort((a, b) => b.daysPastDue - a.daysPastDue)
  // Status field vs computed state (only meaningful at the snapshot date)
  let statusMismatches = 0
  if (ar.asOf === data.meta.as_of_date) {
    for (const i of data.invoices) {
      if (i.customer_id !== customerId || i.status === 'Draft' || i.invoice_date > ar.asOf) continue
      const out = invoiceOutstanding(i, paid)
      const computedOverdue = isOverdueInvoice(i, ar.asOf, out)
      if ((i.status === 'Overdue') !== computedOverdue) statusMismatches++
    }
  }

  // ---- Health components (recomputable)
  const w = inp.weights
  const comp = (
    key: ComponentKey,
    name: string,
    score: number,
    weight: number,
    observed: boolean,
    rawMetric: string,
    comparison: string,
    rule: string,
    sources: EvidenceLink[],
  ): HealthComponentRow => ({
    key,
    name,
    score,
    weight,
    observed,
    rawMetric: observed ? rawMetric : `Insufficient evidence — neutral placeholder ${HEALTH_MISSING_PLACEHOLDER} applied`,
    comparison,
    rule,
    contribution: r1(weight * score),
    shortfall: r1(weight * (100 - score)),
    sources,
  })
  const components: HealthComponentRow[] = [
    comp(
      'volume',
      'Volume trend',
      h.volumeScore,
      w.volumeTrend,
      inp.observed.volume,
      volPrior == null
        ? 'N/A'
        : `Shipped packages ${formatNumber(volPrior)} → ${formatNumber(volCur)} (${sPct(inp.volumeGrowthPct)})`,
      cmpLabel,
      HEALTH_RULES.volume,
      [custLink('Shipments (lifecycle)', '/lifecycle')],
    ),
    comp(
      'delivery',
      'Delivery (on-time)',
      h.deliveryScore,
      w.deliveryPerformance,
      inp.observed.delivery,
      `On-time ${inp.onTimePct?.toFixed(1)}% of shipped packages (delivered ${inp.deliveredPct?.toFixed(1)}% is completion, not the score input)`,
      `${win.current.label} level (prior year ${inp.priorOnTimePct?.toFixed(1) ?? 'N/A'}%)`,
      HEALTH_RULES.delivery,
      [custLink('Shipments (lifecycle)', '/lifecycle')],
    ),
    comp(
      'profitability',
      'Profitability (CM %)',
      h.profitScore,
      w.profitability,
      inp.observed.profitability,
      `Contribution margin ${h.contributionMargin?.toFixed(1)}% (prior year ${inp.priorContributionMargin?.toFixed(1) ?? 'N/A'}%)`,
      `${win.current.label} level`,
      HEALTH_RULES.profitability,
      [custLink('Customer profitability', '/profitability/customer')],
    ),
    comp(
      'payment',
      'Payment behaviour',
      h.paymentScore,
      w.paymentBehavior,
      inp.observed.payment,
      `${inp.overdueInvoiceCount} of ${inp.invoiceCount} invoices overdue as of ${asOf}; ${inp.paidInvoiceCount} fully paid`,
      `Invoices issued ${win.current.label} + older invoices still overdue`,
      HEALTH_RULES.payment,
      [custLink('Collections & AR', '/collections')],
    ),
    comp(
      'billing',
      'Billing quality',
      h.issueScore,
      w.customerIssues,
      inp.observed.billing,
      `${inp.billingCases.length} open billing case${inp.billingCases.length === 1 ? '' : 's'}, ${formatCurrency(inp.billingAffectedAmount)} affected (${inp.billingAffectedPct?.toFixed(2) ?? '0.00'}% of Net Billing); penalties −${inp.billingPenalties.amount.toFixed(1)} / −${inp.billingPenalties.count} / −${inp.billingPenalties.severity}`,
      `Cases detected ${win.current.label}, open as of ${asOf}`,
      HEALTH_RULES.billing,
      [custLink('Reconciliation cases', '/reconciliation', { exceptionStatus: 'Open' })],
    ),
  ]
  const byKey = Object.fromEntries(components.map((c) => [c.key, c])) as Record<ComponentKey, HealthComponentRow>

  // ---- Risk evidence (trigger rules shared with risk tags)
  const all: RiskEvidenceRow[] = []
  if (inp.observed.volume && inp.volumeGrowthPct != null) {
    const confirmed = inp.volumeGrowthPct <= RISK_RULES.volumeDeclinePct
    if (confirmed || h.volumeScore < 50)
      all.push({
        id: 'volume',
        risk: 'Volume contraction',
        status: confirmed ? 'Confirmed' : 'Needs investigation',
        prior: `${formatNumber(volPrior ?? 0)} pkgs`,
        current: `${formatNumber(volCur)} pkgs`,
        change: `${signed(volChange ?? 0, formatNumber)} (${sPct(inp.volumeGrowthPct)})`,
        trigger: `YoY shipped packages ≤ ${thr(RISK_RULES.volumeDeclinePct)}% · ${confirmed ? 'met' : 'not met'}`,
        scoreImpact: byKey.volume.shortfall,
        link: custLink('Volume detail', '#c360-volume'),
      })
  }
  const cmNow = h.contributionMargin
  const cmPrior = inp.priorContributionMargin
  const marginTriggered: string[] = []
  if (cmNow != null && cmNow < RISK_RULES.marginFloorPct) marginTriggered.push(`CM below ${RISK_RULES.marginFloorPct}% demo floor`)
  if (cmNow != null && cmPrior != null && cmNow <= cmPrior - RISK_RULES.marginDropPts)
    marginTriggered.push(`CM down ≥ ${RISK_RULES.marginDropPts} pts YoY`)
  if (inp.observed.profitability && cmNow != null && (marginTriggered.length || h.profitScore < 50)) {
    const changePts = cmPrior == null ? null : r1(cmNow - cmPrior)
    all.push({
      id: 'profitability',
      risk: changePts != null && changePts < 0 ? 'Margin deterioration' : 'Low contribution margin',
      status: marginTriggered.length ? 'Confirmed' : 'Needs investigation',
      prior: cmPrior == null ? 'N/A' : `${cmPrior.toFixed(1)}% CM`,
      current: `${cmNow.toFixed(1)}% CM`,
      change: changePts == null ? 'N/A' : `${changePts > 0 ? '+' : changePts < 0 ? '−' : ''}${Math.abs(changePts).toFixed(1)} pts`,
      trigger: marginTriggered.length ? marginTriggered.join(' · ') : `Score < 50, no margin rule met`,
      scoreImpact: byKey.profitability.shortfall,
      link: custLink('Profitability detail', '#c360-margin'),
    })
  }
  const billingTriggered: string[] = []
  if (inp.billingCases.length >= RISK_RULES.billingCaseCount) billingTriggered.push(`≥ ${RISK_RULES.billingCaseCount} open billing cases`)
  if (inp.billingCases.length > 0 && h.issueScore < RISK_RULES.billingScoreFloor) billingTriggered.push(`Billing score < ${RISK_RULES.billingScoreFloor}`)
  if (inp.billingCases.length > 0 && (billingTriggered.length || h.issueScore < 70)) {
    all.push({
      id: 'billing',
      risk: 'Unresolved billing exceptions',
      status: billingTriggered.length ? 'Confirmed' : 'Needs investigation',
      prior: '—',
      current: `${inp.billingCases.length} open · ${formatCurrency(inp.billingAffectedAmount)}`,
      change: `${inp.billingAffectedPct?.toFixed(2) ?? '0'}% of Net Billing`,
      trigger: billingTriggered.length ? billingTriggered.join(' · ') : 'Billing score < 70, no rule met',
      scoreImpact: byKey.billing.shortfall,
      link: custLink('Billing detail', '#c360-billing'),
    })
  }
  if (ar.overdueAr > 0.005) {
    all.push({
      id: 'payment',
      risk: 'Overdue receivables',
      status: 'Confirmed',
      prior: '—',
      current: `${formatCurrency(ar.overdueAr, true)} overdue`,
      change: `${overdueInvoices.length} invoice${overdueInvoices.length === 1 ? '' : 's'} · oldest ${overdueInvoices[0]?.daysPastDue ?? 0}d past due`,
      trigger: 'Balance past due date as of the As-of Date · met',
      scoreImpact: byKey.payment.shortfall,
      link: custLink('Payment detail', '#c360-payment'),
    })
  }
  if (inp.observed.delivery && inp.onTimePct != null && h.deliveryScore < 70) {
    const confirmed = h.deliveryScore < RISK_RULES.deliveryScoreFloor
    all.push({
      id: 'delivery',
      risk: 'On-time delivery below target',
      status: confirmed ? 'Confirmed' : 'Needs investigation',
      prior: inp.priorOnTimePct == null ? 'N/A' : `${inp.priorOnTimePct.toFixed(1)}% on-time`,
      current: `${inp.onTimePct.toFixed(1)}% on-time`,
      change:
        inp.priorOnTimePct == null
          ? 'N/A'
          : `${signed(r1(inp.onTimePct - inp.priorOnTimePct), (x) => x.toFixed(1))} pts`,
      trigger: `Delivery score < ${RISK_RULES.deliveryScoreFloor} (on-time < 88%) · ${confirmed ? 'met' : 'not met'}`,
      scoreImpact: byKey.delivery.shortfall,
      link: custLink('Delivery detail', '#c360-delivery'),
    })
  }
  all.sort((a, b) => (a.status === b.status ? b.scoreImpact - a.scoreImpact : a.status === 'Confirmed' ? -1 : 1))
  const risks = [...all].sort((a, b) => b.scoreImpact - a.scoreImpact).slice(0, 3)

  // ---- Actions: one per top risk, owner by evidence type
  const topDrop = deltas(byMetroPrior, byMetroCur)[0]
  const priceEffect = revBridge?.comparable ? revBridge.priceImpact : null
  const followDays = { High: 14, Medium: 30, Low: 45 } as const
  const actions: EvidenceAction[] = risks.map((r) => {
    const priority: EvidenceAction['priority'] =
      r.status === 'Confirmed' && r.scoreImpact >= 10 ? 'High' : r.status === 'Confirmed' || r.scoreImpact >= 5 ? 'Medium' : 'Low'
    const priorityRationale =
      priority === 'High'
        ? `Confirmed rule and ${r.scoreImpact.toFixed(1)} pts of score shortfall (≥ 10)`
        : priority === 'Medium'
          ? r.status === 'Confirmed'
            ? `Confirmed rule, ${r.scoreImpact.toFixed(1)} pts shortfall (< 10)`
            : `Not confirmed; ${r.scoreImpact.toFixed(1)} pts shortfall (≥ 5)`
          : `Not confirmed; ${r.scoreImpact.toFixed(1)} pts shortfall`
    const base = {
      id: r.id,
      priority,
      priorityRationale,
      followUpBy: addDays(asOf, followDays[priority]),
      link: r.link,
      evidence: `${r.prior} → ${r.current} (${r.change}); ${r.trigger}`,
    }
    switch (r.id) {
      case 'volume':
        return {
          ...base,
          title: 'Establish the cause of the volume decline',
          problem: `Shipped packages ${sPct(inp.volumeGrowthPct)} YoY; Net Billing ${h.revenueGrowth == null ? 'N/A' : sPct(h.revenueGrowth)}`,
          nextStep: `Account review of the largest declines${topDrop && topDrop.delta < 0 ? ` (${topDrop.key} −${formatNumber(Math.abs(topDrop.delta))} pkgs)` : ''}; confirm with the customer whether volume moved to another carrier, demand fell, or brands changed — not yet verified.`,
          owner: 'Account / Sales',
          successMeasure: `3-mo packages within ${thr(RISK_RULES.volumeDeclinePct)}% of prior year (now ${sPct(inp.volumeGrowthPct)})`,
          financialImpact: 'Not estimated',
          evidenceCompleteness: volPrior != null ? 'Complete' : 'Partial',
        }
      case 'profitability':
        return {
          ...base,
          title: priceEffect != null && priceEffect >= 0 ? 'Review cost per package before repricing' : 'Review yield and pricing',
          problem: `CM ${cmNow?.toFixed(1)}% vs ${RISK_RULES.marginFloorPct}% demo floor (prior year ${cmPrior?.toFixed(1) ?? 'N/A'}%)`,
          nextStep:
            priceEffect != null && priceEffect >= 0
              ? `Price/yield already contributes ${signed(priceEffect, fmtM)} — decompose DSP, sorting and linehaul cost per package with Finance before any repricing.`
              : `Price/yield contributes ${priceEffect == null ? 'N/A' : signed(priceEffect, fmtM)} — review rate card and discounts with Pricing.`,
          owner: 'Account + Finance / Pricing',
          successMeasure: `CM ≥ ${RISK_RULES.marginFloorPct}% (now ${cmNow?.toFixed(1)}%)`,
          financialImpact: 'Not estimated',
          evidenceCompleteness: cmPrior != null ? 'Complete' : 'Partial',
        }
      case 'billing':
        return {
          ...base,
          title: 'Resolve open billing exceptions',
          problem: `${inp.billingCases.length} open cases, ${formatCurrency(inp.billingAffectedAmount)} affected`,
          nextStep: 'Work the open cases in Reconciliation; confirm corrections with the account before invoicing.',
          owner: 'Billing + Account',
          successMeasure: '0 open billing cases',
          financialImpact: `${formatCurrency(inp.billingAffectedAmount)} affected (deduplicated)`,
          evidenceCompleteness: 'Complete',
        }
      case 'payment':
        return {
          ...base,
          title: 'Collect overdue invoices',
          problem: `${formatCurrency(ar.overdueAr, true)} overdue across ${overdueInvoices.length} invoices`,
          nextStep: 'Collections outreach starting with the oldest invoice; confirm any disputed amounts.',
          owner: 'Collections',
          successMeasure: 'Overdue AR $0',
          financialImpact: `${formatCurrency(ar.overdueAr, true)} overdue (cash timing, not lost revenue)`,
          evidenceCompleteness: 'Complete',
        }
      default:
        return {
          ...base,
          title: 'Review on-time delivery performance',
          problem: `On-time ${inp.onTimePct?.toFixed(1)}% vs 97% demo target`,
          nextStep: 'Operations review of late packages by station and service; check for capacity or DSP issues.',
          owner: 'Operations',
          successMeasure: 'On-time ≥ 94% (delivery score ≥ 85)',
          financialImpact: 'Not estimated',
          evidenceCompleteness: inp.priorOnTimePct != null ? 'Complete' : 'Partial',
        }
    }
  })

  // ---- Scenario exposure (reproducible; factor is a demo assumption)
  const factor = SCENARIO_STRESS_FACTORS[h.healthBand]
  const exposure: CustomerEvidence['exposure'] = {
    label: 'Scenario Revenue Exposure',
    basis: inp.exposure.basis,
    basisAmount: inp.exposure.amount,
    horizon: `${inp.exposure.horizonStart} – ${inp.exposure.horizonEnd}`,
    factor,
    factorRule: `Band stress factor (demo assumption, not a validated churn probability): Critical 40% · At Risk 22% · Watchlist 10% · Healthy 3%`,
    amount: h.scenarioRevenueAtRisk,
    formula: `${formatCurrency(inp.exposure.amount)} × ${Math.round(factor * 100)}% = ${formatCurrency(h.scenarioRevenueAtRisk)}`,
    validated: false,
  }

  // ---- Diagnosis: classify components by their real score contribution
  const describeComponent = (c: HealthComponentRow): string => {
    switch (c.key) {
      case 'volume':
        return inp.volumeGrowthPct == null ? 'volume trend not comparable' : `shipped packages ${sPct(inp.volumeGrowthPct)} YoY`
      case 'delivery':
        return inp.onTimePct == null ? 'no shipments' : `on-time delivery ${inp.onTimePct.toFixed(1)}%`
      case 'profitability':
        return cmNow == null ? 'margin unavailable' : `contribution margin ${cmNow.toFixed(1)}%`
      case 'payment':
        return inp.overdueInvoiceCount === 0
          ? `no overdue invoices (${inp.invoiceCount} issued)`
          : `${inp.overdueInvoiceCount} of ${inp.invoiceCount} invoices overdue`
      default:
        return inp.billingCases.length === 0
          ? 'no open billing cases'
          : `${inp.billingCases.length} open billing case${inp.billingCases.length === 1 ? '' : 's'}`
    }
  }
  const toDriver = (c: HealthComponentRow): DiagnosisDriver => ({
    key: c.key,
    name: c.name.split(' (')[0],
    score: c.score,
    shortfall: c.shortfall,
    netEffect: r1(c.weight * (c.score - DIAGNOSIS_RULES.neutralAnchor)),
    detail: describeComponent(c),
  })
  const observedComps = components.filter((c) => c.observed)
  const alertedKeys = new Set(all.filter((r) => r.status === 'Confirmed').map((r) => r.id))
  // A component with an active risk alert is never presented as a strength, even if its score is high
  const positive = observedComps
    .filter((c) => c.score >= DIAGNOSIS_RULES.positiveScore && !alertedKeys.has(c.key))
    .map(toDriver)
    .sort((a, b) => b.netEffect - a.netEffect)
  const negative = observedComps
    .filter((c) => c.score < DIAGNOSIS_RULES.negativeScore && c.shortfall >= DIAGNOSIS_RULES.negativeMinShortfall)
    .map(toDriver)
    .sort((a, b) => b.shortfall - a.shortfall)
  const neutral = components
    .filter((c) => !positive.some((p) => p.key === c.key) && !negative.some((n) => n.key === c.key))
    .map((c) => (c.observed ? toDriver(c) : { ...toDriver(c), detail: 'insufficient evidence (neutral placeholder)' }))
  const alerts = all
    .filter((r) => r.status === 'Confirmed')
    .map((r) => ({ id: r.id, label: r.risk, detail: `${r.current} (${r.change})` }))

  const lowBand = h.healthBand === 'At Risk' || h.healthBand === 'Critical'
  const list = (xs: DiagnosisDriver[]) => xs.slice(0, 2).map((d) => `${d.name.toLowerCase()} (${d.detail})`).join(' and ')
  const scorePart = `${h.customerName} scores ${h.healthScore}/100`
  let headline: string
  if (h.inputs.override.applied) {
    headline = `${scorePart} but is in the ${h.healthBand} Risk Band by override: ${h.overrideReason}.`
  } else if (lowBand) {
    headline = negative.length
      ? `${scorePart} (${h.healthBand}); the largest score drags are ${list(negative)}.`
      : `${scorePart} (${h.healthBand}); no single component is a material drag — weakness is spread across components.`
  } else if (h.healthBand === 'Watchlist') {
    headline = negative.length
      ? `${scorePart} (Watchlist), held back by ${list(negative)}${positive.length ? `; supported by ${list(positive)}` : ''}.`
      : `${scorePart} (Watchlist) with no single material drag${positive.length ? `; supported by ${list(positive)}` : ''}.`
  } else {
    headline = positive.length
      ? `${scorePart} (Healthy), supported by ${list(positive)}.`
      : `${scorePart} (Healthy).`
  }
  const nonDriverAlerts = alerts.filter((a) => !negative.some((n) => n.key === a.id))
  if (nonDriverAlerts.length) {
    headline += ` Risk alert${nonDriverAlerts.length > 1 ? 's' : ''} to monitor: ${nonDriverAlerts
      .slice(0, 2)
      .map((a) => a.label.toLowerCase())
      .join(', ')}.`
  }
  const diagnosis: CustomerDiagnosis = {
    positive,
    negative,
    neutral,
    alerts,
    overrideReason: h.overrideReason,
    headline,
    nextAction: actions[0] ? `${actions[0].title} — ${actions[0].owner}` : null,
  }
  const conclusion = headline

  return {
    window: win,
    asOf,
    conclusion,
    diagnosis,
    health: {
      score: h.healthScore,
      band: h.healthBand,
      scoreBand: h.scoreBand,
      weightedScore: inp.weightedScore,
      coverage: inp.scoreCoverage,
      provisional: inp.scoreCoverage < 100,
      override: inp.override,
      components,
      bandRule: HEALTH_BANDS.map((b, i) => (b.min > 0 ? `${b.band} ≥ ${b.min}` : `${b.band} < ${HEALTH_BANDS[i - 1]?.min ?? 50}`)).join(' · '),
      missingRule: `Missing component → neutral placeholder ${HEALTH_MISSING_PLACEHOLDER}, shown as "Insufficient evidence"; score marked Provisional below 100% coverage. Override: YoY packages ≤ ${thr(HEALTH_GATE_VOLUME_DECLINE_PCT)}% sets the Risk Band to ${HEALTH_GATE_BAND} (the score itself is not changed).`,
    },
    revenue: {
      field: 'Net Billing',
      prior: inp.priorNetBilling,
      current: inp.netBilling,
      change: inp.priorNetBilling == null ? null : money(inp.netBilling - inp.priorNetBilling),
      pct: h.revenueGrowth,
    },
    volume: {
      prior: volPrior,
      current: volCur,
      change: volChange,
      pct: inp.volumeGrowthPct ?? pctChange(volPrior, volCur),
      monthly,
      withinCurrent: { first, last, pct: withinPct, label: withinLabel },
      byMetro: deltas(byMetroPrior, byMetroCur),
      byService: deltas(bySvcPrior, bySvcCur),
    },
    margin: {
      priorCm: cmPrior,
      currentCm: cmNow,
      changePts: cmPrior == null || cmNow == null ? null : r1(cmNow - cmPrior),
      priorContribution: inp.priorContribution,
      currentContribution: inp.contribution,
      contributionChange: inp.priorContribution == null ? null : money(inp.contribution - inp.priorContribution),
      floorPct: RISK_RULES.marginFloorPct,
      dropRulePts: RISK_RULES.marginDropPts,
      triggered: marginTriggered,
    },
    billing: {
      cases: inp.billingCases,
      affectedAmount: inp.billingAffectedAmount,
      affectedPct: inp.billingAffectedPct,
      denominator: inp.netBilling,
      oldestCaseDays: inp.oldestBillingCaseDays,
      triggered: billingTriggered,
    },
    payment: {
      openAr: ar.outstandingAr,
      overdueAr: ar.overdueAr,
      overdueInvoices,
      oldestDaysPastDue: overdueInvoices[0]?.daysPastDue ?? null,
      statusMismatches,
    },
    delivery: {
      onTimePct: inp.onTimePct,
      priorOnTimePct: inp.priorOnTimePct,
      deliveredPct: inp.deliveredPct,
      latePackages: inp.shippedPackages - inp.onTimePackages,
      targetPct: 97,
    },
    exposure,
    risks,
    allRisks: all,
    actions,
  }
}

/** Sum of Σ weight × component — must equal the Health Score within rounding */
export function recomputeWeightedScore(components: HealthComponentRow[]): number {
  return Math.max(0, Math.min(100, Math.round(sumMoney(components.map((c) => c.weight * c.score)))))
}
