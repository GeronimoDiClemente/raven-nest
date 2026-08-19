import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { BridgeProvider } from '../../lib/bridge'
import { EditorPane } from '../../components/EditorPane'
import { stashTabBuffer, takeTabBuffer, __resetHandoffForTests } from '../../lib/editor-buffer-handoff'
import { modelPathFor } from '../../lib/editor-model-path'
import type { PaneNode } from '../../types'

// Real Monaco's onChange reports the model's raw text verbatim (it keeps its
// own text buffer, not a native <textarea>.value) — including literal '\r\n'.
// A native <textarea> normalizes '\r\n' to '\n' on both the DOM value setter
// and on read, so routing test input through fireEvent.change on the stub
// textarea silently strips the very characters these tests need to send.
// Stashing the latest onChange lets tests invoke it directly, bypassing that
// DOM normalization, same as real Monaco would report it.
const monacoStub = vi.hoisted(() => ({
  latestOnChange: null as ((v: string) => void) | null,
  lastOptions: undefined as unknown,
  lastTheme: undefined as string | undefined,
  lastLanguage: undefined as string | undefined,
  lastPath: undefined as string | undefined,
  latestOnMount: null as ((editor: unknown, monaco: unknown) => void) | null,
}))

vi.mock('@monaco-editor/react', () => ({
  // El componente real corre NO-controlado (defaultValue) — el stub refleja
  // el prop en cada re-render para que los tests puedan asertar contenido
  // tras cargas/recargas (que en producción llegan vía setModelText).
  default: ({ defaultValue, onChange, options, theme, language, path, onMount }: { defaultValue: string; onChange: (v: string | undefined) => void; options?: unknown; theme?: string; language?: string; path?: string; onMount?: (editor: unknown, monaco: unknown) => void }) => {
    monacoStub.latestOnChange = onChange
    monacoStub.lastOptions = options
    monacoStub.lastTheme = theme
    monacoStub.lastLanguage = language
    monacoStub.lastPath = path
    monacoStub.latestOnMount = onMount ?? null
    return <textarea data-testid="monaco-stub" value={defaultValue} onChange={(e) => onChange(e.target.value)} />
  },
}))

// shiki mockeado entero: estos tests validan el WIRING (cuándo se llama
// applyTheme/ensureLanguage y qué language recibe Monaco), no shiki en sí —
// eso lo cubre shiki-monaco.test.ts.
const shikiMock = vi.hoisted(() => ({
  applyTheme: vi.fn().mockResolvedValue(true),
  ensureLanguage: vi.fn().mockResolvedValue('typescript'),
}))
// monaco-setup real importa monaco-editor entero — en jsdom ni hace falta
vi.mock('../../lib/monaco-setup', () => ({}))

vi.mock('../../lib/shiki-monaco', () => ({
  applyTheme: shikiMock.applyTheme,
  ensureLanguage: shikiMock.ensureLanguage,
  isMonacoBuiltinTheme: (name: string) => ['vs', 'vs-dark', 'hc-black', 'hc-light'].includes(name),
}))

function makePane(overrides: Partial<PaneNode> = {}): PaneNode {
  return {
    id: 'pane-1',
    aiType: 'editor',
    accountName: '',
    accountDir: '',
    borderColor: '#000',
    cmd: '',
    repoPath: '/repo',
    editorTabs: [{ relPath: 'a.ts', dirty: false }],
    activeEditorTabPath: 'a.ts',
    ...overrides,
  }
}

function makeMockBridge() {
  let changeCb: ((wt: string, rel: string) => void) | null = null
  const fs = {
    readFile: vi.fn().mockResolvedValue({ ok: true, content: 'hello' }),
    writeFile: vi.fn().mockResolvedValue({ ok: true }),
    watch: vi.fn().mockResolvedValue({ ok: true }),
    unwatch: vi.fn().mockResolvedValue(undefined),
    onChanged: vi.fn((cb: (wt: string, rel: string) => void) => {
      changeCb = cb
      return () => { changeCb = null }
    }),
  }
  const bridge = { fs } as unknown as Window & typeof globalThis
  return { bridge, fireChange: (wt: string, rel: string) => changeCb?.(wt, rel) }
}

// Simulates the real IPC round-trip: `watch()` only "registers" the file
// (adds it to `registry`) after an async delay — mirroring the main-process
// `fs:watch` handler which awaits `resolveScoped` before touching the
// chokidar-backed FsWatchRegistry. `unwatch()` resolves fast and always
// removes the entry — mirroring the main-process behavior. This lets a
// rapid watch-effect cleanup+setup (from a churned `tabs` array reference)
// genuinely race unless the caller sequences watch/unwatch calls per key.
// Mirrors ExplorerPanel.test.tsx's makeRaceMockBridge for the same bug class.
function makeRaceMockBridge() {
  const registry = new Set<string>()
  const opLog: string[] = []
  const fs = {
    readFile: vi.fn().mockResolvedValue({ ok: true, content: 'hello' }),
    writeFile: vi.fn().mockResolvedValue({ ok: true }),
    watch: vi.fn().mockImplementation((wt: string, relPath: string) => new Promise((resolve) => {
      setTimeout(() => {
        registry.add(`${wt}::${relPath}`)
        opLog.push(`watch:${relPath}`)
        resolve({ ok: true })
      }, 10)
    })),
    unwatch: vi.fn().mockImplementation((wt: string, relPath: string) => new Promise<void>((resolve) => {
      setTimeout(() => {
        registry.delete(`${wt}::${relPath}`)
        opLog.push(`unwatch:${relPath}`)
        resolve()
      }, 0)
    })),
    onChanged: vi.fn(() => () => {}),
  }
  const bridge = { fs } as unknown as Window & typeof globalThis
  return { bridge, registry, opLog }
}

// El Monaco REAL dispara onDidChangeModelContent (→ onChange del wrapper)
// también para setValue PROGRAMÁTICO — el de las cargas de disco vía
// setModelText. Sin emularlo, la suite no ve que cada carga marcaba la tab
// dirty sin que el usuario tocara nada (visto en vivo en la demo del caso 3,
// 2026-08-18: ambas tabs dirty con una sola editada).
describe('cargas de disco vs onChange de Monaco', () => {
  afterEach(() => vi.clearAllMocks())

  function makeEchoingMonaco() {
    let value = ''
    const model = {
      uri: { path: modelPathFor('/repo', 'a.ts') },
      getValue: () => value,
      setValue: vi.fn((v: string) => { value = v; monacoStub.latestOnChange?.(v) }),
    }
    return { model, monaco: { editor: { setTheme: vi.fn(), getModels: vi.fn(() => [model]), setModelLanguage: vi.fn() } } }
  }

  // La carga INICIAL ahora llega por defaultValue (el editor recién monta con
  // el contenido ya leído, ver finding #1). El path de setModelText→setValue
  // que dispara onChange programático es la RECARGA por watcher (tab limpia,
  // el archivo cambió en disco): ésa tampoco debe marcar la tab dirty.
  it('a disk RELOAD writing the model does not mark the tab dirty', async () => {
    const { bridge, fireChange } = makeMockBridge()
    const onTabsChange = vi.fn()
    const { model, monaco } = makeEchoingMonaco()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={onTabsChange} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    // Carga inicial: el editor monta con el contenido del disco (defaultValue).
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    act(() => { monacoStub.latestOnMount?.({}, monaco) })
    // El archivo cambia en disco → recarga programática vía setModelText.
    ;(bridge.fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, content: 'hello v2' })
    await act(async () => { fireChange('/repo', 'a.ts') })
    expect(model.setValue).toHaveBeenCalledWith('hello v2')
    const dirtyCalls = onTabsChange.mock.calls.filter(
      (call) => (call[0] as Array<{ dirty: boolean }>).some((t) => t.dirty),
    )
    expect(dirtyCalls).toEqual([])
  })

  it('a real user edit after the load still marks the tab dirty', async () => {
    const { bridge } = makeMockBridge()
    const onTabsChange = vi.fn()
    const { monaco } = makeEchoingMonaco()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={onTabsChange} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    act(() => { monacoStub.latestOnMount?.({}, monaco) })
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    act(() => { monacoStub.latestOnChange?.('hello editado') })
    await waitFor(() => expect(onTabsChange).toHaveBeenCalledWith(
      [expect.objectContaining({ relPath: 'a.ts', dirty: true })], 'a.ts',
    ))
  })
})

// "Open in new pane" con una tab dirty perdía el edit sin guardar: contents
// es estado del EditorPane viejo y el pane nuevo carga de disco (confirmado
// en vivo, caso 4d del sweep 2026-08-18). La mudanza ahora PRESERVA el
// buffer vía editor-buffer-handoff — origen stashea, destino consume.
describe('Open in new pane con cambios sin guardar', () => {
  afterEach(() => vi.clearAllMocks())

  // Dos tabs: con una sola, el botón de mover ni se renderiza (ver test de
  // abajo) — mover la única tab a "un pane nuevo" es un no-op conceptual.
  function renderMove(dirty: boolean) {
    const { bridge } = makeMockBridge()
    const onOpenInNewPane = vi.fn()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({
            editorTabs: [{ relPath: 'a.ts', dirty }, { relPath: 'b.ts', dirty: false }],
            activeEditorTabPath: 'a.ts',
          })}
          onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={onOpenInNewPane}
        />
      </BridgeProvider>,
    )
    return { bridge, onOpenInNewPane }
  }
  // El botón de mover de la tab a.ts (la primera).
  const moveBtn = () => screen.getAllByTitle('Open in new pane')[0]

  // Mover la ÚNICA tab de un pane a "un pane nuevo" es un no-op conceptual:
  // ya está sola en su propio pane. Ofrecer el botón igual dejaba un pane
  // cascarón sin tabs (negro, incerrable) por cada click — visto en vivo
  // en la demo del caso 9 (2026-08-18).
  it('hides the move button when the tab is the pane only tab', async () => {
    const { bridge } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({ editorTabs: [{ relPath: 'a.ts', dirty: false }], activeEditorTabPath: 'a.ts' })}
          onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    expect(screen.queryByTitle('Open in new pane')).not.toBeInTheDocument()
  })

  it('moves a clean tab immediately, without banner', async () => {
    const { onOpenInNewPane } = renderMove(false)
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    fireEvent.click(moveBtn())
    expect(onOpenInNewPane).toHaveBeenCalledWith('a.ts')
    expect(screen.queryByTestId('move-dirty-banner')).not.toBeInTheDocument()
  })

  // La mudanza PRESERVA el buffer sin guardar vía el handoff (deja el banner
  // "Save & move" obsoleto): el origen stashea al iniciar el gesto y el
  // destino consume el stash en su carga, en vez de leer disco.
  it('moving a dirty tab stashes its buffer and moves immediately', async () => {
    __resetHandoffForTests()
    const { onOpenInNewPane } = renderMove(true)
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    act(() => { monacoStub.latestOnChange?.('hello editado') })
    fireEvent.click(moveBtn())
    expect(onOpenInNewPane).toHaveBeenCalledWith('a.ts')
    expect(screen.queryByTestId('move-dirty-banner')).not.toBeInTheDocument()
    expect(takeTabBuffer('/repo', 'a.ts')).toEqual({ content: 'hello editado', eol: '\n', dirty: true })
  })

  // ── Drag & drop de tabs entre panes / archivos del Explorer ──
  function makeDataTransfer() {
    const data: Record<string, string> = {}
    return {
      data,
      types: [] as string[],
      effectAllowed: '',
      dropEffect: '',
      setData(type: string, value: string) { data[type] = value; this.types.push(type) },
      getData(type: string) { return data[type] ?? '' },
    }
  }

  it('dragging a tab stashes its buffer and carries the move payload', async () => {
    __resetHandoffForTests()
    renderMove(true)
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    act(() => { monacoStub.latestOnChange?.('hello arrastrado') })
    const dt = makeDataTransfer()
    fireEvent.dragStart(screen.getByText('a.ts'), { dataTransfer: dt })
    expect(JSON.parse(dt.getData('application/x-nest-editor-tab'))).toEqual({
      sourcePaneId: 'pane-1', relPath: 'a.ts', dirty: true, worktreePath: '/repo',
    })
    expect(takeTabBuffer('/repo', 'a.ts')?.content).toBe('hello arrastrado')
  })

  // Protocolo dirty-only: una tab limpia tiene su contenido EN disco, así
  // que no stashea (el destino lee disco, correcto) — y un stash rancio de
  // un drag cancelado jamás se consume porque solo una tab que LLEGA dirty
  // consume, y toda llegada dirty viene de un gesto que stashea fresco.
  it('dragging a clean tab does not stash (disk already matches)', async () => {
    __resetHandoffForTests()
    renderMove(false)
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    const dt = makeDataTransfer()
    fireEvent.dragStart(screen.getByText('a.ts'), { dataTransfer: dt })
    expect(JSON.parse(dt.getData('application/x-nest-editor-tab')).dirty).toBe(false)
    expect(takeTabBuffer('/repo', 'a.ts')).toBeUndefined()
  })

  it('a clean incoming tab ignores a lingering stash and reads disk', async () => {
    __resetHandoffForTests()
    stashTabBuffer('/repo', 'a.ts', { content: 'rancio de un drag cancelado', eol: '\n', dirty: true })
    const { bridge } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({ editorTabs: [{ relPath: 'a.ts', dirty: false }], activeEditorTabPath: 'a.ts' })}
          onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    expect((bridge as unknown as { fs: { readFile: ReturnType<typeof vi.fn> } }).fs.readFile).toHaveBeenCalled()
  })

  it('dropping a tab payload on the pane reports the move (same worktree only)', async () => {
    __resetHandoffForTests()
    const { bridge } = makeMockBridge()
    const onTabDropped = vi.fn()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({ id: 'dest-pane' })}
          onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
          onTabDropped={onTabDropped}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    const dt = makeDataTransfer()
    dt.setData('application/x-nest-editor-tab', JSON.stringify({ sourcePaneId: 'otro', relPath: 'x.ts', dirty: true, worktreePath: '/repo' }))
    fireEvent.drop(screen.getByTestId('editor-pane'), { dataTransfer: dt })
    expect(onTabDropped).toHaveBeenCalledWith({ sourcePaneId: 'otro', relPath: 'x.ts', dirty: true })
    // cross-worktree: relPath significa otro archivo allá — se ignora
    onTabDropped.mockClear()
    const dt2 = makeDataTransfer()
    dt2.setData('application/x-nest-editor-tab', JSON.stringify({ sourcePaneId: 'otro', relPath: 'x.ts', dirty: true, worktreePath: '/OTRO-wt' }))
    fireEvent.drop(screen.getByTestId('editor-pane'), { dataTransfer: dt2 })
    expect(onTabDropped).not.toHaveBeenCalled()
  })

  it('matches dropEffect to the payload effectAllowed (copy for files, move for tabs)', async () => {
    // El Explorer arrastra con effectAllowed='copy' y el pane forzaba
    // dropEffect='move': en el modelo DnD de HTML el mismatch INVALIDA el
    // drop — el pane resaltaba pero el drop jamás disparaba en Chromium
    // (por eso los dragTo de las demos "no entregaban").
    const { bridge } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
          onTabDropped={vi.fn()} onFileDropped={vi.fn()}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    const dtFile = makeDataTransfer()
    dtFile.setData('application/x-nest-file', 'x')
    fireEvent.dragOver(screen.getByTestId('editor-pane'), { dataTransfer: dtFile })
    expect(dtFile.dropEffect).toBe('copy')
    const dtTab = makeDataTransfer()
    dtTab.setData('application/x-nest-editor-tab', 'x')
    fireEvent.dragOver(screen.getByTestId('editor-pane'), { dataTransfer: dtTab })
    expect(dtTab.dropEffect).toBe('move')
  })

  it('dropping an Explorer file payload opens it in this pane', async () => {
    const { bridge } = makeMockBridge()
    const onFileDropped = vi.fn()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane()}
          onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
          onFileDropped={onFileDropped}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    const dt = makeDataTransfer()
    dt.setData('application/x-nest-file', JSON.stringify({ relPath: 'src/nuevo.ts', worktreePath: '/repo' }))
    fireEvent.drop(screen.getByTestId('editor-pane'), { dataTransfer: dt })
    expect(onFileDropped).toHaveBeenCalledWith('src/nuevo.ts')
  })

  // cross-worktree: el relPath significa OTRO archivo allá — este pane NO lo
  // abre, pero tampoco se lo traga: el drop tiene que BURBUJEAR al workspace,
  // que sabe abrir un pane nuevo con el worktree del payload. (El review
  // encontró que stopPropagation antes del guard hacía desaparecer el drop.)
  it('lets a cross-worktree file drop bubble up to the workspace instead of swallowing it', async () => {
    const { bridge } = makeMockBridge()
    const onFileDropped = vi.fn()
    const workspaceDrop = vi.fn()
    render(
      <div onDrop={workspaceDrop}>
        <BridgeProvider value={bridge}>
          <EditorPane
            pane={makePane()}
            onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
            onFileDropped={onFileDropped}
          />
        </BridgeProvider>
      </div>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    const dt = makeDataTransfer()
    dt.setData('application/x-nest-file', JSON.stringify({ relPath: 'src/nuevo.ts', worktreePath: '/OTRO' }))
    fireEvent.drop(screen.getByTestId('editor-pane'), { dataTransfer: dt })
    expect(onFileDropped).not.toHaveBeenCalled()
    expect(workspaceDrop).toHaveBeenCalled()
  })

  it('rejects a file payload with empty relPath (decoder compartido con el workspace)', async () => {
    const { bridge } = makeMockBridge()
    const onFileDropped = vi.fn()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane()}
          onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
          onFileDropped={onFileDropped}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    const dt = makeDataTransfer()
    dt.setData('application/x-nest-file', JSON.stringify({ relPath: '', worktreePath: '/repo' }))
    fireEvent.drop(screen.getByTestId('editor-pane'), { dataTransfer: dt })
    expect(onFileDropped).not.toHaveBeenCalled()
  })

  it('accepts a file drop whose payload carries the other Windows form of the same worktree', async () => {
    // Payload POSIX (C:/, del Explorer alimentado por worktree-store) contra
    // pane con repoPath nativo (C:\, de local-paths): mismo worktree físico.
    // Con comparación estricta el drop moría en silencio SOLO en Windows.
    const { bridge } = makeMockBridge()
    const onFileDropped = vi.fn()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({ repoPath: 'C:\\dev\\repo' })}
          onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
          onFileDropped={onFileDropped}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    const dt = makeDataTransfer()
    dt.setData('application/x-nest-file', JSON.stringify({ relPath: 'src/nuevo.ts', worktreePath: 'C:/dev/repo' }))
    fireEvent.drop(screen.getByTestId('editor-pane'), { dataTransfer: dt })
    expect(onFileDropped).toHaveBeenCalledWith('src/nuevo.ts')
  })

  it('a tab drop handled by the pane does not bubble to the workspace either', async () => {
    // Mismo contrato que el drop de archivos: el gesto lo consume este pane.
    const { bridge } = makeMockBridge()
    const workspaceDrop = vi.fn()
    render(
      <div onDrop={workspaceDrop}>
        <BridgeProvider value={bridge}>
          <EditorPane
            pane={makePane()}
            onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
            onTabDropped={vi.fn()}
          />
        </BridgeProvider>
      </div>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    const dt = makeDataTransfer()
    dt.setData('application/x-nest-editor-tab', JSON.stringify({ sourcePaneId: 'otro', relPath: 'a.ts', dirty: false, worktreePath: '/repo' }))
    fireEvent.drop(screen.getByTestId('editor-pane'), { dataTransfer: dt })
    expect(workspaceDrop).not.toHaveBeenCalled()
  })

  // El workspace (App.tsx) también acepta drops de archivo — abre un pane
  // NUEVO. Si el drop sobre un pane de editor burbujea hasta ahí, un solo
  // gesto abre el archivo DOS veces: tab en este pane + pane nuevo.
  it('a file drop handled by the pane does not bubble to the workspace', async () => {
    const { bridge } = makeMockBridge()
    const workspaceDrop = vi.fn()
    render(
      <div onDrop={workspaceDrop}>
        <BridgeProvider value={bridge}>
          <EditorPane
            pane={makePane()}
            onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
            onFileDropped={vi.fn()}
          />
        </BridgeProvider>
      </div>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    const dt = makeDataTransfer()
    dt.setData('application/x-nest-file', JSON.stringify({ relPath: 'src/nuevo.ts', worktreePath: '/repo' }))
    fireEvent.drop(screen.getByTestId('editor-pane'), { dataTransfer: dt })
    expect(workspaceDrop).not.toHaveBeenCalled()
  })

  // El pane destino puede REMONTARSE entero (la remoción del pane origen
  // cambia el layout y React desmonta/remonta al superviviente): el handoff
  // se consume en el primer commit pero onMount de Monaco llega en un
  // segundo commit — el modelo nace viejo/vacío. El mount debe volcar el
  // estado `contents` (la verdad) al modelo activo.
  it('flushes already-loaded content into the model when Monaco mounts late', async () => {
    __resetHandoffForTests()
    stashTabBuffer('/repo', 'a.ts', { content: 'buffer que llego antes que Monaco', eol: '\n', dirty: true })
    const { bridge } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({ editorTabs: [{ relPath: 'a.ts', dirty: true }], activeEditorTabPath: 'a.ts' })}
          onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
        />
      </BridgeProvider>,
    )
    // handoff consumido con monacoRef todavía null…
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('buffer que llego antes que Monaco'))
    // …y recién ahora monta Monaco (segundo commit del wrapper real)
    let value = 'contenido viejo del modelo global'
    const model = { uri: { path: modelPathFor('/repo', 'a.ts') }, getValue: () => value, setValue: vi.fn((v: string) => { value = v }) }
    const monaco = { editor: { setTheme: vi.fn(), getModels: vi.fn(() => [model]), setModelLanguage: vi.fn() } }
    act(() => { monacoStub.latestOnMount?.({}, monaco) })
    expect(model.setValue).toHaveBeenCalledWith('buffer que llego antes que Monaco')
  })

  it('a moved-in tab consumes the stashed buffer instead of reading disk', async () => {
    __resetHandoffForTests()
    stashTabBuffer('/repo', 'a.ts', { content: 'buffer mudado sin guardar', eol: '\n', dirty: true })
    const { bridge } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({ editorTabs: [{ relPath: 'a.ts', dirty: true }], activeEditorTabPath: 'a.ts' })}
          onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('buffer mudado sin guardar'))
    expect((bridge as unknown as { fs: { readFile: ReturnType<typeof vi.fn> } }).fs.readFile).not.toHaveBeenCalled()
  })
})

// Identidad de modelos calificada por worktree (findings críticos 1-3 del
// review 2026-08-18): el relPath pelado hacía que dos worktrees compartieran
// modelo (clobber cruzado en Ctrl+S), el matching por sufijo confundía
// foo.ts con src/foo.ts, y el unmount del pane (cambio de workspace tab)
// perdía los buffers dirty aunque la tab siguiera marcada dirty.
describe('EditorPane — identidad de modelos por worktree', () => {
  afterEach(() => vi.clearAllMocks())

  it('qualifies the Monaco model path with the worktree', async () => {
    const { bridge } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    expect(monacoStub.lastPath).toBe(modelPathFor('/repo', 'a.ts'))
  })

  it('writes disk loads only into the EXACT model — no suffix matching', async () => {
    const { bridge } = makeMockBridge()
    const rootModel = { uri: { path: modelPathFor('/repo', 'foo.ts') }, getValue: () => '', setValue: vi.fn() }
    const nestedModel = { uri: { path: modelPathFor('/repo', 'src/foo.ts') }, getValue: () => 'contenido de src', setValue: vi.fn() }
    const monaco = { editor: { setTheme: vi.fn(), getModels: vi.fn(() => [nestedModel, rootModel]), setModelLanguage: vi.fn() } }
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({ editorTabs: [{ relPath: 'foo.ts', dirty: false }], activeEditorTabPath: 'foo.ts' })}
          onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    act(() => { monacoStub.latestOnMount?.({}, monaco) })
    await waitFor(() => expect(rootModel.setValue).toHaveBeenCalledWith('hello'))
    // el modelo de src/foo.ts (mismo sufijo) NO se toca
    expect(nestedModel.setValue).not.toHaveBeenCalled()
  })

  it('stashes dirty buffers on unmount so a workspace-tab switch cannot lose them', async () => {
    __resetHandoffForTests()
    const { bridge } = makeMockBridge()
    // Host con estado: en producción App aplica onTabsChange y el dirty
    // vuelve a bajar como prop — sin esto tabsRef nunca ve la tab dirty.
    function Host() {
      const [pane, setPane] = useState(makePane())
      return (
        <EditorPane
          pane={pane}
          onTabsChange={(editorTabs, activeEditorTabPath) => setPane((p) => ({ ...p, editorTabs, activeEditorTabPath }))}
          onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
        />
      )
    }
    const { unmount } = render(<BridgeProvider value={bridge}><Host /></BridgeProvider>)
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    act(() => { monacoStub.latestOnChange?.('hello con edits sin guardar') })
    await waitFor(() => expect(screen.getByTestId('dirty-a.ts')).toBeInTheDocument())
    unmount()
    expect(takeTabBuffer('/repo', 'a.ts')).toEqual({ content: 'hello con edits sin guardar', eol: '\n', dirty: true })
  })

  it('does not stash clean tabs on unmount (nada que preservar)', async () => {
    __resetHandoffForTests()
    const { bridge } = makeMockBridge()
    const { unmount } = render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    unmount()
    expect(takeTabBuffer('/repo', 'a.ts')).toBeUndefined()
  })
})

// Los caches por-path (contents/eol/editSeq) solo se purgaban en closeTab —
// una tab que SE MUDA a otro pane dejaba su snapshot: al volver, la carga
// se salteaba (contents cacheado) y Ctrl+S escribía el contenido PRE-mudanza
// revirtiendo el archivo en disco (finding crítico del review final).
describe('EditorPane — purge de caches al salir una tab (mudanzas incluidas)', () => {
  afterEach(() => vi.clearAllMocks())

  it('re-reads from disk when a moved-out tab comes back', async () => {
    const { bridge } = makeMockBridge()
    const readFile = (bridge as unknown as { fs: { readFile: ReturnType<typeof vi.fn> } }).fs.readFile
    function Host() {
      const [pane, setPane] = useState(makePane({
        editorTabs: [{ relPath: 'a.ts', dirty: false }, { relPath: 'b.ts', dirty: false }],
        activeEditorTabPath: 'a.ts',
      }))
      return (
        <>
          <EditorPane
            pane={pane}
            onTabsChange={(editorTabs, activeEditorTabPath) => setPane((p) => ({ ...p, editorTabs, activeEditorTabPath }))}
            onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
          />
          <button data-testid="mudar" onClick={() => setPane((p) => ({ ...p, editorTabs: [{ relPath: 'b.ts', dirty: false }], activeEditorTabPath: 'b.ts' }))} />
          <button data-testid="volver" onClick={() => setPane((p) => ({ ...p, editorTabs: [{ relPath: 'b.ts', dirty: false }, { relPath: 'a.ts', dirty: false }], activeEditorTabPath: 'a.ts' }))} />
        </>
      )
    }
    render(<BridgeProvider value={bridge}><Host /></BridgeProvider>)
    await waitFor(() => expect(readFile).toHaveBeenCalledWith('/repo', 'a.ts'))
    const readsBefore = readFile.mock.calls.filter((c: string[]) => c[1] === 'a.ts').length
    // la tab a.ts se muda a otro pane (sale de ESTE), y después vuelve
    fireEvent.click(screen.getByTestId('mudar'))
    await waitFor(() => expect(screen.queryByText('a.ts')).not.toBeInTheDocument())
    fireEvent.click(screen.getByTestId('volver'))
    // al volver TIENE que releer de disco — el cache viejo era el bug
    await waitFor(() => {
      const readsAfter = readFile.mock.calls.filter((c: string[]) => c[1] === 'a.ts').length
      expect(readsAfter).toBe(readsBefore + 1)
    })
  })
})

describe('EditorPane — Ctrl+S durante un conflicto', () => {
  afterEach(() => vi.clearAllMocks())

  it('does not write while the conflict banner is asking the question', async () => {
    // El banner ofrece Keep-mine/Reload; el Ctrl+S de memoria muscular
    // escribía igual, LIMPIABA el conflicto y pisaba la versión externa en
    // medio de la pregunta. El save se bloquea hasta que el banner se
    // responda con sus botones.
    const { bridge, fireChange } = makeMockBridge()
    const writeFile = (bridge as unknown as { fs: { writeFile: ReturnType<typeof vi.fn> } }).fs.writeFile
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({ editorTabs: [{ relPath: 'a.ts', dirty: true }], activeEditorTabPath: 'a.ts' })}
          onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(bridge.fs.watch).toHaveBeenCalledWith('/repo', 'a.ts'))
    fireChange('/repo', 'a.ts')
    await waitFor(() => expect(screen.getByTestId('conflict-banner')).toBeInTheDocument())
    fireEvent.keyDown(screen.getByTestId('editor-pane'), { key: 's', ctrlKey: true })
    await new Promise((r) => setTimeout(r, 30))
    expect(writeFile).not.toHaveBeenCalled()
    expect(screen.getByTestId('conflict-banner')).toBeInTheDocument()
    // resolver con "Keep my changes" habilita el save normal
    fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
    fireEvent.keyDown(screen.getByTestId('editor-pane'), { key: 's', ctrlKey: true })
    await waitFor(() => expect(writeFile).toHaveBeenCalledWith('/repo', 'a.ts', 'hello'))
  })
})

describe('EditorPane — cambio de worktree del pane', () => {
  afterEach(() => vi.clearAllMocks())

  it('purges caches and re-reads from the NEW worktree (and stashes dirty buffers to the old one)', async () => {
    // handleWorktreeSelect cambia repoPath pero CONSERVA editorTabs: sin
    // purge, el pane mostraba el contenido cacheado del worktree viejo y
    // Ctrl+S lo escribía en el archivo del worktree nuevo (clobber cruzado).
    __resetHandoffForTests()
    const { bridge } = makeMockBridge()
    const readFile = (bridge as unknown as { fs: { readFile: ReturnType<typeof vi.fn> } }).fs.readFile
    function Host() {
      const [pane, setPane] = useState(makePane())
      return (
        <>
          <EditorPane
            pane={pane}
            onTabsChange={(editorTabs, activeEditorTabPath) => setPane((p) => ({ ...p, editorTabs, activeEditorTabPath }))}
            onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
          />
          <button data-testid="switch-wt" onClick={() => setPane((p) => ({ ...p, repoPath: '/otro-wt' }))} />
        </>
      )
    }
    render(<BridgeProvider value={bridge}><Host /></BridgeProvider>)
    await waitFor(() => expect(readFile).toHaveBeenCalledWith('/repo', 'a.ts'))
    act(() => { monacoStub.latestOnChange?.('edit sin guardar en /repo') })
    await waitFor(() => expect(screen.getByTestId('dirty-a.ts')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('switch-wt'))
    // relee del worktree NUEVO (el cache del viejo se purgó)…
    await waitFor(() => expect(readFile).toHaveBeenCalledWith('/otro-wt', 'a.ts'))
    // …y el buffer dirty del viejo quedó a salvo en el handoff, con SU key
    expect(takeTabBuffer('/repo', 'a.ts')).toEqual({ content: 'edit sin guardar en /repo', eol: '\n', dirty: true })
  })
})

// Líneas agregadas/cambiadas vs HEAD pintadas en verde (como GitHub):
// decoraciones whole-line de Monaco alimentadas por gitDiff.addedLines.
describe('EditorPane — diff vs HEAD en el editor', () => {
  afterEach(() => vi.clearAllMocks())

  function makeDiffEditorHarness(ranges: Array<{ start: number; end: number }>) {
    const { bridge } = makeMockBridge()
    const addedLines = vi.fn().mockResolvedValue({ ok: true, ranges })
    ;(bridge as unknown as { gitDiff: unknown }).gitDiff = { stats: vi.fn(), addedLines }
    const collection = { set: vi.fn() }
    const editor = { createDecorationsCollection: vi.fn(() => collection) }
    const monaco = { editor: { setTheme: vi.fn(), getModels: vi.fn(() => []), setModelLanguage: vi.fn() } }
    return { bridge, addedLines, collection, editor, monaco }
  }

  it('paints added lines with whole-line green decorations on mount', async () => {
    const { bridge, addedLines, collection, editor, monaco } = makeDiffEditorHarness([{ start: 2, end: 3 }])
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    act(() => { monacoStub.latestOnMount?.(editor, monaco) })
    await waitFor(() => expect(addedLines).toHaveBeenCalledWith('/repo', 'a.ts'))
    await waitFor(() => expect(collection.set).toHaveBeenCalledWith([
      expect.objectContaining({
        range: expect.objectContaining({ startLineNumber: 2, endLineNumber: 3 }),
        options: expect.objectContaining({ isWholeLine: true, className: 'nest-diff-added' }),
      }),
    ]))
  })

  it('announces the save (nest:file-saved) and refreshes the decorations', async () => {
    const { bridge, addedLines, editor, monaco } = makeDiffEditorHarness([])
    const savedEvents: unknown[] = []
    const onSaved = (e: Event) => savedEvents.push((e as CustomEvent).detail)
    window.addEventListener('nest:file-saved', onSaved)
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    act(() => { monacoStub.latestOnMount?.(editor, monaco) })
    await waitFor(() => expect(addedLines).toHaveBeenCalledTimes(1))
    // editar y guardar
    act(() => { monacoStub.latestOnChange?.('hello editado') })
    fireEvent.keyDown(screen.getByTestId('editor-pane'), { key: 's', ctrlKey: true })
    await waitFor(() => expect(savedEvents).toEqual([{ worktreePath: '/repo', relPath: 'a.ts' }]))
    await waitFor(() => expect(addedLines).toHaveBeenCalledTimes(2))
    window.removeEventListener('nest:file-saved', onSaved)
  })
})

describe('EditorPane', () => {
  afterEach(() => vi.clearAllMocks())

  it('loads and displays file content', async () => {
    const { bridge } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
  })

  it('marks the tab dirty after an edit', async () => {
    const { bridge } = makeMockBridge()
    const onTabsChange = vi.fn()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={onTabsChange} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    fireEvent.change(screen.getByTestId('monaco-stub'), { target: { value: 'hello world' } })
    expect(onTabsChange).toHaveBeenCalledWith([{ relPath: 'a.ts', dirty: true }], 'a.ts')
  })

  it('shows a conflict banner when the file changes on disk while dirty', async () => {
    const { bridge, fireChange } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({ editorTabs: [{ relPath: 'a.ts', dirty: true }] })}
          onTabsChange={vi.fn()}
          onClose={vi.fn()}
          onFocus={vi.fn()}
          onOpenInNewPane={vi.fn()}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(bridge.fs.watch).toHaveBeenCalledWith('/repo', 'a.ts'))
    fireChange('/repo', 'a.ts')
    await waitFor(() => expect(screen.getByTestId('conflict-banner')).toBeInTheDocument())
  })

  // Regresión del dedup de watchers (#9): el registry deduplica dos formas del
  // MISMO worktree (C:/ vs C:\) en un chokidar que emite fs:changed con UNA sola
  // forma. El pane con la OTRA forma debe reconocerlo igual (sameWorktree), o se
  // queda ciego a cambios externos y su Ctrl+S los pisa sin banner de conflicto.
  it('shows a conflict banner even when fs:changed carries a different path form of the same worktree', async () => {
    const { bridge, fireChange } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({ editorTabs: [{ relPath: 'a.ts', dirty: true }] })}
          onTabsChange={vi.fn()}
          onClose={vi.fn()}
          onFocus={vi.fn()}
          onOpenInNewPane={vi.fn()}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(bridge.fs.watch).toHaveBeenCalledWith('/repo', 'a.ts'))
    fireChange('/repo/', 'a.ts')   // forma variante (trailing slash) del mismo worktree
    await waitFor(() => expect(screen.getByTestId('conflict-banner')).toBeInTheDocument())
  })

  it('does not show a conflict banner when the file changes and there are no unsaved edits', async () => {
    const { bridge, fireChange } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(bridge.fs.watch).toHaveBeenCalledWith('/repo', 'a.ts'))
    fireChange('/repo', 'a.ts')
    await waitFor(() => expect(bridge.fs.readFile).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('conflict-banner')).not.toBeInTheDocument()
  })

  it('shows a "file unavailable" message instead of Monaco when the initial read fails', async () => {
    const { bridge } = makeMockBridge()
    ;(bridge.fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: 'Binary file, cannot edit: a.ts' })
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('file-unavailable')).toHaveTextContent('Binary file, cannot edit: a.ts'))
    expect(screen.queryByTestId('monaco-stub')).not.toBeInTheDocument()
  })

  it('shows a "file unavailable" message when a re-read after a change event fails (file removed on disk)', async () => {
    const { bridge, fireChange } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    ;(bridge.fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: 'ENOENT: no such file' })
    fireChange('/repo', 'a.ts')
    await waitFor(() => expect(screen.getByTestId('file-unavailable')).toHaveTextContent('ENOENT: no such file'))
  })

  it('alerts and keeps the tab dirty when saving fails', async () => {
    const { bridge } = makeMockBridge()
    ;(bridge.fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: 'EACCES: permission denied' })
    const onTabsChange = vi.fn()
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={onTabsChange} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    fireEvent.change(screen.getByTestId('monaco-stub'), { target: { value: 'edited' } })
    expect(onTabsChange).toHaveBeenCalledWith([{ relPath: 'a.ts', dirty: true }], 'a.ts')
    onTabsChange.mockClear()

    fireEvent.keyDown(screen.getByTestId('editor-pane'), { key: 's', ctrlKey: true })
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('EACCES: permission denied')))
    // setDirty(false) never fires on a failed save — onTabsChange stays untouched
    // since the last (successful) edit call, so the tab remains marked dirty.
    expect(onTabsChange).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  // Finding 1: watch/unwatch race triggered on every keystroke.
  it('sequences watch/unwatch through tabs-array churn (no orphaned watch) and skips redundant churn from an already-dirty tab', async () => {
    // Part A: a churned `tabs` array reference re-runs the watch effect's
    // cleanup+setup before the prior watch() IPC round-trip resolves. Without
    // per-key sequencing, the file can end up silently unwatched.
    const { bridge: raceBridge, registry, opLog } = makeRaceMockBridge()
    const { rerender, unmount } = render(
      <BridgeProvider value={raceBridge}>
        <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))

    // Rapidly hand the component a NEW `editorTabs` array reference for the
    // SAME file, several times in a row, before the mocked watch() (10ms)
    // has resolved — this reproduces the effect churn that unconditional
    // setDirty() calls used to cause on every keystroke.
    for (let i = 0; i < 3; i++) {
      rerender(
        <BridgeProvider value={raceBridge}>
          <EditorPane
            pane={makePane({ editorTabs: [{ relPath: 'a.ts', dirty: false }] })}
            onTabsChange={vi.fn()}
            onClose={vi.fn()}
            onFocus={vi.fn()}
            onOpenInNewPane={vi.fn()}
          />
        </BridgeProvider>,
      )
    }

    // Let every sequenced watch/unwatch op for 'a.ts' fully settle.
    await waitFor(() => expect(opLog.filter((e) => e.endsWith(':a.ts')).length).toBeGreaterThan(0))

    // The pane is still mounted with 'a.ts' open — it must end up watched,
    // not orphaned by an unwatch racing ahead of a still-in-flight watch.
    // waitFor (not a fixed sleep): under a loaded suite the 10ms-per-op mock
    // chain can still be in flight; a real orphan leaves the registry empty
    // forever, so this still fails (by timeout) if the bug regresses.
    await waitFor(() => expect(registry.has('/repo::a.ts')).toBe(true))
    unmount()

    // Part B: with the fix, editing an ALREADY-dirty tab must not call
    // setDirty/onTabsChange again — so it must not churn the tabs array
    // reference, and therefore must not trigger any extra watch/unwatch call.
    const { bridge } = makeMockBridge()
    const onTabsChange = vi.fn()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({ editorTabs: [{ relPath: 'a.ts', dirty: true }] })}
          onTabsChange={onTabsChange}
          onClose={vi.fn()}
          onFocus={vi.fn()}
          onOpenInNewPane={vi.fn()}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    expect(bridge.fs.watch).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByTestId('monaco-stub'), { target: { value: 'more edits' } })
    fireEvent.change(screen.getByTestId('monaco-stub'), { target: { value: 'even more edits' } })

    // Already dirty before either edit — setDirty must be skipped both
    // times, so onTabsChange is never called and no extra watch/unwatch
    // round-trip is triggered by the (nonexistent) effect churn.
    expect(onTabsChange).not.toHaveBeenCalled()
    expect(bridge.fs.watch).toHaveBeenCalledTimes(1)
    expect(bridge.fs.unwatch).not.toHaveBeenCalled()
  })

  // Finding 2: stale-closure race on in-flight save() vs. concurrent tab close/switch.
  it('does not resurrect a closed tab or revert the active tab when a save resolves after the tab was closed', async () => {
    const { bridge } = makeMockBridge()
    let resolveWrite: (v: { ok: true }) => void
    ;(bridge.fs.writeFile as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise((resolve) => { resolveWrite = resolve }),
    )
    const onTabsChange = vi.fn()
    const initialPane = makePane({
      editorTabs: [{ relPath: 'a.ts', dirty: true }, { relPath: 'b.ts', dirty: false }],
      activeEditorTabPath: 'a.ts',
    })
    const { rerender } = render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={initialPane} onTabsChange={onTabsChange} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toBeInTheDocument())

    // Trigger a save on 'a.ts' — writeFile() is controlled and won't resolve yet.
    fireEvent.keyDown(screen.getByTestId('editor-pane'), { key: 's', ctrlKey: true })
    await waitFor(() => expect(bridge.fs.writeFile).toHaveBeenCalled())

    // While the save is in flight, simulate the user closing 'a.ts' and
    // switching to 'b.ts' — i.e. the parent's state (and thus this
    // component's props) changed out from under the pending save.
    onTabsChange.mockClear()
    rerender(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({ editorTabs: [{ relPath: 'b.ts', dirty: false }], activeEditorTabPath: 'b.ts' })}
          onTabsChange={onTabsChange}
          onClose={vi.fn()}
          onFocus={vi.fn()}
          onOpenInNewPane={vi.fn()}
        />
      </BridgeProvider>,
    )

    // Now let the save resolve.
    resolveWrite!({ ok: true })
    await waitFor(() => expect(onTabsChange).toHaveBeenCalled())

    // The save's completion must reflect the CURRENT state (post tab-close),
    // not the stale snapshot from when save() was invoked: it must not
    // resurrect 'a.ts', and must not revert the active tab back to 'a.ts'.
    const [tabsArg, activePathArg] = onTabsChange.mock.calls[onTabsChange.mock.calls.length - 1]
    expect(tabsArg.find((t: { relPath: string }) => t.relPath === 'a.ts')).toBeUndefined()
    expect(activePathArg).toBe('b.ts')
  })

  // Windows CRLF-corruption bug: Monaco inserts its platform-default EOL
  // (CRLF on Windows) for lines the user types via Enter, regardless of the
  // loaded file's actual line-ending convention — confirmed via e2e (typing
  // into an LF fixture and saving produced mixed LF/CRLF line endings).
  it('normalizes newly-typed CRLF line breaks back to the loaded file\'s LF convention before saving', async () => {
    const { bridge } = makeMockBridge()
    ;(bridge.fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, content: 'line1\nline2' })
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('line1\nline2'))

    // Simulate what Monaco's onChange reports after the user presses Enter
    // on Windows: the new line break comes back as CRLF even though the
    // file that was loaded only had LF. Invoked directly (not via
    // fireEvent.change) so jsdom's native-textarea CRLF normalization
    // doesn't strip the '\r' before production code ever sees it.
    act(() => monacoStub.latestOnChange?.('line1\r\nline2\r\nline3'))

    fireEvent.keyDown(screen.getByTestId('editor-pane'), { key: 's', ctrlKey: true })
    await waitFor(() => expect(bridge.fs.writeFile).toHaveBeenCalledWith('/repo', 'a.ts', 'line1\nline2\nline3'))
  })

  it('keeps CRLF line breaks when the loaded file already uses CRLF', async () => {
    const { bridge } = makeMockBridge()
    ;(bridge.fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, content: 'line1\r\nline2' })
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(monacoStub.latestOnChange).not.toBeNull())

    act(() => monacoStub.latestOnChange?.('line1\r\nline2\nline3'))

    fireEvent.keyDown(screen.getByTestId('editor-pane'), { key: 's', ctrlKey: true })
    await waitFor(() => expect(bridge.fs.writeFile).toHaveBeenCalledWith('/repo', 'a.ts', 'line1\r\nline2\r\nline3'))
  })

  // Finding 3: reloadFromDisk silently swallows a failed re-read.
  it('alerts and does not clear conflicts/dirty when reloading from disk fails', async () => {
    const { bridge, fireChange } = makeMockBridge()
    const onTabsChange = vi.fn()
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({ editorTabs: [{ relPath: 'a.ts', dirty: true }] })}
          onTabsChange={onTabsChange}
          onClose={vi.fn()}
          onFocus={vi.fn()}
          onOpenInNewPane={vi.fn()}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(bridge.fs.watch).toHaveBeenCalledWith('/repo', 'a.ts'))
    fireChange('/repo', 'a.ts')
    await waitFor(() => expect(screen.getByTestId('conflict-banner')).toBeInTheDocument())

    ;(bridge.fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: 'ENOENT: no such file' })
    fireEvent.click(screen.getByText('Reload from disk'))

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('ENOENT: no such file')))
    // The re-read failed — the conflict is still real and the tab is still
    // dirty, neither must have been silently cleared to a clean state.
    expect(screen.getByTestId('conflict-banner')).toBeInTheDocument()
    expect(onTabsChange).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  it('passes editorOptions and editorTheme through to Monaco', async () => {
    const { bridge } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane()}
          onTabsChange={vi.fn()}
          onClose={vi.fn()}
          onFocus={vi.fn()}
          onOpenInNewPane={vi.fn()}
          editorOptions={{ fontSize: 18, tabSize: 2 }}
          editorTheme="vs"
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    // El minimap va apagado por DEFAULT (en panes chicos es ruido puro) pero
    // las opciones del usuario lo pueden re-activar (spread después).
    expect(monacoStub.lastOptions).toEqual({ minimap: { enabled: false }, wordWrap: 'on', fontSize: 18, tabSize: 2 })
    expect(monacoStub.lastTheme).toBe('vs')
  })

  it('lets user options re-enable the minimap over the default', async () => {
    const { bridge } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
          editorOptions={{ minimap: { enabled: true } } as never}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    expect(monacoStub.lastOptions).toEqual({ minimap: { enabled: true }, wordWrap: 'on' })
  })

  // En un multiplexor los panes de editor viven ANGOSTOS: sin wrap, la línea
  // larga se clipea seca contra el borde del pane vecino y se lee como
  // superposición (reporte de Bautista con captura, 2026-08-18). Wrap ON por
  // default; la config del usuario (Settings / IDE import) lo puede apagar.
  it('turns word wrap ON by default', async () => {
    const { bridge } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    expect(monacoStub.lastOptions).toMatchObject({ wordWrap: 'on' })
  })

  it('lets user options turn word wrap off over the default', async () => {
    const { bridge } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()}
          editorOptions={{ wordWrap: 'off' } as never}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    expect(monacoStub.lastOptions).toMatchObject({ wordWrap: 'off' })
  })

  it('disables TS SEMANTIC validation on mount (no LSP: module errors are noise)', async () => {
    const { bridge } = makeMockBridge()
    const setDiagnosticsOptions = vi.fn()
    const monaco = {
      editor: { setTheme: vi.fn(), getModels: vi.fn(() => []), setModelLanguage: vi.fn() },
      languages: { typescript: {
        typescriptDefaults: { setDiagnosticsOptions },
        javascriptDefaults: { setDiagnosticsOptions },
      } },
    }
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    act(() => { monacoStub.latestOnMount?.({}, monaco) })
    // semántica OFF (imports irresolubles sin LSP), sintaxis ON (typos reales)
    expect(setDiagnosticsOptions).toHaveBeenCalledTimes(2)
    expect(setDiagnosticsOptions).toHaveBeenCalledWith({ noSemanticValidation: true, noSyntaxValidation: false })
  })

  describe('shiki theming', () => {
    const fakeModel = { uri: { path: '/a.ts' }, getValue: vi.fn(() => 'hello'), setValue: vi.fn() }
    const fakeMonaco = {
      editor: {
        setTheme: vi.fn(),
        getModels: vi.fn(() => [fakeModel]),
        setModelLanguage: vi.fn(),
      },
    }

    function mountEditor() {
      // El stub de <Editor> capturó onMount; se dispara a mano simulando el
      // mount real de Monaco, que es donde entra la instancia `monaco`.
      act(() => { monacoStub.latestOnMount?.({}, fakeMonaco) })
    }

    it('applies the preferred theme via shiki on editor mount', async () => {
      const { bridge } = makeMockBridge()
      render(
        <BridgeProvider value={bridge}>
          <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} editorTheme="dracula" />
        </BridgeProvider>,
      )
      await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
      mountEditor()
      await waitFor(() => expect(shikiMock.applyTheme).toHaveBeenCalledWith(fakeMonaco, 'dracula'))
      // Mientras shiki no registró el tema, el wrapper queda en vs-dark — un
      // nombre no built-in en el prop `theme` haría tirar a setTheme.
      expect(monacoStub.lastTheme).toBe('vs-dark')
    })

    it('re-applies the theme when the editorTheme prop changes', async () => {
      const { bridge } = makeMockBridge()
      const props = { pane: makePane(), onTabsChange: vi.fn(), onClose: vi.fn(), onFocus: vi.fn(), onOpenInNewPane: vi.fn() }
      const { rerender } = render(
        <BridgeProvider value={bridge}>
          <EditorPane {...props} editorTheme="dracula" />
        </BridgeProvider>,
      )
      await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
      mountEditor()
      rerender(
        <BridgeProvider value={bridge}>
          <EditorPane {...props} editorTheme="tokyo-night" />
        </BridgeProvider>,
      )
      await waitFor(() => expect(shikiMock.applyTheme).toHaveBeenCalledWith(fakeMonaco, 'tokyo-night'))
    })

    it('keeps passing monaco built-in themes straight through the theme prop', async () => {
      const { bridge } = makeMockBridge()
      render(
        <BridgeProvider value={bridge}>
          <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} editorTheme="vs" />
        </BridgeProvider>,
      )
      await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
      expect(monacoStub.lastTheme).toBe('vs')
    })

    it('loads the shiki grammar and applies it to the model IMPERATIVELY (never via the language prop)', async () => {
      const { bridge } = makeMockBridge()
      render(
        <BridgeProvider value={bridge}>
          <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
        </BridgeProvider>,
      )
      await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
      mountEditor()
      await waitFor(() => expect(shikiMock.ensureLanguage).toHaveBeenCalledWith(fakeMonaco, 'ts'))
      // La aplicación va por setModelLanguage (preserva buffer y cursor).
      // El prop `language` NUNCA debe flipear post-mount: ese flip re-renderiza
      // en medio del tipeo y @monaco-editor/react pisa el buffer con el prop
      // `value` atrasado — se comía keystrokes (visto como '#edited' en E2E).
      await waitFor(() => expect(fakeMonaco.editor.setModelLanguage).toHaveBeenCalledWith(fakeModel, 'typescript'))
      expect(monacoStub.lastLanguage).toBeUndefined()
    })

    it('leaves Monaco language inference (Monarch) untouched when shiki fails', async () => {
      shikiMock.ensureLanguage.mockResolvedValueOnce(null)
      const { bridge } = makeMockBridge()
      render(
        <BridgeProvider value={bridge}>
          <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
        </BridgeProvider>,
      )
      await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
      mountEditor()
      await waitFor(() => expect(shikiMock.ensureLanguage).toHaveBeenCalled())
      // sin lang de shiki, el modelo queda sin override y sigue editable
      expect(fakeMonaco.editor.setModelLanguage).not.toHaveBeenCalled()
      expect(monacoStub.lastLanguage).toBeUndefined()
      expect(screen.getByTestId('monaco-stub')).toHaveValue('hello')
    })
  })

  // Critical finding 1: save() must never write when the active tab's
  // content never successfully loaded — otherwise Ctrl+S truncates the file
  // on disk with an empty string.
  describe('save() bails out instead of truncating when content never loaded', () => {
    it('does not write to disk when Ctrl+S is pressed before the initial read resolves', async () => {
      const { bridge } = makeMockBridge()
      // Never resolves — content stays undefined for the whole test.
      ;(bridge.fs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}))
      render(
        <BridgeProvider value={bridge}>
          <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
        </BridgeProvider>,
      )
      await waitFor(() => expect(bridge.fs.readFile).toHaveBeenCalled())

      fireEvent.keyDown(screen.getByTestId('editor-pane'), { key: 's', ctrlKey: true })
      // Give any (wrongly) in-flight write a tick to happen before asserting.
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(bridge.fs.writeFile).not.toHaveBeenCalled()
    })

    it('does not write to disk when Ctrl+S is pressed on a tab whose initial read failed', async () => {
      const { bridge } = makeMockBridge()
      ;(bridge.fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'Binary file, cannot edit: a.ts' })
      render(
        <BridgeProvider value={bridge}>
          <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
        </BridgeProvider>,
      )
      await waitFor(() => expect(screen.getByTestId('file-unavailable')).toBeInTheDocument())

      fireEvent.keyDown(screen.getByTestId('editor-pane'), { key: 's', ctrlKey: true })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(bridge.fs.writeFile).not.toHaveBeenCalled()
    })
  })

  // Important finding 4: the Ctrl+S listener must be scoped to this pane's
  // own container, not `window` — otherwise one Ctrl+S saves every open
  // pane's active file.
  it('scopes Ctrl+S to the pane it was pressed in, not every mounted pane', async () => {
    const { bridge: bridge1 } = makeMockBridge()
    const { bridge: bridge2 } = makeMockBridge()
    render(
      <>
        <BridgeProvider value={bridge1}>
          <EditorPane pane={makePane({ editorTabs: [{ relPath: 'a.ts', dirty: true }], activeEditorTabPath: 'a.ts' })} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
        </BridgeProvider>
        <BridgeProvider value={bridge2}>
          <EditorPane pane={makePane({ editorTabs: [{ relPath: 'b.ts', dirty: true }], activeEditorTabPath: 'b.ts' })} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
        </BridgeProvider>
      </>,
    )
    await waitFor(() => expect(screen.getAllByTestId('monaco-stub')).toHaveLength(2))

    const panes = screen.getAllByTestId('editor-pane')
    fireEvent.keyDown(panes[0], { key: 's', ctrlKey: true })

    await waitFor(() => expect(bridge1.fs.writeFile).toHaveBeenCalledWith('/repo', 'a.ts', 'hello'))
    expect(bridge2.fs.writeFile).not.toHaveBeenCalled()
  })

  // Important finding 5: closeTab must purge this pane's per-path caches so
  // reopening the same relPath re-reads from disk instead of resurrecting
  // discarded, unsaved edits marked (incorrectly) as clean.
  it('purges cached content/EOL/conflict/loadError state on close, so reopening the same path reloads fresh from disk', async () => {
    const { bridge } = makeMockBridge()
    const onTabsChange = vi.fn()
    const { rerender } = render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({ editorTabs: [{ relPath: 'a.ts', dirty: false }], activeEditorTabPath: 'a.ts' })}
          onTabsChange={onTabsChange}
          onClose={vi.fn()}
          onFocus={vi.fn()}
          onOpenInNewPane={vi.fn()}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))

    // Edit without saving, then close the tab — the edit is discarded.
    fireEvent.change(screen.getByTestId('monaco-stub'), { target: { value: 'discarded edit' } })
    fireEvent.click(screen.getByText('×'))

    // Reopen the SAME relPath as a brand-new (clean) tab — this is what the
    // parent does when the user clicks the file again in the Explorer.
    ;(bridge.fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, content: 'hello' })
    rerender(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({ editorTabs: [{ relPath: 'a.ts', dirty: false }], activeEditorTabPath: 'a.ts' })}
          onTabsChange={onTabsChange}
          onClose={vi.fn()}
          onFocus={vi.fn()}
          onOpenInNewPane={vi.fn()}
        />
      </BridgeProvider>,
    )

    // Must show freshly-read disk content, NOT the discarded in-memory edit.
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    expect(screen.getByTestId('monaco-stub')).not.toHaveValue('discarded edit')
    // A second real disk read for 'a.ts' proves the cache was actually
    // purged (not just coincidentally overwritten).
    expect((bridge.fs.readFile as ReturnType<typeof vi.fn>).mock.calls.filter(([, rel]) => rel === 'a.ts').length).toBeGreaterThanOrEqual(2)
  })
})

// #1 del review (data-loss): si la lectura inicial del disco está EN VUELO, el
// editor no debe ser editable. Antes se montaba un <Editor> con defaultValue ''
// (buffer vacío editable): si el usuario tipeaba, el guard de editSeq descartaba
// el contenido del disco al resolver y un Ctrl+S posterior TRUNCABA el archivo a
// lo tipeado. La carga tardía se cubre con un estado de "loading".
describe('EditorPane — carga inicial (anti-truncación)', () => {
  it('no monta un editor editable hasta que el contenido cargó del disco', async () => {
    let resolveRead!: (v: { ok: true; content: string }) => void
    const readPromise = new Promise<{ ok: true; content: string }>((r) => { resolveRead = r })
    const fs = {
      readFile: vi.fn().mockReturnValue(readPromise),
      writeFile: vi.fn().mockResolvedValue({ ok: true }),
      watch: vi.fn().mockResolvedValue({ ok: true }),
      unwatch: vi.fn().mockResolvedValue(undefined),
      onChanged: vi.fn(() => () => {}),
    }
    const bridge = { fs } as unknown as Window & typeof globalThis
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({ editorTabs: [{ relPath: 'a.ts', dirty: false }], activeEditorTabPath: 'a.ts' })}
          onTabsChange={vi.fn()}
          onClose={vi.fn()}
          onFocus={vi.fn()}
          onOpenInNewPane={vi.fn()}
        />
      </BridgeProvider>,
    )

    // Lectura en vuelo → estado de carga, NADA de editor editable.
    await waitFor(() => expect(screen.getByTestId('editor-loading')).toBeInTheDocument())
    expect(screen.queryByTestId('monaco-stub')).not.toBeInTheDocument()

    // Resuelve la lectura → aparece el editor con el contenido REAL del disco.
    await act(async () => { resolveRead({ ok: true, content: 'REAL DISK CONTENT' }); await readPromise })
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toBeInTheDocument())
    expect(screen.getByTestId('monaco-stub')).toHaveValue('REAL DISK CONTENT')
  })
})
