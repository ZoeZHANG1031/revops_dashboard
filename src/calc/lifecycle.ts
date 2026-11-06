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
