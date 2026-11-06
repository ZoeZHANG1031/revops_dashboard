import { MONTHLY_FIXED_OPEX_POOL_BASE, MONTHLY_FIXED_OPEX_POOL_DOWNSIDE } from '@/data/generate'
import { filterBillingLines, filterCosts, filterShipments } from '@/lib/filters'
import { pkgs } from '@/lib/pricing'
import { money, pct, sumMoney } from '@/lib/money'
import type { DataStore, GlobalFilters, RegionCode, ServiceType } from '@/types'

export interface UnitEconomicsSummary {
  netRevenue: number
  billablePackages: number
  revenuePerPackage: number | null
  variableCostPerPackage: number | null
  contributionProfit: number
  contributionMargin: number | null
  allocatedFixed: number
  operatingProfit: number
  /** Explains why CM can be healthy while OP is negative for some slices */
  fixedAllocation: {
    basis: string
    poolNote: string
    allocatedFixed: number
    contributionCoversFixed: boolean
  }
  costBreakdown: Array<{ type: string; amount: number; perPackage: number | null }>
  byDimension: Array<{
    key: string
    label: string
    revenue: number
    variableCost: number
    packages: number
    rpp: number | null
    cpp: number | null
    margin: number | null
  }>
  marginBridge: Array<{ key: string; label: string; amount: number }>
  volumeProfitParadox: {
    volumeChangePct: number | null
    contributionProfitChangePct: number | null
    operatingProfitChangePct: number | null
    /** Dynamic title based on contribution profit direction */
    title: string
    explanation: string[]
  }
  profitBridge: Array<{ key: string; label: string; amount: number }>
  fixedAllocationDetail: {
    poolMonthly: number
    poolInWindow: number
    basis: string
    scenario: 'Base' | 'Downside'
  }
  unitCosts: {
    costPerDelivered: number | null
    costPerBillable: number | null
    dspPerPackage: number | null
    claimsPerThousand: number | null
    failedIncrementalCost: number
  }
}

const VARIABLE = new Set([
  'DSP Delivery',
  'Sorting',
  'Linehaul',
  'Redelivery',
  'Claims',
  'Other Variable',
])

export function computeUnitEconomics(
  data: DataStore,
  filters: GlobalFilters,
  dimension: UnitEconDimension = 'customer',
  fixedScenario: 'Base' | 'Downside' = 'Base',
): UnitEconomicsSummary {
  const lines = filterBillingLines(data, filters)
  const costs = filterCosts(data, filters)
  const shipments = filterShipments(data, filters).filter((s) => s.billable)

  const netRevenue = sumMoney(lines.map((l) => l.net_amount))
  const billablePackages = pkgs(lines)
  const variableCosts = costs.filter((c) => VARIABLE.has(c.cost_type))
  const totalVariable = sumMoney(variableCosts.map((c) => c.amount))
  const allocatedFixedBase = sumMoney(
    costs.filter((c) => c.cost_type === 'Allocated Fixed').map((c) => c.amount),
  )
  // Downside: scale stored Base allocations by downside/base pool ratio (same volume shares)
  const poolScale =
    fixedScenario === 'Downside'
      ? MONTHLY_FIXED_OPEX_POOL_DOWNSIDE / MONTHLY_FIXED_OPEX_POOL_BASE
      : 1
  const allocatedFixed = money(allocatedFixedBase * poolScale)
  const contributionProfit = money(netRevenue - totalVariable)
  const contributionMargin = pct(contributionProfit, netRevenue)
  const operatingProfit = money(contributionProfit - allocatedFixed)
  const revenuePerPackage = billablePackages ? money(netRevenue / billablePackages) : null
  const variableCostPerPackage = billablePackages ? money(totalVariable / billablePackages) : null

  const costTypes = [
    'DSP Delivery',
    'Sorting',
    'Linehaul',
    'Redelivery',
    'Claims',
    'Other Variable',
    'Allocated Fixed',
  ]
  const costBreakdown = costTypes.map((type) => {
    const amount = sumMoney(costs.filter((c) => c.cost_type === type).map((c) => c.amount))
    return {
      type,
      amount,
      perPackage: billablePackages ? money(amount / billablePackages) : null,
    }
  })

  const byDimension = buildDimension(data, filters, dimension, lines, costs)

  // Margin variance bridge vs prior half of window
  const periods = [
    ...new Set(lines.map((l) => l.accounting_period)),
  ].sort()
  // Equal-length halves (middle month dropped when the window is odd) so volume effects compare like with like
  const half = Math.floor(periods.length / 2)
  const earlyPeriods = periods.slice(0, half)
  const latePeriods = periods.slice(periods.length - half)
  const earlyLines = lines.filter((l) => earlyPeriods.includes(l.accounting_period))
  const lateLines = lines.filter((l) => latePeriods.includes(l.accounting_period))
  const earlyRev = sumMoney(earlyLines.map((l) => l.net_amount))
  const lateRev = sumMoney(lateLines.map((l) => l.net_amount))
  const earlyVar = sumMoney(
    variableCosts.filter((c) => earlyPeriods.includes(c.accounting_period)).map((c) => c.amount),
  )
  const lateVar = sumMoney(
    variableCosts.filter((c) => latePeriods.includes(c.accounting_period)).map((c) => c.amount),
  )
  const earlyProfit = money(earlyRev - earlyVar)
  const lateProfit = money(lateRev - lateVar)
  const earlyVol = pkgs(earlyLines) || 1
  const lateVol = pkgs(lateLines) || 1
  const earlyRpp = earlyRev / earlyVol
  const lateRpp = lateRev / lateVol
  const earlyCpp = earlyVar / earlyVol
  const lateCpp = lateVar / lateVol

  const priceEffect = money((lateRpp - earlyRpp) * lateVol)
  const costEffect = money(-(lateCpp - earlyCpp) * lateVol)
  const volumeEffect = money((lateVol - earlyVol) * (earlyRpp - earlyCpp))
  const plug = money(lateProfit - earlyProfit - priceEffect - costEffect - volumeEffect)

  const marginBridge = [
    { key: 'start', label: 'Early-Period Contribution', amount: earlyProfit },
    { key: 'volume', label: 'Volume Effect', amount: volumeEffect },
    { key: 'price', label: 'Price / RPP Effect', amount: priceEffect },
    { key: 'cost', label: 'Cost / CPP Effect', amount: costEffect },
    { key: 'other', label: 'Other / Mix', amount: plug },
    { key: 'end', label: 'Late-Period Contribution', amount: lateProfit },
  ]

  const volumeChangePct =
    earlyVol <= 1 ? null : money(((lateVol - earlyVol) / earlyVol) * 100)
  const contributionProfitChangePct =
    earlyProfit === 0 ? null : money(((lateProfit - earlyProfit) / Math.abs(earlyProfit)) * 100)

  const earlyFixed = sumMoney(
    costs
      .filter((c) => c.cost_type === 'Allocated Fixed' && earlyPeriods.includes(c.accounting_period))
      .map((c) => c.amount),
  ) * poolScale
  const lateFixed = sumMoney(
    costs
      .filter((c) => c.cost_type === 'Allocated Fixed' && latePeriods.includes(c.accounting_period))
      .map((c) => c.amount),
  ) * poolScale
  const earlyOp = money(earlyProfit - earlyFixed)
  const lateOp = money(lateProfit - lateFixed)
  const operatingProfitChangePct =
    earlyOp === 0 ? null : money(((lateOp - earlyOp) / Math.abs(earlyOp)) * 100)
  const fixedCostChange = money(-(lateFixed - earlyFixed))

  const profitBridge = [
    { key: 'start', label: 'Starting Contribution Profit', amount: earlyProfit },
    { key: 'volume', label: 'Volume Effect', amount: volumeEffect },
    { key: 'rpp', label: 'Revenue per Package Effect', amount: priceEffect },
    { key: 'cpp', label: 'Variable Cost per Package Effect', amount: costEffect },
    // Plug = late − early − (volume + RPP + CPP effects); not separately measured, so labelled residual
    { key: 'mix', label: 'Mix & Unexplained Residual', amount: plug },
    { key: 'end_contrib', label: 'Ending Contribution Profit', amount: lateProfit },
    { key: 'fixed', label: 'Fixed Cost Change (signed to OP)', amount: fixedCostChange },
    { key: 'end_op', label: 'Ending Operating Profit', amount: lateOp },
  ]

  let title = 'Volume & Profit Movement'
  if (volumeChangePct != null && contributionProfitChangePct != null) {
    const vUp = volumeChangePct > 1
    const vDown = volumeChangePct < -1
    const pUp = contributionProfitChangePct > 1
    const pDown = contributionProfitChangePct < -1
    if (vUp && pDown) title = 'Volume Up, Contribution Profit Down'
    else if (vUp && pUp) title = 'Volume Up, Contribution Profit Up'
    else if (vDown && pDown) title = 'Volume Down, Contribution Profit Down'
    else if (vDown && pUp) title = 'Volume Down, Contribution Profit Up'
  }

  const explanation: string[] = []
  if (volumeChangePct != null && contributionProfitChangePct != null && volumeChangePct > 0 && contributionProfitChangePct < 0) {
    explanation.push('Volume grew while contribution profit declined — classic volume/profit paradox.')
    if (priceEffect < 0) explanation.push(`Price/RPP declined (impact ${priceEffect}).`)
    if (costEffect < 0) explanation.push(`Variable cost per package rose (impact ${costEffect}).`)
  } else if (volumeChangePct != null && contributionProfitChangePct != null) {
    explanation.push(
      `Contribution profit change ${contributionProfitChangePct}% with volume change ${volumeChangePct}%. Do not equate this with Operating Profit (after fixed absorption).`,
    )
  } else {
    explanation.push('Insufficient period span to diagnose volume/profit dynamics.')
  }
  if (operatingProfitChangePct != null) {
    explanation.push(`Operating profit change (after allocated fixed): ${operatingProfitChangePct}%.`)
  }

  const deliveredCount = pkgs(filterShipments(data, filters).filter((s) => s.delivery_status === 'Delivered'))
  const dspAmt = costBreakdown.find((c) => c.type === 'DSP Delivery')?.amount ?? 0
  const claimsAmt = costBreakdown.find((c) => c.type === 'Claims')?.amount ?? 0
  const redeliveryAmt = costBreakdown.find((c) => c.type === 'Redelivery')?.amount ?? 0
  const poolMonthly =
    fixedScenario === 'Downside' ? MONTHLY_FIXED_OPEX_POOL_DOWNSIDE : MONTHLY_FIXED_OPEX_POOL_BASE
  const periodCount = Math.max(1, periods.length)

  return {
    netRevenue,
    billablePackages,
    revenuePerPackage,
    variableCostPerPackage,
    contributionProfit,
    contributionMargin,
    allocatedFixed,
    operatingProfit,
    fixedAllocation: {
      basis: data.meta.fixed_opex_basis,
      poolNote: `Base pool $${MONTHLY_FIXED_OPEX_POOL_BASE}/mo; Downside stress $${MONTHLY_FIXED_OPEX_POOL_DOWNSIDE}/mo (underutilization). Shares use company volume denominator — filtering a customer does not assign 100% of company pool to that customer.`,
      allocatedFixed,
      contributionCoversFixed: contributionProfit >= allocatedFixed,
    },
    costBreakdown: costBreakdown.map((c) =>
      c.type === 'Allocated Fixed' ? { ...c, amount: allocatedFixed, perPackage: billablePackages ? money(allocatedFixed / billablePackages) : null } : c,
    ),
    byDimension,
    marginBridge,
    volumeProfitParadox: {
      volumeChangePct,
      contributionProfitChangePct,
      operatingProfitChangePct,
      title,
      explanation,
    },
    profitBridge,
    fixedAllocationDetail: {
      poolMonthly,
      poolInWindow: money(
        filters.customerIds.length || filters.regions.length || filters.serviceTypes.length
          ? allocatedFixed
          : poolMonthly * periodCount,
      ),
      basis: data.meta.fixed_opex_basis,
      scenario: fixedScenario,
    },
    unitCosts: {
      costPerDelivered: deliveredCount ? money(totalVariable / deliveredCount) : null,
      costPerBillable: billablePackages ? money(totalVariable / billablePackages) : null,
      dspPerPackage: billablePackages ? money(dspAmt / billablePackages) : null,
      claimsPerThousand: billablePackages
        ? money((claimsAmt / billablePackages) * 1000)
        : null,
      failedIncrementalCost: money(redeliveryAmt + claimsAmt),
    },
  }
}

function buildDimension(
  data: DataStore,
  filters: GlobalFilters,
  dimension: UnitEconDimension,
  lines: ReturnType<typeof filterBillingLines>,
  costs: ReturnType<typeof filterCosts>,
) {
  const map = new Map<string, { revenue: number; variableCost: number; packages: number; label: string }>()
  const needShip = dimension === 'zone' || dimension === 'dsp' || dimension === 'metro'
  const shipById = needShip ? new Map(data.shipments.map((x) => [x.shipment_id, x])) : null
  const custName = dimension === 'customer' ? new Map(data.customers.map((c) => [c.customer_id, c.customer_name])) : null

  lines.forEach((l) => {
    let key = ''
    let label = ''
    if (dimension === 'customer') {
      key = l.customer_id
      label = custName!.get(key) ?? key
    } else if (dimension === 'metro') {
      key = shipById!.get(l.shipment_id)?.metro ?? 'NA'
      label = key
    } else if (dimension === 'region') {
      key = l.region
      label = l.region
    } else if (dimension === 'service') {
      key = l.service_type
      label = l.service_type
    } else if (dimension === 'month') {
      key = l.accounting_period
      label = l.accounting_period
    } else if (dimension === 'zone') {
      const s = shipById!.get(l.shipment_id)
      key = String(s?.zone ?? 'NA')
      label = `Zone ${key}`
    } else {
      const s = shipById!.get(l.shipment_id)
      key = s?.dsp_id ?? 'NA'
      label = key
    }
    const cur = map.get(key) ?? { revenue: 0, variableCost: 0, packages: 0, label }
    cur.revenue += l.net_amount
    cur.packages += l.package_count
    map.set(key, cur)
  })

  costs
    .filter((c) => VARIABLE.has(c.cost_type))
    .forEach((c) => {
      let key = ''
      if (dimension === 'customer') key = c.customer_id ?? 'NA'
      else if (dimension === 'region') key = c.region
      else if (dimension === 'service') key = c.service_type ?? 'NA'
      else if (dimension === 'month') key = c.accounting_period
      else if (dimension === 'dsp') key = c.dsp_id ?? 'NA'
      else if (dimension === 'zone') {
        // Attribute via shipment join (previously keyed 'NA' → zone CPP was always 0)
        const z = c.shipment_id ? shipById!.get(c.shipment_id)?.zone : undefined
        key = z != null ? String(z) : 'NA'
      } else if (dimension === 'metro') {
        key = (c.shipment_id ? shipById!.get(c.shipment_id)?.metro : undefined) ?? 'NA'
      } else key = 'NA'
      const cur = map.get(key)
      if (cur) cur.variableCost += c.amount
    })

  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      revenue: money(v.revenue),
      variableCost: money(v.variableCost),
      packages: v.packages,
      rpp: v.packages ? money(v.revenue / v.packages) : null,
      cpp: v.packages ? money(v.variableCost / v.packages) : null,
      margin: pct(v.revenue - v.variableCost, v.revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

export const VARIABLE_COST_TYPES = [
  'DSP Delivery',
  'Sorting',
  'Linehaul',
  'Claims',
  'Redelivery',
  'Other Variable',
] as const
export type VariableCostType = (typeof VARIABLE_COST_TYPES)[number]

export interface CostDriverRow {
  key: string
  label: string
  packages: number
  revenue: number
  rpp: number | null
  /** Variable cost per billed package by cost type */
  perPackage: Record<VariableCostType, number | null>
  totalCostPerPackage: number | null
  contributionPerPackage: number | null
  contributionMargin: number | null
}

/**
 * Cost per billed package by cost type for a dimension. Packages = billed lines in the key;
 * costs attributed via cost.customer_id / service_type / dsp_id, or shipment join for metro.
 */
export function computeCostDrivers(
  data: DataStore,
  filters: GlobalFilters,
  dimension: 'service' | 'metro' | 'customer' | 'dsp' | 'company',
): CostDriverRow[] {
  const lines = filterBillingLines(data, filters)
  const costs = filterCosts(data, filters)
  const shipById =
    dimension === 'metro' || dimension === 'dsp' ? new Map(data.shipments.map((x) => [x.shipment_id, x])) : null
  const custName = new Map(data.customers.map((c) => [c.customer_id, c.customer_name]))
  const lineKey = (l: (typeof lines)[number]): string =>
    dimension === 'company'
      ? 'ALL'
      : dimension === 'service'
        ? l.service_type
        : dimension === 'customer'
          ? l.customer_id
          : dimension === 'metro'
            ? (shipById!.get(l.shipment_id)?.metro ?? 'NA')
            : (shipById!.get(l.shipment_id)?.dsp_id ?? 'NA')
  const costKey = (c: (typeof costs)[number]): string =>
    dimension === 'company'
      ? 'ALL'
      : dimension === 'service'
        ? (c.service_type ?? 'NA')
        : dimension === 'customer'
          ? (c.customer_id ?? 'NA')
          : dimension === 'metro'
            ? ((c.shipment_id ? shipById!.get(c.shipment_id)?.metro : null) ?? 'NA')
            : (c.dsp_id ?? 'NA')

  const agg = new Map<string, { packages: number; revenue: number; cost: Record<string, number> }>()
  for (const l of lines) {
    const k = lineKey(l)
    let cur = agg.get(k)
    if (!cur) {
      cur = { packages: 0, revenue: 0, cost: {} }
      agg.set(k, cur)
    }
    cur.packages += l.package_count
    cur.revenue += l.net_amount
  }
  for (const c of costs) {
    if (!VARIABLE.has(c.cost_type)) continue
    const cur = agg.get(costKey(c))
    if (!cur) continue
    cur.cost[c.cost_type] = (cur.cost[c.cost_type] ?? 0) + c.amount
  }
  return [...agg.entries()]
    .filter(([k, v]) => k !== 'NA' && v.packages > 0)
    .map(([key, v]) => {
      const perPackage = Object.fromEntries(
        VARIABLE_COST_TYPES.map((t) => [t, v.packages ? money((v.cost[t] ?? 0) / v.packages) : null]),
      ) as Record<VariableCostType, number | null>
      const totalCost = VARIABLE_COST_TYPES.reduce((a, t) => a + (v.cost[t] ?? 0), 0)
      const rpp = v.packages ? money(v.revenue / v.packages) : null
      const tcpp = v.packages ? money(totalCost / v.packages) : null
      return {
        key,
        label: dimension === 'customer' ? (custName.get(key) ?? key) : dimension === 'company' ? 'Company' : key,
        packages: v.packages,
        revenue: money(v.revenue),
        rpp,
        perPackage,
        totalCostPerPackage: tcpp,
        contributionPerPackage: rpp != null && tcpp != null ? money(rpp - tcpp) : null,
        contributionMargin: pct(v.revenue - totalCost, v.revenue),
      }
    })
    .sort((a, b) => b.revenue - a.revenue)
}

export type UnitEconDimension = 'customer' | 'region' | 'metro' | 'service' | 'month' | 'dsp' | 'zone'

export type { RegionCode, ServiceType }
