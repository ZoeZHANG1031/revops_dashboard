import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { computeCompanyOverview } from '@/calc/companyOverview'
import { DEFAULT_SCENARIO_PARAMS } from '@/calc/forecast'
import { DEFAULT_HEALTH_WEIGHTS, type HealthWeights } from '@/calc/customerHealth'
import { computeSharedMetrics } from '@/calc/metricRegistry'
import { getDataStore } from '@/data/generate'
import {
  buildAnalysisSearch,
  parseAnalysisSearch,
  type DateBasis,
  type EntityType,
  ROUTE_BY_INTENT,
} from '@/lib/analysisUrl'
import { defaultFilters, listHistoricalPeriods, listPeriods } from '@/lib/filters'
import type {
  DataStore,
  DrillNode,
  ExceptionStatus,
  ForecastScenarioParams,
  GlobalFilters,
  RegionCode,
  ServiceType,
} from '@/types'

export interface OpenEntityState {
  entityType: EntityType | 'kpi'
  entityId: string
  label?: string
  actions?: { label: string; onClick: () => void }[]
}

export interface LocalAnalysisFilters {
  exceptionType: string | null
  exceptionStatus: string | null
  pipelineStage: string | null
  costType: string | null
}

export interface InvestigationStep {
  id: string
  label: string
  path: string
}

export interface InvestigationState {
  id: string | null
  title: string | null
  sourcePage: string | null
  steps: InvestigationStep[]
  stepIndex: number
  toast: string | null
}

export interface NavigateExtras {
  customerId?: string | null
  region?: string | null
  metro?: string | null
  station?: string | null
  serviceType?: string | null
  startPeriod?: string | null
  endPeriod?: string | null
  exceptionType?: string | null
  exceptionStatus?: string | null
  highlightCustomerId?: string | null
  openEntity?: OpenEntityState | null
  sourcePage?: string | null
  investigationId?: string | null
  investigationTitle?: string | null
  investigationSteps?: InvestigationStep[]
  investigationStepIndex?: number
  toast?: string | null
  /** Clear only temporary selection objects without wiping global filters */
  clearDrillContext?: boolean
}

/** Snapshot of the analysis context before a cross-page jump — restored by navigateBack */
export interface NavPathEntry {
  path: string
  search: string
  filters: GlobalFilters
  localFilters: LocalAnalysisFilters
  highlightCustomerId: string | null
  scenario: 'Base' | 'Upside' | 'Downside'
}

const NAV_PATH_LIMIT = 8

interface AppContextValue {
  data: DataStore
  filters: GlobalFilters
  setFilters: (f: GlobalFilters | ((prev: GlobalFilters) => GlobalFilters)) => void
  /** Clears business filters to defaults; keeps page-local chart UI alone. */
  clearFilters: () => void
  /** Alias of clearFilters for legacy callers. */
  resetFilters: () => void
  /** Clears temporary selection (customer highlight, entity drawer, local exception focus). */
  clearSelection: () => void
  scenario: 'Base' | 'Upside' | 'Downside'
  setScenario: (s: 'Base' | 'Upside' | 'Downside') => void
  scenarioParams: ForecastScenarioParams
  setScenarioParams: (p: ForecastScenarioParams) => void
  healthWeights: HealthWeights
  setHealthWeights: (w: HealthWeights) => void
  drillStack: DrillNode[]
  pushDrill: (node: DrillNode) => void
  popDrill: () => void
  clearDrill: () => void
  periods: string[]
  dateBasis: DateBasis
  setDateBasis: (d: DateBasis) => void
  localFilters: LocalAnalysisFilters
  setLocalFilters: (
    f: LocalAnalysisFilters | ((prev: LocalAnalysisFilters) => LocalAnalysisFilters),
  ) => void
  highlightCustomerId: string | null
  setHighlightCustomerId: (id: string | null) => void
  openEntity: OpenEntityState | null
  openEntityDrawer: (state: OpenEntityState) => void
  closeEntity: () => void
  navigateToEntity: (type: EntityType | 'kpi', id: string, label?: string) => void
  navigateWithContext: (path: string, extras?: NavigateExtras) => void
  updateExceptionStatus: (exceptionId: string, status: ExceptionStatus) => void
  analysisTrail: { entityType: EntityType | 'kpi'; entityId: string; label: string }[]
  popAnalysisTrail: () => void
  investigation: InvestigationState
  setInvestigation: (s: InvestigationState | ((prev: InvestigationState) => InvestigationState)) => void
  clearInvestigation: () => void
  dismissToast: () => void
  contextFeedback: string | null
  /** Drill-down path of previous pages (oldest first) */
  navPath: NavPathEntry[]
  /** Return to navPath[index], restoring its filters, local filters and selection */
  navigateBack: (index?: number) => void
  /** Clears page-local filters (exception type/status, pipeline stage, cost type) only */
  clearLocalFilters: () => void
  /** Unified Customer 360 entry — keeps global filters, highlights the customer, records path */
  openCustomer360: (customerId: string) => void
}

const AppContext = createContext<AppContextValue | null>(null)

const DEFAULT_LOCAL: LocalAnalysisFilters = {
  exceptionType: null,
  exceptionStatus: null,
  pipelineStage: null,
  costType: null,
}

const DEFAULT_INVESTIGATION: InvestigationState = {
  id: null,
  title: null,
  sourcePage: null,
  steps: [],
  stepIndex: 0,
  toast: null,
}

function applyExceptionOverrides(
  store: DataStore,
  overrides: Record<string, ExceptionStatus>,
): DataStore {
  if (Object.keys(overrides).length === 0) return store
  return {
    ...store,
    exceptions: store.exceptions.map((e) =>
      overrides[e.exception_id] ? { ...e, status: overrides[e.exception_id] } : e,
    ),
  }
}

/** Must render inside BrowserRouter */
export function AppProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const syncingFromUrl = useRef(false)
  const bootstrapped = useRef(false)

  const baseData = useMemo(() => getDataStore(), [])
  const periods = useMemo(() => listPeriods(baseData), [baseData])
  const historicalPeriods = useMemo(() => listHistoricalPeriods(baseData), [baseData])
  const defaultFilt = useMemo(
    () => defaultFilters(periods, historicalPeriods[historicalPeriods.length - 1]),
    [periods, historicalPeriods],
  )

  const [filters, setFiltersState] = useState<GlobalFilters>(defaultFilt)
  const [scenario, setScenarioState] = useState<'Base' | 'Upside' | 'Downside'>('Base')
  const [scenarioParams, setScenarioParams] = useState<ForecastScenarioParams>(
    DEFAULT_SCENARIO_PARAMS.Base,
  )
  const [healthWeights, setHealthWeights] = useState<HealthWeights>(DEFAULT_HEALTH_WEIGHTS)
  const [drillStack, setDrillStack] = useState<DrillNode[]>([])
  const [dateBasis, setDateBasis] = useState<DateBasis>('recognition')
  const [localFilters, setLocalFilters] = useState<LocalAnalysisFilters>(DEFAULT_LOCAL)
  const [highlightCustomerId, setHighlightCustomerId] = useState<string | null>(null)
  const [openEntity, setOpenEntity] = useState<OpenEntityState | null>(null)
  const [analysisTrail, setAnalysisTrail] = useState<
    { entityType: EntityType | 'kpi'; entityId: string; label: string }[]
  >([])
  const [exceptionOverrides, setExceptionOverrides] = useState<Record<string, ExceptionStatus>>({})
  const [investigation, setInvestigationState] = useState<InvestigationState>(DEFAULT_INVESTIGATION)
  const [contextFeedback, setContextFeedback] = useState<string | null>(null)
  const [navPath, setNavPath] = useState<NavPathEntry[]>([])

  const data = useMemo(
    () => applyExceptionOverrides(baseData, exceptionOverrides),
    [baseData, exceptionOverrides],
  )

  // Bootstrap + hydrate from URL (preserve object identity when values unchanged —
  // otherwise every navigateWithContext double-triggers heavy page recomputes)
  useEffect(() => {
    const q = parseAnalysisSearch(searchParams.toString())
    syncingFromUrl.current = true
    setFiltersState((prev) => {
      const next: GlobalFilters = {
        startPeriod: q.filters.startPeriod ?? prev.startPeriod,
        endPeriod: q.filters.endPeriod ?? prev.endPeriod,
        customerIds: q.filters.customerIds ?? prev.customerIds,
        regions: q.filters.regions ?? prev.regions,
        metros: q.filters.metros ?? prev.metros ?? [],
        stations: q.filters.stations ?? prev.stations ?? [],
        serviceTypes: q.filters.serviceTypes ?? prev.serviceTypes,
        snapshot: baseData.meta.snapshot_label,
      }
      if (
        prev.startPeriod === next.startPeriod &&
        prev.endPeriod === next.endPeriod &&
        prev.snapshot === next.snapshot &&
        prev.customerIds.join('|') === next.customerIds.join('|') &&
        prev.regions.join('|') === next.regions.join('|') &&
        (prev.metros ?? []).join('|') === next.metros.join('|') &&
        (prev.stations ?? []).join('|') === (next.stations ?? []).join('|') &&
        prev.serviceTypes.join('|') === next.serviceTypes.join('|')
      ) {
        return prev
      }
      return next
    })
    if (q.scenario) {
      setScenarioState((prev) => (prev === q.scenario ? prev : q.scenario!))
      setScenarioParams(DEFAULT_SCENARIO_PARAMS[q.scenario])
    }
    if (q.dateBasis) setDateBasis((prev) => (prev === q.dateBasis ? prev : q.dateBasis!))
    if (q.focusExceptionType || q.focusExceptionStatus) {
      setLocalFilters((prev) => {
        const exceptionType = q.focusExceptionType ?? prev.exceptionType
        const exceptionStatus = q.focusExceptionStatus ?? prev.exceptionStatus
        if (exceptionType === prev.exceptionType && exceptionStatus === prev.exceptionStatus) {
          return prev
        }
        return { ...prev, exceptionType, exceptionStatus }
      })
    }
    const hl = q.highlightCustomerId ?? q.filters.customerIds?.[0] ?? null
    if (hl) setHighlightCustomerId((prev) => (prev === hl ? prev : hl))
    if (q.entityType && q.entityId) {
      setOpenEntity((prev) =>
        prev && prev.entityType === q.entityType && prev.entityId === q.entityId
          ? prev
          : { entityType: q.entityType!, entityId: q.entityId! },
      )
    }
    if (q.sourcePage || q.investigationId || q.toast) {
      setInvestigationState((prev) => ({
        ...prev,
        sourcePage: q.sourcePage ?? prev.sourcePage,
        id: q.investigationId ?? prev.id,
        toast: q.toast ?? prev.toast,
      }))
      if (q.toast) setContextFeedback(decodeURIComponent(q.toast))
    }
    bootstrapped.current = true
    queueMicrotask(() => {
      syncingFromUrl.current = false
    })
    // Only on first mount / explicit search change from browser nav
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])

  // Sync-warm default-scope aggregates so the landing page hits memo on first paint
  useMemo(() => {
    computeCompanyOverview(baseData, defaultFilt)
    computeSharedMetrics(baseData, defaultFilt, 'Base')
  }, [baseData, defaultFilt])

  const writeUrl = useCallback(
    (
      nextFilters: GlobalFilters,
      nextScenario: string,
      nextDateBasis: DateBasis,
      nextLocal: LocalAnalysisFilters,
      nextHighlight: string | null,
      nextEntity: OpenEntityState | null,
      inv: InvestigationState = investigation,
      replace = true,
    ) => {
      if (syncingFromUrl.current || !bootstrapped.current) return
      const qs = buildAnalysisSearch(nextFilters, {
        scenario: nextScenario,
        dateBasis: nextDateBasis,
        focusExceptionType: nextLocal.exceptionType,
        focusExceptionStatus: nextLocal.exceptionStatus,
        highlightCustomerId: nextHighlight,
        entityType:
          nextEntity && nextEntity.entityType !== 'kpi'
            ? (nextEntity.entityType as EntityType)
            : null,
        entityId: nextEntity && nextEntity.entityType !== 'kpi' ? nextEntity.entityId : null,
        sourcePage: inv.sourcePage,
        investigationId: inv.id,
        toast: inv.toast,
      })
      const current = searchParams.toString()
      if (qs === current) return
      setSearchParams(qs, { replace })
    },
    [searchParams, setSearchParams, investigation],
  )

  const setFilters = useCallback(
    (f: GlobalFilters | ((prev: GlobalFilters) => GlobalFilters)) => {
      setFiltersState((prev) => {
        const next = typeof f === 'function' ? f(prev) : f
        const normalized: GlobalFilters = {
          ...next,
          metros: next.metros ?? [],
          stations: next.stations ?? [],
        }
        writeUrl(normalized, scenario, dateBasis, localFilters, highlightCustomerId, openEntity)
        return normalized
      })
    },
    [writeUrl, scenario, dateBasis, localFilters, highlightCustomerId, openEntity],
  )

  const clearFilters = useCallback(() => {
    setFiltersState(defaultFilt)
    setLocalFilters(DEFAULT_LOCAL)
    setHighlightCustomerId(null)
    setOpenEntity(null)
    setAnalysisTrail([])
    setDrillStack([])
    setScenarioState('Base')
    setScenarioParams(DEFAULT_SCENARIO_PARAMS.Base)
    setDateBasis('recognition')
    setInvestigationState(DEFAULT_INVESTIGATION)
    setNavPath([])
    setContextFeedback('Reset to company defaults')
    writeUrl(defaultFilt, 'Base', 'recognition', DEFAULT_LOCAL, null, null, DEFAULT_INVESTIGATION)
  }, [defaultFilt, writeUrl])

  const clearSelection = useCallback(() => {
    setHighlightCustomerId(null)
    setOpenEntity(null)
    setAnalysisTrail([])
    setLocalFilters((prev) => ({
      ...prev,
      exceptionType: null,
      exceptionStatus: null,
      pipelineStage: null,
      costType: null,
    }))
    setFiltersState((prev) => {
      const next = { ...prev, customerIds: [] as string[] }
      writeUrl(next, scenario, dateBasis, DEFAULT_LOCAL, null, null)
      return next
    })
    setContextFeedback('Selection cleared (global filters retained)')
  }, [writeUrl, scenario, dateBasis])

  const openEntityDrawer = useCallback(
    (state: OpenEntityState) => {
      setOpenEntity(state)
      setAnalysisTrail((prev) => {
        const label = state.label ?? state.entityId
        const last = prev[prev.length - 1]
        if (last && last.entityType === state.entityType && last.entityId === state.entityId) {
          return prev
        }
        return [...prev, { entityType: state.entityType, entityId: state.entityId, label }]
      })
      writeUrl(filters, scenario, dateBasis, localFilters, highlightCustomerId, state, investigation, false)
    },
    [writeUrl, filters, scenario, dateBasis, localFilters, highlightCustomerId, investigation],
  )

  const closeEntity = useCallback(() => {
    setOpenEntity(null)
    writeUrl(filters, scenario, dateBasis, localFilters, highlightCustomerId, null)
  }, [writeUrl, filters, scenario, dateBasis, localFilters, highlightCustomerId])

  const navigateToEntity = useCallback(
    (type: EntityType | 'kpi', id: string, label?: string) => {
      openEntityDrawer({ entityType: type, entityId: id, label })
    },
    [openEntityDrawer],
  )

  const navigateWithContext = useCallback(
    (path: string, extras: NavigateExtras = {}) => {
      const nextFilters: GlobalFilters = {
        ...filters,
        customerIds: extras.customerId
          ? [extras.customerId]
          : extras.customerId === null
            ? []
            : filters.customerIds,
        regions: extras.region
          ? ([extras.region] as RegionCode[])
          : extras.region === null
            ? []
            : filters.regions,
        metros:
          extras.metro !== undefined
            ? extras.metro
              ? [extras.metro]
              : []
            : (filters.metros ?? []),
        stations:
          extras.station !== undefined
            ? extras.station
              ? [extras.station]
              : []
            : (filters.stations ?? []),
        serviceTypes: extras.serviceType
          ? ([extras.serviceType] as ServiceType[])
          : extras.serviceType === null
            ? []
            : filters.serviceTypes,
        startPeriod: extras.startPeriod ?? filters.startPeriod,
        endPeriod: extras.endPeriod ?? filters.endPeriod,
      }
      // When setting metro alone, ensure region aligns if known from data
      if (extras.metro && !extras.region) {
        const ship = data.shipments.find((s) => s.metro === extras.metro)
        if (ship) nextFilters.regions = [ship.region]
      }
      if (extras.station && (!extras.metro || !extras.region)) {
        const st = data.stations.find((s) => s.station_id === extras.station)
        if (st) {
          if (!extras.metro) nextFilters.metros = [st.metro]
          if (!extras.region) nextFilters.regions = [st.region]
        }
      }

      const nextLocal: LocalAnalysisFilters = {
        ...localFilters,
        exceptionType:
          extras.exceptionType !== undefined ? extras.exceptionType : localFilters.exceptionType,
        exceptionStatus:
          extras.exceptionStatus !== undefined
            ? extras.exceptionStatus
            : localFilters.exceptionStatus,
      }
      const hl =
        extras.highlightCustomerId !== undefined
          ? extras.highlightCustomerId
          : extras.customerId ?? highlightCustomerId
      const ent = extras.openEntity !== undefined ? extras.openEntity : openEntity

      const nextInv: InvestigationState = {
        ...investigation,
        sourcePage: extras.sourcePage ?? location.pathname,
        id: extras.investigationId !== undefined ? extras.investigationId : investigation.id,
        title:
          extras.investigationTitle !== undefined
            ? extras.investigationTitle
            : investigation.title,
        steps: extras.investigationSteps ?? investigation.steps,
        stepIndex:
          extras.investigationStepIndex !== undefined
            ? extras.investigationStepIndex
            : investigation.stepIndex,
        toast: extras.toast ?? null,
      }

      const scopeBits = [
        nextFilters.metros[0],
        nextFilters.regions[0],
        nextFilters.serviceTypes[0],
        nextFilters.customerIds[0]
          ? data.customers.find((c) => c.customer_id === nextFilters.customerIds[0])?.customer_name
          : null,
        nextLocal.exceptionType,
        `${nextFilters.startPeriod}–${nextFilters.endPeriod}`,
      ].filter(Boolean)
      const feedback =
        extras.toast ??
        `Opening ${path} · Filters: ${scopeBits.join(' · ') || 'Company Total'}`

      // Record where we came from so the breadcrumb can restore the original context
      if (path !== location.pathname) {
        setNavPath((prev) =>
          [
            ...prev,
            {
              path: location.pathname,
              search: location.search,
              filters,
              localFilters,
              highlightCustomerId,
              scenario,
            },
          ].slice(-NAV_PATH_LIMIT),
        )
      }

      setFiltersState(nextFilters)
      setLocalFilters(nextLocal)
      setHighlightCustomerId(hl)
      if (ent) setOpenEntity(ent)
      else if (extras.openEntity === null) setOpenEntity(null)
      setInvestigationState(nextInv)
      setContextFeedback(feedback)

      if (extras.clearDrillContext) {
        setDrillStack([])
      }

      const qs = buildAnalysisSearch(nextFilters, {
        scenario,
        dateBasis,
        focusExceptionType: nextLocal.exceptionType,
        focusExceptionStatus: nextLocal.exceptionStatus,
        highlightCustomerId: hl,
        entityType: ent && ent.entityType !== 'kpi' ? (ent.entityType as EntityType) : null,
        entityId: ent && ent.entityType !== 'kpi' ? ent.entityId : null,
        sourcePage: nextInv.sourcePage,
        investigationId: nextInv.id,
        toast: nextInv.toast,
      })
      navigate({ pathname: path, search: qs ? `?${qs}` : '' })
    },
    [
      filters,
      localFilters,
      highlightCustomerId,
      openEntity,
      scenario,
      dateBasis,
      navigate,
      investigation,
      location.pathname,
      location.search,
      data,
    ],
  )

  const navigateBack = useCallback(
    (index?: number) => {
      if (navPath.length === 0) return
      const i = index == null ? navPath.length - 1 : Math.max(0, Math.min(index, navPath.length - 1))
      const entry = navPath[i]
      setNavPath(navPath.slice(0, i))
      setFiltersState(entry.filters)
      setLocalFilters(entry.localFilters)
      setHighlightCustomerId(entry.highlightCustomerId)
      setScenarioState(entry.scenario)
      setOpenEntity(null)
      setContextFeedback('Returned to previous analysis with its original filters')
      navigate({ pathname: entry.path, search: entry.search })
    },
    [navPath, navigate],
  )

  const openCustomer360 = useCallback(
    (customerId: string) => {
      const name = data.customers.find((c) => c.customer_id === customerId)?.customer_name ?? customerId
      navigateWithContext('/customer-360', {
        customerId,
        highlightCustomerId: customerId,
        openEntity: null,
        sourcePage: location.pathname,
        toast: `Customer 360 · ${name} (global filters retained)`,
      })
    },
    [data.customers, navigateWithContext, location.pathname],
  )

  const clearLocalFilters = useCallback(() => {
    setLocalFilters(DEFAULT_LOCAL)
    writeUrl(filters, scenario, dateBasis, DEFAULT_LOCAL, highlightCustomerId, openEntity)
    setContextFeedback('Local page filters cleared (global filters retained)')
  }, [writeUrl, filters, scenario, dateBasis, highlightCustomerId, openEntity])

  const updateExceptionStatus = useCallback((exceptionId: string, status: ExceptionStatus) => {
    setExceptionOverrides((prev) => ({ ...prev, [exceptionId]: status }))
  }, [])

  const value: AppContextValue = {
    data,
    filters,
    setFilters,
    clearFilters,
    resetFilters: clearFilters,
    clearSelection,
    scenario,
    setScenario: (s) => {
      setScenarioState(s)
      setScenarioParams(DEFAULT_SCENARIO_PARAMS[s])
      writeUrl(filters, s, dateBasis, localFilters, highlightCustomerId, openEntity)
    },
    scenarioParams,
    setScenarioParams,
    healthWeights,
    setHealthWeights,
    drillStack,
    pushDrill: (node) => setDrillStack((prev) => [...prev, node]),
    popDrill: () => setDrillStack((prev) => prev.slice(0, -1)),
    clearDrill: () => setDrillStack([]),
    periods,
    dateBasis,
    setDateBasis: (d) => {
      setDateBasis(d)
      writeUrl(filters, scenario, d, localFilters, highlightCustomerId, openEntity)
    },
    localFilters,
    setLocalFilters: (f) => {
      setLocalFilters((prev) => {
        const next = typeof f === 'function' ? f(prev) : f
        writeUrl(filters, scenario, dateBasis, next, highlightCustomerId, openEntity)
        return next
      })
    },
    highlightCustomerId,
    setHighlightCustomerId: (id) => {
      setHighlightCustomerId(id)
      writeUrl(filters, scenario, dateBasis, localFilters, id, openEntity)
    },
    openEntity,
    openEntityDrawer,
    closeEntity,
    navigateToEntity,
    navigateWithContext,
    updateExceptionStatus,
    analysisTrail,
    popAnalysisTrail: () => {
      setAnalysisTrail((prev) => {
        const next = prev.slice(0, -1)
        const last = next[next.length - 1]
        if (last) setOpenEntity({ entityType: last.entityType, entityId: last.entityId, label: last.label })
        else setOpenEntity(null)
        return next
      })
    },
    investigation,
    setInvestigation: (s) => {
      setInvestigationState((prev) => (typeof s === 'function' ? s(prev) : s))
    },
    clearInvestigation: () => {
      setInvestigationState(DEFAULT_INVESTIGATION)
      setContextFeedback(null)
    },
    dismissToast: () => {
      setContextFeedback(null)
      setInvestigationState((prev) => ({ ...prev, toast: null }))
    },
    contextFeedback,
    navPath,
    navigateBack,
    clearLocalFilters,
    openCustomer360,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

export { ROUTE_BY_INTENT }
