import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDashed, Info, MinusCircle, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export type StatusTone = 'good' | 'watch' | 'critical' | 'neutral' | 'unavailable'

const TONES: Record<StatusTone, { icon: LucideIcon; cls: string; default: string }> = {
  good: { icon: CheckCircle2, cls: 'bg-[#e8f5ee] text-success', default: 'Healthy' },
  watch: { icon: AlertTriangle, cls: 'bg-amber-50 text-warning', default: 'Watch' },
  critical: { icon: AlertOctagon, cls: 'bg-red-50 text-danger', default: 'Critical' },
  neutral: { icon: MinusCircle, cls: 'bg-[#f0f3f1] text-ink-muted', default: 'Info' },
  unavailable: { icon: CircleDashed, cls: 'bg-[#f0f3f1] text-ink-muted', default: 'Not evaluated' },
}

/** Status always shown as icon + text (never color alone) */
export function StatusIndicator({ tone, label, title }: { tone: StatusTone; label?: string; title?: string }) {
  const t = TONES[tone]
  const Icon = t.icon
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ${t.cls}`}
      title={title}
    >
      <Icon size={11} aria-hidden />
      {label ?? t.default}
    </span>
  )
}

/** Hover / focus tooltip for definitions — keeps long text out of the layout */
export function InfoTip({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <span className="group relative inline-flex items-center" tabIndex={0} aria-label={text}>
      {children ?? (
        <Info size={13} className="ml-1 cursor-help text-ink-muted/80 hover:text-forest" aria-hidden />
      )}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-72 rounded-lg border border-[#dce6df] bg-white p-2 text-[13px] font-normal normal-case leading-snug tracking-normal text-ink shadow-lg group-hover:block group-focus:block"
      >
        {text}
      </span>
    </span>
  )
}
