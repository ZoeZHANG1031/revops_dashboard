import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppShell } from '@/components/layout/AppShell'
import { AppProvider } from '@/context/AppContext'
import { CompanyOverview } from '@/pages/CompanyOverview'
import { CustomerIntelligence } from '@/pages/CustomerIntelligence'
import { ExecutiveOverview } from '@/pages/ExecutiveOverview'
import { RevenueForecasting } from '@/pages/RevenueForecasting'
import { RevenueLifecycle } from '@/pages/RevenueLifecycle'
import { RevenueReconciliation } from '@/pages/RevenueReconciliation'
import { UnitEconomics } from '@/pages/UnitEconomics'

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
            <Route path="/" element={<CompanyOverview />} />
            <Route path="/executive" element={<ExecutiveOverview />} />
            <Route path="/lifecycle" element={<RevenueLifecycle />} />
            <Route path="/reconciliation" element={<RevenueReconciliation />} />
            <Route path="/forecasting" element={<RevenueForecasting />} />
            <Route path="/customers" element={<CustomerIntelligence />} />
            <Route path="/unit-economics" element={<UnitEconomics />} />
          </Route>
        </Routes>
      </AppProvider>
    </MemoryRouter>,
  )
}

describe('page render smoke', { timeout: 120000 }, () => {
  it.each([
    ['/', 'How the Business Works'],
    ['/executive', 'Action Priority'],
    ['/lifecycle', 'Operational Revenue Lifecycle'],
    ['/reconciliation', 'Reconciliation Status'],
    ['/forecasting', 'Scenario Comparison'],
    ['/customers', 'Customer Portfolio Risk Matrix'],
    ['/unit-economics', 'Unit Stack by Dimension'],
  ])('%s renders', (path, heading) => {
    renderAt(path)
    expect(screen.getAllByText(heading).length).toBeGreaterThan(0)
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

  it('path 3: Forecasting → customer variance → Customer 360', () => {
    renderAt('/forecasting')
    const card = screen.getAllByText('Forecast Variance by Customer')[0].closest('section')!
    const row = card.querySelector('tbody tr')!
    fireEvent.click(row)
    expect(document.querySelector('#customer-360 h3')?.textContent).toMatch(/^Customer 360 · /)
    expect(screen.getByText('Revenue Traceability')).toBeTruthy()
  })

  it('cross-page jump records a restorable path', () => {
    renderAt('/executive')
    fireEvent.click(screen.getByText('Billing / Leakage Risk'))
    expect(screen.getByText('← Back')).toBeTruthy()
    fireEvent.click(screen.getByText('← Back'))
    expect(screen.getAllByText('Action Priority').length).toBeGreaterThan(0)
  })
})
