import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { computeOperationalPipeline } from '@/calc/lifecycle'
import type { LifecycleMonth } from '@/calc/lifecycleStages'
import { ChartCard } from '@/components/common/ChartCard'
import { DataTable } from '@/components/common/DataTable'
import { FloatingWaterfall } from '@/components/charts/FloatingWaterfall'
import { PALETTE } from '@/lib/icons'
import {
  formatAxisMoney,
  formatCurrency,
  formatCurrencyPrecise,
  formatNumber,
  formatPercent,
} from '@/lib/money'

type Ops = ReturnType<typeof computeOperationalPipeline>

export function LifecycleComplementCharts({
  ops,
  months,
  onOpenCustomer,
  onOpenUnbilledLot,
  onInvestigateUnbilled,
  onFilterCustomer,
}: {
  ops: Ops
  months: LifecycleMonth[]
  onOpenCustomer?: (customerId: string) => void
  onOpenUnbilledLot?: (shipmentId: string) => void
  onInvestigateUnbilled?: () => void
  onFilterCustomer?: (customerId: string) => void
}) {
  const [showOutside, setShowOutside] = useState(false)
  const [showNonBillable, setShowNonBillable] = useState(false)
  const [selectedUnbilledCust, setSelectedUnbilledCust] = useState<string | null>(null)

  const act = ops.activation
  const split = ops.billableSplit
  const bridge = ops.bridge
  const unbilled = ops.unbilled
  const cycles = ops.cycles
  const accuracy = ops.billingAccuracy

  const trend = months.map((m) => ({
    period: m.period,
    netBilling: m.netBilling,
    recognized: m.recognized,
    cash: m.cash,
  }))

  const agingData = unbilled.buckets.map((b) => ({
    ...b,
    fill: b.key === '31+' && b.packages > 0 ? PALETTE.watch : PALETTE.brandMid,
  }))

  const topCustData = unbilled.topCustomers.map((c) => ({
    ...c,
    name: c.customerName.length > 18 ? `${c.customerName.slice(0, 16)}…` : c.customerName,
  }))

  const unbilledInsight = useMemo(() => {
    if (!unbilled.unbilledPackages) return null
    const top = unbilled.topCustomers[0]
    return `${formatNumber(unbilled.unbilledPackages)} unbilled billable packages · oldest ${
      unbilled.oldestDays ?? '—'
    }d since shipment${top ? ` · top ${top.customerName}` : ''}`
  }, [unbilled])

  const filteredLots = selectedUnbilledCust
    ? unbilled.sampleLots.filter((s) => s.customer_id === selectedUnbilledCust)
    : unbilled.sampleLots

  return (
    <div className="space-y-4">
      {/* Row 2: activation + billable + amount bridge */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-4">
          <ChartCard
            title="Customer activation"
            subtitle={`Activity period · ${formatNumber(act.contractCount)} contracts ≠ ${formatNumber(act.eligibleCustomers)} customers`}
          >
            <p
              className="text-2xl font-semibold tabular-nums text-ink"
              title={act.dateBasis}
            >
              {formatPercent(act.activationRate)}
            </p>
            <p className="text-[11px] text-ink-muted">
              Activated {formatNumber(act.activated)} ÷ Eligible {formatNumber(act.eligibleCustomers)}
            </p>
            <div className="mt-3 space-y-1.5 text-xs">
              <SetRow label="Eligible customers" value={act.eligibleCustomers} />
              <SetRow label="Activated" value={act.activated} tone="brand" />
              <SetRow label="Not yet activated" value={act.notYetActivated} />
              <SetRow
                label="Shipping outside eligible"
                value={act.shippingOutsideEligible}
                tone={act.shippingOutsideEligible > 0 ? 'watch' : undefined}
              />
            </div>
            {act.shippingOutsideEligible > 0 && (
              <button
                type="button"
                className="mt-2 text-[11px] text-forest underline"
                onClick={() => setShowOutside((v) => !v)}
              >
                {showOutside ? 'Hide' : 'Show'} outside-set customers
              </button>
            )}
            {showOutside && (
              <div className="mt-2">
                <p className="mb-1 text-[10px] text-ink-muted">
                  Reasons (evidence only): outside window{' '}
                  {act.reasonCounts['Contract outside relevant date window']} · missing link{' '}
                  {act.reasonCounts['Missing contract link']} · other{' '}
                  {act.reasonCounts['Other / Unclassified']}
                </p>
                <DataTable
                  rows={act.outsideCustomers.slice(0, 20)}
                  rowKey={(r) => r.customerId}
                  searchable={false}
                  defaultPageSize={8}
                  onRowClick={(r) => onOpenCustomer?.(r.customerId)}
                  columns={[
                    { key: 'n', header: 'Customer', render: (r) => r.customerName },
                    {
                      key: 'p',
                      header: 'Pkgs',
                      align: 'right',
                      render: (r) => formatNumber(r.packages),
                    },
                    { key: 'r', header: 'Reason', render: (r) => r.reason },
                  ]}
                />
              </div>
            )}
          </ChartCard>

          <ChartCard
            title="Shipments → Billable"
            subtitle="True proportions · ship_date · packages"
          >
            {split.billablePct == null ? (
              <p className="text-sm text-ink-muted">N/A</p>
            ) : (
              <>
                <div className="flex h-8 w-full overflow-hidden rounded-md bg-[#eef3f0]">
                  <div
                    className="flex items-center justify-center bg-forest text-[10px] font-medium text-white"
                    style={{ width: `${split.billablePct}%` }}
                    title={`Billable ${formatPercent(split.billablePct)}`}
                  >
                    {split.billablePct >= 12 ? 'Billable' : ''}
                  </div>
                  <div
                    className="bg-[#c5d0c9]"
                    style={{ width: `${split.nonBillablePct ?? 0}%` }}
                    title={`Non-billable ${formatNumber(split.nonBillable)}`}
                  />
                  {split.unknown > 0 ? (
                    <div
                      className="bg-[#e8d4a8]"
                      style={{ width: `${(split.unknown / Math.max(split.total, 1)) * 100}%` }}
                      title={`Unknown ${formatNumber(split.unknown)}`}
                    />
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  Total {formatNumber(split.total)} · Billable {formatNumber(split.billable)} (
                  {formatPercent(split.billablePct)}) · Non-billable {formatNumber(split.nonBillable)}{' '}
                  ({formatPercent(split.nonBillablePct)})
                  {split.unknown > 0 ? ` · Unknown ${formatNumber(split.unknown)}` : ''}
                </p>
                <p className="mt-1 text-[10px] text-ink-muted">
                  Non-billable = should not charge · Unbilled billable = should charge, no invoice yet
                </p>
                {split.nonBillable > 0 && (
                  <button
                    type="button"
                    className="mt-1 text-[11px] text-forest underline"
                    onClick={() => setShowNonBillable((v) => !v)}
                  >
                    {showNonBillable ? 'Hide' : 'Show'} non-billable reasons
                  </button>
                )}
                {showNonBillable && (
                  <ul className="mt-1 space-y-0.5 text-[11px] text-ink-muted">
                    {split.nonBillableReasons.map((r) => (
                      <li key={r.reason}>
                        {r.reason}: {formatNumber(r.packages)}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </ChartCard>

          <ChartCard
            title="Billing line accuracy"
            subtitle={`${formatNumber(ops.billingAccuracyMeta.correctlyBilledPackages)} / ${formatNumber(ops.billingAccuracyMeta.eligiblePackages)} packages`}
          >
            <p
              className="text-2xl font-semibold tabular-nums text-ink"
              title={ops.billingAccuracyMeta.formula}
            >
              {formatPercent(accuracy)}
            </p>
            <p className="text-[10px] text-ink-muted">
              Package-weighted · exact-once bill · no rating defect. Not cash or recognition rate.
            </p>
          </ChartCard>
        </div>

        <div className="lg:col-span-8">
          <ChartCard
            title="Gross Rated → Net Billing"
            subtitle={
              bridge.yieldComparable
                ? `Yield ${formatPercent(bridge.yieldPct)} · ${bridge.dateBasis}`
                : `Amount bridge · ${bridge.dateBasis}`
            }
          >
            <FloatingWaterfall
              steps={bridge.steps}
              height={240}
              totalKeys={['gross', 'net']}
              tickFormat={(v) => formatAxisMoney(v)}
              valueFormat={(v) => formatCurrencyPrecise(v)}
              footingNote={
                bridge.foots
                  ? 'Gross − discounts − credits (+ residual if any) = Net.'
                  : `Check residual ${formatCurrencyPrecise(bridge.residual)} — not force-filled.`
              }
            />
            <p className="mt-1 text-[10px] text-ink-muted" title={bridge.note}>
              Green / red = signed commercial adjustments · amber = residual. Full amounts in tooltip.
            </p>
          </ChartCard>
        </div>
      </div>

      {/* Row 3: Unbilled backlog */}
      <ChartCard
        title="Unbilled billable packages"
        subtitle={`As-of ${unbilled.asOf} · ${unbilled.ageBasis} · demo age buckets`}
        insight={unbilledInsight}
        action={
          onInvestigateUnbilled ? (
            <button
              type="button"
              className="rounded-md border border-[#dce6df] px-2 py-1 text-[11px] text-forest"
              onClick={onInvestigateUnbilled}
            >
              Open in Billing & Reconciliation
            </button>
          ) : null
        }
      >
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="grid grid-cols-3 gap-2 lg:col-span-4">
            <CompactStat
              label="Unbilled pkgs"
              value={formatNumber(unbilled.unbilledPackages)}
              watch={unbilled.unbilledPackages > 0}
            />
            <CompactStat
              label="Rated amount"
              value={formatCurrency(unbilled.ratedAmount, true)}
              hint={unbilled.ratedPartial ? 'Partial — some lots unrated' : 'Expected net where rateable'}
            />
            <CompactStat
              label="Oldest age"
              value={unbilled.oldestDays == null ? '—' : `${unbilled.oldestDays}d`}
              hint="Days since shipment"
              watch={(unbilled.oldestDays ?? 0) > 30}
            />
          </div>
          <div className="lg:col-span-4">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              Age since shipment
            </p>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={40} tickFormatter={(v) => formatNumber(Number(v))} />
                  <Tooltip
                    formatter={(v) => [formatNumber(Number(v)), 'Packages']}
                    labelFormatter={(l) => `${l} · ${unbilled.ageNote}`}
                  />
                  <Bar dataKey="packages" name="Packages" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {agingData.map((b) => (
                      <Cell key={b.key} fill={b.fill} />
                    ))}
                    <LabelList dataKey="packages" position="top" style={{ fontSize: 9 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="lg:col-span-4">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              Top customers
            </p>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCustData} layout="vertical" margin={{ left: 4, right: 28 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => formatNumber(Number(v))} />
                  <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 9 }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null
                      const r = payload[0].payload as (typeof topCustData)[0]
                      return (
                        <div className="rounded border border-[#dce6df] bg-white px-2 py-1 text-xs shadow">
                          <div className="font-semibold">{r.customerName}</div>
                          <div>{formatNumber(r.packages)} pkgs · {formatCurrencyPrecise(r.amount)}</div>
                          <div className="text-[10px] text-ink-muted">Oldest {r.oldestDays}d</div>
                        </div>
                      )
                    }}
                  />
                  <Bar
                    dataKey="packages"
                    fill={PALETTE.brand}
                    radius={[0, 4, 4, 0]}
                    cursor="pointer"
                    isAnimationActive={false}
                    onClick={(d) => {
                      const id = (d as { customerId?: string })?.customerId
                      if (!id) return
                      setSelectedUnbilledCust((cur) => (cur === id ? null : id))
                      onFilterCustomer?.(id)
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        {unbilled.limitNote ? (
          <p className="mt-2 text-[10px] text-amber-800">{unbilled.limitNote}</p>
        ) : (
          <p className="mt-2 text-[10px] text-ink-muted">{unbilled.ageNote}</p>
        )}
        {selectedUnbilledCust && (
          <div className="mt-2">
            <p className="mb-1 text-[11px] font-semibold text-ink">
              Lots · {selectedUnbilledCust}{' '}
              <button
                type="button"
                className="ml-2 text-forest underline"
                onClick={() => setSelectedUnbilledCust(null)}
              >
                Clear
              </button>
            </p>
            <DataTable
              rows={filteredLots.map((s) => ({ ...s, id: s.shipment_id }))}
              rowKey={(r) => r.shipment_id}
              searchable={false}
              defaultPageSize={8}
              onRowClick={(r) => onOpenUnbilledLot?.(r.shipment_id)}
              columns={[
                { key: 'id', header: 'Shipment', render: (r) => r.shipment_id },
                { key: 'd', header: 'Ship date', render: (r) => r.ship_date },
                {
                  key: 'p',
                  header: 'Pkgs',
                  align: 'right',
                  render: (r) => formatNumber(r.package_count),
                },
              ]}
            />
          </div>
        )}
        {(cycles.shipToInvoiceMedian != null || cycles.invoiceToPayMedian != null) && (
          <p className="mt-2 text-[11px] text-ink-muted" title={cycles.note}>
            Completed cycle medians: Shipment→Invoice{' '}
            {cycles.shipToInvoiceMedian == null ? '—' : `${cycles.shipToInvoiceMedian}d`} (n=
            {formatNumber(cycles.shipToInvoiceN)}) · Invoice→Payment{' '}
            {cycles.invoiceToPayMedian == null ? '—' : `${cycles.invoiceToPayMedian}d`} (n=
            {formatNumber(cycles.invoiceToPayN)})
            {cycles.openWaitingShipInvoicePackages > 0
              ? ` · ${formatNumber(cycles.openWaitingShipInvoicePackages)} pkgs still awaiting invoice`
              : ''}
          </p>
        )}
      </ChartCard>

      {/* Row 4: trend */}
      <ChartCard
        title="Billing · Recognition · Cash"
        subtitle="Linear monthly · three date bases — same month ≠ same cohort"
      >
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={PALETTE.grid} strokeDasharray="3 3" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => formatAxisMoney(Number(v))}
                width={52}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="rounded border border-[#dce6df] bg-white px-2 py-1.5 text-xs shadow">
                      <div className="font-semibold">{String(label)}</div>
                      {payload.map((p) => (
                        <div key={String(p.dataKey)}>
                          {String(p.name)}: {formatCurrencyPrecise(Number(p.value))}
                        </div>
                      ))}
                      <div className="mt-1 text-[10px] text-ink-muted">
                        Net · billing_period · Recognized · accounting_period · Cash · payment_date
                      </div>
                    </div>
                  )
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="linear"
                dataKey="netBilling"
                name="Net Billing"
                stroke={PALETTE.brandMid}
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="recognized"
                name="Recognized"
                stroke={PALETTE.forecast}
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="cash"
                name="Cash"
                stroke={PALETTE.positive}
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-[10px] text-ink-muted">
          Period differences are timing/scope — not same-batch conversion. Recognized − Cash ≠ Outstanding
          AR.
        </p>
      </ChartCard>
    </div>
  )
}

function SetRow({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'brand' | 'watch'
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-muted">{label}</span>
      <span
        className={`font-mono tabular-nums font-medium ${
          tone === 'watch' ? 'text-amber-800' : tone === 'brand' ? 'text-forest' : 'text-ink'
        }`}
      >
        {formatNumber(value)}
      </span>
    </div>
  )
}

function CompactStat({
  label,
  value,
  hint,
  watch,
}: {
  label: string
  value: string
  hint?: string
  watch?: boolean
}) {
  return (
    <div
      className={`rounded-lg border px-2.5 py-2 ${
        watch ? 'border-amber-200 bg-amber-50/40' : 'border-[#dce6df] bg-white'
      }`}
      title={hint}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</p>
    </div>
  )
}

export function PriorityExceptionStrip({
  items,
  onSelect,
}: {
  items: { id: string; label: string; value: string; tone?: 'watch' | 'alert' }[]
  onSelect: (id: string) => void
}) {
  if (!items.length) return null
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onSelect(it.id)}
          className={`rounded-xl border px-3 py-2.5 text-left hover:bg-[#f7faf8] ${
            it.tone === 'alert'
              ? 'border-red-200 bg-red-50/40'
              : it.tone === 'watch'
                ? 'border-amber-200 bg-amber-50/40'
                : 'border-[#dce6df] bg-white'
          }`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            {it.label}
          </p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{it.value}</p>
        </button>
      ))}
    </div>
  )
}
