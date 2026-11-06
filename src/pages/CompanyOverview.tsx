import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  computeCompanyOverview,
  type BubbleMetric,
  type MetroFootprintRow,
} from '@/calc/companyOverview'
import { UsMetroMap } from '@/components/charts/UsMetroMap'
import { ChartCard } from '@/components/common/ChartCard'
import { DataTable } from '@/components/common/DataTable'
import { KpiCard } from '@/components/common/KpiCard'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { formatCurrency, formatCurrencyPrecise, formatNumber, formatPercent } from '@/lib/money'
import type { RegionCode, ServiceType } from '@/types'

const FLOW = [
  { key: 'client', title: 'B2B Client', detail: 'Retailers & brands contract for last-mile delivery' },
  { key: 'ops', title: 'Network Ops', detail: 'Accept → sort → out for delivery under SLA' },
  { key: 'dsp', title: 'DSP Partners', detail: 'Local drivers execute final mile (cost driver)' },
  { key: 'consumer', title: 'Consumer', detail: 'Parcel delivered; billable event created' },
]

export function CompanyOverview() {
  const { data, filters, setFilters, navigateWithContext, openEntityDrawer } = useApp()
  const [bubbleMetric, setBubbleMetric] = useState<BubbleMetric>('shipments')
  const [selectedMetro, setSelectedMetro] = useState<string | null>(null)

  const model = useMemo(() => computeCompanyOverview(data, filters), [data, filters])

  const onMetro = (row: MetroFootprintRow) => {
    setSelectedMetro(row.metro)
    setFilters({ ...filters, regions: [row.region] })
  }

  const jumpMetroToUnit = (row: MetroFootprintRow) => {
    navigateWithContext('/unit-economics', { region: row.region })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-600">
            Company Profile · Synthetic Last-Mile Carrier
          </p>
          <h2 className="text-lg font-semibold text-ink">Company Overview</h2>
          <p className="text-xs text-ink-muted">
            Business model, scale, footprint, and portfolio — not the weekly action board (see Executive
            Overview). Period: {model.scale.periodLabel}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg bg-forest px-3 py-1.5 text-xs font-medium text-white hover:bg-forest-muted"
          onClick={() =>
            exportToCsv('company_overview.csv', [
              { section: 'scale', ...model.scale, ...model.sharedCheck },
              ...model.topCustomers.map((r) => ({ section: 'customer', ...r })),
              ...model.services.map((r) => ({ section: 'service', ...r })),
              ...model.metros.map((r) => ({ section: 'metro', ...r })),
            ] as Record<string, unknown>[])
          }
        >
          Export Snapshot
        </button>
      </div>

      {/* 1. Business Profile */}
      <ChartCard
        title="Business Profile"
        subtitle="B2B last-mile delivery — how revenue and variable cost are created"
        businessQuestion="How does this synthetic carrier make money?"
        formula="Revenue from rated/billed shipments under contract rate cards; variable cost mainly DSP + sort + linehaul"
        source="Narrative + dim_customer / fact_shipment / fact_billing_line / fact_cost"
        timeBasis={model.scale.periodLabel}
      >
        <p className="mb-3 max-w-3xl text-sm text-ink">
          This demo models a US <strong>B2B last-mile delivery</strong> company: enterprise and mid-market
          shippers contract for package delivery to end consumers. Commercial revenue is earned when
          billable shipments are rated and billed against customer rate cards; contribution profit is net
          billing minus variable delivery costs (DSP, sorting, linehaul, redelivery, claims). Fixed
          facilities/admin are allocated separately on Unit Economics — not shown as company capacity here.
        </p>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW.map((step, i) => (
            <li key={step.key} className="rounded-xl border border-[#dce6df] bg-[#f5f8f5] px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-600">
                Step {i + 1}
              </p>
              <p className="mt-1 text-sm font-semibold text-ink">{step.title}</p>
              <p className="mt-1 text-[11px] text-ink-muted">{step.detail}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[11px] text-ink-muted">
          Client → Operations → DSP → Consumer. Cash collection and revenue recognition may lag billing
          (see Lifecycle / Reconciliation).
        </p>
      </ChartCard>

      {/* 2. Business Scale */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          Business Scale · {model.scale.periodLabel}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <ScaleStat
            label="Active Customers"
            value={formatNumber(model.scale.activeCustomers)}
            hint={model.scale.activeCustomerDefinition}
            period={model.scale.periodLabel}
          />
          <KpiCard
            kpiId="recognized_revenue"
            value={model.scale.recognizedRevenue}
            scopeNote={`Period ${model.scale.periodLabel}`}
            actions={[
              {
                label: 'View Breakdown',
                onClick: () => navigateWithContext('/lifecycle'),
              },
              {
                label: 'Trace Source',
                onClick: () =>
                  openEntityDrawer({
                    entityType: 'kpi',
                    entityId: 'recognized_revenue',
                    label: 'Recognized Revenue',
                  }),
              },
            ]}
          />
          <KpiCard
            kpiId="net_billed_revenue"
            value={model.scale.netBilling}
            scopeNote={`Period ${model.scale.periodLabel} · commercial billing`}
            actions={[
              {
                label: 'View Breakdown',
                onClick: () => navigateWithContext('/reconciliation'),
              },
            ]}
          />
          <ScaleStat
            label="Shipment Volume"
            value={formatNumber(model.scale.shipmentVolume)}
            hint="Distinct shipments with ship_date in filter (deduped by shipment_id)"
            period={model.scale.periodLabel}
          />
          <ScaleStat
            label="Active Metro Markets"
            value={formatNumber(model.scale.activeMetroMarkets)}
            hint="Distinct metro labels on shipments in period"
            period={model.scale.periodLabel}
          />
          <ScaleStat
            label="Service Types Active"
            value={formatNumber(model.scale.serviceTypesInPeriod)}
            hint="Distinct service_type on shipments in period (of Standard / Economy / Express / SameDay)"
            period={model.scale.periodLabel}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {model.scale.unavailable.map((u) => (
            <span
              key={u.label}
              className="rounded-md border border-dashed border-[#c5d5cb] bg-white px-2 py-1 text-[10px] text-ink-muted"
              title={u.reason}
            >
              {u.label}: <em>unavailable</em>
            </span>
          ))}
        </div>
      </div>

      {/* 3. Geographic Footprint */}
      <ChartCard
        title="Geographic Footprint"
        subtitle="Click a metro to filter this page by its region · Jump opens Unit Economics"
        businessQuestion="Where does volume and commercial revenue concentrate?"
        formula="Shipments by fact_shipment.metro; Net Billing attributed via shipment_id → billing_line (no fan-out)"
        source="METRO_DEFINITIONS centroids + fact_shipment / fact_billing_line"
        timeBasis={model.scale.periodLabel}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="filter-input"
              value={bubbleMetric}
              onChange={(e) => setBubbleMetric(e.target.value as BubbleMetric)}
            >
              <option value="shipments">Bubble = Shipments</option>
              <option value="revenue">Bubble = Net Billing</option>
            </select>
            {selectedMetro && (
              <button
                type="button"
                className="rounded-md bg-forest px-2 py-1 text-[11px] text-white"
                onClick={() => {
                  const row = model.metros.find((m) => m.metro === selectedMetro)
                  if (row) jumpMetroToUnit(row)
                }}
              >
                Open Unit Economics · {selectedMetro}
              </button>
            )}
          </div>
        }
      >
        <UsMetroMap
          metros={model.metros}
          metric={bubbleMetric}
          selectedMetro={selectedMetro}
          onSelect={onMetro}
        />
        <DataTable
          rows={model.metros
            .slice()
            .sort((a, b) => b.shipments - a.shipments)
            .map((m) => ({ ...m, id: m.metro }))}
          rowKey={(r) => r.metro}
          onRowClick={(r) => {
            onMetro(r)
            jumpMetroToUnit(r)
          }}
          columns={[
            { key: 'metro', header: 'Metro', render: (r) => r.metro },
            { key: 'reg', header: 'Region', render: (r) => r.region },
            {
              key: 'ship',
              header: 'Shipments',
              align: 'right',
              render: (r) => formatNumber(r.shipments),
              sortValue: (r) => r.shipments,
            },
            {
              key: 'rev',
              header: 'Net Billing',
              align: 'right',
              render: (r) => formatCurrency(r.revenue, true),
              sortValue: (r) => r.revenue,
            },
            {
              key: 'coord',
              header: 'Lat / Lon',
              render: (r) => (
                <span className="font-mono text-[10px]">
                  {r.lat.toFixed(2)}, {r.lon.toFixed(2)}
                </span>
              ),
            },
          ]}
        />
      </ChartCard>

      {/* 4. Customer Portfolio */}
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="Customer Portfolio by Segment"
          subtitle="Active customers & Net Billing share"
          formula="Revenue Share = segment net_billing / total net_billing in filter"
          source="dim_customer.segment + fact_billing_line"
          timeBasis={model.scale.periodLabel}
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={model.segments}
                  dataKey="revenue"
                  nameKey="segment"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={(p) => String((p as { segment?: string }).segment ?? '')}
                >
                  {model.segments.map((s) => (
                    <Cell
                      key={s.segment}
                      fill={
                        s.segment === 'Enterprise'
                          ? '#123C35'
                          : s.segment === 'Mid-Market'
                            ? '#00A86B'
                            : '#7CB342'
                      }
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => formatCurrency(Number(v))}
                  labelFormatter={(_, p) => (p?.[0]?.payload as { segment?: string })?.segment ?? ''}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <DataTable
            rows={model.segments.map((s) => ({ ...s, id: s.segment }))}
            rowKey={(r) => r.segment}
            columns={[
              { key: 'seg', header: 'Segment', render: (r) => r.segment },
              {
                key: 'n',
                header: 'Active Cust.',
                align: 'right',
                render: (r) => formatNumber(r.customers),
              },
              {
                key: 'rev',
                header: 'Net Billing',
                align: 'right',
                render: (r) => formatCurrency(r.revenue, true),
              },
              {
                key: 'share',
                header: 'Share',
                align: 'right',
                render: (r) => formatPercent(r.revenueShare),
              },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Top 10 Customers by Net Billing"
          subtitle={`Top 5 concentration ${formatPercent(model.growth.top5Concentration)} · click → Customer 360`}
          formula={model.growth.hhiNote}
          source="fact_billing_line aggregated by customer_id"
          timeBasis={model.scale.periodLabel}
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={model.topCustomers}
                layout="vertical"
                margin={{ left: 8, right: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) =>
                    Math.abs(Number(v)) < 1000
                      ? `$${Math.round(Number(v))}`
                      : `$${(Number(v) / 1000).toFixed(0)}k`
                  }
                />
                <YAxis type="category" dataKey="customerName" width={110} tick={{ fontSize: 9 }} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Bar
                  dataKey="revenue"
                  fill="#123C35"
                  radius={[0, 4, 4, 0]}
                  onClick={(d) => {
                    const row = d as unknown as { customerId?: string; customerName?: string }
                    if (row.customerId) {
                      navigateWithContext('/customers', {
                        customerId: row.customerId,
                        highlightCustomerId: row.customerId,
                        openEntity: {
                          entityType: 'customer',
                          entityId: row.customerId,
                          label: row.customerName,
                        },
                      })
                    }
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <DataTable
            rows={model.topCustomers.map((c) => ({ ...c, id: c.customerId }))}
            rowKey={(r) => r.customerId}
            onRowClick={(r) =>
              navigateWithContext('/customers', {
                customerId: r.customerId,
                highlightCustomerId: r.customerId,
                openEntity: {
                  entityType: 'customer',
                  entityId: r.customerId,
                  label: r.customerName,
                },
              })
            }
            columns={[
              { key: 'name', header: 'Customer', render: (r) => r.customerName },
              { key: 'seg', header: 'Segment', render: (r) => r.segment },
              { key: 'ind', header: 'Industry', render: (r) => r.industry },
              {
                key: 'rev',
                header: 'Net Billing',
                align: 'right',
                render: (r) => formatCurrencyPrecise(r.revenue),
                sortValue: (r) => r.revenue,
              },
              {
                key: 'share',
                header: 'Share',
                align: 'right',
                render: (r) => formatPercent(r.revenueShare),
              },
            ]}
          />
        </ChartCard>
      </div>

      <ChartCard
        title="Industry Structure"
        subtitle="From dim_customer.industry · Net Billing basis"
        timeBasis={model.scale.periodLabel}
      >
        <DataTable
          rows={model.industries.map((i) => ({ ...i, id: i.industry }))}
          rowKey={(r) => r.industry}
          columns={[
            { key: 'ind', header: 'Industry', render: (r) => r.industry },
            {
              key: 'n',
              header: 'Customers',
              align: 'right',
              render: (r) => formatNumber(r.customers),
            },
            {
              key: 'rev',
              header: 'Net Billing',
              align: 'right',
              render: (r) => formatCurrency(r.revenue, true),
              sortValue: (r) => r.revenue,
            },
            {
              key: 'share',
              header: 'Share',
              align: 'right',
              render: (r) => formatPercent(r.revenueShare),
            },
          ]}
        />
      </ChartCard>

      {/* 5. Service Portfolio */}
      <ChartCard
        title="Service Portfolio"
        subtitle="Click a service → Revenue Lifecycle with that service filter. RPP uses Net Billing ÷ billed packages (≠ Recognized)."
        formula="Revenue per Package = Net Billing / distinct billed shipment_id for that service"
        source="fact_shipment, fact_billing_line"
        timeBasis={model.scale.periodLabel}
      >
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={model.services}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
              <XAxis dataKey="serviceType" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
              <YAxis
                yAxisId="r"
                orientation="right"
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip />
              <Legend />
              <Bar
                yAxisId="l"
                dataKey="shipments"
                name="Shipments"
                fill="#7CB342"
                radius={[4, 4, 0, 0]}
                onClick={(d) => {
                  const row = d as unknown as { serviceType?: ServiceType }
                  if (row.serviceType) {
                    setFilters({ ...filters, serviceTypes: [row.serviceType] })
                  }
                }}
              />
              <Bar
                yAxisId="r"
                dataKey="netBilling"
                name="Net Billing"
                fill="#123C35"
                radius={[4, 4, 0, 0]}
                onClick={(d) => {
                  const row = d as unknown as { serviceType?: ServiceType }
                  if (row.serviceType) {
                    navigateWithContext('/lifecycle', { serviceType: row.serviceType })
                  }
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <DataTable
          rows={model.services.map((s) => ({ ...s, id: s.serviceType }))}
          rowKey={(r) => r.serviceType}
          onRowClick={(r) => navigateWithContext('/lifecycle', { serviceType: r.serviceType })}
          columns={[
            { key: 'svc', header: 'Service', render: (r) => r.serviceType },
            {
              key: 'ship',
              header: 'Shipments',
              align: 'right',
              render: (r) => formatNumber(r.shipments),
            },
            {
              key: 'bill',
              header: 'Billed Pkgs',
              align: 'right',
              render: (r) => formatNumber(r.billedPackages),
            },
            {
              key: 'rev',
              header: 'Net Billing',
              align: 'right',
              render: (r) => formatCurrency(r.netBilling, true),
            },
            {
              key: 'rpp',
              header: 'Rev / Pkg',
              align: 'right',
              render: (r) => (r.revenuePerPackage != null ? formatCurrencyPrecise(r.revenuePerPackage) : '—'),
            },
            {
              key: 'share',
              header: 'Share',
              align: 'right',
              render: (r) => formatPercent(r.revenueShare),
            },
          ]}
        />
      </ChartCard>

      {/* 6. Growth & Exposure */}
      <ChartCard
        title="Growth & Business Exposure"
        subtitle={model.growth.note}
        businessQuestion="Is the book growing on a comparable window, and how concentrated is it?"
        formula="Growth = (Current − Prior) / Prior · equal-length priorPeriodRange"
        source="computeCompanyOverview + computeSharedMetrics"
        timeBasis={`${model.growth.currentLabel}${model.growth.priorLabel ? ` vs ${model.growth.priorLabel}` : ''}`}
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-3 text-xs">
          <GrowthChip
            label="Shipment Growth"
            value={
              model.growth.shipmentGrowth == null
                ? 'Insufficient history'
                : formatPercent(model.growth.shipmentGrowth)
            }
          />
          <GrowthChip
            label="Recognized Revenue Growth"
            value={
              model.growth.recognizedGrowth == null
                ? 'Insufficient history'
                : formatPercent(model.growth.recognizedGrowth)
            }
          />
          <GrowthChip
            label="Net Billing Growth"
            value={
              model.growth.netBillingGrowth == null
                ? 'Insufficient history'
                : formatPercent(model.growth.netBillingGrowth)
            }
          />
        </div>
        {!model.growth.comparable && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
            Comparable prior window is outside available synthetic history — rates not invented.
          </p>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="h-56">
            <p className="mb-1 text-[11px] font-semibold text-ink">Monthly Shipment Trend</p>
            <ResponsiveContainer width="100%" height="90%">
              <LineChart data={model.monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="shipments" stroke="#00A86B" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="h-56">
            <p className="mb-1 text-[11px] font-semibold text-ink">
              Monthly Revenue Trend (Recognized vs Net Billing)
            </p>
            <ResponsiveContainer width="100%" height="90%">
              <LineChart data={model.monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="recognizedRevenue"
                  name="Recognized"
                  stroke="#123C35"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="netBilling"
                  name="Net Billing"
                  stroke="#E58A2B"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <p className="mt-2 text-[11px] font-semibold text-ink">Click a month → set period & open detail page</p>
        <DataTable
          rows={model.monthly.map((m) => ({ ...m, id: m.period }))}
          rowKey={(r) => r.period}
          onRowClick={(r) =>
            navigateWithContext('/executive', {
              startPeriod: r.period,
              endPeriod: r.period,
            })
          }
          columns={[
            { key: 'p', header: 'Month', render: (r) => r.period },
            {
              key: 's',
              header: 'Shipments',
              align: 'right',
              render: (r) => formatNumber(r.shipments),
            },
            {
              key: 'rec',
              header: 'Recognized',
              align: 'right',
              render: (r) => formatCurrency(r.recognizedRevenue, true),
            },
            {
              key: 'net',
              header: 'Net Billing',
              align: 'right',
              render: (r) => formatCurrency(r.netBilling, true),
            },
          ]}
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <ScaleStat
            label="Existing Customer Net Billing"
            value={formatCurrency(model.growth.existingCustomerRevenue, true)}
            hint="acquired_date before period start"
            period={model.scale.periodLabel}
          />
          <ScaleStat
            label="New Customer Net Billing"
            value={formatCurrency(model.growth.newCustomerRevenue, true)}
            hint="acquired_date ≥ period start month"
            period={model.scale.periodLabel}
          />
          <ScaleStat
            label="New vs Existing Share (New)"
            value={formatPercent(model.growth.newShare)}
            hint="New / (New + Existing) net billing"
            period={model.scale.periodLabel}
          />
          <ScaleStat
            label="Top 5 Customer Concentration"
            value={formatPercent(model.growth.top5Concentration)}
            hint="Top 5 net billing / total net billing"
            period={model.scale.periodLabel}
          />
        </div>

        <p className="mt-3 text-[11px] font-semibold text-ink">Regional Concentration (Net Billing)</p>
        <DataTable
          rows={model.growth.regionalConcentration.map((r) => ({ ...r, id: r.region }))}
          rowKey={(r) => r.region}
          onRowClick={(r) => navigateWithContext('/unit-economics', { region: r.region as RegionCode })}
          columns={[
            { key: 'reg', header: 'Region', render: (r) => r.region },
            {
              key: 'rev',
              header: 'Net Billing',
              align: 'right',
              render: (r) => formatCurrency(r.revenue, true),
            },
            {
              key: 'share',
              header: 'Share',
              align: 'right',
              render: (r) => formatPercent(r.share),
            },
          ]}
        />
      </ChartCard>

      <p className="text-[11px] text-ink-muted">
        Consistency check vs shared metrics: Recognized {formatCurrencyPrecise(model.sharedCheck.recognizedRevenue)}{' '}
        · Net Billing {formatCurrencyPrecise(model.sharedCheck.netBilledRevenue)}. DSP count / Facilities /
        Stations intentionally omitted (unavailable in synthetic model).
      </p>
    </div>
  )
}

function ScaleStat({
  label,
  value,
  hint,
  period,
}: {
  label: string
  value: string
  hint: string
  period: string
}) {
  return (
    <div className="card-surface border-l-4 border-l-brand-400 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold text-ink">{value}</p>
      <p className="mt-2 text-[10px] text-ink-muted">Period: {period}</p>
      <p className="mt-1 text-[10px] text-ink-muted">{hint}</p>
    </div>
  )
}

function GrowthChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#dce6df] bg-[#f5f8f5] px-3 py-2">
      <p className="text-[10px] uppercase text-ink-muted">{label}</p>
      <p className="font-mono text-sm font-semibold text-ink">{value}</p>
    </div>
  )
}
