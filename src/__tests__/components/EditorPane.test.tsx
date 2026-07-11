import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BridgeProvider } from '../../lib/bridge'
import { EditorPane } from '../../components/EditorPane'
import type { PaneNode } from '../../types'

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string | undefined) => void }) => (
    <textarea data-testid="monaco-stub" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
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

    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
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
    await new Promise((resolve) => setTimeout(resolve, 30))

    // The pane is still mounted with 'a.ts' open — it must end up watched,
    // not orphaned by an unwatch racing ahead of a still-in-flight watch.
    expect(registry.has('/repo::a.ts')).toBe(true)
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
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
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
    fireEvent.click(screen.getByText('Recargar de disco'))

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('ENOENT: no such file')))
    // The re-read failed — the conflict is still real and the tab is still
    // dirty, neither must have been silently cleared to a clean state.
    expect(screen.getByTestId('conflict-banner')).toBeInTheDocument()
    expect(onTabsChange).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })
})
