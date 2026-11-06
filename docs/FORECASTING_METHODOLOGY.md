# Forecasting Methodology

## Structure

```
Total Expected Revenue = Existing Customer Forecast + New Pipeline Forecast
```

Pipeline rows use `forecast_type = Pipeline` and `customer_id = null` so activated existing customers are not double-counted.

## Driver model

```
Forecast Net Billing =
  Forecast Billable Volume × Forecast Avg Base Rate
  + Expected Surcharges
  − Expected Credits

Forecast Recognized ≈ Forecast Net Billing × 0.98
(pipeline recognized uses 0.90 to reflect activation lag)
```

For complex contracts, historical rating from the rate-card engine informs the baseline average rate per customer before scenario adjustments.

## Scenarios

| Scenario | Volume | Rate | Churn | Credits |
|---|---|---|---|---|
| Base | 0% | 0% | 2% | 3% |
| Upside | +8% | +3% | 1% | 2.5% |
| Downside | −10% | −3% | 6% | 4.5% |

Sliders adjust relative to the selected scenario baseline and recompute all dependent views live.

## Accuracy metrics

- MAE, RMSE, Bias — undefined only if no points
- WAPE — `null` when `sum(|Actual|) = 0` (never Infinity/NaN)

## Revenue at Risk caveat

Assumed loss probabilities are **scenario bands** from health scores, not empirically calibrated churn probabilities.
