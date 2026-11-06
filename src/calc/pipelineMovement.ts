import { money, sumMoney } from '@/lib/money'
import type { DataStore, FactOpportunity, GlobalFilters } from '@/types'
import { periodEndDate, periodStartDate } from '@/lib/asOf'
import { DEMO_STAGE_AGE } from './pipelineDemoConfig'

/**
 * Period pipeline movement from opportunity create/close dates (no value-change events).
 * Opening / Closing are stock reconstructions; Value Changes unavailable → omitted (not invented).
 */
export function computePipelineMovement(data: DataStore, filters: GlobalFilters) {
  const start = periodStartDate(filters.startPeriod)
  const end = periodEndDate(filters.endPeriod)

  const inScope = (o: FactOpportunity) =>
    !filters.customerIds.length ||
    (o.customer_id != null && filters.customerIds.includes(o.customer_id))

  const opps = data.opportunities.filter(inScope)

  // Half-open stock definitions so every opportunity is counted exactly once:
  //   Opening = open at the START of day one (created before start, not closed before start)
  //   Closing = open at the END of the last day (created on/before end, not closed on/before end)
  //   New = created within [start, end]; Won / Lost = closed within [start, end]
  // ⇒ Closing = Opening + New − Won − Lost exactly (no value-change events exist, so no "other" movement)
  const openAtStart = (o: FactOpportunity) =>
    o.created_date < start && (!o.closed_date || o.closed_date >= start)
  const openAtEnd = (o: FactOpportunity) =>
    o.created_date <= end && (!o.closed_date || o.closed_date > end)

  const opening = opps.filter(openAtStart)
  const closing = opps.filter(openAtEnd)
  const created = opps.filter((o) => o.created_date >= start && o.created_date <= end)
  const won = opps.filter(
    (o) => o.stage === 'Closed Won' && o.closed_date && o.closed_date >= start && o.closed_date <= end,
  )
  const lost = opps.filter(
    (o) => o.stage === 'Closed Lost' && o.closed_date && o.closed_date >= start && o.closed_date <= end,
  )

  const openingValue = sumMoney(opening.map((o) => o.opportunity_value))
  const newValue = sumMoney(created.map((o) => o.opportunity_value))
  const wonValue = sumMoney(won.map((o) => o.opportunity_value))
  const lostValue = sumMoney(lost.map((o) => o.opportunity_value))
  const closingValue = sumMoney(closing.map((o) => o.opportunity_value))

  // Should be exactly 0 with half-open boundaries; kept as an explicit integrity check, never hidden
  const impliedClose = money(openingValue + newValue - wonValue - lostValue)
  const residual = money(closingValue - impliedClose)

  const steps = [
    // Movement in OPEN pipeline stock: Won and Lost both leave the open stock (outflows)
    { key: 'opening', label: 'Opening Open Pipeline', shortLabel: 'Opening', amount: openingValue },
    { key: 'new', label: 'New Pipeline (inflow)', shortLabel: 'New', amount: newValue },
    { key: 'won', label: 'Closed Won (outflow)', shortLabel: 'Won', amount: money(-wonValue) },
    { key: 'lost', label: 'Closed Lost (outflow)', shortLabel: 'Lost', amount: money(-lostValue) },
    ...(Math.abs(residual) >= 0.05
      ? [{ key: 'residual', label: 'Unreconciled movement', shortLabel: 'Unreconciled', amount: residual, isResidual: true }]
      : []),
    { key: 'closing', label: 'Closing Open Pipeline', shortLabel: 'Closing', amount: closingValue },
  ]

  return {
    steps,
    openingCount: opening.length,
    closingCount: closing.length,
    newCount: created.length,
    wonCount: won.length,
    lostCount: lost.length,
    residual,
    foots: Math.abs(residual) < 0.05 || Math.abs(impliedClose + residual - closingValue) < 0.05,
    note: 'Opening + New − Won − Lost + Residual = Closing. Residual = unexplained (no value-change events); not Upsell.',
    available: true,
  }
}

export function topOpenOpportunities(data: DataStore, asOf: string, limit = 8) {
  const open = data.opportunities.filter((o) => !o.stage.startsWith('Closed'))
  const scored = open.map((o) => {
    const ev = data.opportunityStageEvents
      ?.filter((e) => e.opportunity_id === o.opportunity_id && e.to_stage === o.stage)
      .sort((a, b) => b.event_date.localeCompare(a.event_date))[0]
    const stageStart = ev?.event_date ?? o.created_date
    const age = Math.max(
      0,
      Math.round((Date.parse(asOf) - Date.parse(stageStart)) / 86400000),
    )
    const band =
      o.stage === 'Lead' || o.stage === 'Qualified' || o.stage === 'Proposal' || o.stage === 'Negotiation'
        ? DEMO_STAGE_AGE[o.stage]
        : null
    const stageOverdue = band != null && age > band.overdueAfter
    const pastExpectedClose = o.expected_close_date < asOf
    const pastExpectedStart = o.expected_start_date < asOf
    const customer =
      (o.customer_id && data.customers.find((c) => c.customer_id === o.customer_id)?.customer_name) ||
      o.prospect_name
    return {
      id: o.opportunity_id,
      name: o.prospect_name,
      customer,
      customerId: o.customer_id,
      value: o.opportunity_value,
      stage: o.stage,
      stageAge: age,
      stageOverdue,
      expectedClose: o.expected_close_date,
      expectedStart: o.expected_start_date,
      owner: o.owner_name || 'Unassigned',
      nextStep: o.next_step,
      nextFollowUp: o.next_follow_up_date,
      pastExpectedClose,
      pastExpectedStart,
      sortReason: pastExpectedClose
        ? 'Past expected close'
        : stageOverdue
          ? 'Stage overdue'
          : 'Value',
    }
  })
  // Explainable sort: past expected close → stage overdue → value desc
  return scored
    .sort((a, b) => {
      if (a.pastExpectedClose !== b.pastExpectedClose) return a.pastExpectedClose ? -1 : 1
      if (a.stageOverdue !== b.stageOverdue) return a.stageOverdue ? -1 : 1
      if (b.value !== a.value) return b.value - a.value
      return b.stageAge - a.stageAge
    })
    .slice(0, limit)
}
