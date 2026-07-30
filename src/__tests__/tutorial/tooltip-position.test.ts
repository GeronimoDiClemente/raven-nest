// src/__tests__/tutorial/tooltip-position.test.ts
import { describe, it, expect } from 'vitest'
import { computeTooltipPosition } from '../../tutorial/tooltipPosition'

const VIEWPORT = { w: 1200, h: 641 }
const SIZE = { w: 260, h: 170 }

describe('computeTooltipPosition', () => {
  it('places the tooltip to the right of the spotlight, top-aligned, for placement="right"', () => {
    const spotlight = { top: 30, left: 6, width: 218, height: 400 }
    expect(computeTooltipPosition(spotlight, 'right', SIZE, VIEWPORT)).toEqual({ top: 30, left: 236 })
  })

  it('places the tooltip to the left for placement="left"', () => {
    const spotlight = { top: 100, left: 900, width: 50, height: 40 }
    expect(computeTooltipPosition(spotlight, 'left', SIZE, VIEWPORT)).toEqual({ top: 100, left: 628 })
  })

  it('falls back below the spotlight when "right" would overflow the viewport', () => {
    const spotlight = { top: 30, left: 6, width: 1100, height: 100 }
    // right edge would be 6+1100+12+260 = 1378 > 1184 → fall back below, then clamp left to margin
    expect(computeTooltipPosition(spotlight, 'right', SIZE, VIEWPORT)).toEqual({ top: 142, left: 16 })
  })

  it('places below the spotlight by default (no placement / "bottom")', () => {
    const spotlight = { top: 50, left: 100, width: 80, height: 30 }
    expect(computeTooltipPosition(spotlight, undefined, SIZE, VIEWPORT)).toEqual({ top: 92, left: 100 })
  })

  it('clamps vertically so the tooltip never overflows the bottom edge', () => {
    const spotlight = { top: 600, left: 100, width: 50, height: 30 }
    // default bottom → top would be 642; clamp to 641-170-16 = 455
    expect(computeTooltipPosition(spotlight, 'bottom', SIZE, VIEWPORT)).toEqual({ top: 455, left: 100 })
  })
})
