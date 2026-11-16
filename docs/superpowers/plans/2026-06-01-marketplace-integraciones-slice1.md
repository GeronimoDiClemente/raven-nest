# Marketplace de Integraciones — Slice 1 (Fundación + Slack) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la fundación del marketplace de integraciones (modelo manifest, store local, catálogo con fallback, credential store cifrado, runtime de acciones) y la integración **Slack** end-to-end como primer vertical slice funcionando.

**Architecture:** Enfoque C del spec — manifest declarativo, catálogo servido por Supabase con fallback a un catálogo built-in, handlers curados en el main process. Los tokens viven cifrados en el main process vía Electron `safeStorage` (nunca en Supabase ni en el renderer salvo tránsito post-OAuth). Las llamadas a APIs externas se ejecutan en el main por IPC.

**Tech Stack:** Electron + React + TypeScript, vitest (`npm test`), `@testing-library/react`, Supabase JS, Electron `safeStorage`.

**Spec:** `docs/superpowers/specs/2026-06-01-marketplace-integraciones-design.md`
**Slice:** 1 de 3 (Slice 2 = Notion+Jira, Slice 3 = funnel Team + "Próximamente" data).

---

## File Structure

**A crear:**
- `src/lib/plugins/manifest.ts` — `validateManifest()` (defensa al leer catálogo remoto).
- `src/lib/plugins/builtinCatalog.ts` — `BUILTIN_CATALOG` (fallback + las 3 integraciones + 2 "coming soon").
- `electron/plugins-store.ts` — persistencia local de `InstalledPlugin[]` (`~/.raven-nest/plugins.json`).
- `electron/plugin-credentials.ts` — store de tokens cifrado vía `safeStorage` (`~/.raven-nest/plugin-credentials.json`).
- `electron/plugin-actions.ts` — dispatcher de acciones (Slack notify) en el main.
- `src/hooks/usePluginCatalog.ts` — fetch remoto + fallback built-in.
- `src/hooks/useInstalledPlugins.ts` — CRUD local vía IPC.
- `src/components/IntegrationsMarketplace.tsx` — modal, tab Personal.
- `supabase/migrations/<ts>_plugin_catalog.sql` — tablas + RLS.
- Tests espejo en `src/__tests__/...` y `electron/__tests__/...`.

**A modificar:**
- `src/types.ts` — tipos del dominio plugin.
- `src/vite-env.d.ts` — augment de `Window` (`plugins`, `pluginCreds`, `pluginActions`, `slack`).
- `electron/preload.ts` — exponer las APIs nuevas.
- `electron/main.ts` — registrar handlers IPC + handler OAuth Slack.
- `src/components/Sidebar.tsx` — botón "Integraciones".
- `src/App.tsx` — montar el modal (patrón Teams/MyRepos).
- `src/components/RepoActionsMenu.tsx` — inyectar "Notificar a Slack".

**Nota de duplicación de tipos:** `electron/*` y `src/*` son contextos de build separados; igual que `custom-cli-store.ts` define su propio `CustomCLI`, los stores de Electron redeclaran `InstalledPlugin`. Es el patrón existente, no se comparte el tipo cross-context.

---

## Task 1: Tipos del dominio plugin

**Files:**
- Modify: `src/types.ts` (agregar al final)

- [ ] **Step 1: Agregar los tipos**

```ts
// === Marketplace de integraciones ===
export type PluginType = 'action' | 'panel' | 'integration'
export type PluginCategory =
  | 'comms' | 'docs' | 'pm' | 'ci' | 'design' | 'observability' | 'other'

export interface ConfigField {
  key: string
  label: string
  type: 'text' | 'password' | 'select'
  required?: boolean
  options?: { value: string; label: string }[]
  placeholder?: string
}

export interface AuthSpec {
  kind: 'oauth' | 'apiKey' | 'none'
  fields?: ConfigField[]
}

export interface MenuContribution {
  id: string          // 'slack.notify'
  label: string       // 'Notificar a Slack'
  actionId: string    // se pasa a window.pluginActions.run(pluginId, actionId, ...)
  surface: 'sidebar' | 'repoActions'
}

export interface EventHook {
  on: 'onAgentDone' | 'onWorktreeReady' | 'onPrPushed'
  actionId: string
}

export interface PluginContributions {
  menuItems?: MenuContribution[]
  events?: EventHook[]
  // paneType: diferido a slices futuros
}

export interface PluginManifest {
  id: string
  name: string
  description: string
  category: PluginCategory
  icon: string
  color: string
  type: PluginType
  publisher: 'raven' | string
  tier: 'free' | 'pro' | 'team-enterprise'
  comingSoon?: boolean
  auth?: AuthSpec
  configSchema?: ConfigField[]
  contributes?: PluginContributions
}

export interface InstalledPlugin {
  pluginId: string
  scope: 'personal' | 'team'
  enabled: boolean
  config: Record<string, unknown>
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(integrations): tipos del dominio plugin"
```

---

## Task 2: Validación de manifests

**Files:**
- Create: `src/lib/plugins/manifest.ts`
- Test: `src/__tests__/lib/plugins/manifest.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from 'vitest'
import { validateManifest } from '../../../lib/plugins/manifest'

describe('validateManifest', () => {
  const valid = { id: 'slack', name: 'Slack', type: 'integration', category: 'comms' }

  it('acepta un manifest mínimo válido y aplica defaults', () => {
    const m = validateManifest(valid)
    expect(m).not.toBeNull()
    expect(m!.id).toBe('slack')
    expect(m!.publisher).toBe('raven')
    expect(m!.tier).toBe('free')
    expect(m!.color).toBe('#888')
  })

  it.each([
    null,
    {},
    { id: '', name: 'x', type: 'integration', category: 'comms' },
    { id: 'x', name: 'x', type: 'bogus', category: 'comms' },
    { id: 'x', type: 'integration', category: 'comms' }, // sin name
  ])('rechaza inválidos: %o', (raw) => {
    expect(validateManifest(raw)).toBeNull()
  })

  it('respeta comingSoon', () => {
    expect(validateManifest({ ...valid, comingSoon: true })!.comingSoon).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/__tests__/lib/plugins/manifest.test.ts`
Expected: FAIL — "Cannot find module '../../../lib/plugins/manifest'".

- [ ] **Step 3: Implementar**

```ts
// src/lib/plugins/manifest.ts
import type { PluginManifest, PluginType } from '../../types'

const TYPES: PluginType[] = ['action', 'panel', 'integration']

export function validateManifest(raw: unknown): PluginManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  if (typeof m.id !== 'string' || m.id === '') return null
  if (typeof m.name !== 'string' || m.name === '') return null
  if (typeof m.type !== 'string' || !TYPES.includes(m.type as PluginType)) return null
  if (typeof m.category !== 'string') return null
  return {
    id: m.id,
    name: m.name,
    description: typeof m.description === 'string' ? m.description : '',
    category: m.category as PluginManifest['category'],
    icon: typeof m.icon === 'string' ? m.icon : '',
    color: typeof m.color === 'string' ? m.color : '#888',
    type: m.type as PluginType,
    publisher: typeof m.publisher === 'string' ? m.publisher : 'raven',
    tier: (typeof m.tier === 'string' ? m.tier : 'free') as PluginManifest['tier'],
    comingSoon: m.comingSoon === true,
    auth: m.auth as PluginManifest['auth'],
    configSchema: m.configSchema as PluginManifest['configSchema'],
    contributes: m.contributes as PluginManifest['contributes'],
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/__tests__/lib/plugins/manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plugins/manifest.ts src/__tests__/lib/plugins/manifest.test.ts
git commit -m "feat(integrations): validateManifest con defaults"
```

---

## Task 3: Catálogo built-in (fallback)

**Files:**
- Create: `src/lib/plugins/builtinCatalog.ts`
- Test: `src/__tests__/lib/plugins/builtinCatalog.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from 'vitest'
import { BUILTIN_CATALOG } from '../../../lib/plugins/builtinCatalog'
import { validateManifest } from '../../../lib/plugins/manifest'

describe('BUILTIN_CATALOG', () => {
  it('incluye slack, notion y jira', () => {
    const ids = BUILTIN_CATALOG.map(p => p.id)
    expect(ids).toEqual(expect.arrayContaining(['slack', 'notion', 'jira']))
  })
  it('todas las entradas son manifests válidos', () => {
    for (const p of BUILTIN_CATALOG) expect(validateManifest(p)).not.toBeNull()
  })
  it('slack expone la acción notify y el hook onAgentDone', () => {
    const slack = BUILTIN_CATALOG.find(p => p.id === 'slack')!
    expect(slack.contributes?.menuItems?.[0].actionId).toBe('notify')
    expect(slack.contributes?.events?.some(e => e.on === 'onAgentDone')).toBe(true)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/__tests__/lib/plugins/builtinCatalog.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar**

```ts
// src/lib/plugins/builtinCatalog.ts
import type { PluginManifest } from '../../types'

export const BUILTIN_CATALOG: PluginManifest[] = [
  {
    id: 'slack', name: 'Slack',
    description: 'Recibí avisos de tus agentes en Slack.',
    category: 'comms', icon: 'slack', color: '#4A154B',
    type: 'integration', publisher: 'raven', tier: 'free',
    auth: { kind: 'oauth' },
    configSchema: [
      { key: 'channel', label: 'Canal', type: 'text', required: true, placeholder: '#dev' },
    ],
    contributes: {
      menuItems: [
        { id: 'slack.notify', label: 'Notificar a Slack', actionId: 'notify', surface: 'repoActions' },
      ],
      events: [{ on: 'onAgentDone', actionId: 'notify' }],
    },
  },
  {
    id: 'notion', name: 'Notion',
    description: 'Enviá el resumen del worktree a Notion.',
    category: 'docs', icon: 'notion', color: '#0F0F0F',
    type: 'integration', publisher: 'raven', tier: 'free', auth: { kind: 'oauth' },
  },
  {
    id: 'jira', name: 'Jira',
    description: 'Creá worktrees desde issues de Jira.',
    category: 'pm', icon: 'jira', color: '#0052CC',
    type: 'integration', publisher: 'raven', tier: 'free', auth: { kind: 'oauth' },
  },
  {
    id: 'figma', name: 'Figma', description: 'Próximamente.',
    category: 'design', icon: 'figma', color: '#F24E1E',
    type: 'integration', publisher: 'raven', tier: 'free', comingSoon: true,
  },
  {
    id: 'sentry', name: 'Sentry', description: 'Próximamente.',
    category: 'observability', icon: 'sentry', color: '#362D59',
    type: 'integration', publisher: 'raven', tier: 'free', comingSoon: true,
  },
]
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/__tests__/lib/plugins/builtinCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plugins/builtinCatalog.ts src/__tests__/lib/plugins/builtinCatalog.test.ts
git commit -m "feat(integrations): catalogo built-in con Slack/Notion/Jira + coming soon"
```

---

## Task 4: Store local de plugins instalados

**Files:**
- Create: `electron/plugins-store.ts`
- Test: `electron/__tests__/plugins-store.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PluginsStore } from '../plugins-store'

describe('PluginsStore', () => {
  let store: PluginsStore
  beforeEach(() => {
    store = new PluginsStore(mkdtempSync(join(tmpdir(), 'nest-plugins-')))
  })

  it('arranca vacío', () => {
    expect(store.list()).toEqual([])
  })

  it('guarda, actualiza por (pluginId, scope) y borra', () => {
    store.save({ pluginId: 'slack', scope: 'personal', enabled: true, config: {} })
    expect(store.list()).toHaveLength(1)
    store.save({ pluginId: 'slack', scope: 'personal', enabled: false, config: { channel: '#x' } })
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].enabled).toBe(false)
    store.delete('slack')
    expect(store.list()).toEqual([])
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run electron/__tests__/plugins-store.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar** (espejo de `electron/custom-cli-store.ts`, con `baseDir` inyectable para testear)

```ts
// electron/plugins-store.ts
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { ravenHome } from './raven-home'

export interface InstalledPlugin {
  pluginId: string
  scope: 'personal' | 'team'
  enabled: boolean
  config: Record<string, unknown>
}

export class PluginsStore {
  private dir: string
  private file: string
  constructor(baseDir: string = join(ravenHome(), '.raven-nest')) {
    this.dir = baseDir
    this.file = join(baseDir, 'plugins.json')
  }
  private load(): InstalledPlugin[] {
    try { return JSON.parse(readFileSync(this.file, 'utf8')) } catch { return [] }
  }
  private persist(list: InstalledPlugin[]): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.file, JSON.stringify(list))
  }
  list(): InstalledPlugin[] { return this.load() }
  save(p: InstalledPlugin): void {
    const all = this.load()
    const idx = all.findIndex(x => x.pluginId === p.pluginId && x.scope === p.scope)
    if (idx >= 0) all[idx] = p; else all.push(p)
    this.persist(all)
  }
  delete(pluginId: string, scope: 'personal' | 'team' = 'personal'): void {
    this.persist(this.load().filter(x => !(x.pluginId === pluginId && x.scope === scope)))
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run electron/__tests__/plugins-store.test.ts`
Expected: PASS.

> Nota: si vitest no toma `electron/__tests__`, agregar el glob a `vitest.config.ts` (`test.include`). Verificar el config existente antes de asumir.

- [ ] **Step 5: Commit**

```bash
git add electron/plugins-store.ts electron/__tests__/plugins-store.test.ts
git commit -m "feat(integrations): PluginsStore local (~/.raven-nest/plugins.json)"
```

---

## Task 5: Credential store cifrado (safeStorage)

**Files:**
- Create: `electron/plugin-credentials.ts`
- Test: `electron/__tests__/plugin-credentials.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PluginCredentialStore, NoKeyringError, type CryptoBackend } from '../plugin-credentials'

const fakeCrypto = (available = true): CryptoBackend => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`enc:${s}`),
  decryptString: (b) => b.toString().replace(/^enc:/, ''),
})

describe('PluginCredentialStore', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nest-creds-')) })

  it('guarda y recupera un token cifrado', () => {
    const s = new PluginCredentialStore(fakeCrypto(), dir)
    s.setToken('slack', 'xoxb-123')
    expect(s.has('slack')).toBe(true)
    expect(s.getToken('slack')).toBe('xoxb-123')
  })

  it('getToken devuelve null si no existe', () => {
    expect(new PluginCredentialStore(fakeCrypto(), dir).getToken('slack')).toBeNull()
  })

  it('delete remueve el token', () => {
    const s = new PluginCredentialStore(fakeCrypto(), dir)
    s.setToken('slack', 'x'); s.delete('slack')
    expect(s.has('slack')).toBe(false)
  })

  it('lanza NoKeyringError si no hay cifrado disponible', () => {
    const s = new PluginCredentialStore(fakeCrypto(false), dir)
    expect(() => s.setToken('slack', 'x')).toThrow(NoKeyringError)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run electron/__tests__/plugin-credentials.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar**

```ts
// electron/plugin-credentials.ts
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { ravenHome } from './raven-home'

export interface CryptoBackend {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}

export class NoKeyringError extends Error {
  constructor() { super('NO_KEYRING'); this.name = 'NoKeyringError' }
}

type Stored = Record<string, string> // pluginId -> base64(encrypted)

export class PluginCredentialStore {
  private dir: string
  private file: string
  constructor(private crypto: CryptoBackend, baseDir: string = join(ravenHome(), '.raven-nest')) {
    this.dir = baseDir
    this.file = join(baseDir, 'plugin-credentials.json')
  }
  private load(): Stored {
    try { return JSON.parse(readFileSync(this.file, 'utf8')) } catch { return {} }
  }
  private persist(s: Stored): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.file, JSON.stringify(s))
  }
  setToken(pluginId: string, token: string): void {
    if (!this.crypto.isEncryptionAvailable()) throw new NoKeyringError()
    const s = this.load()
    s[pluginId] = this.crypto.encryptString(token).toString('base64')
    this.persist(s)
  }
  getToken(pluginId: string): string | null {
    const enc = this.load()[pluginId]
    if (!enc) return null
    if (!this.crypto.isEncryptionAvailable()) throw new NoKeyringError()
    return this.crypto.decryptString(Buffer.from(enc, 'base64'))
  }
  has(pluginId: string): boolean { return this.load()[pluginId] != null }
  delete(pluginId: string): void {
    const s = this.load(); delete s[pluginId]; this.persist(s)
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run electron/__tests__/plugin-credentials.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/plugin-credentials.ts electron/__tests__/plugin-credentials.test.ts
git commit -m "feat(integrations): credential store cifrado con safeStorage (inyectable)"
```

---

## Task 6: Runtime de acciones (Slack notify) en el main

**Files:**
- Create: `electron/plugin-actions.ts`
- Test: `electron/__tests__/plugin-actions.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi } from 'vitest'
import { runPluginAction, type ActionDeps } from '../plugin-actions'

const okFetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true }) } as Response)

describe('runPluginAction — slack.notify', () => {
  it('postea a chat.postMessage con el token y el canal', async () => {
    const fetchSpy = vi.fn(okFetch)
    const deps: ActionDeps = { getToken: () => 'xoxb-1', fetch: fetchSpy as unknown as typeof fetch }
    const r = await runPluginAction('slack', 'notify', { channel: '#dev', text: 'listo' }, deps)
    expect(r.ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ channel: '#dev', text: 'listo' })
  })

  it('devuelve NOT_CONNECTED si no hay token', async () => {
    const deps: ActionDeps = { getToken: () => null, fetch: vi.fn() as unknown as typeof fetch }
    expect(await runPluginAction('slack', 'notify', {}, deps)).toEqual({ ok: false, error: 'NOT_CONNECTED' })
  })

  it('propaga el error de la API de Slack', async () => {
    const deps: ActionDeps = {
      getToken: () => 'x',
      fetch: (() => Promise.resolve({ json: () => Promise.resolve({ ok: false, error: 'channel_not_found' }) })) as unknown as typeof fetch,
    }
    expect(await runPluginAction('slack', 'notify', { channel: '#x' }, deps)).toEqual({ ok: false, error: 'channel_not_found' })
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run electron/__tests__/plugin-actions.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar**

```ts
// electron/plugin-actions.ts
export interface ActionDeps {
  getToken(pluginId: string): string | null
  fetch: typeof fetch
}
export interface ActionResult { ok: boolean; error?: string }

export async function runPluginAction(
  pluginId: string,
  actionId: string,
  params: Record<string, unknown>,
  deps: ActionDeps,
): Promise<ActionResult> {
  if (pluginId === 'slack' && actionId === 'notify') {
    const token = deps.getToken('slack')
    if (!token) return { ok: false, error: 'NOT_CONNECTED' }
    const res = await deps.fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel: params.channel, text: params.text }),
    })
    const json = (await res.json()) as { ok: boolean; error?: string }
    return json.ok ? { ok: true } : { ok: false, error: json.error ?? 'slack_error' }
  }
  return { ok: false, error: 'UNKNOWN_ACTION' }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run electron/__tests__/plugin-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/plugin-actions.ts electron/__tests__/plugin-actions.test.ts
git commit -m "feat(integrations): runPluginAction con slack.notify (fetch inyectable)"
```

---

## Task 7: Wiring IPC (plugins store, credentials, actions, slack OAuth)

> Tarea de integración: no es TDD (IPC). Se verifica con `npx tsc --noEmit` y `npm run build`.

**Files:**
- Modify: `src/vite-env.d.ts`, `electron/preload.ts`, `electron/main.ts`

- [ ] **Step 1: Augment de `Window` en `src/vite-env.d.ts`** (agregar dentro de la interface `Window` existente)

```ts
interface Window {
  plugins: {
    list(): Promise<import('./types').InstalledPlugin[]>
    save(p: import('./types').InstalledPlugin): Promise<void>
    delete(pluginId: string): Promise<void>
  }
  pluginCreds: {
    set(pluginId: string, token: string): Promise<{ ok: boolean; error?: string }>
    has(pluginId: string): Promise<boolean>
    delete(pluginId: string): Promise<void>
  }
  pluginActions: {
    run(pluginId: string, actionId: string, params: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>
  }
  slack: {
    openOAuth(): Promise<void>
    onOAuthCode(cb: (code: string) => void): void
    removeOAuthListener(): void
  }
}
```

- [ ] **Step 2: Exponer las APIs en `electron/preload.ts`** (al final, junto a los otros `exposeInMainWorld`)

```ts
contextBridge.exposeInMainWorld('plugins', {
  list: () => ipcRenderer.invoke('plugins:list'),
  save: (p: unknown) => ipcRenderer.invoke('plugins:save', p),
  delete: (id: string) => ipcRenderer.invoke('plugins:delete', id),
})

contextBridge.exposeInMainWorld('pluginCreds', {
  set: (id: string, token: string) => ipcRenderer.invoke('pluginCreds:set', id, token),
  has: (id: string) => ipcRenderer.invoke('pluginCreds:has', id),
  delete: (id: string) => ipcRenderer.invoke('pluginCreds:delete', id),
})

contextBridge.exposeInMainWorld('pluginActions', {
  run: (id: string, actionId: string, params: unknown) =>
    ipcRenderer.invoke('pluginActions:run', id, actionId, params),
})

contextBridge.exposeInMainWorld('slack', {
  openOAuth: () => ipcRenderer.invoke('slack:open-oauth'),
  onOAuthCode: (cb: (code: string) => void) => {
    const handler = (_e: import('electron').IpcRendererEvent, code: string) => cb(code)
    ipcRenderer.on('slack-oauth-code', handler)
  },
  removeOAuthListener: () => ipcRenderer.removeAllListeners('slack-oauth-code'),
})
```

- [ ] **Step 3: Registrar handlers en `electron/main.ts`** (junto al resto de `ipcMain.handle`; reusar el patrón del handler `nest://` existente para el deep-link de Slack)

```ts
import { safeStorage } from 'electron'
import { PluginsStore } from './plugins-store'
import { PluginCredentialStore } from './plugin-credentials'
import { runPluginAction } from './plugin-actions'

const pluginsStore = new PluginsStore()
const pluginCreds = new PluginCredentialStore({
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (s) => safeStorage.encryptString(s),
  decryptString: (b) => safeStorage.decryptString(b),
})

ipcMain.handle('plugins:list', () => pluginsStore.list())
ipcMain.handle('plugins:save', (_e, p) => pluginsStore.save(p))
ipcMain.handle('plugins:delete', (_e, id) => pluginsStore.delete(id))

ipcMain.handle('pluginCreds:set', (_e, id: string, token: string) => {
  try { pluginCreds.setToken(id, token); return { ok: true } }
  catch (err) { return { ok: false, error: err instanceof Error ? err.message : 'error' } }
})
ipcMain.handle('pluginCreds:has', (_e, id: string) => pluginCreds.has(id))
ipcMain.handle('pluginCreds:delete', (_e, id: string) => pluginCreds.delete(id))

ipcMain.handle('pluginActions:run', (_e, id: string, actionId: string, params) =>
  runPluginAction(id, actionId, params ?? {}, { getToken: (p) => pluginCreds.getToken(p), fetch }))
```

- [ ] **Step 4: Handler OAuth Slack en `electron/main.ts`** (espejo de `github:open-oauth`; ver cómo se arma la URL y se emite `github-oauth-code` desde el deep-link `nest://` y replicar para `slack-oauth-code`). El `SLACK_CLIENT_ID` y el `redirect_uri=nest://slack-callback` van por env/config.

```ts
ipcMain.handle('slack:open-oauth', () => {
  const clientId = process.env.SLACK_CLIENT_ID ?? ''
  const scope = 'chat:write,channels:read'
  const url = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scope}&redirect_uri=nest://slack-callback`
  shell.openExternal(url)
})
// En el handler de deep-link nest:// existente: si la URL es nest://slack-callback?code=...,
// extraer `code` y mainWindow.webContents.send('slack-oauth-code', code)
```

- [ ] **Step 5: Verificar tipos + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build OK.

- [ ] **Step 6: Commit**

```bash
git add src/vite-env.d.ts electron/preload.ts electron/main.ts
git commit -m "feat(integrations): IPC de plugins/creds/actions + OAuth Slack"
```

---

## Task 8: Hook usePluginCatalog (remoto + fallback)

**Files:**
- Create: `src/hooks/usePluginCatalog.ts`
- Test: `src/__tests__/hooks/usePluginCatalog.test.tsx`

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const selectMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: selectMock }) },
}))

import { usePluginCatalog } from '../../hooks/usePluginCatalog'
import { BUILTIN_CATALOG } from '../../lib/plugins/builtinCatalog'

describe('usePluginCatalog', () => {
  beforeEach(() => selectMock.mockReset())

  it('usa el catálogo remoto cuando hay manifests válidos', async () => {
    selectMock.mockResolvedValue({
      data: [{ manifest: { id: 'foo', name: 'Foo', type: 'integration', category: 'other' } }],
      error: null,
    })
    const { result } = renderHook(() => usePluginCatalog())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.source).toBe('remote')
    expect(result.current.catalog.map(p => p.id)).toEqual(['foo'])
  })

  it('cae al built-in si Supabase falla', async () => {
    selectMock.mockResolvedValue({ data: null, error: new Error('down') })
    const { result } = renderHook(() => usePluginCatalog())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.source).toBe('builtin')
    expect(result.current.catalog).toHaveLength(BUILTIN_CATALOG.length)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/__tests__/hooks/usePluginCatalog.test.tsx`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar**

```ts
// src/hooks/usePluginCatalog.ts
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { validateManifest } from '../lib/plugins/manifest'
import { BUILTIN_CATALOG } from '../lib/plugins/builtinCatalog'
import type { PluginManifest } from '../types'

export function usePluginCatalog() {
  const [catalog, setCatalog] = useState<PluginManifest[]>([])
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState<'remote' | 'builtin'>('builtin')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const { data, error } = await supabase.from('plugin_catalog').select('manifest')
        if (error || !data || data.length === 0) throw error ?? new Error('empty')
        const manifests = data
          .map((r) => validateManifest((r as { manifest: unknown }).manifest))
          .filter((m): m is PluginManifest => m !== null)
        if (manifests.length === 0) throw new Error('no valid manifests')
        if (active) { setCatalog(manifests); setSource('remote') }
      } catch {
        if (active) { setCatalog(BUILTIN_CATALOG); setSource('builtin') }
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  return { catalog, loading, source }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/__tests__/hooks/usePluginCatalog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePluginCatalog.ts src/__tests__/hooks/usePluginCatalog.test.tsx
git commit -m "feat(integrations): usePluginCatalog con fallback built-in"
```

---

## Task 9: Hook useInstalledPlugins

**Files:**
- Create: `src/hooks/useInstalledPlugins.ts`
- Test: `src/__tests__/hooks/useInstalledPlugins.test.tsx`

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useInstalledPlugins } from '../../hooks/useInstalledPlugins'

describe('useInstalledPlugins', () => {
  beforeEach(() => {
    const data: unknown[] = []
    ;(globalThis as unknown as { window: Window }).window.plugins = {
      list: vi.fn(() => Promise.resolve([...data] as never)),
      save: vi.fn((p: never) => { data.push(p); return Promise.resolve() }),
      delete: vi.fn((id: string) => {
        const i = data.findIndex((x) => (x as { pluginId: string }).pluginId === id)
        if (i >= 0) data.splice(i, 1)
        return Promise.resolve()
      }),
    } as never
  })

  it('install agrega el plugin y isInstalled lo refleja', async () => {
    const { result } = renderHook(() => useInstalledPlugins())
    await waitFor(() => expect(result.current.installed).toEqual([]))
    await act(async () => { await result.current.install('slack', { channel: '#dev' }) })
    expect(result.current.isInstalled('slack')).toBe(true)
    await act(async () => { await result.current.uninstall('slack') })
    expect(result.current.isInstalled('slack')).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/__tests__/hooks/useInstalledPlugins.test.tsx`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar**

```ts
// src/hooks/useInstalledPlugins.ts
import { useState, useEffect, useCallback } from 'react'
import type { InstalledPlugin } from '../types'

export function useInstalledPlugins() {
  const [installed, setInstalled] = useState<InstalledPlugin[]>([])

  const refresh = useCallback(async () => {
    setInstalled(await window.plugins.list())
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const install = useCallback(async (pluginId: string, config: Record<string, unknown> = {}) => {
    await window.plugins.save({ pluginId, scope: 'personal', enabled: true, config })
    await refresh()
  }, [refresh])

  const uninstall = useCallback(async (pluginId: string) => {
    await window.plugins.delete(pluginId)
    await refresh()
  }, [refresh])

  const isInstalled = useCallback(
    (id: string) => installed.some((p) => p.pluginId === id),
    [installed],
  )

  return { installed, install, uninstall, isInstalled, refresh }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/__tests__/hooks/useInstalledPlugins.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useInstalledPlugins.ts src/__tests__/hooks/useInstalledPlugins.test.tsx
git commit -m "feat(integrations): useInstalledPlugins (CRUD local vía IPC)"
```

---

## Task 10: Migración Supabase (catálogo + requests + leads)

> Infra. Se aplica con la Supabase CLI o el dashboard; verificación = la migración corre sin error y el `select` del Task 8 funciona contra la tabla real.

**Files:**
- Create: `supabase/migrations/20260601_plugin_catalog.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- plugin_catalog: cada fila es un PluginManifest (JSONB)
create table if not exists public.plugin_catalog (
  id text primary key,
  manifest jsonb not null,
  created_at timestamptz default now()
);
alter table public.plugin_catalog enable row level security;
create policy "catalog readable by authenticated"
  on public.plugin_catalog for select to authenticated using (true);

-- plugin_requests: demanda de integraciones ("Pedir una")
create table if not exists public.plugin_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  name text not null,
  note text,
  created_at timestamptz default now()
);
alter table public.plugin_requests enable row level security;
create policy "requests insert own"
  on public.plugin_requests for insert to authenticated with check (auth.uid() = user_id);

-- enterprise_leads: CTA del tab Team
create table if not exists public.enterprise_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  team_id uuid,
  message text,
  created_at timestamptz default now()
);
alter table public.enterprise_leads enable row level security;
create policy "leads insert own"
  on public.enterprise_leads for insert to authenticated with check (auth.uid() = user_id);
```

- [ ] **Step 2: Aplicar y seedear las 3 integraciones**

Aplicar la migración (dashboard o `supabase db push`). Seedear `plugin_catalog` insertando el `manifest` JSON de Slack/Notion/Jira (mismos objetos que `BUILTIN_CATALOG`).

- [ ] **Step 3: Verificar**

Confirmar en el dashboard que `select manifest from plugin_catalog` devuelve filas y que con sesión autenticada el hook del Task 8 reporta `source: 'remote'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260601_plugin_catalog.sql
git commit -m "feat(integrations): migración plugin_catalog + requests + leads (RLS)"
```

---

## Task 11: Modal IntegrationsMarketplace (tab Personal)

**Files:**
- Create: `src/components/IntegrationsMarketplace.tsx`
- Test: `src/__tests__/components/IntegrationsMarketplace.test.tsx`

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IntegrationsMarketplace } from '../../components/IntegrationsMarketplace'
import { BUILTIN_CATALOG } from '../../lib/plugins/builtinCatalog'

vi.mock('../../hooks/usePluginCatalog', () => ({
  usePluginCatalog: () => ({ catalog: BUILTIN_CATALOG, loading: false, source: 'builtin' }),
}))
const installMock = vi.fn()
vi.mock('../../hooks/useInstalledPlugins', () => ({
  useInstalledPlugins: () => ({
    installed: [], install: installMock, uninstall: vi.fn(), isInstalled: () => false, refresh: vi.fn(),
  }),
}))

describe('IntegrationsMarketplace', () => {
  it('lista disponibles y separa las coming-soon', () => {
    render(<IntegrationsMarketplace onClose={() => {}} />)
    expect(screen.getByText('Slack')).toBeInTheDocument()
    expect(screen.getByText('Próximamente · sumamos integraciones cada semana')).toBeInTheDocument()
  })

  it('filtra por búsqueda', () => {
    render(<IntegrationsMarketplace onClose={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('Buscar...'), { target: { value: 'jira' } })
    expect(screen.getByText('Jira')).toBeInTheDocument()
    expect(screen.queryByText('Slack')).not.toBeInTheDocument()
  })

  it('Instalar dispara install()', () => {
    render(<IntegrationsMarketplace onClose={() => {}} />)
    fireEvent.click(screen.getAllByText('Instalar')[0])
    expect(installMock).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/__tests__/components/IntegrationsMarketplace.test.tsx`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar** (estilo/markup siguiendo `TeamsWorkspace`/`MyReposPanel`; lógica mínima para pasar el test)

```tsx
// src/components/IntegrationsMarketplace.tsx
import { useState } from 'react'
import { usePluginCatalog } from '../hooks/usePluginCatalog'
import { useInstalledPlugins } from '../hooks/useInstalledPlugins'
import type { PluginManifest } from '../types'

export function IntegrationsMarketplace({ onClose }: { onClose: () => void }) {
  const { catalog } = usePluginCatalog()
  const { install, uninstall, isInstalled } = useInstalledPlugins()
  const [tab, setTab] = useState<'personal' | 'team'>('personal')
  const [q, setQ] = useState('')

  const match = (p: PluginManifest) => p.name.toLowerCase().includes(q.toLowerCase())
  const visible = catalog.filter(match)
  const available = visible.filter(p => !p.comingSoon && !isInstalled(p.id))
  const comingSoon = visible.filter(p => p.comingSoon)
  const installed = visible.filter(p => isInstalled(p.id))

  return (
    <div className="integrations-modal" role="dialog" aria-label="Integraciones">
      <header>
        <button onClick={() => setTab('personal')} aria-pressed={tab === 'personal'}>Personal</button>
        <button onClick={() => setTab('team')} aria-pressed={tab === 'team'}>Team · Enterprise</button>
        <button onClick={onClose} aria-label="Cerrar">×</button>
      </header>

      {tab === 'personal' && (
        <div>
          <input placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} />

          {installed.length > 0 && (
            <section aria-label="Instaladas">
              <h3>Instaladas</h3>
              {installed.map(p => (
                <article key={p.id}>
                  <span>{p.name}</span>
                  <button onClick={() => uninstall(p.id)}>Quitar</button>
                </article>
              ))}
            </section>
          )}

          <section aria-label="Disponibles">
            <h3>Disponibles</h3>
            {available.map(p => (
              <article key={p.id}>
                <span>{p.name}</span>
                <button onClick={() => install(p.id)}>Instalar</button>
              </article>
            ))}
          </section>

          <section aria-label="Próximamente">
            <h3>Próximamente · sumamos integraciones cada semana</h3>
            {comingSoon.map(p => <article key={p.id}><span>{p.name}</span></article>)}
            <button>Pedir integración</button>
          </section>
        </div>
      )}

      {tab === 'team' && (
        <div aria-label="Team Enterprise">
          <h3>Integraciones a medida para tu equipo</h3>
          <p>Las construimos a medida.</p>
          <button onClick={() => window.electronShell.openExternal('https://cal.com/raven/enterprise')}>
            Contactar Enterprise
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/__tests__/components/IntegrationsMarketplace.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/IntegrationsMarketplace.tsx src/__tests__/components/IntegrationsMarketplace.test.tsx
git commit -m "feat(integrations): modal Integraciones (tab Personal + teaser Team)"
```

---

## Task 12: Montar el modal (Sidebar + App)

> Wiring. Verificar con `npm run build` y un smoke test.

**Files:**
- Modify: `src/components/Sidebar.tsx` (botón nuevo junto a Teams/My Repos — buscar las props `onTeamsOpen`/`onMyReposOpen` y agregar `onIntegrationsOpen`)
- Modify: `src/App.tsx` (estado `integrationsOpen` + render condicional, espejo de cómo se montan `TeamsWorkspace`/`MyReposPanel`)

- [ ] **Step 1: En `Sidebar.tsx`** agregar la prop y el botón

```tsx
// en la interface de props del Sidebar:
onIntegrationsOpen: () => void
// junto al botón de My Repos:
<button className="sidebar-btn" onClick={onIntegrationsOpen}>Integraciones</button>
```

- [ ] **Step 2: En `App.tsx`** montar el modal (mismo patrón que el resto de modales)

```tsx
const [integrationsOpen, setIntegrationsOpen] = useState(false)
// pasar onIntegrationsOpen={() => setIntegrationsOpen(true)} al <Sidebar/>
// y donde se renderizan los modales:
{integrationsOpen && <IntegrationsMarketplace onClose={() => setIntegrationsOpen(false)} />}
```

- [ ] **Step 3: Smoke test** `src/__tests__/components/Sidebar-integrations.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sidebar } from '../../components/Sidebar'

it('el botón Integraciones dispara onIntegrationsOpen', () => {
  const onOpen = vi.fn()
  // pasar el resto de props requeridas con stubs mínimos (ver la interface de Sidebar)
  render(<Sidebar onIntegrationsOpen={onOpen} /* ...stubs... */ />)
  fireEvent.click(screen.getByText('Integraciones'))
  expect(onOpen).toHaveBeenCalled()
})
```

> Si `Sidebar` requiere muchas props, extraer solo el botón a un sub-test o stubear con `as never`. Ajustar al shape real de la interface.

- [ ] **Step 4: Verificar build**

Run: `npm run build && npx vitest run src/__tests__/components/Sidebar-integrations.test.tsx`
Expected: build OK + test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx src/__tests__/components/Sidebar-integrations.test.tsx
git commit -m "feat(integrations): botón en Sidebar + montaje del modal en App"
```

---

## Task 13: Conectar Slack (OAuth) + acción "Notificar a Slack"

> Cierra el vertical slice. La parte OAuth necesita un Slack App real (client id/secret) y la Edge Function `slack-oauth`; se verifica manualmente. La acción notify ya está testeada (Task 6); acá se cablea el disparo manual.

**Files:**
- Modify: `src/components/IntegrationsMarketplace.tsx` (botón "Conectar" en la card de Slack)
- Modify: `src/components/RepoActionsMenu.tsx` (item "Notificar a Slack" si Slack está instalado)
- Create (infra): `supabase/functions/slack-oauth/index.ts` (canjea `code`→`access_token`, espejo de la function `github-oauth`)

- [ ] **Step 1: Botón Conectar en la card de Slack** (dispara el flujo OAuth y guarda el token)

```tsx
async function connectSlack() {
  window.slack.removeOAuthListener()
  window.slack.onOAuthCode(async (code) => {
    window.slack.removeOAuthListener()
    const { data, error } = await supabase.functions.invoke('slack-oauth', { body: { code } })
    if (error || !data?.access_token) return // mostrar estado de error en la card
    await window.pluginCreds.set('slack', data.access_token)
    await install('slack', { channel: '#dev' }) // luego editable en el config drawer
  })
  await window.slack.openOAuth()
}
```

- [ ] **Step 2: Item "Notificar a Slack" en `RepoActionsMenu`** (cuando Slack está instalado)

```tsx
// dentro de la construcción de acciones del menú, si isInstalled('slack'):
{
  label: 'Notificar a Slack',
  onClick: async () => {
    const r = await window.pluginActions.run('slack', 'notify', {
      channel: '#dev',
      text: `Worktree ${repoName} listo`,
    })
    if (!r.ok) showToast(`Slack: ${r.error}`) // sin silent failure
  },
}
```

- [ ] **Step 3: Edge Function `slack-oauth`** (canje server-side del code; el client secret vive en Supabase, nunca en la app)

```ts
// supabase/functions/slack-oauth/index.ts — espejo de github-oauth
// POST { code } -> fetch https://slack.com/api/oauth.v2.access (client_id, client_secret, code, redirect_uri)
// responde { access_token, team } al cliente, que lo guarda vía pluginCreds.set
```

- [ ] **Step 4: Verificación manual end-to-end**

1. `npm run dev`. Abrir Integraciones → Slack → Conectar → completar OAuth.
2. Confirmar que aparece como Instalada y que existe `~/.raven-nest/plugin-credentials.json` (cifrado).
3. En un worktree, menú → "Notificar a Slack" → llega el mensaje al canal.
4. Revocar el token en Slack y confirmar que la acción muestra error claro (no silent failure).
5. **Linux:** si `safeStorage.isEncryptionAvailable()` es false, confirmar el mensaje "requiere keyring" y que NO se guarda en texto plano.

- [ ] **Step 5: Commit**

```bash
git add src/components/IntegrationsMarketplace.tsx src/components/RepoActionsMenu.tsx supabase/functions/slack-oauth/index.ts
git commit -m "feat(integrations): conectar Slack (OAuth) + acción Notificar a Slack"
```

---

## Self-Review

**Cobertura del spec (Slice 1):**
- Modelo manifest → Tasks 1, 2. ✅
- Catálogo remoto + fallback → Tasks 3, 8, 10. ✅
- Storage local + credenciales cifradas (no Supabase plano) → Tasks 4, 5, 7. ✅
- Runtime de acciones en main → Tasks 6, 7. ✅
- UI (modal Personal + teaser Team + "Próximamente") → Tasks 11, 12. ✅
- Slack end-to-end (OAuth + notify) → Task 13. ✅
- Caveat Linux sin keyring → Task 5 (NoKeyringError) + Task 13 step 4. ✅
- Sin silent failures → errores propagados en Tasks 6/13. ✅
- Diferido a Slices 2/3: Notion/Jira handlers, funnel Team con persistencia, `plugin_requests`/`enterprise_leads` UI completa, event hook `onAgentDone` automático (acá es manual), migración GitHub/GitLab.

**Type consistency:** `InstalledPlugin` (renderer en types.ts, redeclarado en electron/plugins-store.ts — intencional, documentado). `actionId`/`pluginId` consistentes entre manifest, IPC y `runPluginAction`. `pluginCreds.set` devuelve `{ok,error}` en preload, main y Window typing.

**Placeholder scan:** sin TODO/TBD en pasos testeables. Tasks 7/10/12/13 son wiring/infra con código concreto y verificación por build/manual (no por unit test, por su naturaleza IPC/OAuth).

**Riesgo conocido:** el token de Slack transita el renderer una vez (post-OAuth) antes de ir a `pluginCreds.set`. Aceptable para MVP; documentado en el spec §6.
