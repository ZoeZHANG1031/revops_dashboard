import { useLocation } from 'react-router-dom'
import { useApp } from '@/context/AppContext'
import { pageMeta } from '@/lib/icons'

function PageCrumb({ path }: { path: string }) {
  const m = pageMeta(path)
  const Icon = m?.icon
  return (
    <span className="inline-flex items-center gap-1">
      {Icon && <Icon size={11} aria-hidden />}
      {m?.label ?? path}
    </span>
  )
}

function pageLabel(path: string): string {
  return pageMeta(path)?.label ?? path
}

export function InvestigationBreadcrumb() {
  const location = useLocation()
  const {
    filters,
    data,
    localFilters,
    setLocalFilters,
    investigation,
    clearInvestigation,
    clearSelection,
    setFilters,
    navigateWithContext,
    contextFeedback,
    dismissToast,
    navPath,
    navigateBack,
  } = useApp()

  const describe = (e: (typeof navPath)[number]) => {
    const bits = [
      e.filters.metros[0],
      !e.filters.metros[0] ? e.filters.regions[0] : null,
      e.filters.serviceTypes[0],
      e.filters.customerIds[0]
        ? data.customers.find((c) => c.customer_id === e.filters.customerIds[0])?.customer_name
        : null,
      e.localFilters.exceptionType,
    ].filter(Boolean)
    return bits.join(' · ')
  }

  const customerName = filters.customerIds[0]
    ? data.customers.find((c) => c.customer_id === filters.customerIds[0])?.customer_name
    : null

  const crumbs: { key: string; label: string; clear?: () => void }[] = [
    {
      key: 'home',
      label: pageLabel('/executive'),
      clear: () => navigateWithContext('/executive', { sourcePage: null }),
    },
  ]

  if (navPath.length === 0 && investigation.sourcePage && investigation.sourcePage !== '/executive') {
    crumbs.push({
      key: 'source',
      label: pageLabel(investigation.sourcePage),
      clear: () => navigateWithContext(investigation.sourcePage!),
    })
  }

  if (filters.metros[0]) {
    crumbs.push({
      key: 'metro',
      label: filters.metros[0],
      clear: () => setFilters({ ...filters, metros: [] }),
    })
  } else if (filters.regions[0]) {
    crumbs.push({
      key: 'region',
      label: filters.regions[0],
      clear: () => setFilters({ ...filters, regions: [], metros: [] }),
    })
  }

  if (filters.serviceTypes[0]) {
    crumbs.push({
      key: 'service',
      label: filters.serviceTypes[0],
      clear: () => setFilters({ ...filters, serviceTypes: [] }),
    })
  }

  if (customerName) {
    crumbs.push({
      key: 'customer',
      label: customerName,
      clear: () => {
        setFilters({ ...filters, customerIds: [] })
        clearSelection()
      },
    })
  }

  if (localFilters.exceptionType) {
    crumbs.push({
      key: 'exc',
      label: localFilters.exceptionType,
      clear: () =>
        setLocalFilters({
          ...localFilters,
          exceptionType: null,
          exceptionStatus: null,
        }),
    })
  }

  if (investigation.title) {
    crumbs.push({
      key: 'guide',
      label: investigation.title,
      clear: () => clearInvestigation(),
    })
  }

  const hasContext =
    navPath.length > 0 ||
    crumbs.length > 1 ||
    Boolean(contextFeedback) ||
    Boolean(investigation.id) ||
    filters.metros.length > 0 ||
    filters.regions.length > 0 ||
    filters.serviceTypes.length > 0 ||
    filters.customerIds.length > 0 ||
    Boolean(localFilters.exceptionType)

  if (!hasContext) return null

  return (
    <div className="border-b border-[#dce6df] bg-[#f7faf7] px-4 py-1.5">
      {navPath.length > 0 && (
        <nav aria-label="Drill-down path" className="mb-1 flex flex-wrap items-center gap-1 text-[13px]">
          <button
            type="button"
            className="mr-1 rounded-md border border-[#dce6df] bg-white px-2 py-0.5 font-medium text-forest hover:border-brand-400"
            onClick={() => navigateBack()}
            title="Return to the previous page with its original filters and selection"
          >
            ← Back
          </button>
          <span className="mr-1 font-semibold uppercase tracking-wide text-ink-muted">Path</span>
          {navPath.map((e, i) => {
            const d = describe(e)
            return (
              <span key={`${e.path}-${i}`} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-slate-300">›</span>}
                <button
                  type="button"
                  className="rounded px-1 text-brand-700 hover:bg-white hover:underline"
                  onClick={() => navigateBack(i)}
                  title="Restore this step's filters and selection"
                >
                  <PageCrumb path={e.path} />
                  {d && <span className="text-ink-muted"> ({d})</span>}
                </button>
              </span>
            )
          })}
          <span className="text-slate-300">›</span>
          <span className="font-semibold text-ink">
            <PageCrumb path={location.pathname} />
          </span>
        </nav>
      )}
      <div className="flex flex-wrap items-center gap-1 text-[13px]">
        <span className="mr-1 font-semibold uppercase tracking-wide text-ink-muted">Active filters</span>
        {crumbs.map((c, i) => (
          <span key={c.key} className="inline-flex items-center gap-1">
            {i > 0 && <span className="text-slate-300">/</span>}
            <button
              type="button"
              className="rounded px-1 font-medium text-brand-700 hover:bg-white hover:underline"
              onClick={() => c.clear?.()}
              title={i === 0 ? 'Return to Executive Command Center' : 'Clear or jump'}
            >
              {c.label}
            </button>
            {i > 0 && c.clear && (
              <button
                type="button"
                className="rounded px-0.5 text-ink-muted hover:text-danger"
                aria-label={`Clear ${c.label}`}
                onClick={(e) => {
                  e.stopPropagation()
                  c.clear?.()
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <button
          type="button"
          className="ml-auto text-xs text-ink-muted hover:text-ink"
          onClick={() => {
            clearInvestigation()
            navigateWithContext('/executive')
          }}
        >
          Exit investigation
        </button>
      </div>
      {contextFeedback && (
        <div className="mt-1 flex items-start justify-between gap-2 rounded-md bg-white px-2 py-1 text-[13px] text-ink">
          <p>{contextFeedback}</p>
          <button type="button" className="shrink-0 text-ink-muted hover:text-ink" onClick={dismissToast}>
            Dismiss
          </button>
        </div>
      )}
      {investigation.id && investigation.steps.length > 0 && (
        <p className="mt-1 text-xs text-ink-muted">
          Guided step {investigation.stepIndex + 1}/{investigation.steps.length}:{' '}
          {investigation.steps[investigation.stepIndex]?.label}
        </p>
      )}
    </div>
  )
}
