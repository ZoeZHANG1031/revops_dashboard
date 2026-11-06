import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { computeTraceability } from '@/calc/kpis'
import type { EntityType } from '@/lib/analysisUrl'
import { formatCurrencyPrecise } from '@/lib/money'

type Trace = NonNullable<ReturnType<typeof computeTraceability>>

interface TraceRecord {
  id: string
  entityType: EntityType
  amount: number | null
  date: string | null
  status: string
}

interface TraceNode {
  key: string
  label: string
  source: string
  logic: string
  records: TraceRecord[]
}

function buildNodes(t: Trace): TraceNode[] {
  const glAmount = (g: Trace['gl'][number]) => (g.credit || 0) - (g.debit || 0)
  return [
    {
      key: 'rec',
      label: 'Revenue Recognition',
      source: 'fact_revenue_recognition',
      logic: 'Header row (billing_line_id = null) for the invoice in the accounting period',
      records: [
        {
          id: t.header.rev_rec_id,
          entityType: 'recognition',
          amount: t.header.amount,
          date: t.header.recognition_date,
          status: `${t.header.recognition_type} · ${t.header.accounting_period}`,
        },
      ],
    },
    {
      key: 'gl',
      label: 'General Ledger',
      source: 'fact_general_ledger',
      logic: 'gl.rev_rec_id = recognition.rev_rec_id; revenue = credit − debit',
      records: t.gl.map((g) => ({
        id: g.gl_entry_id,
        entityType: 'gl' as const,
        amount: glAmount(g),
        date: g.entry_date,
        status: `${g.account_code} ${g.account_name}`,
      })),
    },
    {
      key: 'inv',
      label: 'Invoice',
      source: 'fact_invoice',
      logic: 'invoice.invoice_id = recognition.invoice_id',
      records: t.invoice
        ? [
            {
              id: t.invoice.invoice_id,
              entityType: 'invoice' as const,
              amount: t.invoice.net_amount,
              date: t.invoice.invoice_date,
              status: `${t.invoice.status} · due ${t.invoice.due_date}`,
            },
          ]
        : [],
    },
    {
      key: 'bl',
      label: 'Billing Line',
      source: 'fact_billing_line',
      logic: 'Recognition detail rows (same invoice + period) → billing_line_id; net = base + fuel + remote − discounts − credits',
      records: t.billingLines.map((b) => ({
        id: b!.billing_line_id,
        entityType: 'billing_line' as const,
        amount: b!.net_amount,
        date: b!.billing_date,
        status: b!.is_duplicate ? 'Duplicate' : b!.accounting_period,
      })),
    },
    {
      key: 'sh',
      label: 'Shipment',
      source: 'fact_shipment',
      logic: 'billing_line.shipment_id = shipment.shipment_id',
      records: t.shipments.map((s) => ({
        id: s!.shipment_id,
        entityType: 'shipment' as const,
        amount: null,
        date: s!.ship_date,
        status: `${s!.delivery_status} · ${s!.service_type} · ${s!.metro}`,
      })),
    },
    {
      key: 'rc',
      label: 'Rate Card',
      source: 'dim_rate_card',
      logic: 'billing_line.rate_card_id; version effective on ship_date',
      records: [...new Map(t.rateCards.map((r) => [r!.rate_card_id, r!])).values()].map((r) => ({
        id: r.rate_card_id,
        entityType: 'rate_card' as const,
        amount: r.base_rate,
        date: `${r.effective_from} → ${r.effective_to}`,
        status: `v${r.version} · ${r.service_type} · ${r.region}`,
      })),
    },
  ]
}

/** Interactive lineage: Recognition → GL → Invoice → Billing Line → Shipment → Rate Card */
export function TraceabilityChain({
  trace,
  onOpenRecord,
}: {
  trace: Trace
  onOpenRecord: (type: EntityType, id: string) => void
}) {
  const nodes = buildNodes(trace)
  const [active, setActive] = useState('rec')
  const node = nodes.find((n) => n.key === active) ?? nodes[0]
  return (
    <div className="rounded-xl border border-forest/15 bg-[#f7faf8] p-3">
      <ol className="flex flex-wrap items-center gap-1" aria-label="Revenue lineage">
        {nodes.map((n, i) => (
          <li key={n.key} className="flex items-center gap-1">
            <button
              type="button"
              aria-pressed={active === n.key}
              onClick={() => setActive(n.key)}
              disabled={n.records.length === 0}
              className={`rounded-lg border px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                active === n.key
                  ? 'border-forest bg-white shadow ring-2 ring-forest/20'
                  : n.records.length === 0
                    ? 'cursor-not-allowed border-dashed border-[#c5d5cb] text-ink-muted'
                    : 'border-[#dce6df] bg-white hover:border-brand-400'
              }`}
            >
              <span className="block font-semibold text-ink">{n.label}</span>
              <span className="text-xs text-ink-muted">
                {n.records.length === 0 ? 'No linked record' : `${n.records.length} record${n.records.length > 1 ? 's' : ''}`}
              </span>
            </button>
            {i < nodes.length - 1 && <ChevronRight size={14} className="text-ink-muted" aria-hidden />}
          </li>
        ))}
      </ol>
      <div className="mt-2 rounded-lg border border-[#dce6df] bg-white p-2.5 text-[13px]">
        <p>
          <span className="font-semibold text-ink">Source table: </span>
          <span className="font-mono">{node.source}</span>
        </p>
        <p className="mt-0.5">
          <span className="font-semibold text-ink">Matching logic: </span>
          <span className="text-ink-muted">{node.logic}</span>
        </p>
        <table className="mt-2 w-full text-left">
          <thead className="text-xs uppercase text-ink-muted">
            <tr>
              <th className="py-1">Record ID</th>
              <th className="py-1 text-right">Amount</th>
              <th className="py-1">Date</th>
              <th className="py-1">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {node.records.slice(0, 12).map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-1 font-mono">{r.id}</td>
                <td className="py-1 text-right font-mono">{r.amount == null ? '—' : formatCurrencyPrecise(r.amount)}</td>
                <td className="py-1">{r.date ?? '—'}</td>
                <td className="py-1 text-ink-muted">{r.status}</td>
                <td className="py-1 text-right">
                  <button type="button" className="text-brand-700 hover:underline" onClick={() => onOpenRecord(r.entityType, r.id)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {node.records.length > 12 && <p className="mt-1 text-xs text-ink-muted">+{node.records.length - 12} more</p>}
      </div>
    </div>
  )
}
