import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { terminalJoinService } from '../lib/terminalJoinService'

interface Props {
  onClose: () => void
}

export default function SharedTerminalViewer({ onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [fontSize, setFontSize] = useState(14)

  /**
   * El viewer NO reflowea: adopta las cols/rows del host y escala para entrar
   * en su ventana. Reflowear implicaba redimensionar el PTY del host, que le
   * rompia la terminal al que comparte (y se la dejaba rota al irse el invitado).
   */
  const applyScale = useCallback(() => {
    const cont = containerRef.current
    const el = cont?.querySelector('.xterm') as HTMLElement | null
    if (!cont || !el) return
    el.style.transformOrigin = 'top left'
    el.style.transform = 'none'
    const natW = el.offsetWidth
    const natH = el.offsetHeight
    if (!natW || !natH) return
    const k = Math.min(1, cont.clientWidth / natW, cont.clientHeight / natH)
    el.style.transform = k < 1 ? `scale(${k})` : 'none'
  }, [])

  // Ctrl+= / Ctrl+- cambia el cuerpo de la letra; las columnas siguen siendo las
  // del host, asi que solo cambia cuanto ocupa y por ende la escala.
  const applyFontSize = useCallback((size: number) => {
    if (!termRef.current) return
    termRef.current.options.fontSize = size
    requestAnimationFrame(() => applyScale())
  }, [applyScale])

  // Ctrl+= aumenta, Ctrl+- reduce (igual que VS Code / iTerm)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        setFontSize(prev => { const next = Math.min(prev + 1, 28); applyFontSize(next); return next })
      } else if (e.key === '-') {
        e.preventDefault()
        setFontSize(prev => { const next = Math.max(prev - 1, 8); applyFontSize(next); return next })
      } else if (e.key === '0') {
        e.preventDefault()
        setFontSize(14); applyFontSize(14)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [applyFontSize])

  const write = useCallback((data: string) => {
    termRef.current?.write(data)
  }, [])

  // Init xterm on mount
  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      fontSize: fontSize,
      fontFamily: '"Cascadia Mono", "Consolas", monospace',
      cursorBlink: true,
      disableStdin: false,
      theme: { background: '#0d0d0d', foreground: '#e8e8e8' },
      scrollback: 10000,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddonRef.current = fitAddon
    termRef.current = term

    requestAnimationFrame(() => {
      try {
        // Si el 'size' del host ya llego (puede adelantarse al mount), lo tomamos.
        const hs = terminalJoinService.hostSize
        if (hs) term.resize(hs.cols, hs.rows)
        applyScale()
      } catch { /* ignore */ }
    })

    // Forward guest input to host — 8ms batching to reduce broadcasts
    let inputBuffer = ''
    let inputTimer: ReturnType<typeof setTimeout> | null = null
    term.onData(data => {
      inputBuffer += data
      if (!inputTimer) {
        inputTimer = setTimeout(() => {
          if (inputBuffer) terminalJoinService.sendInput(inputBuffer)
          inputBuffer = ''
          inputTimer = null
        }, 8)
      }
    })

    // El host dicta el tamano (attachSizeListener existia y no lo llamaba nadie:
    // todos los broadcasts de 'size' se tiraban a la basura).
    terminalJoinService.attachSizeListener((cols, rows) => {
      try {
        if (cols > 0 && rows > 0) term.resize(cols, rows)
        applyScale()
      } catch { /* ignore */ }
    })

    // Replay history and attach for live data
    terminalJoinService.attachViewer(write)

    // ResizeObserver — re-escala para entrar en la ventana. NO toca las columnas
    // ni le avisa al host: su terminal no es nuestra para redimensionar.
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try { applyScale() } catch { /* ignore */ }
      })
    })
    resizeObserver.observe(containerRef.current!)

    return () => {
      resizeObserver.disconnect()
      terminalJoinService.detachViewer()
      term.dispose()
      termRef.current = null
    }
  }, [write])

  const handleDisconnect = () => {
    terminalJoinService.leave()
    onClose()
  }

  const [waitingApproval, setWaitingApproval] = useState(() => terminalJoinService.isWaitingApproval)
  const [joinError, setJoinError] = useState<string | null>(() => terminalJoinService.error)

  useEffect(() => {
    return terminalJoinService.subscribe(() => {
      setWaitingApproval(terminalJoinService.isWaitingApproval)
      setJoinError(terminalJoinService.error)
    })
  }, [])

  const code = terminalJoinService.code
  const isMac = window.platform?.isMac ?? false

  return (
    <div style={{
      position: 'fixed',
      top: 'var(--titlebar-height)',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 200,
      display: 'flex',
      flexDirection: 'column',
      background: '#0d0d0d',
    }}>
      {/* Header — follows the same pattern as TabBar (padding-left for Mac traffic lights) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `8px 16px 8px ${isMac ? 86 : 16}px`,
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <span style={{ fontSize: 11, color: waitingApproval ? '#eab308' : '#22c55e', fontWeight: 600 }}>● {waitingApproval ? 'Pending' : 'Live'}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: 2, fontFamily: 'monospace' }}>
            {code}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>— {waitingApproval ? 'Waiting for approval' : 'Interactive'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', userSelect: 'none' }}>
            {fontSize}px · Ctrl+= / Ctrl+-
          </span>
          <button
            onClick={handleDisconnect}
            style={{
              fontSize: 11,
              padding: '3px 10px',
              background: '#7f1d1d',
              color: '#fca5a5',
              border: '1px solid #991b1b',
              borderRadius: 5,
              cursor: 'pointer',
            }}
          >
            Disconnect
          </button>
          <button
            onClick={onClose}
            style={{
              fontSize: 11,
              padding: '3px 10px',
              background: 'var(--bg-elevated)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
              borderRadius: 5,
              cursor: 'pointer',
            }}
          >
            Minimize
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        {(waitingApproval || joinError) && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(13,13,13,0.75)', backdropFilter: 'blur(2px)',
          }}>
            <div style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '20px 28px', textAlign: 'center', maxWidth: 320,
            }}>
              {joinError ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fca5a5', marginBottom: 8 }}>Connection denied</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{joinError}</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Waiting for host approval</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>You can view the terminal. The host must allow input access.</div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
