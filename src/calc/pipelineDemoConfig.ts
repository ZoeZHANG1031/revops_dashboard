import type { OpportunityStage } from '@/types'

/**
 * Demo CRM stage probabilities — synthetic illustration only, not industry benchmarks.
 * Used for win_probability on open opportunities and stage display labels.
 */
export const DEMO_STAGE_WIN_PROB: Record<OpportunityStage, number> = {
  Lead: 0.1,
  Qualified: 0.25,
  Proposal: 0.4,
  Negotiation: 0.65,
  'Closed Won': 1,
  'Closed Lost': 0,
}

export const DEMO_STAGE_PROB_NOTE =
  'Demo stage probabilities (Lead 10% · Qualified 25% · Proposal 40% · Negotiation 65%) — not industry standards.'

/** Demo stage-age bands for synthetic data + overdue highlighting (not SLA contracts). */
export const DEMO_STAGE_AGE: Record<
  'Lead' | 'Qualified' | 'Proposal' | 'Negotiation',
  { normalMin: number; normalMax: number; overdueAfter: number; overdueMax: number }
> = {
  Lead: { normalMin: 1, normalMax: 7, overdueAfter: 7, overdueMax: 18 },
  Qualified: { normalMin: 3, normalMax: 14, overdueAfter: 14, overdueMax: 28 },
  Proposal: { normalMin: 7, normalMax: 21, overdueAfter: 21, overdueMax: 40 },
  Negotiation: { normalMin: 7, normalMax: 30, overdueAfter: 30, overdueMax: 50 },
}

export const DEMO_STAGE_AGE_NOTE =
  'Demo stage-age bands for illustration — not contractual SLAs.'

/** Independent near-term bookings target (90d) — fixed demo config, not reverse-engineered from open pipeline. */
export const DEMO_NEAR_TERM_BOOKINGS_TARGET_TCV = 18_000_000

export const DEMO_NEXT_STEPS = [
  'Confirm budget and decision-maker',
  'Follow up on proposal feedback',
  'Review pricing and contract terms',
  'Schedule technical discovery call',
  'Send revised statement of work',
  'Align on go-live timeline with ops',
] as const
