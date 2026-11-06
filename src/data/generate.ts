import { money, mulMoney, sumMoney } from '@/lib/money'
import type {
  DataStore,
  DimContract,
  DimCustomer,
  DimDate,
  DimRateCard,
  DimRegion,
  DimService,
  FactBillingLine,
  FactCost,
  FactCreditMemo,
  FactException,
  FactForecast,
  FactGeneralLedger,
  FactInvoice,
  FactOpportunity,
  FactOpportunityStageEvent,
  FactPayment,
  FactRevenueRecognition,
  FactShipment,
  OpportunityStage,
  RegionCode,
  ServiceType,
} from '@/types'
import { SeededRng } from './rng'

const SEED = 20241105
const REGIONS: RegionCode[] = ['Northeast', 'Southeast', 'Midwest', 'Southwest', 'West']
const SERVICES: ServiceType[] = ['Standard', 'Express', 'SameDay', 'Economy']

const CUSTOMER_SEED: Array<{
  name: string
  industry: string
  segment: DimCustomer['segment']
  region: RegionCode
  trend: 'growing' | 'stable' | 'declining' | 'at_risk'
  baseVolume: number
  baseRate: number
  /** Relative fail probability multiplier for health diversity */
  deliveryStress: number
  /** DSP cost multiplier — high = low margin scenario */
  costStress: number
  paymentRisk: number
}> = [
  { name: 'Northwind Retail', industry: 'Retail', segment: 'Enterprise', region: 'Northeast', trend: 'growing', baseVolume: 110, baseRate: 6.8, deliveryStress: 0.7, costStress: 0.9, paymentRisk: 0.05 },
  { name: 'Cascade Apparel', industry: 'Apparel', segment: 'Enterprise', region: 'West', trend: 'stable', baseVolume: 95, baseRate: 7.2, deliveryStress: 1.0, costStress: 1.0, paymentRisk: 0.1 },
  { name: 'Prairie Home Goods', industry: 'Home', segment: 'Mid-Market', region: 'Midwest', trend: 'declining', baseVolume: 70, baseRate: 5.9, deliveryStress: 1.4, costStress: 1.15, paymentRisk: 0.25 },
  { name: 'Sunbelt Electronics', industry: 'Electronics', segment: 'Enterprise', region: 'Southwest', trend: 'growing', baseVolume: 120, baseRate: 8.1, deliveryStress: 0.8, costStress: 0.95, paymentRisk: 0.08 },
  { name: 'Atlantic Pharma Dist.', industry: 'Healthcare', segment: 'Enterprise', region: 'Northeast', trend: 'stable', baseVolume: 85, baseRate: 9.4, deliveryStress: 0.6, costStress: 0.85, paymentRisk: 0.05 },
  { name: 'Bayou Grocery Co.', industry: 'Grocery', segment: 'Mid-Market', region: 'Southeast', trend: 'growing', baseVolume: 100, baseRate: 5.4, deliveryStress: 1.1, costStress: 1.25, paymentRisk: 0.12 },
  { name: 'Rocky Mountain Outfitters', industry: 'Outdoor', segment: 'SMB', region: 'West', trend: 'at_risk', baseVolume: 40, baseRate: 6.2, deliveryStress: 2.2, costStress: 1.35, paymentRisk: 0.45 },
  { name: 'Great Lakes Auto Parts', industry: 'Automotive', segment: 'Mid-Market', region: 'Midwest', trend: 'stable', baseVolume: 65, baseRate: 7.0, deliveryStress: 1.0, costStress: 1.05, paymentRisk: 0.15 },
  { name: 'Pacific Beauty Labs', industry: 'Beauty', segment: 'Mid-Market', region: 'West', trend: 'growing', baseVolume: 75, baseRate: 6.5, deliveryStress: 0.9, costStress: 0.95, paymentRisk: 0.1 },
  { name: 'Capital Office Supply', industry: 'B2B', segment: 'SMB', region: 'Northeast', trend: 'declining', baseVolume: 35, baseRate: 5.8, deliveryStress: 1.6, costStress: 1.2, paymentRisk: 0.35 },
  { name: 'Desert Direct', industry: 'Marketplace', segment: 'Enterprise', region: 'Southwest', trend: 'growing', baseVolume: 140, baseRate: 5.2, deliveryStress: 1.3, costStress: 1.4, paymentRisk: 0.18 },
  { name: 'Maple Leaf Pets', industry: 'Pet', segment: 'SMB', region: 'Northeast', trend: 'stable', baseVolume: 45, baseRate: 6.0, deliveryStress: 1.0, costStress: 1.0, paymentRisk: 0.12 },
  { name: 'Gulf Coast Tools', industry: 'Industrial', segment: 'Mid-Market', region: 'Southeast', trend: 'at_risk', baseVolume: 55, baseRate: 7.5, deliveryStress: 2.0, costStress: 1.3, paymentRisk: 0.4 },
  { name: 'Heartland Books', industry: 'Media', segment: 'SMB', region: 'Midwest', trend: 'declining', baseVolume: 30, baseRate: 4.8, deliveryStress: 1.5, costStress: 1.1, paymentRisk: 0.3 },
  { name: 'Sierra Sportswear', industry: 'Apparel', segment: 'Mid-Market', region: 'West', trend: 'growing', baseVolume: 80, baseRate: 6.9, deliveryStress: 0.85, costStress: 0.9, paymentRisk: 0.08 },
  { name: 'Metro Meal Kits', industry: 'Food', segment: 'Enterprise', region: 'Northeast', trend: 'stable', baseVolume: 130, baseRate: 8.8, deliveryStress: 1.2, costStress: 1.15, paymentRisk: 0.1 },
  { name: 'Lone Star Fashion', industry: 'Apparel', segment: 'Mid-Market', region: 'Southwest', trend: 'stable', baseVolume: 60, baseRate: 6.4, deliveryStress: 1.0, costStress: 1.0, paymentRisk: 0.12 },
  { name: 'Evergreen Wellness', industry: 'Healthcare', segment: 'SMB', region: 'West', trend: 'growing', baseVolume: 50, baseRate: 9.0, deliveryStress: 0.55, costStress: 0.8, paymentRisk: 0.05 },
  { name: 'Blue Ridge Hardware', industry: 'Retail', segment: 'SMB', region: 'Southeast', trend: 'at_risk', baseVolume: 28, baseRate: 5.6, deliveryStress: 2.4, costStress: 1.45, paymentRisk: 0.5 },
  { name: 'Frontier Gadgets', industry: 'Electronics', segment: 'Mid-Market', region: 'Midwest', trend: 'growing', baseVolume: 90, baseRate: 7.8, deliveryStress: 0.75, costStress: 0.92, paymentRisk: 0.08 },
]

const OWNERS = ['A. Chen', 'M. Rivera', 'J. Patel', 'S. Brooks', 'L. Nguyen', 'T. Walsh']
const DSPS = ['DSP-Alpha', 'DSP-Beta', 'DSP-Gamma', 'DSP-Delta', 'DSP-Echo']

const METROS: Record<RegionCode, string[]> = {
  Northeast: ['NYC Metro', 'Boston Metro', 'Philly Metro'],
  Southeast: ['Atlanta Metro', 'Miami Metro', 'Charlotte Metro'],
  Midwest: ['Chicago Metro', 'Detroit Metro', 'Minneapolis Metro'],
  Southwest: ['Dallas Metro', 'Phoenix Metro', 'Houston Metro'],
  West: ['LA Metro', 'Bay Area', 'Seattle Metro'],
}

/**
 * Company fixed opex pool per month — allocated by shipment volume share.
 * Base assumption (~$9k) is sized to this synthetic network (~$25–30k monthly net billings),
 * ~30% of revenue — typical last-mile facility/admin absorption for a small demo network.
 * Prior $420k/mo was ~15× revenue (underutilization stress) and is retained as Downside multiplier in Unit Economics.
 */
export const MONTHLY_FIXED_OPEX_POOL_BASE = 9_000
export const MONTHLY_FIXED_OPEX_POOL_DOWNSIDE = 42_000

function pad(n: number, width = 4): string {
  return String(n).padStart(width, '0')
}

function periodLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function seasonality(month: number): number {
  // Q4 peak for last-mile retail volume
  const factors = [0.85, 0.82, 0.9, 0.95, 0.98, 1.0, 0.97, 1.02, 1.08, 1.2, 1.35, 1.28]
  return factors[month - 1]
}

function findRateCard(
  cards: DimRateCard[],
  contractId: string,
  service: ServiceType,
  region: RegionCode,
  date: string,
): DimRateCard {
  const matches = cards.filter(
    (c) =>
      c.contract_id === contractId &&
      c.service_type === service &&
      c.region === region &&
      c.effective_from <= date &&
      c.effective_to >= date,
  )
  if (matches.length) return matches.sort((a, b) => b.version - a.version)[0]
  return cards.find((c) => c.contract_id === contractId)!
}

function priceShipment(
  card: DimRateCard,
  weight: number,
  zone: number,
  isRemote: boolean,
  monthlyVolumeSoFar: number,
): { base: number; fuel: number; remote: number; discount: number } {
  let base = card.base_rate + weight * card.per_lb_rate
  base = mulMoney(base, 1 + (zone - 1) * 0.08 * card.zone_multiplier)
  const discount =
    monthlyVolumeSoFar >= card.volume_tier_min
      ? money(base * card.volume_tier_discount)
      : 0
  const fuel = money((base - discount) * card.fuel_surcharge_pct)
  const remote = isRemote ? card.remote_surcharge : 0
  return { base: money(base), fuel, remote, discount }
}

export function generateDataStore(seed = SEED): DataStore {
  const rng = new SeededRng(seed)
  const generatedAt = new Date().toISOString()

  // --- Dimensions ---
  const regions: DimRegion[] = REGIONS.map((region) => ({
    region,
    zone_count: region === 'West' || region === 'Northeast' ? 8 : 6,
    avg_dsp_cost: money(rng.float(2.8, 4.6)),
  }))

  const services: DimService[] = [
    { service_type: 'Standard', description: '2–3 day last-mile delivery', sla_hours: 72 },
    { service_type: 'Express', description: 'Next-day delivery', sla_hours: 24 },
    { service_type: 'SameDay', description: 'Same-day metro delivery', sla_hours: 8 },
    { service_type: 'Economy', description: 'Economy multi-day delivery', sla_hours: 120 },
  ]

  // 12 months ending Oct 2025
  const startYear = 2024
  const startMonth = 11
  const dates: DimDate[] = []
  const periods: string[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(startYear, startMonth - 1 + i, 1)
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    const key = `${y}-${String(m).padStart(2, '0')}-01`
    const p = periodLabel(y, m)
    periods.push(p)
    dates.push({
      date_key: key,
      year: y,
      month: m,
      quarter: Math.ceil(m / 3),
      month_label: d.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
      is_month_end: true,
    })
  }

  const customers: DimCustomer[] = CUSTOMER_SEED.map((c, i) => ({
    customer_id: `CUS-${pad(i + 1)}`,
    customer_name: c.name,
    industry: c.industry,
    segment: c.segment,
    region: c.region,
    account_owner: OWNERS[i % OWNERS.length],
    status: c.trend === 'at_risk' && rng.chance(0.3) ? 'Active' : 'Active',
    acquired_date: `${rng.int(2021, 2024)}-${String(rng.int(1, 12)).padStart(2, '0')}-15`,
    synthetic: true,
  }))

  const contracts: DimContract[] = []
  const rateCards: DimRateCard[] = []
  let contractSeq = 1
  let rateSeq = 1

  customers.forEach((cust, i) => {
    const seed = CUSTOMER_SEED[i]
    const start = cust.acquired_date < '2024-01-01' ? '2024-01-01' : cust.acquired_date
    const contractId = `CON-${pad(contractSeq++)}`
    const pricingModels: DimContract['pricing_model'][] = [
      'WeightBased',
      'ZoneBased',
      'VolumeTier',
      'FlatRate',
    ]
    contracts.push({
      contract_id: contractId,
      customer_id: cust.customer_id,
      version: 1,
      start_date: start,
      end_date: '2026-12-31',
      pricing_model: pricingModels[i % pricingModels.length],
      volume_commitment: Math.round(seed.baseVolume * 20),
      payment_terms_days: seed.segment === 'Enterprise' ? 45 : 30,
      status: 'Active',
      synthetic: true,
    })

    // V1 rate cards for all service/region combos used by customer
    SERVICES.forEach((svc) => {
      const svcMult = svc === 'Express' ? 1.45 : svc === 'SameDay' ? 1.9 : svc === 'Economy' ? 0.75 : 1
      const rcId = `RC-${pad(rateSeq++)}`
      rateCards.push({
        rate_card_id: rcId,
        contract_id: contractId,
        service_type: svc,
        region: cust.region,
        base_rate: money(seed.baseRate * svcMult),
        per_lb_rate: money(rng.float(0.12, 0.35)),
        zone_multiplier: money(rng.float(0.8, 1.2)),
        volume_tier_min: Math.round(seed.baseVolume * 0.7),
        volume_tier_discount: money(rng.float(0.03, 0.08)),
        fuel_surcharge_pct: money(rng.float(0.06, 0.12)),
        remote_surcharge: money(rng.float(1.5, 4.5)),
        effective_from: start,
        effective_to: '2025-05-31',
        version: 1,
        synthetic: true,
      })
      // V2 mid-year price update
      rateCards.push({
        rate_card_id: `RC-${pad(rateSeq++)}`,
        contract_id: contractId,
        service_type: svc,
        region: cust.region,
        base_rate: money(seed.baseRate * svcMult * (seed.trend === 'growing' ? 1.04 : 0.98)),
        per_lb_rate: money(rng.float(0.12, 0.35)),
        zone_multiplier: money(rng.float(0.8, 1.2)),
        volume_tier_min: Math.round(seed.baseVolume * 0.7),
        volume_tier_discount: money(rng.float(0.03, 0.08)),
        fuel_surcharge_pct: money(rng.float(0.07, 0.13)),
        remote_surcharge: money(rng.float(1.5, 4.5)),
        effective_from: '2025-06-01',
        effective_to: '2026-12-31',
        version: 2,
        synthetic: true,
      })
    })
  })

  // --- Opportunities ---
  const opportunities: FactOpportunity[] = []
  const stages: FactOpportunity['stage'][] = [
    'Lead',
    'Qualified',
    'Proposal',
    'Negotiation',
    'Closed Won',
    'Closed Lost',
  ]
  for (let i = 0; i < 28; i++) {
    const stage = stages[i % stages.length]
    const winProb =
      stage === 'Closed Won'
        ? 1
        : stage === 'Closed Lost'
          ? 0
          : stage === 'Negotiation'
            ? 0.65
            : stage === 'Proposal'
              ? 0.4
              : stage === 'Qualified'
                ? 0.25
                : 0.1
    const value = money(rng.float(80_000, 900_000))
    const monthlyVol = rng.int(20, 150)
    const monthlyRev = money(monthlyVol * rng.float(5, 10) * 12)
    opportunities.push({
      opportunity_id: `OPP-${pad(i + 1)}`,
      customer_id: stage === 'Closed Won' && i < customers.length ? customers[i].customer_id : null,
      prospect_name:
        stage === 'Closed Won' && i < customers.length
          ? customers[i].customer_name
          : `Prospect ${String.fromCharCode(65 + (i % 26))}${i}`,
      stage,
      opportunity_value: value,
      win_probability: winProb,
      expected_start_date: periods[Math.min(periods.length - 1, rng.int(6, 11))] + '-01',
      expected_monthly_volume: monthlyVol,
      expected_monthly_revenue: money(monthlyRev / 12),
      created_date: periods[rng.int(0, 5)] + '-10',
      closed_date: stage.startsWith('Closed') ? periods[rng.int(3, 8)] + '-20' : null,
      sales_cycle_days: stage.startsWith('Closed') ? rng.int(30, 180) : null,
      synthetic: true,
    })
  }

  // Cohort stage history (ordered) — used for true conversion rates, not stock ratios
  const opportunityStageEvents: FactOpportunityStageEvent[] = []
  let stageEventSeq = 1
  const stagePath: OpportunityStage[] = ['Lead', 'Qualified', 'Proposal', 'Negotiation']
  opportunities.forEach((opp) => {
    const created = new Date(opp.created_date)
    let cursor = new Date(created)
    let prev: OpportunityStage | null = null
    const terminal = opp.stage.startsWith('Closed') ? opp.stage : opp.stage
    const pathIndex = stagePath.indexOf(terminal as OpportunityStage)
    const walkTo =
      pathIndex >= 0 ? stagePath.slice(0, pathIndex + 1) : [...stagePath, terminal as OpportunityStage]
    const uniqueWalk = [...new Set(walkTo)]
    uniqueWalk.forEach((toStage, idx) => {
      if (idx > 0) cursor.setDate(cursor.getDate() + rng.int(7, 35))
      opportunityStageEvents.push({
        event_id: `OSE-${pad(stageEventSeq++)}`,
        opportunity_id: opp.opportunity_id,
        from_stage: prev,
        to_stage: toStage,
        event_date: cursor.toISOString().slice(0, 10),
        synthetic: true,
      })
      prev = toStage
    })
    if (opp.stage === 'Closed Won' || opp.stage === 'Closed Lost') {
      cursor.setDate(cursor.getDate() + rng.int(5, 40))
      opportunityStageEvents.push({
        event_id: `OSE-${pad(stageEventSeq++)}`,
        opportunity_id: opp.opportunity_id,
        from_stage: prev,
        to_stage: opp.stage,
        event_date: (opp.closed_date ?? cursor.toISOString().slice(0, 10)),
        synthetic: true,
      })
    }
  })

  // --- Shipments, Billing, Invoices, Rev Rec, Costs ---
  const shipments: FactShipment[] = []
  const billingLines: FactBillingLine[] = []
  const invoices: FactInvoice[] = []
  const creditMemos: FactCreditMemo[] = []
  const payments: FactPayment[] = []
  const revenueRecognition: FactRevenueRecognition[] = []
  const generalLedger: FactGeneralLedger[] = []
  const costs: FactCost[] = []
  const exceptions: FactException[] = []

  let shipSeq = 1
  let billSeq = 1
  let invSeq = 1
  let creditSeq = 1
  let paySeq = 1
  let revSeq = 1
  let glSeq = 1
  let costSeq = 1
  let excSeq = 1

  // Track for exception injection
  const missingBillingShipments: FactShipment[] = []
  const rateMismatchBilling: FactBillingLine[] = []
  /** Volume share basis for fixed-cost allocation: customer_id|period → shipment count */
  const volumeByCustomerPeriod = new Map<string, number>()

  customers.forEach((cust, ci) => {
    const seed = CUSTOMER_SEED[ci]
    const contract = contracts.find((c) => c.customer_id === cust.customer_id)!
    const monthlyVolumeCounter: Record<string, number> = {}

    periods.forEach((period, pi) => {
      const [yStr, mStr] = period.split('-')
      const year = Number(yStr)
      const month = Number(mStr)
      const trendFactor =
        seed.trend === 'growing'
          ? 1 + pi * 0.035
          : seed.trend === 'declining'
            ? 1 - pi * 0.04
            : seed.trend === 'at_risk'
              ? 1 - pi * 0.055
              : 1 + Math.sin(pi / 3) * 0.03
      const volume = Math.max(
        8,
        Math.round(seed.baseVolume * seasonality(month) * trendFactor * rng.float(0.92, 1.08)),
      )
      monthlyVolumeCounter[period] = 0
      volumeByCustomerPeriod.set(`${cust.customer_id}|${period}`, volume)

      const periodBilling: FactBillingLine[] = []
      const periodShipments: FactShipment[] = []

      for (let s = 0; s < volume; s++) {
        const day = rng.int(1, daysInMonth(year, month))
        const shipDate = `${period}-${String(day).padStart(2, '0')}`
        const service = rng.pick(SERVICES)
        const zone = rng.int(1, regions.find((r) => r.region === cust.region)!.zone_count)
        const metro = rng.pick(METROS[cust.region])
        const weight = money(rng.float(0.5, 25))
        const isRemote = rng.chance(seed.deliveryStress > 1.5 ? 0.22 : 0.12)
        const failP = Math.min(0.18, 0.028 * seed.deliveryStress)
        const failed = rng.chance(failP)
        const returned = failed && rng.chance(0.25)
        const isRedelivery = !failed && rng.chance(0.03 * seed.deliveryStress)
        const firstAttemptSuccess = !failed && !isRedelivery && rng.chance(0.97 / Math.sqrt(seed.deliveryStress))
        const onTime =
          !failed &&
          rng.chance(seed.deliveryStress > 1.8 ? 0.82 : seed.deliveryStress > 1.2 ? 0.9 : 0.96)
        const dsp = rng.pick(DSPS)
        const shipmentId = `SHP-${pad(shipSeq++, 6)}`
        const billable = !failed || rng.chance(0.55) // some failed still billable per contract

        let operational_status: FactShipment['operational_status'] = 'Delivered'
        if (returned) operational_status = 'Returned'
        else if (failed) operational_status = rng.chance(0.7) ? 'Failed' : 'Out for Delivery'
        else if (rng.chance(0.02)) operational_status = 'Sorted'
        else if (rng.chance(0.03)) operational_status = 'Out for Delivery'
        else operational_status = 'Delivered'

        const shipment: FactShipment = {
          shipment_id: shipmentId,
          customer_id: cust.customer_id,
          contract_id: contract.contract_id,
          service_type: service,
          region: cust.region,
          metro,
          zone,
          weight_lbs: weight,
          ship_date: shipDate,
          delivery_date: failed
            ? null
            : `${period}-${String(Math.min(daysInMonth(year, month), day + rng.int(0, 3))).padStart(2, '0')}`,
          delivery_status: returned ? 'Returned' : failed ? 'Failed' : 'Delivered',
          operational_status,
          first_attempt_success: firstAttemptSuccess,
          on_time: onTime,
          is_remote: isRemote,
          is_redelivery: isRedelivery,
          dsp_id: dsp,
          billable,
          synthetic: true,
        }
        shipments.push(shipment)
        periodShipments.push(shipment)

        // Costs
        const regionCost = regions.find((r) => r.region === cust.region)!.avg_dsp_cost
        const svcCostMult =
          service === 'SameDay' ? 1.8 : service === 'Express' ? 1.35 : service === 'Economy' ? 0.85 : 1
        const dspCost = money(
          regionCost * svcCostMult * seed.costStress * rng.float(0.9, 1.15) + (isRemote ? 1.2 : 0),
        )
        costs.push({
          cost_id: `CST-${pad(costSeq++)}`,
          shipment_id: shipmentId,
          customer_id: cust.customer_id,
          region: cust.region,
          service_type: service,
          dsp_id: dsp,
          cost_date: shipDate,
          accounting_period: period,
          cost_type: 'DSP Delivery',
          amount: dspCost,
          synthetic: true,
        })
        costs.push({
          cost_id: `CST-${pad(costSeq++)}`,
          shipment_id: shipmentId,
          customer_id: cust.customer_id,
          region: cust.region,
          service_type: service,
          dsp_id: null,
          cost_date: shipDate,
          accounting_period: period,
          cost_type: 'Sorting',
          amount: money(rng.float(0.25, 0.55)),
          synthetic: true,
        })
        if (rng.chance(0.4)) {
          costs.push({
            cost_id: `CST-${pad(costSeq++)}`,
            shipment_id: shipmentId,
            customer_id: cust.customer_id,
            region: cust.region,
            service_type: service,
            dsp_id: null,
            cost_date: shipDate,
            accounting_period: period,
            cost_type: 'Linehaul',
            amount: money(rng.float(0.4, 1.2)),
            synthetic: true,
          })
        }
        if (isRedelivery) {
          costs.push({
            cost_id: `CST-${pad(costSeq++)}`,
            shipment_id: shipmentId,
            customer_id: cust.customer_id,
            region: cust.region,
            service_type: service,
            dsp_id: dsp,
            cost_date: shipDate,
            accounting_period: period,
            cost_type: 'Redelivery',
            amount: money(dspCost * 0.7),
            synthetic: true,
          })
        }
        if (failed && rng.chance(0.3)) {
          costs.push({
            cost_id: `CST-${pad(costSeq++)}`,
            shipment_id: shipmentId,
            customer_id: cust.customer_id,
            region: cust.region,
            service_type: service,
            dsp_id: null,
            cost_date: shipDate,
            accounting_period: period,
            cost_type: 'Claims',
            amount: money(rng.float(8, 45)),
            synthetic: true,
          })
        }

        // Billing — inject ~1.5% missing billing
        const skipBilling = billable && rng.chance(0.015)
        if (skipBilling) {
          missingBillingShipments.push(shipment)
          continue
        }
        if (!billable) continue

        monthlyVolumeCounter[period]++
        const card = findRateCard(rateCards, contract.contract_id, service, cust.region, shipDate)
        const priced = priceShipment(
          card,
          weight,
          zone,
          isRemote,
          monthlyVolumeCounter[period],
        )
        let credits = 0
        if (failed || rng.chance(0.02)) {
          credits = money(priced.base * rng.float(0.2, 1))
        }

        // Inject rate mismatch ~1%
        let baseCharge = priced.base
        const mismatch = rng.chance(0.01)
        if (mismatch) {
          baseCharge = money(priced.base * rng.float(0.85, 0.95))
        }

        // Missing surcharge ~0.8%
        const dropFuel = rng.chance(0.008)
        const fuel = dropFuel ? 0 : priced.fuel

        const net = money(baseCharge + fuel + priced.remote - priced.discount - credits)
        const billingLineId = `BIL-${pad(billSeq++, 6)}`
        const line: FactBillingLine = {
          billing_line_id: billingLineId,
          shipment_id: shipmentId,
          customer_id: cust.customer_id,
          contract_id: contract.contract_id,
          invoice_id: null, // set later
          service_type: service,
          region: cust.region,
          billing_date: shipDate,
          accounting_period: period,
          base_charge: baseCharge,
          fuel_surcharge: fuel,
          remote_surcharge: priced.remote,
          discounts: priced.discount,
          credits,
          net_amount: net,
          rate_card_id: card.rate_card_id,
          is_duplicate: false,
          synthetic: true,
        }
        billingLines.push(line)
        periodBilling.push(line)
        if (mismatch) rateMismatchBilling.push(line)

        if (dropFuel) {
          exceptions.push({
            exception_id: `EXC-${pad(excSeq++)}`,
            exception_type: 'Missing Surcharge',
            customer_id: cust.customer_id,
            shipment_id: shipmentId,
            invoice_id: null,
            billing_line_id: billingLineId,
            expected_amount: priced.fuel,
            actual_amount: 0,
            difference: priced.fuel,
            severity: priced.fuel > 1 ? 'Medium' : 'Low',
            root_cause: 'Fuel surcharge omitted during rating',
            trigger_rule: 'IF contract.fuel_surcharge_pct > 0 AND billing.fuel_surcharge = 0 THEN Missing Surcharge',
            owner: 'Billing',
            status: rng.pick(['Open', 'Investigating', 'Resolved']),
            resolution_notes: '',
            recommended_action: 'Re-rate shipment and issue debit memo',
            detected_date: shipDate,
            financial_impact: priced.fuel,
            synthetic: true,
          })
        }
      }

      // Duplicate billing injection (~0.5% of lines, max 2/customer/period)
      if (periodBilling.length > 10 && rng.chance(0.35)) {
        const orig = rng.pick(periodBilling)
        const dup: FactBillingLine = {
          ...orig,
          billing_line_id: `BIL-${pad(billSeq++, 6)}`,
          is_duplicate: true,
        }
        billingLines.push(dup)
        exceptions.push({
          exception_id: `EXC-${pad(excSeq++)}`,
          exception_type: 'Duplicate Billing',
          customer_id: cust.customer_id,
          shipment_id: orig.shipment_id,
          invoice_id: null,
          billing_line_id: dup.billing_line_id,
          expected_amount: orig.net_amount,
          actual_amount: money(orig.net_amount * 2),
          difference: orig.net_amount,
          severity: 'High',
          root_cause: 'Shipment rated twice in billing engine',
          trigger_rule: 'IF COUNT(billing_line WHERE shipment_id=X) > 1 THEN Duplicate Billing',
          owner: 'Billing',
          status: rng.pick(['Open', 'Investigating']),
          resolution_notes: '',
          recommended_action: 'Void duplicate line and credit customer',
          detected_date: `${period}-28`,
          financial_impact: orig.net_amount,
          synthetic: true,
        })
      }

      // Invoice for period (non-duplicate lines only)
      const invoiceable = periodBilling.filter((b) => !b.is_duplicate)
      if (invoiceable.length === 0) return

      const gross = sumMoney(invoiceable.map((b) => b.base_charge + b.fuel_surcharge + b.remote_surcharge))
      const lineCredits = sumMoney(invoiceable.map((b) => b.credits + b.discounts))
      let creditMemoAmt = 0
      if (rng.chance(0.15)) {
        creditMemoAmt = money(rng.float(50, 400))
      }
      const netInvoice = money(gross - lineCredits - creditMemoAmt)
      const invoiceId = `INV-${pad(invSeq++)}`
      const invoiceDate = `${period}-${String(daysInMonth(year, month)).padStart(2, '0')}`
      const dueDay = new Date(year, month - 1, daysInMonth(year, month))
      dueDay.setDate(dueDay.getDate() + contract.payment_terms_days)
      const dueDate = dueDay.toISOString().slice(0, 10)
      const overdue = dueDate < '2025-11-01' && rng.chance(seed.paymentRisk)
      const paid = !overdue && rng.chance(0.75)
      const partial = !paid && !overdue && rng.chance(0.3)

      const invoice: FactInvoice = {
        invoice_id: invoiceId,
        customer_id: cust.customer_id,
        invoice_date: invoiceDate,
        accounting_period: period,
        gross_amount: money(gross),
        credit_amount: money(lineCredits + creditMemoAmt),
        net_amount: netInvoice,
        status: paid ? 'Paid' : overdue ? 'Overdue' : partial ? 'Partial' : 'Issued',
        due_date: dueDate,
        synthetic: true,
      }
      invoices.push(invoice)
      invoiceable.forEach((b) => {
        b.invoice_id = invoiceId
      })

      if (creditMemoAmt > 0) {
        creditMemos.push({
          credit_memo_id: `CRM-${pad(creditSeq++)}`,
          customer_id: cust.customer_id,
          invoice_id: invoiceId,
          shipment_id: rng.pick(periodShipments).shipment_id,
          credit_date: invoiceDate,
          accounting_period: period,
          amount: creditMemoAmt,
          reason: rng.pick(['SLA miss credit', 'Damaged package', 'Billing adjustment', 'Goodwill']),
          synthetic: true,
        })
      }

      // Payments
      if (paid || partial) {
        const payAmt = paid ? netInvoice : money(netInvoice * rng.float(0.3, 0.7))
        payments.push({
          payment_id: `PAY-${pad(paySeq++)}`,
          customer_id: cust.customer_id,
          invoice_id: invoiceId,
          payment_date: `${period}-${String(Math.min(daysInMonth(year, month), 28)).padStart(2, '0')}`,
          amount: payAmt,
          method: rng.pick(['ACH', 'Wire', 'Check', 'Card']),
          synthetic: true,
        })
      }

      if (overdue) {
        exceptions.push({
          exception_id: `EXC-${pad(excSeq++)}`,
          exception_type: 'Overdue AR',
          customer_id: cust.customer_id,
          shipment_id: null,
          invoice_id: invoiceId,
          billing_line_id: null,
          expected_amount: netInvoice,
          actual_amount: 0,
          difference: netInvoice,
          severity: netInvoice > 5000 ? 'Critical' : 'High',
          root_cause: 'Invoice past due date with no full payment',
          trigger_rule: 'IF invoice.due_date < today AND status NOT IN (Paid) THEN Overdue AR',
          owner: 'Finance',
          status: 'Open',
          resolution_notes: '',
          recommended_action: 'Collections outreach; review credit hold',
          detected_date: invoiceDate,
          financial_impact: netInvoice,
          synthetic: true,
        })
      }

      // Revenue recognition — mostly aligns to invoice; small accrual timing differences
      const timingShift = rng.chance(0.08)
      const recogPeriod = timingShift && pi < periods.length - 1 ? periods[pi + 1] : period
      const recogAmt = timingShift ? money(netInvoice * 0.92) : netInvoice
      const revRecId = `REV-${pad(revSeq++)}`
      revenueRecognition.push({
        rev_rec_id: revRecId,
        customer_id: cust.customer_id,
        invoice_id: invoiceId,
        billing_line_id: null,
        shipment_id: null,
        recognition_date: `${recogPeriod}-28`,
        accounting_period: recogPeriod,
        amount: recogAmt,
        recognition_type: timingShift ? 'Accrual' : 'Invoice',
        gl_account: '4000-Delivery-Revenue',
        synthetic: true,
      })

      // Also create shipment-linked rev rec detail for traceability (allocated)
      const allocBase = sumMoney(invoiceable.map((b) => b.net_amount))
      invoiceable.forEach((b) => {
        const share = allocBase === 0 ? 0 : money((b.net_amount / allocBase) * recogAmt)
        revenueRecognition.push({
          rev_rec_id: `REV-${pad(revSeq++)}`,
          customer_id: cust.customer_id,
          invoice_id: invoiceId,
          billing_line_id: b.billing_line_id,
          shipment_id: b.shipment_id,
          recognition_date: `${recogPeriod}-28`,
          accounting_period: recogPeriod,
          amount: share,
          recognition_type: timingShift ? 'Accrual' : 'Invoice',
          gl_account: '4000-Delivery-Revenue',
          synthetic: true,
        })
      })

      // GL entry matching header rev rec
      generalLedger.push({
        gl_entry_id: `GL-${pad(glSeq++)}`,
        accounting_period: recogPeriod,
        entry_date: `${recogPeriod}-28`,
        account_code: '4000',
        account_name: 'Delivery Revenue',
        debit: 0,
        credit: recogAmt,
        customer_id: cust.customer_id,
        rev_rec_id: revRecId,
        invoice_id: invoiceId,
        description: `Recognize revenue ${invoiceId}`,
        synthetic: true,
      })
      generalLedger.push({
        gl_entry_id: `GL-${pad(glSeq++)}`,
        accounting_period: recogPeriod,
        entry_date: `${recogPeriod}-28`,
        account_code: '1100',
        account_name: 'Accounts Receivable',
        debit: recogAmt,
        credit: 0,
        customer_id: cust.customer_id,
        rev_rec_id: revRecId,
        invoice_id: invoiceId,
        description: `AR for ${invoiceId}`,
        synthetic: true,
      })

      if (timingShift) {
        exceptions.push({
          exception_id: `EXC-${pad(excSeq++)}`,
          exception_type: 'Timing Difference',
          customer_id: cust.customer_id,
          shipment_id: null,
          invoice_id: invoiceId,
          billing_line_id: null,
          expected_amount: netInvoice,
          actual_amount: recogAmt,
          difference: money(netInvoice - recogAmt),
          severity: 'Low',
          root_cause: 'Accounting cut-off; partial accrual into next period',
          trigger_rule: 'IF invoice.period <> rev_rec.period THEN Timing Difference',
          owner: 'Finance',
          status: 'Accepted',
          resolution_notes: 'Expected cut-off difference',
          recommended_action: 'Monitor; no billing action required',
          detected_date: invoiceDate,
          financial_impact: money(Math.abs(netInvoice - recogAmt)),
          synthetic: true,
        })
      }

    })

    // Volume decline exception for declining/at_risk
    if (seed.trend === 'declining' || seed.trend === 'at_risk') {
      const recent = periods.slice(-2)
      const vols = recent.map(
        (p) => shipments.filter((s) => s.customer_id === cust.customer_id && s.ship_date.startsWith(p)).length,
      )
      if (vols[0] > 0 && vols[1] < vols[0] * 0.85) {
        const impact = money((vols[0] - vols[1]) * seed.baseRate)
        exceptions.push({
          exception_id: `EXC-${pad(excSeq++)}`,
          exception_type: 'Volume Decline',
          customer_id: cust.customer_id,
          shipment_id: null,
          invoice_id: null,
          billing_line_id: null,
          expected_amount: money(vols[0] * seed.baseRate),
          actual_amount: money(vols[1] * seed.baseRate),
          difference: impact,
          severity: seed.trend === 'at_risk' ? 'Critical' : 'High',
          root_cause: 'MoM shipment volume decline >15%',
          trigger_rule: 'IF volume_t / volume_t-1 < 0.85 THEN Volume Decline',
          owner: 'Sales',
          status: 'Open',
          resolution_notes: '',
          recommended_action: 'Account review; confirm share-of-wallet and service issues',
          detected_date: `${periods[periods.length - 1]}-25`,
          financial_impact: impact,
          synthetic: true,
        })
      }
    }
  })

  // Allocate company fixed opex pool by shipment volume share (transparent basis)
  periods.forEach((period) => {
    let periodTotalVol = 0
    customers.forEach((cust) => {
      periodTotalVol += volumeByCustomerPeriod.get(`${cust.customer_id}|${period}`) ?? 0
    })
    if (periodTotalVol === 0) return
    customers.forEach((cust) => {
      const vol = volumeByCustomerPeriod.get(`${cust.customer_id}|${period}`) ?? 0
      const share = vol / periodTotalVol
      const amount = money(MONTHLY_FIXED_OPEX_POOL_BASE * share)
      if (amount <= 0) return
      costs.push({
        cost_id: `CST-${pad(costSeq++)}`,
        shipment_id: null,
        customer_id: cust.customer_id,
        region: cust.region,
        service_type: null,
        dsp_id: null,
        cost_date: `${period}-28`,
        accounting_period: period,
        cost_type: 'Allocated Fixed',
        amount,
        synthetic: true,
      })
    })
  })

  // Missing billing exceptions
  missingBillingShipments.forEach((s) => {
    const card = findRateCard(rateCards, s.contract_id, s.service_type, s.region, s.ship_date)
    const priced = priceShipment(card, s.weight_lbs, s.zone, s.is_remote, 0)
    const expected = money(priced.base + priced.fuel + priced.remote - priced.discount)
    exceptions.push({
      exception_id: `EXC-${pad(excSeq++)}`,
      exception_type: 'Missing Billing',
      customer_id: s.customer_id,
      shipment_id: s.shipment_id,
      invoice_id: null,
      billing_line_id: null,
      expected_amount: expected,
      actual_amount: 0,
      difference: expected,
      severity: expected > 15 ? 'High' : 'Medium',
      root_cause: 'Billable shipment has no billing line',
      trigger_rule: 'IF shipment.billable=true AND NOT EXISTS billing_line THEN Missing Billing',
      owner: 'Billing',
      status: rng.pick(['Open', 'Investigating']),
      resolution_notes: '',
      recommended_action: 'Create billing line from rate card and include in next invoice cycle',
      detected_date: s.ship_date,
      financial_impact: expected,
      synthetic: true,
    })
  })

  // Rate mismatch exceptions
  rateMismatchBilling.forEach((b) => {
    const card = rateCards.find((c) => c.rate_card_id === b.rate_card_id)!
    const shipment = shipments.find((s) => s.shipment_id === b.shipment_id)!
    const expected = priceShipment(card, shipment.weight_lbs, shipment.zone, shipment.is_remote, 50)
    exceptions.push({
      exception_id: `EXC-${pad(excSeq++)}`,
      exception_type: 'Rate Mismatch',
      customer_id: b.customer_id,
      shipment_id: b.shipment_id,
      invoice_id: b.invoice_id,
      billing_line_id: b.billing_line_id,
      expected_amount: expected.base,
      actual_amount: b.base_charge,
      difference: money(expected.base - b.base_charge),
      severity: 'High',
      root_cause: 'Billed base rate differs from effective contract rate card',
      trigger_rule: 'IF ABS(billed_base - contract_base) / contract_base > 0.02 THEN Rate Mismatch',
      owner: 'Pricing',
      status: rng.pick(['Open', 'Investigating', 'Resolved']),
      resolution_notes: '',
      recommended_action: 'Re-price using effective rate card version; issue adjustment',
      detected_date: b.billing_date,
      financial_impact: money(Math.abs(expected.base - b.base_charge)),
      synthetic: true,
    })
  })

  // High risk customer exceptions
  CUSTOMER_SEED.forEach((seed, i) => {
    if (seed.trend !== 'at_risk') return
    const cust = customers[i]
    const last3 = periods.slice(-3)
    const rev = sumMoney(
      revenueRecognition
        .filter(
          (r) =>
            r.customer_id === cust.customer_id &&
            last3.includes(r.accounting_period) &&
            r.billing_line_id === null,
        )
        .map((r) => r.amount),
    )
    exceptions.push({
      exception_id: `EXC-${pad(excSeq++)}`,
      exception_type: 'High Risk Customer',
      customer_id: cust.customer_id,
      shipment_id: null,
      invoice_id: null,
      billing_line_id: null,
      expected_amount: rev,
      actual_amount: money(rev * 0.6),
      difference: money(rev * 0.4),
      severity: 'Critical',
      root_cause: 'Composite health signals: volume decline, payment risk, margin pressure',
      trigger_rule: 'IF health_score < 45 OR trend=at_risk THEN High Risk Customer',
      owner: 'Sales',
      status: 'Open',
      resolution_notes: '',
      recommended_action: 'Executive QBR; retention offer; service recovery plan',
      detected_date: `${periods[periods.length - 1]}-20`,
      financial_impact: money(rev * 0.4),
      synthetic: true,
    })
  })

  // --- Forecasts (Base/Upside/Downside) for next 3 months beyond last period ---
  const forecasts: FactForecast[] = []
  let fcSeq = 1
  const lastPeriod = periods[periods.length - 1]
  const [ly, lm] = lastPeriod.split('-').map(Number)
  const futurePeriods: string[] = []
  for (let i = 1; i <= 3; i++) {
    const d = new Date(ly, lm - 1 + i, 1)
    futurePeriods.push(periodLabel(d.getFullYear(), d.getMonth() + 1))
  }
  // Also store historical "as-of" forecasts for evaluation on last 3 actual months
  const evalPeriods = periods.slice(-3)

  const scenarios: Array<{ name: 'Base' | 'Upside' | 'Downside'; vol: number; rate: number; credit: number }> = [
    { name: 'Base', vol: 1.0, rate: 1.0, credit: 1.0 },
    { name: 'Upside', vol: 1.08, rate: 1.03, credit: 0.85 },
    { name: 'Downside', vol: 0.9, rate: 0.97, credit: 1.2 },
  ]

  const allForecastPeriods = [...evalPeriods, ...futurePeriods]
  customers.forEach((cust, ci) => {
    const seed = CUSTOMER_SEED[ci]
    allForecastPeriods.forEach((fp) => {
      const histPeriod = periods.includes(fp)
        ? fp
        : lastPeriod
      const histLines = billingLines.filter(
        (b) =>
          b.customer_id === cust.customer_id &&
          b.accounting_period === (periods.includes(fp) ? addMonthsPeriod(fp, -1) : histPeriod) &&
          !b.is_duplicate,
      )
      const histVol = histLines.length || Math.round(seed.baseVolume * 0.9)
      const histRev = sumMoney(histLines.map((b) => b.net_amount)) || money(seed.baseVolume * seed.baseRate)
      const avgRate = histVol ? money(histRev / histVol) : seed.baseRate

      scenarios.forEach((sc) => {
        const churnHaircut = seed.trend === 'at_risk' ? (sc.name === 'Downside' ? 0.75 : 0.9) : 1
        const vol = Math.round(histVol * sc.vol * churnHaircut)
        const rate = money(avgRate * sc.rate)
        const surcharges = money(vol * rate * 0.1)
        const credits = money(vol * rate * 0.03 * sc.credit)
        const net = money(vol * rate + surcharges - credits)
        forecasts.push({
          forecast_id: `FC-${pad(fcSeq++)}`,
          customer_id: cust.customer_id,
          accounting_period: fp,
          scenario: sc.name,
          forecast_type: 'Existing',
          forecast_volume: vol,
          forecast_avg_rate: rate,
          forecast_surcharges: surcharges,
          forecast_credits: credits,
          forecast_net_billing: net,
          forecast_recognized: money(net * 0.98),
          synthetic: true,
        })
      })
    })
  })

  // Pipeline forecast: new-logo activation for recent history + forward horizon
  // (does not include existing customers — avoids double count)
  const pipelinePeriods = [...evalPeriods, ...futurePeriods]
  pipelinePeriods.forEach((fp, idx) => {
    const isFuture = futurePeriods.includes(fp)
    // Historical: ramping activations; Future: fuller weighted pipeline conversion
    const ramp = isFuture ? 1 : 0.35 + idx * 0.15
    scenarios.forEach((sc) => {
      const openOpps = opportunities.filter((o) => !o.stage.startsWith('Closed'))
      const weighted = sumMoney(
        openOpps.map((o) =>
          money(
            o.expected_monthly_revenue *
              o.win_probability *
              ramp *
              (sc.name === 'Upside' ? 1.15 : sc.name === 'Downside' ? 0.7 : 1),
          ),
        ),
      )
      // Plus synthetic new-logo activations not yet in CRM opportunities
      const activationBump = money(
        (isFuture ? 45_000 : 18_000) *
          (sc.name === 'Upside' ? 1.2 : sc.name === 'Downside' ? 0.65 : 1) *
          ramp,
      )
      const total = money(weighted + activationBump)
      forecasts.push({
        forecast_id: `FC-${pad(fcSeq++)}`,
        customer_id: null,
        accounting_period: fp,
        scenario: sc.name,
        forecast_type: 'Pipeline',
        forecast_volume: Math.round(total / 7),
        forecast_avg_rate: 7,
        forecast_surcharges: money(total * 0.08),
        forecast_credits: money(total * 0.02),
        forecast_net_billing: total,
        forecast_recognized: money(total * 0.9),
        synthetic: true,
      })
    })
  })

  return {
    meta: {
      generated_at: generatedAt,
      seed,
      snapshot_label: 'Synthetic Snapshot FY25-Q4 Preview',
      is_synthetic: true,
      disclaimer:
        'All data is synthetic and for demonstration only. Not affiliated with or sourced from any real carrier.',
      fixed_opex_pool_monthly_base: MONTHLY_FIXED_OPEX_POOL_BASE,
      fixed_opex_pool_monthly_downside: MONTHLY_FIXED_OPEX_POOL_DOWNSIDE,
      fixed_opex_basis:
        'Allocated by shipment volume share of company monthly pool. Filter uses pre-computed shares against company denominator (not re-pooled to segment).',
    },
    customers,
    contracts,
    rateCards,
    regions,
    services,
    dates,
    opportunities,
    opportunityStageEvents,
    shipments,
    billingLines,
    invoices,
    creditMemos,
    payments,
    revenueRecognition,
    generalLedger,
    costs,
    forecasts,
    exceptions,
  }
}

function addMonthsPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

let _cache: DataStore | null = null

export function getDataStore(): DataStore {
  if (!_cache) _cache = generateDataStore()
  return _cache
}

export function resetDataStore(seed?: number): DataStore {
  _cache = generateDataStore(seed)
  return _cache
}
