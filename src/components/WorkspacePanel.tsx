import { useState, useEffect, useRef } from 'react'
import { Workspace, SessionPane, AI_CONFIG, equalSizes } from '../types'
import { useSharedWorkspaces } from '../hooks/useSharedWorkspaces'
import { useProfile } from '../hooks/useProfile'
import { useTeam } from '../hooks/useTeam'
import { useFixedPopover } from '../hooks/useFixedPopover'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  onSave: (name: string) => void
  onLoad: (ws: Workspace) => void
  onRequireUpgrade?: () => void
  docked?: boolean
}

function makePane(aiType: keyof typeof AI_CONFIG): SessionPane {
  return {
    aiType,
    accountName: '',
    accountDir: '',
    borderColor: AI_CONFIG[aiType].color,
    cmd: AI_CONFIG[aiType].cmd,
  }
}

const TEMPLATES: { name: string; description: string; build: () => Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'> }[] = [
  {
    name: '2× Claude',
    description: 'Two Claude panes side by side',
    build: () => ({
      name: '2× Claude',
      layout: { rows: 1, cols: 2 },
      colSizes: [equalSizes(2)],
      rowSizes: equalSizes(1),
      cells: [makePane('claude'), makePane('claude')],
      resumeLastSession: false,
    }),
  },
  {
    name: 'Claude + Terminal',
    description: 'Claude on the left, terminal on the right',
    build: () => ({
      name: 'Claude + Terminal',
      layout: { rows: 1, cols: 2 },
      colSizes: [equalSizes(2)],
      rowSizes: equalSizes(1),
      cells: [makePane('claude'), makePane('terminal')],
      resumeLastSession: false,
    }),
  },
  {
    name: 'Full Stack',
    description: 'Claude, Gemini, and two terminals',
    build: () => ({
      name: 'Full Stack',
      layout: { rows: 2, cols: 2 },
      colSizes: [equalSizes(2), equalSizes(2)],
      rowSizes: equalSizes(2),
      cells: [makePane('claude'), makePane('gemini'), makePane('terminal'), makePane('terminal')],
      resumeLastSession: false,
    }),
  },
  {
    name: '3-way Split',
    description: 'Claude, Gemini, and a terminal',
    build: () => ({
      name: '3-way Split',
      layout: { rows: 1, cols: 3 },
      colSizes: [equalSizes(3)],
      rowSizes: equalSizes(1),
      cells: [makePane('claude'), makePane('gemini'), makePane('terminal')],
      resumeLastSession: false,
    }),
  },
  {
    name: 'Claude Focus',
    description: 'Single Claude pane, full screen',
    build: () => ({
      name: 'Claude Focus',
      layout: { rows: 1, cols: 1 },
      colSizes: [equalSizes(1)],
      rowSizes: equalSizes(1),
      cells: [makePane('claude')],
      resumeLastSession: false,
    }),
  },
  {
    name: 'Terminal Grid',
    description: 'Four terminals in a 2×2 grid',
    build: () => ({
      name: 'Terminal Grid',
      layout: { rows: 2, cols: 2 },
      colSizes: [equalSizes(2), equalSizes(2)],
      rowSizes: equalSizes(2),
      cells: [makePane('terminal'), makePane('terminal'), makePane('terminal'), makePane('terminal')],
      resumeLastSession: false,
    }),
  },
]

export default function WorkspacePanel({ onSave, onLoad, onRequireUpgrade, docked }: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'mine' | 'team' | 'templates'>('mine')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string; shared?: boolean } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const popPos = useFixedPopover(panelRef, open, popoverRef)
  const { team } = useTeam()
  const { items: shared, loading: sharedLoading, userId, refresh: refreshShared, share, remove: removeShared } = useSharedWorkspaces(team?.id)
  const { plan } = useProfile()

  useEffect(() => {
    if (open || docked) {
      window.workspaces.list().then(setWorkspaces)
      refreshShared()
    } else {
      setSaving(false)
    }
  }, [open, docked])

  useEffect(() => {
    if (!open || docked) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, docked])

  const handleSave = () => {
    if (!name.trim()) return
    onSave(name.trim())
    setName('')
    setSaving(false)
    setTimeout(() => window.workspaces.list().then(setWorkspaces), 100)
  }

  const handleLoad = (ws: Workspace) => {
    onLoad(ws)
    if (!docked) setOpen(false)
  }

  const handleDelete = async (id: string) => {
    await window.workspaces.delete(id)
    setWorkspaces((prev) => prev.filter((w) => w.id !== id))
  }

  const handleExport = (ws: Workspace) => {
    window.workspaces.exportToFile(ws)
  }

  const handleImport = async () => {
    const ws = await window.workspaces.importFromFile()
    if (!ws) return
    const imported = { ...ws, id: `ws-${Date.now()}`, createdAt: Date.now(), updatedAt: Date.now() }
    await window.workspaces.save(imported)
    setWorkspaces((prev) => [...prev, imported])
  }

  const handleShare = async (ws: Workspace) => {
    if (plan === 'free') { onRequireUpgrade?.(); return }
    await share(ws, team?.id)
  }

  const handleClone = async (data: Workspace) => {
    const cloned = { ...data, id: `ws-${Date.now()}`, name: `${data.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now() }
    await window.workspaces.save(cloned)
    setWorkspaces(prev => [...prev, cloned])
    setTab('mine')
  }

  const handleUseTemplate = async (templateIdx: number) => {
    const tpl = TEMPLATES[templateIdx]
    const ws: Workspace = {
      ...tpl.build(),
      id: `ws-${Date.now()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await window.workspaces.save(ws)
    setWorkspaces(prev => [...prev, ws])
    onLoad(ws)
    if (!docked) setOpen(false)
  }

  const body = (
    <>
      <div className="snippet-panel-header">
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`workspace-tab-btn${tab === 'mine' ? ' active' : ''}`}
            onClick={() => setTab('mine')}
          >Mine</button>
          <button
            className={`workspace-tab-btn${tab === 'team' ? ' active' : ''}`}
            onClick={() => { setTab('team'); refreshShared() }}
          >Team</button>
          <button
            className={`workspace-tab-btn${tab === 'templates' ? ' active' : ''}`}
            onClick={() => setTab('templates')}
          >Templates</button>
        </div>
        {tab === 'mine' && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="snippet-add-btn" onClick={(e) => { e.stopPropagation(); handleImport() }} title="Import from file">↑</button>
            <button className="snippet-add-btn" onClick={(e) => { e.stopPropagation(); setSaving((v) => !v) }} title="Save current workspace">+</button>
          </div>
        )}
      </div>

      {tab === 'mine' && (
        <>
          {saving && (
            <div className="snippet-form">
              <input
                className="snippet-input"
                placeholder="Workspace name…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave()
                  if (e.key === 'Escape') setSaving(false)
                }}
              />
              <div className="snippet-form-actions">
                <button className="snippet-save-btn" onClick={handleSave}>Save</button>
                <button className="snippet-cancel-btn" onClick={() => setSaving(false)}>Cancel</button>
              </div>
            </div>
          )}
          {workspaces.length === 0 && !saving && (
            <p className="snippet-empty">No workspaces. Click + to save the current layout.</p>
          )}
          <div className="snippet-list">
            {workspaces.map((ws) => (
              <div key={ws.id} className="snippet-item">
                <span className="snippet-name" title={`${ws.layout.rows}×${ws.layout.cols}`}>{ws.name}</span>
                <div className="snippet-item-actions">
                  <button className="snippet-send-btn" onClick={() => handleLoad(ws)} title="Load">Load</button>
                  <button className="snippet-send-btn" onClick={() => handleShare(ws)} title={team ? 'Share to Team' : 'Share to Community'}>↗</button>
                  <button className="snippet-send-btn" onClick={() => handleExport(ws)} title="Export to file">↓</button>
                  <button className="snippet-delete-btn" onClick={() => setConfirmDelete({ id: ws.id, name: ws.name })} title="Delete">×</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'team' && (
        <>
          {sharedLoading && <p className="snippet-empty">Loading…</p>}
          {!sharedLoading && shared.length === 0 && (
            <p className="snippet-empty">No team workspaces yet.</p>
          )}
          <div className="snippet-list">
            {shared.map((item) => (
              <div key={item.id} className="snippet-item">
                <span className="snippet-name" title={`${item.data.layout?.rows}×${item.data.layout?.cols}`}>{item.name}</span>
                <div className="snippet-item-actions">
                  <button className="snippet-send-btn" onClick={() => handleClone(item.data)} title="Clone to Mine">Clone</button>
                  {item.owner_id === userId && (
                    <button className="snippet-delete-btn" onClick={() => setConfirmDelete({ id: item.id, name: item.name, shared: true })} title="Remove">×</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'templates' && (
        <div className="snippet-list">
          {TEMPLATES.map((tpl, i) => (
            <div key={tpl.name} className="snippet-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="snippet-name">{tpl.name}</span>
                <button className="snippet-send-btn" onClick={() => handleUseTemplate(i)} title="Use this template">Use</button>
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', paddingLeft: 2 }}>{tpl.description}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )

  const confirmDeleteDialog = confirmDelete ? (
    <ConfirmDialog
      title="Delete workspace"
      message={`Delete "${confirmDelete.name}"?`}
      confirmLabel="Delete"
      confirmDanger
      onConfirm={() => {
        if (confirmDelete.shared) removeShared(confirmDelete.id)
        else handleDelete(confirmDelete.id)
        setConfirmDelete(null)
      }}
      onCancel={() => setConfirmDelete(null)}
    />
  ) : null

  if (docked) {
    return (
      <>
        <div className="snippet-panel workspace-panel workspace-panel--docked">{body}</div>
        {confirmDeleteDialog}
      </>
    )
  }

  return (
    <>
    <div className="snippet-wrap" ref={panelRef}>
      <button
        className="titlebar-btn"
        onClick={() => { setOpen((v) => !v); setSaving(false) }}
        title="Workspaces"
      />

      {open && popPos && (
        <div ref={popoverRef} className="snippet-panel workspace-panel" style={{ position: 'fixed', top: popPos.top, left: popPos.left, right: 'auto' }}>
          {body}
        </div>
      )}
    </div>

    {confirmDeleteDialog}
    </>
  )
}
