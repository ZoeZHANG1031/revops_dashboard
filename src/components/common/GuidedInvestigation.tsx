import { useState } from 'react'
import { useApp, type InvestigationStep } from '@/context/AppContext'

interface GuideDef {
  id: string
  question: string
  summary: string
  steps: InvestigationStep[]
}

const GUIDES: GuideDef[] = [
  {
    id: 'rev-vs-ship',
    question: 'Why is revenue growing slower than shipments?',
    summary: 'Executive → Lifecycle Price–Volume–Mix → Customer / Service breakdown',
    steps: [
      { id: 'exec', label: 'Monitor growth gap', path: '/executive' },
      { id: 'pvm', label: 'Price–Volume–Mix', path: '/lifecycle' },
      { id: 'cust', label: 'Customer / Service mix', path: '/customers' },
    ],
  },
  {
    id: 'metro-profit',
    question: 'Why is a Metro less profitable?',
    summary: 'Geographic Footprint → Unit Economics → Cost Drivers → Forecast scenario',
    steps: [
      { id: 'geo', label: 'Geographic footprint', path: '/' },
      { id: 'ue', label: 'Unit Economics cost drivers', path: '/unit-economics' },
      { id: 'fc', label: 'Simulate improvement', path: '/forecasting' },
    ],
  },
  {
    id: 'leakage',
    question: 'Where might we be losing revenue?',
    summary: 'Lifecycle → Reconciliation → Exception detail → Financial impact',
    steps: [
      { id: 'lc', label: 'Revenue Lifecycle variance', path: '/lifecycle' },
      { id: 'recon', label: 'Billing exceptions', path: '/reconciliation' },
      { id: 'impact', label: 'Exception financial impact', path: '/reconciliation' },
    ],
  },
  {
    id: 'customer-attn',
    question: 'Which customers need attention?',
    summary: 'Concentration → Customer Intelligence → Health → Revenue at Risk',
    steps: [
      { id: 'conc', label: 'Customer concentration', path: '/' },
      { id: 'ci', label: 'Customer health', path: '/customers' },
      { id: 'rar', label: 'Revenue at Risk', path: '/customers' },
    ],
  },
]

export function GuidedInvestigation({ compact = false }: { compact?: boolean }) {
  const { navigateWithContext, investigation, clearInvestigation, filters } = useApp()
  const [open, setOpen] = useState(false)

  const startGuide = (g: GuideDef, stepIndex = 0) => {
    const step = g.steps[stepIndex]
    navigateWithContext(step.path, {
      sourcePage: '/',
      investigationId: g.id,
      investigationTitle: g.question,
      investigationSteps: g.steps,
      investigationStepIndex: stepIndex,
      toast: `Guided: ${g.question} · Step ${stepIndex + 1}/${g.steps.length}: ${step.label}`,
      exceptionType: g.id === 'leakage' ? 'Duplicate Billing' : undefined,
      metro: g.id === 'metro-profit' ? filters.metros[0] ?? undefined : undefined,
    })
    setOpen(false)
  }

  const advance = () => {
    if (!investigation.id || investigation.steps.length === 0) return
    const next = Math.min(investigation.stepIndex + 1, investigation.steps.length - 1)
    const g = GUIDES.find((x) => x.id === investigation.id)
    if (!g) return
    startGuide(g, next)
  }

  return (
    <div className={`rounded-lg border border-[#dce6df] bg-white ${compact ? 'p-2' : 'p-3'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">
            Explore Business Questions
          </p>
          <p className="text-xs text-ink-muted">
            Optional guided paths — keep current filters; exit anytime
          </p>
        </div>
        <div className="flex gap-2">
          {investigation.id && (
            <>
              <button
                type="button"
                className="rounded-md border border-[#dce6df] px-2 py-1 text-[13px]"
                onClick={advance}
              >
                Next step
              </button>
              <button
                type="button"
                className="rounded-md border border-[#dce6df] px-2 py-1 text-[13px]"
                onClick={clearInvestigation}
              >
                Exit guide
              </button>
            </>
          )}
          <button
            type="button"
            className="rounded-md bg-forest px-2.5 py-1 text-[13px] font-medium text-white"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Hide questions' : 'Show questions'}
          </button>
        </div>
      </div>
      {open && (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {GUIDES.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                className="w-full rounded-lg border border-[#dce6df] bg-[#f5f8f5] px-3 py-2 text-left hover:border-brand-400"
                onClick={() => startGuide(g, 0)}
              >
                <p className="text-xs font-semibold text-ink">{g.question}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{g.summary}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
