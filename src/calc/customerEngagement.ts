export type EngagementEventType =
  | 'QBR'
  | 'Support Escalation'
  | 'Pricing Negotiation'
  | 'Renewal Discussion'
  | 'Competitor Mention'

export interface CustomerEngagementEvent {
  eventId: string
  customerId: string
  eventType: EngagementEventType
  eventDate: string
  sentiment: 'Positive' | 'Neutral' | 'Negative'
  /** Synthetic — deterministic hash, not CRM-backed */
  synthetic: true
  note: string
}

function fnv1a(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function pick<T>(arr: T[], seed: number, i: number): T {
  return arr[(seed + i * 9973) % arr.length]!
}

function isoDaysAgo(asOfDate: string, days: number): string {
  const t = Date.parse(asOfDate)
  const d = new Date(t - days * 86400000)
  return d.toISOString().slice(0, 10)
}

const EVENT_TYPES: EngagementEventType[] = [
  'QBR',
  'Support Escalation',
  'Pricing Negotiation',
  'Renewal Discussion',
  'Competitor Mention',
]

/**
 * Deterministic synthetic engagement timeline from customer_id + as-of date.
 * Does not mutate DataStore / generate.ts.
 */
export function listCustomerEngagementEvents(
  customerId: string,
  asOfDate: string,
): CustomerEngagementEvent[] {
  const seed = fnv1a(`${customerId}|${asOfDate}`)
  const count = 3 + (seed % 4)
  const events: CustomerEngagementEvent[] = []

  for (let i = 0; i < count; i++) {
    const type = pick(EVENT_TYPES, seed, i)
    const daysBack = 15 + ((seed >> (i * 3)) % 320)
    const neg = type === 'Competitor Mention' || type === 'Support Escalation'
    const sentiment: CustomerEngagementEvent['sentiment'] = neg
      ? pick(['Negative', 'Neutral'], seed, i + 7)
      : pick(['Positive', 'Neutral'], seed, i + 11)

    events.push({
      eventId: `SYN-ENG-${customerId.slice(-4)}-${i}`,
      customerId,
      eventType: type,
      eventDate: isoDaysAgo(asOfDate, daysBack),
      sentiment,
      synthetic: true,
      note:
        type === 'Competitor Mention'
          ? 'Synthetic signal — potential risk only, not verified churn.'
          : 'Synthetic engagement event for demo analytics.',
    })
  }

  return events.sort((a, b) => b.eventDate.localeCompare(a.eventDate))
}

/** 0–100 engagement health from synthetic events (lower if recent negatives). */
export function engagementRiskSignal(customerId: string, asOfDate: string): number {
  const events = listCustomerEngagementEvents(customerId, asOfDate)
  if (events.length === 0) return 55
  let score = 72
  for (const e of events.slice(0, 5)) {
    if (e.eventType === 'Competitor Mention') score -= 18
    else if (e.eventType === 'Support Escalation') score -= 10
    else if (e.eventType === 'Renewal Discussion') score -= 4
    else if (e.eventType === 'QBR') score += 6
    if (e.sentiment === 'Negative') score -= 8
    if (e.sentiment === 'Positive') score += 4
  }
  return Math.max(0, Math.min(100, Math.round(score)))
}
