import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  attributeHealthChange,
  scoreClientQuality,
} from '@/calc/clientQuality'
import { computeCustomerContractHealth } from '@/calc/customerContractHealth'
import { customerComparisonWindow } from '@/calc/customerComparison'
import { listCustomerEngagementEvents, listPlannedActivities } from '@/calc/customerEngagement'
import { buildCustomerEvidence, type EvidenceLink, type RiskEvidenceRow } from '@/calc/customerEvidence'
import { computeCustomerHealth } from '@/calc/customerHealth'
import { computeCustomerMarginDiagnosis } from '@/calc/customerMarginBridge'
import { computeCustomerRevenueBridge } from '@/calc/customerRevenueBridge'
import { buildCustomerRiskProfile } from '@/calc/customerRisk'
import { computeCustomerCommission } from '@/calc/salesCompensation'
import { FloatingWaterfall } from '@/components/charts/FloatingWaterfall'
import { ClientQualityDimensionBars } from '@/components/revops/ClientQualitySummary'
import { ChartCard } from '@/components/common/ChartCard'
import { Collapsible } from '@/components/common/Collapsible'
import { DataTable } from '@/components/common/DataTable'
import { DrilldownLink } from '@/components/common/DrilldownLink'
import { PageHeader } from '@/components/common/PageHeader'
import { ModuleSubNav } from '@/components/layout/ModuleSubNav'
import { useApp, type NavigateExtras } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { CUSTOMER_NAV } from '@/lib/icons'
import { formatCurrency, formatCurrencyPrecise, formatNumber, formatPercent } from '@/lib/money'

const SECTIONS = [
  { id: 'c360-score', label: 'Score breakdown' },
  { id: 'c360-volume', label: 'What changed' },
  { id: 'c360-margin', label: 'Why it changed' },
  { id: 'c360-exposure', label: 'What is at risk' },
  { id: 'c360-account', label: 'Actions & account' },
] as const

const BAND_TONE: Record<string, string> = {
  Healthy: 'bg-[#e8f5ee] text-success',
  Watchlist: 'bg-amber-50 text-amber-800',
  'At Risk': 'bg-orange-50 text-orange-800',
  Critical: 'bg-red-50 text-danger',
}

interface DemoAction {
  id: string
  title: string
  createdAt: string
  status: 'Open' | 'Done'
}
const actionsStorageKey = (customerId: string) => `demo-customer-actions:${customerId}`
function loadDemoActions(customerId: string): DemoAction[] {
  try {
    const raw = localStorage.getItem(actionsStorageKey(customerId))
    return raw ? (JSON.parse(raw) as DemoAction[]) : []
  } catch {
    return []
  }
}

const signedMoney = (v: number | null) =>
  v == null ? 'N/A' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatCurrency(Math.abs(v), true)}`
const signedPct = (v: number | null, d = 1) =>
  v == null ? 'N/A' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`
const impact = (v: number) => (v < 0.05 ? '0.0' : `−${v.toFixed(1)}`)
const signedNum = (v: number | null) =>
  v == null ? 'N/A' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatNumber(Math.abs(v))}`

export function Customer360() {
  const { data, filters, setFilters, healthWeights, navigateWithContext, highlightCustomerId, setHighlightCustomerId } =
    useApp()
  const [newActionTitle, setNewActionTitle] = useState('')
  const [demoActions, setDemoActions] = useState<DemoAction[]>([])
  const [showAllMetros, setShowAllMetros] = useState(false)

  const customerId = filters.customerIds[0] ?? highlightCustomerId ?? data.customers[0]?.customer_id ?? null
  const selectCustomer = (id: string) => {
    setFilters({ ...filters, customerIds: id ? [id] : [] })
    setHighlightCustomerId(id || null)
  }
  const custFilters = useMemo(
    () => ({ ...filters, customerIds: customerId ? [customerId] : ([] as string[]) }),
    [filters, customerId],
  )

  const health = useMemo(
    () => (customerId ? computeCustomerHealth(data, custFilters, healthWeights)[0] ?? null : null),
    [data, custFilters, healthWeights, customerId],
  )
  const cqScore = useMemo(
    () => (health ? scoreClientQuality(health, { asOfDate: data.meta.as_of_date }) : null),
    [health, data.meta.as_of_date],
  )
  const cqAttribution = useMemo(() => {
    if (!customerId || !health) return null
    const window = customerComparisonWindow(data, filters)
    if (!window.prior) return null
    const priorRows = computeCustomerHealth(
      data,
      { ...custFilters, startPeriod: window.prior.startPeriod, endPeriod: window.prior.endPeriod },
      healthWeights,
    )
    const priorHealth = priorRows[0]
    if (!priorHealth) return null
    const priorCq = scoreClientQuality(priorHealth, { asOfDate: data.meta.as_of_date })
    const currentCq = scoreClientQuality(health, { asOfDate: data.meta.as_of_date })
    return attributeHealthChange(priorCq, currentCq)
  }, [customerId, health, data, filters, custFilters, healthWeights])
  const profile = useMemo(() => (health ? buildCustomerRiskProfile(health, data, filters) : null), [health, data, filters])
  const revBridge = useMemo(
    () => (customerId ? computeCustomerRevenueBridge(data, filters, customerId) : null),
    [data, filters, customerId],
  )
  const marginDiag = useMemo(
    () => (customerId ? computeCustomerMarginDiagnosis(data, filters, customerId) : null),
    [data, filters, customerId],
  )
  const contract = useMemo(
    () => (customerId ? computeCustomerContractHealth(data, filters, customerId) : null),
    [data, filters, customerId],
  )
  const comp = useMemo(
    () => (customerId ? computeCustomerCommission(data, filters, customerId) : null),
    [data, filters, customerId],
  )
  const ev = useMemo(
    () =>
      customerId && health
        ? buildCustomerEvidence({ data, filters, customerId, health, contract, revBridge, margin: marginDiag })
        : null,
    [data, filters, customerId, health, contract, revBridge, marginDiag],
  )
  const asOf = data.meta.as_of_date ?? '2026-11-05'
  const events = useMemo(() => (customerId ? listCustomerEngagementEvents(customerId, asOf) : []), [customerId, asOf])
  const contracts = data.contracts.filter((c) => c.customer_id === customerId)
  const planned = useMemo(() => listPlannedActivities(contracts, asOf), [contracts, asOf])

  useEffect(() => {
    if (customerId) setDemoActions(loadDemoActions(customerId))
  }, [customerId])

  const cust = data.customers.find((c) => c.customer_id === customerId)
  const brands = data.brands?.filter((b) => b.customer_id === customerId) ?? []

  const go = (l: EvidenceLink) => {
    if (l.path.startsWith('#')) {
      document.getElementById(l.path.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    navigateWithContext(l.path, l.extras as NavigateExtras)
  }

  if (!customerId || !cust || !health || !profile || !ev) {
    return (
      <div className="space-y-4">
        <ModuleSubNav items={CUSTOMER_NAV} />
        <PageHeader path="/customer-360" scope="Select a customer to open the investigation workspace" />
        <p className="text-sm text-ink-muted">No customer selected.</p>
      </div>
    )
  }

  const persistActions = (next: DemoAction[]) => {
    setDemoActions(next)
    try {
      localStorage.setItem(actionsStorageKey(customerId), JSON.stringify(next))
    } catch {
      /* demo only */
    }
  }
  const addDemoAction = (title = newActionTitle.trim()) => {
    if (!title) return
    persistActions([
      { id: `ACT-${Date.now()}`, title, createdAt: new Date().toISOString().slice(0, 10), status: 'Open' },
      ...demoActions,
    ])
    setNewActionTitle('')
  }

  const exportSummary = () =>
    exportToCsv(`customer_360_${cust.customer_id}.csv`, [
      {
        customer_id: cust.customer_id,
        customer_name: cust.customer_name,
        synthetic: true,
        analysis_period: `${ev.window.current.startPeriod}_${ev.window.current.endPeriod}`,
        comparison_period: ev.window.prior ? `${ev.window.prior.startPeriod}_${ev.window.prior.endPeriod}` : 'N/A',
        as_of_date: asOf,
        health_score: ev.health.score,
        health_band: ev.health.band,
        score_coverage_pct: ev.health.coverage,
        ...Object.fromEntries(ev.health.components.flatMap((c) => [[`${c.key}_score`, c.score], [`${c.key}_weight`, c.weight], [`${c.key}_shortfall_pts`, c.shortfall]])),
        net_billing_prior: ev.revenue.prior,
        net_billing_current: ev.revenue.current,
        net_billing_growth_pct: ev.revenue.pct,
        shipped_packages_prior: ev.volume.prior,
        shipped_packages_current: ev.volume.current,
        shipped_packages_change_pct: ev.volume.pct,
        cm_prior_pct: ev.margin.priorCm,
        cm_current_pct: ev.margin.currentCm,
        open_ar: ev.payment.openAr,
        overdue_ar: ev.payment.overdueAr,
        open_billing_cases: ev.billing.cases.length,
        billing_affected_dedup: ev.billing.affectedAmount,
        scenario_revenue_exposure: ev.exposure.amount,
        scenario_exposure_formula: ev.exposure.formula,
        contract_risk_score_higher_is_riskier: contract?.contractRiskScore,
        contract_utilization_pct: contract?.commitmentUtilization,
        risk_tags: profile.riskTypes.join('|'),
      },
    ])

  const priorLabel = ev.window.prior?.label ?? 'N/A'
  const metroRows = showAllMetros ? ev.volume.byMetro : selectMetroRows(ev.volume.byMetro)

  return (
    <div className="space-y-4">
      <ModuleSubNav items={CUSTOMER_NAV} />
      <PageHeader
        path="/customer-360"
        scope="Risk evidence · score breakdown · next actions"
        actions={
          <div className="flex flex-wrap gap-2">
            <DrilldownLink
              to="/customers"
              label="Back to Portfolio"
              onClick={() => navigateWithContext('/customers', { highlightCustomerId: customerId, sourcePage: '/customer-360' })}
            />
            <button type="button" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium" onClick={exportSummary}>
              Export Summary
            </button>
          </div>
        }
      />

      {/* 1 · Account status */}
      <section className="card-surface p-4 sm:p-5" id="c360-status" aria-label="Account status">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-xl font-semibold text-ink">{cust.customer_name}</h3>
            {filters.customerIds.length === 0 && (
              <button type="button" className="text-[11px] text-forest underline" onClick={() => selectCustomer(customerId)}>
                Pin this customer in the global Customer filter
              </button>
            )}
            <p className="mt-1 text-xs text-ink-muted">
              {cust.segment} · {profile.industry} · Account owner {cust.account_owner}
            </p>
          </div>
          <span className="rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">
            {cust.illustrative ? 'Illustrative account · ' : ''}Synthetic data
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-3xl font-semibold tabular-nums text-ink">{ev.health.score}</span>
            <span className="text-sm text-ink-muted">/100 Health</span>
          </div>
          <span className={`rounded-md px-2 py-1 text-sm font-semibold ${BAND_TONE[ev.health.band]}`}>{ev.health.band}</span>
          {ev.health.provisional && (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-ink-muted" title={ev.health.missingRule}>
              Provisional · {ev.health.coverage}% evidence coverage
            </span>
          )}
          <span className="text-xs text-ink-muted" title={ev.health.bandRule}>
            Higher = healthier · {ev.health.bandRule}
          </span>
        </div>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
          <Fact label="Analysis period" value={ev.window.current.label} />
          <Fact label="Compared with" value={`${priorLabel} (same months prior year)`} />
          <Fact label="As-of date" value={asOf} />
        </dl>
        <p className="mt-3 text-[15px] leading-snug text-ink">{ev.conclusion}</p>
        <p className="mt-1 text-xs text-ink-muted">
          Net Billing {formatCurrency(ev.revenue.current, true)} vs {formatCurrency(ev.revenue.prior ?? 0, true)} ({signedPct(ev.revenue.pct)}) ·
          Shipped packages {formatNumber(ev.volume.current)} vs {formatNumber(ev.volume.prior ?? 0)} ({signedPct(ev.volume.pct)})
        </p>
      </section>

      {/* 2 · Top risk evidence */}
      <ChartCard
        title="Top risk evidence"
        subtitle="Rule-based; 'Needs investigation' = score is weak but no risk rule is met"
        formula="Score impact = weight × (100 − component score) — points this component takes off the 100-point Health Score"
        source="customerEvidence · computeCustomerHealth"
        timeBasis={`${ev.window.current.label} vs ${priorLabel}; as of ${asOf}`}
      >
        {ev.risks.length === 0 ? (
          <p className="text-sm text-ink-muted">No risk rule is met in this window.</p>
        ) : (
          <>
          <ul className="space-y-2 sm:hidden">
            {ev.risks.map((r) => (
              <li key={r.id} className="rounded-lg border border-[#e1e9e4] p-2.5 text-[13px]">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-ink">{r.risk}</span>
                  <span className="shrink-0 font-mono text-ink">{impact(r.scoreImpact)} pts</span>
                </div>
                <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.status === 'Confirmed' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-ink-muted'}`}>{r.status}</span>
                <p className="mt-1 font-mono text-xs">{r.prior} → {r.current} ({r.change})</p>
                <p className="text-xs text-ink-muted">{r.trigger}</p>
                <button type="button" className="mt-1 text-xs font-medium text-forest underline" onClick={() => go(r.link)}>{r.link.label}</button>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="text-[10px] uppercase tracking-wide text-ink-muted">
                <tr className="border-b border-slate-200">
                  <th className="py-2 pr-2">Risk</th>
                  <th className="py-2 pr-2 text-right">Prior</th>
                  <th className="py-2 pr-2 text-right">Current</th>
                  <th className="py-2 pr-2 text-right">Change</th>
                  <th className="py-2 pr-2">Trigger</th>
                  <th className="py-2 pr-2 text-right">Score impact</th>
                  <th className="py-2">Investigate</th>
                </tr>
              </thead>
              <tbody>
                {ev.risks.map((r) => (
                  <RiskRow key={r.id} r={r} onGo={go} />
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </ChartCard>

      {/* 3 · Next action */}
      <ChartCard
        title="Next action"
        subtitle="Suggested from the evidence above — owners and dates are suggestions, not assigned tasks"
        formula="Priority: High = confirmed rule & ≥ 10 pts score impact · Medium = confirmed (< 10 pts) or ≥ 5 pts unconfirmed · Low otherwise"
      >
        <div className="grid gap-3 lg:grid-cols-3">
          {ev.actions.map((a) => (
            <div key={a.id} className="flex flex-col rounded-xl border border-[#e1e9e4] bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-semibold text-ink">{a.title}</p>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    a.priority === 'High' ? 'bg-rose-50 text-rose-700' : a.priority === 'Medium' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-ink-muted'
                  }`}
                  title={a.priorityRationale}
                >
                  {a.priority}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink">{a.problem}</p>
              <p className="mt-1 text-xs text-ink-muted">{a.nextStep}</p>
              <dl className="mt-2 space-y-0.5 text-[11px] text-ink-muted">
                <Fact label="Suggested owner" value={a.owner} />
                <Fact label="Suggested follow-up" value={a.followUpBy} />
                <Fact label="Success measure" value={a.successMeasure} />
                <Fact label="Financial impact" value={a.financialImpact} />
                <Fact label="Evidence completeness" value={a.evidenceCompleteness} />
              </dl>
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                <button type="button" className="text-[11px] font-medium text-forest underline" onClick={() => go(a.link)}>
                  Investigate
                </button>
                <button type="button" className="text-[11px] text-ink-muted underline" onClick={() => addDemoAction(a.title)}>
                  Add to tracker
                </button>
              </div>
            </div>
          ))}
          {ev.actions.length === 0 && <p className="text-sm text-ink-muted">Maintain cadence; no evidence-backed action for this window.</p>}
        </div>
      </ChartCard>

      <nav className="sticky top-0 z-10 -mx-1 flex gap-1 overflow-x-auto bg-[var(--page-bg,#f6f8f6)]/95 px-1 py-1.5" aria-label="Customer 360 details">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            onClick={(e) => {
              e.preventDefault()
              document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            className="shrink-0 rounded-md border border-[#dce6df] bg-white px-2.5 py-1 text-[12px] font-medium text-ink-muted hover:text-forest"
          >
            {s.label}
          </a>
        ))}
      </nav>

      {/* Score breakdown */}
      <ChartCard
        id="c360-score"
        title="How the Health Score is calculated"
        subtitle={`Health = Σ(weight × component score) = ${ev.health.components.map((c) => c.contribution.toFixed(1)).join(' + ')} ≈ ${ev.health.weightedScore}${ev.health.override.applied ? ` → override ${ev.health.override.rule}` : ''}`}
        formula="Health = Σ weight × component (0–100). Score impact = weight × (100 − component). Weights and thresholds are demo configuration, not industry standards."
        source={ev.health.missingRule}
        insight={`Largest score impact: ${[...ev.health.components].sort((a, b) => b.shortfall - a.shortfall).slice(0, 2).map((c) => `${c.name} ${impact(c.shortfall)} pts`).join(', ')}.`}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="h-48" aria-label="Score impact by component">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[...ev.health.components].sort((a, b) => b.shortfall - a.shortfall)} layout="vertical" margin={{ left: 4, right: 44 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} domain={[0, (max: number) => Math.max(10, Math.ceil(max / 5) * 5)]} allowDecimals={false} tickFormatter={(v) => (Number(v) === 0 ? '0' : `−${v}`)} />
                <YAxis type="category" dataKey="name" width={118} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [`${impact(Number(v))} pts`, 'Score impact']} />
                <Bar dataKey="shortfall" name="Score impact" isAnimationActive={false} label={{ position: 'right', fontSize: 11, formatter: (v: unknown) => impact(Number(v)) }}>
                  {[...ev.health.components]
                    .sort((a, b) => b.shortfall - a.shortfall)
                    .map((c) => (
                      <Cell key={c.key} fill={c.shortfall >= 10 ? '#C44536' : c.shortfall >= 5 ? '#E58A2B' : '#9bb0a8'} />
                    ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[10px] uppercase tracking-wide text-ink-muted">
                <tr className="border-b border-slate-200">
                  <th className="py-1.5 pr-2">Component</th>
                  <th className="py-1.5 pr-2 text-right">Score</th>
                  <th className="py-1.5 pr-2 text-right">Weight</th>
                  <th className="hidden py-1.5 pr-2 text-right sm:table-cell">Contribution</th>
                  <th className="py-1.5 text-right">Impact</th>
                </tr>
              </thead>
              <tbody>
                {ev.health.components.map((c) => (
                  <tr key={c.key} className="border-b border-slate-100 align-top">
                    <td className="py-1.5 pr-2">
                      <details>
                        <summary className="cursor-pointer font-medium text-ink">{c.name}</summary>
                        <div className="mt-1 space-y-0.5 text-xs text-ink-muted">
                          <p><strong className="text-ink">Raw metric:</strong> {c.rawMetric}</p>
                          <p><strong className="text-ink">Comparison:</strong> {c.comparison}</p>
                          <p><strong className="text-ink">Rule:</strong> {c.rule}</p>
                          <p>
                            <strong className="text-ink">Sources:</strong>{' '}
                            {c.sources.map((s) => (
                              <button key={s.label} type="button" className="text-forest underline" onClick={() => go(s)}>
                                {s.label}
                              </button>
                            ))}
                          </p>
                        </div>
                      </details>
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{c.observed ? c.score : <span title="Insufficient evidence">{c.score}*</span>}</td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{Math.round(c.weight * 100)}%</td>
                    <td className="hidden py-1.5 pr-2 text-right font-mono tabular-nums sm:table-cell">{c.contribution.toFixed(1)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-ink">{impact(c.shortfall)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </ChartCard>

      {cqScore && (
        <ChartCard
          id="c360-cq"
          title="Client Quality dimensions (N/A-safe)"
          subtitle="Five-dimension CQ model · missing Relationship Signals excluded and weights renormalized · not churn probability"
          formula="CQ = Σ(available dimension × normalized weight). Complaints/tickets not in Synthetic Data → Relationship often N/A."
          insight={
            cqAttribution?.totalChange != null
              ? `CQ change ${cqAttribution.totalChange >= 0 ? '+' : ''}${cqAttribution.totalChange} pts vs prior YoY window`
              : cqAttribution?.note ?? undefined
          }
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <ClientQualityDimensionBars
              portfolioScore={cqScore}
              onSelectDimension={(key) => {
                if (key === 'serviceQuality')
                  go({
                    path: '/lifecycle',
                    label: 'Lifecycle',
                    extras: { customerId, sourcePage: '/customer-360' },
                  })
                else if (key === 'financialHealth')
                  go({
                    path: '/reconciliation',
                    label: 'Reconciliation',
                    extras: { customerId, sourcePage: '/customer-360' },
                  })
                else if (key === 'revenueStability')
                  go({
                    path: '/unit-economics',
                    label: 'Unit Economics',
                    extras: { customerId, sourcePage: '/customer-360' },
                  })
                else document.getElementById('c360-volume')?.scrollIntoView({ behavior: 'smooth' })
              }}
            />
            {cqAttribution && cqAttribution.steps.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-semibold text-ink">Health score change attribution</p>
                <FloatingWaterfall
                  steps={cqAttribution.steps.map((s) => ({
                    key: s.key,
                    label: s.label,
                    amount: s.amount,
                    shortLabel: s.label.split(/[\s/]/)[0]?.slice(0, 10) ?? s.key,
                  }))}
                  height={220}
                  totalKeys={['prior', 'current']}
                  valueFormat={(v) => `${v.toFixed(1)} pts`}
                  tickFormat={(v) => `${Math.round(v)}`}
                  footingNote={cqAttribution.note}
                />
              </div>
            ) : (
              <p className="text-sm text-ink-muted">
                {cqAttribution?.note ?? 'Insufficient History for CQ attribution (need prior YoY window).'}
              </p>
            )}
          </div>
        </ChartCard>
      )}

      {/* What changed: volume */}
      <ChartCard
        id="c360-volume"
        title="Volume: shipped packages"
        subtitle={`${priorLabel} → ${ev.window.current.label} · ${formatNumber(ev.volume.prior ?? 0)} → ${formatNumber(ev.volume.current)} (${signedNum(ev.volume.change)}, ${signedPct(ev.volume.pct)})`}
        insight={`Period-over-period: ${signedPct(ev.volume.pct)} vs same months last year. ${ev.volume.withinCurrent.label}: ${formatNumber(ev.volume.withinCurrent.first)} → ${formatNumber(ev.volume.withinCurrent.last)} (${signedPct(ev.volume.withinCurrent.pct)}).`}
        formula="Shipped packages by ship month (package_count). Same population as the Health Score volume component."
      >
        <div className="h-56" aria-label="Monthly shipped packages across both comparison periods">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ev.volume.monthly} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              {ev.window.prior && (
                <ReferenceArea x1={ev.window.prior.startPeriod} x2={ev.window.prior.endPeriod} fill="#94a3b8" fillOpacity={0.12} label={{ value: 'Prior', position: 'insideTop', fontSize: 11 }} />
              )}
              <ReferenceArea x1={ev.window.current.startPeriod} x2={ev.window.current.endPeriod} fill="#2F9E6B" fillOpacity={0.12} label={{ value: 'Current', position: 'insideTop', fontSize: 11 }} />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}K`} width={36} />
              <Tooltip formatter={(v) => [formatNumber(Number(v)), 'Packages']} />
              <Bar dataKey="packages" isAnimationActive={false}>
                {ev.volume.monthly.map((m) => (
                  <Cell key={m.period} fill={m.segment === 'current' ? '#123C35' : m.segment === 'prior' ? '#7c8f88' : '#cbd5d1'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-ink">Change by metro (packages)</p>
            <div style={{ height: Math.max(140, metroRows.length * 26) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metroRows} layout="vertical" margin={{ left: 8, right: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => formatNumber(Number(v))} />
                  <YAxis type="category" dataKey="key" width={130} tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.replace(' Metro', '')} />
                  <ReferenceLine x={0} stroke="#64748b" />
                  <Tooltip formatter={(v, _n, p) => [`${signedNum(Number(v))} (${formatNumber(p.payload.prior)} → ${formatNumber(p.payload.current)})`, 'Δ packages']} />
                  <Bar dataKey="delta" isAnimationActive={false}>
                    {metroRows.map((r) => (
                      <Cell key={r.key} fill={r.delta < 0 ? '#C44536' : '#2F9E6B'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {ev.volume.byMetro.length > metroRows.length || showAllMetros ? (
              <button type="button" className="text-[11px] text-forest underline" onClick={() => setShowAllMetros((v) => !v)}>
                {showAllMetros ? 'Show top declines & offsets' : `Show all ${ev.volume.byMetro.length} metros`}
              </button>
            ) : null}
          </div>
          <div>
            <p className="text-xs font-semibold text-ink">Change by service</p>
            <table className="mt-1 w-full text-[13px]">
              <thead className="text-[10px] uppercase text-ink-muted">
                <tr>
                  <th className="text-left">Service</th>
                  <th className="text-right">Prior</th>
                  <th className="text-right">Current</th>
                  <th className="text-right">Δ</th>
                  <th className="text-right">Δ %</th>
                </tr>
              </thead>
              <tbody>
                {ev.volume.byService.map((r) => (
                  <tr key={r.key} className="border-t border-slate-100">
                    <td>{r.key}</td>
                    <td className="text-right font-mono">{formatNumber(r.prior)}</td>
                    <td className="text-right font-mono">{formatNumber(r.current)}</td>
                    <td className="text-right font-mono">{signedNum(r.delta)}</td>
                    <td className="text-right font-mono">{signedPct(r.prior ? (r.delta / r.prior) * 100 : null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-ink-muted">
              Statistical contribution only — it does not prove competitive loss, lower customer demand or share change. The business cause needs account evidence.
            </p>
          </div>
        </div>
      </ChartCard>

      {revBridge && (
        <ChartCard
          id="c360-bridge"
          title="Revenue driver bridge (arithmetic attribution)"
          subtitle={`Net Billing ${priorLabel} → ${ev.window.current.label} · explains how the amount changed, not why the customer changed behaviour`}
          formula={revBridge.note}
          source="Billing lines (net_amount, credits, billed package_count); billed packages can differ slightly from shipped packages by month"
        >
          {revBridge.comparable ? (
            <div className="overflow-x-auto">
              <div className="min-w-[600px]">
                <FloatingWaterfall steps={revBridge.waterfall} height={260} totalKeys={['prior', 'current']} summaryMode="footing" />
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">{revBridge.note}</p>
          )}
          <div className="mt-2 grid gap-2 text-[11px] text-ink-muted sm:grid-cols-3">
            <p><strong className="text-ink">Arithmetic attribution:</strong> which factors add up to the Net Billing change.</p>
            <p><strong className="text-ink">Business root cause:</strong> why volume or pricing moved — not in this data; verify with the account.</p>
            <p><strong className="text-ink">Risk scoring:</strong> which Health rules fired (see score breakdown).</p>
          </div>
        </ChartCard>
      )}

      {/* Why it changed: profitability, billing, payment, delivery */}
      <ChartCard
        id="c360-margin"
        title="Profitability"
        subtitle={`Contribution margin ${ev.margin.priorCm?.toFixed(1) ?? 'N/A'}% → ${ev.margin.currentCm?.toFixed(1) ?? 'N/A'}% (${ev.margin.changePts == null ? 'N/A' : `${ev.margin.changePts > 0 ? '+' : ev.margin.changePts < 0 ? '−' : ''}${Math.abs(ev.margin.changePts).toFixed(1)} pts`}) · demo floor ${ev.margin.floorPct}% · drop rule ${ev.margin.dropRulePts} pts`}
        insight={
          ev.margin.triggered.length
            ? `Rule met: ${ev.margin.triggered.join(' · ')}. Contribution ${signedMoney(ev.margin.contributionChange)} YoY.`
            : `No margin rule met. Contribution ${signedMoney(ev.margin.contributionChange)} YoY.`
        }
        formula="CM % = (Net Billing − variable cost) ÷ Net Billing. Variable cost = DSP, sorting, linehaul, redelivery, claims, other variable. Sales commission is NOT deducted (avoids double counting)."
      >
        <div className="grid gap-2 sm:grid-cols-4">
          <Kpi label="Prior CM" value={ev.margin.priorCm == null ? 'N/A' : formatPercent(ev.margin.priorCm)} sub={priorLabel} />
          <Kpi label="Current CM" value={ev.margin.currentCm == null ? 'N/A' : formatPercent(ev.margin.currentCm)} sub={ev.window.current.label} warn={(ev.margin.currentCm ?? 99) < ev.margin.floorPct} />
          <Kpi label="Change" value={ev.margin.changePts == null ? 'N/A' : `${ev.margin.changePts > 0 ? '+' : ''}${ev.margin.changePts.toFixed(1)} pts`} />
          <Kpi label="Contribution Δ" value={signedMoney(ev.margin.contributionChange)} sub={`${formatCurrency(ev.margin.priorContribution ?? 0, true)} → ${formatCurrency(ev.margin.currentContribution, true)}`} />
        </div>
        {marginDiag?.comparable && (
          <div className="mt-3 overflow-x-auto">
            <div className="min-w-[600px]">
              <FloatingWaterfall steps={marginDiag.waterfall} height={240} totalKeys={['prior', 'current']} summaryMode="footing" />
            </div>
          </div>
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          id="c360-billing"
          title="Billing quality"
          subtitle={
            ev.billing.cases.length
              ? `${ev.billing.cases.length} open case${ev.billing.cases.length === 1 ? '' : 's'} · ${formatCurrency(ev.billing.affectedAmount)} affected (deduplicated) · ${ev.billing.affectedPct?.toFixed(2)}% of ${formatCurrency(ev.billing.denominator, true)} Net Billing`
              : 'No open billing cases in this window'
          }
          formula="Billing types only: Missing Billing, Unbilled Packages, Rate Mismatch, Missing Surcharge, Duplicate Billing. Affected $ counted once per billing line / invoice."
        >
          {ev.billing.cases.length ? (
            <>
              <p className="text-xs text-ink-muted">
                Oldest case {ev.billing.oldestCaseDays}d · Rule {ev.billing.triggered.length ? `met: ${ev.billing.triggered.join(' · ')}` : 'not met'}
              </p>
              <ul className="mt-2 divide-y divide-slate-100 text-[13px]">
                {ev.billing.cases.map((e) => (
                  <li key={e.exception_id} className="flex flex-wrap justify-between gap-2 py-1">
                    <span>
                      {e.exception_type} · <span className="text-ink-muted">{e.status} · {e.detected_date.slice(0, 10)}</span>
                    </span>
                    <span className="font-mono">{formatCurrencyPrecise(e.financial_impact)}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="mt-2 text-[11px] text-forest underline"
                onClick={() => navigateWithContext('/reconciliation', { customerId, exceptionStatus: 'Open', sourcePage: '/customer-360' })}
              >
                Open cases in Reconciliation
              </button>
            </>
          ) : (
            <p className="text-sm text-ink-muted">No billing risk tag.</p>
          )}
        </ChartCard>

        <ChartCard
          id="c360-payment"
          title="Payment"
          subtitle={`Open AR ${formatCurrency(ev.payment.openAr, true)} · Overdue AR ${formatCurrency(ev.payment.overdueAr, true)} (as of ${asOf})`}
          formula="Overdue = remaining balance after payments applied on or before the As-of Date, with due date before the As-of Date. Open AR alone is not a collection risk."
        >
          {ev.payment.overdueInvoices.length ? (
            <ul className="divide-y divide-slate-100 text-[13px]">
              {ev.payment.overdueInvoices.slice(0, 6).map((o) => (
                <li key={o.invoice.invoice_id} className="flex justify-between gap-2 py-1">
                  <span>
                    {o.invoice.invoice_id} · <span className="text-ink-muted">{o.daysPastDue}d past due</span>
                  </span>
                  <span className="font-mono">{formatCurrencyPrecise(o.outstanding)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">No overdue balance — open AR is within payment terms, so no collection risk.</p>
          )}
          {ev.payment.statusMismatches > 0 && (
            <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
              Data quality: {ev.payment.statusMismatches} invoice status value(s) disagree with the computed as-of state.
            </p>
          )}
          <button
            type="button"
            className="mt-2 text-[11px] text-forest underline"
            onClick={() => navigateWithContext('/collections', { customerId, sourcePage: '/customer-360' })}
          >
            Open Collections & AR
          </button>
        </ChartCard>
      </div>

      <ChartCard
        id="c360-delivery"
        title="Delivery"
        subtitle={`On-time ${ev.delivery.onTimePct?.toFixed(1) ?? 'N/A'}% (prior year ${ev.delivery.priorOnTimePct?.toFixed(1) ?? 'N/A'}%) vs ${ev.delivery.targetPct}% demo target · ${formatNumber(ev.delivery.latePackages)} late packages`}
        insight={
          ev.delivery.onTimePct != null
            ? `Delivery score ${health.deliveryScore} = 100 − 5 × (${ev.delivery.targetPct} − ${ev.delivery.onTimePct.toFixed(1)}). Completion (delivered) is ${ev.delivery.deliveredPct?.toFixed(1)}% — a different metric, not the score input.`
            : 'No shipments in this window — delivery is Insufficient evidence.'
        }
      >
        <div className="grid gap-2 sm:grid-cols-4">
          <Kpi label="On-time (score input)" value={ev.delivery.onTimePct == null ? 'N/A' : formatPercent(ev.delivery.onTimePct)} />
          <Kpi label="Prior year on-time" value={ev.delivery.priorOnTimePct == null ? 'N/A' : formatPercent(ev.delivery.priorOnTimePct)} />
          <Kpi label="Delivered (completion)" value={ev.delivery.deliveredPct == null ? 'N/A' : formatPercent(ev.delivery.deliveredPct)} />
          <Kpi label="Late packages" value={formatNumber(ev.delivery.latePackages)} />
        </div>
      </ChartCard>

      {/* What is at risk */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          id="c360-exposure"
          title={ev.exposure.label}
          subtitle="Scenario, not forecast · not an expected or confirmed loss"
          formula={ev.exposure.formula}
          source={ev.exposure.factorRule}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <Kpi label="Scenario exposure" value={formatCurrency(ev.exposure.amount, true)} />
            <Kpi label="Stress factor" value={`${Math.round(ev.exposure.factor * 100)}%`} sub={`${ev.health.band} band · not validated`} />
          </div>
          <dl className="mt-2 space-y-0.5 text-xs text-ink-muted">
            <Fact label="Revenue basis" value={`${ev.exposure.basis}: ${formatCurrency(ev.exposure.basisAmount)}`} />
            <Fact label="Time horizon" value={ev.exposure.horizon} />
            <Fact label="Formula" value={ev.exposure.formula} />
            <Fact label="Validated probability" value="No — demo assumption by band" />
          </dl>
        </ChartCard>

        {contract && (
          <ChartCard
            title="Contract"
            subtitle={`${contract.contractId ?? 'No contract'} · minimum ${formatNumber(contract.monthlyCommitment)} pkgs/mo · renewal ${contract.renewalDate ?? '—'} (${contract.daysUntilRenewal ?? '—'}d)`}
            formula={contract.note}
          >
            <div className="grid gap-2 sm:grid-cols-3">
              <Kpi label="Utilization of minimum" value={contract.commitmentUtilization == null ? 'N/A' : formatPercent(contract.commitmentUtilization)} sub={`${contract.activeMonths} active month(s)`} />
              <Kpi label="Contract risk" value={`${contract.contractRiskScore} · ${contract.contractRiskLevel}`} sub="0–100, higher = riskier" />
              <Kpi label="Renewal" value={contract.renewalStatus} />
            </div>
            {contract.utilizationTrend.length > 0 && (
              <div className="mt-3 h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={contract.utilizationTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} unit="%" width={44} />
                    <ReferenceLine y={100} stroke="#C44536" strokeDasharray="4 3" label={{ value: 'Minimum', fontSize: 10, position: 'insideTopRight' }} />
                    <Tooltip formatter={(v) => formatPercent(Number(v))} />
                    <Bar dataKey="utilizationPct" fill="#123C35" name="% of minimum" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <ul className="mt-2 grid gap-0.5 text-[11px] text-ink-muted sm:grid-cols-2">
              {contract.contractRiskRules.map((r) => (
                <li key={r.rule} className={r.triggered ? 'font-medium text-ink' : ''}>
                  {r.triggered ? '●' : '○'} {r.rule} (+{r.points})
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-ink-muted">Contract risk and Customer Health are separate scales and are never combined.</p>
          </ChartCard>
        )}
      </div>

      <ChartCard title="Engagement" subtitle="Synthetic demo events (not CRM-backed) · not used in the Health Score">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-ink">Occurred (on or before {asOf})</p>
            <ul className="mt-1 space-y-1.5 text-[13px]">
              {events.map((e) => (
                <li key={e.eventId} className="border-b border-[#eef4ef] pb-1">
                  <span className="font-mono text-xs text-ink-muted">{e.eventDate}</span> <span className="font-medium">{e.eventType}</span>{' '}
                  <span className="text-xs text-ink-muted">· {e.sentiment} · Synthetic</span>
                </li>
              ))}
              {events.length === 0 && <li className="text-ink-muted">No events.</li>}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-ink">Planned activities (after {asOf})</p>
            <ul className="mt-1 space-y-1.5 text-[13px]">
              {planned.map((p) => (
                <li key={p.source} className="border-b border-[#eef4ef] pb-1">
                  <span className="font-mono text-xs text-ink-muted">{p.date}</span> {p.label} <span className="text-xs text-ink-muted">· {p.source}</span>
                </li>
              ))}
              {planned.length === 0 && <li className="text-ink-muted">None scheduled.</li>}
            </ul>
          </div>
        </div>
      </ChartCard>

      {/* Actions & account */}
      <section id="c360-account" className="space-y-4">
        <ChartCard title="Action tracker (demo)" subtitle="Stored in this browser only — may clear on refresh or a new profile">
          <div className="flex flex-wrap gap-2">
            <input
              className="filter-input min-w-0 flex-1 text-sm"
              placeholder="New action title…"
              value={newActionTitle}
              onChange={(e) => setNewActionTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addDemoAction()}
            />
            <button type="button" className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-medium text-white" onClick={() => addDemoAction()}>
              Add action
            </button>
            <button
              type="button"
              className="rounded-lg border border-[#dce6df] px-3 py-1.5 text-xs text-forest"
              onClick={() => navigateWithContext('/actions', { customerId, sourcePage: '/customer-360' })}
            >
              Action Center
            </button>
          </div>
          <ul className="mt-3 space-y-1 text-[13px]">
            {demoActions.length === 0 && <li className="text-ink-muted">No tracked actions yet.</li>}
            {demoActions.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded border border-[#e1e9e4] px-2 py-1">
                <span>{a.title}</span>
                <span className="text-xs text-ink-muted">{a.createdAt}</span>
              </li>
            ))}
          </ul>
        </ChartCard>

        <Collapsible title="Account structure & contracts" subtitle={`${brands.length} brand(s) · ${contracts.length} contract(s)`}>
          <dl className="grid grid-cols-2 gap-2 text-[13px]">
            <Fact label="Bill-to" value={cust.customer_name} />
            <Fact label="Parent" value={cust.parent_account_name} />
          </dl>
          <p className="mt-2 text-[13px]">
            {brands.length ? brands.map((b) => (
              <span key={b.brand_id} className="mr-1 inline-block rounded bg-[#f5f8f5] px-1.5 py-0.5 text-xs">
                {b.brand_name}
              </span>
            )) : 'Direct shipper'}
          </p>
          <ul className="mt-2 text-xs text-ink-muted">
            {contracts.map((c) => (
              <li key={c.contract_id}>
                {c.contract_id} · {c.pricing_model} · {c.start_date} → {c.end_date} · {c.status} · minimum {formatNumber(c.volume_commitment)} pkgs/mo
              </li>
            ))}
          </ul>
        </Collapsible>

        {comp && (
          <Collapsible title="Sales compensation (account)" subtitle="Commission expense — not deducted again from contribution margin">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <Kpi label="Sales rep" value={comp.repName} />
              <Kpi label="Eligible revenue" value={formatCurrency(comp.eligibleRevenue, true)} />
              <Kpi label="Commission expense" value={formatCurrency(comp.commissionExpense, true)} />
              <Kpi label="Blended rate" value={formatPercent(comp.blendedRate)} />
              <Kpi label="Clawback / adj." value={formatCurrency(comp.adjustments, true)} />
            </div>
            <button type="button" className="mt-2 text-xs text-forest underline" onClick={() => navigateWithContext('/sales-compensation', { customerId })}>
              Open Sales Compensation
            </button>
          </Collapsible>
        )}

        <Collapsible title="All metro volume changes" subtitle="Full record behind the metro chart">
          <DataTable
            rows={ev.volume.byMetro.map((r) => ({ ...r, id: r.key }))}
            rowKey={(r) => r.key}
            defaultPageSize={10}
            columns={[
              { key: 'k', header: 'Metro', render: (r) => r.key },
              { key: 'p', header: 'Prior', align: 'right', render: (r) => formatNumber(r.prior), sortValue: (r) => r.prior },
              { key: 'c', header: 'Current', align: 'right', render: (r) => formatNumber(r.current), sortValue: (r) => r.current },
              { key: 'd', header: 'Δ', align: 'right', render: (r) => signedNum(r.delta), sortValue: (r) => r.delta },
            ]}
            onRowClick={(r) => setFilters({ ...filters, customerIds: [customerId], metros: [r.key], stations: [] })}
          />
        </Collapsible>
      </section>
    </div>
  )
}

/** Top declines plus the main growth offsets (full list behind a toggle) */
function selectMetroRows<T extends { delta: number }>(rows: T[]): T[] {
  const declines = rows.filter((r) => r.delta < 0).slice(0, 6)
  const growth = [...rows].filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 2)
  return [...declines, ...growth]
}

function RiskRow({ r, onGo }: { r: RiskEvidenceRow; onGo: (l: EvidenceLink) => void }) {
  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="py-2 pr-2">
        <div className="font-medium text-ink">{r.risk}</div>
        <span
          className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            r.status === 'Confirmed' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-ink-muted'
          }`}
        >
          {r.status}
        </span>
      </td>
      <td className="py-2 pr-2 text-right font-mono tabular-nums text-ink-muted">{r.prior}</td>
      <td className="py-2 pr-2 text-right font-mono tabular-nums">{r.current}</td>
      <td className="py-2 pr-2 text-right font-mono tabular-nums">{r.change}</td>
      <td className="py-2 pr-2 text-xs text-ink-muted">{r.trigger}</td>
      <td className="py-2 pr-2 text-right font-mono tabular-nums text-ink">{impact(r.scoreImpact)} pts</td>
      <td className="py-2">
        <button type="button" className="text-xs font-medium text-forest underline" onClick={() => onGo(r.link)}>
          {r.link.label}
        </button>
      </td>
    </tr>
  )
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-1">
      <dt className="text-ink-muted">{label}:</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  )
}

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-[#e1e9e4] bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-sm font-semibold ${warn ? 'text-danger' : 'text-ink'}`}>{value}</div>
      {sub && <div className="text-[11px] text-ink-muted">{sub}</div>}
    </div>
  )
}
