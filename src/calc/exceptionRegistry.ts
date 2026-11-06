import type { ExceptionType, FactException, ResponsibleTeam } from '@/types'

/**
 * Single source of truth for exception semantics. Every page (Executive, Lifecycle, Reconciliation,
 * Customer 360, Action Priority) classifies exceptions through this registry so counts and exposure
 * classes agree.
 */
export type ExposureClass =
  | 'Recoverable Billing Exposure'
  | 'Billing Correction'
  | 'Collections Exposure'
  | 'Customer Revenue Risk'
  | 'Margin Pressure'
  | 'Timing / Adjustment'
  | 'Data Quality'

export interface ExceptionDefinition {
  typeId: string
  type: ExceptionType
  definition: string
  detectionRule: string
  sourceData: string
  impactLogic: string
  recoverability: string
  /** True only when resolving the exception can add billable revenue */
  recoverable: boolean
  exposureClass: ExposureClass
  defaultOwner: ResponsibleTeam
  lifecycleStage: 'contract' | 'shipment' | 'rating' | 'billing' | 'recognition' | 'collection' | 'customer'
}

export const EXCEPTION_REGISTRY: Record<ExceptionType, ExceptionDefinition> = {
  'Missing Billing': {
    typeId: 'EX-BIL-01',
    type: 'Missing Billing',
    definition: 'Billable shipment with no billing line',
    detectionRule: 'shipment.billable = true AND no non-duplicate billing_line for shipment_id',
    sourceData: 'fact_shipment, fact_billing_line',
    impactLogic: 'expected_amount from effective rate card',
    recoverability: 'High — re-bill from rate card',
    recoverable: true,
    exposureClass: 'Recoverable Billing Exposure',
    defaultOwner: 'Billing',
    lifecycleStage: 'billing',
  },
  'Unbilled Packages': {
    typeId: 'EX-BIL-02',
    type: 'Unbilled Packages',
    definition: 'Delivered packages not yet invoiced past cut-off',
    detectionRule: 'delivered AND billable AND billing_date missing after cut-off',
    sourceData: 'fact_shipment, fact_billing_line',
    impactLogic: 'expected charge per package',
    recoverability: 'High — invoice in next cycle',
    recoverable: true,
    exposureClass: 'Recoverable Billing Exposure',
    defaultOwner: 'Billing',
    lifecycleStage: 'billing',
  },
  'Rate Mismatch': {
    typeId: 'EX-RAT-01',
    type: 'Rate Mismatch',
    definition: 'Billed base charge differs from effective rate card',
    detectionRule: '|billed base − rate-card base on ship_date| > tolerance',
    sourceData: 'fact_billing_line, dim_rate_card',
    impactLogic: 'expected − actual base (positive = under-billed)',
    recoverability: 'High when under-billed; over-billing is a credit',
    recoverable: true,
    exposureClass: 'Recoverable Billing Exposure',
    defaultOwner: 'Pricing',
    lifecycleStage: 'rating',
  },
  'Missing Surcharge': {
    typeId: 'EX-RAT-02',
    type: 'Missing Surcharge',
    definition: 'Fuel / remote surcharge omitted on an eligible line',
    detectionRule: 'eligible (is_remote or fuel %) AND surcharge = 0',
    sourceData: 'fact_billing_line, dim_rate_card, fact_shipment',
    impactLogic: 'expected surcharge amount',
    recoverability: 'High — re-rate surcharge',
    recoverable: true,
    exposureClass: 'Recoverable Billing Exposure',
    defaultOwner: 'Billing',
    lifecycleStage: 'rating',
  },
  'Duplicate Billing': {
    typeId: 'EX-BIL-03',
    type: 'Duplicate Billing',
    definition: 'Same shipment billed more than once',
    detectionRule: 'billing_line.is_duplicate = true (fingerprint match)',
    sourceData: 'fact_billing_line',
    impactLogic: 'duplicate line net_amount (customer over-billed)',
    recoverability: 'None — refund / credit risk, not revenue recovery',
    recoverable: false,
    exposureClass: 'Billing Correction',
    defaultOwner: 'Billing',
    lifecycleStage: 'billing',
  },
  'Timing Difference': {
    typeId: 'EX-REC-01',
    type: 'Timing Difference',
    definition: 'Shipped in one period, billed / recognized in another',
    detectionRule: 'ship period ≠ billing accounting_period',
    sourceData: 'fact_shipment, fact_billing_line, fact_revenue_recognition',
    impactLogic: 'amount shifted across periods',
    recoverability: 'N/A — accounting cut-off, not leakage',
    recoverable: false,
    exposureClass: 'Timing / Adjustment',
    defaultOwner: 'Finance',
    lifecycleStage: 'recognition',
  },
  'Credit Memo Adjustment': {
    typeId: 'EX-REC-02',
    type: 'Credit Memo Adjustment',
    definition: 'Documented credit memo reducing invoice',
    detectionRule: 'credit_memo linked to invoice in period',
    sourceData: 'fact_credit_memo, fact_invoice',
    impactLogic: 'credit memo amount',
    recoverability: 'N/A — approved commercial adjustment',
    recoverable: false,
    exposureClass: 'Timing / Adjustment',
    defaultOwner: 'Finance',
    lifecycleStage: 'recognition',
  },
  'Invoice GL Mismatch': {
    typeId: 'EX-REC-03',
    type: 'Invoice GL Mismatch',
    definition: 'Invoice net does not match posted GL revenue',
    detectionRule: '|invoice net − GL credit| > tolerance',
    sourceData: 'fact_invoice, fact_general_ledger',
    impactLogic: 'absolute difference',
    recoverability: 'Investigate — posting error',
    recoverable: false,
    exposureClass: 'Data Quality',
    defaultOwner: 'Finance',
    lifecycleStage: 'recognition',
  },
  'Customer Mapping Error': {
    typeId: 'EX-DQ-01',
    type: 'Customer Mapping Error',
    definition: 'Record linked to wrong / unknown customer',
    detectionRule: 'customer_id not in dim_customer or contract mismatch',
    sourceData: 'fact_shipment, dim_customer, dim_contract',
    impactLogic: 'affected amount',
    recoverability: 'Investigate — master data',
    recoverable: false,
    exposureClass: 'Data Quality',
    defaultOwner: 'Operations',
    lifecycleStage: 'contract',
  },
  'Missing Shipment ID': {
    typeId: 'EX-DQ-02',
    type: 'Missing Shipment ID',
    definition: 'Billing or cost row without shipment reference',
    detectionRule: 'shipment_id IS NULL on line-level record',
    sourceData: 'fact_billing_line, fact_cost',
    impactLogic: 'affected amount',
    recoverability: 'Investigate — data lineage',
    recoverable: false,
    exposureClass: 'Data Quality',
    defaultOwner: 'Operations',
    lifecycleStage: 'shipment',
  },
  'Overdue AR': {
    typeId: 'EX-COL-01',
    type: 'Overdue AR',
    definition: 'Invoice unpaid past due date',
    detectionRule: 'invoice.status = Overdue (as-of > due_date)',
    sourceData: 'fact_invoice, fact_payment',
    impactLogic: 'invoice net outstanding',
    recoverability: 'Collections — cash, not revenue recovery',
    recoverable: false,
    exposureClass: 'Collections Exposure',
    defaultOwner: 'Finance',
    lifecycleStage: 'collection',
  },
  'High Risk Customer': {
    typeId: 'EX-CUS-01',
    type: 'High Risk Customer',
    definition: 'Customer health below risk threshold',
    detectionRule: 'health score < threshold (assumption weights)',
    sourceData: 'derived: customer health',
    impactLogic: 'scenario revenue at risk (not booked)',
    recoverability: 'Retention — forward revenue risk',
    recoverable: false,
    exposureClass: 'Customer Revenue Risk',
    defaultOwner: 'Sales',
    lifecycleStage: 'customer',
  },
  'Volume Decline': {
    typeId: 'EX-CUS-02',
    type: 'Volume Decline',
    definition: 'Customer volume down vs prior window',
    detectionRule: 'late-window volume < early-window volume by threshold',
    sourceData: 'fact_shipment',
    impactLogic: 'lost run-rate revenue (estimate)',
    recoverability: 'Retention — forward revenue risk',
    recoverable: false,
    exposureClass: 'Customer Revenue Risk',
    defaultOwner: 'Sales',
    lifecycleStage: 'customer',
  },
  'Margin Decline': {
    typeId: 'EX-MAR-01',
    type: 'Margin Decline',
    definition: 'Contribution margin down vs prior window',
    detectionRule: 'CM late − CM early < threshold',
    sourceData: 'fact_billing_line, fact_cost',
    impactLogic: 'contribution shortfall',
    recoverability: 'Pricing / cost action',
    recoverable: false,
    exposureClass: 'Margin Pressure',
    defaultOwner: 'Pricing',
    lifecycleStage: 'customer',
  },
}

export const RECOVERABLE_EXCEPTION_TYPES = new Set<ExceptionType>(
  (Object.values(EXCEPTION_REGISTRY) as ExceptionDefinition[]).filter((d) => d.recoverable).map((d) => d.type),
)

export const OPEN_EXCEPTION_STATUSES = new Set(['Open', 'Investigating', 'Pending Approval'])

export function isOpenException(e: FactException): boolean {
  return OPEN_EXCEPTION_STATUSES.has(e.status)
}

export function exceptionDef(type: ExceptionType): ExceptionDefinition {
  return EXCEPTION_REGISTRY[type]
}

/** Open exposure split by exposure class — classes are NOT additive into a single "loss". */
export function exposureByClass(exceptions: FactException[]): Record<ExposureClass, { amount: number; cases: number }> {
  const out = {} as Record<ExposureClass, { amount: number; cases: number }>
  for (const d of Object.values(EXCEPTION_REGISTRY) as ExceptionDefinition[]) {
    out[d.exposureClass] ??= { amount: 0, cases: 0 }
  }
  for (const e of exceptions) {
    if (!isOpenException(e)) continue
    const cls = EXCEPTION_REGISTRY[e.exception_type]?.exposureClass ?? 'Data Quality'
    out[cls].amount = Math.round((out[cls].amount + e.financial_impact) * 100) / 100
    out[cls].cases += 1
  }
  return out
}
