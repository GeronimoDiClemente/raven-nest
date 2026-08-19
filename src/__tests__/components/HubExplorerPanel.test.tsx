import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BridgeProvider } from '../../lib/bridge'
import HubExplorerPanel, { type ExplorerRoot } from '../../components/HubExplorerPanel'

function makeMockBridge() {
  const fs = {
    listDir: vi.fn().mockImplementation((_wt: string, relPath: string) => {
      if (relPath === '') return Promise.resolve({ ok: true, entries: [
        { name: 'README.md', path: 'README.md', isDirectory: false },
      ] })
      return Promise.resolve({ ok: true, entries: [] })
    }),
    watch: vi.fn().mockResolvedValue({ ok: true }),
    unwatch: vi.fn().mockResolvedValue(undefined),
    onChanged: vi.fn(() => () => {}),
  }
  const bridge = { fs } as unknown as Window & typeof globalThis
  return { bridge, fs }
}

const roots: ExplorerRoot[] = [
  { tabId: 'ws1', name: 'NEST MAIN', repoPath: '/home/user/raven-nest' },
  { tabId: 'ws2', name: 'AIRA MAIN', repoPath: '/home/user/voxia' },
]

describe('HubExplorerPanel', () => {
  it('shows an empty hint when no open workspace has a repo', () => {
    render(<HubExplorerPanel roots={[]} onOpenFile={vi.fn()} />)
    expect(screen.getByText(/no repos open/i)).toBeInTheDocument()
  })

  it('renders one root header per workspace with its name and repo basename', () => {
    const { bridge } = makeMockBridge()
    render(<BridgeProvider value={bridge}><HubExplorerPanel roots={roots} onOpenFile={vi.fn()} /></BridgeProvider>)
    expect(screen.getByText('NEST MAIN')).toBeInTheDocument()
    expect(screen.getByText('AIRA MAIN')).toBeInTheDocument()
    expect(screen.getByText('raven-nest')).toBeInTheDocument()
    expect(screen.getByText('voxia')).toBeInTheDocument()
  })

  it('is collapsed by default (does not list files) and mounts the tree on expand', async () => {
    const { bridge, fs } = makeMockBridge()
    render(<BridgeProvider value={bridge}><HubExplorerPanel roots={roots} onOpenFile={vi.fn()} /></BridgeProvider>)
    // Nothing listed yet — no watcher/git spawned for collapsed roots.
    expect(screen.queryByText('README.md')).not.toBeInTheDocument()
    expect(fs.listDir).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('NEST MAIN'))
    await waitFor(() => expect(screen.getByText('README.md')).toBeInTheDocument())
  })

  it('opens a file with its owning workspace id and repo path', async () => {
    const { bridge } = makeMockBridge()
    const onOpenFile = vi.fn()
    render(<BridgeProvider value={bridge}><HubExplorerPanel roots={roots} onOpenFile={onOpenFile} /></BridgeProvider>)
    fireEvent.click(screen.getByText('NEST MAIN'))
    await waitFor(() => screen.getByText('README.md'))
    fireEvent.click(screen.getByText('README.md'))
    expect(onOpenFile).toHaveBeenCalledWith('ws1', '/home/user/raven-nest', 'README.md')
  })
})
