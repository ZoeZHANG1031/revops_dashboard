import type { ReactNode } from 'react'

/** Compact KPI for analysis pages — short label, large value, optional hint/tag */
export function CompactKpi({
  label,
  value,
  hint,
  tag,
  onClick,
  active,
}: {
  label: string
  value: ReactNode
  hint?: string
  tag?: string
  onClick?: () => void
  active?: boolean
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
        {tag ? (
          <span className="rounded bg-[#f0f3f1] px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
            {tag}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums text-ink sm:text-2xl">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">{hint}</p> : null}
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`rounded-xl border bg-white px-3 py-2.5 text-left transition-colors ${
          active
            ? 'border-forest ring-1 ring-forest/20'
            : 'border-[#dce6df] hover:border-brand-400 hover:bg-[#f7faf8]'
        }`}
      >
        {body}
      </button>
    )
  }
  return <div className="rounded-xl border border-[#dce6df] bg-white px-3 py-2.5">{body}</div>
}

export function OneLineInsight({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-[#dce6df] bg-[#f7faf8] px-3 py-1.5 text-xs text-ink">
      {children}
    </p>
  )
}
