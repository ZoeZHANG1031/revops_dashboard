import { filterShipments, monthDiff } from '@/lib/filters'
import { money, pct } from '@/lib/money'
import type { DataStore, GlobalFilters } from '@/types'

export interface ContractUtilizationMonth {
  period: string
  actualVolume: number
  expectedVolume: number
  utilizationPct: number | null
}

export interface CustomerContractHealth {
  customerId: string
  contractId: string | null
  monthlyCommitment: number
  commitmentUtilization: number | null
  utilizationTrend: ContractUtilizationMonth[]
  contractedRate: number | null
  effectiveRate: number | null
  daysUntilRenewal: number | null
  renewalStatus: 'Active' | 'Expiring Soon' | 'Expired' | 'Unknown'
  contractRiskScore: number
  note: string
}

function activeContract(data: DataStore, customerId: string) {
  const list = data.contracts
    .filter((c) => c.customer_id === customerId)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
  return list.find((c) => c.status === 'Active') ?? list[0] ?? null
}

function monthlyCommitment(data: DataStore, customerId: string, contract: DataStore['contracts'][0]) {
  const cust = data.customers.find((c) => c.customer_id === customerId)
  const opp = data.opportunities.find(
    (o) => o.customer_id === customerId && o.stage === 'Closed Won',
  )
  return money(
    opp?.expected_monthly_volume ||
      cust?.expected_monthly_volume ||
      Math.max(1, Math.round(contract.volume_commitment / 12)),
  )
}

function listMonthsInWindow(start: string, end: string): string[] {
  const out: string[] = []
  let cur = start
  while (cur <= end) {
    out.push(cur)
    const [y, m] = cur.split('-').map(Number)
    const d = new Date(y, m, 1)
    d.setMonth(d.getMonth() + 1)
    cur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  return out
}

function contractRiskScore(util: number | null, daysUntil: number | null): number {
  let score = 70
  if (util != null) {
    if (util < 0.5) score -= 25
    else if (util < 0.75) score -= 12
    else if (util > 1.15) score -= 8
    else score += 10
  }
  if (daysUntil != null) {
    if (daysUntil < 0) score -= 30
    else if (daysUntil <= 30) score -= 20
    else if (daysUntil <= 90) score -= 10
  }
  return Math.max(0, Math.min(100, Math.round(score)))
}

/**
 * Contract utilization vs volume_commitment (annual / 12) or expected_monthly_volume.
 */
export function computeCustomerContractHealth(
  data: DataStore,
  filters: GlobalFilters,
  customerId: string,
): CustomerContractHealth {
  const contract = activeContract(data, customerId)
  const asOfMs = Date.parse(data.meta.as_of_date ?? '2026-11-05')
  const months = listMonthsInWindow(filters.startPeriod, filters.endPeriod)
  const monthsInWindow = monthDiff(filters.startPeriod, filters.endPeriod) + 1

  if (!contract) {
    return {
      customerId,
      contractId: null,
      monthlyCommitment: 0,
      commitmentUtilization: null,
      utilizationTrend: [],
      contractedRate: null,
      effectiveRate: null,
      daysUntilRenewal: null,
      renewalStatus: 'Unknown',
      contractRiskScore: 50,
      note: 'No contract on file.',
    }
  }

  const monthly = monthlyCommitment(data, customerId, contract)
  const ships = filterShipments(data, { ...filters, customerIds: [customerId] }).filter(
    (s) => s.billable !== false,
  )
  const actualVolume = ships.reduce((a, s) => a + s.package_count, 0)
  const expectedInWindow = monthly * monthsInWindow
  const commitmentUtilization =
    expectedInWindow > 0 ? money(actualVolume / expectedInWindow) : null

  const utilizationTrend: ContractUtilizationMonth[] = months.map((period) => {
    const vol = ships
      .filter((s) => s.ship_date.startsWith(period))
      .reduce((a, s) => a + s.package_count, 0)
    return {
      period,
      actualVolume: vol,
      expectedVolume: monthly,
      utilizationPct: monthly > 0 ? pct(vol, monthly) : null,
    }
  })

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
  const effectiveRate = actualVolume > 0 ? money(billNet / actualVolume) : null

  const renewMs = Date.parse(contract.end_date)
  const daysUntilRenewal = Number.isFinite(renewMs)
    ? Math.round((renewMs - asOfMs) / 86400000)
    : null

  let renewalStatus: CustomerContractHealth['renewalStatus'] = 'Active'
  if (daysUntilRenewal != null) {
    if (daysUntilRenewal < 0) renewalStatus = 'Expired'
    else if (daysUntilRenewal <= 90) renewalStatus = 'Expiring Soon'
  }

  return {
    customerId,
    contractId: contract.contract_id,
    monthlyCommitment: monthly,
    commitmentUtilization,
    utilizationTrend,
    contractedRate,
    effectiveRate,
    daysUntilRenewal,
    renewalStatus,
    contractRiskScore: contractRiskScore(commitmentUtilization, daysUntilRenewal),
    note: 'Utilization = eligible billable shipments ÷ (monthly commitment × months in filter window).',
  }
}
