import { useMemo, useState } from 'react'
import {
  ACTION_PRIORITY_RULE,
  buildActionCenter,
  type ActionItem,
} from '@/calc/actionCenter'
import { ChartCard } from '@/components/common/ChartCard'
import { DataTable } from '@/components/common/DataTable'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusIndicator } from '@/components/common/StatusIndicator'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { formatCurrency, formatCurrencyPrecise, formatNumber } from '@/lib/money'

type StatusOverride = Record<string, string>

const STORAGE_KEY = 'revops_action_status_v1'

function loadOverrides(): StatusOverride {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StatusOverride) : {}
  } catch {
    return {}
  }
}

export function ActionCenterPage() {
  const { data, filters, navigateWithContext, openCustomer360, updateExceptionStatus } = useApp()
  const [overrides, setOverrides] = useState<StatusOverride>(() => loadOverrides())
  const [ownerFilter, setOwnerFilter] = useState('')
  const [priorityMin, setPriorityMin] = useState(0)

  const raw = useMemo(() => buildActionCenter(data, filters), [data, filters])
  const items = useMemo(() => {
    return raw
      .map((a) => ({
        ...a,
        status: overrides[a.id] ?? a.status,
      }))
      .filter((a) => (ownerFilter ? a.owner === ownerFilter : true))
      .filter((a) => (a.priorityScore ?? 0) >= priorityMin)
  }, [raw, overrides, ownerFilter, priorityMin])

  const owners = [...new Set(raw.map((a) => a.owner))].sort()

  const setStatus = (item: ActionItem, status: string) => {
    const next = { ...overrides, [item.id]: status }
    setOverrides(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    if (item.sourceException && ['Open', 'Investigating', 'Resolved', 'Rejected', 'Accepted'].includes(status)) {
      updateExceptionStatus(
        item.sourceException.exception_id,
        status as 'Open' | 'Investigating' | 'Resolved' | 'Rejected' | 'Accepted',
      )
    }
  }

  const byClass = useMemo(() => {
    const m = new Map<string, { count: number; impact: number }>()
    for (const a of items) {
      const cur = m.get(a.category) ?? { count: 0, impact: 0 }
      cur.count += 1
      cur.impact += a.financialImpact
      m.set(a.category, cur)
    }
    return [...m.entries()].map(([category, v]) => ({
      category,
      count: v.count,
      impact: Math.round(v.impact * 100) / 100,
    }))
  }, [items])

  return (
    <div className="space-y-4">
      <PageHeader
        path="/actions"
        title="Action Center"
        scope="Deduped open actions from exceptions, health, and margin signals · Demo status persists in localStorage"
        actions={
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
            onClick={() =>
              exportToCsv(
                'action_center.csv',
                items.map((a) => ({
                  id: a.id,
                  category: a.category,
                  title: a.title,
                  impact: a.financialImpact,
                  owner: a.owner,
                  status: a.status,
                  priority: a.priorityScore,
                  confidence: a.confidence,
                  customer_id: a.customerId,
                  period: `${filters.startPeriod}_${filters.endPeriod}`,
                  disclaimer: 'Synthetic',
                })),
              )
            }
          >
            Export Actions
          </button>
        }
      />

      <p className="text-[12px] text-ink-muted">{ACTION_PRIORITY_RULE}</p>
      <p className="text-[12px] text-amber-800">
        Exposure classes are listed separately and must not be summed into one “revenue loss” number.
      </p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {byClass.map((c) => (
          <div key={c.category} className="rounded-lg border border-[#e1e9e4] bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-ink-muted">{c.category}</div>
            <div className="font-mono text-sm font-semibold">{formatCurrency(c.impact, true)}</div>
            <div className="text-[11px] text-ink-muted">{formatNumber(c.count)} open</div>
          </div>
        ))}
        {byClass.length === 0 && (
          <div className="col-span-full rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-ink-muted">
            No actionable exceptions under current filters.
          </div>
        )}
      </div>

      <ChartCard
        title="Prioritized actions"
        subtitle="Click a row to open source · status changes persist locally (Demo Mode)"
        action={
          <div className="flex flex-wrap gap-2 text-xs">
            <select
              className="filter-input"
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
            >
              <option value="">All owners</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <select
              className="filter-input"
              value={priorityMin}
              onChange={(e) => setPriorityMin(Number(e.target.value))}
            >
              <option value={0}>All priorities</option>
              <option value={8}>Priority ≥ 8</option>
              <option value={10}>Priority ≥ 10</option>
            </select>
          </div>
        }
      >
        <DataTable
          rows={items.map((a) => ({ ...a, id: a.id }))}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'pri',
              header: 'Pri',
              align: 'right',
              render: (r) => String(r.priorityScore ?? '—'),
              sortValue: (r) => r.priorityScore ?? 0,
            },
            { key: 'cat', header: 'Class', render: (r) => r.category, sortValue: (r) => r.category },
            { key: 'title', header: 'Issue', render: (r) => r.title, sortValue: (r) => r.title },
            {
              key: 'imp',
              header: 'Impact',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.financialImpact),
              sortValue: (r) => r.financialImpact,
            },
            { key: 'own', header: 'Owner', render: (r) => r.owner },
            {
              key: 'conf',
              header: 'Conf',
              render: (r) => r.confidence ?? '—',
            },
            {
              key: 'st',
              header: 'Status',
              render: (r) => (
                <select
                  className="filter-input py-0.5 text-[12px]"
                  value={r.status}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setStatus(r, e.target.value)}
                >
                  {['Open', 'Investigating', 'Resolved', 'Rejected', 'Accepted'].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ),
            },
          ]}
          onRowClick={(r) => {
            if (r.category === 'Compensation Audit') {
              navigateWithContext('/sales-compensation', {
                customerId: r.customerId ?? undefined,
                sourcePage: '/actions',
              })
              return
            }
            if (r.category === 'Customer Revenue Risk' && r.customerId) {
              openCustomer360(r.customerId)
              return
            }
            if (r.category === 'Margin Pressure') {
              navigateWithContext('/unit-economics', { sourcePage: '/actions' })
              return
            }
            navigateWithContext('/reconciliation', {
              exceptionType: r.sourceException?.exception_type ?? null,
              openEntity: r.sourceException
                ? {
                    entityType: 'exception',
                    entityId: r.sourceException.exception_id,
                    label: r.title,
                  }
                : null,
              sourcePage: '/actions',
            })
          }}
        />
      </ChartCard>

      <StatusIndicator tone="neutral" label="Demo Mode" title="Status overrides stored in browser localStorage only" />
    </div>
  )
}
