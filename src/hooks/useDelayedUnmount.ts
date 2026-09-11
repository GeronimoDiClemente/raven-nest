import { useEffect, useRef, useState } from 'react'

export interface DelayedUnmountState {
  /** Whether the caller should still render the node (mounted, possibly closing). */
  visible: boolean
  /** True while playing the exit animation — apply the `.closing`-style class. */
  closing: boolean
}

/**
 * Keeps a conditionally-rendered node mounted for `exitMs` after `open`
 * flips to false, so its CSS exit animation (a `.closing` class swap) has
 * time to play before React actually removes it. Without this, `{open &&
 * <Overlay/>}` unmounts in the same tick `open` goes false and the exit
 * keyframes never get a frame to render.
 *
 * Failure modes this guards against (workspace-shell-design spec, part A):
 * - **A second close mid-animation is a no-op.** `open` is already `false`;
 *   React bails out of the effect before scheduling a second timer.
 * - **A pending timer never leaves the app stuck.** Even if something kept
 *   the timeout from firing, the `.closing` class this state drives is
 *   expected to carry `pointer-events: none` — the (invisible, mid-animation)
 *   overlay stops intercepting clicks well before it's actually gone from
 *   the DOM.
 * - **Reopening cancels the pending unmount.** If `open` flips back to true
 *   while still closing, the timer is cleared and the node snaps back to
 *   "fully open" — it never disappears out from under a fast re-open.
 */
export function useDelayedUnmount(open: boolean, exitMs: number): DelayedUnmountState {
  const [visible, setVisible] = useState(open)
  const [closing, setClosing] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      setClosing(false)
      setVisible(true)
      return
    }

    // open === false past this point.
    if (!visible) return // Already gone — nothing to animate out.
    if (timerRef.current !== null) return // Already closing — a second close is a no-op.

    setClosing(true)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setVisible(false)
      setClosing(false)
    }, exitMs)
  }, [open, visible, exitMs])

  // Belt-and-suspenders: clear any pending timer if the owning component
  // itself unmounts (e.g. route change) so it never fires setState on an
  // unmounted component.
  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
  }, [])

  return { visible, closing }
}
