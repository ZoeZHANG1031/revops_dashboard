import { RECOVERABLE_EXCEPTION_TYPES } from './exceptionRegistry'
import { forecastComparability } from './forecastScope'
import { computeBillingIntegrity } from './billingIntegrity'
import { filterBillingLines, filterCosts, filterExceptions, filterInvoices, filterShipments } from '@/lib/filters'
import { computeRecognizedRevenue } from '@/calc/recognizedRevenue'
import { createCalcMemo, filterCacheKey } from '@/lib/memoCalc'
import { money, pct, sumMoney } from '@/lib/money'
import type { DataStore, GlobalFilters, KpiDefinition } from '@/types'
import { computeCustomerHealth, type CustomerHealthRow } from './customerHealth'
import { KPI_DEFINITIONS } from './kpiDefinitions'

let _healthCache: { key: string; rows: CustomerHealthRow[] } | null = null

function healthCacheKey(data: DataStore, filters: GlobalFilters): string {
  return [
    data.meta.seed,
    data.meta.snapshot_label,
    data.exceptions.length,
    filters.startPeriod,
    filters.endPeriod,
    filters.customerIds.join(','),
    filters.regions.join(','),
    (filters.metros ?? []).join(','),
    filters.serviceTypes.join(','),
  ].join('|')
}

function cachedCustomerHealth(data: DataStore, filters: GlobalFilters): CustomerHealthRow[] {
  const key = healthCacheKey(data, filters)
  if (_healthCache?.key === key) return _healthCache.rows
  const rows = computeCustomerHealth(data, filters)
  _healthCache = { key, rows }
  return rows
}

export type MetricId =
  | 'recognized_revenue'
  | 'net_billed_revenue'
  | 'gross_billings'
  | 'net_invoice_amount'
  | 'cash_collections'
  | 'overdue_ar'
  | 'accounts_receivable'
  | 'forecast_existing'
  | 'forecast_pipeline'
  | 'forecast_total'
  | 'forecast_variance_existing'
  | 'expected_charges'
  | 'reconciliation_variance'
  | 'unbilled_exposure'
  | 'open_recoverable_leakage'
  | 'confirmed_recoverable_leakage'
  | 'scenario_revenue_at_risk'
  | 'contribution_profit'
  | 'contribution_margin'
  | 'allocated_fixed'
  | 'operating_profit'
  | 'variable_cost'
  | 'billing_accuracy'
  | 'bookings_tcv'
  | 'weighted_pipeline'

export interface MetricMeta extends KpiDefinition {
  id: MetricId
  chineseName: string
  grain: string
  dateBasis: string
  includes: string
  excludes: string
  actionHint: string
}

/** Extended registry — UI tooltips + docs read from here */
export const METRIC_REGISTRY: Record<MetricId, MetricMeta> = {
  recognized_revenue: {
    ...(KPI_DEFINITIONS.recognized_revenue as KpiDefinition),
    id: 'recognized_revenue',
    chineseName: '已确认收入',
    grain: 'Accounting period × customer (header rev-rec)',
    dateBasis: 'fact_revenue_recognition.accounting_period / recognition_date',
    includes: 'Invoice recognition + accruals (header rows only)',
    excludes: 'Shipment-detail allocation rows; cash collections; bookings',
    actionHint: 'Investigate variance bridge if off forecast; check accruals vs invoices.',
  },
  net_billed_revenue: {
    ...(KPI_DEFINITIONS.net_billed_revenue as KpiDefinition),
    id: 'net_billed_revenue',
    chineseName: '净计费金额',
    grain: 'Billing line',
    dateBasis: 'fact_billing_line.accounting_period / billing_date',
    includes: 'Non-duplicate lines: base + surcharges − discounts − credits',
    excludes: 'Duplicate lines; invoice-level credit memos (shown separately)',
    actionHint: 'Compare to expected charges for leakage; review credit rate.',
  },
  gross_billings: {
    id: 'gross_billings',
    name: 'Gross Billings',
    chineseName: '计费总额',
    businessDefinition: 'Sum of base + fuel + remote before discounts and credits.',
    formula: 'SUM(base + fuel + remote) WHERE is_duplicate=false',
    sourceTables: ['fact_billing_line'],
    sourceColumns: ['base_charge', 'fuel_surcharge', 'remote_surcharge'],
    calculationExample: 'Gross $90K before $5K discounts/credits',
    interpretation: 'Commercial gross rating before commercial reductions.',
    commonCauses: ['Volume', 'Rate cards', 'Surcharge policy'],
    grain: 'Billing line',
    dateBasis: 'billing_date / accounting_period',
    includes: 'Rated gross components',
    excludes: 'Discounts, credits, duplicates',
    actionHint: 'Use with net billings to see credit/discount pressure.',
  },
  net_invoice_amount: {
    id: 'net_invoice_amount',
    name: 'Net Invoice Amount',
    chineseName: '净发票金额',
    businessDefinition: 'Customer invoice net after line discounts/credits and invoice credit memos.',
    formula: 'SUM(fact_invoice.net_amount)',
    sourceTables: ['fact_invoice'],
    sourceColumns: ['net_amount', 'accounting_period'],
    calculationExample: 'Billing net $85K − credit memos $1K = $84K invoices',
    interpretation: 'Amount billed to customer on invoices.',
    commonCauses: ['Billing cycle', 'Credit memos', 'Cut-off'],
    grain: 'Invoice',
    dateBasis: 'invoice_date / accounting_period',
    includes: 'Issued/paid/partial/overdue invoices in period',
    excludes: 'Unbilled shipments',
    actionHint: 'Reconcile to billing lines − credit memos.',
  },
  cash_collections: {
    ...(KPI_DEFINITIONS.cash_collections as KpiDefinition),
    id: 'cash_collections',
    chineseName: '已收现金',
    grain: 'Payment',
    dateBasis: 'fact_payment.payment_date',
    includes: 'Cash applied to invoices',
    excludes: 'Recognized revenue; open AR',
    actionHint: 'Collections focus when lagging invoices.',
  },
  overdue_ar: {
    id: 'overdue_ar',
    name: 'Overdue AR',
    chineseName: '逾期应收账款',
    businessDefinition: 'Open invoice net still unpaid past due date. Liquidity exposure — not recognized revenue loss.',
    formula: 'SUM(invoice.net_amount − payments) WHERE status=Overdue OR (due_date < as_of AND not fully paid)',
    sourceTables: ['fact_invoice', 'fact_payment'],
    sourceColumns: ['net_amount', 'status', 'due_date'],
    calculationExample: '3 overdue invoices totaling $3.8K',
    interpretation: 'Cash/credit risk; do not subtract from recognized revenue.',
    commonCauses: ['Disputes', 'Credit terms', 'Customer stress'],
    grain: 'Invoice',
    dateBasis: 'due_date vs as-of; filter by invoice accounting_period',
    includes: 'Overdue status invoices in filter window',
    excludes: 'Paid invoices; scenario churn risk',
    actionHint: 'Finance collections; hold credit if chronic.',
  },
  accounts_receivable: {
    id: 'accounts_receivable',
    name: 'Accounts Receivable',
    chineseName: '应收账款',
    businessDefinition: 'Unpaid invoice balances (issued/partial/overdue).',
    formula: 'SUM(open invoice remaining balance)',
    sourceTables: ['fact_invoice', 'fact_payment'],
    sourceColumns: ['net_amount', 'status'],
    calculationExample: 'Open AR $12K including $3.8K overdue',
    interpretation: 'Working capital tied in receivables.',
    commonCauses: ['Billing growth', 'Payment terms', 'Delinquency'],
    grain: 'Invoice',
    dateBasis: 'invoice in filter; open as of snapshot',
    includes: 'Issued, Partial, Overdue',
    excludes: 'Paid',
    actionHint: 'Monitor aging buckets.',
  },
  forecast_existing: {
    id: 'forecast_existing',
    name: 'Existing Customer Forecast',
    chineseName: '现有客户预测收入',
    businessDefinition: 'Driver-based recognized forecast for existing customers only.',
    formula: 'SUM(forecast_recognized) WHERE forecast_type=Existing AND scenario=selected',
    sourceTables: ['fact_forecast'],
    sourceColumns: ['forecast_recognized', 'forecast_type', 'scenario'],
    calculationExample: 'Existing Base $81.8K',
    interpretation: 'Compare to actual recognized for variance bridge.',
    commonCauses: ['Volume', 'Rate', 'Churn haircut'],
    grain: 'Customer × period × scenario',
    dateBasis: 'forecast target accounting_period',
    includes: 'Existing logos only',
    excludes: 'Pipeline / new logos',
    actionHint: 'Bridge actual vs this series — not Total Business Forecast.',
  },
  forecast_pipeline: {
    id: 'forecast_pipeline',
    name: 'New Pipeline Forecast',
    chineseName: '新客户销售漏斗预测',
    businessDefinition: 'Weighted new-logo activation forecast; never double-counts activated existing customers.',
    formula: 'SUM(forecast_recognized) WHERE forecast_type=Pipeline',
    sourceTables: ['fact_forecast', 'fact_opportunity'],
    sourceColumns: ['forecast_recognized', 'win_probability'],
    calculationExample: 'Pipeline $31.6K in forward months',
    interpretation: 'Additive to Existing for Total Business Forecast.',
    commonCauses: ['Win rate', 'Activation timing', 'Ramp'],
    grain: 'Period × scenario (customer_id null)',
    dateBasis: 'target accounting_period',
    includes: 'Open opportunities + activation bump',
    excludes: 'Existing customer IDs',
    actionHint: 'Extend date filter into forward horizon to see pipeline.',
  },
  forecast_total: {
    id: 'forecast_total',
    name: 'Total Business Forecast',
    chineseName: '总预计收入',
    businessDefinition: 'Existing + Pipeline. Do not compare Actual Recognized only to this when Actual excludes unactivated pipeline.',
    formula: 'Existing Customer Forecast + New Pipeline Forecast',
    sourceTables: ['fact_forecast'],
    sourceColumns: ['forecast_recognized', 'forecast_type'],
    calculationExample: '$81.8K + $31.6K = $113.4K',
    interpretation: 'Full outlook; historical actuals primarily validate Existing.',
    commonCauses: ['Both legs'],
    grain: 'Period × scenario',
    dateBasis: 'target month',
    includes: 'Both forecast types',
    excludes: 'Double-counted activations (by design excluded)',
    actionHint: 'Use Existing for backtest; Total for forward plan.',
  },
  forecast_variance_existing: {
    id: 'forecast_variance_existing',
    name: 'Forecast Variance (vs Existing)',
    chineseName: '相对现有客户预测的差异',
    businessDefinition: 'Recognized Revenue − Existing Customer Forecast.',
    formula: 'Recognized − Existing Forecast',
    sourceTables: ['fact_revenue_recognition', 'fact_forecast'],
    sourceColumns: ['amount', 'forecast_recognized'],
    calculationExample: '$84K − $82K = +$2K',
    interpretation: 'Primary performance vs run-rate plan.',
    commonCauses: ['Volume/price/mix/credits/timing'],
    grain: 'Filter window',
    dateBasis: 'Aligned accounting periods',
    includes: 'Existing forecast only',
    excludes: 'Pipeline forecast',
    actionHint: 'Decompose with variance bridge.',
  },
  expected_charges: {
    id: 'expected_charges',
    name: 'Expected Charges',
    chineseName: '预期合同费用',
    businessDefinition: 'Rate-card theoretical charges for billable shipments in period.',
    formula: 'SUM(rate_card price for billable shipments)',
    sourceTables: ['fact_shipment', 'dim_rate_card'],
    sourceColumns: ['base_rate', 'per_lb_rate', 'fuel_surcharge_pct'],
    calculationExample: 'Expected $90.4K',
    interpretation: 'Pricing system expectation before billing engine output.',
    commonCauses: ['Volume', 'Rate version', 'Surcharges'],
    grain: 'Shipment',
    dateBasis: 'ship_date with effective rate card',
    includes: 'Billable shipments',
    excludes: 'Non-billable failures per contract',
    actionHint: 'Reconcile to net billings via recon bridge.',
  },
  reconciliation_variance: {
    id: 'reconciliation_variance',
    name: 'Reconciliation Variance',
    chineseName: '对账差异',
    businessDefinition: 'Actual net charges − expected rate-card charges. Not all variance is leakage.',
    formula: 'Actual Net Charges − Expected Charges',
    sourceTables: ['fact_billing_line', 'fact_shipment', 'dim_rate_card'],
    sourceColumns: ['net_amount', 'expected'],
    calculationExample: '$84.7K − $90.4K = −$5.7K',
    interpretation: 'Must be bridged into discounts, credits, timing, leakage, etc.',
    commonCauses: ['Missing billing', 'Credits', 'Rate mismatch'],
    grain: 'Filter window',
    dateBasis: 'Shipment/billing periods in filter',
    includes: 'Signed total gap',
    excludes: 'N/A — decompose before calling leakage',
    actionHint: 'Open Reconciliation Bridge before treating as leakage.',
  },
  unbilled_exposure: {
    ...(KPI_DEFINITIONS.unbilled_exposure as KpiDefinition),
    id: 'unbilled_exposure',
    chineseName: '未计费风险敞口',
    grain: 'Missing-billing exception',
    dateBasis: 'exception detected_date / shipment date',
    includes: 'Open+investigating missing billing expected amounts',
    excludes: 'Resolved; non-missing exception types',
    actionHint: 'Billing queue — create lines from rate cards.',
  },
  open_recoverable_leakage: {
    id: 'open_recoverable_leakage',
    name: 'Open Actionable Recoverable Leakage',
    chineseName: '未关闭可追回漏计费',
    businessDefinition: 'Open/Investigating exceptions of type Missing Billing, Rate Mismatch, Missing Surcharge. Excludes duplicates (customer overcharge risk) and overdue AR.',
    formula: 'SUM(recoverable_amount) WHERE type IN (...) AND status IN (Open, Investigating)',
    sourceTables: ['fact_exception'],
    sourceColumns: ['financial_impact', 'exception_type', 'status'],
    calculationExample: '211 open missing/rate/surcharge cases ~$2K',
    interpretation: 'Actionable recovery pool — not equal to total identified exposure.',
    commonCauses: ['Rating gaps', 'Sync failures'],
    grain: 'Exception',
    dateBasis: 'detected_date in filter',
    includes: 'Recoverable rating defects still open',
    excludes: 'Duplicate billing; Overdue AR; Resolved; High-risk scenario RaR',
    actionHint: 'Prioritize by root-cause rollup in Action Center.',
  },
  confirmed_recoverable_leakage: {
    id: 'confirmed_recoverable_leakage',
    name: 'Confirmed Recoverable Leakage',
    chineseName: '已确认可追回漏计费',
    businessDefinition: 'Exceptions with status Investigating/Pending where rule engine confirmed defect (same recoverable types).',
    formula: 'SUM(impact) WHERE recoverable types AND status=Investigating',
    sourceTables: ['fact_exception'],
    sourceColumns: ['financial_impact', 'status'],
    calculationExample: 'Subset of open pool under active investigation',
    interpretation: 'Higher confidence than newly opened items.',
    commonCauses: ['Validated missing lines'],
    grain: 'Exception',
    dateBasis: 'detected_date',
    includes: 'Investigating recoverable types',
    excludes: 'Open unvalidated; Resolved recovered',
    actionHint: 'Issue debit memos / next-cycle billings.',
  },
  scenario_revenue_at_risk: {
    ...(KPI_DEFINITIONS.revenue_at_risk as KpiDefinition),
    id: 'scenario_revenue_at_risk',
    name: 'Scenario Revenue at Risk',
    chineseName: '情景风险收入',
    grain: 'Customer',
    dateBasis: 'Forward forecast periods after filter end',
    includes: 'Expected future revenue × assumed loss fraction from health bands',
    excludes: 'Confirmed leakage; Overdue AR; Booked losses',
    actionHint: 'Retention QBRs — label as scenario, not churn model.',
  },
  contribution_profit: {
    ...(KPI_DEFINITIONS.contribution_profit as KpiDefinition),
    id: 'contribution_profit',
    chineseName: '贡献利润',
    grain: 'Filter window',
    dateBasis: 'Billing period for revenue; cost accounting_period',
    includes: 'Net billings − variable costs',
    excludes: 'Allocated fixed',
    actionHint: 'Primary unit-economics health metric.',
  },
  contribution_margin: {
    ...(KPI_DEFINITIONS.contribution_margin as KpiDefinition),
    id: 'contribution_margin',
    chineseName: '贡献利润率',
    grain: 'Filter window',
    dateBasis: 'Same as contribution profit',
    includes: 'Contribution / Net billings',
    excludes: 'Operating margin after fixed',
    actionHint: 'Watch mix and DSP inflation.',
  },
  allocated_fixed: {
    id: 'allocated_fixed',
    name: 'Allocated Fixed Operating Expenses',
    chineseName: '分摊固定运营成本',
    businessDefinition:
      'Share of company monthly fixed opex pool allocated by shipment volume. Filter uses original company denominator — does not reallocate 100% of company pool to a single customer filter.',
    formula: 'CompanyFixedPool_period × (SegmentShipments / CompanyShipments_period)',
    sourceTables: ['fact_cost'],
    sourceColumns: ['cost_type=Allocated Fixed', 'amount'],
    calculationExample: 'Pool $9K × customer share 5% = $450',
    interpretation: 'Absorption of network/facility costs; not incremental package cost.',
    commonCauses: ['Utilization', 'Pool size assumption', 'Volume mix'],
    grain: 'Customer × period allocation line',
    dateBasis: 'accounting_period',
    includes: 'Volume-share allocation of Base pool',
    excludes: 'Variable DSP/sorting/etc.',
    actionHint: 'Review utilization before cutting accounts on OP alone.',
  },
  operating_profit: {
    id: 'operating_profit',
    name: 'Operating Profit',
    chineseName: '营业利润',
    businessDefinition: 'Contribution Profit − Allocated Fixed.',
    formula: 'Contribution Profit − Allocated Fixed',
    sourceTables: ['fact_billing_line', 'fact_cost'],
    sourceColumns: ['net_amount', 'amount'],
    calculationExample: '$50K − $27K = $23K',
    interpretation: 'After shared network cost absorption.',
    commonCauses: ['Contribution', 'Fixed pool', 'Utilization'],
    grain: 'Filter window',
    dateBasis: 'Aligned periods',
    includes: 'As formula',
    excludes: 'Below-the-line corporate items not modeled',
    actionHint: 'Separate CM issues from absorption issues.',
  },
  variable_cost: {
    id: 'variable_cost',
    name: 'Variable Cost',
    chineseName: '变动成本',
    businessDefinition: 'DSP + Sorting + Linehaul + Redelivery + Claims + Other Variable.',
    formula: 'SUM(variable cost types)',
    sourceTables: ['fact_cost'],
    sourceColumns: ['cost_type', 'amount'],
    calculationExample: 'DSP $28K + other var $7K',
    interpretation: 'Moves with volume and failure rates.',
    commonCauses: ['DSP rates', 'Failures', 'Claims'],
    grain: 'Cost event',
    dateBasis: 'cost accounting_period',
    includes: 'Listed variable types',
    excludes: 'Allocated fixed',
    actionHint: 'Tie to delivery performance.',
  },
  billing_accuracy: {
    id: 'billing_accuracy',
    name: 'Billing Accuracy',
    chineseName: '计费准确率',
    businessDefinition: 'Billed shipment count / billable shipment count.',
    formula: 'Σ packages in billable lots billed exactly once with no Rate Mismatch / Missing Surcharge / Duplicate ÷ Σ billable packages (ship_date in range)',
    sourceTables: ['fact_shipment', 'fact_billing_line'],
    sourceColumns: ['billable', 'shipment_id'],
    calculationExample: '5299 / 5393 = 98.3%',
    interpretation: 'Operational completeness of billing.',
    commonCauses: ['Missing billing', 'Timing'],
    grain: 'Shipment count',
    dateBasis: 'ship_date in filter',
    includes: 'Counts only',
    excludes: 'Dollar accuracy (see recon variance)',
    actionHint: 'Complement with dollar recon bridge.',
  },
  bookings_tcv: {
    ...(KPI_DEFINITIONS.bookings as KpiDefinition),
    id: 'bookings_tcv',
    chineseName: '合同总价值/成交预订',
    grain: 'Opportunity',
    dateBasis: 'closed_date',
    includes: 'Closed Won opportunity_value',
    excludes: 'Revenue',
    actionHint: 'Sales productivity — not recognized revenue.',
  },
  weighted_pipeline: {
    id: 'weighted_pipeline',
    name: 'Weighted Pipeline',
    chineseName: '加权销售商机',
    businessDefinition: 'Open opportunity value × win probability.',
    formula: 'SUM(value × win_probability) for open stages',
    sourceTables: ['fact_opportunity'],
    sourceColumns: ['opportunity_value', 'win_probability', 'stage'],
    calculationExample: '$2M × avg 40% = $800K weighted',
    interpretation: 'Bookings potential, not revenue.',
    commonCauses: ['Stage mix', 'Win rates'],
    grain: 'Opportunity',
    dateBasis: 'Open as of snapshot',
    includes: 'Non-closed stages',
    excludes: 'Closed Won/Lost',
    actionHint: 'Feed pipeline forecast; not Actual Revenue.',
  },
}

const VARIABLE = new Set([
  'DSP Delivery',
  'Sorting',
  'Linehaul',
  'Redelivery',
  'Claims',
  'Other Variable',
])

// Recoverable types come from the shared Exception Registry (same rule on every page)
const RECOVERABLE_TYPES = RECOVERABLE_EXCEPTION_TYPES as Set<string>

export interface SharedMetrics {
  recognizedRevenue: number
  netBilledRevenue: number
  grossBillings: number
  netInvoiceAmount: number
  cashCollections: number
  overdueAr: number
  accountsReceivable: number
  forecastExisting: number
  forecastPipeline: number
  forecastTotal: number
  /** Comparable Actual (forecast periods, customer scope) − Existing Forecast */
  forecastVarianceExisting: number
  /** Recognized revenue restricted to periods that have Existing forecast rows */
  comparableActual: number
  /** False when filters cannot be applied to forecast rows (Region / Metro / Service) */
  forecastComparable: boolean
  forecastComparableReason: string | null
  forecastComparableNote: string | null
  expectedCharges: number
  reconciliationVariance: number
  unbilledExposure: number
  openRecoverableLeakage: number
  confirmedRecoverableLeakage: number
  scenarioRevenueAtRisk: number
  contributionProfit: number
  contributionMargin: number | null
  allocatedFixed: number
  operatingProfit: number
  variableCost: number
  billingAccuracy: number | null
  bookingsTcv: number
  weightedPipeline: number
}

const sharedMetricsMemo = createCalcMemo<SharedMetrics>(64)

const paidCache = new WeakMap<object, Map<string, number>>()
function paidByInvoiceIndex(data: DataStore): Map<string, number> {
  let m = paidCache.get(data.payments)
  if (!m) {
    m = new Map()
    for (const p of data.payments) m.set(p.invoice_id, (m.get(p.invoice_id) ?? 0) + p.amount)
    paidCache.set(data.payments, m)
  }
  return m
}

export function computeSharedMetrics(
  data: DataStore,
  filters: GlobalFilters,
  scenario: 'Base' | 'Upside' | 'Downside' = 'Base',
): SharedMetrics {
  const key = filterCacheKey(filters, [scenario, `exc:${data.exceptions.length}`])
  const cached = sharedMetricsMemo.get(data, key)
  if (cached) return cached
  return sharedMetricsMemo.set(data, key, computeSharedMetricsFresh(data, filters, scenario))
}

function computeSharedMetricsFresh(
  data: DataStore,
  filters: GlobalFilters,
  scenario: 'Base' | 'Upside' | 'Downside',
): SharedMetrics {
  const lines = filterBillingLines(data, filters)
  const netBilledRevenue = sumMoney(lines.map((l) => l.net_amount))
  const grossBillings = sumMoney(lines.map((l) => l.base_charge + l.fuel_surcharge + l.remote_surcharge))
  const recognizedRevenue = computeRecognizedRevenue(data, filters).amount
  const invoices = filterInvoices(data, filters)
  const netInvoiceAmount = sumMoney(invoices.map((i) => i.net_amount))
  const cashCollections = sumMoney(
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
  const openInvoices = invoices.filter((i) => i.status !== 'Paid')
  const paidByInvoice = paidByInvoiceIndex(data)
  // Overdue AR = outstanding balance (net − payments) of invoices past due as of the snapshot
  const overdueAr = sumMoney(
    invoices
      .filter((i) => i.status === 'Overdue')
      .map((i) => money(Math.max(0, i.net_amount - (paidByInvoice.get(i.invoice_id) ?? 0)))),
  )
  const accountsReceivable = sumMoney(
    openInvoices.map((i) => money(Math.max(0, i.net_amount - (paidByInvoice.get(i.invoice_id) ?? 0)))),
  )

  const forecastExisting = sumMoney(
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
  const forecastPipeline = sumMoney(
    data.forecasts
      .filter(
        (f) =>
          f.scenario === scenario &&
          f.forecast_type === 'Pipeline' &&
          f.accounting_period >= filters.startPeriod &&
          f.accounting_period <= filters.endPeriod,
      )
      .map((f) => f.forecast_recognized),
  )

  // Expected charges: billable lots re-rated with the shared rater (lib/pricing) — same function that billed them
  const integrity = computeBillingIntegrity(data, filters)
  const expectedCharges = integrity.expectedGross

  const exceptions = filterExceptions(data, filters)
  const unbilledExposure = sumMoney(
    exceptions
      .filter((e) => e.exception_type === 'Missing Billing' || e.exception_type === 'Unbilled Packages')
      .map((e) => e.financial_impact),
  )
  const openRecoverableLeakage = sumMoney(
    exceptions
      .filter(
        (e) =>
          RECOVERABLE_TYPES.has(e.exception_type) &&
          (e.status === 'Open' ||
            e.status === 'Investigating' ||
            e.status === 'Pending Approval'),
      )
      .map((e) => e.financial_impact),
  )
  const confirmedRecoverableLeakage = sumMoney(
    exceptions
      .filter((e) => RECOVERABLE_TYPES.has(e.exception_type) && e.status === 'Investigating')
      .map((e) => e.financial_impact),
  )

  const costs = filterCosts(data, filters)
  const variableCost = sumMoney(costs.filter((c) => VARIABLE.has(c.cost_type)).map((c) => c.amount))
  const allocatedFixed = sumMoney(costs.filter((c) => c.cost_type === 'Allocated Fixed').map((c) => c.amount))
  const contributionProfit = money(netBilledRevenue - variableCost)
  const contributionMargin = pct(contributionProfit, netBilledRevenue)
  const operatingProfit = money(contributionProfit - allocatedFixed)


  const fcScope = forecastComparability(data, filters, scenario)
  const sameWindow =
    fcScope.comparableFilters.startPeriod === filters.startPeriod &&
    fcScope.comparableFilters.endPeriod === filters.endPeriod
  const comparableActual = sameWindow
    ? recognizedRevenue
    : computeRecognizedRevenue(data, fcScope.comparableFilters).amount

  // Per-customer health is costly — memoize by snapshot + filter key within session.
  const health = cachedCustomerHealth(data, filters)
  const scenarioRevenueAtRisk = sumMoney(health.map((h) => h.revenueAtRisk))

  const bookingsTcv = sumMoney(
    data.opportunities.filter((o) => o.stage === 'Closed Won').map((o) => o.opportunity_value),
  )
  const weightedPipeline = sumMoney(
    data.opportunities
      .filter((o) => !o.stage.startsWith('Closed'))
      .map((o) => money(o.opportunity_value * o.win_probability)),
  )

  return {
    recognizedRevenue,
    netBilledRevenue,
    grossBillings,
    netInvoiceAmount,
    cashCollections,
    overdueAr,
    accountsReceivable,
    forecastExisting,
    forecastPipeline,
    forecastTotal: money(forecastExisting + forecastPipeline),
    forecastVarianceExisting: money(comparableActual - forecastExisting),
    comparableActual,
    forecastComparable: fcScope.comparable,
    forecastComparableReason: fcScope.reason,
    forecastComparableNote: fcScope.note,
    expectedCharges,
    reconciliationVariance: money(netBilledRevenue - expectedCharges),
    unbilledExposure,
    openRecoverableLeakage,
    confirmedRecoverableLeakage,
    scenarioRevenueAtRisk,
    contributionProfit,
    contributionMargin,
    allocatedFixed,
    operatingProfit,
    variableCost,
    // Package-weighted: eligible billable packages billed exactly once with no rating defect
    billingAccuracy: pct(integrity.correctlyBilledPackages, integrity.eligiblePackages),
    bookingsTcv,
    weightedPipeline,
  }
}
