import type { ReactNode } from 'react'
import { pageMeta } from '@/lib/icons'

/** Consistent page title: large icon on tinted tile, title, business question, scope, actions */
export function PageHeader({
  path,
  title,
  question,
  scope,
  actions,
}: {
  path: string
  title?: string
  question?: string
  scope?: ReactNode
  actions?: ReactNode
}) {
  const meta = pageMeta(path)
  const Icon = meta?.icon
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-forest ring-1 ring-forest/10"
            role="img"
            aria-label={`${meta?.label} page`}
            title={meta?.label}
          >
            <Icon size={22} strokeWidth={1.8} />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="t-page-title text-ink">{title ?? meta?.label}</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            {question ?? meta?.question}
            {scope ? <span className="text-ink-muted"> · {scope}</span> : null}
          </p>
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
