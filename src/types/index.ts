/** Synthetic Last-Mile Revenue Operations data model */

export type ServiceType = 'Standard' | 'Express' | 'SameDay' | 'Economy'
/** Region → Metro → Station / Hub → ZIP → Route / DSP */
export type RegionCode = 'West' | 'Central' | 'East'
export type OpportunityStage =
  | 'Lead'
  | 'Qualified'
  | 'Proposal'
  | 'Negotiation'
  | 'Closed Won'
  | 'Closed Lost'
export type ExceptionSeverity = 'Critical' | 'High' | 'Medium' | 'Low'
export type ExceptionStatus =
  | 'Open'
  | 'Investigating'
  | 'Pending Approval'
  | 'Resolved'
  | 'Rejected'
  | 'Accepted'
export type ResponsibleTeam = 'Sales' | 'Operations' | 'Billing' | 'Finance' | 'Pricing'
export type ExceptionType =
  | 'Missing Billing'
  | 'Duplicate Billing'
  | 'Rate Mismatch'
  | 'Missing Surcharge'
  | 'Customer Mapping Error'
  | 'Missing Shipment ID'
  | 'Invoice GL Mismatch'
  | 'Timing Difference'
  | 'Credit Memo Adjustment'
  | 'Volume Decline'
  | 'Margin Decline'
  | 'Overdue AR'
  | 'High Risk Customer'
  | 'Unbilled Packages'

export type CustomerLifecycleStatus = 'Onboarding' | 'Active' | 'Expansion' | 'At Risk' | 'Churned'

/** Contracting / Bill-to account. Revenue is always attributed here (never to the brand). */
export interface DimCustomer {
  customer_id: string
  customer_name: string
  industry: string
  segment: 'Enterprise' | 'Mid-Market' | 'SMB'
  /** Home region (customers may ship in several metros / regions) */
  region: RegionCode
  account_owner: string
  status: 'Active' | 'Churned' | 'Prospect'
  acquired_date: string
  /** Parent account (may own several bill-to accounts) */
  parent_account_id: string
  parent_account_name: string
  /** Direct shipper pays for its own parcels; a 3PL pays on behalf of downstream brands */
  customer_type: 'Direct Shipper' | '3PL / Fulfillment'
  /** Public brand name used as an illustrative account only — not a verified customer relationship */
  illustrative: boolean
  activation_date: string
  first_shipment_date: string | null
  churn_date: string | null
  renewal_date: string
  lifecycle_status: CustomerLifecycleStatus
  expected_monthly_volume: number
  contracted_services: ServiceType[]
  home_metro: string
  synthetic: true
}

export interface DimContract {
  contract_id: string
  customer_id: string
  version: number
  start_date: string
  end_date: string
  pricing_model: 'WeightBased' | 'ZoneBased' | 'VolumeTier' | 'FlatRate'
  volume_commitment: number
  payment_terms_days: number
  status: 'Active' | 'Expired' | 'Pending'
  /** Contract bills failed delivery attempts (otherwise failed lots are non-billable) */
  bill_failed_attempts: boolean
  contracted_services: ServiceType[]
  synthetic: true
}

export interface DimRateCard {
  rate_card_id: string
  contract_id: string
  service_type: ServiceType
  region: RegionCode
  base_rate: number
  per_lb_rate: number
  zone_multiplier: number
  volume_tier_min: number
  volume_tier_discount: number
  fuel_surcharge_pct: number
  /** Per remote / residential package */
  remote_surcharge: number
  /** Per package in Nov–Dec (peak season) */
  peak_surcharge: number
  effective_from: string
  effective_to: string
  version: number
  synthetic: true
}

/** Metropolitan delivery market → stations (sort hubs) */
export interface DimStation {
  station_id: string
  station_name: string
  metro: string
  region: RegionCode
  /** Daily package capacity */
  capacity_daily: number
  launch_period: string
  /** Sortation cost per package at standard utilization */
  sort_cost_per_pkg: number
  /** Monthly fixed cost (rent, equipment, salaried staff) */
  fixed_cost_monthly: number
  zip_prefixes: string[]
  dsp_ids: string[]
}

export interface DimDsp {
  dsp_id: string
  dsp_name: string
  metro: string
  /** Contracted cost per delivered stop before density / service adjustments */
  base_cost_per_stop: number
}

/** Brand / merchant whose parcels are shipped — attribute only, never a revenue owner */
export interface DimBrand {
  brand_id: string
  brand_name: string
  /** Bill-to account that pays the carrier */
  customer_id: string
  industry: string
  illustrative: boolean
}

export interface DimRegion {
  region: RegionCode
  zone_count: number
  avg_dsp_cost: number
}

export interface DimService {
  service_type: ServiceType
  description: string
  sla_hours: number
}

export interface DimDate {
  date_key: string
  year: number
  month: number
  quarter: number
  month_label: string
  is_month_end: boolean
}

export interface FactOpportunity {
  opportunity_id: string
  customer_id: string | null
  prospect_name: string
  stage: OpportunityStage
  opportunity_value: number
  win_probability: number
  expected_start_date: string
  expected_monthly_volume: number
  expected_monthly_revenue: number
  created_date: string
  closed_date: string | null
  sales_cycle_days: number | null
  synthetic: true
}

export type OperationalStatus =
  | 'Accepted'
  | 'Sorted'
  | 'Out for Delivery'
  | 'Delivered'
  | 'Failed'
  | 'Returned'

/**
 * Shipment lot: packages of one bill-to customer, brand, station, service and outcome shipped in a
 * month. `package_count` packages share the lot attributes; monetary fields on linked billing lines
 * and costs are lot totals. Counts must SUM(package_count) — never count rows.
 */
export interface FactShipment {
  shipment_id: string
  package_count: number
  station_id: string
  brand_id: string
  customer_id: string
  contract_id: string
  service_type: ServiceType
  region: RegionCode
  metro: string
  zone: number
  /** Average billable weight per package in the lot */
  weight_lbs: number
  ship_date: string
  delivery_date: string | null
  delivery_status: 'Delivered' | 'Failed' | 'Pending' | 'Returned'
  operational_status: OperationalStatus
  first_attempt_success: boolean
  on_time: boolean
  is_remote: boolean
  is_redelivery: boolean
  dsp_id: string
  billable: boolean
  synthetic: true
}

export interface FactBillingLine {
  billing_line_id: string
  shipment_id: string
  /** Packages billed on this line (lot total) */
  package_count: number
  customer_id: string
  contract_id: string
  invoice_id: string | null
  service_type: ServiceType
  region: RegionCode
  billing_date: string
  accounting_period: string
  base_charge: number
  fuel_surcharge: number
  /** Accessorials: remote / residential delivery + peak-season surcharge */
  remote_surcharge: number
  discounts: number
  credits: number
  net_amount: number
  rate_card_id: string
  is_duplicate: boolean
  synthetic: true
}

export interface FactInvoice {
  invoice_id: string
  customer_id: string
  invoice_date: string
  accounting_period: string
  gross_amount: number
  credit_amount: number
  net_amount: number
  status: 'Draft' | 'Issued' | 'Paid' | 'Partial' | 'Overdue'
  due_date: string
  synthetic: true
}

export interface FactCreditMemo {
  credit_memo_id: string
  customer_id: string
  invoice_id: string | null
  shipment_id: string | null
  credit_date: string
  accounting_period: string
  amount: number
  reason: string
  synthetic: true
}

export interface FactPayment {
  payment_id: string
  customer_id: string
  invoice_id: string
  payment_date: string
  amount: number
  method: 'ACH' | 'Wire' | 'Check' | 'Card'
  synthetic: true
}

export interface FactRevenueRecognition {
  rev_rec_id: string
  customer_id: string
  invoice_id: string | null
  billing_line_id: string | null
  shipment_id: string | null
  recognition_date: string
  accounting_period: string
  amount: number
  recognition_type: 'Invoice' | 'Accrual' | 'Deferral Release' | 'Credit'
  gl_account: string
  synthetic: true
}

export interface FactGeneralLedger {
  gl_entry_id: string
  accounting_period: string
  entry_date: string
  account_code: string
  account_name: string
  debit: number
  credit: number
  customer_id: string | null
  rev_rec_id: string | null
  invoice_id: string | null
  description: string
  synthetic: true
}

export interface FactCost {
  cost_id: string
  shipment_id: string | null
  customer_id: string | null
  region: RegionCode
  service_type: ServiceType | null
  dsp_id: string | null
  cost_date: string
  accounting_period: string
  station_id: string | null
  /** Fixed-cost pool for 'Allocated Fixed' rows */
  fixed_pool: 'Station' | 'Corporate' | null
  cost_type:
    | 'DSP Delivery'
    | 'Sorting'
    | 'Linehaul'
    | 'Redelivery'
    | 'Claims'
    | 'Other Variable'
    | 'Allocated Fixed'
  amount: number
  synthetic: true
}

export interface FactForecast {
  forecast_id: string
  customer_id: string | null
  /** Snapshot the forecast came from (created before the target month's actuals exist) */
  forecast_version: string
  created_date: string
  /** 1 = target month is the creation month */
  horizon_months: number
  method: 'Run-rate driver' | 'Weighted pipeline'
  opportunity_id: string | null
  accounting_period: string
  scenario: 'Base' | 'Upside' | 'Downside'
  forecast_type: 'Existing' | 'Pipeline' | 'Total'
  forecast_volume: number
  forecast_avg_rate: number
  forecast_surcharges: number
  forecast_credits: number
  forecast_net_billing: number
  forecast_recognized: number
  synthetic: true
}

export interface FactException {
  exception_id: string
  exception_type: ExceptionType
  customer_id: string | null
  shipment_id: string | null
  invoice_id: string | null
  billing_line_id: string | null
  expected_amount: number
  actual_amount: number
  difference: number
  severity: ExceptionSeverity
  root_cause: string
  trigger_rule: string
  owner: ResponsibleTeam
  status: ExceptionStatus
  resolution_notes: string
  recommended_action: string
  detected_date: string
  resolved_date: string | null
  metro: string | null
  service_type: ServiceType | null
  financial_impact: number
  synthetic: true
}

export interface FactOpportunityStageEvent {
  event_id: string
  opportunity_id: string
  from_stage: OpportunityStage | null
  to_stage: OpportunityStage
  event_date: string
  synthetic: true
}

export interface DataStore {
  meta: {
    generated_at: string
    seed: number
    snapshot_label: string
    is_synthetic: true
    disclaimer: string
    fixed_opex_pool_monthly_base: number
    fixed_opex_pool_monthly_downside: number
    fixed_opex_basis: string
    data_version: string
    history_start: string
    history_end: string
    /** As-of date for AR aging / open items */
    as_of_date: string
    scale_note: string
  }
  customers: DimCustomer[]
  brands: DimBrand[]
  stations: DimStation[]
  dsps: DimDsp[]
  contracts: DimContract[]
  rateCards: DimRateCard[]
  regions: DimRegion[]
  services: DimService[]
  dates: DimDate[]
  opportunities: FactOpportunity[]
  opportunityStageEvents: FactOpportunityStageEvent[]
  shipments: FactShipment[]
  billingLines: FactBillingLine[]
  invoices: FactInvoice[]
  creditMemos: FactCreditMemo[]
  payments: FactPayment[]
  revenueRecognition: FactRevenueRecognition[]
  generalLedger: FactGeneralLedger[]
  costs: FactCost[]
  /** Official forecast per target month (horizon-1 snapshot; latest version for future months) */
  forecasts: FactForecast[]
  /** Every forecast version × horizon — for accuracy-by-horizon analysis */
  forecastSnapshots: FactForecast[]
  exceptions: FactException[]
}

export interface GlobalFilters {
  startPeriod: string
  endPeriod: string
  customerIds: string[]
  regions: RegionCode[]
  /** Optional metro names (e.g. Houston). Empty = all metros in selected regions. */
  metros: string[]
  /** Optional station IDs (sort hubs). Empty = all stations in selected metros. */
  stations?: string[]
  serviceTypes: ServiceType[]
  snapshot: string
}

export interface ForecastScenarioParams {
  volumeGrowth: number
  avgRateChange: number
  churnRate: number
  surchargeRate: number
  creditRate: number
}

export interface KpiDefinition {
  id: string
  name: string
  businessDefinition: string
  formula: string
  sourceTables: string[]
  sourceColumns: string[]
  calculationExample: string
  interpretation: string
  commonCauses: string[]
}

export interface DrillNode {
  level: 'company' | 'customer' | 'invoice' | 'billing_line' | 'shipment' | 'gl' | 'rate_card'
  id: string
  label: string
}
