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
import { DEFAULT_SCENARIO_PARAMS } from '@/calc/forecast'
import { DEFAULT_HEALTH_WEIGHTS, type HealthWeights } from '@/calc/customerHealth'
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

interface AppContextValue {
  data: DataStore
  filters: GlobalFilters
  setFilters: (f: GlobalFilters | ((prev: GlobalFilters) => GlobalFilters)) => void
  resetFilters: () => void
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
  navigateWithContext: (
    path: string,
    extras?: {
      customerId?: string | null
      region?: string | null
      serviceType?: string | null
      startPeriod?: string | null
      endPeriod?: string | null
      exceptionType?: string | null
      exceptionStatus?: string | null
      highlightCustomerId?: string | null
      openEntity?: OpenEntityState | null
    },
  ) => void
  updateExceptionStatus: (exceptionId: string, status: ExceptionStatus) => void
  analysisTrail: { entityType: EntityType | 'kpi'; entityId: string; label: string }[]
  popAnalysisTrail: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

const DEFAULT_LOCAL: LocalAnalysisFilters = {
  exceptionType: null,
  exceptionStatus: null,
  pipelineStage: null,
  costType: null,
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

  const data = useMemo(
    () => applyExceptionOverrides(baseData, exceptionOverrides),
    [baseData, exceptionOverrides],
  )

  // Bootstrap + hydrate from URL
  useEffect(() => {
    const q = parseAnalysisSearch(searchParams.toString())
    syncingFromUrl.current = true
    setFiltersState((prev) => ({
      startPeriod: q.filters.startPeriod ?? prev.startPeriod,
      endPeriod: q.filters.endPeriod ?? prev.endPeriod,
      customerIds: q.filters.customerIds ?? prev.customerIds,
      regions: q.filters.regions ?? prev.regions,
      serviceTypes: q.filters.serviceTypes ?? prev.serviceTypes,
      snapshot: baseData.meta.snapshot_label,
    }))
    if (q.scenario) {
      setScenarioState(q.scenario)
      setScenarioParams(DEFAULT_SCENARIO_PARAMS[q.scenario])
    }
    if (q.dateBasis) setDateBasis(q.dateBasis)
    if (q.focusExceptionType || q.focusExceptionStatus) {
      setLocalFilters((prev) => ({
        ...prev,
        exceptionType: q.focusExceptionType ?? prev.exceptionType,
        exceptionStatus: q.focusExceptionStatus ?? prev.exceptionStatus,
      }))
    }
    if (q.highlightCustomerId) setHighlightCustomerId(q.highlightCustomerId)
    if (q.filters.customerIds?.[0]) setHighlightCustomerId(q.filters.customerIds[0])
    if (q.entityType && q.entityId) {
      setOpenEntity({ entityType: q.entityType, entityId: q.entityId })
    }
    bootstrapped.current = true
    queueMicrotask(() => {
      syncingFromUrl.current = false
    })
    // Only on first mount / explicit search change from browser nav
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])

  const writeUrl = useCallback(
    (
      nextFilters: GlobalFilters,
      nextScenario: string,
      nextDateBasis: DateBasis,
      nextLocal: LocalAnalysisFilters,
      nextHighlight: string | null,
      nextEntity: OpenEntityState | null,
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
      })
      const current = searchParams.toString()
      if (qs === current) return
      setSearchParams(qs, { replace })
    },
    [searchParams, setSearchParams],
  )

  const setFilters = useCallback(
    (f: GlobalFilters | ((prev: GlobalFilters) => GlobalFilters)) => {
      setFiltersState((prev) => {
        const next = typeof f === 'function' ? f(prev) : f
        writeUrl(next, scenario, dateBasis, localFilters, highlightCustomerId, openEntity)
        return next
      })
    },
    [writeUrl, scenario, dateBasis, localFilters, highlightCustomerId, openEntity],
  )

  const resetFilters = useCallback(() => {
    setFiltersState(defaultFilt)
    setLocalFilters(DEFAULT_LOCAL)
    setHighlightCustomerId(null)
    setOpenEntity(null)
    setAnalysisTrail([])
    setDrillStack([])
    setScenarioState('Base')
    setScenarioParams(DEFAULT_SCENARIO_PARAMS.Base)
    setDateBasis('recognition')
    writeUrl(defaultFilt, 'Base', 'recognition', DEFAULT_LOCAL, null, null)
  }, [defaultFilt, writeUrl])

  const clearSelection = useCallback(() => {
    setHighlightCustomerId(null)
    setOpenEntity(null)
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
      writeUrl(filters, scenario, dateBasis, localFilters, highlightCustomerId, state, false)
    },
    [writeUrl, filters, scenario, dateBasis, localFilters, highlightCustomerId],
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
    (
      path: string,
      extras: {
        customerId?: string | null
        region?: string | null
        serviceType?: string | null
        startPeriod?: string | null
        endPeriod?: string | null
        exceptionType?: string | null
        exceptionStatus?: string | null
        highlightCustomerId?: string | null
        openEntity?: OpenEntityState | null
      } = {},
    ) => {
      const nextFilters: GlobalFilters = {
        ...filters,
        customerIds: extras.customerId
          ? [extras.customerId]
          : extras.customerId === null
            ? []
            : filters.customerIds,
        regions: extras.region
          ? ([extras.region] as GlobalFilters['regions'])
          : extras.region === null
            ? []
            : filters.regions,
        serviceTypes: extras.serviceType
          ? ([extras.serviceType] as GlobalFilters['serviceTypes'])
          : extras.serviceType === null
            ? []
            : filters.serviceTypes,
        startPeriod: extras.startPeriod ?? filters.startPeriod,
        endPeriod: extras.endPeriod ?? filters.endPeriod,
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

      setFiltersState(nextFilters)
      setLocalFilters(nextLocal)
      setHighlightCustomerId(hl)
      if (ent) setOpenEntity(ent)
      else if (extras.openEntity === null) setOpenEntity(null)

      const qs = buildAnalysisSearch(nextFilters, {
        scenario,
        dateBasis,
        focusExceptionType: nextLocal.exceptionType,
        focusExceptionStatus: nextLocal.exceptionStatus,
        highlightCustomerId: hl,
        entityType: ent && ent.entityType !== 'kpi' ? (ent.entityType as EntityType) : null,
        entityId: ent && ent.entityType !== 'kpi' ? ent.entityId : null,
      })
      navigate({ pathname: path, search: qs ? `?${qs}` : '' })
    },
    [filters, localFilters, highlightCustomerId, openEntity, scenario, dateBasis, navigate],
  )

  const updateExceptionStatus = useCallback((exceptionId: string, status: ExceptionStatus) => {
    setExceptionOverrides((prev) => ({ ...prev, [exceptionId]: status }))
  }, [])

  const value: AppContextValue = {
    data,
    filters,
    setFilters,
    resetFilters,
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
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

export { ROUTE_BY_INTENT }
