// src/tutorial/TutorialSandbox.tsx
import { useRef, useState, useEffect } from 'react'
import { createDemoHarness, type DemoHarness } from './demo/harness'
import { createDemoState, type DemoState } from './demo/fixtures'
import { OnboardingTour } from './OnboardingTour'
import { getTour } from './registry'
import { WorktreesSection } from '../components/WorktreesSection'
import { NewWorktreeModal } from '../components/NewWorktreeModal'
import { DiffViewerPanel } from '../components/DiffViewerPanel'
import type { TourId } from './types'

interface Props {
  tourId: TourId
  onClose: () => void
}

/**
 * Full-screen overlay that runs a tutorial section in demo mode: activates a
 * (selective) demo harness so the mounted REAL components read mocks via bridge,
 * then renders those components + the coachmark tour. The background app is
 * untouched (it uses window.* directly). Worktrees does NOT swap supabase.
 */
export function TutorialSandbox({ tourId, onClose }: Props) {
  const harnessRef = useRef<DemoHarness | null>(null)
  const [ready, setReady] = useState(false)
  const stateRef = useRef<DemoState | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [diffPath, setDiffPath] = useState<string | null>(null)

  if (!harnessRef.current) {
    stateRef.current = createDemoState()
    // Worktrees needs no supabase/fetch — keep them off for isolation.
    harnessRef.current = createDemoHarness(stateRef.current, { supabase: false, fetch: false })
  }

  useEffect(() => {
    const h = harnessRef.current!
    h.activate()
    setReady(true)
    return () => {
      h.deactivate()
      setReady(false)
    }
  }, [])

  if (!ready) return null
  const tour = getTour(tourId)
  if (!tour) return null
  const repoPath = stateRef.current!.worktree.rootRepoPath

  return (
    <div className="tutorial-sandbox" style={{ position: 'fixed', inset: 0, zIndex: 1900, background: '#0b0b0c', display: 'flex' }}>
      {/* Left panel mimics the real sidebar wrapper using the real CSS classes */}
      <div className="sidebar expanded" style={{ width: 280, borderRight: '1px solid #1b1b20', overflow: 'auto' }}>
        <div className="sidebar-worktrees-wrap">
          <WorktreesSection
            repoPath={repoPath}
            activeRepoPath={repoPath}
            onSelect={(p) => setDiffPath(p)}
            onNewClick={() => setModalOpen(true)}
          />
        </div>
      </div>
      <div className="workspace" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b6b74' }}>
        Tutorial: Worktrees
      </div>

      <NewWorktreeModal
        open={modalOpen}
        repoPath={repoPath}
        onClose={() => setModalOpen(false)}
        onCreated={() => setModalOpen(false)}
      />
      <DiffViewerPanel open={diffPath !== null} worktreePath={diffPath} onClose={() => setDiffPath(null)} />

      <OnboardingTour steps={tour.steps} onClose={onClose} />
    </div>
  )
}
