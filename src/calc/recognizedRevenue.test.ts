import { describe, expect, it } from 'vitest'
import { computeRecognizedRevenue } from '@/calc/recognizedRevenue'
import { computeSharedMetrics } from '@/calc/metricRegistry'
import { getDataStore } from '@/data/generate'
import { defaultFilters, filterBillingLines, listHistoricalPeriods, listPeriods } from '@/lib/filters'
import { sumMoney } from '@/lib/money'

describe('recognized revenue dimensional attribution', () => {
  const data = getDataStore()
  const periods = listPeriods(data)
  const hist = listHistoricalPeriods(data)
  const base = defaultFilters(periods, hist[hist.length - 1])

  it('company total uses invoice headers and is > 0', () => {
    const r = computeRecognizedRevenue(data, base)
    expect(r.grain).toBe('invoice_header')
    expect(r.display).toBe('value')
    expect(r.amount).toBeGreaterThan(0)
  })

  it('West filter does not collapse Recognized Revenue to empty when billing exists', () => {
    const west = { ...base, regions: ['West' as const] }
    const billing = sumMoney(filterBillingLines(data, west).map((l) => l.net_amount))
    expect(billing).toBeGreaterThan(0)
    const r = computeRecognizedRevenue(data, west)
    expect(r.grain).toBe('detail_allocated')
    // Detail-allocated recognition should be available for West shipments
    expect(r.display).not.toBe('no_records')
    expect(r.amount).toBeGreaterThan(0)
    // Must not silently equal Net Billing
    expect(Math.abs(r.amount - billing)).toBeGreaterThan(0.01)
  })

  it('shared metrics match helper under West filter', () => {
    const west = { ...base, regions: ['West' as const] }
    const r = computeRecognizedRevenue(data, west)
    const shared = computeSharedMetrics(data, west)
    expect(Math.abs(shared.recognizedRevenue - r.amount)).toBeLessThan(0.05)
  })

  it('traces one West billing line to a recognition detail', () => {
    const west = { ...base, regions: ['West' as const] }
    const line = filterBillingLines(data, west)[0]
    expect(line).toBeTruthy()
    const detail = data.revenueRecognition.find(
      (r) => r.billing_line_id === line.billing_line_id,
    )
    expect(detail).toBeTruthy()
    expect(detail!.shipment_id).toBe(line.shipment_id)
    const header = data.revenueRecognition.find(
      (r) => r.invoice_id === line.invoice_id && r.billing_line_id === null,
    )
    expect(header).toBeTruthy()
    expect(header!.shipment_id).toBeNull()
  })
})
