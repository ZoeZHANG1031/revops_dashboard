import { filterBillingLines, filterShipments } from '@/lib/filters'
import { pkgs } from '@/lib/pricing'
import { money, pct, sumMoney } from '@/lib/money'
import type { DataStore, GlobalFilters } from '@/types'
import { computeRecognizedRevenue } from './recognizedRevenue'

export function computeSalesPipeline(data: DataStore) {
  const open = data.opportunities.filter((o) => !o.stage.startsWith('Closed'))
  const closedWon = data.opportunities.filter((o) => o.stage === 'Closed Won')
  const closedLost = data.opportunities.filter((o) => o.stage === 'Closed Lost')
  const closed = [...closedWon, ...closedLost]

  const pipelineValue = sumMoney(open.map((o) => o.opportunity_value))
  const weightedPipeline = sumMoney(
    open.map((o) => money(o.opportunity_value * o.win_probability)),
  )
  const winRate = closed.length ? pct(closedWon.length, closed.length) : null
  const cycles = closedWon.map((o) => o.sales_cycle_days ?? 0).filter((d) => d > 0)
  const salesCycleLength = cycles.length
    ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length)
    : null

  const stages = ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'] as const
  /** Stage stock snapshot — NOT a cascading conversion funnel. Amounts need not decrease. */
  const stageStock = stages.map((stage) => ({
    stage,
    count: data.opportunities.filter((o) => o.stage === stage).length,
    value: sumMoney(
      data.opportunities.filter((o) => o.stage === stage).map((o) => o.opportunity_value),
    ),
    weighted: sumMoney(
      data.opportunities
        .filter((o) => o.stage === stage)
        .map((o) => money(o.opportunity_value * o.win_probability)),
    ),
  }))

  const openStages = ['Lead', 'Qualified', 'Proposal', 'Negotiation'] as const
  const conversionHints = openStages.slice(0, -1).map((stage, i) => {
    const next = openStages[i + 1]
    const from = stageStock.find((s) => s.stage === stage)!.count
    const to = stageStock.find((s) => s.stage === next)!.count
    return {
      from: stage,
      to: next,
      /** Stock ratio only — not cohort conversion; labeled as such in UI */
      stockRatio: from === 0 ? null : pct(to, from),
    }
  })

  // Stage aging from stage events when available; else sales_cycle_days / stages heuristic
  const asOf = data.meta.generated_at?.slice(0, 10) ?? '2026-10-31'
  const stageAging = openStages.map((stage) => {
    const opps = open.filter((o) => o.stage === stage)
    const days = opps.map((o) => {
      const ev = data.opportunityStageEvents
        ?.filter((e) => e.opportunity_id === o.opportunity_id && e.to_stage === stage)
        .sort((a, b) => b.event_date.localeCompare(a.event_date))[0]
      const start = ev?.event_date ?? o.created_date
      const t0 = Date.parse(start)
      const t1 = Date.parse(asOf)
      return Number.isFinite(t0) && Number.isFinite(t1)
        ? Math.max(0, Math.round((t1 - t0) / 86400000))
        : o.sales_cycle_days ?? 0
    })
    const sorted = [...days].sort((a, b) => a - b)
    const avg = days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null
    const median = sorted.length
      ? sorted.length % 2
        ? sorted[Math.floor(sorted.length / 2)]
        : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
      : null
    const stalled = days.filter((d) => d >= 45).length
    return { stage, count: opps.length, avgDays: avg, medianDays: median, stalledCount: stalled }
  })

  const pastDueClose = open.filter((o) => o.expected_start_date && o.expected_start_date < asOf).length

  // Pipeline coverage vs remaining quarterly bookings target (synthetic: 1.2× last-quarter Closed Won TCV)
  const recentWonTcv = sumMoney(
    closedWon
      .filter((o) => (o.closed_date ?? '').slice(0, 7) >= '2026-07')
      .map((o) => o.opportunity_value),
  )
  const remainingSalesTarget = money(Math.max(recentWonTcv * 0.35, weightedPipeline * 0.25, 1))
  const pipelineCoverage = pct(weightedPipeline, remainingSalesTarget)

  const segmentOf = (o: (typeof data.opportunities)[0]): string => {
    if (!o.customer_id) return 'Unassigned (no customer)'
    const c = data.customers.find((x) => x.customer_id === o.customer_id)
    return c?.segment ?? 'Unassigned (no customer)'
  }
  const segmentKeys = ['Enterprise', 'Mid-Market', 'SMB', 'Unassigned (no customer)'] as const
  const winLossBySegment = segmentKeys.map((segment) => {
    const won = closedWon.filter((o) => segmentOf(o) === segment)
    const lost = closedLost.filter((o) => segmentOf(o) === segment)
    const n = won.length + lost.length
    return {
      segment,
      winRate: n ? pct(won.length, n) : null,
      won: won.length,
      lost: lost.length,
      avgDeal: won.length ? money(sumMoney(won.map((o) => o.opportunity_value)) / won.length) : null,
    }
  })
  const segmentClosed = winLossBySegment.reduce((a, r) => a + r.won + r.lost, 0)

  return {
    pipelineValue,
    weightedPipeline,
    winRate,
    /** Closed Deal Win Rate = Closed Won / (Closed Won + Closed Lost) */
    closedDealWinRate: winRate,
    closedWonCount: closedWon.length,
    closedLostCount: closedLost.length,
    salesCycleLength,
    newCustomerAcquisition: closedWon.length,
    expectedMonthlyVolume: sumMoney(open.map((o) => o.expected_monthly_volume)),
    expectedMonthlyRevenue: sumMoney(open.map((o) => o.expected_monthly_revenue)),
    funnel: stageStock,
    stageStock,
    conversionHints,
    stageAging,
    pastDueClose,
    remainingSalesTarget,
    pipelineCoverage,
    pipelineCoverageNote:
      'Coverage = Weighted Open Pipeline ÷ synthetic remaining target (35% of recent Closed-Won TCV floor). Not a CRM quota system.',
    winLossBySegment,
    segmentRollupNote:
      segmentClosed === closed.length
        ? 'Segment win rates use the same Closed Won+Lost set as Overall (including Unassigned).'
        : `Segment table covers ${segmentClosed}/${closed.length} closed deals — investigate mapping gaps.`,
    note: 'Stage chart shows current stock by stage (independent counts). It is not a cascading conversion funnel — later stages can hold larger deals. Opportunity value ≠ recognized revenue. TCV ≠ period Recognized Revenue.',
  }
}

export function computeOperationalPipeline(data: DataStore, filters: GlobalFilters) {
  // Scope Active contracts to the same customer filter as shipments (apples-to-apples)
  const contractedIds = new Set(
    data.contracts
      .filter((c) => c.status === 'Active')
      .filter((c) => !filters.customerIds.length || filters.customerIds.includes(c.customer_id))
      .map((c) => c.customer_id),
  )
  const contracted = contractedIds.size
  const shipments = filterShipments(data, filters)
  const activeCustomers = new Set(shipments.map((s) => s.customer_id)).size
  const billable = shipments.filter((s) => s.billable)
  const lines = filterBillingLines(data, filters)
  const ratedCharges = sumMoney(
    lines.map((l) => l.base_charge + l.fuel_surcharge + l.remote_surcharge),
  )
  const netBilling = sumMoney(lines.map((l) => l.net_amount))
  const recognized = computeRecognizedRevenue(data, filters).amount

  const stages = [
    {
      key: 'contracted',
      label: 'Contracted Customers',
      value: contracted,
      unit: 'count' as const,
      dateBasis: 'Contract status = Active (customer-filtered)',
    },
    {
      key: 'active',
      label: 'Active Customers',
      value: activeCustomers,
      unit: 'count' as const,
      dateBasis: 'Shipments with ship_date in filter',
    },
    {
      key: 'shipments',
      label: 'Shipment Volume (packages)',
      value: pkgs(shipments),
      unit: 'count' as const,
      dateBasis: 'ship_date',
    },
    {
      key: 'billable',
      label: 'Billable Packages',
      value: pkgs(billable),
      unit: 'count' as const,
      dateBasis: 'ship_date · billable flag',
    },
    {
      key: 'rated',
      label: 'Gross Rated Charges',
      value: ratedCharges,
      unit: 'money' as const,
      dateBasis: 'billing_period (line gross before discount)',
    },
    {
      key: 'net',
      label: 'Net Billing',
      value: netBilling,
      unit: 'money' as const,
      dateBasis: 'billing_period',
    },
    {
      key: 'recognized',
      label: 'Recognized Revenue',
      value: recognized,
      unit: 'money' as const,
      dateBasis: 'accounting_period (recognition)',
    },
  ]

  /** Same-unit ratios only. Money→money rows are yield / timing ratios — NOT conversion rates. */
  const conversions = [
    {
      from: 'Contracted → Active',
      rate: pct(activeCustomers, contracted),
      kind: 'count_ratio' as const,
      leakage: 'Inactive contracted accounts / not yet shipping in window',
      numerator: activeCustomers,
      denominator: contracted,
    },
    {
      from: 'Shipments → Billable',
      rate: pct(pkgs(billable), pkgs(shipments)),
      kind: 'count_ratio' as const,
      leakage: 'Failed deliveries under non-billable rules',
      numerator: pkgs(billable),
      denominator: pkgs(shipments),
    },
    {
      from: 'Billable packages vs Billed line packages',
      rate: pct(pkgs(lines), pkgs(billable)),
      kind: 'count_ratio' as const,
      leakage:
        'Cross-period billing / missing billing — ship_date vs billing_period may differ; not a pure funnel conversion',
      numerator: pkgs(lines),
      denominator: pkgs(billable),
    },
    {
      from: 'Net Billing ÷ Gross Rated (yield)',
      rate: pct(netBilling, ratedCharges),
      kind: 'yield_ratio' as const,
      leakage: 'Discounts + credits (not a stage conversion)',
      numerator: netBilling,
      denominator: ratedCharges,
    },
    {
      from: 'Recognized ÷ Net Billing (timing ratio)',
      rate: pct(recognized, netBilling),
      kind: 'timing_ratio' as const,
      leakage:
        'Different date bases (billing_period vs accounting_period). Can exceed 100% with accruals / prior-period release — use Lifecycle Bridge, not conversion %.',
      numerator: recognized,
      denominator: netBilling,
    },
  ]

  return {
    stages,
    conversions,
    dateBasisNote:
      'Operational: ship_date · Commercial billing: billing_period · Accounting: accounting_period. Do not treat Net Billing → Recognized as a conversion funnel.',
  }
}
