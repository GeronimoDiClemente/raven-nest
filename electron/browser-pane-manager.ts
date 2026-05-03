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
