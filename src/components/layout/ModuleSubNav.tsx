import { NavLink, useLocation } from 'react-router-dom'
import type { NavItem } from '@/lib/icons'

export function ModuleSubNav({ items }: { items: NavItem[] }) {
  const { search } = useLocation()

  return (
    <nav
      className="flex flex-wrap gap-1 rounded-lg border border-[#dce6df] bg-[#f7faf8] p-1 lg:hidden"
      aria-label="Module sections"
    >
      {items.map(({ path, label, icon: Icon }) => (
        <NavLink
          key={path}
          to={{ pathname: path, search }}
          className={({ isActive }) =>
            `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              isActive
                ? 'bg-brand-50 text-forest shadow-sm ring-1 ring-forest/10'
                : 'text-ink-muted hover:bg-white hover:text-ink'
            }`
          }
        >
          <Icon size={14} aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
