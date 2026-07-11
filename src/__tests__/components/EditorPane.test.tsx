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
})
