/**
 * Growth Opportunities — separates Target Gap (forecast − target) from verifiable opportunities
 * (Recovery · Expansion · Pricing). A forecast below target is NOT an identified opportunity.
 */
import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { computeClientQualityPortfolio } from '@/calc/clientQuality'
import { DEFAULT_SCENARIO_PARAMS } from '@/calc/forecast'
import { computeCustomerTargetGaps, computeForwardOverview, resolveForwardHorizon } from '@/calc/forwardForecast'
import {
  computeGrowthOpportunities,
  EVIDENCE_RANK,
  OPPORTUNITY_DEFINITIONS,
  opportunityTypeTotals,
  type GrowthOpportunity,
  type OpportunityType,
} from '@/calc/portfolioVisuals'
import { ChartCard } from '@/components/common/ChartCard'
import { Collapsible } from '@/components/common/Collapsible'
import { DataTable } from '@/components/common/DataTable'
import { PageHeader } from '@/components/common/PageHeader'
import { ModuleSubNav } from '@/components/layout/ModuleSubNav'
import { compactMoneyTick, KpiStrip, logAxis, Toggle } from '@/components/revops/PortfolioVisuals'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { CUSTOMER_NAV } from '@/lib/icons'
import { formatCurrency, formatCurrencyPrecise, formatPercent } from '@/lib/money'

/** Validated categorical palette (CVD ΔE ≥ 9.3, contrast ≥ 3:1) — never the risk orange/red */
const TYPE_COLOR: Record<OpportunityType, string> = {
  Recovery: '#2F6FDB',
  Expansion: '#2E9C6A',
  Pricing: '#B0569E',
}
const TYPES: OpportunityType[] = ['Recovery', 'Expansion', 'Pricing']
const BELOW = '#C44536'
const ABOVE = '#2F7D62'

function BulletBar({ forecast, target }: { forecast: number; target: number }) {
  const max = Math.max(forecast, target, 1) * 1.08
  const fw = (forecast / max) * 100
  const tx = (target / max) * 100
  const gap = forecast - target
  return (
    <div aria-label="Portfolio forecast versus target" title={`Forecast ${formatCurrencyPrecise(forecast)} · Target ${formatCurrencyPrecise(target)}`}>
      <div className="relative mt-2 h-6 rounded bg-[#eef3f0]">
        <div className="absolute inset-y-1 left-0 rounded-r" style={{ width: `${fw}%`, background: gap < 0 ? '#9DB8AC' : ABOVE }} />
        <div className="absolute -inset-y-1 w-[3px] rounded bg-forest" style={{ left: `calc(${tx}% - 1px)` }} />
      </div>
      <div className="mt-1 flex flex-wrap justify-between gap-2 text-[12px]">
        <span className="text-ink">
          Forecast <span className="font-mono font-semibold">{formatCurrency(forecast, true)}</span>
        </span>
        <span className={gap < 0 ? 'font-medium text-danger' : 'font-medium text-success'}>
          Gap {gap >= 0 ? '+' : '−'}
          {formatCurrency(Math.abs(gap), true)} ({target ? ((forecast / target) * 100).toFixed(1) : '—'}% of target)
        </span>
        <span className="text-ink">
          Target <span className="font-mono font-semibold">{formatCurrency(target, true)}</span>
        </span>
      </div>
    </div>
  )
}

function TypeLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-ink-muted">
      {TYPES.map((t) => (
        <span key={t} className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLOR[t] }} aria-hidden />
          {t}
        </span>
      ))}
    </div>
  )
}

export function CustomerGrowth() {
  const { data, filters, scenario, scenarioParams, healthWeights, openCustomer360, highlightCustomerId } = useApp()
  const [typeFilter, setTypeFilter] = useState<OpportunityType | 'All'>('All')
  const params = scenario === 'Base' ? scenarioParams : DEFAULT_SCENARIO_PARAMS[scenario]
  const horizon = useMemo(() => resolveForwardHorizon(data, 3), [data])
  const { overview } = useMemo(
    () => computeForwardOverview(data, filters, scenario, params, 3),
    [data, filters, scenario, params],
  )
  const gaps = useMemo(
    () => computeCustomerTargetGaps(data, filters, scenario, params, horizon),
    [data, filters, scenario, params, horizon],
  )
  const cq = useMemo(() => computeClientQualityPortfolio(data, filters, healthWeights), [data, filters, healthWeights])
  const opps = useMemo(() => computeGrowthOpportunities(data, filters, cq.profiles), [data, filters, cq.profiles])
  const totals = useMemo(() => opportunityTypeTotals(opps), [opps])
  const shown = typeFilter === 'All' ? opps : opps.filter((o) => o.type === typeFilter)
  const top5 = shown.slice(0, 5)
  const gapRows = useMemo(
    () => [...gaps].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 8).sort((a, b) => a.gap - b.gap),
    [gaps],
  )
  const belowCount = gaps.filter((g) => g.gap < 0).length
  const totalOpp = totals.reduce((a, t) => a + t.value, 0)
  const highOpp = totals.reduce((a, t) => a + t.highEvidenceValue, 0)
  const gap = overview.forecastGap
  const attainment = overview.revenueTarget ? (overview.forecastRevenue / overview.revenueTarget) * 100 : null

  const jitter = (id: string) => {
    let h = 0
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997
    return (h / 997 - 0.5) * 0.5
  }
  const matrixPts = shown.map((o) => ({ ...o, y: EVIDENCE_RANK[o.evidence] + jitter(o.id) }))
  const oppAxis = logAxis(matrixPts.map((p) => p.value))

  return (
    <div className="space-y-5">
      <ModuleSubNav items={CUSTOMER_NAV} />
      <PageHeader
        path="/customers/growth"
        scope={`${overview.horizon.label} · ${scenario} · Target Gap ≠ opportunity`}
        actions={
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
            onClick={() =>
              exportToCsv(
                'growth_opportunities.csv',
                opps.map((o) => ({
                  customer_id: o.customerId,
                  customer: o.customerName,
                  type: o.type,
                  value: o.value,
                  evidence: o.evidence,
                  basis: o.basis,
                  evidence_note: o.evidenceNote,
                  risk_band: o.healthBand ?? '',
                  disclaimer: 'Synthetic · verifiable basis shown; not a booking forecast',
                })),
              )
            }
          >
            Export
          </button>
        }
      />

      <KpiStrip
        items={[
          {
            label: 'Target Gap',
            value: `${gap >= 0 ? '+' : '−'}${formatCurrency(Math.abs(gap), true)}`,
            sub: attainment == null ? 'No target' : `Forecast at ${attainment.toFixed(1)}% of target`,
            tip: 'Forward forecast − revenue target for the horizon. A planning gap — not an identified growth opportunity.',
            tone: gap < 0 ? 'risk' : 'neutral',
          },
          {
            label: 'Identified Opportunity',
            value: formatCurrency(totalOpp, true),
            sub: `${opps.length} opportunities across ${new Set(opps.map((o) => o.customerId)).size} clients`,
            tip: 'Σ Recovery + Expansion + Pricing values, each with a verifiable record basis. Horizons differ by type — see definitions.',
          },
          {
            label: 'High-Evidence Value',
            value: formatCurrency(highOpp, true),
            sub: totalOpp ? `${((highOpp / totalOpp) * 100).toFixed(0)}% of identified` : '—',
            tip: 'Opportunities with High evidence strength (Negotiation-stage pipeline, ≥3 confirmed rate-card cases, or recovery with volume decline and complete data).',
          },
          {
            label: 'Clients Below Target',
            value: `${belowCount} / ${gaps.length}`,
            sub: 'Customer forecast < customer target',
            tip: 'Clients whose Existing forecast is below their own target in the horizon.',
            tone: belowCount > 0 ? 'risk' : 'neutral',
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="How far is the forecast from target?"
          subtitle={`${overview.horizon.label} · forecast bar vs target line · this is a planning gap, not an opportunity`}
          formula="Portfolio: forward driver forecast (existing + weighted pipeline) vs company revenue target. Customers: Existing forecast vs customer target (pipeline is company-level and not allocated)."
        >
          <BulletBar forecast={overview.forecastRevenue} target={overview.revenueTarget} />
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Largest customer gaps</p>
          <ul className="mt-1 space-y-1" aria-label="Customer target gaps">
            {gapRows.map((r) => {
              const maxAbs = Math.max(...gapRows.map((g) => Math.abs(g.gap)), 1)
              const w = (Math.abs(r.gap) / maxAbs) * 50
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    className="grid w-full grid-cols-[minmax(0,9rem)_minmax(0,1fr)_4.5rem] items-center gap-2 rounded py-0.5 text-left text-[12px] hover:bg-brand-50/50"
                    onClick={() => openCustomer360(r.id)}
                    title={`${r.name}: forecast ${formatCurrencyPrecise(r.forecast)} vs target ${formatCurrencyPrecise(r.target)}${r.gapPct != null ? ` (${formatPercent(r.gapPct)})` : ''}`}
                  >
                    <span className="truncate text-ink">{r.name}</span>
                    <span className="relative h-3.5">
                      <span className="absolute inset-y-0 left-1/2 w-px bg-slate-400" aria-hidden />
                      <span
                        className="absolute inset-y-0 rounded-sm"
                        style={{
                          background: r.gap < 0 ? BELOW : ABOVE,
                          width: `${w}%`,
                          left: r.gap < 0 ? `${50 - w}%` : '50%',
                        }}
                      />
                    </span>
                    <span className={`text-right font-mono ${r.gap < 0 ? 'text-danger' : 'text-success'}`}>
                      {r.gap >= 0 ? '+' : '−'}
                      {formatCurrency(Math.abs(r.gap), true)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="mt-1 text-[11px] text-ink-muted">Red = below own target · green = above · click for Client 360</p>
        </ChartCard>

        <ChartCard
          title="What kinds of opportunity are real?"
          subtitle="Identified value by type · darker = High evidence · click a bar to focus"
          formula={TYPES.map((t) => `${t}: ${OPPORTUNITY_DEFINITIONS[t]}`).join(' ')}
        >
          <div className="h-44" aria-label="Opportunity value by type">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={totals.map((t) => ({ ...t, other: Math.max(0, t.value - t.highEvidenceValue) }))}
                layout="vertical"
                margin={{ top: 0, right: 72, bottom: 0, left: 0 }}
                barCategoryGap={14}
              >
                <CartesianGrid stroke="#e3ebe6" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="type" width={78} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: '#f0f5f2' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null
                    const r = payload[0].payload as (typeof totals)[number]
                    return (
                      <div className="max-w-xs rounded-lg border border-[#dce6df] bg-white px-3 py-2 text-[12px] shadow-md">
                        <p className="font-semibold">
                          {r.type} · {formatCurrency(r.value, true)}
                        </p>
                        <p>
                          {r.count} opportunities · High evidence {formatCurrency(r.highEvidenceValue, true)}
                        </p>
                        <p className="mt-1 text-ink-muted">{OPPORTUNITY_DEFINITIONS[r.type]}</p>
                      </div>
                    )
                  }}
                />
                {(['highEvidenceValue', 'other'] as const).map((key) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="t"
                    isAnimationActive={false}
                    cursor="pointer"
                    stroke="#fff"
                    strokeWidth={2}
                    onClick={(d) => {
                      const t = (d as unknown as { type?: OpportunityType }).type
                      if (t) setTypeFilter(typeFilter === t ? 'All' : t)
                    }}
                  >
                    {totals.map((t) => (
                      <Cell
                        key={t.type}
                        fill={TYPE_COLOR[t.type]}
                        fillOpacity={(key === 'highEvidenceValue' ? 1 : 0.45) * (typeFilter === 'All' || typeFilter === t.type ? 1 : 0.35)}
                      />
                    ))}
                    {key === 'other' && (
                      <LabelList
                        dataKey="value"
                        position="right"
                        formatter={(v: unknown) => formatCurrency(Number(v), true)}
                        style={{ fontSize: 11, fill: '#4a635e' }}
                      />
                    )}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 rounded-lg bg-[#f5f8f5] px-3 py-2 text-[12px] text-ink-muted">
            Target Gap {gap >= 0 ? '+' : '−'}
            {formatCurrency(Math.abs(gap), true)} is shown separately and is not counted here. Types use different horizons, so
            the identified total is not a forecast of closable revenue.
          </p>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartCard
          title="Which opportunities are both large and well-evidenced?"
          subtitle="Upper-right = pursue first · color = type · click a dot for Client 360"
          formula="X = opportunity value (log scale). Y = evidence strength (dots spread vertically within a level for legibility)."
          action={
            <Toggle
              value={typeFilter}
              onChange={setTypeFilter}
              options={[['All', 'All'], ...TYPES.map((t) => [t, t] as [OpportunityType, string])]}
            />
          }
        >
          <div className="h-72" aria-label="Opportunity size versus evidence strength">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 16, bottom: 22, left: 4 }}>
                <CartesianGrid stroke="#e3ebe6" />
                <XAxis
                  type="number"
                  dataKey="value"
                  scale="log"
                  domain={oppAxis.domain}
                  ticks={oppAxis.ticks}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => compactMoneyTick(Number(v))}
                  label={{ value: 'Opportunity value (log scale)', position: 'insideBottom', offset: -12, fontSize: 11, fill: '#4a635e' }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  domain={[0.5, 3.5]}
                  ticks={[1, 2, 3]}
                  tickFormatter={(v) => (v === 3 ? 'High' : v === 2 ? 'Medium' : 'Low')}
                  tick={{ fontSize: 11 }}
                  width={56}
                />
                <ZAxis range={[70, 70]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null
                    const o = payload[0].payload as GrowthOpportunity
                    return (
                      <div className="max-w-xs rounded-lg border border-[#dce6df] bg-white px-3 py-2 text-[12px] shadow-md">
                        <p className="font-semibold">{o.customerName}</p>
                        <p>
                          {o.type} · {formatCurrency(o.value, true)} · {o.evidence} evidence
                        </p>
                        <p className="text-ink-muted">{o.basis}</p>
                        <p className="text-ink-muted">{o.evidenceNote}</p>
                        {o.healthBand && <p className="mt-1">Risk Band: {o.healthBand}</p>}
                      </div>
                    )
                  }}
                />
                <Scatter
                  data={matrixPts}
                  isAnimationActive={false}
                  cursor="pointer"
                  onClick={(d) => {
                    const id = (d as unknown as { customerId?: string }).customerId
                    if (id) openCustomer360(id)
                  }}
                >
                  {matrixPts.map((p) => (
                    <Cell
                      key={p.id}
                      fill={TYPE_COLOR[p.type]}
                      fillOpacity={0.85}
                      stroke={p.customerId === highlightCustomerId ? '#123C35' : '#fff'}
                      strokeWidth={p.customerId === highlightCustomerId ? 2.5 : 1.5}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <TypeLegend />
        </ChartCard>

        <ChartCard
          title={`Top 5 ${typeFilter === 'All' ? '' : `${typeFilter} `}opportunities`}
          subtitle="Ranked by value × evidence strength"
        >
          <ol className="divide-y divide-[#eef3f0]">
            {top5.map((o, i) => (
              <li key={o.id}>
                <button
                  type="button"
                  className="flex w-full items-start gap-3 py-2 text-left hover:bg-brand-50/40"
                  onClick={() => openCustomer360(o.customerId)}
                >
                  <span className="mt-0.5 font-mono text-xs font-semibold text-ink-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-ink">{o.customerName}</span>
                      <span className="font-mono text-sm font-semibold text-ink">{formatCurrency(o.value, true)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-muted">
                      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_COLOR[o.type] }} aria-hidden />
                      {o.type} · {o.evidence} evidence
                    </span>
                    <span className="block truncate text-[11px] text-ink-muted">{o.basis}</span>
                  </span>
                </button>
              </li>
            ))}
            {top5.length === 0 && <li className="py-4 text-sm text-ink-muted">No verifiable opportunities under current filters.</li>}
          </ol>
        </ChartCard>
      </div>

      <Collapsible title="All opportunities" subtitle={`${shown.length} rows · basis and evidence for each`}>
        <DataTable
          rows={shown}
          rowKey={(r) => r.id}
          onRowClick={(r) => openCustomer360(r.customerId)}
          defaultPageSize={10}
          pageSizeOptions={[10, 25, 50]}
          columns={[
            { key: 'n', header: 'Customer', render: (r) => r.customerName, sortValue: (r) => r.customerName, searchValue: (r) => r.customerName },
            { key: 't', header: 'Type', render: (r) => r.type, sortValue: (r) => r.type },
            { key: 'v', header: 'Value', align: 'right', render: (r) => formatCurrency(r.value, true), sortValue: (r) => r.value },
            { key: 'e', header: 'Evidence', render: (r) => r.evidence, sortValue: (r) => EVIDENCE_RANK[r.evidence] },
            { key: 'b', header: 'Basis', render: (r) => <span className="text-[12px]">{r.basis}</span> },
            { key: 'h', header: 'Risk Band', render: (r) => r.healthBand ?? '—' },
          ]}
        />
      </Collapsible>

      <Collapsible title="Customer target gaps" subtitle={`${gaps.length} customers · forecast vs target · planning gap only`}>
        <DataTable
          rows={gaps}
          rowKey={(r) => r.id}
          onRowClick={(r) => openCustomer360(r.id)}
          defaultPageSize={10}
          pageSizeOptions={[10, 25, 50]}
          columns={[
            { key: 'n', header: 'Customer', render: (r) => r.name, sortValue: (r) => r.name, searchValue: (r) => r.name },
            { key: 'f', header: 'Forecast', align: 'right', render: (r) => formatCurrency(r.forecast, true), sortValue: (r) => r.forecast },
            { key: 't', header: 'Target', align: 'right', render: (r) => formatCurrency(r.target, true), sortValue: (r) => r.target },
            {
              key: 'g',
              header: 'Gap',
              align: 'right',
              render: (r) => (
                <span className={r.gap >= 0 ? 'text-success' : 'text-danger'}>
                  {r.gap >= 0 ? '+' : ''}
                  {formatCurrency(r.gap, true)}
                  {r.gapPct != null ? ` (${formatPercent(r.gapPct)})` : ''}
                </span>
              ),
              sortValue: (r) => r.gap,
            },
          ]}
        />
      </Collapsible>
    </div>
  )
}
