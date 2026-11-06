import { X } from 'lucide-react'
import type { KpiDefinition } from '@/types'

export function KpiDefinitionPanel({
  definition,
  onClose,
}: {
  definition: KpiDefinition
  onClose: () => void
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-lg text-left">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-ink">{definition.name} — Definition</h4>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-ink">
          <X size={14} />
        </button>
      </div>
      <dl className="space-y-2 text-xs text-ink-muted">
        <div>
          <dt className="font-semibold text-ink">Business Definition</dt>
          <dd>{definition.businessDefinition}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Formula</dt>
          <dd className="font-mono text-[13px] text-brand-800">{definition.formula}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Source Tables</dt>
          <dd>{definition.sourceTables.join(', ')}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Source Columns</dt>
          <dd>{definition.sourceColumns.join(', ')}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Example</dt>
          <dd>{definition.calculationExample}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Interpretation</dt>
          <dd>{definition.interpretation}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Common Causes of Change</dt>
          <dd>
            <ul className="list-disc pl-4">
              {definition.commonCauses.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </div>
  )
}
