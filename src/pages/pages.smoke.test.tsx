import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
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
import { SalesCompensation } from '@/pages/SalesCompensation'
import { ActionCenterPage } from '@/pages/ActionCenter'
import { CollectionsAR } from '@/pages/CollectionsAR'
import { CustomerRiskRetention } from '@/pages/CustomerRiskRetention'
import { CustomerGrowth } from '@/pages/CustomerGrowth'
import { AdHocAnalysis } from '@/pages/AdHocAnalysis'

// jsdom lacks ResizeObserver (used by Recharts ResponsiveContainer)
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/executive" replace />} />
            <Route path="/company" element={<CompanyOverview />} />
            <Route path="/executive" element={<ExecutiveOverview />} />
            <Route path="/pipeline" element={<RevenueLifecycle pageFocus="pipeline" />} />
            <Route path="/lifecycle" element={<RevenueLifecycle pageFocus="lifecycle" />} />
            <Route path="/reconciliation" element={<RevenueReconciliation />} />
            <Route path="/collections" element={<CollectionsAR />} />
            <Route path="/forecasting" element={<RevenueForecasting focus="outlook" />} />
            <Route path="/forecasting/scenarios" element={<RevenueForecasting focus="scenarios" />} />
            <Route path="/forecasting/accuracy" element={<RevenueForecasting focus="accuracy" />} />
            <Route path="/forecasting/gap" element={<RevenueForecasting focus="gap" />} />
            <Route path="/customers" element={<CustomerIntelligence />} />
            <Route path="/customer-360" element={<Customer360 />} />
            <Route path="/customers/risk" element={<CustomerRiskRetention />} />
            <Route path="/customers/growth" element={<CustomerGrowth />} />
            <Route path="/profitability/unit" element={<UnitEconomics focusDim="service" pagePath="/profitability/unit" />} />
            <Route path="/profitability/customer" element={<UnitEconomics focusDim="customer" pagePath="/profitability/customer" />} />
            <Route path="/profitability/network" element={<UnitEconomics focusDim="metro" pagePath="/profitability/network" />} />
            <Route path="/unit-economics" element={<Navigate to="/profitability/unit" replace />} />
            <Route path="/sales-compensation" element={<SalesCompensation initialSection="overview" />} />
            <Route path="/sales-compensation/audit" element={<SalesCompensation initialSection="audit" />} />
            <Route
              path="/sales-compensation/simulator"
              element={<SalesCompensation initialSection="simulator" />}
            />
            <Route path="/actions" element={<ActionCenterPage />} />
            <Route path="/adhoc" element={<AdHocAnalysis />} />
          </Route>
        </Routes>
      </AppProvider>
    </MemoryRouter>,
  )
}

describe('page render smoke', { timeout: 120000 }, () => {
  it.each([
    ['/company', 'How the Business Works'],
    ['/executive', 'Action Priority'],
    ['/pipeline', 'Commercial Pipeline · Lead → Closed Won'],
    ['/lifecycle', 'Operational Revenue Lifecycle'],
    ['/reconciliation', 'Reconciliation Status'],
    ['/collections', 'AR Aging'],
    ['/forecasting', 'Revenue Forecast Trend'],
    ['/forecasting/scenarios', 'Scenario Drivers'],
    ['/forecasting/gap', 'What Would Close the Gap?'],
    ['/customers', 'Customer Portfolio Risk Matrix'],
    ['/customers/risk', 'At-Risk & Critical Customers'],
    ['/customers/growth', 'Growth & Expansion Candidates'],
    ['/profitability/unit', 'Unit Stack by Dimension'],
    ['/sales-compensation', 'Commission Status Breakdown'],
    ['/sales-compensation/audit', 'Commission Transaction Audit'],
    ['/sales-compensation/simulator', 'Proposed Plan Earned Commission'],
    ['/actions', 'Prioritized actions'],
    ['/adhoc', 'Customer contribution cut'],
  ])('%s renders', (path, heading) => {
    renderAt(path)
    expect(screen.getAllByText(heading).length).toBeGreaterThan(0)
  })

  it('root redirects to executive command center', () => {
    renderAt('/')
    expect(screen.getAllByText('Action Priority').length).toBeGreaterThan(0)
  })

  it('legacy unit-economics redirects to profitability/unit', () => {
    renderAt('/unit-economics')
    expect(screen.getAllByText('Unit Stack by Dimension').length).toBeGreaterThan(0)
  })

  it('lifecycle stage click opens detail panel; gap click switches it', () => {
    renderAt('/lifecycle')
    fireEvent.click(screen.getAllByText(/^5\. Recognition$/)[0])
    expect(screen.getByText('Stage detail')).toBeTruthy()
    fireEvent.click(screen.getByText('Overdue AR', { selector: 'span' }))
    expect(screen.getByText('Recognition → Collection')).toBeTruthy()
  })

  it('path 2: Executive → Billing risk → Reconciliation → exception trace → source record', () => {
    renderAt('/executive')
    fireEvent.click(screen.getByText('Billing / Leakage Risk'))
    expect(screen.getAllByText('Exception Detail').length).toBeGreaterThan(0)
    const rows = document.querySelectorAll('table tbody tr')
    const excRow = [...rows].find((r) => /^EXC|^EX-|^E\d/.test(r.textContent ?? '') || (r.textContent ?? '').includes('Missing'))
    expect(excRow).toBeTruthy()
    fireEvent.click(excRow!)
    expect(screen.getByText(/^Trace ·/)).toBeTruthy()
    expect(screen.getByText('Open source record:')).toBeTruthy()
  })
})
