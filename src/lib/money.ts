import Decimal from 'decimal.js'

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP })

export function D(value: number | string | Decimal): Decimal {
  return new Decimal(value)
}

export function money(value: number | string | Decimal): number {
  return D(value).toDecimalPlaces(2).toNumber()
}

export function sumMoney(values: Array<number | string | Decimal>): number {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), D(0)).toDecimalPlaces(2).toNumber()
}

export function mulMoney(a: number | string | Decimal, b: number | string | Decimal): number {
  return D(a).times(D(b)).toDecimalPlaces(2).toNumber()
}

export function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null
  return D(numerator).div(D(denominator)).times(100).toDecimalPlaces(2).toNumber()
}

export function safeDiv(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null
  return D(numerator).div(D(denominator)).toDecimalPlaces(4).toNumber()
}

export function formatCurrency(value: number, compact = false): string {
  if (compact && Math.abs(value) >= 1_000_000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(value)
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatCurrencyPrecise(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || Number.isNaN(value) || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

export function formatNumber(value: number, compact = false): string {
  if (compact && Math.abs(value) >= 1000) {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value)
  }
  return new Intl.NumberFormat('en-US').format(Math.round(value))
}

export function deltaPct(current: number, prior: number): number | null {
  if (prior === 0) return current === 0 ? 0 : null
  return D(current).minus(prior).div(Math.abs(prior)).times(100).toDecimalPlaces(1).toNumber()
}
