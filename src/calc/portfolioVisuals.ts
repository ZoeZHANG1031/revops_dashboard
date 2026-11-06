/**
 * Visual-first rollups for Client Quality / Risk / Growth pages.
 *
 * Every number here is derived from existing calc outputs (computeCustomerHealth,
 * buildCustomerRiskProfile, computeClientQualityPortfolio, fact tables). Nothing is
 * hard-coded: distributions, migrations and opportunity values recompute under filters.
 */
import type { ClientQualityPortfolio, WatchlistRow } from '@/calc/clientQuality'
import type { HealthBand } from '@/calc/customerHealth'
import type { CustomerRiskProfile, RiskType } from '@/calc/customerRisk'
import { computeCustomerHealth, dedupeBillingImpact } from '@/calc/customerHealth'
import { addMonths, filterExceptions, monthDiff } from '@/lib/filters'
import { money, sumMoney } from '@/lib/money'
import type { DataStore, ExceptionType, GlobalFilters } from '@/types'

export const BANDS: HealthBand[] = ['Healthy', 'Watchlist', 'At Risk', 'Critical']
const BAND_RANK: Record<HealthBand, number> = { Healthy: 0, Watchlist: 1, 'At Risk': 2, Critical: 3 }

// ---------------------------------------------------------------------------
// Portfolio health distribution
// ---------------------------------------------------------------------------

export interface BandSlice {
  band: HealthBand
  clients: number
  revenue: number
  clientShare: number
  revenueShare: number
}

export function healthDistribution(rows: Pick<WatchlistRow, 'healthBand' | 'revenue'>[]): BandSlice[] {
  const totalClients = rows.length
  const totalRevenue = sumMoney(rows.map((r) => Math.max(0, r.revenue)))
  return BANDS.map((band) => {
    const inBand = rows.filter((r) => r.healthBand === band)
    const revenue = sumMoney(inBand.map((r) => Math.max(0, r.revenue)))
    return {
      band,
      clients: inBand.length,
      revenue,
      clientShare: totalClients ? (inBand.length / totalClients) * 100 : 0,
      revenueShare: totalRevenue ? (revenue / totalRevenue) * 100 : 0,
    }
  })
}

// ---------------------------------------------------------------------------
// Risk driver distribution (a client may trigger several signals)
// ---------------------------------------------------------------------------

export type RiskDriverKey =
  | 'volume'
  | 'revenue'
  | 'delivery'
  | 'billing'
  | 'margin'
  | 'payment'

export const RISK_DRIVERS: { key: RiskDriverKey; label: string; riskType: RiskType; rule: string }[] = [
  { key: 'volume', label: 'Volume Decline', riskType: 'Volume Decline', rule: 'Shipped packages ≤ −10% YoY' },
  { key: 'revenue', label: 'Revenue Decline', riskType: 'Revenue Decline', rule: 'Net Billing ≤ −10% YoY' },
  {
    key: 'delivery',
    label: 'Delivery Deterioration',
    riskType: 'Operational Deterioration',
    rule: 'Delivery score < 55 (on-time < 88%)',
  },
  {
    key: 'billing',
    label: 'Billing Friction',
    riskType: 'Billing Exceptions',
    rule: '≥ 3 open billing cases, or billing score < 55',
  },
  {
    key: 'margin',
    label: 'Margin Compression',
    riskType: 'Margin Compression',
    rule: 'CM < 18%, or CM down ≥ 5 pts YoY',
  },
  { key: 'payment', label: 'Payment Risk', riskType: 'Collection Risk', rule: 'Balance past due as of the As-of Date' },
]

export interface RiskDriverBar {
  key: RiskDriverKey
  label: string
  rule: string
  clients: number
  revenue: number
  customerIds: string[]
}

export function riskDriverDistribution(rows: Pick<WatchlistRow, 'customerId' | 'riskTypes' | 'revenue'>[]): {
  bars: RiskDriverBar[]
  clientsWithAnySignal: number
  clientsWithMultipleSignals: number
  totalSignals: number
} {
  const bars = RISK_DRIVERS.map((d) => {
    const hit = rows.filter((r) => r.riskTypes.includes(d.riskType))
    return {
      key: d.key,
      label: d.label,
      rule: d.rule,
      clients: hit.length,
      revenue: sumMoney(hit.map((r) => Math.max(0, r.revenue))),
      customerIds: hit.map((r) => r.customerId),
    }
  })
  const signalCount = (r: (typeof rows)[number]) =>
    RISK_DRIVERS.filter((d) => r.riskTypes.includes(d.riskType)).length
  return {
    bars,
    clientsWithAnySignal: rows.filter((r) => signalCount(r) > 0).length,
    clientsWithMultipleSignals: rows.filter((r) => signalCount(r) > 1).length,
    totalSignals: bars.reduce((a, b) => a + b.clients, 0),
  }
}

export function riskTypeForDriver(key: RiskDriverKey): RiskType {
  return RISK_DRIVERS.find((d) => d.key === key)!.riskType
}

// ---------------------------------------------------------------------------
// Health migration: prior comparable window band → current band (real history, by customer ID)
// ---------------------------------------------------------------------------

export type PriorBand = HealthBand | 'No prior score'
export const PRIOR_BANDS: PriorBand[] = [...BANDS, 'No prior score']

export interface MigrationCell {
  from: PriorBand
  to: HealthBand
  clients: number
  revenue: number
  customerIds: string[]
  /** +1 worsened, −1 improved, 0 same band, null = no prior */
  direction: 1 | -1 | 0 | null
}

export interface HealthMigration {
  available: boolean
  priorLabel: string | null
  cells: MigrationCell[]
  improved: number
  worsened: number
  stable: number
  noPrior: number
  /** Clients that moved INTO At Risk / Critical from a healthier band */
  newlyAtRisk: number
  newlyAtRiskRevenue: number
}

export function computeHealthMigration(portfolio: ClientQualityPortfolio): HealthMigration {
  const rows = portfolio.watchlist
  const cells: MigrationCell[] = []
  for (const from of PRIOR_BANDS) {
    for (const to of BANDS) {
      const hit = rows.filter((r) => (r.priorHealthBand ?? 'No prior score') === from && r.healthBand === to)
      cells.push({
        from,
        to,
        clients: hit.length,
        revenue: sumMoney(hit.map((r) => Math.max(0, r.revenue))),
        customerIds: hit.map((r) => r.customerId),
        direction:
          from === 'No prior score'
            ? null
            : BAND_RANK[to] > BAND_RANK[from]
              ? 1
              : BAND_RANK[to] < BAND_RANK[from]
                ? -1
                : 0,
      })
    }
  }
  const sum = (dir: MigrationCell['direction']) =>
    cells.filter((c) => c.direction === dir).reduce((a, c) => a + c.clients, 0)
  const newly = cells.filter(
    (c) =>
      c.direction === 1 &&
      (c.to === 'At Risk' || c.to === 'Critical') &&
      (c.from === 'Healthy' || c.from === 'Watchlist'),
  )
  return {
    available: portfolio.kpis.priorComparable && portfolio.priorHealth.size > 0,
    priorLabel: portfolio.kpis.priorLabel,
    cells,
    improved: sum(-1),
    worsened: sum(1),
    stable: sum(0),
    noPrior: sum(null),
    newlyAtRisk: newly.reduce((a, c) => a + c.clients, 0),
    newlyAtRiskRevenue: sumMoney(newly.map((c) => c.revenue)),
  }
}

// ---------------------------------------------------------------------------
// Growth opportunities — verifiable value only; Target Gap is reported separately
// ---------------------------------------------------------------------------

export type OpportunityType = 'Recovery' | 'Expansion' | 'Pricing'
export type EvidenceStrength = 'High' | 'Medium' | 'Low'
export const EVIDENCE_RANK: Record<EvidenceStrength, number> = { High: 3, Medium: 2, Low: 1 }

export interface GrowthOpportunity {
  id: string
  customerId: string
  customerName: string
  type: OpportunityType
  value: number
  evidence: EvidenceStrength
  basis: string
  evidenceNote: string
  healthBand: HealthBand | null
}

/** Rate-card adherence types: billed below the contracted rate (pricing), not missing invoices (leakage) */
export const PRICING_EXCEPTION_TYPES: ReadonlySet<ExceptionType> = new Set<ExceptionType>([
  'Rate Mismatch',
  'Missing Surcharge',
])

const OPEN = new Set(['Open', 'Investigating', 'Pending Approval'])
const STAGE_EVIDENCE: Record<string, EvidenceStrength> = {
  Negotiation: 'High',
  Proposal: 'Medium',
  Qualified: 'Medium',
  Lead: 'Low',
}

export const OPPORTUNITY_DEFINITIONS: Record<OpportunityType, string> = {
  Recovery:
    'Net Billing shortfall vs the same months prior year for active clients whose revenue declined — a historical baseline the client has already delivered, not a guaranteed win-back.',
  Expansion:
    'Open pipeline opportunities on existing customers: expected monthly revenue × 3 months × stage win probability. Evidence follows the pipeline stage.',
  Pricing:
    'Open Rate Mismatch / Missing Surcharge cases: billed below the contracted rate card (deduplicated $). Recoverable once corrected and confirmed.',
}

export function computeGrowthOpportunities(
  data: DataStore,
  filters: GlobalFilters,
  profiles: CustomerRiskProfile[],
): GrowthOpportunity[] {
  const byId = new Map(profiles.map((p) => [p.customerId, p]))
  const out: GrowthOpportunity[] = []

  // Recovery — comparable YoY Net Billing shortfall
  for (const p of profiles) {
    if (p.revenueGrowth == null || p.priorRevenue <= 0) continue
    const shortfall = money(p.priorRevenue - p.revenue)
    if (shortfall <= 0) continue
    const volDown = p.volumeGrowth != null && p.volumeGrowth < 0
    const evidence: EvidenceStrength =
      p.confidence === 'Low' ? 'Low' : volDown && p.confidence === 'High' ? 'High' : 'Medium'
    out.push({
      id: `rec-${p.customerId}`,
      customerId: p.customerId,
      customerName: p.customerName,
      type: 'Recovery',
      value: shortfall,
      evidence,
      basis: `Prior-year Net Billing ${Math.round(p.priorRevenue).toLocaleString()} → ${Math.round(p.revenue).toLocaleString()}`,
      evidenceNote: `${p.revenueGrowth.toFixed(1)}% revenue YoY${p.volumeGrowth != null ? ` · packages ${p.volumeGrowth.toFixed(1)}%` : ''} · data confidence ${p.confidence}`,
      healthBand: p.healthBand,
    })
  }

  // Expansion — open pipeline on existing customers
  const scopeIds = new Set(profiles.map((p) => p.customerId))
  for (const o of data.opportunities) {
    if (!o.customer_id || o.stage === 'Closed Won' || o.stage === 'Closed Lost') continue
    if (!scopeIds.has(o.customer_id)) continue
    const value = money(o.expected_monthly_revenue * 3 * o.win_probability)
    if (value <= 0) continue
    const p = byId.get(o.customer_id)
    out.push({
      id: `exp-${o.opportunity_id}`,
      customerId: o.customer_id,
      customerName: p?.customerName ?? o.prospect_name,
      type: 'Expansion',
      value,
      evidence: STAGE_EVIDENCE[o.stage] ?? 'Low',
      basis: `${o.opportunity_id} · ${o.stage} · ${Math.round(o.win_probability * 100)}% win probability`,
      evidenceNote: `Expected ${Math.round(o.expected_monthly_revenue).toLocaleString()}/mo from ${o.expected_start_date}`,
      healthBand: p?.healthBand ?? null,
    })
  }

  // Pricing — open rate-card adherence exceptions
  const byCustCases = new Map<string, ReturnType<typeof filterExceptions>>()
  for (const e of filterExceptions(data, filters)) {
    if (!e.customer_id || !scopeIds.has(e.customer_id)) continue
    if (!OPEN.has(e.status) || !PRICING_EXCEPTION_TYPES.has(e.exception_type)) continue
    const list = byCustCases.get(e.customer_id) ?? []
    list.push(e)
    byCustCases.set(e.customer_id, list)
  }
  for (const [cid, cases] of byCustCases) {
    const value = dedupeBillingImpact(cases)
    if (value <= 0) continue
    const p = byId.get(cid)
    out.push({
      id: `prc-${cid}`,
      customerId: cid,
      customerName: p?.customerName ?? cid,
      type: 'Pricing',
      value,
      evidence: cases.length >= 3 ? 'High' : 'Medium',
      basis: `${cases.length} open rate-card case${cases.length === 1 ? '' : 's'}`,
      evidenceNote: [...new Set(cases.map((c) => c.exception_type))].join(' · '),
      healthBand: p?.healthBand ?? null,
    })
  }

  // Rank by verifiable value weighted by evidence strength, then raw value
  return out.sort(
    (a, b) =>
      b.value * EVIDENCE_RANK[b.evidence] - a.value * EVIDENCE_RANK[a.evidence] || b.value - a.value,
  )
}

export function opportunityTypeTotals(opps: GrowthOpportunity[]) {
  return (['Recovery', 'Expansion', 'Pricing'] as OpportunityType[]).map((type) => {
    const xs = opps.filter((o) => o.type === type)
    return {
      type,
      count: xs.length,
      value: sumMoney(xs.map((o) => o.value)),
      highEvidenceValue: sumMoney(xs.filter((o) => o.evidence === 'High').map((o) => o.value)),
    }
  })
}

// ---------------------------------------------------------------------------
// Client 360 — rolling Health Score trend (same model, real history)
// ---------------------------------------------------------------------------

export interface HealthTrendPoint {
  period: string
  /** Window covered by this point, e.g. 2026-04 → 2026-06 */
  windowLabel: string
  score: number
  band: HealthBand
  /** Share of score weight backed by observed evidence (100 = complete) */
  coverage: number
  provisional: boolean
}

/**
 * Health Score recomputed for rolling windows of the same length as the selected window,
 * each ending one month apart. Points where a component lacked evidence are flagged provisional.
 */
export function customerHealthTrend(
  data: DataStore,
  filters: GlobalFilters,
  customerId: string,
  weights: Parameters<typeof computeCustomerHealth>[2],
  points = 9,
): HealthTrendPoint[] {
  const len = monthDiff(filters.startPeriod, filters.endPeriod) + 1
  const first = data.dates[0]?.date_key.slice(0, 7) ?? filters.startPeriod
  const out: HealthTrendPoint[] = []
  for (let i = points - 1; i >= 0; i--) {
    const end = addMonths(filters.endPeriod, -i)
    const start = addMonths(end, -(len - 1))
    if (start < first) continue
    const row = computeCustomerHealth(data, { ...filters, startPeriod: start, endPeriod: end, customerIds: [customerId] }, weights)[0]
    if (!row || (row.revenue === 0 && row.volume === 0)) continue
    out.push({
      period: end,
      windowLabel: len > 1 ? `${start} → ${end}` : end,
      score: row.healthScore,
      band: row.healthBand,
      coverage: row.inputs.scoreCoverage,
      provisional: row.inputs.scoreCoverage < 100,
    })
  }
  return out
}
