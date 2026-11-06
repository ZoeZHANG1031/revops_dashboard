import { AlertTriangle, ChevronRight } from 'lucide-react'

export type FlowTone = 'ok' | 'watch' | 'alert' | 'neutral'

export interface FlowStage {
  id: string
  label: string
  activity: string
  metricLabel: string
  metricValue: string
  available: boolean
  onClick?: () => void
  /** Optional rule-based stage status */
  status?: FlowTone
  statusLabel?: string
  /** Open / investigating exceptions mapped to this stage */
  exceptionCount?: number
}

/** Clickable variance / exception indicator rendered between stage i and i+1 */
export interface FlowGap {
  id: string
  label: string
  value: string
  tone: FlowTone
  onClick?: () => void
  title?: string
}

interface InteractiveBusinessFlowProps {
  stages: FlowStage[]
  title?: string
  subtitle?: string
  /** gaps[i] sits between stages[i] and stages[i+1] */
  gaps?: (FlowGap | null)[]
  selectedId?: string | null
  /** compact = overview strip; large = primary lifecycle flow; dense = name+value+badge only */
  size?: 'compact' | 'large' | 'dense'
}

const TONE_BORDER: Record<FlowTone, string> = {
  ok: 'border-t-success',
  watch: 'border-t-warning',
  alert: 'border-t-danger',
  neutral: 'border-t-[#c5d5cb]',
}
const TONE_BADGE: Record<FlowTone, string> = {
  ok: 'bg-[#e8f5ee] text-success',
  watch: 'bg-amber-50 text-warning',
  alert: 'bg-red-50 text-danger',
  neutral: 'bg-[#f0f3f1] text-ink-muted',
}

export function InteractiveBusinessFlow({
  stages,
  title = 'How the business works',
  subtitle = 'Click a stage to open the matching analysis',
  gaps,
  selectedId,
  size = 'compact',
}: InteractiveBusinessFlowProps) {
  const dense = size === 'dense'
  const lg = size === 'large' || dense
  return (
    <div>
      {(title || subtitle) && (
        <div className="mb-2">
          {title && (
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</p>
          )}
          {subtitle && <p className="text-[13px] text-ink-muted">{subtitle}</p>}
        </div>
      )}
      <ol
        className="flex flex-wrap items-stretch gap-1.5 [overflow-wrap:normal] [word-break:normal] xl:grid xl:gap-1.5"
        style={{
          gridTemplateColumns: stages
            .map((_, i) =>
              i < stages.length - 1
                ? `minmax(0,1fr) ${gaps ? (lg ? '64px' : '68px') : '14px'}`
                : 'minmax(0,1fr)',
            )
            .join(' '),
        }}
      >
        {stages.map((s, i) => {
          const gap = gaps?.[i] ?? null
          const selected = selectedId === s.id
          const tone = s.status ?? 'neutral'
          const showStatus = !dense && s.statusLabel
          const showStatusWatch = dense && s.statusLabel && tone !== 'ok' && tone !== 'neutral'
          return (
            <li key={s.id} className="flex flex-1 items-stretch gap-1.5 xl:contents">
              <button
                type="button"
                disabled={!s.onClick}
                onClick={s.onClick}
                aria-pressed={selected}
                className={`w-full rounded-lg border border-t-4 text-left transition-all ${
                  dense
                    ? 'min-w-[100px] px-2.5 py-2 xl:min-w-0'
                    : lg
                      ? 'min-w-[118px] px-3 py-3 xl:min-w-0'
                      : 'min-w-[112px] px-3 py-2 xl:min-w-0'
                } ${
                  s.status && (tone === 'watch' || tone === 'alert') ? TONE_BORDER[tone] : 'border-t-[#c5d5cb]'
                } ${
                  selected
                    ? 'border-forest bg-brand-50 shadow-md ring-2 ring-forest/30'
                    : s.available && s.onClick
                      ? 'border-[#dce6df] bg-white hover:-translate-y-0.5 hover:border-brand-400 hover:bg-brand-50 hover:shadow'
                      : s.available
                        ? 'cursor-default border-[#dce6df] bg-white'
                        : 'border-dashed border-[#c5d5cb] bg-[#f5f8f5] opacity-80'
                }`}
                title={s.available ? `${s.activity}${s.metricLabel ? ` · ${s.metricLabel}` : ''}` : 'Data unavailable for this stage'}
              >
                <div className="flex flex-wrap items-start justify-between gap-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                    {s.label}
                  </p>
                  {s.exceptionCount != null && s.exceptionCount > 0 && (
                    <span
                      className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded px-1 text-[10px] font-semibold ${
                        tone === 'alert' ? 'bg-red-50 text-danger' : 'bg-amber-50 text-warning'
                      }`}
                      title={`${s.exceptionCount} open / investigating exceptions`}
                    >
                      <AlertTriangle size={10} />
                      {s.exceptionCount}
                    </span>
                  )}
                </div>
                {!dense && <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted">{s.activity}</p>}
                <p
                  className={`mt-1 font-mono tabular-nums text-ink ${
                    dense ? 'text-lg font-semibold' : lg ? 'text-xl font-bold' : 'text-[15px] font-semibold'
                  }`}
                >
                  {s.available ? s.metricValue : 'Data unavailable'}
                </p>
                <p className={`text-ink-muted ${dense ? 'text-[10px] leading-tight' : 'text-xs'}`}>
                  {s.metricLabel}
                </p>
                {(showStatus || showStatusWatch) && s.statusLabel ? (
                  <span className={`mt-1 inline-block rounded px-1 text-[10px] font-semibold ${TONE_BADGE[tone]}`}>
                    {s.statusLabel}
                  </span>
                ) : null}
              </button>
              {i < stages.length - 1 &&
                (gap ? (
                  <button
                    type="button"
                    onClick={gap.onClick}
                    disabled={!gap.onClick}
                    aria-pressed={selectedId === gap.id}
                    title={gap.title ?? gap.label}
                    className={`flex shrink-0 flex-col items-center justify-center rounded-md border px-1 py-1 text-center leading-tight transition-colors ${
                      dense ? 'w-[60px] text-[10px] xl:w-auto' : lg ? 'w-[80px] text-[13px] xl:w-auto' : 'w-[76px] text-xs xl:w-auto'
                    } ${
                      selectedId === gap.id
                        ? 'border-forest bg-brand-50 ring-2 ring-forest/30'
                        : 'border-transparent hover:border-[#dce6df] hover:bg-white'
                    }`}
                  >
                    <ChevronRight size={dense ? 14 : lg ? 18 : 14} className="text-ink-muted" />
                    <span className={`whitespace-nowrap rounded px-1 py-0.5 font-semibold ${TONE_BADGE[gap.tone]}`}>
                      {gap.value}
                    </span>
                    <span className={`mt-0.5 text-ink-muted ${dense ? 'line-clamp-2 text-[9px] leading-tight' : ''}`}>
                      {gap.label}
                    </span>
                  </button>
                ) : (
                  <span className="hidden self-center text-ink-muted sm:inline" aria-hidden>
                    →
                  </span>
                ))}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
