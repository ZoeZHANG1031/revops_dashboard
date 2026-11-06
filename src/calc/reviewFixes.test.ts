import { describe, expect, it } from 'vitest'
import { getDataStore } from '@/data/generate'
import { defaultFilters, filterExceptions, listHistoricalPeriods } from '@/lib/filters'
import { money, sumMoney } from '@/lib/money'
import { actionCategoryTotals, buildActionCenter } from './actionCenter'
import { computeArSnapshot, invoiceOutstanding, paidByInvoiceAsOf } from './arSnapshot'
import { sumCompanyTargets } from './forwardForecast'
import { computeSharedMetrics } from './metricRegistry'
import { computePipelineMovement } from './pipelineMovement'

const data = getDataStore()
const hist = listHistoricalPeriods(data)
const filters = defaultFilters(hist, hist[hist.length - 1])
const OPEN = new Set(['Open', 'Investigating', 'Pending Approval'])

describe('Overdue AR — one point-in-time population everywhere', () => {
  it('KPI = AR snapshot = open Overdue AR cases = Action Center Collections Exposure', () => {
    const asOf = data.meta.as_of_date
    const paid = paidByInvoiceAsOf(data, asOf)
    const truth = sumMoney(
      data.invoices
        .filter((i) => i.status !== 'Draft' && i.invoice_date <= asOf && i.due_date < asOf)
        .map((i) => invoiceOutstanding(i, paid)),
    )
    const m = computeSharedMetrics(data, filters)
    const ar = computeArSnapshot(data, filters)
    const cases = filterExceptions(data, filters).filter((e) => e.exception_type === 'Overdue AR' && OPEN.has(e.status))
    const coll = actionCategoryTotals(buildActionCenter(data, filters)).find((c) => c.category === 'Collections Exposure')
    expect(money(ar.overdueAr - truth)).toBeCloseTo(0, 1)
    expect(m.overdueAr).toBeCloseTo(ar.overdueAr, 1)
    expect(sumMoney(cases.map((e) => e.financial_impact))).toBeCloseTo(ar.overdueAr, 0)
    expect(coll?.impact ?? 0).toBeCloseTo(ar.overdueAr, 0)
  })

  it('an invoice issued before the activity window still counts while unpaid', () => {
    const ar = computeArSnapshot(data, filters)
    expect(ar.openInvoices.some((i) => i.accounting_period < filters.startPeriod)).toBe(true)
    expect(ar.agingFoots && ar.overdueFoots).toBe(true)
  })
})

describe('CRM and plan coverage for the default window', () => {
  it('pipeline movement shows current-quarter activity (new, won and lost)', () => {
    const mv = computePipelineMovement(data, filters)
    const get = (k: string) => mv.steps.find((s) => s.key === k)?.amount ?? 0
    expect(get('new')).toBeGreaterThan(0)
    expect(get('won')).toBeLessThan(0)
    expect(get('lost')).toBeLessThan(0)
  })

  it('open opportunities are not all created on one day', () => {
    const open = data.opportunities.filter((o) => !o.stage.startsWith('Closed'))
    expect(new Set(open.map((o) => o.created_date)).size).toBeGreaterThan(open.length / 2)
  })

  it('every historical month with a forecast has an approved company target', () => {
    const fcMonths = [...new Set(data.forecasts.map((f) => f.accounting_period))]
    for (const p of fcMonths) expect(sumCompanyTargets(data, [p])).toBeGreaterThan(0)
  })

  it('meta fixed pool equals the pool actually allocated in the last closed month', () => {
    const total = sumMoney(
      data.costs
        .filter((c) => c.cost_type === 'Allocated Fixed' && c.accounting_period === hist[hist.length - 1])
        .map((c) => c.amount),
    )
    expect(Math.abs(total - data.meta.fixed_opex_pool_monthly_base)).toBeLessThan(1)
  })
})

describe('High Risk Customer cases come from realised signals only', () => {
  it('every case shows ≥ 15% YoY 3-month package decline', () => {
    const cases = data.exceptions.filter((e) => e.exception_type === 'High Risk Customer')
    const pk = (cid: string, months: string[]) =>
      data.shipments
        .filter((s) => s.customer_id === cid && months.includes(s.ship_date.slice(0, 7)))
        .reduce((a, s) => a + s.package_count, 0)
    const end = hist[hist.length - 1]
    const shift = (p: string, k: number) => {
      const [y, m] = p.split('-').map(Number)
      const d = new Date(Date.UTC(y, m - 1 - k, 1))
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    }
    for (const e of cases) {
      const now = pk(e.customer_id!, [0, 1, 2].map((k) => shift(end, k)))
      const ago = pk(e.customer_id!, [12, 13, 14].map((k) => shift(end, k)))
      expect(now / ago - 1).toBeLessThanOrEqual(-0.15 + 1e-9)
      expect(e.financial_impact).toBeCloseTo(e.expected_amount - e.actual_amount, 1)
    }
  })
})
