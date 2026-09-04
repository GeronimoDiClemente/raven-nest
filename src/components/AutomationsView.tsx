import { useEffect, useState } from 'react'
import { AI_CONFIG, type AIType, type Automation, type WorkerSpec, type WorkerStep } from '../types'
import { basename } from '../lib/path'
import { bridge } from '../lib/bridge'

type SchedulePreset = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom'

const SCHEDULE_OPTIONS: { value: SchedulePreset; label: string }[] = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'custom', label: 'Custom (cron)' },
]

// AI CLIs the app already knows how to drive (mirrors `AIType` minus
// terminal/custom/browser, which don't make sense for a headless run).
const PROVIDER_OPTIONS: { value: string; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'copilot', label: 'Copilot' },
  { value: 'opencode', label: 'opencode' },
]

const DEFAULT_TIME = '09:00'

// Real launchable agents a worker step can run as. Excludes terminal/browser
// (not meaningful worker agents) and custom (needs a customCliId picker —
// deferred to a later enhancement). Order mirrors PROVIDER_OPTIONS above.
const WORKER_AGENTS: AIType[] = ['claude', 'codex', 'gemini', 'copilot', 'opencode']

function nextRunLabel(nextRunAt: number | null): string {
  if (nextRunAt == null) return 'Not scheduled'
  return `Next: ${new Date(nextRunAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
}

/** Scheduled agents — run a prompt on a schedule (nightly audits, triage,
 *  summaries). Time-driven, contrasted with Recipes, which are event-driven.
 *  Loads/mutates via `window.automations` (electron/integrations/scheduler.ts
 *  on the main side); the actual headless CLI run it dispatches is currently
 *  stubbed there — see the comment above `runAutomationStub` in main.ts. */
export function AutomationsView() {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [repos, setRepos] = useState<string[]>([])
  const [showForm, setShowForm] = useState(false)

  const [workers, setWorkers] = useState<WorkerSpec[]>([])
  const [showWorkerForm, setShowWorkerForm] = useState(false)
  const [wName, setWName] = useState('')
  const [wSteps, setWSteps] = useState<WorkerStep[]>([{ agent: 'claude' }])
  const [wSubmitting, setWSubmitting] = useState(false)
  const [wError, setWError] = useState<string | null>(null)
  // Saved CLI accounts per agent, loaded lazily (only for account-agents, i.e.
  // not AI_CONFIG[agent].noAccount) and cached so switching between steps that
  // share an agent doesn't refetch. Backs the per-step "Account" select below.
  const [accountsByAgent, setAccountsByAgent] = useState<Record<string, string[]>>({})

  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState<SchedulePreset>('daily')
  const [time, setTime] = useState(DEFAULT_TIME)
  const [cron, setCron] = useState('')
  const [prompt, setPrompt] = useState('')
  const [repo, setRepo] = useState('')
  const [provider, setProvider] = useState('claude')
  const [model, setModel] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => { void window.automations?.list?.().then(setAutomations) }
  const refreshWorkers = () => { void window.workerSpecs?.list?.().then(setWorkers) }

  useEffect(() => {
    refresh()
    void window.worktree?.listAll?.().then((res) => {
      if (res && res.ok) {
        setRepos([...new Set(res.worktrees.map((w) => w.rootRepoPath))].sort())
      }
    })
  }, [])

  useEffect(() => { refreshWorkers() }, [])

  // Ensure accounts are loaded for every account-agent currently used by a
  // step, whenever the form is open (covers both "form just opened" and "a
  // step's agent just changed"). Keyed on a stable string so retyping
  // instructions (which also replaces the wSteps array) doesn't refetch.
  const stepAgentsKey = [...new Set(wSteps.map((s) => s.agent))].join(',')
  useEffect(() => {
    if (!showWorkerForm) return
    for (const agent of stepAgentsKey.split(',') as AIType[]) {
      if (!agent || AI_CONFIG[agent].noAccount || accountsByAgent[agent]) continue
      void bridge.accounts.list(agent).then((list) => {
        setAccountsByAgent((prev) => ({ ...prev, [agent]: list }))
      })
    }
  }, [showWorkerForm, stepAgentsKey, accountsByAgent])

  const resetForm = () => {
    setName('')
    setSchedule('daily')
    setTime(DEFAULT_TIME)
    setCron('')
    setPrompt('')
    setRepo('')
    setProvider('claude')
    setModel('')
    setError(null)
  }

  const handleCreate = async () => {
    setError(null)
    const trigger = schedule === 'custom' ? cron.trim() : schedule
    if (!name.trim() || !prompt.trim() || !trigger) {
      setError('Name, prompt and schedule are required.')
      return
    }
    setSubmitting(true)
    try {
      await window.automations.create({
        name: name.trim(),
        trigger,
        time: schedule === 'hourly' || schedule === 'custom' ? undefined : time,
        prompt: prompt.trim(),
        repo: repo || undefined,
        provider: provider || undefined,
        model: model || undefined,
      })
      resetForm()
      setShowForm(false)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create automation')
    } finally {
      setSubmitting(false)
    }
  }

  const toggle = async (a: Automation) => {
    await window.automations.update(a.id, { enabled: !a.enabled })
    refresh()
  }

  const remove = async (a: Automation) => {
    await window.automations.delete(a.id)
    refresh()
  }

  const resetWorkerForm = () => {
    setWName('')
    setWSteps([{ agent: 'claude' }])
    setWError(null)
  }

  const updateStep = (i: number, patch: Partial<WorkerStep>) => {
    setWSteps((steps) => steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  const addStep = () => setWSteps((steps) => [...steps, { agent: 'claude' }])

  const removeStep = (i: number) => {
    setWSteps((steps) => (steps.length > 1 ? steps.filter((_, idx) => idx !== i) : steps))
  }

  const createWorker = async () => {
    setWError(null)
    if (!wName.trim()) return
    setWSubmitting(true)
    try {
      await window.workerSpecs.save({
        name: wName.trim(),
        steps: wSteps.map((s) => ({
          agent: s.agent,
          model: s.model || undefined,
          instructions: s.instructions?.trim() || undefined,
          role: s.role?.trim() || undefined,
          account: s.account || undefined,
        })),
      })
      resetWorkerForm()
      setShowWorkerForm(false)
      refreshWorkers()
    } catch (err) {
      setWError(err instanceof Error ? err.message : 'Could not create worker')
    } finally {
      setWSubmitting(false)
    }
  }

  const deleteWorker = async (w: WorkerSpec) => {
    setWError(null)
    try {
      await window.workerSpecs.delete(w.id)
      refreshWorkers()
    } catch (err) {
      setWError(err instanceof Error ? err.message : 'Could not delete worker')
    }
  }

  return (
    <div className="auto-view">
      <div className="auto-workers">
        <div className="auto-head">
          <div>
            <h2 className="auto-title">Workers</h2>
            <p className="auto-lead">
              Reusable task types: pick the agent + model once, run it anywhere.
            </p>
          </div>
          <button className="integration-btn primary" onClick={() => setShowWorkerForm((v) => !v)}>
            + New worker
          </button>
        </div>

        {showWorkerForm && (
          <div className="auto-form">
            <input
              className="auto-input"
              placeholder="Name (e.g. Code reviewer)"
              value={wName}
              onChange={(e) => setWName(e.target.value)}
            />

            {wSteps.map((step, i) => (
              <div className="auto-step-row" key={i}>
                <div className="auto-form-row">
                  <select
                    className="auto-select"
                    aria-label="Agent"
                    value={step.agent}
                    onChange={(e) => updateStep(i, { agent: e.target.value as AIType, model: undefined, account: undefined })}
                  >
                    {WORKER_AGENTS.map((a) => <option key={a} value={a}>{AI_CONFIG[a].label}</option>)}
                  </select>
                  {!!AI_CONFIG[step.agent].models?.length && (
                    <select
                      className="auto-select"
                      aria-label="Model"
                      value={step.model ?? ''}
                      onChange={(e) => updateStep(i, { model: e.target.value || undefined })}
                    >
                      <option value="">Default model</option>
                      {AI_CONFIG[step.agent].models!.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  )}
                  {!AI_CONFIG[step.agent].noAccount && (
                    <select
                      className="auto-select"
                      aria-label="Account"
                      value={step.account ?? ''}
                      disabled={!accountsByAgent[step.agent]?.length}
                      onChange={(e) => updateStep(i, { account: e.target.value || undefined })}
                    >
                      <option value="">Auto (pick at run time)</option>
                      {(accountsByAgent[step.agent] ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  )}
                </div>

                <textarea
                  className="auto-textarea"
                  placeholder="Instructions for this worker…"
                  value={step.instructions ?? ''}
                  onChange={(e) => updateStep(i, { instructions: e.target.value })}
                  rows={3}
                />

                <div className="auto-step-footer">
                  <input
                    className="auto-input"
                    placeholder="role (optional), e.g. explore"
                    value={step.role ?? ''}
                    onChange={(e) => updateStep(i, { role: e.target.value })}
                  />
                  {wSteps.length > 1 && (
                    <button
                      type="button"
                      className="auto-step-remove"
                      aria-label={`Remove step ${i + 1}`}
                      onClick={() => removeStep(i)}
                    >
                      × Remove
                    </button>
                  )}
                </div>
              </div>
            ))}

            <button type="button" className="integration-btn ghost auto-step-add" onClick={addStep}>+ Add step</button>

            {wError && <p className="integration-error">{wError}</p>}

            <div className="auto-form-actions">
              <button className="integration-btn ghost" onClick={() => { setShowWorkerForm(false); resetWorkerForm() }}>Cancel</button>
              <button className="integration-btn primary" disabled={wSubmitting} onClick={() => void createWorker()}>
                {wSubmitting ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {wError && !showWorkerForm && <p className="integration-error">{wError}</p>}

        {workers.length === 0 ? (
          <div className="auto-empty">No workers yet. Create one to reuse an agent + model combo.</div>
        ) : (
          <div className="auto-list">
            {workers.map((w) => (
              <div key={w.id} className="auto-row">
                <div className="auto-row-main">
                  <span className="auto-row-name">{w.name}</span>
                  <span className="auto-row-sched">
                    {w.steps.map((s) => (s.model ? `${s.agent}:${s.model}` : s.agent)).join(' → ')}
                  </span>
                </div>
                <div className="auto-row-actions">
                  <button
                    className="auto-delete"
                    onClick={() => void deleteWorker(w)}
                    title="Delete"
                    aria-label={`Delete ${w.name}`}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="auto-head">
        <div>
          <h2 className="auto-title">Automations</h2>
          <p className="auto-lead">
            Scheduled agents — run a prompt on a schedule. Time-driven, unlike Recipes which are event-driven.
          </p>
        </div>
        <button className="integration-btn primary" onClick={() => setShowForm((v) => !v)}>
          + New automation
        </button>
      </div>

      {showForm && (
        <div className="auto-form">
          <input
            className="auto-input"
            placeholder="Name (e.g. Nightly security audit)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <div className="auto-form-row">
            <select
              className="auto-select"
              aria-label="Schedule"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value as SchedulePreset)}
            >
              {SCHEDULE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {schedule === 'custom' ? (
              <input
                className="auto-input"
                placeholder="0 18 * * 1-5"
                aria-label="Cron expression"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
              />
            ) : schedule !== 'hourly' ? (
              <input
                className="auto-input auto-input-time"
                type="time"
                aria-label="Time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            ) : null}
          </div>
          {schedule === 'weekly' && <p className="auto-form-hint">Runs every Monday.</p>}

          <textarea
            className="auto-textarea"
            placeholder="Prompt for the agent to run…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
          />

          <div className="auto-form-row">
            <select className="auto-select" aria-label="Repo" value={repo} onChange={(e) => setRepo(e.target.value)}>
              <option value="">No repo</option>
              {repos.map((r) => <option key={r} value={r}>{basename(r)}</option>)}
            </select>
            <select
              className="auto-select"
              aria-label="Provider"
              value={provider}
              onChange={(e) => { setProvider(e.target.value); setModel('') }}
            >
              {PROVIDER_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            {!!AI_CONFIG[provider as AIType]?.models?.length && (
              <select className="auto-select" aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">Default model</option>
                {AI_CONFIG[provider as AIType]!.models!.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
          </div>

          {error && <p className="integration-error">{error}</p>}

          <div className="auto-form-actions">
            <button className="integration-btn ghost" onClick={() => { setShowForm(false); resetForm() }}>Cancel</button>
            <button className="integration-btn primary" disabled={submitting} onClick={() => void handleCreate()}>
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {automations.length === 0 ? (
        <div className="auto-empty">No automations yet. Create one to run a prompt on a schedule.</div>
      ) : (
        <div className="auto-list">
          {automations.map((a) => (
            <div key={a.id} className={a.enabled ? 'auto-row' : 'auto-row auto-row-disabled'}>
              <div className="auto-row-main">
                <span className="auto-row-name">{a.name}</span>
                <span className="auto-row-sched">{a.scheduleLabel}</span>
              </div>
              <div className="auto-row-meta">
                {a.repo && <span className="auto-chip">{basename(a.repo)}</span>}
                {a.provider && <span className="auto-chip auto-chip-provider">{a.provider}</span>}
                <span className="auto-next">{nextRunLabel(a.nextRunAt)}</span>
              </div>
              <div className="auto-row-actions">
                <button
                  className={a.enabled ? 'auto-toggle on' : 'auto-toggle'}
                  onClick={() => void toggle(a)}
                  title={a.enabled ? 'Pause' : 'Enable'}
                >
                  {a.enabled ? 'On' : 'Off'}
                </button>
                <button
                  className="auto-delete"
                  onClick={() => void remove(a)}
                  title="Delete"
                  aria-label={`Delete ${a.name}`}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
