import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PaneNode } from '../types'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Props {
  pane: PaneNode
  onClose: () => void
  // Called when the WebContentsView navigates so the parent can persist the
  // current URL on the pane model. Without this, switching workspaces destroys
  // the view and the pane re-mounts with the original (placeholder) URL.
  onNavigate?: (url: string) => void
  borderColor?: string
  // Other pane ids in the same workspace tab. Used to filter the port
  // dropdown to "what's running in this workspace" instead of the whole OS.
  siblingPaneIds?: string[]
  // The workspace's linked repo/worktree path. When set, processes whose
  // ExecutablePath/CommandLine reference this path are also included
  // (catches dev servers launched outside Nest).
  workspaceRepoPath?: string | undefined
  // Per-pane repoPaths from every sibling cell. Critical when the dev
  // server runs from a worktree that's a SIBLING of the tab's repo root —
  // workspaceRepoPath alone would miss it. Each path is scanned for
  // external processes independently.
  siblingRepoPaths?: string[]
  // Zoom: este browser está maximizado (ocupa todo el workspace). El
  // WebContentsView es una capa nativa sin z-index, así que el zoom se
  // coordina reposicionando el view (ver el effect de reposition).
  zoomed?: boolean
  zoomingOut?: boolean
  // Maximiza/restaura este pane (botón de la barra).
  onZoom?: () => void
  // Hay un drag de panes en curso (cualquiera). El WebContentsView nativo
  // pinta sobre el DOM sin z-index, así que taparía el fantasma del drag —
  // lo colapsamos mientras dura el arrastre.
  dragging?: boolean
}

const HEADER_HEIGHT = 36

function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u)
}

// Dark placeholder loaded into the WebContentsView when the user hasn't
// navigated anywhere yet. Replaces the default Chromium error page (white)
// that used to show because we'd load `http://localhost:3000` blindly and
// it'd fail with ERR_CONNECTION_REFUSED on machines without a dev server
// there. Pure HTML data URL — no network, no preload needed.
const BLANK_PAGE = 'data:text/html;charset=utf-8,' + encodeURIComponent(
  `<!doctype html><html><head><meta charset="utf-8"><style>` +
  `html,body{margin:0;height:100%;background:#0a0a0a;color:#666;` +
  `font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;` +
  `display:flex;align-items:center;justify-content:center;font-size:12px;` +
  `letter-spacing:0.02em;text-align:center;padding:24px;box-sizing:border-box}` +
  `.h{font-size:13px;color:#aaa;font-weight:500;margin-bottom:6px}` +
  `kbd{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:3px;` +
  `padding:1px 5px;font-size:11px;color:#999;margin:0 2px}` +
  `</style></head><body><div>` +
  `<div class="h">Browser pane ready</div>` +
  `Type a URL above, or click <kbd>:</kbd> to pick a listening port.` +
  `</div></body></html>`
)

// Detects when a URL points at the renderer's own origin (Nest's vite dev
// server in dev, `app://` in packaged builds). Loading the parent renderer
// inside a child WebContentsView produces a blank page — the renderer's JS
// expects Electron preload globals (`window.pty`, `window.electron`, etc.)
// that a plain WebContentsView doesn't expose. We intercept the navigation
// and show a friendly explanation instead.
function isOwnOrigin(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    return u.origin === window.location.origin
  } catch {
    return false
  }
}

export default function BrowserCell({ pane, onClose, onNavigate, borderColor, siblingPaneIds, workspaceRepoPath, siblingRepoPaths, zoomed = false, zoomingOut = false, onZoom, dragging = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { setNodeRef: setSortableRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: pane.id })
  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Como terminal/editor: al arrastrar, la celda origen se atenúa (el
    // WebContentsView ya se colapsa aparte) en vez de quedar sólida en la grilla.
    opacity: isDragging ? 0.3 : 1,
  }
  const setNodeRef = (el: HTMLDivElement | null) => {
    setSortableRef(el)
    ;(containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
  }
  const placeholderRef = useRef<HTMLDivElement>(null)
  // send() (en el effect de reposition) lee esto para no colapsar el view
  // cuando ESTE browser es el que está zoomeado — hay que agrandarlo.
  const zoomedRef = useRef(zoomed)
  zoomedRef.current = zoomed
  // Mientras se arrastra ESTE browser, el pane real queda quieto (dnd-kit lo
  // "levanta" a un overlay). Colapsamos el WebContentsView para que no quede
  // el contenido nativo clavado atrás; la foto del contenido la muestra el
  // overlay (ver pane snapshot en App).
  const hiddenForDragRef = useRef(false)
  // Cualquier drag de panes (no sólo el de este browser): el fantasma DOM del
  // DragOverlay pasaría por debajo del WebContentsView nativo. Lo colapsamos
  // mientras dure el arrastre y vuelve al soltar.
  hiddenForDragRef.current = isDragging || dragging
  const createdRef = useRef(false)
  const [url, setUrl] = useState<string>(pane.url ?? 'about:blank')
  // Hide data: URLs (BLANK_PAGE placeholder) from the input — they're internal
  // implementation, not navigable addresses the user typed or wants to share.
  const initialDraft = pane.url && !pane.url.startsWith('data:') ? pane.url : ''
  const [draftUrl, setDraftUrl] = useState<string>(initialDraft)
  const [isUntouched, setIsUntouched] = useState<boolean>(!isHttpUrl(pane.url ?? ''))
  const isUntouchedRef = useRef<boolean>(!isHttpUrl(pane.url ?? ''))
  // Set to the URL the user attempted to navigate to when it matches the
  // renderer's own origin. Renders a notice instead of letting the cell go
  // blank (see `isOwnOrigin` above).
  const [selfOriginAttempt, setSelfOriginAttempt] = useState<string | null>(null)

  // Create the WebContentsView once per pane. Also tear down + recreate when
  // sessionPartition changes — partitions are wired at view-create time in
  // main and can't be swapped on an existing WebContentsView, so changing
  // tab/workspace requires destroying and re-creating the view (otherwise
  // cookies/localStorage from the wrong session bleed through).
  useEffect(() => {
    if (createdRef.current) return
    const initialUrl = isHttpUrl(pane.url ?? '') ? pane.url! : BLANK_PAGE
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
  }, [pane.id, pane.sessionPartition])

  // Latest onNavigate kept in a ref so the long-lived subscription below
  // always calls the freshest closure without re-subscribing on every render.
  const onNavigateRef = useRef(onNavigate)
  useEffect(() => { onNavigateRef.current = onNavigate }, [onNavigate])

  // Subscribe to navigation updates from main
  useEffect(() => {
    const cb = (paneId: string, navUrl: string) => {
      if (paneId !== pane.id) return
      // The BLANK_PAGE placeholder is a data: URL — showing its encoded HTML
      // in the input field is meaningless and ugly, so we keep internal state
      // but leave the input empty so the "https://" placeholder is visible.
      // Also: don't propagate it to the pane model, otherwise we'd persist the
      // placeholder as if it were a user navigation.
      if (navUrl.startsWith('data:')) {
        setUrl(navUrl)
        setDraftUrl('')
        return
      }
      setUrl(navUrl)
      setDraftUrl(navUrl)
      onNavigateRef.current?.(navUrl)
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
      const ce = e as CustomEvent<{ paneId: string; url: string }>
      const sourceEl = document.querySelector(`[data-pane-id="${ce.detail.paneId}"]`)
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
      if (isOwnOrigin(ce.detail.url)) {
        setSelfOriginAttempt(ce.detail.url)
        setDraftUrl(ce.detail.url)
        return
      }
      setSelfOriginAttempt(null)
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
      // Zoom de OTRO pane: su backdrop cubre todo, así que el browser debe
      // colapsar para no taparlo. Si ESTE browser es el zoomeado, send() lo
      // excluye vía zoomedRef y lo agranda en su lugar.
      '.zoom-backdrop',
      // Dialogs / modals (full-screen backdrops)
      '.dialog-overlay',
      '.confirm-overlay',
      '.team-modal-overlay',
      '.modal-overlay',
      '.cmd-overlay',
      '.global-search-overlay',
      '.repo-picker-overlay',
      '.repo-picker-modal',
      '.upgrade-modal',
      // Full-screen workspace views
      '.teams-workspace',
      // Sidebars / panels
      '.snippet-panel',
      '.mcp-panel',
      '.notification-panel',
      '.conv-overlay',
      '.conv-sidebar',
      '.diff-drawer',
      '.repo-status-panel',
      '.ts-panel',
      // Popovers / inline overlays
      '.layout-popover',
      '.layout-selector-popover',
      '.user-menu-popover',
      '.cmd-panel',
      '.pane-color-popover',
      '.resource-bar-popover',
      '.rb-overlay',
      '.port-chips-popover',
      '.wt-context-menu',
      '.ide-picker-menu',
      '.repo-menu-pop',
      // Pane-level overlays
      '.browser-port-dropdown',
      '.browser-self-origin-overlay',
    ].join(', ')

    const computeBounds = (): { x: number; y: number; width: number; height: number } => {
      // Si el drag oculta este browser, colapsar (la foto la muestra el overlay).
      if (hiddenForDragRef.current) return { x: 0, y: 0, width: 0, height: 0 }
      // Si ESTE browser está zoomeado, ignorar el colapso por overlay: el
      // .zoom-backdrop está en el DOM pero acá hay que AGRANDAR el view al rect
      // (fullscreen por la clase .browser-cell.zoomed), no ocultarlo.
      if (!zoomedRef.current && document.querySelector(OVERLAY_SELECTOR)) {
        return { x: 0, y: 0, width: 0, height: 0 }
      }
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, width: r.width, height: r.height }
    }

    // Reposición en TIEMPO REAL: un loop de requestAnimationFrame recalcula el
    // rect cada frame y sólo emite IPC cuando cambió (dedupe por string). Un
    // ResizeObserver no alcanza: no detecta cambios de POSICIÓN — reordenar
    // panes, abrir un pane hermano o la animación de zoom mueven el browser sin
    // redimensionarlo, y el WebContentsView (capa nativa) quedaba clavado en la
    // posición vieja hasta el siguiente tick. getBoundingClientRect por frame es
    // barato y el IPC sólo sale en cambios, así que en reposo no hay tráfico.
    let raf = 0
    let last = ''
    const tick = () => {
      const b = computeBounds()
      const key = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}`
      if (key !== last) {
        last = key
        void window.browser.reposition(pane.id, b)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pane.id])

  const submitUrl = () => {
    const next = draftUrl.trim()
    if (!next) return
    const normalized = isHttpUrl(next) ? next : `https://${next}`
    isUntouchedRef.current = false
    setIsUntouched(false)
    if (isOwnOrigin(normalized)) {
      setSelfOriginAttempt(normalized)
      return
    }
    setSelfOriginAttempt(null)
    void window.browser.navigate(pane.id, normalized)
  }

  const portBtnRef = useRef<HTMLButtonElement>(null)
  const [portsOpen, setPortsOpen] = useState(false)
  const [openPorts, setOpenPorts] = useState<number[]>([])
  const [portsAnchor, setPortsAnchor] = useState<{ top: number; right: number } | null>(null)
  const [showAll, setShowAll] = useState(() =>
    localStorage.getItem('nest.browserCell.showAll') === '1'
  )
  const [systemPorts, setSystemPorts] = useState<number[]>([])
  const togglePorts = async () => {
    if (portsOpen) { setPortsOpen(false); return }
    try {
      const filtered = await window.port.listForWorkspace({
        repoPath: workspaceRepoPath,
        repoPaths: siblingRepoPaths ?? [],
        paneIds: siblingPaneIds ?? [],
      })
      setOpenPorts(filtered)
      if (showAll) {
        const all = await window.port.listAll()
        setSystemPorts(all.filter(p => !filtered.includes(p)))
      } else {
        setSystemPorts([])
      }
    } catch {
      setOpenPorts([])
      setSystemPorts([])
    }
    const rect = portBtnRef.current?.getBoundingClientRect()
    if (rect) setPortsAnchor({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    setPortsOpen(true)
  }
  const onToggleShowAll = async (next: boolean) => {
    setShowAll(next)
    localStorage.setItem('nest.browserCell.showAll', next ? '1' : '0')
    if (next) {
      try {
        const all = await window.port.listAll()
        setSystemPorts(all.filter(p => !openPorts.includes(p)))
      } catch {
        setSystemPorts([])
      }
    } else {
      setSystemPorts([])
    }
  }
  const goToPort = (port: number) => {
    const url = `http://localhost:${port}`
    setDraftUrl(url)
    isUntouchedRef.current = false
    setIsUntouched(false)
    setPortsOpen(false)
    if (isOwnOrigin(url)) {
      setSelfOriginAttempt(url)
      return
    }
    setSelfOriginAttempt(null)
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
      ref={setNodeRef}
      className={`browser-cell${zoomed ? ' zoomed' : ''}${zoomed && zoomingOut ? ' zooming-out' : ''}`}
      data-pane-id={pane.id}
      data-browser-untouched={isUntouched ? 'true' : undefined}
      style={{ ...sortableStyle, '--pane-color': accent } as React.CSSProperties}
    >
      <div className="browser-header" style={{ height: HEADER_HEIGHT }}>
        <span className="browser-drag-handle" {...listeners} {...attributes} />
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
            style={{
              position: 'fixed',
              top: portsAnchor.top,
              right: portsAnchor.right,
              zIndex: 100,
              minWidth: 220,
              maxWidth: 320,
              background: 'rgba(22, 22, 24, 0.92)',
              backdropFilter: 'blur(22px) saturate(180%)',
              WebkitBackdropFilter: 'blur(22px) saturate(180%)',
              border: '1px solid rgba(255, 255, 255, 0.09)',
              borderRadius: 10,
              padding: 6,
              boxShadow: '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 12px 36px rgba(0, 0, 0, 0.6), 0 4px 10px rgba(0, 0, 0, 0.4)',
              overflow: 'hidden',
              animation: 'browser-port-dropdown-in 140ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div className="ports-section-label">Listening ports — Nest</div>
            {openPorts.length === 0 ? (
              <div className="ports-empty">No ports detected in this workspace.</div>
            ) : (
              openPorts.map((port) => (
                <button
                  key={port}
                  className="ports-item"
                  onClick={() => goToPort(port)}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'flex-start',
                    gap: 8,
                    width: '100%',
                    background: 'transparent',
                    border: 0,
                    outline: 0,
                    color: '#fff',
                    padding: '8px 12px',
                    borderRadius: 7,
                    cursor: 'pointer',
                    textAlign: 'left',
                    font: 'inherit',
                    fontSize: 13,
                    WebkitAppearance: 'none',
                    appearance: 'none',
                    marginTop: 1,
                    transition: 'background 120ms ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: 13, fontWeight: 400 }}>localhost</span>
                  <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: '#0066FF', fontWeight: 600, fontSize: 13, letterSpacing: '0.02em' }}>:{port}</span>
                </button>
              ))
            )}
            {showAll && systemPorts.length > 0 && (
              <>
                <div className="ports-section-label ports-section-label--muted">Other system ports</div>
                {systemPorts.map((port) => (
                  <button
                    key={`sys-${port}`}
                    className="ports-item ports-item--muted"
                    onClick={() => goToPort(port)}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'flex-start',
                      gap: 8,
                      width: '100%',
                      background: 'transparent',
                      border: 0,
                      outline: 0,
                      color: '#fff',
                      padding: '8px 12px',
                      borderRadius: 7,
                      cursor: 'pointer',
                      textAlign: 'left',
                      font: 'inherit',
                      fontSize: 13,
                      WebkitAppearance: 'none',
                      appearance: 'none',
                      marginTop: 1,
                      transition: 'background 120ms ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: 13, fontWeight: 400 }}>localhost</span>
                    <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: '#0066FF', fontWeight: 600, fontSize: 13, letterSpacing: '0.02em' }}>:{port}</span>
                  </button>
                ))}
              </>
            )}
            <label className="ports-toggle">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => void onToggleShowAll(e.target.checked)}
              />
              <span>Show other system ports</span>
            </label>
          </div>
        )}
        <button
          className="browser-btn"
          onClick={() => window.electronShell.openExternal(url)}
          title="Open in external browser"
        >↗</button>
        {onZoom && (
          <button className="browser-btn" onClick={onZoom} title={zoomed ? 'Restore' : 'Zoom'}>⤢</button>
        )}
        <button className="browser-btn browser-btn-close" onClick={onClose} title="Close">×</button>
      </div>
      <div ref={placeholderRef} className="browser-placeholder">
        {selfOriginAttempt && (
          <div className="browser-self-origin-overlay" role="status">
            <div className="browser-self-origin-icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12 7v6M12 16v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <div className="browser-self-origin-title">Can&apos;t load Nest&apos;s own URL here</div>
            <div className="browser-self-origin-body">
              <code>{selfOriginAttempt}</code> is Nest&apos;s own renderer. It expects the Electron preload
              ({' '}<code>window.pty</code>, etc.) which isn&apos;t exposed to embedded browser panes.
            </div>
            <div className="browser-self-origin-actions">
              <button
                className="browser-self-origin-btn browser-self-origin-btn--primary"
                onClick={() => { window.electronShell.openExternal(selfOriginAttempt); }}
              >Open in external browser</button>
              <button
                className="browser-self-origin-btn"
                onClick={() => { setSelfOriginAttempt(null); setDraftUrl('') }}
              >Dismiss</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
