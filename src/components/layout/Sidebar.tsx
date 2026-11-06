/**
 * IA map (Phase 1): `/executive` Executive Command Center (default home);
 * `/lifecycle` Revenue Performance › Revenue Flow; `/reconciliation` › Billing & Reconciliation;
 * `/unit-economics` › Profitability; `/customers` Customer Intelligence › Portfolio;
 * `/customer-360` via portfolio only; `/forecasting` Revenue Forecasting; `/actions` Action Center;
 * `/company` Company & Network Profile (was `/` Company Overview).
 */
import { ChevronDown, Package } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { NAV_MODULES, type NavModule } from '@/lib/icons'

const PRIMARY_MODULES = NAV_MODULES.filter((m) => m.id !== 'company')
const COMPANY_MODULE = NAV_MODULES.find((m) => m.id === 'company')!

function moduleActive(mod: NavModule, pathname: string): boolean {
  if (mod.path) return pathname === mod.path
  return mod.children?.some((c) => pathname === c.path) ?? false
}

export function Sidebar() {
  const { pathname, search } = useLocation()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const autoExpandIds = useMemo(() => {
    const ids: string[] = []
    for (const mod of NAV_MODULES) {
      if (mod.children?.some((c) => c.path === pathname)) ids.push(mod.id)
    }
    return ids
  }, [pathname])

  useEffect(() => {
    if (autoExpandIds.length === 0) return
    setExpanded((prev) => {
      let next = prev
      for (const id of autoExpandIds) {
        if (!prev[id]) {
          next = { ...next, [id]: true }
        }
      }
      return next
    })
  }, [autoExpandIds])

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
      isActive ? 'bg-brand-50 font-medium text-forest' : 'text-ink-muted hover:bg-[#f5f8f5] hover:text-ink'
    }`

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
        {PRIMARY_MODULES.map((mod) => {
          if (mod.children) {
            const open = expanded[mod.id] ?? false
            const parentActive = moduleActive(mod, pathname)
            return (
              <div key={mod.id} className="flex flex-col gap-0.5">
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    parentActive && !open
                      ? 'bg-brand-50/60 font-medium text-forest'
                      : 'text-ink-muted hover:bg-[#f5f8f5] hover:text-ink'
                  }`}
                  aria-expanded={open}
                  onClick={() => setExpanded((e) => ({ ...e, [mod.id]: !open }))}
                >
                  <mod.icon size={16} />
                  <span className="flex-1">{mod.label}</span>
                  <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-0' : '-rotate-90'}`} />
                </button>
                {open && (
                  <div className="ml-2 flex flex-col gap-0.5 border-l border-[#dce6df] pl-2">
                    {mod.children.map((child) => (
                      <NavLink key={child.path} to={{ pathname: child.path, search }} className={linkClass}>
                        <child.icon size={15} />
                        {child.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          }
          return (
            <NavLink key={mod.id} to={{ pathname: mod.path!, search }} className={linkClass}>
              <mod.icon size={16} />
              {mod.label}
            </NavLink>
          )
        })}
      </nav>
      <div className="p-2">
        <NavLink to={{ pathname: COMPANY_MODULE.path!, search }} className={linkClass}>
          <COMPANY_MODULE.icon size={16} />
          {COMPANY_MODULE.label}
        </NavLink>
      </div>
      <div className="border-t border-[#dce6df] p-3 text-xs leading-relaxed text-ink-muted">
        Independent demo inspired by last-mile ops visuals. Not a Jitsu product. Synthetic data only.
      </div>
    </aside>
  )
}
