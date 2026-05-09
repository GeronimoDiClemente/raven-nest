import { useState, useEffect, useRef, useCallback } from 'react'
import { useProfile } from '../hooks/useProfile'
import { useTeam } from '../hooks/useTeam'
import { useSharedMcpConfigs } from '../hooks/useSharedMcpConfigs'
import { useFixedPopover } from '../hooks/useFixedPopover'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  repoPath?: string
  onRequireUpgrade?: () => void
}

interface FormState {
  command: string
  args: string[]
  env: { key: string; value: string }[]
}

function serverToForm(server: unknown): FormState {
  const s = (server && typeof server === 'object' && !Array.isArray(server))
    ? server as Record<string, unknown>
    : {}
  return {
    command: typeof s.command === 'string' ? s.command : '',
    args: Array.isArray(s.args) ? s.args.map(String) : [],
    env: s.env && typeof s.env === 'object' && !Array.isArray(s.env)
      ? Object.entries(s.env as Record<string, unknown>).map(([key, value]) => ({ key, value: String(value) }))
      : [],
  }
}

function formToServer(form: FormState): Record<string, unknown> {
  const result: Record<string, unknown> = {
    command: form.command,
    args: form.args,
  }
  if (form.env.length > 0) {
    result.env = Object.fromEntries(form.env.map(({ key, value }) => [key, value]))
  }
  return result
}

export default function MCPPanel({ repoPath, onRequireUpgrade }: Props) {
  const [open, setOpen] = useState(false)
  const [globalPath, setGlobalPath] = useState('')
  const [globalServers, setGlobalServers] = useState<Record<string, unknown>>({})
  const [projectServers, setProjectServers] = useState<Record<string, unknown>>({})
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [editTab, setEditTab] = useState<'form' | 'json'>('form')
  const [formState, setFormState] = useState<FormState>({ command: '', args: [], env: [] })
  const [jsonValue, setJsonValue] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ scope: 'global' | 'project'; name: string } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const popPos = useFixedPopover(panelRef, open, popoverRef)
  const { plan } = useProfile()

  const projectPath = repoPath ? `${repoPath}/.mcp.json` : null
  const { team } = useTeam()
  const { share: shareMcp } = useSharedMcpConfigs(team?.id)

  const load = useCallback(async (gPath: string) => {
    const [g, p] = await Promise.all([
      window.mcp.read(gPath),
      projectPath ? window.mcp.read(projectPath) : Promise.resolve({}),
    ])
    setGlobalServers(g)
    setProjectServers(p)
  }, [projectPath])

  useEffect(() => {
    if (!open) return
    window.mcp.globalPath().then((gPath) => {
      setGlobalPath(gPath)
      load(gPath)
    })
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
        setExpandedKey(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const expand = (scope: 'global' | 'project', name: string) => {
    const key = `${scope}:${name}`
    if (expandedKey === key) { setExpandedKey(null); return }
    const servers = scope === 'global' ? globalServers : projectServers
    const server = servers[name]
    setFormState(serverToForm(server))
    setJsonValue(JSON.stringify(server, null, 2))
    setEditTab('form')
    setSaveError(null)
    setExpandedKey(key)
  }

  const switchTab = (tab: 'form' | 'json') => {
    setSaveError(null)
    if (tab === 'json' && editTab === 'form') {
      setJsonValue(JSON.stringify(formToServer(formState), null, 2))
    } else if (tab === 'form' && editTab === 'json') {
      try {
        const parsed = JSON.parse(jsonValue)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          setSaveError('Invalid JSON — fix it before switching to Form view')
          return
        }
        setFormState(serverToForm(parsed))
      } catch {
        setSaveError('Invalid JSON — fix it before switching to Form view')
        return
      }
    }
    setEditTab(tab)
  }

  const getCurrentServerObj = (): Record<string, unknown> | null => {
    if (editTab === 'form') return formToServer(formState)
    try {
      const parsed = JSON.parse(jsonValue)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
      return parsed as Record<string, unknown>
    } catch {
      return null
    }
  }

  const save = async (scope: 'global' | 'project', name: string) => {
    setSaveError(null)
    const serverObj = getCurrentServerObj()
    if (!serverObj) {
      setSaveError(editTab === 'json' ? 'Invalid JSON' : 'Invalid data')
      return
    }
    const filePath = scope === 'global' ? globalPath : projectPath!
    const updated = { ...(scope === 'global' ? globalServers : projectServers), [name]: serverObj }
    try {
      await window.mcp.write(filePath, updated)
      if (scope === 'global') setGlobalServers(updated)
      else setProjectServers(updated)
      setExpandedKey(null)
    } catch {
      setSaveError('Failed to save')
    }
  }

  const remove = async (scope: 'global' | 'project', name: string) => {
    const filePath = scope === 'global' ? globalPath : projectPath!
    const servers = { ...(scope === 'global' ? globalServers : projectServers) }
    delete servers[name]
    await window.mcp.write(filePath, servers)
    if (scope === 'global') setGlobalServers(servers)
    else setProjectServers(servers)
    if (expandedKey === `${scope}:${name}`) setExpandedKey(null)
  }

  const addServer = async (scope: 'global' | 'project') => {
    const servers = scope === 'global' ? globalServers : projectServers
    let key = 'new-server'
    let i = 2
    while (key in servers) key = `new-server-${i++}`
    const filePath = scope === 'global' ? globalPath : projectPath!
    const template = { command: '', args: [] as string[] }
    const updated = { ...servers, [key]: template }
    await window.mcp.write(filePath, updated)
    if (scope === 'global') setGlobalServers(updated)
    else setProjectServers(updated)
    setFormState(serverToForm(template))
    setJsonValue(JSON.stringify(template, null, 2))
    setEditTab('form')
    setSaveError(null)
    setExpandedKey(`${scope}:${key}`)
  }

  // ── Form view helpers ──────────────────────────────────────

  const updateArg = (i: number, val: string) =>
    setFormState(f => { const args = [...f.args]; args[i] = val; return { ...f, args } })
  const removeArg = (i: number) =>
    setFormState(f => ({ ...f, args: f.args.filter((_, idx) => idx !== i) }))
  const addArg = () =>
    setFormState(f => ({ ...f, args: [...f.args, ''] }))

  const updateEnvKey = (i: number, val: string) =>
    setFormState(f => { const env = [...f.env]; env[i] = { ...env[i], key: val }; return { ...f, env } })
  const updateEnvVal = (i: number, val: string) =>
    setFormState(f => { const env = [...f.env]; env[i] = { ...env[i], value: val }; return { ...f, env } })
  const removeEnv = (i: number) =>
    setFormState(f => ({ ...f, env: f.env.filter((_, idx) => idx !== i) }))
  const addEnv = () =>
    setFormState(f => ({ ...f, env: [...f.env, { key: '', value: '' }] }))

  const renderEditor = (scope: 'global' | 'project', name: string) => (
    <div className="mcp-editor">
      <div className="mcp-editor-tabs">
        <button
          className={`mcp-editor-tab${editTab === 'form' ? ' active' : ''}`}
          onClick={() => switchTab('form')}
        >Form</button>
        <button
          className={`mcp-editor-tab${editTab === 'json' ? ' active' : ''}`}
          onClick={() => switchTab('json')}
        >JSON</button>
      </div>

      {editTab === 'form' ? (
        <div className="mcp-form">
          <label className="mcp-field-label">command</label>
          <input
            className="snippet-input"
            value={formState.command}
            onChange={e => setFormState(f => ({ ...f, command: e.target.value }))}
            placeholder="npx, node, python…"
            spellCheck={false}
          />

          <label className="mcp-field-label">
            args
            <button className="mcp-add-row" onClick={addArg} title="Add arg">+</button>
          </label>
          {formState.args.length === 0 && (
            <p className="mcp-empty-hint">No args</p>
          )}
          {formState.args.map((arg, i) => (
            <div key={i} className="mcp-row">
              <input
                className="snippet-input mcp-row-input"
                value={arg}
                onChange={e => updateArg(i, e.target.value)}
                placeholder={`arg ${i}`}
                spellCheck={false}
              />
              <button className="snippet-delete-btn" onClick={() => removeArg(i)}>×</button>
            </div>
          ))}

          <label className="mcp-field-label">
            env
            <button className="mcp-add-row" onClick={addEnv} title="Add env var">+</button>
          </label>
          {formState.env.length === 0 && (
            <p className="mcp-empty-hint">No env vars</p>
          )}
          {formState.env.map(({ key, value }, i) => (
            <div key={i} className="mcp-row">
              <input
                className="snippet-input mcp-row-input mcp-env-key"
                value={key}
                onChange={e => updateEnvKey(i, e.target.value)}
                placeholder="KEY"
                spellCheck={false}
              />
              <input
                className="snippet-input mcp-row-input mcp-env-val"
                value={value}
                onChange={e => updateEnvVal(i, e.target.value)}
                placeholder="value"
                spellCheck={false}
              />
              <button className="snippet-delete-btn" onClick={() => removeEnv(i)}>×</button>
            </div>
          ))}
        </div>
      ) : (
        <textarea
          className="mcp-textarea"
          value={jsonValue}
          onChange={e => { setJsonValue(e.target.value); setSaveError(null) }}
          spellCheck={false}
          rows={8}
        />
      )}

      {saveError && <p className="mcp-save-error">{saveError}</p>}
      <div className="snippet-form-actions">
        <button className="snippet-save-btn" onClick={() => save(scope, name)}>Save</button>
      </div>
    </div>
  )

  const renderSection = (
    scope: 'global' | 'project',
    servers: Record<string, unknown>,
    disabled?: boolean
  ) => {
    const label = scope === 'global' ? 'Global (~/.claude)' : 'Project (.mcp.json)'
    const canAdd = !disabled && (scope === 'global' ? !!globalPath : !!projectPath)

    return (
      <div className={`mcp-section${disabled ? ' mcp-section--disabled' : ''}`}>
        <div className="mcp-section-header">
          <span className="mcp-section-title">{label}</span>
          {canAdd && (
            <button className="snippet-add-btn" onClick={() => addServer(scope)} title="Add server">+</button>
          )}
        </div>
        {disabled ? (
          <p className="snippet-empty">No repo linked to this tab</p>
        ) : Object.keys(servers).length === 0 ? (
          <p className="snippet-empty">No MCP servers configured</p>
        ) : (
          <div className="mcp-list">
            {Object.entries(servers).map(([name]) => {
              const key = `${scope}:${name}`
              const isExpanded = expandedKey === key
              return (
                <div key={key} className="mcp-item">
                  <div className="mcp-item-row">
                    <button className="mcp-name" onClick={() => expand(scope, name)}>
                      <span className="mcp-expand-icon">{isExpanded ? '▾' : '▸'}</span>
                      {name}
                    </button>
                    {team && (
                      <button
                        className="snippet-send-btn"
                        title="Share to Team"
                        onClick={() => {
                          const servers = scope === 'global' ? globalServers : projectServers
                          const cfg = servers[name] as Record<string, unknown>
                          if (cfg.env && Object.keys(cfg.env as object).length > 0) {
                            if (!window.confirm('This server has env vars that may contain API keys. Share anyway?')) return
                          }
                          shareMcp(name, cfg, team.id)
                        }}
                      >↗</button>
                    )}
                    <button className="snippet-delete-btn" onClick={() => setConfirmDelete({ scope, name })} title="Remove">×</button>
                  </div>
                  {isExpanded && renderEditor(scope, name)}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mcp-wrap" ref={panelRef}>
      <button
        className={`titlebar-btn${open ? ' active' : ''}`}
        onClick={() => {
          if (plan === 'free') { onRequireUpgrade?.(); return }
          setOpen(v => !v)
          setExpandedKey(null)
          setSaveError(null)
        }}
        title="MCP Servers"
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <rect x="1" y="2" width="8" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M4 5h2M4 7.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          <circle cx="11" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M11 7v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        MCP
      </button>

      {open && popPos && (
        <div ref={popoverRef} className="mcp-panel" style={{ position: 'fixed', top: popPos.top, left: popPos.left, right: 'auto' }}>
          {renderSection('global', globalServers)}
          <div className="mcp-divider" />
          {renderSection('project', projectServers, !projectPath)}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Remove MCP server"
          message={`Remove "${confirmDelete.name}"?`}
          confirmLabel="Remove"
          confirmDanger
          onConfirm={() => { remove(confirmDelete.scope, confirmDelete.name); setConfirmDelete(null) }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
