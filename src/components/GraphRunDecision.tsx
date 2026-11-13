import { useState } from 'react'
import type { GraphMode, GraphRun, GraphTemplate } from '../types'
import { pendingGate } from '../lib/graph-decision'

const MODES: GraphMode[] = ['auto', 'gate', 'step']

interface Props {
  run: GraphRun
  template: GraphTemplate
  /** Refrescar el run apenas se encoló la decisión, sin esperar el poll de 2 s. */
  onChanged: () => void
}

/** Los controles humanos del run: el modo, y — cuando un gate está esperando —
 *  los concerns que lo frenan con las dos salidas posibles.
 *
 *  Ninguno de los dos botones aplica nada: encolan un `pendingDecision` y el tick
 *  del orquestador es el único que lo aplica y avanza el run (single-writer). Por
 *  eso, con una decisión ya encolada, los botones se apagan. */
export function GraphRunDecision({ run, template, onChanged }: Props) {
  const [feedback, setFeedback] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const gate = pendingGate(template, run)
  const queued = run.pendingDecision != null

  async function send(fn: (() => Promise<unknown> | undefined) | undefined) {
    if (!fn) return   // preload viejo sin estos métodos: no romper la pantalla
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
    onChanged()
  }

  return (
    <div className="gb-isec gb-dec">
      <h5>Run control</h5>

      <div className="gb-modes" role="group" aria-label="Run mode">
        {MODES.map((m) => (
          <button
            key={m}
            className={`gb-mode${run.mode === m ? ' on' : ''}`}
            aria-pressed={run.mode === m}
            disabled={busy}
            onClick={() => void send(() => window.graphRuns?.setMode?.(run.runId, m))}
          >
            {m}
          </button>
        ))}
      </div>

      {gate && (
        <>
          {gate.concerns.length > 0 ? (
            <div className="gb-concerns">
              {gate.concerns.map((c) => (
                <div key={c.from} className="gb-concern">
                  <div className="gb-concern-from">{c.from}</div>
                  <ul>{c.items.map((it, i) => <li key={i}>{it}</li>)}</ul>
                </div>
              ))}
            </div>
          ) : (
            <div className="gb-hint">The gate is holding — no blocking concerns were reported.</div>
          )}

          <textarea
            className="auto-input gb-dec-fb"
            rows={3}
            placeholder="What needs to change? (goes back to the coder)"
            value={feedback}
            disabled={queued}
            onChange={(e) => { setFeedback(e.target.value); setErr(null) }}
          />

          <div className="gb-acts">
            <button
              className="integration-btn primary"
              disabled={queued || busy}
              onClick={() => void send(() => window.graphRuns?.approve?.(run.runId, gate.gateId))}
            >
              Approve anyway
            </button>
            <button
              className="integration-btn"
              disabled={queued || busy}
              onClick={() => {
                const text = feedback.trim()
                if (!text) { setErr('Write what needs to change first.'); return }
                void send(() => window.graphRuns?.requestChanges?.(run.runId, text))
              }}
            >
              Request changes
            </button>
          </div>

          {err && <span className="integration-error">{err}</span>}
          {queued && <span className="gb-hint">Decision queued — applies on the next tick.</span>}
        </>
      )}
    </div>
  )
}
