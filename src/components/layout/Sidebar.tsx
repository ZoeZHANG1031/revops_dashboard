/**
 * Two-level RevOps IA: Business Module → Analysis Page.
 * Expand state persists for the session; active child path auto-expands its parent.
 */
import { ChevronDown, Package } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { NAV_MODULES, type NavModule } from '@/lib/icons'

function childActive(path: string, pathname: string): boolean {
  return pathname === path
}

function moduleActive(mod: NavModule, pathname: string): boolean {
  if (mod.path) return pathname === mod.path
  return mod.children?.some((c) => childActive(c.path, pathname)) ?? false
}

export function Sidebar() {
  const { pathname, search } = useLocation()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const autoExpandIds = useMemo(() => {
    const ids: string[] = []
    for (const mod of NAV_MODULES) {
      if (mod.children?.some((c) => childActive(c.path, pathname))) ids.push(mod.id)
    }
    return ids
  }, [pathname])

  useEffect(() => {
    if (autoExpandIds.length === 0) return
    setExpanded((prev) => {
      let next = prev
      for (const id of autoExpandIds) {
        if (!prev[id]) next = { ...next, [id]: true }
      }
      return next
    })
  }, [autoExpandIds])

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
      isActive
        ? 'bg-brand-50 font-medium text-forest ring-1 ring-inset ring-forest/15'
        : 'text-ink-muted hover:bg-[#f5f8f5] hover:text-ink'
    }`

  const childLinkClass = ({ isActive }: { isActive: boolean }) =>
    `relative flex items-center gap-2 rounded-lg py-1.5 pl-3 pr-2 text-[13px] transition-colors ${
      isActive
        ? 'bg-brand-50 font-medium text-forest before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-forest'
        : 'text-ink-muted hover:bg-[#f5f8f5] hover:text-ink'
    }`

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-[#dce6df] bg-white">
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
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {NAV_MODULES.map((mod) => {
          if (mod.children) {
            const open = expanded[mod.id] ?? false
            const parentActive = moduleActive(mod, pathname)
            return (
              <div key={mod.id} className="flex flex-col gap-0.5">
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    parentActive
                      ? 'font-medium text-forest'
                      : 'text-ink-muted hover:bg-[#f5f8f5] hover:text-ink'
                  }`}
                  aria-expanded={open}
                  onClick={() => setExpanded((e) => ({ ...e, [mod.id]: !open }))}
                >
                  <mod.icon size={16} className="shrink-0" />
                  <span className="flex-1 leading-snug">{mod.label}</span>
                  <ChevronDown
                    size={14}
                    className={`shrink-0 transition-transform ${open ? 'rotate-0' : '-rotate-90'}`}
                  />
                </button>
                {open && (
                  <div className="ml-3 flex flex-col gap-0.5 border-l border-[#dce6df] pl-2">
                    {mod.children.map((child) => (
                      <NavLink
                        key={child.path}
                        to={{ pathname: child.path, search }}
                        className={childLinkClass}
                        title={child.question}
                      >
                        <child.icon size={14} className="shrink-0 opacity-80" />
                        <span className="leading-snug">{child.label}</span>
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
      <div className="border-t border-[#dce6df] p-3 text-xs leading-relaxed text-ink-muted">
        Independent demo inspired by last-mile ops visuals. Not a Jitsu product. Synthetic data only.
      </div>
    </aside>
  )
}
