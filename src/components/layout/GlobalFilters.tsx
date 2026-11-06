import { useApp } from '@/context/AppContext'
import { REGIONS as NETWORK_REGIONS, METRO_DEFINITIONS } from '@/data/metros'
import type { DateBasis } from '@/lib/analysisUrl'
import { DATE_PRESETS, resolveDatePreset, type DatePresetId } from '@/lib/filters'
import type { RegionCode, ServiceType } from '@/types'

const REGIONS: RegionCode[] = NETWORK_REGIONS
const SERVICES: ServiceType[] = ['Standard', 'Express', 'SameDay', 'Economy']
const DATE_BASIS: { id: DateBasis; label: string }[] = [
  { id: 'recognition', label: 'Recognition' },
  { id: 'billing', label: 'Billing' },
  { id: 'shipment', label: 'Shipment' },
  { id: 'invoice', label: 'Invoice' },
  { id: 'payment', label: 'Payment' },
  { id: 'forecast_target', label: 'Forecast Target' },
]

export function GlobalFiltersBar() {
  const {
    data,
    filters,
    setFilters,
    periods,
    scenario,
    setScenario,
    dateBasis,
    setDateBasis,
    clearFilters,
    localFilters,
  } = useApp()

  const historicalPeriods = periods.filter((p) => data.dates.some((d) => d.date_key.startsWith(p)))
  const stations = (data.stations ?? []).filter(
    (s) =>
      (filters.metros.length === 0 || filters.metros.includes(s.metro)) &&
      (filters.regions.length === 0 || filters.regions.includes(s.region)),
  )

  const applyPreset = (id: DatePresetId) => {
    const range = resolveDatePreset(id, historicalPeriods.length ? historicalPeriods : periods)
    if (!range) return
    setFilters({ ...filters, ...range })
  }

  return (
    <div className="space-y-1.5 border-b border-[#e1e9e4] bg-white/80 px-6 py-2.5 backdrop-blur">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          Date
        </span>
        {DATE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="rounded-md border border-[#dce6df] bg-white px-2 py-0.5 text-[11px] font-medium text-ink-muted hover:border-brand-600 hover:text-brand-700"
            onClick={() => applyPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
        <span className="ml-1 text-[10px] text-ink-muted">or Custom ↓</span>
      </div>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <FilterField label="From">
          <select
            className="filter-input"
            value={filters.startPeriod}
            onChange={(e) => setFilters({ ...filters, startPeriod: e.target.value })}
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="To">
          <select
            className="filter-input"
            value={filters.endPeriod}
            onChange={(e) => setFilters({ ...filters, endPeriod: e.target.value })}
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Customer">
          <select
            className="filter-input min-w-[160px]"
            value={filters.customerIds[0] ?? ''}
            onChange={(e) =>
              setFilters({
                ...filters,
                customerIds: e.target.value ? [e.target.value] : [],
              })
            }
          >
            <option value="">All customers</option>
            {data.customers.map((c) => (
              <option key={c.customer_id} value={c.customer_id}>
                {c.customer_name}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Region">
          <select
            className="filter-input"
            value={filters.regions[0] ?? ''}
            onChange={(e) =>
              setFilters({
                ...filters,
                regions: e.target.value ? [e.target.value as RegionCode] : [],
                metros: [],
                stations: [],
              })
            }
          >
            <option value="">All regions</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Metro">
          <select
            className="filter-input min-w-[120px]"
            value={filters.metros[0] ?? ''}
            onChange={(e) => {
              const metro = e.target.value
              if (!metro) {
                setFilters({ ...filters, metros: [], stations: [] })
                return
              }
              const def = METRO_DEFINITIONS.find((m) => m.metro === metro)
              setFilters({
                ...filters,
                metros: [metro],
                stations: [],
                regions: def ? [def.region] : filters.regions,
              })
            }}
          >
            <option value="">All metros</option>
            {METRO_DEFINITIONS.filter(
              (m) => filters.regions.length === 0 || filters.regions.includes(m.region),
            ).map((m) => (
              <option key={m.metro} value={m.metro}>
                {m.metro}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Station">
          <select
            className="filter-input min-w-[140px]"
            value={filters.stations?.[0] ?? ''}
            onChange={(e) => {
              const stationId = e.target.value
              if (!stationId) {
                setFilters({ ...filters, stations: [] })
                return
              }
              const st = data.stations.find((s) => s.station_id === stationId)
              setFilters({
                ...filters,
                stations: [stationId],
                metros: st ? [st.metro] : filters.metros,
                regions: st ? [st.region] : filters.regions,
              })
            }}
          >
            <option value="">All stations</option>
            {stations.map((s) => (
              <option key={s.station_id} value={s.station_id}>
                {s.station_name}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Service Type">
          <select
            className="filter-input"
            value={filters.serviceTypes[0] ?? ''}
            onChange={(e) =>
              setFilters({
                ...filters,
                serviceTypes: e.target.value ? [e.target.value as ServiceType] : [],
              })
            }
          >
            <option value="">All services</option>
            {SERVICES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Scenario">
          <select
            className="filter-input"
            value={scenario}
            onChange={(e) => setScenario(e.target.value as 'Base' | 'Upside' | 'Downside')}
          >
            <option value="Base">Base</option>
            <option value="Upside">Upside</option>
            <option value="Downside">Downside</option>
          </select>
        </FilterField>
        <FilterField label="Date Basis">
          <select
            className="filter-input"
            value={dateBasis}
            onChange={(e) => setDateBasis(e.target.value as DateBasis)}
          >
            {DATE_BASIS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </FilterField>
        {(localFilters.exceptionType || localFilters.exceptionStatus) && (
          <FilterField label="Local (Recon)">
            <div className="filter-input max-w-[200px] truncate bg-amber-50 text-[13px] text-warning">
              {[localFilters.exceptionType, localFilters.exceptionStatus].filter(Boolean).join(' · ')}
            </div>
          </FilterField>
        )}
        {(filters.customerIds.length > 0 ||
          filters.regions.length > 0 ||
          filters.metros.length > 0 ||
          (filters.stations?.length ?? 0) > 0 ||
          filters.serviceTypes.length > 0) && (
          <button
            type="button"
            className="mb-0.5 rounded-md border border-[#dce6df] px-2.5 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-[#f5f8f5]"
            onClick={clearFilters}
            title="Clear global date/customer/region/metro/station/service/scenario filters"
          >
            Clear Filters
          </button>
        )}
      </div>
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs font-semibold text-ink-muted">
      {label}
      <div className="mt-0.5">{children}</div>
    </label>
  )
}
