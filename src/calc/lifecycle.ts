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

  const winLossBySegment = (['Enterprise', 'Mid-Market', 'SMB'] as const).map((segment) => {
    const won = closedWon.filter((o) => {
      const c = data.customers.find((x) => x.customer_id === o.customer_id)
      return c?.segment === segment
    })
    const lost = closedLost.filter((o) => {
      const c = data.customers.find((x) => x.customer_id === o.customer_id)
      return c?.segment === segment
    })
    const n = won.length + lost.length
    return {
      segment,
      winRate: n ? pct(won.length, n) : null,
      won: won.length,
      lost: lost.length,
      avgDeal: won.length ? money(sumMoney(won.map((o) => o.opportunity_value)) / won.length) : null,
    }
  })

  return {
    pipelineValue,
    weightedPipeline,
    winRate,
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
    note: 'Stage chart shows current stock by stage (independent counts). It is not a cascading conversion funnel — later stages can hold larger deals. Opportunity value ≠ recognized revenue.',
  }
}

export function computeOperationalPipeline(data: DataStore, filters: GlobalFilters) {
  // Distinct customers with an active contract (contracts have several versions over time)
  const contracted = new Set(data.contracts.filter((c) => c.status === 'Active').map((c) => c.customer_id)).size
  const activeCustomers = new Set(
    filterShipments(data, filters).map((s) => s.customer_id),
  ).size
  const shipments = filterShipments(data, filters)
  const billable = shipments.filter((s) => s.billable)
  const lines = filterBillingLines(data, filters)
  const ratedCharges = sumMoney(
    lines.map((l) => l.base_charge + l.fuel_surcharge + l.remote_surcharge),
  )
  const netBilling = sumMoney(lines.map((l) => l.net_amount))
  const recognized = computeRecognizedRevenue(data, filters).amount

  const stages = [
    { key: 'contracted', label: 'Contracted Customers', value: contracted, unit: 'count' as const },
    { key: 'active', label: 'Active Customers', value: activeCustomers, unit: 'count' as const },
    { key: 'shipments', label: 'Shipment Volume (packages)', value: pkgs(shipments), unit: 'count' as const },
    { key: 'billable', label: 'Billable Packages', value: pkgs(billable), unit: 'count' as const },
    { key: 'rated', label: 'Rated Charges', value: ratedCharges, unit: 'money' as const },
    { key: 'net', label: 'Net Billing', value: netBilling, unit: 'money' as const },
    { key: 'recognized', label: 'Recognized Revenue', value: recognized, unit: 'money' as const },
  ]

  const conversions = [
    {
      from: 'Contracted → Active',
      rate: pct(activeCustomers, contracted),
      leakage: 'Inactive contracted accounts / not yet shipping',
    },
    {
      from: 'Shipments → Billable',
      rate: pct(pkgs(billable), pkgs(shipments)),
      leakage: 'Failed deliveries under non-billable rules',
    },
    {
      from: 'Billable → Billed Packages',
      rate: pct(pkgs(lines), pkgs(billable)),
      leakage: 'Missing billing / rating failures',
    },
    {
      from: 'Rated → Net Billing',
      rate: pct(netBilling, ratedCharges),
      leakage: 'Discounts, credits, surcharge omissions',
    },
    {
      from: 'Net Billing → Recognized',
      rate: pct(recognized, netBilling),
      leakage: 'Timing differences, accruals, credit memos',
    },
  ]

  return { stages, conversions }
}
