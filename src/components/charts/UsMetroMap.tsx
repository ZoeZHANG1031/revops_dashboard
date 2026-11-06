import type { BubbleMetric, MetroFootprintRow } from '@/calc/companyOverview'
import { formatCurrency, formatNumber } from '@/lib/money'

interface UsMetroMapProps {
  metros: MetroFootprintRow[]
  metric: BubbleMetric
  selectedMetro?: string | null
  onSelect: (row: MetroFootprintRow) => void
}

/** Simplified continental US outline (viewBox 0 0 1000 620) for bubble overlay — not a survey-grade map. */
const US_OUTLINE =
  'M 160,120 L 220,95 L 310,88 L 400,92 L 480,85 L 560,90 L 640,100 L 720,115 L 780,140 L 820,180 L 850,230 L 860,290 L 850,350 L 820,400 L 780,440 L 720,470 L 650,490 L 580,500 L 500,505 L 420,500 L 350,485 L 290,460 L 240,420 L 200,370 L 175,310 L 160,250 L 155,190 Z'

export function UsMetroMap({ metros, metric, selectedMetro, onSelect }: UsMetroMapProps) {
  const values = metros.map((m) => (metric === 'shipments' ? m.shipments : m.revenue))
  const max = Math.max(...values, 1)

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-gradient-to-b from-[#eef6f1] to-[#f7faf8]">
      <svg viewBox="0 0 1000 620" className="h-auto w-full" role="img" aria-label="US metro footprint">
        <path d={US_OUTLINE} fill="#d5e8dd" stroke="#9cb9a8" strokeWidth="2" />
        {metros.map((m) => {
          const v = metric === 'shipments' ? m.shipments : m.revenue
          const r = 10 + Math.sqrt(v / max) * 36
          const selected = selectedMetro === m.metro
          return (
            <g
              key={m.metro}
              transform={`translate(${m.x}, ${m.y})`}
              className="cursor-pointer"
              onClick={() => onSelect(m)}
            >
              <title>
                {`${m.metro} (${m.region})\nShipments: ${formatNumber(m.shipments)}\nNet Billing: ${formatCurrency(m.revenue)}\nCoords: ${m.lat.toFixed(2)}, ${m.lon.toFixed(2)} · ${m.source}`}
              </title>
              <circle
                r={r}
                fill={selected ? '#123C35' : '#00A86B'}
                fillOpacity={selected ? 0.85 : 0.55}
                stroke={selected ? '#0a2420' : '#123C35'}
                strokeWidth={selected ? 2.5 : 1}
              />
              <text
                y={r + 14}
                textAnchor="middle"
                className="fill-ink"
                style={{ fontSize: 11, fontWeight: 600 }}
              >
                {m.metro.replace(' Metro', '')}
              </text>
            </g>
          )
        })}
      </svg>
      <p className="absolute bottom-2 left-3 text-[10px] text-ink-muted">
        Bubbles sized by {metric === 'shipments' ? 'Shipment Volume' : 'Net Billing'} · Metro centroids from
        explicit catalog (not random)
      </p>
    </div>
  )
}
