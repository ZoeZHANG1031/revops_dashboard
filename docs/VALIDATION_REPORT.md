# Validation Report

## Fixed cost audit (critical finding)

| Item | Result |
|---|---|
| Allocation math | Correct — volume share of company monthly pool |
| Prior pool $420k/mo | **Unrealistic** vs ~$28k monthly net billings (~15×) — caused OP ≈ −$1.2M |
| Remediation | Base pool set to **$9,000/mo** (~30% of revenue). Downside stress pool **$42,000/mo** retained as explicit scenario |
| Filter behavior | Customer/region filters receive **share only**, not full company pool |

## Automated tests

- `src/calc/reconciliation.test.ts` — billing↔invoice, rev-rec↔GL, bridges, reproducibility
- `src/calc/integrity.test.ts` — shared metrics, recon bridge, fixed pool scale, health spread, cohort events

## Known limitations / open items

1. **Unexplained Forecast Residual (Other)** can be material — surfaced explicitly; not forced to zero.
2. **Recon unresolved residual** may remain after discounts/credits/missing/rate/surcharge/timing — shown as Unresolved.
3. **Health assumed loss fractions** are scenario bands, not calibrated churn probabilities.
4. **Accrual without invoice** is partially modeled via timing shifts; full accrual subledger not separate.
5. **Rate Calculation Explorer** UI is partially covered via Lifecycle trace + rate card table; dedicated shipment price breakdown panel can be deepened further.
6. Old Vite processes on port 5173 may serve stale UI — use a fresh `npm run dev` port if colors/layout look outdated.
