import { useEffect, useState, useCallback } from 'react'

type VaultSettings = { version: number; enabled: boolean; root: string | null; includeSuperseded: boolean; includeTeamScope: boolean }
type VaultResult = { written: number; moved: number; deleted: number; conflicts: number; warnings: unknown[] }

/**
 * Task 5 (plan de memoria por cuenta multi-dispositivo) — "Mirror my memory to Markdown"
 * (vault spec §7). Enabling corre una pasada completa al toque (lo hace
 * `memory:vault:setSettings` del lado main, no este componente) — el "un click prende +
 * genera + abre la carpeta" que el spec llama el momento comercial real.
 *
 * Self-contained a propósito, como MemoryHub/MemoryAdoptionDialog: no pasa por useMemory()
 * porque el vault es un subsistema aparte del daemon de sync (no tiene status en vivo que
 * empujar, sólo se consulta a pedido).
 */
export default function MemoryVaultCard() {
  const [settings, setSettings] = useState<VaultSettings | null>(null)
  const [rootDir, setRootDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<VaultResult | null>(null)

  const load = useCallback(async () => {
    const res = await window.memory?.vaultGetSettings?.()
    if (res?.ok) {
      setSettings(res.settings ?? null)
      setRootDir(res.rootDir ?? null)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (!window.memory?.vaultGetSettings) return null // old preload — hide instead of crashing
  if (!settings) return null // still loading, or memory subsystem unavailable

  const toggle = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.memory!.vaultSetSettings!({ enabled: !settings.enabled })
      if (!res.ok) { setError(res.error ?? 'Could not update the vault'); return }
      setSettings(res.settings ?? settings)
      if (res.regenerated) {
        if (res.regenerated.ok) setLastResult(null) // getSettings/regenerate below will fill this in on next call; enabling just ran a full pass
        else setError(res.regenerated.error ?? 'Enabled, but the first pass failed')
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  const regenerate = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.memory!.vaultRegenerate!()
      if (!res.ok) { setError(res.error ?? 'Regeneration failed'); return }
      setLastResult(res.result ?? null)
      if (res.rootDir) setRootDir(res.rootDir)
    } finally {
      setBusy(false)
    }
  }

  const reveal = async () => {
    const res = await window.memory!.vaultReveal!()
    if (!res.ok) setError(res.error ?? 'Could not open the folder')
  }

  const setConfigFlag = async (patch: Partial<Pick<VaultSettings, 'includeSuperseded' | 'includeTeamScope'>>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.memory!.vaultSetSettings!(patch)
      if (res.ok) setSettings(res.settings ?? settings)
      else setError(res.error ?? 'Could not update the vault')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sp-card">
      <div className="sp-card-row">
        <div className="sp-card-left">
          <span className="sp-card-label">Memory Vault</span>
          <span style={{ fontSize: 11, opacity: 0.65, marginLeft: 6 }}>
            {settings.enabled
              ? 'Mirroring your memory to Markdown — open it in Obsidian for graph view, or just grep it'
              : 'Mirror your memory to a folder of Markdown files, one per observation'}
          </span>
        </div>
        <button className={settings.enabled ? 'sp-btn-danger' : 'sp-btn-purple'} onClick={() => void toggle()} disabled={busy}>
          {busy ? '…' : settings.enabled ? 'Disable' : 'Enable'}
        </button>
      </div>

      {settings.enabled && (
        <>
          {rootDir && (
            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 8, wordBreak: 'break-all' }}>{rootDir}</div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="sp-action-btn" onClick={() => void regenerate()} disabled={busy}>
              {busy ? 'Working…' : 'Regenerate now'}
            </button>
            <button className="sp-action-btn" onClick={() => void reveal()} disabled={busy}>
              Open folder
            </button>
          </div>
          {lastResult && (
            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 6 }}>
              {lastResult.written} written · {lastResult.moved} moved · {lastResult.deleted} deleted
              {lastResult.conflicts > 0 && `, ${lastResult.conflicts} of your edits preserved in _conflicts/`}
              {lastResult.warnings.length > 0 && ` · ${lastResult.warnings.length} warning${lastResult.warnings.length === 1 ? '' : 's'}`}
            </div>
          )}
          <label className="sp-checkbox-row">
            <input
              type="checkbox"
              checked={settings.includeSuperseded}
              disabled={busy}
              onChange={(e) => void setConfigFlag({ includeSuperseded: e.target.checked })}
            />
            Include superseded (historical) versions
          </label>
          <label className="sp-checkbox-row">
            <input
              type="checkbox"
              checked={settings.includeTeamScope}
              disabled={busy}
              onChange={(e) => void setConfigFlag({ includeTeamScope: e.target.checked })}
            />
            Include memories shared by teammates
          </label>
        </>
      )}

      {error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 8 }}>{error}</div>}
    </div>
  )
}
