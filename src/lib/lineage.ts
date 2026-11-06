import type { DataStore } from '@/types'
import type { EntityType } from '@/lib/analysisUrl'

export interface LineageHop {
  entityType: EntityType
  entityId: string
  label: string
  sourceTable: string
  joinKey: string
  transformation: string
  amount?: number
}

export interface LineagePath {
  metricOrEntity: string
  hops: LineageHop[]
  aggregation: string
  dateBasis: string
  filtersApplied: string[]
  residualNote?: string
}

/** Forward lineage from recognition → shipment → rate card */
export function lineageFromRecognition(
  data: DataStore,
  revRecId: string,
): LineagePath {
  const rr = data.revenueRecognition.find((r) => r.rev_rec_id === revRecId)
  const hops: LineageHop[] = []
  if (!rr) {
    return {
      metricOrEntity: revRecId,
      hops: [],
      aggregation: 'none',
      dateBasis: 'recognition',
      filtersApplied: [],
      residualNote: 'Recognition entry not found',
    }
  }
  hops.push({
    entityType: 'recognition',
    entityId: rr.rev_rec_id,
    label: `Recognition ${rr.rev_rec_id}`,
    sourceTable: 'fact_revenue_recognition',
    joinKey: 'rev_rec_id',
    transformation: `${rr.recognition_type} amount`,
    amount: rr.amount,
  })
  if (rr.invoice_id) {
    hops.push({
      entityType: 'invoice',
      entityId: rr.invoice_id,
      label: `Invoice ${rr.invoice_id}`,
      sourceTable: 'fact_invoice',
      joinKey: 'invoice_id',
      transformation: 'Invoice / Accrual source',
    })
  }
  if (rr.billing_line_id) {
    const bl = data.billingLines.find((b) => b.billing_line_id === rr.billing_line_id)
    hops.push({
      entityType: 'billing_line',
      entityId: rr.billing_line_id,
      label: `Billing Line ${rr.billing_line_id}`,
      sourceTable: 'fact_billing_line',
      joinKey: 'billing_line_id',
      transformation: 'net_amount',
      amount: bl?.net_amount,
    })
    if (bl) {
      hops.push({
        entityType: 'shipment',
        entityId: bl.shipment_id,
        label: `Shipment ${bl.shipment_id}`,
        sourceTable: 'fact_shipment',
        joinKey: 'shipment_id',
        transformation: 'operational source of charge',
      })
      hops.push({
        entityType: 'rate_card',
        entityId: bl.rate_card_id,
        label: `Rate Card ${bl.rate_card_id}`,
        sourceTable: 'dim_rate_card',
        joinKey: 'rate_card_id',
        transformation: 'pricing applied at ship date',
      })
    }
  } else if (rr.shipment_id) {
    hops.push({
      entityType: 'shipment',
      entityId: rr.shipment_id,
      label: `Shipment ${rr.shipment_id}`,
      sourceTable: 'fact_shipment',
      joinKey: 'shipment_id',
      transformation: 'accrual without billing line',
    })
  }
  return {
    metricOrEntity: 'Recognized Revenue',
    hops,
    aggregation: 'SUM(amount) by accounting_period',
    dateBasis: 'recognition / accounting_period',
    filtersApplied: ['GlobalFilters.accounting_period', 'customer/region/service'],
  }
}

/** Reverse: shipment impact on revenue / cost / exceptions */
export function lineageFromShipment(data: DataStore, shipmentId: string): LineagePath {
  const ship = data.shipments.find((s) => s.shipment_id === shipmentId)
  const hops: LineageHop[] = []
  if (!ship) {
    return {
      metricOrEntity: shipmentId,
      hops: [],
      aggregation: 'none',
      dateBasis: 'shipment',
      filtersApplied: [],
      residualNote: 'Shipment not found',
    }
  }
  hops.push({
    entityType: 'shipment',
    entityId: ship.shipment_id,
    label: `Shipment ${ship.shipment_id}`,
    sourceTable: 'fact_shipment',
    joinKey: 'shipment_id',
    transformation: 'ops event',
  })
  hops.push({
    entityType: 'customer',
    entityId: ship.customer_id,
    label: `Customer ${ship.customer_id}`,
    sourceTable: 'dim_customer',
    joinKey: 'customer_id',
    transformation: 'commercial owner',
  })
  hops.push({
    entityType: 'contract',
    entityId: ship.contract_id,
    label: `Contract ${ship.contract_id}`,
    sourceTable: 'dim_contract',
    joinKey: 'contract_id',
    transformation: 'pricing authority',
  })
  const lines = data.billingLines.filter((b) => b.shipment_id === shipmentId)
  for (const bl of lines.slice(0, 5)) {
    hops.push({
      entityType: 'billing_line',
      entityId: bl.billing_line_id,
      label: `Billing ${bl.billing_line_id}`,
      sourceTable: 'fact_billing_line',
      joinKey: 'shipment_id',
      transformation: 'rated → billed',
      amount: bl.net_amount,
    })
  }
  const recs = data.revenueRecognition.filter((r) => r.shipment_id === shipmentId)
  for (const rr of recs.slice(0, 3)) {
    hops.push({
      entityType: 'recognition',
      entityId: rr.rev_rec_id,
      label: `Recognition ${rr.rev_rec_id}`,
      sourceTable: 'fact_revenue_recognition',
      joinKey: 'shipment_id',
      transformation: rr.recognition_type,
      amount: rr.amount,
    })
  }
  const costs = data.costs.filter((c) => c.shipment_id === shipmentId)
  for (const c of costs.slice(0, 5)) {
    hops.push({
      entityType: 'cost',
      entityId: c.cost_id,
      label: `${c.cost_type} ${c.cost_id}`,
      sourceTable: 'fact_cost',
      joinKey: 'shipment_id',
      transformation: c.cost_type,
      amount: c.amount,
    })
  }
  const excs = data.exceptions.filter((e) => e.shipment_id === shipmentId)
  for (const e of excs.slice(0, 5)) {
    hops.push({
      entityType: 'exception',
      entityId: e.exception_id,
      label: `${e.exception_type}`,
      sourceTable: 'fact_exception',
      joinKey: 'shipment_id',
      transformation: e.root_cause,
      amount: e.financial_impact,
    })
  }
  return {
    metricOrEntity: `Shipment ${shipmentId} impact`,
    hops,
    aggregation: '1:N billing/cost/exception; do not double-count revenue across joins',
    dateBasis: 'ship_date / billing_date / recognition_date',
    filtersApplied: [],
  }
}

export function lineageForMetric(metricId: string): LineagePath {
  const MAP: Record<string, LineagePath> = {
    recognized_revenue: {
      metricOrEntity: 'Recognized Revenue',
      hops: [
        {
          entityType: 'recognition',
          entityId: '*',
          label: 'Recognition Entries',
          sourceTable: 'fact_revenue_recognition',
          joinKey: 'accounting_period',
          transformation: 'SUM(amount)',
        },
        {
          entityType: 'invoice',
          entityId: '*',
          label: 'Invoice / Accrual',
          sourceTable: 'fact_invoice / accrual flags',
          joinKey: 'invoice_id',
          transformation: 'optional link',
        },
        {
          entityType: 'billing_line',
          entityId: '*',
          label: 'Billing Lines',
          sourceTable: 'fact_billing_line',
          joinKey: 'billing_line_id',
          transformation: 'exclude is_duplicate',
        },
        {
          entityType: 'shipment',
          entityId: '*',
          label: 'Shipments',
          sourceTable: 'fact_shipment',
          joinKey: 'shipment_id',
          transformation: 'ops source',
        },
        {
          entityType: 'rate_card',
          entityId: '*',
          label: 'Contract Rate Card',
          sourceTable: 'dim_rate_card',
          joinKey: 'rate_card_id',
          transformation: 'effective_from/to vs ship_date',
        },
      ],
      aggregation: 'SUM recognition.amount (no JOIN fan-out)',
      dateBasis: 'recognition accounting_period',
      filtersApplied: ['startPeriod–endPeriod', 'customerIds', 'regions', 'serviceTypes'],
    },
    unbilled_exposure: {
      metricOrEntity: 'Unbilled Exposure',
      hops: [
        {
          entityType: 'exception',
          entityId: '*',
          label: 'Missing Billing exceptions',
          sourceTable: 'fact_exception',
          joinKey: 'exception_type=Missing Billing',
          transformation: 'SUM(expected_amount) for open-ish statuses',
        },
        {
          entityType: 'shipment',
          entityId: '*',
          label: 'Billable shipment without billing line',
          sourceTable: 'fact_shipment',
          joinKey: 'shipment_id',
          transformation: 'expected charge from rate card',
        },
      ],
      aggregation: 'SUM exception.expected_amount',
      dateBasis: 'detected_date / ship_date',
      filtersApplied: ['GlobalFilters', 'local exception status optional'],
    },
    contribution_margin: {
      metricOrEntity: 'Contribution Margin',
      hops: [
        {
          entityType: 'billing_line',
          entityId: '*',
          label: 'Net Revenue basis',
          sourceTable: 'fact_billing_line / recognition',
          joinKey: 'customer/period',
          transformation: 'Net Revenue − Variable Costs',
        },
        {
          entityType: 'cost',
          entityId: '*',
          label: 'Variable costs',
          sourceTable: 'fact_cost',
          joinKey: 'shipment_id / customer_id',
          transformation: 'exclude Allocated Fixed',
        },
      ],
      aggregation: 'Contribution Profit / Net Revenue',
      dateBasis: 'accounting_period',
      filtersApplied: ['GlobalFilters'],
      residualNote: 'Allocated Fixed is separate Fully Allocated view',
    },
  }
  return (
    MAP[metricId] ?? {
      metricOrEntity: metricId,
      hops: [],
      aggregation: 'see METRIC_REGISTRY',
      dateBasis: 'varies',
      filtersApplied: [],
    }
  )
}
