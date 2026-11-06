import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { AppProvider } from '@/context/AppContext'
import { CompanyOverview } from '@/pages/CompanyOverview'
import { Customer360 } from '@/pages/Customer360'
import { CustomerIntelligence } from '@/pages/CustomerIntelligence'
import { ExecutiveOverview } from '@/pages/ExecutiveOverview'
import { RevenueForecasting } from '@/pages/RevenueForecasting'
import { RevenueLifecycle } from '@/pages/RevenueLifecycle'
import { RevenueReconciliation } from '@/pages/RevenueReconciliation'
import { UnitEconomics } from '@/pages/UnitEconomics'

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<CompanyOverview />} />
            <Route path="/executive" element={<ExecutiveOverview />} />
            <Route path="/lifecycle" element={<RevenueLifecycle />} />
            <Route path="/reconciliation" element={<RevenueReconciliation />} />
            <Route path="/forecasting" element={<RevenueForecasting />} />
            <Route path="/customers" element={<CustomerIntelligence />} />
            <Route path="/customer-360" element={<Customer360 />} />
            <Route path="/unit-economics" element={<UnitEconomics />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AppProvider>
    </BrowserRouter>
  )
}
