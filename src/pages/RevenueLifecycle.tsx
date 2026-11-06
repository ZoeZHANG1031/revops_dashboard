import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { computeTraceability } from '@/calc/kpis'
import { computeOperationalPipeline, computeSalesPipeline } from '@/calc/lifecycle'
import { computeCohortConversions } from '@/calc/salesCohort'
import { ChartCard } from '@/components/common/ChartCard'
import { DataTable } from '@/components/common/DataTable'
import { useApp } from '@/context/AppContext'
import { formatCurrency, formatCurrencyPrecise, formatNumber, formatPercent } from '@/lib/money'

export function RevenueLifecycle() {
  const { data, filters, pushDrill, navigateToEntity, navigateWithContext } = useApp()
  const sales = useMemo(() => computeSalesPipeline(data), [data])
  const cohort = useMemo(() => computeCohortConversions(data), [data])
  const ops = useMemo(() => computeOperationalPipeline(data, filters), [data, filters])
  const [selectedRev, setSelectedRev] = useState<string | null>(null)
  const [stageKey, setStageKey] = useState<string | null>(null)
  const [showAllRates, setShowAllRates] = useState(false)

  const activeRates = useMemo(() => {
    const today = data.meta.snapshot_label.slice(0, 10) || '2024-11-05'
    const active = data.rateCards.filter(
      (r) => r.effective_from <= today && r.effective_to >= today,
    )
    return showAllRates ? data.rateCards : active
  }, [data, showAllRates])

  const stageRecords = useMemo(() => {
    if (!stageKey) return []
    const ships = data.shipments.filter((s) => {
      if (filters.customerIds.length && !filters.customerIds.includes(s.customer_id)) return false
      if (filters.regions.length && !filters.regions.includes(s.region)) return false
      if (filters.serviceTypes.length && !filters.serviceTypes.includes(s.service_type)) return false
      const period = s.ship_date.slice(0, 7)
      if (period < filters.startPeriod || period > filters.endPeriod) return false
      return true
    })
    const billedIds = new Set(
      data.billingLines
        .filter((b) => !b.is_duplicate)
        .map((b) => b.shipment_id),
    )
    if (stageKey === 'billable') return ships.filter((s) => s.billable).slice(0, 40)
    if (stageKey === 'billed') return ships.filter((s) => billedIds.has(s.shipment_id)).slice(0, 40)
    if (stageKey === 'missing_billing')
      return ships.filter((s) => s.billable && !billedIds.has(s.shipment_id)).slice(0, 40)
    if (stageKey === 'shipments') return ships.slice(0, 40)
    return ships.slice(0, 40)
  }, [stageKey, data, filters])

  const headerRev = useMemo(
    () =>
      data.revenueRecognition.filter(
        (r) =>
          r.billing_line_id === null &&
          r.accounting_period >= filters.startPeriod &&
          r.accounting_period <= filters.endPeriod &&
          (filters.customerIds.length === 0 || filters.customerIds.includes(r.customer_id)),
      ),
    [data, filters],
  )

  const trace = selectedRev ? computeTraceability(data, selectedRev) : null

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-ink">Revenue Lifecycle & Pipeline</h2>
        <p className="text-xs text-ink-muted">
          Lead → Opportunity → Contract → Shipment → Billing → Invoice → Recognition → Collection.
          Recognition and cash are modeled independently.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pipeline Value" value={formatCurrency(sales.pipelineValue, true)} />
        <Stat label="Weighted Pipeline" value={formatCurrency(sales.weightedPipeline, true)} hint="Value × Win %" />
        <Stat label="Win Rate" value={formatPercent(sales.winRate)} />
        <Stat
          label="Avg Sales Cycle"
          value={sales.salesCycleLength != null ? `${sales.salesCycleLength} days` : '—'}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="Sales Stage Stock (not a cascading funnel)"
          subtitle={sales.note}
          businessQuestion="Where does open pipeline sit today — by stage stock?"
          formula="Weighted = Opportunity Value × Win Probability (bookings potential ≠ revenue)"
          source="fact_opportunity"
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sales.stageStock} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#dce6df" />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="stage" width={90} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Bar dataKey="value" name="Stage stock $" fill="#123C35" radius={[0, 4, 4, 0]} />
                <Bar dataKey="weighted" name="Weighted $" fill="#00A86B" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            Chart above = <strong>stage stock</strong> (independent counts). True cohort conversions use stage
            history events below — not stock ratios.
          </div>
          <div className="mt-3">
            <p className="text-xs font-semibold text-ink mb-1">Cohort conversions (from stage events)</p>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {cohort.conversions.map((c) => (
                <div key={`${c.from}-${c.to}`} className="rounded bg-[#f5f8f5] px-2 py-1.5">
                  <div className="flex justify-between font-medium">
                    <span>
                      {c.from} → {c.to}
                    </span>
                    <span className="font-mono">{formatPercent(c.rate)}</span>
                  </div>
                  <p className="text-ink-muted">
                    {c.reachedTo}/{c.enteredFrom} opps · Win rate {formatPercent(cohort.winRate)} · Cycle{' '}
                    {cohort.avgSalesCycleDays ?? '—'}d
                  </p>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Closed Won logos: {sales.newCustomerAcquisition} · Open expected monthly revenue:{' '}
            {formatCurrency(sales.expectedMonthlyRevenue, true)} · Expected volume:{' '}
            {formatNumber(sales.expectedMonthlyVolume)} pkgs/mo
          </p>
        </ChartCard>

        <ChartCard
          title="Operational Revenue Pipeline"
          subtitle="Click a stage to list underlying records. Billable→Billed gap = missing billing set."
        >
          <ol className="space-y-2">
            {ops.stages.map((s, i) => (
              <li key={s.key}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs hover:bg-brand-50 ${
                    stageKey === s.key ? 'bg-brand-50 ring-1 ring-brand-200' : 'bg-slate-50'
                  }`}
                  onClick={() => {
                    setStageKey(stageKey === s.key ? null : s.key)
                    if (s.key === 'billable' || s.key === 'billed' || s.key.includes('bill')) {
                      /* keep local stage list */
                    }
                  }}
                >
                  <span className="font-medium text-ink">
                    {i + 1}. {s.label}
                  </span>
                  <span className="font-mono text-brand-800">
                    {s.unit === 'money' ? formatCurrency(s.value, true) : formatNumber(s.value)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="mt-2 text-[11px] text-brand-700 hover:underline"
            onClick={() => {
              setStageKey('missing_billing')
              navigateWithContext('/reconciliation', {
                exceptionType: 'Missing Billing',
                exceptionStatus: 'Open',
              })
            }}
          >
            Investigate Billable → Billed gap (Missing Billing)
          </button>
          <div className="mt-3 space-y-1.5">
            {ops.conversions.map((c) => (
              <div key={c.from} className="flex items-start justify-between gap-2 text-xs">
                <div>
                  <p className="font-medium text-ink">{c.from}</p>
                  <p className="text-ink-muted">{c.leakage}</p>
                </div>
                <span className="font-mono">{formatPercent(c.rate)}</span>
              </div>
            ))}
          </div>
          {stageKey && stageRecords.length > 0 && (
            <div className="mt-3 rounded-lg border border-[#dce6df] p-2">
              <p className="mb-1 text-[11px] font-semibold text-ink">
                Stage records · {stageKey} ({stageRecords.length})
              </p>
              <DataTable
                rows={stageRecords.map((s) => ({ ...s, id: s.shipment_id }))}
                rowKey={(r) => r.shipment_id}
                onRowClick={(r) => navigateToEntity('shipment', r.shipment_id, r.shipment_id)}
                columns={[
                  { key: 'id', header: 'Shipment', render: (r) => r.shipment_id },
                  { key: 'cust', header: 'Customer', render: (r) => r.customer_id },
                  { key: 'svc', header: 'Service', render: (r) => r.service_type },
                  { key: 'date', header: 'Ship Date', render: (r) => r.ship_date },
                  { key: 'st', header: 'Status', render: (r) => r.delivery_status },
                ]}
              />
            </div>
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="Pricing Rules in Force"
        subtitle="Default: currently effective versions only. Match ship_date to effective window — not latest."
        action={
          <button
            type="button"
            className="text-xs text-brand-700"
            onClick={() => setShowAllRates((v) => !v)}
          >
            {showAllRates ? 'Show active only' : 'Show all versions'}
          </button>
        }
      >
        <DataTable
          rows={activeRates.slice(0, 40).map((r) => ({ ...r, id: r.rate_card_id }))}
          rowKey={(r) => r.rate_card_id}
          onRowClick={(r) => navigateToEntity('rate_card', r.rate_card_id, r.rate_card_id)}
          columns={[
            { key: 'id', header: 'Rate Card', render: (r) => r.rate_card_id },
            { key: 'con', header: 'Contract', render: (r) => r.contract_id },
            { key: 'svc', header: 'Service', render: (r) => r.service_type },
            { key: 'reg', header: 'Region', render: (r) => r.region },
            {
              key: 'base',
              header: 'Base',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.base_rate),
              sortValue: (r) => r.base_rate,
            },
            {
              key: 'fuel',
              header: 'Fuel %',
              align: 'right',
              render: (r) => formatPercent(r.fuel_surcharge_pct * 100),
            },
            { key: 'ver', header: 'Ver', render: (r) => String(r.version) },
            {
              key: 'eff',
              header: 'Effective',
              render: (r) => `${r.effective_from} → ${r.effective_to}`,
            },
          ]}
        />
      </ChartCard>

      <ChartCard
        title="Revenue Traceability"
        subtitle="Recognized Revenue → GL → Rev Rec Detail → Invoice → Billing Line → Shipment → Rate Card"
      >
        <DataTable
          rows={headerRev.map((r) => ({ ...r, id: r.rev_rec_id }))}
          rowKey={(r) => r.rev_rec_id}
          onRowClick={(r) => {
            setSelectedRev(r.rev_rec_id)
            navigateToEntity('recognition', r.rev_rec_id, r.rev_rec_id)
            pushDrill({
              level: 'customer',
              id: r.customer_id,
              label: data.customers.find((c) => c.customer_id === r.customer_id)?.customer_name ?? r.customer_id,
            })
          }}
          columns={[
            { key: 'id', header: 'Rev Rec ID', render: (r) => r.rev_rec_id },
            {
              key: 'cust',
              header: 'Customer',
              render: (r) =>
                data.customers.find((c) => c.customer_id === r.customer_id)?.customer_name ?? r.customer_id,
            },
            { key: 'period', header: 'Period', render: (r) => r.accounting_period },
            { key: 'type', header: 'Type', render: (r) => r.recognition_type },
            {
              key: 'amt',
              header: 'Amount',
              align: 'right',
              render: (r) => formatCurrencyPrecise(r.amount),
              sortValue: (r) => r.amount,
            },
            { key: 'inv', header: 'Invoice', render: (r) => r.invoice_id ?? '—' },
          ]}
        />

        {trace && (
          <div className="mt-4 space-y-3 rounded-lg border border-brand-100 bg-brand-50/40 p-3 text-xs">
            <p className="font-semibold text-ink">
              Trace for {trace.header.rev_rec_id} · {formatCurrencyPrecise(trace.header.amount)}
            </p>
            <TraceBlock title="GL Entries" rows={trace.gl.map((g) => `${g.gl_entry_id} ${g.account_name}: Dr ${g.debit} / Cr ${g.credit}`)} />
            <TraceBlock
              title="Invoice"
              rows={
                trace.invoice
                  ? [
                      `${trace.invoice.invoice_id} net ${formatCurrencyPrecise(trace.invoice.net_amount)} (${trace.invoice.status})`,
                    ]
                  : ['—']
              }
            />
            <TraceBlock
              title="Billing Lines"
              rows={trace.billingLines.map(
                (b) =>
                  `${b!.billing_line_id} · ${b!.shipment_id} · net ${formatCurrencyPrecise(b!.net_amount)} = base ${b!.base_charge} + fuel ${b!.fuel_surcharge} + remote ${b!.remote_surcharge} − disc ${b!.discounts} − credits ${b!.credits}`,
              )}
            />
            <TraceBlock
              title="Shipments"
              rows={trace.shipments.map(
                (s) =>
                  `${s!.shipment_id} · ${s!.service_type} · ${s!.region} Z${s!.zone} · ${s!.weight_lbs} lb · ${s!.delivery_status}`,
              )}
            />
            <TraceBlock
              title="Rate Cards"
              rows={trace.rateCards.map(
                (r) =>
                  `${r!.rate_card_id} v${r!.version} base ${r!.base_rate} /lb ${r!.per_lb_rate} fuel ${(r!.fuel_surcharge_pct * 100).toFixed(1)}% (${r!.effective_from}→${r!.effective_to})`,
              )}
            />
          </div>
        )}
      </ChartCard>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold text-ink">{value}</p>
      {hint && <p className="mt-1 text-[10px] text-ink-muted">{hint}</p>}
    </div>
  )
}

function TraceBlock({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div>
      <p className="font-semibold text-brand-900">{title}</p>
      <ul className="mt-1 max-h-28 overflow-auto font-mono text-[10px] text-ink-muted">
        {rows.slice(0, 12).map((r) => (
          <li key={r}>{r}</li>
        ))}
        {rows.length > 12 && <li>… +{rows.length - 12} more</li>}
      </ul>
    </div>
  )
}
