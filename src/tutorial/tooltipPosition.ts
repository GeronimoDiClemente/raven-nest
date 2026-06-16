// src/tutorial/tooltipPosition.ts

export interface SpotlightBox {
  top: number
  left: number
  width: number
  height: number
}
export interface TooltipSize {
  w: number
  h: number
}
export interface Viewport {
  w: number
  h: number
}
export type Placement = 'top' | 'bottom' | 'left' | 'right'

const MARGIN = 16
const GAP = 12

function clamp(min: number, value: number, max: number): number {
  // When the element is larger than the available room (max < min), prefer the
  // top/left margin so it isn't pushed off the opposite edge.
  if (max < min) return min
  return Math.min(Math.max(min, value), max)
}

/**
 * Position the coachmark tooltip relative to its spotlight, honoring the step's
 * preferred `placement`. 'left'/'right' sit beside the spotlight (top-aligned);
 * 'top'/'bottom' sit above/below it. If a side placement would overflow the
 * viewport horizontally we fall back to below the spotlight. The result is
 * always clamped inside the viewport (both axes) so the tooltip never hugs or
 * crosses an edge.
 */
export function computeTooltipPosition(
  spotlight: SpotlightBox,
  placement: Placement | undefined,
  size: TooltipSize,
  viewport: Viewport,
): { top: number; left: number } {
  let top: number
  let left: number

  switch (placement) {
    case 'right':
      left = spotlight.left + spotlight.width + GAP
      top = spotlight.top
      break
    case 'left':
      left = spotlight.left - size.w - GAP
      top = spotlight.top
      break
    case 'top':
      left = spotlight.left
      top = spotlight.top - size.h - GAP
      break
    default:
      left = spotlight.left
      top = spotlight.top + spotlight.height + GAP
  }

  // Side placements that don't fit horizontally fall back to below the spotlight.
  const overflowsRight = placement === 'right' && left + size.w > viewport.w - MARGIN
  const overflowsLeft = placement === 'left' && left < MARGIN
  if (overflowsRight || overflowsLeft) {
    left = spotlight.left
    top = spotlight.top + spotlight.height + GAP
  }

  left = clamp(MARGIN, left, viewport.w - size.w - MARGIN)
  top = clamp(MARGIN, top, viewport.h - size.h - MARGIN)
  return { top, left }
}
