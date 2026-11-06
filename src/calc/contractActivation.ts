import { filterShipments } from '@/lib/filters'
import { money, pct, sumMoney } from '@/lib/money'
import type { DataStore, GlobalFilters } from '@/types'

export interface ContractActivationRow {
  customerId: string
  customerName: string
  contractId: string
  contractStart: string
  expectedMonthlyVolume: number
  firstShipmentPeriod: string | null
  daysToFirstShipment: number | null
  firstMonthVolume: number | null
  rampUpAttainment: number | null
  potentialVolumeGap: number | null
  note: string
}

/**
 * Closed-won / active contract ramp: Actual first-month packages vs expected_monthly_volume.
 * Potential gap is volume shortfall × illustrative — NOT booked financial loss.
 */
export function computeContractActivation(
  data: DataStore,
  filters: GlobalFilters,
): ContractActivationRow[] {
  const rows: ContractActivationRow[] = []
  const contracts = data.contracts.filter((c) => c.status === 'Active' || c.status === 'Pending')

  for (const c of contracts) {
    if (filters.customerIds.length && !filters.customerIds.includes(c.customer_id)) continue
    const cust = data.customers.find((x) => x.customer_id === c.customer_id)
    if (!cust) continue

    const ships = data.shipments
      .filter((s) => s.customer_id === c.customer_id && s.ship_date >= c.start_date)
      .sort((a, b) => a.ship_date.localeCompare(b.ship_date))

    const first = ships[0] ?? null
    const firstPeriod = first ? first.ship_date.slice(0, 7) : null
    let daysToFirst: number | null = null
    if (first) {
      const t0 = Date.parse(c.start_date)
      const t1 = Date.parse(first.ship_date)
      daysToFirst = Number.isFinite(t0) && Number.isFinite(t1) ? Math.max(0, Math.round((t1 - t0) / 86400000)) : null
    }

    const firstMonthVolume = firstPeriod
      ? sumMoney(
          ships
            .filter((s) => s.ship_date.startsWith(firstPeriod))
            .map((s) => s.package_count),
        )
      : null

    // Prefer opportunity expected volume when linked; else contract volume_commitment / 12-ish monthly
    const opp = data.opportunities.find(
      (o) => o.customer_id === c.customer_id && o.stage === 'Closed Won',
    )
    const expectedMonthlyVolume = money(
      opp?.expected_monthly_volume || Math.max(1, Math.round(c.volume_commitment / 12)),
    )

    const ramp =
      firstMonthVolume == null || expectedMonthlyVolume <= 0
        ? null
        : pct(firstMonthVolume, expectedMonthlyVolume)
    const gap =
      firstMonthVolume == null
        ? expectedMonthlyVolume
        : money(Math.max(0, expectedMonthlyVolume - firstMonthVolume))

    // Period relevance: include if contract overlaps filter or first ship in filter
    const startP = c.start_date.slice(0, 7)
    const endP = c.end_date.slice(0, 7)
    const overlaps =
      startP <= filters.endPeriod && endP >= filters.startPeriod
    if (!overlaps && !(firstPeriod && firstPeriod >= filters.startPeriod && firstPeriod <= filters.endPeriod)) {
      continue
    }

    rows.push({
      customerId: c.customer_id,
      customerName: cust.customer_name,
      contractId: c.contract_id,
      contractStart: c.start_date,
      expectedMonthlyVolume,
      firstShipmentPeriod: firstPeriod,
      daysToFirstShipment: daysToFirst,
      firstMonthVolume,
      rampUpAttainment: ramp,
      potentialVolumeGap: gap,
      note:
        ramp == null
          ? 'No first-month shipments yet — Potential Opportunity / ramp pending, not booked loss.'
          : 'Ramp-up Attainment = First-month packages ÷ Expected monthly volume. Gap is potential volume only.',
    })
  }

  // Also surface customers with shipments in filter but no row yet — skip duplicates
  return rows.sort((a, b) => (a.rampUpAttainment ?? 999) - (b.rampUpAttainment ?? 999))
}

export function computeCustomerRamp(
  data: DataStore,
  filters: GlobalFilters,
  customerId: string,
): ContractActivationRow | null {
  return (
    computeContractActivation(data, { ...filters, customerIds: [customerId] }).find(
      (r) => r.customerId === customerId,
    ) ?? null
  )
}

/** Quick check used by lifecycle — ships in filter for activation stats */
export function activationSummary(data: DataStore, filters: GlobalFilters) {
  const rows = computeContractActivation(data, filters)
  const withRamp = rows.filter((r) => r.rampUpAttainment != null)
  const avgRamp =
    withRamp.length === 0
      ? null
      : money(withRamp.reduce((a, r) => a + (r.rampUpAttainment ?? 0), 0) / withRamp.length)
  const below80 = withRamp.filter((r) => (r.rampUpAttainment ?? 100) < 80).length
  const ships = filterShipments(data, filters)
  return {
    contractsInScope: rows.length,
    avgRampUpAttainment: avgRamp,
    belowTargetCount: below80,
    activeShippingCustomers: new Set(ships.map((s) => s.customer_id)).size,
  }
}
