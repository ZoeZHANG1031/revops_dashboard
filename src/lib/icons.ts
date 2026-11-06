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
  ListTodo,
  MapPinned,
  Package,
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
  '/': { path: '/', label: 'Company Overview', icon: Building2, question: 'How big are we, where do we operate, and what drives revenue?' },
  '/executive': { path: '/executive', label: 'Executive Overview', icon: LayoutDashboard, question: 'Are we on plan — and what needs action this week?' },
  '/lifecycle': { path: '/lifecycle', label: 'Revenue Lifecycle', icon: Workflow, question: 'Where does value stall between contract and cash?' },
  '/reconciliation': { path: '/reconciliation', label: 'Reconciliation', icon: Scale, question: 'Do expected charges, billing and revenue agree — and why not?' },
  '/forecasting': { path: '/forecasting', label: 'Forecasting', icon: ChartNoAxesCombined, question: 'Are actuals tracking forecast, and how wide is the scenario range?' },
  '/customers': { path: '/customers', label: 'Customer Intelligence', icon: UsersRound, question: 'Which customers create value — and which put revenue at risk?' },
  '/unit-economics': { path: '/unit-economics', label: 'Unit Economics', icon: Wallet, question: 'What do we earn per package, and where does margin leak?' },
}

export const PAGE_ORDER = ['/', '/executive', '/lifecycle', '/reconciliation', '/forecasting', '/customers', '/unit-economics']

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
