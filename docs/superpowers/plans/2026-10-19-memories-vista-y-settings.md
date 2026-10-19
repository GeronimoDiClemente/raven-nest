# Memories: mirar vs. configurar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memories muestra sólo memoria (grafo, lista, búsqueda); toda la configuración de memoria vive en una vista «Memory settings» dentro del mismo overlay; Memories se explica sola con una bienvenida y dos tours.

**Architecture:** `MemoriesWorkspace` gana un estado `vista: 'memorias' | 'settings'`. La vista de settings (`MemorySettingsView`) es un rail de 4 secciones numeradas que monta las tarjetas existentes, más `CloudMemoryCard` extraída de `SettingsPanel`. El color por tipo de memoria sale de la paleta ANSI del tema de terminal del usuario. Los tours reusan `src/tutorial/` (`OnboardingTour`, anclas `data-tour-id`).

**Tech Stack:** Electron + React 18 + TypeScript, Tailwind v4 sin preflight + shadcn, vitest + Testing Library, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-10-19-memories-vista-y-settings-design.md`

## Global Constraints

- UI, copy y nombres visibles **en inglés**; comentarios de código en español, como el resto del repo.
- Componente nuevo = shadcn + utilidades Tailwind. **Ninguna clase nueva en `global.css`.** Tailwind sin preflight: no importar `"tailwindcss"` entero.
- Color sólo para: tipos de memoria (ANSI del tema), estados (`--ok`, `--warn`, `--destructive`). Rail lateral sin color.
- Typecheck real = `npx tsc -p tsconfig.node.json --noEmit --composite false` y `npx tsc -p tsconfig.web.json --noEmit --composite false`. Baseline: 0 errores. **No usar `tsc -b`.**
- `npm test` corre `pretest` → deja el binding de Node; para volver a levantar la app: `npm run native:electron` y verificar sha256 `359cbd480d7c…` de `node_modules/better-sqlite3/build/Release/better_sqlite3.node`.
- Todo cambio de UI pasa `e2e/04-contraste.spec.ts` antes del commit final.
- Commits en `feat/memories-settings`, **sin push**. Terminar cada mensaje con `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

- **Sin repo vinculado en la pestaña:** «This project & team» muestra sólo «Link a repo» (nunca un toggle que falla). Test en Task 5.
- **Sin equipo activo:** la sección Encryption no muestra la tarjeta de equipo ni un hueco. Test en Task 5.
- **e2e / `appFlags.e2eBypass`:** la bienvenida NO aparece (si aparece, tapa todos los e2e que abren Memories). Test en Task 7.
- **Tema de terminal importado o desconocido:** el color por tipo cae al tema Nest, nunca `undefined` en un nodo. Test en Task 1.
- **Barra de la nube:** con 1 pendiente y 3 MB de 1 GB, la barra de cuota no puede verse llena. Test en Task 3.

---

### Task 1: Color por tipo desde la paleta ANSI

**Files:**
- Modify: `src/lib/memory-type-legend.ts` (hoy hexes fijos para 7 tipos)
- Modify: `src/lib/memory-graph-visuals.ts:278-332` (`toGraphData` recibe la paleta)
- Modify: `src/components/MemoryGraphPanel.tsx:121` (default `colorBy` → `'type'`), `:151` (pasa `ansi`)
- Modify: `src/components/MemoriesList.tsx:200-251` (`MemoryRow`: etiqueta de tipo en texto)
- Test: `src/__tests__/lib/memory-type-colors.test.ts` (nuevo)

**Interfaces:**
- Produces: `memoryTypeSwatch(type: string, ansi?: readonly string[]): { label: string; color: string } | null` — sin `ansi` usa `TEMA_NEST.ansi`.
- Produces: `MEMORY_TYPE_ANSI: Record<KnownMemoryType, number>`; `KnownMemoryType` suma `'session' | 'handoff'`.
- Produces: prop `ansi?: readonly string[]` en `MemoryGraphPanel` y `MemoriesList`.

- [ ] **Step 1: Test que falla**

```ts
import { describe, it, expect } from 'vitest'
import { memoryTypeSwatch, MEMORY_TYPE_ANSI } from '../../lib/memory-type-legend'
import { TEMA_NEST, TEMAS } from '../../lib/terminal-themes'

describe('color por tipo = ANSI del tema', () => {
  it('cada tipo conocido sale de su índice ANSI', () => {
    const tema = TEMAS[1]
    expect(memoryTypeSwatch('decision', tema.ansi)?.color).toBe(tema.ansi[4])
    expect(memoryTypeSwatch('bugfix', tema.ansi)?.color).toBe(tema.ansi[1])
    expect(memoryTypeSwatch('architecture', tema.ansi)?.color).toBe(tema.ansi[5])
    expect(memoryTypeSwatch('discovery', tema.ansi)?.color).toBe(tema.ansi[6])
    expect(memoryTypeSwatch('pattern', tema.ansi)?.color).toBe(tema.ansi[2])
    expect(memoryTypeSwatch('handoff', tema.ansi)?.color).toBe(tema.ansi[3])
    for (const t of ['config', 'preference', 'session'] as const) {
      expect(memoryTypeSwatch(t, tema.ansi)?.color).toBe(tema.ansi[8])
    }
  })
  it('sin paleta, o con una paleta rota, cae al tema Nest', () => {
    expect(memoryTypeSwatch('decision')?.color).toBe(TEMA_NEST.ansi[4])
    expect(memoryTypeSwatch('decision', [])?.color).toBe(TEMA_NEST.ansi[4])
  })
  it('un tipo desconocido no inventa color', () => {
    expect(memoryTypeSwatch('nada', TEMA_NEST.ansi)).toBeNull()
  })
  it('los nueve tipos tienen índice', () => {
    expect(Object.keys(MEMORY_TYPE_ANSI).sort()).toEqual(
      ['architecture', 'bugfix', 'config', 'decision', 'discovery', 'handoff', 'pattern', 'preference', 'session'])
  })
})
```

- [ ] **Step 2:** `npx vitest run src/__tests__/lib/memory-type-colors.test.ts` → FAIL (`MEMORY_TYPE_ANSI` no existe).

- [ ] **Step 3: Implementación** — en `memory-type-legend.ts` reemplazar la tabla de hexes por:

```ts
import { TEMA_NEST } from './terminal-themes'

export type KnownMemoryType =
  | 'decision' | 'bugfix' | 'architecture' | 'discovery' | 'pattern'
  | 'config' | 'preference' | 'session' | 'handoff'

/** Índice ANSI por tipo. El color sale del tema de terminal del usuario: Memories se ve como sus terminales. */
export const MEMORY_TYPE_ANSI: Record<KnownMemoryType, number> = {
  decision: 4, bugfix: 1, architecture: 5, discovery: 6, pattern: 2, handoff: 3,
  config: 8, preference: 8, session: 8,
}

const LABEL: Record<KnownMemoryType, string> = {
  decision: 'Decision', bugfix: 'Bugfix', architecture: 'Architecture', discovery: 'Discovery',
  pattern: 'Pattern', config: 'Config', preference: 'Preference', session: 'Session', handoff: 'Handoff',
}

export function memoryTypeSwatch(type: string, ansi?: readonly string[]): { label: string; color: string } | null {
  if (!(type in MEMORY_TYPE_ANSI)) return null
  const k = type as KnownMemoryType
  const paleta = ansi && ansi.length >= 16 ? ansi : TEMA_NEST.ansi
  return { label: LABEL[k], color: paleta[MEMORY_TYPE_ANSI[k]] }
}
```

Mantener `MEMORY_TYPES_IN_LEGEND_ORDER` con los 9 tipos en este orden: decision, bugfix, architecture, discovery, pattern, handoff, config, preference, session. Buscar los llamadores con `grep -rn "memoryTypeSwatch" src` y pasarles `ansi` donde lo tengan (los que no, siguen andando con el default).

- [ ] **Step 4:** En `toGraphData(graph, opts)` sumar `ansi?: readonly string[]` a `opts` y usar `memoryTypeSwatch(n.type, opts.ansi)`. En `MemoryGraphPanel` sumar la prop `ansi`, pasarla a `toGraphData`, y cambiar `useState<ColorBy>('project')` por `useState<ColorBy>('type')`. En `MemoryRow` de `MemoriesList` reemplazar el punto de 2px por una etiqueta de texto:

```tsx
{swatch && (
  <span className="shrink-0 rounded-full px-2 text-fs-xs" style={{ color: swatch.color, border: `1px solid ${swatch.color}` }}>
    {swatch.label.toLowerCase()}
  </span>
)}
```

- [ ] **Step 5: Chips que filtran (spec §2).** Test que falla en `src/__tests__/lib/memory-graph-visuals.test.ts` (crear el `describe` si el archivo existe; si no, archivo nuevo):

```ts
it('los tipos ocultos no llegan al grafo', () => {
  const graph = { nodes: [
    { syncId: 'a', type: 'decision' }, { syncId: 'b', type: 'bugfix' },
  ], edges: [] } as any
  const data = toGraphData(graph, { colorBy: 'type', hideOrphans: false, foco: null, tiposOcultos: new Set(['bugfix']) } as any)
  expect(data.nodes.map((n) => n.id)).toEqual(['a'])
})
```

(Copiar la forma exacta de `graph` de los tests existentes de `toGraphData` si `as any` no alcanza para que corra.) Implementar: `opts.tiposOcultos?: ReadonlySet<string>` filtra nodos y las aristas que los tocan. En `MemoryGraphPanel`, la leyenda de tipos (`:420-431`) pasa a ser una fila de `<button aria-pressed>` con `swatch.color`, label y contador (cantidad de nodos de ese tipo); click alterna el tipo en un `Set` que vive en `MemoriesWorkspace` y baja como props `tiposOcultos` + `onToggleTipo` a `MemoryGraphPanel` y `MemoriesList` (la lista filtra `items` por `!tiposOcultos.has(item.type)`). Test de componente: click en el chip «Bugfix» → `aria-pressed="false"` y la fila bugfix desaparece de la lista.
- [ ] **Step 6:** `npx vitest run src/__tests__/lib src/__tests__/components/MemoryGraphPanel* src/__tests__/components/MemoriesList*` → PASS (ajustar sólo aserciones que fijaban los hexes viejos o el default `'project'`).
- [ ] **Step 7: Commit** `feat(memories): el color por tipo sale de la paleta ANSI y los tipos filtran grafo y lista`

---

### Task 2: El hilo del equipo: hook compartido y toggle aparte

**Files:**
- Create: `src/hooks/useTeamThreadSettings.ts`
- Create: `src/components/TeamThreadToggle.tsx`
- Modify: `src/components/TeamThreadPanel.tsx` (usa el hook; sin estado vacío)
- Modify: `src/components/TeamThreadGraph.tsx:66-73,89` (se van el bloque `!enabled` y «Turn off»)
- Test: `src/__tests__/hooks/useTeamThreadSettings.test.tsx`, `src/__tests__/components/TeamThreadToggle.test.tsx`

**Interfaces:**
- Produces: `useTeamThreadSettings(activeRepoPath: string | null): { ready: boolean; projectKey: string | null; enabled: boolean; error: string | null; setEnabled: (next: boolean) => Promise<void> }`
- Produces: `<TeamThreadToggle activeRepoPath={string} />` (switch con label «Branch notes in the repo»).
- `TeamThreadPanel` devuelve `null` si `!enabled`.

- [ ] **Step 1: Tests que fallan**

```tsx
// useTeamThreadSettings.test.tsx
import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTeamThreadSettings } from '../../hooks/useTeamThreadSettings'

beforeEach(() => {
  ;(window as any).memory = {
    teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue({ ok: true, projectKey: 'pk' }),
    teamThreadGetSettings: vi.fn().mockResolvedValue({ ok: true, settings: { enabled: false } }),
    teamThreadSetSettings: vi.fn().mockResolvedValue({ ok: true }),
  }
})

describe('useTeamThreadSettings', () => {
  it('lee el estado del repo', async () => {
    const { result } = renderHook(() => useTeamThreadSettings('/repo'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.enabled).toBe(false)
    expect(result.current.projectKey).toBe('pk')
  })
  it('prender escribe y refleja', async () => {
    const { result } = renderHook(() => useTeamThreadSettings('/repo'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(() => result.current.setEnabled(true))
    expect((window as any).memory.teamThreadSetSettings).toHaveBeenCalledWith('pk', '/repo', { enabled: true })
    expect(result.current.enabled).toBe(true)
  })
  it('un rechazo de main muestra su mensaje y no cambia el estado', async () => {
    ;(window as any).memory.teamThreadSetSettings.mockResolvedValue({ ok: false, message: 'Your plan does not include it' })
    const { result } = renderHook(() => useTeamThreadSettings('/repo'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(() => result.current.setEnabled(true))
    expect(result.current.enabled).toBe(false)
    expect(result.current.error).toBe('Your plan does not include it')
  })
  it('sin repo no consulta nada', async () => {
    const { result } = renderHook(() => useTeamThreadSettings(null))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect((window as any).memory.teamThreadProjectKeyForWorktree).not.toHaveBeenCalled()
  })
})
```

```tsx
// TeamThreadToggle.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
import TeamThreadToggle from '../../components/TeamThreadToggle'

it('el switch prende las notas por rama', async () => {
  ;(window as any).memory = {
    teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue({ ok: true, projectKey: 'pk' }),
    teamThreadGetSettings: vi.fn().mockResolvedValue({ ok: true, settings: { enabled: false } }),
    teamThreadSetSettings: vi.fn().mockResolvedValue({ ok: true }),
  }
  render(<TeamThreadToggle activeRepoPath="/repo" />)
  const sw = await screen.findByRole('switch', { name: /Branch notes in the repo/ })
  fireEvent.click(sw)
  await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'))
})
```

- [ ] **Step 2:** `npx vitest run src/__tests__/hooks/useTeamThreadSettings.test.tsx src/__tests__/components/TeamThreadToggle.test.tsx` → FAIL (módulos no existen).

- [ ] **Step 3: Hook** — mover a `useTeamThreadSettings.ts` la parte de `TeamThreadPanel.load` que resuelve `projectKey` y lee `settings.enabled`, y `handleToggle` como `setEnabled`. Mismos textos de error (`LOAD_ERROR`, `TOGGLE_ERROR`, y `res.message` cuando main lo manda). Efecto con `alive` para no setear estado tras desmontar.

- [ ] **Step 4: Toggle** — `TeamThreadToggle.tsx`:

```tsx
import { useTeamThreadSettings } from '../hooks/useTeamThreadSettings'

export default function TeamThreadToggle({ activeRepoPath }: { activeRepoPath: string }) {
  const t = useTeamThreadSettings(activeRepoPath)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span id="branch-notes-label" className="text-fs-md font-medium">Branch notes in the repo</span>
        <button
          type="button" role="switch" aria-checked={t.enabled} aria-labelledby="branch-notes-label"
          disabled={!t.ready || !t.projectKey}
          onClick={() => void t.setEnabled(!t.enabled)}
          className="ml-auto h-5 w-9 rounded-full border border-border bg-muted aria-checked:bg-foreground"
        >
          <span className="block h-4 w-4 translate-x-0.5 rounded-full bg-background transition-transform data-[on=true]:translate-x-4" data-on={t.enabled} />
        </button>
      </div>
      <p className="text-fs-sm text-muted-foreground">
        Writes a short note per branch into <code className="font-mono">.nest/team/</code> inside this repo: who is on it,
        what they changed and what they found. It travels with git, so the team reads it even without Nest — and a map
        of the branches shows up under the graph in Memories.
      </p>
      {t.error && <p className="text-fs-sm text-warn">{t.error}</p>}
    </div>
  )
}
```

(Si `src/components/ui/switch.tsx` existe, usar ese primitivo en vez del botón a mano: `ls src/components/ui`.)

- [ ] **Step 5:** `TeamThreadPanel` usa el hook para `projectKey`/`enabled`, conserva la lectura de ramas (`teamThreadRead`, `git.info`) y devuelve `null` si `!enabled`. `TeamThreadGraph`: borrar el bloque `if (!enabled) {…}` y el botón «Turn off»; quitar `enabled`/`onToggle` de sus props y de sus llamadores.
- [ ] **Step 6:** `npx vitest run src/__tests__ -t "TeamThread"` → PASS (borrar/ajustar aserciones sobre «Turn on»/«Turn off» dentro del grafo).
- [ ] **Step 7: Commit** `refactor(memories): el toggle del hilo sale del grafo a su propio componente`

---

### Task 3: `CloudMemoryCard` extraída de Settings, con subida y cuota separadas

**Files:**
- Create: `src/components/CloudMemoryCard.tsx`
- Modify: `src/components/SettingsPanel.tsx` (borrar `SECCIONES` `cloud`, su `<Seccion>` `:652-820`, el estado de memoria `:317-363` que sólo usaba esa sección, y los portales `:1123-1132`; Account: botón «Memory settings»)
- Create: `src/__tests__/components/CloudMemoryCard.test.tsx` (mudanza de `SettingsPanel.test.tsx:321-698`)
- Modify: `src/__tests__/components/SettingsPanel.test.tsx`, `src/__tests__/components/settings-una-seccion.test.tsx:90-110`

**Interfaces:**
- Produces: `<CloudMemoryCard />` sin props (lee `useMemory`, `useProfile`, `useUserRepos`). Monta su propio `UpgradeModal` y `MemoryHub` vía `createPortal(…, document.body)`.
- Produces: en `SettingsPanel`, `onOpenMemories?: (vista?: 'memorias' | 'settings') => void`; el botón de Account se llama «Memory settings» y llama `onOpenMemories('settings')`.

- [ ] **Step 1: Mudar los tests** — mover a `CloudMemoryCard.test.tsx` los casos de `SettingsPanel.test.tsx:346-698` con su `mockMemoryBridge` (`:321-344`), cambiando el render a `render(<CloudMemoryCard />)` (sin clicks en «Settings»/«Account»). Agregar:

```tsx
it('la barra de cuota es la cuota, no el progreso de subida', async () => {
  mockMemoryBridge({ connected: true, deviceId: 'd', itemCount: 48, pendingCount: 1, daemonStatus: 'idle',
    quota: { used_bytes: 3.1 * 1024 * 1024, max_bytes: 1024 ** 3 } })
  render(<CloudMemoryCard />)
  const barra = await screen.findByRole('meter', { name: /Cloud space/ })
  expect(Number(barra.getAttribute('aria-valuenow'))).toBeLessThan(1)
  expect(screen.getByText(/Uploading 1 change/)).toBeInTheDocument()
})
it('sin pendientes no dice que sube nada', async () => {
  mockMemoryBridge({ connected: true, deviceId: 'd', itemCount: 48, pendingCount: 0, daemonStatus: 'idle' })
  render(<CloudMemoryCard />)
  await screen.findByText(/48 memories/)
  expect(screen.queryByText(/Uploading/)).toBeNull()
})
```

En `settings-una-seccion.test.tsx` cambiar `'Cloud memory'` por `'Voice'` en `:90-110`. En `SettingsPanel.test.tsx` agregar: el rail NO tiene «Cloud memory» y Account tiene el botón «Memory settings» que llama `onOpenMemories('settings')`.

- [ ] **Step 2:** `npx vitest run src/__tests__/components/CloudMemoryCard.test.tsx src/__tests__/components/SettingsPanel.test.tsx src/__tests__/components/settings-una-seccion.test.tsx` → FAIL.

- [ ] **Step 3: Implementación** — copiar a `CloudMemoryCard.tsx` el JSX `:661-818` y el estado que usa (`memory`, `nubeDisponible`, `memoryUpgradeOpen`, `memoryHubOpen`, `deleteCloudOnDisconnect`, `memoryToken`, su `useEffect`, `formatBytes`, `conectarMemoria`). Cambios de contenido:
  - Título «Cloud sync»; línea: «Keeps a copy of your memory in the cloud, so what an agent learns on this machine is there when you open Nest on another one. It is encrypted here before it leaves.»
  - Estado conectado: `{itemCount} memories`.
  - Se borra la barra `sp-mem-progress`. Si `pendingCount > 0` y conectado: `<span className="text-fs-sm text-warn">Uploading {n} change{s}…</span>`.
  - Cuota: `Cloud space: {formatBytes(used)} of {formatBytes(max)}` + `<div role="meter" aria-label="Cloud space" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>` con ancho `max(pct, 0.5)%`.
  - Reemplazar los `style={{ color: '#f59e0b' }}` / `'#ef4444'` por clases `text-warn` / `text-destructive`.
  - El checkbox «Also delete my cloud memory…» queda, pero dentro de un `AlertDialog` que abre «Turn off» (antes «Disconnect»); el dialog llama `memory.disconnect(deleteCloud)`. Si `src/components/ui/alert-dialog.tsx` no existe, usar `dialog.tsx`.
  - Ajustar los tests mudados que buscaban «Disconnect» para que primero abran el diálogo con «Turn off».

- [ ] **Step 4:** Borrar lo mudado de `SettingsPanel.tsx` y sus imports sin uso (`MemoryHub`, `UpgradeModal` si no quedan otros usos, `logoUrl`, `Cloud`). El `MemoryAdoptionDialog` (`:502-510`) y su `useMemory` se quedan. Account: `{onOpenMemories && <Button variant="outline" size="sm" onClick={() => onOpenMemories('settings')}>Memory settings</Button>}`.
- [ ] **Step 5:** tests del Step 2 → PASS; `npx vitest run src/__tests__/iconos-sin-repetir.test.ts` → PASS.
- [ ] **Step 6: Commit** `refactor(settings): la nube de memoria sale de Settings a CloudMemoryCard, con la subida separada de la cuota`

---

### Task 4: Copy de las tarjetas: qué es y para qué sirve

**Files:**
- Modify: `src/components/LinkDeviceCard.tsx:80` y su párrafo
- Modify: `src/components/SyncServiceCard.tsx:76` y su párrafo
- Modify: `src/components/ShareProjectCard.tsx:107,130` y su cuerpo
- Modify: `src/components/MemoryEncryptionCard.tsx:165` (título y aviso del código), `src/components/TeamEncryptionCard.tsx:92,193,207`
- Modify: `electron/cli-del-paquete.ts` (`comandoLogin`, la línea que nombra la tarjeta)
- Test: los tests existentes de cada tarjeta (`ls src/__tests__/components | grep -i -E "LinkDevice|SyncService|ShareProject|share-project|Encryption"`)

**Interfaces:** ninguna nueva; sólo texto.

- [ ] **Step 1:** Actualizar primero las aserciones de texto en los tests de esas tarjetas a los textos nuevos de abajo → correrlos → FAIL.
- [ ] **Step 2: Textos** (exactos):
  - LinkDeviceCard: título «Add a machine that has no browser»; párrafo «For a server, a VM or an SSH box where you can't sign in with a browser. That machine shows you a code; you approve it here, from a machine that is already signed in.»; lista `<ol>` 1. «On that machine, run `npx nest-memory login`» 2. «It prints an 8-character code. Type it below within 10 minutes.»; botón «Approve machine».
  - SyncServiceCard: título «Where your memory syncs to» + badge «Advanced» (`Badge variant="outline"`); párrafo «The server your memory travels through. Leave it as it is — change it only if your company runs its own Nest server.»
  - ShareProjectCard (cara con permiso): título «Share this project's memory with a team»; párrafo «What agents learn while working on this repo becomes available to everyone in the team you pick. Their agents read it before they start, so nobody re-discovers what a teammate already figured out.»; dos cajas `grid grid-cols-2 gap-2`: «The team will see — Memories saved in this project: decisions, fixes, how the code fits together, including the ones already saved.» / «Stays only yours — Your other projects, your personal memories, your code and your terminals.»; botón «Share with {team}». La cara sin permiso conserva su explicación, con título «Share this project's memory with a team».
  - MemoryEncryptionCard: título «Encrypt your memory»; descripción «Locks your memory with a key that only your own machines hold, before anything goes to the cloud. On this machine it stays readable, so search and your agents keep working as usual.»; aviso `text-warn`: «You will get a recovery code. Keep it somewhere safe: if you lose every machine and the code, the cloud copy can never be opened again.»
  - TeamEncryptionCard: título «Encrypt what {team} shares»; descripción «Same idea, for the projects this team shares: one key that only the team's machines hold. What was already shared gets re-encrypted when you turn it on. Only the team leader can do it.»
  - `cli-del-paquete.ts`: `'  into "Connect a machine without a browser".'` → `'  into Memory settings → "Add a machine that has no browser".'`
  - **No cambiar** «Turn on encryption», «Save this code», «Encryption on», «Turn on team encryption»: los usan e2e 12 y 16.
- [ ] **Step 3:** tests de tarjetas → PASS.
- [ ] **Step 4: Commit** `copy(memories): cada tarjeta dice qué es y para qué sirve`

---

### Task 5: `MemorySettingsView`

**Files:**
- Create: `src/components/MemorySettingsView.tsx`
- Test: `src/__tests__/components/MemorySettingsView.test.tsx`

**Interfaces:**
- Consumes: `CloudMemoryCard` (Task 3), `TeamThreadToggle` (Task 2), las tarjetas de Task 4, `MemoryVaultCard`, `WorkspaceNavButton` (`{ icon, label, active, onClick, dataTourId? }`).
- Produces: `export type SeccionDeMemoria = 'sync' | 'encryption' | 'project' | 'disk'`
- Produces: `<MemorySettingsView activeRepoPath={string|null} onLinkRepo?={() => void} seccionInicial?={SeccionDeMemoria} onHowItWorks={() => void} />`
- Escucha `window` `CustomEvent<'nest:memory-settings-seccion'>` con `detail: SeccionDeMemoria` (lo dispara el tour, Task 7).

- [ ] **Step 1: Test que falla**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MemorySettingsView from '../../components/MemorySettingsView'

vi.mock('../../components/CloudMemoryCard', () => ({ default: () => <div>cloud-card</div> }))
vi.mock('../../components/LinkDeviceCard', () => ({ default: () => <div>link-card</div> }))
vi.mock('../../components/SyncServiceCard', () => ({ default: () => <div>service-card</div> }))
vi.mock('../../components/MemoryEncryptionCard', () => ({ default: () => <div>enc-card</div> }))
vi.mock('../../components/TeamEncryptionCard', () => ({ default: () => <div>team-enc-card</div> }))
vi.mock('../../components/ShareProjectCard', () => ({ default: () => <div>share-card</div> }))
vi.mock('../../components/TeamThreadToggle', () => ({ default: () => <div>thread-toggle</div> }))
vi.mock('../../components/MemoryVaultCard', () => ({ default: () => <div>vault-card</div> }))
const team = vi.hoisted(() => ({ activeTeam: null as null | { id: string; name: string } }))
vi.mock('../../hooks/useTeam', () => ({ useTeam: () => team }))

beforeEach(() => { team.activeTeam = null })

describe('MemorySettingsView', () => {
  it('arranca en Sync con sus tres tarjetas', () => {
    render(<MemorySettingsView activeRepoPath="/r" onHowItWorks={() => {}} />)
    expect(screen.getByText('cloud-card')).toBeInTheDocument()
    expect(screen.getByText('link-card')).toBeInTheDocument()
    expect(screen.getByText('service-card')).toBeInTheDocument()
  })
  it('el rail cambia de sección', () => {
    render(<MemorySettingsView activeRepoPath="/r" onHowItWorks={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Encryption/ }))
    expect(screen.getByText('enc-card')).toBeInTheDocument()
    expect(screen.queryByText('cloud-card')).toBeNull()
  })
  it('sin equipo activo no hay tarjeta de equipo', () => {
    render(<MemorySettingsView activeRepoPath="/r" seccionInicial="encryption" onHowItWorks={() => {}} />)
    expect(screen.queryByText('team-enc-card')).toBeNull()
  })
  it('con equipo activo sí', () => {
    team.activeTeam = { id: 't', name: 'STI' }
    render(<MemorySettingsView activeRepoPath="/r" seccionInicial="encryption" onHowItWorks={() => {}} />)
    expect(screen.getByText('team-enc-card')).toBeInTheDocument()
  })
  it('sin repo, This project sólo ofrece vincular uno', () => {
    const onLinkRepo = vi.fn()
    render(<MemorySettingsView activeRepoPath={null} seccionInicial="project" onLinkRepo={onLinkRepo} onHowItWorks={() => {}} />)
    expect(screen.queryByText('share-card')).toBeNull()
    expect(screen.queryByText('thread-toggle')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Link a repo' }))
    expect(onLinkRepo).toHaveBeenCalled()
  })
  it('How Memories works llama al callback', () => {
    const onHowItWorks = vi.fn()
    render(<MemorySettingsView activeRepoPath="/r" onHowItWorks={onHowItWorks} />)
    fireEvent.click(screen.getByRole('button', { name: /How Memories works/ }))
    expect(onHowItWorks).toHaveBeenCalled()
  })
  it('el evento del tour cambia la sección', () => {
    render(<MemorySettingsView activeRepoPath="/r" onHowItWorks={() => {}} />)
    window.dispatchEvent(new CustomEvent('nest:memory-settings-seccion', { detail: 'disk' }))
    expect(screen.getByText('vault-card')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2:** `npx vitest run src/__tests__/components/MemorySettingsView.test.tsx` → FAIL.

- [ ] **Step 3: Implementación**

```tsx
import { useEffect, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import WorkspaceNavButton from './WorkspaceNavButton'
import CloudMemoryCard from './CloudMemoryCard'
import LinkDeviceCard from './LinkDeviceCard'
import SyncServiceCard from './SyncServiceCard'
import MemoryEncryptionCard from './MemoryEncryptionCard'
import TeamEncryptionCard from './TeamEncryptionCard'
import ShareProjectCard from './ShareProjectCard'
import TeamThreadToggle from './TeamThreadToggle'
import MemoryVaultCard from './MemoryVaultCard'
import { useTeam } from '../hooks/useTeam'
import { Button } from '@/components/ui/button'
import { ICON_SIZE } from '../lib/icons'

export type SeccionDeMemoria = 'sync' | 'encryption' | 'project' | 'disk'

const SECCIONES: Array<{ id: SeccionDeMemoria; n: string; titulo: string; bajada: string }> = [
  { id: 'sync', n: '01', titulo: 'Sync', bajada: 'Same memory on every machine you work on.' },
  { id: 'encryption', n: '02', titulo: 'Encryption', bajada: "The server keeps your memory but can't read it — not even us." },
  { id: 'project', n: '03', titulo: 'This project & team', bajada: 'Nothing here is shared until you turn it on.' },
  { id: 'disk', n: '04', titulo: 'Notes on disk', bajada: 'Your memories as Markdown files you can open in any editor.' },
]

export const EVENTO_SECCION = 'nest:memory-settings-seccion'

interface Props {
  activeRepoPath: string | null
  onLinkRepo?: () => void
  seccionInicial?: SeccionDeMemoria
  onHowItWorks: () => void
}

export default function MemorySettingsView({ activeRepoPath, onLinkRepo, seccionInicial = 'sync', onHowItWorks }: Props) {
  const [seccion, setSeccion] = useState<SeccionDeMemoria>(seccionInicial)
  const { activeTeam } = useTeam()

  useEffect(() => {
    const alCambiar = (e: Event) => {
      const id = (e as CustomEvent<SeccionDeMemoria>).detail
      if (SECCIONES.some((s) => s.id === id)) setSeccion(id)
    }
    window.addEventListener(EVENTO_SECCION, alCambiar)
    return () => window.removeEventListener(EVENTO_SECCION, alCambiar)
  }, [])

  const actual = SECCIONES.find((s) => s.id === seccion)!
  return (
    <div className="flex min-h-0 flex-1">
      <nav className="teams-workspace-nav flex flex-col">
        {SECCIONES.map((s) => (
          <WorkspaceNavButton
            key={s.id}
            icon={<span className="font-mono text-fs-xs text-muted-foreground">{s.n}</span>}
            label={s.titulo}
            active={seccion === s.id}
            onClick={() => setSeccion(s.id)}
            dataTourId={`memory-settings-${s.id}`}
          />
        ))}
        <Button variant="outline" size="sm" className="mt-auto justify-start" onClick={onHowItWorks}>
          <CircleHelp size={ICON_SIZE.sm} aria-hidden />
          How Memories works
        </Button>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        <header className="flex flex-col gap-1">
          <h2 className="flex items-baseline gap-2 text-fs-lg font-semibold">
            <span className="font-mono text-fs-sm text-muted-foreground">{actual.n}</span>{actual.titulo}
          </h2>
          <p className="text-fs-sm text-muted-foreground">{actual.bajada}</p>
        </header>
        {seccion === 'sync' && (<><CloudMemoryCard /><LinkDeviceCard /><SyncServiceCard /></>)}
        {seccion === 'encryption' && (<><MemoryEncryptionCard />{activeTeam && <TeamEncryptionCard />}</>)}
        {seccion === 'project' && (activeRepoPath ? (
          <><ShareProjectCard activeRepoPath={activeRepoPath} /><TeamThreadToggle activeRepoPath={activeRepoPath} /></>
        ) : (
          <div className="flex items-center gap-3 rounded-md border border-border p-4">
            <span className="flex-1 text-fs-sm text-muted-foreground">Open a repo in this tab to share it or keep branch notes.</span>
            {onLinkRepo && <Button variant="outline" size="sm" onClick={onLinkRepo}>Link a repo</Button>}
          </div>
        ))}
        {seccion === 'disk' && <MemoryVaultCard />}
      </div>
    </div>
  )
}
```

Cambiar el título «Memory Vault» de `MemoryVaultCard.tsx:88` por «Notes on disk» y ajustar `MemoriesStatusRow.test.tsx` en el Task 6.
- [ ] **Step 4:** test → PASS.
- [ ] **Step 5: Commit** `feat(memories): vista Memory settings con cuatro secciones numeradas`

---

### Task 6: `MemoriesWorkspace` con las dos vistas, y App

**Files:**
- Modify: `src/components/MemoriesWorkspace.tsx` (todo el archivo)
- Modify: `src/components/MemoriesStatusRow.tsx:107-118` (se va el popover)
- Modify: `src/App.tsx:246-253` (estado), `:1876` y `:2117` (callbacks), `:2180-2191` (mount)
- Modify: `src/components/Sidebar.tsx:938` (pasa la vista)
- Test: `src/__tests__/components/MemoriesWorkspace.test.tsx`, `src/__tests__/components/MemoriesStatusRow.test.tsx`

**Interfaces:**
- Consumes: `MemorySettingsView`, `SeccionDeMemoria` (Task 5); prop `ansi` de `MemoryGraphPanel`/`MemoriesList` (Task 1).
- Produces: `MemoriesWorkspace` props suman `vistaInicial?: 'memorias' | 'settings'`, `ansi?: readonly string[]`, `onHowItWorks: () => void`, `onMemorySettingsTour: () => void`.
- Produces: `App` guarda `memoriesVista: 'memorias' | 'settings'`; `onMemoriesOpen(vista = 'memorias')`.

- [ ] **Step 1: Tests que fallan** (en `MemoriesWorkspace.test.tsx`, con los mocks que el archivo ya usa):

```tsx
it('la vista principal no tiene configuración', () => {
  renderWorkspace({ activeRepoPath: '/r' })
  expect(screen.queryByText(/Share this project/)).toBeNull()
  expect(screen.queryByText(/Encrypt your memory/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull()
})
it('Settings abre la vista de settings y Back vuelve a los nodos', () => {
  renderWorkspace({ activeRepoPath: '/r' })
  fireEvent.click(screen.getByRole('button', { name: 'Memory settings' }))
  expect(screen.getByText('Memory settings', { selector: '.tw-header-title' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Memories/ }))
  expect(screen.getByText('Memories', { selector: '.tw-header-title' })).toBeInTheDocument()
})
it('vistaInicial=settings abre directo en settings', () => {
  renderWorkspace({ activeRepoPath: null, vistaInicial: 'settings' })
  expect(screen.getByText('Memory settings', { selector: '.tw-header-title' })).toBeInTheDocument()
})
it('How it works llama al callback', () => {
  const onHowItWorks = vi.fn()
  renderWorkspace({ activeRepoPath: null, onHowItWorks })
  fireEvent.click(screen.getByRole('button', { name: 'How it works' }))
  expect(onHowItWorks).toHaveBeenCalled()
})
```

Borrar los tests de `:100-130` sobre la línea «Link a repo» en la vista principal (esa línea se muda al Task 5). En `MemoriesStatusRow.test.tsx` reemplazar `:42` por: no hay botón `/memory vault settings/i`.
- [ ] **Step 2:** `npx vitest run src/__tests__/components/MemoriesWorkspace.test.tsx src/__tests__/components/MemoriesStatusRow.test.tsx` → FAIL.

- [ ] **Step 3: `MemoriesWorkspace`**
  - `const [vista, setVista] = useState(vistaInicial ?? 'memorias')`.
  - Header: el Back de la izquierda hace `vista === 'settings' ? setVista('memorias') : onClose()` y su texto es `vista === 'settings' ? 'Memories' : 'Back'`. Título `.tw-header-title`: `'Memories'` o `'Memory settings'`. A la derecha, sólo en `'memorias'`: `<Button variant="ghost" size="sm" onClick={onHowItWorks} data-tour-id="memories-how">How it works</Button>` y `<Button variant="outline" size="sm" aria-label="Memory settings" onClick={() => setVista('settings')} data-tour-id="memories-settings"><Settings size={ICON_SIZE.sm} aria-hidden />Settings</Button>`.
  - `'settings'`: `<MemorySettingsView activeRepoPath={activeRepoPath} onLinkRepo={onLinkRepo} onHowItWorks={onMemorySettingsTour} />` en lugar del body.
  - `'memorias'`: `MemoriesStatusRow` (`data-tour-id="memories-status"` en su raíz), «New memory» (`data-tour-id="memories-new"`), `MemoryGraphPanel` (envuelto en `<div data-tour-id="memories-graph">`, con `ansi`), `MemoriesList` (`<div data-tour-id="memories-list">`, con `ansi`), y `{activeRepoPath && <TeamThreadPanel …/>}` sin caja cuando devuelve null (envolver sólo si renderiza: mover el borde adentro de `TeamThreadPanel`).
  - Borrar los imports y el JSX de las 5 tarjetas y de la línea «Link a repo».
- [ ] **Step 4: `MemoriesStatusRow`** — borrar el `Popover` y sus imports; `MemoryVaultCard` ya vive en «Notes on disk».
- [ ] **Step 5: App** — `const [memoriesVista, setMemoriesVista] = useState<'memorias' | 'settings'>('memorias')`; `const abrirMemories = (vista: 'memorias' | 'settings' = 'memorias') => { setMemoriesVista(vista); setMemoriesOpen(true) }`; usarla en `:1876` y `:2117`; en el mount pasar `key={memoriesVista}`, `vistaInicial={memoriesVista}`, `ansi={temaPorId(userPrefs.prefs.ui_settings.terminalTheme, userPrefs.prefs.ui_settings.terminalThemesImportados ?? []).ansi}`, `onHowItWorks={() => setMemoriesWelcome(true)}` y `onMemorySettingsTour={() => setTutorialTour('memory-settings')}` (los dos estados del Task 7; hasta entonces `onHowItWorks={() => {}}`). `Sidebar.tsx:938`: `onOpenMemories={(v) => onMemoriesOpen(v)}` y tipar `onMemoriesOpen?: (vista?: 'memorias' | 'settings') => void` en las props de Sidebar.
- [ ] **Step 6:** tests del Step 2 + `npx vitest run src/__tests__/components` → PASS. Typecheck web: `npx tsc -p tsconfig.web.json --noEmit --composite false` → 0 errores.
- [ ] **Step 7: Commit** `feat(memories): la vista principal sólo muestra memoria; la configuración vive en Memory settings`

---

### Task 7: Bienvenida, tour de Memories y «How Memories works»

**Files:**
- Create: `src/components/MemoriesWelcome.tsx`
- Create: `src/tutorial/tours/memories.ts`, `src/tutorial/tours/memory-settings.ts`
- Modify: `src/tutorial/types.ts:5` (`TourId`), `src/tutorial/registry.ts`
- Modify: `electron/settings-store.ts:23-31,53`, `src/types.ts:1494`, `src/lib/keybindings.ts:20,25`, `src/hooks/useSettings.ts:13,43-49`
- Modify: `src/App.tsx:274-279,2276-2279`
- Test: `src/__tests__/components/MemoriesWelcome.test.tsx`, `src/__tests__/tutorial/section-tours.test.ts:42`, `src/__tests__/hooks/useSettings.test.tsx`, `electron/__tests__/settings-store.test.ts`

**Interfaces:**
- Consumes: anclas `data-tour-id` de Task 5 (`memory-settings-sync|encryption|project|disk`) y Task 6 (`memories-status|graph|list|new|settings`); `EVENTO_SECCION` de Task 5.
- Produces: `TourId` suma `'memories' | 'memory-settings'`; `AppSettings.hasSeenMemoriesWelcome?: boolean`; `useSettings().markMemoriesWelcomeSeen(): void`.
- Produces: `<MemoriesWelcome onTour={() => void} onSkip={() => void} />`.

- [ ] **Step 1: Tests que fallan**
  - `section-tours.test.ts:42`: esperar `['memories', 'memory-settings', 'my-repos', 'teams', 'worktrees']`. (El test de anclas de `:22-38` ya va a exigir que cada `data-tour-id` exista en algún `.tsx`.)
  - `settings-store.test.ts` y `useSettings.test.tsx`: copiar los casos de `hasSeenMemoryHub` para `hasSeenMemoriesWelcome` / `markMemoriesWelcomeSeen` (default `false`, persiste `true`).
  - `MemoriesWelcome.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
import MemoriesWelcome from '../../components/MemoriesWelcome'

it('muestra la escena y los cuatro usos, y ofrece tour o saltar', () => {
  const onTour = vi.fn(); const onSkip = vi.fn()
  render(<MemoriesWelcome onTour={onTour} onSkip={onSkip} />)
  expect(screen.getByRole('dialog', { name: 'Your agents stop starting from zero' })).toBeInTheDocument()
  for (const uso of ['Just for you', 'On all your machines', 'With your team', 'Outside Nest']) {
    expect(screen.getByText(uso)).toBeInTheDocument()
  }
  fireEvent.click(screen.getByRole('button', { name: /Show me around/ }))
  expect(onTour).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /Skip/ }))
  expect(onSkip).toHaveBeenCalled()
})
```

- [ ] **Step 2:** `npx vitest run src/__tests__/tutorial src/__tests__/components/MemoriesWelcome.test.tsx src/__tests__/hooks/useSettings.test.tsx electron/__tests__/settings-store.test.ts` → FAIL.

- [ ] **Step 3: Tours**

```ts
// src/tutorial/tours/memories.ts
import type { TourDef } from '../types'
const en = (en: string) => ({ en, es: en })
export const memoriesTour: TourDef = {
  id: 'memories',
  steps: [
    { id: 'status', anchor: '[data-tour-id="memories-status"]', title: en('Is it in step?'), body: en('Pending, synced or blocked — this line tells you if what agents wrote here already reached your other machines.') },
    { id: 'graph', anchor: '[data-tour-id="memories-graph"]', title: en('This is everything your agents remember'), body: en('Each dot is one memory, coloured by kind. Lines join memories that belong together — agents link them as they work, or you drag one onto another. Click a dot to read it.') },
    { id: 'list', anchor: '[data-tour-id="memories-list"]', title: en('Search it like you would ask'), body: en('Type any words, in any order. Matches light up in the graph too.'), placement: 'top' },
    { id: 'new', anchor: '[data-tour-id="memories-new"]', title: en('Write one yourself'), body: en('Agents write most of them. When you want something on record — a decision, a gotcha — add it here.') },
    { id: 'settings', anchor: '[data-tour-id="memories-settings"]', title: en('Everything else lives here'), body: en('Sync between machines, encryption, sharing with your team. "How Memories works" in there walks you through it.'), placement: 'left' },
  ],
}
```

```ts
// src/tutorial/tours/memory-settings.ts
import type { TourDef } from '../types'
const en = (en: string) => ({ en, es: en })
export const memorySettingsTour: TourDef = {
  id: 'memory-settings',
  steps: [
    { id: 'sync', anchor: '[data-tour-id="memory-settings-sync"]', placement: 'right', title: en('Sync: the same memory everywhere'), body: en('Turn on cloud sync and what an agent learns here is there when you open Nest on another machine. A server or SSH box with no browser connects with a code.') },
    { id: 'encryption', anchor: '[data-tour-id="memory-settings-encryption"]', placement: 'right', title: en("Encryption: the server can't read it"), body: en('Once sync is on, turn this on too. Your memory is locked here before it travels and only your machines hold the key. Save the recovery code it gives you.') },
    { id: 'project', anchor: '[data-tour-id="memory-settings-project"]', placement: 'right', title: en('Your team'), body: en("Share a project and your teammates' agents start with what yours learned. Branch notes put a summary per branch inside the repo.") },
    { id: 'disk', anchor: '[data-tour-id="memory-settings-disk"]', placement: 'right', title: en('Notes on disk'), body: en('Your memories as Markdown files, if you want to read them in Obsidian or any editor.') },
  ],
}
```

Registrar los dos en `registry.ts` y sumar los ids a `TourId`.
- [ ] **Step 4: Persistencia** — `hasSeenMemoriesWelcome` igual que `hasSeenMemoryHub` en los cinco lugares listados en *Files* (interface, default `false`, `load`, tipo del renderer, copia explícita en `useSettings.ts:13`, y `markMemoriesWelcomeSeen` copiando `markMemoryHubSeen`).
- [ ] **Step 5: `MemoriesWelcome`** — `Dialog` de shadcn (`src/components/ui/dialog.tsx`) abierto, `DialogTitle` «Your agents stop starting from zero». Contenido:
  1. Escena en monoespaciada, dos bloques tipo terminal (`rounded-md border border-border bg-background p-3 font-mono text-fs-sm`):
     `claude · monday` → `● memory_save  decision: "search matches loose terms, not the exact phrase"`
     `codex · tuesday` → `● memory_context  1 memory about search — reading it before starting`
  2. Lista `<ul>` de 4 líneas: «**Just for you** — works the moment you open a terminal; nothing leaves this machine.» / «**On all your machines** — pick up on the laptop what you started on the desktop.» / «**With your team** — share a project and everyone's agents start with what the others decided.» / «**Outside Nest** — any editor or terminal, with `npx nest-memory`.»
  3. Botones: `Show me around · 5 steps` (default) y `Skip — I'll look on my own` (ghost).
- [ ] **Step 6: App** — `const { settings, markMemoryHubSeen, markMemoriesWelcomeSeen } = useSettings()`; `const [memoriesWelcome, setMemoriesWelcome] = useState(false)`; mostrar la bienvenida si `memoriesOpen && memoriesVista === 'memorias' && (memoriesWelcome || (!settings.hasSeenMemoriesWelcome && !window.appFlags?.e2eBypass))`. `onTour`: `markMemoriesWelcomeSeen(); setMemoriesWelcome(false); setTutorialTour('memories')`. `onSkip`: `markMemoriesWelcomeSeen(); setMemoriesWelcome(false)`. En el `<OnboardingTour>` de `:2276-2279` agregar `onStepChange={(id) => { if (tutorialTour === 'memory-settings') window.dispatchEvent(new CustomEvent(EVENTO_SECCION, { detail: id })) }}`. Cablear `onHowItWorks={() => setMemoriesWelcome(true)}` en el mount del Task 6.
- [ ] **Step 7:** tests del Step 2 → PASS; typecheck de los dos `tsc` → 0.
- [ ] **Step 8: Commit** `feat(memories): bienvenida, tour de Memories y «How Memories works»`

---

### Task 8: e2e, contraste, CLAUDE.md y verificación final

**Files:**
- Modify: `e2e/03-memories-in-app.spec.ts:207-214,240-274`
- Modify: `e2e/12-cifrado-dos-maquinas.spec.ts:59-70,89-137`
- Modify: `CLAUDE.md` (sección «UI — Tailwind y shadcn», bullet de la allow-list)

- [ ] **Step 1: e2e 03** — `:207-214`: el botón de Account ahora es `'Memory settings'` y debe abrir `.memories-workspace` con el título `Memory settings`. `:240-274`: tras abrir Memories, click en `getByRole('button', { name: 'Memory settings' })`, después en el rail `getByRole('button', { name: /This project & team/ })`; `getByText(/Share this project's memory with a team/)`; el switch `getByRole('switch', { name: /Branch notes in the repo/ })` → click → `aria-checked="true"`; volver con `getByRole('button', { name: 'Memories' })` y esperar `.team-thread-panel` y `/No branch notes yet/`.
- [ ] **Step 2: e2e 12** — helper nuevo `abrirEncryption(page)`: `abrirMemories(page)` + click `{ name: 'Memory settings' }` + click rail `{ name: /Encryption/ }`. Usarlo donde hoy se llama `abrirMemories` antes de `'Turn on encryption'` y de `'Encryption on'`. `cerrarMemories`: primero el Back de settings (`{ name: 'Memories' }`) y después `{ name: /Back/ }`.
- [ ] **Step 3: CLAUDE.md** — al bullet «Un literal de color cromático no se prohíbe siempre, se decide» sumar: «… o el color por tipo de memoria en Memories, que sale del índice ANSI del tema de terminal del usuario (`memory-type-legend.ts`), no de un literal».
- [ ] **Step 4: Verificación**
  - `npx tsc -p tsconfig.node.json --noEmit --composite false` y `npx tsc -p tsconfig.web.json --noEmit --composite false` → 0 errores.
  - `npm test` → verde (comparar fallas con el baseline del handoff: 5 tests de componentes que fallan sólo en suite completa y pasan aislados).
  - `npm run native:electron` y verificar sha256 `359cbd480d7c…`.
  - `npx playwright test e2e/03-memories-in-app.spec.ts e2e/04-contraste.spec.ts e2e/08-memory-graph.spec.ts e2e/12-cifrado-dos-maquinas.spec.ts e2e/16-cifrado-de-equipo.spec.ts` → verde.
- [ ] **Step 5: Commit** `test(e2e): Memories y cifrado entran por Memory settings`
