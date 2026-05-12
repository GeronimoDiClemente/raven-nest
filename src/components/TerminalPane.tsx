import { useEffect, useRef, useState, useCallback } from 'react'
import { PaneNode, AI_CONFIG, ResponseBlock } from '../types'
import { useXterm } from '../hooks/useXterm'
import { addCommand } from '../lib/commandHistory'
import PaneHeader from './PaneHeader'
import BlocksView from './BlocksView'
import FileStagingBar, { StagedFile } from './FileStagingBar'
import TerminalSharePanel from './TerminalSharePanel'
import { useTerminalShare } from '../hooks/useTerminalShare'
import { terminalShareService } from '../lib/terminalShareService'
import { registerPane, unregisterPane } from '../pty-events'
import { registerTerminalFocus, unregisterTerminalFocus } from '../terminal-registry'
import { safeWriteText } from '../lib/clipboard'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const BUSY_THRESHOLD_MS = 2000
const MAX_CONV_BUFFER = 500_000 // ~500KB

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b[()][A-Z0-9]|\x1b[=>]|\x07|\r/g
const stripAnsi = (s: string) => s.replace(ANSI_RE, '')
const PROMPT_RE = /^\s*[\$\#\>❯➜]\s*$|^\s*$|^[0-9]+\s*$|\(base\)/
const LOCAL_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+(?:\/[^\s'"\x1b\x07]*)?/gi
// Claude/Gemini UI chrome: status bars, keyboard hints, spinner lines
const UI_CHROME_RE = /tab to cycle|shift\+tab|bypass|permission|esc to interrupt|working\.\.\.|thinking\.\.\.|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏|\([^)]{0,40}to [^)]{0,30}\)/i

function filterChrome(text: string): string {
  return text
    .split(/[\r\n]+/)
    .filter((l) => !UI_CHROME_RE.test(l.trim()) && !PROMPT_RE.test(l.trim()))
    .join('\n')
    .trim()
}

function extractLabel(raw: string): string {
  const lines = raw
    .split(/[\r\n]+/)
    .map((l) => stripAnsi(l).trim())
    .filter((l) => l.length > 4 && !PROMPT_RE.test(l) && !UI_CHROME_RE.test(l))
  const last = lines[lines.length - 1] ?? ''
  return last.length > 60 ? last.slice(0, 58) + '…' : last
}

interface Props {
  pane: PaneNode
  cellId: string
  isDragging: boolean
  zoomed: boolean
  zoomingOut: boolean
  onZoom: () => void
  onClose: () => void
  onColorChange: (color: string) => void
  onNoteChange: (note: string) => void
  onInput: (data: string) => void
  onBusyChange: (paneId: string, busy: boolean) => void
  onFocus: () => void
  onActivity?: (paneId: string, active: boolean) => void
  onJoinRequest?: (paneId: string) => void
  onPtyStarted?: (paneId: string, runningRepoPath: string | undefined) => void
  fontSize: number
  style?: React.CSSProperties
}

export default function TerminalPane({ pane, cellId, isDragging, zoomed, zoomingOut, onZoom, onClose, onColorChange, onNoteChange, onInput, onBusyChange, onFocus, onActivity, onJoinRequest, onPtyStarted, fontSize, style }: Props) {
  const cmdBufferRef = useRef('')
  const wrappedOnInput = useCallback((data: string) => {
    for (const ch of data) {
      if (ch === '\r') {
        const cmd = cmdBufferRef.current.replace(/[\x00-\x1F\x7F]/g, '').trim()
        if (cmd) addCommand(cmd)
        cmdBufferRef.current = ''
      } else if (ch === '\x7F') {
        cmdBufferRef.current = cmdBufferRef.current.slice(0, -1)
      } else if (ch >= ' ' || ch === '\t') {
        cmdBufferRef.current += ch
      }
    }
    onInput(data)
  }, [onInput])
  const { containerRef, write, focus, resize, findNext, findPrev, clearSearch } = useXterm(
    pane.id, wrappedOnInput, fontSize,
    useCallback((cols: number, rows: number) => {
      terminalShareService.broadcastSize(pane.id, cols, rows)
    }, [pane.id])
  )
  const { setNodeRef, attributes, listeners, transform, transition, isOver } = useSortable({ id: cellId })
  const outputBuf = useRef('')       // notification buffer (last 2000 chars)
  const convBuf = useRef('')         // full conversation buffer
  const urlScanBuf = useRef('')      // sliding window for localhost URL detection
  const seenUrlsRef = useRef<Set<string>>(new Set())
  const busyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busyStartRef = useRef<number | null>(null)
  const lastResponseRef = useRef('')
  const responseAccumRef = useRef('')
  const onFocusRef = useRef(onFocus)
  onFocusRef.current = onFocus
  const onBusyChangeRef = useRef(onBusyChange)
  onBusyChangeRef.current = onBusyChange
  const onActivityRef = useRef(onActivity)
  onActivityRef.current = onActivity
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [processEnded, setProcessEnded] = useState(false)
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([])
  const paneRef = useRef<HTMLDivElement | null>(null)
  const MAX_BLOCKS = 50
  const [blocks, setBlocks] = useState<ResponseBlock[]>([])
  const [showBlocks, setShowBlocks] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const isBusyRef = useRef(false)
  const [showShare, setShowShare] = useState(false)
  const { shareCode, isSharing, startSharing, stopSharing } = useTerminalShare(
    pane.id,
    onJoinRequest ? () => onJoinRequest(pane.id) : undefined
  )

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    setTimeout(() => searchInputRef.current?.focus(), 50)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
    clearSearch()
  }, [clearSearch])

  // Register this pane for keyboard focus navigation
  useEffect(() => {
    registerTerminalFocus(pane.id, focus)
    return () => unregisterTerminalFocus(pane.id)
  }, [pane.id, focus])

  // ⌘F to open search — only when this terminal has focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        if (!containerRef.current?.contains(document.activeElement)) return
        e.preventDefault()
        openSearch()
      }
      if (e.key === 'Escape' && searchOpen) { closeSearch() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [searchOpen, openSearch, closeSearch, containerRef])

  const saveConversation = useCallback(async () => {
    const content = stripAnsi(convBuf.current).trim()
    if (!content) return
    await window.conversations.save(pane.aiType, pane.accountName, content)
  }, [pane.aiType, pane.accountName])

  useEffect(() => {
    let alive = true
    let activityDebounce: ReturnType<typeof setTimeout> | null = null

    registerPane(pane.id, (data) => {
      if (!alive) return
      write(data)
      if (!activityDebounce) {
        onActivityRef.current?.(pane.id, true)
        activityDebounce = setTimeout(() => { activityDebounce = null }, 500)
      }

      outputBuf.current = (outputBuf.current + data).slice(-2000)
      convBuf.current = (convBuf.current + data).slice(-MAX_CONV_BUFFER)

      urlScanBuf.current = (urlScanBuf.current + data).slice(-1024)
      const clean = urlScanBuf.current.replace(ANSI_RE, '')
      LOCAL_URL_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = LOCAL_URL_RE.exec(clean)) !== null) {
        const detectedUrl = m[0]
        if (seenUrlsRef.current.has(detectedUrl)) continue
        seenUrlsRef.current.add(detectedUrl)
        window.dispatchEvent(new CustomEvent('nest:pty-url', {
          detail: { paneId: pane.id, cellId, url: detectedUrl }
        }))
      }

      if (!busyStartRef.current) {
        busyStartRef.current = Date.now()
        responseAccumRef.current = ''
      }
      responseAccumRef.current += data
      isBusyRef.current = true
      setIsBusy(true)
      onBusyChangeRef.current(pane.id, true)
      if (busyTimer.current) clearTimeout(busyTimer.current)
      busyTimer.current = setTimeout(() => {
        const duration = busyStartRef.current ? Date.now() - busyStartRef.current : 0
        busyStartRef.current = null
        const stripped = filterChrome(stripAnsi(responseAccumRef.current))
        lastResponseRef.current = stripped
        responseAccumRef.current = ''
        isBusyRef.current = false
        setIsBusy(false)
        onBusyChangeRef.current(pane.id, false)
        if (stripped.length > 0) {
          const block: ResponseBlock = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            content: stripped,
            aiType: pane.aiType,
            label: pane.customLabel ?? AI_CONFIG[pane.aiType].label,
          }
          setBlocks(prev => {
            const next = [...prev, block]
            return next.length > MAX_BLOCKS ? next.slice(next.length - MAX_BLOCKS) : next
          })
        }
        if (duration > 2000 && Notification.permission === 'granted' && !document.hasFocus()) {
          new Notification('Nest — terminal finished', {
            body: `${pane.customLabel ?? pane.aiType}${pane.accountName ? ` · ${pane.accountName}` : ''} finished responding`,
            silent: false,
          })
        }
      }, BUSY_THRESHOLD_MS)

    }, () => {
      if (!alive) return
      setProcessEnded(true)
      setIsBusy(false)
      write('\r\n\x1b[2m── process ended ──\x1b[0m\r\n')
      onBusyChangeRef.current(pane.id, false)
    })

    let createCalled = false
    const t = setTimeout(async () => {
      if (!alive) return
      createCalled = true
      const alreadyRunning = await window.pty.exists(pane.id)
      if (alreadyRunning) {
        // Reconnect: replay scroll-back buffer into xterm
        const buffer = await window.pty.getBuffer(pane.id)
        if (buffer) write(buffer)
      } else {
        const res = await window.pty.create(pane.id, pane.cmd, pane.accountDir, pane.repoPath, pane.shellId)
        if (!res.ok) {
          write(`\r\n\x1b[31m── failed to start terminal: ${res.error} ──\x1b[0m\r\n`)
          setProcessEnded(true)
        } else {
          onPtyStarted?.(pane.id, pane.repoPath)
        }
      }
      // Sync PTY size with xterm's actual dimensions
      requestAnimationFrame(() => resize())
    }, 50)

    return () => {
      alive = false
      clearTimeout(t)
      if (activityDebounce) clearTimeout(activityDebounce)
      unregisterPane(pane.id)
      // Do NOT kill the PTY — it must survive tab switches and window hide
      if (busyTimer.current) clearTimeout(busyTimer.current)
    }
    // pane.cmd and pane.repoPath are intentionally omitted: re-running this effect
    // would replay the buffer on top of existing terminal content. Live changes to
    // repoPath are propagated by App.tsx (cd into running shells). cmd changes
    // require an explicit Restart from the pane header.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id, pane.aiType, pane.accountDir])

  const handleToggleBlocks = useCallback(() => {
    setShowBlocks(prev => !prev)
  }, [])

  useEffect(() => {
    if (!showBlocks) requestAnimationFrame(() => resize())
  }, [showBlocks, resize])

  const handleCopyLastResponse = useCallback(() => {
    if (lastResponseRef.current) {
      void safeWriteText(lastResponseRef.current)
    }
  }, [])

  const handleRestart = useCallback(async () => {
    setProcessEnded(false)
    convBuf.current = ''
    outputBuf.current = ''
    const res = await window.pty.create(pane.id, pane.cmd, pane.accountDir, pane.repoPath, pane.shellId)
    if (!res.ok) {
      write(`\r\n\x1b[31m── failed to start terminal: ${res.error} ──\x1b[0m\r\n`)
      setProcessEnded(true)
    } else {
      onPtyStarted?.(pane.id, pane.repoPath)
    }
  }, [pane.id, pane.cmd, pane.accountDir, pane.repoPath, pane.shellId, write, onPtyStarted])

  const handleSyncCwd = useCallback(() => {
    void window.pty.kill(pane.id).then(() => handleRestart())
  }, [pane.id, handleRestart])

  const repoPathDiverged =
    pane.cmd !== '' &&
    !processEnded &&
    pane.runningRepoPath !== undefined &&
    pane.runningRepoPath !== pane.repoPath

  // File staging handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    const readThumbnail = (f: File): Promise<string | undefined> =>
      new Promise(resolve => {
        if (!f.type.startsWith('image/')) return resolve(undefined)
        const reader = new FileReader()
        reader.onload = (ev) => resolve(ev.target?.result as string)
        reader.onerror = () => resolve(undefined)
        reader.readAsDataURL(f)
      })

    Promise.all(files.map(async (f, i) => {
      const originalPath = window.nestUtils.getPathForFile(f)
      const thumbnail = await readThumbnail(f)
      let path = originalPath
      if (thumbnail) {
        try {
          path = await window.tempImages.copyToTemp(originalPath, i)
        } catch {
          path = originalPath
        }
      }
      return { path, name: f.name, thumbnail }
    })).then(newFiles => {
      setStagedFiles(prev => [...prev, ...newFiles])
    }).catch(console.error)
  }, [])

  // Paste image from clipboard (capture phase, fires before xterm's paste blocker)
  useEffect(() => {
    const el = paneRef.current
    if (!el) return
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          e.stopImmediatePropagation()
          const blob = item.getAsFile()
          if (!blob) continue
          const reader = new FileReader()
          reader.onload = async (ev) => {
            const dataUrl = ev.target?.result as string
            const base64 = dataUrl.split(',')[1]
            const path = await window.tempImages.save(base64)
            setStagedFiles(prev => [...prev, {
              path,
              name: `captura-${Date.now()}.png`,
              thumbnail: dataUrl,
            }])
          }
          reader.readAsDataURL(blob)
          return
        }
      }
    }
    el.addEventListener('paste', handlePaste, true)
    return () => el.removeEventListener('paste', handlePaste, true)
  }, []) // paneRef.current is set via combinedRef before effects run

  const cleanupTempFiles = useCallback((files: StagedFile[]) => {
    const tempPaths = files.filter(f => f.thumbnail).map(f => f.path)
    if (tempPaths.length > 0) window.tempImages.cleanup(tempPaths).catch(() => {})
  }, [])

  const handleStagingSend = useCallback((message: string) => {
    if (stagedFiles.length === 0) return
    const msg = message.trim()
    // Images use @path so Claude Code attaches them multimodally via subscription
    // Other files use @path as file context
    const refs = stagedFiles.map(f => `@"${f.path}"`).join(' ')
    onInput(`\x15${msg ? msg + ' ' : ''}${refs}\n`)
    setStagedFiles([])
    focus()
  }, [stagedFiles, onInput, focus])

  const handleStagingRemove = useCallback((path: string) => {
    setStagedFiles(prev => {
      const removed = prev.find(f => f.path === path)
      if (removed?.thumbnail) window.tempImages.cleanup([path]).catch(() => {})
      const next = prev.filter(f => f.path !== path)
      if (next.length === 0) focus()
      return next
    })
  }, [focus])

  const sortableStyle: React.CSSProperties = {
    ...style,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    outline: isOver && !isDragging ? '2px solid #0066FF66' : undefined,
    outlineOffset: isOver && !isDragging ? '-2px' : undefined,
    '--pane-color': pane.borderColor,
  } as React.CSSProperties

  const combinedRef = useCallback((el: HTMLDivElement | null) => {
    setNodeRef(el)
    paneRef.current = el
  }, [setNodeRef])

  return (
    <div
      ref={combinedRef}
      className={`terminal-pane${zoomed ? ' zoomed' : ''}${zoomed && zoomingOut ? ' zooming-out' : ''}`}
      style={sortableStyle}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <PaneHeader
        pane={pane}
        zoomed={zoomed}
        onZoom={onZoom}
        onClose={onClose}
        onColorChange={onColorChange}
        dragHandleProps={{ ...listeners, ...attributes }}
        processEnded={processEnded}
        isBusy={isBusy}
        onRestart={handleRestart}
        onSaveConversation={saveConversation}
        onCopyLastResponse={handleCopyLastResponse}
        onNoteChange={onNoteChange}
        showBlocks={showBlocks}
        blockCount={blocks.length}
        onToggleBlocks={handleToggleBlocks}
        onShare={() => setShowShare(v => !v)}
        isSharing={isSharing}
        repoPathDiverged={repoPathDiverged}
        onSyncCwd={handleSyncCwd}
      />
      {searchOpen && (
        <div className="search-bar">
          <input
            ref={searchInputRef}
            className="search-input"
            placeholder="Search…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              if (e.target.value) findNext(e.target.value)
              else clearSearch()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.shiftKey ? findPrev(searchQuery) : findNext(searchQuery)
              }
              if (e.key === 'Escape') closeSearch()
            }}
          />
          <button className="search-nav-btn" onClick={() => findPrev(searchQuery)} title="Previous (⇧Enter)">↑</button>
          <button className="search-nav-btn" onClick={() => findNext(searchQuery)} title="Next (Enter)">↓</button>
          <button className="search-close-btn" onClick={closeSearch}>×</button>
        </div>
      )}
      <div
        ref={containerRef}
        className="terminal-container"
        style={{ display: showBlocks ? 'none' : undefined }}
        onMouseDown={() => onFocusRef.current()}
      />
      {showBlocks && <BlocksView blocks={blocks} pane={pane} />}
      {stagedFiles.length > 0 && (
        <FileStagingBar
          files={stagedFiles}
          onRemove={handleStagingRemove}
          onSend={handleStagingSend}
          onCancel={() => { cleanupTempFiles(stagedFiles); setStagedFiles([]); focus() }}
        />
      )}
      {showShare && (
        <div style={{ position: 'absolute', top: 32, right: 8, zIndex: 50, maxWidth: 'calc(100% - 16px)' }}>
          <TerminalSharePanel
            shareCode={shareCode}
            isSharing={isSharing}
            onStartSharing={startSharing}
            onStopSharing={stopSharing}
            onClose={() => setShowShare(false)}
          />
        </div>
      )}
    </div>
  )
}
