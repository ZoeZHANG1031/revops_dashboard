import { useEffect, useMemo, useState } from 'react'
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
import {
  attainmentDistribution,
  computeAuditModuleKpis,
  computeCommissionStatusBreakdown,
  computeCompKpis,
  computeCompTrend,
  computeRepPerformance,
  currentPlanAsSimParams,
  DEFAULT_SIM_PARAMS,
  filterCommissionAudits,
  filterCommissionLedger,
  filterLedgerByStatusBucket,
  forecastCommissionExpense,
  runCommissionTransactionAudit,
  simulatePlanChange,
  type CommissionStatusBucket,
  type CompLocalFilters,
  type PlanSimParams,
  type SimulatorResult,
  type TransactionAuditRow,
  type TransactionAuditStatus,
} from '@/calc/salesCompensation'
import { computeUnitEconomics } from '@/calc/unitEconomics'
import { FloatingWaterfall } from '@/components/charts/FloatingWaterfall'
import { ChartCard } from '@/components/common/ChartCard'
import { Collapsible } from '@/components/common/Collapsible'
import { DataTable } from '@/components/common/DataTable'
import { PageHeader } from '@/components/common/PageHeader'
import { ModuleSubNav } from '@/components/layout/ModuleSubNav'
import { useApp } from '@/context/AppContext'
import { exportToCsv } from '@/lib/export'
import { COMPENSATION_NAV, PALETTE } from '@/lib/icons'
import { formatCurrency, formatCurrencyPrecise, formatPercent, money } from '@/lib/money'

type PageFocus = 'overview' | 'audit' | 'simulator'
type OverviewTab = 'status' | 'performance' | 'efficiency'

type ScenarioKey = 'current' | 'growth' | 'margin' | 'custom'

const SCENARIO_PRESETS: Record<Exclude<ScenarioKey, 'custom'>, Partial<PlanSimParams>> = {
  current: {},
  growth: {
    baseRevenueRate: 0.011,
    newAcquisitionRate: 0.055,
    expansionRate: 0.035,
    accelerator100: 1.35,
    accelerator120: 1.65,
    newCustomerBonus: 2500,
  },
  margin: {
    baseRevenueRate: 0.007,
    newAcquisitionRate: 0.04,
    expansionRate: 0.025,
    clawbackCreditRate: 0.75,
    marginIncentiveRate: 0.003,
    minimumMarginEligibilityPct: 12,
  },
}

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

const TEAM_COLORS = [PALETTE.brand, PALETTE.brandMid, PALETTE.positive, PALETTE.forecast, PALETTE.watch]

export function SalesCompensation({
  initialSection = 'overview',
}: {
  initialSection?: PageFocus | 'performance' | 'calculation'
}) {
  const { data, filters, navigateWithContext, scenario } = useApp()
  const pageFocus: PageFocus =
    initialSection === 'audit' || initialSection === 'simulator' ? initialSection : 'overview'

  const [overviewTab, setOverviewTab] = useState<OverviewTab>('status')
  const [repId, setRepId] = useState('')
  const [team, setTeam] = useState('')
  const [sim, setSim] = useState<PlanSimParams>(() => currentPlanAsSimParams(data))
  const [statusDrill, setStatusDrill] = useState<CommissionStatusBucket | null>(null)
  const [detailRepId, setDetailRepId] = useState<string | null>(null)
  const [auditView, setAuditView] = useState<'exceptions' | 'transactions'>('transactions')
  const [txFilter, setTxFilter] = useState<TransactionAuditStatus | 'All'>('All')
  const [winnerFilter, setWinnerFilter] = useState<'all' | 'winners' | 'losers' | 'unchanged'>('all')
  const [auditDetail, setAuditDetail] = useState<TransactionAuditRow | null>(null)
  const [savedScenarios, setSavedScenarios] = useState<Record<ScenarioKey, PlanSimParams>>(() => {
    const base = currentPlanAsSimParams(data)
    return {
      current: base,
      growth: { ...base, ...SCENARIO_PRESETS.growth },
      margin: { ...base, ...SCENARIO_PRESETS.margin },
      custom: base,
    }
  })
  const [activeScenario, setActiveScenario] = useState<ScenarioKey>('custom')

  useEffect(() => {
    if (initialSection === 'performance') setOverviewTab('performance')
    if (initialSection === 'calculation') setOverviewTab('status')
  }, [initialSection])

  const pagePath =
    pageFocus === 'audit'
      ? '/sales-compensation/audit'
      : pageFocus === 'simulator'
        ? '/sales-compensation/simulator'
        : '/sales-compensation'

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
  const statusBreakdown = useMemo(
    () => computeCommissionStatusBreakdown(data, filters, local),
    [data, filters, local],
  )
  const trend = useMemo(() => computeCompTrend(data, filters, local), [data, filters, local])
  const reps = useMemo(() => computeRepPerformance(data, filters, local), [data, filters, local])
  const dist = useMemo(() => attainmentDistribution(reps), [reps])
  const ledger = useMemo(() => filterCommissionLedger(data, filters, local), [data, filters, local])
  const audits = useMemo(() => filterCommissionAudits(data, filters, local), [data, filters, local])
  const auditKpis = useMemo(() => computeAuditModuleKpis(data, filters, local), [data, filters, local])
  const txAudit = useMemo(
    () => runCommissionTransactionAudit(data, filters, local),
    [data, filters, local],
  )
  const econ = useMemo(() => computeUnitEconomics(data, filters), [data, filters])
  const simResult = useMemo(
    () => simulatePlanChange(data, filters, sim, local, econ.contributionProfit),
    [data, filters, sim, local, econ.contributionProfit],
  )
  const forwardExpense = useMemo(
    () => forecastCommissionExpense(data, filters, scenario),
    [data, filters, scenario],
  )

  const scenarioResults = useMemo(() => {
    const out: Record<ScenarioKey, SimulatorResult> = {
      current: simulatePlanChange(
        data,
        filters,
        savedScenarios.current,
        local,
        econ.contributionProfit,
      ),
      growth: simulatePlanChange(
        data,
        filters,
        savedScenarios.growth,
        local,
        econ.contributionProfit,
      ),
      margin: simulatePlanChange(
        data,
        filters,
        savedScenarios.margin,
        local,
        econ.contributionProfit,
      ),
      custom: simulatePlanChange(data, filters, sim, local, econ.contributionProfit),
    }
    return out
  }, [data, filters, local, econ.contributionProfit, savedScenarios, sim])

  const statusDrillRows = useMemo(() => {
    if (!statusDrill) return []
    return filterLedgerByStatusBucket(data, filters, local, statusDrill)
  }, [statusDrill, data, filters, local])

  const detailRep = useMemo(
    () => (detailRepId ? reps.find((r) => r.repId === detailRepId) ?? null : null),
    [detailRepId, reps],
  )
  const detailLedger = useMemo(() => {
    if (!detailRepId) return []
    return ledger.filter((L) => L.rep_id === detailRepId)
  }, [detailRepId, ledger])

  const scatterData = useMemo(
    () =>
      reps
        .filter((r) => r.quotaAttainmentPct != null && r.effectiveCommissionRatePct != null)
        .map((r) => ({
          ...r,
          x: r.quotaAttainmentPct!,
          y: r.effectiveCommissionRatePct!,
          z: Math.max(r.eligibleRevenue, 1),
        })),
    [reps],
  )

  const filteredTx = useMemo(
    () => (txFilter === 'All' ? txAudit : txAudit.filter((t) => t.auditStatus === txFilter)),
    [txAudit, txFilter],
  )

  const filteredWinners = useMemo(() => {
    const rows = simResult.byRep
    if (winnerFilter === 'winners') return rows.filter((r) => r.delta > 0.005)
    if (winnerFilter === 'losers') return rows.filter((r) => r.delta < -0.005)
    if (winnerFilter === 'unchanged') return rows.filter((r) => Math.abs(r.delta) <= 0.005)
    return rows
  }, [simResult.byRep, winnerFilter])

  const applyScenario = (key: ScenarioKey) => {
    setActiveScenario(key)
    if (key === 'custom') return
    setSim(savedScenarios[key])
  }

  const saveCustomScenario = () => {
    setSavedScenarios((s) => ({ ...s, custom: sim }))
    setActiveScenario('custom')
  }

  return (
    <div className="space-y-5">
      <ModuleSubNav items={COMPENSATION_NAV} />
      <PageHeader
        path={pagePath}
        scope={`${filters.startPeriod} → ${filters.endPeriod} · Commission Period · Earned ≠ Approved ≠ Paid`}
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
            <button
              type="button"
              className="rounded-md border border-[#dce6df] px-2 py-1.5 text-ink-muted hover:bg-[#f7faf8]"
              onClick={() => {
                setRepId('')
                setTeam('')
                setStatusDrill(null)
                setDetailRepId(null)
              }}
            >
              Reset Local Filters
            </button>
          </div>
        }
      />

      <p className="rounded-lg border border-[#dce6df] bg-[#f7faf8] px-3 py-2 text-xs text-ink-muted">
        Synthetic Assumption — commission plans, quotas and ledgers are illustrative demo data linked to
        existing customers / contracts / opportunities. Contribution Profit in Unit Economics does not
        subtract commission; simulator “after commission” views are illustrative only.
      </p>

      {pageFocus === 'overview' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Total Earned Commission" value={formatCurrency(kpis.earned, true)} hint="Commission Period" />
            <Stat
              label="Approved Unpaid"
              value={formatCurrency(kpis.approvedUnpaid, true)}
              hint="Approved − Paid"
            />
            <Stat
              label="Effective Commission Rate"
              value={formatPercent(kpis.effectiveCommissionRatePct)}
              hint="Earned ÷ Eligible Revenue"
            />
            <Stat
              label="Avg Quota Attainment"
              value={formatPercent(kpis.avgQuotaAttainmentPct)}
              hint={`Simple average · weighted ${formatPercent(kpis.weightedQuotaAttainmentPct)}`}
            />
            <Stat
              label="Comm. Cost / Eligible"
              value={formatPercent(kpis.commissionCostPctOfEligible)}
              hint={`Eligible ${formatCurrency(kpis.eligibleRevenue, true)}`}
            />
          </div>

          <nav className="flex flex-wrap gap-1 rounded-lg border border-[#dce6df] bg-[#f7faf8] p-1" aria-label="Overview sections">
            {(
              [
                ['status', 'Commission Status & Expense'],
                ['performance', 'Sales Performance'],
                ['efficiency', 'Compensation Efficiency'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setOverviewTab(id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  overviewTab === id
                    ? 'bg-brand-50 text-forest shadow-sm ring-1 ring-forest/10'
                    : 'text-ink-muted hover:bg-white hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {overviewTab === 'status' && (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard
                  title="Commission Status Breakdown"
                  subtitle="Lifecycle on same Commission Entry set — click a status for ledger drill-down"
                  formula="Pending Approval + Approved ≈ Earned (excl. Rejected)"
                >
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={statusBreakdown} layout="vertical" margin={{ left: 100 }}>
                        <CartesianGrid stroke={PALETTE.grid} strokeDasharray="3 3" />
                        <XAxis type="number" tickFormatter={(v) => formatCurrency(v, true)} tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="status" width={110} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v) => formatCurrencyPrecise(Number(v))} />
                        <Bar
                          dataKey="amount"
                          name="Amount"
                          fill={PALETTE.brandMid}
                          cursor="pointer"
                          onClick={(d) => {
                            const st = (d as { status?: CommissionStatusBucket })?.status
                            if (st) setStatusDrill(st)
                          }}
                        >
                          {statusBreakdown.map((s) => (
                            <Cell
                              key={s.status}
                              fill={
                                s.status === 'Paid'
                                  ? PALETTE.positive
                                  : s.status === 'Pending Approval'
                                    ? PALETTE.watch
                                    : s.status === 'Rejected'
                                      ? PALETTE.critical
                                      : PALETTE.brand
                              }
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-ink-muted">
                    {statusBreakdown.map((s) => (
                      <button
                        key={s.status}
                        type="button"
                        className="rounded border border-[#dce6df] px-2 py-1 hover:bg-[#f7faf8]"
                        onClick={() => setStatusDrill(s.status)}
                      >
                        {s.status}: {formatCurrency(s.amount, true)} ({s.entryCount})
                      </button>
                    ))}
                  </div>
                </ChartCard>

                <ChartCard
                  title="Commission Expense Trend"
                  subtitle="Earned/Approved by Commission Period · Paid by settlement in period (may lag)"
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
                        <Line
                          type="monotone"
                          dataKey="paid"
                          name="Paid"
                          stroke={PALETTE.forecast}
                          strokeWidth={2}
                          dot={false}
                          connectNulls={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-2 text-xs text-ink-muted">
                    Pending Approval {formatCurrency(kpis.pendingApproval, true)} · Paid{' '}
                    {formatCurrency(kpis.paid, true)}. Zero Paid in a month means no settlement dated to that
                    commission period — not “not yet due” cash timing.
                  </p>
                </ChartCard>
              </div>

              {statusDrill && (
                <Collapsible
                  title={`${statusDrill} — Ledger Detail`}
                  subtitle={`${statusDrillRows.length} entries`}
                  defaultOpen
                  actions={
                    <button
                      type="button"
                      className="text-xs text-forest underline"
                      onClick={() => setStatusDrill(null)}
                    >
                      Clear
                    </button>
                  }
                >
                  <DataTable
                    columns={[
                      {
                        key: 'ledger_id',
                        header: 'Commission ID',
                        render: (r) => r.ledger_id,
                        sortValue: (r) => r.ledger_id,
                        searchValue: (r) => r.ledger_id,
                      },
                      {
                        key: 'rep',
                        header: 'Sales Rep',
                        render: (r) =>
                          data.salesReps.find((x) => x.rep_id === r.rep_id)?.rep_name ?? r.rep_id,
                        sortValue: (r) => r.rep_id,
                        searchValue: (r) =>
                          data.salesReps.find((x) => x.rep_id === r.rep_id)?.rep_name ?? '',
                      },
                      {
                        key: 'customer',
                        header: 'Customer',
                        render: (r) =>
                          data.customers.find((c) => c.customer_id === r.customer_id)?.customer_name ??
                          '—',
                        searchValue: (r) =>
                          data.customers.find((c) => c.customer_id === r.customer_id)?.customer_name ??
                          '',
                      },
                      {
                        key: 'opportunity_id',
                        header: 'Opportunity',
                        render: (r) => r.opportunity_id ?? '—',
                      },
                      {
                        key: 'commission_earned',
                        header: 'Earned',
                        align: 'right',
                        render: (r) => formatCurrency(r.commission_earned, true),
                        sortValue: (r) => r.commission_earned,
                      },
                      {
                        key: 'period',
                        header: 'Earned Period',
                        render: (r) => r.period,
                        sortValue: (r) => r.period,
                      },
                      {
                        key: 'approval_status',
                        header: 'Approval',
                        render: (r) => r.approval_status,
                      },
                      {
                        key: 'pending_days',
                        header: 'Pending Days',
                        align: 'right',
                        render: (r) => {
                          if (r.approval_status !== 'Pending') return '—'
                          const end = new Date(`${filters.endPeriod}-28`).getTime()
                          const start = new Date(`${r.period}-15`).getTime()
                          return String(Math.max(0, Math.round((end - start) / 86400000)))
                        },
                      },
                      {
                        key: 'notes',
                        header: 'Reason',
                        render: (r) => r.calc_notes.slice(0, 60),
                        searchValue: (r) => r.calc_notes,
                      },
                    ]}
                    rows={statusDrillRows}
                    rowKey={(r) => r.ledger_id}
                    onRowClick={(r) => {
                      if (r.customer_id)
                        navigateWithContext('/customer-360', { customerId: r.customer_id })
                    }}
                  />
                </Collapsible>
              )}

              <Collapsible
                title="Forward Commission Expense (estimate)"
                subtitle="Forecast Existing Net Billing × plan revenue_rate"
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
                  ]}
                  rows={forwardExpense}
                  rowKey={(r) => r.period}
                />
              </Collapsible>
            </>
          )}

          {overviewTab === 'performance' && (
            <>
              <ChartCard
                title="Sales Performance Scorecard"
                subtitle="Commission credit from ledger attribution — not Customer Owner by default"
                action={
                  <button
                    type="button"
                    className="text-xs text-forest underline"
                    onClick={() =>
                      exportToCsv(
                        'sales-performance-scorecard.csv',
                        reps.map((r) => ({
                          rep: r.repName,
                          team: r.team,
                          eligible_revenue: r.eligibleRevenue,
                          quota: r.quota,
                          attainment_pct: r.quotaAttainmentPct,
                          new_business: r.newCustomerRevenue,
                          expansion: r.expansionRevenue,
                          earned: r.earned,
                          effective_rate_pct: r.effectiveCommissionRatePct,
                          revenue_per_comm_dollar: r.revenuePerCommissionDollar,
                          active_accounts: r.activeAccounts,
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
                      render: (r) => (
                        <button
                          type="button"
                          className="text-forest underline"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDetailRepId(r.repId)
                          }}
                        >
                          {r.repName}
                        </button>
                      ),
                      sortValue: (r) => r.repName,
                      searchValue: (r) => `${r.repName} ${r.team}`,
                    },
                    { key: 'team', header: 'Team', render: (r) => r.team, sortValue: (r) => r.team },
                    {
                      key: 'eligibleRevenue',
                      header: 'Eligible Revenue',
                      align: 'right',
                      render: (r) => formatCurrency(r.eligibleRevenue, true),
                      sortValue: (r) => r.eligibleRevenue,
                    },
                    {
                      key: 'quota',
                      header: 'Quota',
                      align: 'right',
                      render: (r) => formatCurrency(r.quota, true),
                      sortValue: (r) => r.quota,
                    },
                    {
                      key: 'quotaAttainmentPct',
                      header: 'Quota Attainment',
                      align: 'right',
                      render: (r) => formatPercent(r.quotaAttainmentPct),
                      sortValue: (r) => r.quotaAttainmentPct ?? -1,
                    },
                    {
                      key: 'newCustomerRevenue',
                      header: 'New Business',
                      align: 'right',
                      render: (r) => formatCurrency(r.newCustomerRevenue, true),
                      sortValue: (r) => r.newCustomerRevenue,
                    },
                    {
                      key: 'expansionRevenue',
                      header: 'Expansion',
                      align: 'right',
                      render: (r) => formatCurrency(r.expansionRevenue, true),
                      sortValue: (r) => r.expansionRevenue,
                    },
                    {
                      key: 'earned',
                      header: 'Earned Commission',
                      align: 'right',
                      render: (r) => formatCurrency(r.earned, true),
                      sortValue: (r) => r.earned,
                    },
                    {
                      key: 'effectiveCommissionRatePct',
                      header: 'Eff. Rate',
                      align: 'right',
                      render: (r) => formatPercent(r.effectiveCommissionRatePct),
                      sortValue: (r) => r.effectiveCommissionRatePct ?? -1,
                    },
                    {
                      key: 'revenuePerCommissionDollar',
                      header: 'Rev / $ Comm',
                      align: 'right',
                      render: (r) =>
                        r.revenuePerCommissionDollar == null
                          ? 'N/A'
                          : r.revenuePerCommissionDollar.toFixed(1),
                      sortValue: (r) => r.revenuePerCommissionDollar ?? -1,
                    },
                    {
                      key: 'activeAccounts',
                      header: 'Active Accounts',
                      align: 'right',
                      render: (r) => r.activeAccounts,
                      sortValue: (r) => r.activeAccounts,
                    },
                  ]}
                  rows={reps}
                  rowKey={(r) => r.repId}
                  onRowClick={(r) => setDetailRepId(r.repId)}
                />
              </ChartCard>

              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Quota Attainment Distribution" subtitle="Reps by band">
                  <div className="h-56">
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
                <ChartCard
                  title="Commission by Sales Rep"
                  subtitle="Earned in filter window"
                >
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={reps.slice(0, 12)} layout="vertical" margin={{ left: 72 }}>
                        <CartesianGrid stroke={PALETTE.grid} strokeDasharray="3 3" />
                        <XAxis type="number" tickFormatter={(v) => formatCurrency(v, true)} tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="repName" width={70} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v) => formatCurrencyPrecise(Number(v))} />
                        <Bar
                          dataKey="earned"
                          name="Earned"
                          fill={PALETTE.brandMid}
                          cursor="pointer"
                          onClick={(d) => {
                            const id = (d as { repId?: string })?.repId
                            if (id) setDetailRepId(id)
                          }}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
              </div>
            </>
          )}

          {overviewTab === 'efficiency' && (
            <>
              <ChartCard
                title="Sales Performance vs Compensation Efficiency"
                subtitle="X = Quota Attainment % · Y = Effective Commission Rate % · Bubble = Eligible Revenue · Color = Team"
                formula="High rate ≠ low efficiency — interpret with New vs Expansion mix and plan rules"
              >
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 12, right: 12, bottom: 12, left: 12 }}>
                      <CartesianGrid stroke={PALETTE.grid} strokeDasharray="3 3" />
                      <XAxis
                        type="number"
                        dataKey="x"
                        name="Attainment"
                        unit="%"
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        name="Eff. Rate"
                        unit="%"
                        tick={{ fontSize: 11 }}
                      />
                      <ZAxis type="number" dataKey="z" range={[60, 400]} />
                      <Tooltip
                        cursor={{ strokeDasharray: '3 3' }}
                        formatter={(v, name) =>
                          name === 'z'
                            ? formatCurrency(Number(v), true)
                            : `${Number(v).toFixed(1)}%`
                        }
                        labelFormatter={() => ''}
                        content={({ active, payload }) => {
                          if (!active || !payload?.[0]) return null
                          const r = payload[0].payload as (typeof scatterData)[0]
                          return (
                            <div className="rounded border border-[#dce6df] bg-white px-2 py-1 text-xs shadow">
                              <div className="font-semibold">{r.repName}</div>
                              <div>{r.team}</div>
                              <div>Attainment {formatPercent(r.x)}</div>
                              <div>Eff. Rate {formatPercent(r.y)}</div>
                              <div>Eligible {formatCurrency(r.eligibleRevenue, true)}</div>
                            </div>
                          )
                        }}
                      />
                      {teams.map((t, i) => (
                        <Scatter
                          key={t}
                          name={t}
                          data={scatterData.filter((d) => d.team === t)}
                          fill={TEAM_COLORS[i % TEAM_COLORS.length]}
                          onClick={(d) => {
                            const id = (d as { repId?: string })?.repId
                            if (id) setDetailRepId(id)
                          }}
                        />
                      ))}
                      <Legend />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              <ChartCard
                title="Commission Cost vs Eligible Revenue"
                subtitle="Monthly — Eligible ≠ Recognized Revenue"
              >
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={trend.map((t) => ({
                        ...t,
                        costPct: t.eligibleRevenue
                          ? money((t.earned / t.eligibleRevenue) * 100)
                          : null,
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
                      <Line
                        yAxisId="r"
                        type="monotone"
                        dataKey="costPct"
                        name="Cost %"
                        stroke={PALETTE.watch}
                        strokeWidth={2}
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>
            </>
          )}
        </>
      )}

      {pageFocus === 'audit' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat
              label="Audit Coverage"
              value={formatPercent(auditKpis.auditCoveragePct)}
              hint={`${auditKpis.auditedEntries} / ${auditKpis.eligibleEntries} entries with audit record`}
            />
            <Stat label="Open Audit Exceptions" value={String(auditKpis.openExceptions)} />
            <Stat
              label="Exception Exposure $"
              value={formatCurrency(auditKpis.exceptionExposure, true)}
              hint="Not confirmed loss"
            />
            <Stat
              label="Pending Approval $"
              value={formatCurrency(auditKpis.pendingApproval, true)}
            />
            <Stat
              label="Payout Recon Diff $"
              value={formatCurrency(auditKpis.payoutReconciliationDiff, true)}
              hint="Approved − Paid − Approved Unpaid (expect ~0)"
            />
          </div>

          <nav className="flex flex-wrap gap-1 rounded-lg border border-[#dce6df] bg-[#f7faf8] p-1">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                auditView === 'transactions' ? 'bg-brand-50 text-forest ring-1 ring-forest/10' : 'text-ink-muted'
              }`}
              onClick={() => setAuditView('transactions')}
            >
              Commission Transaction Audit
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                auditView === 'exceptions' ? 'bg-brand-50 text-forest ring-1 ring-forest/10' : 'text-ink-muted'
              }`}
              onClick={() => setAuditView('exceptions')}
            >
              Audit Exceptions
            </button>
          </nav>

          {auditView === 'transactions' && (
            <ChartCard
              title="Commission Transaction Audit"
              subtitle="Expected from independent plan-rule engine — not a copy of production earned"
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="rounded-md border border-[#dce6df] px-2 py-1 text-xs"
                    value={txFilter}
                    onChange={(e) => setTxFilter(e.target.value as TransactionAuditStatus | 'All')}
                  >
                    {['All', 'Not Audited', 'Passed', 'Flagged', 'Under Review', 'Resolved'].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="text-xs text-forest underline"
                    onClick={() =>
                      exportToCsv(
                        'commission-transaction-audit.csv',
                        filteredTx.map((t) => ({
                          commission_id: t.ledgerId,
                          rep: t.repName,
                          customer_id: t.customerId,
                          expected: t.expectedCommission,
                          calculated: t.calculatedCommission,
                          variance: t.variance,
                          audit_status: t.auditStatus,
                          approval: t.approvalStatus,
                          payment: t.paymentStatus,
                          rules: t.ruleHits.join('|'),
                          formula: t.formula,
                        })),
                      )
                    }
                  >
                    Export CSV
                  </button>
                </div>
              }
            >
              <DataTable
                columns={[
                  {
                    key: 'ledgerId',
                    header: 'Commission ID',
                    render: (r) => r.ledgerId,
                    searchValue: (r) => `${r.ledgerId} ${r.repName}`,
                    sortValue: (r) => r.ledgerId,
                  },
                  {
                    key: 'repName',
                    header: 'Sales Rep',
                    render: (r) => r.repName,
                    sortValue: (r) => r.repName,
                  },
                  {
                    key: 'customerId',
                    header: 'Customer',
                    render: (r) =>
                      data.customers.find((c) => c.customer_id === r.customerId)?.customer_name ?? '—',
                  },
                  {
                    key: 'opportunityId',
                    header: 'Opportunity',
                    render: (r) => r.opportunityId ?? '—',
                  },
                  {
                    key: 'contractId',
                    header: 'Contract',
                    render: (r) => r.contractId ?? '—',
                  },
                  {
                    key: 'eligibleRevenue',
                    header: 'Eligible Rev',
                    align: 'right',
                    render: (r) => formatCurrency(r.eligibleRevenue, true),
                    sortValue: (r) => r.eligibleRevenue,
                  },
                  {
                    key: 'planVersionId',
                    header: 'Plan Ver',
                    render: (r) => r.planVersionId,
                  },
                  {
                    key: 'expectedCommission',
                    header: 'Expected',
                    align: 'right',
                    render: (r) => formatCurrencyPrecise(r.expectedCommission),
                    sortValue: (r) => r.expectedCommission,
                  },
                  {
                    key: 'calculatedCommission',
                    header: 'Calculated',
                    align: 'right',
                    render: (r) => formatCurrencyPrecise(r.calculatedCommission),
                    sortValue: (r) => r.calculatedCommission,
                  },
                  {
                    key: 'variance',
                    header: 'Variance',
                    align: 'right',
                    render: (r) => formatCurrencyPrecise(r.variance),
                    sortValue: (r) => r.variance,
                  },
                  {
                    key: 'auditStatus',
                    header: 'Audit',
                    render: (r) => r.auditStatus,
                    sortValue: (r) => r.auditStatus,
                  },
                  {
                    key: 'approvalStatus',
                    header: 'Approval',
                    render: (r) => r.approvalStatus,
                  },
                  {
                    key: 'paymentStatus',
                    header: 'Payment',
                    render: (r) => r.paymentStatus,
                  },
                ]}
                rows={filteredTx}
                rowKey={(r) => r.ledgerId}
                onRowClick={(r) => setAuditDetail(r)}
              />
            </ChartCard>
          )}

          {auditView === 'exceptions' && (
            <ChartCard
              title="Commission Audit Exceptions"
              subtitle={
                audits.filter((a) => a.status === 'Open' || a.status === 'Investigating').length === 0
                  ? 'No open audit exceptions for current filters.'
                  : 'Open items are under investigation — not confirmed financial loss'
              }
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
                        status: a.status,
                        expected: a.expected_amount,
                        actual: a.actual_amount,
                        difference: a.difference,
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
                    key: 'audit_id',
                    header: 'Audit ID',
                    render: (r) => r.audit_id,
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
                    render: (r) =>
                      data.salesReps.find((x) => x.rep_id === r.rep_id)?.rep_name ?? r.rep_id,
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
                  { key: 'status', header: 'Status', render: (r) => r.status },
                  { key: 'suggested_owner', header: 'Owner', render: (r) => r.suggested_owner },
                  { key: 'root_cause', header: 'Root Cause', render: (r) => r.root_cause },
                ]}
                rows={audits}
                rowKey={(r) => r.audit_id}
                onRowClick={(r) => {
                  if (r.customer_id) navigateWithContext('/customer-360', { customerId: r.customer_id })
                }}
              />
              <button
                type="button"
                className="mt-3 text-xs text-forest underline"
                onClick={() => navigateWithContext('/actions')}
              >
                Open Action Center
              </button>
            </ChartCard>
          )}
        </>
      )}

      {pageFocus === 'simulator' && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-3 rounded-xl border border-[#dce6df] bg-white p-4">
            <div className="text-sm font-semibold text-ink">Plan Parameters</div>
            <p className="text-[11px] text-ink-muted">
              Historical backtest on the same eligibility events. Paid history never overwritten.
            </p>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ['current', 'Current Plan'],
                  ['growth', 'Growth Incentive'],
                  ['margin', 'Margin Protection'],
                  ['custom', 'Custom'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`rounded-md px-2 py-1 text-[11px] ${
                    activeScenario === key
                      ? 'bg-forest text-white'
                      : 'border border-[#dce6df] text-ink-muted hover:bg-[#f7faf8]'
                  }`}
                  onClick={() => applyScenario(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <SimSlider
              label="Base revenue rate"
              value={sim.baseRevenueRate}
              min={0}
              max={0.03}
              step={0.001}
              format={(v) => formatPercent(v * 100, 2)}
              onChange={(v) => {
                setActiveScenario('custom')
                setSim({ ...sim, baseRevenueRate: v })
              }}
            />
            <SimSlider
              label="New acquisition rate"
              value={sim.newAcquisitionRate}
              min={0}
              max={0.1}
              step={0.005}
              format={(v) => formatPercent(v * 100, 2)}
              onChange={(v) => {
                setActiveScenario('custom')
                setSim({ ...sim, newAcquisitionRate: v })
              }}
            />
            <SimSlider
              label="Expansion rate"
              value={sim.expansionRate}
              min={0}
              max={0.08}
              step={0.005}
              format={(v) => formatPercent(v * 100, 2)}
              onChange={(v) => {
                setActiveScenario('custom')
                setSim({ ...sim, expansionRate: v })
              }}
            />
            <SimSlider
              label="Accel @ 100–119%"
              value={sim.accelerator100}
              min={1}
              max={2}
              step={0.05}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(v) => {
                setActiveScenario('custom')
                setSim({ ...sim, accelerator100: v })
              }}
            />
            <SimSlider
              label="Accel @ ≥120%"
              value={sim.accelerator120}
              min={1}
              max={2.5}
              step={0.05}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(v) => {
                setActiveScenario('custom')
                setSim({ ...sim, accelerator120: v })
              }}
            />
            <SimSlider
              label="New customer bonus"
              value={sim.newCustomerBonus}
              min={0}
              max={5000}
              step={100}
              format={(v) => formatCurrency(v)}
              onChange={(v) => {
                setActiveScenario('custom')
                setSim({ ...sim, newCustomerBonus: v })
              }}
            />
            <SimSlider
              label="Clawback credit rate"
              value={sim.clawbackCreditRate}
              min={0}
              max={1}
              step={0.05}
              format={(v) => formatPercent(v * 100, 0)}
              onChange={(v) => {
                setActiveScenario('custom')
                setSim({ ...sim, clawbackCreditRate: v })
              }}
            />
            <SimSlider
              label="Commission cap (0 = none)"
              value={sim.commissionCap ?? 0}
              min={0}
              max={100000}
              step={1000}
              format={(v) => (v === 0 ? 'None' : formatCurrency(v))}
              onChange={(v) => {
                setActiveScenario('custom')
                setSim({ ...sim, commissionCap: v === 0 ? null : v })
              }}
            />
            <SimSlider
              label="Quota adjustment %"
              value={sim.quotaAdjustmentPct}
              min={-20}
              max={20}
              step={1}
              format={(v) => `${v > 0 ? '+' : ''}${v}%`}
              onChange={(v) => {
                setActiveScenario('custom')
                setSim({ ...sim, quotaAdjustmentPct: v })
              }}
            />
            <SimSlider
              label="Margin incentive rate"
              value={sim.marginIncentiveRate}
              min={0}
              max={0.01}
              step={0.0005}
              format={(v) => formatPercent(v * 100, 2)}
              onChange={(v) => {
                setActiveScenario('custom')
                setSim({ ...sim, marginIncentiveRate: v })
              }}
            />
            <button
              type="button"
              className="w-full rounded-md border border-[#dce6df] px-3 py-2 text-xs font-medium text-ink hover:bg-[#f7faf8]"
              onClick={() => {
                setSim(currentPlanAsSimParams(data))
                setActiveScenario('current')
              }}
            >
              Reset to current plan (v2)
            </button>
            <button
              type="button"
              className="w-full rounded-md border border-[#dce6df] px-3 py-2 text-xs text-ink-muted hover:bg-[#f7faf8]"
              onClick={saveCustomScenario}
            >
              Save Custom Scenario
            </button>
            <button
              type="button"
              className="w-full rounded-md border border-[#dce6df] px-3 py-2 text-xs text-ink-muted hover:bg-[#f7faf8]"
              onClick={() => {
                setSim(DEFAULT_SIM_PARAMS)
                setActiveScenario('custom')
              }}
            >
              Load demo defaults
            </button>
          </div>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Stat
                label="Current Plan Earned Commission"
                value={formatCurrency(simResult.currentPlanEarned, true)}
              />
              <Stat
                label="Proposed Plan Earned Commission"
                value={formatCurrency(simResult.proposedPlanEarned, true)}
              />
              <Stat
                label="Total Commission Delta"
                value={formatCurrency(simResult.delta, true)}
                hint={`Σ rep Δ ${formatCurrency(simResult.sumRepDelta, true)}`}
              />
              <Stat
                label="Proposed Cost / Eligible"
                value={formatPercent(simResult.proposedCostPct)}
                hint={`Was ${formatPercent(simResult.currentCostPct)}`}
              />
              <Stat
                label="Contrib. after Comm. (Δ)"
                value={
                  simResult.contributionAfterCommissionCurrent == null ||
                  simResult.contributionAfterCommissionProposed == null
                    ? 'N/A'
                    : formatCurrency(
                        money(
                          simResult.contributionAfterCommissionProposed -
                            simResult.contributionAfterCommissionCurrent,
                        ),
                        true,
                      )
                }
                hint="Illustrative — UE does not subtract commission"
              />
            </div>
            <p className="text-xs text-ink-muted">{simResult.disclaimer}</p>

            <ChartCard
              title="Commission Impact Waterfall"
              subtitle="Fixed-order attribution · Interaction/Residual closes ledger↔eligibility gaps"
            >
              <FloatingWaterfall
                steps={simResult.waterfall.map((w) => ({
                  key: w.key,
                  label: w.label,
                  amount: w.amount,
                  shortLabel:
                    w.key === 'current'
                      ? 'Current'
                      : w.key === 'proposed'
                        ? 'Proposed'
                        : w.key === 'residual'
                          ? 'Residual'
                          : w.label.split(' ').slice(0, 2).join(' '),
                }))}
                height={260}
                totalKeys={['current', 'proposed']}
                footingNote="Current + signed plan impacts (+ residual if any) = Proposed."
              />
            </ChartCard>

            <ChartCard
              title="Winners & Losers by Plan"
              subtitle="Δ proposed − current earned · includes Explicit Unassigned margin row"
              action={
                <select
                  className="rounded-md border border-[#dce6df] px-2 py-1 text-xs"
                  value={winnerFilter}
                  onChange={(e) =>
                    setWinnerFilter(e.target.value as typeof winnerFilter)
                  }
                >
                  <option value="all">All</option>
                  <option value="winners">Winners</option>
                  <option value="losers">Losers</option>
                  <option value="unchanged">Unchanged</option>
                </select>
              }
            >
              <DataTable
                columns={[
                  {
                    key: 'repName',
                    header: 'Sales Rep',
                    render: (r) => (
                      <button
                        type="button"
                        className="text-forest underline"
                        onClick={() => !r.unassigned && setDetailRepId(r.repId)}
                      >
                        {r.repName}
                      </button>
                    ),
                    searchValue: (r) => `${r.repName} ${r.team}`,
                    sortValue: (r) => r.repName,
                  },
                  { key: 'team', header: 'Team', render: (r) => r.team },
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
                    header: 'Delta $',
                    align: 'right',
                    render: (r) => formatCurrency(r.delta, true),
                    sortValue: (r) => r.delta,
                  },
                  {
                    key: 'deltaPct',
                    header: 'Delta %',
                    align: 'right',
                    render: (r) => formatPercent(r.deltaPct),
                    sortValue: (r) => r.deltaPct ?? 0,
                  },
                  {
                    key: 'primaryChangeDriver',
                    header: 'Primary Driver',
                    render: (r) => r.primaryChangeDriver,
                  },
                ]}
                rows={filteredWinners}
                rowKey={(r) => r.repId}
              />
            </ChartCard>

            <ChartCard
              title="Scenario Comparison"
              subtitle="Same historical eligibility sample across scenarios"
            >
              <DataTable
                columns={[
                  { key: 'metric', header: 'Metric', render: (r) => r.metric },
                  {
                    key: 'current',
                    header: 'Current',
                    align: 'right',
                    render: (r) => r.current,
                  },
                  {
                    key: 'growth',
                    header: 'Growth Incentive',
                    align: 'right',
                    render: (r) => r.growth,
                  },
                  {
                    key: 'margin',
                    header: 'Margin Protection',
                    align: 'right',
                    render: (r) => r.margin,
                  },
                  {
                    key: 'custom',
                    header: 'Custom',
                    align: 'right',
                    render: (r) => r.custom,
                  },
                ]}
                rows={[
                  {
                    metric: 'Total Commission',
                    current: formatCurrency(scenarioResults.current.proposedPlanEarned, true),
                    growth: formatCurrency(scenarioResults.growth.proposedPlanEarned, true),
                    margin: formatCurrency(scenarioResults.margin.proposedPlanEarned, true),
                    custom: formatCurrency(scenarioResults.custom.proposedPlanEarned, true),
                  },
                  {
                    metric: 'Effective Rate',
                    current: formatPercent(scenarioResults.current.proposedCostPct),
                    growth: formatPercent(scenarioResults.growth.proposedCostPct),
                    margin: formatPercent(scenarioResults.margin.proposedCostPct),
                    custom: formatPercent(scenarioResults.custom.proposedCostPct),
                  },
                  {
                    metric: 'Cost Delta vs Current Plan',
                    current: 'Baseline',
                    growth: formatCurrency(scenarioResults.growth.delta, true),
                    margin: formatCurrency(scenarioResults.margin.delta, true),
                    custom: formatCurrency(scenarioResults.custom.delta, true),
                  },
                  {
                    metric: 'Profit after Commission',
                    current:
                      scenarioResults.current.contributionAfterCommissionProposed == null
                        ? 'N/A'
                        : formatCurrency(
                            scenarioResults.current.contributionAfterCommissionProposed,
                            true,
                          ),
                    growth:
                      scenarioResults.growth.contributionAfterCommissionProposed == null
                        ? 'N/A'
                        : formatCurrency(
                            scenarioResults.growth.contributionAfterCommissionProposed,
                            true,
                          ),
                    margin:
                      scenarioResults.margin.contributionAfterCommissionProposed == null
                        ? 'N/A'
                        : formatCurrency(
                            scenarioResults.margin.contributionAfterCommissionProposed,
                            true,
                          ),
                    custom:
                      scenarioResults.custom.contributionAfterCommissionProposed == null
                        ? 'N/A'
                        : formatCurrency(
                            scenarioResults.custom.contributionAfterCommissionProposed,
                            true,
                          ),
                  },
                  {
                    metric: 'Reps Gaining',
                    current: 'Baseline',
                    growth: String(
                      scenarioResults.growth.byRep.filter((r) => !r.unassigned && r.delta > 0).length,
                    ),
                    margin: String(
                      scenarioResults.margin.byRep.filter((r) => !r.unassigned && r.delta > 0).length,
                    ),
                    custom: String(
                      scenarioResults.custom.byRep.filter((r) => !r.unassigned && r.delta > 0).length,
                    ),
                  },
                ]}
                rowKey={(r) => r.metric}
              />
            </ChartCard>
          </div>
        </div>
      )}

      {/* Sales Rep Detail drawer */}
      {detailRep && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/25" role="dialog" aria-modal>
          <button
            type="button"
            className="flex-1 cursor-default"
            aria-label="Close"
            onClick={() => setDetailRepId(null)}
          />
          <aside className="flex h-full w-full max-w-xl flex-col border-l border-[#dce6df] bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-[#dce6df] px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
                  Sales Rep Detail
                </p>
                <h3 className="text-base font-semibold text-ink">{detailRep.repName}</h3>
                <p className="text-xs text-ink-muted">
                  {detailRep.team} · {detailRep.territory}
                </p>
              </div>
              <button
                type="button"
                className="text-ink-muted hover:text-ink"
                onClick={() => setDetailRepId(null)}
              >
                Close
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
              <section>
                <h4 className="mb-2 font-semibold uppercase text-ink-muted">Performance</h4>
                <dl className="grid grid-cols-2 gap-2">
                  <div>
                    <dt className="text-ink-muted">Eligible Revenue</dt>
                    <dd className="font-mono">{formatCurrency(detailRep.eligibleRevenue)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Quota Attainment</dt>
                    <dd className="font-mono">{formatPercent(detailRep.quotaAttainmentPct)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">New vs Expansion</dt>
                    <dd className="font-mono">
                      {formatCurrency(detailRep.newCustomerRevenue, true)} /{' '}
                      {formatCurrency(detailRep.expansionRevenue, true)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Win Rate</dt>
                    <dd className="font-mono">{formatPercent(detailRep.winRate)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Avg Deal Size</dt>
                    <dd className="font-mono">
                      {detailRep.avgDealSize == null
                        ? 'N/A'
                        : formatCurrency(detailRep.avgDealSize, true)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Sales Cycle</dt>
                    <dd className="font-mono">
                      {detailRep.avgSalesCycle == null
                        ? 'N/A'
                        : `${detailRep.avgSalesCycle.toFixed(0)} days`}
                    </dd>
                  </div>
                </dl>
              </section>
              <section>
                <h4 className="mb-2 font-semibold uppercase text-ink-muted">Compensation</h4>
                <dl className="grid grid-cols-2 gap-2">
                  <div>
                    <dt className="text-ink-muted">Earned</dt>
                    <dd className="font-mono">{formatCurrency(detailRep.earned)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Approved</dt>
                    <dd className="font-mono">{formatCurrency(detailRep.approved)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Paid</dt>
                    <dd className="font-mono">{formatCurrency(detailRep.paid)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Pending Approval</dt>
                    <dd className="font-mono">{formatCurrency(detailRep.pendingApproval)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Effective Rate</dt>
                    <dd className="font-mono">{formatPercent(detailRep.effectiveCommissionRatePct)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Plan Versions</dt>
                    <dd className="font-mono">{detailRep.appliedPlanVersions || '—'}</dd>
                  </div>
                </dl>
              </section>
              <section>
                <h4 className="mb-2 font-semibold uppercase text-ink-muted">Account Portfolio</h4>
                <p className="text-ink-muted">
                  Active accounts with commission credit: {detailRep.activeAccounts}
                </p>
                <button
                  type="button"
                  className="mt-2 text-forest underline"
                  onClick={() => {
                    setRepId(detailRep.repId)
                    navigateWithContext('/customers')
                  }}
                >
                  Open Customer Intelligence (filter context)
                </button>
              </section>
              <section>
                <h4 className="mb-2 font-semibold uppercase text-ink-muted">Transaction Details</h4>
                <DataTable
                  columns={[
                    { key: 'ledger_id', header: 'ID', render: (r) => r.ledger_id },
                    { key: 'period', header: 'Period', render: (r) => r.period },
                    {
                      key: 'customer_id',
                      header: 'Customer',
                      render: (r) =>
                        data.customers.find((c) => c.customer_id === r.customer_id)?.customer_name ??
                        '—',
                    },
                    {
                      key: 'commission_earned',
                      header: 'Earned',
                      align: 'right',
                      render: (r) => formatCurrency(r.commission_earned, true),
                    },
                    {
                      key: 'approval_status',
                      header: 'Approval',
                      render: (r) => r.approval_status,
                    },
                  ]}
                  rows={detailLedger.slice(0, 50)}
                  rowKey={(r) => r.ledger_id}
                  onRowClick={(r) => {
                    if (r.customer_id)
                      navigateWithContext('/customer-360', { customerId: r.customer_id })
                  }}
                />
              </section>
            </div>
          </aside>
        </div>
      )}

      {/* Audit formula drill-down */}
      {auditDetail && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/25" role="dialog" aria-modal>
          <button
            type="button"
            className="flex-1"
            aria-label="Close"
            onClick={() => setAuditDetail(null)}
          />
          <aside className="flex h-full w-full max-w-lg flex-col border-l border-[#dce6df] bg-white shadow-xl">
            <div className="border-b border-[#dce6df] px-4 py-3">
              <p className="text-xs font-semibold uppercase text-brand-600">Audit Drill-down</p>
              <h3 className="font-semibold text-ink">{auditDetail.ledgerId}</h3>
            </div>
            <div className="space-y-3 overflow-y-auto p-4 text-xs">
              <p className="rounded bg-[#f7faf8] p-2 font-mono">{auditDetail.formula}</p>
              <dl className="grid grid-cols-2 gap-2">
                <div>
                  <dt className="text-ink-muted">Expected</dt>
                  <dd>{formatCurrencyPrecise(auditDetail.expectedCommission)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Calculated</dt>
                  <dd>{formatCurrencyPrecise(auditDetail.calculatedCommission)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Variance</dt>
                  <dd>{formatCurrencyPrecise(auditDetail.variance)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Audit Status</dt>
                  <dd>{auditDetail.auditStatus}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Approval</dt>
                  <dd>{auditDetail.approvalStatus}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Payment</dt>
                  <dd>{auditDetail.paymentStatus}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Reviewer</dt>
                  <dd>{auditDetail.reviewer ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Audit Date</dt>
                  <dd>{auditDetail.auditDate ?? '—'}</dd>
                </div>
              </dl>
              <div>
                <p className="font-semibold text-ink-muted">Rule Hits</p>
                <p>{auditDetail.ruleHits.length ? auditDetail.ruleHits.join(', ') : 'None'}</p>
              </div>
              <div>
                <p className="font-semibold text-ink-muted">Trace</p>
                <p className="text-ink-muted">
                  {auditDetail.repName} → Customer {auditDetail.customerId ?? '—'} → Opp{' '}
                  {auditDetail.opportunityId ?? '—'} / Contract {auditDetail.contractId ?? '—'} →{' '}
                  {auditDetail.planVersionId} → {auditDetail.approvalStatus} →{' '}
                  {auditDetail.paymentStatus}
                </p>
              </div>
              <button
                type="button"
                className="text-forest underline"
                onClick={() => navigateWithContext('/actions')}
              >
                Action Center
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
