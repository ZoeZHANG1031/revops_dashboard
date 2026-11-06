import { describe, expect, it } from 'vitest'
import { getDataStore } from '@/data/generate'
import { buildAnalysisSearch, parseAnalysisSearch } from '@/lib/analysisUrl'
import { lineageForMetric, lineageFromRecognition, lineageFromShipment } from '@/lib/lineage'
import { resolveEntity } from '@/lib/recordLookup'
import { defaultFilters, listHistoricalPeriods, listPeriods } from '@/lib/filters'
import { computeSharedMetrics } from '@/calc/metricRegistry'

describe('analysis URL', () => {
  it('round-trips global filters', () => {
    const qs = buildAnalysisSearch(
      {
        startPeriod: '2024-08',
        endPeriod: '2024-10',
        customerIds: ['CUST-001'],
        regions: ['West'],
        serviceTypes: ['Express'],
        snapshot: 'snap',
      },
      { scenario: 'Base', dateBasis: 'recognition', focusExceptionType: 'Missing Billing' },
    )
    const parsed = parseAnalysisSearch(qs)
    expect(parsed.filters.startPeriod).toBe('2024-08')
    expect(parsed.filters.customerIds?.[0]).toBe('CUST-001')
    expect(parsed.filters.regions?.[0]).toBe('West')
    expect(parsed.focusExceptionType).toBe('Missing Billing')
  })
})

describe('lineage + entity resolution', () => {
  const data = getDataStore()

  it('builds recognized revenue lineage hops', () => {
    const path = lineageForMetric('recognized_revenue')
    expect(path.hops.length).toBeGreaterThanOrEqual(4)
    expect(path.hops[0].sourceTable).toContain('revenue_recognition')
  })

  it('resolves recognition → linked records when present', () => {
    const rr = data.revenueRecognition.find((r) => r.billing_line_id)
    expect(rr).toBeTruthy()
    if (!rr) return
    const path = lineageFromRecognition(data, rr.rev_rec_id)
    expect(path.hops[0].entityType).toBe('recognition')
    expect(path.hops.some((h) => h.entityType === 'billing_line')).toBe(true)
  })

  it('resolves shipment reverse lineage without fabricating IDs', () => {
    const ship = data.shipments[0]
    const path = lineageFromShipment(data, ship.shipment_id)
    expect(path.hops[0].entityId).toBe(ship.shipment_id)
    const detail = resolveEntity(data, 'shipment', ship.shipment_id)
    expect(detail.available).toBe(true)
    expect(detail.linked.some((l) => l.entityType === 'customer')).toBe(true)
  })

  it('returns Not Available for unknown IDs', () => {
    const detail = resolveEntity(data, 'shipment', 'SHIP-DOES-NOT-EXIST')
    expect(detail.available).toBe(false)
    expect(detail.title).toMatch(/No Linked Record/)
  })

  it('keeps cross-page recognized revenue consistent under same filters', () => {
    const periods = listPeriods(data)
    const hist = listHistoricalPeriods(data)
    const filters = defaultFilters(periods, hist[hist.length - 1])
    const m = computeSharedMetrics(data, filters, 'Base')
    const fromRec = data.revenueRecognition
      .filter(
        (r) =>
          r.billing_line_id === null &&
          r.accounting_period >= filters.startPeriod &&
          r.accounting_period <= filters.endPeriod,
      )
      .reduce((a, r) => a + r.amount, 0)
    expect(Math.abs(m.recognizedRevenue - fromRec)).toBeLessThan(0.05)
  })
})
