import { useMemo, useState } from 'react'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => React.ReactNode
  sortValue?: (row: T) => string | number
  align?: 'left' | 'right'
  /** Optional searchable text override (defaults to String(sortValue) or cell key) */
  searchValue?: (row: T) => string
}

const PAGE_SIZES = [25, 50, 100] as const

export function DataTable<T extends { id?: string }>({
  rows,
  columns,
  rowKey,
  onRowClick,
  emptyMessage = 'No rows for current filters',
  selectedKey,
  searchable = true,
  pageSizeOptions = PAGE_SIZES,
  defaultPageSize = 25,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  emptyMessage?: string
  /** Highlights the row whose rowKey matches (shared selection with charts) */
  selectedKey?: string | null
  searchable?: boolean
  pageSizeOptions?: readonly number[]
  defaultPageSize?: number
}) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [asc, setAsc] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(defaultPageSize)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) =>
      columns.some((c) => {
        const raw =
          c.searchValue?.(row) ??
          (c.sortValue ? String(c.sortValue(row)) : '')
        return raw.toLowerCase().includes(q)
      }),
    )
  }, [rows, query, columns])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sortValue) return filtered
    return [...filtered].sort((a, b) => {
      const av = col.sortValue!(a)
      const bv = col.sortValue!(b)
      if (av < bv) return asc ? -1 : 1
      if (av > bv) return asc ? 1 : -1
      return 0
    })
  }, [filtered, sortKey, asc, columns])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize)

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-ink-muted">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {searchable ? (
          <input
            type="search"
            className="filter-input min-w-[180px] max-w-xs"
            placeholder="Search table…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(0)
            }}
          />
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
          <span>
            {filtered.length === 0
              ? '0 rows'
              : `${safePage * pageSize + 1}–${Math.min((safePage + 1) * pageSize, sorted.length)} of ${sorted.length}`}
          </span>
          <label className="flex items-center gap-1">
            Rows
            <select
              className="filter-input py-0.5"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(0)
              }}
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded border border-[#dce6df] px-2 py-0.5 disabled:opacity-40"
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Prev
          </button>
          <button
            type="button"
            className="rounded border border-[#dce6df] px-2 py-0.5 disabled:opacity-40"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next
          </button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-ink-muted">
          No rows match “{query}”
        </div>
      ) : (
        <div className="overflow-auto scrollbar-thin rounded-lg border border-[#e1e9e4]">
          <table className="min-w-full text-left text-[13px]">
            <thead className="bg-[#f7faf8] text-xs font-semibold uppercase tracking-wide text-ink-muted">
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
              {pageRows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={`border-t border-slate-100 ${onRowClick ? 'cursor-pointer hover:bg-brand-50/50' : ''} ${
                    selectedKey != null && rowKey(row) === selectedKey
                      ? 'bg-brand-50 shadow-[inset_3px_0_0_#123C35]'
                      : ''
                  }`}
                  aria-selected={selectedKey != null && rowKey(row) === selectedKey}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2 text-ink ${c.align === 'right' ? 'whitespace-nowrap text-right font-mono' : ''}`}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
