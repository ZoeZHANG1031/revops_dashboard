import { ChevronRight, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useApp } from '@/context/AppContext'
import type { EntityType } from '@/lib/analysisUrl'
import { lineageForMetric } from '@/lib/lineage'
import { resolveEntity } from '@/lib/recordLookup'
import type { ExceptionStatus } from '@/types'

const EXCEPTION_STATUSES: ExceptionStatus[] = [
  'Open',
  'Investigating',
  'Pending Approval',
  'Resolved',
  'Rejected',
  'Accepted',
]

export function DetailDrawer() {
  const {
    data,
    openEntity,
    closeEntity,
    navigateToEntity,
    updateExceptionStatus,
    analysisTrail,
  } = useApp()
  const [lineageOpen, setLineageOpen] = useState(true)
  const [kpiLineageId, setKpiLineageId] = useState<string | null>(null)

  const detail = useMemo(() => {
    if (!openEntity) return null
    if (openEntity.entityType === 'kpi') {
      return null
    }
    return resolveEntity(data, openEntity.entityType as EntityType, openEntity.entityId)
  }, [data, openEntity])

  const kpiLineage = useMemo(() => {
    if (!openEntity || openEntity.entityType !== 'kpi') return null
    return lineageForMetric(openEntity.entityId)
  }, [openEntity])

  if (!openEntity) return null

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/25" role="dialog" aria-modal>
      <button type="button" className="flex-1 cursor-default" aria-label="Close drawer" onClick={closeEntity} />
      <aside className="flex h-full w-full max-w-xl flex-col border-l border-[#dce6df] bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-[#dce6df] px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
              {openEntity.entityType.replace('_', ' ')} Detail
            </p>
            <h3 className="truncate text-base font-semibold text-ink">
              {detail?.title ?? openEntity.label ?? openEntity.entityId}
            </h3>
            <p className="text-xs text-ink-muted">
              {detail?.subtitle ?? openEntity.entityId}
              {!detail?.available && openEntity.entityType !== 'kpi' ? ' · Not Available' : ''}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-ink-muted hover:bg-[#f5f8f5] hover:text-ink"
            onClick={closeEntity}
          >
            <X size={18} />
          </button>
        </div>

        {analysisTrail.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 border-b border-[#dce6df] px-4 py-2 text-[13px]">
            {analysisTrail.map((t, i) => (
              <span key={`${t.entityType}-${t.entityId}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} className="text-slate-300" />}
                <button
                  type="button"
                  className="text-brand-700 hover:underline"
                  onClick={() => navigateToEntity(t.entityType, t.entityId, t.label)}
                >
                  {t.label}
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {openEntity.entityType === 'kpi' && kpiLineage && (
            <Section title="Data Lineage Explorer">
              <p className="mb-2 text-xs text-ink-muted">
                Aggregation: {kpiLineage.aggregation} · Date basis: {kpiLineage.dateBasis}
              </p>
              <ol className="space-y-2">
                {kpiLineage.hops.map((h, i) => (
                  <li key={`${h.label}-${i}`} className="rounded-lg bg-[#f5f8f5] px-3 py-2 text-xs">
                    <p className="font-semibold text-ink">
                      {i + 1}. {h.label}
                    </p>
                    <p className="text-ink-muted">
                      {h.sourceTable} · join {h.joinKey} · {h.transformation}
                    </p>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-[13px] text-ink-muted">
                Filters: {kpiLineage.filtersApplied.join('; ') || 'none'}
              </p>
              {openEntity.actions && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {openEntity.actions.map((a) => (
                    <button
                      key={a.label}
                      type="button"
                      className="rounded-md bg-forest px-2.5 py-1 text-[13px] font-medium text-white hover:bg-forest-muted"
                      onClick={a.onClick}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </Section>
          )}

          {detail && (
            <>
              <Section title="Overview">
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  {detail.overview.map((row) => (
                    <div key={row.label}>
                      <dt className="text-ink-muted">{row.label}</dt>
                      <dd className="font-mono text-ink">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </Section>

              <Section title="Financial Breakdown">
                {detail.financial.length === 0 ? (
                  <p className="text-xs text-ink-muted">Not Available</p>
                ) : (
                  <ul className="space-y-2 text-xs">
                    {detail.financial.map((f) => (
                      <li key={f.label} className="flex flex-col rounded-lg bg-[#f5f8f5] px-3 py-2">
                        <span className="flex justify-between gap-2">
                          <span>{f.label}</span>
                          <span className="font-mono font-semibold">{f.value}</span>
                        </span>
                        {f.formula && <span className="mt-1 text-xs text-ink-muted">{f.formula}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Linked Records">
                {detail.linked.length === 0 ? (
                  <p className="text-xs text-ink-muted">No Linked Record</p>
                ) : (
                  <ul className="space-y-1">
                    {detail.linked.map((l) => (
                      <li key={`${l.entityType}-${l.entityId}`}>
                        <button
                          type="button"
                          className="w-full rounded-md px-2 py-1.5 text-left text-xs text-brand-700 hover:bg-brand-50"
                          onClick={() => navigateToEntity(l.entityType, l.entityId, l.label)}
                        >
                          {l.label}{' '}
                          <span className="text-xs text-ink-muted">({l.entityType})</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Timeline">
                {detail.timeline.length === 0 ? (
                  <p className="text-xs text-ink-muted">Not Available</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {detail.timeline.map((t, i) => (
                      <li key={`${t.date}-${i}`} className="flex justify-between gap-2">
                        <span>{t.label}</span>
                        <span className="font-mono text-ink-muted">{t.date}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Exceptions & Actions">
                {detail.exceptions.length === 0 && detail.actions.length === 0 ? (
                  <p className="text-xs text-ink-muted">No Linked Record</p>
                ) : (
                  <>
                    <ul className="space-y-1">
                      {detail.exceptions.map((e) => (
                        <li key={e.entityId}>
                          <button
                            type="button"
                            className="text-xs text-brand-700 hover:underline"
                            onClick={() => navigateToEntity('exception', e.entityId, e.label)}
                          >
                            {e.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <ul className="mt-2 list-disc pl-4 text-xs text-ink-muted">
                      {detail.actions.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}
                {detail.entityType === 'exception' && (
                  <div className="mt-3">
                    <p className="mb-1 text-xs font-semibold uppercase text-ink-muted">
                      Demo status update (local synthetic only)
                    </p>
                    <select
                      className="filter-input w-full"
                      value={
                        data.exceptions.find((x) => x.exception_id === detail.entityId)?.status ??
                        'Open'
                      }
                      onChange={(e) =>
                        updateExceptionStatus(detail.entityId, e.target.value as ExceptionStatus)
                      }
                    >
                      {EXCEPTION_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </Section>

              <Section title="Data Source">
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-muted">Table</dt>
                    <dd className="font-mono">{detail.dataSource.table}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Fields</dt>
                    <dd className="font-mono text-xs">{detail.dataSource.fields.join(', ') || '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-muted">Snapshot</dt>
                    <dd className="font-mono">{detail.dataSource.version}</dd>
                  </div>
                </dl>
              </Section>

              {detail.lineage && (
                <Section title="Data Lineage Explorer">
                  <button
                    type="button"
                    className="mb-2 text-[13px] text-brand-700"
                    onClick={() => setLineageOpen((v) => !v)}
                  >
                    {lineageOpen ? 'Collapse' : 'Expand'}
                  </button>
                  {lineageOpen && (
                    <ol className="space-y-2">
                      {detail.lineage.hops.map((h, i) => (
                        <li key={`${h.entityId}-${i}`}>
                          <button
                            type="button"
                            className="w-full rounded-lg bg-[#f5f8f5] px-3 py-2 text-left text-xs hover:bg-brand-50"
                            disabled={h.entityId === '*'}
                            onClick={() => {
                              if (h.entityId !== '*') {
                                navigateToEntity(h.entityType, h.entityId, h.label)
                              }
                            }}
                          >
                            <p className="font-semibold">
                              {i + 1}. {h.label}
                            </p>
                            <p className="text-ink-muted">
                              {h.sourceTable} · {h.joinKey} · {h.transformation}
                              {h.amount != null ? ` · ${h.amount}` : ''}
                            </p>
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </Section>
              )}

              {detail.entityType === 'customer' && (
                <Section title="Metric Lineage Shortcuts">
                  <div className="flex flex-wrap gap-2">
                    {['recognized_revenue', 'contribution_margin', 'unbilled_exposure'].map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="rounded-md border border-[#dce6df] px-2 py-1 text-[13px] hover:bg-[#f5f8f5]"
                        onClick={() => setKpiLineageId(kpiLineageId === id ? null : id)}
                      >
                        {id}
                      </button>
                    ))}
                  </div>
                  {kpiLineageId && (
                    <ol className="mt-2 space-y-1 text-[13px] text-ink-muted">
                      {lineageForMetric(kpiLineageId).hops.map((h, i) => (
                        <li key={i}>
                          {i + 1}. {h.label} ← {h.sourceTable}
                        </li>
                      ))}
                    </ol>
                  )}
                </Section>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">{title}</h4>
      {children}
    </section>
  )
}
