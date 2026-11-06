import type { DimCustomer, RegionCode, ServiceType } from '@/types'

/**
 * Customer catalog for the synthetic carrier.
 *
 * A handful of publicly known brand names are included ONLY as Illustrative Accounts
 * (illustrative = true). They are not claimed to be customers of any real carrier, and every
 * volume, price, contract, margin and health figure attached to them is synthetic.
 * Set USE_ILLUSTRATIVE_BRANDS = false to replace them with fictional names.
 */
export const USE_ILLUSTRATIVE_BRANDS = true

export type Industry =
  | 'Apparel & Fashion'
  | 'Beauty & Personal Care'
  | 'Consumer Electronics'
  | 'Meal Kits & Grocery'
  | 'Health & Wellness'
  | 'Home Goods'
  | 'Pet Supplies'
  | 'Subscription Commerce'
  | '3PL / Fulfillment'
  | 'General Merchandise'

export type Profile = 'core' | 'growth' | 'new' | 'declining' | 'at_risk' | 'churn' | 'volatile'

export interface CustomerSpec {
  name: string
  industry: Industry
  segment: DimCustomer['segment']
  type: DimCustomer['customer_type']
  illustrative: boolean
  parent?: string
  homeRegion: RegionCode
  profile: Profile
  /** Relative size at full maturity (normalized later so the network hits the volume target) */
  size: number
  /** Downstream merchant brands for 3PL accounts */
  brands?: string[]
}

/** Service mix by industry (shares of packages) */
export const SERVICE_MIX: Record<Industry, Partial<Record<ServiceType, number>>> = {
  'Apparel & Fashion': { Standard: 0.6, Economy: 0.3, Express: 0.1 },
  'Beauty & Personal Care': { Standard: 0.62, Economy: 0.23, Express: 0.15 },
  'Consumer Electronics': { Standard: 0.5, Express: 0.35, SameDay: 0.15 },
  'Meal Kits & Grocery': { Express: 0.55, Standard: 0.3, SameDay: 0.15 },
  'Health & Wellness': { Standard: 0.55, Express: 0.35, SameDay: 0.1 },
  'Home Goods': { Standard: 0.55, Economy: 0.4, Express: 0.05 },
  'Pet Supplies': { Standard: 0.6, Economy: 0.3, Express: 0.1 },
  'Subscription Commerce': { Standard: 0.55, Economy: 0.35, Express: 0.1 },
  '3PL / Fulfillment': { Standard: 0.55, Economy: 0.35, Express: 0.1 },
  'General Merchandise': { Standard: 0.5, Economy: 0.4, Express: 0.1 },
}

/** Monthly demand seasonality by industry (Jan..Dec); Q4 peak, early-year trough */
export function seasonality(industry: Industry, month: number): number {
  const retail = [0.82, 0.8, 0.88, 0.92, 0.95, 0.96, 0.95, 1.0, 1.02, 1.08, 1.32, 1.42]
  const mealKits = [1.1, 1.02, 1.0, 0.97, 0.95, 0.9, 0.88, 0.9, 0.98, 1.02, 1.05, 0.98]
  const steady = [0.92, 0.9, 0.95, 0.97, 0.98, 0.98, 0.97, 1.0, 1.01, 1.04, 1.16, 1.2]
  if (industry === 'Meal Kits & Grocery') return mealKits[month - 1]
  if (industry === 'Health & Wellness' || industry === 'Pet Supplies' || industry === 'Subscription Commerce')
    return steady[month - 1]
  return retail[month - 1]
}

const ILLUSTRATIVE: CustomerSpec[] = [
  { name: 'HelloFresh', industry: 'Meal Kits & Grocery', segment: 'Enterprise', type: 'Direct Shipper', illustrative: true, homeRegion: 'East', profile: 'core', size: 120 },
  { name: 'Daily Harvest', industry: 'Meal Kits & Grocery', segment: 'Mid-Market', type: 'Direct Shipper', illustrative: true, homeRegion: 'East', profile: 'declining', size: 22 },
  { name: 'Crowd Cow', industry: 'Meal Kits & Grocery', segment: 'Mid-Market', type: 'Direct Shipper', illustrative: true, homeRegion: 'West', profile: 'volatile', size: 14 },
  { name: 'American Eagle', industry: 'Apparel & Fashion', segment: 'Enterprise', type: 'Direct Shipper', illustrative: true, homeRegion: 'East', profile: 'growth', size: 95 },
  { name: 'Nespresso', industry: 'Subscription Commerce', segment: 'Enterprise', type: 'Direct Shipper', illustrative: true, homeRegion: 'East', profile: 'core', size: 70 },
  { name: 'ShipHero', industry: '3PL / Fulfillment', segment: 'Enterprise', type: '3PL / Fulfillment', illustrative: true, homeRegion: 'East', profile: 'growth', size: 85, brands: ['Lumen Skin Co.', 'Trailhead Gear', 'Copper Kettle Coffee', 'Nordvik Home'] },
  { name: 'Radial', industry: '3PL / Fulfillment', segment: 'Enterprise', type: '3PL / Fulfillment', illustrative: true, homeRegion: 'Central', profile: 'core', size: 110, brands: ['Halcyon Apparel', 'Brightwave Audio', 'Juniper & Lace', 'Atlas Fitness Co.', 'Pebble Pet Co.'] },
  { name: 'Flexport', industry: '3PL / Fulfillment', segment: 'Enterprise', type: '3PL / Fulfillment', illustrative: true, homeRegion: 'West', profile: 'new', size: 65, brands: ['Solstice Swim', 'Oakline Furniture', 'Verdant Botanics'] },
  { name: 'Ryder', industry: '3PL / Fulfillment', segment: 'Enterprise', type: '3PL / Fulfillment', illustrative: true, homeRegion: 'Central', profile: 'at_risk', size: 60, brands: ['Ironclad Tools', 'Glow Theory Beauty', 'Wildroot Pet'] },
]

/** Fictional accounts — names are invented */
const FICTIONAL: Omit<CustomerSpec, 'illustrative'>[] = [
  // Enterprise
  { name: 'Northwind Retail Group', industry: 'General Merchandise', segment: 'Enterprise', type: 'Direct Shipper', homeRegion: 'East', profile: 'core', size: 100, parent: 'Northwind Holdings' },
  { name: 'Northwind Outlet', industry: 'General Merchandise', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'Central', profile: 'declining', size: 18, parent: 'Northwind Holdings' },
  { name: 'Cascade Apparel Co.', industry: 'Apparel & Fashion', segment: 'Enterprise', type: 'Direct Shipper', homeRegion: 'West', profile: 'core', size: 80 },
  { name: 'Sunbelt Electronics', industry: 'Consumer Electronics', segment: 'Enterprise', type: 'Direct Shipper', homeRegion: 'Central', profile: 'growth', size: 75 },
  { name: 'Pacific Beauty Labs', industry: 'Beauty & Personal Care', segment: 'Enterprise', type: 'Direct Shipper', homeRegion: 'West', profile: 'growth', size: 60 },
  { name: 'Evergreen Wellness', industry: 'Health & Wellness', segment: 'Enterprise', type: 'Direct Shipper', homeRegion: 'West', profile: 'core', size: 55 },
  { name: 'Harborline Fulfillment', industry: '3PL / Fulfillment', segment: 'Enterprise', type: '3PL / Fulfillment', homeRegion: 'East', profile: 'new', size: 70, brands: ['Marlowe Candle Co.', 'Ridgeback Outdoor', 'Petal & Stem', 'Kinfolk Kids'] },
  { name: 'Desert Direct Marketplace', industry: 'General Merchandise', segment: 'Enterprise', type: 'Direct Shipper', homeRegion: 'West', profile: 'volatile', size: 65 },
  // Mid-Market
  { name: 'Prairie Home Goods', industry: 'Home Goods', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'Central', profile: 'declining', size: 20 },
  { name: 'Lone Star Fashion', industry: 'Apparel & Fashion', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'Central', profile: 'core', size: 24 },
  { name: 'Sierra Sportswear', industry: 'Apparel & Fashion', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'West', profile: 'growth', size: 22 },
  { name: 'Frontier Gadgets', industry: 'Consumer Electronics', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'Central', profile: 'core', size: 19 },
  { name: 'Metro Meal Kits', industry: 'Meal Kits & Grocery', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'East', profile: 'at_risk', size: 26 },
  { name: 'Bayou Grocery Co.', industry: 'Meal Kits & Grocery', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'Central', profile: 'growth', size: 17 },
  { name: 'Maple Leaf Pets', industry: 'Pet Supplies', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'East', profile: 'core', size: 16 },
  { name: 'Great Lakes Auto Parts', industry: 'General Merchandise', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'Central', profile: 'core', size: 15 },
  { name: 'Coastal Kitchenware', industry: 'Home Goods', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'East', profile: 'new', size: 18 },
  { name: 'Velvet Row Cosmetics', industry: 'Beauty & Personal Care', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'East', profile: 'growth', size: 15 },
  { name: 'Summit Supplements', industry: 'Health & Wellness', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'Central', profile: 'core', size: 14 },
  { name: 'Brightpath Learning Kits', industry: 'Subscription Commerce', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'East', profile: 'churn', size: 13 },
  { name: 'Tidewater Outfitters', industry: 'Apparel & Fashion', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'East', profile: 'volatile', size: 12 },
  { name: 'Redwood Home Co.', industry: 'Home Goods', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'West', profile: 'core', size: 14 },
  { name: 'Pawprint Provisions', industry: 'Pet Supplies', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'West', profile: 'growth', size: 12 },
  { name: 'Ironwood Fitness', industry: 'Consumer Electronics', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'West', profile: 'at_risk', size: 13 },
  { name: 'Fresh Fork Market', industry: 'Meal Kits & Grocery', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'West', profile: 'new', size: 16 },
  { name: 'Keystone Fulfillment', industry: '3PL / Fulfillment', segment: 'Mid-Market', type: '3PL / Fulfillment', homeRegion: 'East', profile: 'core', size: 21, brands: ['Hearth & Hive', 'Blue Heron Apparel', 'Saltbox Snacks'] },
  { name: 'Mesa Logistics Partners', industry: '3PL / Fulfillment', segment: 'Mid-Market', type: '3PL / Fulfillment', homeRegion: 'West', profile: 'growth', size: 18, brands: ['Cactus Bloom Skincare', 'Arroyo Home', 'Dune Surf Co.'] },
  { name: 'Lakeshore Beauty Box', industry: 'Subscription Commerce', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'Central', profile: 'declining', size: 13 },
  { name: 'Granite State Goods', industry: 'General Merchandise', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'East', profile: 'churn', size: 11 },
  { name: 'Orchard & Vine', industry: 'Meal Kits & Grocery', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'West', profile: 'core', size: 11 },
  { name: 'Lumière Skin', industry: 'Beauty & Personal Care', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'West', profile: 'new', size: 12 },
  { name: 'Copperline Audio', industry: 'Consumer Electronics', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'East', profile: 'core', size: 10 },
  { name: 'Hollow Creek Pet', industry: 'Pet Supplies', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'Central', profile: 'new', size: 10 },
  { name: 'Wellspring Vitamins', industry: 'Health & Wellness', segment: 'Mid-Market', type: 'Direct Shipper', homeRegion: 'East', profile: 'growth', size: 11 },
  // SMB
  { name: 'Rocky Mountain Outfitters', industry: 'Apparel & Fashion', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'Central', profile: 'at_risk', size: 3.2 },
  { name: 'Capital Office Supply', industry: 'General Merchandise', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'East', profile: 'declining', size: 2.6 },
  { name: 'Heartland Books', industry: 'General Merchandise', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'Central', profile: 'churn', size: 2.1 },
  { name: 'Blue Ridge Hardware', industry: 'Home Goods', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'East', profile: 'at_risk', size: 2.4 },
  { name: 'Gulf Coast Tools', industry: 'General Merchandise', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'Central', profile: 'volatile', size: 2.8 },
  { name: 'Bramble & Bloom', industry: 'Home Goods', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'West', profile: 'growth', size: 2.2 },
  { name: 'Moonlit Tea Co.', industry: 'Subscription Commerce', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'West', profile: 'core', size: 1.8 },
  { name: 'Little Acorn Toys', industry: 'General Merchandise', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'East', profile: 'new', size: 2.0 },
  { name: 'Sweetgrass Soap', industry: 'Beauty & Personal Care', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'East', profile: 'core', size: 1.4 },
  { name: 'Fireside Candles', industry: 'Home Goods', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'Central', profile: 'growth', size: 1.6 },
  { name: 'Trailblazer Bikes', industry: 'Consumer Electronics', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'West', profile: 'declining', size: 1.9 },
  { name: 'Barkside Treats', industry: 'Pet Supplies', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'Central', profile: 'core', size: 1.5 },
  { name: 'Nimbus Phone Cases', industry: 'Consumer Electronics', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'West', profile: 'churn', size: 1.7 },
  { name: 'Sage & Salt Kitchen', industry: 'Meal Kits & Grocery', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'West', profile: 'new', size: 2.3 },
  { name: 'Aurora Yoga Wear', industry: 'Apparel & Fashion', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'West', profile: 'core', size: 1.6 },
  { name: 'Riverbend Coffee Club', industry: 'Subscription Commerce', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'Central', profile: 'growth', size: 1.3 },
  { name: 'Peak Performance Nutrition', industry: 'Health & Wellness', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'Central', profile: 'core', size: 1.5 },
  { name: 'Coral Reef Swim', industry: 'Apparel & Fashion', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'East', profile: 'volatile', size: 1.2 },
  { name: 'Willow Lane Linens', industry: 'Home Goods', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'East', profile: 'new', size: 1.4 },
  { name: 'Ember Grillworks', industry: 'Home Goods', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'Central', profile: 'declining', size: 1.3 },
  { name: 'Pixel Pals Gaming', industry: 'Consumer Electronics', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'East', profile: 'growth', size: 1.5 },
  { name: 'Golden Hour Candles', industry: 'Home Goods', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'West', profile: 'churn', size: 1.1 },
  { name: 'Kindred Baby Co.', industry: 'General Merchandise', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'East', profile: 'core', size: 1.4 },
  { name: 'Wild Prairie Honey', industry: 'Meal Kits & Grocery', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'Central', profile: 'core', size: 1.0 },
  { name: 'Urban Leaf Plants', industry: 'Home Goods', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'West', profile: 'at_risk', size: 1.3 },
  { name: 'Chroma Nail Studio', industry: 'Beauty & Personal Care', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'Central', profile: 'new', size: 1.2 },
  { name: 'Brightside Vitamins', industry: 'Health & Wellness', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'West', profile: 'volatile', size: 1.1 },
  { name: 'Northstar Books', industry: 'General Merchandise', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'Central', profile: 'core', size: 0.9 },
  { name: 'Sea Glass Jewelry', industry: 'Apparel & Fashion', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'East', profile: 'growth', size: 1.0 },
  { name: 'Hilltop Hardware', industry: 'Home Goods', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'Central', profile: 'core', size: 1.0 },
  { name: 'Fernwood Pet Supply', industry: 'Pet Supplies', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'East', profile: 'new', size: 1.1 },
  { name: 'Velo City Cycles', industry: 'Consumer Electronics', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'East', profile: 'core', size: 0.9 },
  { name: 'Lantern Lane Gifts', industry: 'General Merchandise', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'West', profile: 'declining', size: 0.8 },
  { name: 'Clover Field Farms', industry: 'Meal Kits & Grocery', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'East', profile: 'new', size: 1.2 },
  { name: 'Meridian Watch Co.', industry: 'Apparel & Fashion', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'West', profile: 'core', size: 0.8 },
  { name: 'Bluebird Stationery', industry: 'General Merchandise', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'Central', profile: 'growth', size: 0.9 },
  { name: 'Tundra Coolers', industry: 'Home Goods', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'Central', profile: 'volatile', size: 1.0 },
  { name: 'Rosewater Apothecary', industry: 'Beauty & Personal Care', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'West', profile: 'core', size: 0.8 },
  { name: 'Quarry Climbing Co.', industry: 'Apparel & Fashion', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'West', profile: 'new', size: 0.9 },
  { name: 'Harvest Moon Bakery', industry: 'Meal Kits & Grocery', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'Central', profile: 'churn', size: 0.8 },
  { name: 'Lighthouse Toys', industry: 'General Merchandise', segment: 'SMB', type: 'Direct Shipper', homeRegion: 'East', profile: 'core', size: 0.8 },
]

const FICTIONAL_FOR_ILLUSTRATIVE: Record<string, string> = {
  HelloFresh: 'Freshbox Meals',
  'Daily Harvest': 'Green Spoon Foods',
  'Crowd Cow': 'Prime Pasture Meats',
  'American Eagle': 'Eastwind Apparel',
  Nespresso: 'Crema Capsule Club',
  ShipHero: 'Shipwell Fulfillment',
  Radial: 'Axis Commerce Fulfillment',
  Flexport: 'Portside Fulfillment',
  Ryder: 'Roadline Logistics Fulfillment',
}

export function customerSpecs(): CustomerSpec[] {
  const illustrative = ILLUSTRATIVE.map((c) =>
    USE_ILLUSTRATIVE_BRANDS ? c : { ...c, name: FICTIONAL_FOR_ILLUSTRATIVE[c.name] ?? c.name, illustrative: false },
  )
  return [...illustrative, ...FICTIONAL.map((c) => ({ ...c, illustrative: false }))]
}

export const ACCOUNT_OWNERS = ['A. Chen', 'M. Rivera', 'J. Patel', 'S. Brooks', 'L. Nguyen', 'T. Walsh', 'R. Okafor', 'K. Duarte']

export const PROSPECT_NAMES = [
  'Bluefin Seafood Co.', 'Arcadia Home', 'Northline Apparel', 'Vantage Audio', 'Sprout & Co.', 'Halo Hair Care',
  'Ridgeview Supply', 'Cobalt Fitness', 'Marigold Market', 'Pinecrest Pets', 'Solace Sleep', 'Tandem Toys',
  'Driftwood Decor', 'Boldface Beauty', 'Kitebird Kids', 'Oakmoss Organics', 'Riverstone Retail', 'Gridiron Gear',
  'Starling Snacks', 'Larkspur Living', 'Mosaic Makers', 'Cinder Coffee', 'Foxglove Fashion', 'Ivy & Oak',
]
