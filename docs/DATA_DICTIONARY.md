# Data Dictionary

All tables are synthetic (`synthetic: true`). Seed: `20241105`.

## Dimension tables

| Table | Key | Description |
|---|---|---|
| `dim_customer` | `customer_id` | 20 active shippers across 5 US regions / 3 segments |
| `dim_contract` | `contract_id` | Active commercial agreement per customer |
| `dim_rate_card` | `rate_card_id` | Versioned prices by service × region with effective dates |
| `dim_region` | `region` | Northeast, Southeast, Midwest, Southwest, West |
| `dim_service` | `service_type` | Standard, Express, SameDay, Economy |
| `dim_date` | `date_key` | 12 month-start keys Nov 2024 – Oct 2025 |

## Fact tables

| Table | Grain | Join keys |
|---|---|---|
| `fact_opportunity` | Opportunity | `customer_id` (nullable for prospects) |
| `fact_shipment` | Package | `customer_id`, `contract_id`, `ship_date` |
| `fact_billing_line` | Rated charge | `shipment_id`, `invoice_id`, `rate_card_id`, `accounting_period` |
| `fact_invoice` | Customer-period invoice | `customer_id`, `accounting_period` |
| `fact_credit_memo` | Credit | `invoice_id`, `shipment_id` |
| `fact_payment` | Cash receipt | `invoice_id`, `customer_id` |
| `fact_revenue_recognition` | Header + detail | Header: `billing_line_id IS NULL`; detail links shipment/billing |
| `fact_general_ledger` | Journal line | `rev_rec_id`, `invoice_id`, `account_code` |
| `fact_cost` | Cost event | `shipment_id` (nullable for allocated fixed), `cost_type` |
| `fact_forecast` | Customer-period-scenario | `customer_id` (null for pipeline), `scenario`, `forecast_type` |
| `fact_exception` | Detected anomaly | Optional `shipment_id` / `invoice_id` / `billing_line_id` |

## Metric separation

| Concept | Source |
|---|---|
| Bookings | Closed-won `fact_opportunity.opportunity_value` |
| Billings | Non-duplicate `fact_billing_line.net_amount` |
| Recognized revenue | Header `fact_revenue_recognition` (`billing_line_id` null) |
| Cash collections | `fact_payment.amount` |
