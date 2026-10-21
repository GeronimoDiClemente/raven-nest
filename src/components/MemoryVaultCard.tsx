import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import SettingRow from './memories/settings/SettingRow'

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
    <SettingRow
      nombre="Mirror to Markdown"
      descripcion="One file per memory in a folder you can open in Obsidian or grep."
      control={
        // Apagar el vault no es destructivo (las notas siguen ahí): `outline`.
        <Button variant={settings.enabled ? 'outline' : 'default'} size="sm" onClick={() => void toggle()} disabled={busy}>
          {busy ? '…' : settings.enabled ? 'Disable' : 'Enable'}
        </Button>
      }
    >
      {settings.enabled && (
        <>
          {rootDir && <p className="m-0 break-all font-mono text-fs-xs text-muted-foreground">{rootDir}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void reveal()} disabled={busy}>Open folder</Button>
            <Button variant="outline" size="sm" onClick={() => void regenerate()} disabled={busy}>{busy ? 'Working…' : 'Regenerate now'}</Button>
          </div>
          {lastResult && (
            <p className="m-0 text-fs-xs text-muted-foreground">
              {lastResult.written} written · {lastResult.moved} moved · {lastResult.deleted} deleted
              {lastResult.conflicts > 0 && `, ${lastResult.conflicts} of your edits preserved in _conflicts/`}
              {lastResult.warnings.length > 0 && ` · ${lastResult.warnings.length} warning${lastResult.warnings.length === 1 ? '' : 's'}`}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Switch id="vault-old-versions" checked={settings.includeSuperseded} disabled={busy}
              onCheckedChange={(v) => void setConfigFlag({ includeSuperseded: v })} />
            <label htmlFor="vault-old-versions" className="text-fs-sm text-foreground">Include old versions</label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="vault-teammates" checked={settings.includeTeamScope} disabled={busy}
              onCheckedChange={(v) => void setConfigFlag({ includeTeamScope: v })} />
            <label htmlFor="vault-teammates" className="text-fs-sm text-foreground">Include teammates&apos; memories</label>
          </div>
        </>
      )}
      {error && <p className="m-0 text-fs-sm text-destructive">{error}</p>}
    </SettingRow>
  )
}
