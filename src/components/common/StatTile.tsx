import type { ReactNode } from 'react'
import { InfoTip } from './StatusIndicator'

export type StatTone = 'good' | 'warn' | 'bad'

/**
 * Shared metric tile. primary = Level-1 KPI (30px value, slight lift); secondary = supporting KPI (22px).
 * Tone is a left accent + optional status text — never color alone.
 */
export function StatTile({
  label,
  value,
  hint,
  tone,
  size = 'secondary',
  tip,
  title,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: StatTone
  size?: 'primary' | 'secondary'
  tip?: string
  title?: string
}) {
  const border =
    tone === 'good' ? 'border-l-success' : tone === 'warn' ? 'border-l-warning' : tone === 'bad' ? 'border-l-danger' : 'border-l-[#e1e9e4]'
  const primary = size === 'primary'
  return (
    <div className={`card-surface h-full border-l-4 ${border} ${primary ? 'card-raised p-5' : 'p-4'}`} title={title}>
      <p className="t-kpi-label flex items-center uppercase text-ink-muted">
        {label}
        {tip && <InfoTip text={tip} />}
      </p>
      <p className={`mt-1.5 font-mono text-ink ${primary ? 't-kpi' : 'text-[22px] font-bold tracking-tight'}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  )
}
