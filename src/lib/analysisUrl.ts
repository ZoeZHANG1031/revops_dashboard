import type { GlobalFilters, RegionCode, ServiceType } from '@/types'

export type DateBasis =
  | 'recognition'
  | 'billing'
  | 'shipment'
  | 'invoice'
  | 'payment'
  | 'forecast_target'

export interface AnalysisQuery {
  filters: Partial<GlobalFilters>
  scenario?: 'Base' | 'Upside' | 'Downside'
  dateBasis?: DateBasis
  focusCustomerId?: string
  focusExceptionType?: string
  focusExceptionStatus?: string
  entityType?: EntityType
  entityId?: string
  highlightCustomerId?: string
  sourcePage?: string
  investigationId?: string
  toast?: string
  /** Page-local portfolio focus, e.g. `band:Critical` or `driver:volume` (not sticky) */
  portfolioFocus?: string
}

export type EntityType =
  | 'customer'
  | 'contract'
  | 'opportunity'
  | 'shipment'
  | 'rate_card'
  | 'billing_line'
  | 'invoice'
  | 'recognition'
  | 'gl'
  | 'payment'
  | 'cost'
  | 'exception'
  | 'forecast'

export function parseAnalysisSearch(search: string): AnalysisQuery {
  const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const customer = sp.get('customer')
  const region = sp.get('region') as RegionCode | null
  const service = sp.get('service') as ServiceType | null
  const scenario = sp.get('scenario') as AnalysisQuery['scenario'] | null
  const dateBasis = sp.get('dateBasis') as DateBasis | null
  const metro = sp.get('metro')
  const station = sp.get('station')
  return {
    filters: {
      startPeriod: sp.get('from') ?? undefined,
      endPeriod: sp.get('to') ?? undefined,
      customerIds: customer ? [customer] : undefined,
      regions: region ? [region] : undefined,
      metros: metro ? [metro] : undefined,
      stations: station ? [station] : undefined,
      serviceTypes: service ? [service] : undefined,
      snapshot: sp.get('snapshot') ?? undefined,
    },
    scenario: scenario ?? undefined,
    dateBasis: dateBasis ?? undefined,
    focusCustomerId: sp.get('focusCustomer') ?? undefined,
    focusExceptionType: sp.get('excType') ?? undefined,
    focusExceptionStatus: sp.get('excStatus') ?? undefined,
    entityType: (sp.get('entityType') as EntityType | null) ?? undefined,
    entityId: sp.get('entityId') ?? undefined,
    highlightCustomerId: sp.get('hlCustomer') ?? undefined,
    sourcePage: sp.get('fromPage') ?? undefined,
    investigationId: sp.get('guide') ?? undefined,
    toast: sp.get('toast') ?? undefined,
    portfolioFocus: sp.get('focus') ?? undefined,
  }
}

export function buildAnalysisSearch(
  filters: GlobalFilters,
  extras: {
    scenario?: string
    dateBasis?: DateBasis
    focusCustomerId?: string | null
    focusExceptionType?: string | null
    focusExceptionStatus?: string | null
    entityType?: EntityType | null
    entityId?: string | null
    highlightCustomerId?: string | null
    sourcePage?: string | null
    investigationId?: string | null
    toast?: string | null
    portfolioFocus?: string | null
  } = {},
): string {
  const sp = new URLSearchParams()
  sp.set('from', filters.startPeriod)
  sp.set('to', filters.endPeriod)
  if (filters.customerIds[0]) sp.set('customer', filters.customerIds[0])
  if (filters.regions[0]) sp.set('region', filters.regions[0])
  if (filters.metros?.[0]) sp.set('metro', filters.metros[0])
  if (filters.stations?.[0]) sp.set('station', filters.stations[0])
  if (filters.serviceTypes[0]) sp.set('service', filters.serviceTypes[0])
  if (filters.snapshot) sp.set('snapshot', filters.snapshot)
  if (extras.scenario) sp.set('scenario', extras.scenario)
  if (extras.dateBasis) sp.set('dateBasis', extras.dateBasis)
  if (extras.focusCustomerId) sp.set('focusCustomer', extras.focusCustomerId)
  if (extras.focusExceptionType) sp.set('excType', extras.focusExceptionType)
  if (extras.focusExceptionStatus) sp.set('excStatus', extras.focusExceptionStatus)
  if (extras.entityType) sp.set('entityType', extras.entityType)
  if (extras.entityId) sp.set('entityId', extras.entityId)
  if (extras.highlightCustomerId) sp.set('hlCustomer', extras.highlightCustomerId)
  if (extras.sourcePage) sp.set('fromPage', extras.sourcePage)
  if (extras.investigationId) sp.set('guide', extras.investigationId)
  if (extras.toast) sp.set('toast', extras.toast)
  if (extras.portfolioFocus) sp.set('focus', extras.portfolioFocus)
  return sp.toString()
}

export const ROUTE_BY_INTENT = {
  recognized: '/lifecycle',
  billing: '/reconciliation',
  unbilled: '/reconciliation',
  forecast: '/forecasting',
  customers: '/customers',
  customer360: '/customer-360',
  unit: '/unit-economics',
  overview: '/',
} as const
