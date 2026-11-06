import { it } from 'vitest'
import { generateDataStore } from '@/data/generate'
it('calibration', () => {
  const t0 = performance.now()
  const d = generateDataStore()
  console.log('gen ms', Math.round(performance.now() - t0))
  console.log('rows', JSON.stringify(Object.fromEntries(Object.entries(d).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length]))))
  const per = (p: string) => {
    const lots = d.shipments.filter((s) => s.ship_date.startsWith(p))
    const pk = lots.reduce((a, s) => a + s.package_count, 0)
    const lines = d.billingLines.filter((b) => b.accounting_period === p && !b.is_duplicate)
    const net = lines.reduce((a, b) => a + b.net_amount, 0)
    const bp = lines.reduce((a, b) => a + b.package_count, 0)
    const vc = d.costs.filter((c) => c.accounting_period === p && c.cost_type !== 'Allocated Fixed').reduce((a, c) => a + c.amount, 0)
    const fx = d.costs.filter((c) => c.accounting_period === p && c.cost_type === 'Allocated Fixed').reduce((a, c) => a + c.amount, 0)
    const cust = new Set(lots.map((l) => l.customer_id)).size
    const metros = new Set(lots.map((l) => l.metro)).size
    const del = lots.filter((l) => l.delivery_status === 'Delivered').reduce((a, s) => a + s.package_count, 0)
    const ot = lots.filter((l) => l.on_time).reduce((a, s) => a + s.package_count, 0)
    return `${p} lots=${lots.length} pkgs=${pk} net=${Math.round(net)} rpp=${(net / bp).toFixed(2)} CM=${((net - vc) / net * 100).toFixed(1)}% OP=${((net - vc - fx) / net * 100).toFixed(1)}% cust=${cust} metros=${metros} deliv=${(del / pk * 100).toFixed(1)} otd=${(ot / pk * 100).toFixed(1)}`
  }
  ;['2024-10', '2024-12', '2025-01', '2025-06', '2025-10', '2025-12', '2026-02', '2026-06', '2026-08', '2026-09', '2026-10'].forEach((p) => console.log(per(p)))
  const segs: Record<string, number> = {}
  const octLines = d.billingLines.filter((b) => b.accounting_period === '2026-10' && !b.is_duplicate)
  const byCust = new Map<string, number>()
  octLines.forEach((b) => byCust.set(b.customer_id, (byCust.get(b.customer_id) ?? 0) + b.net_amount))
  const ranked = [...byCust.values()].sort((a, b) => b - a); const tot = ranked.reduce((a, x) => a + x, 0)
  console.log('top1', (ranked[0] / tot * 100).toFixed(1), 'top5', (ranked.slice(0, 5).reduce((a, x) => a + x, 0) / tot * 100).toFixed(1), 'top10', (ranked.slice(0, 10).reduce((a, x) => a + x, 0) / tot * 100).toFixed(1))
  d.customers.forEach((c) => { segs[c.lifecycle_status] = (segs[c.lifecycle_status] ?? 0) + 1 })
  console.log('lifecycle', JSON.stringify(segs), 'customers', d.customers.length, 'stations', d.stations.length, 'dsps', d.dsps.length)
  const ex: Record<string, string> = {}
  d.exceptions.forEach((e) => { ex[e.exception_type] = String(Number(ex[e.exception_type] ?? 0) + 1) })
  console.log('exceptions', JSON.stringify(ex))
  const open = d.exceptions.filter((e) => ['Open', 'Investigating', 'Pending Approval'].includes(e.status))
  console.log('open exc', open.length, 'impact', Math.round(open.reduce((a, e) => a + e.financial_impact, 0)))
  const overdue = d.invoices.filter((i) => i.status === 'Overdue')
  console.log('invoices', d.invoices.length, 'overdue', overdue.length, JSON.stringify(Object.fromEntries(['Paid', 'Partial', 'Issued', 'Overdue'].map((s) => [s, d.invoices.filter((i) => i.status === s).length]))))
  const util = d.stations.map((s) => s.capacity_daily).sort((a, b) => a - b)
  console.log('station cap min/med/max', util[0], util[Math.floor(util.length / 2)], util[util.length - 1])
  console.log('forecast rows', d.forecasts.length, 'snapshots', d.forecastSnapshots.length, 'periods', [...new Set(d.forecasts.map((f) => f.accounting_period))].sort().join(','))
  const svc: Record<string, number> = {}
  d.shipments.filter((s) => s.ship_date.startsWith('2026-10')).forEach((s) => (svc[s.service_type] = (svc[s.service_type] ?? 0) + s.package_count))
  console.log('svc mix', JSON.stringify(svc))
  const rppSvc: Record<string, string> = {}
  ;['Economy', 'Standard', 'Express', 'SameDay'].forEach((sv) => { const l = octLines.filter((b) => b.service_type === sv); rppSvc[sv] = (l.reduce((a, b) => a + b.net_amount, 0) / l.reduce((a, b) => a + b.package_count, 0)).toFixed(2) })
  console.log('rpp by svc', JSON.stringify(rppSvc))
}, 120000)
