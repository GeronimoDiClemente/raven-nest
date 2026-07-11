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

describe('ExplorerPanel', () => {
  it('shows a placeholder when there is no active worktree', () => {
    render(<ExplorerPanel worktreePath={null} onFileOpen={vi.fn()} />)
    expect(screen.getByText(/no hay repo activo/i)).toBeInTheDocument()
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
})
