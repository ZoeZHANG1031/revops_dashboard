import type { DataStore } from '@/types'

/** Last calendar day of YYYY-MM (synthetic month-end; day-28 used elsewhere for contract overlap). */
export function periodEndDate(period: string): string {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return period
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${period}-${String(last).padStart(2, '0')}`
}

export function periodStartDate(period: string): string {
  return `${period}-01`
}

export type ArBalanceMode = 'current_remaining' | 'payment_capped'

export interface ResolvedAsOf {
  asOf: string
  snapshotAsOf: string
  mode: ArBalanceMode
  /** Short UI label next to balance KPIs */
  balanceLabel: string
  note: string
}

/**
 * Unify Activity Period vs As-of Date.
 * - Activity Period (filters.start/end): operating activity window.
 * - As-of: point-in-time for balances, aging, open cases.
 * Payments after asOf are excluded; invoice status history is not available — outstanding uses net − payments ≤ asOf.
 */
export function resolveAsOf(
  data: DataStore,
  asOfInput?: string | null,
): ResolvedAsOf {
  const snapshotAsOf = data.meta.as_of_date
  let asOf = (asOfInput && asOfInput.slice(0, 10)) || snapshotAsOf
  if (asOf > snapshotAsOf) asOf = snapshotAsOf

  if (asOf >= snapshotAsOf) {
    return {
      asOf: snapshotAsOf,
      snapshotAsOf,
      mode: 'current_remaining',
      balanceLabel: 'Current remaining balance',
      note: `As-of ${snapshotAsOf} · current remaining (payments applied through snapshot)`,
    }
  }

  return {
    asOf,
    snapshotAsOf,
    mode: 'payment_capped',
    balanceLabel: `As-of ${asOf}`,
    note: `Reconstructed as of ${asOf}: invoices dated ≤ as-of, payments with payment_date ≤ as-of. Invoice status history unavailable — outstanding is net − applied cash, not ledger status replay.`,
  }
}

/** Shared days-between helper for aging / case age */
export function daysBetween(isoA: string, isoB: string): number {
  const a = Date.parse(isoA.slice(0, 10))
  const b = Date.parse(isoB.slice(0, 10))
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((b - a) / 86400000)
}
