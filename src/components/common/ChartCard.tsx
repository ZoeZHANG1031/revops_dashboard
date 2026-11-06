import { Info } from 'lucide-react'
import { useState, type ReactNode } from 'react'

export function ChartCard({
  title,
  subtitle,
  action,
  children,
  businessQuestion,
  formula,
  source,
  timeBasis,
  recommendedAction,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  businessQuestion?: string
  formula?: string
  source?: string
  timeBasis?: string
  recommendedAction?: string
}) {
  const [metaOpen, setMetaOpen] = useState(false)
  const hasMeta = businessQuestion || formula || source || timeBasis || recommendedAction

  return (
    <section className="card-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            {hasMeta && (
              <button
                type="button"
                className="text-ink-muted hover:text-brand-700"
                onClick={() => setMetaOpen((v) => !v)}
                aria-label="Chart methodology"
              >
                <Info size={14} />
              </button>
            )}
          </div>
          {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
          {businessQuestion && (
            <p className="mt-1 text-[11px] font-medium text-forest-muted">Q: {businessQuestion}</p>
          )}
        </div>
        {action}
      </div>
      {metaOpen && hasMeta && (
        <div className="mb-3 rounded-lg border border-[#dce6df] bg-[#f5f8f5] p-3 text-[11px] text-ink-muted space-y-1">
          {formula && (
            <p>
              <span className="font-semibold text-ink">Formula: </span>
              <span className="font-mono">{formula}</span>
            </p>
          )}
          {source && (
            <p>
              <span className="font-semibold text-ink">Source: </span>
              {source}
            </p>
          )}
          {timeBasis && (
            <p>
              <span className="font-semibold text-ink">Time basis: </span>
              {timeBasis}
            </p>
          )}
          {recommendedAction && (
            <p>
              <span className="font-semibold text-ink">Suggested action: </span>
              {recommendedAction}
            </p>
          )}
        </div>
      )}
      {children}
    </section>
  )
}
