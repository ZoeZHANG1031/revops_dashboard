import { Line, LineChart, ResponsiveContainer } from 'recharts'

interface SparklineProps {
  data: number[]
  stroke?: string
  height?: number
}

/** Tiny trend glyph — only render when ≥2 finite points exist. */
export function Sparkline({ data, stroke = '#123C35', height = 28 }: SparklineProps) {
  const points = data.filter((v) => Number.isFinite(v))
  if (points.length < 2) return null
  const series = points.map((v, i) => ({ i, v }))
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <Line isAnimationActive={false} type="monotone" dataKey="v" stroke={stroke} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
