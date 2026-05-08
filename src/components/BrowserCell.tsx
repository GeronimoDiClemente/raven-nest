import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PaneNode } from '../types'

interface Props {
  pane: PaneNode
  cellId: string
  onClose: () => void
  borderColor?: string
}

const HEADER_HEIGHT = 36

function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u)
}

export default function BrowserCell({ pane, cellId, onClose, borderColor }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const placeholderRef = useRef<HTMLDivElement>(null)
  const createdRef = useRef(false)
  const [url, setUrl] = useState<string>(pane.url ?? 'about:blank')
  const [draftUrl, setDraftUrl] = useState<string>(pane.url ?? '')

  // Create the WebContentsView once per pane
  useEffect(() => {
    if (createdRef.current) return
    const initialUrl = isHttpUrl(pane.url ?? '') ? pane.url! : 'http://localhost:3000'
    const partition = pane.sessionPartition ?? 'persist:browser-default'
    createdRef.current = true
    void window.browser.create(pane.id, initialUrl, partition).catch((err) => {
      console.error('browser:create failed', err)
    })
    return () => {
      void window.browser.destroy(pane.id).catch(() => {})
      createdRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id])

  // Subscribe to navigation updates from main
  useEffect(() => {
    const cb = (paneId: string, navUrl: string) => {
      if (paneId !== pane.id) return
      setUrl(navUrl)
      setDraftUrl(navUrl)
    }
    window.browser.onNavigated(cb)
    return () => window.browser.removeListeners()
  }, [pane.id])

  // Reposition on resize/scroll. Also collapses the WebContentsView to 0×0 when
  // any in-renderer modal/overlay is open, since WebContentsView always paints
  // above DOM content (no z-index) and would otherwise cover the dialog.
  useLayoutEffect(() => {
    const el = placeholderRef.current
    if (!el) return

    // Selectors of every overlay/full-screen view that should hide the browser
    // pane while open. Modals + the Teams / My Repos full-screen workspaces
    // (both render with the .teams-workspace root) all cover the grid area.
    const OVERLAY_SELECTOR =
      '.dialog-overlay, .confirm-overlay, .team-modal-overlay, .modal-overlay, .teams-workspace'

    const send = () => {
      const overlayOpen = !!document.querySelector(OVERLAY_SELECTOR)
      if (overlayOpen) {
        void window.browser.reposition(pane.id, { x: 0, y: 0, width: 0, height: 0 })
        return
      }
      const rect = el.getBoundingClientRect()
      void window.browser.reposition(pane.id, {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      })
    }
    send()
    const ro = new ResizeObserver(send)
    ro.observe(el)
    window.addEventListener('resize', send)
    // Watch the body for overlay nodes appearing/disappearing.
    const mo = new MutationObserver(send)
    mo.observe(document.body, { childList: true, subtree: true })
    const interval = setInterval(send, 1000)  // catch parent layout shifts
    return () => {
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', send)
      clearInterval(interval)
    }
  }, [pane.id])

  const submitUrl = () => {
    const next = draftUrl.trim()
    if (!next) return
    const normalized = isHttpUrl(next) ? next : `https://${next}`
    void window.browser.navigate(pane.id, normalized)
  }

  const accent = borderColor ?? '#0066FF'

  return (
    <div
      ref={containerRef}
      className="browser-cell"
      data-cell-id={cellId}
      style={{ borderColor: accent }}
    >
      <div className="browser-header" style={{ height: HEADER_HEIGHT }}>
        <button className="browser-btn" onClick={() => window.browser.back(pane.id)} title="Back">‹</button>
        <button className="browser-btn" onClick={() => window.browser.forward(pane.id)} title="Forward">›</button>
        <button className="browser-btn" onClick={() => window.browser.reload(pane.id)} title="Reload">↻</button>
        <input
          className="browser-url"
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitUrl() }}
          placeholder="https://"
          spellCheck={false}
        />
        <button
          className="browser-btn"
          onClick={() => window.electronShell.openExternal(url)}
          title="Open in external browser"
        >↗</button>
        <button className="browser-btn browser-btn-close" onClick={onClose} title="Close">×</button>
      </div>
      <div ref={placeholderRef} className="browser-placeholder" />
    </div>
  )
}
