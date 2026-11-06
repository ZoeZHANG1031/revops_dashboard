// Geometry is tested on the canonical model (src/lib/waterfall.test.ts) and on rendered SVG
// (FloatingWaterfall.render.test.tsx). This file re-exports nothing; kept to document the move.
import { describe, expect, it } from 'vitest'
import { buildWaterfallModel } from '@/lib/waterfall'

describe('FloatingWaterfall uses the canonical model', () => {
  it('builds rows from steps', () => {
    const rows = buildWaterfallModel(
      [
        { key: 'opening', label: 'Opening', amount: 100 },
        { key: 'new', label: 'New', amount: 40 },
        { key: 'won', label: 'Won', amount: -30 },
        { key: 'closing', label: 'Closing', amount: 110 },
      ],
      ['opening', 'closing'],
    )
    expect(rows.map((r) => r.type)).toEqual(['start', 'delta', 'delta', 'end'])
  })
})
