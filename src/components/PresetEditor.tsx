import { useEffect, useState } from 'react'
import type { RavenPreset } from '../types'

interface Props {
  repoPath: string | null
}

const EMPTY: RavenPreset = {
  id: '',
  name: '',
  description: '',
  setup: [],
  dev: '',
  ports: [],
}

export function PresetEditor({ repoPath }: Props) {
  const [presets, setPresets] = useState<RavenPreset[]>([])
  const [editing, setEditing] = useState<RavenPreset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [json, setJson] = useState<string>('')

  const refresh = async () => {
    if (!repoPath) { setPresets([]); return }
    try { setPresets(await window.preset.list(repoPath)) }
    catch (e) { console.error(e); setPresets([]) }
  }

  useEffect(() => { void refresh() }, [repoPath])

  const beginEdit = (p: RavenPreset) => {
    setEditing(p)
    setJson(JSON.stringify(p, null, 2))
    setError(null)
  }

  const beginNew = () => {
    setEditing({ ...EMPTY })
    setJson(JSON.stringify(EMPTY, null, 2))
    setError(null)
  }

  const save = async () => {
    if (!repoPath || !editing) return
    let parsed: RavenPreset
    try { parsed = JSON.parse(json) }
    catch (e) { setError(`Invalid JSON: ${(e as Error).message}`); return }
    try {
      await window.preset.save(repoPath, parsed)
      setEditing(null)
      setError(null)
      await refresh()
    } catch (e) { setError((e as Error).message) }
  }

  const remove = async (id: string) => {
    if (!repoPath) return
    if (!confirm(`Delete preset "${id}"?`)) return
    try { await window.preset.delete(repoPath, id); await refresh() }
    catch (e) { alert((e as Error).message) }
  }

  if (!repoPath) {
    return <div className="preset-empty">Open a repo (link to a tab) to edit presets.</div>
  }

  return (
    <div className="preset-editor">
      <div className="preset-editor-header">
        <span className="preset-editor-title">Presets · {repoPath.split(/[/\\]/).pop()}</span>
        <button className="btn-primary" onClick={beginNew}>+ New preset</button>
      </div>
      <div className="preset-editor-list">
        {presets.length === 0 && <div className="preset-empty">No presets yet. Create one to share with your team via .raven/presets/</div>}
        {presets.map((p) => (
          <div key={p.id} className="preset-row">
            <div className="preset-row-main">
              <span className="preset-row-name">{p.name}</span>
              <span className="preset-row-id">{p.id}</span>
              {p.description && <span className="preset-row-desc">{p.description}</span>}
            </div>
            <div className="preset-row-actions">
              <button className="btn-secondary" onClick={() => beginEdit(p)}>Edit</button>
              <button className="btn-danger" onClick={() => remove(p.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <div className="preset-editor-form">
          <label className="field-label">JSON</label>
          <textarea
            className="preset-editor-textarea"
            value={json}
            onChange={(e) => setJson(e.target.value)}
            spellCheck={false}
            rows={14}
          />
          {error && <div className="modal-error">{error}</div>}
          <div className="dialog-actions">
            <button className="dialog-cancel" onClick={() => { setEditing(null); setError(null) }}>Cancel</button>
            <button className="btn-primary" onClick={save}>Save</button>
          </div>
        </div>
      )}
    </div>
  )
}
