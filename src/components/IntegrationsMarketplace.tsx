import { useEffect, useState, type ReactNode } from 'react'
import { usePluginCatalog } from '../hooks/usePluginCatalog'
import { useInstalledPlugins } from '../hooks/useInstalledPlugins'
import { usePluginConnection, notifyPluginConnectionChanged } from '../hooks/usePluginConnection'
import { useGitHub } from '../hooks/useGitHub'
import { supabase } from '../lib/supabase'
import { IntegrationLogo } from './IntegrationLogos'
import type { PluginManifest, ConfigField } from '../types'

// Duplica la consulta a `profiles.github_token` que hace useGitHub.ts en su
// fetch inicial: la necesitamos acá para "reusar" el token ya guardado en
// Supabase justo después de que el flujo OAuth existente termina (useGitHub
// resetea su propio `githubToken` a null tras conectar, ver useGitHub.ts:50).
// Una alternativa más limpia sería exponer un `getToken()` en el hook; se
// deja para no tocar su contrato público en esta task.
async function fetchGithubTokenFromSupabase(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('profiles').select('github_token').eq('id', user.id).maybeSingle()
  return data?.github_token ?? null
}

function ApiKeyForm({ pluginId, fields, onSaved }: { pluginId: string; fields: ConfigField[]; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await window.pluginCreds.set(pluginId, JSON.stringify(values))
      if (!res.ok) throw new Error(res.error ?? 'Could not save credentials')
      notifyPluginConnectionChanged(pluginId)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save credentials')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="integration-apikey-form">
      {fields.map((f) => (
        <input
          key={f.key}
          className="integration-apikey-input"
          type={f.type === 'password' ? 'password' : 'text'}
          placeholder={f.placeholder ?? f.label}
          value={values[f.key] ?? ''}
          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
        />
      ))}
      <button className="integration-btn primary" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      {error && <span className="integration-error">{error}</span>}
    </div>
  )
}

/**
 * Badge/botón de Connect según `auth.kind` del manifest. Exportado para que
 * ConnectionCard (Connections tab del hub, ver ConnectionsView.tsx) lo
 * reuse tal cual — es el único lugar con la lógica OAuth/apiKey real
 * (Slack deep-link, reuso de sesión GitHub, gcal loopback+PKCE) y no debe
 * duplicarse.
 */
export function ConnectControl({ plugin }: { plugin: PluginManifest }) {
  const { connected, loading, refresh } = usePluginConnection(plugin.id)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const github = useGitHub()

  // GitHub: si la sesión de la app ya está conectada (Settings), persistimos
  // ese token en pluginCreds sin pedir un OAuth nuevo — cubre tanto "ya
  // estaba conectado" como "se acaba de conectar acá mismo" (connectGitHub
  // dispara el flujo existente y esto reacciona cuando isConnected pasa a true).
  useEffect(() => {
    if (plugin.id !== 'github' || !github.isConnected) return
    void (async () => {
      const token = github.githubToken ?? await fetchGithubTokenFromSupabase()
      if (token) {
        await window.pluginCreds.set('github', token)
        notifyPluginConnectionChanged('github')
      }
    })()
  }, [plugin.id, github.isConnected, github.githubToken])

  if (!plugin.auth || plugin.auth.kind === 'none' || loading) return null
  const auth = plugin.auth

  const disconnect = async () => {
    await window.pluginCreds.delete(plugin.id)
    notifyPluginConnectionChanged(plugin.id)
  }

  if (connected) {
    return (
      <div className="integration-connect-row">
        <span className="integration-connected">Connected ✓</span>
        <button className="integration-btn ghost" onClick={() => void disconnect()}>Disconnect</button>
      </div>
    )
  }

  if (auth.kind === 'apiKey') {
    if (showForm) {
      return <ApiKeyForm pluginId={plugin.id} fields={auth.fields ?? []} onSaved={() => { setShowForm(false); void refresh() }} />
    }
    return <button className="integration-btn primary" onClick={() => setShowForm(true)}>Connect</button>
  }

  // auth.kind === 'oauth'
  const connectOAuth = async () => {
    setError(null)
    if (plugin.id === 'slack') {
      window.slack.removeOAuthListener()
      const unsubscribe = window.slack.onOAuthCode((code) => {
        unsubscribe()
        void (async () => {
          const res = await window.slack.exchangeCode(code)
          if (res.ok) notifyPluginConnectionChanged('slack')
          else setError(res.error ?? 'Slack connection failed')
        })()
      })
      await window.slack.openOAuth()
      return
    }
    if (plugin.id === 'github') {
      await github.connectGitHub()
      return
    }
    if (plugin.id === 'gcal') {
      // OAuth desktop (loopback + PKCE) resuelto en main: sin roundtrip de code
      // por deep-link como Slack. openOAuth resuelve cuando el token se guardó.
      const res = await window.gcal.openOAuth()
      if (res.ok) notifyPluginConnectionChanged('gcal')
      else setError(res.error === 'NOT_CONFIGURED' ? 'Google Calendar is not configured on this build' : (res.error ?? 'Calendar connection failed'))
      return
    }
    setError('This integration does not support Connect yet')
  }

  return (
    <div className="integration-connect-row">
      <button className="integration-btn primary" onClick={() => void connectOAuth()}>Connect</button>
      {(error ?? (plugin.id === 'github' ? github.error : null)) && (
        <span className="integration-error">{error ?? github.error}</span>
      )}
    </div>
  )
}

/**
 * Marketplace personal de integraciones (búsqueda, grids de
 * instaladas/disponibles/coming-soon). Se usa embebido dentro de
 * `MyReposPanel` (sección "Integrations").
 */
export function IntegrationsMarketplaceView() {
  const { catalog } = usePluginCatalog()
  const { install, uninstall, isInstalled } = useInstalledPlugins()
  const [q, setQ] = useState('')

  const match = (p: PluginManifest) => p.name.toLowerCase().includes(q.toLowerCase())
  const visible = catalog.filter(match)
  const available = visible.filter(p => !p.comingSoon && !isInstalled(p.id))
  const comingSoon = visible.filter(p => p.comingSoon)
  const installed = visible.filter(p => isInstalled(p.id))

  const card = (p: PluginManifest, action: ReactNode) => (
    <article key={p.id} className="integration-card">
      <span className="integration-icon" style={{ background: p.color }} aria-hidden><IntegrationLogo id={p.id} size={16} /></span>
      <div className="integration-meta">
        <span className="integration-name">{p.name}</span>
        {p.description && <span className="integration-desc">{p.description}</span>}
      </div>
      {action}
    </article>
  )

  return (
    <div className="integrations-embedded">
      <div className="integrations-body">
        <input className="integrations-search" placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} />

        {installed.length > 0 && (
          <section aria-label="Installed">
            <h3 className="integrations-section-title">Installed</h3>
            <div className="integrations-grid">
              {installed.map(p => card(p, (
                <div className="integration-card-actions">
                  {/* Solo montamos ConnectControl si el plugin declara auth: evita
                      llamar a usePluginConnection/useGitHub (que tocan window.pluginCreds
                      y window.slack/github) para integraciones sin auth como "demo". */}
                  {p.auth && p.auth.kind !== 'none' && <ConnectControl plugin={p} />}
                  <button className="integration-btn ghost" onClick={() => uninstall(p.id)}>Remove</button>
                </div>
              )))}
            </div>
          </section>
        )}

        <section aria-label="Available">
          <h3 className="integrations-section-title">Available</h3>
          <div className="integrations-grid">
            {available.map(p => card(p, <button className="integration-btn primary" onClick={() => install(p.id)}>Install</button>))}
          </div>
        </section>

        <section aria-label="Coming soon">
          <h3 className="integrations-section-title">Coming soon · new integrations every week</h3>
          <div className="integrations-grid">
            {comingSoon.map(p => card(p, <span className="integration-soon-tag">Soon</span>))}
          </div>
          <button className="integration-request">Request an integration</button>
        </section>
      </div>
    </div>
  )
}
