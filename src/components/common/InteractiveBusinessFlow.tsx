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
  /** compact = overview strip; large = primary lifecycle flow */
  size?: 'compact' | 'large'
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
  const lg = size === 'large'
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
      {/* >=1280px: one row (stage columns share width, gap columns fixed); narrower: wrap */}
      <ol
        className="flex flex-wrap items-stretch gap-1.5 [overflow-wrap:normal] [word-break:normal] xl:grid xl:gap-1.5"
        style={{
          gridTemplateColumns: stages
            .map((_, i) => (i < stages.length - 1 ? `minmax(0,1fr) ${gaps ? (lg ? '76px' : '68px') : '14px'}` : 'minmax(0,1fr)'))
            .join(' '),
        }}
      >
        {stages.map((s, i) => {
          const gap = gaps?.[i] ?? null
          const selected = selectedId === s.id
          const tone = s.status ?? 'neutral'
          return (
            <li key={s.id} className="flex flex-1 items-stretch gap-1.5 xl:contents">
              <button
                type="button"
                disabled={!s.onClick}
                onClick={s.onClick}
                aria-pressed={selected}
                className={`w-full rounded-lg border border-t-4 text-left transition-all ${lg ? 'min-w-[118px] px-3 py-3 xl:min-w-0' : 'min-w-[112px] px-3 py-2 xl:min-w-0'} ${
                  s.status ? TONE_BORDER[tone] : ''
                } ${
                  selected
                    ? 'border-forest bg-brand-50 shadow-md ring-2 ring-forest/30'
                    : s.available && s.onClick
                      ? 'border-[#dce6df] bg-white hover:-translate-y-0.5 hover:border-brand-400 hover:bg-brand-50 hover:shadow'
                      : s.available
                        ? 'cursor-default border-[#dce6df] bg-white'
                        : 'border-dashed border-[#c5d5cb] bg-[#f5f8f5] opacity-80'
                }`}
                title={s.available ? s.activity : 'Data unavailable for this stage'}
              >
                <div className="flex flex-wrap items-start justify-between gap-1">
                  <p className="text-xs font-semibold uppercase text-brand-600">
                    {i + 1}. {s.label}
                  </p>
                  {s.exceptionCount != null && s.exceptionCount > 0 && (
                    <span
                      className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded bg-red-50 px-1 text-xs font-semibold text-danger"
                      title={`${s.exceptionCount} open / investigating exceptions`}
                    >
                      <AlertTriangle size={11} />
                      {s.exceptionCount}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted">{s.activity}</p>
                <p className={`mt-1 font-mono text-ink ${lg ? 'text-xl font-bold' : 'text-[15px] font-semibold'}`}>
                  {s.available ? s.metricValue : 'Data unavailable'}
                </p>
                <p className="text-xs text-ink-muted">{s.metricLabel}</p>
                {s.statusLabel && (
                  <span className={`mt-1 inline-block rounded px-1 text-xs font-semibold ${TONE_BADGE[tone]}`}>
                    {s.statusLabel}
                  </span>
                )}
              </button>
              {i < stages.length - 1 &&
                (gap ? (
                  <button
                    type="button"
                    onClick={gap.onClick}
                    disabled={!gap.onClick}
                    aria-pressed={selectedId === gap.id}
                    title={gap.title ?? gap.label}
                    className={`flex shrink-0 flex-col items-center justify-center rounded-md border px-1 py-1 text-center leading-tight transition-colors ${lg ? 'w-[80px] text-[13px] xl:w-auto' : 'w-[76px] text-xs xl:w-auto'} ${
                      selectedId === gap.id
                        ? 'border-forest bg-brand-50 ring-2 ring-forest/30'
                        : 'border-transparent hover:border-[#dce6df] hover:bg-white'
                    }`}
                  >
                    <ChevronRight size={lg ? 18 : 14} className="text-ink-muted" />
                    <span className={`whitespace-nowrap rounded px-1.5 py-0.5 font-semibold ${lg ? 'text-sm' : ''} ${TONE_BADGE[gap.tone]}`}>{gap.value}</span>
                    <span className="mt-0.5 text-ink-muted">{gap.label}</span>
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
