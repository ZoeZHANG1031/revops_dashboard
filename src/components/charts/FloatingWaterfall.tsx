import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  usePlotArea,
  useYAxisScale,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCurrencyPrecise } from '@/lib/money'
import {
  axisTickFormatter,
  buildWaterfallModel,
  clipToDomain,
  formatBridgeMoney,
  rowFill,
  signedLabel,
  summarizeWaterfall,
  WATERFALL_COLORS,
  waterfallDomain,
  type WaterfallRow,
  type WaterfallScaleMode,
  type WaterfallStep,
} from '@/lib/waterfall'
import { WrapTick } from './WrapTick'

export type { WaterfallStep, WaterfallScaleMode, WaterfallRow }

type ChartRow = WaterfallRow & { axisLabel: string; range: [number, number] }

/**
 * Floating bridge waterfall.
 *
 * Geometry is drawn directly from the canonical model (lib/waterfall): every delta bar spans exactly
 * [min(before, after), max(before, after)] in data space and is clipped to the plot area; totals span
 * [0, value] and are clipped at the axis floor in Variance Focus. Connectors sit at each row's
 * cumulativeAfter. Recharts only supplies axes, grid, scale and tooltip hit-areas.
 */
export function FloatingWaterfall({
  steps,
  height = 300,
  totalKeys = ['forecast', 'actual'],
  showLabels = true,
  valueFormat,
  tickFormat,
  onStepClick,
  selectedKey,
  footingNote,
  labelColorMode = 'sign',
  scaleMode: scaleModeProp,
  showScaleToggle = true,
  respectStepColors = false,
  filterSummary,
  showSummary = true,
  summaryMode = 'full',
}: {
  steps: WaterfallStep[]
  height?: number
  showLabels?: boolean
  /** Exact value formatter (tooltip) */
  valueFormat?: (v: number) => string
  /** Axis / bar-label formatter (compact) */
  tickFormat?: (v: number) => string
  totalKeys?: string[]
  onStepClick?: (key: string) => void
  selectedKey?: string | null
  /** Replaces the default footing line (pass null to hide) */
  footingNote?: string | null
  labelColorMode?: 'sign' | 'neutral'
  scaleMode?: WaterfallScaleMode
  showScaleToggle?: boolean
  respectStepColors?: boolean
  filterSummary?: string
  /** Show the compact footing / attribution line under the chart */
  showSummary?: boolean
  /** 'footing' = only Start + Σ = End (use when the card header already shows attribution) */
  summaryMode?: 'full' | 'footing'
}) {
  const [scaleModeLocal, setScaleModeLocal] = useState<WaterfallScaleMode>('variance')
  const scaleMode = scaleModeProp ?? scaleModeLocal
  const fmtPrecise = valueFormat ?? ((v: number) => formatCurrencyPrecise(v))
  /** Bar labels: caller's unit formatter if given (e.g. per-package $), else compact bridge money */
  const fmtLabel = tickFormat ?? formatBridgeMoney

  const rows = useMemo(() => buildWaterfallModel(steps, totalKeys), [steps, totalKeys])
  const summary = useMemo(() => summarizeWaterfall(rows), [rows])
  const { domain, truncated } = useMemo(() => waterfallDomain(rows, scaleMode), [rows, scaleMode])
  const axisTick = useMemo(() => tickFormat ?? axisTickFormatter(domain), [tickFormat, domain])

  // Unique category keys (duplicate short labels would collapse bands)
  const data: ChartRow[] = useMemo(() => {
    const seen = new Map<string, number>()
    return rows.map((r) => {
      const n = seen.get(r.shortLabel) ?? 0
      seen.set(r.shortLabel, n + 1)
      return {
        ...r,
        axisLabel: n ? `${r.shortLabel}${'​'.repeat(n)}` : r.shortLabel,
        range: [r.lowerBound, r.upperBound] as [number, number],
      }
    })
  }, [rows])

  if (!steps.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-xs text-ink-muted">
        No data for this bridge in the current filters
      </div>
    )
  }

  const hasResidual = rows.some((r) => r.isResidual)

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-ink-muted">
          <Swatch color={WATERFALL_COLORS.start} label="Start" />
          <Swatch color={WATERFALL_COLORS.positive} label="Increase" />
          <Swatch color={WATERFALL_COLORS.negative} label="Decrease" />
          {hasResidual && <Swatch color={WATERFALL_COLORS.residual} label="Residual" />}
          <Swatch color={WATERFALL_COLORS.end} label="End" />
          {truncated && (
            <span
              className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-900"
              title="Y-axis does not start at zero: total bars are cut at the axis floor. Delta bars keep exact geometry; labels and tooltips show true amounts."
            >
              Axis truncated
            </span>
          )}
        </div>
        {showScaleToggle && scaleModeProp == null && (
          <div className="flex overflow-hidden rounded border border-[#dce6df] text-[11px]" role="tablist" aria-label="Waterfall scale">
            {(['variance', 'full'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={scaleMode === m}
                className={`px-2 py-0.5 font-medium ${scaleMode === m ? 'bg-[#123C35] text-white' : 'bg-white text-ink-muted hover:bg-brand-50'}`}
                onClick={() => setScaleModeLocal(m)}
              >
                {m === 'variance' ? 'Variance focus' : 'Full scale'}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ height }} data-testid="floating-waterfall">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 26, right: 10, left: 4, bottom: 4 }} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" vertical={false} />
            <XAxis dataKey="axisLabel" tick={<WrapTick maxChars={11} />} interval={0} height={46} />
            <YAxis
              tick={{ fontSize: 11 }}
              width={60}
              domain={domain}
              allowDataOverflow
              tickFormatter={(v) => axisTick(Number(v))}
            />
            {domain[0] <= 0 && domain[1] >= 0 && <ReferenceLine y={0} stroke="#9bb0a8" />}
            <Tooltip
              cursor={{ fill: 'rgba(18,60,53,0.05)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const r = payload[0].payload as ChartRow
                return (
                  <div className="max-w-xs rounded-lg border border-[#dce6df] bg-white px-3 py-2 text-xs shadow-md">
                    <p className="font-semibold text-ink">{r.label}</p>
                    {r.type === 'delta' ? (
                      <>
                        <p className="font-mono text-ink">Impact {signedLabel(r, fmtPrecise)}</p>
                        <p className="text-ink-muted">
                          Cumulative {fmtPrecise(r.cumulativeBefore)} → {fmtPrecise(r.cumulativeAfter)}
                        </p>
                        {r.isResidual && <p className="text-amber-800">Unexplained residual — not attributed to a driver</p>}
                      </>
                    ) : (
                      <p className="font-mono text-ink">Total {fmtPrecise(r.signedValue)}</p>
                    )}
                    {r.note && <p className="mt-1 text-ink-muted">{r.note}</p>}
                    {filterSummary && <p className="mt-1 text-[11px] text-ink-muted">{filterSummary}</p>}
                  </div>
                )
              }}
            />
            {/* Transparent range bars: hover/tooltip hit-areas only (visible geometry is drawn below) */}
            <Bar isAnimationActive={false} dataKey="range" fill="transparent" legendType="none" />
            <WaterfallLayer
              rows={data}
              domain={domain}
              showLabels={showLabels}
              labelColorMode={labelColorMode}
              respectStepColors={respectStepColors}
              selectedKey={selectedKey ?? null}
              onStepClick={onStepClick}
              fmtShort={fmtLabel}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {showSummary && footingNote !== null && (
        <p className={`mt-1 text-[11px] ${summary.reconciles ? 'text-ink-muted' : 'text-amber-800'}`}>
          {footingNote ??
            (summary.footingGap == null
              ? null
              : summary.reconciles
                ? `${fmtPrecise(summary.start ?? 0)} ${summary.deltaSum >= 0 ? '+' : '−'} ${fmtPrecise(Math.abs(summary.deltaSum))} = ${fmtPrecise(summary.end ?? 0)} ✓`
                : `Does not foot: gap ${fmtPrecise(summary.footingGap)} (shown as-is)`)}
          {summaryMode === 'full' && hasResidual && summary.attributionCoverage != null && (
            <span className="ml-2">
              · Attribution {summary.attributionCoverage.toFixed(1)}% · Residual {signedMoney(summary.residual, fmtLabel)}
            </span>
          )}
        </p>
      )}
    </div>
  )
}

function signedMoney(v: number, fmt: (v: number) => string) {
  return v === 0 ? fmt(0) : `${v > 0 ? '+' : '−'}${fmt(Math.abs(v))}`
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> {label}
    </span>
  )
}

/** Draws bars, connectors and labels in data space using the chart's own Y scale and plot area. */
function WaterfallLayer({
  rows,
  domain,
  showLabels,
  labelColorMode,
  respectStepColors,
  selectedKey,
  onStepClick,
  fmtShort,
}: {
  rows: ChartRow[]
  domain: [number, number]
  showLabels: boolean
  labelColorMode: 'sign' | 'neutral'
  respectStepColors: boolean
  selectedKey: string | null
  onStepClick?: (key: string) => void
  fmtShort: (v: number) => string
}) {
  const plot = usePlotArea()
  const yScale = useYAxisScale()
  if (!plot || !yScale || !rows.length) return null
  const y = (v: number) => Number(yScale(v))
  const band = plot.width / rows.length
  const barW = Math.max(6, band * 0.62)
  const xOf = (i: number) => plot.x + i * band + (band - barW) / 2
  const clipId = `wf-clip-${Math.round(plot.x)}-${Math.round(plot.width)}-${rows.length}`

  return (
    <g className="waterfall-layer">
      <defs>
        <clipPath id={clipId}>
          <rect x={plot.x} y={plot.y} width={plot.width} height={plot.height} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {/* Connectors at the exact running total between adjacent bars */}
        {rows.slice(0, -1).map((r, i) => {
          const level = r.cumulativeAfter
          if (level < domain[0] || level > domain[1]) return null
          const yy = y(level)
          return (
            <line
              key={`c-${r.id}-${i}`}
              x1={xOf(i) + barW}
              x2={xOf(i + 1)}
              y1={yy}
              y2={yy}
              stroke="#6b8579"
              strokeWidth={1}
              strokeDasharray="3 2"
              pointerEvents="none"
            />
          )
        })}
        {rows.map((r, i) => {
          const fill = rowFill(r, respectStepColors)
          const vis = clipToDomain(r.lowerBound, r.upperBound, domain)
          const selected = selectedKey === r.id
          const clickable = onStepClick && r.type === 'delta'
          if (Math.abs(r.signedValue) < 1e-9 || !vis) {
            // Zero delta (or fully off-axis): thin marker at the cumulative level
            const lvl = Math.min(Math.max(r.cumulativeAfter, domain[0]), domain[1])
            return (
              <line
                key={`b-${r.id}-${i}`}
                x1={xOf(i)}
                x2={xOf(i) + barW}
                y1={y(lvl)}
                y2={y(lvl)}
                stroke={fill}
                strokeWidth={2}
              />
            )
          }
          const top = y(vis[1])
          const bottom = y(vis[0])
          return (
            <rect
              key={`b-${r.id}-${i}`}
              data-row={r.id}
              data-lower={r.lowerBound}
              data-upper={r.upperBound}
              x={xOf(i)}
              y={top}
              width={barW}
              height={Math.max(1, bottom - top)}
              rx={2}
              fill={fill}
              stroke={selected ? '#0B3D2E' : r.type !== 'delta' ? '#0B3D2E' : 'none'}
              strokeWidth={selected ? 2 : r.type !== 'delta' ? 0.75 : 0}
              cursor={clickable ? 'pointer' : undefined}
              onClick={clickable ? () => onStepClick!(r.id) : undefined}
            />
          )
        })}
      </g>
      {showLabels &&
        rows.map((r, i) => {
          const vis = clipToDomain(r.lowerBound, r.upperBound, domain)
          const upper = vis ? vis[1] : Math.min(Math.max(r.cumulativeAfter, domain[0]), domain[1])
          const yy = Math.max(plot.y + 10, y(upper) - 5)
          const color =
            labelColorMode === 'neutral' || r.type !== 'delta'
              ? '#123C35'
              : r.direction === 'negative'
                ? '#B03A2E'
                : r.direction === 'positive'
                  ? '#1F6B4A'
                  : '#4a635e'
          return (
            <text
              key={`l-${r.id}-${i}`}
              x={xOf(i) + barW / 2}
              y={yy}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill={color}
              pointerEvents="none"
            >
              {signedLabel(r, fmtShort)}
            </text>
          )
        })}
    </g>
  )
}
