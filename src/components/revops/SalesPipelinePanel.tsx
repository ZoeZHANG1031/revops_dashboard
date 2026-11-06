import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import type { computeCohortConversions } from '@/calc/salesCohort'
import type { computeSalesPipeline } from '@/calc/lifecycle'
import { computePipelineMovement, topOpenOpportunities } from '@/calc/pipelineMovement'
import { ChartCard } from '@/components/common/ChartCard'
import { DataTable } from '@/components/common/DataTable'
import { FloatingWaterfall } from '@/components/charts/FloatingWaterfall'
import { CompactKpi, OneLineInsight } from '@/components/revops/CompactKpi'
import { PALETTE } from '@/lib/icons'
import {
  formatAxisMoney,
  formatCurrency,
  formatCurrencyPrecise,
  formatNumber,
  formatPercent,
} from '@/lib/money'
import type { DataStore, GlobalFilters } from '@/types'

type Sales = ReturnType<typeof computeSalesPipeline>
type Cohort = ReturnType<typeof computeCohortConversions>

const OPEN_STAGES = ['Lead', 'Qualified', 'Proposal', 'Negotiation'] as const

export function SalesPipelinePanel({
  sales,
  cohort,
  eventCount,
  selectedStage,
  onSelectStage,
  data,
  filters,
  asOfDate,
  onOpenOpportunity,
}: {
  sales: Sales
  cohort: Cohort
  eventCount: number
  selectedStage: string | null
  onSelectStage: (stage: string | null) => void
  data: DataStore
  filters: GlobalFilters
  asOfDate: string
  onOpenOpportunity?: (id: string) => void
}) {
  const [pipeMetric, setPipeMetric] = useState<'value' | 'count'>('value')
  const [cohortStage, setCohortStage] = useState<string | null>(null)
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null)

  const openStock = useMemo(
    () => sales.stageStock.filter((s) => (OPEN_STAGES as readonly string[]).includes(s.stage)),
    [sales.stageStock],
  )
  const closedStock = useMemo(
    () => sales.stageStock.filter((s) => s.stage.startsWith('Closed')),
    [sales.stageStock],
  )

  const funnelSteps = useMemo(() => {
    const steps: { stage: string; count: number; rateFromPrior: number | null }[] = []
    if (!cohort.conversions.length) return steps
    const first = cohort.conversions[0]
    steps.push({ stage: first.from, count: first.enteredFrom, rateFromPrior: null })
    for (const c of cohort.conversions) {
      steps.push({ stage: c.to, count: c.reachedTo, rateFromPrior: c.rate })
    }
    return steps
  }, [cohort.conversions])

  const lowestRate = useMemo(() => {
    let worst: { label: string; rate: number } | null = null
    for (const c of cohort.conversions) {
      if (c.rate == null) continue
      if (!worst || c.rate < worst.rate) worst = { label: `${c.from} → ${c.to}`, rate: c.rate }
    }
    return worst
  }, [cohort.conversions])

  const coverageMult = sales.coverageMult

  const unknownSeg = sales.winLossBySegment.find((s) => s.segment === 'Unknown')
  const segmentDq =
    unknownSeg && unknownSeg.n > 0
      ? `Unknown segment: ${unknownSeg.won}W / ${unknownSeg.lost}L · coverage ${
          sales.segmentCoveragePct == null ? '—' : `${sales.segmentCoveragePct.toFixed(0)}%`
        }`
      : sales.segmentRollupNote

  const agingRows = sales.stageAging.map((r) => ({
    ...r,
    fill: r.overdueCount > 0 ? PALETTE.watch : PALETTE.brandMid,
    targetMark: r.overdueAfter,
  }))

  const winScatter = sales.winLossBySegment
    .filter((s) => s.won + s.lost > 0)
    .map((s, i) => ({
      ...s,
      y: i,
      x: s.winRate ?? 0,
      z: Math.max(s.won + s.lost, 1),
    }))

  const movement = useMemo(() => computePipelineMovement(data, filters), [data, filters])
  const topOpps = useMemo(() => topOpenOpportunities(data, asOfDate, 8), [data, asOfDate])

  const selectedOpp = useMemo(() => {
    if (!selectedOppId) return null
    return topOpps.find((o) => o.id === selectedOppId) ?? null
  }, [selectedOppId, topOpps])

  const selectedAging = selectedStage
    ? sales.stageAging.find((a) => a.stage === selectedStage)
    : null

  const cohortOpps = useMemo(() => {
    if (!cohortStage) return []
    const ids = new Set(
      data.opportunityStageEvents.filter((e) => e.to_stage === cohortStage).map((e) => e.opportunity_id),
    )
    return data.opportunities
      .filter((o) => ids.has(o.opportunity_id))
      .slice(0, 25)
      .map((o) => ({
        id: o.opportunity_id,
        name: o.prospect_name,
        stage: o.stage,
        value: o.opportunity_value,
        closed: o.closed_date,
      }))
  }, [cohortStage, data])

  const heaviestStage = [...openStock].sort((a, b) => b.value - a.value)[0]

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-ink-muted">
        Current snapshot as-of {asOfDate.slice(0, 10)}. Period filters apply to cohort / movement
        activity only — not a full historical CRM rebuild.
      </p>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <CompactKpi
          label="Open Pipeline"
          value={formatCurrency(sales.pipelineValue, true)}
          hint="Open stages · Gross TCV"
        />
        <CompactKpi
          label="Weighted Pipeline"
          value={formatCurrency(sales.weightedPipeline, true)}
          hint="Σ Gross × opp win probability"
        />
        <CompactKpi
          label="Closed Deal Win Rate"
          value={formatPercent(sales.closedDealWinRate)}
          hint={`${formatNumber(sales.closedWonCount)} won / ${formatNumber(sales.closedLostCount)} lost`}
        />
        <CompactKpi
          label="Past Expected Close"
          value={formatNumber(sales.pastExpectedClose)}
          hint="expected_close_date before as-of · sales action"
          tag={sales.pastExpectedClose > 0 ? 'Watch' : undefined}
        />
        <CompactKpi
          label="Past Expected Start"
          value={formatNumber(sales.pastExpectedStart)}
          hint="expected_start_date before as-of · service start"
        />
      </div>

      <OneLineInsight>
        {formatCurrency(sales.pipelineValue, true)} open ·{' '}
        {formatCurrency(sales.weightedPipeline, true)} weighted
        {heaviestStage ? (
          <>
            {' '}
            · most Gross in <strong>{heaviestStage.stage}</strong> (
            {heaviestStage.labelProbPct != null ? `${heaviestStage.labelProbPct}%` : '—'} win wt.)
          </>
        ) : null}
        {lowestRate ? (
          <>
            {' '}
            · lowest cohort rate {lowestRate.label} ({formatPercent(lowestRate.rate)})
          </>
        ) : null}
      </OneLineInsight>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <ChartCard
            icon="salesPipeline"
            title="Open Pipeline by Stage"
            subtitle={`${sales.demoStageProbNote} · click stage to focus aging`}
            action={
              <div className="flex gap-1" role="tablist">
                {(['value', 'count'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={pipeMetric === k}
                    onClick={() => setPipeMetric(k)}
                    className={`rounded-md px-2 py-1 text-[11px] ${
                      pipeMetric === k ? 'bg-forest text-white' : 'border border-[#dce6df] text-ink-muted'
                    }`}
                  >
                    {k === 'value' ? 'Amount' : 'Count'}
                  </button>
                ))}
              </div>
            }
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={openStock} layout="vertical" margin={{ left: 8, right: 72 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) =>
                      pipeMetric === 'value' ? formatAxisMoney(Number(v)) : String(v)
                    }
                  />
                  <YAxis
                    type="category"
                    dataKey="stage"
                    width={118}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(stage) => {
                      const row = openStock.find((s) => s.stage === stage)
                      const pct =
                        row?.labelProbPct != null ? ` · ${row.labelProbPct}%` : ''
                      return `${stage}${pct}`
                    }}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null
                      const r = payload[0].payload as (typeof openStock)[0]
                      if (pipeMetric === 'count') {
                        return (
                          <div className="rounded border border-[#dce6df] bg-white px-2 py-1.5 text-xs shadow">
                            <div className="font-semibold">{r.stage}</div>
                            <div>{formatNumber(r.count)} opportunities</div>
                            <div className="text-[10px] text-ink-muted">
                              Count mode — no weighted count (undefined)
                            </div>
                          </div>
                        )
                      }
                      const probPct = r.labelProbPct
                      return (
                        <div className="max-w-xs rounded border border-[#dce6df] bg-white px-2 py-1.5 text-xs shadow">
                          <div className="font-semibold">
                            {r.stage} · {probPct == null ? '—' : `${probPct}%`}
                          </div>
                          <div>Gross {formatCurrencyPrecise(r.value)}</div>
                          <div>Weighted {formatCurrencyPrecise(r.weighted)}</div>
                          <div className="mt-1 text-[10px] text-ink-muted">
                            Stage wt. avg = Σ(value × opp.win_prob) / Σ(value)
                            {r.avgWinProb != null
                              ? ` = ${formatCurrencyPrecise(r.weighted)} / ${formatCurrencyPrecise(r.value)} = ${(r.avgWinProb * 100).toFixed(1)}%`
                              : ''}
                          </div>
                          <div className="text-[10px] text-ink-muted">
                            Demo stage label {Math.round((r.demoStageProb ?? 0) * 100)}% · opp probs
                            from demo stage config
                          </div>
                        </div>
                      )
                    }}
                  />
                  {pipeMetric === 'value' ? (
                    <>
                      <Bar
                        dataKey="value"
                        name="Gross Pipeline Value"
                        fill={PALETTE.brand}
                        radius={[0, 4, 4, 0]}
                        cursor="pointer"
                        isAnimationActive={false}
                        onClick={(d) => {
                          const st = (d as { stage?: string })?.stage
                          if (st) onSelectStage(selectedStage === st ? null : st)
                        }}
                      >
                        {openStock.map((s) => (
                          <Cell
                            key={s.stage}
                            fill={selectedStage === s.stage ? PALETTE.forecast : PALETTE.brand}
                          />
                        ))}
                        <LabelList
                          dataKey="value"
                          position="right"
                          formatter={(v) => formatAxisMoney(Number(v ?? 0))}
                          style={{ fontSize: 10, fill: '#123C35' }}
                        />
                      </Bar>
                      <Bar
                        dataKey="weighted"
                        name="Weighted Pipeline Value"
                        fill={PALETTE.forecastLight}
                        radius={[0, 4, 4, 0]}
                        isAnimationActive={false}
                      />
                    </>
                  ) : (
                    <Bar
                      dataKey="count"
                      name="Opportunities"
                      fill={PALETTE.brandMid}
                      radius={[0, 4, 4, 0]}
                      cursor="pointer"
                      isAnimationActive={false}
                      onClick={(d) => {
                        const st = (d as { stage?: string })?.stage
                        if (st) onSelectStage(selectedStage === st ? null : st)
                      }}
                    >
                      <LabelList dataKey="count" position="right" style={{ fontSize: 10 }} />
                    </Bar>
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
            {pipeMetric === 'value' ? (
              <div className="mt-2 space-y-1 text-[11px] text-ink-muted">
                {openStock.map((s) => (
                  <div key={s.stage} className="flex flex-wrap gap-x-2">
                    <span className="font-medium text-ink">
                      {s.stage} · {s.labelProbPct == null ? '—' : `${s.labelProbPct}%`}
                    </span>
                    <span>
                      Gross {formatCurrency(s.value, true)} / Weighted{' '}
                      {formatCurrency(s.weighted, true)}
                    </span>
                  </div>
                ))}
                <div className="pt-1 text-[10px]">
                  Σ Gross {formatCurrency(sales.pipelineValue, true)}
                  {sales.openGrossFoots ? ' = Open Pipeline' : ' ≠ Open Pipeline (check)'} · Σ Weighted{' '}
                  {formatCurrency(sales.weightedPipeline, true)}
                  {sales.openWeightedFoots ? ' = Weighted Pipeline' : ' ≠ Weighted Pipeline (check)'}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[10px] text-ink-muted">
                Count mode shows opportunity headcount only — weighted count is not defined.
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-muted">
              {closedStock.map((s) => (
                <span key={s.stage}>
                  {s.stage}: {formatNumber(s.count)} · {formatCurrency(s.value, true)}
                </span>
              ))}
            </div>
          </ChartCard>
        </div>

        <div className="xl:col-span-5">
          <ChartCard
            icon="salesPipeline"
            title="Cohort Conversion Funnel"
            subtitle={`Stage-history (${formatNumber(eventCount)}) · not stage stock · click a stage`}
          >
            <div className="space-y-2">
              {funnelSteps.map((step, i) => {
                const max = funnelSteps[0]?.count || 1
                const widthPct = Math.max(8, (step.count / max) * 100)
                const isLowest =
                  lowestRate &&
                  i > 0 &&
                  `${funnelSteps[i - 1].stage} → ${step.stage}` === lowestRate.label
                return (
                  <button
                    key={`${step.stage}-${i}`}
                    type="button"
                    className="block w-full text-left"
                    onClick={() => setCohortStage(cohortStage === step.stage ? null : step.stage)}
                  >
                    <div className="mb-0.5 flex flex-wrap items-baseline justify-between gap-1 text-xs">
                      <span
                        className={`font-medium ${cohortStage === step.stage ? 'text-forest' : 'text-ink'}`}
                      >
                        {step.stage}
                      </span>
                      <span className="font-mono tabular-nums text-ink">
                        {formatNumber(step.count)}
                        {step.rateFromPrior != null ? (
                          <span
                            className={`ml-2 ${isLowest ? 'font-semibold text-[#C44536]' : 'text-ink-muted'}`}
                          >
                            {formatPercent(step.rateFromPrior)}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="h-7 w-full rounded bg-[#eef3f0]">
                      <div
                        className={`h-full rounded ${isLowest ? 'bg-[#C44536]' : 'bg-forest'}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-[10px] text-ink-muted">
              Not-yet-converted ≠ Closed Lost. Rates from stage-event cohort definition.
            </p>
            {cohortStage && (
              <div className="mt-2">
                <p className="mb-1 text-[11px] font-semibold text-ink">
                  Entered {cohortStage} · {cohortOpps.length} shown
                  <button
                    type="button"
                    className="ml-2 text-forest underline"
                    onClick={() => setCohortStage(null)}
                  >
                    Clear
                  </button>
                </p>
                <DataTable
                  rows={cohortOpps}
                  rowKey={(r) => r.id}
                  searchable={false}
                  defaultPageSize={8}
                  onRowClick={(r) => onOpenOpportunity?.(r.id)}
                  columns={[
                    { key: 'n', header: 'Opportunity', render: (r) => r.name },
                    { key: 's', header: 'Current', render: (r) => r.stage },
                    {
                      key: 'v',
                      header: 'Value',
                      align: 'right',
                      render: (r) => formatCurrency(r.value, true),
                    },
                  ]}
                />
              </div>
            )}
          </ChartCard>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Stage Aging"
          subtitle={
            selectedAging
              ? `${selectedAging.stage}: median ${selectedAging.medianDays ?? '—'}d · n=${selectedAging.count} · overdue >${selectedAging.overdueAfter}d = ${selectedAging.overdueCount}`
              : `${sales.demoStageAgeNote} · Stage Age = as-of − latest entry to current stage`
          }
          action={
            selectedStage ? (
              <button
                type="button"
                className="text-[11px] text-forest underline"
                onClick={() => onSelectStage(null)}
              >
                Clear stage
              </button>
            ) : null
          }
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingRows} layout="vertical" margin={{ left: 4, right: 48 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} unit="d" />
                <YAxis type="category" dataKey="stage" width={80} tick={{ fontSize: 11 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null
                    const r = payload[0].payload as (typeof agingRows)[0]
                    return (
                      <div className="rounded border border-[#dce6df] bg-white px-2 py-1.5 text-xs shadow">
                        <div className="font-semibold">{r.stage}</div>
                        <div>Median {r.medianDays ?? '—'}d · P75 {r.p75Days ?? '—'}d</div>
                        <div>Oldest {r.oldestDays ?? '—'}d · n={r.count}</div>
                        <div>
                          Overdue &gt;{r.overdueAfter}d: {r.overdueCount}
                          {r.overduePct != null ? ` (${formatPercent(r.overduePct)})` : ''}
                        </div>
                        <div className="text-[10px] text-ink-muted">
                          Stage Age = as-of − latest to_stage event (not opportunity created date)
                        </div>
                      </div>
                    )
                  }}
                />
                {selectedAging ? (
                  <ReferenceLine
                    x={selectedAging.overdueAfter}
                    stroke={PALETTE.muted}
                    strokeDasharray="4 4"
                    label={{ value: `>${selectedAging.overdueAfter}d`, fontSize: 9, fill: PALETTE.muted }}
                  />
                ) : null}
                <Bar
                  dataKey="medianDays"
                  name="Median Stage Days"
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  isAnimationActive={false}
                  onClick={(d) => {
                    const st = (d as { stage?: string })?.stage
                    if (st) onSelectStage(selectedStage === st ? null : st)
                  }}
                >
                  {agingRows.map((r) => (
                    <Cell
                      key={r.stage}
                      fill={
                        selectedStage === r.stage
                          ? PALETTE.forecast
                          : r.overdueCount > 0
                            ? PALETTE.watch
                            : PALETTE.brandMid
                      }
                    />
                  ))}
                  <LabelList
                    dataKey="overdueCount"
                    position="right"
                    formatter={(v) => {
                      const n = Number(v ?? 0)
                      return n > 0 ? `${n} od` : ''
                    }}
                    style={{ fontSize: 9, fill: '#8a5a2b' }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 space-y-0.5 text-[10px] text-ink-muted">
            {agingRows.map((r) => (
              <div key={r.stage}>
                {r.stage}: median {r.medianDays ?? '—'}d · n={r.count} · overdue {r.overdueCount}
                {r.overduePct != null ? ` (${formatPercent(r.overduePct)})` : ''} · target &gt;
                {r.overdueAfter}d
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard
          title="Win Rate by Segment"
          subtitle={`Won/(Won+Lost) · segment coverage ${
            sales.segmentCoveragePct == null ? '—' : `${sales.segmentCoveragePct.toFixed(0)}%`
          }`}
        >
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
                <CartesianGrid stroke={PALETTE.grid} strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="x"
                  domain={[0, 100]}
                  unit="%"
                  tick={{ fontSize: 10 }}
                  name="Win %"
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => winScatter[Number(v)]?.segment ?? ''}
                  width={78}
                  allowDecimals={false}
                />
                <ZAxis type="number" dataKey="z" range={[60, 220]} />
                {sales.closedDealWinRate != null && (
                  <ReferenceLine
                    x={sales.closedDealWinRate}
                    stroke={PALETTE.muted}
                    strokeDasharray="4 4"
                    label={{ value: 'Overall', fontSize: 9, fill: PALETTE.muted }}
                  />
                )}
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null
                    const r = payload[0].payload as (typeof winScatter)[0]
                    return (
                      <div className="rounded border border-[#dce6df] bg-white px-2 py-1 text-xs shadow">
                        <div className="font-semibold">{r.segment}</div>
                        <div>
                          Win Rate {formatPercent(r.winRate)} = {r.won} / ({r.won}+{r.lost})
                        </div>
                        <div>
                          n={r.n}
                          {r.smallSample ? ' · Small sample' : ''}
                        </div>
                        {r.winRate === 100 && r.smallSample ? (
                          <div className="text-[10px] text-ink-muted">
                            100% with small n is not strong evidence of excellence
                          </div>
                        ) : null}
                      </div>
                    )
                  }}
                />
                <Scatter data={winScatter} fill={PALETTE.brandMid}>
                  {winScatter.map((s) => (
                    <Cell
                      key={s.segment}
                      fill={s.smallSample ? PALETTE.muted : PALETTE.brandMid}
                      opacity={s.smallSample ? 0.7 : 1}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 space-y-0.5 text-[10px] text-ink-muted">
            {winScatter.map((s) => (
              <div key={s.segment}>
                {s.segment}: {formatPercent(s.winRate)} · {s.won}W/{s.lost}L · n={s.n}
                {s.smallSample ? ' · Small sample' : ''}
              </div>
            ))}
          </div>
          {segmentDq ? <p className="mt-1 text-[10px] text-ink-muted">{segmentDq}</p> : null}
        </ChartCard>

        <ChartCard
          title="Pipeline Coverage"
          subtitle={`Near-term Weighted TCV (close ${asOfDate.slice(0, 10)}→${sales.coverageHorizonEnd}) ÷ Demo bookings target`}
        >
          {coverageMult == null ? (
            <p className="py-8 text-center text-sm text-ink-muted">No valid target — coverage N/A</p>
          ) : (
            <>
              <p className="text-3xl font-semibold tabular-nums text-ink">
                {coverageMult.toFixed(2)}×
              </p>
              <p className="text-xs text-ink-muted">
                {formatCurrency(sales.nearTermWeighted, true)} /{' '}
                {formatCurrency(sales.remainingSalesTarget, true)}
              </p>
              <div className="relative mt-3 h-3 w-full overflow-hidden rounded-full bg-[#eef3f0]">
                <div
                  className="h-full rounded-full bg-forest"
                  style={{ width: `${Math.min(100, (Math.min(coverageMult, 4) / 4) * 100)}%` }}
                />
                <div
                  className="absolute top-0 h-full w-px bg-[#C44536]"
                  style={{ left: '25%' }}
                  title="1.0× mark"
                />
              </div>
              <div className="mt-1 flex justify-between text-[9px] text-ink-muted">
                <span>0×</span>
                <span>1.0×</span>
                <span>2×</span>
                <span>4×+</span>
              </div>
              <p className="mt-2 text-[10px] text-ink-muted">
                <span className="rounded bg-amber-50 px-1 font-medium text-amber-900">
                  Demo bookings target
                </span>{' '}
                — independent config, not reverse-engineered from open pipeline.
              </p>
            </>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <ChartCard
            title="Pipeline Movement"
            subtitle={`${filters.startPeriod}→${filters.endPeriod} · period activity`}
          >
            <FloatingWaterfall
              steps={movement.steps}
              height={220}
              totalKeys={['opening', 'closing']}
            />
            <p className="mt-1 text-[10px] text-ink-muted" title={movement.note}>
              Opening + New − Won − Lost
              {Math.abs(movement.residual) >= 0.05 ? ' + Residual' : ''} = Closing.
            </p>
          </ChartCard>
        </div>
        <div className="lg:col-span-7">
          <ChartCard
            title="Top Open Opportunities"
            subtitle="Sort: Past Expected Close → Stage overdue → Value · not a risk score · demo next steps"
          >
            <DataTable
              rows={topOpps}
              rowKey={(r) => r.id}
              searchable={false}
              defaultPageSize={8}
              onRowClick={(r) => {
                setSelectedOppId(selectedOppId === r.id ? null : r.id)
                onOpenOpportunity?.(r.id)
              }}
              columns={[
                {
                  key: 'n',
                  header: 'Opportunity / Account',
                  render: (r) => (
                    <span className="block max-w-[140px] truncate" title={`${r.name} · ${r.customer}`}>
                      {r.name}
                    </span>
                  ),
                },
                {
                  key: 'v',
                  header: 'Value',
                  align: 'right',
                  render: (r) => formatCurrency(r.value, true),
                },
                { key: 's', header: 'Stage', render: (r) => r.stage },
                {
                  key: 'a',
                  header: 'Stage Age',
                  align: 'right',
                  render: (r) => (
                    <span className={r.stageOverdue ? 'text-amber-800' : undefined}>{r.stageAge}d</span>
                  ),
                },
                {
                  key: 'ec',
                  header: 'Exp. Close',
                  render: (r) => (
                    <span className={r.pastExpectedClose ? 'text-amber-800' : undefined}>
                      {r.expectedClose}
                    </span>
                  ),
                },
                {
                  key: 'o',
                  header: 'Owner',
                  render: (r) => (
                    <span className="block max-w-[90px] truncate" title={r.owner}>
                      {r.owner}
                    </span>
                  ),
                },
                {
                  key: 'ns',
                  header: 'Next Step',
                  render: (r) => (
                    <span className="block max-w-[160px] truncate" title={`${r.nextStep} (demo)`}>
                      {r.nextStep}
                    </span>
                  ),
                },
                {
                  key: 'nf',
                  header: 'Follow-up',
                  render: (r) => r.nextFollowUp,
                },
              ]}
            />
            {selectedOpp ? (
              <div className="mt-2 rounded border border-[#dce6df] bg-[#f7faf8] p-2 text-[11px] text-ink">
                <div className="font-semibold">
                  {selectedOpp.name}{' '}
                  <span className="font-normal text-ink-muted">· {selectedOpp.id}</span>
                </div>
                <div className="mt-1 grid gap-1 sm:grid-cols-2">
                  <div>Account: {selectedOpp.customer}</div>
                  <div>Owner: {selectedOpp.owner}</div>
                  <div>
                    Stage Age: {selectedOpp.stageAge}d
                    {selectedOpp.stageOverdue ? ' (overdue)' : ''}
                  </div>
                  <div>Expected Close: {selectedOpp.expectedClose}</div>
                  <div>Expected Service Start: {selectedOpp.expectedStart}</div>
                  <div>Next Follow-up: {selectedOpp.nextFollowUp}</div>
                  <div className="sm:col-span-2">
                    Next Step (demo): {selectedOpp.nextStep}
                  </div>
                  <div className="sm:col-span-2 text-ink-muted">
                    Sort reason: {selectedOpp.sortReason}
                  </div>
                </div>
              </div>
            ) : null}
          </ChartCard>
        </div>
      </div>

      {selectedStage && selectedAging && (
        <ChartCard
          title={`Stage focus · ${selectedStage}`}
          subtitle={`${selectedAging.overdueCount} overdue >${selectedAging.overdueAfter}d · ${selectedAging.count} open`}
        >
          <DataTable
            rows={[
              {
                id: selectedStage,
                stage: selectedStage,
                count: selectedAging.count,
                median: selectedAging.medianDays,
                p75: selectedAging.p75Days,
                oldest: selectedAging.oldestDays,
                avg: selectedAging.avgDays,
                overdue: selectedAging.overdueCount,
                overdueAfter: selectedAging.overdueAfter,
              },
            ]}
            rowKey={(r) => r.id}
            searchable={false}
            columns={[
              { key: 's', header: 'Stage', render: (r) => r.stage },
              { key: 'n', header: 'Open', align: 'right', render: (r) => formatNumber(r.count) },
              {
                key: 'm',
                header: 'Median days',
                align: 'right',
                render: (r) => (r.median == null ? '—' : String(r.median)),
              },
              {
                key: 'p',
                header: 'P75',
                align: 'right',
                render: (r) => (r.p75 == null ? '—' : String(r.p75)),
              },
              {
                key: 'o',
                header: 'Oldest',
                align: 'right',
                render: (r) => (r.oldest == null ? '—' : String(r.oldest)),
              },
              {
                key: 'od',
                header: 'Overdue',
                align: 'right',
                render: (r) => `${formatNumber(r.overdue)} (>${r.overdueAfter}d)`,
              },
            ]}
          />
        </ChartCard>
      )}
    </div>
  )
}
