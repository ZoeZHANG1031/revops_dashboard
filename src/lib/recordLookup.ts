import type { DataStore } from '@/types'
import type { EntityType } from '@/lib/analysisUrl'
import { lineageFromRecognition, lineageFromShipment, type LineagePath } from '@/lib/lineage'
import { formatCurrencyPrecise } from '@/lib/money'

export interface LinkedRecord {
  entityType: EntityType
  entityId: string
  label: string
}

export interface TimelineEvent {
  date: string
  label: string
}

export interface EntityDetail {
  entityType: EntityType
  entityId: string
  title: string
  subtitle: string
  overview: { label: string; value: string }[]
  financial: { label: string; value: string; formula?: string }[]
  linked: LinkedRecord[]
  timeline: TimelineEvent[]
  exceptions: LinkedRecord[]
  actions: string[]
  dataSource: { table: string; fields: string[]; version: string }
  lineage: LineagePath | null
  available: boolean
}

function na(v: string | number | null | undefined): string {
  if (v == null || v === '') return 'Not Available'
  return String(v)
}

export function resolveEntity(data: DataStore, entityType: EntityType, entityId: string): EntityDetail {
  const base = {
    entityType,
    entityId,
    available: true,
    exceptions: [] as LinkedRecord[],
    actions: [] as string[],
    lineage: null as LineagePath | null,
  }

  switch (entityType) {
    case 'customer': {
      const c = data.customers.find((x) => x.customer_id === entityId)
      if (!c) return missing(entityType, entityId, 'dim_customer')
      const contracts = data.contracts.filter((x) => x.customer_id === entityId)
      const opps = data.opportunities.filter((x) => x.customer_id === entityId)
      const excs = data.exceptions.filter((x) => x.customer_id === entityId)
      return {
        ...base,
        title: c.customer_name,
        subtitle: `${c.segment} · ${c.region} · ${c.status}`,
        overview: [
          { label: 'Customer ID', value: c.customer_id },
          { label: 'Industry', value: c.industry },
          { label: 'Owner', value: c.account_owner },
          { label: 'Acquired', value: c.acquired_date },
        ],
        financial: [
          {
            label: 'Period Net Billing (filter not applied here)',
            value: formatCurrencyPrecise(
              data.billingLines
                .filter((b) => b.customer_id === entityId && !b.is_duplicate)
                .reduce((a, b) => a + b.net_amount, 0),
            ),
            formula: 'SUM(billing_line.net_amount) WHERE NOT is_duplicate',
          },
        ],
        linked: [
          ...contracts.map((ct) => ({
            entityType: 'contract' as const,
            entityId: ct.contract_id,
            label: `Contract ${ct.contract_id} v${ct.version}`,
          })),
          ...opps.slice(0, 5).map((o) => ({
            entityType: 'opportunity' as const,
            entityId: o.opportunity_id,
            label: `${o.stage} · ${o.opportunity_id}`,
          })),
        ],
        timeline: [{ date: c.acquired_date, label: 'Acquired' }],
        exceptions: excs.slice(0, 10).map((e) => ({
          entityType: 'exception' as const,
          entityId: e.exception_id,
          label: `${e.exception_type} · ${e.status}`,
        })),
        actions: ['Review health score', 'Open unit economics for customer', 'Check open exceptions'],
        dataSource: {
          table: 'dim_customer',
          fields: ['customer_id', 'customer_name', 'segment', 'region', 'status'],
          version: data.meta.snapshot_label,
        },
      }
    }
    case 'contract': {
      const ct = data.contracts.find((x) => x.contract_id === entityId)
      if (!ct) return missing(entityType, entityId, 'dim_contract')
      const rates = data.rateCards.filter((r) => r.contract_id === entityId)
      return {
        ...base,
        title: `Contract ${ct.contract_id}`,
        subtitle: `v${ct.version} · ${ct.status} · ${ct.pricing_model}`,
        overview: [
          { label: 'Customer', value: ct.customer_id },
          { label: 'Start', value: ct.start_date },
          { label: 'End', value: ct.end_date },
          { label: 'Payment Terms', value: `${ct.payment_terms_days}d` },
          { label: 'Volume Commitment', value: String(ct.volume_commitment) },
        ],
        financial: [
          { label: 'Volume Commitment', value: String(ct.volume_commitment), formula: 'contractual monthly pkgs' },
        ],
        linked: [
          {
            entityType: 'customer',
            entityId: ct.customer_id,
            label: `Customer ${ct.customer_id}`,
          },
          ...rates.map((r) => ({
            entityType: 'rate_card' as const,
            entityId: r.rate_card_id,
            label: `${r.service_type} ${r.region} v${r.version}`,
          })),
        ],
        timeline: [
          { date: ct.start_date, label: 'Contract start' },
          { date: ct.end_date, label: 'Contract end' },
        ],
        exceptions: [],
        actions: ['Trace rate card by ship date', 'Compare to billed rates'],
        dataSource: {
          table: 'dim_contract',
          fields: ['contract_id', 'customer_id', 'version', 'pricing_model'],
          version: data.meta.snapshot_label,
        },
      }
    }
    case 'opportunity': {
      const o = data.opportunities.find((x) => x.opportunity_id === entityId)
      if (!o) return missing(entityType, entityId, 'fact_opportunity')
      return {
        ...base,
        title: o.prospect_name,
        subtitle: `${o.stage} · win ${Math.round(o.win_probability * 100)}%`,
        overview: [
          { label: 'Opportunity ID', value: o.opportunity_id },
          { label: 'Customer', value: na(o.customer_id) },
          { label: 'Expected Start', value: o.expected_start_date },
          { label: 'Created', value: o.created_date },
          { label: 'Closed', value: na(o.closed_date) },
        ],
        financial: [
          { label: 'Opportunity Value', value: formatCurrencyPrecise(o.opportunity_value) },
          { label: 'Expected Monthly Revenue', value: formatCurrencyPrecise(o.expected_monthly_revenue) },
        ],
        linked: o.customer_id
          ? [{ entityType: 'customer', entityId: o.customer_id, label: `Customer ${o.customer_id}` }]
          : [],
        timeline: [
          { date: o.created_date, label: 'Created' },
          ...(o.closed_date ? [{ date: o.closed_date, label: 'Closed' }] : []),
        ],
        exceptions: [],
        actions: ['Sales pipeline stage is stock, not cohort conversion'],
        dataSource: {
          table: 'fact_opportunity',
          fields: ['opportunity_id', 'stage', 'opportunity_value'],
          version: data.meta.snapshot_label,
        },
      }
    }
    case 'shipment': {
      const s = data.shipments.find((x) => x.shipment_id === entityId)
      if (!s) return missing(entityType, entityId, 'fact_shipment')
      const lines = data.billingLines.filter((b) => b.shipment_id === entityId)
      const costs = data.costs.filter((c) => c.shipment_id === entityId)
      const excs = data.exceptions.filter((e) => e.shipment_id === entityId)
      const rate = data.rateCards.find((r) => {
        const shipDay = s.ship_date
        return (
          r.contract_id === s.contract_id &&
          r.service_type === s.service_type &&
          r.region === s.region &&
          r.effective_from <= shipDay &&
          r.effective_to >= shipDay
        )
      })
      return {
        ...base,
        title: `Shipment lot ${s.shipment_id}`,
        subtitle: `${s.package_count.toLocaleString()} packages · ${s.service_type} · ${s.metro} · ${s.station_id} · ${s.delivery_status}`,
        overview: [
          { label: 'Customer', value: s.customer_id },
          { label: 'Contract', value: s.contract_id },
          { label: 'Ship Date', value: s.ship_date },
          { label: 'Delivery', value: na(s.delivery_date) },
          { label: 'Weight (lbs)', value: String(s.weight_lbs) },
          { label: 'Billable', value: s.billable ? 'Yes' : 'No' },
          { label: 'DSP', value: s.dsp_id },
        ],
        financial: [
          {
            label: 'Net Billed',
            value: formatCurrencyPrecise(lines.filter((b) => !b.is_duplicate).reduce((a, b) => a + b.net_amount, 0)),
            formula: 'SUM billing_line.net_amount WHERE NOT is_duplicate',
          },
          {
            label: 'Variable Cost',
            value: formatCurrencyPrecise(
              costs.filter((c) => c.cost_type !== 'Allocated Fixed').reduce((a, c) => a + c.amount, 0),
            ),
          },
        ],
        linked: [
          { entityType: 'customer', entityId: s.customer_id, label: `Customer ${s.customer_id}` },
          { entityType: 'contract', entityId: s.contract_id, label: `Contract ${s.contract_id}` },
          ...(rate
            ? [{ entityType: 'rate_card' as const, entityId: rate.rate_card_id, label: `Rate ${rate.rate_card_id}` }]
            : []),
          ...lines.map((b) => ({
            entityType: 'billing_line' as const,
            entityId: b.billing_line_id,
            label: `Billing ${b.billing_line_id}`,
          })),
        ],
        timeline: [
          { date: s.ship_date, label: 'Shipped' },
          ...(s.delivery_date ? [{ date: s.delivery_date, label: 'Delivered / closed' }] : []),
        ],
        exceptions: excs.map((e) => ({
          entityType: 'exception' as const,
          entityId: e.exception_id,
          label: `${e.exception_type} · ${e.status}`,
        })),
        actions: excs.map((e) => e.recommended_action).slice(0, 3),
        dataSource: {
          table: 'fact_shipment',
          fields: ['shipment_id', 'customer_id', 'contract_id', 'ship_date', 'billable'],
          version: data.meta.snapshot_label,
        },
        lineage: lineageFromShipment(data, entityId),
      }
    }
    case 'rate_card': {
      const r = data.rateCards.find((x) => x.rate_card_id === entityId)
      if (!r) return missing(entityType, entityId, 'dim_rate_card')
      return {
        ...base,
        title: `Rate Card ${r.rate_card_id}`,
        subtitle: `${r.service_type} · ${r.region} · v${r.version}`,
        overview: [
          { label: 'Contract', value: r.contract_id },
          { label: 'Effective From', value: r.effective_from },
          { label: 'Effective To', value: r.effective_to },
          { label: 'Volume Tier Min', value: String(r.volume_tier_min) },
        ],
        financial: [
          { label: 'Base Rate', value: formatCurrencyPrecise(r.base_rate) },
          { label: 'Per Lb', value: formatCurrencyPrecise(r.per_lb_rate) },
          { label: 'Fuel Surcharge %', value: `${(r.fuel_surcharge_pct * 100).toFixed(1)}%` },
          { label: 'Remote Surcharge', value: formatCurrencyPrecise(r.remote_surcharge) },
          { label: 'Zone Multiplier', value: String(r.zone_multiplier) },
          {
            label: 'Pricing Formula',
            value: `(base + weight×per_lb) × zone × (1−tier_disc) × (1+fuel) + remote`,
            formula: 'Matched by contract+service+region and ship_date ∈ [effective_from, effective_to]',
          },
        ],
        linked: [{ entityType: 'contract', entityId: r.contract_id, label: `Contract ${r.contract_id}` }],
        timeline: [
          { date: r.effective_from, label: 'Effective from' },
          { date: r.effective_to, label: 'Effective to' },
        ],
        exceptions: [],
        actions: ['Match shipment ship_date to version window — do not use latest blindly'],
        dataSource: {
          table: 'dim_rate_card',
          fields: ['rate_card_id', 'base_rate', 'per_lb_rate', 'fuel_surcharge_pct', 'effective_from', 'effective_to'],
          version: data.meta.snapshot_label,
        },
      }
    }
    case 'billing_line': {
      const b = data.billingLines.find((x) => x.billing_line_id === entityId)
      if (!b) return missing(entityType, entityId, 'fact_billing_line')
      return {
        ...base,
        title: `Billing Line ${b.billing_line_id}`,
        subtitle: b.is_duplicate ? 'DUPLICATE FLAG' : `Net ${formatCurrencyPrecise(b.net_amount)}`,
        overview: [
          { label: 'Shipment', value: b.shipment_id },
          { label: 'Customer', value: b.customer_id },
          { label: 'Invoice', value: na(b.invoice_id) },
          { label: 'Billing Date', value: b.billing_date },
          { label: 'Period', value: b.accounting_period },
          { label: 'Rate Card', value: b.rate_card_id },
        ],
        financial: [
          { label: 'Base', value: formatCurrencyPrecise(b.base_charge) },
          { label: 'Fuel', value: formatCurrencyPrecise(b.fuel_surcharge) },
          { label: 'Remote', value: formatCurrencyPrecise(b.remote_surcharge) },
          { label: 'Discounts', value: formatCurrencyPrecise(b.discounts) },
          { label: 'Credits', value: formatCurrencyPrecise(b.credits) },
          {
            label: 'Net',
            value: formatCurrencyPrecise(b.net_amount),
            formula: 'base + fuel + remote − discounts − credits',
          },
        ],
        linked: [
          { entityType: 'shipment', entityId: b.shipment_id, label: `Shipment ${b.shipment_id}` },
          { entityType: 'rate_card', entityId: b.rate_card_id, label: `Rate ${b.rate_card_id}` },
          { entityType: 'customer', entityId: b.customer_id, label: `Customer ${b.customer_id}` },
          ...(b.invoice_id
            ? [{ entityType: 'invoice' as const, entityId: b.invoice_id, label: `Invoice ${b.invoice_id}` }]
            : []),
        ],
        timeline: [{ date: b.billing_date, label: 'Billed' }],
        exceptions: data.exceptions
          .filter((e) => e.billing_line_id === entityId)
          .map((e) => ({
            entityType: 'exception' as const,
            entityId: e.exception_id,
            label: e.exception_type,
          })),
        actions: b.is_duplicate ? ['Investigate duplicate billing'] : [],
        dataSource: {
          table: 'fact_billing_line',
          fields: ['billing_line_id', 'net_amount', 'rate_card_id', 'is_duplicate'],
          version: data.meta.snapshot_label,
        },
      }
    }
    case 'invoice': {
      const inv = data.invoices.find((x) => x.invoice_id === entityId)
      if (!inv) return missing(entityType, entityId, 'fact_invoice')
      const lines = data.billingLines.filter((b) => b.invoice_id === entityId)
      const pays = data.payments.filter((p) => p.invoice_id === entityId)
      return {
        ...base,
        title: `Invoice ${inv.invoice_id}`,
        subtitle: `${inv.status} · Due ${inv.due_date}`,
        overview: [
          { label: 'Customer', value: inv.customer_id },
          { label: 'Invoice Date', value: inv.invoice_date },
          { label: 'Period', value: inv.accounting_period },
          { label: 'Status', value: inv.status },
        ],
        financial: [
          { label: 'Gross', value: formatCurrencyPrecise(inv.gross_amount) },
          { label: 'Credits', value: formatCurrencyPrecise(inv.credit_amount) },
          { label: 'Net', value: formatCurrencyPrecise(inv.net_amount) },
          {
            label: 'Collected',
            value: formatCurrencyPrecise(pays.reduce((a, p) => a + p.amount, 0)),
            formula: 'SUM payments — cash ≠ recognized revenue',
          },
        ],
        linked: [
          { entityType: 'customer', entityId: inv.customer_id, label: `Customer ${inv.customer_id}` },
          ...lines.slice(0, 8).map((b) => ({
            entityType: 'billing_line' as const,
            entityId: b.billing_line_id,
            label: b.billing_line_id,
          })),
          ...pays.map((p) => ({
            entityType: 'payment' as const,
            entityId: p.payment_id,
            label: p.payment_id,
          })),
        ],
        timeline: [
          { date: inv.invoice_date, label: 'Issued' },
          { date: inv.due_date, label: 'Due' },
          ...pays.map((p) => ({ date: p.payment_date, label: `Payment ${p.payment_id}` })),
        ],
        exceptions: data.exceptions
          .filter((e) => e.invoice_id === entityId)
          .map((e) => ({
            entityType: 'exception' as const,
            entityId: e.exception_id,
            label: e.exception_type,
          })),
        actions: [],
        dataSource: {
          table: 'fact_invoice',
          fields: ['invoice_id', 'gross_amount', 'net_amount', 'status'],
          version: data.meta.snapshot_label,
        },
      }
    }
    case 'recognition': {
      const rr = data.revenueRecognition.find((x) => x.rev_rec_id === entityId)
      if (!rr) return missing(entityType, entityId, 'fact_revenue_recognition')
      const gl = data.generalLedger.filter((g) => g.rev_rec_id === entityId)
      return {
        ...base,
        title: `Recognition ${rr.rev_rec_id}`,
        subtitle: `${rr.recognition_type} · ${rr.accounting_period}`,
        overview: [
          { label: 'Customer', value: rr.customer_id },
          { label: 'Invoice', value: na(rr.invoice_id) },
          { label: 'Billing Line', value: na(rr.billing_line_id) },
          { label: 'Shipment', value: na(rr.shipment_id) },
          { label: 'GL Account', value: rr.gl_account },
          { label: 'Recognition Date', value: rr.recognition_date },
        ],
        financial: [{ label: 'Amount', value: formatCurrencyPrecise(rr.amount) }],
        linked: [
          ...(rr.invoice_id
            ? [{ entityType: 'invoice' as const, entityId: rr.invoice_id, label: rr.invoice_id }]
            : []),
          ...(rr.billing_line_id
            ? [
                {
                  entityType: 'billing_line' as const,
                  entityId: rr.billing_line_id,
                  label: rr.billing_line_id,
                },
              ]
            : []),
          ...(rr.shipment_id
            ? [{ entityType: 'shipment' as const, entityId: rr.shipment_id, label: rr.shipment_id }]
            : []),
          ...gl.map((g) => ({
            entityType: 'gl' as const,
            entityId: g.gl_entry_id,
            label: g.gl_entry_id,
          })),
        ],
        timeline: [{ date: rr.recognition_date, label: 'Recognized' }],
        exceptions: [],
        actions: ['Open Data Lineage Explorer'],
        dataSource: {
          table: 'fact_revenue_recognition',
          fields: ['rev_rec_id', 'amount', 'recognition_type', 'accounting_period'],
          version: data.meta.snapshot_label,
        },
        lineage: lineageFromRecognition(data, entityId),
      }
    }
    case 'gl': {
      const g = data.generalLedger.find((x) => x.gl_entry_id === entityId)
      if (!g) return missing(entityType, entityId, 'fact_general_ledger')
      return {
        ...base,
        title: `GL ${g.gl_entry_id}`,
        subtitle: `${g.account_code} ${g.account_name}`,
        overview: [
          { label: 'Period', value: g.accounting_period },
          { label: 'Entry Date', value: g.entry_date },
          { label: 'Customer', value: na(g.customer_id) },
          { label: 'Rev Rec', value: na(g.rev_rec_id) },
          { label: 'Invoice', value: na(g.invoice_id) },
          { label: 'Description', value: g.description },
        ],
        financial: [
          { label: 'Debit', value: formatCurrencyPrecise(g.debit) },
          { label: 'Credit', value: formatCurrencyPrecise(g.credit) },
        ],
        linked: [
          ...(g.rev_rec_id
            ? [{ entityType: 'recognition' as const, entityId: g.rev_rec_id, label: g.rev_rec_id }]
            : []),
          ...(g.invoice_id
            ? [{ entityType: 'invoice' as const, entityId: g.invoice_id, label: g.invoice_id }]
            : []),
        ],
        timeline: [{ date: g.entry_date, label: 'Posted' }],
        exceptions: [],
        actions: [],
        dataSource: {
          table: 'fact_general_ledger',
          fields: ['gl_entry_id', 'debit', 'credit', 'account_code'],
          version: data.meta.snapshot_label,
        },
      }
    }
    case 'payment': {
      const p = data.payments.find((x) => x.payment_id === entityId)
      if (!p) return missing(entityType, entityId, 'fact_payment')
      return {
        ...base,
        title: `Payment ${p.payment_id}`,
        subtitle: `${p.method} · ${p.payment_date}`,
        overview: [
          { label: 'Customer', value: p.customer_id },
          { label: 'Invoice', value: p.invoice_id },
          { label: 'Method', value: p.method },
        ],
        financial: [
          {
            label: 'Amount',
            value: formatCurrencyPrecise(p.amount),
            formula: 'Cash collection — not recognized revenue',
          },
        ],
        linked: [
          { entityType: 'invoice', entityId: p.invoice_id, label: p.invoice_id },
          { entityType: 'customer', entityId: p.customer_id, label: p.customer_id },
        ],
        timeline: [{ date: p.payment_date, label: 'Collected' }],
        exceptions: [],
        actions: [],
        dataSource: {
          table: 'fact_payment',
          fields: ['payment_id', 'amount', 'invoice_id'],
          version: data.meta.snapshot_label,
        },
      }
    }
    case 'cost': {
      const c = data.costs.find((x) => x.cost_id === entityId)
      if (!c) return missing(entityType, entityId, 'fact_cost')
      return {
        ...base,
        title: `${c.cost_type}`,
        subtitle: c.cost_id,
        overview: [
          { label: 'Shipment', value: na(c.shipment_id) },
          { label: 'Customer', value: na(c.customer_id) },
          { label: 'Region', value: c.region },
          { label: 'Service', value: na(c.service_type) },
          { label: 'DSP', value: na(c.dsp_id) },
          { label: 'Period', value: c.accounting_period },
        ],
        financial: [{ label: 'Amount', value: formatCurrencyPrecise(c.amount) }],
        linked: [
          ...(c.shipment_id
            ? [{ entityType: 'shipment' as const, entityId: c.shipment_id, label: c.shipment_id }]
            : []),
          ...(c.customer_id
            ? [{ entityType: 'customer' as const, entityId: c.customer_id, label: c.customer_id }]
            : []),
        ],
        timeline: [{ date: c.cost_date, label: 'Cost date' }],
        exceptions: [],
        actions:
          c.cost_type === 'Claims'
            ? ['Ensure claims not also double-counted as revenue credit']
            : [],
        dataSource: {
          table: 'fact_cost',
          fields: ['cost_id', 'cost_type', 'amount', 'shipment_id'],
          version: data.meta.snapshot_label,
        },
      }
    }
    case 'exception': {
      const e = data.exceptions.find((x) => x.exception_id === entityId)
      if (!e) return missing(entityType, entityId, 'fact_exception')
      return {
        ...base,
        title: e.exception_type,
        subtitle: `${e.status} · ${e.severity} · ${e.owner}`,
        overview: [
          { label: 'Exception ID', value: e.exception_id },
          { label: 'Customer', value: na(e.customer_id) },
          { label: 'Shipment', value: na(e.shipment_id) },
          { label: 'Billing Line', value: na(e.billing_line_id) },
          { label: 'Invoice', value: na(e.invoice_id) },
          { label: 'Root Cause', value: e.root_cause },
          { label: 'Trigger', value: e.trigger_rule },
          { label: 'Detected', value: e.detected_date },
        ],
        financial: [
          { label: 'Expected', value: formatCurrencyPrecise(e.expected_amount) },
          { label: 'Actual', value: formatCurrencyPrecise(e.actual_amount) },
          { label: 'Difference', value: formatCurrencyPrecise(e.difference) },
          { label: 'Financial Impact', value: formatCurrencyPrecise(e.financial_impact) },
        ],
        linked: [
          ...(e.customer_id
            ? [{ entityType: 'customer' as const, entityId: e.customer_id, label: e.customer_id }]
            : []),
          ...(e.shipment_id
            ? [{ entityType: 'shipment' as const, entityId: e.shipment_id, label: e.shipment_id }]
            : []),
          ...(e.billing_line_id
            ? [
                {
                  entityType: 'billing_line' as const,
                  entityId: e.billing_line_id,
                  label: e.billing_line_id,
                },
              ]
            : []),
          ...(e.invoice_id
            ? [{ entityType: 'invoice' as const, entityId: e.invoice_id, label: e.invoice_id }]
            : []),
        ],
        timeline: [{ date: e.detected_date, label: 'Detected' }],
        exceptions: [],
        actions: [e.recommended_action, e.resolution_notes || 'No resolution notes'].filter(Boolean),
        dataSource: {
          table: 'fact_exception',
          fields: [
            'exception_id',
            'exception_type',
            'expected_amount',
            'actual_amount',
            'status',
            'financial_impact',
          ],
          version: data.meta.snapshot_label,
        },
      }
    }
    case 'forecast': {
      const f = data.forecasts.find((x) => x.forecast_id === entityId)
      if (!f) return missing(entityType, entityId, 'fact_forecast')
      return {
        ...base,
        title: `Forecast ${f.forecast_id}`,
        subtitle: `${f.forecast_type} · ${f.scenario} · ${f.accounting_period}`,
        overview: [
          { label: 'Customer', value: na(f.customer_id) },
          { label: 'Period', value: f.accounting_period },
          { label: 'Type', value: f.forecast_type },
          { label: 'Scenario', value: f.scenario },
        ],
        financial: [
          { label: 'Volume', value: String(f.forecast_volume) },
          { label: 'Avg Rate', value: formatCurrencyPrecise(f.forecast_avg_rate) },
          { label: 'Net Billing', value: formatCurrencyPrecise(f.forecast_net_billing) },
          { label: 'Recognized', value: formatCurrencyPrecise(f.forecast_recognized) },
        ],
        linked: f.customer_id
          ? [{ entityType: 'customer', entityId: f.customer_id, label: f.customer_id }]
          : [],
        timeline: [],
        exceptions: [],
        actions: ['Scenario sliders adjust projected values — historical actuals unchanged'],
        dataSource: {
          table: 'fact_forecast',
          fields: ['forecast_id', 'forecast_type', 'forecast_recognized', 'scenario'],
          version: data.meta.snapshot_label,
        },
      }
    }
    default:
      return missing(entityType, entityId, 'unknown')
  }
}

function missing(entityType: EntityType, entityId: string, table: string): EntityDetail {
  return {
    entityType,
    entityId,
    title: 'No Linked Record',
    subtitle: `${entityType} ${entityId}`,
    overview: [{ label: 'Status', value: 'Not Available' }],
    financial: [],
    linked: [],
    timeline: [],
    exceptions: [],
    actions: [],
    dataSource: { table, fields: [], version: 'n/a' },
    lineage: null,
    available: false,
  }
}
