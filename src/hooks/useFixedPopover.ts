import { useEffect, useLayoutEffect, useState, RefObject, useCallback } from 'react'

export interface PopoverPos {
  top: number
  left: number
}

/**
 * Computes a fixed-position offset to the right of `triggerRef` (sidebar item).
 * `position: fixed` is required because the sidebar can become a scroll container
 * (overflow-y: auto), and absolutely-positioned popovers would be clipped by it.
 *
 * If `popoverRef` is provided, after the first paint we measure the popover and
 * shift `top`/`left` so it stays inside the viewport — useful when the trigger
 * is near the bottom of the sidebar and the popover would otherwise overflow.
 */
export function useFixedPopover(
  triggerRef: RefObject<HTMLElement | null>,
  isOpen: boolean,
  popoverRef?: RefObject<HTMLElement | null>,
  gap = 4,
): PopoverPos | null {
  const [pos, setPos] = useState<PopoverPos | null>(null)

  const update = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let top = rect.top
    let left = rect.right + gap

    // If the popover has already mounted, clamp inside the viewport.
    const pop = popoverRef?.current
    if (pop) {
      const margin = 8
      const vh = window.innerHeight
      const vw = window.innerWidth
      const popRect = pop.getBoundingClientRect()
      if (top + popRect.height > vh - margin) {
        top = Math.max(margin, vh - popRect.height - margin)
      }
      if (left + popRect.width > vw - margin) {
        // Fall back to opening on the LEFT side of the trigger.
        left = Math.max(margin, rect.left - popRect.width - gap)
      }
    }
    setPos({ top, left })
  }, [triggerRef, popoverRef, gap])

  // Synchronous pre-paint set so the first frame is positioned correctly.
  useLayoutEffect(() => {
    if (!isOpen) {
      setPos(null)
      return
    }
    update()
  }, [isOpen, update])

  // After the popover paints we have its real size — re-measure and clamp.
  useEffect(() => {
    if (!isOpen) return
    const raf = requestAnimationFrame(update)
    const onResize = () => update()
    window.addEventListener('resize', onResize)
    // Capture-phase scroll listener catches scrolls inside any ancestor
    // (e.g. .sidebar-scroll) — bubbling skips the window for inner scrollers.
    document.addEventListener('scroll', onResize, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('scroll', onResize, true)
    }
  }, [isOpen, update])

  return pos
}
