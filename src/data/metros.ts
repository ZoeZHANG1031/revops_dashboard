import type { RegionCode } from '@/types'

export const REGIONS: RegionCode[] = ['West', 'Central', 'East']

/** Explicit metro catalog — coordinates are published city centroids, not random. */
export interface MetroDefinition {
  metro: string
  region: RegionCode
  /** WGS84 latitude */
  lat: number
  /** WGS84 longitude */
  lon: number
  source: string
  /** First month of synthetic operations (network expansion) */
  launch_period: string
  /** Relative delivery density (stops per route-hour); higher = cheaper per package */
  density: number
  /** Relative labor / DSP cost index (1 = network average) */
  cost_index: number
  /** Share of packages to remote / rural ZIPs (accessorial eligible) */
  remote_share: number
  /** Number of sort stations / hubs */
  stations: number
  /** Relative demand weight (market size) */
  demand: number
  /** 3-digit ZIP prefixes served (illustrative) */
  zips: string[]
}

/**
 * Synthetic network: 24 metros in three regions. Launch dates create a realistic expansion path
 * (new metros start with low density and therefore higher cost per package).
 */
export const METRO_DEFINITIONS: MetroDefinition[] = [
  // West
  { metro: 'LA Metro', region: 'West', lat: 34.0522, lon: -118.2437, source: 'Los Angeles city center', launch_period: '2022-01', density: 1.15, cost_index: 1.08, remote_share: 0.06, stations: 4, demand: 1.6, zips: ['900', '902', '913', '917'] },
  { metro: 'Bay Area', region: 'West', lat: 37.7749, lon: -122.4194, source: 'San Francisco city center', launch_period: '2022-01', density: 1.05, cost_index: 1.18, remote_share: 0.07, stations: 3, demand: 1.15, zips: ['941', '945', '950'] },
  { metro: 'Seattle Metro', region: 'West', lat: 47.6062, lon: -122.3321, source: 'Seattle city center', launch_period: '2022-06', density: 0.95, cost_index: 1.1, remote_share: 0.1, stations: 2, demand: 0.85, zips: ['980', '981'] },
  { metro: 'Phoenix Metro', region: 'West', lat: 33.4484, lon: -112.074, source: 'Phoenix city center', launch_period: '2023-03', density: 0.9, cost_index: 0.95, remote_share: 0.11, stations: 2, demand: 0.75, zips: ['850', '852'] },
  { metro: 'San Diego Metro', region: 'West', lat: 32.7157, lon: -117.1611, source: 'San Diego city center', launch_period: '2023-09', density: 0.92, cost_index: 1.05, remote_share: 0.08, stations: 2, demand: 0.6, zips: ['919', '921'] },
  { metro: 'Portland Metro', region: 'West', lat: 45.5152, lon: -122.6784, source: 'Portland city center', launch_period: '2025-03', density: 0.78, cost_index: 1.02, remote_share: 0.13, stations: 1, demand: 0.45, zips: ['970', '972'] },
  { metro: 'Las Vegas Metro', region: 'West', lat: 36.1699, lon: -115.1398, source: 'Las Vegas city center', launch_period: '2025-08', density: 0.82, cost_index: 0.97, remote_share: 0.09, stations: 1, demand: 0.4, zips: ['889', '891'] },
  { metro: 'Salt Lake Metro', region: 'West', lat: 40.7608, lon: -111.891, source: 'Salt Lake City center', launch_period: '2026-04', density: 0.7, cost_index: 0.96, remote_share: 0.16, stations: 1, demand: 0.35, zips: ['840', '841'] },
  // Central
  { metro: 'Dallas–Fort Worth Metro', region: 'Central', lat: 32.7767, lon: -96.797, source: 'Dallas city center', launch_period: '2022-01', density: 1.0, cost_index: 0.92, remote_share: 0.09, stations: 3, demand: 1.25, zips: ['750', '752', '761'] },
  { metro: 'Houston Metro', region: 'Central', lat: 29.7604, lon: -95.3698, source: 'Houston city center', launch_period: '2022-03', density: 0.95, cost_index: 0.93, remote_share: 0.1, stations: 3, demand: 1.1, zips: ['770', '773', '775'] },
  { metro: 'Chicago Metro', region: 'Central', lat: 41.8781, lon: -87.6298, source: 'Chicago city center', launch_period: '2022-01', density: 1.12, cost_index: 1.03, remote_share: 0.06, stations: 3, demand: 1.3, zips: ['606', '600', '604'] },
  { metro: 'Denver Metro', region: 'Central', lat: 39.7392, lon: -104.9903, source: 'Denver city center', launch_period: '2023-06', density: 0.86, cost_index: 0.99, remote_share: 0.12, stations: 2, demand: 0.65, zips: ['800', '802'] },
  { metro: 'Austin Metro', region: 'Central', lat: 30.2672, lon: -97.7431, source: 'Austin city center', launch_period: '2024-02', density: 0.84, cost_index: 0.94, remote_share: 0.11, stations: 1, demand: 0.55, zips: ['786', '787'] },
  { metro: 'Minneapolis Metro', region: 'Central', lat: 44.9778, lon: -93.265, source: 'Minneapolis city center', launch_period: '2023-10', density: 0.85, cost_index: 1.0, remote_share: 0.12, stations: 1, demand: 0.5, zips: ['553', '554'] },
  { metro: 'Kansas City Metro', region: 'Central', lat: 39.0997, lon: -94.5786, source: 'Kansas City center', launch_period: '2025-06', density: 0.72, cost_index: 0.9, remote_share: 0.15, stations: 1, demand: 0.35, zips: ['641', '660'] },
  { metro: 'Detroit Metro', region: 'Central', lat: 42.3314, lon: -83.0458, source: 'Detroit city center', launch_period: '2024-09', density: 0.8, cost_index: 0.95, remote_share: 0.11, stations: 1, demand: 0.45, zips: ['481', '482'] },
  // East
  { metro: 'NYC Metro', region: 'East', lat: 40.7128, lon: -74.006, source: 'NYC city center', launch_period: '2022-01', density: 1.3, cost_index: 1.2, remote_share: 0.04, stations: 4, demand: 1.8, zips: ['100', '112', '070', '113'] },
  { metro: 'Boston Metro', region: 'East', lat: 42.3601, lon: -71.0589, source: 'Boston city center', launch_period: '2022-04', density: 1.05, cost_index: 1.12, remote_share: 0.07, stations: 2, demand: 0.85, zips: ['021', '019'] },
  { metro: 'Philadelphia Metro', region: 'East', lat: 39.9526, lon: -75.1652, source: 'Philadelphia city center', launch_period: '2022-06', density: 1.02, cost_index: 1.04, remote_share: 0.07, stations: 2, demand: 0.85, zips: ['191', '080'] },
  { metro: 'Atlanta Metro', region: 'East', lat: 33.749, lon: -84.388, source: 'Atlanta city center', launch_period: '2022-09', density: 0.93, cost_index: 0.95, remote_share: 0.1, stations: 2, demand: 0.9, zips: ['303', '300'] },
  { metro: 'Washington DC Metro', region: 'East', lat: 38.9072, lon: -77.0369, source: 'Washington DC center', launch_period: '2023-04', density: 1.0, cost_index: 1.1, remote_share: 0.07, stations: 2, demand: 0.8, zips: ['200', '220', '208'] },
  { metro: 'Miami Metro', region: 'East', lat: 25.7617, lon: -80.1918, source: 'Miami city center', launch_period: '2023-11', density: 0.96, cost_index: 1.0, remote_share: 0.08, stations: 2, demand: 0.75, zips: ['331', '330'] },
  { metro: 'Charlotte Metro', region: 'East', lat: 35.2271, lon: -80.8431, source: 'Charlotte city center', launch_period: '2024-11', density: 0.76, cost_index: 0.93, remote_share: 0.13, stations: 1, demand: 0.4, zips: ['282', '280'] },
  { metro: 'Orlando Metro', region: 'East', lat: 28.5384, lon: -81.3792, source: 'Orlando city center', launch_period: '2026-02', density: 0.7, cost_index: 0.96, remote_share: 0.12, stations: 1, demand: 0.35, zips: ['327', '328'] },
]

export function metroByName(name: string): MetroDefinition | undefined {
  return METRO_DEFINITIONS.find((m) => m.metro === name)
}

/** Equirectangular project continental US into SVG viewBox */
export function projectUs(lon: number, lat: number, width = 1000, height = 620): { x: number; y: number } {
  const west = -125
  const east = -66
  const north = 49.5
  const south = 24.5
  const x = ((lon - west) / (east - west)) * width
  const y = ((north - lat) / (north - south)) * height
  return { x, y }
}
