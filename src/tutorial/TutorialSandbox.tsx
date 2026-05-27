// src/tutorial/TutorialSandbox.tsx
import { useRef, useState, useEffect, useCallback } from 'react'
import { createDemoHarness, type DemoHarness } from './demo/harness'
import { createDemoState, type DemoState } from './demo/fixtures'
import { OnboardingTour, type AdvanceSignal } from './OnboardingTour'
import { BridgeProvider } from '../lib/bridge'
import { DemoTabBar, DemoWorkspace } from './DemoWorkspaceMock'
import { getTour } from './registry'
import { WorktreesSection } from '../components/WorktreesSection'
import { NewWorktreeModal } from '../components/NewWorktreeModal'
import { DiffViewerPanel } from '../components/DiffViewerPanel'
import { type TourId, TOUR_ACTIONS } from './types'

// Steps where the workspace must stay visible (drag target / Sync cwd button),
// so the full-screen diff drawer must NOT be open / must not be opened by a
// worktree selection. The diff drawer belongs only to the 'diff'/'diff-panel'
// steps.
const WORKSPACE_STEPS = new Set(['drag-terminal', 'sync-cwd'])

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
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)
  const stateRef = useRef<DemoState | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [diffPath, setDiffPath] = useState<string | null>(null)
  // Drives the workspace mock's cwd divergence (which worktree the user picked).
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(null)
  // Tracks the current tour step id so the sandbox can react (e.g. close panels).
  const [stepId, setStepId] = useState<string | null>(null)
  // Action channel: bumping the nonce advances the step whose advanceOnAction matches.
  const [advanceSignal, setAdvanceSignal] = useState<AdvanceSignal | null>(null)
  const nonceRef = useRef(0)
  const fire = useCallback((action: string) => {
    setAdvanceSignal({ action, nonce: ++nonceRef.current })
  }, [])

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

  // Resolve a dropped worktree path → branch by reading the LIVE demo store
  // (so a worktree the user just created in the real modal resolves too).
  const resolveBranch = useCallback(
    (repoPath: string) => stateRef.current?.worktree.worktrees.find((w) => w.repoPath === repoPath)?.branch,
    [],
  )

  // Close the diff drawer when the tour reaches a step that needs the workspace
  // visible (it would otherwise stay open from the diff-panel step and cover it).
  useEffect(() => {
    if (stepId && WORKSPACE_STEPS.has(stepId)) setDiffPath(null)
  }, [stepId])

  if (!ready) return null
  const tour = getTour(tourId)
  if (!tour) return null
  const repoPath = stateRef.current!.worktree.rootRepoPath

  return (
    <div ref={containerRef} className="tutorial-sandbox" style={{ position: 'fixed', inset: 0, zIndex: 1900, background: '#000', display: 'flex', flexDirection: 'column' }}>
      {/*
        Only the components INSIDE this provider read the demo mocks (via
        useBridge). The live app, mounted outside this subtree, keeps reading
        window.* and is untouched even though it renders these same components.
      */}
      <BridgeProvider value={harnessRef.current!.bridge}>
        {/* Window-wide tab bar (static mock) so the sandbox reads like the real app. */}
        <DemoTabBar />

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Left panel mimics the real sidebar wrapper using the real CSS classes */}
          <div className="sidebar expanded" style={{ width: 280, borderRight: '1px solid #1b1b20', overflow: 'auto' }}>
            <div className="sidebar-worktrees-wrap">
              <WorktreesSection
                repoPath={repoPath}
                activeRepoPath={repoPath}
                onSelect={(p) => {
                  setSelectedRepoPath(p)
                  // On the workspace steps, selecting a worktree must diverge the
                  // pane WITHOUT opening the diff drawer (it would cover the
                  // Sync cwd button / drop area the step points at).
                  if (!WORKSPACE_STEPS.has(stepId ?? '')) setDiffPath(p)
                }}
                onNewClick={() => setModalOpen(true)}
              />
            </div>
          </div>

          {/* Right panel: an interactive workspace replica (drop target + fake panes). */}
          <DemoWorkspace
            resolveBranch={resolveBranch}
            selectedRepoPath={selectedRepoPath}
            onPaneOpened={() => fire(TOUR_ACTIONS.DROP)}
            onSyncCwd={() => fire(TOUR_ACTIONS.SYNC)}
          />
        </div>

        <NewWorktreeModal
          open={modalOpen}
          repoPath={repoPath}
          onClose={() => setModalOpen(false)}
          onCreated={() => setModalOpen(false)}
        />
        <DiffViewerPanel open={diffPath !== null} worktreePath={diffPath} onClose={() => setDiffPath(null)} />
      </BridgeProvider>

      {/* The tour scopes anchor lookups to this sandbox container so it never
          targets the live app's duplicate data-tour-id anchors behind the overlay. */}
      <OnboardingTour steps={tour.steps} onClose={onClose} rootRef={containerRef} advanceSignal={advanceSignal} onStepChange={setStepId} />
    </div>
  )
}
