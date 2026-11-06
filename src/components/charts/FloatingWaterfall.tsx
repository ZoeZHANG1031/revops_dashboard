import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { WrapTick } from './WrapTick'
import { formatCurrency } from '@/lib/money'

export interface WaterfallStep {
  key: string
  label: string
  amount: number
}

/**
 * Floating (bridge) waterfall:
 * - Forecast & Actual are absolute bars from 0
 * - Intermediate steps float from prior running total (invisible base + signed delta)
 */
/** Tiny invisible segment so every bar has a non-empty top for its label */
const LABEL_CAP = 1e-6

export function FloatingWaterfall({
  steps,
  height = 300,
  totalKeys = ['forecast', 'actual'],
  showLabels = true,
  valueFormat,
  tickFormat,
}: {
  steps: WaterfallStep[]
  height?: number
  /** Signed value label above each bar */
  showLabels?: boolean
  /** Exact value formatter (tooltip + labels); defaults to whole-dollar currency */
  valueFormat?: (v: number) => string
  /** Y-axis tick formatter; defaults to $Nk */
  tickFormat?: (v: number) => string
  /** Keys rendered as absolute level bars from 0 (running total resets to their amount) */
  totalKeys?: string[]
}) {
  const isTotal = (k: string) => totalKeys.includes(k)
  const fmt = valueFormat ?? ((v: number) => formatCurrency(v))
  const tick = tickFormat ?? ((v: number) => `${v < 0 ? '−' : ''}$${(Math.abs(v) / 1000).toFixed(0)}k`)

  // Running level before each step (pure prefix computation — no render-time mutation)
  const startLevels = steps.map((_, i) =>
    steps.slice(0, i).reduce((lvl, st) => (isTotal(st.key) ? st.amount : lvl + st.amount), 0),
  )
  const data = steps.map((step, i) => {
    const start = startLevels[i]
    const kind: 'absolute' | 'positive' | 'negative' = isTotal(step.key)
      ? 'absolute'
      : step.amount >= 0
        ? 'positive'
        : 'negative'
    const labelText =
      kind === 'absolute' ? fmt(step.amount) : `${step.amount >= 0 ? '+' : '−'}${fmt(Math.abs(step.amount))}`
    const common = { ...step, display: step.amount, kind, labelText, cap: LABEL_CAP }
    if (kind === 'absolute') {
      // Negative level (e.g. operating loss) drawn below zero rather than hidden
      return { ...common, base: 0, rise: Math.max(step.amount, 0), fall: Math.min(step.amount, 0) }
    }
    if (kind === 'positive') return { ...common, base: start, rise: step.amount, fall: 0 }
    return { ...common, base: start + step.amount, rise: 0, fall: Math.abs(step.amount) }
  })

  // Label rendered on the transparent cap that tops every stack; text comes from the row itself
  const renderLabel = (props: { x?: number | string; y?: number | string; width?: number | string; value?: unknown }) => {
    const txt = String(props.value ?? '')
    if (!txt) return null
    const x = Number(props.x) + Number(props.width) / 2
    return (
      <text x={x} y={Number(props.y) - 4} textAnchor="middle" fontSize={12} fontWeight={600} fill={txt.startsWith('−') ? '#C44536' : '#123C35'}>
        {txt}
      </text>
    )
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 22, right: 8, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" vertical={false} />
          <XAxis dataKey="label" tick={<WrapTick maxChars={11} />} interval={0} height={44} />
          <YAxis
            tick={{ fontSize: 12 }}
            width={56}
            tickFormatter={(v) => tick(Number(v))}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0].payload as (typeof data)[0]
              return (
                <div className="rounded-lg border border-[#dce6df] bg-white px-3 py-2 text-xs shadow-md">
                  <p className="font-semibold text-ink">{row.label}</p>
                  <p className="font-mono text-forest">
                    {row.kind === 'absolute' ? 'Level: ' : 'Impact: '}
                    {row.kind === 'absolute' ? '' : row.display >= 0 ? '+' : '−'}
                    {fmt(row.kind === 'absolute' ? row.display : Math.abs(row.display))}
                  </p>
                </div>
              )
            }}
          />
          <ReferenceLine y={0} stroke="#9bb0a8" />
          <Bar isAnimationActive={false} dataKey="base" stackId="w" fill="transparent" />
          <Bar isAnimationActive={false} dataKey="rise" stackId="w" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell
                key={`${d.key}-rise`}
                fill={d.kind === 'absolute' ? (d.key === 'actual' || d.key === steps[steps.length - 1]?.key ? '#00A86B' : '#123C35') : '#00A86B'}
              />
            ))}
          </Bar>
          <Bar isAnimationActive={false} dataKey="fall" stackId="w" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell key={`${d.key}-fall`} fill="#C44536" />
            ))}
          </Bar>
          {showLabels && (
            <Bar isAnimationActive={false} dataKey="cap" stackId="w" fill="transparent" legendType="none" tooltipType="none">
              <LabelList dataKey="labelText" content={renderLabel} />
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
