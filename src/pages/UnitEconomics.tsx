import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { WrapTick } from '@/components/charts/WrapTick'
import {
  computeCostDrivers,
  computeUnitEconomics,
  VARIABLE_COST_TYPES,
  type UnitEconDimension,
} from '@/calc/unitEconomics'
import { ModuleSubNav } from '@/components/layout/ModuleSubNav'
import { PageHeader } from '@/components/common/PageHeader'
import { PROFITABILITY_NAV, PALETTE } from '@/lib/icons'
import { FloatingWaterfall } from '@/components/charts/FloatingWaterfall'
import { StatTile } from '@/components/common/StatTile'
import { ChartCard } from '@/components/common/ChartCard'
import { Collapsible } from '@/components/common/Collapsible'
import { DataTable } from '@/components/common/DataTable'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { formatCurrency, formatCurrencyPrecise, formatNumber, formatPercent } from '@/lib/money'
import type { GlobalFilters, ServiceType } from '@/types'

type SelectDim = 'service' | 'metro' | 'customer'
interface LocalSelection {
  dim: SelectDim
  key: string
  label: string
}
type StackMetric = 'stack' | 'rpp' | 'cpp' | 'cpkg' | 'cm' | 'contrib'

const STACK_METRICS: { id: StackMetric; label: string }[] = [
  { id: 'stack', label: 'Cost + Contribution = RPP' },
  { id: 'rpp', label: 'Revenue / pkg' },
  { id: 'cpp', label: 'Cost / pkg' },
  { id: 'cpkg', label: 'Contribution / pkg' },
  { id: 'cm', label: 'CM %' },
  { id: 'contrib', label: 'Total Contribution $' },
]

/** Non-DSP cost types in neutral grays — cost is normal business, not an anomaly */
const COST_GRAYS = ['#5F6F68', '#7E8F88', '#9DADA6', '#B9C7C1', '#D3DDD8', '#E5ECE8']

function applySelection(filters: GlobalFilters, sel: LocalSelection | null): GlobalFilters {
  if (!sel) return filters
  if (sel.dim === 'service') return { ...filters, serviceTypes: [sel.key as ServiceType] }
  if (sel.dim === 'metro') return { ...filters, metros: [sel.key] }
  return { ...filters, customerIds: [sel.key] }
}

export function UnitEconomics({
  focusDim = 'service',
  pagePath = '/profitability/unit',
}: {
  focusDim?: UnitEconDimension
  pagePath?: string
}) {
  const { data, filters, setHighlightCustomerId, openEntityDrawer, navigateWithContext } =
    useApp()
  const [dimension, setDimension] = useState<UnitEconDimension>(focusDim)
  useEffect(() => {
    setDimension(focusDim)
    if (focusDim === 'customer' || focusDim === 'metro' || focusDim === 'service') {
      setCostDim(focusDim)
    }
  }, [focusDim])
  const [stackMetric, setStackMetric] = useState<StackMetric>('stack')
  const [fixedScenario, setFixedScenario] = useState<'Base' | 'Downside'>('Base')
  const [selection, setSelection] = useState<LocalSelection | null>(null)
  const [costDim, setCostDim] = useState<'service' | 'metro' | 'customer' | 'dsp'>(
    focusDim === 'customer' || focusDim === 'metro' || focusDim === 'service' ? focusDim : 'service',
  )

  // Local selection narrows this page only (not the global filter bar)
  const scoped = useMemo(() => applySelection(filters, selection), [filters, selection])
  const econ = useMemo(
    () => computeUnitEconomics(data, scoped, dimension, fixedScenario),
    [data, scoped, dimension, fixedScenario],
  )
  // Each ranking ignores its own selection (so the selected item stays visible) but honors the others
  const rankFilters = (dim: SelectDim) => (selection && selection.dim !== dim ? scoped : filters)
  const svcFilters = rankFilters('service')
  const metroFilters = rankFilters('metro')
  const custFilters = rankFilters('customer')
  const svcRank = useMemo(() => computeUnitEconomics(data, svcFilters, 'service').byDimension, [data, svcFilters])
  const metroRank = useMemo(() => computeUnitEconomics(data, metroFilters, 'metro').byDimension, [data, metroFilters])
  const custRank = useMemo(() => computeUnitEconomics(data, custFilters, 'customer').byDimension, [data, custFilters])

  const trend = useMemo(() => {
    const periods = [
      ...new Set(
        data.dates.map((d) => d.date_key.slice(0, 7)).filter((p) => p >= scoped.startPeriod && p <= scoped.endPeriod),
      ),
    ].sort()
    return periods.map((period) => {
      const slice = computeUnitEconomics(data, { ...scoped, startPeriod: period, endPeriod: period }, 'month')
      return {
        period,
        revenue: slice.netRevenue,
        variableCost: slice.netRevenue - slice.contributionProfit,
        contribution: slice.contributionProfit,
      }
    })
  }, [data, scoped])

  const select = (dim: SelectDim, key: string, label: string) => {
    if (key === 'NA') return
    if (selection?.dim === dim && selection.key === key) {
      setSelection(null)
      return
    }
    setSelection({ dim, key, label })
    if (dim === 'customer') setHighlightCustomerId(key)
  }

  const contributionPerPkg =
    econ.revenuePerPackage != null && econ.variableCostPerPackage != null
      ? econ.revenuePerPackage - econ.variableCostPerPackage
      : null

  const stackRows = econ.byDimension
    .filter((d) => d.key !== 'NA' && d.rpp != null && d.cpp != null)
    .slice(0, 14)
    .map((d) => {
      const contrib = d.revenue - d.variableCost
      return {
        label: d.label.length > 14 ? `${d.label.slice(0, 12)}…` : d.label,
        fullLabel: d.label,
        key: d.key,
        cpp: d.cpp ?? 0,
        cpkg: (d.rpp ?? 0) - (d.cpp ?? 0),
        rpp: d.rpp ?? 0,
        cm: d.margin ?? 0,
        contrib: Math.round(contrib * 100) / 100,
      }
    })
    .sort((a, b) => (stackMetric === 'stack' ? b.rpp - a.rpp : (b[stackMetric] as number) - (a[stackMetric] as number)))

  const selectableDim: SelectDim | null =
    dimension === 'service' || dimension === 'metro' || dimension === 'customer' ? dimension : null
  const stackFmt = (v: number) =>
    stackMetric === 'cm'
      ? formatPercent(v)
      : stackMetric === 'contrib'
        ? formatCurrencyPrecise(v)
        : formatCurrencyPrecise(v)

  const variableDrivers = econ.costBreakdown
    .filter((c) => c.type !== 'Allocated Fixed')
    .sort((a, b) => b.amount - a.amount)
  const totalVar = variableDrivers.reduce((a, c) => a + c.amount, 0)
  const unprofitable = econ.byDimension.filter((d) => (d.margin ?? 0) < 0)

  // Cost drivers by dimension (rankings honor the other selection, like the profitability rankings)
  const costDimFilters = selection && selection.dim !== costDim ? scoped : filters
  const drivers = useMemo(() => computeCostDrivers(data, costDimFilters, costDim), [data, costDimFilters, costDim])
  const companyUnit = useMemo(() => computeCostDrivers(data, filters, 'company')[0] ?? null, [data, filters])
  const selectedUnit = useMemo(
    () => (selection ? (computeCostDrivers(data, scoped, 'company')[0] ?? null) : null),
    [data, scoped, selection],
  )
  // DSP dimension: only cost types that carry dsp_id can be attributed
  const dspTaggedTypes = useMemo(
    () => new Set(data.costs.filter((c) => c.dsp_id).map((c) => c.cost_type)),
    [data.costs],
  )
  const driverTypes = VARIABLE_COST_TYPES.filter((t) => costDim !== 'dsp' || dspTaggedTypes.has(t))
  const driverRows = [
    ...(companyUnit ? [{ ...companyUnit, label: 'Company avg', key: '__company' }] : []),
    ...drivers.slice(0, 10),
  ].map((d) => ({
    label: d.label.length > 16 ? `${d.label.slice(0, 14)}…` : d.label,
    fullLabel: d.label,
    key: d.key,
    rpp: d.rpp,
    cpkg: d.contributionPerPackage,
    ...Object.fromEntries(driverTypes.map((t) => [t, d.perPackage[t] ?? 0])),
  }))
  const unit = selectedUnit ?? companyUnit

  // Computed insights
  const byCpkg = [...stackRows].sort((a, b) => b.cpkg - a.cpkg)
  const stackInsight =
    byCpkg.length >= 2
      ? `${byCpkg[0].fullLabel} earns the most per package (${formatCurrencyPrecise(byCpkg[0].cpkg)} contribution on ${formatCurrencyPrecise(byCpkg[0].rpp)} revenue); ${byCpkg[byCpkg.length - 1].fullLabel} the least (${formatCurrencyPrecise(byCpkg[byCpkg.length - 1].cpkg)}).`
      : null
  const dspShare =
    companyUnit && companyUnit.totalCostPerPackage
      ? ((companyUnit.perPackage['DSP Delivery'] ?? 0) / companyUnit.totalCostPerPackage) * 100
      : null
  const topDspKey = [...drivers].sort((a, b) => (b.perPackage['DSP Delivery'] ?? 0) - (a.perPackage['DSP Delivery'] ?? 0))[0]
  const costInsight =
    dspShare != null
      ? `DSP Delivery is ${formatPercent(dspShare)} of variable cost per package${topDspKey ? `; highest DSP cost/pkg: ${topDspKey.label} (${formatCurrencyPrecise(topDspKey.perPackage['DSP Delivery'] ?? 0)})` : ''}.`
      : null
  const drillInsight =
    selection && selectedUnit && companyUnit && selectedUnit.contributionPerPackage != null && companyUnit.contributionPerPackage != null
      ? `${selection.label}: contribution ${formatCurrencyPrecise(selectedUnit.contributionPerPackage)}/pkg vs company ${formatCurrencyPrecise(companyUnit.contributionPerPackage)} (${selectedUnit.contributionPerPackage >= companyUnit.contributionPerPackage ? '+' : '−'}${formatCurrencyPrecise(Math.abs(selectedUnit.contributionPerPackage - companyUnit.contributionPerPackage))}).`
      : companyUnit && companyUnit.contributionPerPackage != null && companyUnit.rpp
        ? `Company keeps ${formatCurrencyPrecise(companyUnit.contributionPerPackage)} of every ${formatCurrencyPrecise(companyUnit.rpp)} billed per package (${formatPercent((companyUnit.contributionPerPackage / companyUnit.rpp) * 100)}).`
        : null
  const plug = econ.profitBridge.find((b) => b.key === 'mix')?.amount ?? 0
  const startC = econ.profitBridge.find((b) => b.key === 'start')?.amount ?? 0
  const endC = econ.profitBridge.find((b) => b.key === 'end_contrib')?.amount ?? 0
  const bridgeInsight =
    endC !== startC
      ? `Contribution moved ${endC >= startC ? '+' : '−'}${formatCurrency(Math.abs(endC - startC), true)} between the early and late half; ${formatCurrency(plug, true)} of it is unexplained mix / residual.`
      : null
  const unitSteps = unit
    ? [
        { key: 'rpp', label: 'Revenue / pkg', amount: unit.rpp ?? 0 },
        ...VARIABLE_COST_TYPES.map((t) => ({ key: t, label: t, amount: -(unit.perPackage[t] ?? 0) })),
        { key: 'cpkg', label: 'Contribution / pkg', amount: unit.contributionPerPackage ?? 0 },
      ]
    : []

  return (
    <div className="space-y-5">
      <ModuleSubNav items={PROFITABILITY_NAV} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader path={pagePath} scope="Contribution (before fixed) ≠ Operating Profit (after allocated fixed)" />
        <div className="flex flex-wrap items-center gap-2">
          {selection && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[13px] text-forest ring-1 ring-forest/20">
              Local selection: {selection.dim} = <strong>{selection.label}</strong>
              <button
                type="button"
                aria-label="Clear local selection"
                className="ml-1 rounded-full px-1 hover:bg-white"
                onClick={() => setSelection(null)}
              >
                ×
              </button>
            </span>
          )}
          {selection && (
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
              onClick={() =>
                navigateWithContext('/customers', {
                  ...(selection.dim === 'customer'
                    ? { customerId: selection.key }
                    : selection.dim === 'metro'
                      ? { metro: selection.key }
                      : { serviceType: selection.key as ServiceType }),
                  sourcePage: '/unit-economics',
                })
              }
            >
              Customers in {selection.label} →
            </button>
          )}
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
            onClick={() =>
              exportToCsv('cost_profitability.csv', [
                {
                  scope: selection ? `${selection.dim}=${selection.label}` : 'filters',
                  net_revenue: econ.netRevenue,
                  contribution_profit: econ.contributionProfit,
                  contribution_margin: econ.contributionMargin,
                  operating_profit: econ.operatingProfit,
                  rpp: econ.revenuePerPackage,
                  cpp: econ.variableCostPerPackage,
                },
                ...econ.byDimension,
              ])
            }
          >
            Export Cost & Profitability
          </button>
        </div>
      </div>

      {/* Level 1 — contribution view */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1.25fr))_repeat(2,minmax(0,1fr))]">
        <Stat
          primary
          label="Revenue / Package"
          value={econ.revenuePerPackage != null ? formatCurrencyPrecise(econ.revenuePerPackage) : 'N/A'}
          hint={`${formatCurrency(econ.netRevenue, true)} Net Billing ÷ ${formatNumber(econ.billablePackages)} billed pkgs`}
        />
        <Stat
          primary
          label="Variable Cost / Package"
          value={econ.variableCostPerPackage != null ? formatCurrencyPrecise(econ.variableCostPerPackage) : 'N/A'}
          hint="DSP, sort, linehaul, redelivery, claims, other"
        />
        <Stat
          primary
          label="Contribution / Package"
          value={contributionPerPkg != null ? formatCurrencyPrecise(contributionPerPkg) : 'N/A'}
          hint="RPP − CPP"
          tone={contributionPerPkg == null ? undefined : contributionPerPkg >= 0 ? 'good' : 'bad'}
        />
        <Stat
          label="Contribution Margin"
          value={formatPercent(econ.contributionMargin)}
          hint="Before fixed allocation"
          tone={econ.contributionMargin == null ? undefined : econ.contributionMargin >= 28 ? 'good' : econ.contributionMargin >= 22 ? 'warn' : 'bad'}
        />
        <button
          type="button"
          className="text-left"
          onClick={() => openEntityDrawer({ entityType: 'kpi', entityId: 'contribution_margin', label: 'Contribution Margin' })}
        >
          <Stat label="Contribution Profit" value={formatCurrency(econ.contributionProfit, true)} hint="Net Billing − variable cost · click for lineage" />
        </button>
      </div>

      {/* Fixed allocation kept visually separate from contribution */}
      <div
        className={`rounded-xl border px-4 py-3 text-xs ${
          econ.fixedAllocation.contributionCoversFixed
            ? 'border-brand-200 bg-brand-50 text-forest'
            : 'border-amber-200 bg-amber-50 text-amber-950'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-4">
            <p>
              <span className="text-xs font-semibold uppercase">Allocated Fixed</span>{' '}
              <span className="font-mono text-sm font-semibold">{formatCurrency(econ.allocatedFixed, true)}</span>
            </p>
            <p>
              <span className="text-xs font-semibold uppercase">Operating Profit (fully allocated)</span>{' '}
              <span className={`font-mono text-sm font-semibold ${econ.operatingProfit < 0 ? 'text-danger' : ''}`}>
                {formatCurrency(econ.operatingProfit, true)}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold uppercase">Fixed pool</span>
            {(['Base', 'Downside'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFixedScenario(s)}
                className={`rounded-md px-2 py-1 text-[13px] font-medium ${
                  fixedScenario === s ? 'bg-forest text-white' : 'border border-[#dce6df] bg-white text-ink'
                }`}
              >
                {s} {formatCurrency(s === 'Base' ? data.meta.fixed_opex_pool_monthly_base : data.meta.fixed_opex_pool_monthly_downside, true)}/mo
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 opacity-90">
          {econ.fixedAllocation.basis} Operating Profit is not an incremental customer P&L.
        </p>
        {!econ.fixedAllocation.contributionCoversFixed && (
          <p className="mt-1 font-medium">
            Contribution {formatCurrency(econ.contributionProfit, true)} does not cover allocated fixed{' '}
            {formatCurrency(econ.allocatedFixed, true)} in this scope.
          </p>
        )}
      </div>

      {/* Level 2 — unit stack */}
      <ChartCard
        icon="contribution"
        title="Unit Stack by Dimension"
        emphasis
        insight={stackInsight}
        businessQuestion="How do cost and contribution make up revenue per package?"
        subtitle={
          stackMetric === 'stack'
            ? 'Variable Cost / pkg + Contribution / pkg = Revenue / pkg · negative contribution drawn below zero'
            : 'Ranked by selected metric'
        }
        formula="RPP = Net Billing ÷ billed packages; CPP = variable cost ÷ billed packages"
        source="fact_billing_line, fact_cost (variable types)"
        action={
          <div className="flex flex-wrap gap-1">
            <select
              className="filter-input"
              value={dimension}
              onChange={(e) => setDimension(e.target.value as UnitEconDimension)}
              aria-label="Dimension"
            >
              {(['service', 'metro', 'customer', 'region', 'zone', 'dsp', 'month'] as const).map((d) => (
                <option key={d} value={d}>
                  By {d}
                </option>
              ))}
            </select>
            <select
              className="filter-input"
              value={stackMetric}
              onChange={(e) => setStackMetric(e.target.value as StackMetric)}
              aria-label="Metric"
            >
              {STACK_METRICS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {stackRows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-xs text-ink-muted">
            No billed packages in scope
          </p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stackRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="fullLabel" tick={<WrapTick maxChars={12} />} interval={0} height={44} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) =>
                    stackMetric === 'cm'
                      ? `${v}%`
                      : stackMetric === 'contrib'
                        ? `$${(Number(v) / 1000).toFixed(0)}k`
                        : `$${Number(v).toFixed(2)}`
                  }
                />
                <ReferenceLine y={0} stroke="#9bb0a8" />
                <Tooltip
                  formatter={(v, name) => [stackFmt(Number(v)), String(name)]}
                  labelFormatter={(_, p) => {
                    const row = p?.[0]?.payload as { fullLabel?: string; rpp?: number } | undefined
                    return row ? `${row.fullLabel} · RPP ${formatCurrencyPrecise(row.rpp ?? 0)}` : ''
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {stackMetric === 'stack' ? (
                  <>
                    <Bar isAnimationActive={false} dataKey="cpp" stackId="rpp" name="Variable Cost / pkg" fill={PALETTE.cost} cursor={selectableDim ? 'pointer' : undefined}
                      onClick={(d) => {
                        const r = d as unknown as { key?: string; fullLabel?: string }
                        if (selectableDim && r.key) select(selectableDim, r.key, r.fullLabel ?? r.key)
                      }}
                    />
                    <Bar isAnimationActive={false} dataKey="cpkg" stackId="rpp" name="Contribution / pkg (red if negative)" fill={PALETTE.positive} cursor={selectableDim ? 'pointer' : undefined}
                      onClick={(d) => {
                        const r = d as unknown as { key?: string; fullLabel?: string }
                        if (selectableDim && r.key) select(selectableDim, r.key, r.fullLabel ?? r.key)
                      }}
                    >
                      {stackRows.map((r) => (
                        <Cell key={r.key} fill={r.cpkg < 0 ? PALETTE.critical : PALETTE.positive} />
                      ))}
                    </Bar>
                  </>
                ) : (
                  <Bar isAnimationActive={false}
                    dataKey={stackMetric}
                    name={STACK_METRICS.find((m) => m.id === stackMetric)?.label}
                    radius={[4, 4, 0, 0]}
                    cursor={selectableDim ? 'pointer' : undefined}
                    onClick={(d) => {
                      const r = d as unknown as { key?: string; fullLabel?: string }
                      if (selectableDim && r.key) select(selectableDim, r.key, r.fullLabel ?? r.key)
                    }}
                  >
                    {stackRows.map((r) => (
                      <Cell
                        key={r.key}
                        fill={
                          selection?.dim === selectableDim && selection?.key === r.key
                            ? '#123C35'
                            : stackMetric === 'cpp'
                              ? PALETTE.cost
                              : (r[stackMetric] as number) < 0
                                ? '#C44536'
                                : '#00A86B'
                        }
                      />
                    ))}
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {selectableDim && <p className="mt-1 text-xs text-ink-muted">Click a bar to select it — the page re-scopes to that {selectableDim}.</p>}
      </ChartCard>

      {/* Level 3 — profitability rankings (cross-filtering) */}
      <div className="grid gap-4 lg:grid-cols-3">
        {(
          [
            ['service', 'Service Profitability', 'Which services earn the most contribution?', svcRank],
            ['metro', 'Metro Profitability', 'Which metros are most / least profitable?', metroRank],
            ['customer', 'Customer Profitability', 'Which customers drive or drain contribution?', custRank],
          ] as const
        ).map(([dim, title, q, rows]) => (
          <ChartCard key={dim} icon="contribution" title={title} businessQuestion={q} subtitle="Contribution $ · CM% · click to cross-filter">
            <ProfitRanking
              rows={rows.filter((r) => r.key !== 'NA').slice(0, 8)}
              selectedKey={selection?.dim === dim ? selection.key : null}
              onSelect={(key, label) => select(dim, key, label)}
            />
          </ChartCard>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          icon="costBreakdown"
          title="Cost Driver Breakdown"
          insight={costInsight}
          businessQuestion="Which cost lines consume revenue per package — and where is DSP cost highest?"
          subtitle={`Variable cost per billed package by type · total ${formatCurrency(totalVar, true)} · allocated fixed excluded`}
          action={
            <select className="filter-input" value={costDim} onChange={(e) => setCostDim(e.target.value as typeof costDim)} aria-label="Cost dimension">
              <option value="service">By Service</option>
              <option value="metro">By Metro</option>
              <option value="customer">By Customer</option>
              <option value="dsp">By DSP</option>
            </select>
          }
        >
          {costDim === 'dsp' && (
            <p className="mb-1 text-xs text-ink-muted">
              DSP view shows only cost types tagged with a DSP ({driverTypes.join(', ') || 'none'}); other costs are not attributable to a DSP and are omitted rather than allocated.
            </p>
          )}
          <div style={{ height: Math.max(180, driverRows.length * 24 + 50) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={driverRows} layout="vertical" margin={{ left: 4, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v) => `$${Number(v).toFixed(2)}`} />
                <YAxis type="category" dataKey="label" width={104} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(v, name) => [formatCurrencyPrecise(Number(v)), String(name)]}
                  labelFormatter={(_, p) => {
                    const r = p?.[0]?.payload as { fullLabel?: string; rpp?: number | null; cpkg?: number | null } | undefined
                    return r ? `${r.fullLabel} · RPP ${r.rpp == null ? '—' : formatCurrencyPrecise(r.rpp)} · Contribution/pkg ${r.cpkg == null ? '—' : formatCurrencyPrecise(r.cpkg)}` : ''
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {driverTypes.map((t, i) => (
                  <Bar isAnimationActive={false}
                    key={t}
                    dataKey={t}
                    stackId="c"
                    name={t}
                    fill={t === 'DSP Delivery' ? PALETTE.brand : COST_GRAYS[i % COST_GRAYS.length]}
                    cursor={costDim !== 'dsp' ? 'pointer' : undefined}
                    onClick={(d) => {
                      const r = d as unknown as { key?: string; fullLabel?: string }
                      if (costDim === 'dsp' || !r.key || r.key === '__company') return
                      select(costDim, r.key, r.fullLabel ?? r.key)
                    }}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
            <Chip label="DSP / pkg" value={econ.unitCosts.dspPerPackage != null ? formatCurrencyPrecise(econ.unitCosts.dspPerPackage) : '—'} />
            <Chip label="Var cost / delivered" value={econ.unitCosts.costPerDelivered != null ? formatCurrencyPrecise(econ.unitCosts.costPerDelivered) : '—'} />
            <Chip label="Claims / 1k pkgs" value={econ.unitCosts.claimsPerThousand != null ? formatCurrencyPrecise(econ.unitCosts.claimsPerThousand) : '—'} />
            <Chip label="Failed delivery cost" value={formatCurrency(econ.unitCosts.failedIncrementalCost, true)} />
          </div>
        </ChartCard>

        <ChartCard
          icon="contribution"
          title={`Profitability Drill-down · ${selection ? selection.label : 'Company'}`}
          insight={drillInsight}
          businessQuestion="How does revenue per package turn into contribution per package?"
          subtitle={selection ? 'Selected scope vs company average (per billed package)' : 'Select a service, metro or customer to compare with the company average'}
        >
          {unitSteps.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-xs text-ink-muted">No billed packages in scope</p>
          ) : (
            <>
              <FloatingWaterfall
                steps={unitSteps}
                height={230}
                totalKeys={['rpp', 'cpkg']}
                valueFormat={(v) => formatCurrencyPrecise(v)}
                tickFormat={(v) => `$${v.toFixed(2)}`}
              />
              <table className="mt-1 w-full text-[13px]">
                <thead className="text-xs uppercase text-ink-muted">
                  <tr>
                    <th className="py-1 text-left">Per package</th>
                    <th className="py-1 text-right">{selection ? selection.label : 'Company'}</th>
                    {selection && <th className="py-1 text-right">Company avg</th>}
                    {selection && <th className="py-1 text-right">Δ</th>}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Revenue / pkg', unit?.rpp ?? null, companyUnit?.rpp ?? null, true],
                    ...VARIABLE_COST_TYPES.map((t) => [t, unit?.perPackage[t] ?? null, companyUnit?.perPackage[t] ?? null, false] as const),
                    ['Contribution / pkg', unit?.contributionPerPackage ?? null, companyUnit?.contributionPerPackage ?? null, true],
                  ].map(([label, v, c, higherBetter]) => {
                    const delta = v != null && c != null ? Number(v) - Number(c) : null
                    const good = delta == null ? null : higherBetter ? delta >= 0 : delta <= 0
                    return (
                      <tr key={String(label)} className="border-t border-slate-100">
                        <td className={`py-1 ${label === 'DSP Delivery' ? 'font-semibold text-ink' : ''}`}>{label}</td>
                        <td className="py-1 text-right font-mono">{v == null ? '—' : formatCurrencyPrecise(Number(v))}</td>
                        {selection && <td className="py-1 text-right font-mono text-ink-muted">{c == null ? '—' : formatCurrencyPrecise(Number(c))}</td>}
                        {selection && (
                          <td className={`py-1 text-right font-mono ${good == null ? '' : good ? 'text-success' : 'text-danger'}`}>
                            {delta == null ? '—' : `${delta >= 0 ? '+' : '−'}${formatCurrencyPrecise(Math.abs(delta))}`}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-3">
        <ChartCard
          icon="revenue"
          title="Revenue, Cost & Contribution Trend"
          businessQuestion="Is contribution keeping pace with revenue?"
          timeBasis="accounting_period"
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => formatCurrencyPrecise(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line isAnimationActive={false} type="monotone" dataKey="revenue" name="Net Billing" stroke="#123C35" strokeWidth={2} dot={false} />
                <Line isAnimationActive={false} type="monotone" dataKey="variableCost" name="Variable Cost" stroke={PALETTE.costDark} strokeWidth={2} dot={false} />
                <Line isAnimationActive={false} type="monotone" dataKey="contribution" name="Contribution" stroke="#00A86B" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <ChartCard
        title={econ.volumeProfitParadox.title}
        insight={bridgeInsight}
        businessQuestion="What moved contribution — and operating profit — between the early and late half of the window?"
        subtitle="Early → volume / RPP / CPP / mix → late contribution → fixed change → operating profit"
      >
        <div className="mb-2 flex flex-wrap gap-2 text-[13px]">
          <Chip label="Volume Δ" value={econ.volumeProfitParadox.volumeChangePct == null ? 'Insufficient history' : formatPercent(econ.volumeProfitParadox.volumeChangePct)} />
          <Chip label="Contribution Δ" value={econ.volumeProfitParadox.contributionProfitChangePct == null ? 'Insufficient history' : formatPercent(econ.volumeProfitParadox.contributionProfitChangePct)} />
          <Chip label="Operating profit Δ" value={econ.volumeProfitParadox.operatingProfitChangePct == null ? 'Insufficient history' : formatPercent(econ.volumeProfitParadox.operatingProfitChangePct)} />
        </div>
        <FloatingWaterfall steps={econ.profitBridge} height={260} totalKeys={['start', 'end_contrib', 'end_op']} />
        <Collapsible title="Bridge notes" subtitle="How to read this bridge">
          <ul className="list-disc pl-4 text-xs text-ink-muted">
            {econ.volumeProfitParadox.explanation.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Collapsible>
      </ChartCard>

      <Collapsible title={`Unprofitable segments (${unprofitable.length})`} subtitle={`Negative contribution margin · by ${dimension}`}>
        <DataTable
          rows={unprofitable.map((d) => ({ ...d, id: d.key }))}
          rowKey={(r) => r.key}
          emptyMessage="No unprofitable segments in current scope"
          columns={[
            { key: 'label', header: 'Segment', render: (r) => r.label },
            { key: 'rev', header: 'Revenue', align: 'right', render: (r) => formatCurrencyPrecise(r.revenue) },
            { key: 'cost', header: 'Variable Cost', align: 'right', render: (r) => formatCurrencyPrecise(r.variableCost) },
            { key: 'm', header: 'Margin', align: 'right', render: (r) => formatPercent(r.margin) },
          ]}
        />
      </Collapsible>

      <Collapsible title="Cost structure detail" subtitle="All cost types incl. allocated fixed">
        <DataTable
          rows={econ.costBreakdown.map((c) => ({ ...c, id: c.type }))}
          rowKey={(r) => r.type}
          columns={[
            { key: 'type', header: 'Cost Type', render: (r) => r.type },
            { key: 'amt', header: 'Amount', align: 'right', render: (r) => formatCurrencyPrecise(r.amount), sortValue: (r) => r.amount },
            { key: 'pp', header: 'Per Package', align: 'right', render: (r) => (r.perPackage != null ? formatCurrencyPrecise(r.perPackage) : '—') },
            { key: 'cls', header: 'Class', render: (r) => (r.type === 'Allocated Fixed' ? 'Fixed (→ Operating Profit)' : 'Variable (→ Contribution)') },
          ]}
        />
      </Collapsible>
    </div>
  )
}

function ProfitRanking({
  rows,
  selectedKey,
  onSelect,
}: {
  rows: { key: string; label: string; revenue: number; variableCost: number; margin: number | null }[]
  selectedKey: string | null
  onSelect: (key: string, label: string) => void
}) {
  if (rows.length === 0) {
    return <p className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-xs text-ink-muted">No data in scope</p>
  }
  const ranked = rows
    .map((r) => ({ ...r, contribution: r.revenue - r.variableCost }))
    .sort((a, b) => b.contribution - a.contribution)
  const max = Math.max(...ranked.map((r) => Math.abs(r.contribution)), 1)
  return (
    <ul className="space-y-1">
      {ranked.map((r) => {
        const selected = selectedKey === r.key
        const neg = r.contribution < 0
        return (
          <li key={r.key}>
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(r.key, r.label)}
              title={`${r.label}: contribution ${formatCurrencyPrecise(r.contribution)} on ${formatCurrencyPrecise(r.revenue)} revenue`}
              className={`group w-full rounded-md px-1.5 py-1 text-left text-[13px] transition-colors hover:bg-brand-50 ${
                selected ? 'bg-brand-50 ring-1 ring-forest/30' : selectedKey ? 'opacity-60 hover:opacity-100' : ''
              }`}
            >
              <div className="flex justify-between gap-2">
                <span className="truncate text-ink">{r.label}</span>
                <span className="shrink-0 font-mono">
                  <span className={neg ? 'text-danger' : 'text-ink'}>{formatCurrency(r.contribution, true)}</span>{' '}
                  <span className={`text-ink-muted ${(r.margin ?? 0) < 0 ? 'text-danger' : ''}`}>{formatPercent(r.margin)}</span>
                </span>
              </div>
              <div className="mt-0.5 h-1.5 rounded bg-[#eef3f0]">
                <div
                  className={`h-1.5 rounded ${neg ? 'bg-danger' : selected ? 'bg-forest' : 'bg-brand-500/80 group-hover:bg-brand-500'}`}
                  style={{ width: `${Math.max(2, (Math.abs(r.contribution) / max) * 100)}%` }}
                />
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Stat({
  label,
  value,
  hint,
  tone,
  primary,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'good' | 'warn' | 'bad'
  primary?: boolean
}) {
  return <StatTile label={label} value={value} hint={hint} tone={tone} size={primary ? 'primary' : 'secondary'} />
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#dce6df] bg-white px-2 py-1">
      <span className="text-ink-muted">{label}: </span>
      <span className="font-mono font-semibold text-ink">{value}</span>
    </div>
  )
}
