import { useEffect, useRef, useCallback } from 'react'
import { isResizeSuppressed, onResizeSettled } from '../lib/pane-resize-gate'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { registerTerminal, unregisterTerminal } from '../terminal-instances'
import { safeWriteText, safeReadText } from '../lib/clipboard'
import { isLocalUrl } from '../lib/is-local-url'

export function useXterm(paneId: string, onInput?: (data: string) => void, fontSize = 13, onResize?: (cols: number, rows: number) => void) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const onInputRef = useRef(onInput)
  onInputRef.current = onInput
  const onResizeRef = useRef(onResize)
  onResizeRef.current = onResize

  useEffect(() => {
    if (!containerRef.current) return

    const fontFamily = window.platform?.isMac
      ? '"SF Mono", "Menlo", "Monaco", monospace'
      : '"Cascadia Mono", "Cascadia Code", "Consolas", monospace'

    const term = new Terminal({
      fontFamily,
      fontSize,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      theme: {
        background: '#000000',
        foreground: '#e8e8e8',
        cursor: '#0066FF',
        cursorAccent: '#0d0d0d',
        selectionBackground: '#0066FF33',
        black: '#1a1a1a',
        red: '#ff5f57',
        green: '#28cd41',
        yellow: '#ffbd2e',
        blue: '#0066FF',
        magenta: '#b48ead',
        cyan: '#88c0d0',
        white: '#e8e8e8',
        brightBlack: '#4c4c4c',
        brightRed: '#ff6e67',
        brightGreen: '#5af78e',
        brightYellow: '#f4f99d',
        brightBlue: '#4d9eff',
        brightMagenta: '#caa9fa',
        brightCyan: '#9aedfe',
        brightWhite: '#ffffff'
      },
      scrollback: 5000,
      allowProposedApi: true
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    term.loadAddon(new WebLinksAddon((event, url) => {
      event.preventDefault()
      if (isLocalUrl(url)) {
        window.dispatchEvent(new CustomEvent('nest:pty-url', {
          detail: { paneId, url }
        }))
      } else {
        window.electronShell.openExternal(url)
      }
    }))
    term.open(containerRef.current)

    termRef.current = term
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon
    registerTerminal(paneId, term)

    // Defer initial fit so the grid layout is fully painted before measuring
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          fitAddon.fit()
          if (!isResizeSuppressed()) window.pty.resize(paneId, term.cols, term.rows, 'pane')
          onResizeRef.current?.(term.cols, term.rows)
        } catch { /* ignore */ }
        term.focus()
      })
    })

    // Ctrl+C copies if there's a selection, otherwise sends SIGINT
    // Ctrl+V pastes from clipboard
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === 'c' && term.hasSelection()) {
        void safeWriteText(term.getSelection())
        return false
      }
      if (event.ctrlKey && event.key === 'v') {
        void safeReadText().then(text => {
          if (text === null) return
          if (onInputRef.current) onInputRef.current(text)
          else window.pty.write(paneId, text)
        })
        return false
      }
      // On Linux/Windows, Ctrl+ArrowRight/Left are the pane navigation shortcuts.
      // xterm intercepts these before the window listener sees them — return false
      // so xterm skips processing and the event bubbles up to App.tsx.
      if (!window.platform?.isMac && event.ctrlKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        return false
      }

      // Edit-on-selection: when the user selects text in the active prompt line and
      // presses Backspace/Delete or types a character, translate it into cursor-move
      // + backspace sequences for the shell's readline. Replaces editor-style
      // "select-and-overwrite" without making the user reach for the arrow keys.
      // Limitations: only works on the cursor's visual row in shells with readline
      // support (PowerShell PSReadLine, bash, zsh). TUI apps (vim, less) won't work.
      if (event.type === 'keydown' && term.hasSelection()) {
        const isBackspace = event.key === 'Backspace'
        const isDelete = event.key === 'Delete'
        const isPlainChar = event.key.length === 1 && !event.metaKey && !(event.ctrlKey && !event.altKey)
        if (isBackspace || isDelete || isPlainChar) {
          const buffer = term.buffer.active
          // Skip in alternate-buffer mode (vim, less, fzf, etc). Those apps handle
          // their own keys; injecting cursor-move + DEL would corrupt files.
          if (buffer.type === 'alternate') return true
          const sel = term.getSelectionPosition()
          if (!sel) return true
          // Single visual row only — multi-row selections cross wrap boundaries the
          // shell can't reason about with simple cursor-move + backspace.
          if (sel.start.y !== sel.end.y) return true
          const cursorAbsY = buffer.baseY + buffer.cursorY
          if (sel.start.y !== cursorAbsY) return true
          // PSReadLine and bash render multi-line buffers as wrapped visual rows.
          // If this row or the previous one is part of a wrapped logical line, the
          // shell's "left arrow" doesn't map 1-to-1 with visual columns, so our
          // cursor-move math would be off. Bail and let the shell handle the key.
          const currentLine = buffer.getLine(cursorAbsY)
          const prevLine = cursorAbsY > 0 ? buffer.getLine(cursorAbsY - 1) : undefined
          if (currentLine?.isWrapped || prevLine?.isWrapped) return true
          const length = sel.end.x - sel.start.x
          if (length <= 0) return true

          // Move readline cursor from its current X to the end-of-selection X, then
          // erase `length` characters to the left, then optionally insert the typed
          // char. \x7f is DEL (what readline treats as backspace); \x1b[C/D are
          // right/left arrows.
          const moveDelta = sel.end.x - buffer.cursorX
          let seq = ''
          if (moveDelta > 0) seq += '\x1b[C'.repeat(moveDelta)
          else if (moveDelta < 0) seq += '\x1b[D'.repeat(-moveDelta)
          seq += '\x7f'.repeat(length)
          if (isPlainChar) seq += event.key

          if (onInputRef.current) onInputRef.current(seq)
          else window.pty.write(paneId, seq)
          term.clearSelection()
          event.preventDefault()
          return false
        }
      }
      return true
    })

    // Forward keyboard input — use onInput callback if provided (broadcast), else direct write
    term.onData((data) => {
      if (onInputRef.current) onInputRef.current(data)
      else window.pty.write(paneId, data)
    })

    // Re-focus terminal on click so typing always works
    const container = containerRef.current
    const onMouseDown = () => term.focus()
    container.addEventListener('mousedown', onMouseDown)

    // Prevent native paste event — Ctrl+V is handled manually in attachCustomKeyEventHandler
    // Without this, paste fires twice: once from our handler and once from xterm's onData
    const onPaste = (e: Event) => e.preventDefault()
    container.addEventListener('paste', onPaste, true)

    // Resize observer — defer to next frame so grid layout is finalized.
    // Guard against hidden-window resizes (clientWidth/Height = 0 when win.hide()
    // is called on macOS) — FitAddon would resize the terminal to 2×1 and corrupt
    // both the xterm buffer and the PTY.
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          if (!container.clientWidth || !container.clientHeight) return
          fitAddon.fit()
          if (!isResizeSuppressed()) window.pty.resize(paneId, term.cols, term.rows, 'pane')
          onResizeRef.current?.(term.cols, term.rows)
        } catch { /* ignore */ }
      })
    })
    resizeObserver.observe(container)

    // Al terminar el drag mandamos el tamano YA asentado: durante el
    // movimiento se suprimieron todos, incluidos los degenerados del reflow.
    //
    // "Asentado" no es "un frame despues de soltar": el reflow del grid y la
    // animacion de zoom siguen corriendo, y medir ahi daba formas imposibles
    // (21x6, 15x37) que el proceso tomaba como reales — la TUI repintaba y
    // cortaba las respuestas en curso. Medimos hasta que DOS lecturas
    // consecutivas coincidan, y recien ahi mandamos.
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    const offSettled = onResizeSettled(() => {
      if (settleTimer) clearTimeout(settleTimer)
      let lastKey = ''
      let tries = 0
      const check = () => {
        settleTimer = null
        try {
          if (container.clientWidth && container.clientHeight) {
            fitAddon.fit()
            const key = `${term.cols}x${term.rows}`
            if (key === lastKey) {
              window.pty.resize(paneId, term.cols, term.rows, 'settled')
              onResizeRef.current?.(term.cols, term.rows)
              return
            }
            lastKey = key
          }
        } catch { /* ignore */ }
        // ~1s de techo: si nunca se estabiliza, no insistimos para siempre.
        if (++tries < 12) settleTimer = setTimeout(check, 80)
      }
      settleTimer = setTimeout(check, 80)
    })

    // Re-fit and re-focus after the window comes back from win.hide() on macOS.
    // Without this, the terminal stays at the corrupted 2×1 dimensions until the
    // user manually resizes the window.
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      requestAnimationFrame(() => {
        try {
          fitAddon.fit()
          if (!isResizeSuppressed()) window.pty.resize(paneId, term.cols, term.rows, 'pane')
          onResizeRef.current?.(term.cols, term.rows)
        } catch { /* ignore */ }
      })
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      container.removeEventListener('mousedown', onMouseDown)
      container.removeEventListener('paste', onPaste, true)
      resizeObserver.disconnect()
      offSettled()
      if (settleTimer) clearTimeout(settleTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      unregisterTerminal(paneId)
      term.dispose()
    }

  }, [paneId])

  // Update font size without recreating the terminal
  useEffect(() => {
    if (!termRef.current || !fitAddonRef.current) return
    termRef.current.options.fontSize = fontSize
    try {
      fitAddonRef.current.fit()
      if (!isResizeSuppressed()) window.pty.resize(paneId, termRef.current.cols, termRef.current.rows, 'pane-fontsize')
    } catch { /* ignore */ }
  }, [fontSize, paneId])

  const write = useCallback((data: string) => termRef.current?.write(data), [])
  const focus = useCallback(() => termRef.current?.focus(), [])
  const resize = useCallback(() => {
    if (!fitAddonRef.current || !termRef.current) return
    try {
      fitAddonRef.current.fit()
      if (!isResizeSuppressed()) window.pty.resize(paneId, termRef.current.cols, termRef.current.rows, 'pane-fontsize')
    } catch { /* ignore */ }
  }, [paneId])

  const findNext = (query: string) =>
    searchAddonRef.current?.findNext(query, { caseSensitive: false, regex: false, incremental: true })

  const findPrev = (query: string) =>
    searchAddonRef.current?.findPrevious(query, { caseSensitive: false, regex: false, incremental: true })

  const clearSearch = () =>
    searchAddonRef.current?.findNext('', {})

  return { containerRef, write, focus, resize, findNext, findPrev, clearSearch }
}
