import { Outlet } from 'react-router-dom'
import { DetailDrawer } from '@/components/common/DetailDrawer'
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
    resetFilters,
  } = useApp()

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-[#dce6df] bg-white/90 px-4 py-3 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-lg font-semibold text-ink">
                Last-Mile Revenue Operations Intelligence
              </h1>
              <p className="text-xs text-ink-muted">
                Snapshot {data.meta.snapshot_label} · Seed {data.meta.seed} · Updated{' '}
                {new Date(data.meta.generated_at).toLocaleString()}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-[#dce6df] px-2 py-1 text-[11px] text-ink-muted hover:bg-[#f5f8f5]"
                onClick={clearSelection}
              >
                Clear Selection
              </button>
              <button
                type="button"
                className="rounded-md border border-[#dce6df] px-2 py-1 text-[11px] text-ink-muted hover:bg-[#f5f8f5]"
                onClick={resetFilters}
              >
                Reset View
              </button>
              <span className="rounded-md bg-lime/30 px-2 py-1 text-[11px] font-semibold text-forest">
                INDEPENDENT WORK
              </span>
              <span className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-warning">
                SYNTHETIC DATA
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
        <main className="flex-1 overflow-auto p-4">
          <Outlet />
        </main>
      </div>
      <DetailDrawer />
    </div>
  )
}
