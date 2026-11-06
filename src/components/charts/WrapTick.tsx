/**
 * Category axis tick that wraps long names onto up to `lines` horizontal lines (no rotation).
 * Recharts clones this element and injects x / y / payload.
 */
export function WrapTick({
  x = 0,
  y = 0,
  payload,
  maxChars = 12,
  lines = 2,
  fontSize = 12,
}: {
  x?: number | string
  y?: number | string
  payload?: { value?: string | number }
  maxChars?: number
  lines?: number
  fontSize?: number
}) {
  const full = String(payload?.value ?? '')
  const words = full.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (next.length <= maxChars || !cur) cur = next
    else {
      out.push(cur)
      cur = w
    }
  }
  if (cur) out.push(cur)
  let shown = out.slice(0, lines)
  if (out.length > lines || shown.some((l) => l.length > maxChars + 2)) {
    shown = shown.map((l, i) =>
      i === shown.length - 1 && (out.length > lines || l.length > maxChars + 2)
        ? `${l.slice(0, maxChars).replace(/\s+$/, '')}…`
        : l,
    )
  }
  return (
    <g transform={`translate(${Number(x)},${Number(y)})`}>
      <title>{full}</title>
      <text textAnchor="middle" fontSize={fontSize} fill="#4a635e">
        {shown.map((l, i) => (
          <tspan key={i} x={0} dy={i === 0 ? fontSize + 2 : fontSize + 1}>
            {l}
          </tspan>
        ))}
      </text>
    </g>
  )
}
