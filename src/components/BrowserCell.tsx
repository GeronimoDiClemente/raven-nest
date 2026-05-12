import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PaneNode } from '../types'

interface Props {
  pane: PaneNode
  cellId: string
  onClose: () => void
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

export default function BrowserCell({ pane, cellId, onClose, borderColor, siblingPaneIds, workspaceRepoPath, siblingRepoPaths }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const placeholderRef = useRef<HTMLDivElement>(null)
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

  // Create the WebContentsView once per pane
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
  }, [pane.id])

  // Subscribe to navigation updates from main
  useEffect(() => {
    const cb = (paneId: string, navUrl: string) => {
      if (paneId !== pane.id) return
      // The BLANK_PAGE placeholder is a data: URL — showing its encoded HTML
      // in the input field is meaningless and ugly, so we keep internal state
      // but leave the input empty so the "https://" placeholder is visible.
      if (navUrl.startsWith('data:')) {
        setUrl(navUrl)
        setDraftUrl('')
        return
      }
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
      '.browser-self-origin-overlay',
      '.wt-context-menu',
      '.ide-picker-menu',
      '.repo-menu-pop',
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
    // MutationObserver fires on every xterm log line in sibling panes. Coalesce
    // to one send() per animation frame so we don't saturate the main process
    // with browser:reposition IPC when terminals are spammy.
    let rafId: number | null = null
    const sendDebounced = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => { rafId = null; send() })
    }
    send()
    const ro = new ResizeObserver(sendDebounced)
    ro.observe(el)
    window.addEventListener('resize', send)
    // Watch the body for overlay nodes appearing/disappearing.
    const mo = new MutationObserver(sendDebounced)
    mo.observe(document.body, { childList: true, subtree: true })
    const interval = setInterval(sendDebounced, 1000)  // catch parent layout shifts
    return () => {
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', send)
      clearInterval(interval)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    }
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
  const togglePorts = async () => {
    if (portsOpen) { setPortsOpen(false); return }
    try {
      // Prefer the workspace-scoped query: ports of sibling panes + procs
      // running under the workspace's linked repo. Falls back to listAll
      // when the host didn't provide context. Note: `[]` is truthy in JS, so
      // an empty siblingPaneIds list would mask the fallback — we check
      // length explicitly here.
      const useWorkspaceScope = !!workspaceRepoPath || (siblingPaneIds?.length ?? 0) > 0 || (siblingRepoPaths?.length ?? 0) > 0
      let list = useWorkspaceScope
        ? await window.port.listForWorkspace({
            repoPath: workspaceRepoPath,
            repoPaths: siblingRepoPaths ?? [],
            paneIds: siblingPaneIds ?? [],
          })
        : await window.port.listAll()
      // Fall back to system-wide scan when the workspace-scoped query returns
      // nothing — covers dev servers launched outside Nest (in another shell,
      // VS Code, Docker, etc.) so the dropdown isn't useless.
      if (list.length === 0 && useWorkspaceScope) {
        list = await window.port.listAll()
      }
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
            <div style={{
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'rgba(255, 255, 255, 0.4)',
              padding: '6px 10px 6px',
            }}>Listening ports</div>
            {openPorts.length === 0 ? (
              <div style={{ padding: '14px 12px', color: 'rgba(255, 255, 255, 0.4)', fontSize: 11.5, textAlign: 'center', letterSpacing: '0.01em' }}>
                No listening ports
              </div>
            ) : openPorts.map((port) => (
              <button
                key={port}
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
          </div>
        )}
        <button
          className="browser-btn"
          onClick={() => window.electronShell.openExternal(url)}
          title="Open in external browser"
        >↗</button>
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
