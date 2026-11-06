import { Info } from 'lucide-react'
import { METRIC_REGISTRY, type MetricId } from '@/calc/metricRegistry'
import type { DateBasis } from '@/lib/analysisUrl'

const GLOBAL_LABEL: Record<DateBasis, string> = {
  recognition: 'Recognition',
  billing: 'Billing',
  shipment: 'Shipment',
  invoice: 'Invoice',
  payment: 'Payment',
  forecast_target: 'Forecast Target',
}

/** Unified Definition → Formula → Source → Date Basis → Interpretation tooltip */
export function MetricDefinitionTip({
  metricId,
  globalDateBasis,
}: {
  metricId: string
  globalDateBasis?: DateBasis
}) {
  const m = METRIC_REGISTRY[metricId as MetricId]
  if (!m) return null
  const globalNote =
    globalDateBasis != null
      ? `Global Date Basis selector = ${GLOBAL_LABEL[globalDateBasis]}. This KPI always uses its native date field below — do not subtract KPIs with different date bases.`
      : null

  return (
    <span className="group relative inline-flex items-center" tabIndex={0}>
      <Info size={13} className="ml-1 cursor-help text-ink-muted/80 hover:text-forest" aria-hidden />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-80 space-y-1.5 rounded-lg border border-[#dce6df] bg-white p-2.5 text-[12px] font-normal normal-case leading-snug tracking-normal text-ink shadow-lg group-hover:block group-focus:block"
      >
        <p>
          <span className="font-semibold text-ink-muted">Definition. </span>
          {m.businessDefinition}
        </p>
        <p>
          <span className="font-semibold text-ink-muted">Formula. </span>
          {m.formula}
        </p>
        <p>
          <span className="font-semibold text-ink-muted">Source. </span>
          {m.sourceTables.join(', ')}
        </p>
        <p>
          <span className="font-semibold text-ink-muted">Date Basis. </span>
          {m.dateBasis}
        </p>
        <p>
          <span className="font-semibold text-ink-muted">Interpretation. </span>
          {m.interpretation}
        </p>
        {globalNote && (
          <p className="border-t border-[#e1e9e4] pt-1.5 text-amber-800">{globalNote}</p>
        )}
      </span>
    </span>
  )
}
