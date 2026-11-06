/**
 * Visual-first building blocks shared by Executive, Client Quality, Risk & Retention.
 * Every chart: hover → detail tooltip · click → select customer / dimension.
 */
import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import type { WatchlistRow } from '@/calc/clientQuality'
import type { HealthBand } from '@/calc/customerHealth'
import {
  BANDS,
  PRIOR_BANDS,
  type BandSlice,
  type HealthMigration,
  type MigrationCell,
  type RiskDriverBar,
  type RiskDriverKey,
} from '@/calc/portfolioVisuals'
import { InfoTip } from '@/components/common/StatusIndicator'
import { shortLabel } from '@/lib/labels'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/money'

/**
 * Ordinal risk-band colors (validated: adjacent CVD ΔE ≥ 13.6). Healthy/Watchlist are
 * deliberately recessive so only real risk (orange/red) draws the eye. Always paired with labels.
 */
export const BAND_COLOR: Record<HealthBand, string> = {
  Healthy: '#2F7D62',
  Watchlist: '#9DB8AC',
  'At Risk': '#E58A2B',
  Critical: '#C44536',
}
const NEUTRAL_BAR = '#2E6B5E'
const MUTED_BAR = '#A8B5AF'
const GRID = '#e3ebe6'
const SELECTED_STROKE = '#123C35'

export function BandBadge({ band, title }: { band: HealthBand; title?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-ink"
      style={{ background: `${BAND_COLOR[band]}26` }}
      title={title}
    >
      <span className="inline-block h-2 w-2 rounded-sm" style={{ background: BAND_COLOR[band] }} aria-hidden />
      {band}
    </span>
  )
}

export function BandLegend({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap gap-3 text-[11px] text-ink-muted ${className}`}>
      {BANDS.map((b) => (
        <span key={b} className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: BAND_COLOR[b] }} aria-hidden />
          {b}
        </span>
      ))}
    </div>
  )
}

/** Log-scale axis with readable 1-3-10 ticks spanning the positive values */
export function logAxis(values: number[]): { ticks: number[]; domain: [number, number] } {
  const pos = values.filter((v) => v > 0)
  const min = pos.length ? Math.min(...pos) : 1
  const max = pos.length ? Math.max(...pos) : 10
  const lo = Math.pow(10, Math.floor(Math.log10(min)))
  const ticks: number[] = []
  for (let d = lo; d <= max * 10; d *= 10) for (const m of [1, 3]) if (d * m >= lo && d * m <= max * 3) ticks.push(d * m)
  const hiTick = ticks.find((t) => t >= max) ?? max
  return { ticks: ticks.filter((t) => t <= hiTick), domain: [lo, hiTick] }
}

export function compactMoneyTick(n: number): string {
  if (n >= 1e6) return `$${Number((n / 1e6).toFixed(1))}M`
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`
  if (n >= 1) return `$${Math.round(n)}`
  return `$${Number(n.toPrecision(1))}`
}

function TipBox({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-xs rounded-lg border border-[#dce6df] bg-white px-3 py-2 text-[12px] leading-snug text-ink shadow-md">
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// KPI strip — max 4 per page
// ---------------------------------------------------------------------------

export interface KpiItem {
  label: string
  value: string
  sub?: string
  tip: string
  tone?: 'risk' | 'watch' | 'neutral'
  onClick?: () => void
}

export function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.slice(0, 4).map((k) => {
        const body = (
          <>
            <p className="flex items-center text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              {k.label}
              <InfoTip text={k.tip} />
            </p>
            <p
              className={`mt-1 font-mono text-[26px] font-semibold leading-tight tabular-nums ${
                k.tone === 'risk' ? 'text-danger' : k.tone === 'watch' ? 'text-amber-800' : 'text-ink'
              }`}
            >
              {k.value}
            </p>
            {k.sub && <p className="mt-0.5 truncate text-[12px] text-ink-muted">{k.sub}</p>}
          </>
        )
        return k.onClick ? (
          <button
            key={k.label}
            type="button"
            onClick={k.onClick}
            className="card-surface px-4 py-3 text-left transition hover:-translate-y-0.5 hover:shadow-md"
          >
            {body}
          </button>
        ) : (
          <div key={k.label} className="card-surface px-4 py-3">
            {body}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Insights — max 3, two lines each, evidence on demand
// ---------------------------------------------------------------------------

export interface InsightItem {
  id: string
  tone: 'risk' | 'watch' | 'neutral'
  title: string
  detail: string
  evidence?: string[]
  action?: { label: string; onClick: () => void }
}

export function InsightList({ items }: { items: InsightItem[] }) {
  const [open, setOpen] = useState<string | null>(null)
  if (items.length === 0) return <p className="text-sm text-ink-muted">No actionable signal under current filters.</p>
  return (
    <ol className="space-y-2">
      {items.slice(0, 3).map((it, i) => {
        const isOpen = open === it.id
        return (
          <li
            key={it.id}
            className={`rounded-lg border-l-[3px] bg-white px-3 py-2 ${
              it.tone === 'risk' ? 'border-l-danger' : it.tone === 'watch' ? 'border-l-warning' : 'border-l-forest/40'
            }`}
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 font-mono text-[11px] font-semibold text-ink-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[13px] leading-snug text-ink">
                  <span className="font-semibold">{it.title}</span> {it.detail}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  {it.action && (
                    <button type="button" className="text-[12px] font-medium text-forest underline" onClick={it.action.onClick}>
                      {it.action.label}
                    </button>
                  )}
                  {it.evidence && it.evidence.length > 0 && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-0.5 text-[12px] text-ink-muted hover:text-ink"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : it.id)}
                    >
                      Evidence
                      <ChevronDown size={12} className={isOpen ? '' : '-rotate-90'} />
                    </button>
                  )}
                </div>
                {isOpen && it.evidence && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-ink-muted">
                    {it.evidence.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ---------------------------------------------------------------------------
// Portfolio health distribution — 100% stacked bar (clients vs revenue)
// ---------------------------------------------------------------------------

export function HealthDistributionChart({
  slices,
  onSelectBand,
  activeBand,
}: {
  slices: BandSlice[]
  onSelectBand?: (band: HealthBand) => void
  activeBand?: HealthBand | null
}) {
  const rows = [
    { metric: 'Clients', ...Object.fromEntries(slices.map((s) => [s.band, s.clientShare])) },
    { metric: 'Revenue', ...Object.fromEntries(slices.map((s) => [s.band, s.revenueShare])) },
  ]
  const byBand = new Map(slices.map((s) => [s.band, s]))
  return (
    <div>
      <div className="h-[118px]" aria-label="Share of clients and revenue by risk band">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }} barCategoryGap={14}>
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis type="category" dataKey="metric" width={62} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: 'transparent' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                return (
                  <TipBox>
                    <p className="mb-1 font-semibold">{label} by risk band</p>
                    {BANDS.map((b) => {
                      const s = byBand.get(b)!
                      return (
                        <p key={b} className="flex justify-between gap-3">
                          <span>{b}</span>
                          <span className="font-mono">
                            {label === 'Clients'
                              ? `${s.clients} · ${s.clientShare.toFixed(0)}%`
                              : `${formatCurrency(s.revenue, true)} · ${s.revenueShare.toFixed(0)}%`}
                          </span>
                        </p>
                      )
                    })}
                  </TipBox>
                )
              }}
            />
            {BANDS.map((b, i) => (
              <Bar
                key={b}
                dataKey={b}
                stackId="s"
                fill={BAND_COLOR[b]}
                stroke="#fff"
                strokeWidth={2}
                isAnimationActive={false}
                cursor={onSelectBand ? 'pointer' : undefined}
                fillOpacity={activeBand && activeBand !== b ? 0.35 : 1}
                radius={i === 0 ? [4, 0, 0, 4] : i === BANDS.length - 1 ? [0, 4, 4, 0] : 0}
                onClick={() => onSelectBand?.(b)}
              >
                <LabelList
                  dataKey={b}
                  position="center"
                  formatter={(v: unknown) => (Number(v) >= 9 ? `${Number(v).toFixed(0)}%` : '')}
                  style={{ fontSize: 11, fill: b === 'Watchlist' ? '#123C35' : '#fff', fontWeight: 600 }}
                />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <BandLegend className="mt-1 pl-[62px]" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Priority ranking — compact horizontal bars
// ---------------------------------------------------------------------------

export function PriorityRankChart({
  rows,
  onSelect,
  selectedId,
  valueKey = 'priorityScore',
}: {
  rows: WatchlistRow[]
  onSelect: (customerId: string) => void
  selectedId?: string | null
  valueKey?: 'priorityScore' | 'scenarioRevenueAtRisk' | 'revenue'
}) {
  const isMoney = valueKey !== 'priorityScore'
  return (
    <div style={{ height: Math.max(120, rows.length * 34 + 16) }} aria-label="Client ranking">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap={8}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis
            type="category"
            dataKey="customerName"
            width={138}
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => shortLabel(String(v), 20)}
            interval={0}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: '#f0f5f2' }}
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null
              const r = payload[0].payload as WatchlistRow
              return (
                <TipBox>
                  <p className="font-semibold">{r.customerName}</p>
                  <p>
                    {r.healthBand} · Health {r.healthScore ?? 'N/A'}
                    {r.healthScoreChange != null ? ` (${r.healthScoreChange >= 0 ? '+' : ''}${r.healthScoreChange} vs prior)` : ''}
                  </p>
                  <p>
                    Revenue {formatCurrency(r.revenue, true)} · growth {formatPercent(r.revenueGrowth)} · CM{' '}
                    {formatPercent(r.contributionMargin)}
                  </p>
                  <p>Signals: {r.riskTypes.length ? r.riskTypes.join(', ') : 'none'}</p>
                  {r.overrideReason && <p className="mt-1 text-ink-muted">Override: {r.overrideReason}</p>}
                  <p className="mt-1 text-ink-muted">
                    Priority {r.priorityScore.toFixed(0)} = {r.priorityReason}
                  </p>
                </TipBox>
              )
            }}
          />
          <Bar
            dataKey={valueKey}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
            cursor="pointer"
            onClick={(d) => {
              const id = (d as unknown as { customerId?: string }).customerId
              if (id) onSelect(id)
            }}
          >
            {rows.map((r) => (
              <Cell
                key={r.customerId}
                fill={BAND_COLOR[r.healthBand]}
                stroke={r.customerId === selectedId ? SELECTED_STROKE : undefined}
                strokeWidth={r.customerId === selectedId ? 2 : 0}
              />
            ))}
            <LabelList
              dataKey={valueKey}
              position="right"
              formatter={(v: unknown) => (isMoney ? formatCurrency(Number(v), true) : Number(v).toFixed(0))}
              style={{ fontSize: 11, fill: '#4a635e' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Client Health × Revenue matrix
// ---------------------------------------------------------------------------

export type BubbleSize = 'contributionProfit' | 'scenarioRevenueAtRisk'

export function HealthRevenueMatrix({
  rows,
  sizeBy,
  onSelect,
  selectedId,
  height = 300,
}: {
  rows: WatchlistRow[]
  sizeBy: BubbleSize
  onSelect: (customerId: string) => void
  selectedId?: string | null
  height?: number
}) {
  const pts = rows
    .filter((r) => r.revenue > 0 && r.healthScore != null)
    .map((r) => ({ ...r, z: Math.max(1, sizeBy === 'contributionProfit' ? r.contributionProfit : r.scenarioRevenueAtRisk) }))
  const hidden = rows.length - pts.length
  // Readable log ticks (1-3-10 steps) and a Y floor that keeps the band lines without empty space
  const { ticks: xTicks, domain: xDomain } = logAxis(pts.map((p) => p.revenue))
  const minScore = Math.min(...pts.map((p) => p.healthScore as number), 100)
  const yMin = Math.max(0, Math.min(40, Math.floor((minScore - 5) / 10) * 10))
  const yTicks = [yMin, 50, 70, 85, 100].filter((t, i, a) => t >= yMin && a.indexOf(t) === i)
  return (
    <div>
      <div style={{ height }} aria-label="Health score versus revenue by client">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 22, left: 4 }}>
            <CartesianGrid stroke={GRID} />
            <XAxis
              type="number"
              dataKey="revenue"
              scale="log"
              domain={xDomain}
              ticks={xTicks}
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => compactMoneyTick(Number(v))}
              label={{ value: 'Revenue contribution (Net Billing, log scale)', position: 'insideBottom', offset: -12, fontSize: 11, fill: '#4a635e' }}
            />
            <YAxis
              type="number"
              dataKey="healthScore"
              domain={[yMin, 100]}
              ticks={yTicks}
              tick={{ fontSize: 11 }}
              width={40}
              label={{ value: 'Health score', angle: -90, position: 'insideLeft', offset: 12, fontSize: 11, fill: '#4a635e' }}
            />
            <ZAxis type="number" dataKey="z" range={[36, 520]} />
            <ReferenceLine y={70} stroke="#b9c8c0" strokeDasharray="4 3" />
            <ReferenceLine y={50} stroke="#E58A2B" strokeOpacity={0.6} strokeDasharray="4 3" />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              wrapperStyle={{ zIndex: 50 }}
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null
                const r = payload[0].payload as (typeof pts)[number]
                return (
                  <TipBox>
                    <p className="font-semibold">{r.customerName}</p>
                    <p>
                      {r.healthBand} · Health {r.healthScore}
                      {r.healthScoreChange != null ? ` (${r.healthScoreChange >= 0 ? '+' : ''}${r.healthScoreChange})` : ''}
                    </p>
                    <p>Revenue {formatCurrency(r.revenue, true)} · growth {formatPercent(r.revenueGrowth)}</p>
                    <p>
                      CM {formatPercent(r.contributionMargin)} · contribution {formatCurrency(r.contributionProfit, true)}
                    </p>
                    <p>Scenario exposure {formatCurrency(r.scenarioRevenueAtRisk, true)}</p>
                    <p className="mt-1 text-ink-muted">Risk driver: {r.riskTypes[0] ?? 'none'}</p>
                    <p className="text-[11px] text-forest">Click → Client 360</p>
                  </TipBox>
                )
              }}
            />
            <Scatter
              data={pts}
              isAnimationActive={false}
              cursor="pointer"
              onClick={(d) => {
                const id = (d as unknown as { customerId?: string }).customerId
                if (id) onSelect(id)
              }}
            >
              {pts.map((p) => (
                <Cell
                  key={p.customerId}
                  fill={BAND_COLOR[p.healthBand]}
                  fillOpacity={0.85}
                  stroke={p.customerId === selectedId ? SELECTED_STROKE : '#fff'}
                  strokeWidth={p.customerId === selectedId ? 2.5 : 1.5}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <BandLegend />
        <p className="text-[11px] text-ink-muted">
          Bubble = {sizeBy === 'contributionProfit' ? 'contribution profit' : 'scenario revenue exposure'}
          {hidden > 0 ? ` · ${hidden} client(s) with ≤ $0 revenue not plotted` : ''}
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Risk driver distribution
// ---------------------------------------------------------------------------

export function RiskDriverChart({
  bars,
  metric,
  onSelect,
  active,
}: {
  bars: RiskDriverBar[]
  metric: 'clients' | 'revenue'
  onSelect?: (key: RiskDriverKey) => void
  active?: RiskDriverKey | null
}) {
  const data = [...bars].sort((a, b) => b[metric] - a[metric])
  const max = Math.max(...data.map((d) => d[metric]), 0)
  return (
    <div style={{ height: data.length * 36 + 12 }} aria-label="Clients and revenue by risk signal">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }} barCategoryGap={8}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" hide domain={[0, Math.max(1, max)]} />
          <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 12 }} interval={0} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: '#f0f5f2' }}
            content={({ active: a, payload }) => {
              if (!a || !payload?.[0]) return null
              const r = payload[0].payload as RiskDriverBar
              return (
                <TipBox>
                  <p className="font-semibold">{r.label}</p>
                  <p>
                    {r.clients} client{r.clients === 1 ? '' : 's'} · {formatCurrency(r.revenue, true)} revenue involved
                  </p>
                  <p className="mt-1 text-ink-muted">Rule: {r.rule}</p>
                  {onSelect && <p className="text-[11px] text-forest">Click → filter clients</p>}
                </TipBox>
              )
            }}
          />
          <Bar
            dataKey={metric}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
            cursor={onSelect ? 'pointer' : undefined}
            onClick={(d) => {
              const k = (d as unknown as { key?: RiskDriverKey }).key
              if (k) onSelect?.(k)
            }}
          >
            {data.map((d, i) => (
              <Cell
                key={d.key}
                fill={active ? (active === d.key ? NEUTRAL_BAR : MUTED_BAR) : i === 0 && d[metric] > 0 ? '#E58A2B' : NEUTRAL_BAR}
              />
            ))}
            <LabelList
              dataKey={metric}
              position="right"
              formatter={(v: unknown) => (metric === 'revenue' ? formatCurrency(Number(v), true) : formatNumber(Number(v)))}
              style={{ fontSize: 11, fill: '#4a635e' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Health migration heatmap (prior band → current band)
// ---------------------------------------------------------------------------

export function MigrationHeatmap({
  migration,
  onSelectCell,
  activeCell,
  metric = 'clients',
}: {
  migration: HealthMigration
  onSelectCell?: (cell: MigrationCell) => void
  activeCell?: { from: string; to: string } | null
  metric?: 'clients' | 'revenue'
}) {
  const max = Math.max(...migration.cells.map((c) => c[metric]), 1)
  const rowsShown = PRIOR_BANDS.filter(
    (b) => b !== 'No prior score' || migration.cells.some((c) => c.from === b && c.clients > 0),
  )
  const cell = (from: string, to: string) => migration.cells.find((c) => c.from === from && c.to === to)!
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-separate border-spacing-1 text-[12px]" aria-label="Health migration matrix">
        <thead>
          <tr>
            <th className="w-[120px] text-left align-bottom text-[11px] font-medium text-ink-muted">
              Prior ↓ · Current →
            </th>
            {BANDS.map((b) => (
              <th key={b} className="pb-1 text-center font-semibold text-ink">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: BAND_COLOR[b] }} aria-hidden />
                  {b}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowsShown.map((from) => (
            <tr key={from}>
              <th className="pr-1 text-left font-medium text-ink">{from}</th>
              {BANDS.map((to) => {
                const c = cell(from, to)
                const v = c[metric]
                const intensity = v > 0 ? 0.12 + 0.68 * (v / max) : 0
                const isActive = activeCell?.from === from && activeCell?.to === to
                const worsened = c.direction === 1 && v > 0
                const improved = c.direction === -1 && v > 0
                return (
                  <td key={to} className="p-0">
                    <button
                      type="button"
                      disabled={c.clients === 0 || !onSelectCell}
                      onClick={() => onSelectCell?.(c)}
                      title={`${from} → ${to}: ${c.clients} client(s) · ${formatCurrency(c.revenue, true)} revenue`}
                      className={`flex h-12 w-full flex-col items-center justify-center rounded-md text-center transition ${
                        c.clients > 0 && onSelectCell ? 'cursor-pointer hover:ring-2 hover:ring-forest/40' : 'cursor-default'
                      } ${isActive ? 'ring-2 ring-forest' : ''} ${worsened ? 'outline outline-2 -outline-offset-2 outline-[#E58A2B]' : ''}`}
                      style={{ background: v > 0 ? `rgba(18,60,53,${intensity})` : '#f4f7f5' }}
                    >
                      <span
                        className={`font-mono text-[13px] font-semibold ${intensity > 0.5 ? 'text-white' : 'text-ink'}`}
                      >
                        {c.clients > 0 ? (metric === 'revenue' ? formatCurrency(c.revenue, true) : c.clients) : '·'}
                      </span>
                      {c.clients > 0 && (worsened || improved) && (
                        <span className={`text-[10px] ${intensity > 0.5 ? 'text-white/85' : 'text-ink-muted'}`}>
                          {worsened ? '▼ worse' : '▲ better'}
                        </span>
                      )}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MigrationSummary({ m }: { m: HealthMigration }) {
  return (
    <p className="text-[12px] text-ink-muted">
      <span className="font-semibold text-danger">{m.worsened} worsened</span> ·{' '}
      <span className="font-semibold text-success">{m.improved} improved</span> · {m.stable} same band
      {m.noPrior > 0 ? ` · ${m.noPrior} no prior score` : ''} · vs {m.priorLabel ?? 'prior window'}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Segmented toggle (real state switch — no decorative buttons)
// ---------------------------------------------------------------------------

export function Toggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: [T, string][]
}) {
  return (
    <div className="inline-flex rounded-lg border border-[#dce6df] bg-white p-0.5 text-xs" role="group">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          className={`rounded-md px-2 py-0.5 ${value === v ? 'bg-forest font-medium text-white' : 'text-ink-muted hover:text-ink'}`}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

