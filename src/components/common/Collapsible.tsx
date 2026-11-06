import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'

export function Collapsible({
  title,
  subtitle,
  defaultOpen = false,
  children,
  actions,
}: {
  title: string
  subtitle?: string
  defaultOpen?: boolean
  children: ReactNode
  actions?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="card-surface overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown
            size={16}
            className={`mt-0.5 shrink-0 text-ink-muted transition-transform ${open ? 'rotate-0' : '-rotate-90'}`}
          />
          <span>
            <span className="block text-sm font-semibold text-ink">{title}</span>
            {subtitle && <span className="mt-0.5 block text-xs text-ink-muted">{subtitle}</span>}
          </span>
        </button>
        {actions}
      </div>
      {open && <div className="border-t border-[#e3ebe6] px-4 py-3">{children}</div>}
    </section>
  )
}
