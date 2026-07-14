import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { subscribeToPtyData } from '../pty-events'

// Replay only the tail of the 10k-line main-process buffer — a compact tile
// doesn't need full scroll-back and writing 10k lines × 12 tiles at once
// would jank the overlay open animation.
const TAIL_LINES = 200

/**
 * Lightweight xterm for Hub tiles. Attaches to an EXISTING PTY by paneId:
 * replays the buffer tail, subscribes to the global data bus, forwards input.
 * Never creates or kills the PTY, never touches the pane registries
 * (registerPane/registerTerminal are single-slot per paneId and belong to
 * the real TerminalPane).
 *
 * PTY resize policy: only when `canResizePty` (pane is NOT in the active
 * tab — active-tab panes stay mounted at real size behind the overlay) and
 * only when this tile owns keyboard focus.
 */
export function useHubTerminal(paneId: string, canResizePty: boolean) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const canResizeRef = useRef(canResizePty)
  canResizeRef.current = canResizePty

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const fontFamily = window.platform?.isMac
      ? '"SF Mono", "Menlo", "Monaco", monospace'
      : '"Cascadia Mono", "Cascadia Code", "Consolas", monospace'

    const term = new Terminal({
      fontFamily,
      fontSize: 11,
      lineHeight: 1.3,
      cursorBlink: false,
      cursorStyle: 'bar',
      scrollback: 1000,
      theme: {
        background: '#000000',
        foreground: '#e8e8e8',
        cursor: '#0066FF',
        selectionBackground: '#0066FF33',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    termRef.current = term
    fitRef.current = fit

    // Fit the xterm view to the tile WITHOUT resizing the PTY — view-only.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try { fit.fit() } catch { /* ignore */ }
      })
    })

    let alive = true
    window.pty.getBuffer(paneId).then((buf) => {
      if (!alive || !buf) return
      const tail = buf.split('\n').slice(-TAIL_LINES).join('\n')
      term.write(tail)
    })

    const unsubscribe = subscribeToPtyData((id, data) => {
      if (id === paneId) term.write(data)
    })

    // Input flows only when this xterm has DOM focus — xterm only emits
    // onData for the focused instance, so no extra gating is needed.
    term.onData((data) => window.pty.write(paneId, data))

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          if (!container.clientWidth || !container.clientHeight) return
          fit.fit()
          if (canResizeRef.current && container.contains(document.activeElement)) {
            window.pty.resize(paneId, term.cols, term.rows)
          }
        } catch { /* ignore */ }
      })
    })
    resizeObserver.observe(container)

    return () => {
      alive = false
      unsubscribe()
      resizeObserver.disconnect()
      // Do NOT kill the PTY — same contract as TerminalPane.
      term.dispose()
    }
  }, [paneId])

  const focusTile = useCallback(() => {
    const term = termRef.current
    if (!term) return
    term.focus()
    if (canResizeRef.current && fitRef.current) {
      try {
        fitRef.current.fit()
        window.pty.resize(paneId, term.cols, term.rows)
      } catch { /* ignore */ }
    }
  }, [paneId])

  return { containerRef, focusTile }
}
