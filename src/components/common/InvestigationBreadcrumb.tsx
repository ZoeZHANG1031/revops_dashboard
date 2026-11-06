import { useLocation, useNavigate } from 'react-router-dom'
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
  const navigate = useNavigate()
  const {
    filters,
    data,
    localFilters,
    setLocalFilters,
    investigation,
    clearInvestigation,
    clearNavContext,
    clearSelection,
    setFilters,
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

  const crumbs: { key: string; label: string; clear?: () => void }[] = []

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

  if (localFilters.pipelineStage) {
    crumbs.push({
      key: 'pipe',
      label: `Stage: ${localFilters.pipelineStage}`,
      clear: () => setLocalFilters({ ...localFilters, pipelineStage: null }),
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
    crumbs.length > 0 ||
    Boolean(contextFeedback) ||
    Boolean(investigation.id)

  if (!hasContext) return null

  return (
    <div className="border-b border-[#dce6df] bg-[#f7faf7] px-4 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        {navPath.length > 0 && (
          <>
            <button
              type="button"
              className="rounded-md border border-[#dce6df] bg-white px-2 py-0.5 font-medium text-forest hover:border-brand-400"
              onClick={() => navigateBack()}
              title="Return to the previous page with its original filters"
            >
              ← Back
            </button>
            {navPath.map((e, i) => {
              const d = describe(e)
              return (
                <span key={`${e.path}-${i}`} className="inline-flex items-center gap-1">
                  {i > 0 && <span className="text-slate-300">›</span>}
                  <button
                    type="button"
                    className="rounded px-1 text-brand-700 hover:bg-white hover:underline"
                    onClick={() => navigateBack(i)}
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
            <span className="mx-1 text-slate-300">·</span>
          </>
        )}
        {crumbs.length > 0 && (
          <>
            {navPath.length === 0 && (
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                Active context
              </span>
            )}
            {crumbs.map((c) => (
              <button
                key={c.key}
                type="button"
                className="inline-flex items-center gap-0.5 rounded-full border border-[#dce6df] bg-white px-2 py-0.5 text-[11px] text-ink hover:border-brand-400"
                onClick={() => c.clear?.()}
                title={`Clear ${c.label}`}
              >
                {c.label}
                <span className="text-ink-muted">×</span>
              </button>
            ))}
          </>
        )}
        {(navPath.length > 0 || investigation.id || crumbs.length > 0) && (
          <button
            type="button"
            className="ml-auto text-[11px] text-ink-muted hover:text-ink"
            onClick={() => {
              // Clear residual breadcrumb / investigation without pushing another trail entry
              clearNavContext()
              setFilters({ ...filters, customerIds: [], metros: [], regions: [], serviceTypes: [] })
              clearSelection()
              if (location.pathname !== '/executive') navigate('/executive')
            }}
            title="Clear investigation context and return to Executive"
          >
            Exit
          </button>
        )}
      </div>
      {contextFeedback && (
        <div className="mt-1 flex items-start justify-between gap-2 rounded-md bg-white px-2 py-1 text-[12px] text-ink">
          <p>{contextFeedback}</p>
          <button type="button" className="shrink-0 text-ink-muted hover:text-ink" onClick={dismissToast}>
            Dismiss
          </button>
        </div>
      )}
      {investigation.id && investigation.steps.length > 0 && (
        <p className="mt-1 text-[11px] text-ink-muted">
          Guided {investigation.stepIndex + 1}/{investigation.steps.length}:{' '}
          {investigation.steps[investigation.stepIndex]?.label}
          {investigation.sourcePage ? ` · from ${pageLabel(investigation.sourcePage)}` : ''}
        </p>
      )}
    </div>
  )
}
