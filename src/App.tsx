import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { AppProvider } from '@/context/AppContext'
import { CompanyOverview } from '@/pages/CompanyOverview'
import { ActionCenterPage } from '@/pages/ActionCenter'
import { AdHocAnalysis } from '@/pages/AdHocAnalysis'
import { CollectionsAR } from '@/pages/CollectionsAR'
import { Customer360 } from '@/pages/Customer360'
import { CustomerGrowth } from '@/pages/CustomerGrowth'
import { CustomerIntelligence } from '@/pages/CustomerIntelligence'
import { CustomerRiskRetention } from '@/pages/CustomerRiskRetention'
import { ExecutiveOverview } from '@/pages/ExecutiveOverview'
import { RevenueForecasting } from '@/pages/RevenueForecasting'
import { RevenueLifecycle } from '@/pages/RevenueLifecycle'
import { RevenueReconciliation } from '@/pages/RevenueReconciliation'
import { UnitEconomics } from '@/pages/UnitEconomics'
import { SalesCompensation } from '@/pages/SalesCompensation'

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/executive" replace />} />

            {/* 01 Business Overview */}
            <Route path="/company" element={<CompanyOverview />} />
            <Route path="/executive" element={<ExecutiveOverview />} />

            {/* 02 Revenue Operations */}
            <Route path="/pipeline" element={<RevenueLifecycle pageFocus="pipeline" />} />
            <Route path="/lifecycle" element={<RevenueLifecycle pageFocus="lifecycle" />} />
            <Route path="/reconciliation" element={<RevenueReconciliation />} />
            <Route path="/collections" element={<CollectionsAR />} />

            {/* 03 Forecasting & Planning */}
            <Route path="/forecasting" element={<RevenueForecasting focus="outlook" />} />
            <Route path="/forecasting/scenarios" element={<RevenueForecasting focus="scenarios" />} />
            <Route path="/forecasting/accuracy" element={<RevenueForecasting focus="accuracy" />} />
            <Route path="/forecasting/gap" element={<RevenueForecasting focus="gap" />} />

            {/* 04 Customer Intelligence */}
            <Route path="/customers" element={<CustomerIntelligence />} />
            <Route path="/customer-360" element={<Customer360 />} />
            <Route path="/customers/risk" element={<CustomerRiskRetention />} />
            <Route path="/customers/growth" element={<CustomerGrowth />} />

            {/* 05 Profitability */}
            <Route
              path="/profitability/unit"
              element={<UnitEconomics focusDim="service" pagePath="/profitability/unit" />}
            />
            <Route
              path="/profitability/customer"
              element={<UnitEconomics focusDim="customer" pagePath="/profitability/customer" />}
            />
            <Route
              path="/profitability/network"
              element={<UnitEconomics focusDim="metro" pagePath="/profitability/network" />}
            />

            {/* 06 Sales Compensation */}
            <Route path="/sales-compensation" element={<SalesCompensation initialSection="overview" />} />
            <Route
              path="/sales-compensation/audit"
              element={<SalesCompensation initialSection="audit" />}
            />
            <Route
              path="/sales-compensation/simulator"
              element={<SalesCompensation initialSection="simulator" />}
            />

            {/* 07 Action & Insights */}
            <Route path="/actions" element={<ActionCenterPage />} />
            <Route path="/adhoc" element={<AdHocAnalysis />} />

            {/* Legacy redirects */}
            <Route path="/unit-economics" element={<Navigate to="/profitability/unit" replace />} />
            <Route path="/revenue/flow" element={<Navigate to="/lifecycle" replace />} />
            <Route path="/revenue/billing" element={<Navigate to="/reconciliation" replace />} />
            <Route path="/revenue/profitability" element={<Navigate to="/profitability/unit" replace />} />
            <Route path="/compensation" element={<Navigate to="/sales-compensation" replace />} />

            <Route path="*" element={<Navigate to="/executive" replace />} />
          </Route>
        </Routes>
      </AppProvider>
    </BrowserRouter>
  )
}
