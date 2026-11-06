import { useDeferredValue, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
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
  computeCompanyOverview,
  type BubbleColorMetric,
  type BubbleMetric,
  type MetroFootprintRow,
  type ServiceMixMetric,
} from '@/calc/companyOverview'
import { runDataValidation } from '@/calc/dataValidation'
import { computeSharedMetrics } from '@/calc/metricRegistry'
import { UsMetroMap } from '@/components/charts/UsMetroMap'
import { ChartCard } from '@/components/common/ChartCard'
import { Collapsible } from '@/components/common/Collapsible'
import { DataTable } from '@/components/common/DataTable'
import { GuidedInvestigation } from '@/components/common/GuidedInvestigation'
import { InteractiveBusinessFlow } from '@/components/common/InteractiveBusinessFlow'
import { PageHeader } from '@/components/common/PageHeader'
import { InfoTip } from '@/components/common/StatusIndicator'
import { MODULE_ICONS, PALETTE, type ModuleIconKey } from '@/lib/icons'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { formatCurrency, formatCurrencyPrecise, formatNumber, formatPercent } from '@/lib/money'
import type { ServiceType } from '@/types'

export function CompanyOverview() {
  const { data, filters, scenario, setFilters, navigateWithContext, clearSelection, openCustomer360 } = useApp()
  // Selected month: applied to the global date range (all pages); previous range kept for Restore
  const [savedRange, setSavedRange] = useState<{ startPeriod: string; endPeriod: string } | null>(null)
  const monthSelected = savedRange != null && filters.startPeriod === filters.endPeriod
  const selectMonth = (period: string) => {
    if (monthSelected && filters.startPeriod === period) {
      restoreRange()
      return
    }
    const base = savedRange ?? { startPeriod: filters.startPeriod, endPeriod: filters.endPeriod }
    setSavedRange(base)
    setFilters({ ...filters, startPeriod: period, endPeriod: period })
  }
  const restoreRange = () => {
    if (!savedRange) return
    setFilters({ ...filters, ...savedRange })
    setSavedRange(null)
  }
  const [bubbleMetric, setBubbleMetric] = useState<BubbleMetric>('shipments')
  const [colorMetric, setColorMetric] = useState<BubbleColorMetric>('contributionMargin')
  const [serviceMix, setServiceMix] = useState<ServiceMixMetric>('netBilling')
  // Selection is the global metro filter — single source of truth shared by map, table and charts
  const selectedMetro = filters.metros[0] ?? null
  const [segmentMode, setSegmentMode] = useState<'all' | 'customers' | 'revenue' | 'contribution'>('all')
  const [trendMetric, setTrendMetric] = useState<TrendView>('revenue')
  const [showAllInsights, setShowAllInsights] = useState(false)

  // Defer filter-driven recompute so UI stays responsive while aggregates catch up
  const deferredFilters = useDeferredValue(filters)
  const model = useMemo(
    () => computeCompanyOverview(data, deferredFilters),
    [data, deferredFilters],
  )
  // Map + metro ranking keep all metros visible (parent geo scope) so the selection is highlighted, not hidden
  const geoModel = useMemo(
    () => computeCompanyOverview(data, { ...deferredFilters, regions: [], metros: [] }),
    [data, deferredFilters],
  )
  const shared = useMemo(
    () => computeSharedMetrics(data, deferredFilters, scenario),
    [data, deferredFilters, scenario],
  )
  const crossValidation = useMemo(
    () => runDataValidation(data, deferredFilters, scenario),
    [data, deferredFilters, scenario],
  )
  // Trend keeps the pre-selection window so the selected month stays in context
  const trendModel = useMemo(
    () => (monthSelected && savedRange ? computeCompanyOverview(data, { ...deferredFilters, ...savedRange }) : model),
    [data, deferredFilters, monthSelected, savedRange, model],
  )

  const resetView = () => {
    setBubbleMetric('shipments')
    setColorMetric('contributionMargin')
    setServiceMix('netBilling')
    setSegmentMode('all')
    setTrendMetric('revenue')
    setShowAllInsights(false)
  }

  const onMetro = (row: MetroFootprintRow) => {
    if (selectedMetro === row.metro) {
      setFilters({ ...filters, regions: [], metros: [] })
      return
    }
    setFilters({ ...filters, regions: [row.region], metros: [row.metro] })
  }

  const scopeLabel = model.scope.isFiltered ? 'Selected Scope' : 'Company Total'
  const insightRows = showAllInsights ? model.insights : model.topInsights

  // 100% stacked rows — one per measure; values are real computed shares (no proxies)
  const segmentMeasures = [
    { key: 'customers', measure: 'Customer Count', field: 'customerShare' as const, abs: (x: (typeof model.segments)[number]) => formatNumber(x.customers) },
    { key: 'revenue', measure: 'Net Billing', field: 'revenueShare' as const, abs: (x: (typeof model.segments)[number]) => formatCurrencyPrecise(x.revenue) },
    { key: 'contribution', measure: 'Contribution', field: 'contributionShare' as const, abs: (x: (typeof model.segments)[number]) => formatCurrencyPrecise(x.contribution) },
  ].filter((m) => segmentMode === 'all' || m.key === segmentMode)
  const segmentBars = segmentMeasures.map((m) => {
    const row: Record<string, string | number> = { measure: m.measure }
    model.segments.forEach((sg) => {
      row[sg.segment] = sg[m.field] ?? 0
      row[`${sg.segment}__abs`] = m.abs(sg)
    })
    return row
  })

  // Cumulative share uses the all-customer Net Billing denominator (revenueShare), so the line is correct
  // even though only the top N bars are drawn
  const pareto = model.topCustomers.map((c, i) => ({
    name: c.customerName.length > 11 ? `${c.customerName.slice(0, 10)}…` : c.customerName,
    fullName: c.customerName,
    customerId: c.customerId,
    revenue: c.revenue,
    share: c.revenueShare ?? 0,
    cumulative:
      Math.round(model.topCustomers.slice(0, i + 1).reduce((a, x) => a + (x.revenueShare ?? 0), 0) * 100) / 100,
  }))

  const serviceMixData = [...model.services]
    .map((s) => ({
      serviceType: s.serviceType,
      value:
        serviceMix === 'shipments'
          ? s.shipmentShare ?? 0
          : serviceMix === 'contribution'
            ? s.contributionShare ?? 0
            : s.revenueShare ?? 0,
      netBilling: s.netBilling,
      cm: s.contributionMargin,
    }))
    .sort((a, b) => b.value - a.value)

  const trendData = trendModel.monthly.map((m) => ({
    period: m.period,
    shipments: m.shipments,
    netBilling: m.netBilling,
    recognized: m.recognizedDisplay === 'no_records' ? null : m.recognizedRevenue,
    rpp: m.revenuePerPackage,
    cm: m.contributionMargin,
  }))

  // ---- Computed insights for the current filters ----
  const metroTotal = geoModel.metros.reduce((a, x) => a + x.revenue, 0)
  const topMetro = [...geoModel.metros].sort((a, b) => b.revenue - a.revenue)[0]
  const weakMetro = [...geoModel.metros]
    .filter((x) => x.contributionMargin != null)
    .sort((a, b) => (a.contributionMargin ?? 0) - (b.contributionMargin ?? 0))[0]
  const geoInsight =
    topMetro && metroTotal
      ? `${topMetro.metro.replace(' Metro', '')} leads with ${formatPercent((topMetro.revenue / metroTotal) * 100)} of Net Billing${
          weakMetro && weakMetro.metro !== topMetro.metro
            ? `; ${weakMetro.metro.replace(' Metro', '')} has the lowest CM at ${formatPercent(weakMetro.contributionMargin)}`
            : ''
        }.`
      : null
  const topSeg = [...model.segments].sort((a, b) => (b.revenueShare ?? 0) - (a.revenueShare ?? 0))[0]
  const segInsight = topSeg
    ? `${topSeg.segment} is ${formatPercent(topSeg.customerShare)} of customers but ${formatPercent(topSeg.revenueShare)} of Net Billing and ${formatPercent(topSeg.contributionShare)} of contribution.`
    : null
  const hhi = model.concentration.hhi
  const concInsight =
    model.concentration.top3 != null
      ? `Top 3 customers = ${formatPercent(model.concentration.top3)} of Net Billing; HHI ${hhi != null ? hhi.toFixed(3) : '—'} (${
          hhi == null ? 'n/a' : hhi < 0.15 ? 'unconcentrated' : hhi < 0.25 ? 'moderately concentrated' : 'highly concentrated'
        }).`
      : null
  const topSvc = serviceMixData[0]
  const svcInsight = topSvc
    ? `${topSvc.serviceType} is the largest ${serviceMix === 'shipments' ? 'shipment' : serviceMix === 'contribution' ? 'contribution' : 'Net Billing'} share at ${formatPercent(topSvc.value)} (CM ${formatPercent(topSvc.cm)}).`
    : null
  const trendPts = trendData.filter((d) => d.netBilling > 0)
  const lastT = trendPts[trendPts.length - 1]
  const prevT = trendPts[trendPts.length - 2]
  const trendInsight =
    lastT && prevT && prevT.netBilling
      ? `${lastT.period} Net Billing ${formatCurrency(lastT.netBilling, true)}, ${lastT.netBilling >= prevT.netBilling ? 'up' : 'down'} ${formatPercent(Math.abs(((lastT.netBilling - prevT.netBilling) / prevT.netBilling) * 100))} vs ${prevT.period}; CM ${formatPercent(lastT.cm)}.`
      : 'Insufficient history for a month-over-month comparison.'

  const flowStages = [
    {
      id: 'clients',
      label: 'B2B Clients',
      activity: 'Contract shippers',
      metricLabel: 'Active customers',
      metricValue: formatNumber(model.scale.activeCustomers),
      available: true,
      onClick: () => navigateWithContext('/customers', { sourcePage: '/company' }),
    },
    {
      id: 'network',
      label: 'Network Ops',
      activity: 'Accept → sort → OFD',
      metricLabel: 'Shipments',
      metricValue: formatNumber(model.scale.shipmentVolume),
      available: true,
      onClick: () => navigateWithContext('/executive', { sourcePage: '/company' }),
    },
    {
      id: 'dsp',
      label: 'DSP Partners',
      activity: 'Final-mile execution',
      metricLabel: 'Active DSPs',
      metricValue:
        model.scale.activeDspPartners != null ? formatNumber(model.scale.activeDspPartners) : 'N/A',
      available: model.scale.activeDspPartners != null,
      onClick: () => navigateWithContext('/unit-economics', { sourcePage: '/company' }),
    },
    {
      id: 'delivery',
      label: 'Delivery',
      activity: 'Billable event',
      metricLabel: 'Success rate',
      metricValue: formatPercent(model.scale.deliverySuccessRate),
      available: model.scale.deliverySuccessRate != null,
      onClick: () => navigateWithContext('/executive', { sourcePage: '/company' }),
    },
    {
      id: 'billing',
      label: 'Billing',
      activity: 'Rate & invoice',
      metricLabel: 'Net Billing',
      metricValue: formatCurrency(model.scale.netBilling, true),
      available: true,
      onClick: () => navigateWithContext('/lifecycle', { sourcePage: '/company' }),
    },
    {
      id: 'recognition',
      label: 'Recognition',
      activity: 'Book revenue',
      metricLabel: 'Recognized',
      metricValue:
        model.scale.recognized.display === 'no_records'
          ? 'No records'
          : formatCurrency(model.scale.recognized.amount, true),
      available: model.scale.recognized.display !== 'no_records',
      onClick: () => navigateWithContext('/reconciliation', { sourcePage: '/company' }),
    },
    {
      id: 'collection',
      label: 'Collection',
      activity: 'Cash application',
      metricLabel: `Cash collected · Overdue AR ${formatCurrency(shared.overdueAr, true)}`,
      metricValue: formatCurrency(shared.cashCollections, true),
      available: true,
      onClick: () =>
        navigateWithContext('/reconciliation', {
          exceptionType: 'Overdue AR',
          sourcePage: '/company',
        }),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        path="/company"
        scope={model.periodLabel}
        actions={
          <>
            <button type="button" className="rounded-md border border-[#dce6df] px-2.5 py-1 text-[13px]" onClick={clearSelection}>
              Clear Selection
            </button>
            <button type="button" className="rounded-md border border-[#dce6df] px-2.5 py-1 text-[13px]" onClick={resetView} title="Reset this page's chart toggles only">
              Reset View
            </button>
            <button
              type="button"
              className="rounded-lg bg-forest px-3 py-1 text-[13px] font-medium text-white"
              onClick={() =>
                exportToCsv('company_overview.csv', [
                  { section: 'scale', period: model.periodLabel, ...model.sharedCheck },
                  ...model.topCustomers.map((r) => ({ section: 'customer', ...r })),
                ] as Record<string, unknown>[])
              }
            >
              Export
            </button>
          </>
        }
      />
      {monthSelected && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-forest/20 bg-brand-50 px-3 py-1.5 text-[13px] text-forest">
          <strong>Selected month {filters.startPeriod}</strong> — applied to the global date filter on every page.
          <button type="button" className="rounded border border-forest/30 bg-white px-2 py-0.5 hover:bg-brand-50" onClick={restoreRange}>
            Restore {savedRange!.startPeriod} → {savedRange!.endPeriod}
          </button>
        </div>
      )}

      <GuidedInvestigation compact />

      {/* A — Glance */}
      <section>
        <p className="mb-1 text-xs font-semibold uppercase text-ink-muted">
          Company at a Glance · {scopeLabel}
        </p>
        {model.scope.isFiltered && (
          <p className="mb-2 text-xs text-amber-800">
            Selected ≠ Company Total · Customers {formatNumber(model.scope.selected.activeCustomers)}/
            {formatNumber(model.scope.company.activeCustomers)} · Shipments{' '}
            {formatPercent(model.scope.selected.shareOfShipments)} · Net Billing{' '}
            {formatPercent(model.scope.selected.shareOfNetBilling)}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Glance
            icon="customers"
            label={model.scope.isFiltered ? 'Selected Active Customers' : 'Active Customers'}
            value={formatNumber(model.scale.activeCustomers)}
            sub="in period"
            hint={model.scale.activeDefinition}
            onClick={() => navigateWithContext('/customers', { sourcePage: '/company' })}
          />
          <Glance
            icon="shipments"
            label="Total Shipments"
            value={formatNumber(model.scale.shipmentVolume)}
            sub="period total"
            hint="Period cumulative count of shipments by ship_date in the selected range."
            onClick={() => navigateWithContext('/lifecycle', { sourcePage: '/company' })}
          />
          <Glance
            icon="geography"
            label="Active Metro Markets"
            value={formatNumber(model.scale.activeMetroMarkets)}
            sub={`${formatNumber(model.scale.activeStations)} stations`}
            hint="Distinct metros / stations with at least one shipment lot in the period."
          />
          <Glance
            icon="delivery"
            label="Network Utilization"
            value={
              model.scale.networkUtilization == null
                ? 'N/A'
                : formatPercent(model.scale.networkUtilization)
            }
            sub={
              model.scale.monthlyCapacity
                ? `cap ${formatNumber(model.scale.monthlyCapacity)} pkgs/mo`
                : 'no capacity'
            }
            hint="Period packages ÷ (active station daily capacity × 30 × months). DSP partners remain available in Unit Economics."
            onClick={() => navigateWithContext('/unit-economics', { sourcePage: '/company' })}
          />
          <Glance
            icon="billing"
            label="Net Billed Revenue"
            value={formatCurrency(model.scale.netBilling, true)}
            sub={model.growth.netBillingGrowth == null ? 'prior: insufficient history' : `${model.growth.netBillingGrowth >= 0 ? '+' : ''}${model.growth.netBillingGrowth.toFixed(1)}% vs prior window`}
            hint={`${scopeLabel}. Σ non-duplicate billing_line.net_amount by accounting_period. Not Recognized Revenue. Exact ${formatCurrencyPrecise(model.scale.netBilling)}.`}
            onClick={() => navigateWithContext('/lifecycle', { sourcePage: '/company' })}
          />
          <Glance
            icon="contribution"
            label="Contribution Margin"
            value={formatPercent(model.scale.contributionMargin)}
            sub={`${formatCurrency(model.scale.contributionProfit, true)} contribution`}
            hint="(Net Billing − variable cost) ÷ Net Billing. Before allocated fixed cost — not Operating Profit."
            onClick={() => navigateWithContext('/unit-economics', { sourcePage: '/company' })}
          />
        </div>
      </section>

      {/* B — Flow */}
      <ChartCard icon="revenue" title="How the Business Works" businessQuestion="How does this carrier make money?" timeBasis={model.periodLabel}>
        <InteractiveBusinessFlow stages={flowStages} title="" subtitle="Click a stage to open the matching analysis" />
      </ChartCard>

      {/* Insights compact */}
      <ChartCard
        title="Key Insights"
        subtitle="Top findings from current filters"
        action={
          <button type="button" className="text-[13px] text-brand-700" onClick={() => setShowAllInsights((v) => !v)}>
            {showAllInsights ? 'Top 3' : 'View all'}
          </button>
        }
      >
        <ul className="space-y-1.5">
          {insightRows.slice(0, showAllInsights ? 99 : 3).map((ins) => (
            <li key={ins.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-[#f5f8f5] px-3 py-2 text-xs">
              <span className="text-ink">{ins.finding}</span>
              {ins.actionPath && (
                <button
                  type="button"
                  className="shrink-0 font-medium text-brand-700"
                  onClick={() =>
                    navigateWithContext(ins.actionPath!, {
                      region: ins.actionExtras?.region,
                      metro: ins.actionExtras?.metro,
                      serviceType: ins.actionExtras?.serviceType,
                      exceptionType: ins.actionExtras?.exceptionType,
                      sourcePage: '/company',
                    })
                  }
                >
                  {ins.actionLabel ?? 'Next'} →
                </button>
              )}
            </li>
          ))}
        </ul>
        <Collapsible title="Analysis summary detail" subtitle="What / Why / Impact / Next">
          <div className="grid gap-3 sm:grid-cols-4 text-xs">
            <p><span className="font-semibold">What:</span> {model.analysisSummary.whatHappened}</p>
            <p><span className="font-semibold">Why:</span> {model.analysisSummary.why}</p>
            <p><span className="font-semibold">Impact:</span> {model.analysisSummary.financialImpact}</p>
            <p><span className="font-semibold">Next:</span> {model.analysisSummary.whatNext}</p>
          </div>
        </Collapsible>
      </ChartCard>

      {/* C — Geo */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ChartCard
            icon="geography"
            title="Geographic Footprint"
            emphasis
            insight={geoInsight}
            businessQuestion="Where do volume and margin concentrate?"
            action={
              <div className="flex flex-wrap gap-1">
                <select className="filter-input" value={bubbleMetric} onChange={(e) => setBubbleMetric(e.target.value as BubbleMetric)}>
                  <option value="shipments">Size: Shipments</option>
                  <option value="revenue">Size: Net Billing</option>
                  <option value="contribution">Size: Contribution</option>
                </select>
                <select className="filter-input" value={colorMetric} onChange={(e) => setColorMetric(e.target.value as BubbleColorMetric)}>
                  <option value="contributionMargin">Color: Absolute CM%</option>
                  <option value="relativeMargin">Color: CM vs Company</option>
                  <option value="growth">Color: Growth</option>
                  <option value="exceptions">Color: Exception Rate</option>
                </select>
                {selectedMetro && (
                  <>
                    <button
                      type="button"
                      className="rounded-md border border-[#dce6df] px-2 py-1 text-[13px] text-ink-muted hover:text-ink"
                      onClick={() => setFilters({ ...filters, regions: [], metros: [] })}
                    >
                      Clear {selectedMetro.replace(' Metro', '')} ×
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-[#dce6df] px-2 py-1 text-[13px]"
                      onClick={() =>
                        navigateWithContext('/customers', {
                          metro: selectedMetro,
                          region: geoModel.metros.find((m) => m.metro === selectedMetro)?.region,
                          sourcePage: '/company',
                        })
                      }
                    >
                      Customers
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-[#dce6df] px-2 py-1 text-[13px]"
                      onClick={() =>
                        navigateWithContext('/lifecycle', {
                          metro: selectedMetro,
                          region: geoModel.metros.find((m) => m.metro === selectedMetro)?.region,
                          sourcePage: '/company',
                        })
                      }
                    >
                      Revenue
                    </button>
                    <button
                      type="button"
                      className="rounded-md bg-forest px-2 py-1 text-[13px] text-white"
                      onClick={() =>
                        navigateWithContext('/unit-economics', {
                          metro: selectedMetro,
                          region: geoModel.metros.find((m) => m.metro === selectedMetro)?.region,
                          sourcePage: '/company',
                        })
                      }
                    >
                      Unit Economics
                    </button>
                  </>
                )}
              </div>
            }
          >
            <UsMetroMap
              metros={geoModel.metros}
              metric={bubbleMetric}
              colorMetric={colorMetric}
              selectedMetro={selectedMetro}
              onSelect={onMetro}
              companyMargin={geoModel.scale.contributionMargin}
            />
          </ChartCard>
        </div>
        <div className="lg:col-span-2">
          <ChartCard
            icon="geography"
            title="Metro Performance"
            subtitle="Ranked by Net Billing · click to select (shared with map); click again to clear"
            businessQuestion="Which metros earn the most — and at what margin?"
          >
            <DataTable
              rows={[...geoModel.metros].sort((a, b) => b.revenue - a.revenue).slice(0, 8).map((m) => ({ ...m, id: m.metro }))}
              rowKey={(r) => r.metro}
              selectedKey={selectedMetro}
              onRowClick={(r) => onMetro(r)}
              columns={[
                { key: 'm', header: 'Metro', render: (r) => r.metro.replace(' Metro', '') },
                { key: 's', header: 'Ship', align: 'right', render: (r) => formatNumber(r.shipments) },
                { key: 'r', header: 'Net', align: 'right', render: (r) => formatCurrency(r.revenue, true) },
                { key: 'cm', header: 'CM%', align: 'right', render: (r) => formatPercent(r.contributionMargin) },
                {
                  key: 'ex',
                  header: 'Exc/100',
                  align: 'right',
                  render: (r) => (r.exceptionRate == null ? 'N/A' : r.exceptionRate.toFixed(1)),
                  sortValue: (r) => r.exceptionRate ?? -1,
                },
              ]}
            />
            {selectedMetro && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold text-ink-muted">
                  Stations in {selectedMetro.replace(' Metro', '')} · click to set Station filter
                </p>
                <DataTable
                  rows={(data.stations ?? [])
                    .filter((s) => s.metro === selectedMetro)
                    .map((s) => {
                      const pkgs = data.shipments
                        .filter(
                          (sh) =>
                            sh.station_id === s.station_id &&
                            sh.ship_date.slice(0, 7) >= filters.startPeriod &&
                            sh.ship_date.slice(0, 7) <= filters.endPeriod,
                        )
                        .reduce((a, sh) => a + sh.package_count, 0)
                      return {
                        id: s.station_id,
                        station_id: s.station_id,
                        station_name: s.station_name,
                        capacity: s.capacity_daily * 30,
                        packages: pkgs,
                        util: s.capacity_daily ? (pkgs / (s.capacity_daily * 30)) * 100 : null,
                      }
                    })}
                  rowKey={(r) => r.station_id}
                  selectedKey={filters.stations?.[0] ?? null}
                  defaultPageSize={25}
                  onRowClick={(r) =>
                    setFilters({
                      ...filters,
                      metros: [selectedMetro],
                      stations: [r.station_id],
                    })
                  }
                  columns={[
                    { key: 'n', header: 'Station', render: (r) => r.station_name, sortValue: (r) => r.station_name },
                    {
                      key: 'p',
                      header: 'Packages',
                      align: 'right',
                      render: (r) => formatNumber(r.packages),
                      sortValue: (r) => r.packages,
                    },
                    {
                      key: 'c',
                      header: 'Mo Cap',
                      align: 'right',
                      render: (r) => formatNumber(r.capacity),
                      sortValue: (r) => r.capacity,
                    },
                    {
                      key: 'u',
                      header: 'Util %',
                      align: 'right',
                      render: (r) => (r.util == null ? 'N/A' : formatPercent(r.util)),
                      sortValue: (r) => r.util ?? -1,
                    },
                  ]}
                />
              </div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* D — Portfolio */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          icon="customers"
          iconTone="customer"
          title="Customer Mix by Industry"
          subtitle="Net Billing share by industry · Synthetic"
        >
          <DataTable
            rows={model.industries.map((i) => ({ ...i, id: i.industry }))}
            rowKey={(r) => r.industry}
            defaultPageSize={25}
            columns={[
              { key: 'i', header: 'Industry', render: (r) => r.industry, sortValue: (r) => r.industry },
              {
                key: 'c',
                header: 'Customers',
                align: 'right',
                render: (r) => formatNumber(r.customers),
                sortValue: (r) => r.customers,
              },
              {
                key: 'r',
                header: 'Net Billing',
                align: 'right',
                render: (r) => formatCurrency(r.revenue, true),
                sortValue: (r) => r.revenue,
              },
              {
                key: 's',
                header: 'Share',
                align: 'right',
                render: (r) => formatPercent(r.revenueShare),
                sortValue: (r) => r.revenueShare ?? -1,
              },
            ]}
          />
        </ChartCard>
        <ChartCard
          icon="customers"
          iconTone="customer"
          title="Customer Segment Mix"
          insight={segInsight}
          businessQuestion="Which customer segments drive revenue and contribution?"
          subtitle="100% stacked share · Contribution = Net Billing − customer-attributed variable cost"
          action={
            <select className="filter-input" value={segmentMode} onChange={(e) => setSegmentMode(e.target.value as typeof segmentMode)} aria-label="Segment measure">
              <option value="all">All measures</option>
              <option value="customers">Customer Count</option>
              <option value="revenue">Net Billing</option>
              <option value="contribution">Contribution</option>
            </select>
          }
        >
          <div className={segmentMode === 'all' ? 'h-44' : 'h-28'}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={segmentBars} layout="vertical" margin={{ left: 4, right: 16, top: 4 }} barCategoryGap="28%">
                <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} horizontal={false} />
                <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="measure" width={104} tick={{ fontSize: 12 }} />
                <Tooltip
                  wrapperStyle={{ zIndex: 50 }}
                  cursor={{ fill: 'rgba(91,62,150,0.06)' }}
                  formatter={(v, name, item) => {
                    const abs = (item?.payload as Record<string, string> | undefined)?.[`${String(name)}__abs`]
                    return [`${formatPercent(Number(v))}${abs ? ` · ${abs}` : ''}`, String(name)]
                  }}
                />
                <Legend verticalAlign="top" align="right" height={20} wrapperStyle={{ fontSize: 12 }} />
                {SEGMENT_COLORS.map(([seg, color]) => (
                  <Bar isAnimationActive={false} key={seg} dataKey={seg} stackId="seg" fill={color} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1 text-center text-xs">
            <Conc label="Top 1" value={formatPercent(model.concentration.top1)} />
            <Conc label="Top 3" value={formatPercent(model.concentration.top3)} />
            <Conc label="Top 5" value={formatPercent(model.concentration.top5)} />
            <Conc label="HHI" value={model.concentration.hhi != null ? model.concentration.hhi.toFixed(3) : '—'} />
          </div>
        </ChartCard>

        <ChartCard
          icon="customers"
          iconTone="customer"
          title="Customer Concentration (Pareto)"
          insight={concInsight}
          businessQuestion="How dependent are we on our largest customers?"
          subtitle={`Top ${pareto.length} of ${formatNumber(model.concentration.activeCustomerCount)} active customers · cumulative % uses all-customer Net Billing as denominator · click a bar → Customer 360`}
        >
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={pareto} margin={{ left: 0, right: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} vertical={false} />
                <XAxis dataKey="fullName" tick={<WrapTick maxChars={8} />} interval={0} height={44} />
                <YAxis yAxisId="l" tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  wrapperStyle={{ zIndex: 50 }}
                  labelFormatter={(_, p) => (p?.[0]?.payload as { fullName?: string } | undefined)?.fullName ?? ''}
                  formatter={(v, name) =>
                    name === 'Cumulative % of all customers' ? formatPercent(Number(v)) : formatCurrencyPrecise(Number(v))
                  }
                />
                <Legend verticalAlign="top" height={18} wrapperStyle={{ fontSize: 12 }} />
                <Bar isAnimationActive={false}
                  yAxisId="l"
                  dataKey="revenue"
                  fill={PALETTE.segment[0]}
                  name="Net Billing"
                  cursor="pointer"
                  onClick={(d) => {
                    const row = d as unknown as { customerId?: string }
                    if (row.customerId) openCustomer360(row.customerId)
                  }}
                />
                <Line isAnimationActive={false} yAxisId="r" type="monotone" dataKey="cumulative" stroke={PALETTE.brand} name="Cumulative % of all customers" dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Service mix */}
      <ChartCard
        icon="shipments"
        title="Service Mix"
        insight={svcInsight}
        subtitle={model.serviceMixMeta.comparisonScopeNote}
        action={
          <select className="filter-input" value={serviceMix} onChange={(e) => setServiceMix(e.target.value as ServiceMixMetric)}>
            <option value="shipments">Shipment share</option>
            <option value="netBilling">Net Billing share</option>
            <option value="contribution">Contribution share</option>
          </select>
        }
      >
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={serviceMixData} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
              {/* Zero-based (no truncation); upper bound fits the data instead of a fixed 100% */}
              <XAxis
                type="number"
                domain={[0, Math.min(100, Math.max(10, Math.ceil(Math.max(...serviceMixData.map((d) => d.value), 0) / 10) * 10))]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 12 }}
              />
              <YAxis type="category" dataKey="serviceType" width={72} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => formatPercent(Number(v))} />
              <Bar isAnimationActive={false}
                dataKey="value"
                fill="#123C35"
                radius={[0, 4, 4, 0]}
                onClick={(d) => {
                  const row = d as unknown as { serviceType?: ServiceType }
                  if (row.serviceType)
                    navigateWithContext('/unit-economics', { serviceType: row.serviceType, sourcePage: '/company' })
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* E — Trends */}
      <ChartCard
        icon="revenue"
        title="Business Trends"
        insight={trendInsight}
        businessQuestion="How have volume, revenue and margin changed over time?"
        subtitle={`Trailing 12 months · click a month to apply it to all pages${monthSelected ? ` · selected ${filters.startPeriod}` : ''}`}
        action={
          <div className="flex flex-wrap gap-1" role="tablist">
            {TREND_VIEWS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={trendMetric === t.id}
                onClick={() => setTrendMetric(t.id)}
                className={`rounded-md px-2 py-1 text-[13px] ${
                  trendMetric === t.id
                    ? 'bg-forest text-white'
                    : 'border border-[#dce6df] text-ink-muted hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="mb-2 flex flex-wrap gap-2 text-[13px]">
          <GrowthChip label="Shipment Δ" value={fmtGrowth(model.growth.shipmentGrowth)} />
          <GrowthChip label="Net Billing Δ" value={fmtGrowth(model.growth.netBillingGrowth)} />
          <GrowthChip label="RPP Δ" value={fmtGrowth(model.growth.rppGrowth)} />
        </div>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={trendData}
              onClick={(e) => {
                const label = (e as { activeLabel?: string | number } | null)?.activeLabel
                if (label != null) selectMonth(String(label))
              }}
              style={{ cursor: 'pointer' }}
            >
              {monthSelected && <ReferenceLine x={filters.startPeriod} stroke={PALETTE.brand} strokeWidth={2} label={{ value: 'Selected', fontSize: 12, position: 'top', fill: PALETTE.brand }} />}
              <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
              <XAxis dataKey="period" tick={{ fontSize: 12 }} />
              <YAxis
                tick={{ fontSize: 12 }}
                tickFormatter={(v) =>
                  trendMetric === 'shipments'
                    ? formatNumber(v)
                    : trendMetric === 'cm'
                      ? `${v}%`
                      : trendMetric === 'rpp'
                        ? `$${Number(v).toFixed(2)}`
                        : `$${(Number(v) / 1000).toFixed(0)}k`
                }
              />
              <Tooltip
                formatter={(v) =>
                  v == null
                    ? 'No records'
                    : trendMetric === 'shipments'
                      ? formatNumber(Number(v))
                      : trendMetric === 'cm'
                        ? formatPercent(Number(v))
                        : formatCurrencyPrecise(Number(v))
                }
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {trendMetric === 'revenue' && (
                <>
                  <Line isAnimationActive={false} type="monotone" dataKey="netBilling" name="Net Billing (accounting_period)" stroke="#123C35" strokeWidth={2} dot={false} />
                  <Line isAnimationActive={false} type="monotone" dataKey="recognized" name="Recognized Revenue" stroke="#00A86B" strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls />
                </>
              )}
              {trendMetric === 'shipments' && <Line isAnimationActive={false} type="monotone" dataKey="shipments" name="Shipments (ship_date)" stroke="#123C35" strokeWidth={2} dot={false} />}
              {trendMetric === 'rpp' && <Line isAnimationActive={false} type="monotone" dataKey="rpp" name="Revenue / Billed Package" stroke="#E58A2B" strokeWidth={2} dot={false} connectNulls />}
              {trendMetric === 'cm' && <Line isAnimationActive={false} type="monotone" dataKey="cm" name="Contribution Margin %" stroke="#123C35" strokeWidth={2} dot={false} connectNulls />}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <Collapsible title="View monthly data" subtitle="Click a month to apply it to all pages (click again to restore)">
          <DataTable
            rows={trendModel.monthly.map((m) => ({ ...m, id: m.period }))}
            rowKey={(r) => r.period}
            selectedKey={monthSelected ? filters.startPeriod : null}
            onRowClick={(r) => selectMonth(r.period)}
            columns={[
              { key: 'p', header: 'Month', render: (r) => r.period },
              { key: 's', header: 'Shipments', align: 'right', render: (r) => formatNumber(r.shipments) },
              { key: 'n', header: 'Net Billing', align: 'right', render: (r) => formatCurrency(r.netBilling, true) },
              {
                key: 'rec',
                header: 'Recognized',
                align: 'right',
                render: (r) =>
                  r.recognizedDisplay === 'no_records' ? 'No records' : formatCurrency(r.recognizedRevenue, true),
              },
              {
                key: 'rpp',
                header: 'RPP',
                align: 'right',
                render: (r) => (r.revenuePerPackage != null ? formatCurrencyPrecise(r.revenuePerPackage) : '—'),
              },
              {
                key: 'cm',
                header: 'CM%',
                align: 'right',
                render: (r) => formatPercent(r.contributionMargin),
              },
            ]}
          />
        </Collapsible>
      </ChartCard>

      <Collapsible title="Data Quality Monitor" subtitle="Deterministic checks · default collapsed for analysts">
        <DataTable
          rows={model.dataQuality.map((q) => ({ ...q, id: q.id }))}
          rowKey={(r) => r.id}
          onRowClick={(r) => {
            if (!r.investigatePath) return
            navigateWithContext(r.investigatePath, {
              exceptionType: r.investigateExtras?.exceptionType,
              sourcePage: '/company',
            })
          }}
          columns={[
            { key: 'l', header: 'Check', render: (r) => r.label },
            { key: 'sev', header: 'Status', render: (r) => r.severity },
            { key: 'n', header: 'Issues', align: 'right', render: (r) => `${r.issueCount}/${r.checkedCount}` },
            {
              key: 'fi',
              header: 'Impact',
              align: 'right',
              render: (r) => (r.financialImpact != null ? formatCurrency(r.financialImpact, true) : '—'),
            },
          ]}
        />
        <p className="mb-1 mt-4 text-xs font-semibold text-ink">Cross-module validation</p>
        <DataTable
          rows={crossValidation.map((q, i) => ({ ...q, id: `xv-${i}` }))}
          rowKey={(r) => r.id}
          columns={[
            { key: 'n', header: 'Check', render: (r) => r.name, searchValue: (r) => r.name },
            { key: 's', header: 'Status', render: (r) => r.status, sortValue: (r) => r.status },
            { key: 'e', header: 'Expected', render: (r) => r.expected },
            { key: 'a', header: 'Actual', render: (r) => r.actual },
            { key: 'd', header: 'Diff', render: (r) => r.difference },
            { key: 'sev', header: 'Severity', render: (r) => r.severity },
            { key: 'r', header: 'Related', render: (r) => r.relatedRecords },
          ]}
        />
      </Collapsible>
    </div>
  )
}

type TrendView = 'revenue' | 'shipments' | 'rpp' | 'cm'
const TREND_VIEWS: { id: TrendView; label: string }[] = [
  { id: 'revenue', label: 'Net Billing vs Recognized' },
  { id: 'shipments', label: 'Shipments' },
  { id: 'rpp', label: 'Revenue / Package' },
  { id: 'cm', label: 'Contribution Margin' },
]
// Customer-analysis palette (purple family) — distinct from status colors
const SEGMENT_COLORS: [string, string][] = [
  ['Enterprise', PALETTE.segment[0]],
  ['Mid-Market', PALETTE.segment[1]],
  ['SMB', PALETTE.segment[2]],
]

function Glance({
  icon,
  label,
  value,
  sub,
  hint,
  onClick,
}: {
  icon: ModuleIconKey
  label: string
  value: string
  sub: string
  hint: string
  onClick?: () => void
}) {
  const Icon = MODULE_ICONS[icon]
  const body = (
    <>
      <p className="t-kpi-label flex items-start gap-1 uppercase leading-snug text-ink-muted">
        <Icon size={14} className="mt-px shrink-0 text-forest" aria-hidden />
        <span className="min-w-0">{label}</span>
        <InfoTip text={hint} />
      </p>
      <p className="mt-1.5 font-mono text-[26px] font-bold tracking-tight text-ink">{value}</p>
      <p className="text-xs text-ink-muted">{sub}</p>
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className="card-surface p-4 text-left transition-colors hover:border-brand-300">
      {body}
    </button>
  ) : (
    <div className="card-surface p-4">{body}</div>
  )
}

function Conc({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-[#f5f8f5] px-1 py-1.5">
      <p className="text-ink-muted">{label}</p>
      <p className="font-mono text-xs font-semibold">{value}</p>
    </div>
  )
}

function GrowthChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[#dce6df] px-2 py-1">
      <span className="text-ink-muted">{label}: </span>
      <span className="font-mono font-semibold">{value}</span>
    </div>
  )
}

function fmtGrowth(v: number | null): string {
  if (v == null) return 'Insufficient history'
  return formatPercent(v)
}
