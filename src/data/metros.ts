import type { RegionCode } from '@/types'

/** Explicit metro catalog — coordinates are published city centroids, not random. */
export interface MetroDefinition {
  metro: string
  region: RegionCode
  /** WGS84 latitude */
  lat: number
  /** WGS84 longitude */
  lon: number
  source: string
}

/**
 * Must stay in sync with METROS in generate.ts.
 * Coordinates: approximate metro CBDs (public city centers).
 */
export const METRO_DEFINITIONS: MetroDefinition[] = [
  { metro: 'NYC Metro', region: 'Northeast', lat: 40.7128, lon: -74.006, source: 'NYC city center' },
  { metro: 'Boston Metro', region: 'Northeast', lat: 42.3601, lon: -71.0589, source: 'Boston city center' },
  { metro: 'Philly Metro', region: 'Northeast', lat: 39.9526, lon: -75.1652, source: 'Philadelphia city center' },
  { metro: 'Atlanta Metro', region: 'Southeast', lat: 33.749, lon: -84.388, source: 'Atlanta city center' },
  { metro: 'Miami Metro', region: 'Southeast', lat: 25.7617, lon: -80.1918, source: 'Miami city center' },
  { metro: 'Charlotte Metro', region: 'Southeast', lat: 35.2271, lon: -80.8431, source: 'Charlotte city center' },
  { metro: 'Chicago Metro', region: 'Midwest', lat: 41.8781, lon: -87.6298, source: 'Chicago city center' },
  { metro: 'Detroit Metro', region: 'Midwest', lat: 42.3314, lon: -83.0458, source: 'Detroit city center' },
  { metro: 'Minneapolis Metro', region: 'Midwest', lat: 44.9778, lon: -93.265, source: 'Minneapolis city center' },
  { metro: 'Dallas Metro', region: 'Southwest', lat: 32.7767, lon: -96.797, source: 'Dallas city center' },
  { metro: 'Phoenix Metro', region: 'Southwest', lat: 33.4484, lon: -112.074, source: 'Phoenix city center' },
  { metro: 'Houston Metro', region: 'Southwest', lat: 29.7604, lon: -95.3698, source: 'Houston city center' },
  { metro: 'LA Metro', region: 'West', lat: 34.0522, lon: -118.2437, source: 'Los Angeles city center' },
  { metro: 'Bay Area', region: 'West', lat: 37.7749, lon: -122.4194, source: 'San Francisco city center' },
  { metro: 'Seattle Metro', region: 'West', lat: 47.6062, lon: -122.3321, source: 'Seattle city center' },
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
