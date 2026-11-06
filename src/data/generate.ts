/**
 * Synthetic Last-Mile RevOps data generator — v3 (25 months, ~1.2M packages/month at Oct 2026).
 *
 * Grain: a FactShipment row is a *shipment lot* — the packages of one bill-to customer shipped
 * through one station, for one brand, service and delivery outcome in a month. `package_count`
 * carries the volume, so the full network is represented exactly (no sampling) at a size the browser
 * can hold. Billing lines, costs, recognition and exceptions all link to lots, keeping
 * Contract → Rate Card → Lot → Billing Line → Invoice → Recognition → GL traceable end to end.
 *
 * Deterministic: fixed seed + stable hashing; no wall-clock dependence except `generated_at`.
 * All business entities are synthetic. Public brand names are illustrative accounts only.
 */
import type {
  DataStore,
  DimBrand,
  DimContract,
  DimCustomer,
  DimDate,
  DimDsp,
  DimRateCard,
  DimRegion,
  DimService,
  DimStation,
  ExceptionSeverity,
  ExceptionStatus,
  ExceptionType,
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
  ResponsibleTeam,
  ServiceType,
} from '@/types'
import { buildRateCardIndex, rateLot } from '@/lib/pricing'
import {
  ACCOUNT_OWNERS,
  customerSpecs,
  PROSPECT_NAMES,
  seasonality,
  SERVICE_MIX,
  type CustomerSpec,
  type Industry,
} from './catalog'
import { METRO_DEFINITIONS, REGIONS, type MetroDefinition } from './metros'
import { SeededRng } from './rng'

const SEED = 20261031
export const HISTORY_START = '2024-10'
export const HISTORY_END = '2026-10'
export const AS_OF_DATE = '2026-11-05'
const FORECAST_END = '2027-01'
/** Calibration target, not a hard-coded KPI: volumes are scaled so planned Oct-2026 demand ≈ 1.2M */
const TARGET_OCT_2026_PACKAGES = 1_200_000

/** Reference monthly fixed pool (stations + corporate, Oct 2026) — Unit Economics downside stress uses the ratio */
export const MONTHLY_FIXED_OPEX_POOL_BASE = 1_000_000
export const MONTHLY_FIXED_OPEX_POOL_DOWNSIDE = 1_300_000

const SERVICES: ServiceType[] = ['Standard', 'Express', 'SameDay', 'Economy']
/** Target list base per package (incl. avg weight & zone) before tier discount / fuel */
const SERVICE_BASE: Record<ServiceType, number> = { Economy: 3.2, Standard: 4.3, Express: 6.6, SameDay: 9.4 }
const SERVICE_WEIGHT: Record<ServiceType, number> = { Economy: 4.6, Standard: 3.6, Express: 3.0, SameDay: 2.3 }
const DSP_SERVICE_MULT: Record<ServiceType, number> = { Economy: 0.88, Standard: 1, Express: 1.22, SameDay: 1.95 }
const LINEHAUL_SERVICE_MULT: Record<ServiceType, number> = { Economy: 0.85, Standard: 1, Express: 1.35, SameDay: 0.55 }
const DSP_NAMES = [
  'Swift Route', 'Blue Lane', 'Metro Wheels', 'Last Mile Pros', 'Northstar Couriers', 'Velocity Van',
  'Parcel Pilots', 'Orbit Delivery', 'Summit Couriers', 'Harbor Haul', 'Keystone Courier', 'Redline Routes',
]

const r2 = (v: number) => Math.round(v * 100) / 100

function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
function pad(n: number, width = 4): string {
  return String(n).padStart(width, '0')
}
function addMonths(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function monthIndex(period: string): number {
  const [y, m] = period.split('-').map(Number)
  const [sy, sm] = HISTORY_START.split('-').map(Number)
  return (y - sy) * 12 + (m - sm)
}
function daysIn(period: string): number {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
}
function monthEnd(period: string): string {
  return `${period}-${String(daysIn(period)).padStart(2, '0')}`
}
function periodsFrom(start: string, end: string): string[] {
  const out: string[] = []
  for (let p = start; p <= end; p = addMonths(p, 1)) out.push(p)
  return out
}
function metroCode(metro: string): string {
  const base = metro.replace(/Metro|Area|–.*$/g, '').trim().replace(/[^A-Za-z ]/g, '')
  const words = base.split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words.map((w) => w[0]).join('') : base.slice(0, 3)).toUpperCase().padEnd(3, 'X').slice(0, 3)
}

interface CustomerPlan {
  spec: CustomerSpec
  customer: DimCustomer
  activationIdx: number
  churnIdx: number | null
  growth: number
  noise: number
  deliveryStress: number
  paymentRisk: number
  priceTier: number
  billFailed: boolean
  metroWeights: { metro: MetroDefinition; weight: number }[]
  serviceShares: { service: ServiceType; share: number }[]
  brandIds: string[]
  scale: number
}

export function generateDataStore(seed = SEED): DataStore {
  const rng = new SeededRng(seed)
  const generatedAt = new Date().toISOString()
  const periods = periodsFrom(HISTORY_START, HISTORY_END)
  const lastIdx = periods.length - 1

  // ---------------------------------------------------------------- dimensions
  const regions: DimRegion[] = REGIONS.map((region) => ({
    region,
    zone_count: 8,
    avg_dsp_cost: r2(
      METRO_DEFINITIONS.filter((m) => m.region === region).reduce((a, m) => a + 2.55 * m.cost_index, 0) /
        Math.max(1, METRO_DEFINITIONS.filter((m) => m.region === region).length),
    ),
    synthetic: true,
  }))
  const services: DimService[] = [
    { service_type: 'Standard', description: '2–3 day last-mile delivery', sla_hours: 72 },
    { service_type: 'Express', description: 'Next-day delivery', sla_hours: 24 },
    { service_type: 'SameDay', description: 'Same-day metro delivery', sla_hours: 8 },
    { service_type: 'Economy', description: 'Economy multi-day delivery', sla_hours: 120 },
  ]
  const dates: DimDate[] = periods.map((p) => {
    const [y, m] = p.split('-').map(Number)
    return {
      date_key: `${p}-01`,
      year: y,
      month: m,
      quarter: Math.ceil(m / 3),
      month_label: new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      is_month_end: true,
      synthetic: true,
    } as DimDate
  })

  // Network: DSPs and stations per metro
  const dsps: DimDsp[] = []
  const stations: DimStation[] = []
  const stationsByMetro = new Map<string, DimStation[]>()
  let dspSeq = 1
  for (const m of METRO_DEFINITIONS) {
    const code = metroCode(m.metro)
    const metroDsps: DimDsp[] = []
    const nDsp = m.stations >= 3 ? 4 : m.stations === 2 ? 3 : 2
    for (let i = 0; i < nDsp; i++) {
      const d: DimDsp = {
        dsp_id: `DSP-${pad(dspSeq++, 3)}`,
        dsp_name: `${DSP_NAMES[(hash(m.metro) + i * 5) % DSP_NAMES.length]} ${code}`,
        metro: m.metro,
        base_cost_per_stop: r2(2.42 * rng.float(0.94, 1.08)),
        synthetic: true,
      } as DimDsp
      metroDsps.push(d)
      dsps.push(d)
    }
    const nSt = Math.max(1, Math.ceil(m.stations / 2))
    const list: DimStation[] = []
    for (let i = 0; i < nSt; i++) {
      const st: DimStation = {
        station_id: `STN-${code}${i + 1}`,
        station_name: `${m.metro.replace(' Metro', '')} ${['North', 'South', 'East', 'West'][i] ?? `Hub ${i + 1}`} Station`,
        metro: m.metro,
        region: m.region,
        capacity_daily: 0, // sized after demand planning
        // Second stations open later in big metros (network build-out)
        launch_period: i === 0 ? m.launch_period : m.launch_period < '2025-01' ? (i === 1 ? '2025-04' : '2025-10') : addMonths(m.launch_period, 9),
        sort_cost_per_pkg: r2(0.36 * m.cost_index * rng.float(0.92, 1.1)),
        fixed_cost_monthly: 0,
        zip_prefixes: m.zips.filter((_, zi) => zi % nSt === i),
        dsp_ids: metroDsps.filter((_, di) => di % nSt === i || nSt === 1).map((d) => d.dsp_id),
        synthetic: true,
      } as DimStation
      list.push(st)
      stations.push(st)
    }
    stationsByMetro.set(m.metro, list)
  }
  const metroLaunchIdx = new Map(METRO_DEFINITIONS.map((m) => [m.metro, monthIndex(m.launch_period)]))

  // ---------------------------------------------------------------- customers & plans
  const specs = customerSpecs()
  const plans: CustomerPlan[] = []
  const brands: DimBrand[] = []
  let brandSeq = 1
  const parentIds = new Map<string, string>()
  specs.forEach((spec, i) => {
    const id = `CUS-${pad(i + 1)}`
    const prof = spec.profile
    const activationIdx =
      prof === 'new' ? rng.int(3, 21) : -rng.int(6, 40) // months relative to 2024-10
    const churnIdx = prof === 'churn' ? rng.int(6, 20) : null
    const growth =
      prof === 'core' ? rng.float(0.03, 0.12)
        : prof === 'growth' ? rng.float(0.28, 0.55)
          : prof === 'new' ? rng.float(0.08, 0.2)
            : prof === 'declining' ? rng.float(-0.28, -0.12)
              : prof === 'volatile' ? rng.float(-0.05, 0.12)
                : prof === 'at_risk' ? rng.float(0.0, 0.08)
                  : rng.float(-0.1, 0.05)
    const stress =
      prof === 'at_risk' ? rng.float(1.6, 2.2) : prof === 'declining' ? rng.float(1.1, 1.5) : rng.float(0.65, 1.25)
    const paymentRisk =
      (prof === 'at_risk' ? rng.float(0.3, 0.5) : prof === 'declining' ? rng.float(0.12, 0.25) : rng.float(0.02, 0.1)) +
      (spec.segment === 'SMB' ? 0.06 : 0)
    const priceTier = spec.segment === 'Enterprise' ? rng.float(0.92, 0.98) : spec.segment === 'Mid-Market' ? rng.float(0.99, 1.05) : rng.float(1.05, 1.14)

    // Metro footprint: home region first, then by market size
    const nMetros =
      spec.segment === 'Enterprise' ? rng.int(10, 17) + (spec.type === '3PL / Fulfillment' ? 2 : 0) : spec.segment === 'Mid-Market' ? rng.int(3, 6) : rng.int(1, 2)
    const ranked = [...METRO_DEFINITIONS]
      .map((m) => ({ m, score: m.demand * (m.region === spec.homeRegion ? 2.2 : 1) * rng.float(0.6, 1.4) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(METRO_DEFINITIONS.length, nMetros))
    const metroWeights = ranked.map(({ m, score }) => ({ metro: m, weight: score }))

    const mix = SERVICE_MIX[spec.industry as Industry]
    const raw = SERVICES.filter((s) => mix[s]).map((s) => ({ service: s, share: (mix[s] ?? 0) * rng.float(0.75, 1.25) }))
    const tot = raw.reduce((a, x) => a + x.share, 0)
    const serviceShares = raw.map((x) => ({ ...x, share: x.share / tot })).filter((x) => x.share >= 0.06 || spec.segment === 'Enterprise')
    const tot2 = serviceShares.reduce((a, x) => a + x.share, 0)
    serviceShares.forEach((x) => (x.share /= tot2))

    const parentName = spec.parent ?? spec.name
    if (!parentIds.has(parentName)) parentIds.set(parentName, `PAR-${pad(parentIds.size + 1)}`)

    const brandNames = spec.type === '3PL / Fulfillment' ? spec.brands ?? [`${spec.name} Merchant`] : [spec.name]
    const brandIds = brandNames.map((bn) => {
      const b: DimBrand = {
        brand_id: `BRD-${pad(brandSeq++)}`,
        brand_name: bn,
        customer_id: id,
        industry: spec.type === '3PL / Fulfillment' ? 'Merchant (via 3PL)' : spec.industry,
        illustrative: spec.illustrative && spec.type !== '3PL / Fulfillment',
        synthetic: true,
      } as DimBrand
      brands.push(b)
      return b.brand_id
    })

    const activationPeriod = addMonths(HISTORY_START, activationIdx)
    const customer: DimCustomer = {
      customer_id: id,
      customer_name: spec.name,
      industry: spec.industry,
      segment: spec.segment,
      region: spec.homeRegion,
      account_owner: ACCOUNT_OWNERS[hash(spec.name) % ACCOUNT_OWNERS.length],
      status: churnIdx != null ? 'Churned' : 'Active',
      acquired_date: `${activationPeriod}-01`,
      parent_account_id: parentIds.get(parentName)!,
      parent_account_name: parentName,
      customer_type: spec.type,
      illustrative: spec.illustrative,
      activation_date: `${activationPeriod}-01`,
      first_shipment_date: null,
      churn_date: churnIdx != null ? monthEnd(addMonths(HISTORY_START, churnIdx)) : null,
      renewal_date: '',
      lifecycle_status: 'Active',
      expected_monthly_volume: 0,
      contracted_services: serviceShares.map((x) => x.service),
      home_metro: metroWeights[0].metro.metro,
      synthetic: true,
    } as DimCustomer
    plans.push({
      spec,
      customer,
      activationIdx,
      churnIdx,
      growth,
      noise: prof === 'volatile' ? 0.14 : 0.045,
      deliveryStress: stress,
      paymentRisk,
      priceTier,
      billFailed: spec.segment === 'Enterprise' ? rng.chance(0.6) : rng.chance(0.3),
      metroWeights,
      serviceShares,
      brandIds,
      scale: 1,
    })
  })

  /** Relative customer level at month t (1.0 = maturity level at Oct 2026) */
  const levelAt = (p: CustomerPlan, t: number): number => {
    if (t < p.activationIdx) return 0
    if (p.churnIdx != null && t > p.churnIdx) return 0
    let lvl = Math.pow(1 + p.growth, (t - lastIdx) / 12)
    if (p.spec.profile === 'at_risk' && t >= 17) lvl *= Math.pow(0.95, t - 16) // softening from 2026-03
    if (p.spec.profile === 'new') lvl *= Math.min(1, 0.25 + 0.75 * ((t - p.activationIdx + 1) / 5))
    if (p.churnIdx != null) {
      const toChurn = p.churnIdx - t
      if (toChurn < 3) lvl *= 0.55 + toChurn * 0.15 // wind-down before churn
      lvl *= Math.pow(1 + p.growth, (t - p.churnIdx) / 12) // level anchored at churn
    }
    return lvl
  }
  const metroShareAt = (p: CustomerPlan, t: number) => {
    const live = p.metroWeights
      .map((mw) => {
        const launch = metroLaunchIdx.get(mw.metro.metro) ?? 0
        if (t < launch) return { ...mw, weight: 0 }
        // Customer expansion into new metros ramps over 6 months
        const ramp = Math.min(1, (t - launch + 1) / 6)
        return { ...mw, weight: mw.weight * ramp }
      })
      .filter((x) => x.weight > 0)
    const tot = live.reduce((a, x) => a + x.weight, 0)
    if (tot <= 0) return [] // none of the customer's metros is live yet
    return live.map((x) => ({ metro: x.metro, share: x.weight / tot }))
  }

  // Normalize so planned Oct-2026 demand ≈ target (calibration, not a hard-coded KPI)
  const octRaw = plans.reduce(
    (a, p) => a + p.spec.size * levelAt(p, lastIdx) * seasonality(p.spec.industry, 10),
    0,
  )
  const unit = TARGET_OCT_2026_PACKAGES / octRaw
  plans.forEach((p) => {
    p.scale = p.spec.size * unit
    p.customer.expected_monthly_volume = Math.round(p.scale * Math.max(levelAt(p, lastIdx), levelAt(p, p.churnIdx ?? lastIdx)))
  })

  // Planned demand by customer × month (with noise) — used for station capacity sizing and lots
  const demand: number[][] = plans.map((p) =>
    periods.map((period, t) => {
      const lvl = levelAt(p, t)
      if (lvl <= 0) return 0
      const month = Number(period.slice(5, 7))
      return p.scale * lvl * seasonality(p.spec.industry, month) * Math.max(0.6, 1 + rng.normal(0, p.noise))
    }),
  )

  // Station assignment and capacity sizing
  const stationFor = (p: CustomerPlan, metro: string, t: number): DimStation => {
    const list = (stationsByMetro.get(metro) ?? []).filter((s) => monthIndex(s.launch_period) <= t)
    const all = stationsByMetro.get(metro)!
    if (list.length === 0) return all[0]
    return list[hash(`${p.customer.customer_id}|${metro}`) % list.length]
  }
  const stationVolume = new Map<string, number[]>()
  plans.forEach((p, ci) => {
    periods.forEach((_, t) => {
      const v = demand[ci][t]
      if (!v) return
      for (const ms of metroShareAt(p, t)) {
        const st = stationFor(p, ms.metro.metro, t)
        const arr = stationVolume.get(st.station_id) ?? periods.map(() => 0)
        arr[t] += v * ms.share
        stationVolume.set(st.station_id, arr)
      }
    })
  })
  for (const st of stations) {
    const vols = stationVolume.get(st.station_id) ?? periods.map(() => 0)
    // Sized for the busiest NON-peak month at ~88% utilization; Nov–Dec peaks run above capacity
    const ref = Math.max(1, ...vols.filter((_, t) => { const m = Number(periods[t].slice(5, 7)); return m !== 11 && m !== 12 }))
    st.capacity_daily = Math.max(500, Math.round((ref / 30 / 0.88) / 100) * 100)
    st.fixed_cost_monthly = Math.round(8000 + st.capacity_daily * 7)
  }
  const stationUtil = (stationId: string, t: number) => {
    const st = stations.find((s) => s.station_id === stationId)!
    return (stationVolume.get(stationId)?.[t] ?? 0) / 30 / st.capacity_daily
  }
  const utilCache = new Map<string, number>()
  const utilization = (stationId: string, t: number) => {
    const k = `${stationId}|${t}`
    let u = utilCache.get(k)
    if (u == null) {
      u = stationUtil(stationId, t)
      utilCache.set(k, u)
    }
    return u
  }

  // ---------------------------------------------------------------- contracts & rate cards
  const contracts: DimContract[] = []
  const rateCards: DimRateCard[] = []
  let conSeq = 1
  let rcSeq = 1
  const contractsByCustomer = new Map<string, DimContract[]>()
  plans.forEach((p) => {
    const cid = p.customer.customer_id
    const regionsUsed = [...new Set(p.metroWeights.map((mw) => mw.metro.region))]
    const terms = p.spec.segment === 'Enterprise' ? 45 : p.spec.segment === 'Mid-Market' ? 30 : 30
    const termMonths = p.spec.segment === 'Enterprise' ? 36 : 24
    const list: DimContract[] = []
    let start = p.customer.activation_date
    let version = 1
    const horizonEnd = `${FORECAST_END}-31`
    while (start <= horizonEnd) {
      const endPeriod = addMonths(start.slice(0, 7), termMonths - 1)
      const end = monthEnd(endPeriod)
      const churned = p.churnIdx != null && start > (p.customer.churn_date ?? '9999')
      if (churned) break
      const c: DimContract = {
        contract_id: `CON-${pad(conSeq++)}`,
        customer_id: cid,
        version,
        start_date: start,
        end_date: end,
        pricing_model: (['ZoneBased', 'WeightBased', 'VolumeTier', 'FlatRate'] as const)[hash(cid) % 4],
        volume_commitment: Math.round(p.customer.expected_monthly_volume * 0.6),
        payment_terms_days: terms,
        status: end < AS_OF_DATE ? 'Expired' : start > AS_OF_DATE ? 'Pending' : 'Active',
        bill_failed_attempts: p.billFailed,
        contracted_services: p.serviceShares.map((x) => x.service),
        synthetic: true,
      } as DimContract
      if (p.churnIdx != null && c.end_date > (p.customer.churn_date ?? '')) {
        c.end_date = p.customer.churn_date!
        c.status = 'Expired'
      }
      list.push(c)
      contracts.push(c)
      // Rate card versions: contract start, then each Jan 1 general rate increase within the term
      const renewalDiscount = version > 1 ? 0.97 : 1
      const segs: { from: string; to: string; gri: number }[] = []
      let from = c.start_date
      let gri = 1
      while (from <= c.end_date) {
        const nextJan = `${Number(from.slice(0, 4)) + 1}-01-01`
        const to = nextJan > c.end_date ? c.end_date : addDays(nextJan, -1)
        segs.push({ from, to, gri })
        gri *= Number(nextJan.slice(0, 4)) === 2025 ? 1.045 : Number(nextJan.slice(0, 4)) === 2026 ? 1.039 : 1.035
        from = nextJan
      }
      const cardSeed = new SeededRng(hash(c.contract_id))
      regionsUsed.forEach((region) => {
        p.serviceShares.forEach(({ service }) => {
          const perLb = r2(cardSeed.float(0.09, 0.14))
          const zm = r2(cardSeed.float(0.85, 1.15))
          const regionAdj = region === 'West' ? 1.04 : region === 'East' ? 1.03 : 0.97
          const listPerPkg = SERVICE_BASE[service] * p.priceTier * regionAdj * renewalDiscount
          const baseRate0 = listPerPkg / (1 + (3.2 - 1) * 0.06 * zm) - perLb * SERVICE_WEIGHT[service]
          const tierDisc = p.spec.segment === 'Enterprise' ? cardSeed.float(0.05, 0.08) : p.spec.segment === 'Mid-Market' ? cardSeed.float(0.025, 0.05) : cardSeed.float(0, 0.02)
          const fuel = r2(cardSeed.float(0.075, 0.105))
          segs.forEach((sg, si) => {
            rateCards.push({
              rate_card_id: `RC-${pad(rcSeq++, 5)}`,
              contract_id: c.contract_id,
              service_type: service,
              region,
              base_rate: r2(baseRate0 * sg.gri),
              per_lb_rate: perLb,
              zone_multiplier: zm,
              volume_tier_min: Math.round(p.customer.expected_monthly_volume * 0.55),
              volume_tier_discount: r2(tierDisc),
              fuel_surcharge_pct: r2(fuel + (sg.from >= '2025-07-01' ? 0.005 : 0)),
              remote_surcharge: r2(cardSeed.float(0.95, 1.6)),
              peak_surcharge: r2(cardSeed.float(0.22, 0.42)),
              effective_from: sg.from,
              effective_to: sg.to,
              version: si + 1,
              synthetic: true,
            } as DimRateCard)
          })
        })
      })
      start = addDays(c.end_date, 1)
      version++
      if (p.churnIdx != null && c.end_date === p.customer.churn_date) break
    }
    contractsByCustomer.set(cid, list)
    const current = list.find((c) => c.start_date <= AS_OF_DATE && c.end_date >= AS_OF_DATE) ?? list[list.length - 1]
    p.customer.renewal_date = current.end_date
  })
  const rateCardFor = buildRateCardIndex(rateCards)
  const contractAt = (cid: string, date: string) =>
    contractsByCustomer.get(cid)!.find((c) => c.start_date <= date && c.end_date >= date) ?? null

  // ---------------------------------------------------------------- operational & financial facts
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
  let cmSeq = 1
  let paySeq = 1
  let revSeq = 1
  let glSeq = 1
  let costSeq = 1
  let excSeq = 1

  const exRng = new SeededRng(seed ^ 0x5bd1e995)
  const statusFor = (detected: string): { status: ExceptionStatus; resolved: string | null; notes: string } => {
    const age = daysBetween(detected, AS_OF_DATE)
    const u = exRng.next()
    if (age > 75) {
      if (u < 0.86) return { status: 'Resolved', resolved: addDays(detected, exRng.int(6, 40)), notes: 'Corrected and re-billed / closed' }
      if (u < 0.95) return { status: 'Accepted', resolved: addDays(detected, exRng.int(10, 30)), notes: 'Accepted as commercial adjustment' }
      return { status: 'Rejected', resolved: addDays(detected, exRng.int(10, 30)), notes: 'Investigated — not a billing defect' }
    }
    if (age > 30) {
      if (u < 0.45) return { status: 'Resolved', resolved: addDays(detected, exRng.int(5, Math.max(6, age - 1))), notes: 'Corrected' }
      if (u < 0.8) return { status: 'Investigating', resolved: null, notes: '' }
      return { status: 'Open', resolved: null, notes: '' }
    }
    if (u < 0.6) return { status: 'Open', resolved: null, notes: '' }
    if (u < 0.9) return { status: 'Investigating', resolved: null, notes: '' }
    return { status: 'Pending Approval', resolved: null, notes: '' }
  }
  const pushException = (e: Omit<FactException, 'exception_id' | 'status' | 'resolved_date' | 'resolution_notes' | 'synthetic'> & { status?: ExceptionStatus }) => {
    const st = e.status ? { status: e.status, resolved: null, notes: '' } : statusFor(e.detected_date)
    exceptions.push({
      ...e,
      exception_id: `EXC-${pad(excSeq++, 5)}`,
      status: st.status,
      resolved_date: st.resolved && st.resolved <= AS_OF_DATE ? st.resolved : st.resolved ? AS_OF_DATE : null,
      resolution_notes: st.notes,
      synthetic: true,
    } as FactException)
  }

  // Event calendar (deterministic)
  const dspInflation = (period: string) => (period >= '2026-04' ? 1.072 : period >= '2025-07' ? 1.04 : 1)
  const peakFactor = (period: string) => {
    const m = Number(period.slice(5, 7))
    if (period === '2025-12') return 1.75 // capacity crunch: network ran above station capacity
    return m === 11 || m === 12 ? 1.25 : 1
  }
  const regionQualityDip = (period: string, region: RegionCode) => (region === 'Central' && (period === '2025-07' || period === '2025-08') ? 1.45 : 1)

  const monthlyCustomer = new Map<string, { pkgs: number; net: number; rec: number; varCost: number }>()
  const mcKey = (cid: string, period: string) => `${cid}|${period}`
  const fixedBasis = new Map<string, Map<string, number>>() // period → station|customer → packages
  const firstShip = new Map<string, string>()

  plans.forEach((p, ci) => {
    const cust = p.customer
    const cid = cust.customer_id
    const custRng = new SeededRng(hash(cid) ^ seed)

    // billing lines by accounting period (invoices are cut per billing month)
    const linesByPeriod = new Map<string, FactBillingLine[]>()

    periods.forEach((period, t) => {
      const total = demand[ci][t]
      if (!total) return
      const contract = contractAt(cid, `${period}-15`) ?? contractAt(cid, `${period}-01`)
      if (!contract) return
      const month = Number(period.slice(5, 7))
      const lots: FactShipment[] = []
      const comboCosts: { lotIds: { ok?: string; redel?: string; fail?: string }; n: number; nRedel: number; nFail: number; station: DimStation; dsp: DimDsp; metro: MetroDefinition; service: ServiceType; weight: number }[] = []

      for (const ms of metroShareAt(p, t)) {
        const station = stationFor(p, ms.metro.metro, t)
        const util = utilization(station.station_id, t)
        const brandId = p.brandIds[hash(`${cid}|${ms.metro.metro}`) % p.brandIds.length]
        const dspId = station.dsp_ids[hash(`${cid}|${station.station_id}`) % station.dsp_ids.length]
        const dsp = dsps.find((d) => d.dsp_id === dspId)!
        const zone = 2 + (hash(`${cid}|${ms.metro.metro}|z`) % 4)
        const launch = metroLaunchIdx.get(ms.metro.metro) ?? 0
        const newMetro = t - launch < 4 ? 1.3 : 1
        for (const sv of p.serviceShares) {
          const n = Math.round(total * ms.share * sv.share)
          if (n < 40) continue
          const weight = r2(SERVICE_WEIGHT[sv.service] * custRng.float(0.85, 1.15))
          const svcFail = sv.service === 'SameDay' ? 1.3 : sv.service === 'Express' ? 1.1 : 1
          const overCap = util > 1 ? 1 + (util - 1) * 1.4 : 1
          const failRate = Math.min(0.12, 0.011 * p.deliveryStress * svcFail * peakFactor(period) * newMetro * overCap * regionQualityDip(period, ms.metro.region) * custRng.float(0.8, 1.2))
          const lateRate = Math.min(0.25, 0.032 * p.deliveryStress * (sv.service === 'SameDay' ? 1.6 : sv.service === 'Express' ? 1.3 : 1) * peakFactor(period) * overCap * custRng.float(0.8, 1.2))
          const nFail = Math.round(n * failRate)
          const nRedel = Math.round(n * failRate * 0.85)
          const nLate = Math.round(n * lateRate)
          const nOk = Math.max(0, n - nFail - nRedel - nLate)
          const day = custRng.int(1, daysIn(period))
          const shipDate = `${period}-${String(day).padStart(2, '0')}`
          const mk = (count: number, kind: 'ok' | 'late' | 'redel' | 'fail'): FactShipment | null => {
            if (count <= 0) return null
            const returned = kind === 'fail' && hash(`${cid}|${period}|${sv.service}|${ms.metro.metro}`) % 4 === 0
            const lot: FactShipment = {
              shipment_id: `SHP-${pad(shipSeq++, 6)}`,
              package_count: count,
              station_id: station.station_id,
              brand_id: brandId,
              customer_id: cid,
              contract_id: contract.contract_id,
              service_type: sv.service,
              region: ms.metro.region,
              metro: ms.metro.metro,
              zone,
              weight_lbs: weight,
              ship_date: shipDate,
              delivery_date: kind === 'fail' ? null : addDays(shipDate, kind === 'ok' ? 1 : kind === 'late' ? 4 : 3),
              delivery_status: kind === 'fail' ? (returned ? 'Returned' : 'Failed') : 'Delivered',
              operational_status: kind === 'fail' ? (returned ? 'Returned' : 'Failed') : 'Delivered',
              first_attempt_success: kind === 'ok' || kind === 'late',
              on_time: kind === 'ok',
              is_remote: ms.metro.remote_share >= 0.1,
              is_redelivery: kind === 'redel',
              dsp_id: dspId,
              billable: kind !== 'fail' || contract.bill_failed_attempts,
              synthetic: true,
            } as FactShipment
            lots.push(lot)
            shipments.push(lot)
            return lot
          }
          const okLot = mk(nOk, 'ok')
          mk(nLate, 'late')
          const redelLot = mk(nRedel, 'redel')
          const failLot = mk(nFail, 'fail')
          comboCosts.push({
            lotIds: { ok: okLot?.shipment_id, redel: redelLot?.shipment_id, fail: failLot?.shipment_id },
            n,
            nRedel,
            nFail,
            station,
            dsp,
            metro: ms.metro,
            service: sv.service,
            weight,
          })
          // fixed-cost allocation basis (station × customer packages)
          const fb = fixedBasis.get(period) ?? new Map<string, number>()
          fb.set(`${station.station_id}|${cid}`, (fb.get(`${station.station_id}|${cid}`) ?? 0) + n)
          fixedBasis.set(period, fb)
        }
      }
      if (!lots.length) return
      if (!firstShip.has(cid)) firstShip.set(cid, lots.reduce((a, l) => (l.ship_date < a ? l.ship_date : a), lots[0].ship_date))

      // ---- Variable costs (per combo; linked to a representative lot of the combo)
      let periodVarCost = 0
      for (const cc of comboCosts) {
        const months = t - (metroLaunchIdx.get(cc.metro.metro) ?? 0)
        const maturity = Math.min(1, 0.68 + 0.32 * Math.max(0, months) / 12)
        const smallCombo = cc.n < 600 ? 0.9 : 1
        const density = cc.metro.density * maturity * smallCombo
        const util = utilization(cc.station.station_id, t)
        const capPremium = util > 1 ? 1 + (util - 1) * 0.35 : 1
        const peakDsp = Number(period.slice(5, 7)) >= 11 ? 1.1 : 1
        const perStop = (cc.dsp.base_cost_per_stop * cc.metro.cost_index * dspInflation(period) * peakDsp * capPremium * DSP_SERVICE_MULT[cc.service]) / density
        const rep = cc.lotIds.ok ?? cc.lotIds.redel ?? cc.lotIds.fail!
        const row = (type: FactCost['cost_type'], amount: number, shipmentId: string, dspId: string | null) => {
          if (amount <= 0) return
          const a = r2(amount)
          periodVarCost += a
          costs.push({
            cost_id: `CST-${pad(costSeq++, 6)}`,
            shipment_id: shipmentId,
            customer_id: cid,
            region: cc.metro.region,
            service_type: cc.service,
            dsp_id: dspId,
            station_id: cc.station.station_id,
            fixed_pool: null,
            cost_date: `${period}-${String(Math.min(28, daysIn(period))).padStart(2, '0')}`,
            accounting_period: period,
            cost_type: type,
            amount: a,
            synthetic: true,
          } as FactCost)
        }
        row('DSP Delivery', cc.n * perStop, rep, cc.dsp.dsp_id)
        row('Sorting', cc.n * cc.station.sort_cost_per_pkg * (util > 0.95 ? 1.12 : 1), rep, null)
        row('Linehaul', cc.n * 0.29 * LINEHAUL_SERVICE_MULT[cc.service] * (cc.metro.region !== p.spec.homeRegion ? 1.22 : 1) * (1 + Math.min(0.4, cc.weight / 40)), rep, null)
        if (cc.nRedel) row('Redelivery', cc.nRedel * perStop * 0.9, cc.lotIds.redel ?? rep, cc.dsp.dsp_id)
        if (cc.nFail) {
          const claims = Math.round(cc.nFail * 0.14)
          if (claims) row('Claims', claims * custRng.float(24, 58), cc.lotIds.fail ?? rep, null)
        }
        row('Other Variable', cc.n * 0.055, rep, null)
      }

      // ---- Billing (volume-tier basis = billable packages shipped this month)
      const billablePkgs = lots.filter((l) => l.billable).reduce((a, l) => a + l.package_count, 0)
      let periodPkgs = 0
      for (const lot of lots) {
        periodPkgs += lot.package_count
        if (!lot.billable) continue
        const card = rateCardFor(lot.contract_id, lot.service_type, lot.region, lot.ship_date)
        if (!card) {
          pushException({
            exception_type: 'Customer Mapping Error',
            customer_id: cid,
            shipment_id: lot.shipment_id,
            invoice_id: null,
            billing_line_id: null,
            expected_amount: 0,
            actual_amount: 0,
            difference: 0,
            severity: 'High',
            root_cause: 'No effective rate card for contract × service × region on ship date',
            trigger_rule: 'IF billable lot AND no rate_card effective on ship_date THEN Missing Rate Card',
            owner: 'Pricing',
            recommended_action: 'Load rate card version and re-rate lot',
            detected_date: lot.ship_date,
            metro: lot.metro,
            service_type: lot.service_type,
            financial_impact: 0,
          })
          continue
        }
        const charges = rateLot(card, lot, billablePkgs)
        // Missing billing (~0.5% of billable lots)
        if (custRng.chance(0.005)) {
          pushException({
            exception_type: 'Missing Billing',
            customer_id: cid,
            shipment_id: lot.shipment_id,
            invoice_id: null,
            billing_line_id: null,
            expected_amount: charges.expectedNet,
            actual_amount: 0,
            difference: charges.expectedNet,
            severity: charges.expectedNet > 5000 ? 'Critical' : charges.expectedNet > 1000 ? 'High' : 'Medium',
            root_cause: 'Billable lot has no billing line (rating job skipped)',
            trigger_rule: 'IF shipment.billable = true AND NOT EXISTS billing_line THEN Missing Billing',
            owner: 'Billing',
            recommended_action: 'Create billing line from effective rate card and include in next invoice',
            detected_date: addDays(lot.ship_date, 3),
            metro: lot.metro,
            service_type: lot.service_type,
            financial_impact: charges.expectedNet,
          })
          continue
        }
        // Credits: SLA credits on late premium lots, failed-attempt credit, occasional goodwill
        let credits = 0
        if (!lot.on_time && lot.first_attempt_success && (lot.service_type === 'SameDay' || lot.service_type === 'Express'))
          credits += (charges.base - charges.discount) * custRng.float(0.35, 0.6)
        if (lot.delivery_status !== 'Delivered') credits += charges.expectedNet * 0.5
        if (custRng.chance(0.012)) credits += charges.expectedNet * custRng.float(0.02, 0.06)
        credits = r2(credits)

        let base = charges.base
        let fuel = charges.fuel
        const mismatch = custRng.chance(0.006)
        if (mismatch) {
          base = r2(charges.base * (1 - custRng.float(0.04, 0.12)))
          fuel = r2((base - charges.discount) * card.fuel_surcharge_pct)
        }
        const dropFuel = !mismatch && custRng.chance(0.004)
        if (dropFuel) fuel = 0
        const net = r2(base + fuel + charges.accessorial - charges.discount - credits)
        // Lots shipped at month-end bill early next month (cross-month timing). Lots billed after the
        // history window stay billed-but-not-invoiced as of the snapshot.
        const billingDate = addDays(lot.ship_date, 1 + (hash(lot.shipment_id) % 3))
        const line: FactBillingLine = {
          billing_line_id: `BIL-${pad(billSeq++, 6)}`,
          shipment_id: lot.shipment_id,
          package_count: lot.package_count,
          customer_id: cid,
          contract_id: lot.contract_id,
          invoice_id: null,
          service_type: lot.service_type,
          region: lot.region,
          billing_date: billingDate,
          accounting_period: billingDate.slice(0, 7),
          base_charge: base,
          fuel_surcharge: fuel,
          remote_surcharge: charges.accessorial,
          discounts: charges.discount,
          credits,
          net_amount: net,
          rate_card_id: card.rate_card_id,
          is_duplicate: false,
          synthetic: true,
        } as FactBillingLine
        billingLines.push(line)
        const lp = linesByPeriod.get(line.accounting_period) ?? []
        lp.push(line)
        linesByPeriod.set(line.accounting_period, lp)
        if (mismatch) {
          const actualBeforeCredits = r2(base + fuel + charges.accessorial - charges.discount)
          pushException({
            exception_type: 'Rate Mismatch',
            customer_id: cid,
            shipment_id: lot.shipment_id,
            invoice_id: null,
            billing_line_id: line.billing_line_id,
            expected_amount: charges.expectedNet,
            actual_amount: actualBeforeCredits,
            difference: r2(charges.expectedNet - actualBeforeCredits),
            severity: 'High',
            root_cause: 'Billed base rate below the effective contract rate-card version',
            trigger_rule: 'IF billed_base < rate_card_base × (1 − 2%) THEN Rate Mismatch',
            owner: 'Pricing',
            recommended_action: 'Re-price using effective rate card version; issue debit adjustment',
            detected_date: addDays(billingDate, 2),
            metro: lot.metro,
            service_type: lot.service_type,
            financial_impact: r2(charges.expectedNet - actualBeforeCredits),
          })
        }
        if (dropFuel) {
          pushException({
            exception_type: 'Missing Surcharge',
            customer_id: cid,
            shipment_id: lot.shipment_id,
            invoice_id: null,
            billing_line_id: line.billing_line_id,
            expected_amount: charges.fuel,
            actual_amount: 0,
            difference: charges.fuel,
            severity: charges.fuel > 500 ? 'High' : 'Medium',
            root_cause: 'Fuel surcharge omitted during rating',
            trigger_rule: 'IF rate_card.fuel_surcharge_pct > 0 AND billing.fuel_surcharge = 0 THEN Missing Surcharge',
            owner: 'Billing',
            recommended_action: 'Re-rate fuel surcharge and issue debit memo',
            detected_date: addDays(billingDate, 2),
            metro: lot.metro,
            service_type: lot.service_type,
            financial_impact: charges.fuel,
          })
        }
        // Duplicate billing (~0.15% of lines) — excluded from Net Billing; refund risk
        if (custRng.chance(0.0015)) {
          const dup: FactBillingLine = { ...line, billing_line_id: `BIL-${pad(billSeq++, 6)}`, is_duplicate: true }
          billingLines.push(dup)
          pushException({
            exception_type: 'Duplicate Billing',
            customer_id: cid,
            shipment_id: lot.shipment_id,
            invoice_id: null,
            billing_line_id: dup.billing_line_id,
            expected_amount: line.net_amount,
            actual_amount: r2(line.net_amount * 2),
            difference: line.net_amount,
            severity: line.net_amount > 2000 ? 'Critical' : 'High',
            root_cause: 'Lot rated twice in billing engine',
            trigger_rule: 'IF COUNT(billing_line WHERE shipment_id = X AND NOT voided) > 1 THEN Duplicate Billing',
            owner: 'Billing',
            recommended_action: 'Void duplicate line and credit customer',
            detected_date: addDays(billingDate, 3),
            metro: lot.metro,
            service_type: lot.service_type,
            financial_impact: line.net_amount,
          })
        }
      }
      const mc = monthlyCustomer.get(mcKey(cid, period)) ?? { pkgs: 0, net: 0, rec: 0, varCost: 0 }
      mc.pkgs += periodPkgs
      mc.varCost += periodVarCost
      monthlyCustomer.set(mcKey(cid, period), mc)
    })

    // ---- Invoices, collections, recognition per billing month
    for (const [period, lines] of [...linesByPeriod.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (period > HISTORY_END) continue // not yet invoiced at the as-of date
      const contract = contractAt(cid, `${period}-15`) ?? contractsByCustomer.get(cid)!.slice(-1)[0]
      const gross = r2(lines.reduce((a, b) => a + b.base_charge + b.fuel_surcharge + b.remote_surcharge, 0))
      const lineCredits = r2(lines.reduce((a, b) => a + b.credits + b.discounts, 0))
      const lineNet = r2(lines.reduce((a, b) => a + b.net_amount, 0))
      const invoiceId = `INV-${pad(invSeq++, 5)}`
      const invoiceDate = monthEnd(period)
      const memo = custRng.chance(0.045) ? r2(lineNet * custRng.float(0.004, 0.018)) : 0
      const netInvoice = r2(lineNet - memo)
      const dueDate = addDays(invoiceDate, contract.payment_terms_days)
      // Collections behaviour
      const slow = custRng.chance(p.paymentRisk * 0.6)
      const delay = slow ? custRng.int(contract.payment_terms_days + 20, contract.payment_terms_days + 110) : Math.max(5, Math.round(contract.payment_terms_days + custRng.normal(p.paymentRisk * 25 - 4, 6)))
      const payDate = addDays(invoiceDate, delay)
      const partial = slow && custRng.chance(0.35)
      let paid = 0
      if (payDate <= AS_OF_DATE) {
        const amt = partial ? r2(netInvoice * custRng.float(0.4, 0.75)) : netInvoice
        payments.push({ payment_id: `PAY-${pad(paySeq++, 5)}`, customer_id: cid, invoice_id: invoiceId, payment_date: payDate, amount: amt, method: (['ACH', 'Wire', 'ACH', 'Check'] as const)[hash(invoiceId) % 4], synthetic: true } as FactPayment)
        paid += amt
        if (partial) {
          const rest = addDays(payDate, custRng.int(25, 60))
          if (rest <= AS_OF_DATE) {
            payments.push({ payment_id: `PAY-${pad(paySeq++, 5)}`, customer_id: cid, invoice_id: invoiceId, payment_date: rest, amount: r2(netInvoice - amt), method: 'ACH', synthetic: true } as FactPayment)
            paid = netInvoice
          }
        }
      }
      const outstanding = r2(netInvoice - paid)
      const status: FactInvoice['status'] =
        outstanding <= 0.005 ? 'Paid' : dueDate < AS_OF_DATE ? 'Overdue' : paid > 0 ? 'Partial' : 'Issued'
      invoices.push({ invoice_id: invoiceId, customer_id: cid, invoice_date: invoiceDate, accounting_period: period, gross_amount: gross, credit_amount: r2(lineCredits + memo), net_amount: netInvoice, status, due_date: dueDate, synthetic: true } as FactInvoice)
      lines.forEach((l) => (l.invoice_id = invoiceId))
      if (memo > 0) {
        creditMemos.push({ credit_memo_id: `CRM-${pad(cmSeq++, 5)}`, customer_id: cid, invoice_id: invoiceId, shipment_id: lines[0].shipment_id, credit_date: invoiceDate, accounting_period: period, amount: memo, reason: (['SLA miss credit', 'Damaged package', 'Billing adjustment', 'Goodwill'] as const)[hash(invoiceId) % 4], synthetic: true } as FactCreditMemo)
        pushException({
          exception_type: 'Credit Memo Adjustment',
          customer_id: cid,
          shipment_id: null,
          invoice_id: invoiceId,
          billing_line_id: null,
          expected_amount: lineNet,
          actual_amount: netInvoice,
          difference: memo,
          severity: 'Low',
          root_cause: 'Approved credit memo reduces invoice',
          trigger_rule: 'IF credit_memo linked to invoice THEN Credit Memo Adjustment',
          owner: 'Finance',
          recommended_action: 'None — documented commercial adjustment',
          detected_date: invoiceDate,
          metro: null,
          service_type: null,
          financial_impact: memo,
          status: 'Accepted',
        })
      }
      if (status === 'Overdue') {
        pushException({
          exception_type: 'Overdue AR',
          customer_id: cid,
          shipment_id: null,
          invoice_id: invoiceId,
          billing_line_id: null,
          expected_amount: netInvoice,
          actual_amount: r2(paid),
          difference: outstanding,
          severity: outstanding > 100000 ? 'Critical' : outstanding > 20000 ? 'High' : 'Medium',
          root_cause: 'Invoice past due date without full payment',
          trigger_rule: 'IF invoice.due_date < as_of AND balance > 0 THEN Overdue AR',
          owner: 'Finance',
          recommended_action: daysBetween(dueDate, AS_OF_DATE) > 60 ? 'Escalate collections; consider credit hold' : 'Collections outreach',
          detected_date: addDays(dueDate, 1),
          metro: null,
          service_type: null,
          financial_impact: outstanding,
          status: daysBetween(dueDate, AS_OF_DATE) > 45 ? 'Investigating' : 'Open',
        })
      }

      // Recognition: invoice-period header + allocated detail; ~5% partial accrual shift (cut-off)
      const shift = custRng.chance(0.05) && period < HISTORY_END
      const recogPeriod = shift ? addMonths(period, 1) : period
      const recogAmt = shift ? r2(netInvoice * 0.94) : netInvoice
      const revRecId = `REV-${pad(revSeq++, 6)}`
      revenueRecognition.push({ rev_rec_id: revRecId, customer_id: cid, invoice_id: invoiceId, billing_line_id: null, shipment_id: null, recognition_date: monthEnd(recogPeriod), accounting_period: recogPeriod, amount: recogAmt, recognition_type: shift ? 'Accrual' : 'Invoice', gl_account: '4000-Delivery-Revenue', synthetic: true } as FactRevenueRecognition)
      let allocated = 0
      lines.forEach((b, bi) => {
        const share = bi === lines.length - 1 ? r2(recogAmt - allocated) : lineNet === 0 ? 0 : r2((b.net_amount / lineNet) * recogAmt)
        allocated = r2(allocated + share)
        revenueRecognition.push({ rev_rec_id: `REV-${pad(revSeq++, 6)}`, customer_id: cid, invoice_id: invoiceId, billing_line_id: b.billing_line_id, shipment_id: b.shipment_id, recognition_date: monthEnd(recogPeriod), accounting_period: recogPeriod, amount: share, recognition_type: shift ? 'Accrual' : 'Invoice', gl_account: '4000-Delivery-Revenue', synthetic: true } as FactRevenueRecognition)
      })
      generalLedger.push({ gl_entry_id: `GL-${pad(glSeq++, 6)}`, accounting_period: recogPeriod, entry_date: monthEnd(recogPeriod), account_code: '4000', account_name: 'Delivery Revenue', debit: 0, credit: recogAmt, customer_id: cid, rev_rec_id: revRecId, invoice_id: invoiceId, description: `Recognize revenue ${invoiceId}`, synthetic: true } as FactGeneralLedger)
      generalLedger.push({ gl_entry_id: `GL-${pad(glSeq++, 6)}`, accounting_period: recogPeriod, entry_date: monthEnd(recogPeriod), account_code: '1100', account_name: 'Accounts Receivable', debit: recogAmt, credit: 0, customer_id: cid, rev_rec_id: revRecId, invoice_id: invoiceId, description: `AR for ${invoiceId}`, synthetic: true } as FactGeneralLedger)
      if (shift) {
        pushException({
          exception_type: 'Timing Difference',
          customer_id: cid,
          shipment_id: null,
          invoice_id: invoiceId,
          billing_line_id: null,
          expected_amount: netInvoice,
          actual_amount: recogAmt,
          difference: r2(netInvoice - recogAmt),
          severity: 'Low',
          root_cause: 'Accounting cut-off; partial accrual recognized in the following period',
          trigger_rule: 'IF invoice.period <> rev_rec.period THEN Timing Difference',
          owner: 'Finance',
          recommended_action: 'Monitor; no billing action required',
          detected_date: invoiceDate,
          metro: null,
          service_type: null,
          financial_impact: r2(Math.abs(netInvoice - recogAmt)),
          status: 'Accepted',
        })
      }
      const mcb = monthlyCustomer.get(mcKey(cid, period)) ?? { pkgs: 0, net: 0, rec: 0, varCost: 0 }
      mcb.net = r2(mcb.net + lineNet)
      monthlyCustomer.set(mcKey(cid, period), mcb)
      const mcr = monthlyCustomer.get(mcKey(cid, recogPeriod)) ?? { pkgs: 0, net: 0, rec: 0, varCost: 0 }
      mcr.rec = r2(mcr.rec + recogAmt)
      monthlyCustomer.set(mcKey(cid, recogPeriod), mcr)
    }
  })

  // ---- Fixed costs: station fixed (allocated by station package share) + corporate (company share)
  periods.forEach((period, t) => {
    const basis = fixedBasis.get(period) ?? new Map<string, number>()
    const byStation = new Map<string, { cid: string; n: number }[]>()
    let companyPkgs = 0
    const byCustomer = new Map<string, number>()
    for (const [k, n] of basis) {
      const [sid, cid] = k.split('|')
      const list = byStation.get(sid) ?? []
      list.push({ cid, n })
      byStation.set(sid, list)
      companyPkgs += n
      byCustomer.set(cid, (byCustomer.get(cid) ?? 0) + n)
    }
    const fixedRow = (cid: string | null, st: DimStation | null, region: RegionCode, pool: 'Station' | 'Corporate', amount: number) => {
      if (amount <= 0) return
      costs.push({ cost_id: `CST-${pad(costSeq++, 6)}`, shipment_id: null, customer_id: cid, region, service_type: null, dsp_id: null, station_id: st?.station_id ?? null, fixed_pool: pool, cost_date: monthEnd(period), accounting_period: period, cost_type: 'Allocated Fixed', amount: r2(amount), synthetic: true } as FactCost)
    }
    for (const st of stations) {
      if (monthIndex(st.launch_period) > t) continue
      const list = byStation.get(st.station_id) ?? []
      const tot = list.reduce((a, x) => a + x.n, 0)
      if (!tot) {
        fixedRow(null, st, st.region, 'Station', st.fixed_cost_monthly) // unabsorbed capacity
        continue
      }
      for (const x of list) fixedRow(x.cid, st, st.region, 'Station', (st.fixed_cost_monthly * x.n) / tot)
    }
    const corporate = 330000 * (1 + 0.012 * t)
    for (const [cid, n] of byCustomer) {
      const p = plans.find((pl) => pl.customer.customer_id === cid)!
      fixedRow(cid, null, p.spec.homeRegion, 'Corporate', (corporate * n) / companyPkgs)
    }
  })

  // ---- Customer-level risk exceptions (latest period) from realised actuals
  const lastPeriod = HISTORY_END
  plans.forEach((p) => {
    const cid = p.customer.customer_id
    const m0 = monthlyCustomer.get(mcKey(cid, lastPeriod))
    const prior3 = [1, 2, 3].map((k) => monthlyCustomer.get(mcKey(cid, addMonths(lastPeriod, -k)))?.pkgs ?? 0)
    const recent3 = [0, 1, 2].map((k) => monthlyCustomer.get(mcKey(cid, addMonths(lastPeriod, -k)))?.pkgs ?? 0)
    const yAgo = monthlyCustomer.get(mcKey(cid, addMonths(lastPeriod, -12)))
    if (m0 && yAgo && yAgo.pkgs > 0 && m0.pkgs < yAgo.pkgs * 0.85 && p.churnIdx == null) {
      const rate = m0.pkgs ? m0.net / m0.pkgs : 5
      pushException({
        exception_type: 'Volume Decline',
        customer_id: cid, shipment_id: null, invoice_id: null, billing_line_id: null,
        expected_amount: r2(yAgo.pkgs * rate), actual_amount: r2(m0.pkgs * rate), difference: r2((yAgo.pkgs - m0.pkgs) * rate),
        severity: m0.pkgs < yAgo.pkgs * 0.7 ? 'Critical' : 'High',
        root_cause: `Volume down ${Math.round((1 - m0.pkgs / yAgo.pkgs) * 100)}% YoY (seasonally comparable)`,
        trigger_rule: 'IF volume_t / volume_t−12 < 0.85 THEN Volume Decline', owner: 'Sales',
        recommended_action: 'Account review: share-of-wallet, service issues, competitive pricing',
        detected_date: `${lastPeriod}-25`, metro: null, service_type: null,
        financial_impact: r2((yAgo.pkgs - m0.pkgs) * rate),
        status: 'Open',
      })
    }
    const cm = (k: number[]) => {
      let net = 0
      let vc = 0
      k.forEach((o) => {
        const x = monthlyCustomer.get(mcKey(cid, addMonths(lastPeriod, -o)))
        if (x) {
          net += x.net
          vc += x.varCost
        }
      })
      return net ? (net - vc) / net : null
    }
    const cmNow = cm([0, 1, 2])
    const cmPrev = cm([12, 13, 14])
    const netNow = recent3.reduce((a, x) => a + x, 0)
    if (cmNow != null && cmPrev != null && cmNow < cmPrev - 0.05 && netNow > 0) {
      const net3 = [0, 1, 2].reduce((a, o) => a + (monthlyCustomer.get(mcKey(cid, addMonths(lastPeriod, -o)))?.net ?? 0), 0)
      pushException({
        exception_type: 'Margin Decline',
        customer_id: cid, shipment_id: null, invoice_id: null, billing_line_id: null,
        expected_amount: r2(net3 * cmPrev), actual_amount: r2(net3 * cmNow), difference: r2(net3 * (cmPrev - cmNow)),
        severity: cmNow < 0.1 ? 'Critical' : 'High',
        root_cause: `Contribution margin ${(cmNow * 100).toFixed(1)}% vs ${(cmPrev * 100).toFixed(1)}% a year ago`,
        trigger_rule: 'IF CM(last 3 mo) < CM(same 3 mo prior year) − 5 pts THEN Margin Decline', owner: 'Pricing',
        recommended_action: 'Review DSP rates, zone mix and repricing at renewal',
        detected_date: `${lastPeriod}-26`, metro: null, service_type: null,
        financial_impact: r2(net3 * (cmPrev - cmNow)),
        status: 'Open',
      })
    }
    if (p.spec.profile === 'at_risk' && prior3.some((x) => x > 0)) {
      const rev = [0, 1, 2].reduce((a, o) => a + (monthlyCustomer.get(mcKey(cid, addMonths(lastPeriod, -o)))?.rec ?? 0), 0)
      pushException({
        exception_type: 'High Risk Customer',
        customer_id: cid, shipment_id: null, invoice_id: null, billing_line_id: null,
        expected_amount: r2(rev), actual_amount: r2(rev * 0.7), difference: r2(rev * 0.3),
        severity: 'Critical',
        root_cause: 'Composite signals: volume softening, service failures, slow payment',
        trigger_rule: 'IF health_score < 50 OR (volume trend < 0 AND overdue AR) THEN High Risk Customer', owner: 'Sales',
        recommended_action: 'Executive QBR; service recovery plan; retention offer',
        detected_date: `${lastPeriod}-20`, metro: null, service_type: null,
        financial_impact: r2(rev * 0.3),
        status: 'Open',
      })
    }
  })

  // ---- Customer lifecycle attributes from realised activity
  plans.forEach((p) => {
    const c = p.customer
    c.first_shipment_date = firstShip.get(c.customer_id) ?? null
    const now = monthlyCustomer.get(mcKey(c.customer_id, lastPeriod))?.pkgs ?? 0
    const yAgo = monthlyCustomer.get(mcKey(c.customer_id, addMonths(lastPeriod, -12)))?.pkgs ?? 0
    c.lifecycle_status =
      p.churnIdx != null ? 'Churned'
        : p.activationIdx > lastIdx - 3 ? 'Onboarding'
          : p.spec.profile === 'at_risk' || (yAgo > 0 && now < yAgo * 0.85) ? 'At Risk'
            : yAgo > 0 && now > yAgo * 1.25 ? 'Expansion'
              : 'Active'
  })

  // ---------------------------------------------------------------- opportunities (CRM)
  const opportunities: FactOpportunity[] = []
  const opportunityStageEvents: FactOpportunityStageEvent[] = []
  const oppRng = new SeededRng(seed ^ 0x1234567)
  let oppSeq = 1
  let oseSeq = 1
  const stageProb: Record<OpportunityStage, number> = { Lead: 0.1, Qualified: 0.25, Proposal: 0.4, Negotiation: 0.65, 'Closed Won': 1, 'Closed Lost': 0 }
  const path: OpportunityStage[] = ['Lead', 'Qualified', 'Proposal', 'Negotiation']
  const addOpp = (o: Omit<FactOpportunity, 'opportunity_id' | 'synthetic'>, reached: OpportunityStage[]) => {
    const id = `OPP-${pad(oppSeq++)}`
    opportunities.push({ ...o, opportunity_id: id, synthetic: true } as FactOpportunity)
    let d = o.created_date
    const end = o.closed_date ?? AS_OF_DATE
    const span = Math.max(reached.length, 1)
    const step = Math.max(3, Math.floor(daysBetween(o.created_date, end) / span))
    let prev: OpportunityStage | null = null
    reached.forEach((st, i) => {
      if (i > 0) d = addDays(d, Math.max(2, Math.round(step * oppRng.float(0.6, 1.2))))
      if (o.closed_date && d > o.closed_date) d = o.closed_date
      opportunityStageEvents.push({ event_id: `OSE-${pad(oseSeq++)}`, opportunity_id: id, from_stage: prev, to_stage: st, event_date: d, synthetic: true } as FactOpportunityStageEvent)
      prev = st
    })
    return id
  }
  const custOpp = new Map<string, string>()
  plans.filter((p) => p.spec.profile === 'new').forEach((p) => {
    const act = p.customer.activation_date
    const created = addDays(act, -oppRng.int(110, 230))
    const closed = addDays(act, -oppRng.int(25, 60))
    const monthlyRev = r2(p.customer.expected_monthly_volume * 5.0)
    const id = addOpp({
      customer_id: p.customer.customer_id, prospect_name: p.customer.customer_name, stage: 'Closed Won',
      opportunity_value: r2(monthlyRev * 24), win_probability: 1, expected_start_date: act,
      expected_monthly_volume: p.customer.expected_monthly_volume, expected_monthly_revenue: monthlyRev,
      created_date: created, closed_date: closed, sales_cycle_days: daysBetween(created, closed),
    }, [...path, 'Closed Won'])
    custOpp.set(p.customer.customer_id, id)
  })
  for (let i = 0; i < 26; i++) {
    const created = addDays('2024-06-01', oppRng.int(0, 700))
    const lostAt = oppRng.int(1, 4)
    const closed = addDays(created, oppRng.int(40, 180))
    if (closed > AS_OF_DATE) continue
    const vol = Math.round(oppRng.float(4000, 60000))
    addOpp({
      customer_id: null, prospect_name: `${PROSPECT_NAMES[i % PROSPECT_NAMES.length]}${i >= PROSPECT_NAMES.length ? ' II' : ''}`, stage: 'Closed Lost',
      opportunity_value: r2(vol * 5 * 24), win_probability: 0, expected_start_date: addDays(closed, 45),
      expected_monthly_volume: vol, expected_monthly_revenue: r2(vol * 5), created_date: created, closed_date: closed,
      sales_cycle_days: daysBetween(created, closed),
    }, [...path.slice(0, lostAt), 'Closed Lost'])
  }
  const openStages: OpportunityStage[] = ['Lead', 'Lead', 'Qualified', 'Qualified', 'Proposal', 'Proposal', 'Negotiation']
  for (let i = 0; i < 22; i++) {
    const stage = openStages[i % openStages.length]
    const created = addDays('2026-01-05', oppRng.int(0, 280))
    const vol = Math.round(oppRng.float(3000, 70000))
    addOpp({
      customer_id: null, prospect_name: PROSPECT_NAMES[(i + 7) % PROSPECT_NAMES.length] + (i >= 17 ? ' Group' : ''), stage,
      opportunity_value: r2(vol * 5 * 24), win_probability: stageProb[stage], expected_start_date: `${addMonths('2026-11', oppRng.int(0, 6))}-01`,
      expected_monthly_volume: vol, expected_monthly_revenue: r2(vol * 5), created_date: created, closed_date: null, sales_cycle_days: null,
    }, path.slice(0, path.indexOf(stage) + 1))
  }

  // ---------------------------------------------------------------- forecast snapshots (point-in-time)
  const forecastSnapshots: FactForecast[] = []
  let fcSeq = 1
  const versions = periodsFrom(addMonths(HISTORY_START, 1), addMonths(HISTORY_END, 1))
  const seasonOf = (p: CustomerPlan, period: string) => seasonality(p.spec.industry, Number(period.slice(5, 7)))
  versions.forEach((V) => {
    const created = `${V}-01`
    plans.forEach((p) => {
      const cid = p.customer.customer_id
      const hist: { period: string; pkgs: number; net: number; rec: number }[] = []
      for (let k = 1; k <= 6; k++) {
        const per = addMonths(V, -k)
        if (per < HISTORY_START) break
        const x = monthlyCustomer.get(mcKey(cid, per))
        hist.push({ period: per, pkgs: x?.pkgs ?? 0, net: x?.net ?? 0, rec: x?.rec ?? 0 })
      }
      const last3 = hist.slice(0, 3).filter((h) => h.pkgs > 0)
      if (!last3.length || hist[0].pkgs === 0) return // not an active existing customer at V
      const deseason = (h: { period: string; pkgs: number }) => h.pkgs / seasonOf(p, h.period)
      const baseLevel = last3.reduce((a, h) => a + deseason(h), 0) / last3.length
      const prev3 = hist.slice(3, 6).filter((h) => h.pkgs > 0)
      let g = 0
      if (prev3.length === 3 && last3.length === 3) {
        const prevLevel = prev3.reduce((a, h) => a + deseason(h), 0) / 3
        g = Math.max(-0.06, Math.min(0.06, Math.pow(baseLevel / prevLevel, 1 / 3) - 1)) * 0.5
      }
      const netSum = last3.reduce((a, h) => a + h.net, 0)
      const pkgSum = last3.reduce((a, h) => a + h.pkgs, 0)
      const rate = pkgSum ? netSum / pkgSum : 5
      const recRatio = Math.max(0.9, Math.min(1.05, netSum ? last3.reduce((a, h) => a + h.rec, 0) / netSum : 0.99))
      for (let h = 1; h <= 3; h++) {
        const T = addMonths(V, h - 1)
        if (T > FORECAST_END) break
        const griKnown = T.slice(5, 7) === '01' || (T.slice(0, 4) > hist[0].period.slice(0, 4)) ? 1.035 : 1
        const vol0 = baseLevel * seasonOf(p, T) * Math.pow(1 + g, h + 1)
        ;(['Base', 'Upside', 'Downside'] as const).forEach((sc) => {
          const vol = Math.round(vol0 * (sc === 'Upside' ? 1.06 : sc === 'Downside' ? (g < -0.01 ? 0.85 : 0.92) : 1))
          const r = rate * griKnown * (sc === 'Upside' ? 1.01 : sc === 'Downside' ? 0.99 : 1)
          const net = r2(vol * r)
          forecastSnapshots.push({
            forecast_id: `FC-${pad(fcSeq++, 6)}`, customer_id: cid, forecast_version: `FV-${V}`, created_date: created,
            horizon_months: h, method: 'Run-rate driver', opportunity_id: null, accounting_period: T, scenario: sc,
            forecast_type: 'Existing', forecast_volume: vol, forecast_avg_rate: r2(r), forecast_surcharges: r2(net * 0.09),
            forecast_credits: r2(net * 0.02), forecast_net_billing: net, forecast_recognized: r2(net * recRatio), synthetic: true,
          } as FactForecast)
        })
      }
    })
    // Pipeline: opportunities known at V whose account is not yet shipping
    opportunities.forEach((o) => {
      if (o.created_date >= created) return
      if (o.stage === 'Closed Lost' && o.closed_date && o.closed_date < created) return
      if (o.customer_id) {
        const fs = firstShip.get(o.customer_id)
        if (fs && fs < created) return // activated → now in Existing (no double count)
      }
      const known: OpportunityStage =
        o.closed_date && o.closed_date < created ? o.stage
          : [...opportunityStageEvents].filter((e) => e.opportunity_id === o.opportunity_id && e.event_date < created && !e.to_stage.startsWith('Closed')).map((e) => e.to_stage).pop() ?? 'Lead'
      const prob = known === 'Closed Won' ? 1 : known === 'Closed Lost' ? 0 : stageProb[known]
      if (!prob) return
      for (let h = 1; h <= 3; h++) {
        const T = addMonths(V, h - 1)
        if (T > FORECAST_END) break
        const startP = o.expected_start_date.slice(0, 7)
        if (T < startP) continue
        const ramp = [0.35, 0.6, 0.85, 1][Math.min(3, monthIndex(T) - monthIndex(startP))]
        ;(['Base', 'Upside', 'Downside'] as const).forEach((sc) => {
          const mult = sc === 'Upside' ? 1.15 : sc === 'Downside' ? 0.7 : 1
          const net = r2(o.expected_monthly_revenue * prob * ramp * mult)
          if (net <= 0) return
          forecastSnapshots.push({
            forecast_id: `FC-${pad(fcSeq++, 6)}`, customer_id: null, forecast_version: `FV-${V}`, created_date: created,
            horizon_months: h, method: 'Weighted pipeline', opportunity_id: o.opportunity_id, accounting_period: T, scenario: sc,
            forecast_type: 'Pipeline', forecast_volume: Math.round(net / 5), forecast_avg_rate: 5, forecast_surcharges: r2(net * 0.08),
            forecast_credits: r2(net * 0.02), forecast_net_billing: net, forecast_recognized: r2(net * 0.97), synthetic: true,
          } as FactForecast)
        })
      }
    })
  })
  // Official forecast per target: historical months → horizon-1 snapshot; future months → latest version
  const latestVersion = `FV-${versions[versions.length - 1]}`
  const forecasts = forecastSnapshots.filter((f) =>
    f.accounting_period <= HISTORY_END ? f.horizon_months === 1 : f.forecast_version === latestVersion,
  )

  return {
    meta: {
      generated_at: generatedAt,
      seed,
      snapshot_label: `Synthetic Snapshot · as of ${AS_OF_DATE}`,
      is_synthetic: true,
      disclaimer:
        'All data is synthetic and for demonstration only. Public brand names are illustrative accounts — not claimed customers of any real carrier; no figure is real commercial data.',
      fixed_opex_pool_monthly_base: MONTHLY_FIXED_OPEX_POOL_BASE,
      fixed_opex_pool_monthly_downside: MONTHLY_FIXED_OPEX_POOL_DOWNSIDE,
      fixed_opex_basis:
        'Station fixed cost allocated by each customer’s package share at that station; corporate overhead allocated by company package share. Allocation ≠ incremental customer cost.',
      data_version: `v3.0-seed${seed}`,
      history_start: HISTORY_START,
      history_end: HISTORY_END,
      as_of_date: AS_OF_DATE,
      scale_note:
        'Shipment rows are lots (package_count packages each). Volumes, revenue and cost are complete totals, not samples.',
    },
    customers: plans.map((p) => p.customer),
    brands,
    stations,
    dsps,
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
    forecastSnapshots,
    exceptions,
  }
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

// Types re-exported for generators / tests
export type { ExceptionSeverity, ExceptionType, ResponsibleTeam }
