import { describe, expect, it } from 'vitest'
import { getDataStore } from '@/data/generate'
import { computeSharedMetrics } from '@/calc/metricRegistry'
import { defaultFilters, filterRevenue, listHistoricalPeriods, listPeriods } from '@/lib/filters'

describe('recognition west probe', () => {
  it('diagnoses west recognized revenue', () => {
    const data = getDataStore()
    const periods = listPeriods(data)
    const hist = listHistoricalPeriods(data)
    const base = defaultFilters(periods, hist[hist.length - 1])
    const west = { ...base, regions: ['West' as const] }
    const sharedAll = computeSharedMetrics(data, base)
    const sharedWest = computeSharedMetrics(data, west)
    const revAll = filterRevenue(data, base).filter((r) => r.billing_line_id === null)
    const revWest = filterRevenue(data, west).filter((r) => r.billing_line_id === null)

    const sample = revAll[0]
    let neither = 0
    for (const r of revAll) {
      if (!r.shipment_id && !r.billing_line_id) neither++
    }

    const invLines = sample?.invoice_id
      ? data.billingLines.filter((b) => b.invoice_id === sample.invoice_id && !b.is_duplicate)
      : []
    const cust = data.customers.find((c) => c.customer_id === sample?.customer_id)

    // Assert diagnostics into message for visibility
    expect(
      {
        all: sharedAll.recognizedRevenue,
        west: sharedWest.recognizedRevenue,
        westNet: sharedWest.netBilledRevenue,
        headersAll: revAll.length,
        headersWest: revWest.length,
        neitherLink: neither,
        sampleHasShip: Boolean(sample?.shipment_id),
        sampleHasBill: Boolean(sample?.billing_line_id),
        sampleInvoice: sample?.invoice_id,
        invRegions: [...new Set(invLines.map((l) => l.region))],
        custRegion: cust?.region,
      },
      JSON.stringify(
        {
          all: sharedAll.recognizedRevenue,
          west: sharedWest.recognizedRevenue,
          westNet: sharedWest.netBilledRevenue,
          headersAll: revAll.length,
          headersWest: revWest.length,
          neitherLink: neither,
          sampleHasShip: Boolean(sample?.shipment_id),
          sampleHasBill: Boolean(sample?.billing_line_id),
          sampleInvoice: sample?.invoice_id,
          invRegions: [...new Set(invLines.map((l) => l.region))],
          custRegion: cust?.region,
        },
        null,
        2,
      ),
    ).toMatchObject({
      all: expect.any(Number),
    })
  })
})
