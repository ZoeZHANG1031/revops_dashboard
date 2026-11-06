import { useMemo, useState } from 'react'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => React.ReactNode
  sortValue?: (row: T) => string | number
  align?: 'left' | 'right'
}

export function DataTable<T extends { id?: string }>({
  rows,
  columns,
  rowKey,
  onRowClick,
  emptyMessage = 'No rows for current filters',
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  emptyMessage?: string
}) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [asc, setAsc] = useState(false)

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sortValue) return rows
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a)
      const bv = col.sortValue!(b)
      if (av < bv) return asc ? -1 : 1
      if (av > bv) return asc ? 1 : -1
      return 0
    })
  }, [rows, sortKey, asc, columns])

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-ink-muted">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="overflow-auto scrollbar-thin rounded-lg border border-slate-200">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-ink-muted">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`whitespace-nowrap px-3 py-2 font-semibold ${c.align === 'right' ? 'text-right' : ''} ${c.sortValue ? 'cursor-pointer select-none hover:text-ink' : ''}`}
                onClick={() => {
                  if (!c.sortValue) return
                  if (sortKey === c.key) setAsc((v) => !v)
                  else {
                    setSortKey(c.key)
                    setAsc(false)
                  }
                }}
              >
                {c.header}
                {sortKey === c.key ? (asc ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              className={`border-t border-slate-100 ${onRowClick ? 'cursor-pointer hover:bg-brand-50/50' : ''}`}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-2 text-ink ${c.align === 'right' ? 'text-right font-mono' : ''}`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
