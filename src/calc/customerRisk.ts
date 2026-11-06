import { filterBillingLines, filterCosts, filterExceptions, filterInvoices, filterShipments } from '@/lib/filters'
import { money, sumMoney } from '@/lib/money'
import type { DataStore, GlobalFilters } from '@/types'
import type { CustomerHealthRow, HealthBand } from '@/calc/customerHealth'
import { computeCustomerContractHealth } from '@/calc/customerContractHealth'
import { RECOVERABLE_EXCEPTION_TYPES } from '@/calc/exceptionRegistry'

export type RiskType =
  | 'Revenue Decline'
  | 'Volume Decline'
  | 'Margin Compression'
  | 'Operational Deterioration'
  | 'Billing Disputes'
  | 'Collection Risk'
  | 'Contract Renewal Risk'
  | 'Engagement Risk'

export interface CustomerRiskExtras {
  asOf?: string
  volumeGrowth?: number | null
  engagementScore?: number | null
  recoverableBilling?: number
}

export interface CustomerRiskProfile extends CustomerHealthRow {
  riskTypes: RiskType[]
  openAr: number
  overdueAr: number
  contributionProfit: number
  volumeGrowth: number | null
  commitmentUtilization: number | null
  daysUntilRenewal: number | null
  industry: string
  financialExposure: {
    currentRevenue: number
    scenarioRaR: number
    recoverableBilling: number
    contributionAtRisk: number
  }
}

export interface PortfolioRiskKpis {
  atRiskCustomers: number
  /** Sum of current-period revenue for At Risk + Critical bands — NOT scenario RaR */
  revenueFromAtRisk: number
  contributionProfitAtRisk: number
  decliningVolumeCount: number
  marginCompressionCount: number
  contractsExpiring90d: number
  /** Scenario-weighted exposure (distinct from revenueFromAtRisk) */
  scenarioRevenueAtRiskTotal: number
}

const VARIABLE = new Set([
  'DSP Delivery',
  'Sorting',
  'Linehaul',
  'Redelivery',
  'Claims',
  'Other Variable',
])

function paidByInvoice(data: DataStore): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of data.payments) {
    m.set(p.invoice_id, (m.get(p.invoice_id) ?? 0) + p.amount)
  }
  return m
}

function arBalances(data: DataStore, customerId: string, filters: GlobalFilters) {
  const invoices = filterInvoices(data, { ...filters, customerIds: [customerId] })
  const paid = paidByInvoice(data)
  const openAr = sumMoney(
    invoices
      .filter((i) => i.status !== 'Paid')
      .map((i) => money(Math.max(0, i.net_amount - (paid.get(i.invoice_id) ?? 0)))),
  )
  const overdueAr = sumMoney(
    invoices
      .filter((i) => i.status === 'Overdue')
      .map((i) => money(Math.max(0, i.net_amount - (paid.get(i.invoice_id) ?? 0)))),
  )
  return { openAr, overdueAr }
}

/**
 * Transparent risk rules — a customer may match multiple types.
 */
export function classifyCustomerRisks(
  row: CustomerHealthRow,
  extras: CustomerRiskExtras = {},
): RiskType[] {
  const risks: RiskType[] = []

  if (row.revenueGrowth != null && row.revenueGrowth <= -10) {
    risks.push('Revenue Decline')
  }
  if (row.volumeScore < 50 || (extras.volumeGrowth != null && extras.volumeGrowth <= -10)) {
    risks.push('Volume Decline')
  }
  if (row.contributionMargin != null && row.contributionMargin < 18) {
    risks.push('Margin Compression')
  }
  if (row.deliveryScore < 55) {
    risks.push('Operational Deterioration')
  }
  if (row.billingExceptionCount >= 3 || row.issueScore < 55) {
    risks.push('Billing Disputes')
  }

  return risks
}

/** Classify with AR fields resolved (Collection Risk requires overdue, not open AR alone). */
export function classifyCustomerRisksWithAr(
  row: CustomerHealthRow,
  extras: CustomerRiskExtras & { overdueAr: number; openAr?: number },
): RiskType[] {
  const risks = classifyCustomerRisks(row, extras)
  if (extras.overdueAr > 0 || row.paymentAgingDays > 0) {
    if (!risks.includes('Collection Risk')) risks.push('Collection Risk')
  }

  const asOfMs = Date.parse(extras.asOf ?? '')
  if (row.contractRenewalDate && Number.isFinite(asOfMs)) {
    const renewMs = Date.parse(row.contractRenewalDate)
    const days = Math.round((renewMs - asOfMs) / 86400000)
    if (days >= 0 && days <= 90) risks.push('Contract Renewal Risk')
  }

  if (extras.engagementScore != null && extras.engagementScore < 50) {
    risks.push('Engagement Risk')
  }

  return [...new Set(risks)]
}

export function enrichHealthRow(
  row: CustomerHealthRow,
  data: DataStore,
  filters: GlobalFilters,
  extras: CustomerRiskExtras = {},
): CustomerRiskProfile {
  return buildCustomerRiskProfile(row, data, filters, extras)
}

export function buildCustomerRiskProfile(
  row: CustomerHealthRow,
  data: DataStore,
  filters: GlobalFilters,
  extras: CustomerRiskExtras = {},
): CustomerRiskProfile {
  const cust = data.customers.find((c) => c.customer_id === row.customerId)
  const { openAr, overdueAr } = arBalances(data, row.customerId, filters)

  const scope: GlobalFilters = { ...filters, customerIds: [row.customerId] }
  const lines = filterBillingLines(data, scope)
  const costs = filterCosts(data, scope).filter((c) => VARIABLE.has(c.cost_type))
  const revenue = sumMoney(lines.map((l) => l.net_amount))
  const varCost = sumMoney(costs.map((c) => c.amount))
  const contributionProfit = money(revenue - varCost)

  let volumeGrowth: number | null = extras.volumeGrowth ?? null
  if (volumeGrowth == null && row.priorRevenue > 0) {
    const pyStart = `${Number(filters.startPeriod.slice(0, 4)) - 1}${filters.startPeriod.slice(4)}`
    const pyEnd = `${Number(filters.endPeriod.slice(0, 4)) - 1}${filters.endPeriod.slice(4)}`
    const histStart = data.meta.history_start ?? '0000-00'
    if (pyStart >= histStart) {
      const curVol = sumMoney(
        filterShipments(data, scope).map((s) => s.package_count),
      )
      const priorVol = sumMoney(
        filterShipments(data, { ...scope, startPeriod: pyStart, endPeriod: pyEnd }).map(
          (s) => s.package_count,
        ),
      )
      if (priorVol > 0) volumeGrowth = money(((curVol - priorVol) / priorVol) * 100)
    }
  }

  const contract = computeCustomerContractHealth(data, filters, row.customerId)
  const asOf = extras.asOf ?? data.meta.as_of_date ?? '2026-11-05'
  const riskTypes = classifyCustomerRisksWithAr(row, {
    ...extras,
    overdueAr,
    asOf,
    engagementScore: extras.engagementScore,
  })

  const recoverableBilling = money(
    extras.recoverableBilling ??
      sumMoney(
        filterExceptions(data, scope)
          .filter(
            (e) =>
              RECOVERABLE_EXCEPTION_TYPES.has(e.exception_type) &&
              (e.status === 'Open' ||
                e.status === 'Investigating' ||
                e.status === 'Pending Approval'),
          )
          .map((e) => e.financial_impact),
      ),
  )
  const lossP = row.assumedLossProbability
  const contributionAtRisk = money(contributionProfit * lossP)

  return {
    ...row,
    riskTypes,
    openAr,
    overdueAr,
    contributionProfit,
    volumeGrowth,
    commitmentUtilization: contract.commitmentUtilization,
    daysUntilRenewal: contract.daysUntilRenewal,
    industry: cust?.industry ?? 'Unknown',
    financialExposure: {
      currentRevenue: row.revenue,
      scenarioRaR: row.scenarioRevenueAtRisk,
      recoverableBilling,
      contributionAtRisk,
    },
  }
}

/**
 * Portfolio rollups. revenueFromAtRisk = sum(current revenue) for At Risk + Critical —
 * NOT the same as scenarioRevenueAtRiskTotal (probability-weighted forward exposure).
 */
export function computePortfolioRiskKpis(rows: CustomerRiskProfile[]): PortfolioRiskKpis {
  const atRiskBands: HealthBand[] = ['At Risk', 'Critical']
  const atRisk = rows.filter((r) => atRiskBands.includes(r.healthBand))
  const revenueFromAtRisk = sumMoney(atRisk.map((r) => r.revenue))
  const contributionProfitAtRisk = sumMoney(atRisk.map((r) => r.contributionProfit))
  const decliningVolumeCount = rows.filter((r) => r.riskTypes.includes('Volume Decline')).length
  const marginCompressionCount = rows.filter((r) =>
    r.riskTypes.includes('Margin Compression'),
  ).length
  const contractsExpiring90d = rows.filter(
    (r) => r.daysUntilRenewal != null && r.daysUntilRenewal >= 0 && r.daysUntilRenewal <= 90,
  ).length
  const scenarioRevenueAtRiskTotal = sumMoney(rows.map((r) => r.scenarioRevenueAtRisk))

  return {
    atRiskCustomers: atRisk.length,
    revenueFromAtRisk,
    contributionProfitAtRisk,
    decliningVolumeCount,
    marginCompressionCount,
    contractsExpiring90d,
    scenarioRevenueAtRiskTotal,
  }
}
