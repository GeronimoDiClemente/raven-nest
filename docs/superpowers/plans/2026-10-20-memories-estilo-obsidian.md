# Memories estilo Obsidian — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la vista principal de Memories (grafo 3D en caja + lista) por un layout de tres zonas estilo Obsidian: explorer por carpetas, pestañas con un grafo 2D global y notas en live preview (CodeMirror 6), y un panel derecho con grafo local, links, propiedades y outline.

**Architecture:** Componentes de presentación nuevos en `src/components/memories/`, sin acceso a `window.memory` ni a Electron (todo por props/callbacks). `MemoriesWorkspace` y un adaptador `MemoriesNoteTab` (fuera de esa carpeta) son los únicos que hablan con `window.memory`. Lógica pura en `src/lib/` (árbol, pestañas, subgrafo, live preview, outline), testeada por separado. Main sólo cambia en un punto: los nodos del grafo suman `aliases` para el autocompletado de `[[`.

**Tech Stack:** React 18, TypeScript 5.7, Tailwind v4 sin preflight + shadcn, `react-force-graph-2d`, CodeMirror 6, `react-resizable-panels` (ya instalado), Radix (`radix-ui`, ya instalado), Vitest 4 + Testing Library (jsdom), Playwright (e2e contra `dist/`).

**Spec:** `docs/superpowers/specs/2026-10-20-memories-estilo-obsidian-design.md` (mockup: https://claude.ai/artifact/LyWpMQ3MijSatbsFhuDPwX)

## Global Constraints

- Copy de la UI **en inglés**. Ningún literal de string de 4–200 caracteres en `src/**` (fuera de `__tests__` y `src/tutorial/`) puede tener `áéíóúñ¿¡` (`src/__tests__/la-app-es-en-ingles.test.ts`). Los comentarios pueden ir en español.
- **Componentes nuevos con shadcn + utilidades Tailwind**, nunca clases nuevas en `global.css`. Colores sólo por tokens (`text-muted-foreground`, `border-border`, `bg-accent`…); los colores por tipo salen de `memoryTypeSwatch(type, ansi)` / `toGraphData(..., { ansi })`. El canvas lee tokens con `getComputedStyle`.
- Tailwind **sin preflight**: no importar `"tailwindcss"` entero.
- Nada en `src/components/memories/` importa `window.memory`, `electron` ni hooks que lo hagan.
- Todo widget del editor es DOM armado por nosotros; **nunca** `innerHTML` / `dangerouslySetInnerHTML` con contenido de una memoria.
- Guardado: debounce **1500 ms**; usa `window.memory.updateFromUi` sin cambios.
- Ventana angosta: **< 1100 px** ⇒ panel derecho arranca colapsado.
- Carpeta de memorias sin repo: se llama **«Global»** (decisión de Gero del 2026-10-09, `src/lib/nombre-de-proyecto.ts`). El spec dice «Personal»; manda la decisión vieja, y se le avisa a Gero.
- `localStorage` siempre dentro de try/catch; si falla, valores por defecto.
- Dependencias nuevas con versión **exacta** (`--save-exact`): `react-force-graph-2d@1.29.2`, `@codemirror/state@6.7.6`, `@codemirror/view@6.43.13`, `@codemirror/language@6.12.4`, `@codemirror/lang-markdown@6.5.2`, `@codemirror/autocomplete@6.20.3`, `@lezer/markdown@1.7.2`.
- **No se sacan** `Graph3D.tsx`, `Graph3DLazy.tsx`, `three` ni `react-force-graph-3d` (los usa `TeamThreadGraph`).
- Typecheck real (los dos de CI): `npx tsc -p tsconfig.node.json --noEmit --composite false` y `npx tsc -p tsconfig.web.json --noEmit --composite false`. Baseline: 0 errores. **No usar `tsc -b`.**
- Tests unitarios: `npx vitest run <archivo>`; `npm test` corre `native:node` antes. **Antes de lanzar la app o el e2e: `npm run native:electron`.**
- e2e corre contra `dist/`: `npm run build` antes (`npm run e2e` ya lo hace con `pre-e2e`).
- Commits locales en `feat/memories-settings`, sin push. Mensaje con `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. `git add` sólo los archivos de la tarea (el árbol tiene cambios ajenos sin commitear: capturas, `.superpowers/sdd/.gitignore`, `package-lock.json` previo — no tocarlos salvo que la tarea instale deps).

## Review Focus

1. **Ctrl/Cmd+W dentro del overlay** puede disparar el acelerador del menú de Electron (cerrar ventana) o un handler global de la app antes que el nuestro: la persona espera que cierre la pestaña, nunca la ventana. Task 10 lo testea en el handler y Task 11 lo verifica en la app real; si el menú lo intercepta, se saca el atajo y se avisa.
2. **Cerrar la pestaña o el overlay con cambios sin guardar** (dentro de los 1,5 s): la persona espera que se guarde igual. Test en Task 7 (`flush` al desmontar).
3. **Un agente actualiza la memoria abierta mientras escribís**: espera no perder lo escrito. Test en Task 7 (cambio externo con cambios locales ⇒ banda, sin pisar el texto).
4. **Más de 1500 memorias** (el `limit` del grafo): el explorer se arma del grafo; la persona espera saber que faltan. Test en Task 9 (aviso «N more not shown»).
5. **Contenido malicioso** (`<img onerror>`, `<script>`, `javascript:` en un `[[...]]`): no puede producir elementos ni navegar. Test en Task 6.

---

## Mapa de archivos

**Nuevos**
- `src/lib/memories-tree.ts` — árbol de carpetas desde los nodos del grafo.
- `src/lib/memory-tabs.ts` — reducer puro de pestañas + caché de sesión.
- `src/lib/memory-graph-2d.ts` — subgrafo local, estilo de aristas, opacidades de hover/resaltado.
- `src/lib/memory-outline.ts` — encabezados de un Markdown (fuera de bloques de código).
- `src/lib/cm-live-preview.ts` — extensión CodeMirror: decoraciones de live preview, wikilinks, click.
- `src/lib/cm-wikilink-autocomplete.ts` — fuente de autocompletado para `[[`.
- `src/lib/almacen-seguro.ts` — `localStorage` envuelto en try/catch (incluye adaptador para `react-resizable-panels`).
- `src/hooks/useMemoryTabs.ts`, `src/hooks/useAutosave.ts`, `src/hooks/useGraphFilters.ts`.
- `src/components/ui/dropdown-menu.tsx` — shadcn sobre `radix-ui`.
- `src/components/memories/MemoriesExplorer.tsx`, `MemoryTabs.tsx`, `MemoryGraph2D.tsx`, `GraphFiltersPanel.tsx`, `MemoryNoteEditor.tsx`, `MemoryNoteSidePanel.tsx`.
- `src/components/MemoriesNoteTab.tsx` — adaptador: detalle + guardado + borrado de una pestaña (habla con `window.memory`).

**Modificados**
- `electron/memory-graph.ts:457-471` y `src/types.ts:313` — `aliases` en `MemoryGraphNode`.
- `src/hooks/useMemoryDetail.ts` — parámetro `nonce` para recargar.
- `src/components/MemoriesWorkspace.tsx` — reescritura del cuerpo de la vista «memorias».
- `src/tutorial/tours/memories.ts` — anclas y copy.
- `e2e/08-memory-graph.spec.ts`, `e2e/03-memories-in-app.spec.ts`, `e2e/11-paquete-con-nest-abierto.spec.ts`.

**Borrados** (con sus tests, reemplazados): `MemoryGraphPanel.tsx`, `MemoriesList.tsx`, `MemoryGraph3D.tsx`, `MemoryMarkdown.tsx`; tests `MemoriesList.test.tsx`, `MemoryGraphPanel-chips-tipo.test.tsx`, `MemoryGraphPanel-sin-vinculos.test.tsx`, `MemoryDocumentoAcciones.test.tsx`, `MemoryDocumentoLinks.test.tsx`, `MemoryMarkdown.test.tsx`.

---

### Task 1: `aliases` en los nodos del grafo

**Files:**
- Modify: `electron/memory-graph.ts:457-471`
- Modify: `src/types.ts:313` (interface `MemoryGraphNode`)
- Test: `electron/__tests__/memory-graph.test.ts`

**Interfaces:**
- Produces: `MemoryGraphNode.aliases?: string[]` — alias del frontmatter YAML (`parsearAlias`), `[]` si no hay. Los nodos pendientes (huecos) no lo llevan.

- [ ] **Step 1: Test que falla.** Al final de `electron/memory-graph.test.ts`:

```ts
describe('aliases en los nodos', () => {
  it('cada nodo trae los alias de su frontmatter, para el autocompletado de [[', () => {
    insert({ syncId: 'a', title: 'El candado', content: '---\naliases: [candado, lock]\n---\ncuerpo', updatedAt: 1 })
    insert({ syncId: 'b', title: 'Sin alias', content: 'nada', updatedAt: 2 })
    const g = buildMemoryGraph(db, Q())
    expect(g.nodes.find((n) => n.syncId === 'a')?.aliases).toEqual(['candado', 'lock'])
    expect(g.nodes.find((n) => n.syncId === 'b')?.aliases).toEqual([])
  })
})
```

- [ ] **Step 2:** `npx vitest run electron/__tests__/memory-graph.test.ts -t "aliases"` → FAIL (`aliases` undefined).
- [ ] **Step 3:** En `src/types.ts`, dentro de `MemoryGraphNode`, después de `topicKey`:

```ts
  /** Alias del frontmatter (`aliases:`), para el autocompletado de `[[` en la app. Ausente en
   *  los huecos y en mains viejos. */
  aliases?: string[]
```

En `electron/memory-graph.ts`, en el `selected.map` de la línea 457, después de `topicKey: r.topic_key,`:

```ts
    aliases: parsearAlias(r.content_head ?? ''),
```

(`parsearAlias` ya está importado desde `./wikilinks` en ese archivo, línea 31; verificar.)
- [ ] **Step 4:** `npx vitest run electron/__tests__/memory-graph.test.ts` → PASS completo. Los dos `tsc` de CI → 0.
- [ ] **Step 5:** Commit: `git add electron/memory-graph.ts src/types.ts electron/__tests__/memory-graph.test.ts && git commit -m "feat(memories): los nodos del grafo traen sus alias"`.

---

### Task 2: El árbol de carpetas (`memories-tree`)

**Files:**
- Create: `src/lib/memories-tree.ts`
- Test: `src/__tests__/lib/memories-tree.test.ts`

**Interfaces:**
- Consumes: `MemoryGraphNode` (`src/types.ts`), `nombreDeProyecto` (`src/lib/nombre-de-proyecto.ts`).
- Produces:

```ts
export interface CarpetaDeMemorias { id: string; nombre: string; items: MemoryGraphNode[] }
export function armarArbol(nodes: MemoryGraphNode[], coincidencias: ReadonlySet<string> | null): CarpetaDeMemorias[]
```
  `id`: `'global'` | `'team'` | `` `project:${projectKey}` ``. Orden: Global, proyectos por nombre (`localeCompare`, sensibilidad `base`), Team. Excluye `pending` y `superseded`. Items por `updatedAt` desc. Con `coincidencias` no nulo, sólo esos ids y sin carpetas vacías; sin búsqueda, las carpetas vacías tampoco se muestran.

- [ ] **Step 1: Test que falla:**

```ts
import { describe, it, expect } from 'vitest'
import { armarArbol } from '../../lib/memories-tree'
import type { MemoryGraphNode } from '../../types'

const n = (o: Partial<MemoryGraphNode> & { syncId: string }): MemoryGraphNode => ({
  projectKey: 'p1', projectDisplayName: 'raven-nest', tags: [], title: o.syncId, type: 'decision',
  scope: 'personal', topicKey: null, gitBranch: null, originAi: null, authorDisplay: null,
  updatedAt: 1, superseded: false, ...o,
})

describe('armarArbol', () => {
  it('Global primero, proyectos por nombre, Team al final', () => {
    const arbol = armarArbol([
      n({ syncId: 'a', projectKey: 'p2', projectDisplayName: 'zeta' }),
      n({ syncId: 'b', projectKey: '__global__', projectDisplayName: '__global__' }),
      n({ syncId: 'c', scope: 'team' }),
      n({ syncId: 'd', projectKey: 'p1', projectDisplayName: 'alfa' }),
    ], null)
    expect(arbol.map((c) => c.nombre)).toEqual(['Global', 'alfa', 'zeta', 'Team'])
    expect(arbol.map((c) => c.id)).toEqual(['global', 'project:p1', 'project:p2', 'team'])
  })
  it('saca huecos y reemplazadas, y ordena por fecha descendente', () => {
    const [c] = armarArbol([
      n({ syncId: 'viejo', updatedAt: 1 }), n({ syncId: 'nuevo', updatedAt: 5 }),
      n({ syncId: 'hueco', pending: true }), n({ syncId: 'reemplazada', superseded: true }),
    ], null)
    expect(c.items.map((i) => i.syncId)).toEqual(['nuevo', 'viejo'])
  })
  it('con busqueda deja solo las coincidencias y saca carpetas vacias', () => {
    const arbol = armarArbol([n({ syncId: 'a' }), n({ syncId: 'b', scope: 'team' })], new Set(['a']))
    expect(arbol).toHaveLength(1)
    expect(arbol[0].items.map((i) => i.syncId)).toEqual(['a'])
  })
})
```

- [ ] **Step 2:** `npx vitest run src/__tests__/lib/memories-tree.test.ts` → FAIL (módulo no existe).
- [ ] **Step 3: Implementación:**

```ts
// El explorer de Memories: las memorias agrupadas como las carpetas de un vault.
//
// Sale de los nodos del grafo y no de `crossProject`: el grafo ya está cargado para la
// pestaña Graph, trae el proyecto, el scope y la fecha de cada memoria, y no pagina. La
// búsqueda (FTS en main) sólo decide QUÉ ids se ven.
import type { MemoryGraphNode } from '../types'
import { nombreDeProyecto } from './nombre-de-proyecto'

export interface CarpetaDeMemorias { id: string; nombre: string; items: MemoryGraphNode[] }

const CLAVE_GLOBAL = '__global__'

function carpetaDe(n: MemoryGraphNode): { id: string; nombre: string } {
  if (n.scope === 'team') return { id: 'team', nombre: 'Team' }
  if (n.projectKey === CLAVE_GLOBAL) return { id: 'global', nombre: 'Global' }
  return { id: `project:${n.projectKey}`, nombre: nombreDeProyecto(n.projectKey, n.projectDisplayName) }
}

function rango(id: string): number {
  if (id === 'global') return 0
  if (id === 'team') return 2
  return 1
}

export function armarArbol(nodes: MemoryGraphNode[], coincidencias: ReadonlySet<string> | null): CarpetaDeMemorias[] {
  const porId = new Map<string, CarpetaDeMemorias>()
  for (const n of nodes) {
    if (n.pending || n.superseded) continue
    if (coincidencias && !coincidencias.has(n.syncId)) continue
    const { id, nombre } = carpetaDe(n)
    let c = porId.get(id)
    if (!c) { c = { id, nombre, items: [] }; porId.set(id, c) }
    c.items.push(n)
  }
  const carpetas = [...porId.values()]
  for (const c of carpetas) c.items.sort((a, b) => b.updatedAt - a.updatedAt)
  return carpetas.sort((a, b) =>
    rango(a.id) - rango(b.id) || a.nombre.localeCompare(b.nombre, undefined, { sensitivity: 'base' }))
}
```

- [ ] **Step 4:** el test → PASS.
- [ ] **Step 5:** Commit `feat(memories): arbol de carpetas para el explorer`.

---

### Task 3: Pestañas (`memory-tabs` + `useMemoryTabs`)

**Files:**
- Create: `src/lib/memory-tabs.ts`, `src/hooks/useMemoryTabs.ts`
- Test: `src/__tests__/lib/memory-tabs.test.ts`

**Interfaces:**
- Produces:

```ts
export type MemoryTab =
  | { kind: 'graph' }
  | { kind: 'thread' }
  | { kind: 'note'; syncId: string }
  | { kind: 'new'; key: string; titulo: string }
export interface TabsState { tabs: MemoryTab[]; activeId: string }
export type TabsAction =
  | { type: 'open'; tab: MemoryTab; background?: boolean }
  | { type: 'close'; id: string }
  | { type: 'activate'; id: string }
  | { type: 'replace'; id: string; tab: MemoryTab }
  | { type: 'setThread'; on: boolean }
export function tabId(t: MemoryTab): string   // 'graph' | 'thread' | `note:${syncId}` | `new:${key}`
export function esFija(t: MemoryTab): boolean // graph y thread
export const ESTADO_INICIAL: TabsState        // { tabs: [{kind:'graph'}], activeId: 'graph' }
export function tabsReducer(s: TabsState, a: TabsAction): TabsState
// hook:
export function useMemoryTabs(conHilo: boolean): TabsState & {
  open: (tab: MemoryTab, opts?: { background?: boolean }) => void
  close: (id: string) => void
  activate: (id: string) => void
  replace: (id: string, tab: MemoryTab) => void
}
```
  El hook recuerda el último estado en una variable de módulo (vive mientras la app está abierta; al reiniciar vuelve a `ESTADO_INICIAL`) y despacha `setThread` cuando cambia `conHilo`.

- [ ] **Step 1: Test que falla:**

```ts
import { describe, it, expect } from 'vitest'
import { tabsReducer, ESTADO_INICIAL, tabId } from '../../lib/memory-tabs'

const nota = (syncId: string) => ({ kind: 'note' as const, syncId })

describe('tabsReducer', () => {
  it('abrir agrega y activa; abrir una ya abierta solo la enfoca', () => {
    let s = tabsReducer(ESTADO_INICIAL, { type: 'open', tab: nota('a') })
    s = tabsReducer(s, { type: 'open', tab: nota('b') })
    s = tabsReducer(s, { type: 'open', tab: nota('a') })
    expect(s.tabs.map(tabId)).toEqual(['graph', 'note:a', 'note:b'])
    expect(s.activeId).toBe('note:a')
  })
  it('abrir en segundo plano no cambia la activa', () => {
    const s = tabsReducer(ESTADO_INICIAL, { type: 'open', tab: nota('a'), background: true })
    expect(s.activeId).toBe('graph')
    expect(s.tabs.map(tabId)).toEqual(['graph', 'note:a'])
  })
  it('cerrar la activa activa la de la izquierda', () => {
    let s = tabsReducer(ESTADO_INICIAL, { type: 'open', tab: nota('a') })
    s = tabsReducer(s, { type: 'open', tab: nota('b') })
    s = tabsReducer(s, { type: 'close', id: 'note:b' })
    expect(s.activeId).toBe('note:a')
  })
  it('Graph y Team thread no se cierran', () => {
    let s = tabsReducer(ESTADO_INICIAL, { type: 'setThread', on: true })
    s = tabsReducer(s, { type: 'close', id: 'graph' })
    s = tabsReducer(s, { type: 'close', id: 'thread' })
    expect(s.tabs.map(tabId)).toEqual(['graph', 'thread'])
  })
  it('setThread inserta el hilo despues de Graph y lo saca al apagarse', () => {
    let s = tabsReducer(ESTADO_INICIAL, { type: 'open', tab: nota('a') })
    s = tabsReducer(s, { type: 'setThread', on: true })
    expect(s.tabs.map(tabId)).toEqual(['graph', 'thread', 'note:a'])
    s = tabsReducer(s, { type: 'activate', id: 'thread' })
    s = tabsReducer(s, { type: 'setThread', on: false })
    expect(s.tabs.map(tabId)).toEqual(['graph', 'note:a'])
    expect(s.activeId).toBe('graph')
  })
  it('replace cambia la pestaña de New memory por la memoria guardada, en el mismo lugar', () => {
    let s = tabsReducer(ESTADO_INICIAL, { type: 'open', tab: { kind: 'new', key: 'k1', titulo: '' } })
    s = tabsReducer(s, { type: 'replace', id: 'new:k1', tab: nota('z') })
    expect(s.tabs.map(tabId)).toEqual(['graph', 'note:z'])
    expect(s.activeId).toBe('note:z')
  })
})
```

- [ ] **Step 2:** `npx vitest run src/__tests__/lib/memory-tabs.test.ts` → FAIL.
- [ ] **Step 3: Implementación** `src/lib/memory-tabs.ts`:

```ts
// Las pestañas del centro de Memories. Graph es la primera y fija; Team thread, fija, aparece
// sólo si el repo activo tiene el hilo prendido. Puro: el hook sólo lo envuelve.
export type MemoryTab =
  | { kind: 'graph' }
  | { kind: 'thread' }
  | { kind: 'note'; syncId: string }
  | { kind: 'new'; key: string; titulo: string }

export interface TabsState { tabs: MemoryTab[]; activeId: string }

export type TabsAction =
  | { type: 'open'; tab: MemoryTab; background?: boolean }
  | { type: 'close'; id: string }
  | { type: 'activate'; id: string }
  | { type: 'replace'; id: string; tab: MemoryTab }
  | { type: 'setThread'; on: boolean }

export function tabId(t: MemoryTab): string {
  switch (t.kind) {
    case 'graph': return 'graph'
    case 'thread': return 'thread'
    case 'note': return `note:${t.syncId}`
    case 'new': return `new:${t.key}`
  }
}

export function esFija(t: MemoryTab): boolean { return t.kind === 'graph' || t.kind === 'thread' }

export const ESTADO_INICIAL: TabsState = { tabs: [{ kind: 'graph' }], activeId: 'graph' }

export function tabsReducer(s: TabsState, a: TabsAction): TabsState {
  switch (a.type) {
    case 'open': {
      const id = tabId(a.tab)
      const ya = s.tabs.some((t) => tabId(t) === id)
      const tabs = ya ? s.tabs : [...s.tabs, a.tab]
      return { tabs, activeId: a.background ? s.activeId : id }
    }
    case 'close': {
      const i = s.tabs.findIndex((t) => tabId(t) === a.id)
      if (i === -1 || esFija(s.tabs[i])) return s
      const tabs = s.tabs.filter((_, j) => j !== i)
      const activeId = s.activeId === a.id ? tabId(tabs[Math.max(0, i - 1)]) : s.activeId
      return { tabs, activeId }
    }
    case 'activate':
      return s.tabs.some((t) => tabId(t) === a.id) ? { ...s, activeId: a.id } : s
    case 'replace': {
      const i = s.tabs.findIndex((t) => tabId(t) === a.id)
      if (i === -1) return s
      const nuevoId = tabId(a.tab)
      const tabs = s.tabs.filter((t, j) => j === i || tabId(t) !== nuevoId).map((t) => (tabId(t) === a.id ? a.tab : t))
      return { tabs, activeId: s.activeId === a.id ? nuevoId : s.activeId }
    }
    case 'setThread': {
      const tiene = s.tabs.some((t) => t.kind === 'thread')
      if (a.on === tiene) return s
      if (a.on) return { ...s, tabs: [s.tabs[0], { kind: 'thread' }, ...s.tabs.slice(1)] }
      return { tabs: s.tabs.filter((t) => t.kind !== 'thread'), activeId: s.activeId === 'thread' ? 'graph' : s.activeId }
    }
  }
}
```

`src/hooks/useMemoryTabs.ts`:

```ts
import { useCallback, useEffect, useReducer } from 'react'
import { ESTADO_INICIAL, tabsReducer, type MemoryTab, type TabsState } from '../lib/memory-tabs'

// Vive mientras la app está abierta: cerrar y reabrir el overlay vuelve a las mismas
// pestañas; reiniciar la app vuelve a sólo Graph (spec §3).
let ultimo: TabsState = ESTADO_INICIAL

export function useMemoryTabs(conHilo: boolean) {
  const [state, dispatch] = useReducer(tabsReducer, ultimo)
  useEffect(() => { ultimo = state }, [state])
  useEffect(() => { dispatch({ type: 'setThread', on: conHilo }) }, [conHilo])
  return {
    ...state,
    open: useCallback((tab: MemoryTab, opts?: { background?: boolean }) => dispatch({ type: 'open', tab, background: opts?.background }), []),
    close: useCallback((id: string) => dispatch({ type: 'close', id }), []),
    activate: useCallback((id: string) => dispatch({ type: 'activate', id }), []),
    replace: useCallback((id: string, tab: MemoryTab) => dispatch({ type: 'replace', id, tab }), []),
  }
}

/** Sólo para tests: vuelve la caché de sesión al inicio. */
export function __reiniciarPestanas(): void { ultimo = ESTADO_INICIAL }
```

- [ ] **Step 4:** el test → PASS. Los dos `tsc` → 0.
- [ ] **Step 5:** Commit `feat(memories): reducer y hook de pestanas`.

---

### Task 4: El grafo 2D (`memory-graph-2d` + `MemoryGraph2D`)

**Files:**
- Modify: `package.json`, `package-lock.json` (instalar `react-force-graph-2d@1.29.2 --save-exact`)
- Create: `src/lib/memory-graph-2d.ts`, `src/components/memories/MemoryGraph2D.tsx`
- Test: `src/__tests__/lib/memory-graph-2d.test.ts`, `src/__tests__/components/MemoryGraph2D.test.tsx`

**Interfaces:**
- Consumes: `GraphData`, `GraphNodeDatum`, `GraphLinkDatum` (`src/lib/memory-graph-visuals.ts`), `MemoryEdgeKind`.
- Produces:

```ts
// src/lib/memory-graph-2d.ts
export const ARISTAS_AFIRMADAS: ReadonlySet<MemoryEdgeKind>   // manual, wikilink, revision
export function esInferida(kind: MemoryEdgeKind): boolean
export function vecinos(links: GraphLinkDatum[], id: string): Set<string>
export function subgrafoLocal(data: GraphData, foco: string, saltos: 1 | 2): GraphData
export function opacidadDeNodo(id: string, hover: string | null, vecinosDelHover: ReadonlySet<string>, resaltados: ReadonlySet<string> | null): number

// src/components/memories/MemoryGraph2D.tsx (default export)
export interface MemoryGraph2DProps {
  data: GraphData
  /** Nodo resaltado al centro (grafo local) o seleccionado (global). */
  foco?: string | null
  /** Ids que coinciden con la búsqueda; el resto se atenúa. null = sin búsqueda. */
  resaltados?: ReadonlySet<string> | null
  /** 'local' = etiquetas siempre, física lenta, sin zoom. */
  modo: 'global' | 'local'
  escalaDeNodo?: number      // 0.5–2, default 1
  distanciaDeLinks?: number  // 20–120, default 50
  onOpen: (syncId: string, opts: { background: boolean }) => void
}
```
  Los links de `GraphLinkDatum` llegan con `source`/`target` string; `react-force-graph-2d` los muta a objetos: usar siempre `idDe(x)` (`typeof x === 'string' ? x : x.id`).

- [ ] **Step 1:** `npm install --save-exact react-force-graph-2d@1.29.2`.
- [ ] **Step 2: Tests que fallan.** `src/__tests__/lib/memory-graph-2d.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { vecinos, subgrafoLocal, opacidadDeNodo, esInferida } from '../../lib/memory-graph-2d'
import type { GraphData } from '../../lib/memory-graph-visuals'

const nodo = (id: string) => ({ id, label: id, color: '#fff', val: 1, degree: 1, superseded: false, type: 'decision', projectKey: 'p', projectLabel: 'p', tags: [], gitBranch: null, pending: false })
const data: GraphData = {
  nodes: ['a', 'b', 'c', 'd'].map(nodo),
  links: [{ source: 'a', target: 'b', kind: 'wikilink' }, { source: 'b', target: 'c', kind: 'similar' }, { source: 'c', target: 'd', kind: 'manual' }],
  orphansHidden: 0,
}

describe('memory-graph-2d', () => {
  it('vecinos en las dos direcciones', () => {
    expect([...vecinos(data.links, 'b')].sort()).toEqual(['a', 'c'])
  })
  it('subgrafo local a 1 y a 2 saltos', () => {
    expect(subgrafoLocal(data, 'a', 1).nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(subgrafoLocal(data, 'a', 2).nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c'])
    expect(subgrafoLocal(data, 'a', 2).links).toHaveLength(2)
  })
  it('inferidas son las que no afirma nadie', () => {
    expect(esInferida('similar')).toBe(true)
    expect(esInferida('branch')).toBe(true)
    expect(esInferida('wikilink')).toBe(false)
    expect(esInferida('manual')).toBe(false)
    expect(esInferida('revision')).toBe(false)
  })
  it('hover atenua todo menos el nodo y sus vecinos; la busqueda atenua lo que no coincide', () => {
    const v = vecinos(data.links, 'b')
    expect(opacidadDeNodo('a', 'b', v, null)).toBe(1)
    expect(opacidadDeNodo('d', 'b', v, null)).toBeLessThan(0.3)
    expect(opacidadDeNodo('d', null, new Set(), new Set(['a']))).toBeLessThan(0.3)
    expect(opacidadDeNodo('a', null, new Set(), new Set(['a']))).toBe(1)
  })
})
```

`src/__tests__/components/MemoryGraph2D.test.tsx` (mock del canvas: jsdom no dibuja):

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('react-force-graph-2d', () => ({
  default: ({ graphData, onNodeClick }: { graphData: { nodes: Array<{ id: string; label: string }> }; onNodeClick: (n: { id: string }, e: MouseEvent) => void }) => (
    <div data-testid="fg2d">
      {graphData.nodes.map((n) => (
        <button key={n.id} type="button" onClick={(e) => onNodeClick(n, e.nativeEvent)}>{n.label}</button>
      ))}
    </div>
  ),
}))

import MemoryGraph2D from '../../components/memories/MemoryGraph2D'

const nodo = (id: string, pending = false) => ({ id, label: id, color: '#fff', val: 1, degree: 1, superseded: false, type: 'decision', projectKey: 'p', projectLabel: 'p', tags: [], gitBranch: null, pending })

describe('MemoryGraph2D', () => {
  it('click en un nodo abre la memoria; ctrl+click en segundo plano; un hueco no abre', async () => {
    const onOpen = vi.fn()
    render(<MemoryGraph2D modo="global" onOpen={onOpen} data={{ nodes: [nodo('a'), nodo('hueco', true)], links: [], orphansHidden: 0 }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'a' }))
    expect(onOpen).toHaveBeenLastCalledWith('a', { background: false })
    fireEvent.click(screen.getByRole('button', { name: 'a' }), { ctrlKey: true })
    expect(onOpen).toHaveBeenLastCalledWith('a', { background: true })
    fireEvent.click(screen.getByRole('button', { name: 'hueco' }))
    expect(onOpen).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 3:** los dos tests → FAIL.
- [ ] **Step 4: Implementación** `src/lib/memory-graph-2d.ts`:

```ts
// Lo puro del grafo 2D: qué arista es inferida, vecinos, el subgrafo local y el atenuado.
import type { MemoryEdgeKind } from '../types'
import type { GraphData, GraphLinkDatum } from './memory-graph-visuals'

export const ARISTAS_AFIRMADAS: ReadonlySet<MemoryEdgeKind> = new Set<MemoryEdgeKind>(['manual', 'wikilink', 'revision'])

export function esInferida(kind: MemoryEdgeKind): boolean { return !ARISTAS_AFIRMADAS.has(kind) }

/** react-force-graph muta `source`/`target` a objetos después del primer tick. */
export function idDe(x: unknown): string {
  return typeof x === 'string' ? x : String((x as { id: string }).id)
}

export function vecinos(links: GraphLinkDatum[], id: string): Set<string> {
  const out = new Set<string>()
  for (const l of links) {
    const s = idDe(l.source), t = idDe(l.target)
    if (s === id) out.add(t)
    if (t === id) out.add(s)
  }
  return out
}

export function subgrafoLocal(data: GraphData, foco: string, saltos: 1 | 2): GraphData {
  const dentro = new Set([foco])
  let frontera = new Set([foco])
  for (let i = 0; i < saltos; i++) {
    const nueva = new Set<string>()
    for (const id of frontera) for (const v of vecinos(data.links, id)) if (!dentro.has(v)) { dentro.add(v); nueva.add(v) }
    frontera = nueva
  }
  return {
    nodes: data.nodes.filter((n) => dentro.has(n.id)),
    links: data.links.filter((l) => dentro.has(idDe(l.source)) && dentro.has(idDe(l.target))),
    orphansHidden: 0,
  }
}

const ATENUADO = 0.15

export function opacidadDeNodo(id: string, hover: string | null, vecinosDelHover: ReadonlySet<string>, resaltados: ReadonlySet<string> | null): number {
  if (hover) return id === hover || vecinosDelHover.has(id) ? 1 : ATENUADO
  if (resaltados) return resaltados.has(id) ? 1 : ATENUADO
  return 1
}
```

`src/components/memories/MemoryGraph2D.tsx`:

```tsx
// El grafo de Memories en 2D, como el de Obsidian: puntos chicos, líneas finas, etiquetas que
// aparecen con el zoom y hover que deja a pleno sólo al nodo y sus vecinos. El mismo
// componente dibuja el grafo global (pestaña Graph) y el local (panel derecho).
//
// Presentación pura: no conoce `window.memory`.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphData, GraphNodeDatum } from '../../lib/memory-graph-visuals'
import { esInferida, idDe, opacidadDeNodo, vecinos } from '../../lib/memory-graph-2d'

const ForceGraph2D = lazy(() => import('react-force-graph-2d'))

export interface MemoryGraph2DProps {
  data: GraphData
  foco?: string | null
  resaltados?: ReadonlySet<string> | null
  modo: 'global' | 'local'
  escalaDeNodo?: number
  distanciaDeLinks?: number
  onOpen: (syncId: string, opts: { background: boolean }) => void
}

type Nodo = GraphNodeDatum & { x?: number; y?: number; fx?: number; fy?: number }

function token(nombre: string, porDefecto: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()
  return v || porDefecto
}

/** Umbral de zoom a partir del cual el grafo global muestra todas las etiquetas. */
const ZOOM_DE_ETIQUETAS = 1.6

export default function MemoryGraph2D({ data, foco = null, resaltados = null, modo, escalaDeNodo = 1, distanciaDeLinks = 50, onOpen }: MemoryGraph2DProps) {
  const caja = useRef<HTMLDivElement>(null)
  const fg = useRef<{ d3Force: (n: string) => { distance?: (d: number) => void } | undefined } | null>(null)
  const [tam, setTam] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    const el = caja.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setTam({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => { fg.current?.d3Force('link')?.distance?.(distanciaDeLinks) }, [distanciaDeLinks])

  const vecinosDelHover = useMemo(() => (hover ? vecinos(data.links, hover) : new Set<string>()), [hover, data.links])
  const colores = useMemo(() => ({
    texto: token('--muted-foreground', '#a3a3a3'),
    textoFuerte: token('--foreground', '#f0f0f0'),
    linea: token('--border', '#3a3a3a'),
  }), [])

  return (
    <div ref={caja} className="relative h-full w-full" aria-label={modo === 'global' ? 'Memory graph' : 'Local graph'} role="img">
      <Suspense fallback={null}>
        {tam.w > 0 && (
          <ForceGraph2D
            ref={fg as never}
            width={tam.w}
            height={tam.h}
            graphData={data}
            backgroundColor="rgba(0,0,0,0)"
            cooldownTicks={modo === 'local' ? 60 : 200}
            d3VelocityDecay={modo === 'local' ? 0.6 : 0.35}
            enableZoomInteraction={modo === 'global'}
            enablePanInteraction={modo === 'global'}
            nodeRelSize={4 * escalaDeNodo}
            onNodeHover={(n: Nodo | null) => setHover(n ? n.id : null)}
            onNodeClick={(n: Nodo, e: MouseEvent) => {
              if (n.pending) return
              onOpen(n.id, { background: e.ctrlKey || e.metaKey })
            }}
            onNodeDragEnd={(n: Nodo) => { n.fx = n.x; n.fy = n.y }}
            linkColor={() => colores.linea}
            linkWidth={(l: { kind: GraphNodeDatum['type'] }) => (esInferida(l.kind as never) ? 0.6 : 1.2)}
            linkLineDash={(l: { kind: string }) => (esInferida(l.kind as never) ? [2, 3] : null)}
            linkVisibility={(l: { source: unknown; target: unknown }) => {
              if (!hover) return true
              return idDe(l.source) === hover || idDe(l.target) === hover
            }}
            nodeCanvasObject={(n: Nodo, ctx: CanvasRenderingContext2D, escala: number) => {
              const r = (2.5 + Math.sqrt(n.degree + 1) * 1.6) * escalaDeNodo
              ctx.globalAlpha = opacidadDeNodo(n.id, hover, vecinosDelHover, resaltados)
              ctx.beginPath()
              ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI)
              if (n.pending) { ctx.strokeStyle = colores.texto; ctx.lineWidth = 1 / escala; ctx.stroke() }
              else { ctx.fillStyle = n.color; ctx.fill() }
              if (n.id === foco || n.id === hover) {
                ctx.strokeStyle = colores.textoFuerte; ctx.lineWidth = 1.5 / escala; ctx.stroke()
              }
              const conEtiqueta = modo === 'local' || escala >= ZOOM_DE_ETIQUETAS || n.id === hover || n.id === foco
              if (conEtiqueta) {
                const fs = 11 / escala
                ctx.font = `${fs}px Inter, system-ui, sans-serif`
                ctx.textAlign = 'center'
                ctx.textBaseline = 'top'
                ctx.fillStyle = n.id === hover || n.id === foco ? colores.textoFuerte : colores.texto
                ctx.fillText(n.label.length > 40 ? `${n.label.slice(0, 39)}…` : n.label, n.x ?? 0, (n.y ?? 0) + r + 2 / escala)
              }
              ctx.globalAlpha = 1
            }}
            nodePointerAreaPaint={(n: Nodo, color: string, ctx: CanvasRenderingContext2D) => {
              ctx.fillStyle = color
              ctx.beginPath()
              ctx.arc(n.x ?? 0, n.y ?? 0, 8 * escalaDeNodo, 0, 2 * Math.PI)
              ctx.fill()
            }}
          />
        )}
      </Suspense>
    </div>
  )
}
```

Nota para el implementador: en el test el `ResizeObserver` es un stub de `setup-dom.ts` que no dispara; si `tam.w` queda en 0 y el mock no se renderiza, en el test hacer `vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')` no alcanza: agregar al componente una lectura inicial `setTam({ w: el.clientWidth || 1, h: el.clientHeight || 1 })` antes de observar (en jsdom da 0 → 1, suficiente para montar el mock). Ajustar los tipos `as never` sólo donde las props de `react-force-graph-2d` lo exijan; no usar `any`.

- [ ] **Step 5:** los dos tests → PASS. Los dos `tsc` → 0.
- [ ] **Step 6:** Commit (incluye `package.json` y `package-lock.json`): `feat(memories): grafo 2D estilo Obsidian`.

---

### Task 5: Filtros del grafo (`useGraphFilters` + `GraphFiltersPanel`)

**Files:**
- Create: `src/hooks/useGraphFilters.ts`, `src/components/memories/GraphFiltersPanel.tsx`
- Test: `src/__tests__/components/GraphFiltersPanel.test.tsx`

**Interfaces:**
- Consumes: `toGraphData`, `projectGroups`, `tagGroups`, `countEdgeKinds`, `EDGE_STYLES`, `EDGE_KINDS_IN_LEGEND_ORDER`, `ColorBy`, `Foco` (`memory-graph-visuals.ts`); `MEMORY_TYPES_IN_LEGEND_ORDER`, `memoryTypeSwatch` (`memory-type-legend.ts`); `MemoryGraph`.
- Produces:

```ts
export interface GraphFilters {
  colorBy: ColorBy; foco: Foco; hideOrphans: boolean; tiposOcultos: ReadonlySet<string>
  escalaDeNodo: number; distanciaDeLinks: number
}
export function useGraphFilters(graph: MemoryGraph | null, ansi?: readonly string[]): {
  filtros: GraphFilters
  setColorBy: (c: ColorBy) => void; setFoco: (f: Foco) => void; setHideOrphans: (v: boolean) => void
  toggleTipo: (tipo: string) => void; setEscalaDeNodo: (v: number) => void; setDistanciaDeLinks: (v: number) => void
  data: GraphData            // toGraphData(graph, ...) o vacío
  conteoPorTipo: Map<string, number>
}
// GraphFiltersPanel props:
export interface GraphFiltersPanelProps {
  graph: MemoryGraph | null
  ansi?: readonly string[]
  filtros: ReturnType<typeof useGraphFilters>
  includeSimilar: boolean
  onIncludeSimilar: (v: boolean) => void
}
```
  La lógica de «color efectivo» de hoy se conserva (`MemoryGraphPanel.tsx:179-181`): dentro de un foco de proyecto, siempre `'type'`; con ≤1 tipo presente, `'type'` cae a `'project'`. Los `memoryTypeSwatch` se llaman **con `ansi`** (hoy el panel no lo pasaba: era un bug de color).

- [ ] **Step 1: Test que falla:**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import GraphFiltersPanel from '../../components/memories/GraphFiltersPanel'
import { useGraphFilters } from '../../hooks/useGraphFilters'
import type { MemoryGraph } from '../../types'

const g: MemoryGraph = {
  truncated: 0,
  nodes: [
    { syncId: 'a', projectKey: 'p1', projectDisplayName: 'raven-nest', tags: ['auth'], title: 'A', type: 'decision', scope: 'personal', topicKey: null, gitBranch: null, originAi: null, authorDisplay: null, updatedAt: 1, superseded: false },
    { syncId: 'b', projectKey: 'p1', projectDisplayName: 'raven-nest', tags: [], title: 'B', type: 'bugfix', scope: 'personal', topicKey: null, gitBranch: null, originAi: null, authorDisplay: null, updatedAt: 2, superseded: false },
  ],
  edges: [{ from: 'a', to: 'b', kind: 'wikilink', directed: true }],
}

function Harness() {
  const filtros = useGraphFilters(g)
  const [inc, setInc] = useState(true)
  return (<>
    <GraphFiltersPanel graph={g} filtros={filtros} includeSimilar={inc} onIncludeSimilar={setInc} />
    <output data-testid="nodos">{filtros.data.nodes.map((n) => n.id).join(',')}</output>
  </>)
}

describe('GraphFiltersPanel', () => {
  it('ocultar un tipo lo saca del grafo', () => {
    render(<Harness />)
    expect(screen.getByTestId('nodos').textContent).toBe('a,b')
    fireEvent.click(screen.getByRole('button', { name: /^Bugfix/ }))
    expect(screen.getByTestId('nodos').textContent).toBe('a')
  })
  it('el boton de links adivinados alterna includeSimilar', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide guessed links' }))
    expect(screen.getByRole('button', { name: 'Show guessed links' })).toBeInTheDocument()
  })
  it('Color by tiene Type, Project y Tag', () => {
    render(<Harness />)
    for (const n of ['Type', 'Project', 'Tag']) expect(screen.getByRole('button', { name: n, exact: true } as never)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementación.** `useGraphFilters`: estado con `useState` para cada campo (defaults `colorBy: 'type'`, `foco: null`, `hideOrphans: true`, `tiposOcultos: new Set()`, `escalaDeNodo: 1`, `distanciaDeLinks: 50`). `data` con `useMemo`:

```ts
const tiposPresentes = new Set(graph.nodes.filter((n) => !n.pending).map((n) => n.type))
const colorEfectivo: ColorBy = foco?.tipo === 'project' ? 'type' : colorBy === 'type' && tiposPresentes.size <= 1 ? 'project' : colorBy
return toGraphData(graph, { colorBy: colorEfectivo, hideOrphans, foco, ansi, tiposOcultos })
```

Sin grafo, `data = { nodes: [], links: [], orphansHidden: 0 }`. `conteoPorTipo` cuenta `graph.nodes` sin `pending`.

`GraphFiltersPanel` (shadcn `Button` + utilidades; sin literales de color):
- Sección «Color by»: tres `Button` `variant={activo ? 'secondary' : 'ghost'}` `size="sm"` con textos `Type`, `Project`, `Tag`.
- «Types»: un `Button variant="outline" size="sm"` por tipo presente en `MEMORY_TYPES_IN_LEGEND_ORDER` (más los tipos desconocidos al final), con el punto `memoryTypeSwatch(tipo, ansi)?.color`, el `label` y el contador; `aria-pressed={!oculto}`; el accessible name empieza por el label (`Bugfix 1`).
- «Links»: la leyenda con `EDGE_KINDS_IN_LEGEND_ORDER` filtrada a los que tienen conteo > 0 (`countEdgeKinds(data)`), cada uno con su `EDGE_STYLES[kind].label` y una muestra de línea (sólida o punteada según `esInferida`) hecha con `border-t` y `border-dashed`, color `border-muted-foreground`.
- Toggles: `Button` «Hide guessed links» / «Show guessed links» (llama `onIncludeSimilar(!includeSimilar)`) y `Button` `aria-pressed` `${data.orphansHidden} unconnected hidden` / «Showing unconnected».
- Sliders: `<label>Node size<input type="range" min={0.5} max={2} step={0.1} …/></label>` y `Link distance` (20–120, paso 5).
- «Projects» y «Tags»: los de `projectGroups(graph)` / `tagGroups(graph)` como botones que ponen `foco` (`{ tipo: 'project', valor: projectKey }` / `{ tipo: 'tag', valor: tag }`), con «Everything» para volver a `null`.

- [ ] **Step 4:** PASS. `tsc` → 0.
- [ ] **Step 5:** Commit `feat(memories): filtros del grafo en el panel derecho`.

---

### Task 6: Live preview y autocompletado (CodeMirror 6)

**Files:**
- Modify: `package.json`, `package-lock.json` (`npm install --save-exact @codemirror/state@6.7.6 @codemirror/view@6.43.13 @codemirror/language@6.12.4 @codemirror/lang-markdown@6.5.2 @codemirror/autocomplete@6.20.3 @lezer/markdown@1.7.2`)
- Create: `src/lib/cm-live-preview.ts`, `src/lib/cm-wikilink-autocomplete.ts`
- Test: `src/__tests__/lib/cm-live-preview.test.ts`

**Interfaces:**
- Produces:

```ts
// cm-live-preview.ts
export type EstadoDeLink = { syncId: string } | 'pendiente' | 'desconocido'
export type Resolver = (nombre: string) => EstadoDeLink
export interface MarcaLP { from: number; to: number; ocultar: boolean; clase?: string; wikilink?: string }
export const refrescarLivePreview: StateEffectType<null>
export function lineasActivas(state: EditorState): Set<number>                 // números de línea (1-based) con cursor o selección
export function marcasDeLivePreview(state: EditorState, resolver: Resolver): MarcaLP[]
export function livePreview(opts: { resolver: () => Resolver; onWikilink: (nombre: string, background: boolean) => void }): Extension
export function nombreDeWikilink(crudo: string): string                       // '[[a|b#c]]' interno → 'a'
// cm-wikilink-autocomplete.ts
export interface CandidatoDeLink { syncId: string; title: string; topicKey: string | null; aliases?: string[] }
export function autocompletadoDeWikilinks(candidatos: () => CandidatoDeLink[]): Extension
```
  Clases: `cm-lp-h1`…`cm-lp-h6` (línea), `cm-lp-strong`, `cm-lp-em`, `cm-lp-code`, `cm-lp-codeblock` (línea), `cm-lp-quote` (línea), `cm-lp-wikilink`, `cm-lp-wikilink-pendiente`. El tema (`EditorView.theme`) usa sólo `var(--…)`.

  Resolución: sale de `detail.links` (`name → syncId | null`). Un nombre que no está en `links` (escrito y todavía sin guardar) es `'desconocido'`: se ve como link neutro y el click no hace nada; se resuelve solo después del autoguardado y la recarga del detalle. No se porta `resolverWikilink` al renderer.

- [ ] **Step 1:** instalar las dependencias.
- [ ] **Step 2: Test que falla** (EditorState puro, sin vista):

```ts
import { describe, it, expect } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { marcasDeLivePreview, lineasActivas, nombreDeWikilink, type Resolver } from '../../lib/cm-live-preview'

const estado = (doc: string, cursor: number) => {
  const s = EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [markdown()] })
  ensureSyntaxTree(s, s.doc.length, 5000)
  return s
}
const resolver: Resolver = (n) => (n === 'Otra' ? { syncId: 's2' } : n === 'Falta' ? 'pendiente' : 'desconocido')
const ocultas = (s: EditorState) => marcasDeLivePreview(s, resolver).filter((m) => m.ocultar).map((m) => s.sliceDoc(m.from, m.to))

describe('live preview', () => {
  const doc = '## Titulo\n\nTexto **fuerte** y `code` con [[Otra]].\n\nOtra linea con [[Falta]].'
  it('fuera de la linea del cursor oculta las marcas', () => {
    const s = estado(doc, doc.length)          // cursor en la ultima linea
    const o = ocultas(s)
    expect(o).toEqual(expect.arrayContaining(['## ', '**', '`', '[[', ']]']))
  })
  it('en la linea del cursor muestra la sintaxis', () => {
    const s = estado(doc, doc.indexOf('fuerte'))
    expect(ocultas(s)).not.toContain('**')
    expect(ocultas(s)).toContain('## ')
  })
  it('marca los wikilinks con su estado', () => {
    const s = estado(doc, 0)
    const links = marcasDeLivePreview(s, resolver).filter((m) => m.wikilink)
    expect(links.map((m) => [m.wikilink, m.clase])).toEqual([
      ['Otra', 'cm-lp-wikilink'],
      ['Falta', 'cm-lp-wikilink cm-lp-wikilink-pendiente'],
    ])
  })
  it('no ve wikilinks dentro de codigo', () => {
    const s = estado('`[[Otra]]`\n\n```\n[[Otra]]\n```', 0)
    expect(marcasDeLivePreview(s, resolver).filter((m) => m.wikilink)).toEqual([])
  })
  it('contenido hostil queda como texto: ninguna marca trae HTML ni destino', () => {
    const s = estado('<img src=x onerror=alert(1)> [[javascript:alert(1)]] <script>x</script>', 999)
    for (const m of marcasDeLivePreview(s, resolver)) {
      expect(Object.keys(m).sort()).toEqual(expect.arrayContaining(['from', 'ocultar', 'to']))
      expect(JSON.stringify(m)).not.toMatch(/<|href/)
    }
  })
  it('nombre de un wikilink sin alias ni seccion', () => {
    expect(nombreDeWikilink('a|b')).toBe('a')
    expect(nombreDeWikilink('a#seccion')).toBe('a')
    expect(nombreDeWikilink(' a ')).toBe('a')
  })
  it('lineasActivas cubre una seleccion de varias lineas', () => {
    const s = EditorState.create({ doc: 'a\nb\nc', selection: EditorSelection.range(0, 3) })
    expect([...lineasActivas(s)].sort()).toEqual([1, 2])
  })
})
```

Además, para el foco 5 (navegación hostil), en el mismo archivo un test de que `onWikilink` recibe **el nombre** (`'javascript:alert(1)'`) y nunca hay un `href`: el componente decide abrir sólo si `resolver` da `{ syncId }`, así que un nombre que no resuelve no navega a nada (se cubre en Task 7).

- [ ] **Step 3:** FAIL.
- [ ] **Step 4: Implementación** `src/lib/cm-live-preview.ts`:

```ts
// Live preview como el de Obsidian, sobre CodeMirror 6. El documento es SIEMPRE el Markdown
// tal cual: acá sólo se decide cómo se ve. Fuera de la línea del cursor se ocultan las
// marcas (`**`, `#`, `` ` ``, `[[`/`]]`); en la línea del cursor se muestran para editar.
//
// Seguridad: todo es `Decoration.mark/line/replace` con clases y atributos fijos. Ningún
// pedazo del contenido llega al DOM como HTML (misma regla que tenía MemoryMarkdown: una
// memoria la puede escribir cualquier agente o venir de otra máquina del equipo).
import { syntaxTree } from '@codemirror/language'
import { RangeSetBuilder, StateEffect, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

export type EstadoDeLink = { syncId: string } | 'pendiente' | 'desconocido'
export type Resolver = (nombre: string) => EstadoDeLink
export interface MarcaLP { from: number; to: number; ocultar: boolean; clase?: string; wikilink?: string }

export const refrescarLivePreview = StateEffect.define<null>()

const MARCAS_INLINE = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark'])
const CLASE_INLINE: Record<string, string> = { StrongEmphasis: 'cm-lp-strong', Emphasis: 'cm-lp-em', InlineCode: 'cm-lp-code' }
const NODOS_DE_CODIGO = new Set(['InlineCode', 'FencedCode', 'CodeBlock'])

export function nombreDeWikilink(crudo: string): string {
  return crudo.split('|')[0].split('#')[0].trim()
}

export function lineasActivas(state: EditorState): Set<number> {
  const out = new Set<number>()
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number, b = state.doc.lineAt(r.to).number
    for (let i = a; i <= b; i++) out.add(i)
  }
  return out
}

export function marcasDeLivePreview(state: EditorState, resolver: Resolver): MarcaLP[] {
  const activas = lineasActivas(state)
  const enActiva = (pos: number) => activas.has(state.doc.lineAt(pos).number)
  const marcas: MarcaLP[] = []
  const codigo: Array<[number, number]> = []

  syntaxTree(state).iterate({
    enter: (n) => {
      if (NODOS_DE_CODIGO.has(n.name)) codigo.push([n.from, n.to])
      const h = /^ATXHeading(\d)$/.exec(n.name)
      if (h) marcas.push({ from: n.from, to: n.from, ocultar: false, clase: `cm-lp-h${h[1]}` })
      if (n.name === 'FencedCode') marcas.push({ from: n.from, to: n.from, ocultar: false, clase: 'cm-lp-codeblock' })
      if (n.name === 'Blockquote') marcas.push({ from: n.from, to: n.from, ocultar: false, clase: 'cm-lp-quote' })
      if (CLASE_INLINE[n.name]) marcas.push({ from: n.from, to: n.to, ocultar: false, clase: CLASE_INLINE[n.name] })
      if (n.name === 'HeaderMark' && !enActiva(n.from)) {
        // El `#` y el espacio que lo sigue.
        const fin = state.sliceDoc(n.to, n.to + 1) === ' ' ? n.to + 1 : n.to
        marcas.push({ from: n.from, to: fin, ocultar: true })
      }
      if (MARCAS_INLINE.has(n.name) && !enActiva(n.from)) {
        // Las marcas de un bloque de código cercado (```) no se ocultan: sin ellas no se ve
        // dónde empieza y termina el bloque.
        const padre = n.node.parent?.name
        if (padre !== 'FencedCode') marcas.push({ from: n.from, to: n.to, ocultar: true })
      }
    },
  })

  const enCodigo = (pos: number) => codigo.some(([a, b]) => pos >= a && pos < b)
  const texto = state.doc.toString()
  const re = /\[\[([^[\]\n]+?)\]\]/g
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const from = m.index, to = from + m[0].length
    if (enCodigo(from)) continue
    const nombre = nombreDeWikilink(m[1])
    const estado = resolver(nombre)
    const clase = estado === 'pendiente' ? 'cm-lp-wikilink cm-lp-wikilink-pendiente' : 'cm-lp-wikilink'
    marcas.push({ from: from + 2, to: to - 2, ocultar: false, clase, wikilink: nombre })
    if (!enActiva(from)) {
      marcas.push({ from, to: from + 2, ocultar: true })
      marcas.push({ from: to - 2, to, ocultar: true })
    }
  }
  return marcas
}

function decorar(state: EditorState, resolver: Resolver): DecorationSet {
  const marcas = marcasDeLivePreview(state, resolver).sort((a, b) => a.from - b.from || a.to - b.to)
  const b = new RangeSetBuilder<Decoration>()
  for (const m of marcas) {
    if (m.ocultar) b.add(m.from, m.to, Decoration.replace({}))
    else if (m.from === m.to && m.clase) b.add(m.from, m.from, Decoration.line({ class: m.clase }))
    else if (m.clase) b.add(m.from, m.to, Decoration.mark({ class: m.clase, attributes: m.wikilink ? { 'data-wikilink': m.wikilink } : undefined }))
  }
  return b.finish()
}

export function livePreview(opts: { resolver: () => Resolver; onWikilink: (nombre: string, background: boolean) => void }): Extension {
  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = decorar(view.state, opts.resolver()) }
    update(u: ViewUpdate) {
      const forzado = u.transactions.some((t) => t.effects.some((e) => e.is(refrescarLivePreview)))
      if (u.docChanged || u.selectionSet || u.viewportChanged || forzado || syntaxTree(u.state) !== syntaxTree(u.startState)) {
        this.decorations = decorar(u.state, opts.resolver())
      }
    }
  }, { decorations: (v) => v.decorations })

  const click = EditorView.domEventHandlers({
    mousedown(e, view) {
      const el = (e.target as HTMLElement | null)?.closest('[data-wikilink]')
      if (!el) return false
      const pos = view.posAtDOM(el)
      if (lineasActivas(view.state).has(view.state.doc.lineAt(pos).number)) return false // se está editando
      e.preventDefault()
      opts.onWikilink(el.getAttribute('data-wikilink') ?? '', e.ctrlKey || e.metaKey)
      return true
    },
  })

  const tema = EditorView.theme({
    '&': { color: 'var(--foreground)', backgroundColor: 'transparent', fontSize: 'var(--fs-md, 15px)' },
    '.cm-content': { fontFamily: 'inherit', lineHeight: '1.7', caretColor: 'var(--foreground)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-lp-h1': { fontSize: '1.6em', fontWeight: '600' },
    '.cm-lp-h2': { fontSize: '1.3em', fontWeight: '600' },
    '.cm-lp-h3': { fontSize: '1.15em', fontWeight: '600' },
    '.cm-lp-strong': { fontWeight: '600' },
    '.cm-lp-em': { fontStyle: 'italic' },
    '.cm-lp-code': { fontFamily: 'var(--font-mono, monospace)', backgroundColor: 'var(--muted)', borderRadius: '4px', padding: '0 4px' },
    '.cm-lp-codeblock': { fontFamily: 'var(--font-mono, monospace)', backgroundColor: 'var(--muted)' },
    '.cm-lp-quote': { borderLeft: '2px solid var(--border)', paddingLeft: '10px', color: 'var(--muted-foreground)' },
    '.cm-lp-wikilink': { color: 'var(--link, var(--foreground))', textDecoration: 'underline', textUnderlineOffset: '3px', cursor: 'pointer' },
    '.cm-lp-wikilink-pendiente': { color: 'var(--muted-foreground)', textDecorationStyle: 'dashed' },
  })

  return [plugin, click, tema]
}
```

Nota: si `--link` o `--fs-md` no existen en `global.css`, usar el token de link que ya use la app (buscar `--link`/`--primary` en `global.css`) — no inventar tokens. `--muted`, `--border`, `--foreground`, `--muted-foreground` existen.

`src/lib/cm-wikilink-autocomplete.ts`:

```ts
// Al escribir `[[`, sugerir memorias por título, topic y alias. Inserta el TÍTULO, que es lo
// que main resuelve siempre (topic → último tramo → alias → título).
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'

export interface CandidatoDeLink { syncId: string; title: string; topicKey: string | null; aliases?: string[] }

export function autocompletadoDeWikilinks(candidatos: () => CandidatoDeLink[]): Extension {
  const fuente = (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\[\[[^[\]\n]*$/)
    if (!m) return null
    const q = m.text.slice(2).toLowerCase()
    const opciones = candidatos()
      .filter((c) => [c.title, c.topicKey ?? '', ...(c.aliases ?? [])].some((s) => s.toLowerCase().includes(q)))
      .slice(0, 30)
      .map((c) => ({ label: c.title, detail: c.topicKey ?? undefined, apply: `${c.title}]]` }))
    return { from: m.from + 2, options: opciones, validFor: /^[^[\]\n]*$/ }
  }
  return autocompletion({ override: [fuente], icons: false })
}
```

Test extra del autocompletado (mismo archivo de test, describe aparte): con `CompletionContext` de `@codemirror/autocomplete` sobre `EditorState.create({ doc: 'ver [[cand', extensions: [markdown()] })` en la posición final, la fuente devuelve la opción con `apply: 'El candado]]'` cuando un candidato tiene alias `candado`. Para obtener la fuente desde el test, exportar también `export function fuenteDeWikilinks(candidatos: () => CandidatoDeLink[])` y que `autocompletadoDeWikilinks` la use.

- [ ] **Step 5:** PASS. `tsc` → 0.
- [ ] **Step 6:** Commit (con `package.json`/`package-lock.json`): `feat(memories): live preview y autocompletado de wikilinks sobre CodeMirror 6`.

---

### Task 7: Autoguardado y `MemoryNoteEditor`

**Files:**
- Create: `src/hooks/useAutosave.ts`, `src/components/memories/MemoryNoteEditor.tsx`
- Test: `src/__tests__/hooks/useAutosave.test.tsx`, `src/__tests__/components/MemoryNoteEditor.test.tsx`

**Interfaces:**
- Consumes: `livePreview`, `refrescarLivePreview`, `Resolver` (Task 6), `autocompletadoDeWikilinks`, `CandidatoDeLink` (Task 6), `memoryTypeSwatch`, `relativeTime` (`src/lib/memories-status`), `nombreDeProyecto`, `AILogo` (`src/components/AILogos`), `MemoryObservationDetail`.
- Produces:

```ts
// useAutosave
export interface ResultadoDeGuardado { ok: boolean; reason?: string | null; error?: string }
export type EstadoDeGuardado = 'limpio' | 'pendiente' | 'guardando' | 'guardado' | 'error' | 'reemplazada' | 'borrada'
export function useAutosave(opts: {
  valor: { title: string; content: string }
  base: { title: string; content: string }       // lo último que vino del store
  guardar: (v: { title: string; content: string }) => Promise<ResultadoDeGuardado>
  demoraMs?: number                                // 1500
  habilitado: boolean                              // false en solo lectura
}): { estado: EstadoDeGuardado; error: string | null; flush: () => Promise<void>; reintentar: () => void; sucio: boolean }

// MemoryNoteEditor
export interface MemoryNoteEditorHandle { irALinea: (linea: number) => void }
export interface MemoryNoteEditorProps {
  detail: MemoryObservationDetail
  ansi?: readonly string[]
  candidatos: CandidatoDeLink[]
  /** Vino un cambio de afuera (onChanged) para esta memoria: la versión nueva del store. */
  externo: MemoryObservationDetail | null
  onSave: (v: { title: string; content: string }) => Promise<ResultadoDeGuardado>
  onOpen: (syncId: string, opts: { background: boolean }) => void
  onCreate: (titulo: string) => void
  onOpenNewer: () => void
  onConnect: () => void
  onDelete: () => Promise<void>
}
// default export forwardRef<MemoryNoteEditorHandle, MemoryNoteEditorProps>
```
  Reglas de `useAutosave`: sin cambios respecto de `base` ⇒ `'limpio'` y no llama; título vacío (trim) ⇒ no guarda, queda `'pendiente'`; después de `demoraMs` sin cambios llama `guardar`; `reason: 'unchanged'` ⇒ `'guardado'`; `'superseded'` ⇒ `'reemplazada'`; `'deleted'`/`'not_found'` ⇒ `'borrada'`; `ok: false` con otro reason o excepción ⇒ `'error'`. Al desmontar con cambios: `flush()` sin esperar (fire-and-forget). Una vez `'reemplazada'`/`'borrada'` no vuelve a guardar.

- [ ] **Step 1: Tests que fallan.** `useAutosave.test.tsx` (fake timers):

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutosave } from '../../hooks/useAutosave'

const base = { title: 'T', content: 'c' }
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useAutosave', () => {
  it('guarda 1500 ms despues del ultimo cambio, una sola vez', async () => {
    const guardar = vi.fn().mockResolvedValue({ ok: true })
    const { rerender, result } = renderHook((p) => useAutosave(p), { initialProps: { valor: base, base, guardar, habilitado: true } })
    rerender({ valor: { title: 'T', content: 'c1' }, base, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(1000) })
    rerender({ valor: { title: 'T', content: 'c12' }, base, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(1499) })
    expect(guardar).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(guardar).toHaveBeenCalledTimes(1)
    expect(guardar).toHaveBeenCalledWith({ title: 'T', content: 'c12' })
    expect(result.current.estado).toBe('guardado')
  })
  it('titulo vacio no guarda', async () => {
    const guardar = vi.fn()
    const { rerender } = renderHook((p) => useAutosave(p), { initialProps: { valor: base, base, guardar, habilitado: true } })
    rerender({ valor: { title: '  ', content: 'x' }, base, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(guardar).not.toHaveBeenCalled()
  })
  it('superseded deja de guardar', async () => {
    const guardar = vi.fn().mockResolvedValue({ ok: false, reason: 'superseded' })
    const { rerender, result } = renderHook((p) => useAutosave(p), { initialProps: { valor: base, base, guardar, habilitado: true } })
    rerender({ valor: { title: 'T', content: 'x' }, base, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(result.current.estado).toBe('reemplazada')
    rerender({ valor: { title: 'T', content: 'xy' }, base, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(guardar).toHaveBeenCalledTimes(1)
  })
  it('unchanged es silencio; error de red es error con reintento', async () => {
    const guardar = vi.fn().mockResolvedValueOnce({ ok: false, reason: 'unchanged' }).mockRejectedValueOnce(new Error('disk')).mockResolvedValueOnce({ ok: true })
    const { rerender, result } = renderHook((p) => useAutosave(p), { initialProps: { valor: base, base, guardar, habilitado: true } })
    rerender({ valor: { title: 'T', content: 'a' }, base, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(result.current.estado).toBe('guardado')
    rerender({ valor: { title: 'T', content: 'ab' }, base, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(result.current.estado).toBe('error')
    await act(async () => { result.current.reintentar() })
    expect(guardar).toHaveBeenCalledTimes(3)
    expect(result.current.estado).toBe('guardado')
  })
  it('al desmontar con cambios sin guardar, guarda igual (Review Focus 2)', async () => {
    const guardar = vi.fn().mockResolvedValue({ ok: true })
    const { rerender, unmount } = renderHook((p) => useAutosave(p), { initialProps: { valor: base, base, guardar, habilitado: true } })
    rerender({ valor: { title: 'T', content: 'ultimo' }, base, guardar, habilitado: true })
    unmount()
    expect(guardar).toHaveBeenCalledWith({ title: 'T', content: 'ultimo' })
  })
})
```

`MemoryNoteEditor.test.tsx` (CodeMirror real en jsdom; si `EditorView` falla por medición, ver nota del Step 3):

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MemoryNoteEditor from '../../components/memories/MemoryNoteEditor'
import type { MemoryObservationDetail } from '../../types'

const det = (o: Partial<MemoryObservationDetail> = {}): MemoryObservationDetail => ({
  syncId: 's1', projectKey: 'p1', scope: 'personal', type: 'decision', title: 'Auth', content: 'ver [[Otra]] y [[Falta]]',
  tags: [], topicKey: null, gitBranch: 'main', originAi: null, authorDisplay: null, createdAt: 1, updatedAt: 1,
  supersededBy: null, revisionCount: 1, links: [{ name: 'Otra', syncId: 's2' }, { name: 'Falta', syncId: null }], mentionedIn: [], ...o,
})
const props = () => ({
  ansi: undefined, candidatos: [], externo: null,
  onSave: vi.fn().mockResolvedValue({ ok: true }), onOpen: vi.fn(), onCreate: vi.fn(),
  onOpenNewer: vi.fn(), onConnect: vi.fn(), onDelete: vi.fn().mockResolvedValue(undefined),
})

describe('MemoryNoteEditor', () => {
  it('muestra el titulo editable y el contenido sin HTML', () => {
    render(<MemoryNoteEditor detail={det({ content: '<img src=x onerror=alert(1)>' })} {...props()} />)
    expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveValue('Auth')
    expect(document.querySelector('.cm-content img')).toBeNull()
  })
  it('click en un link resuelto abre; en uno pendiente ofrece crearla', () => {
    const p = props()
    render(<MemoryNoteEditor detail={det()} {...p} />)
    fireEvent.mouseDown(document.querySelector('[data-wikilink="Otra"]')!)
    expect(p.onOpen).toHaveBeenCalledWith('s2', { background: false })
    fireEvent.mouseDown(document.querySelector('[data-wikilink="Falta"]')!)
    fireEvent.click(screen.getByRole('button', { name: 'Create this memory' }))
    expect(p.onCreate).toHaveBeenCalledWith('Falta')
  })
  it('cambio externo sin cambios locales recarga; con cambios locales muestra la banda (Review Focus 3)', () => {
    const p = props()
    const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
    rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ title: 'Auth v2', updatedAt: 2 })} />)
    expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveValue('Auth v2')
    fireEvent.change(screen.getByRole('textbox', { name: 'Memory title' }), { target: { value: 'Mio' } })
    rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ title: 'Auth v3', updatedAt: 3 })} />)
    expect(screen.getByText(/A newer version replaced this one/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveValue('Mio')
  })
  it('una memoria reemplazada es solo lectura y ofrece abrir la nueva', () => {
    const p = props()
    render(<MemoryNoteEditor detail={det({ supersededBy: 's9' })} {...p} />)
    expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveAttribute('readonly')
    fireEvent.click(screen.getByRole('button', { name: 'Open the newer version' }))
    expect(p.onOpenNewer).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementación.**

`useAutosave.ts`: refs para `valor`, `guardar` y `estado` terminal; `useEffect` sobre `[valor.title, valor.content, habilitado]` que, si `sucio && titulo valido && !terminal`, pone `'pendiente'` y arma `setTimeout(flush, demoraMs)` (limpiando el anterior). `flush` compara contra el último guardado (no contra `base` si ya se guardó una vez), pone `'guardando'`, `await guardar(v)` en try/catch y mapea el resultado según las reglas de arriba. `useEffect(() => () => { if (sucioRef.current && validoRef.current && !terminalRef.current) void guardarRef.current(valorRef.current) }, [])` para el desmontaje. `sucio` = `valor` difiere de lo último guardado/`base`.

`MemoryNoteEditor.tsx`:
- Estructura: contenedor `flex min-h-0 flex-1 flex-col overflow-y-auto`, columna centrada `mx-auto w-full max-w-[720px] px-10 py-9`.
- Línea de metadatos: punto (`memoryTypeSwatch(detail.type, ansi)`), label, `nombreDeProyecto(detail.projectKey, null)`, rama, `relativeTime(detail.updatedAt)`, `AILogo` si hay `originAi`; a la derecha, el estado (`Saving…` / `Saved` / `Unsaved` cuando `pendiente`) y el menú «⋯» (`DropdownMenu` de Task 10 — **si Task 10 todavía no existe, este task crea `src/components/ui/dropdown-menu.tsx`** con el código de Task 10, Step 3, y Task 10 lo reusa) con «Connect to another memory…» y «Delete» (este último abre un `AlertDialog` con «Delete this memory?» / «Delete» / «Cancel», llama `onDelete`). En solo lectura el menú no se muestra.
- Título: `<input aria-label="Memory title" readOnly={soloLectura} className="… text-[26px] font-semibold bg-transparent border-0 outline-none w-full">` (tamaños con utilidades; si existe un token de tamaño grande en `global.css`, usarlo).
- Cuerpo: un `div` donde se monta un `EditorView` en `useEffect` (una vez por `detail.syncId`), con extensiones `[markdown(), EditorView.lineWrapping, livePreview({ resolver: () => resolverRef.current, onWikilink }), autocompletadoDeWikilinks(() => candidatosRef.current), EditorView.updateListener.of((u) => { if (u.docChanged) setContenido(u.state.doc.toString()) }), EditorState.readOnly.of(soloLectura), EditorView.contentAttributes.of({ 'aria-label': 'Memory content' })]`. `soloLectura` va en un `Compartment` para reconfigurar.
- `resolverRef.current`: `(nombre) => { const l = linksPorNombre.get(nombre.toLowerCase()); return l === undefined ? 'desconocido' : l === null ? 'pendiente' : { syncId: l } }` con `linksPorNombre` de `detail.links`. Cuando cambia `detail.links`, `view.dispatch({ effects: refrescarLivePreview.of(null) })`.
- `onWikilink(nombre, background)`: `{ syncId }` ⇒ `onOpen(syncId, { background })`; `'pendiente'` ⇒ abre un `Popover` anclado al link con el texto «Not written yet» y un `Button` «Create this memory» (`onCreate(nombre)`); `'desconocido'` ⇒ nada.
- Autoguardado: `useAutosave({ valor: { title, content }, base: { title: detail.title, content: detail.content ?? '' }, guardar: onSave, habilitado: !soloLectura })`.
- Cambio externo: `useEffect` sobre `externo?.updatedAt`: si `!sucio`, reemplaza título y documento (`view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: externo.content ?? '' } })`) y la base; si `sucio`, pone la banda `reemplazada` sin tocar el texto.
- Bandas (arriba del título, `role="status"`, `rounded-md border border-border bg-accent px-3 py-2 text-fs-sm`):
  - `reemplazada` o `detail.supersededBy`: «A newer version replaced this one.» + `Button` «Open the newer version» (`onOpenNewer`). Al entrar en este estado por un guardado rechazado, copiar `title + '\n\n' + content` con `navigator.clipboard?.writeText` (try/catch) y sumar «Your text was copied to the clipboard.»
  - `borrada`: «This memory was deleted.»
  - `error`: texto `error ?? 'Could not save'` + `Button` «Retry» (`reintentar`), con `text-destructive`.
- `forwardRef` + `useImperativeHandle(ref, () => ({ irALinea: (n) => { const l = view.state.doc.line(Math.min(n, view.state.doc.lines)); view.dispatch({ selection: { anchor: l.from }, scrollIntoView: true }); view.focus() } }))`.

Nota jsdom: CodeMirror 6 monta en jsdom, pero `posAtDOM`/medición pueden fallar. Si el test de click no encuentra `[data-wikilink]` o tira por `getClientRects`, agregar en `src/__tests__/setup-dom.ts` stubs de `Range.prototype.getClientRects`/`getBoundingClientRect` (devolver rects vacíos) — no mockear CodeMirror.

- [ ] **Step 4:** PASS los dos archivos. `tsc` → 0. `npx vitest run src/__tests__/la-app-es-en-ingles.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(memories): editor en live preview con autoguardado`.

---

### Task 8: Panel derecho de la nota (`memory-outline` + `MemoryNoteSidePanel`)

**Files:**
- Create: `src/lib/memory-outline.ts`, `src/components/memories/MemoryNoteSidePanel.tsx`
- Test: `src/__tests__/lib/memory-outline.test.ts`, `src/__tests__/components/MemoryNoteSidePanel.test.tsx`

**Interfaces:**
- Consumes: `MemoryGraph2D` (Task 4), `subgrafoLocal` (Task 4), `GraphData`, `MemoryObservationDetail`, `memoryTypeSwatch`, `nombreDeProyecto`, `relativeTime`.
- Produces:

```ts
export interface EncabezadoDeOutline { nivel: number; texto: string; linea: number }  // linea 1-based
export function outlineDe(markdown: string): EncabezadoDeOutline[]
export interface MemoryNoteSidePanelProps {
  detail: MemoryObservationDetail
  graphData: GraphData                // el grafo global ya filtrado (para el local)
  ansi?: readonly string[]
  titulosPorId: ReadonlyMap<string, { title: string; type: string }>  // para pintar Links to
  onOpen: (syncId: string, opts: { background: boolean }) => void
  onIrALinea: (linea: number) => void
}
```
  Secciones colapsables (`<details open>` con `<summary>` estilizado; recordar abiertas/cerradas no hace falta): «Local graph» (alto fijo 180 px, toggle «1 hop» / «2 hops»), «Mentioned in» (`detail.mentionedIn`, vacío ⇒ «Nothing links here yet.»), «Links to» (`detail.links`; `syncId: null` ⇒ fila atenuada en itálica con « — not written yet» y sin click), «Properties» (Type, Project, Branch, Written by = `authorDisplay ?? originAi ?? '—'`, Updated, Created, Tags, Scope, Revisions), «Outline» (`outlineDe(detail.content ?? '')`, vacío ⇒ «No headings in this memory.»; click ⇒ `onIrALinea`).

- [ ] **Step 1: Tests que fallan:**

```ts
// memory-outline.test.ts
import { describe, it, expect } from 'vitest'
import { outlineDe } from '../../lib/memory-outline'
describe('outlineDe', () => {
  it('encabezados ATX con nivel y linea, ignorando bloques de codigo', () => {
    expect(outlineDe('# A\ntexto\n```\n# no\n```\n## B')).toEqual([
      { nivel: 1, texto: 'A', linea: 1 }, { nivel: 2, texto: 'B', linea: 6 },
    ])
  })
})
```

```tsx
// MemoryNoteSidePanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
vi.mock('../../components/memories/MemoryGraph2D', () => ({ default: () => <div data-testid="local" /> }))
import MemoryNoteSidePanel from '../../components/memories/MemoryNoteSidePanel'

const detail = {
  syncId: 's1', projectKey: 'p1', scope: 'personal' as const, type: 'decision', title: 'Auth', content: '## Why\nx',
  tags: ['auth'], topicKey: null, gitBranch: 'main', originAi: 'claude', authorDisplay: null, createdAt: 1, updatedAt: 1,
  supersededBy: null, revisionCount: 2,
  links: [{ name: 'Otra', syncId: 's2' }, { name: 'Falta', syncId: null }],
  mentionedIn: [{ syncId: 's3', title: 'La que me nombra' }],
}
describe('MemoryNoteSidePanel', () => {
  it('backlinks, links salientes con huecos, propiedades y outline', () => {
    const onOpen = vi.fn(), onIrALinea = vi.fn()
    render(<MemoryNoteSidePanel detail={detail} graphData={{ nodes: [], links: [], orphansHidden: 0 }}
      titulosPorId={new Map([['s2', { title: 'Otra memoria', type: 'bugfix' }]])} onOpen={onOpen} onIrALinea={onIrALinea} />)
    fireEvent.click(screen.getByRole('button', { name: /La que me nombra/ }))
    expect(onOpen).toHaveBeenCalledWith('s3', { background: false })
    fireEvent.click(screen.getByRole('button', { name: /Otra memoria/ }))
    expect(onOpen).toHaveBeenCalledWith('s2', { background: false })
    expect(screen.getByText(/Falta — not written yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Falta/ })).toBeNull()
    expect(screen.getByText('main')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Why' }))
    expect(onIrALinea).toHaveBeenCalledWith(1)
  })
})
```

- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementación.** `outlineDe`:

```ts
// Los encabezados de una memoria, para saltar entre ellos. Ignora lo que está dentro de un
// bloque de código cercado: un `# comentario` de bash no es un título.
export interface EncabezadoDeOutline { nivel: number; texto: string; linea: number }

export function outlineDe(markdown: string): EncabezadoDeOutline[] {
  const out: EncabezadoDeOutline[] = []
  let enCodigo = false
  markdown.split('\n').forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { enCodigo = !enCodigo; return }
    if (enCodigo) return
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l)
    if (m) out.push({ nivel: m[1].length, texto: m[2], linea: i + 1 })
  })
  return out
}
```

`MemoryNoteSidePanel`: lo descrito en Interfaces. Grafo local: `const [saltos, setSaltos] = useState<1 | 2>(1)`; `data = useMemo(() => subgrafoLocal(graphData, detail.syncId, saltos), …)`; `<MemoryGraph2D modo="local" data={data} foco={detail.syncId} onOpen={onOpen} />`. Si el nodo no está en `graphData` (filtrado), mostrar «Not in the current graph filters.» en vez del grafo. Las filas son `<button type="button">` con `onClick={(e) => onOpen(id, { background: e.ctrlKey || e.metaKey })}` y el punto de color por tipo.
- [ ] **Step 4:** PASS. `tsc` → 0.
- [ ] **Step 5:** Commit `feat(memories): panel derecho de la nota`.

---

### Task 9: `MemoriesExplorer` y `MemoryTabs`

**Files:**
- Create: `src/lib/almacen-seguro.ts`, `src/components/memories/MemoriesExplorer.tsx`, `src/components/memories/MemoryTabs.tsx`
- Test: `src/__tests__/components/MemoriesExplorer.test.tsx`, `src/__tests__/components/MemoryTabs.test.tsx`

**Interfaces:**
- Consumes: `CarpetaDeMemorias` (Task 2), `MemoryTab`, `tabId`, `esFija` (Task 3), `memoryTypeSwatch`.
- Produces:

```ts
// almacen-seguro.ts
export function leer(clave: string): string | null
export function escribir(clave: string, valor: string): void
export const almacenDePaneles: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void }

// MemoriesExplorer
export interface MemoriesExplorerProps {
  carpetas: CarpetaDeMemorias[]
  query: string
  onQuery: (q: string) => void
  activoId: string | null                         // syncId de la pestaña activa
  carpetaSeleccionada: string | null
  onSeleccionarCarpeta: (id: string) => void
  onOpen: (syncId: string, opts: { background: boolean }) => void
  onNew: () => void
  truncadas: number                               // MemoryGraph.truncated
  ansi?: readonly string[]
  cargando: boolean
}
// MemoryTabs
export interface MemoryTabsProps {
  tabs: MemoryTab[]
  activeId: string
  etiqueta: (t: MemoryTab) => { texto: string; tipo?: string }
  ansi?: readonly string[]
  onActivate: (id: string) => void
  onClose: (id: string) => void
}
```
  Explorer: `Input` «Search memories…» (`aria-label="Search memories"`), `Button` «New memory» (`data-tour-id="memories-new"`), un `<button aria-expanded>` por carpeta (nombre + contador) y, abierta, una fila `<button>` por memoria (punto + título truncado, `aria-current={activo ? 'page' : undefined}`). Carpetas abiertas recordadas con `leer/escribir('nest:memories:carpetas')` (JSON de ids cerrados). Con búsqueda, todas abiertas. Sin carpetas: «No memories yet» (o «No matches» con búsqueda). `truncadas > 0` ⇒ al pie «{n} more not shown» (Review Focus 4). Click en carpeta también llama `onSeleccionarCarpeta`.
  Tabs: `role="tablist"`; cada pestaña `role="tab"` `aria-selected`; Graph con ícono (`lucide-react` `Network`), Team thread con `GitBranch`, notas con el punto de color; × (`aria-label="Close tab"`) sólo si `!esFija`. Click con el botón del medio cierra.

- [ ] **Step 1: Tests que fallan:**

```tsx
// MemoriesExplorer.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MemoriesExplorer from '../../components/memories/MemoriesExplorer'

const nodo = (syncId: string, title: string) => ({ syncId, title, projectKey: 'p1', projectDisplayName: 'raven-nest', tags: [], type: 'decision', scope: 'personal' as const, topicKey: null, gitBranch: null, originAi: null, authorDisplay: null, updatedAt: 1, superseded: false })
const base = () => ({
  carpetas: [{ id: 'project:p1', nombre: 'raven-nest', items: [nodo('a', 'Auth pasa a cookies')] }, { id: 'team', nombre: 'Team', items: [nodo('t', 'Rate limit')] }],
  query: '', onQuery: vi.fn(), activoId: null, carpetaSeleccionada: null, onSeleccionarCarpeta: vi.fn(),
  onOpen: vi.fn(), onNew: vi.fn(), truncadas: 0, cargando: false,
})

describe('MemoriesExplorer', () => {
  it('carpetas con contador; abrir una memoria; ctrl+click en segundo plano', () => {
    const p = base()
    render(<MemoriesExplorer {...p} />)
    expect(screen.getByRole('button', { name: /raven-nest 1/ })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Auth pasa a cookies' }))
    expect(p.onOpen).toHaveBeenLastCalledWith('a', { background: false })
    fireEvent.click(screen.getByRole('button', { name: 'Auth pasa a cookies' }), { metaKey: true })
    expect(p.onOpen).toHaveBeenLastCalledWith('a', { background: true })
  })
  it('cerrar una carpeta esconde sus memorias y se recuerda', () => {
    const { unmount } = render(<MemoriesExplorer {...base()} />)
    fireEvent.click(screen.getByRole('button', { name: /raven-nest 1/ }))
    expect(screen.queryByRole('button', { name: 'Auth pasa a cookies' })).toBeNull()
    unmount()
    render(<MemoriesExplorer {...base()} />)
    expect(screen.queryByRole('button', { name: 'Auth pasa a cookies' })).toBeNull()
  })
  it('avisa cuantas quedaron afuera del grafo (Review Focus 4)', () => {
    render(<MemoriesExplorer {...base()} truncadas={12} />)
    expect(screen.getByText('12 more not shown')).toBeInTheDocument()
  })
  it('sin carpetas dice No memories yet', () => {
    render(<MemoriesExplorer {...base()} carpetas={[]} />)
    expect(screen.getByText('No memories yet')).toBeInTheDocument()
  })
})
```

Antes de cada test del explorer: `localStorage.clear()` en un `beforeEach`.

```tsx
// MemoryTabs.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MemoryTabs from '../../components/memories/MemoryTabs'

describe('MemoryTabs', () => {
  it('Graph no tiene cerrar; una nota si; el medio cierra', () => {
    const onClose = vi.fn(), onActivate = vi.fn()
    render(<MemoryTabs tabs={[{ kind: 'graph' }, { kind: 'note', syncId: 'a' }]} activeId="graph"
      etiqueta={(t) => ({ texto: t.kind === 'graph' ? 'Graph' : 'Auth' })} onActivate={onActivate} onClose={onClose} />)
    expect(screen.getAllByRole('button', { name: 'Close tab' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: /Auth/ }))
    expect(onActivate).toHaveBeenCalledWith('note:a')
    fireEvent.mouseUp(screen.getByRole('tab', { name: /Auth/ }), { button: 1 })
    expect(onClose).toHaveBeenCalledWith('note:a')
  })
})
```

- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementación.** `almacen-seguro.ts`:

```ts
// localStorage puede tirar (perfil sin storage, cuota) o volver vacío: nada de lo que se
// guarda acá es indispensable, así que un fallo vuelve al valor por defecto y listo.
export function leer(clave: string): string | null {
  try { return window.localStorage.getItem(clave) } catch { return null }
}
export function escribir(clave: string, valor: string): void {
  try { window.localStorage.setItem(clave, valor) } catch { /* sin storage: se pierde la preferencia */ }
}
export const almacenDePaneles = { getItem: leer, setItem: escribir }
```

Explorer y Tabs: según Interfaces, sólo shadcn/utilidades/tokens. El accessible name de la carpeta: `${nombre} ${items.length}`.
- [ ] **Step 4:** PASS. `tsc` → 0.
- [ ] **Step 5:** Commit `feat(memories): explorer por carpetas y barra de pestanas`.

---

### Task 10: El workspace nuevo (cableado, borrado de lo viejo, tour)

**Files:**
- Create: `src/components/ui/dropdown-menu.tsx` (si Task 7 no lo creó), `src/components/MemoriesNoteTab.tsx`
- Modify: `src/hooks/useMemoryDetail.ts`, `src/components/MemoriesWorkspace.tsx`, `src/tutorial/tours/memories.ts`, `src/__tests__/components/MemoriesWorkspace.test.tsx`, `src/__tests__/components/memories-en-vivo.test.tsx`, `src/__tests__/tutorial/memories-tour.test.ts`, `src/__tests__/components/MemoriesWorkspace-tokens.test.tsx`
- Delete: `src/components/MemoryGraphPanel.tsx`, `src/components/MemoriesList.tsx`, `src/components/MemoryGraph3D.tsx`, `src/components/MemoryMarkdown.tsx`, `src/__tests__/components/MemoriesList.test.tsx`, `src/__tests__/components/MemoryGraphPanel-chips-tipo.test.tsx`, `src/__tests__/components/MemoryGraphPanel-sin-vinculos.test.tsx`, `src/__tests__/components/MemoryDocumentoAcciones.test.tsx`, `src/__tests__/components/MemoryDocumentoLinks.test.tsx`, `src/__tests__/components/MemoryMarkdown.test.tsx`
- Test: `src/__tests__/components/MemoriesWorkspace-obsidian.test.tsx`

**Interfaces:**
- Consumes: todo lo anterior; `useMemoryGraph(includeSimilar)`; `useCrossProjectMemories()`; `useMemories()`; `TeamThreadPanel`; `NewMemoryForm`; `MemorySettingsView`; `window.memory.{link, updateFromUi, deleteFromUi, onChanged, teamThreadProjectKeyForWorktree}`.
- Produces:

```ts
// useMemoryDetail: nuevo parámetro opcional
export function useMemoryDetail(syncId: string | null, nonce?: number): MemoryDetailState
// MemoriesNoteTab (adaptador; habla con window.memory)
export interface MemoriesNoteTabProps {
  syncId: string
  version: number                        // bump por onChanged
  graphData: GraphData
  ansi?: readonly string[]
  candidatos: CandidatoDeLink[]
  titulosPorId: ReadonlyMap<string, { title: string; type: string }>
  panelDerecho: HTMLElement | null       // portal: el panel lateral vive en la columna derecha
  onOpen: (syncId: string, opts: { background: boolean }) => void
  onCreate: (titulo: string) => void
  onConnect: (syncId: string) => void
  onDeleted: (syncId: string) => void
  onTitulo: (syncId: string, titulo: string, tipo: string) => void  // para la etiqueta de la pestaña
}
```
  Las props de `MemoriesWorkspace` **no cambian** (App.tsx no se toca).

- [ ] **Step 1: Test que falla** `MemoriesWorkspace-obsidian.test.tsx` (mock de `react-force-graph-2d` como en Task 4; `setMemoryApi`/`api()` copiados de `MemoriesWorkspace.test.tsx:6-29`; `__reiniciarPestanas()` en `beforeEach`):

```tsx
it('arranca en Graph; abrir desde el explorer crea una pestana con la nota y su panel', async () => {
  setMemoryApi(api({
    graph: vi.fn().mockResolvedValue({ truncated: 0, nodes: [nodo('a', 'Auth pasa a cookies'), nodo('b', 'Otra')], edges: [{ from: 'a', to: 'b', kind: 'wikilink', directed: true }] }),
    crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    observation: vi.fn().mockImplementation(async (id: string) => detalle(id)),
  }))
  render(<MemoriesWorkspace {...props()} />)
  expect(await screen.findByRole('tab', { name: /Graph/, selected: true })).toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: 'Auth pasa a cookies' }))
  expect(await screen.findByRole('tab', { name: /Auth pasa a cookies/, selected: true })).toBeInTheDocument()
  expect(await screen.findByRole('textbox', { name: 'Memory title' })).toHaveValue('Auth pasa a cookies')
  expect(screen.getByText('Mentioned in')).toBeInTheDocument()
})
it('conectar a mano: el menu pone el modo y el proximo click enlaza en vez de abrir; Esc cancela', async () => { /* … link: vi.fn().mockResolvedValue({ ok: true }); abrir 'a'; menú «More actions» → «Connect to another memory…»; ver banda /Pick the memory this one goes with/; click en 'Otra' del explorer ⇒ link('a','b') y NO se abre pestaña de 'b'; repetir y apretar Escape ⇒ banda desaparece, link no se llama */ })
it('Ctrl+W cierra la pestana activa y no burbujea (Review Focus 1)', async () => { /* abrir 'a'; const ev = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }); spy en window keydown; fireEvent(workspaceRoot, ev) ⇒ pestaña cerrada, ev.defaultPrevented === true, el spy de window no lo recibió */ })
it('New memory abre una pestana con el formulario y al guardar pasa a la memoria nueva', async () => { /* saveFromUi: vi.fn().mockResolvedValue({ ok: true, syncId: 'n1' }); click «New memory» ⇒ tab «New memory»; llenar Memory title; «Save memory» ⇒ tab de n1 activa */ })
it('Team thread aparece como pestana fija si el repo tiene el hilo', async () => { /* con activeRepoPath y el api del hilo prendido como en MemoriesWorkspace.test.tsx; ver tab «Team thread» */ })
it('buscar filtra el explorer y resalta en el grafo', async () => { /* crossProject con query devuelve solo 'a' ⇒ el explorer muestra 'Auth pasa a cookies' y no 'Otra' */ })
```

El implementador escribe los cuerpos completos siguiendo el patrón del primer test (todos los helpers `nodo`, `detalle`, `props` se definen arriba del archivo con los tipos de `src/types.ts`). Para el test de Team thread, copiar el mock del hilo que ya usa `MemoriesWorkspace.test.tsx` (buscar `teamThread` en ese archivo) en vez de inventarlo.

- [ ] **Step 2:** FAIL.
- [ ] **Step 3: `dropdown-menu.tsx`** (shadcn, mismo patrón y mismo ajuste de z-index que `popover.tsx`):

```tsx
"use client"

import * as React from "react"
import { cn } from "cn"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

function DropdownMenu(props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}
function DropdownMenuTrigger(props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}
function DropdownMenuContent({ className, sideOffset = 4, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          // Mismo motivo que popover.tsx: el portal compite contra la escala de overlays.
          "z-[calc(var(--z-overlay-top)_+_1)] min-w-[10rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}
function DropdownMenuItem({ className, variant, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { variant?: "destructive" }) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-fs-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        variant === "destructive" && "text-destructive focus:text-destructive",
        className
      )}
      {...props}
    />
  )
}
export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem }
```

- [ ] **Step 4: `useMemoryDetail(syncId, nonce = 0)`**: sumar `nonce` a las dependencias del `useEffect` y no limpiar `detail` a null mientras recarga el mismo `syncId` (mantener el anterior con `loading: true`), para que la pestaña no parpadee al recargar.
- [ ] **Step 5: `MemoriesNoteTab`**: `const { detail, loading, missing } = useMemoryDetail(syncId, version)`; guarda la primera versión como `detail` del editor y las siguientes (por `version`) como `externo`. `onSave` ⇒ `window.memory?.updateFromUi?.({ syncId, title, content })` (sin API ⇒ `{ ok: false, error: 'This build cannot edit memories yet.' }`). `onDelete` ⇒ `deleteFromUi(syncId)` y `onDeleted(syncId)`. `onOpenNewer` ⇒ `onOpen(detail.supersededBy, { background: false })`. Renderiza `MemoryNoteEditor` en el centro y `createPortal(<MemoryNoteSidePanel …/>, panelDerecho)` cuando `panelDerecho` existe. `loading` sin detalle ⇒ «Loading…»; `missing` ⇒ «This memory is no longer there — it was deleted after the graph was drawn.» Llama `onTitulo` cuando el detalle llega o el título cambia.
- [ ] **Step 6: `MemoriesWorkspace`** — se conservan header, `vista`, `onVistaChange`, `MemorySettingsView`, `useMemories`, `MemoriesStatusRow`, la suscripción a `onChanged` (bump de `version` + `state.refresh`) y `useCrossProjectMemories`. Se reemplaza el cuerpo de la vista «memorias» por:

```tsx
<PanelGroup direction="horizontal" autoSaveId="nest:memories:columnas" storage={almacenDePaneles} className="min-h-0 flex-1">
  <Panel defaultSize={18} minSize={12} collapsible id="explorer" order={1}>
    <MemoriesExplorer … />                        {/* data-tour-id="memories-explorer" en su raíz */}
  </Panel>
  <PanelResizeHandle className="w-px bg-border" />
  <Panel minSize={30} id="centro" order={2}>
    <MemoryTabs … />                               {/* data-tour-id="memories-tabs" */}
    {/* banda de conectar: «Pick the memory this one goes with — in the explorer or in the graph.» + Cancel */}
    {/* contenido por pestaña: graph ⇒ <MemoryGraph2D modo="global" data={filtros.data} resaltados={resaltados} … escalaDeNodo distanciaDeLinks onOpen={alAbrir} />
        thread ⇒ <TeamThreadPanel activeRepoPath onOpenFile />
        note ⇒ <MemoriesNoteTab key={syncId} … /> (TODAS las pestañas de nota montadas, ocultas con `hidden` salvo la activa, para no perder el editor ni el autoguardado al cambiar)
        new ⇒ <NewMemoryForm activeRepoPath={repoDeLaCarpeta ?? activeRepoPath} onClose={() => tabs.close(id)} onSaved={…} /> */}
  </Panel>
  <PanelResizeHandle className="w-px bg-border" />
  <Panel ref={panelDerechoRef} defaultSize={22} minSize={15} collapsible id="derecho" order={3}>
    <div ref={setPanelDerechoEl} className="h-full overflow-y-auto">
      {activa.kind === 'graph' && <GraphFiltersPanel … />}
    </div>
  </Panel>
</PanelGroup>
```

  Detalles a respetar:
  - `const [includeSimilar, setIncludeSimilar] = useState(true)`; `const grafo = useMemoryGraph(includeSimilar)`; `grafo.refresh()` cuando `version` cambia; `const filtros = useGraphFilters(grafo.graph, ansi)`.
  - `const conHilo`: el hilo está prendido para `activeRepoPath`. Reusar la misma consulta que usa `TeamThreadPanel` para decidir si renderiza (leer `TeamThreadPanel.tsx:60-90` y extraer esa lectura a un hook `useTeamThreadEnabled(activeRepoPath): boolean` en `src/hooks/`, usado por los dos — no duplicar la consulta).
  - `tabs = useMemoryTabs(conHilo)`.
  - `carpetas = armarArbol(grafo.graph?.nodes ?? [], resaltados)`, con `resaltados` como hoy (`busqueda.query.trim() ? new Set(busqueda.items.map(i => i.syncId)) : null`).
  - `candidatos` y `titulosPorId` salen de `grafo.graph.nodes` (sin `pending`), con `aliases`.
  - `alAbrir(syncId, { background })`: si `conectandoDesde` ⇒ hace el `link` como el `alElegir` de hoy (mismos mensajes de error), cancela el modo y bump de `version`; si no ⇒ `tabs.open({ kind: 'note', syncId }, { background })`.
  - New memory: `tabs.open({ kind: 'new', key: String(Date.now()), titulo: '' })`; desde «Create this memory», `titulo` = el nombre. `NewMemoryForm` no acepta título inicial: agregarle la prop opcional `tituloInicial?: string` (default `''`) y usarla como valor inicial del input. `repoDeLaCarpeta`: si la carpeta seleccionada es la del repo activo, `activeRepoPath`; si es `global`, `null`; si es otro proyecto, `activeRepoPath` (el form no sabe crear en otro repo; el spec no lo pide). `onSaved` recibe hoy `() => void`: cambiarlo a `(syncId?: string) => void` pasando el `syncId` que devuelve `saveFromUi`, y en el workspace `tabs.replace(id, { kind: 'note', syncId })` si vino, o cerrar la pestaña si no.
  - Teclado (en `onKeyDown` del contenedor raíz `.memories-workspace`, **no** en `window`): Ctrl/Cmd+W ⇒ `e.preventDefault(); e.stopPropagation(); tabs.close(tabs.activeId)`; Escape con `conectandoDesde` ⇒ cancelar.
  - Ventana angosta: `useEffect(() => { if (window.innerWidth < 1100) panelDerechoRef.current?.collapse() }, [])`.
  - Pestaña activa `graph` sin memorias (grafo vacío y no cargando): el centro muestra «No memories yet» y el explorer también.
  - `data-tour-id="memories-graph"` va en el contenedor del grafo global.
- [ ] **Step 7: Tour** `src/tutorial/tours/memories.ts`: steps `status` (igual), `explorer` (`[data-tour-id="memories-explorer"]`, «Every memory, by project», «Global, one folder per repo, and Team. Search here — matches light up in the graph too.», `placement: 'right'`), `graph` (`[data-tour-id="memories-graph"]`, «This is everything your agents remember», «Each dot is one memory, coloured by kind. Solid lines are links someone wrote; dotted ones are guesses. Click a dot to open it — or open a memory and pick "Connect to another memory" in its ⋯ menu, then click the other.»), `tabs` (`[data-tour-id="memories-tabs"]`, «Read and edit in place», «Memories open as tabs and save as you type. [[Links]] take you to the memory they name.», `placement: 'bottom'`), `new` (igual, anclado al botón del explorer), `settings` (igual). Ajustar `src/__tests__/tutorial/memories-tour.test.ts`: el paso `graph` sigue sin decir «drag» y sigue mencionando «Connect to another memory».
- [ ] **Step 8: Borrar** los cuatro componentes y los seis tests viejos. Portar a `MemoriesWorkspace-obsidian.test.tsx` lo que cubrían y no está en los tests de Tasks 4–9: (a) chips por tipo filtran el grafo **y** el explorer (de `MemoryGraphPanel-chips-tipo`): ocultar «Bugfix» en los filtros saca esos nodos de `filtros.data` — el explorer **no** se filtra por tipo (decisión: los filtros son del grafo; anotarlo en el reporte); (b) grafo sin aristas: hoy devolvía null; ahora la pestaña Graph muestra los nodos igual (Obsidian muestra huérfanos si «Showing unconnected»), y con `hideOrphans` y 0 aristas muestra «Nothing is connected yet — show unconnected to see every memory.» con un botón que llama `setHideOrphans(false)`. En `MemoriesWorkspace.test.tsx`, borrar/adaptar los casos que miraban la lista o el cuadro del grafo (los de «type chip filtering graph and list») y mantener el resto (status row, Settings/Back, vistaInicial, How it works, onVistaChange). En `memories-en-vivo.test.tsx`, el refetch por `onChanged` ahora se verifica sobre `graph` (y sobre `observation` si hay una pestaña abierta) en vez de sobre la lista. En `MemoriesWorkspace-tokens.test.tsx`, sumar a la lista de archivos revisados todos los de `src/components/memories/`.
- [ ] **Step 9:** `npx vitest run src/__tests__/components src/__tests__/tutorial src/__tests__/lib src/__tests__/la-app-es-en-ingles.test.ts` → todo PASS. Los dos `tsc` → 0. `rg -n "MemoryGraphPanel|MemoriesList|MemoryGraph3D|MemoryMarkdown" src e2e` → sin resultados fuera de comentarios (los e2e se arreglan en Task 11; si aparecen ahí, dejarlos para Task 11).
- [ ] **Step 10:** Commit `feat(memories): la vista principal pasa a explorer, pestanas y panel estilo Obsidian`.

---

### Task 11: e2e, contraste y verificación en la app real

**Files:**
- Modify: `e2e/08-memory-graph.spec.ts`, `e2e/03-memories-in-app.spec.ts`, `e2e/11-paquete-con-nest-abierto.spec.ts`

**Interfaces:**
- Consumes: la vista de Task 10. Selectores estables: `.memories-workspace`, `getByRole('tab', …)`, `getByRole('button', { name: <título> })` en el explorer, `getByRole('textbox', { name: 'Memory title' })`, `.cm-content`, `[data-wikilink="…"]`, `getByRole('button', { name: 'More actions' })`.

- [ ] **Step 1: Reescribir `e2e/08-memory-graph.spec.ts`** con los mismos datos de `seedMemories`/`MEMORIAS_DE_MUESTRA` y el mismo `abrirMemories`. Casos:
  1. Sin memorias: «No memories yet» visible; ningún `canvas` dentro de `.memories-workspace`. Captura `01-sin-memorias.png`.
  2. Con memorias: la pestaña Graph está seleccionada y hay un `canvas` visible que ocupa el centro (ancho del canvas > 50 % del ancho de la ventana). Captura `02-grafo-con-memorias.png`.
  3. Abrir «Auth pasa a cookies de sesión» desde el explorer ⇒ pestaña nueva seleccionada, título en el input, «Mentioned in» en el panel. Captura `03-nota-abierta.png`.
  4. Editar: click al final de `.cm-content`, escribir « editado», esperar «Saved» (timeout 5 s), cerrar la pestaña, reabrirla desde el explorer y ver « editado» en `.cm-content`.
  5. Seguir un `[[link]]`: en la memoria del seed que tiene `[[release-yml]]` (ver `MEMORIAS_DE_MUESTRA`), click en `[data-wikilink="release-yml"]` (con el cursor en otra línea: primero click en el título) ⇒ se abre esa memoria. El hueco «el checklist de QA» ⇒ click ⇒ «Create this memory» visible. Captura `04-links.png`.
  6. Conectar a mano: «More actions» ⇒ «Connect to another memory…» ⇒ banda visible ⇒ click en otra memoria del explorer ⇒ en «Links to» no (son manuales), pero el filtro de leyenda muestra «Connected by hand» (el `EDGE_STYLES.manual.label`) en el panel de la pestaña Graph. Captura `05-conectadas-a-mano.png`.
  7. New memory: «New memory» ⇒ pestaña «New memory» ⇒ llenar `Memory title`/`Memory content`/tipo `Preference` ⇒ «Save memory» ⇒ la pestaña pasa a la memoria nueva.
  8. Ctrl+W (Review Focus 1): con una nota activa, `page.keyboard.press('Control+W')` ⇒ la pestaña se cierra **y la ventana sigue abierta** (`expect(page.locator('.memories-workspace')).toBeVisible()`). Si la ventana se cierra, **no** parchear el test: sacar el atajo de Task 10 (dejar sólo × y botón del medio), anotarlo en el reporte y avisar a Gero.
  Las capturas viejas `06-dentro-de-un-tag.png`, `07-escrita-a-mano.png`, `08-conectadas-a-mano.png` en `.superpowers/sdd/shots/memory-graph/` se reemplazan por las nuevas; no commitear capturas (el árbol ya tiene esas modificadas fuera de este trabajo).
- [ ] **Step 2: `e2e/03-memories-in-app.spec.ts`**: donde espera `.team-thread-panel` visible, primero `getByRole('tab', { name: /Team thread/ }).click()`. El resto de los selectores (`.memories-status-row`, `.tw-back-btn`, `.tw-header-title`, «Memory settings») no cambia.
- [ ] **Step 3: `e2e/11-paquete-con-nest-abierto.spec.ts`**: «No memories yet» sigue existiendo (explorer); verificar que el caso pase sin cambios y, si busca la memoria en la lista, buscarla como botón del explorer.
- [ ] **Step 4:** `npm run native:electron && npm run e2e -- e2e/08-memory-graph.spec.ts e2e/03-memories-in-app.spec.ts e2e/11-paquete-con-nest-abierto.spec.ts e2e/04-contraste.spec.ts` → PASS. Si `04-contraste` falla en algún componente nuevo, corregir con tokens (nunca bajar el umbral).
- [ ] **Step 5: Suite completa:** `npm test` (deja el binding de Node) → registrar pasados/fallados. Las fallas por carga conocidas (`AutomationsView*`, `IntegrationsMarketplace-connect`, `memories-en-vivo`) se reintentan aisladas; cualquier otra falla se arregla. Después `npm run native:electron`.
- [ ] **Step 6:** Los dos `tsc` → 0.
- [ ] **Step 7:** Commit `test(e2e): Memories estilo Obsidian`.

---

## Self-review (hecho al escribir)

- **Cobertura del spec:** §3 layout/navegación → Tasks 3, 9, 10 · §3 New memory / conectar / Team thread → Task 10 · §4 grafo 2D y filtros → Tasks 4, 5 · §5 live preview, guardado, errores, cambio externo, menú → Tasks 6, 7, 10 · §6 componentes sin Electron → Global Constraints + Tasks 4–9 · §7 datos (alias) → Task 1 · §8 tests → todas + Task 11 · §9 fuera de alcance respetado.
- **Desvíos a avisar a Gero:** carpeta «Global» en vez de «Personal»; los filtros por tipo afectan al grafo y no al explorer; un `[[link]]` recién escrito se resuelve después del autoguardado (≤1,5 s + recarga), no al instante.
- **Tipos:** `MemoryTab`/`tabId` (Task 3) usados igual en 9 y 10; `ResultadoDeGuardado` (Task 7) es el mismo shape que devuelve `updateFromUi`; `CandidatoDeLink` (Task 6) se arma en Task 10 desde `MemoryGraphNode` (con `aliases` de Task 1); `GraphData` de `memory-graph-visuals.ts` en 4, 5, 8, 10.
