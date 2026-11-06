import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
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
export function FloatingWaterfall({
  steps,
  height = 300,
}: {
  steps: WaterfallStep[]
  height?: number
}) {
  let running = 0
  const data = steps.map((step) => {
    if (step.key === 'forecast') {
      running = step.amount
      return {
        ...step,
        base: 0,
        rise: Math.max(step.amount, 0),
        fall: 0,
        display: step.amount,
        kind: 'absolute' as const,
      }
    }
    if (step.key === 'actual') {
      return {
        ...step,
        base: 0,
        rise: Math.max(step.amount, 0),
        fall: 0,
        display: step.amount,
        kind: 'absolute' as const,
      }
    }
    const start = running
    running = running + step.amount
    if (step.amount >= 0) {
      return {
        ...step,
        base: start,
        rise: step.amount,
        fall: 0,
        display: step.amount,
        kind: 'positive' as const,
      }
    }
    return {
      ...step,
      base: start + step.amount,
      rise: 0,
      fall: Math.abs(step.amount),
      display: step.amount,
      kind: 'negative' as const,
    }
  })

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 8, left: 8, bottom: 48 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#4a635e' }}
            interval={0}
            angle={-18}
            textAnchor="end"
            height={60}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#4a635e' }}
            tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`}
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
                    {formatCurrency(row.display)}
                  </p>
                </div>
              )
            }}
          />
          <ReferenceLine y={0} stroke="#9bb0a8" />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="rise" stackId="w" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell
                key={`${d.key}-rise`}
                fill={d.kind === 'absolute' ? (d.key === 'actual' ? '#00A86B' : '#123C35') : '#00A86B'}
              />
            ))}
          </Bar>
          <Bar dataKey="fall" stackId="w" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell key={`${d.key}-fall`} fill="#C44536" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
