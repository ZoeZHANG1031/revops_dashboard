# Change Log — Revenue Intelligence V2 Optimization

## Fixed / corrected

- Fixed opex pool scaled from $420k → $9k Base (Downside $42k) after audit
- Exposure naming: Open Recoverable Leakage ≠ Unbilled ≠ Scenario RaR ≠ Overdue AR
- Action Center default = root-cause rollup (not hundreds of duplicate Missing Billing rows)
- Sales cohort conversions from stage events (not stock ratios)
- Unit Economics title now data-driven (no false “Volume Up, Profit Down”)
- Reconciliation dollar bridge decomposes variance (discounts, credits, timing, leakage…)
- Forecast bridge residual labeled when Other is large
- Customer Health scoring more discriminating + bands + confidence

## Added

- `metricRegistry.ts` / `computeSharedMetrics`
- `reconBridge.ts`, `actionRollup.ts`, `salesCohort.ts`
- Opportunity stage events in synthetic generator
- Docs: METRIC_DICTIONARY, DATA_LINEAGE, VALIDATION_REPORT
- `integrity.test.ts`

## UI

- Compact Executive Decision Brief
- KPI priority reorder on Executive Overview
- Fixed cost Base/Downside toggle on Unit Economics
