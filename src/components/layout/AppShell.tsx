import { Outlet } from 'react-router-dom'
import { DetailDrawer } from '@/components/common/DetailDrawer'
import { InvestigationBreadcrumb } from '@/components/common/InvestigationBreadcrumb'
import { useApp } from '@/context/AppContext'
import { GlobalFiltersBar } from './GlobalFilters'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const {
    data,
    drillStack,
    popDrill,
    clearDrill,
    analysisTrail,
    popAnalysisTrail,
    clearSelection,
    clearFilters,
    clearLocalFilters,
    localFilters,
  } = useApp()
  const hasLocal = Boolean(
    localFilters.exceptionType || localFilters.exceptionStatus || localFilters.pipelineStage || localFilters.costType,
  )

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-[#e1e9e4] bg-white/90 px-6 py-3 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="t-app-title text-ink">Last-Mile RevOps Intelligence</h1>
              <span
                className="rounded-full bg-[#f1f5f2] px-2.5 py-0.5 text-xs text-ink-muted"
                title={`Snapshot ${data.meta.snapshot_label} · Seed ${data.meta.seed} · Updated ${new Date(data.meta.generated_at).toLocaleString()}`}
              >
                {data.meta.snapshot_label.replace(/^Synthetic Snapshot\s*/i, '')} · seed {data.meta.seed} ·{' '}
                {new Date(data.meta.generated_at).toLocaleDateString()}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-[#dce6df] px-2.5 py-1 text-[13px] text-ink-muted hover:bg-[#f5f8f5]"
                title="Clears highlight, entity drawer, and exception focus — keeps global filters"
                onClick={clearSelection}
              >
                Clear Selection
              </button>
              <button
                type="button"
                disabled={!hasLocal}
                className="rounded-md border border-[#dce6df] px-2.5 py-1 text-[13px] text-ink-muted hover:bg-[#f5f8f5] disabled:cursor-not-allowed disabled:opacity-40"
                title="Clears page-local filters (exception type / status, stage, cost type) — keeps global filters"
                onClick={clearLocalFilters}
              >
                Clear Local Filters
              </button>
              <button
                type="button"
                className="rounded-md border border-[#dce6df] px-2.5 py-1 text-[13px] text-ink-muted hover:bg-[#f5f8f5]"
                title="Restores default date range, clears all filters, selection, scenario and drill-down path"
                onClick={clearFilters}
              >
                Reset All
              </button>
              <span
                className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-warning"
                title="Independent work · all data is synthetic"
              >
                Synthetic data
              </span>
            </div>
          </div>
          {(drillStack.length > 0 || analysisTrail.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <button type="button" className="text-brand-700 hover:underline" onClick={clearDrill}>
                Company
              </button>
              {drillStack.map((d, i) => (
                <span key={`${d.level}-${d.id}`} className="flex items-center gap-2">
                  <span className="text-slate-300">/</span>
                  <button
                    type="button"
                    className="text-brand-700 hover:underline"
                    onClick={() => {
                      while (drillStack.length > i + 1) popDrill()
                    }}
                  >
                    {d.label}
                  </button>
                </span>
              ))}
              {analysisTrail.length > 0 && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="text-ink-muted">Detail trail:</span>
                  {analysisTrail.map((t, i) => (
                    <span key={`trail-${t.entityType}-${t.entityId}-${i}`} className="flex items-center gap-1">
                      {i > 0 && <span className="text-slate-300">/</span>}
                      <span className="text-ink">{t.label}</span>
                    </span>
                  ))}
                  <button
                    type="button"
                    className="ml-1 text-ink-muted hover:text-ink"
                    onClick={popAnalysisTrail}
                  >
                    Back to Previous Analysis
                  </button>
                </>
              )}
              {drillStack.length > 0 && (
                <button type="button" className="ml-2 text-ink-muted hover:text-ink" onClick={popDrill}>
                  Back
                </button>
              )}
            </div>
          )}
        </header>
        <GlobalFiltersBar />
        <InvestigationBreadcrumb />
        <main className="flex-1 overflow-auto px-6 py-5">
          <Outlet />
        </main>
      </div>
      <DetailDrawer />
    </div>
  )
}
