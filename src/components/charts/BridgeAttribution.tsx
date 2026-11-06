import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { formatAxisMoney, formatCurrencyPrecise } from '@/lib/money'
import type { WaterfallSummary } from '@/lib/waterfall'

/**
 * Compact attribution indicator for a bridge: "Attribution 77.5% | Residual −$481K | Review".
 * Takes the canonical waterfall summary, so header, chart footer and tooltips show identical numbers.
 */
export function BridgeAttribution({
  summary,
  forecastBase,
  note,
  reviewBelow = 70,
}: {
  summary: WaterfallSummary
  /** Optional base for "% of forecast" */
  forecastBase?: number | null
  note?: string
  /** Attribution % below which the indicator asks for review */
  reviewBelow?: number
}) {
  const [open, setOpen] = useState(false)
  const cov = summary.attributionCoverage
  const review = cov != null && cov < reviewBelow
  const res = summary.residual
  const signed = res === 0 ? formatAxisMoney(0) : `${res > 0 ? '+' : '−'}${formatAxisMoney(Math.abs(res))}`
  const pctOfBase =
    forecastBase != null && forecastBase !== 0 ? `${((res / Math.abs(forecastBase)) * 100).toFixed(1)}% of forecast` : null
  return (
    <div className={`mb-2 rounded-md border text-[12px] ${review ? 'border-amber-200 bg-amber-50/70' : 'border-[#e1e9e4] bg-[#f7faf8]'}`}>
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-2.5 py-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronRight size={13} className={`shrink-0 text-ink-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <span>
          Attribution <strong className="font-mono">{cov == null ? 'N/A' : `${cov.toFixed(1)}%`}</strong>
        </span>
        <span className="text-ink-muted">|</span>
        <span title={formatCurrencyPrecise(res)}>
          Residual <strong className="font-mono">{signed}</strong>
          {pctOfBase && <span className="text-ink-muted"> ({pctOfBase})</span>}
        </span>
        <span className="text-ink-muted">|</span>
        <span className={review ? 'font-semibold text-amber-900' : 'text-success'}>{review ? 'Review' : 'OK'}</span>
        <span className="ml-auto text-[11px] text-ink-muted">
          {summary.reconciles ? 'Foots ✓' : `Gap ${formatCurrencyPrecise(summary.footingGap ?? 0)}`}
        </span>
      </button>
      {open && (
        <div className="space-y-0.5 border-t border-inherit px-3 py-2 text-[11.5px] leading-snug text-ink-muted">
          <p>
            Attribution = |known drivers| ÷ (|known drivers| + |residual|). Residual = Actual − Forecast − Σ known
            drivers ({formatCurrencyPrecise(res)}), computed once from the same filtered bridge the chart draws.
          </p>
          <p>
            Known drivers net {formatCurrencyPrecise(summary.knownDrivers)} · Start {formatCurrencyPrecise(summary.start ?? 0)} →
            End {formatCurrencyPrecise(summary.end ?? 0)}
          </p>
          {note && <p>{note}</p>}
        </div>
      )}
    </div>
  )
}
