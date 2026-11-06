import { ArrowRight } from 'lucide-react'
import { formatCurrency } from '@/lib/money'
import { StatusIndicator, type StatusTone } from './StatusIndicator'

export type IssueSeverity = 'healthy' | 'watch' | 'critical' | 'unavailable'

export interface IssueCardProps {
  title: string
  severity: IssueSeverity
  financialImpact: number | null
  evidence: string
  suggestedOwner: string
  recommendedAction: string
  onInvestigate: () => void
  impactNote?: string
  drillLabel?: string
}

const SEV: Record<IssueSeverity, { tone: StatusTone; label: string; border: string }> = {
  critical: { tone: 'critical', label: 'Critical', border: 'border-l-danger' },
  watch: { tone: 'watch', label: 'Watch', border: 'border-l-warning' },
  healthy: { tone: 'good', label: 'Healthy', border: 'border-l-success' },
  unavailable: { tone: 'unavailable', label: 'Not evaluated', border: 'border-l-slate-300' },
}

export function IssueCard({
  title,
  severity,
  financialImpact,
  evidence,
  suggestedOwner,
  recommendedAction,
  onInvestigate,
  impactNote,
  drillLabel,
}: IssueCardProps) {
  const sev = SEV[severity]
  return (
    <button
      type="button"
      onClick={onInvestigate}
      className={`card-surface flex h-full flex-col border-l-4 ${sev.border} p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] font-semibold text-ink">{title}</p>
        <StatusIndicator tone={sev.tone} label={sev.label} />
      </div>
      <p className="mt-2 font-mono text-[24px] font-bold tracking-tight text-ink">
        {financialImpact == null ? 'N/A' : formatCurrency(financialImpact, true)}
      </p>
      {impactNote && <p className="text-xs text-ink-muted">{impactNote}</p>}
      <dl className="mt-2 space-y-0.5 text-[13px] text-ink-muted">
        <div className="line-clamp-2">
          <dt className="inline font-medium text-ink">Evidence: </dt>
          <dd className="inline">{evidence}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-ink">Suggested owner: </dt>
          <dd className="inline">{suggestedOwner}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-ink">Action: </dt>
          <dd className="inline">{recommendedAction}</dd>
        </div>
      </dl>
      <p className="mt-auto inline-flex items-center gap-1 pt-2 text-[13px] font-medium text-brand-700">
        {drillLabel ?? 'Drill down'} <ArrowRight size={11} aria-hidden />
      </p>
    </button>
  )
}
