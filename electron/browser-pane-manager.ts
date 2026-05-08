import { BrowserWindow, WebContentsView, session as electronSession } from 'electron'

export interface PaneBounds {
  x: number
  y: number
  width: number
  height: number
}

interface PaneEntry {
  view: WebContentsView
  url: string
}

// Replaces the default Chromium scrollbar inside the Browser cell with a thin,
// translucent one that fades into the page. Overlay-style: it's still
// scrollable with mouse wheel, trackpad and arrow keys — just visually quiet.
// Inject on every load so SPAs that swap <html> still get it.
const SCROLLBAR_CSS = `
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: rgba(128,128,128,0.35);
    border-radius: 4px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  ::-webkit-scrollbar-thumb:hover { background: rgba(128,128,128,0.6); background-clip: padding-box; }
  ::-webkit-scrollbar-corner { background: transparent; }
`

export class BrowserPaneManager {
  private panes = new Map<string, PaneEntry>()
  private hostWindowGetter: () => BrowserWindow | null

  constructor(hostWindowGetter: () => BrowserWindow | null) {
    this.hostWindowGetter = hostWindowGetter
  }

  has(paneId: string): boolean {
    return this.panes.has(paneId)
  }

  create(paneId: string, url: string, partition: string): void {
    const win = this.hostWindowGetter()
    if (!win) throw new Error('No host window')
    if (this.panes.has(paneId)) this.destroy(paneId)

    const view = new WebContentsView({
      webPreferences: {
        session: electronSession.fromPartition(partition),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    win.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    void view.webContents.loadURL(url).catch(() => {})

    view.webContents.on('did-navigate', (_e, navUrl) => {
      const e = this.panes.get(paneId)
      if (e) e.url = navUrl
      win.webContents.send('browser:navigated', paneId, navUrl)
    })
    view.webContents.on('did-navigate-in-page', (_e, navUrl) => {
      const e = this.panes.get(paneId)
      if (e) e.url = navUrl
      win.webContents.send('browser:navigated', paneId, navUrl)
    })
    // Inject thin/quiet scrollbar styling on every full load — including
    // navigations to a different origin. insertCSS returns a key that we
    // intentionally don't track: the styles are scoped to the document and
    // get garbage-collected with it.
    view.webContents.on('did-finish-load', () => {
      void view.webContents.insertCSS(SCROLLBAR_CSS).catch(() => {})
    })

    // Zoom shortcuts. Chromium only natively binds Ctrl+= for zoom-in, but the
    // user's "Ctrl++" usually arrives as Ctrl+Shift+= on QWERTY layouts, so we
    // accept both. Also handle Ctrl+- (zoom out), Ctrl+0 (reset) and the
    // numeric-keypad variants.
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      if (!(input.control || input.meta)) return
      const k = input.key
      const isZoomIn = k === '+' || k === '=' || k === 'Add'
      const isZoomOut = k === '-' || k === '_' || k === 'Subtract'
      const isReset = k === '0'
      if (!isZoomIn && !isZoomOut && !isReset) return
      event.preventDefault()
      const wc = view.webContents
      if (isReset) {
        wc.setZoomLevel(0)
      } else {
        const next = wc.getZoomLevel() + (isZoomIn ? 0.5 : -0.5)
        // Match Chrome's range: roughly 25% — 500% (zoom level −7 to 7).
        wc.setZoomLevel(Math.max(-7, Math.min(7, next)))
      }
    })

    this.panes.set(paneId, { view, url })
  }

  reposition(paneId: string, bounds: PaneBounds): void {
    const e = this.panes.get(paneId)
    if (!e) return
    e.view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    })
  }

  navigate(paneId: string, url: string): void {
    const e = this.panes.get(paneId)
    if (!e) return
    e.url = url
    void e.view.webContents.loadURL(url).catch(() => {})
  }

  back(paneId: string): void {
    const e = this.panes.get(paneId)
    if (!e) return
    if (e.view.webContents.canGoBack()) e.view.webContents.goBack()
  }

  forward(paneId: string): void {
    const e = this.panes.get(paneId)
    if (!e) return
    if (e.view.webContents.canGoForward()) e.view.webContents.goForward()
  }

  reload(paneId: string): void {
    const e = this.panes.get(paneId)
    if (!e) return
    e.view.webContents.reload()
  }

  getUrl(paneId: string): string | null {
    return this.panes.get(paneId)?.url ?? null
  }

  destroy(paneId: string): void {
    const win = this.hostWindowGetter()
    const e = this.panes.get(paneId)
    if (!e) return
    try {
      if (win) win.contentView.removeChildView(e.view)
    } catch {}
    try {
      e.view.webContents.close()
    } catch {}
    this.panes.delete(paneId)
  }

  destroyAll(): void {
    for (const id of Array.from(this.panes.keys())) this.destroy(id)
  }
}
