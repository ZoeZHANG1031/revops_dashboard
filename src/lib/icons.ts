import {
  BadgeDollarSign,
  Building2,
  ChartColumnIncreasing,
  ChartNoAxesCombined,
  ChartPie,
  DatabaseZap,
  FileWarning,
  GitBranch,
  HandCoins,
  HeartPulse,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  MapPinned,
  Package,
  Percent,
  Receipt,
  Route,
  Scale,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  Truck,
  Users,
  UsersRound,
  Wallet,
  Workflow,
  type LucideIcon,
} from 'lucide-react'

export interface PageMeta {
  path: string
  label: string
  icon: LucideIcon
  /** The page's core business question */
  question: string
}

/** One icon per page — used by sidebar, page header, breadcrumbs and drill-down links */
export const PAGE_META: Record<string, PageMeta> = {
  '/': {
    path: '/',
    label: 'Company Overview',
    icon: Building2,
    question: 'How big are we, where do we operate, and what drives revenue?',
  },
  '/company': {
    path: '/company',
    label: 'Company Overview',
    icon: Building2,
    question: 'How big are we, where do we operate, and what drives revenue?',
  },
  '/executive': {
    path: '/executive',
    label: 'Executive Command Center',
    icon: LayoutDashboard,
    question: 'Are we on plan — and what needs action this week?',
  },
  '/pipeline': {
    path: '/pipeline',
    label: 'Sales Pipeline',
    icon: GitBranch,
    question: 'Where does commercial pipeline sit — and what is converting?',
  },
  '/lifecycle': {
    path: '/lifecycle',
    label: 'Revenue Lifecycle',
    icon: Workflow,
    question: 'Where does value stall between contract and cash?',
  },
  '/reconciliation': {
    path: '/reconciliation',
    label: 'Billing & Reconciliation',
    icon: Scale,
    question: 'Do expected charges, billing and revenue agree — and why not?',
  },
  '/collections': {
    path: '/collections',
    label: 'Collections & AR',
    icon: HandCoins,
    question: 'How much cash did we collect — and what AR is overdue?',
  },
  '/forecasting': {
    path: '/forecasting',
    label: 'Revenue Forecast',
    icon: ChartNoAxesCombined,
    question: 'How much revenue can we expect, and will we meet our target?',
  },
  '/forecasting/scenarios': {
    path: '/forecasting/scenarios',
    label: 'Scenario Planning',
    icon: SlidersHorizontal,
    question: 'If drivers change, how do revenue and margin shift?',
  },
  '/forecasting/accuracy': {
    path: '/forecasting/accuracy',
    label: 'Forecast Accuracy',
    icon: Target,
    question: 'How accurate were past forecasts — and where did error come from?',
  },
  '/forecasting/gap': {
    path: '/forecasting/gap',
    label: 'Revenue Gap Analysis',
    icon: TrendingUp,
    question: 'Where does Forecast vs Target gap come from — and what closes it?',
  },
  '/customers': {
    path: '/customers',
    label: 'Client Quality',
    icon: UsersRound,
    question: 'Which clients need attention — and what is driving deterioration?',
  },
  '/customer-360': {
    path: '/customer-360',
    label: 'Client 360',
    icon: Users,
    question: 'What is happening inside this one customer account?',
  },
  '/customers/risk': {
    path: '/customers/risk',
    label: 'Risk & Retention',
    icon: ShieldAlert,
    question: 'Which customers are at risk of churn — and why?',
  },
  '/customers/growth': {
    path: '/customers/growth',
    label: 'Growth Opportunities',
    icon: Sparkles,
    question: 'Which existing customers have expansion potential?',
  },
  '/unit-economics': {
    path: '/unit-economics',
    label: 'Unit Economics',
    icon: Wallet,
    question: 'What do we earn per package, and where does margin leak?',
  },
  '/profitability/unit': {
    path: '/profitability/unit',
    label: 'Unit Economics',
    icon: Wallet,
    question: 'What do we earn per package, and where does margin leak?',
  },
  '/profitability/customer': {
    path: '/profitability/customer',
    label: 'Customer Profitability',
    icon: ChartPie,
    question: 'Which customers create contribution profit — and which compress margin?',
  },
  '/profitability/network': {
    path: '/profitability/network',
    label: 'Network Profitability',
    icon: MapPinned,
    question: 'Which metros, stations and services are profitable?',
  },
  '/sales-compensation': {
    path: '/sales-compensation',
    label: 'Commission Overview',
    icon: Percent,
    question: 'What commission was earned, approved and paid — vs quota?',
  },
  '/sales-compensation/audit': {
    path: '/sales-compensation/audit',
    label: 'Commission Audit',
    icon: FileWarning,
    question: 'Do calculated commissions match expected rules and payouts?',
  },
  '/sales-compensation/simulator': {
    path: '/sales-compensation/simulator',
    label: 'Plan Simulator',
    icon: SlidersHorizontal,
    question: 'How would plan changes affect payout and company cost?',
  },
  '/actions': {
    path: '/actions',
    label: 'Action Center',
    icon: ListChecks,
    question: 'What should we do next — and who owns it?',
  },
  '/adhoc': {
    path: '/adhoc',
    label: 'Ad-hoc Analysis',
    icon: DatabaseZap,
    question: 'What temporary cut of the data do I need for research?',
  },
}

export const PAGE_ORDER = [
  '/executive',
  '/company',
  '/pipeline',
  '/lifecycle',
  '/reconciliation',
  '/collections',
  '/forecasting',
  '/forecasting/scenarios',
  '/forecasting/accuracy',
  '/forecasting/gap',
  '/customers',
  '/customer-360',
  '/customers/risk',
  '/customers/growth',
  '/profitability/unit',
  '/profitability/customer',
  '/profitability/network',
  '/sales-compensation',
  '/sales-compensation/audit',
  '/sales-compensation/simulator',
  '/actions',
  '/adhoc',
  '/unit-economics',
  '/',
]

export type NavItem = { path: string; label: string; icon: LucideIcon; question?: string }
export type NavModule = { id: string; label: string; icon: LucideIcon; path?: string; children?: NavItem[] }

function navItem(path: string): NavItem {
  const m = PAGE_META[path]
  return { path, label: m.label, icon: m.icon, question: m.question }
}

/**
 * Level-1 Business Modules → Level-2 Analysis Pages
 * IA: Monitor → Diagnose → Forecast → Act
 */
export const NAV_MODULES: NavModule[] = [
  {
    id: 'business-overview',
    label: 'Business Overview',
    icon: Building2,
    children: [navItem('/company'), navItem('/executive')],
  },
  {
    id: 'revenue-operations',
    label: 'Revenue Operations',
    icon: BadgeDollarSign,
    children: [
      navItem('/pipeline'),
      navItem('/lifecycle'),
      navItem('/reconciliation'),
      navItem('/collections'),
    ],
  },
  {
    id: 'forecasting',
    label: 'Forecasting & Planning',
    icon: ChartNoAxesCombined,
    children: [
      navItem('/forecasting'),
      navItem('/forecasting/scenarios'),
      navItem('/forecasting/accuracy'),
      navItem('/forecasting/gap'),
    ],
  },
  {
    id: 'customer-intelligence',
    label: 'Customer Intelligence',
    icon: UsersRound,
    children: [
      navItem('/customers'),
      navItem('/customer-360'),
      navItem('/customers/risk'),
      navItem('/customers/growth'),
    ],
  },
  {
    id: 'profitability',
    label: 'Profitability',
    icon: Wallet,
    children: [
      navItem('/profitability/unit'),
      navItem('/profitability/customer'),
      navItem('/profitability/network'),
    ],
  },
  {
    id: 'sales-compensation',
    label: 'Sales Compensation',
    icon: Percent,
    children: [
      navItem('/sales-compensation'),
      navItem('/sales-compensation/audit'),
      navItem('/sales-compensation/simulator'),
    ],
  },
  {
    id: 'action-insights',
    label: 'Action & Insights',
    icon: ListChecks,
    children: [navItem('/actions'), navItem('/adhoc')],
  },
]

export const REVENUE_OPS_NAV: NavItem[] =
  NAV_MODULES.find((m) => m.id === 'revenue-operations')?.children ?? []
export const FORECASTING_NAV: NavItem[] =
  NAV_MODULES.find((m) => m.id === 'forecasting')?.children ?? []
export const CUSTOMER_NAV: NavItem[] =
  NAV_MODULES.find((m) => m.id === 'customer-intelligence')?.children ?? []
export const PROFITABILITY_NAV: NavItem[] =
  NAV_MODULES.find((m) => m.id === 'profitability')?.children ?? []
export const COMPENSATION_NAV: NavItem[] =
  NAV_MODULES.find((m) => m.id === 'sales-compensation')?.children ?? []
export const ACTION_NAV: NavItem[] =
  NAV_MODULES.find((m) => m.id === 'action-insights')?.children ?? []

/** @deprecated use REVENUE_OPS_NAV */
export const REVENUE_PERFORMANCE_NAV: NavItem[] = REVENUE_OPS_NAV

export function pageMeta(path: string): PageMeta | undefined {
  return PAGE_META[path]
}

export function moduleForPath(pathname: string): NavModule | undefined {
  return NAV_MODULES.find(
    (m) =>
      m.path === pathname ||
      m.children?.some((c) => c.path === pathname || pathname.startsWith(c.path + '/')),
  )
}

/** Module icons — each maps to one business concept only */
export const MODULE_ICONS = {
  revenue: BadgeDollarSign,
  customers: Users,
  shipments: Package,
  delivery: Truck,
  geography: MapPinned,
  salesPipeline: GitBranch,
  billing: Receipt,
  reconciliation: Scale,
  collections: HandCoins,
  forecast: TrendingUp,
  scenario: SlidersHorizontal,
  accuracy: Target,
  health: HeartPulse,
  risk: ShieldAlert,
  costBreakdown: ChartPie,
  contribution: ChartColumnIncreasing,
  dataQuality: DatabaseZap,
  exceptions: FileWarning,
  traceability: Route,
  actions: ListTodo,
} satisfies Record<string, LucideIcon>

export type ModuleIconKey = keyof typeof MODULE_ICONS

/** Semantic chart palette — business type vs status are separate */
export const PALETTE = {
  brand: '#123C35',
  brandMid: '#2E6B5E',
  positive: '#00A86B',
  forecast: '#2F6FDB',
  forecastLight: '#9DBDF2',
  watch: '#E58A2B',
  critical: '#C44536',
  segment: ['#5B3E96', '#8B6BC7', '#C9B8EA'],
  cost: '#8A9A93',
  costDark: '#5F6F68',
  muted: '#A8B5AF',
  grid: '#dce6df',
} as const
