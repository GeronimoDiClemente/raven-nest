import { useState, useEffect, useRef } from 'react'
import { Snippet } from '../types'
import { useSharedSnippets } from '../hooks/useSharedSnippets'
import { useProfile } from '../hooks/useProfile'
import { useTeam } from '../hooks/useTeam'
import { useFixedPopover } from '../hooks/useFixedPopover'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  onSend: (content: string) => void
  onBroadcast: (content: string) => void
  onRequireUpgrade?: () => void
}

interface VarModal {
  content: string
  vars: string[]
  values: Record<string, string>
  mode: 'send' | 'broadcast'
}

const generateId = () => `snippet-${Date.now()}`

function extractVars(content: string): string[] {
  const matches = content.match(/\{\{(\w+)\}\}/g) ?? []
  return [...new Set(matches.map((m) => m.slice(2, -2)))]
}

function substituteVars(content: string, values: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? `{{${key}}}`)
}

export default function SnippetPanel({ onSend, onBroadcast, onRequireUpgrade }: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'mine' | 'team'>('mine')
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string; shared?: boolean } | null>(null)
  const [varModal, setVarModal] = useState<VarModal | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const popPos = useFixedPopover(panelRef, open, popoverRef)
  const { team } = useTeam()
  const { items: shared, loading: sharedLoading, userId, refresh: refreshShared, share, remove: removeShared } = useSharedSnippets(team?.id)
  const { plan } = useProfile()

  useEffect(() => {
    window.snippets.list().then(setSnippets)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
        setCreating(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const save = async () => {
    if (!name.trim() || !content.trim()) return
    const snippet: Snippet = { id: generateId(), name: name.trim(), content: content.trim() }
    await window.snippets.save(snippet)
    setSnippets((prev) => [...prev, snippet])
    setName('')
    setContent('')
    setCreating(false)
  }

  const handleShare = async (name: string, content: string) => {
    if (plan === 'free') { onRequireUpgrade?.(); return }
    await share(name, content, team?.id)
  }

  const remove = async (id: string) => {
    await window.snippets.delete(id)
    setSnippets((prev) => prev.filter((s) => s.id !== id))
  }

  const handleSend = (snippetContent: string, mode: 'send' | 'broadcast') => {
    const vars = extractVars(snippetContent)
    if (vars.length === 0) {
      if (mode === 'send') onSend(snippetContent)
      else onBroadcast(snippetContent)
      setOpen(false)
      return
    }
    const values: Record<string, string> = {}
    vars.forEach((v) => (values[v] = ''))
    setVarModal({ content: snippetContent, vars, values, mode })
  }

  const confirmVarModal = () => {
    if (!varModal) return
    const result = substituteVars(varModal.content, varModal.values)
    if (varModal.mode === 'send') onSend(result)
    else onBroadcast(result)
    setVarModal(null)
    setOpen(false)
  }

  return (
    <div className="snippet-wrap" ref={panelRef}>
      <button
        className={`titlebar-btn${open ? ' active' : ''}`}
        onClick={() => { setOpen((v) => !v); setCreating(false) }}
        title="Snippets"
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <rect x="1" y="1" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.3"/>
          <rect x="1" y="5.5" width="8" height="3" rx="1" stroke="currentColor" strokeWidth="1.3"/>
          <rect x="1" y="10" width="10" height="3" rx="1" stroke="currentColor" strokeWidth="1.3"/>
        </svg>
        Snippets
      </button>

      {open && popPos && (
        <div ref={popoverRef} className="snippet-panel" style={{ position: 'fixed', top: popPos.top, left: popPos.left, right: 'auto' }}>
          <div className="snippet-panel-header">
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={`workspace-tab-btn${tab === 'mine' ? ' active' : ''}`} onClick={() => setTab('mine')}>Mine</button>
              <button className={`workspace-tab-btn${tab === 'team' ? ' active' : ''}`} onClick={() => { setTab('team'); refreshShared() }}>Team</button>
            </div>
            {tab === 'mine' && (
              <button className="snippet-add-btn" onClick={() => setCreating((v) => !v)} title="New snippet">+</button>
            )}
          </div>

          {tab === 'mine' && (
            <>
              {creating && (
                <div className="snippet-form">
                  <input className="snippet-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                  <textarea
                    className="snippet-textarea"
                    placeholder="Content… Use {{variable}} for dynamic values"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={4}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
                      if (e.key === 'Escape') setCreating(false)
                    }}
                  />
                  <div className="snippet-form-actions">
                    <button className="snippet-save-btn" onClick={save}>Save</button>
                    <button className="snippet-cancel-btn" onClick={() => setCreating(false)}>Cancel</button>
                  </div>
                </div>
              )}
              {snippets.length === 0 && !creating && (
                <p className="snippet-empty">No snippets yet. Click + to create one.</p>
              )}
              <div className="snippet-list">
                {snippets.map((s) => (
                  <div key={s.id} className="snippet-item">
                    <span className="snippet-name" title={s.content}>{s.name}</span>
                    <div className="snippet-item-actions">
                      <button className="snippet-send-btn" onClick={() => handleSend(s.content, 'send')} title="Send to active terminal">Send</button>
                      <button className="snippet-broadcast-btn" onClick={() => handleSend(s.content, 'broadcast')} title="Broadcast to all">All</button>
                      <button className="snippet-send-btn" onClick={() => handleShare(s.name, s.content)} title={team ? 'Share to Team' : 'Share to Community'}>↗</button>
                      <button className="snippet-delete-btn" onClick={() => setConfirmDelete({ id: s.id, name: s.name })} title="Delete">×</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'team' && (
            <>
              {sharedLoading && <p className="snippet-empty">Loading…</p>}
              {!sharedLoading && shared.length === 0 && <p className="snippet-empty">No team snippets yet.</p>}
              <div className="snippet-list">
                {shared.map((s) => (
                  <div key={s.id} className="snippet-item">
                    <span className="snippet-name" title={s.content}>{s.name}</span>
                    <div className="snippet-item-actions">
                      <button className="snippet-send-btn" onClick={() => handleSend(s.content, 'send')} title="Send">Send</button>
                      <button className="snippet-broadcast-btn" onClick={() => handleSend(s.content, 'broadcast')} title="Broadcast">All</button>
                      {s.owner_id === userId && (
                        <button className="snippet-delete-btn" onClick={() => setConfirmDelete({ id: s.id, name: s.name, shared: true })} title="Remove">×</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {varModal && (
        <div className="confirm-overlay" onClick={() => setVarModal(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 280 }}>
            <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 13 }}>Fill in variables</p>
            {varModal.vars.map((v) => (
              <div key={v} style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>{`{{${v}}}`}</label>
                <input
                  className="snippet-input"
                  placeholder={v}
                  value={varModal.values[v]}
                  autoFocus={varModal.vars[0] === v}
                  onChange={(e) =>
                    setVarModal((m) => m ? { ...m, values: { ...m.values, [v]: e.target.value } } : m)
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmVarModal()
                    if (e.key === 'Escape') setVarModal(null)
                  }}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
            ))}
            <div className="confirm-actions" style={{ marginTop: 12 }}>
              <button className="snippet-save-btn" onClick={confirmVarModal}>Send</button>
              <button className="snippet-cancel-btn" onClick={() => setVarModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete snippet"
          message={`Delete "${confirmDelete.name}"?`}
          confirmLabel="Delete"
          confirmDanger
          onConfirm={() => {
            if (confirmDelete.shared) removeShared(confirmDelete.id)
            else remove(confirmDelete.id)
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
