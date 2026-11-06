import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  attainmentDistribution,
  computeCompKpis,
  computeCompTrend,
  computeRepPerformance,
  currentPlanAsSimParams,
  DEFAULT_SIM_PARAMS,
  filterCommissionAudits,
  filterCommissionLedger,
  forecastCommissionExpense,
  simulatePlanChange,
  type CompLocalFilters,
  type PlanSimParams,
} from '@/calc/salesCompensation'
import { computeUnitEconomics } from '@/calc/unitEconomics'
import { ChartCard } from '@/components/common/ChartCard'
import { Collapsible } from '@/components/common/Collapsible'
import { DataTable } from '@/components/common/DataTable'
import { PageHeader } from '@/components/common/PageHeader'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { PALETTE } from '@/lib/icons'
import { formatCurrency, formatCurrencyPrecise, formatPercent, money } from '@/lib/money'

type Section = 'overview' | 'performance' | 'calculation' | 'audit' | 'simulator'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'performance', label: 'Sales Performance' },
  { id: 'calculation', label: 'Commission Calculation' },
  { id: 'audit', label: 'Commission Audit' },
  { id: 'simulator', label: 'Plan Simulator' },
]

function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-[#dce6df] bg-white px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold text-ink tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-ink-muted">{hint}</div> : null}
    </div>
  )
}

function SimSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <label className="block text-xs text-ink">
      <span className="flex justify-between gap-2">
        <span>{label}</span>
        <span className="font-medium tabular-nums text-forest">{format(value)}</span>
      </span>
      <input
        type="range"
        className="mt-1 w-full accent-forest"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function SalesCompensation() {
  const { data, filters, navigateWithContext, scenario } = useApp()
  const [section, setSection] = useState<Section>('overview')
  const [repId, setRepId] = useState('')
  const [team, setTeam] = useState('')
  const [sim, setSim] = useState<PlanSimParams>(() => currentPlanAsSimParams(data))

  const local: CompLocalFilters = useMemo(
    () => ({
      repIds: repId ? [repId] : [],
      teams: team ? [team] : [],
    }),
    [repId, team],
  )

  const teams = useMemo(
    () => [...new Set(data.salesReps.map((r) => r.team))].sort(),
    [data.salesReps],
  )

  const kpis = useMemo(() => computeCompKpis(data, filters, local), [data, filters, local])
  const trend = useMemo(() => computeCompTrend(data, filters, local), [data, filters, local])
  const reps = useMemo(() => computeRepPerformance(data, filters, local), [data, filters, local])
  const dist = useMemo(() => attainmentDistribution(reps), [reps])
  const ledger = useMemo(() => filterCommissionLedger(data, filters, local), [data, filters, local])
  const audits = useMemo(() => filterCommissionAudits(data, filters, local), [data, filters, local])
  const econ = useMemo(() => computeUnitEconomics(data, filters), [data, filters])
  const simResult = useMemo(
    () => simulatePlanChange(data, filters, sim, local, econ.contributionProfit),
    [data, filters, sim, local, econ.contributionProfit],
  )
  const forwardExpense = useMemo(
    () => forecastCommissionExpense(data, filters, scenario),
    [data, filters, scenario],
  )

  const planVersions = data.compensationPlanVersions

  return (
    <div className="space-y-5">
      <PageHeader
        path="/sales-compensation"
        scope={`${filters.startPeriod} → ${filters.endPeriod} · Earned ≠ Approved ≠ Paid · Eligible ≠ Recognized`}
        actions={
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              className="rounded-md border border-[#dce6df] bg-white px-2 py-1.5"
              value={repId}
              onChange={(e) => setRepId(e.target.value)}
              aria-label="Sales rep filter"
            >
              <option value="">All Sales Reps</option>
              {data.salesReps.map((r) => (
                <option key={r.rep_id} value={r.rep_id}>
                  {r.rep_name}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-[#dce6df] bg-white px-2 py-1.5"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              aria-label="Team filter"
            >
              <option value="">All Teams</option>
              {teams.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <p className="rounded-lg border border-[#dce6df] bg-[#f7faf8] px-3 py-2 text-xs text-ink-muted">
        Synthetic Assumption — commission plans, quotas and ledgers are illustrative demo data linked to
        existing customers / contracts / opportunities. Not a real carrier sales compensation policy.
        Commission expense is tracked separately from Contribution Margin (do not double-subtract).
      </p>

      <nav className="flex flex-wrap gap-1 rounded-lg border border-[#dce6df] bg-[#f7faf8] p-1" aria-label="Compensation sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              section === s.id
                ? 'bg-brand-50 text-forest shadow-sm ring-1 ring-forest/10'
                : 'text-ink-muted hover:bg-white hover:text-ink'
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* KPI Summary — always visible */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <Stat label="Total Earned" value={formatCurrency(kpis.earned, true)} hint="Calculated commission" />
        <Stat label="Approved" value={formatCurrency(kpis.approved, true)} hint="Cleared for payout" />
        <Stat label="Paid" value={formatCurrency(kpis.paid, true)} hint="Settlement to date" />
        <Stat label="Unpaid" value={formatCurrency(kpis.unpaid, true)} hint="Approved − Paid" />
        <Stat
          label="Avg Quota Attainment"
          value={formatPercent(kpis.avgQuotaAttainmentPct)}
          hint="Eligible Revenue ÷ Quota"
        />
        <Stat
          label="Comm. Cost / Eligible Rev"
          value={formatPercent(kpis.commissionCostPctOfEligible)}
          hint={`Eligible ${formatCurrency(kpis.eligibleRevenue, true)}`}
        />
        <Stat
          label="Open Audit Exceptions"
          value={String(kpis.openAuditExceptions)}
          hint={`Exposure ${formatCurrency(kpis.openAuditExposure, true)} · not booked loss`}
        />
      </div>

      {section === 'overview' && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Commission Expense Trend"
              subtitle="Earned vs Approved vs Paid by month"
              formula="Statuses are exclusive stages — do not sum Earned+Approved+Paid"
            >
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trend}>
                    <CartesianGrid stroke={PALETTE.grid} strokeDasharray="3 3" />
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v, true)} />
                    <Tooltip formatter={(v) => formatCurrencyPrecise(Number(v))} />
                    <Legend />
                    <Bar dataKey="earned" name="Earned" fill={PALETTE.brandMid} />
                    <Bar dataKey="approved" name="Approved" fill={PALETTE.positive} />
                    <Line type="monotone" dataKey="paid" name="Paid" stroke={PALETTE.forecast} strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                Paid lags Approved by design (payroll cycle). Unpaid ≠ audit exception.
              </p>
            </ChartCard>

            <ChartCard
              title="Quota Attainment Distribution"
              subtitle="Reps by attainment band (Eligible Revenue ÷ Quota)"
            >
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dist}>
                    <CartesianGrid stroke={PALETTE.grid} strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="reps" name="Reps" fill={PALETTE.brand} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>

          <ChartCard
            title="Commission by Sales Rep"
            subtitle="Earned commission in filter window"
            action={
              <button
                type="button"
                className="text-xs text-forest underline"
                onClick={() =>
                  exportToCsv(
                    'commission-by-rep.csv',
                    reps.map((r) => ({
                      rep: r.repName,
                      team: r.team,
                      earned: r.earned,
                      approved: r.approved,
                      paid: r.paid,
                      quota_attainment_pct: r.quotaAttainmentPct,
                      eligible_revenue: r.eligibleRevenue,
                    })),
                  )
                }
              >
                Export CSV
              </button>
            }
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reps.slice(0, 12)} layout="vertical" margin={{ left: 72 }}>
                  <CartesianGrid stroke={PALETTE.grid} strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={(v) => formatCurrency(v, true)} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="repName" width={70} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => formatCurrencyPrecise(Number(v))} />
                  <Bar dataKey="earned" name="Earned" fill={PALETTE.brandMid} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard
            title="Commission Cost vs Eligible Revenue"
            subtitle="Monthly cost ratio — Eligible Revenue = invoice Net Billing residual + expansion (not Recognized)"
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={trend.map((t) => ({
                    ...t,
                    costPct: t.eligibleRevenue ? money((t.earned / t.eligibleRevenue) * 100) : null,
                  }))}
                >
                  <CartesianGrid stroke={PALETTE.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="l" tickFormatter={(v) => formatCurrency(v, true)} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="l" dataKey="eligibleRevenue" name="Eligible Revenue" fill={PALETTE.muted} />
                  <Bar yAxisId="l" dataKey="earned" name="Commission Earned" fill={PALETTE.brandMid} />
                  <Line yAxisId="r" type="monotone" dataKey="costPct" name="Cost %" stroke={PALETTE.watch} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <Collapsible
            title="Forward Commission Expense (estimate)"
            subtitle="From Forecasting Existing Net Billing × plan revenue_rate — incremental expense view only"
          >
            <DataTable
              columns={[
                { key: 'period', header: 'Period', render: (r) => r.period },
                {
                  key: 'forecastEligibleProxy',
                  header: 'Forecast Net Billing',
                  align: 'right',
                  render: (r) => formatCurrency(r.forecastEligibleProxy),
                  sortValue: (r) => r.forecastEligibleProxy,
                },
                {
                  key: 'estimatedCommission',
                  header: 'Est. Commission',
                  align: 'right',
                  render: (r) => formatCurrency(r.estimatedCommission),
                  sortValue: (r) => r.estimatedCommission,
                },
                {
                  key: 'rateUsed',
                  header: 'Rate',
                  align: 'right',
                  render: (r) => formatPercent(r.rateUsed * 100, 2),
                  sortValue: (r) => r.rateUsed,
                },
              ]}
              rows={forwardExpense}
              rowKey={(r) => r.period}
            />
            <p className="mt-2 text-xs text-ink-muted">
              {forwardExpense[0]?.note ??
                'No forward Existing forecast rows in scope — Not Available.'}
            </p>
            <button
              type="button"
              className="mt-2 text-xs text-forest underline"
              onClick={() => navigateWithContext('/forecasting')}
            >
              Open Revenue Forecasting
            </button>
          </Collapsible>
        </>
      )}

      {section === 'performance' && (
        <ChartCard
          title="Sales Performance"
          subtitle="Quota basis = Eligible Revenue (invoice Net Billing residual + expansion). Closed Won = bookings TCV."
          action={
            <button
              type="button"
              className="text-xs text-forest underline"
              onClick={() =>
                exportToCsv(
                  'sales-performance.csv',
                  reps.map((r) => ({
                    rep: r.repName,
                    team: r.team,
                    territory: r.territory,
                    quota: r.quota,
                    quota_basis: r.quotaBasis,
                    eligible_revenue: r.eligibleRevenue,
                    attainment_pct: r.quotaAttainmentPct,
                    closed_won_tcv: r.closedWonValue,
                    expansion_eligible: r.expansionRevenue,
                    earned: r.earned,
                    win_rate_pct: r.winRate,
                    avg_cycle_days: r.avgSalesCycle,
                    open_audits: r.openAudits,
                  })),
                )
              }
            >
              Export CSV
            </button>
          }
        >
          <DataTable
            columns={[
              {
                key: 'repName',
                header: 'Sales Rep',
                render: (r) => r.repName,
                sortValue: (r) => r.repName,
                searchValue: (r) => `${r.repName} ${r.team}`,
              },
              { key: 'team', header: 'Team', render: (r) => r.team, sortValue: (r) => r.team },
              {
                key: 'quota',
                header: 'Quota',
                align: 'right',
                render: (r) => formatCurrency(r.quota, true),
                sortValue: (r) => r.quota,
              },
              {
                key: 'eligibleRevenue',
                header: 'Eligible Rev',
                align: 'right',
                render: (r) => formatCurrency(r.eligibleRevenue, true),
                sortValue: (r) => r.eligibleRevenue,
              },
              {
                key: 'quotaAttainmentPct',
                header: 'Attainment',
                align: 'right',
                render: (r) => formatPercent(r.quotaAttainmentPct),
                sortValue: (r) => r.quotaAttainmentPct ?? -1,
              },
              {
                key: 'closedWonValue',
                header: 'Closed Won TCV',
                align: 'right',
                render: (r) => formatCurrency(r.closedWonValue, true),
                sortValue: (r) => r.closedWonValue,
              },
              {
                key: 'expansionRevenue',
                header: 'Expansion',
                align: 'right',
                render: (r) => formatCurrency(r.expansionRevenue, true),
                sortValue: (r) => r.expansionRevenue,
              },
              {
                key: 'winRate',
                header: 'Win Rate',
                align: 'right',
                render: (r) => formatPercent(r.winRate),
                sortValue: (r) => r.winRate ?? -1,
              },
              {
                key: 'earned',
                header: 'Earned',
                align: 'right',
                render: (r) => formatCurrency(r.earned, true),
                sortValue: (r) => r.earned,
              },
              {
                key: 'openAudits',
                header: 'Audits',
                align: 'right',
                render: (r) => r.openAudits,
                sortValue: (r) => r.openAudits,
              },
            ]}
            rows={reps}
            rowKey={(r) => r.repId}
            onRowClick={(r) => setRepId(r.repId)}
          />
        </ChartCard>
      )}

      {section === 'calculation' && (
        <>
          <ChartCard
            title="Active Plan Versions"
            subtitle="Commission uses the plan version effective on the eligibility period"
          >
            <DataTable
              columns={[
                {
                  key: 'version_label',
                  header: 'Version',
                  render: (r) => r.version_label,
                  sortValue: (r) => r.version_label,
                },
                {
                  key: 'effective_from',
                  header: 'From',
                  render: (r) => r.effective_from,
                  sortValue: (r) => r.effective_from,
                },
                {
                  key: 'effective_to',
                  header: 'To',
                  render: (r) => r.effective_to ?? 'Open',
                  sortValue: (r) => r.effective_to ?? '9999',
                },
                {
                  key: 'new_acquisition_rate',
                  header: 'New Logo Rate',
                  align: 'right',
                  render: (r) => formatPercent(r.new_acquisition_rate * 100, 2),
                  sortValue: (r) => r.new_acquisition_rate,
                },
                {
                  key: 'expansion_rate',
                  header: 'Expansion',
                  align: 'right',
                  render: (r) => formatPercent(r.expansion_rate * 100, 2),
                  sortValue: (r) => r.expansion_rate,
                },
                {
                  key: 'revenue_rate',
                  header: 'Residual Rev',
                  align: 'right',
                  render: (r) => formatPercent(r.revenue_rate * 100, 2),
                  sortValue: (r) => r.revenue_rate,
                },
                {
                  key: 'quota_basis',
                  header: 'Quota Basis',
                  render: (r) => r.quota_basis,
                  sortValue: (r) => r.quota_basis,
                },
              ]}
              rows={planVersions}
              rowKey={(r) => r.plan_version_id}
            />
            <p className="mt-2 text-xs text-ink-muted">{planVersions[0]?.synthetic_assumption}</p>
          </ChartCard>

          <Collapsible
            title="Commission Ledger (detailed records)"
            subtitle={`${ledger.length} lines · click customer to open Customer 360`}
            defaultOpen
            actions={
              <button
                type="button"
                className="text-xs text-forest underline"
                onClick={() =>
                  exportToCsv(
                    'commission-ledger.csv',
                    ledger.map((L) => ({
                      ledger_id: L.ledger_id,
                      period: L.period,
                      rep_id: L.rep_id,
                      customer_id: L.customer_id,
                      type: L.eligibility_type,
                      basis: L.basis_amount,
                      rate: L.base_rate,
                      accelerator: L.accelerator_mult,
                      earned: L.commission_earned,
                      approved: L.approved_amount,
                      paid: L.paid_amount,
                      plan_version: L.plan_version_id,
                      approval: L.approval_status,
                      notes: L.calc_notes,
                    })),
                  )
                }
              >
                Export CSV
              </button>
            }
          >
            <DataTable
              columns={[
                {
                  key: 'ledger_id',
                  header: 'Ledger ID',
                  render: (r) => r.ledger_id,
                  sortValue: (r) => r.ledger_id,
                  searchValue: (r) => r.ledger_id,
                },
                {
                  key: 'period',
                  header: 'Period',
                  render: (r) => r.period,
                  sortValue: (r) => r.period,
                },
                {
                  key: 'rep_id',
                  header: 'Rep',
                  render: (r) => data.salesReps.find((x) => x.rep_id === r.rep_id)?.rep_name ?? r.rep_id,
                  sortValue: (r) => r.rep_id,
                  searchValue: (r) =>
                    data.salesReps.find((x) => x.rep_id === r.rep_id)?.rep_name ?? r.rep_id,
                },
                {
                  key: 'customer_id',
                  header: 'Customer',
                  render: (r) =>
                    data.customers.find((c) => c.customer_id === r.customer_id)?.customer_name ?? '—',
                  sortValue: (r) => r.customer_id ?? '',
                  searchValue: (r) =>
                    data.customers.find((c) => c.customer_id === r.customer_id)?.customer_name ?? '',
                },
                {
                  key: 'eligibility_type',
                  header: 'Type',
                  render: (r) => r.eligibility_type,
                  sortValue: (r) => r.eligibility_type,
                },
                {
                  key: 'basis_amount',
                  header: 'Basis',
                  align: 'right',
                  render: (r) => formatCurrency(r.basis_amount, true),
                  sortValue: (r) => r.basis_amount,
                },
                {
                  key: 'base_rate',
                  header: 'Rate',
                  align: 'right',
                  render: (r) => formatPercent(r.base_rate * 100, 2),
                  sortValue: (r) => r.base_rate,
                },
                {
                  key: 'accelerator_mult',
                  header: 'Accel',
                  align: 'right',
                  render: (r) => `${r.accelerator_mult.toFixed(2)}×`,
                  sortValue: (r) => r.accelerator_mult,
                },
                {
                  key: 'commission_earned',
                  header: 'Earned',
                  align: 'right',
                  render: (r) => formatCurrency(r.commission_earned, true),
                  sortValue: (r) => r.commission_earned,
                },
                {
                  key: 'approval_status',
                  header: 'Approval',
                  render: (r) => r.approval_status,
                  sortValue: (r) => r.approval_status,
                },
                {
                  key: 'paid_amount',
                  header: 'Paid',
                  align: 'right',
                  render: (r) => formatCurrency(r.paid_amount, true),
                  sortValue: (r) => r.paid_amount,
                },
              ]}
              rows={ledger.slice(0, 200)}
              rowKey={(r) => r.ledger_id}
              onRowClick={(r) => {
                if (r.customer_id) {
                  navigateWithContext('/customer-360', { customerId: r.customer_id })
                }
              }}
            />
            {ledger.length > 200 && (
              <p className="mt-2 text-xs text-ink-muted">
                Showing first 200 of {ledger.length} — export CSV for full filtered set.
              </p>
            )}
          </Collapsible>

          <div className="flex flex-wrap gap-3 text-xs">
            <button type="button" className="text-forest underline" onClick={() => navigateWithContext('/lifecycle')}>
              Trace Closed Won in Revenue Flow
            </button>
            <button type="button" className="text-forest underline" onClick={() => setSection('audit')}>
              Open Commission Audit
            </button>
          </div>
        </>
      )}

      {section === 'audit' && (
        <ChartCard
          title="Commission Audit Exceptions"
          subtitle="Expected vs Actual — open items are under investigation, not confirmed financial loss"
          action={
            <button
              type="button"
              className="text-xs text-forest underline"
              onClick={() =>
                exportToCsv(
                  'commission-audit.csv',
                  audits.map((a) => ({
                    audit_id: a.audit_id,
                    type: a.audit_type,
                    period: a.period,
                    rep_id: a.rep_id,
                    customer_id: a.customer_id,
                    ledger_id: a.ledger_id,
                    expected: a.expected_amount,
                    actual: a.actual_amount,
                    difference: a.difference,
                    root_cause: a.root_cause,
                    owner: a.suggested_owner,
                    status: a.status,
                    financial_impact: a.financial_impact,
                    confirmed_loss: a.is_confirmed_loss,
                  })),
                )
              }
            >
              Export Audit CSV
            </button>
          }
        >
          <DataTable
            columns={[
              {
                key: 'audit_id',
                header: 'Audit ID',
                render: (r) => r.audit_id,
                sortValue: (r) => r.audit_id,
                searchValue: (r) => `${r.audit_id} ${r.audit_type} ${r.root_cause}`,
              },
              {
                key: 'audit_type',
                header: 'Exception Type',
                render: (r) => r.audit_type,
                sortValue: (r) => r.audit_type,
              },
              {
                key: 'rep_id',
                header: 'Rep',
                render: (r) => data.salesReps.find((x) => x.rep_id === r.rep_id)?.rep_name ?? r.rep_id,
                sortValue: (r) => r.rep_id,
              },
              {
                key: 'customer_id',
                header: 'Customer',
                render: (r) =>
                  data.customers.find((c) => c.customer_id === r.customer_id)?.customer_name ?? '—',
                sortValue: (r) => r.customer_id ?? '',
              },
              {
                key: 'expected_amount',
                header: 'Expected',
                align: 'right',
                render: (r) => formatCurrencyPrecise(r.expected_amount),
                sortValue: (r) => r.expected_amount,
              },
              {
                key: 'actual_amount',
                header: 'Actual',
                align: 'right',
                render: (r) => formatCurrencyPrecise(r.actual_amount),
                sortValue: (r) => r.actual_amount,
              },
              {
                key: 'difference',
                header: 'Diff',
                align: 'right',
                render: (r) => formatCurrencyPrecise(r.difference),
                sortValue: (r) => r.difference,
              },
              {
                key: 'status',
                header: 'Status',
                render: (r) => r.status,
                sortValue: (r) => r.status,
              },
              {
                key: 'suggested_owner',
                header: 'Owner',
                render: (r) => r.suggested_owner,
                sortValue: (r) => r.suggested_owner,
              },
              {
                key: 'root_cause',
                header: 'Root Cause',
                render: (r) => r.root_cause,
                sortValue: (r) => r.root_cause,
              },
            ]}
            rows={audits}
            rowKey={(r) => r.audit_id}
            onRowClick={(r) => {
              if (r.customer_id) navigateWithContext('/customer-360', { customerId: r.customer_id })
            }}
          />
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <button
              type="button"
              className="text-forest underline"
              onClick={() => navigateWithContext('/actions')}
            >
              Create / track in Action Center
            </button>
            <span className="text-ink-muted">
              Trace path: Sales Rep → Customer → Contract / Opportunity → Eligible Revenue → Rule → Ledger →
              Payment
            </span>
          </div>
        </ChartCard>
      )}

      {section === 'simulator' && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-3 rounded-xl border border-[#dce6df] bg-white p-4">
            <div className="text-sm font-semibold text-ink">Proposed Plan Parameters</div>
            <p className="text-[11px] text-ink-muted">
              Backtest on historical eligibility events. Paid history is never overwritten.
            </p>
            <SimSlider
              label="Base revenue rate"
              value={sim.baseRevenueRate}
              min={0}
              max={0.03}
              step={0.001}
              format={(v) => formatPercent(v * 100, 2)}
              onChange={(v) => setSim({ ...sim, baseRevenueRate: v })}
            />
            <SimSlider
              label="New acquisition rate"
              value={sim.newAcquisitionRate}
              min={0}
              max={0.1}
              step={0.005}
              format={(v) => formatPercent(v * 100, 2)}
              onChange={(v) => setSim({ ...sim, newAcquisitionRate: v })}
            />
            <SimSlider
              label="Expansion rate"
              value={sim.expansionRate}
              min={0}
              max={0.08}
              step={0.005}
              format={(v) => formatPercent(v * 100, 2)}
              onChange={(v) => setSim({ ...sim, expansionRate: v })}
            />
            <SimSlider
              label="Accel @ 100–119%"
              value={sim.accelerator100}
              min={1}
              max={2}
              step={0.05}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(v) => setSim({ ...sim, accelerator100: v })}
            />
            <SimSlider
              label="Accel @ ≥120%"
              value={sim.accelerator120}
              min={1}
              max={2.5}
              step={0.05}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(v) => setSim({ ...sim, accelerator120: v })}
            />
            <SimSlider
              label="New customer bonus"
              value={sim.newCustomerBonus}
              min={0}
              max={5000}
              step={100}
              format={(v) => formatCurrency(v)}
              onChange={(v) => setSim({ ...sim, newCustomerBonus: v })}
            />
            <SimSlider
              label="Clawback credit rate"
              value={sim.clawbackCreditRate}
              min={0}
              max={1}
              step={0.05}
              format={(v) => formatPercent(v * 100, 0)}
              onChange={(v) => setSim({ ...sim, clawbackCreditRate: v })}
            />
            <SimSlider
              label="Commission cap (0 = none)"
              value={sim.commissionCap ?? 0}
              min={0}
              max={100000}
              step={1000}
              format={(v) => (v === 0 ? 'None' : formatCurrency(v))}
              onChange={(v) => setSim({ ...sim, commissionCap: v === 0 ? null : v })}
            />
            <button
              type="button"
              className="w-full rounded-md border border-[#dce6df] px-3 py-2 text-xs font-medium text-ink hover:bg-[#f7faf8]"
              onClick={() => setSim(currentPlanAsSimParams(data))}
            >
              Reset to current plan (v2)
            </button>
            <button
              type="button"
              className="w-full rounded-md border border-[#dce6df] px-3 py-2 text-xs text-ink-muted hover:bg-[#f7faf8]"
              onClick={() => setSim(DEFAULT_SIM_PARAMS)}
            >
              Load demo defaults
            </button>
          </div>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Current Payout" value={formatCurrency(simResult.currentPayout, true)} />
              <Stat label="Proposed Payout" value={formatCurrency(simResult.proposedPayout, true)} />
              <Stat
                label="Change vs Current"
                value={formatCurrency(simResult.delta, true)}
                hint={simResult.delta >= 0 ? 'Higher company cost' : 'Lower company cost'}
              />
              <Stat
                label="Proposed Cost / Eligible"
                value={formatPercent(simResult.proposedCostPct)}
                hint={`Was ${formatPercent(simResult.currentCostPct)}`}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat
                label="Contrib. after Comm. (current)"
                value={
                  simResult.contributionAfterCommissionCurrent == null
                    ? 'Not Available'
                    : formatCurrency(simResult.contributionAfterCommissionCurrent, true)
                }
                hint="Illustrative only — not Unit Economics rewrite"
              />
              <Stat
                label="Contrib. after Comm. (proposed)"
                value={
                  simResult.contributionAfterCommissionProposed == null
                    ? 'Not Available'
                    : formatCurrency(simResult.contributionAfterCommissionProposed, true)
                }
              />
            </div>
            <p className="text-xs text-ink-muted">{simResult.disclaimer}</p>
            <ChartCard title="Winners & Losers by Plan" subtitle="Δ proposed − current earned">
              <DataTable
                columns={[
                  {
                    key: 'repName',
                    header: 'Sales Rep',
                    render: (r) => r.repName,
                    sortValue: (r) => r.repName,
                    searchValue: (r) => r.repName,
                  },
                  {
                    key: 'current',
                    header: 'Current',
                    align: 'right',
                    render: (r) => formatCurrency(r.current, true),
                    sortValue: (r) => r.current,
                  },
                  {
                    key: 'proposed',
                    header: 'Proposed',
                    align: 'right',
                    render: (r) => formatCurrency(r.proposed, true),
                    sortValue: (r) => r.proposed,
                  },
                  {
                    key: 'delta',
                    header: 'Δ',
                    align: 'right',
                    render: (r) => formatCurrency(r.delta, true),
                    sortValue: (r) => r.delta,
                  },
                ]}
                rows={simResult.byRep}
                rowKey={(r) => r.repId}
              />
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  )
}
