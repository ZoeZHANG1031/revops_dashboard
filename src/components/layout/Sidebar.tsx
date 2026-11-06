import { Package } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { PAGE_META, PAGE_ORDER } from '@/lib/icons'

const NAV = PAGE_ORDER.map((p) => ({ to: p, label: PAGE_META[p].label, icon: PAGE_META[p].icon }))

export function Sidebar() {
  const { search } = useLocation()

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[#dce6df] bg-white">
      <div className="border-b border-[#dce6df] px-4 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-forest text-lime">
            <Package size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Last-Mile RevOps</p>
            <p className="text-xs text-ink-muted">Intelligence Platform · Synthetic</p>
          </div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={{ pathname: to, search }}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-brand-50 font-medium text-forest'
                  : 'text-ink-muted hover:bg-[#f5f8f5] hover:text-ink'
              }`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-[#dce6df] p-3 text-xs leading-relaxed text-ink-muted">
        Independent demo inspired by last-mile ops visuals. Not a Jitsu product. Synthetic data only.
      </div>
    </aside>
  )
}
