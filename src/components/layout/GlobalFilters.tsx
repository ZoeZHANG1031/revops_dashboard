import { useApp } from '@/context/AppContext'
import type { DateBasis } from '@/lib/analysisUrl'
import type { RegionCode, ServiceType } from '@/types'

const REGIONS: RegionCode[] = ['Northeast', 'Southeast', 'Midwest', 'Southwest', 'West']
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
    resetFilters,
    localFilters,
  } = useApp()

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-[#dce6df] bg-white/80 px-4 py-3 backdrop-blur">
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
      <FilterField label="Region / Metro">
        <select
          className="filter-input"
          value={filters.regions[0] ?? ''}
          onChange={(e) =>
            setFilters({
              ...filters,
              regions: e.target.value ? [e.target.value as RegionCode] : [],
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
      <FilterField label="Snapshot">
        <div className="filter-input bg-[#f5f8f5] text-ink-muted">{data.meta.snapshot_label}</div>
      </FilterField>
      {(localFilters.exceptionType || localFilters.exceptionStatus) && (
        <FilterField label="Local (Recon)">
          <div className="filter-input max-w-[200px] truncate bg-amber-50 text-[11px] text-warning">
            {[localFilters.exceptionType, localFilters.exceptionStatus].filter(Boolean).join(' · ')}
          </div>
        </FilterField>
      )}
      <button
        type="button"
        className="mb-0.5 rounded-md border border-[#dce6df] px-2.5 py-1.5 text-[11px] font-medium text-ink-muted hover:bg-[#f5f8f5]"
        onClick={resetFilters}
      >
        Clear Filters
      </button>
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  )
}
