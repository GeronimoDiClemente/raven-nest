import { useEffect, useState } from 'react'
import { CLOUD_MONTHLY_PRICE } from '../lib/stripe'

interface Props {
  onClose: () => void
  /** The Cloud screen's CTA hands off to the caller instead of running checkout itself
   * — App.tsx already owns that flow via UpgradeModal, no need to duplicate it here. */
  onUpgrade: () => void
}

interface HubStats {
  itemCount: number
  projectCount: number
}

const SCREEN_COUNT = 3

/**
 * The Task 7 hub (docs/superpowers/plans/2026-09-03-memoria-por-cuenta-multi-dispositivo.md):
 * shown once, to every user including Free, on the app's first launch after this feature
 * ships. Three screens — recognition with the user's own numbers, how it works, what Cloud
 * adds — reachable again from Settings without re-triggering the "seen" flag.
 */
export default function MemoryHub({ onClose, onUpgrade }: Props) {
  const [screen, setScreen] = useState(0)
  const [stats, setStats] = useState<HubStats | null>(null)

  useEffect(() => {
    window.memory.hubStats().then(setStats).catch(() => setStats({ itemCount: 0, projectCount: 0 }))
  }, [])

  const next = () => setScreen((s) => Math.min(s + 1, SCREEN_COUNT - 1))

  return (
    <div className="modal-backdrop">
      <div className="memory-hub">
        <div className="memory-hub-body">
          {screen === 0 && <RecognitionScreen stats={stats} />}
          {screen === 1 && <HowItWorksScreen />}
          {screen === 2 && <CloudScreen onUpgrade={onUpgrade} />}
        </div>

        <div className="memory-hub-footer">
          <button className="memory-hub-skip" onClick={onClose}>Skip</button>
          <div className="memory-hub-dots">
            {Array.from({ length: SCREEN_COUNT }).map((_, i) => (
              <span key={i} className={`memory-hub-dot${i === screen ? ' active' : ''}`} />
            ))}
          </div>
          {screen < SCREEN_COUNT - 1 ? (
            <button className="memory-hub-next" onClick={next}>Next</button>
          ) : (
            <button className="memory-hub-next" onClick={onClose}>Got it</button>
          )}
        </div>
      </div>
    </div>
  )
}

function RecognitionScreen({ stats }: { stats: HubStats | null }) {
  if (!stats) {
    return (
      <>
        <h2>Looking at what you've already got…</h2>
        <p>Give us a second.</p>
      </>
    )
  }

  if (stats.itemCount === 0) {
    return (
      <>
        <h2>Nest starts capturing as you work</h2>
        <p>No setup needed — every session with your AI of choice quietly becomes memory it can use next time.</p>
      </>
    )
  }

  const project = stats.projectCount === 1 ? 'project' : 'projects'

  return (
    <>
      <h2>We found {stats.itemCount} memories across {stats.projectCount} {project} of yours</h2>
      <p>Your AI doesn't start from zero anymore — it already knows how you work.</p>
    </>
  )
}

function HowItWorksScreen() {
  return (
    <>
      <h2>Captured automatically, local-first</h2>
      <p>Nest listens in on every session — decisions, gotchas, the way you like things done — and turns it into memory your AI can pull from later. Nothing to configure, nothing leaves your machine unless you turn on Cloud.</p>
    </>
  )
}

function CloudScreen({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <>
      <h2>Cloud: your memory, on every machine you use</h2>
      <p>Local is free and complete. Cloud adds one thing — pick up on another machine mid-thought, same context, same memories.</p>
      <div className="memory-hub-price">
        <span className="memory-hub-price-amount">${CLOUD_MONTHLY_PRICE}</span>
        <span className="memory-hub-price-period">/mo</span>
      </div>
      <button className="memory-hub-cta" onClick={onUpgrade}>See plans</button>
    </>
  )
}
