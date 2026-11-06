# Revenue Reconciliation Methodology

## Layers compared

1. **Operations** — billable shipments from TMS/OMS (`fact_shipment`)
2. **Pricing** — expected charges from effective `dim_rate_card`
3. **Billing** — rated `fact_billing_line` (excluding duplicates for totals)
4. **Finance** — invoices, revenue recognition headers, GL account 4000

## Rules engine (deterministic)

| Condition | Exception |
|---|---|
| Billable shipment with no billing line | Missing Billing |
| More than one billing line per shipment | Duplicate Billing |
| \|Billed base − Contract base\| / Contract base > 2% | Rate Mismatch |
| Contract fuel % > 0 and fuel surcharge = 0 | Missing Surcharge |
| Invoice period ≠ recognition period | Timing Difference |
| Invoice past due and not paid | Overdue AR |

## Classification

| Nature | Meaning |
|---|---|
| Revenue Leakage | Preventable miss (missing/duplicate/rate/surcharge) |
| Timing Difference | Accounting cut-off — not leakage |
| Contract Adjustment | Accepted credit / documented adjustment |
| Unverified Anomaly | Needs investigation |

## Data quality policy

If invoice ≠ billing−credits or rev-rec ≠ GL within $0.02, the UI shows a **Data Quality Warning**. Numbers are not silently forced to match.
