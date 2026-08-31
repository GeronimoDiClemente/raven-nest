// Boots the REAL Nest worktree components with the tutorial demo bridge, minus
// the coachmark tour — a clean, full-window replica of the app for capturing
// authentic UI footage. Mirrors TutorialSandbox's wiring.
import { useRef, useState, useEffect, useCallback } from 'react'
import { createDemoHarness, type DemoHarness } from '../src/tutorial/demo/harness'
import { createDemoState, type DemoState } from '../src/tutorial/demo/fixtures'
import { BridgeProvider } from '../src/lib/bridge'
import { DemoTabBar, DemoWorkspace } from '../src/tutorial/DemoWorkspaceMock'
import { WorktreesSection } from '../src/components/WorktreesSection'
import { NewWorktreeModal } from '../src/components/NewWorktreeModal'
import { DiffViewerPanel } from '../src/components/DiffViewerPanel'

export function CaptureWorktrees() {
  const harnessRef = useRef<DemoHarness | null>(null)
  const stateRef = useRef<DemoState | null>(null)
  const [ready, setReady] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [diffPath, setDiffPath] = useState<string | null>(null)
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(null)
  // Bumped after a worktree is created so WorktreesSection re-lists and shows it.
  const [refreshKey, setRefreshKey] = useState(0)

  if (!harnessRef.current) {
    stateRef.current = createDemoState()
    harnessRef.current = createDemoHarness(stateRef.current, { supabase: false, fetch: false })
  }

  useEffect(() => {
    const h = harnessRef.current!
    h.activate()
    setReady(true)
    return () => h.deactivate()
  }, [])

  const resolveBranch = useCallback(
    (repoPath: string) => stateRef.current?.worktree.worktrees.find((w) => w.repoPath === repoPath)?.branch,
    [],
  )

  if (!ready) return null
  const repoPath = stateRef.current!.worktree.rootRepoPath

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'flex', flexDirection: 'column' }}>
      <BridgeProvider value={harnessRef.current!.bridge}>
        <DemoTabBar />
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div className="sidebar expanded" style={{ width: 320, borderRight: '1px solid #1b1b20', overflow: 'auto' }}>
            <div className="sidebar-worktrees-wrap">
              <WorktreesSection
                repoPath={repoPath}
                activeRepoPath={repoPath}
                refreshKey={refreshKey}
                onSelect={(p) => { setSelectedRepoPath(p); setDiffPath(p) }}
                onNewClick={() => setModalOpen(true)}
              />
            </div>
          </div>
          <DemoWorkspace resolveBranch={resolveBranch} selectedRepoPath={selectedRepoPath} />
        </div>
        <NewWorktreeModal open={modalOpen} repoPath={repoPath} onClose={() => setModalOpen(false)} onCreated={() => { setModalOpen(false); setRefreshKey((k) => k + 1) }} />
        <DiffViewerPanel open={diffPath !== null} worktreePath={diffPath} onClose={() => setDiffPath(null)} />
      </BridgeProvider>
    </div>
  )
}
