import { useEffect } from 'react'
import { useXterm } from '../hooks/useXterm'
import { registerPane, unregisterPane } from '../pty-events'

/** Attaches a live xterm to a graph node's headless pane. main owns the PTY
 *  (spawned by the orchestrator tick) — we only mount a view on it: register for
 *  `pty:data` first (so nothing is missed), backfill the scrollback via
 *  graphRuns.attach, and never kill the PTY on unmount (the run outlives the
 *  viewer). Typing writes back to the PTY through useXterm's default onData →
 *  window.pty.write, which is the node's "Reply". */
export function GraphNodeTerminal({ runId, nodeId }: { runId: string; nodeId: string }) {
  const paneId = `${runId}:${nodeId}`
  const { containerRef, write, focus, resize } = useXterm(paneId)

  useEffect(() => {
    let cancelled = false
    registerPane(paneId, (data) => write(data))
    void window.graphRuns?.attach?.(runId, nodeId).then((res) => {
      if (cancelled || !res) return
      if (res.buffer) write(res.buffer)
      resize()
      focus()
    })
    return () => { cancelled = true; unregisterPane(paneId) }
    // write/focus/resize are stable closures over refs (same as TerminalPane).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId])

  return <div ref={containerRef} className="terminal-container gb-term-live" />
}
