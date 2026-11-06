import {
  Activity,
  Building2,
  GitCompare,
  LayoutDashboard,
  LineChart,
  Package,
  Users,
  Wallet,
} from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'

const NAV = [
  { to: '/', label: 'Company Overview', icon: Building2 },
  { to: '/executive', label: 'Executive Overview', icon: LayoutDashboard },
  { to: '/lifecycle', label: 'Revenue Lifecycle', icon: GitCompare },
  { to: '/reconciliation', label: 'Reconciliation', icon: Activity },
  { to: '/forecasting', label: 'Forecasting', icon: LineChart },
  { to: '/customers', label: 'Customer Intelligence', icon: Users },
  { to: '/unit-economics', label: 'Unit Economics', icon: Wallet },
]

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
            <p className="text-[10px] text-ink-muted">Intelligence Platform · Synthetic</p>
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
      <div className="border-t border-[#dce6df] p-3 text-[10px] leading-relaxed text-ink-muted">
        Independent demo inspired by last-mile ops visuals. Not a Jitsu product. Synthetic data only.
      </div>
    </aside>
  )
}
