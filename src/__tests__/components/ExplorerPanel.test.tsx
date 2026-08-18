import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BridgeProvider } from '../../lib/bridge'
import { ExplorerPanel } from '../../components/ExplorerPanel'

function makeMockBridge() {
  let changeCb: ((wt: string, rel: string) => void) | null = null
  const rootEntries = [
    { name: 'src', path: 'src', isDirectory: true },
    { name: 'README.md', path: 'README.md', isDirectory: false },
  ]
  const fs = {
    listDir: vi.fn().mockImplementation((_wt: string, relPath: string) => {
      if (relPath === '') return Promise.resolve({ ok: true, entries: [...rootEntries] })
      if (relPath === 'src') {
        return Promise.resolve({ ok: true, entries: [{ name: 'index.ts', path: 'src/index.ts', isDirectory: false }] })
      }
      return Promise.resolve({ ok: true, entries: [] })
    }),
    watch: vi.fn().mockResolvedValue({ ok: true }),
    unwatch: vi.fn().mockResolvedValue(undefined),
    onChanged: vi.fn((cb: (wt: string, rel: string) => void) => {
      changeCb = cb
      return () => { changeCb = null }
    }),
  }
  const bridge = { fs } as unknown as Window & typeof globalThis
  return { bridge, rootEntries, fireChange: (wt: string, rel: string) => changeCb?.(wt, rel) }
}

// Simulates the real IPC round-trip: `watch()` only "registers" the
// directory (adds it to `registry`) after an async delay — mirroring the
// main-process `fs:watch` handler which awaits `resolveScoped` before
// touching the chokidar-backed FsWatchRegistry. `unwatch()` resolves fast
// and only removes the entry if it is ALREADY registered — mirroring the
// main-process no-op when nothing is registered yet for that key. This
// lets a rapid expand→collapse genuinely race unless the caller sequences
// watch/unwatch calls per key.
function makeRaceMockBridge() {
  const registry = new Set<string>()
  const opLog: string[] = []
  const fs = {
    listDir: vi.fn().mockImplementation((_wt: string, relPath: string) => {
      if (relPath === '') {
        return Promise.resolve({ ok: true, entries: [{ name: 'src', path: 'src', isDirectory: true }] })
      }
      return Promise.resolve({ ok: true, entries: [] })
    }),
    watch: vi.fn().mockImplementation((_wt: string, relPath: string) => new Promise((resolve) => {
      setTimeout(() => {
        registry.add(relPath)
        opLog.push(`watch:${relPath}`)
        resolve({ ok: true })
      }, 10)
    })),
    unwatch: vi.fn().mockImplementation((_wt: string, relPath: string) => new Promise<void>((resolve) => {
      setTimeout(() => {
        registry.delete(relPath)
        opLog.push(`unwatch:${relPath}`)
        resolve()
      }, 0)
    })),
    onChanged: vi.fn(() => () => {}),
  }
  const bridge = { fs } as unknown as Window & typeof globalThis
  return { bridge, registry, opLog }
}

describe('ExplorerPanel', () => {
  it('shows an English placeholder when there is no active worktree', () => {
    render(<ExplorerPanel worktreePath={null} onFileOpen={vi.fn()} />)
    expect(screen.getByText(/no repo linked/i)).toBeInTheDocument()
  })

  it('renders the EXPLORER header with the repo basename uppercased', async () => {
    const { bridge } = makeMockBridge()
    render(<BridgeProvider value={bridge}><ExplorerPanel worktreePath="/home/user/my-repo" onFileOpen={vi.fn()} /></BridgeProvider>)
    expect(screen.getByText('EXPLORER')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('MY-REPO')).toBeInTheDocument())
  })

  it('collapse-all collapses every expanded directory and unwatches it', async () => {
    const { bridge } = makeMockBridge()
    render(<BridgeProvider value={bridge}><ExplorerPanel worktreePath="/repo" onFileOpen={vi.fn()} /></BridgeProvider>)
    await waitFor(() => screen.getByText('src'))
    fireEvent.click(screen.getByText('src'))
    await waitFor(() => expect(screen.getByText('index.ts')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('Collapse folders'))
    await waitFor(() => expect(screen.queryByText('index.ts')).not.toBeInTheDocument())
    await waitFor(() => expect(bridge.fs.unwatch).toHaveBeenCalledWith('/repo', 'src'))
  })

  it('refresh re-lists every loaded directory', async () => {
    const { bridge } = makeMockBridge()
    render(<BridgeProvider value={bridge}><ExplorerPanel worktreePath="/repo" onFileOpen={vi.fn()} /></BridgeProvider>)
    await waitFor(() => screen.getByText('src'))
    fireEvent.click(screen.getByText('src'))
    await waitFor(() => screen.getByText('index.ts'))
    const callsBefore = (bridge.fs.listDir as ReturnType<typeof vi.fn>).mock.calls.length

    fireEvent.click(screen.getByTitle('Refresh'))
    await waitFor(() => {
      const calls = (bridge.fs.listDir as ReturnType<typeof vi.fn>).mock.calls.slice(callsBefore)
      expect(calls.map((c) => c[1])).toEqual(expect.arrayContaining(['', 'src']))
    })
  })

  it('marks the last clicked file as selected', async () => {
    const { bridge } = makeMockBridge()
    render(<BridgeProvider value={bridge}><ExplorerPanel worktreePath="/repo" onFileOpen={vi.fn()} /></BridgeProvider>)
    await waitFor(() => screen.getByText('README.md'))
    fireEvent.click(screen.getByText('README.md'))
    expect(screen.getByText('README.md').closest('.explorer-entry')).toHaveClass('selected')
  })

  it('renders the root listing', async () => {
    const { bridge } = makeMockBridge()
    render(<BridgeProvider value={bridge}><ExplorerPanel worktreePath="/repo" onFileOpen={vi.fn()} /></BridgeProvider>)
    await waitFor(() => expect(screen.getByText('README.md')).toBeInTheDocument())
    expect(screen.getByText('src')).toBeInTheDocument()
  })

  it('calls onFileOpen when a file entry is clicked', async () => {
    const { bridge } = makeMockBridge()
    const onFileOpen = vi.fn()
    render(<BridgeProvider value={bridge}><ExplorerPanel worktreePath="/repo" onFileOpen={onFileOpen} /></BridgeProvider>)
    await waitFor(() => screen.getByText('README.md'))
    fireEvent.click(screen.getByText('README.md'))
    expect(onFileOpen).toHaveBeenCalledWith('README.md')
  })

  it('expands a directory and lists its children on click', async () => {
    const { bridge } = makeMockBridge()
    render(<BridgeProvider value={bridge}><ExplorerPanel worktreePath="/repo" onFileOpen={vi.fn()} /></BridgeProvider>)
    await waitFor(() => screen.getByText('src'))
    fireEvent.click(screen.getByText('src'))
    await waitFor(() => expect(screen.getByText('index.ts')).toBeInTheDocument())
  })

  it('watches the root (depth 0) and re-lists it when a change is reported', async () => {
    const { bridge, rootEntries, fireChange } = makeMockBridge()
    render(<BridgeProvider value={bridge}><ExplorerPanel worktreePath="/repo" onFileOpen={vi.fn()} /></BridgeProvider>)
    await waitFor(() => screen.getByText('README.md'))
    expect(bridge.fs.watch).toHaveBeenCalledWith('/repo', '', { depth: 0 })
    rootEntries.push({ name: 'NEW.txt', path: 'NEW.txt', isDirectory: false })
    fireChange('/repo', '')
    await waitFor(() => expect(screen.getByText('NEW.txt')).toBeInTheDocument())
  })

  it('watches an expanded directory (depth 0) and unwatches it on collapse', async () => {
    const { bridge } = makeMockBridge()
    render(<BridgeProvider value={bridge}><ExplorerPanel worktreePath="/repo" onFileOpen={vi.fn()} /></BridgeProvider>)
    await waitFor(() => screen.getByText('src'))
    fireEvent.click(screen.getByText('src'))
    await waitFor(() => expect(bridge.fs.watch).toHaveBeenCalledWith('/repo', 'src', { depth: 0 }))
    fireEvent.click(screen.getByText('src'))
    await waitFor(() => expect(bridge.fs.unwatch).toHaveBeenCalledWith('/repo', 'src'))
  })

  it('sequences a rapid expand-then-collapse so unwatch is not lost to an in-flight watch', async () => {
    const { bridge, registry, opLog } = makeRaceMockBridge()
    render(<BridgeProvider value={bridge}><ExplorerPanel worktreePath="/repo" onFileOpen={vi.fn()} /></BridgeProvider>)
    await waitFor(() => screen.getByText('src'))

    // Expand then immediately collapse, synchronously, before the mocked
    // watch() promise for 'src' has resolved (it resolves after 10ms).
    fireEvent.click(screen.getByText('src'))
    fireEvent.click(screen.getByText('src'))

    // Let both the watch() and unwatch() round-trips for 'src' finish.
    await waitFor(() => {
      expect(opLog.filter((entry) => entry.endsWith(':src'))).toHaveLength(2)
    })

    // The last operation applied to 'src' must be the unwatch — collapse
    // wins — and the simulated registry must not still hold a watcher for
    // a directory the UI shows as collapsed.
    const srcOps = opLog.filter((entry) => entry.endsWith(':src'))
    expect(srcOps[srcOps.length - 1]).toBe('unwatch:src')
    expect(registry.has('src')).toBe(false)
  })
})

// Badges de diff vs HEAD: +N en verde, −M en rojo, U para untracked — el
// estado git del worktree visible archivo por archivo, como en GitHub.
describe('ExplorerPanel — badges de diff', () => {
  function makeDiffBridge() {
    let changeCb: ((wt: string, rel: string) => void) | null = null
    const fs = {
      listDir: vi.fn().mockResolvedValue({
        ok: true,
        entries: [
          { name: 'a.ts', path: 'a.ts', isDirectory: false },
          { name: 'nuevo.ts', path: 'nuevo.ts', isDirectory: false },
          { name: 'intacto.ts', path: 'intacto.ts', isDirectory: false },
        ],
      }),
      watch: vi.fn().mockResolvedValue({ ok: true }),
      unwatch: vi.fn().mockResolvedValue(undefined),
      onChanged: vi.fn((cb: (wt: string, rel: string) => void) => {
        changeCb = cb
        return () => { changeCb = null }
      }),
    }
    const gitDiff = {
      stats: vi.fn().mockResolvedValue({
        ok: true,
        files: [{ relPath: 'a.ts', added: 3, deleted: 1 }],
        untracked: ['nuevo.ts'],
      }),
      addedLines: vi.fn().mockResolvedValue({ ok: true, ranges: [] }),
    }
    const bridge = { fs, gitDiff } as unknown as Window & typeof globalThis
    return { bridge, gitDiff, fireChange: (wt: string, rel: string) => changeCb?.(wt, rel) }
  }

  it('shows +N / −M on modified files and U on untracked ones', async () => {
    const { bridge } = makeDiffBridge()
    render(
      <BridgeProvider value={bridge}>
        <ExplorerPanel worktreePath="/wt" onFileOpen={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByText('+3')).toBeInTheDocument())
    expect(screen.getByText('−1')).toBeInTheDocument()
    expect(screen.getByText('U')).toBeInTheDocument()
    // el archivo sin cambios no tiene badge
    const intactRow = screen.getByText('intacto.ts').closest('.explorer-entry')!
    expect(intactRow.querySelector('.explorer-diff')).toBeNull()
  })

  it('refreshes the stats when the watcher reports a change', async () => {
    const { bridge, gitDiff, fireChange } = makeDiffBridge()
    render(
      <BridgeProvider value={bridge}>
        <ExplorerPanel worktreePath="/wt" onFileOpen={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(gitDiff.stats).toHaveBeenCalledTimes(1))
    fireChange('/wt', '')
    await waitFor(() => expect(gitDiff.stats).toHaveBeenCalledTimes(2))
  })

  it('refreshes the stats on the nest:file-saved event (Ctrl+S en el editor)', async () => {
    const { bridge, gitDiff } = makeDiffBridge()
    render(
      <BridgeProvider value={bridge}>
        <ExplorerPanel worktreePath="/wt" onFileOpen={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(gitDiff.stats).toHaveBeenCalledTimes(1))
    fireEvent(window, new CustomEvent('nest:file-saved', { detail: { worktreePath: '/wt' } }))
    await waitFor(() => expect(gitDiff.stats).toHaveBeenCalledTimes(2))
  })
})
