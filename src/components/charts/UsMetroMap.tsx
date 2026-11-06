import { useEffect, useRef, useState } from 'react'
import { projectUs } from '@/data/metros'
import type { BubbleColorMetric, BubbleMetric, MetroFootprintRow } from '@/calc/companyOverview'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/money'

interface UsMetroMapProps {
  metros: MetroFootprintRow[]
  metric: BubbleMetric
  colorMetric?: BubbleColorMetric
  selectedMetro?: string | null
  onSelect: (row: MetroFootprintRow) => void
  /** Company CM% — baseline for relative-margin mode */
  companyMargin?: number | null
}

const US_OUTLINE_LL: [number, number][] = [
  [-124.7, 48.4], [-124.2, 42.0], [-124.4, 40.0], [-122.4, 37.8], [-120.5, 34.5],
  [-117.2, 32.5], [-114.7, 32.7], [-111.0, 31.3], [-108.2, 31.8], [-106.5, 31.8],
  [-103.0, 29.0], [-100.0, 28.0], [-97.2, 25.9], [-93.9, 29.7], [-89.2, 28.9],
  [-87.5, 30.2], [-85.5, 29.9], [-81.5, 25.2], [-80.1, 26.7], [-80.8, 32.0],
  [-75.5, 35.2], [-75.9, 36.9], [-74.9, 39.0], [-73.9, 40.6], [-70.0, 41.5],
  [-70.7, 43.1], [-67.0, 44.8], [-66.9, 44.8], [-69.8, 46.7], [-71.5, 45.0],
  [-74.5, 45.0], [-82.5, 41.7], [-84.5, 46.5], [-88.0, 48.0], [-95.0, 49.0],
  [-110.0, 49.0], [-123.0, 49.0], [-124.7, 48.4],
]

// Higher-contrast sequential steps (strong → weak) used by all modes
const STEPS = ['#0B7A4B', '#6DBE45', '#F0A53A', '#C44536']

function colorFor(row: MetroFootprintRow, colorMetric: BubbleColorMetric, companyMargin?: number | null): string {
  if (colorMetric === 'relativeMargin') {
    if (row.contributionMargin == null || companyMargin == null) return '#7a9a88'
    const d = row.contributionMargin - companyMargin
    if (d >= 3) return STEPS[0]
    if (d >= 0) return STEPS[1]
    if (d >= -3) return STEPS[2]
    return STEPS[3]
  }
  if (colorMetric === 'exceptions') {
    // Lower exception rate = healthier (business semantics, not sign)
    const r = row.exceptionRate
    if (r == null) return '#7a9a88'
    if (r < 1) return STEPS[0]
    if (r < 2.5) return STEPS[1]
    if (r < 5) return STEPS[2]
    return STEPS[3]
  }
  if (colorMetric === 'growth') {
    const g = row.shipmentGrowth
    if (g == null) return '#7a9a88'
    if (g >= 10) return STEPS[0]
    if (g >= 0) return STEPS[1]
    if (g >= -10) return STEPS[2]
    return STEPS[3]
  }
  const cm = row.contributionMargin
  if (cm == null) return '#7a9a88'
  if (cm >= 35) return STEPS[0]
  if (cm >= 25) return STEPS[1]
  if (cm >= 15) return STEPS[2]
  return STEPS[3]
}

function bubbleValue(m: MetroFootprintRow, metric: BubbleMetric): number {
  if (metric === 'shipments') return m.shipments
  if (metric === 'contribution') return Math.max(0, m.contribution)
  return m.revenue
}

export function UsMetroMap({
  metros,
  metric,
  colorMetric = 'contributionMargin',
  selectedMetro,
  onSelect,
  companyMargin,
}: UsMetroMapProps) {
  // Keep labels at ~12.5px on screen regardless of rendered map width (SVG units scale with width)
  const boxRef = useRef<HTMLDivElement>(null)
  const [unitPx, setUnitPx] = useState(0.6)
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = () => setUnitPx(Math.max(0.2, el.clientWidth / 1000))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const labelSize = 12.5 / unitPx
  const values = metros.map((m) => bubbleValue(m, metric))
  const max = Math.max(...values, 1)
  const outline = US_OUTLINE_LL.map(([lon, lat]) => {
    const { x, y } = projectUs(lon, lat, 1000, 520)
    return `${x},${y}`
  }).join(' ')

  const sizeLabel =
    metric === 'shipments' ? 'Shipments' : metric === 'contribution' ? 'Contribution $' : 'Net Billing'
  const colorLabel =
    colorMetric === 'growth'
      ? 'Shipment growth vs prior window'
      : colorMetric === 'exceptions'
        ? 'Exception rate (per 100 shipments)'
        : colorMetric === 'relativeMargin'
          ? `CM% vs company ${companyMargin == null ? '' : `(${companyMargin.toFixed(1)}%)`}`
          : 'Absolute CM%'
  const legend =
    colorMetric === 'exceptions'
      ? ['<1', '1–2.5', '2.5–5', '≥5']
      : colorMetric === 'growth'
        ? ['≥10%', '0–10%', '−10–0%', '<−10%']
        : colorMetric === 'relativeMargin'
          ? ['≥ +3 pts', '0 to +3', '−3 to 0', '< −3 pts']
          : ['≥35%', '25–35%', '15–25%', '<15%']
  const swatches = STEPS

  return (
    <div ref={boxRef} className="relative w-full overflow-hidden rounded-xl border border-[#dce6df] bg-[#eef5f0]">
      <svg viewBox="0 0 1000 520" className="h-[300px] w-full" role="img" aria-label="US metro footprint">
        <rect width="1000" height="520" fill="#e8f2ec" />
        <polygon points={outline} fill="#d2e4da" stroke="#8fad9c" strokeWidth="1.5" />
        {metros.map((m) => {
          const v = bubbleValue(m, metric)
          const r = 8 + Math.sqrt(v / max) * 26
          const selected = selectedMetro === m.metro
          const { x, y } = projectUs(m.lon, m.lat, 1000, 520)
          return (
            <g
              key={m.metro}
              transform={`translate(${x}, ${y})`}
              className="cursor-pointer"
              onClick={() => onSelect(m)}
            >
              <title>
                {`${m.metro} · ${m.region}
Shipments: ${formatNumber(m.shipments)}
Net Billing: ${formatCurrency(m.revenue)}
Contribution: ${formatCurrency(m.contribution)}
CM: ${formatPercent(m.contributionMargin)}${companyMargin != null && m.contributionMargin != null ? ` (${m.contributionMargin - companyMargin >= 0 ? '+' : ''}${(m.contributionMargin - companyMargin).toFixed(1)} pts vs company)` : ''}
Growth: ${m.shipmentGrowth == null ? 'Insufficient history' : formatPercent(m.shipmentGrowth)}
Exceptions: ${formatNumber(m.exceptionCount)} (${m.exceptionRate == null ? 'N/A' : `${m.exceptionRate.toFixed(1)} / 100 shipments`})
Click to select · syncs page`}
              </title>
              <circle
                r={r}
                fill={colorFor(m, colorMetric, companyMargin)}
                fillOpacity={selected ? 0.92 : 0.7}
                stroke={selected ? '#123C35' : '#fff'}
                strokeWidth={selected ? 2.5 : 1.2}
              />
              {/* ~13px on screen at typical widths; white halo keeps labels legible over bubbles */}
              <text
                y={r + labelSize}
                textAnchor="middle"
                style={{ fontSize: labelSize, fontWeight: 600, fill: '#123C35', paintOrder: 'stroke', stroke: '#eef5f0', strokeWidth: labelSize / 4 }}
              >
                {m.metro.replace(' Metro', '').replace(' Area', '')}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#dce6df] bg-white/90 px-3 py-1 text-xs text-ink-muted">
        <span>
          Size = {sizeLabel} · Color = {colorLabel}
        </span>
        <span className="flex flex-wrap gap-2">
          {legend.map((l, i) => (
            <span key={l} className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: swatches[i] }} />
              {l}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#7a9a88' }} />
            N/A
          </span>
        </span>
      </div>
    </div>
  )
}
