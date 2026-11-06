/**
 * Category axis tick that wraps long names onto up to `lines` horizontal lines.
 * For dense / narrow charts prefer CategoryTick (truncate or angled) instead —
 * multi-line wrap collides when category bandwidth is small.
 *
 * Recharts 3 clones this element and injects x / y / payload.
 */
export function WrapTick({
  x = 0,
  y = 0,
  payload,
  maxChars = 12,
  lines = 2,
  fontSize = 11,
}: {
  x?: number | string
  y?: number | string
  payload?: { value?: string | number }
  maxChars?: number
  lines?: number
  fontSize?: number
}) {
  const px = Number(x)
  const py = Number(y)
  const raw = payload?.value
  const full = raw == null ? '' : String(typeof raw === 'object' ? JSON.stringify(raw) : raw)
  if (!Number.isFinite(px) || !Number.isFinite(py) || !full) return <g />

  // Single-line truncate when lines === 1 (safest for dense axes)
  if (lines <= 1) {
    const shown = full.length <= maxChars ? full : `${full.slice(0, Math.max(1, maxChars - 1))}…`
    return (
      <g transform={`translate(${px},${py})`}>
        <title>{full}</title>
        <text textAnchor="middle" fontSize={fontSize} fill="#4a635e" dy={fontSize + 2}>
          {shown}
        </text>
      </g>
    )
  }

  const words = full.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    // Hard-break very long tokens so they never overflow a category slot
    if (w.length > maxChars) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
      for (let i = 0; i < w.length; i += maxChars) {
        out.push(w.slice(i, i + maxChars))
      }
      continue
    }
    const next = cur ? `${cur} ${w}` : w
    if (next.length <= maxChars || !cur) cur = next
    else {
      out.push(cur)
      cur = w
    }
  }
  if (cur) out.push(cur)

  let shown = out.slice(0, lines)
  if (out.length > lines) {
    const last = shown[shown.length - 1] ?? ''
    shown[shown.length - 1] = `${last.slice(0, Math.max(1, maxChars - 1))}…`
  }

  return (
    <g transform={`translate(${px},${py})`}>
      <title>{full}</title>
      <text textAnchor="middle" fontSize={fontSize} fill="#4a635e">
        {shown.map((l, i) => (
          <tspan key={`${l}-${i}`} x={0} dy={i === 0 ? fontSize + 2 : fontSize + 1}>
            {l}
          </tspan>
        ))}
      </text>
    </g>
  )
}
