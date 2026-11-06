import { money, pct, sumMoney } from '@/lib/money'
import type { DataStore, OpportunityStage } from '@/types'

export interface CohortConversion {
  from: OpportunityStage
  to: OpportunityStage
  enteredFrom: number
  reachedTo: number
  rate: number | null
  windowNote: string
}

/**
 * True cohort conversion from stage events — not stock ratios.
 * For each opp that entered `from`, did it later reach `to`?
 */
export function computeCohortConversions(data: DataStore): {
  conversions: CohortConversion[]
  winRate: number | null
  avgSalesCycleDays: number | null
  pipelineVelocity: number | null
  stageAgingDays: Array<{ stage: OpportunityStage; avgDaysInStage: number | null }>
} {
  const pairs: Array<[OpportunityStage, OpportunityStage]> = [
    ['Lead', 'Qualified'],
    ['Qualified', 'Proposal'],
    ['Proposal', 'Negotiation'],
    ['Negotiation', 'Closed Won'],
  ]

  const events = data.opportunityStageEvents
  const byOpp = new Map<string, typeof events>()
  events.forEach((e) => {
    const list = byOpp.get(e.opportunity_id) ?? []
    list.push(e)
    byOpp.set(e.opportunity_id, list)
  })

  const conversions = pairs.map(([from, to]) => {
    let enteredFrom = 0
    let reachedTo = 0
    byOpp.forEach((evts) => {
      const hitFrom = evts.some((e) => e.to_stage === from)
      if (!hitFrom) return
      enteredFrom++
      const fromDate = evts.find((e) => e.to_stage === from)!.event_date
      const hitTo = evts.some((e) => e.to_stage === to && e.event_date >= fromDate)
      if (hitTo) reachedTo++
    })
    return {
      from,
      to,
      enteredFrom,
      reachedTo,
      rate: pct(reachedTo, enteredFrom),
      windowNote: 'Cohort: opps that entered From-stage; measured if they later reached To-stage (synthetic stage history).',
    }
  })

  const closedWon = data.opportunities.filter((o) => o.stage === 'Closed Won')
  const closedLost = data.opportunities.filter((o) => o.stage === 'Closed Lost')
  const closed = closedWon.length + closedLost.length
  const winRate = closed ? pct(closedWon.length, closed) : null

  const cycles = closedWon.map((o) => o.sales_cycle_days ?? 0).filter((d) => d > 0)
  const avgSalesCycleDays = cycles.length
    ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length)
    : null

  const openWeighted = sumMoney(
    data.opportunities
      .filter((o) => !o.stage.startsWith('Closed'))
      .map((o) => money(o.opportunity_value * o.win_probability)),
  )
  const pipelineVelocity =
    avgSalesCycleDays && avgSalesCycleDays > 0
      ? money(openWeighted / avgSalesCycleDays)
      : null

  const stageAgingDays = (['Lead', 'Qualified', 'Proposal', 'Negotiation'] as OpportunityStage[]).map(
    (stage) => {
      const dwells: number[] = []
      byOpp.forEach((evts) => {
        const sorted = [...evts].sort((a, b) => a.event_date.localeCompare(b.event_date))
        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i].to_stage !== stage) continue
          const next = sorted[i + 1]
          if (!next) continue
          const days =
            (new Date(next.event_date).getTime() - new Date(sorted[i].event_date).getTime()) / 86400000
          if (days >= 0) dwells.push(days)
        }
      })
      return {
        stage,
        avgDaysInStage: dwells.length
          ? Math.round(dwells.reduce((a, b) => a + b, 0) / dwells.length)
          : null,
      }
    },
  )

  return { conversions, winRate, avgSalesCycleDays, pipelineVelocity, stageAgingDays }
}
