# Metric Dictionary

Canonical definitions live in `src/calc/metricRegistry.ts` (`METRIC_REGISTRY` + `computeSharedMetrics`).

## Naming that must not be mixed

| Metric | Means | Does **not** mean |
|---|---|---|
| Recognized Revenue | Accounting recognition (header rev-rec) | Cash / billings / bookings |
| Existing Customer Forecast | Run-rate forecast for current logos | Total Business Forecast |
| New Pipeline Forecast | Weighted new-logo activation | Existing run-rate |
| Open Recoverable Leakage | Open Missing Billing / Rate / Surcharge | Overdue AR or Scenario RaR |
| Scenario Revenue at Risk | Future revenue × assumed loss band | Confirmed loss / ML churn |
| Overdue AR | Unpaid past-due invoices | Revenue reduction |
| Contribution Profit | Net billings − variable cost | Operating profit |
| Operating Profit | Contribution − allocated fixed | Contribution |

## Date bases

| Family | Date field |
|---|---|
| Shipments / OTD | `ship_date` |
| Billings | `billing_date` / `accounting_period` |
| Invoices | `invoice_date` / `accounting_period` |
| Recognized | `recognition_date` / `accounting_period` |
| Cash | `payment_date` |
| Forecast | Target `accounting_period` |

## Fixed cost

- Base pool: `meta.fixed_opex_pool_monthly_base` ($9,000/mo)
- Downside stress pool: `meta.fixed_opex_pool_monthly_downside` ($42,000/mo)
- Driver: shipment volume share of **company** denominator
- Filtering a customer never reassigns 100% of company pool to that customer
