import { MoreHorizontal, TrendingDown, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { KPI_DEFINITIONS } from '@/calc/kpiDefinitions'
import { METRIC_REGISTRY, type MetricId } from '@/calc/metricRegistry'
import { useApp } from '@/context/AppContext'
import {
  interpretDelta,
  interpretLevel,
  KPI_POLARITY,
  toneBorderClass,
  toneTextClass,
  type KpiPolarity,
} from '@/lib/semantics'
import { formatCurrency, formatPercent } from '@/lib/money'
import { KpiDefinitionPanel } from './KpiDefinitionPanel'
import { MetricDefinitionTip } from './MetricDefinitionTip'
import { Sparkline } from './Sparkline'
import type { KpiDefinition } from '@/types'

export interface KpiAction {
  label: string
  onClick: () => void
}

interface KpiCardProps {
  kpiId: string
  value: number
  /** Percent change vs prior comparable window (already ×100 scale for formatPercent) */
  priorDelta?: number | null
  /** Absolute change vs named baseline (same units as value) */
  absoluteChange?: number | null
  /** Named comparison baseline, e.g. "vs Existing Customer Forecast" */
  baselineLabel?: string
  target?: number | null
  format?: 'currency' | 'percent' | 'number'
  onClick?: () => void
  actions?: KpiAction[]
  size?: 'primary' | 'secondary'
  polarity?: KpiPolarity
  levelThresholds?: { good: number; warn: number }
  scopeNote?: string
  dateBasisNote?: string
  statusLabel?: string
  sparkline?: number[] | null
}

export function KpiCard({
  kpiId,
  value,
  priorDelta,
  absoluteChange,
  baselineLabel,
  target,
  format = 'currency',
  onClick,
  actions,
  size = 'secondary',
  polarity,
  levelThresholds,
  scopeNote,
  dateBasisNote,
  statusLabel,
  sparkline,
}: KpiCardProps) {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { dateBasis } = useApp()
  const registry = METRIC_REGISTRY[kpiId as MetricId]
  const def: KpiDefinition | undefined = registry
    ? {
        id: registry.id,
        name: registry.name,
        businessDefinition: `${registry.chineseName} — ${registry.businessDefinition}`,
        formula: registry.formula,
        sourceTables: registry.sourceTables,
        sourceColumns: registry.sourceColumns,
        calculationExample: registry.calculationExample,
        interpretation: `${registry.interpretation} Date basis: ${registry.dateBasis}. ${registry.actionHint}`,
        commonCauses: registry.commonCauses,
      }
    : KPI_DEFINITIONS[kpiId]
  const pol =
    polarity ??
    KPI_POLARITY[kpiId] ??
    (kpiId.includes('risk') ||
    kpiId.includes('overdue') ||
    kpiId.includes('unbilled') ||
    kpiId.includes('leakage')
      ? 'lower_better'
      : 'higher_better')
  const deltaTone = interpretDelta(priorDelta ?? (absoluteChange != null ? absoluteChange : null), pol)
  const levelTone = levelThresholds
    ? interpretLevel(value, levelThresholds, pol)
    : deltaTone === 'neutral' && pol !== 'neutral'
      ? interpretDelta(priorDelta ?? absoluteChange ?? 0, pol)
      : deltaTone

  const display =
    format === 'currency'
      ? formatCurrency(value, true)
      : format === 'percent'
        ? formatPercent(value)
        : value.toLocaleString()

  const absDisplay =
    absoluteChange == null
      ? null
      : format === 'currency'
        ? `${absoluteChange >= 0 ? '+' : ''}${formatCurrency(absoluteChange, true)}`
        : format === 'percent'
          ? `${absoluteChange >= 0 ? '+' : ''}${absoluteChange.toFixed(1)} pts`
          : `${absoluteChange >= 0 ? '+' : ''}${absoluteChange.toLocaleString()}`

  const clickable = Boolean(onClick || (actions && actions.length > 0))

  const handleCardClick = () => {
    if (actions && actions.length > 0) {
      setMenuOpen((v) => !v)
      return
    }
    onClick?.()
  }

  return (
    <div
      className={`relative card-surface border-l-4 ${size === 'primary' ? 'card-raised p-5' : 'p-4'} ${toneBorderClass(levelTone)} ${
        clickable ? 'cursor-pointer transition-colors hover:border-brand-300' : ''
      }`}
      onClick={handleCardClick}
      role={clickable ? 'button' : undefined}
      title={clickable ? 'Click for breakdown / lineage / investigate' : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="t-kpi-label flex items-center uppercase text-ink-muted">
            {def?.name ?? kpiId}
            {METRIC_REGISTRY[kpiId as MetricId] && (
              <MetricDefinitionTip metricId={kpiId} globalDateBasis={dateBasis} />
            )}
          </p>
          <p className={`mt-1.5 font-mono text-ink ${size === 'primary' ? 't-kpi' : 'text-[24px] font-bold tracking-tight'}`}>
            {display}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-0.5">
            {actions && actions.length > 0 && (
              <button
                type="button"
                className="rounded-md p-1 text-slate-400 hover:bg-brand-50 hover:text-brand-700"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen((v) => !v)
                }}
                aria-label="KPI actions"
              >
                <MoreHorizontal size={16} />
              </button>
            )}
            <button
              type="button"
              className="rounded-md p-1 text-slate-400 hover:bg-brand-50 hover:text-brand-700"
              onClick={(e) => {
                e.stopPropagation()
                setOpen((v) => !v)
              }}
              aria-label="KPI definition"
            >
              <Info size={16} />
            </button>
          </div>
          {sparkline && sparkline.length >= 2 && (
            <div className="w-16">
              <Sparkline data={sparkline} />
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
        {(absoluteChange != null || priorDelta != null) && (
          <span className={`inline-flex items-center gap-1 font-medium ${toneTextClass(deltaTone)}`}>
            {(absoluteChange ?? priorDelta ?? 0) >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {absDisplay}
            {priorDelta != null && (
              <span>
                {absDisplay ? ' / ' : ''}
                {format === 'percent' && pol !== 'lower_better'
                  ? `${priorDelta > 0 ? '+' : ''}${priorDelta.toFixed(1)} pts`
                  : formatPercent(priorDelta)}
              </span>
            )}
            <span className="font-normal text-ink-muted">{baselineLabel ?? 'vs prior'}</span>
          </span>
        )}
        {statusLabel && (
          <span className="rounded bg-[#f5f8f5] px-1.5 py-0.5 text-xs font-medium text-ink">
            {statusLabel}
          </span>
        )}
        {target != null && format === 'currency' && (
          <span className="text-ink-muted">
            Target {formatCurrency(target, true)} (
            {formatPercent(((value - target) / Math.abs(target || 1)) * 100)} vs target)
          </span>
        )}
        {target != null && format === 'percent' && (
          <span className="text-ink-muted">Target {formatPercent(target)}</span>
        )}
      </div>
      {/* Date basis is Level-3 detail: available via the ⓘ definition panel and hover title */}
      {(scopeNote || dateBasisNote) && (
        <p
          className="mt-1.5 text-xs text-ink-muted"
          title={registry ? `Date basis: ${registry.dateBasis}` : undefined}
        >
          {dateBasisNote ? `${dateBasisNote}${scopeNote ? ' · ' : ''}` : ''}
          {scopeNote ?? ''}
        </p>
      )}
      {menuOpen && actions && actions.length > 0 && (
        <div
          className="absolute right-2 top-10 z-30 min-w-[180px] rounded-lg border border-[#dce6df] bg-white py-1 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className="block w-full px-3 py-1.5 text-left text-xs text-ink hover:bg-brand-50"
              onClick={() => {
                setMenuOpen(false)
                a.onClick()
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {open && def && (
        <div className="absolute left-0 right-0 top-full z-20 mt-2">
          <KpiDefinitionPanel definition={def} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
