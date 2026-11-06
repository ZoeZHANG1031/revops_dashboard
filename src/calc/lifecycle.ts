import { money, pct, sumMoney } from '@/lib/money'
import type { DataStore, OpportunityStage } from '@/types'
import {
  DEMO_NEAR_TERM_BOOKINGS_TARGET_TCV,
  DEMO_STAGE_AGE,
  DEMO_STAGE_AGE_NOTE,
  DEMO_STAGE_PROB_NOTE,
  DEMO_STAGE_WIN_PROB,
} from './pipelineDemoConfig'
export {
  computeOperationalPipeline,
  computeUnbilledBacklog,
  computeActivationSet,
  computeGrossToNetBridge,
  computeBillableSplit,
} from './lifecycleOps'

function latestStageEntry(
  data: DataStore,
  opportunityId: string,
  stage: OpportunityStage,
  fallbackCreated: string,
): string {
  const ev = data.opportunityStageEvents
    ?.filter((e) => e.opportunity_id === opportunityId && e.to_stage === stage)
    .sort((a, b) => b.event_date.localeCompare(a.event_date))[0]
  return ev?.event_date ?? fallbackCreated
}

export function computeSalesPipeline(data: DataStore, asOfInput?: string | null) {
  const asOf = (asOfInput ?? data.meta.as_of_date ?? data.meta.generated_at?.slice(0, 10) ?? '2026-11-05').slice(
    0,
    10,
  )
  const open = data.opportunities.filter((o) => !o.stage.startsWith('Closed'))
  const closedWon = data.opportunities.filter((o) => o.stage === 'Closed Won')
  const closedLost = data.opportunities.filter((o) => o.stage === 'Closed Lost')
  const closed = [...closedWon, ...closedLost]

  const pipelineValue = sumMoney(open.map((o) => o.opportunity_value))
  const weightedPipeline = sumMoney(
    open.map((o) => money(o.opportunity_value * o.win_probability)),
  )
  const winRate = closed.length ? pct(closedWon.length, closed.length) : null
  const cycles = closedWon.map((o) => o.sales_cycle_days ?? 0).filter((d) => d > 0)
  const salesCycleLength = cycles.length
    ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length)
    : null

  const stages = ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'] as const
  /** Stage stock — Gross + value-weighted avg win prob + Weighted (= Σ value×prob). */
  const stageStock = stages.map((stage) => {
    const rows = data.opportunities.filter((o) => o.stage === stage)
    const value = sumMoney(rows.map((o) => o.opportunity_value))
    const weighted = sumMoney(rows.map((o) => money(o.opportunity_value * o.win_probability)))
    const avgWinProb =
      value > 0 ? weighted / value : rows.length ? rows[0]?.win_probability ?? DEMO_STAGE_WIN_PROB[stage] : null
    const demoProb = DEMO_STAGE_WIN_PROB[stage]
    return {
      stage,
      count: rows.length,
      value,
      weighted,
      /** Value-weighted average of opportunity win_probability */
      avgWinProb: avgWinProb == null ? null : Math.round(avgWinProb * 1000) / 1000,
      demoStageProb: demoProb,
      labelProbPct: avgWinProb == null ? null : Math.round(avgWinProb * 100),
    }
  })

  const openStages = ['Lead', 'Qualified', 'Proposal', 'Negotiation'] as const
  const conversionHints = openStages.slice(0, -1).map((stage, i) => {
    const next = openStages[i + 1]
    const from = stageStock.find((s) => s.stage === stage)!.count
    const to = stageStock.find((s) => s.stage === next)!.count
    return {
      from: stage,
      to: next,
      stockRatio: from === 0 ? null : pct(to, from),
    }
  })

  const stageAging = openStages.map((stage) => {
    const band = DEMO_STAGE_AGE[stage]
    const opps = open.filter((o) => o.stage === stage)
    const days = opps.map((o) => {
      const start = latestStageEntry(data, o.opportunity_id, stage, o.created_date)
      const t0 = Date.parse(start)
      const t1 = Date.parse(asOf)
      return Number.isFinite(t0) && Number.isFinite(t1)
        ? Math.max(0, Math.round((t1 - t0) / 86400000))
        : 0
    })
    const sorted = [...days].sort((a, b) => a - b)
    const avg = days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null
    const median = sorted.length
      ? sorted.length % 2
        ? sorted[Math.floor(sorted.length / 2)]
        : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
      : null
    const p75 =
      sorted.length >= 4
        ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.75) - 1)]
        : sorted.length
          ? sorted[sorted.length - 1]
          : null
    const oldest = sorted.length ? sorted[sorted.length - 1] : null
    const overdueCount = days.filter((d) => d > band.overdueAfter).length
    return {
      stage,
      count: opps.length,
      avgDays: avg,
      medianDays: median,
      p75Days: p75,
      oldestDays: oldest,
      overdueAfter: band.overdueAfter,
      overdueCount,
      overduePct: days.length ? pct(overdueCount, days.length) : null,
      /** @deprecated use overdueCount — kept for older UI */
      stalledCount: overdueCount,
    }
  })

  const pastExpectedStart = open.filter(
    (o) => o.expected_start_date && o.expected_start_date < asOf,
  ).length
  const pastExpectedClose = open.filter(
    (o) => o.expected_close_date && o.expected_close_date < asOf,
  ).length
  const pastDueClose = pastExpectedStart

  // Coverage: Weighted TCV of open opps expected to close in next 90d ÷ independent demo bookings target
  const horizonEnd = (() => {
    const t = Date.parse(asOf) + 90 * 86400000
    return new Date(t).toISOString().slice(0, 10)
  })()
  const nearTermOpen = open.filter(
    (o) => o.expected_close_date >= asOf && o.expected_close_date <= horizonEnd,
  )
  const nearTermWeighted = sumMoney(
    nearTermOpen.map((o) => money(o.opportunity_value * o.win_probability)),
  )
  const remainingSalesTarget = DEMO_NEAR_TERM_BOOKINGS_TARGET_TCV
  const pipelineCoverage = pct(nearTermWeighted, remainingSalesTarget)
  const coverageMult = remainingSalesTarget > 0 ? nearTermWeighted / remainingSalesTarget : null

  const segmentOf = (o: (typeof data.opportunities)[0]): string => o.segment || 'Unknown'
  const segmentKeys = ['Enterprise', 'Mid-Market', 'SMB', 'Unknown'] as const
  const winLossBySegment = segmentKeys.map((segment) => {
    const won = closedWon.filter((o) => segmentOf(o) === segment)
    const lost = closedLost.filter((o) => segmentOf(o) === segment)
    const n = won.length + lost.length
    return {
      segment,
      winRate: n ? pct(won.length, n) : null,
      won: won.length,
      lost: lost.length,
      n,
      smallSample: n > 0 && n < 5,
      avgDeal: won.length ? money(sumMoney(won.map((o) => o.opportunity_value)) / won.length) : null,
    }
  })
  const segmentClosed = winLossBySegment.reduce((a, r) => a + r.won + r.lost, 0)
  const unknownClosed = winLossBySegment.find((s) => s.segment === 'Unknown')
  const segmentCoveragePct =
    closed.length > 0 ? pct(closed.length - (unknownClosed?.n ?? 0), closed.length) : null

  const openGrossCheck = sumMoney(
    stageStock.filter((s) => openStages.includes(s.stage as (typeof openStages)[number])).map((s) => s.value),
  )
  const openWeightedCheck = sumMoney(
    stageStock.filter((s) => openStages.includes(s.stage as (typeof openStages)[number])).map((s) => s.weighted),
  )

  return {
    asOf,
    pipelineValue,
    weightedPipeline,
    nearTermWeighted,
    coverageHorizonEnd: horizonEnd,
    winRate,
    closedDealWinRate: winRate,
    closedWonCount: closedWon.length,
    closedLostCount: closedLost.length,
    salesCycleLength,
    newCustomerAcquisition: closedWon.length,
    expectedMonthlyVolume: sumMoney(open.map((o) => o.expected_monthly_volume)),
    expectedMonthlyRevenue: sumMoney(open.map((o) => o.expected_monthly_revenue)),
    funnel: stageStock,
    stageStock,
    conversionHints,
    stageAging,
    pastDueClose,
    pastExpectedStart,
    pastExpectedClose,
    remainingSalesTarget,
    pipelineCoverage,
    coverageMult,
    pipelineCoverageNote: `Coverage = Weighted TCV of open opps with expected_close in ${asOf}→${horizonEnd} ÷ Demo near-term bookings target ($${DEMO_NEAR_TERM_BOOKINGS_TARGET_TCV.toLocaleString()}). Independent demo target — not reverse-engineered from open pipeline.`,
    demoStageProbNote: DEMO_STAGE_PROB_NOTE,
    demoStageAgeNote: DEMO_STAGE_AGE_NOTE,
    winLossBySegment,
    segmentCoveragePct,
    segmentRollupNote:
      segmentClosed === closed.length
        ? `Segment coverage ${segmentCoveragePct == null ? '—' : `${segmentCoveragePct.toFixed(0)}%`} of closed deals (prospect segment on opp).`
        : `Segment table covers ${segmentClosed}/${closed.length} closed deals — investigate mapping gaps.`,
    openGrossFoots: Math.abs(openGrossCheck - pipelineValue) < 0.05,
    openWeightedFoots: Math.abs(openWeightedCheck - weightedPipeline) < 0.05,
    note: 'Stage chart shows current stock by stage. Opportunity value = demo TCV ≠ recognized revenue.',
  }
}

