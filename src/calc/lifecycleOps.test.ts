import { describe, expect, it } from 'vitest'
import { generateDataStore } from '@/data/generate'
import { defaultFilters, listHistoricalPeriods } from '@/lib/filters'
import {
  computeActivationSet,
  computeGrossToNetBridge,
  computeOperationalPipeline,
  computeUnbilledBacklog,
  computeBillableSplit,
} from './lifecycleOps'
import { money } from '@/lib/money'

describe('lifecycle ops fixes', () => {
  const data = generateDataStore()
  const hist = listHistoricalPeriods(data)
  const filters = defaultFilters(hist, hist[hist.length - 1])
  const asOf = data.meta.as_of_date

  it('activation numerator is subset of eligible; contracts ≠ customers', () => {
    const a = computeActivationSet(data, filters)
    expect(a.activated).toBeLessThanOrEqual(a.eligibleCustomers)
    expect(a.notYetActivated).toBe(a.eligibleCustomers - a.activated)
    expect(a.activated + a.notYetActivated).toBe(a.eligibleCustomers)
    expect(a.contractCount).toBeGreaterThan(0)
    // Outside customers classified with evidence reasons only
    for (const row of a.outsideCustomers) {
      expect([
        'Contract outside relevant date window',
        'Missing contract link',
        'Other / Unclassified',
      ]).toContain(row.reason)
    }
  })

  it('Gross − discounts − credits (+ residual) foots to Net', () => {
    const b = computeGrossToNetBridge(data, filters)
    const adj = b.steps.filter((s) => s.key !== 'gross' && s.key !== 'net').reduce((a, s) => a + s.amount, 0)
    expect(Math.abs(money(b.gross + adj - b.net))).toBeLessThan(0.05)
  })

  it('billable + non-billable (+ unknown) = total', () => {
    const s = computeBillableSplit(data, filters)
    expect(s.billable + s.nonBillable + s.unknown).toBe(s.total)
    expect(s.foots).toBe(true)
  })

  it('unbilled uses as-of billing_date and does not invent overdue', () => {
    const u = computeUnbilledBacklog(data, filters, asOf)
    expect(u.ageBasis).toBe('Days since shipment')
    expect(u.buckets.reduce((a, b) => a + b.packages, 0)).toBe(u.unbilledPackages)
    for (const lot of u.sampleLots) {
      expect(lot.billable).toBe(true)
      expect(lot.ship_date <= asOf).toBe(true)
    }
  })

  it('ops pipeline wires modules and accuracy label', () => {
    const ops = computeOperationalPipeline(data, filters, asOf)
    expect(ops.billingAccuracyMeta.label).toBe('Billing line accuracy')
    expect(ops.unbilled.unbilledPackages).toBeGreaterThanOrEqual(0)
    expect(ops.bridge.steps[0].key).toBe('gross')
    expect(ops.bridge.steps[ops.bridge.steps.length - 1].key).toBe('net')
  })
})
