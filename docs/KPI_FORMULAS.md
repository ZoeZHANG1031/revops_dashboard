# KPI Formula Documentation

Canonical definitions live in `src/calc/kpiDefinitions.ts` and are shown in-app via the info icon on each KPI card.

## Core executive KPIs

| KPI | Formula |
|---|---|
| Recognized Revenue | `SUM(rev_rec.amount)` where `billing_line_id IS NULL` in filter |
| Forecast Revenue | `SUM(forecast_recognized)` Existing + selected scenario |
| Revenue Variance | Recognized − Forecast |
| Net Billed Revenue | `SUM(billing_line.net_amount)` where `is_duplicate=false` |
| Contribution Profit | Net Billed − Variable Costs |
| Contribution Margin | Contribution Profit / Net Billed |
| Revenue at Risk | `Σ (Expected Future Revenue × Assumed Loss Probability)` |
| Unbilled Exposure | `SUM(expected_amount)` for Missing Billing exceptions |

## Unit economics

| KPI | Formula |
|---|---|
| Revenue per Package | Net Revenue / Billable Packages |
| Variable Cost per Package | Variable Costs / Billable Packages |
| Operating Profit | Contribution Profit − Allocated Fixed |

## Variance bridge (non-overlapping)

1. Volume = `(ActVol − FcVol) × FcAvgRate`
2. Price = `ActVol × (ActAvgRateBeforeCredits − FcAvgRate)`
3. Mix = customer share residual vs forecast shares
4. Credits = `−(ActCredits − FcCredits)`
5. Other = plug so Σ effects = Actual − Forecast

Automated tests assert `|Σ effects − (Actual − Forecast)| < $0.05`.
