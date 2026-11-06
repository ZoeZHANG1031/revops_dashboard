import { ArrowRight } from 'lucide-react'
import { pageMeta } from '@/lib/icons'

/** Cross-page link that shows the destination page icon so users know where a click goes */
export function DrilldownLink({
  to,
  label,
  onClick,
  variant = 'link',
}: {
  to: string
  label?: string
  onClick: () => void
  variant?: 'link' | 'button' | 'primary'
}) {
  const meta = pageMeta(to)
  const Icon = meta?.icon
  const text = label ?? meta?.label ?? to
  const cls =
    variant === 'primary'
      ? 'rounded-md bg-forest px-2 py-1 text-white hover:bg-forest-muted'
      : variant === 'button'
        ? 'rounded-md border border-[#dce6df] bg-white px-2 py-1 text-ink hover:border-brand-400 hover:bg-brand-50'
        : 'text-brand-700 hover:underline'
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`inline-flex items-center gap-1 text-[13px] font-medium transition-colors ${cls}`}
      title={`Open ${meta?.label ?? to} with current context`}
    >
      {Icon && <Icon size={12} aria-hidden />}
      {text}
      <ArrowRight size={11} aria-hidden />
    </button>
  )
}
