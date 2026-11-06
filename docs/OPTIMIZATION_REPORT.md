# Last-Mile RevOps Dashboard — Optimization Delivery Report

Date: 2026-11-05 · Synthetic seed `20241105`

## 1. Change Summary

### Critical fixes (Phase 1)
- **Service Mix shares**: Shares now always use parent comparison scope (all services × same date/customer/region/metro). Service filter no longer shrinks the denominator (root cause of >100% / ~220% Y-axis). Chart uses horizontal bars with `domain={[0,100]}`.
- **Company Total vs Selected Scope**: Primary KPI labels distinguish Selected Active Customers; comparison table shows Company / Selected / Share for customers, shipments, Net Billing only (no bogus Margin share).
- **Duplicate Billing**: New `assessDuplicateBilling` classifies Exact Duplicate / Potential / Legitimate Multi-Charge. DQ Monitor counts exact flagged clones and Confirmed Exposure only; Investigate → Reconciliation with `exceptionType=Duplicate Billing`.
- **Metro filter**: `GlobalFilters.metros` added end-to-end (URL, filter bar, shipment/billing/cost filters with indexed metro join).
- **Clear Selection / Clear Filters / Reset View**: Separated — Selection clears highlight/drawer/local exception focus; Clear Filters restores defaults; Reset View resets page-local chart toggles only.

### Navigation & context (Phase 2)
- `navigateWithContext` extended with metro, sourcePage, investigation steps, toast feedback.
- `InvestigationBreadcrumb` under global filters (context chips + dismissible feedback).
- KPI / insight / metro / DQ rows pass real context into Lifecycle, Reconciliation, Unit Economics, Customers, Forecasting, Executive.

### Readability (Phase 3)
- Company Overview: Primary vs Secondary KPI hierarchy, ranked Insights (top 3 + View All), Analysis Summary (What/Why/Impact/Next), Service Mix parent-scope note.

### Guided Investigation (Phase 4)
- `Explore Business Questions` on Company Overview with four optional paths and step progress.

### Tests (Phase 5)
- `serviceMix.test.ts`, `duplicateBilling.test.ts`, `scopeConsistency.test.ts` (+ existing company overview suite).

---

## 2. Navigation Map

| Source | Trigger | Destination | Context Passed |
|---|---|---|---|
| Company Overview | Active Customers KPI | `/customers` | Date, region, metro, service, scenario |
| Company Overview | Net Billing → Trace Billing | `/lifecycle` | Global filters + toast |
| Company Overview | Recognized Revenue | `/lifecycle` | Global filters |
| Company Overview | Total Shipments | `/executive` | Global filters |
| Company Overview | Contribution Margin | `/unit-economics` or `/forecasting` | Global filters |
| Company Overview | DSP Partners | `/unit-economics` | Global filters |
| Company Overview | Metro map / table | `/unit-economics` (+ Analyze Revenue/Cost/Customers) | Region + Metro |
| Company Overview | Customer row | `/customers` | customerId + entity drawer |
| Company Overview | Service Mix bar | `/unit-economics` | serviceType (parent mix retained in chart) |
| Company Overview | Insight Next Step | Path per insight | Filter extras + toast |
| Company Overview | DQ Investigate | `/reconciliation` etc. | exceptionType when duplicate |
| Guided Q1 | Start / Next | `/executive` → `/lifecycle` → `/customers` | guide id + steps |
| Guided Q2 | Start / Next | `/` → `/unit-economics` → `/forecasting` | metro if set |
| Guided Q3 | Start / Next | `/lifecycle` → `/reconciliation` | Duplicate Billing focus |
| Guided Q4 | Start / Next | `/` → `/customers` | concentration → health |

---

## 3. Metric Validation Report

| Metric | Definition | Source | Formula | Test |
|---|---|---|---|---|
| Active Customers (Selected) | Distinct customers with ≥1 shipment or non-dup billing line in filter | shipments + billing | Set cardinality | scopeConsistency ✓ |
| Company Active Customers | Same definition with business filters cleared | emptyFilters() | Set cardinality | companyOverview ✓ |
| Net Billing | Sum net_amount | billing lines `is_duplicate=false` | SUM | shared metrics ✓ |
| Recognized Revenue | Recognition records / allocated detail | recognition calc | computeRecognizedRevenue | companyOverview ✓ |
| Service Mix Share | Service ÷ all services in parent scope | billing / shipments | pct(num, parentTot) | serviceMix ✓ (sum ≈100%, ≤100%) |
| Contribution Margin | (Net Billing − Var Cost) / Net Billing | billing + costs | pct | unit economics aligned |
| Exact Duplicate Exposure | Flagged clone net_amount | assessDuplicateBilling | SUM exact clones | duplicateBilling ✓ |

---

## 4. Bug Fix Report

### Service Mix >100%
- **Root cause**: When Service=Economy, numerators used each service type but denominator was Economy-only Net Billing → Standard/Economy/… shares could exceed 100% and sum ≫100%.
- **Fix**: Parent filters clear `serviceTypes` for mix denominators; selected service shown separately; Y-axis clamped 0–100.

### Active Customers scope confusion
- **Root cause**: KPI label did not state Selected vs Company; metro was only applied as region, so Selected often looked like Company.
- **Fix**: Explicit Selected Active Customers label + comparison table; true metro filter on shipments/billing/costs.

### Duplicate Billing
- **Root cause**: DQ counted all `is_duplicate` lines in period without classification; Investigate did not open detail path.
- **Fix**: Fingerprint-based Exact Duplicate; Confirmed Exposure = clone amounts only; Investigate wires exception type.

### Other
- Metro filter join used per-row `Array.find` → pathological slowness; replaced with Map index when metros active.

---

## 5. Test Results

| Suite | Result |
|---|---|
| companyOverview.test.ts | Passed |
| serviceMix.test.ts | Passed |
| duplicateBilling.test.ts | Passed |
| scopeConsistency.test.ts | Passed |
| `tsc --noEmit` | Passed |
| Full vitest (other files) | Not re-run in this pass |
| Responsive layout visual QA | Not automated |

---

## 6. Remaining Limitations

- Synthetic Health Score / Revenue at Risk remain assumption-based — not calibrated churn probabilities.
- Legitimate multi-charge lines are rare in the generator (usually one net line + optional clone); classification is ready for richer charge types.
- Guided Investigation advances steps but does not auto-scroll to in-page anchors (e.g. PVM section) — page-level context only.
- Forecast scenario sliders inherit filters; DSP CPP / redelivery knobs still use existing Forecasting controls.
- Contribution share can deviate slightly from 100% when contribution is near zero / sign-mixed — chart still clamps axis; note shown under chart.
- Real billing systems may need Charge Event ID in the uniqueness key beyond the synthetic fingerprint.
