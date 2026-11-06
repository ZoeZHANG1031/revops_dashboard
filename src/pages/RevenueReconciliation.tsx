import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { CategoryTick, exceptionAxisLabel } from '@/components/charts/CategoryTick'
import { rollupExceptionsByRootCause } from '@/calc/actionRollup'
import {
  classifyExceptionNature,
  computeReconciliation,
} from '@/calc/reconciliation'
import { computeReconciliationBridge, type ReconDiffClass } from '@/calc/reconBridge'
import { EXCEPTION_REGISTRY, exposureByClass, isOpenException } from '@/calc/exceptionRegistry'
import { ModuleSubNav } from '@/components/layout/ModuleSubNav'
import { PageHeader } from '@/components/common/PageHeader'
import { REVENUE_OPS_NAV, PALETTE } from '@/lib/icons'
import { InfoTip, StatusIndicator } from '@/components/common/StatusIndicator'
import { FloatingWaterfall } from '@/components/charts/FloatingWaterfall'
import { ChartCard } from '@/components/common/ChartCard'
import { Collapsible } from '@/components/common/Collapsible'
import { DataTable } from '@/components/common/DataTable'
import { CompactKpi, OneLineInsight } from '@/components/revops/CompactKpi'
import { useApp } from '@/context/AppContext'
import { filterExceptions } from '@/lib/filters'
import { exportToCsv } from '@/lib/export'
import {
  formatAxisMoney,
  formatCurrency,
  formatCurrencyPrecise,
  formatNumber,
  formatPercent,
} from '@/lib/money'
import type { ExceptionStatus, ExceptionType, FactException, ServiceType } from '@/types'

const OPEN_STATUSES = new Set<ExceptionStatus>(['Open', 'Investigating', 'Pending Approval'])
const ALL_TYPES: ExceptionType[] = [
  'Missing Billing',
  'Unbilled Packages',
  'Duplicate Billing',
  'Rate Mismatch',
  'Missing Surcharge',
  'Timing Difference',
  'Credit Memo Adjustment',
  'Invoice GL Mismatch',
  'Customer Mapping Error',
  'Missing Shipment ID',
  'Overdue AR',
  'Volume Decline',
  'Margin Decline',
  'High Risk Customer',
]
const ALL_STATUSES: ExceptionStatus[] = [
  'Open',
  'Investigating',
  'Pending Approval',
  'Resolved',
  'Rejected',
  'Accepted',
]
const SERVICES: ServiceType[] = ['Standard', 'Express', 'SameDay', 'Economy']
/** Taxonomy hint colors — FloatingWaterfall uses semantic ± unless respectStepColors */
const BRIDGE_COLOR: Record<ReconDiffClass, string | undefined> = {
  Baseline: undefined,
  'Valid Commercial Adjustments': undefined,
  'Timing Differences': undefined,
  'Recoverable Billing Exceptions': undefined,
  'Unexplained Residual': undefined,
  Informational: '#9bb0a8',
}

const BRIDGE_TO_EXCEPTION: Partial<Record<string, ExceptionType>> = {
  missing: 'Missing Billing',
  rate: 'Rate Mismatch',
  surcharge: 'Missing Surcharge',
  timing: 'Timing Difference',
  credits: 'Credit Memo Adjustment',
  duplicate: 'Duplicate Billing',
}

function daysBetween(iso: string, asOf: string): number {
  const a = Date.parse(iso.slice(0, 10))
  const b = Date.parse(asOf.slice(0, 10))
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.max(0, Math.round((b - a) / 86400000))
}

function moneyResidual(bridge: { expected: number; actual: number; checkSum: number; totalGap: number }) {
  return Math.round((bridge.expected + bridge.checkSum - bridge.actual) * 100) / 100
}

export function RevenueReconciliation() {
  const {
    data,
    filters,
    asOfDate,
    localFilters,
    setLocalFilters,
    navigateToEntity,
    navigateWithContext,
    updateExceptionStatus,
    openEntity,
    openCustomer360,
  } = useApp()
  const [bridgeMode, setBridgeMode] = useState<'full' | 'components'>('full')
  const [showZeroBridge, setShowZeroBridge] = useState(false)
  const [heatMetric, setHeatMetric] = useState<'amount' | 'count'>('amount')
  const [bridgeKey, setBridgeKey] = useState<string | null>(null)
  /** Exception-management scope only — does not change period bridge amounts */
  const [caseScope, setCaseScope] = useState<'open_asof' | 'period_detected'>('open_asof')

  const typeFilter = (localFilters.exceptionType as ExceptionType | null) ?? ''
  const statusFilter = (localFilters.exceptionStatus as ExceptionStatus | null) ?? ''
  const setTypeFilter = (v: ExceptionType | '') =>
    setLocalFilters((prev) => ({ ...prev, exceptionType: v || null }))
  const setStatusFilter = (v: ExceptionStatus | '') =>
    setLocalFilters((prev) => ({ ...prev, exceptionStatus: v || null }))

  const [traceId, setTraceId] = useState<string | null>(() =>
    openEntity?.entityType === 'exception' ? openEntity.entityId : null,
  )
  const custName = useMemo(
    () => new Map(data.customers.map((c) => [c.customer_id, c.customer_name])),
    [data.customers],
  )
  const shipById = useMemo(
    () => new Map(data.shipments.map((sh) => [sh.shipment_id, sh])),
    [data.shipments],
  )
  const recon = useMemo(() => computeReconciliation(data, filters), [data, filters])
  const bridge = useMemo(() => computeReconciliationBridge(data, filters), [data, filters])
  const rollups = useMemo(() => rollupExceptionsByRootCause(data, filters), [data, filters])
  const scopedExceptions = useMemo(() => filterExceptions(data, filters), [data, filters])

  /** Open as of selected date — current status only (no status-history replay) */
  const openAsOfCases = useMemo(() => {
    return scopedExceptions.filter((e) => {
      if (!OPEN_STATUSES.has(e.status)) return false
      if (e.detected_date.slice(0, 10) > asOfDate.slice(0, 10)) return false
      if (e.resolved_date && e.resolved_date.slice(0, 10) <= asOfDate.slice(0, 10)) return false
      return true
    })
  }, [scopedExceptions, asOfDate])

  /** Population for status strip + list before status click-filter */
  const scopePopulation = useMemo(() => {
    const base = caseScope === 'open_asof' ? openAsOfCases : scopedExceptions
    return typeFilter ? base.filter((e) => e.exception_type === typeFilter) : base
  }, [caseScope, openAsOfCases, scopedExceptions, typeFilter])

  const exceptions = useMemo(() => {
    return scopePopulation.filter((e) => {
      if (statusFilter && e.status !== statusFilter) return false
      return true
    })
  }, [scopePopulation, statusFilter])

  const openInView = exceptions.filter((e) => OPEN_STATUSES.has(e.status))
  const groupImpact = (key: (e: FactException) => string) => {
    const m = new Map<string, { key: string; impact: number; cases: number; oldestDays: number }>()
    for (const e of openInView) {
      const k = key(e)
      const age = daysBetween(e.detected_date, asOfDate)
      const cur = m.get(k) ?? { key: k, impact: 0, cases: 0, oldestDays: 0 }
      cur.impact += e.financial_impact
      cur.cases += 1
      cur.oldestDays = Math.max(cur.oldestDays, age)
      m.set(k, cur)
    }
    return [...m.values()]
      .map((x) => ({ ...x, impact: Math.round(x.impact * 100) / 100 }))
      .sort((a, b) => b.impact - a.impact)
  }
  const byReason = groupImpact((e) => e.exception_type)
  const byCustomer = groupImpact((e) => e.customer_id ?? '—')
  const byServiceRaw = groupImpact((e) => {
    if (e.service_type) return e.service_type
    if (e.shipment_id) return shipById.get(e.shipment_id)?.service_type ?? 'Unallocated'
    return 'Invoice / customer-level'
  })
  const byService = byServiceRaw.filter((r) => r.key !== 'Invoice / customer-level')
  const invoiceLevel = byServiceRaw.find((r) => r.key === 'Invoice / customer-level')

  const statusCounts = ALL_STATUSES.map((st) => ({
    status: st,
    count: scopePopulation.filter((e) => e.status === st).length,
  })).filter((c) => c.count > 0)
  const traced = traceId ? exceptions.find((e) => e.exception_id === traceId) ?? null : null

  const diffPct =
    recon.expectedCharges === 0
      ? null
      : (Math.abs(recon.reconciliationDifference) / Math.abs(recon.expectedCharges)) * 100
  const unexplained = bridge.classTotals.unexplained
  const periodRecoverable = bridge.classTotals.recoverable
  const validCommercial = bridge.classTotals.validCommercial
  /** Alert on unexplained / recoverable — not on gross-to-net that includes discounts */
  const reconStatus =
    recon.expectedCharges === 0
      ? { label: 'Not evaluated', tone: 'unavailable' as const, note: 'No expected charges in scope' }
      : Math.abs(unexplained) >= 0.05
        ? {
            label: 'Unexplained residual',
            tone: 'critical' as const,
            note: `Unexplained ${formatCurrency(unexplained, true)} after known adjustments`,
          }
        : Math.abs(periodRecoverable) > Math.abs(recon.expectedCharges) * 0.01
          ? {
              label: 'Recoverable-class variance',
              tone: 'watch' as const,
              note: `Period recoverable-class ${formatCurrency(periodRecoverable, true)} — investigate`,
            }
          : {
              label: 'Gross-to-net explained',
              tone: 'good' as const,
              note: `Difference includes valid discounts/credits (${formatCurrency(validCommercial, true)})`,
            }
  const openExposure = exposureByClass(openAsOfCases)
  const openPotentialRecovery = openExposure['Recoverable Billing Exposure']
  const overdueExposure = openExposure['Collections Exposure']

  const exceptionTrend = useMemo(() => {
    const months = new Map<
      string,
      { period: string; detected: number; resolved: number; detectedAmt: number; resolvedAmt: number }
    >()
    for (const e of scopedExceptions) {
      const op = e.detected_date.slice(0, 7)
      if (op < filters.startPeriod || op > filters.endPeriod) continue
      const cur = months.get(op) ?? {
        period: op,
        detected: 0,
        resolved: 0,
        detectedAmt: 0,
        resolvedAmt: 0,
      }
      cur.detected += 1
      cur.detectedAmt += e.financial_impact
      months.set(op, cur)
    }
    for (const e of scopedExceptions) {
      // Only cases with an actual resolved_date — do not invent a month for status-only Resolved
      if (!e.resolved_date) continue
      const rp = e.resolved_date.slice(0, 7)
      if (rp < filters.startPeriod || rp > filters.endPeriod) continue
      const cur = months.get(rp) ?? {
        period: rp,
        detected: 0,
        resolved: 0,
        detectedAmt: 0,
        resolvedAmt: 0,
      }
      cur.resolved += 1
      cur.resolvedAmt += e.financial_impact
      months.set(rp, cur)
    }
    return [...months.values()].sort((a, b) => a.period.localeCompare(b.period))
  }, [scopedExceptions, filters.startPeriod, filters.endPeriod])

  const resolvedInPeriod = scopedExceptions.filter(
    (e) =>
      e.resolved_date &&
      e.resolved_date.slice(0, 7) >= filters.startPeriod &&
      e.resolved_date.slice(0, 7) <= filters.endPeriod,
  )
  const resolvedImpactSum = resolvedInPeriod.reduce((a, e) => a + e.financial_impact, 0)
  const medianResolveDays = (() => {
    const days = resolvedInPeriod
      .map((e) =>
        Math.round((Date.parse(e.resolved_date!) - Date.parse(e.detected_date)) / 86400000),
      )
      .filter((d) => Number.isFinite(d) && d >= 0)
      .sort((a, b) => a - b)
    if (!days.length) return null
    const mid = Math.floor(days.length / 2)
    return days.length % 2 ? days[mid] : Math.round((days[mid - 1] + days[mid]) / 2)
  })()
  const registryRows = Object.values(EXCEPTION_REGISTRY).map((d) => {
    const list = scopedExceptions.filter((e) => e.exception_type === d.type)
    const open = list.filter(isOpenException)
    return {
      ...d,
      id: d.typeId,
      total: list.length,
      open: open.length,
      resolved: list.filter((e) => e.status === 'Resolved').length,
      openExposure: Math.round(open.reduce((a, e) => a + e.financial_impact, 0) * 100) / 100,
    }
  })

  const coloredItems = bridge.items.map((i) => ({
    key: i.key,
    label: i.label,
    amount: i.amount,
    color: BRIDGE_COLOR[i.diffClass],
    diffClass: i.diffClass,
  }))
  const componentItems = coloredItems.filter((i) => i.key !== 'expected' && i.key !== 'actual')
  const bridgeSteps =
    bridgeMode === 'full'
      ? coloredItems.filter(
          (i) => showZeroBridge || i.amount !== 0 || i.key === 'expected' || i.key === 'actual',
        )
      : [
          ...componentItems.filter((i) => showZeroBridge || i.amount !== 0),
          {
            key: 'total_diff',
            label: 'Total Difference',
            amount: bridge.totalGap,
            color: '#00A86B',
            diffClass: 'Baseline' as ReconDiffClass,
          },
        ]

  const hasLocal = Boolean(typeFilter || statusFilter || bridgeKey)

  const bridgeComps = bridge.items.filter((i) => i.key !== 'expected' && i.key !== 'actual')
  const bigComp = [...bridgeComps].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0]
  const bridgeInsight = bigComp
    ? `Gross-to-net ${bridge.totalGap >= 0 ? '+' : '−'}${formatCurrency(Math.abs(bridge.totalGap), true)}${
        diffPct == null ? '' : ` (${diffPct.toFixed(1)}% of expected)`
      } · largest: ${bigComp.label} · commercial adj ${formatCurrency(validCommercial, true)}.`
    : null

  const reasonTotal = byReason.reduce((a, r) => a + Math.abs(r.impact), 0)
  const pareto = (() => {
    let cum = 0
    return byReason.map((r) => {
      cum += Math.abs(r.impact)
      return {
        ...r,
        label: r.key,
        /** Short unique axis label — full name stays in tooltip / title */
        axisLabel: exceptionAxisLabel(r.key),
        cumPct: reasonTotal > 0 ? (cum / reasonTotal) * 100 : 0,
      }
    })
  })()

  const custScatter = byCustomer
    .filter((c) => c.key !== '—')
    .slice(0, 40)
    .map((c) => ({
      ...c,
      name: custName.get(c.key) ?? c.key,
      x: c.oldestDays,
      y: c.impact,
      z: Math.max(c.cases, 1),
    }))

  const heatTypes = [
    ...new Set(
      openInView
        .filter((e) => e.shipment_id || e.service_type)
        .map((e) => e.exception_type),
    ),
  ].slice(0, 8)
  const heatCells = SERVICES.flatMap((svc) =>
    heatTypes.map((typ) => {
      const rows = openInView.filter((e) => {
        const s =
          e.service_type ??
          (e.shipment_id ? shipById.get(e.shipment_id)?.service_type : null)
        return s === svc && e.exception_type === typ
      })
      const amount = rows.reduce((a, e) => a + e.financial_impact, 0)
      return {
        service: svc,
        type: typ,
        amount,
        cases: rows.length,
        value: heatMetric === 'amount' ? amount : rows.length,
      }
    }),
  )
  const heatMax = Math.max(...heatCells.map((c) => Math.abs(c.value)), 1)

  const severityRank: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 }
  const actionSource =
    caseScope === 'open_asof' ? exceptions : exceptions.filter((e) => OPEN_STATUSES.has(e.status))
  const prioritized = [...actionSource]
    .map((e) => ({
      ...e,
      ageDays: daysBetween(e.detected_date, asOfDate),
      open: OPEN_STATUSES.has(e.status),
    }))
    .sort((a, b) => {
      const sa = severityRank[a.severity] ?? 9
      const sb = severityRank[b.severity] ?? 9
      if (sa !== sb) return sa - sb
      if (b.financial_impact !== a.financial_impact) return b.financial_impact - a.financial_impact
      return b.ageDays - a.ageDays
    })
    .slice(0, 10)

  const clearLocal = () => {
    setLocalFilters((prev) => ({ ...prev, exceptionType: null, exceptionStatus: null }))
    setBridgeKey(null)
  }

  const volumeMatrix = [
    { metric: 'Total Shipments', value: recon.layers.operations.shipments },
    { metric: 'Billable Shipments', value: recon.layers.operations.billable },
    { metric: 'Billed Shipments', value: recon.actualBilledShipments },
    { metric: 'Billing Lines', value: recon.layers.billing.lines },
  ]
  const dollarMatrix = [
    { metric: 'Expected Charges', value: recon.layers.pricing.expectedCharges },
    { metric: 'Net Billing', value: recon.layers.billing.netAmount },
    { metric: 'Invoice Net', value: recon.layers.finance.invoiceNet },
    { metric: 'Recognized Revenue', value: recon.layers.finance.recognized },
    { metric: 'GL Revenue', value: recon.layers.finance.glRevenue },
  ]

  const statusTotal = statusCounts.reduce((a, c) => a + c.count, 0) || 1
  const recordCountLabel =
    caseScope === 'open_asof'
      ? `Open exception records (${formatNumber(exceptions.length)})`
      : statusFilter || typeFilter
        ? `Filtered records (${formatNumber(exceptions.length)})`
        : `All cases detected in period (${formatNumber(exceptions.length)})`

  return (
    <div className="w-full max-w-none space-y-4">
      <ModuleSubNav items={REVENUE_OPS_NAV} />
      <PageHeader
        path="/reconciliation"
        scope={`Activity ${filters.startPeriod}→${filters.endPeriod} · As-of ${asOfDate.slice(0, 10)} · classes not additive`}
        actions={
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
            onClick={() => exportToCsv('billing_exceptions.csv', exceptions.map((e) => ({ ...e })))}
          >
            Export Exceptions CSV
          </button>
        }
      />

      {recon.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="font-semibold">Data quality · </span>
          {recon.warnings.join(' · ')}
        </div>
      )}

      {/* —— Period reconciliation (ignore caseScope) —— */}
      <section className="space-y-3 rounded-xl border border-[#dce6df] bg-white p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Period reconciliation</h2>
          <span className="text-[10px] text-ink-muted">
            Activity {filters.startPeriod}→{filters.endPeriod} · Expected is gross before discounts
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <CompactKpi
            label="Expected Charges"
            value={formatCurrency(bridge.expected, true)}
            hint="Gross expected · rate card before contractual discounts"
          />
          <CompactKpi
            label="Actual Net Billing"
            value={formatCurrency(bridge.actual, true)}
            hint="Net of discounts & credits · billing lines in window"
          />
          <CompactKpi
            label="Gross-to-net difference"
            value={formatCurrency(bridge.totalGap, true)}
            hint={`${reconStatus.note}${diffPct == null ? '' : ` · ${diffPct.toFixed(1)}% of expected`}`}
            tag={reconStatus.label}
          />
          {Math.abs(unexplained) >= 0.05 ? (
            <CompactKpi
              label="Unexplained Residual"
              value={formatCurrency(unexplained, true)}
              hint="After known commercial, timing & recoverable-class components"
              tag="Investigate"
            />
          ) : (
            <CompactKpi
              label="Period recoverable-class"
              value={formatCurrency(periodRecoverable, true)}
              hint="Bridge missing/rate/surcharge components · ≠ open Potential Recovery"
              tag="Period"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <StatusIndicator tone={reconStatus.tone} label={reconStatus.label} />
            <InfoTip text="Alerts prioritize unexplained residual and recoverable-class variance. Gross-to-net difference includes valid contractual discounts — not leakage by itself." />
          </span>
          <span>Billing line accuracy {formatPercent(recon.billingAccuracy)}</span>
        </div>

        <ChartCard
          icon="reconciliation"
          title="Reconciliation Bridge"
          emphasis
          insight={bridgeInsight}
          subtitle={`Expected → signed adjustments → Actual · ${formatCurrencyPrecise(bridge.totalGap)}`}
          action={
            <div className="flex flex-wrap gap-1">
              {(['full', 'components'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={bridgeMode === mode}
                  onClick={() => setBridgeMode(mode)}
                  className={`rounded-md px-2 py-1 text-[11px] ${
                    bridgeMode === mode ? 'bg-forest text-white' : 'border border-[#dce6df] text-ink-muted'
                  }`}
                >
                  {mode === 'full' ? 'Full Bridge' : 'Variance Components Only'}
                </button>
              ))}
              <button
                type="button"
                className="rounded-md border border-[#dce6df] px-2 py-1 text-[11px] text-ink-muted"
                onClick={() => setShowZeroBridge((v) => !v)}
              >
                {showZeroBridge ? 'Hide zeros' : 'Show zeros'}
              </button>
            </div>
          }
          timeBasis={`${filters.startPeriod} → ${filters.endPeriod}`}
        >
          <p className="mb-2 text-[10px] text-ink-muted">
            Bars use signed semantic colors (green +, red −, amber residual). Taxonomy notes remain in
            tooltips — classes are not additive.
          </p>
          <FloatingWaterfall
            steps={bridgeSteps.map((s) => ({
              key: s.key,
              label: s.label,
              amount: s.amount,
              color: s.color,
              note: bridge.items.find((i) => i.key === s.key)?.note,
            }))}
            height={300}
            totalKeys={bridgeMode === 'full' ? ['expected', 'actual'] : ['total_diff']}
            selectedKey={bridgeKey}
            footingNote={
              bridgeMode === 'full'
                ? bridge.reconciles
                  ? 'Expected + adjustments = Actual Net Billing.'
                  : `Residual ${formatCurrencyPrecise(moneyResidual(bridge))} — not force-filled.`
                : 'Each bar length = component amount; Total Difference = Σ components.'
            }
            filterSummary={`Activity ${filters.startPeriod}→${filters.endPeriod}`}
            onStepClick={(key) => {
              if (key === 'total_diff') return
              setBridgeKey(bridgeKey === key ? null : key)
              const exc = BRIDGE_TO_EXCEPTION[key]
              if (exc) setTypeFilter(typeFilter === exc ? '' : exc)
            }}
          />
          <p className="mt-1 text-[10px] text-ink-muted" title="Period bridge component ≠ open case exposure">
            Period potentially recoverable variance {formatCurrency(periodRecoverable, true)} · Open
            potential recovery (as-of) {formatCurrency(openPotentialRecovery.amount, true)}
          </p>
        </ChartCard>
      </section>

      {/* —— Exception management —— */}
      <section className="space-y-3 rounded-xl border border-[#dce6df] bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Exception management</h2>
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['open_asof', 'Open as of selected date'],
                ['period_detected', 'All cases detected in period'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setCaseScope(id)
                  if (id === 'open_asof' && statusFilter && !OPEN_STATUSES.has(statusFilter)) {
                    setStatusFilter('')
                  }
                }}
                className={`rounded-md px-2 py-1 text-[11px] ${
                  caseScope === id ? 'bg-forest text-white' : 'border border-[#dce6df] text-ink-muted'
                }`}
              >
                {label}
              </button>
            ))}
            <span className="self-center text-[10px] text-ink-muted">As-of {asOfDate.slice(0, 10)}</span>
          </div>
        </div>
        <p className="text-[10px] text-ink-muted">
          {caseScope === 'open_asof'
            ? 'Still-open cases detected on/before as-of. Status history not available — current status only.'
            : 'Cases detected in activity period. Statuses are current (no historical as-of replay).'}
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <CompactKpi
            label="Open Potential Recovery"
            value={formatCurrency(openPotentialRecovery.amount, true)}
            hint={`${openPotentialRecovery.cases} open recoverable-type cases as of ${asOfDate.slice(0, 10)} · unconfirmed`}
            tag="As-of"
          />
          <CompactKpi
            label="Overdue AR"
            value={formatCurrency(overdueExposure.amount, true)}
            hint={`${overdueExposure.cases} open · collections exposure, not revenue`}
            tag={overdueExposure.cases > 0 ? 'Alert' : undefined}
            onClick={() => {
              setCaseScope('open_asof')
              setTypeFilter('Overdue AR')
              setStatusFilter('')
            }}
            active={typeFilter === 'Overdue AR'}
          />
          <CompactKpi
            label="Open Exceptions"
            value={formatNumber(openAsOfCases.length)}
            hint={`Open as of ${asOfDate.slice(0, 10)} · ${formatNumber(scopedExceptions.length)} detected in period`}
          />
        </div>

      {openInView.length === 0 && caseScope === 'open_asof' ? (
        <div className="rounded-lg border border-[#dce6df] bg-[#f7faf8] px-3 py-2 text-sm text-ink">
          No open exceptions as of {asOfDate.slice(0, 10)}
          {typeFilter ? ` · type ${typeFilter}` : ''}.
          <button
            type="button"
            className="ml-2 text-forest underline"
            onClick={() => setCaseScope('period_detected')}
          >
            View cases detected in period
          </button>
        </div>
      ) : openInView.length === 0 ? (
        <div className="rounded-lg border border-[#dce6df] bg-[#f7faf8] px-3 py-2 text-sm text-ink-muted">
          No open cases in the current filtered period view.
        </div>
      ) : (
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <ChartCard
            icon="exceptions"
            iconTone="risk"
            title="Exposure by Reason"
            insight={
              pareto[0]
                ? `${pareto[0].key} is ${formatPercent(
                    reasonTotal ? (Math.abs(pareto[0].impact) / reasonTotal) * 100 : null,
                  )} of open exposure (${pareto[0].cases} cases).`
                : null
            }
            subtitle="Pareto · open exception impact · mutually exclusive types"
            businessQuestion="Which exception rules carry the most open exposure?"
          >
            {pareto.length === 0 ? (
              <p className="py-6 text-center text-xs text-ink-muted">No open exposure for current filters</p>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={pareto} margin={{ top: 4, left: 4, right: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} vertical={false} />
                    <XAxis
                      dataKey="axisLabel"
                      interval={0}
                      height={68}
                      tick={<CategoryTick mode="angle" maxChars={11} fontSize={10} angle={-40} />}
                    />
                    <YAxis
                      yAxisId="amt"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => formatAxisMoney(Number(v))}
                      width={48}
                    />
                    <YAxis
                      yAxisId="pct"
                      orientation="right"
                      domain={[0, 100]}
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => `${v}%`}
                      width={40}
                    />
                    <Tooltip
                      labelFormatter={(_, payload) => {
                        const row = payload?.[0]?.payload as { label?: string } | undefined
                        return row?.label ?? ''
                      }}
                      formatter={(v, name) => [
                        String(name).includes('%')
                          ? formatPercent(Number(v))
                          : formatCurrencyPrecise(Number(v)),
                        String(name),
                      ]}
                    />
                    <Bar
                      yAxisId="amt"
                      dataKey="impact"
                      name="Exposure $"
                      radius={[3, 3, 0, 0]}
                      cursor="pointer"
                      onClick={(d) => {
                        const k = (d as { key?: string })?.key
                        if (k) setTypeFilter(typeFilter === k ? '' : (k as ExceptionType))
                      }}
                    >
                      {pareto.map((r) => (
                        <Cell
                          key={r.key}
                          fill={typeFilter === r.key ? PALETTE.forecast : PALETTE.brand}
                        />
                      ))}
                    </Bar>
                    <Line
                      yAxisId="pct"
                      type="monotone"
                      dataKey="cumPct"
                      name="Cumulative %"
                      stroke={PALETTE.forecast}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        </div>

        <div className="lg:col-span-4">
          <ChartCard
            icon="customers"
            iconTone="customer"
            title="Customer Priority"
            subtitle="X = oldest open case age (detected_date → as-of) · Y = exposure · bubble = cases"
            businessQuestion="Which customers hold unresolved exposure longest?"
          >
            {custScatter.length === 0 ? (
              <p className="py-6 text-center text-xs text-ink-muted">No matching open customer cases</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 8, bottom: 12, left: 8 }}>
                    <CartesianGrid stroke={PALETTE.grid} strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name="Oldest age"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => `${v}d`}
                      label={{ value: 'Oldest case days', position: 'insideBottom', offset: -2, fontSize: 10 }}
                      height={36}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="Exposure"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => formatAxisMoney(Number(v))}
                      width={48}
                    />
                    <ZAxis type="number" dataKey="z" range={[40, 240]} />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.[0]) return null
                        const r = payload[0].payload as (typeof custScatter)[0]
                        return (
                          <div className="rounded border border-[#dce6df] bg-white px-2 py-1 text-xs shadow">
                            <div className="font-semibold">{r.name}</div>
                            <div>
                              {formatCurrency(r.impact, true)} · {r.cases} cases · oldest {r.oldestDays}d
                            </div>
                          </div>
                        )
                      }}
                    />
                    <Scatter
                      data={custScatter}
                      fill={PALETTE.brandMid}
                      cursor="pointer"
                      onClick={(d: unknown) => {
                        const payload = d as { key?: string; payload?: { key?: string } }
                        const id = payload?.payload?.key ?? payload?.key
                        if (id && id !== '—') openCustomer360(id)
                      }}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="mt-1 text-[10px] text-ink-muted">
              Labels omitted for density — hover or click a bubble → Customer 360.
            </p>
          </ChartCard>
        </div>

        <div className="lg:col-span-4">
          <ChartCard
            icon="shipments"
            title="Exposure by Service"
            subtitle="Service × exception type heatmap · Unallocated kept separate"
            action={
              <div className="flex gap-1">
                {(['amount', 'count'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setHeatMetric(m)}
                    className={`rounded-md px-2 py-1 text-[11px] ${
                      heatMetric === m ? 'bg-forest text-white' : 'border border-[#dce6df] text-ink-muted'
                    }`}
                  >
                    {m === 'amount' ? 'Amount' : 'Cases'}
                  </button>
                ))}
              </div>
            }
          >
            {heatTypes.length === 0 ? (
              <p className="py-6 text-center text-xs text-ink-muted">No shipment-linked open exposure</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[280px] border-collapse text-[10px]">
                  <thead>
                    <tr>
                      <th className="p-1 text-left font-semibold text-ink-muted">Service</th>
                      {heatTypes.map((t) => (
                        <th key={t} className="max-w-[72px] truncate p-1 font-semibold text-ink-muted" title={t}>
                          {exceptionAxisLabel(t)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SERVICES.map((svc) => (
                      <tr key={svc}>
                        <td className="p-1 font-medium text-ink">{svc}</td>
                        {heatTypes.map((typ) => {
                          const cell = heatCells.find((c) => c.service === svc && c.type === typ)!
                          const intensity = Math.abs(cell.value) / heatMax
                          const empty = cell.cases === 0
                          return (
                            <td key={typ} className="p-0.5">
                              <button
                                type="button"
                                disabled={empty}
                                title={
                                  empty
                                    ? 'No data'
                                    : `${svc} · ${typ}: ${formatCurrencyPrecise(cell.amount)} · ${cell.cases} cases`
                                }
                                onClick={() => setTypeFilter(typeFilter === typ ? '' : typ)}
                                className={`flex h-8 w-full items-center justify-center rounded ${
                                  empty
                                    ? 'bg-[#f3f5f4] text-[#c5d0c9]'
                                    : 'text-ink hover:ring-1 hover:ring-forest'
                                }`}
                                style={
                                  empty
                                    ? undefined
                                    : {
                                        background: `rgba(18, 60, 53, ${0.12 + intensity * 0.7})`,
                                        color: intensity > 0.55 ? '#fff' : undefined,
                                      }
                                }
                              >
                                {empty
                                  ? '—'
                                  : heatMetric === 'amount'
                                    ? formatAxisMoney(cell.amount)
                                    : formatNumber(cell.cases)}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {invoiceLevel && (
              <p className="mt-2 text-[11px] text-ink-muted">
                Invoice / customer-level (not in heatmap): {formatCurrency(invoiceLevel.impact, true)} ·{' '}
                {invoiceLevel.cases} cases
              </p>
            )}
            {byService.some((s) => s.key === 'Unallocated') && (
              <p className="mt-1 text-[11px] text-amber-800">
                Unallocated kept as-is — not prorated across services.
              </p>
            )}
          </ChartCard>
        </div>
      </div>
      )}

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <ChartCard
            title="Exception Intake vs Resolution"
            subtitle="Cases by calendar month · Detected ≠ Resolved cohort"
          >
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={exceptionTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    allowDecimals={false}
                    width={36}
                    label={{ value: 'Cases', angle: -90, position: 'insideLeft', fontSize: 10 }}
                  />
                  <Tooltip
                    formatter={(v, name) => [formatNumber(Number(v)), String(name)]}
                    labelFormatter={(l) => String(l)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="detected"
                    name="Detected"
                    fill="#123C35"
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="resolved"
                    name="Resolved"
                    fill="#3B6F9E"
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-[10px] text-ink-muted">
              Detected = detected_date · Resolved = resolved_date only (status without date excluded). Same
              month bars are not a batch resolution rate.
            </p>
          </ChartCard>
        </div>
        <div className="lg:col-span-4">
          <ChartCard title="Period outcome summary" subtitle="Separate date bases · not additive">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2" title="Open recoverable-type case impact as of selected date">
                <dt className="text-ink-muted">Open exposure (as-of)</dt>
                <dd className="font-mono font-semibold">
                  {formatCurrency(openPotentialRecovery.amount, true)}
                </dd>
              </div>
              <div
                className="flex justify-between gap-2"
                title={`Sum of financial_impact for cases with resolved_date in ${filters.startPeriod}→${filters.endPeriod}. Case impact sum — categories may overlap underlying amounts; n=${resolvedInPeriod.length}`}
              >
                <dt className="text-ink-muted">Case impact resolved (period)</dt>
                <dd className="font-mono font-semibold">{formatCurrency(resolvedImpactSum, true)}</dd>
              </div>
              <div
                className="flex justify-between gap-2"
                title={`Median (resolved_date − detected_date); n=${resolvedInPeriod.length} with valid timestamps`}
              >
                <dt className="text-ink-muted">Median resolve days</dt>
                <dd className="font-mono font-semibold">
                  {medianResolveDays == null
                    ? 'N/A'
                    : `${medianResolveDays}d (n=${resolvedInPeriod.length})`}
                </dd>
              </div>
              <div className="flex justify-between gap-2" title="No confirmed recovery / cash mapping field on exceptions">
                <dt className="text-ink-muted">Confirmed recovered</dt>
                <dd className="font-mono font-semibold text-ink-muted">Not tracked</dd>
              </div>
            </dl>
          </ChartCard>
        </div>
      </div>

      <ChartCard
        icon="exceptions"
        iconTone="risk"
        title="Exception Detail"
        subtitle={`${recordCountLabel} · status strip matches this list`}
      >
        <div className="mb-1 flex flex-wrap gap-1.5">
          {statusCounts.map((c) => {
            const w = (c.count / statusTotal) * 100
            const active = statusFilter === c.status
            return (
              <button
                key={c.status}
                type="button"
                title={`${c.status}: ${c.count}`}
                onClick={() => setStatusFilter(statusFilter === c.status ? '' : c.status)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
                  active ? 'border-forest bg-brand-50 ring-1 ring-forest/30' : 'border-[#dce6df] bg-white'
                }`}
              >
                <span
                  className={`h-2.5 w-2.5 rounded-sm ${
                    OPEN_STATUSES.has(c.status)
                      ? 'bg-amber-400'
                      : c.status === 'Resolved'
                        ? 'bg-emerald-500'
                        : 'bg-[#9bb0a8]'
                  }`}
                  style={{ minWidth: 10 }}
                />
                <span className="font-medium text-ink">{c.status}</span>
                <span className="font-mono tabular-nums text-ink-muted">{c.count}</span>
                <span className="text-[9px] text-ink-muted">({w.toFixed(0)}%)</span>
              </button>
            )
          })}
        </div>
        {(typeFilter || statusFilter) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {typeFilter && (
              <button
                type="button"
                className="rounded-full border border-[#dce6df] bg-[#f7faf8] px-2 py-0.5 text-[11px]"
                onClick={() => setTypeFilter('')}
              >
                Type: {typeFilter} ×
              </button>
            )}
            {statusFilter && (
              <button
                type="button"
                className="rounded-full border border-[#dce6df] bg-[#f7faf8] px-2 py-0.5 text-[11px]"
                onClick={() => setStatusFilter('')}
              >
                Status: {statusFilter} ×
              </button>
            )}
            <button type="button" className="text-[11px] text-forest underline" onClick={clearLocal}>
              Clear filters
            </button>
          </div>
        )}

        {traced && (
          <TraceChain
            e={traced}
            customer={traced.customer_id ? custName.get(traced.customer_id) ?? traced.customer_id : null}
            onClose={() => setTraceId(null)}
            onOpenRecord={() => navigateToEntity('exception', traced.exception_id, traced.exception_type)}
            onCustomer={traced.customer_id ? () => openCustomer360(traced.customer_id!) : undefined}
            onSource={(type, id) => navigateToEntity(type, id, id)}
          />
        )}

        {caseScope === 'open_asof' && prioritized.length === 0 ? null : prioritized.length > 0 ? (
          <div className="mt-2">
            <OneLineInsight>
              Top {prioritized.length} by severity → impact → age (detected_date → as-of).
            </OneLineInsight>
            <DataTable
              rows={prioritized.map((e) => ({ ...e, id: e.exception_id }))}
              rowKey={(r) => r.exception_id}
              selectedKey={traceId}
              searchable={false}
              defaultPageSize={10}
              onRowClick={(r) => setTraceId(traceId === r.exception_id ? null : r.exception_id)}
              columns={[
                {
                  key: 'cust',
                  header: 'Customer',
                  render: (r) =>
                    r.customer_id ? custName.get(r.customer_id) ?? r.customer_id : 'Unassigned',
                },
                { key: 'type', header: 'Exception', render: (r) => r.exception_type },
                {
                  key: 'imp',
                  header: 'Impact',
                  align: 'right',
                  render: (r) => formatCurrencyPrecise(r.financial_impact),
                  sortValue: (r) => r.financial_impact,
                },
                {
                  key: 'age',
                  header: 'Age',
                  align: 'right',
                  render: (r) => `${r.ageDays}d`,
                  sortValue: (r) => r.ageDays,
                },
                {
                  key: 'owner',
                  header: 'Owner',
                  render: (r) => r.owner || 'Unassigned',
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (r) => (
                    <select
                      className="filter-input py-0.5 text-xs"
                      value={r.status}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        updateExceptionStatus(r.exception_id, e.target.value as ExceptionStatus)
                      }
                    >
                      {ALL_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  ),
                },
                {
                  key: 'next',
                  header: 'Next action',
                  render: (r) => (
                    <span className="block max-w-[140px] truncate" title={r.recommended_action || 'Not recorded'}>
                      {r.recommended_action || 'Not recorded'}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">No action rows for current filters.</p>
        )}

        <Collapsible
          title={recordCountLabel}
          subtitle="Same scope as status strip · click to trace"
          defaultOpen={
            hasLocal ||
            openEntity?.entityType === 'exception' ||
            caseScope === 'period_detected'
          }
        >
          <div className="mb-2">
            <select
              className="filter-input"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as ExceptionType | '')}
              aria-label="Exception type"
            >
              <option value="">All types</option>
              {ALL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <DataTable
            rows={exceptions.map((e) => ({ ...e, id: e.exception_id }))}
            rowKey={(r) => r.exception_id}
            selectedKey={traceId}
            onRowClick={(r) => setTraceId(traceId === r.exception_id ? null : r.exception_id)}
            columns={[
              { key: 'id', header: 'Exception ID', render: (r) => r.exception_id },
              { key: 'type', header: 'Type', render: (r) => r.exception_type },
              {
                key: 'cust',
                header: 'Customer',
                render: (r) =>
                  r.customer_id ? custName.get(r.customer_id) ?? r.customer_id : '—',
              },
              {
                key: 'src',
                header: 'Source',
                render: (r) => r.shipment_id ?? r.invoice_id ?? r.billing_line_id ?? '—',
              },
              {
                key: 'imp',
                header: 'Impact',
                align: 'right',
                render: (r) => formatCurrencyPrecise(r.financial_impact),
                sortValue: (r) => r.financial_impact,
              },
              { key: 'nature', header: 'Nature', render: (r) => classifyExceptionNature(r).category },
              { key: 'sev', header: 'Severity', render: (r) => r.severity },
              { key: 'owner', header: 'Owner', render: (r) => r.owner },
              { key: 'status', header: 'Status', render: (r) => r.status },
            ]}
          />
        </Collapsible>
      </ChartCard>
      </section>

      <Collapsible
        title="Exception Registry"
        subtitle="Definitions shared across Executive, Lifecycle, Reconciliation and Customer 360"
      >
        <DataTable
          rows={registryRows}
          rowKey={(r) => r.typeId}
          selectedKey={typeFilter ? EXCEPTION_REGISTRY[typeFilter]?.typeId : null}
          onRowClick={(r) => setTypeFilter(typeFilter === r.type ? '' : r.type)}
          columns={[
            { key: 't', header: 'Type', render: (r) => r.type },
            { key: 'd', header: 'Definition', render: (r) => r.definition },
            { key: 'cls', header: 'Exposure class', render: (r) => r.exposureClass },
            {
              key: 'n',
              header: 'Open / Total',
              align: 'right',
              render: (r) => `${r.open} / ${r.total}`,
              sortValue: (r) => r.total,
            },
            {
              key: 'x',
              header: 'Open exposure',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.openExposure),
              sortValue: (r) => r.openExposure,
            },
          ]}
        />
      </Collapsible>

      <Collapsible title="Layer reconciliation detail" subtitle="Package and dollar layers">
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Volume Reconciliation (packages)"
            subtitle="Package counts only — separate axis from dollars"
          >
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={volumeMatrix}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                  <XAxis
                    dataKey="metric"
                    interval={0}
                    height={56}
                    tick={<CategoryTick mode="angle" maxChars={10} fontSize={10} />}
                  />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatNumber(Number(v))} width={52} />
                  <Tooltip formatter={(v) => formatNumber(Number(v))} />
                  <Bar
                    isAnimationActive={false}
                    dataKey="value"
                    name="Packages / lines"
                    fill="#123C35"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
          <ChartCard
            title="Dollar Layers (USD)"
            subtitle="Different date bases — compare, do not subtract as loss"
          >
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dollarMatrix}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                  <XAxis
                    dataKey="metric"
                    interval={0}
                    height={56}
                    tick={<CategoryTick mode="angle" maxChars={10} fontSize={10} />}
                  />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatAxisMoney(Number(v))} width={56} />
                  <Tooltip formatter={(v) => formatCurrencyPrecise(Number(v))} />
                  <Bar
                    isAnimationActive={false}
                    dataKey="value"
                    name="USD"
                    fill="#00A86B"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
        <div className="mt-3">
          <DataTable
            rows={rollups.map((r) => ({ ...r, id: r.rootCauseKey }))}
            rowKey={(r) => r.rootCauseKey}
            selectedKey={typeFilter || null}
            onRowClick={(r) =>
              setTypeFilter(typeFilter === r.exceptionType ? '' : (r.exceptionType as ExceptionType))
            }
            columns={[
              { key: 't', header: 'Type', render: (r) => r.exceptionType },
              { key: 'c', header: 'Cases', align: 'right', render: (r) => formatNumber(r.cases) },
              {
                key: 'o',
                header: 'Open Exposure',
                align: 'right',
                render: (r) => formatCurrencyPrecise(r.openExposure),
              },
              {
                key: 'r',
                header: 'Recoverable',
                align: 'right',
                render: (r) => formatCurrencyPrecise(r.recoverable),
              },
              { key: 'own', header: 'Owner', render: (r) => r.owner },
            ]}
          />
        </div>
      </Collapsible>

      <p className="text-[11px] text-ink-muted">
        Gross-to-net · period recoverable-class · open Potential Recovery · overdue AR are different
        measures and are not additive. Confirmed recovered is not tracked without a recovery mapping.
      </p>
    </div>
  )
}

function TraceChain({
  e,
  customer,
  onClose,
  onOpenRecord,
  onCustomer,
  onSource,
}: {
  e: FactException
  customer: string | null
  onClose: () => void
  onOpenRecord: () => void
  onCustomer?: () => void
  onSource?: (type: 'shipment' | 'billing_line' | 'invoice', id: string) => void
}) {
  const nature = classifyExceptionNature(e)
  const steps = [
    {
      k: 'Source Record',
      v:
        [
          e.shipment_id && `Shipment ${e.shipment_id}`,
          e.billing_line_id && `Line ${e.billing_line_id}`,
          e.invoice_id && `Invoice ${e.invoice_id}`,
        ]
          .filter(Boolean)
          .join(' · ') || (customer ? `Customer ${customer}` : '—'),
    },
    {
      k: 'Calculation',
      v: `Expected ${formatCurrencyPrecise(e.expected_amount)} − Actual ${formatCurrencyPrecise(e.actual_amount)} = ${formatCurrencyPrecise(e.difference)}`,
    },
    { k: 'Exception Rule', v: e.trigger_rule },
    {
      k: 'Financial Impact',
      v: `${formatCurrencyPrecise(e.financial_impact)} · ${nature.category}`,
    },
    {
      k: 'Status',
      v: `${e.status} · ${e.owner}${e.resolution_notes ? ` · ${e.resolution_notes}` : ''}`,
    },
  ]
  return (
    <div className="my-3 rounded-xl border border-forest/20 bg-[#f7faf8] p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">
            Trace · {e.exception_id}
          </p>
          <p className="text-xs font-semibold text-ink">
            {e.exception_type}
            {customer ? ` · ${customer}` : ''}
          </p>
          <p className="text-xs text-ink-muted">
            {nature.note} Root cause: {e.root_cause}
          </p>
        </div>
        <div className="flex gap-1.5">
          {onCustomer && (
            <button
              type="button"
              className="rounded-md border border-[#dce6df] bg-white px-2 py-1 text-[13px]"
              onClick={onCustomer}
            >
              Customer 360 →
            </button>
          )}
          <button
            type="button"
            className="rounded-md bg-forest px-2 py-1 text-[13px] text-white"
            onClick={onOpenRecord}
          >
            Open record
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[13px] text-ink-muted hover:bg-white"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>
      <ol className="grid gap-1.5 md:grid-cols-5">
        {steps.map((st, i) => (
          <li key={st.k} className="rounded-lg border border-[#dce6df] bg-white px-2 py-1.5 text-[13px]">
            <p className="text-xs font-semibold uppercase text-brand-600">
              {i + 1}. {st.k}
            </p>
            <p className="mt-0.5 break-words font-mono text-xs text-ink">{st.v}</p>
          </li>
        ))}
      </ol>
      {onSource && (e.shipment_id || e.billing_line_id || e.invoice_id) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-ink-muted">Open source record:</span>
          {e.shipment_id && (
            <button
              type="button"
              className="rounded border border-[#dce6df] bg-white px-1.5 py-0.5 font-mono hover:border-brand-400"
              onClick={() => onSource('shipment', e.shipment_id!)}
            >
              Shipment {e.shipment_id}
            </button>
          )}
          {e.billing_line_id && (
            <button
              type="button"
              className="rounded border border-[#dce6df] bg-white px-1.5 py-0.5 font-mono hover:border-brand-400"
              onClick={() => onSource('billing_line', e.billing_line_id!)}
            >
              Line {e.billing_line_id}
            </button>
          )}
          {e.invoice_id && (
            <button
              type="button"
              className="rounded border border-[#dce6df] bg-white px-1.5 py-0.5 font-mono hover:border-brand-400"
              onClick={() => onSource('invoice', e.invoice_id!)}
            >
              Invoice {e.invoice_id}
            </button>
          )}
        </div>
      )}
      <p className="mt-2 text-xs text-ink-muted">Recommended: {e.recommended_action}</p>
    </div>
  )
}
