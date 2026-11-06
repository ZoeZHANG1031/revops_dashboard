import {
  defaultFilters,
  filterBillingLines,
  filterCosts,
  filterExceptions,
  filterInvoices,
  filterShipments,
  priorPeriodRange,
} from '@/lib/filters'
import { deltaPct, money, pct, sumMoney } from '@/lib/money'
import type { DataStore, ForecastScenarioParams, GlobalFilters } from '@/types'
import { computeCustomerHealth } from './customerHealth'
import { computeRecognizedRevenue } from './recognizedRevenue'
import { computeVarianceBridge } from './varianceBridge'

export interface ExecutiveKpis {
  recognizedRevenue: number
  forecastRevenue: number
  revenueVariance: number
  netBilledRevenue: number
  contributionProfit: number
  contributionMargin: number | null
  revenueAtRisk: number
  unbilledExposure: number
  bookings: number
  cashCollections: number
  prior: {
    recognizedRevenue: number
    forecastRevenue: number
    netBilledRevenue: number
    contributionProfit: number
    contributionMargin: number | null
    revenueAtRisk: number
    unbilledExposure: number
  }
  deltas: {
    recognizedRevenue: number | null
    forecastRevenue: number | null
    netBilledRevenue: number | null
    contributionProfit: number | null
    contributionMargin: number | null
    revenueAtRisk: number | null
    unbilledExposure: number | null
  }
  targets: {
    recognizedRevenue: number
    contributionMargin: number
  }
}

function headerRevenue(data: DataStore, filters: GlobalFilters): number {
  return computeRecognizedRevenue(data, filters).amount
}

function netBilled(data: DataStore, filters: GlobalFilters): number {
  return sumMoney(filterBillingLines(data, filters).map((b) => b.net_amount))
}

function variableCosts(data: DataStore, filters: GlobalFilters): number {
  const variableTypes = new Set([
    'DSP Delivery',
    'Sorting',
    'Linehaul',
    'Redelivery',
    'Claims',
    'Other Variable',
  ])
  return sumMoney(
    filterCosts(data, filters)
      .filter((c) => variableTypes.has(c.cost_type))
      .map((c) => c.amount),
  )
}

function forecastForFilters(
  data: DataStore,
  filters: GlobalFilters,
  scenario: 'Base' | 'Upside' | 'Downside' = 'Base',
): number {
  return sumMoney(
    data.forecasts
      .filter(
        (f) =>
          f.scenario === scenario &&
          f.forecast_type === 'Existing' &&
          f.accounting_period >= filters.startPeriod &&
          f.accounting_period <= filters.endPeriod &&
          (filters.customerIds.length === 0 ||
            (f.customer_id != null && filters.customerIds.includes(f.customer_id))),
      )
      .map((f) => f.forecast_recognized),
  )
}

function unbilled(data: DataStore, filters: GlobalFilters): number {
  return sumMoney(
    filterExceptions(data, filters)
      .filter((e) => e.exception_type === 'Missing Billing' || e.exception_type === 'Unbilled Packages')
      .map((e) => e.financial_impact),
  )
}

function revenueAtRisk(data: DataStore, filters: GlobalFilters): number {
  const health = computeCustomerHealth(data, filters)
  return sumMoney(health.map((h) => h.revenueAtRisk))
}

function cashCollections(data: DataStore, filters: GlobalFilters): number {
  return sumMoney(
    data.payments
      .filter((p) => {
        const period = p.payment_date.slice(0, 7)
        return (
          period >= filters.startPeriod &&
          period <= filters.endPeriod &&
          (filters.customerIds.length === 0 || filters.customerIds.includes(p.customer_id))
        )
      })
      .map((p) => p.amount),
  )
}

function bookings(data: DataStore): number {
  return sumMoney(
    data.opportunities.filter((o) => o.stage === 'Closed Won').map((o) => o.opportunity_value),
  )
}

export function computeExecutiveKpis(
  data: DataStore,
  filters: GlobalFilters,
  scenario: 'Base' | 'Upside' | 'Downside' = 'Base',
): ExecutiveKpis {
  const recognizedRevenue = headerRevenue(data, filters)
  const forecastRevenue = forecastForFilters(data, filters, scenario)
  const netBilledRevenue = netBilled(data, filters)
  const varCost = variableCosts(data, filters)
  const contributionProfit = money(netBilledRevenue - varCost)
  const contributionMargin = pct(contributionProfit, netBilledRevenue)
  const rar = revenueAtRisk(data, filters)
  const unbilledExposure = unbilled(data, filters)

  const priorFilters: GlobalFilters = { ...filters, ...priorPeriodRange(filters) }
  const priorRecognized = headerRevenue(data, priorFilters)
  const priorForecast = forecastForFilters(data, priorFilters, scenario)
  const priorNet = netBilled(data, priorFilters)
  const priorProfit = money(priorNet - variableCosts(data, priorFilters))
  const priorMargin = pct(priorProfit, priorNet)
  const priorRar = revenueAtRisk(data, priorFilters)
  const priorUnbilled = unbilled(data, priorFilters)

  return {
    recognizedRevenue,
    forecastRevenue,
    revenueVariance: money(recognizedRevenue - forecastRevenue),
    netBilledRevenue,
    contributionProfit,
    contributionMargin,
    revenueAtRisk: rar,
    unbilledExposure,
    bookings: bookings(data),
    cashCollections: cashCollections(data, filters),
    prior: {
      recognizedRevenue: priorRecognized,
      forecastRevenue: priorForecast,
      netBilledRevenue: priorNet,
      contributionProfit: priorProfit,
      contributionMargin: priorMargin,
      revenueAtRisk: priorRar,
      unbilledExposure: priorUnbilled,
    },
    deltas: {
      recognizedRevenue: deltaPct(recognizedRevenue, priorRecognized),
      forecastRevenue: deltaPct(forecastRevenue, priorForecast),
      netBilledRevenue: deltaPct(netBilledRevenue, priorNet),
      contributionProfit: deltaPct(contributionProfit, priorProfit),
      contributionMargin:
        priorMargin != null && contributionMargin != null
          ? money(contributionMargin - priorMargin)
          : null,
      revenueAtRisk: deltaPct(rar, priorRar),
      unbilledExposure: deltaPct(unbilledExposure, priorUnbilled),
    },
    targets: {
      recognizedRevenue: money(forecastRevenue * 1.02),
      contributionMargin: 28,
    },
  }
}

export function monthlyRevenueSeries(data: DataStore, filters: GlobalFilters) {
  const periods = data.dates
    .map((d) => d.date_key.slice(0, 7))
    .filter((p) => p >= filters.startPeriod && p <= filters.endPeriod)

  return periods.map((period) => {
    const f: GlobalFilters = { ...filters, startPeriod: period, endPeriod: period }
    const recognized = headerRevenue(data, f)
    const billed = netBilled(data, f)
    const forecast = forecastForFilters(data, f, 'Base')
    const label = data.dates.find((d) => d.date_key.startsWith(period))?.month_label ?? period
    return { period, label, recognized, billed, forecast }
  })
}

export function getPriorityExceptions(data: DataStore, filters: GlobalFilters, limit = 12) {
  return filterExceptions(data, filters)
    .slice()
    .sort((a, b) => b.financial_impact - a.financial_impact)
    .slice(0, limit)
}

export function computeTraceability(data: DataStore, revRecId: string) {
  const header = data.revenueRecognition.find((r) => r.rev_rec_id === revRecId)
  if (!header) return null
  const gl = data.generalLedger.filter((g) => g.rev_rec_id === revRecId)
  const details = data.revenueRecognition.filter(
    (r) =>
      r.invoice_id === header.invoice_id &&
      r.billing_line_id != null &&
      r.accounting_period === header.accounting_period,
  )
  const invoice = header.invoice_id
    ? data.invoices.find((i) => i.invoice_id === header.invoice_id)
    : null
  const billingLines = details
    .map((d) => data.billingLines.find((b) => b.billing_line_id === d.billing_line_id))
    .filter(Boolean)
  const shipments = billingLines
    .map((b) => data.shipments.find((s) => s.shipment_id === b!.shipment_id))
    .filter(Boolean)
  const rateCards = billingLines
    .map((b) => data.rateCards.find((r) => r.rate_card_id === b!.rate_card_id))
    .filter(Boolean)

  return { header, gl, details, invoice, billingLines, shipments, rateCards }
}

export { computeVarianceBridge, defaultFilters, filterShipments, filterInvoices }
export type { ForecastScenarioParams }
