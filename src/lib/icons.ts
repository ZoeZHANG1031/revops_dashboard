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
    label: 'Company & Network Profile',
    icon: Building2,
    question: 'How big are we, where do we operate, and what drives revenue?',
  },
  '/executive': {
    path: '/executive',
    label: 'Executive Command Center',
    icon: LayoutDashboard,
    question: 'Are we on plan — and what needs action this week?',
  },
  '/lifecycle': {
    path: '/lifecycle',
    label: 'Revenue Flow',
    icon: Workflow,
    question: 'Where does value stall between contract and cash?',
  },
  '/reconciliation': {
    path: '/reconciliation',
    label: 'Billing & Reconciliation',
    icon: Scale,
    question: 'Do expected charges, billing and revenue agree — and why not?',
  },
  '/forecasting': {
    path: '/forecasting',
    label: 'Revenue Forecasting',
    icon: ChartNoAxesCombined,
    question: 'What revenue should we expect forward — and where are we off plan?',
  },
  '/customers': {
    path: '/customers',
    label: 'Portfolio',
    icon: UsersRound,
    question: 'Which customers create value — and which put revenue at risk?',
  },
  '/customer-360': {
    path: '/customer-360',
    label: 'Customer 360',
    icon: Users,
    question: 'What is happening inside this one customer account?',
  },
  '/unit-economics': {
    path: '/unit-economics',
    label: 'Profitability',
    icon: Wallet,
    question: 'What do we earn per package, and where does margin leak?',
  },
  '/actions': {
    path: '/actions',
    label: 'Action Center',
    icon: ListChecks,
    question: 'What should we do next — and who owns it?',
  },
  '/sales-compensation': {
    path: '/sales-compensation',
    label: 'Sales Compensation',
    icon: Percent,
    question: 'Are commissions calculated, paid, and auditable — and what if the plan changes?',
  },
}

export const PAGE_ORDER = [
  '/executive',
  '/lifecycle',
  '/reconciliation',
  '/unit-economics',
  '/forecasting',
  '/customers',
  '/customer-360',
  '/sales-compensation',
  '/actions',
  '/company',
  '/',
]

export type NavItem = { path: string; label: string; icon: LucideIcon; question?: string }
export type NavModule = { id: string; label: string; icon: LucideIcon; path?: string; children?: NavItem[] }

function navItem(path: string): NavItem {
  const m = PAGE_META[path]
  return { path, label: m.label, icon: m.icon, question: m.question }
}

export const NAV_MODULES: NavModule[] = [
  { id: 'executive', label: 'Executive Command Center', icon: LayoutDashboard, path: '/executive' },
  {
    id: 'revenue-performance',
    label: 'Revenue Performance',
    icon: BadgeDollarSign,
    children: [navItem('/lifecycle'), navItem('/reconciliation'), navItem('/unit-economics')],
  },
  {
    id: 'customer-intelligence',
    label: 'Customer Intelligence',
    icon: UsersRound,
    path: '/customers',
  },
  { id: 'forecasting', label: 'Revenue Forecasting', icon: ChartNoAxesCombined, path: '/forecasting' },
  { id: 'sales-compensation', label: 'Sales Compensation', icon: Percent, path: '/sales-compensation' },
  { id: 'actions', label: 'Action Center', icon: ListChecks, path: '/actions' },
  { id: 'company', label: 'Company & Network Profile', icon: Building2, path: '/company' },
]

/** Sidebar / module sub-nav: Revenue Performance child routes */
export const REVENUE_PERFORMANCE_NAV: NavItem[] =
  NAV_MODULES.find((m) => m.id === 'revenue-performance')?.children ?? []

export function pageMeta(path: string): PageMeta | undefined {
  return PAGE_META[path]
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
