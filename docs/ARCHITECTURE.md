# Architecture & Design Decisions

## Stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · Recharts · React Router · decimal.js · Vitest

## Module boundaries

```
src/types          Domain types
src/data           Seeded synthetic generator (single source of truth)
src/lib            Money, filters, CSV export, analysis URL, lineage, record lookup
src/calc           KPI / recon / forecast / health / unit economics
src/context        Global filters, scenario, URL sync, entity drawer, exception overrides
src/components     Layout + DetailDrawer + shared UI
src/pages          Seven route pages (Company Overview + six analysis pages)
```

## Key decisions

1. **One data store** — all pages read `getDataStore()`; no page-local mock KPIs.
2. **Header vs detail rev-rec** — invoice-level recognition headers (`billing_line_id = null`) drive company KPIs; detail rows enable shipment traceability without double-counting.
3. **Duplicates flagged** — duplicate billing lines exist for exception demos but are excluded from net billing KPIs via `is_duplicate`.
4. **Decimal money** — aggregation uses `decimal.js` then rounds to 2 dp.
5. **Fixed seed** — `20241105` for reproducible demos and tests.
6. **Warnings over coercion** — reconciliation mismatches surface as Data Quality Warnings / Unexplained Residual.
7. **Global vs local filters** — date/customer/region/service/scenario/dateBasis sync via URL query string; exception type/status are local analysis filters and do not rewrite recognized revenue scope.
8. **Detail Drawer** — `resolveEntity` only returns links that exist in the synthetic store; missing FKs show Not Available / No Linked Record.
9. **Exception status overrides** — demo workflow mutates an in-memory override map only (not the generator seed); Action Center / open leakage KPIs recompute from the overridden store.

## Cross-page navigation

| From | Action | To |
|---|---|---|
| Executive KPI | View Breakdown / Trace / Investigate | Lifecycle, Unit Econ, Forecasting, Customers, Reconciliation |
| Action Center exception | Row click | Reconciliation + Exception Detail Drawer |
| Lifecycle stage / rev-rec / rate card | Click | Shipment / Recognition / Rate Card drawer |
| Customer scorecard / risk charts | Click | Customer 360 drawer; deep-links to Unit / Forecast / Recon |
| Unit Economics bubble / table | Click | Customer highlight + drawer |

Shareable analysis URLs encode `from`, `to`, `customer`, `region`, `service`, `scenario`, `dateBasis`, `excType`, `excStatus`, `entityType`, `entityId`.

## Performance notes

Shipment volume is sized for browser interactivity (~tens of thousands of rows). Filters reduce working sets before aggregation.
