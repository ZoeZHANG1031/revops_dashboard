# Data Lineage

## Commercial path

Customer → Opportunity (+ stage events) → Contract → Rate Card (versioned)

## Operational → financial path

Shipment (operational_status, metro, OTD flags)
→ Charge eligibility (`billable`)
→ Rated / Billing Line (rate_card_id, effective version by ship_date)
→ Invoice (+ Credit Memo)
→ Revenue Recognition header (`billing_line_id` null) + detail rows
→ General Ledger (account 4000 / 1100)
→ Payment → Cash / AR aging

## Cost path

Shipment → DSP / Sorting / Linehaul / Redelivery / Claims (variable)
Company Fixed Pool → Allocated Fixed by volume share (customer × period)

## Forecast path

Existing: customer × period × scenario  
Pipeline: period × scenario (`customer_id` null) — never double-counts activated logos

## Join caution

Revenue KPIs use **header** rev-rec only. Detail rows are for traceability and must not be summed with headers.
Duplicate billing lines are flagged `is_duplicate=true` and excluded from Net Billings.
