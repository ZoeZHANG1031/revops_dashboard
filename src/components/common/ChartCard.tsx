import { Info, Lightbulb } from 'lucide-react'
import { useContext, useState, type ReactNode } from 'react'
import { CardNestingContext } from './cardContext'
import { MODULE_ICONS, type ModuleIconKey } from '@/lib/icons'


/**
 * Standard analysis module: Title → Key Insight → Chart → Drill-down.
 * Formula / source / time basis (Level 3) live behind the info toggle.
 */
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
  icon,
  iconTone = 'brand',
  id,
  insight,
  footer,
  emphasis,
}: {
  /** Module icon key (see MODULE_ICONS) */
  icon?: ModuleIconKey
  /** brand (default) · forecast (blue) · customer (purple) · risk (amber) */
  iconTone?: 'brand' | 'forecast' | 'customer' | 'risk'
  id?: string
  title: string
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
  businessQuestion?: string
  formula?: string
  source?: string
  timeBasis?: string
  recommendedAction?: string
  /** One computed, filter-aware takeaway shown above the chart */
  insight?: ReactNode
  /** Drill-down actions shown under the chart */
  footer?: ReactNode
  /** Primary module — slight lift */
  emphasis?: boolean
}) {
  const [metaOpen, setMetaOpen] = useState(false)
  const nested = useContext(CardNestingContext)
  // With an insight present, the business question moves to Level 3 (info panel) to cut text
  const questionInMeta = Boolean(insight && businessQuestion)
  const hasMeta = formula || source || timeBasis || recommendedAction || questionInMeta
  const Icon = icon ? MODULE_ICONS[icon] : null
  const toneCls =
    iconTone === 'forecast'
      ? 'text-forecast'
      : iconTone === 'customer'
        ? 'text-segment'
        : iconTone === 'risk'
          ? 'text-warning'
          : 'text-forest'

  return (
    <section
      className={nested ? 'border-t border-[#e8eeea] pt-4 first:border-t-0 first:pt-0' : `card-surface p-5 ${emphasis ? 'card-raised' : ''}`}
      id={id}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {Icon && <Icon size={18} strokeWidth={1.9} className={`shrink-0 ${toneCls}`} aria-hidden />}
            <h3 className="t-section text-ink">{title}</h3>
            {hasMeta && (
              <button
                type="button"
                className="rounded p-0.5 text-ink-muted hover:bg-brand-50 hover:text-brand-700"
                onClick={() => setMetaOpen((v) => !v)}
                aria-label="Chart methodology"
                aria-expanded={metaOpen}
                title="Business question, formula, source and time basis"
              >
                <Info size={15} />
              </button>
            )}
          </div>
          {subtitle && <p className="mt-1 text-[13px] text-ink-muted">{subtitle}</p>}
          {businessQuestion && !questionInMeta && (
            <p className="mt-1 text-[13px] font-medium text-forest-muted">{businessQuestion}</p>
          )}
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{action}</div>}
      </div>
      {metaOpen && hasMeta && (
        <div className="mb-3 space-y-1 rounded-lg border border-[#e1e9e4] bg-[#f7faf8] p-3 text-[13px] text-ink-muted">
          {questionInMeta && (
            <p>
              <span className="font-semibold text-ink">Business question: </span>
              {businessQuestion}
            </p>
          )}
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
      {insight && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border-l-[3px] border-forest/70 bg-brand-50/50 px-3 py-2 text-sm text-ink">
          <Lightbulb size={15} className="mt-0.5 shrink-0 text-forest" aria-label="Key insight" />
          <span>{insight}</span>
        </p>
      )}
      <CardNestingContext.Provider value>{children}</CardNestingContext.Provider>
      {footer && <div className="mt-3 flex flex-wrap items-center justify-end gap-2">{footer}</div>}
    </section>
  )
}
