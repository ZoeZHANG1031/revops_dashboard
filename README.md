# Last-Mile Revenue Operations Intelligence Dashboard V2

Interactive **synthetic** revenue operations dashboard for a US last-mile logistics business (similar in *process* to carriers like Jitsu, but **not** using any real internal data).

## Quick start

```bash
npm install
npm run dev
```

Open the URL printed by Vite (typically `http://localhost:5173`).

```bash
npm test      # automated reconciliation & consistency tests
npm run build # production build
```

No paid APIs, databases, or external keys are required.

## What this answers

1. Where does revenue come from?
2. How do contracts become shipments and billings?
3. How do billings reconcile to finance / GL?
4. Why does actual differ from forecast?
5. Which customers are at risk?
6. What is contribution profit per package — and why can volume rise while profit falls?

## Pages

| Route | Page |
|---|---|
| `/` | Company Overview (default home) |
| `/executive` | Executive Overview |
| `/lifecycle` | Revenue Lifecycle & Traceability |
| `/reconciliation` | Cross-system Reconciliation |
| `/forecasting` | Driver-based Forecasting + Scenarios |
| `/customers` | Customer Intelligence & Health |
| `/unit-economics` | Unit Economics & Profitability |

Global filters (date range, customer, region, service, scenario, snapshot) apply across pages.

## Architecture

- **React + TypeScript + Vite + Tailwind CSS + Recharts**
- Single synthetic data store (`src/data/generate.ts`) with fixed seed `20241105`
- Shared calc modules under `src/calc/` (never hardcode KPIs in page components)
- Decimal-safe money helpers via `decimal.js`

## Documentation

- [Metric Dictionary](docs/METRIC_DICTIONARY.md) *(canonical KPI registry)*
- [Data Lineage](docs/DATA_LINEAGE.md)
- [Validation Report](docs/VALIDATION_REPORT.md)
- [Change Log V2](docs/CHANGELOG_V2.md)
- [Data Dictionary](docs/DATA_DICTIONARY.md)
- [KPI Formulas](docs/KPI_FORMULAS.md)
- [Reconciliation Methodology](docs/RECONCILIATION_METHODOLOGY.md)
- [Forecasting Methodology](docs/FORECASTING_METHODOLOGY.md)
- [Architecture & Design Decisions](docs/ARCHITECTURE.md)

## Disclaimer

All figures are **Synthetic Data** for product demonstration and training. They are not affiliated with, sourced from, or representative of any real carrier’s financials.
