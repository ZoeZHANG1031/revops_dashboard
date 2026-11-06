import { filterRevenue } from '@/lib/filters'
import { sumMoney } from '@/lib/money'
import type { DataStore, FactRevenueRecognition, GlobalFilters } from '@/types'

export type RecognitionGrain = 'invoice_header' | 'detail_allocated'

export interface RecognizedRevenueResult {
  amount: number
  recordCount: number
  grain: RecognitionGrain
  /** True when the synthetic store has any recognition rows at all */
  storeHasRecognition: boolean
  /**
   * Display mode:
   * - no_records: selection/store has zero recognition rows to aggregate
   * - zero: rows exist but sum to 0
   * - value: positive or negative non-zero amount
   */
  display: 'no_records' | 'zero' | 'value'
  note: string
  rows: FactRevenueRecognition[]
}

function needsDimensionalAttribution(filters: GlobalFilters): boolean {
  return filters.regions.length > 0 || filters.serviceTypes.length > 0
}

/**
 * Single source of truth for Recognized Revenue.
 *
 * Invoice header rows (billing_line_id = null) intentionally have null shipment_id
 * so company totals never double-count. When Region/Service filters are applied,
 * those headers cannot be geo/service-matched — we therefore sum allocated DETAIL
 * recognition rows (billing_line_id set) that inherit region/service from shipment
 * or billing line. Detail shares are designed to sum to the header per invoice.
 *
 * Never substitute Net Billing for Recognized Revenue.
 */
export function computeRecognizedRevenue(
  data: DataStore,
  filters: GlobalFilters,
): RecognizedRevenueResult {
  const storeHasRecognition = data.revenueRecognition.length > 0
  const dimensional = needsDimensionalAttribution(filters)
  const filtered = filterRevenue(data, filters)
  const rows = dimensional
    ? filtered.filter((r) => r.billing_line_id != null)
    : filtered.filter((r) => r.billing_line_id === null)
  const amount = sumMoney(rows.map((r) => r.amount))
  const grain: RecognitionGrain = dimensional ? 'detail_allocated' : 'invoice_header'
  const note = dimensional
    ? 'Region/Service filter active: SUM(detail recognition allocated to matching shipments/billing lines). Invoice headers have null shipment_id by design and are excluded to avoid dropping or double-counting.'
    : 'Company/customer scope: SUM(invoice-level recognition headers where billing_line_id IS NULL).'

  let display: RecognizedRevenueResult['display']
  if (!storeHasRecognition || rows.length === 0) display = 'no_records'
  else if (amount === 0) display = 'zero'
  else display = 'value'

  return {
    amount,
    recordCount: rows.length,
    grain,
    storeHasRecognition,
    display,
    note,
    rows,
  }
}

export function formatRecognizedRevenueDisplay(result: RecognizedRevenueResult): {
  primary: string
  warning?: string
} {
  if (result.display === 'no_records') {
    return {
      primary: 'No recognition records available',
      warning: result.storeHasRecognition
        ? 'No recognition rows match the current dimensional filters.'
        : 'Synthetic store has no recognition entries.',
    }
  }
  return { primary: '' } // caller formats currency for zero/value
}
