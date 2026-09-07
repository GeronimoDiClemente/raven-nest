import { useEffect, useMemo, useState } from 'react'
import type { GraphTemplate, GraphRun, PersistedGraphRun, NodeRunState } from '../types'
import { toFlow, type FlowInputNode, type FlowNodeState } from '../lib/graph-view'
import { GraphNodeTerminal } from './GraphNodeTerminal'
import { GraphRunDecision } from './GraphRunDecision'

interface GraphBoardProps {
  onClose: () => void
  activeRepoPath?: string | null
}

// NodeRunState → the visual bucket the mockups use (working/needs/done/queued).
const STATE_CLASS: Record<NodeRunState, 'working' | 'needs' | 'done' | 'queued'> = {
  queued: 'queued',
  running: 'working',
  needs_input: 'needs',
  blocked: 'needs',
  done: 'done',
  failed: 'needs',
  skipped: 'queued',
}

const ROLE_SHORT: Record<string, string> = {
  architect: 'Arch', coder: 'Coder', reviewer: 'Rev', tester: 'Test', gate: 'Gate',
}

/** Aggregate a run's node states into a single tile status. */
function runStatus(run: GraphRun): 'working' | 'needs' | 'done' | 'queued' {
  const states = Object.values(run.nodes).map((n) => n.state)
  if (states.some((s) => s === 'needs_input' || s === 'blocked' || s === 'failed')) return 'needs'
  if (states.some((s) => s === 'running')) return 'working'
  if (states.length > 0 && states.every((s) => s === 'done' || s === 'skipped')) return 'done'
  return 'queued'
}

function toFlowInput(template: GraphTemplate, run: GraphRun): FlowInputNode[] {
  return template.nodes.map((n) => {
    const base: FlowInputNode = {
      id: n.id, role: n.role, kind: n.kind, dependsOn: n.dependsOn,
      state: (run.nodes[n.id]?.state ?? 'queued') as FlowNodeState,
    }
    if (n.focus !== undefined) base.focus = n.focus
    return base
  })
}

/** Group nodes into rank columns (x from the pure longest-path layout). */
function rankColumns(input: FlowInputNode[]): FlowInputNode[][] {
  const { nodes } = toFlow(input)
  const xById = new Map(nodes.map((n) => [n.id, n.position.x]))
  const byX = new Map<number, FlowInputNode[]>()
  for (const n of input) {
    const x = xById.get(n.id) ?? 0
    const arr = byX.get(x) ?? []
    arr.push(n)
    byX.set(x, arr)
  }
  return [...byX.entries()].sort((a, b) => a[0] - b[0]).map(([, arr]) => arr)
}

/** A column is "complete" when every node in it is done/skipped → solid edge. */
function columnDone(col: FlowInputNode[]): boolean {
  return col.every((n) => n.state === 'done' || n.state === 'skipped')
}

// ── Mini-graph (board tile) ─────────────────────────────────────────────────
function MiniGraph({ input }: { input: FlowInputNode[] }) {
  const cols = useMemo(() => rankColumns(input), [input])
  return (
    <div className="gb-mini">
      {cols.map((col, ci) => (
        <div key={ci} className="gb-mini-seg">
          {ci > 0 && <div className={`gb-mc ${columnDone(cols[ci - 1]) ? 'on' : 'dash'}`} />}
          {col.length > 1 ? (
            <div className="gb-grp">
              {col.map((n) => <MiniNode key={n.id} node={n} />)}
            </div>
          ) : (
            <MiniNode node={col[0]} />
          )}
        </div>
      ))}
    </div>
  )
}

function MiniNode({ node }: { node: FlowInputNode }) {
  if (node.kind === 'gate') return <div className="gb-gate-mini">⋈</div>
  return (
    <div className={`gb-mn ${STATE_CLASS[node.state as NodeRunState]}`}>
      <span className="gb-dot" />
      {ROLE_SHORT[node.role] ?? node.role}
      {node.focus && <small>{node.focus}</small>}
    </div>
  )
}

// ── Full flow (detail stage) ────────────────────────────────────────────────
function FlowGraph({ input, selected, onSelect }: {
  input: FlowInputNode[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  const cols = useMemo(() => rankColumns(input), [input])
  return (
    <div className="gb-flow">
      {cols.map((col, ci) => (
        <div key={ci} className="gb-flow-seg">
          {ci > 0 && <div className={`gb-conn ${columnDone(cols[ci - 1]) ? 'on' : 'dash'}`} />}
          {col.length > 1 ? (
            <div className="gb-grp-v">
              {col.map((n) => <FlowNode key={n.id} node={n} selected={selected === n.id} onSelect={onSelect} />)}
            </div>
          ) : (
            <FlowNode node={col[0]} selected={selected === col[0].id} onSelect={onSelect} />
          )}
        </div>
      ))}
    </div>
  )
}

function FlowNode({ node, selected, onSelect }: {
  node: FlowInputNode
  selected: boolean
  onSelect: (id: string) => void
}) {
  if (node.kind === 'gate') {
    return <div className="gb-gate">⋈ Gate</div>
  }
  const cls = STATE_CLASS[node.state as NodeRunState]
  return (
    <div className={`gb-node ${cls}${selected ? ' sel' : ''}`} onClick={() => onSelect(node.id)}>
      <div className="gb-node-r1">
        <span className="gb-role">{node.role}</span>
        <span className="gb-st"><span className="gb-s" />{node.state}</span>
      </div>
      {node.focus && <div className="gb-focus">{node.focus}</div>}
      <div className="gb-open">↳ open terminal</div>
    </div>
  )
}

// ── Board (overlay root) ────────────────────────────────────────────────────
export function GraphBoard({ onClose, activeRepoPath }: GraphBoardProps) {
  const [runs, setRuns] = useState<PersistedGraphRun[]>([])
  const [templates, setTemplates] = useState<GraphTemplate[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [showTerm, setShowTerm] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startErr, setStartErr] = useState<string | null>(null)
  const [newTemplate, setNewTemplate] = useState('full')
  const [newBranch, setNewBranch] = useState('')

  const refresh = () => {
    void window.graphRuns?.list?.().then(setRuns)
    void window.graphTemplates?.list?.().then(setTemplates)
  }
  useEffect(() => {
    refresh()
    // The orchestrator tick persists every ~3s; poll a bit faster to reflect it.
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [])

  const templateById = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates])
  const selected = selectedRunId ? runs.find((r) => r.run.runId === selectedRunId) ?? null : null

  async function handleStart() {
    setStartErr(null)
    if (!activeRepoPath) { setStartErr('Open a repo tab first'); return }
    if (!newBranch.trim()) { setStartErr('Enter a branch name'); return }
    setStarting(true)
    try {
      const res = await window.graphRuns?.start?.({
        repoPath: activeRepoPath,
        templateId: newTemplate,
        ticketId: newBranch.trim(),
        branch: newBranch.trim(),
      })
      if (!res || !res.ok) { setStartErr(res && !res.ok ? res.error : 'Failed to start'); return }
      setNewBranch('')
      refresh()
      setSelectedRunId(res.runId)
    } finally {
      setStarting(false)
    }
  }

  const counts = useMemo(() => {
    let working = 0, needs = 0, done = 0
    for (const { run } of runs) {
      const s = runStatus(run)
      if (s === 'working') working++
      else if (s === 'needs') needs++
      else if (s === 'done') done++
    }
    return { working, needs, done }
  }, [runs])

  return (
    <div className="teams-workspace">
      <div className="teams-workspace-header">
        <button className="tw-back-btn" onClick={selected ? () => { setSelectedRunId(null); setSelectedNodeId(null); setShowTerm(false) } : onClose}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 5 }}>
            <path d="M8 2L4 6.5L8 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {selected ? 'Graphs' : 'Back'}
        </button>
        <div className="tw-header-center">
          <span className="gb-crumb">
            <b>Orchestration</b>
            {selected && <><span className="gb-sep">›</span><span className="mono">{selected.run.ticketId}</span></>}
          </span>
        </div>
        <div className="tw-header-right" />
      </div>

      <div className="teams-workspace-body">
        <div className="teams-workspace-content">
          {!selected ? (
            <div className="gb-view">
              <div className="gb-sub">
                <span><b>{runs.length}</b> graphs</span>
                <span><b>{counts.working}</b> working</span>
                <span><b>{counts.needs}</b> needs you</span>
                <span><b>{counts.done}</b> done</span>
              </div>

              <div className="gb-start">
                <select className="auto-select" value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)}>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <input
                  className="auto-input"
                  placeholder="branch (e.g. graph/rate-limit)"
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value)}
                />
                <button className="integration-btn primary" disabled={starting} onClick={handleStart}>
                  {starting ? 'Starting…' : 'New run'}
                </button>
                {startErr && <span className="integration-error">{startErr}</span>}
              </div>

              {runs.length === 0 ? (
                <div className="gb-empty">
                  <div className="gb-empty-title">No graph runs yet</div>
                  <div className="gb-empty-sub">Start one above — an Architect → Coder → Reviewers → Gate → Tester graph runs headless; click a node to open its terminal.</div>
                </div>
              ) : (
                <div className="gb-board">
                  {runs.map(({ run }) => {
                    const template = templateById.get(run.templateId)
                    const input = template ? toFlowInput(template, run) : []
                    return (
                      <div key={run.runId} className="gb-tile" onClick={() => setSelectedRunId(run.runId)}>
                        <div className="gb-thead">
                          <span className="gb-id mono">{run.ticketId}</span>
                          <span className="gb-ti">{run.branch}</span>
                          <span className={`gb-st-dot ${runStatus(run)}`} />
                        </div>
                        {template ? <MiniGraph input={input} /> : <div className="gb-focus">template “{run.templateId}” not found</div>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <DetailView
              persisted={selected}
              template={templateById.get(selected.run.templateId) ?? null}
              selectedNodeId={selectedNodeId}
              onSelectNode={(id) => { setSelectedNodeId(id); setShowTerm(false) }}
              showTerm={showTerm}
              onToggleTerm={() => setShowTerm((v) => !v)}
              onChanged={refresh}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function DetailView({ persisted, template, selectedNodeId, onSelectNode, showTerm, onToggleTerm, onChanged }: {
  persisted: PersistedGraphRun
  template: GraphTemplate | null
  selectedNodeId: string | null
  onSelectNode: (id: string) => void
  showTerm: boolean
  onToggleTerm: () => void
  onChanged: () => void
}) {
  const { run } = persisted
  if (!template) return <div className="gb-empty"><div className="gb-empty-title">Template not found</div></div>
  const input = toFlowInput(template, run)
  const node = selectedNodeId ? template.nodes.find((n) => n.id === selectedNodeId) ?? null : null
  const rt = selectedNodeId ? run.nodes[selectedNodeId] : undefined

  return (
    <div className="gb-detail">
      <div className="gb-stage">
        <FlowGraph input={input} selected={selectedNodeId} onSelect={onSelectNode} />
      </div>
      <div className="gb-insp">
        <GraphRunDecision run={run} template={template} onChanged={onChanged} />
        {!node ? (
          <div className="gb-insp-empty">Select a node to inspect it.</div>
        ) : (
          <>
            <div className="gb-ihead">
              <div className="gb-irole">
                <span className={`gb-s ${STATE_CLASS[(rt?.state ?? 'queued') as NodeRunState]}`} />
                {node.role}{node.focus ? ` · ${node.focus}` : ''}
              </div>
              <div className="gb-imeta">
                <span><b>{node.model ?? node.agent ?? '—'}</b></span>
                <span>{rt?.state ?? 'queued'}</span>
              </div>
            </div>
            {rt?.summary && (
              <div className="gb-isec">
                <h5>Summary</h5>
                <div className="gb-qbox">{rt.summary}</div>
              </div>
            )}
            <div className="gb-isec">
              <h5>Actions</h5>
              <div className="gb-acts">
                <button className="integration-btn primary" disabled={!rt?.paneId} onClick={onToggleTerm}>
                  {showTerm ? 'Hide terminal' : 'Open terminal'}
                </button>
                {!rt?.paneId && <span className="gb-hint">No pane yet — the node hasn’t launched.</span>}
              </div>
            </div>
            {showTerm && rt?.paneId && (
              <div className="gb-isec gb-isec-term">
                <h5>Terminal — type to reply</h5>
                <GraphNodeTerminal runId={run.runId} nodeId={node.id} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
