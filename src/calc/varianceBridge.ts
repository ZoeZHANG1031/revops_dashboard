import { filterBillingLines } from '@/lib/filters'
import { pkgs } from '@/lib/pricing'
import { money, sumMoney } from '@/lib/money'
import type { DataStore, GlobalFilters, RegionCode, ServiceType } from '@/types'
import { forecastComparability } from './forecastScope'
import { computeRecognizedRevenue } from './recognizedRevenue'

export interface VarianceBridgeItem {
  key: string
  label: string
  amount: number
}

/**
 * Waterfall decomposition that telescopes exactly:
 * Forecast → +Volume → +Price → +Mix → +Credits → +Other → Actual
 *
 * Method (non-overlapping):
 * 1. Volume: (Actual Vol − Forecast Vol) × Forecast Avg Rate
 * 2. Price: Actual Vol × (Actual Avg Rate before credits − Forecast Avg Rate)
 *    where "rate before credits" uses (base+surcharges−discounts)/vol
 * 3. Mix: residual from reweighting by customer share vs forecast shares
 * 4. Credits: −(Actual Credits − Forecast Credits)
 * 5. Other: plug so sum(effects) = Actual − Forecast (timing, accruals, etc.)
 */
export interface VarianceBridgeResult {
  items: VarianceBridgeItem[]
  actual: number
  forecast: number
  checkSum: number
  /** |explained| / (|explained| + |residual|) — null if no movement */
  attributionCoverage: number | null
  /** True when |residual| > 40% of |total gap| or > sum(|drivers|) */
  attributionQualityWarning: boolean
  attributionNote: string
}

export function computeVarianceBridge(
  data: DataStore,
  rawFilters: GlobalFilters,
  scenario: 'Base' | 'Upside' | 'Downside' = 'Base',
  groupBy: 'total' | 'customer' | 'region' | 'service' | 'month' = 'total',
): VarianceBridgeResult {
  // Comparable window: only periods that carry Existing forecast rows (never compare actual to a missing forecast)
  const filters = forecastComparability(data, rawFilters, scenario).comparableFilters
  const actual = computeRecognizedRevenue(data, filters).amount

  const forecastRows = data.forecasts.filter(
    (f) =>
      f.scenario === scenario &&
      f.forecast_type === 'Existing' &&
      f.accounting_period >= filters.startPeriod &&
      f.accounting_period <= filters.endPeriod &&
      (filters.customerIds.length === 0 ||
        (f.customer_id != null && filters.customerIds.includes(f.customer_id))),
  )
  const forecast = sumMoney(forecastRows.map((f) => f.forecast_recognized))
  const forecastVol = sumMoney(forecastRows.map((f) => f.forecast_volume))
  const forecastCredits = sumMoney(forecastRows.map((f) => f.forecast_credits))
  const forecastAvgRate =
    forecastVol > 0
      ? money(
          sumMoney(forecastRows.map((f) => f.forecast_net_billing + f.forecast_credits - f.forecast_surcharges)) /
            forecastVol,
        )
      : 0

  const lines = filterBillingLines(data, filters)
  const actualVol = pkgs(lines)
  const actualCredits = sumMoney(lines.map((l) => l.credits))
  const actualGross = sumMoney(
    lines.map((l) => l.base_charge + l.fuel_surcharge + l.remote_surcharge - l.discounts),
  )
  const actualAvgRate = actualVol > 0 ? money(actualGross / actualVol) : 0

  const volumeImpact = money((actualVol - forecastVol) * forecastAvgRate)
  const priceImpact = money(actualVol * (actualAvgRate - forecastAvgRate))

  // Mix: customer-level volume share difference × rate differential
  const mixImpact = money(computeMixEffect(data, filters, forecastRows, forecastAvgRate))
  const creditsImpact = money(-(actualCredits - forecastCredits))

  const explained = money(volumeImpact + priceImpact + mixImpact + creditsImpact)
  const totalGap = money(actual - forecast)
  const other = money(totalGap - explained)

  const items: VarianceBridgeItem[] = [
    { key: 'forecast', label: 'Existing Customer Forecast', amount: forecast },
    { key: 'volume', label: 'Volume Impact', amount: volumeImpact },
    { key: 'price', label: 'Price Impact', amount: priceImpact },
    { key: 'mix', label: 'Customer / Service Mix Impact', amount: mixImpact },
    { key: 'credits', label: 'Credits Impact', amount: creditsImpact },
    { key: 'other', label: 'Unexplained Residual', amount: other },
    { key: 'actual', label: 'Actual Recognized Revenue', amount: actual },
  ]

  const driverAbs =
    Math.abs(volumeImpact) + Math.abs(priceImpact) + Math.abs(mixImpact) + Math.abs(creditsImpact)
  const residualAbs = Math.abs(other)
  const gapAbs = Math.abs(totalGap)
  const attributionCoverage =
    driverAbs + residualAbs === 0 ? null : money((driverAbs / (driverAbs + residualAbs)) * 100)
  const attributionQualityWarning =
    gapAbs > 0 && (residualAbs > gapAbs * 0.4 || (driverAbs > 0 && residualAbs > driverAbs))
  const attributionNote = attributionQualityWarning
    ? 'Attribution Quality Warning: unexplained residual is large vs known drivers (timing, accruals, or missing forecast grain). Residual is retained — not forced to zero.'
    : 'Forecast + signed driver impacts + residual = Actual. Scope = Existing Customer Forecast only (not Total Business).'

  const checkSum = money(volumeImpact + priceImpact + mixImpact + creditsImpact + other)
  const base: VarianceBridgeResult = {
    items,
    actual,
    forecast,
    checkSum,
    attributionCoverage,
    attributionQualityWarning,
    attributionNote,
  }

  if (groupBy !== 'total') {
    return {
      ...base,
      ...{ drilldown: buildDrilldown(data, filters, groupBy, scenario) },
    } as VarianceBridgeResult & { drilldown: unknown }
  }

  return base
}

function computeMixEffect(
  data: DataStore,
  filters: GlobalFilters,
  forecastRows: DataStore['forecasts'],
  forecastAvgRate: number,
): number {
  const lines = filterBillingLines(data, filters)
  const byCustomer = new Map<string, { vol: number; rev: number }>()
  lines.forEach((l) => {
    const cur = byCustomer.get(l.customer_id) ?? { vol: 0, rev: 0 }
    cur.vol += l.package_count
    cur.rev += l.base_charge + l.fuel_surcharge + l.remote_surcharge - l.discounts
    byCustomer.set(l.customer_id, cur)
  })
  const fcByCustomer = new Map<string, { vol: number }>()
  forecastRows.forEach((f) => {
    if (!f.customer_id) return
    const cur = fcByCustomer.get(f.customer_id) ?? { vol: 0 }
    cur.vol += f.forecast_volume
    fcByCustomer.set(f.customer_id, cur)
  })

  let mix = 0
  const totalActVol = pkgs(lines) || 1
  const totalFcVol = [...fcByCustomer.values()].reduce((a, b) => a + b.vol, 0) || 1

  byCustomer.forEach((act, cust) => {
    const fc = fcByCustomer.get(cust)
    const actShare = act.vol / totalActVol
    const fcShare = (fc?.vol ?? 0) / totalFcVol
    const custRate = act.vol > 0 ? act.rev / act.vol : forecastAvgRate
    mix += (actShare - fcShare) * (custRate - forecastAvgRate) * totalActVol
  })
  return mix
}

function buildDrilldown(
  data: DataStore,
  filters: GlobalFilters,
  groupBy: 'customer' | 'region' | 'service' | 'month',
  scenario: 'Base' | 'Upside' | 'Downside',
) {
  const keys =
    groupBy === 'customer'
      ? data.customers.map((c) => c.customer_id)
      : groupBy === 'region'
        ? (['West', 'Central', 'East'] as RegionCode[])
        : groupBy === 'service'
          ? (['Standard', 'Express', 'SameDay', 'Economy'] as ServiceType[])
          : data.dates
              .map((d) => d.date_key.slice(0, 7))
              .filter((p) => p >= filters.startPeriod && p <= filters.endPeriod)

  return keys.map((key) => {
    const f: GlobalFilters = { ...filters }
    if (groupBy === 'customer') f.customerIds = [key]
    if (groupBy === 'region') f.regions = [key as RegionCode]
    if (groupBy === 'service') f.serviceTypes = [key as ServiceType]
    if (groupBy === 'month') {
      f.startPeriod = key
      f.endPeriod = key
    }
    const bridge = computeVarianceBridge(data, f, scenario, 'total')
    const label =
      groupBy === 'customer'
        ? data.customers.find((c) => c.customer_id === key)?.customer_name ?? key
        : key
    return { key, label, variance: money(bridge.actual - bridge.forecast), ...bridge }
  })
}
