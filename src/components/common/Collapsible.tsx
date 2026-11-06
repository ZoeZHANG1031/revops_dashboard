import { ChevronDown } from 'lucide-react'
import { useContext, useState, type ReactNode } from 'react'
import { CardNestingContext } from './cardContext'

/**
 * Level-3 disclosure. Top-level: its own card. Inside a card: an inline divider row (no nested card).
 */
export function Collapsible({
  title,
  subtitle,
  defaultOpen = false,
  children,
  actions,
  id,
  open: openProp,
  onToggle,
}: {
  title: string
  subtitle?: string
  defaultOpen?: boolean
  children: ReactNode
  actions?: ReactNode
  id?: string
  /** Controlled mode (optional): parent owns open state */
  open?: boolean
  onToggle?: (open: boolean) => void
}) {
  const [openState, setOpenState] = useState(defaultOpen)
  const open = openProp ?? openState
  const setOpen = (fn: (v: boolean) => boolean) => {
    const next = fn(open)
    if (openProp === undefined) setOpenState(next)
    onToggle?.(next)
  }
  const nested = useContext(CardNestingContext)
  const header = (
    <div className={`flex items-center justify-between gap-3 ${nested ? 'py-2' : 'px-5 py-3.5'}`}>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-start gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronDown
          size={16}
          className={`mt-0.5 shrink-0 text-ink-muted transition-transform ${open ? 'rotate-0' : '-rotate-90'}`}
        />
        <span>
          <span className={`block font-semibold text-ink ${nested ? 'text-[13px]' : 'text-[15px]'}`}>{title}</span>
          {subtitle && <span className="mt-0.5 block text-xs text-ink-muted">{subtitle}</span>}
        </span>
      </button>
      {actions}
    </div>
  )
  if (nested) {
    return (
      <div className="mt-3 border-t border-[#e8eeea]" id={id}>
        {header}
        {open && <div className="pt-1">{children}</div>}
      </div>
    )
  }
  return (
    <section className="card-surface overflow-hidden scroll-mt-4" id={id}>
      {header}
      {open && (
        <div className="border-t border-[#e8eeea] px-5 py-4">
          <CardNestingContext.Provider value>{children}</CardNestingContext.Provider>
        </div>
      )}
    </section>
  )
}
