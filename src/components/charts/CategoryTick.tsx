/**
 * Reliable category-axis tick for Recharts 3.
 * Prefer this over WrapTick for dense charts — wrapping often collides in narrow panels.
 *
 * Modes:
 * - truncate: single-line centered label (default)
 * - angle: rotated end-anchored label for many categories
 */
export function CategoryTick({
  x = 0,
  y = 0,
  payload,
  maxChars = 12,
  fontSize = 10,
  mode = 'truncate',
  angle = -35,
  fill = '#4a635e',
}: {
  x?: number | string
  y?: number | string
  payload?: { value?: string | number }
  /** Also accept Recharts nested tickProps if clone shape changes */
  tickProps?: { x?: number | string; y?: number | string; payload?: { value?: string | number } }
  maxChars?: number
  fontSize?: number
  mode?: 'truncate' | 'angle'
  angle?: number
  fill?: string
}) {
  const px = Number(x)
  const py = Number(y)
  const full = String(payload?.value ?? '')
  if (!Number.isFinite(px) || !Number.isFinite(py) || !full) return null

  const truncated =
    full.length <= maxChars ? full : `${full.slice(0, Math.max(1, maxChars - 1)).replace(/\s+$/, '')}…`

  if (mode === 'angle') {
    return (
      <g transform={`translate(${px},${py})`}>
        <title>{full}</title>
        <text
          textAnchor="end"
          fontSize={fontSize}
          fill={fill}
          transform={`rotate(${angle})`}
          dy={4}
        >
          {truncated}
        </text>
      </g>
    )
  }

  return (
    <g transform={`translate(${px},${py})`}>
      <title>{full}</title>
      <text textAnchor="middle" fontSize={fontSize} fill={fill} dy={fontSize + 2}>
        {truncated}
      </text>
    </g>
  )
}

/** Unique short labels for exception types (avoid "Missing" collisions). */
export const EXCEPTION_AXIS_LABEL: Record<string, string> = {
  'Overdue AR': 'Overdue AR',
  'High Risk Customer': 'High Risk',
  'Volume Decline': 'Vol Decline',
  'Margin Decline': 'Margin ↓',
  'Missing Billing': 'Miss. Bill',
  'Unbilled Packages': 'Unbilled',
  'Duplicate Billing': 'Duplicate',
  'Rate Mismatch': 'Rate',
  'Missing Surcharge': 'Surcharge',
  'Credit Memo Adjustment': 'Credits',
  'Timing Difference': 'Timing',
  'Delivery Failure Cost': 'Deliv. Fail',
  'Commission Clawback': 'Clawback',
}

export function exceptionAxisLabel(type: string): string {
  return EXCEPTION_AXIS_LABEL[type] ?? (type.length > 12 ? `${type.slice(0, 11)}…` : type)
}
