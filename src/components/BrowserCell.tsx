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
  const [isUntouched, setIsUntouched] = useState<boolean>(!isHttpUrl(pane.url ?? ''))
  const isUntouchedRef = useRef<boolean>(!isHttpUrl(pane.url ?? ''))

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

  // Auto-navigate to localhost URLs detected in any terminal pane's output —
  // only when this Browser cell is still untouched, and only if no other
  // untouched Browser cell is spatially closer to the source pane.
  useEffect(() => {
    const handler = (e: Event) => {
      if (!isUntouchedRef.current) return
      const ce = e as CustomEvent<{ paneId: string; cellId: string; url: string }>
      const sourceEl = document.querySelector(`[data-cell-id="${ce.detail.cellId}"]`)
      const myEl = containerRef.current
      if (sourceEl && myEl) {
        const sr = sourceEl.getBoundingClientRect()
        const mr = myEl.getBoundingClientRect()
        const cx = sr.left + sr.width / 2
        const cy = sr.top + sr.height / 2
        const myDist = Math.hypot(
          mr.left + mr.width / 2 - cx,
          mr.top + mr.height / 2 - cy,
        )
        const others = document.querySelectorAll('[data-browser-untouched="true"]')
        for (const o of others) {
          if (o === myEl) continue
          const or = o.getBoundingClientRect()
          const od = Math.hypot(
            or.left + or.width / 2 - cx,
            or.top + or.height / 2 - cy,
          )
          if (od < myDist) return
        }
      }
      isUntouchedRef.current = false
      setIsUntouched(false)
      void window.browser.navigate(pane.id, ce.detail.url).catch((err) => {
        console.error('browser:navigate failed', err)
      })
    }
    window.addEventListener('nest:pty-url', handler as EventListener)
    return () => window.removeEventListener('nest:pty-url', handler as EventListener)
  }, [pane.id])

  // Reposition on resize/scroll. Also collapses the WebContentsView to 0×0 when
  // any in-renderer modal/overlay is open, since WebContentsView always paints
  // above DOM content (no z-index) and would otherwise cover the dialog.
  useLayoutEffect(() => {
    const el = placeholderRef.current
    if (!el) return

    // Selectors of every overlay/full-screen view that should hide the browser
    // pane while open. WebContentsView always paints above DOM (no z-index),
    // so any sidebar popover or modal must collapse this pane to avoid being
    // covered. Includes: dialogs, full-screen workspaces, sidebar popovers,
    // pane-level overlays.
    const OVERLAY_SELECTOR = [
      '.dialog-overlay',
      '.confirm-overlay',
      '.team-modal-overlay',
      '.modal-overlay',
      '.teams-workspace',
      '.snippet-panel',
      '.mcp-panel',
      '.layout-popover',
      '.notification-panel',
      '.user-menu-popover',
      '.cmd-panel',
      '.diff-drawer',
      '.repo-status-panel',
      '.pane-color-popover',
      '.ts-panel',
      '.resource-bar-popover',
      '.rb-overlay',
      '.browser-port-dropdown',
    ].join(', ')

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
    isUntouchedRef.current = false
    setIsUntouched(false)
    void window.browser.navigate(pane.id, normalized)
  }

  const portBtnRef = useRef<HTMLButtonElement>(null)
  const [portsOpen, setPortsOpen] = useState(false)
  const [openPorts, setOpenPorts] = useState<number[]>([])
  const [portsAnchor, setPortsAnchor] = useState<{ top: number; right: number } | null>(null)
  const togglePorts = async () => {
    if (portsOpen) { setPortsOpen(false); return }
    try {
      const list = await window.port.listAll()
      setOpenPorts(list)
    } catch {
      setOpenPorts([])
    }
    const rect = portBtnRef.current?.getBoundingClientRect()
    if (rect) setPortsAnchor({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    setPortsOpen(true)
  }
  const goToPort = (port: number) => {
    const url = `http://localhost:${port}`
    setDraftUrl(url)
    isUntouchedRef.current = false
    setIsUntouched(false)
    setPortsOpen(false)
    void window.browser.navigate(pane.id, url)
  }

  // Close ports dropdown on click outside
  useEffect(() => {
    if (!portsOpen) return
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest('.browser-port-dropdown, .browser-port-btn')
      if (!el) setPortsOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [portsOpen])

  const accent = borderColor ?? '#0066FF'

  return (
    <div
      ref={containerRef}
      className="browser-cell"
      data-cell-id={cellId}
      data-browser-untouched={isUntouched ? 'true' : undefined}
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
          ref={portBtnRef}
          className="browser-btn browser-port-btn"
          onClick={togglePorts}
          title="Open listening ports"
        >:</button>
        {portsOpen && portsAnchor && (
          <div
            className="browser-port-dropdown"
            role="listbox"
            style={{ position: 'fixed', top: portsAnchor.top, right: portsAnchor.right, zIndex: 100 }}
          >
            {openPorts.length === 0 ? (
              <div className="browser-port-empty">No listening ports</div>
            ) : openPorts.map((port) => (
              <button key={port} className="browser-port-item" onClick={() => goToPort(port)}>
                <span className="browser-port-num">:{port}</span>
                <span className="browser-port-host">localhost</span>
              </button>
            ))}
          </div>
        )}
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
