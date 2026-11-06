import { addMonths, filterShipments } from '@/lib/filters'
import { money, pct } from '@/lib/money'
import type { DataStore, GlobalFilters } from '@/types'

export interface ContractUtilizationMonth {
  period: string
  actualVolume: number
  /** Contract monthly minimum in force that month (0 = contract not active) */
  expectedVolume: number
  /** % of the monthly minimum (100 = commitment met) */
  utilizationPct: number | null
}

export interface ContractRiskRule {
  rule: string
  points: number
  triggered: boolean
}

export interface CustomerContractHealth {
  customerId: string
  contractId: string | null
  /** Contract monthly minimum (contract.volume_commitment) */
  monthlyCommitment: number
  /** % of the minimum over months the contract was active in the window (same scale as the monthly trend) */
  commitmentUtilization: number | null
  activeMonths: number
  utilizationTrend: ContractUtilizationMonth[]
  contractedRate: number | null
  effectiveRate: number | null
  daysUntilRenewal: number | null
  renewalDate: string | null
  renewalStatus: 'Active' | 'Expiring Soon' | 'Expired' | 'Unknown'
  /** 0–100, HIGHER = MORE contract risk (independent of Customer Health, where higher = healthier) */
  contractRiskScore: number
  contractRiskLevel: 'Low' | 'Medium' | 'High'
  contractRiskRules: ContractRiskRule[]
  note: string
}

function activeContract(data: DataStore, customerId: string) {
  const list = data.contracts
    .filter((c) => c.customer_id === customerId)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
  return list.find((c) => c.status === 'Active') ?? list[0] ?? null
}

export function listMonthsInWindow(start: string, end: string): string[] {
  const out: string[] = []
  for (let cur = start; cur <= end; cur = addMonths(cur, 1)) out.push(cur)
  return out
}

/** Demo configuration — contract risk points (higher = riskier) */
export function contractRiskRules(utilPct: number | null, daysUntil: number | null): ContractRiskRule[] {
  return [
    { rule: 'Utilization < 75% of monthly minimum', points: 40, triggered: utilPct != null && utilPct < 75 },
    { rule: 'Utilization 75–99% of monthly minimum', points: 20, triggered: utilPct != null && utilPct >= 75 && utilPct < 100 },
    { rule: 'Contract expired', points: 40, triggered: daysUntil != null && daysUntil < 0 },
    { rule: 'Renewal within 30 days', points: 30, triggered: daysUntil != null && daysUntil >= 0 && daysUntil <= 30 },
    { rule: 'Renewal in 31–90 days', points: 15, triggered: daysUntil != null && daysUntil > 30 && daysUntil <= 90 },
    { rule: 'Renewal in 91–180 days', points: 5, triggered: daysUntil != null && daysUntil > 90 && daysUntil <= 180 },
  ]
}

/**
 * Contract utilization = billable shipped packages ÷ (contract monthly minimum × months the contract
 * was active), reported in % on the same scale as the monthly trend.
 */
export function computeCustomerContractHealth(
  data: DataStore,
  filters: GlobalFilters,
  customerId: string,
): CustomerContractHealth {
  const contract = activeContract(data, customerId)
  const asOfIso = data.meta.as_of_date ?? '2026-11-05'
  const asOfMs = Date.parse(asOfIso)
  const months = listMonthsInWindow(filters.startPeriod, filters.endPeriod)

  if (!contract) {
    return {
      customerId,
      contractId: null,
      monthlyCommitment: 0,
      commitmentUtilization: null,
      activeMonths: 0,
      utilizationTrend: [],
      contractedRate: null,
      effectiveRate: null,
      daysUntilRenewal: null,
      renewalDate: null,
      renewalStatus: 'Unknown',
      contractRiskScore: 0,
      contractRiskLevel: 'Low',
      contractRiskRules: [],
      note: 'No contract on file — contract risk not assessed.',
    }
  }

  const minimum = contract.volume_commitment
  const contractsForCust = data.contracts.filter((c) => c.customer_id === customerId)
  const minimumFor = (period: string) => {
    // A month counts when any contract version is in force for the whole month
    const c = contractsForCust.find((k) => k.start_date.slice(0, 7) <= period && k.end_date.slice(0, 7) >= period)
    return c ? c.volume_commitment : 0
  }

  const ships = filterShipments(data, { ...filters, customerIds: [customerId] }).filter((s) => s.billable !== false)
  const volByMonth = new Map<string, number>()
  for (const s of ships) {
    const k = s.ship_date.slice(0, 7)
    volByMonth.set(k, (volByMonth.get(k) ?? 0) + s.package_count)
  }

  const utilizationTrend: ContractUtilizationMonth[] = months.map((period) => {
    const vol = volByMonth.get(period) ?? 0
    const min = minimumFor(period)
    return { period, actualVolume: vol, expectedVolume: min, utilizationPct: min > 0 ? pct(vol, min) : null }
  })
  const active = utilizationTrend.filter((m) => m.expectedVolume > 0)
  const actualActive = active.reduce((a, m) => a + m.actualVolume, 0)
  const expectedActive = active.reduce((a, m) => a + m.expectedVolume, 0)
  const commitmentUtilization = expectedActive > 0 ? pct(actualActive, expectedActive) : null

  const rateCard = data.rateCards.find((r) => r.contract_id === contract.contract_id)
  const contractedRate = rateCard ? money(rateCard.base_rate) : null
  const billNet = data.billingLines
    .filter(
      (b) =>
        b.customer_id === customerId &&
        !b.is_duplicate &&
        b.accounting_period >= filters.startPeriod &&
        b.accounting_period <= filters.endPeriod,
    )
    .reduce((a, b) => a + b.net_amount, 0)
  const allPkgs = ships.reduce((a, s) => a + s.package_count, 0)
  const effectiveRate = allPkgs > 0 ? money(billNet / allPkgs) : null

  const renewMs = Date.parse(contract.end_date)
  const daysUntilRenewal = Number.isFinite(renewMs) ? Math.round((renewMs - asOfMs) / 86400000) : null
  let renewalStatus: CustomerContractHealth['renewalStatus'] = 'Active'
  if (daysUntilRenewal != null) {
    if (daysUntilRenewal < 0) renewalStatus = 'Expired'
    else if (daysUntilRenewal <= 90) renewalStatus = 'Expiring Soon'
  }

  const rules = contractRiskRules(commitmentUtilization, daysUntilRenewal)
  const score = Math.min(100, rules.filter((r) => r.triggered).reduce((a, r) => a + r.points, 0))

  return {
    customerId,
    contractId: contract.contract_id,
    monthlyCommitment: minimum,
    commitmentUtilization,
    activeMonths: active.length,
    utilizationTrend,
    contractedRate,
    effectiveRate,
    daysUntilRenewal,
    renewalDate: contract.end_date,
    renewalStatus,
    contractRiskScore: score,
    contractRiskLevel: score >= 50 ? 'High' : score >= 20 ? 'Medium' : 'Low',
    contractRiskRules: rules,
    note: `Utilization = billable shipped packages ÷ (contract monthly minimum × ${active.length} active month${active.length === 1 ? '' : 's'}). Contract risk: higher = riskier (demo rules).`,
  }
}
