# Team Memory Layer 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el hilo de trabajo del equipo —índice + una nota por rama, con autor y fecha— aparezca solo en `.nest/team/` de cada worktree de cada compañero, sin que nadie escriba ni mande un `.md`.

**Architecture:** Un planner puro nuevo (`team-thread-plan.ts`) agrupa las filas de scope `team` por `gitBranch` y emite un `VaultPlan`, que el motor de fs ya existente (`vault-apply.ts`) aplica de forma atómica. No se toca `vault-plan.ts`: la separación entre el vault personal y el hilo de equipo la garantiza la estructura de módulos, no un flag. La UI suma un grafo de SVG a mano, sin dependencias, alimentado por otro módulo puro.

**Tech Stack:** TypeScript, Electron (main + preload + renderer React), vitest, better-sqlite3.

**Spec:** `docs/superpowers/specs/2026-09-08-team-memory-layer-2-design.md`

## Global Constraints

- **Typecheck**: `npx tsc --noEmit` en la raíz **NO CHEQUEA NADA** (tsconfig solution-style con `files: []`). El chequeo real es `npx tsc -b`.
- **`tsc -b` emite `.js`/`.d.ts` junto a los sources** (composite). Se limpia con `git clean -fd`. **⚠️ `git add` los archivos fuente NUEVOS ANTES del `git clean`** — clean borra todo lo untracked y no distingue un `.ts` recién creado de un `.js` emitido. Ya se llevó puesto un componente nuevo y su test el 2026-08-18.
- Hay **~15 errores de tipo preexistentes** bajo `tsc -b` en código de `main` (pidusage, metrics-collector). No son de este trabajo; no intentar arreglarlos.
- **better-sqlite3**: `npm test` dispara `pretest` → `npm run native:node`. Después de correr tests, la app no arranca hasta `npm run native:electron`.
- **Tests**: vitest. Para un archivo suelto, `npx vitest run <path>` (con el binding de Node ya puesto).
- **Idioma**: UI, código, nombres de archivo y copy **en inglés**; comentarios y docs internos pueden ir en español, siguiendo lo que ya hace `electron/integrations/`.
- **Ni una tabla nueva ni un endpoint nuevo.** Layer 1 ya mueve las filas.
- **`vault-plan.ts` no se modifica en ninguna task.** Si una task parece necesitarlo, está mal planteada.
- **Multi-OS**: rutas relativas con `/` dentro del plan (las convierte `vault-apply.ts:abs()`), slugs vía `vaultSlug()`.

---

## File Structure

| Archivo | Responsabilidad | Toca fs |
|---|---|---|
| `electron/integrations/team-thread-plan.ts` | **Nuevo, puro.** Filas `team` → `VaultPlan` (agrupado por rama) | no |
| `electron/integrations/team-thread-note.ts` | **Nuevo, puro.** Render de una nota de rama y del índice | no |
| `src/lib/team-thread-graph.ts` | **Nuevo, puro.** Ramas → nodos, aristas y coordenadas. Vive en `src/` porque es presentacional y **`src/` nunca importa de `electron/`** | no |
| `src/types.ts` | **Modificado.** `TeamThreadBranch` duplicado, con el comentario del patrón | — |
| `electron/integrations/team-thread-config.ts` | **Nuevo.** Settings por proyecto (leer/escribir JSON) | sí |
| `electron/integrations/vault-apply.ts` | **Modificado.** Rutas de manifest/tombstones/README parametrizables | sí |
| `electron/integrations/agents-md-pointer.ts` | **Nuevo.** La línea idempotente en `AGENTS.md`/`CLAUDE.md` | sí |
| `electron/memory-store.ts` | **Modificado.** `synchronous = FULL` | sí |
| `electron/main.ts` | **Modificado.** Orquestación del pase + IPC | sí |
| `electron/preload.ts` | **Modificado.** Exponer los canales nuevos | — |
| `src/components/TeamThreadGraph.tsx` | **Nuevo.** SVG a mano | — |
| `src/components/TeamThreadCard.tsx` | **Nuevo.** Toggle por proyecto | — |

---

### Task 1: El render de una nota de rama y del índice

**Files:**
- Create: `electron/integrations/team-thread-note.ts`
- Test: `electron/__tests__/team-thread-note.test.ts`

**Interfaces:**
- Consumes: `MemoryRecord` de `./memory-port`; `vaultSlug` de `./vault-naming`.
- Produces: `type EstadoRama`, `const TEAM_THREAD_VERSION`, `function renderBranchNote(input: BranchNoteInput): string`, `function renderThreadIndex(input: ThreadIndexInput): string`, `function branchSlug(branch: string | null): string`.

- [ ] **Step 1: Write the failing test**

```typescript
// electron/__tests__/team-thread-note.test.ts
import { describe, it, expect } from 'vitest'
import { renderBranchNote, renderThreadIndex, branchSlug } from '../integrations/team-thread-note'
import type { MemoryRecord } from '../integrations/memory-port'

function record(over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    syncId: 'obs-aaaaaaaaaaaaaaaa',
    projectKey: 'proj1111aaaaaaaa',
    scope: 'team',
    topicKey: null,
    type: 'handoff',
    title: 'Segunda vuelta del sidebar',
    content: 'El repo va debajo de las pestanas.',
    tags: [],
    source: 'hook',
    originAi: 'claude',
    originAccount: 'Gero Personal',
    gitBranch: 'feat/sidebar-tabs',
    authorDisplay: 'Gero',
    sourceRef: null,
    contentHash: 'hash-v1',
    revisionCount: 0,
    duplicateCount: 0,
    createdAt: Date.UTC(2026, 8, 7, 14, 20),
    updatedAt: Date.UTC(2026, 8, 7, 14, 20),
    deleted: false,
    supersededBy: null,
    ...over,
  }
}

describe('branchSlug', () => {
  it('convierte una rama con barra en un slug de un solo segmento', () => {
    expect(branchSlug('feat/sidebar-tabs')).toBe('feat-sidebar-tabs')
  })

  it('las filas sin rama caen en general', () => {
    expect(branchSlug(null)).toBe('general')
  })
})

describe('renderBranchNote', () => {
  it('pone las entradas de la mas nueva a la mas vieja, con autor y fecha', () => {
    const nota = renderBranchNote({
      branch: 'feat/sidebar-tabs',
      estado: 'activa',
      entries: [
        record({ syncId: 'obs-1', createdAt: Date.UTC(2026, 8, 7, 2, 10), title: 'Tipografia', content: 'Inter nunca estuvo empaquetada.' }),
        record({ syncId: 'obs-2', createdAt: Date.UTC(2026, 8, 7, 14, 20), title: 'Segunda vuelta', content: 'El repo va debajo.' }),
      ],
      neighbours: ['memory-bridge'],
    })

    const posSegunda = nota.indexOf('Segunda vuelta')
    const posTipografia = nota.indexOf('Tipografia')
    expect(posSegunda).toBeGreaterThan(-1)
    expect(posSegunda).toBeLessThan(posTipografia)
    expect(nota).toContain('2026-09-07 14:20 · Gero')
    expect(nota).toContain('[[general]]')
    expect(nota).toContain('[[memory-bridge]]')
  })

  it('el frontmatter lleva estado y ultima entrada, y NO lleva marca de sync', () => {
    const nota = renderBranchNote({
      branch: 'feat/sidebar-tabs',
      estado: 'cerrada',
      entries: [record({ createdAt: Date.UTC(2026, 8, 7, 14, 20) })],
      neighbours: [],
    })

    expect(nota).toContain('nest_scope: "team"')
    expect(nota).toContain('nest_estado: "cerrada"')
    expect(nota).toContain('nest_ultima_entrada: "2026-09-07T14:20:00.000Z"')
    expect(nota).not.toContain('nest_ultima_sync')
  })

  it('una fila con content null no rompe el render', () => {
    const nota = renderBranchNote({
      branch: 'main',
      estado: 'activa',
      entries: [record({ content: null })],
      neighbours: [],
    })
    expect(nota).toContain('# main')
  })
})

describe('renderThreadIndex', () => {
  it('lista una linea por rama, la mas reciente primero, y lleva la marca de sync al minuto', () => {
    const indice = renderThreadIndex({
      displayName: 'raven-nest',
      ultimaSync: Date.UTC(2026, 8, 8, 14, 22, 47),
      branches: [
        { slug: 'memory-bridge', branch: 'smoke/memory-bridge', estado: 'activa', ultimoAutor: 'Gero', ultimaEntrada: Date.UTC(2026, 8, 6, 10, 0), entradas: 3 },
        { slug: 'feat-sidebar-tabs', branch: 'feat/sidebar-tabs', estado: 'activa', ultimoAutor: 'Bauti', ultimaEntrada: Date.UTC(2026, 8, 7, 14, 20), entradas: 2 },
      ],
    })

    expect(indice).toContain('nest_ultima_sync: "2026-09-08T14:22:00.000Z"')
    const posSidebar = indice.indexOf('[[feat-sidebar-tabs]]')
    const posBridge = indice.indexOf('[[memory-bridge]]')
    expect(posSidebar).toBeLessThan(posBridge)
    expect(indice).toContain('Bauti')
  })

  it('avisa cuando recorta por el techo de lineas', () => {
    const branches = Array.from({ length: 260 }, (_, i) => ({
      slug: `rama-${i}`,
      branch: `feat/rama-${i}`,
      estado: 'activa' as const,
      ultimoAutor: 'Gero',
      ultimaEntrada: i,
      entradas: 1,
    }))
    const indice = renderThreadIndex({ displayName: 'raven-nest', ultimaSync: 0, branches })

    expect(indice.split('\n').length).toBeLessThanOrEqual(200)
    expect(indice).toContain('recortado por recencia')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/team-thread-note.test.ts`
Expected: FAIL — `Failed to resolve import "../integrations/team-thread-note"`

- [ ] **Step 3: Write minimal implementation**

```typescript
// electron/integrations/team-thread-note.ts
// Render de una nota del hilo de equipo. Puro, sin fs. Ver spec §4.2.
//
// A diferencia del vault personal (una nota por observacion), aca la unidad es la RAMA:
// una nota agrupa todas las entradas de esa rama, en orden cronologico inverso.
import type { MemoryRecord } from './memory-port'
import { vaultSlug } from './vault-naming'

export const TEAM_THREAD_VERSION = 1

/** Techo del indice: es lo que se inyecta en cada sesion, ver spec §4.3. */
export const INDEX_MAX_LINES = 200

export type EstadoRama = 'activa' | 'sin-worktree' | 'cerrada'

export interface BranchNoteInput {
  branch: string | null
  estado: EstadoRama
  /** Todas las filas de esa rama; se ordenan aca, el caller no necesita hacerlo. */
  entries: MemoryRecord[]
  /** Slugs de otras notas del hilo, para los wikilinks. */
  neighbours: string[]
}

export interface ThreadIndexBranch {
  slug: string
  branch: string
  estado: EstadoRama
  ultimoAutor: string
  ultimaEntrada: number
  entradas: number
}

export interface ThreadIndexInput {
  displayName: string
  /** ms epoch. Se redondea al minuto a proposito: ver spec §4.2. */
  ultimaSync: number
  branches: ThreadIndexBranch[]
}

function emitString(value: string): string {
  return JSON.stringify(value)
}

/** `feat/sidebar-tabs` -> `feat-sidebar-tabs`. Las filas sin rama van a `general`. */
export function branchSlug(branch: string | null): string {
  if (branch === null || branch.trim() === '') return 'general'
  return vaultSlug(branch)
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** Al minuto: una marca al segundo cambiaria en cada pasada y anularia el hash-compare. */
function isoAlMinuto(ms: number): string {
  return new Date(Math.floor(ms / 60_000) * 60_000).toISOString()
}

function fecha(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

export function renderBranchNote(input: BranchNoteInput): string {
  const { branch, estado, entries, neighbours } = input
  const slug = branchSlug(branch)
  const titulo = branch ?? 'general'

  // Mas nueva primero: lo que le interesa a alguien que se esta poniendo al dia.
  const ordenadas = [...entries].sort((a, b) => b.createdAt - a.createdAt)
  const ultimaEntrada = ordenadas.length > 0 ? ordenadas[0].createdAt : 0

  const enlaces = ['[[_index]]', ...neighbours.filter((n) => n !== slug).map((n) => `[[${n}]]`)]

  const lines: string[] = ['---']
  lines.push(`nest_scope: ${emitString('team')}`)
  lines.push(`nest_rama: ${emitString(titulo)}`)
  lines.push(`nest_estado: ${emitString(estado)}`)
  lines.push(`nest_ultima_entrada: ${emitString(iso(ultimaEntrada))}`)
  lines.push(`nest_version: ${TEAM_THREAD_VERSION}`)
  lines.push(`nest_generated: true`)
  lines.push('---', '')
  lines.push(`# ${titulo}`, '')
  lines.push(enlaces.join(' · '), '')

  for (const e of ordenadas) {
    lines.push(`## ${fecha(e.createdAt)} · ${e.authorDisplay ?? 'desconocido'}`)
    lines.push('')
    if (e.title) lines.push(`**${e.title}**`, '')
    if (e.content) lines.push(e.content.trim(), '')
  }

  return lines.join('\n')
}

export function renderThreadIndex(input: ThreadIndexInput): string {
  const { displayName, ultimaSync, branches } = input
  const ordenadas = [...branches].sort((a, b) => b.ultimaEntrada - a.ultimaEntrada)

  const head: string[] = ['---']
  head.push(`nest_scope: ${emitString('team')}`)
  head.push(`nest_proyecto: ${emitString(displayName)}`)
  head.push(`nest_ultima_sync: ${emitString(isoAlMinuto(ultimaSync))}`)
  head.push(`nest_version: ${TEAM_THREAD_VERSION}`)
  head.push('---', '')
  head.push(`# ${displayName} — hilo del equipo`, '')

  const cuerpo: string[] = []
  // Se reservan las 2 lineas del aviso de recorte MAS la que agrega el '\n' final, para
  // que `split('\n').length` respete el techo de verdad y no por uno.
  const techo = INDEX_MAX_LINES - head.length - 3
  const visibles = ordenadas.slice(0, Math.max(techo, 0))

  for (const b of visibles) {
    const marca = b.estado === 'activa' ? '' : ` _(${b.estado})_`
    cuerpo.push(`- [[${b.slug}]] — ${b.branch}${marca} · ${b.ultimoAutor} · ${b.entradas} entrada(s)`)
  }

  const pie: string[] = []
  if (visibles.length < ordenadas.length) {
    pie.push('', `_${ordenadas.length - visibles.length} rama(s) mas: recortado por recencia._`)
  }

  return [...head, ...cuerpo, ...pie].join('\n') + '\n'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/team-thread-note.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/team-thread-note.ts electron/__tests__/team-thread-note.test.ts
git commit -m "feat(team-thread): render de la nota de rama y del indice"
```

---

### Task 2: El planner puro

**Files:**
- Create: `electron/integrations/team-thread-plan.ts`
- Test: `electron/__tests__/team-thread-plan.test.ts`

**Interfaces:**
- Consumes: `renderBranchNote`, `renderThreadIndex`, `branchSlug`, `EstadoRama` (Task 1); `VaultManifest`, `VaultPlan` de `./vault-plan`; `redact` de `../memory-redaction`.
- Produces: `const DEFAULT_THREAD_TYPES: ObservationType[]`, `function branchNoteId(slug: string): string`, `function planTeamThread(input: PlanTeamThreadInput): VaultPlan`, `interface TeamThreadConfig`.

- [ ] **Step 1: Write the failing test**

```typescript
// electron/__tests__/team-thread-plan.test.ts
import { describe, it, expect } from 'vitest'
import { planTeamThread, branchNoteId, DEFAULT_THREAD_TYPES, type TeamThreadConfig } from '../integrations/team-thread-plan'
import { emptyManifest } from '../integrations/vault-plan'
import type { MemoryRecord } from '../integrations/memory-port'

function record(over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    syncId: 'obs-aaaaaaaaaaaaaaaa',
    projectKey: 'proj1111aaaaaaaa',
    scope: 'team',
    topicKey: null,
    type: 'handoff',
    title: 'Un handoff',
    content: 'Cuerpo del handoff.',
    tags: [],
    source: 'hook',
    originAi: 'claude',
    originAccount: 'Gero Personal',
    gitBranch: 'feat/sidebar-tabs',
    authorDisplay: 'Gero',
    sourceRef: null,
    contentHash: 'hash-v1',
    revisionCount: 0,
    duplicateCount: 0,
    createdAt: 1000,
    updatedAt: 1000,
    deleted: false,
    supersededBy: null,
    ...over,
  }
}

const CONFIG: TeamThreadConfig = {
  projectKey: 'proj1111aaaaaaaa',
  displayName: 'raven-nest',
  includedTypes: DEFAULT_THREAD_TYPES,
  branchStates: { 'feat/sidebar-tabs': 'activa' },
  ultimaSync: 5000,
}

describe('planTeamThread', () => {
  it('EL GUARDIA: una fila personal o project NUNCA entra al hilo del equipo', () => {
    const plan = planTeamThread({
      records: [
        record({ syncId: 'obs-personal', scope: 'personal' }),
        record({ syncId: 'obs-project', scope: 'project' }),
      ],
      manifest: emptyManifest(),
      config: CONFIG,
      onDiskHashes: {},
    })

    expect(plan.writes).toHaveLength(0)
  })

  it('agrupa por rama: una nota por rama, no una por fila', () => {
    const plan = planTeamThread({
      records: [
        record({ syncId: 'obs-1', gitBranch: 'feat/sidebar-tabs' }),
        record({ syncId: 'obs-2', gitBranch: 'feat/sidebar-tabs' }),
        record({ syncId: 'obs-3', gitBranch: 'main' }),
      ],
      manifest: emptyManifest(),
      config: { ...CONFIG, branchStates: { 'feat/sidebar-tabs': 'activa', main: 'activa' } },
      onDiskHashes: {},
    })

    expect(plan.writes).toHaveLength(2)
    expect(plan.writes.map((w) => w.filePath).sort()).toEqual(['ramas/feat-sidebar-tabs.md', 'ramas/main.md'])
    expect(plan.writes.find((w) => w.filePath === 'ramas/feat-sidebar-tabs.md')!.syncId).toBe(branchNoteId('feat-sidebar-tabs'))
  })

  it('CONCURRENCIA: dos autores en la misma rama el mismo dia conservan sus dos entradas', () => {
    const plan = planTeamThread({
      records: [
        record({ syncId: 'obs-gero', authorDisplay: 'Gero', content: 'Lo de Gero', createdAt: 1000 }),
        record({ syncId: 'obs-bauti', authorDisplay: 'Bauti', content: 'Lo de Bauti', createdAt: 2000 }),
      ],
      manifest: emptyManifest(),
      config: CONFIG,
      onDiskHashes: {},
    })

    const nota = plan.writes[0].content
    expect(nota).toContain('Lo de Gero')
    expect(nota).toContain('Lo de Bauti')
    expect(nota).toContain('Gero')
    expect(nota).toContain('Bauti')
  })

  it('las filas sin rama van a general.md', () => {
    const plan = planTeamThread({
      records: [record({ gitBranch: null })],
      manifest: emptyManifest(),
      config: CONFIG,
      onDiskHashes: {},
    })

    expect(plan.writes.map((w) => w.filePath)).toEqual(['general.md'])
  })

  it('solo entran los tipos incluidos', () => {
    const plan = planTeamThread({
      records: [
        record({ syncId: 'obs-h', type: 'handoff' }),
        record({ syncId: 'obs-b', type: 'bugfix' }),
      ],
      manifest: emptyManifest(),
      config: CONFIG,
      onDiskHashes: {},
    })

    expect(plan.writes).toHaveLength(1)
    expect(plan.writes[0].content).not.toContain('obs-b')
  })

  it('no reescribe si nada cambio (hash-compare)', () => {
    const primera = planTeamThread({
      records: [record()],
      manifest: emptyManifest(),
      config: CONFIG,
      onDiskHashes: {},
    })
    const w = primera.writes[0]
    const manifest = { entries: { [w.syncId]: { filePath: w.filePath, sourceHash: w.sourceHash, fileHash: w.fileHash } } }

    const segunda = planTeamThread({
      records: [record()],
      manifest,
      config: CONFIG,
      onDiskHashes: { [w.filePath]: w.fileHash },
    })

    expect(segunda.writes).toHaveLength(0)
  })

  it('preserva los bytes del usuario si edito el archivo a mano', () => {
    const primera = planTeamThread({ records: [record()], manifest: emptyManifest(), config: CONFIG, onDiskHashes: {} })
    const w = primera.writes[0]
    const manifest = { entries: { [w.syncId]: { filePath: w.filePath, sourceHash: w.sourceHash, fileHash: w.fileHash } } }

    const segunda = planTeamThread({
      records: [record({ contentHash: 'hash-v2', content: 'Cuerpo nuevo.' })],
      manifest,
      config: CONFIG,
      onDiskHashes: { [w.filePath]: 'hash-de-lo-que-escribio-el-usuario' },
    })

    expect(segunda.conflicts).toHaveLength(1)
    expect(segunda.conflicts[0].conflictPath).toBe('ramas/_conflicts/feat-sidebar-tabs.md')
  })

  it('borra la nota de una rama que se quedo sin filas', () => {
    const manifest = {
      entries: { [branchNoteId('rama-vieja')]: { filePath: 'ramas/rama-vieja.md', sourceHash: 'h', fileHash: 'f' } },
    }
    const plan = planTeamThread({ records: [record()], manifest, config: CONFIG, onDiskHashes: {} })

    expect(plan.deletes.map((d) => d.filePath)).toContain('ramas/rama-vieja.md')
  })

  it('una fila con pinta de secreto queda advertida', () => {
    const plan = planTeamThread({
      records: [record({ content: 'el token es ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })],
      manifest: emptyManifest(),
      config: CONFIG,
      onDiskHashes: {},
    })

    expect(plan.warnings.some((w) => w.kind === 'possible-secret')).toBe(true)
  })

  it('siempre emite el indice cuando algo cambio', () => {
    const plan = planTeamThread({ records: [record()], manifest: emptyManifest(), config: CONFIG, onDiskHashes: {} })
    expect(plan.indexWrites.map((i) => i.filePath)).toEqual(['_index.md'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/team-thread-plan.test.ts`
Expected: FAIL — `Failed to resolve import "../integrations/team-thread-plan"`

- [ ] **Step 3: Write minimal implementation**

```typescript
// electron/integrations/team-thread-plan.ts
// El corazon de Layer 2: filas de scope `team` -> VaultPlan. Puro, sin fs, para que aca
// viva el grueso de los tests. Ver spec §5 y §6.
//
// Por que un modulo nuevo y no un flag en vault-plan.ts: ese modulo EXCLUYE el scope team
// por decision de producto (privacidad de companeros, Task 5 del vault). Un bug de config
// ahi filtraria notas de companeros al vault personal. Aca la separacion la garantiza la
// estructura, no un booleano.
import { createHash } from 'crypto'
import type { ObservationType } from '../memory-protocol'
import { redact } from '../memory-redaction'
import type { MemoryRecord } from './memory-port'
import {
  branchSlug,
  renderBranchNote,
  renderThreadIndex,
  type EstadoRama,
  type ThreadIndexBranch,
} from './team-thread-note'
import type {
  VaultConflict,
  VaultDelete,
  VaultIndexWrite,
  VaultManifest,
  VaultPlan,
  VaultWarning,
  VaultWrite,
} from './vault-plan'

/** Spec §6.1: por default solo el hilo, no toda la memoria del equipo. */
export const DEFAULT_THREAD_TYPES: ObservationType[] = ['handoff', 'decision']

export interface TeamThreadConfig {
  projectKey: string
  displayName: string
  includedTypes: ObservationType[]
  /** Estado de cada rama, consultado a git por el caller: este modulo no toca git. */
  branchStates: Record<string, EstadoRama>
  /** ms epoch del ultimo push exitoso. Solo va al indice (spec §4.2). */
  ultimaSync: number
}

export interface PlanTeamThreadInput {
  records: MemoryRecord[]
  manifest: VaultManifest
  config: TeamThreadConfig
  onDiskHashes: Record<string, string>
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** El id sintetico estable que ocupa el lugar del `syncId` del vault. Spec §4.1. */
export function branchNoteId(slug: string): string {
  return `rama:${slug}`
}

function filePathFor(slug: string): string {
  return slug === 'general' ? 'general.md' : `ramas/${slug}.md`
}

function conflictPathFor(filePath: string): string {
  const slash = filePath.lastIndexOf('/')
  const dir = slash === -1 ? '' : filePath.slice(0, slash + 1)
  const name = slash === -1 ? filePath : filePath.slice(slash + 1)
  return `${dir}_conflicts/${name}`
}

export function planTeamThread(input: PlanTeamThreadInput): VaultPlan {
  const { records, manifest, config, onDiskHashes } = input

  const writes: VaultWrite[] = []
  const deletes: VaultDelete[] = []
  const conflicts: VaultConflict[] = []
  const warnings: VaultWarning[] = []
  const indexWrites: VaultIndexWrite[] = []

  const tipos = new Set(config.includedTypes)

  // EL GUARDIA (spec §9, test 1): solo scope team, solo este proyecto, solo tipos del
  // hilo, sin tombstones ni superseded. Todo lo demas no existe para este modulo.
  const elegibles = records.filter(
    (r) =>
      r.scope === 'team' &&
      r.projectKey === config.projectKey &&
      tipos.has(r.type) &&
      !r.deleted &&
      r.supersededBy === null,
  )

  const porRama = new Map<string, MemoryRecord[]>()
  for (const r of elegibles) {
    const slug = branchSlug(r.gitBranch)
    const bucket = porRama.get(slug)
    if (bucket) bucket.push(r)
    else porRama.set(slug, [r])
  }

  const slugs = [...porRama.keys()].sort()
  const ramasDelIndice: ThreadIndexBranch[] = []
  let algoCambio = false

  for (const [slug, entries] of porRama) {
    const branch = entries[0].gitBranch
    const estado = (branch ? config.branchStates[branch] : undefined) ?? 'sin-worktree'

    for (const e of entries) {
      const { redacted } = redact(`${e.title}\n${e.content ?? ''}`)
      if (redacted) {
        warnings.push({
          syncId: e.syncId,
          kind: 'possible-secret',
          message: `"${e.title}" matchea un patron de secreto conocido — no se comparte hasta que la confirmes.`,
        })
      }
    }

    const content = renderBranchNote({ branch, estado, entries, neighbours: slugs })
    const fileHash = sha256(content)
    // El sourceHash del grupo: si ninguna fila cambio y el estado tampoco, la nota no se
    // toca. Incluye el estado a proposito, porque cambia sin que cambie ninguna fila.
    const sourceHash = sha256(
      [...entries].sort((a, b) => a.syncId.localeCompare(b.syncId)).map((e) => e.contentHash).join('|') + `|${estado}`,
    )

    const id = branchNoteId(slug)
    const filePath = filePathFor(slug)
    const previous = manifest.entries[id]

    const ordenadas = [...entries].sort((a, b) => b.createdAt - a.createdAt)
    ramasDelIndice.push({
      slug,
      branch: branch ?? 'general',
      estado,
      ultimoAutor: ordenadas[0].authorDisplay ?? 'desconocido',
      ultimaEntrada: ordenadas[0].createdAt,
      entradas: entries.length,
    })

    if (previous) {
      const onDisk = onDiskHashes[previous.filePath]
      if (onDisk !== undefined && onDisk !== previous.fileHash) {
        conflicts.push({
          syncId: id,
          filePath: previous.filePath,
          conflictPath: conflictPathFor(previous.filePath),
          freshContent: content,
          freshFileHash: fileHash,
          freshSourceHash: sourceHash,
          freshPath: filePath,
        })
        algoCambio = true
        continue
      }
      if (previous.sourceHash === sourceHash && previous.filePath === filePath) continue
    }

    writes.push({ syncId: id, filePath, content, fileHash, sourceHash })
    algoCambio = true
  }

  // Una rama que se quedo sin filas (o que dejo de ser elegible) pierde su nota.
  const vivos = new Set([...porRama.keys()].map(branchNoteId))
  for (const [id, entry] of Object.entries(manifest.entries)) {
    if (!id.startsWith('rama:')) continue
    if (vivos.has(id)) continue
    deletes.push({ syncId: id, filePath: entry.filePath, reason: 'excluded' })
    algoCambio = true
  }

  if (algoCambio) {
    indexWrites.push({
      filePath: '_index.md',
      content: renderThreadIndex({
        displayName: config.displayName,
        ultimaSync: config.ultimaSync,
        branches: ramasDelIndice,
      }),
    })
  }

  return { writes, moves: [], deletes, conflicts, warnings, indexWrites, readme: README_HILO }
}

const README_HILO = `# Hilo del equipo — Nest

**Esta carpeta es un espejo. Nest la regenera. Lo que edites aca no vuelve a Nest: se
preserva en \`_conflicts/\`, no se aplica.**

- \`_index.md\` — una linea por rama, la mas reciente primero.
- \`ramas/\` — una nota por rama, con las entradas de mas nueva a mas vieja.
- \`general.md\` — lo que no esta atado a una rama.
- No entra a git: cada maquina la regenera de su propia memoria sincronizada.
`
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/team-thread-plan.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/team-thread-plan.ts electron/__tests__/team-thread-plan.test.ts
git commit -m "feat(team-thread): planner puro — agrupa por rama y emite un VaultPlan"
```

---

### Task 3: Parametrizar dónde `vault-apply` deja su contabilidad

**Files:**
- Modify: `electron/integrations/vault-apply.ts:9-11` (constantes), `:32`, `:41`, `:87`, `:143-145`
- Test: `electron/__tests__/vault-apply.test.ts` (agregar un caso)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `interface VaultApplyPaths { manifest: string; tombstones: string; readme: string }`, `const DEFAULT_APPLY_PATHS: VaultApplyPaths`, y las firmas ampliadas `readManifest(rootDir, paths?)`, `computeOnDiskHashes(rootDir, manifest)` (sin cambios), `applyVaultPlan(rootDir, plan, paths?)`.

El hilo del equipo no puede dejar su manifest en `.nest-vault/`, que es del vault personal. Se parametriza con los valores actuales como default, así el vault no cambia de comportamiento.

- [ ] **Step 1: Write the failing test**

```typescript
// Agregar al final de electron/__tests__/vault-apply.test.ts
import { DEFAULT_APPLY_PATHS } from '../integrations/vault-apply'

describe('rutas de contabilidad parametrizables', () => {
  it('por default deja el manifest donde siempre', () => {
    expect(DEFAULT_APPLY_PATHS.manifest).toBe('.nest-vault/manifest.json')
  })

  it('respeta rutas propias y no pisa las del vault', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'team-thread-'))
    const paths = { manifest: '.manifest.json', tombstones: '.tombstones.jsonl', readme: 'README.md' }

    const plan = {
      writes: [{ syncId: 'rama:main', filePath: 'ramas/main.md', content: '# main\n', fileHash: 'fh', sourceHash: 'sh' }],
      moves: [],
      deletes: [],
      conflicts: [],
      warnings: [],
      indexWrites: [],
      readme: '# hilo\n',
    }

    await applyVaultPlan(rootDir, plan, paths)

    expect(existsSync(join(rootDir, '.manifest.json'))).toBe(true)
    expect(existsSync(join(rootDir, '.nest-vault', 'manifest.json'))).toBe(false)
    expect(readManifest(rootDir, paths).entries['rama:main'].filePath).toBe('ramas/main.md')
  })
})
```

> Si `mkdtempSync`, `tmpdir`, `join`, `existsSync`, `applyVaultPlan` o `readManifest` no
> están ya importados en ese archivo, agregalos a los imports del tope.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/vault-apply.test.ts`
Expected: FAIL — `DEFAULT_APPLY_PATHS` no existe / `applyVaultPlan` recibe 2 argumentos

- [ ] **Step 3: Write minimal implementation**

En `electron/integrations/vault-apply.ts`, reemplazar las dos constantes de ruta por un objeto y pasarlo por parámetro:

```typescript
// Reemplaza:
//   const MANIFEST_REL_PATH = '.nest-vault/manifest.json'
//   const TOMBSTONES_REL_PATH = '.nest-vault/tombstones.jsonl'
export interface VaultApplyPaths {
  manifest: string
  tombstones: string
  readme: string
}

/** Lo que usaba el vault antes de que esto fuera parametrizable. No cambiar. */
export const DEFAULT_APPLY_PATHS: VaultApplyPaths = {
  manifest: '.nest-vault/manifest.json',
  tombstones: '.nest-vault/tombstones.jsonl',
  readme: 'README.md',
}
```

Después, en las cuatro funciones que las usaban:

```typescript
export function readManifest(rootDir: string, paths: VaultApplyPaths = DEFAULT_APPLY_PATHS): VaultManifest {
  try {
    const raw = readFileSync(abs(rootDir, paths.manifest), 'utf8')
    const data = JSON.parse(raw) as { entries?: Record<string, VaultManifestEntry> }
    return { entries: data.entries && typeof data.entries === 'object' ? data.entries : {} }
  } catch {
    return { entries: {} }
  }
}

function writeManifest(rootDir: string, manifest: VaultManifest, paths: VaultApplyPaths): void {
  writeFileAtomic(abs(rootDir, paths.manifest), JSON.stringify(manifest, null, 2))
}

function appendTombstones(
  rootDir: string,
  entries: Array<{ syncId: string; deletedAt: number; file: string }>,
  paths: VaultApplyPaths,
): void {
  if (entries.length === 0) return
  const path = abs(rootDir, paths.tombstones)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
}

export async function applyVaultPlan(
  rootDir: string,
  plan: VaultPlan,
  paths: VaultApplyPaths = DEFAULT_APPLY_PATHS,
): Promise<{ manifest: VaultManifest; result: VaultApplyResult }> {
  const manifest = readManifest(rootDir, paths)
  // ... cuerpo sin cambios hasta el final ...
```

Y al final de `applyVaultPlan`, las tres últimas escrituras:

```typescript
  writeFileAtomic(abs(rootDir, paths.readme), plan.readme)
  appendTombstones(rootDir, tombstoneEntries, paths)
  writeManifest(rootDir, manifest, paths)
```

- [ ] **Step 4: Run the whole vault suite to verify nothing regressed**

Run: `npx vitest run electron/__tests__/vault-apply.test.ts electron/__tests__/vault-plan.test.ts electron/__tests__/vault-config.test.ts electron/__tests__/vault-naming.test.ts electron/__tests__/vault-note.test.ts`
Expected: PASS — todos los tests previos del vault siguen verdes (el default preserva el comportamiento)

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/vault-apply.ts electron/__tests__/vault-apply.test.ts
git commit -m "refactor(vault-apply): rutas de contabilidad por parametro, con los valores de hoy como default"
```

---

### Task 4: Settings del hilo por proyecto

**Files:**
- Create: `electron/integrations/team-thread-config.ts`
- Test: `electron/__tests__/team-thread-config.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_THREAD_TYPES` (Task 2).
- Produces: `interface TeamThreadSettings { enabled: boolean; includedTypes: ObservationType[]; writeAgentsPointer: boolean }`, `function loadTeamThreadSettings(path: string, projectKey: string): TeamThreadSettings`, `function saveTeamThreadSettings(path: string, projectKey: string, patch: Partial<TeamThreadSettings>): TeamThreadSettings`.

- [ ] **Step 1: Write the failing test**

```typescript
// electron/__tests__/team-thread-config.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadTeamThreadSettings, saveTeamThreadSettings } from '../integrations/team-thread-config'

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-config-'))
  path = join(dir, 'team-thread.json')
})

describe('loadTeamThreadSettings', () => {
  it('el default es conservador: apagado', () => {
    const s = loadTeamThreadSettings(path, 'proj1')
    expect(s.enabled).toBe(false)
    expect(s.includedTypes).toEqual(['handoff', 'decision'])
    expect(s.writeAgentsPointer).toBe(true)
  })

  it('un archivo corrupto no rompe: cae al default', () => {
    writeFileSync(path, '{ esto no es json')
    expect(loadTeamThreadSettings(path, 'proj1').enabled).toBe(false)
  })

  it('cada proyecto tiene su propia config', () => {
    saveTeamThreadSettings(path, 'proj1', { enabled: true })
    expect(loadTeamThreadSettings(path, 'proj1').enabled).toBe(true)
    expect(loadTeamThreadSettings(path, 'proj2').enabled).toBe(false)
  })
})

describe('saveTeamThreadSettings', () => {
  it('el patch es parcial y no pisa lo que no toca', () => {
    saveTeamThreadSettings(path, 'proj1', { enabled: true, includedTypes: ['handoff', 'decision', 'architecture'] })
    const s = saveTeamThreadSettings(path, 'proj1', { writeAgentsPointer: false })
    expect(s.enabled).toBe(true)
    expect(s.includedTypes).toEqual(['handoff', 'decision', 'architecture'])
    expect(s.writeAgentsPointer).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/team-thread-config.test.ts`
Expected: FAIL — `Failed to resolve import "../integrations/team-thread-config"`

- [ ] **Step 3: Write minimal implementation**

```typescript
// electron/integrations/team-thread-config.ts
// Settings del hilo de equipo, por proyecto. Un solo JSON con un objeto por projectKey.
// El default es apagado a proposito (spec §3, decision 2): compartir es opt-in.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { ObservationType } from '../memory-protocol'
import { DEFAULT_THREAD_TYPES } from './team-thread-plan'

export interface TeamThreadSettings {
  enabled: boolean
  includedTypes: ObservationType[]
  /** La linea en AGENTS.md/CLAUDE.md. Es el unico artefacto que toca un archivo
   *  versionado del usuario, por eso tiene su propio interruptor (spec §10.2). */
  writeAgentsPointer: boolean
}

function defaults(): TeamThreadSettings {
  return { enabled: false, includedTypes: [...DEFAULT_THREAD_TYPES], writeAgentsPointer: true }
}

type Archivo = Record<string, Partial<TeamThreadSettings>>

function leerArchivo(path: string): Archivo {
  try {
    const raw = readFileSync(path, 'utf8')
    const data = JSON.parse(raw) as unknown
    return data && typeof data === 'object' ? (data as Archivo) : {}
  } catch {
    return {}
  }
}

export function loadTeamThreadSettings(path: string, projectKey: string): TeamThreadSettings {
  return { ...defaults(), ...(leerArchivo(path)[projectKey] ?? {}) }
}

export function saveTeamThreadSettings(
  path: string,
  projectKey: string,
  patch: Partial<TeamThreadSettings>,
): TeamThreadSettings {
  const archivo = leerArchivo(path)
  const merged: TeamThreadSettings = { ...defaults(), ...(archivo[projectKey] ?? {}), ...patch }
  archivo[projectKey] = merged
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(archivo, null, 2), 'utf8')
  return merged
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/team-thread-config.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/team-thread-config.ts electron/__tests__/team-thread-config.test.ts
git commit -m "feat(team-thread): settings por proyecto, apagado por default"
```

---

### Task 5: El puntero en `AGENTS.md` / `CLAUDE.md`

**Files:**
- Create: `electron/integrations/agents-md-pointer.ts`
- Test: `electron/__tests__/agents-md-pointer.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `const POINTER_MARKER: string`, `function ensureAgentsPointer(worktreePath: string): 'written' | 'already' | 'skipped'`, `function removeAgentsPointer(worktreePath: string): void`.

Spec §10.2. Es el único artefacto que toca un archivo versionado del usuario: una línea, con marcador, idempotente, best-effort y apagable.

- [ ] **Step 1: Write the failing test**

```typescript
// electron/__tests__/agents-md-pointer.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ensureAgentsPointer, removeAgentsPointer, POINTER_MARKER } from '../integrations/agents-md-pointer'

let wt: string

beforeEach(() => {
  wt = mkdtempSync(join(tmpdir(), 'pointer-'))
})

describe('ensureAgentsPointer', () => {
  it('agrega la linea al AGENTS.md que ya existe, sin tocar lo demas', () => {
    writeFileSync(join(wt, 'AGENTS.md'), '# Reglas del repo\n\nCorrer npm test.\n')
    expect(ensureAgentsPointer(wt)).toBe('written')

    const texto = readFileSync(join(wt, 'AGENTS.md'), 'utf8')
    expect(texto).toContain('# Reglas del repo')
    expect(texto).toContain('Correr npm test.')
    expect(texto).toContain(POINTER_MARKER)
    expect(texto).toContain('.nest/team/_index.md')
  })

  it('es idempotente: dos pasadas dejan UNA sola linea', () => {
    writeFileSync(join(wt, 'AGENTS.md'), '# Reglas\n')
    ensureAgentsPointer(wt)
    expect(ensureAgentsPointer(wt)).toBe('already')

    const texto = readFileSync(join(wt, 'AGENTS.md'), 'utf8')
    expect(texto.split(POINTER_MARKER)).toHaveLength(2)
  })

  it('si no hay AGENTS.md usa CLAUDE.md', () => {
    writeFileSync(join(wt, 'CLAUDE.md'), '# Instrucciones\n')
    expect(ensureAgentsPointer(wt)).toBe('written')
    expect(readFileSync(join(wt, 'CLAUDE.md'), 'utf8')).toContain('.nest/team/_index.md')
  })

  it('prefiere AGENTS.md cuando estan los dos', () => {
    writeFileSync(join(wt, 'AGENTS.md'), '# A\n')
    writeFileSync(join(wt, 'CLAUDE.md'), '# C\n')
    ensureAgentsPointer(wt)
    expect(readFileSync(join(wt, 'AGENTS.md'), 'utf8')).toContain(POINTER_MARKER)
    expect(readFileSync(join(wt, 'CLAUDE.md'), 'utf8')).not.toContain(POINTER_MARKER)
  })

  it('NO crea el archivo si no existe ninguno: no le inventamos convenciones al repo ajeno', () => {
    expect(ensureAgentsPointer(wt)).toBe('skipped')
    expect(existsSync(join(wt, 'AGENTS.md'))).toBe(false)
    expect(existsSync(join(wt, 'CLAUDE.md'))).toBe(false)
  })
})

describe('removeAgentsPointer', () => {
  it('saca la linea y deja el resto intacto', () => {
    writeFileSync(join(wt, 'AGENTS.md'), '# Reglas\n\nCorrer npm test.\n')
    ensureAgentsPointer(wt)
    removeAgentsPointer(wt)

    const texto = readFileSync(join(wt, 'AGENTS.md'), 'utf8')
    expect(texto).not.toContain(POINTER_MARKER)
    expect(texto).toContain('Correr npm test.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/agents-md-pointer.test.ts`
Expected: FAIL — `Failed to resolve import "../integrations/agents-md-pointer"`

- [ ] **Step 3: Write minimal implementation**

```typescript
// electron/integrations/agents-md-pointer.ts
// Una linea en AGENTS.md (o CLAUDE.md) apuntando al hilo del equipo. Spec §10.2.
//
// AGENTS.md esta bajo la Linux Foundation y lo soportan ~25 herramientas; con esta linea
// el hilo pasa a ser alcanzable por Cursor, Codex, Copilot, Zed y Aider, no solo por los
// CLIs donde provisionamos hooks.
//
// Reglas, porque este archivo es del USUARIO y esta versionado: una sola linea, con
// marcador para poder reconocerla, idempotente, y NO se crea el archivo si no existe.
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export const POINTER_MARKER = '<!-- nest:team-thread -->'

const POINTER_LINE = `${POINTER_MARKER} El contexto vivo del equipo para este repo esta en \`.nest/team/_index.md\` — leelo antes de empezar.`

const CANDIDATES = ['AGENTS.md', 'CLAUDE.md'] as const

function targetFile(worktreePath: string): string | null {
  for (const name of CANDIDATES) {
    const p = join(worktreePath, name)
    if (existsSync(p)) return p
  }
  return null
}

/**
 * Best-effort de punta a punta: que no se pueda escribir el puntero NUNCA puede impedir
 * que se escriba el hilo, que es lo que el usuario pidio. Mismo criterio que
 * `handoff.ts:excluirNestDelRepo`.
 */
export function ensureAgentsPointer(worktreePath: string): 'written' | 'already' | 'skipped' {
  try {
    const path = targetFile(worktreePath)
    if (!path) return 'skipped'

    const actual = readFileSync(path, 'utf8')
    if (actual.includes(POINTER_MARKER)) return 'already'

    const sep = actual === '' || actual.endsWith('\n') ? '' : '\n'
    writeFileSync(path, `${actual}${sep}\n${POINTER_LINE}\n`, 'utf8')
    return 'written'
  } catch (err) {
    console.warn('[team-thread] no se pudo escribir el puntero en AGENTS.md', err)
    return 'skipped'
  }
}

export function removeAgentsPointer(worktreePath: string): void {
  try {
    const path = targetFile(worktreePath)
    if (!path) return
    const actual = readFileSync(path, 'utf8')
    if (!actual.includes(POINTER_MARKER)) return
    const limpio = actual
      .split('\n')
      .filter((linea) => !linea.includes(POINTER_MARKER))
      .join('\n')
      .replace(/\n{3,}$/, '\n')
    writeFileSync(path, limpio, 'utf8')
  } catch (err) {
    console.warn('[team-thread] no se pudo quitar el puntero de AGENTS.md', err)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/agents-md-pointer.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/agents-md-pointer.ts electron/__tests__/agents-md-pointer.test.ts
git commit -m "feat(team-thread): puntero idempotente en AGENTS.md/CLAUDE.md"
```

---

### Task 6: `synchronous = FULL`

**Files:**
- Modify: `electron/memory-store.ts:503`
- Test: `electron/__tests__/memory-store.test.ts` (agregar un caso)

**Interfaces:**
- Consumes: nada.
- Produces: nada nuevo. Es un cambio de pragma.

Spec §8.3. Cierra el agujero de durabilidad ante corte de luz.

- [ ] **Step 1: Write the failing test**

```typescript
// Agregar a electron/__tests__/memory-store.test.ts, dentro del describe de constructor
it('el store corre en synchronous FULL: sobrevive a un corte de luz (spec Layer 2 §8.3)', () => {
  const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), 'ms-')), 'memory.db'))
  const db = (store as unknown as { db: { pragma(s: string, o?: { simple?: boolean }): unknown } }).db

  // 2 = FULL en SQLite. 1 = NORMAL, que es lo que habia antes.
  expect(db.pragma('synchronous', { simple: true })).toBe(2)
  expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
  store.close()
})
```

> Si `mkdtempSync` / `tmpdir` no están importados en ese archivo, agregalos. Si el helper
> del archivo ya crea stores temporales, usá ese helper en vez de construir uno a mano.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/memory-store.test.ts -t "synchronous FULL"`
Expected: FAIL — recibe `1` (NORMAL), esperaba `2`

- [ ] **Step 3: Write minimal implementation**

En `electron/memory-store.ts`, línea 503:

```typescript
    this.db.pragma('journal_mode = WAL')
    // FULL y no NORMAL: NORMAL aguanta que se caiga la app o el SO, pero un corte de luz
    // puede perder las ultimas transacciones — y con memoria de equipo eso es contexto que
    // un companero nunca va a recibir. La base escribe poco y chico, y con WAL el costo de
    // FULL es muy inferior al de rollback-journal. Spec Layer 2 §8.3.
    this.db.pragma('synchronous = FULL')
```

Y actualizar el comentario de `memory-store.ts:107`, que hoy documenta `synchronous = NORMAL`, para que no quede mintiendo.

- [ ] **Step 4: Run the full store suite**

Run: `npx vitest run electron/__tests__/memory-store.test.ts`
Expected: PASS — todo el suite, no sólo el caso nuevo

- [ ] **Step 5: Commit**

```bash
git add electron/memory-store.ts electron/__tests__/memory-store.test.ts
git commit -m "fix(memory-store): synchronous = FULL — sobrevivir al corte de luz"
```

---

### Task 7: El pase de regeneración del hilo

**Files:**
- Modify: `electron/main.ts` (junto a `runVaultRegeneration`, ~línea 3155)
- Modify: `electron/preload.ts:93-100` (canales nuevos)
- Test: `electron/__tests__/team-thread-run.test.ts`

**Interfaces:**
- Consumes: `planTeamThread`, `TeamThreadConfig` (Task 2); `applyVaultPlan`, `readManifest`, `computeOnDiskHashes` con `VaultApplyPaths` (Task 3); `loadTeamThreadSettings` (Task 4); `ensureAgentsPointer`, `removeAgentsPointer` (Task 5); `openReadonlyReader` de `./integrations/memory-readonly-reader`.
- Produces: `const TEAM_THREAD_PATHS: VaultApplyPaths`, `function teamThreadRootDir(worktreePath: string): string`, `function collectBranchStates(worktreePath: string, branches: string[]): Record<string, EstadoRama>`, e IPC `memory:teamThread:getSettings` / `setSettings` / `regenerate` / `read`.

- [ ] **Step 1: Write the failing test**

```typescript
// electron/__tests__/team-thread-run.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { planTeamThread, DEFAULT_THREAD_TYPES } from '../integrations/team-thread-plan'
import { applyVaultPlan, readManifest, computeOnDiskHashes } from '../integrations/vault-apply'
import { TEAM_THREAD_PATHS, teamThreadRootDir } from '../integrations/team-thread-paths'
import type { MemoryRecord } from '../integrations/memory-port'

let wt: string

beforeEach(() => {
  wt = mkdtempSync(join(tmpdir(), 'tt-run-'))
})

function record(over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    syncId: 'obs-1', projectKey: 'p1', scope: 'team', topicKey: null, type: 'handoff',
    title: 'Un handoff', content: 'Cuerpo.', tags: [], source: 'hook', originAi: 'claude',
    originAccount: 'Gero', gitBranch: 'main', authorDisplay: 'Gero', sourceRef: null,
    contentHash: 'h1', revisionCount: 0, duplicateCount: 0, createdAt: 1000, updatedAt: 1000,
    deleted: false, supersededBy: null, ...over,
  }
}

async function pasada(records: MemoryRecord[]): Promise<void> {
  const rootDir = teamThreadRootDir(wt)
  const manifest = readManifest(rootDir, TEAM_THREAD_PATHS)
  const plan = planTeamThread({
    records,
    manifest,
    config: { projectKey: 'p1', displayName: 'raven-nest', includedTypes: DEFAULT_THREAD_TYPES, branchStates: { main: 'activa' }, ultimaSync: 0 },
    onDiskHashes: computeOnDiskHashes(rootDir, manifest),
  })
  await applyVaultPlan(rootDir, plan, TEAM_THREAD_PATHS)
}

describe('el pase completo contra disco', () => {
  it('escribe el hilo dentro de .nest/team del worktree', async () => {
    await pasada([record()])

    expect(existsSync(join(wt, '.nest', 'team', '_index.md'))).toBe(true)
    expect(existsSync(join(wt, '.nest', 'team', 'ramas', 'main.md'))).toBe(true)
    expect(readFileSync(join(wt, '.nest', 'team', 'ramas', 'main.md'), 'utf8')).toContain('Gero')
  })

  it('la contabilidad NO cae en .nest-vault: esa carpeta es del vault personal', async () => {
    await pasada([record()])

    expect(existsSync(join(wt, '.nest', 'team', '.manifest.json'))).toBe(true)
    expect(existsSync(join(wt, '.nest', 'team', '.nest-vault'))).toBe(false)
  })

  it('una segunda pasada sin cambios no reescribe nada', async () => {
    await pasada([record()])
    const antes = readFileSync(join(wt, '.nest', 'team', '.manifest.json'), 'utf8')
    await pasada([record()])
    expect(readFileSync(join(wt, '.nest', 'team', '.manifest.json'), 'utf8')).toBe(antes)
  })

  it('preserva los bytes del usuario si edito la nota a mano', async () => {
    await pasada([record()])
    writeFileSync(join(wt, '.nest', 'team', 'ramas', 'main.md'), 'ESTO LO ESCRIBI YO\n')
    await pasada([record({ contentHash: 'h2', content: 'Cuerpo nuevo.' })])

    expect(readFileSync(join(wt, '.nest', 'team', 'ramas', '_conflicts', 'main.md'), 'utf8')).toContain('ESTO LO ESCRIBI YO')
    expect(readFileSync(join(wt, '.nest', 'team', 'ramas', 'main.md'), 'utf8')).toContain('Cuerpo nuevo.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/team-thread-run.test.ts`
Expected: FAIL — `Failed to resolve import "../integrations/team-thread-paths"`

- [ ] **Step 3: Write the paths module**

```typescript
// electron/integrations/team-thread-paths.ts
// Donde vive el hilo y donde deja su contabilidad. Modulo aparte y chiquito para que los
// tests puedan usarlo sin arrastrar `main.ts` entero.
import { join } from 'path'
import type { VaultApplyPaths } from './vault-apply'

/** Ocultas para que Obsidian las ignore, igual que `.nest-vault/` en el vault personal. */
export const TEAM_THREAD_PATHS: VaultApplyPaths = {
  manifest: '.manifest.json',
  tombstones: '.tombstones.jsonl',
  readme: 'README.md',
}

/** Uno por worktree, completo (spec §3, decision 7). */
export function teamThreadRootDir(worktreePath: string): string {
  return join(worktreePath, '.nest', 'team')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/team-thread-run.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire it into main.ts**

Agregar junto a `runVaultRegeneration` (después de la línea ~3182). Reusa `excluirNestDelRepo`, que ya está en `./integrations/handoff` — exportala si todavía es privada.

```typescript
async function runTeamThreadRegeneration(
  worktreePath: string,
  projectKey: string,
): Promise<{ ok: boolean; error?: string; warnings?: unknown[] }> {
  if (!memory) return { ok: false, error: 'memory_unavailable' }
  const userId = memory.store.getOwnerUserId()
  const settings = loadTeamThreadSettings(teamThreadSettingsPath(ravenHome(), userId), projectKey)

  const rootDir = teamThreadRootDir(worktreePath)

  if (!settings.enabled) {
    // Apagar el toggle borra la carpeta local y saca el puntero, pero NO des-promueve lo
    // que ya se compartio: eso es una accion explicita y aparte (spec §8.2).
    rmSync(rootDir, { recursive: true, force: true })
    removeAgentsPointer(worktreePath)
    return { ok: true }
  }

  const { reader, close } = openReadonlyReader(ravenHome(), userId)
  try {
    const records = reader.listRecords(projectKey)
    const project = reader.listProjects().find((p) => p.projectKey === projectKey) ?? null

    const branches = [...new Set(records.map((r) => r.gitBranch).filter((b): b is string => b !== null))]

    const manifest = readManifest(rootDir, TEAM_THREAD_PATHS)
    const plan = planTeamThread({
      records,
      manifest,
      config: {
        projectKey,
        displayName: project?.displayName ?? projectKey,
        includedTypes: settings.includedTypes,
        branchStates: collectBranchStates(worktreePath, branches),
        ultimaSync: Date.now(),
      },
      onDiskHashes: computeOnDiskHashes(rootDir, manifest),
    })
    const { result } = await applyVaultPlan(rootDir, plan, TEAM_THREAD_PATHS)

    excluirNestDelRepo(worktreePath)
    if (settings.writeAgentsPointer) ensureAgentsPointer(worktreePath)
    else removeAgentsPointer(worktreePath)

    return { ok: true, warnings: result.warnings }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    close()
  }
}
```

Y `collectBranchStates`, que es lo único que consulta git (el planner no lo hace):

```typescript
/** `activa` si hay un worktree abierto en esa rama, `sin-worktree` si la rama existe pero
 *  nadie la tiene abierta, `cerrada` si ya no existe. */
function collectBranchStates(worktreePath: string, branches: string[]): Record<string, EstadoRama> {
  const out: Record<string, EstadoRama> = {}
  let existentes = new Set<string>()
  let conWorktree = new Set<string>()
  try {
    existentes = new Set(
      execFileSync('git', ['branch', '--format=%(refname:short)'], { cwd: worktreePath, encoding: 'utf8' })
        .split('\n').map((l) => l.trim()).filter(Boolean),
    )
    conWorktree = new Set(
      execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: worktreePath, encoding: 'utf8' })
        .split('\n').filter((l) => l.startsWith('branch '))
        .map((l) => l.slice('branch refs/heads/'.length).trim()).filter(Boolean),
    )
  } catch {
    // Sin git no hay estado que informar: todo queda `sin-worktree`, que es el default
    // menos afirmativo. No es motivo para no escribir el hilo.
  }
  for (const b of branches) {
    out[b] = conWorktree.has(b) ? 'activa' : existentes.has(b) ? 'sin-worktree' : 'cerrada'
  }
  return out
}
```

Agregar los IPC, al lado de los `memory:vault:*` existentes:

```typescript
ipcMain.handle('memory:teamThread:getSettings', (_e, projectKey: string) => {
  if (!memory) return { ok: false, error: 'memory_unavailable' }
  const userId = memory.store.getOwnerUserId()
  return { ok: true, settings: loadTeamThreadSettings(teamThreadSettingsPath(ravenHome(), userId), projectKey) }
})

ipcMain.handle('memory:teamThread:setSettings', async (_e, projectKey: string, worktreePath: string, patch: Partial<TeamThreadSettings>) => {
  if (!memory) return { ok: false, error: 'memory_unavailable' }
  const userId = memory.store.getOwnerUserId()
  const settings = saveTeamThreadSettings(teamThreadSettingsPath(ravenHome(), userId), projectKey, patch)
  const res = await runTeamThreadRegeneration(worktreePath, projectKey)
  return { ...res, settings }
})

ipcMain.handle('memory:teamThread:regenerate', (_e, worktreePath: string, projectKey: string) =>
  runTeamThreadRegeneration(worktreePath, projectKey))
```

Y en `electron/preload.ts`, dentro del objeto `memory` (después de `vaultReveal`):

```typescript
  teamThreadGetSettings: (projectKey: string) => ipcRenderer.invoke('memory:teamThread:getSettings', projectKey),
  teamThreadSetSettings: (projectKey: string, worktreePath: string, patch: unknown) =>
    ipcRenderer.invoke('memory:teamThread:setSettings', projectKey, worktreePath, patch),
  teamThreadRegenerate: (worktreePath: string, projectKey: string) =>
    ipcRenderer.invoke('memory:teamThread:regenerate', worktreePath, projectKey),
```

- [ ] **Step 6: Typecheck**

```bash
git add electron/integrations/team-thread-paths.ts electron/__tests__/team-thread-run.test.ts
npx tsc -b
git clean -fd
```
Expected: los ~15 errores preexistentes de `main` y **ninguno nuevo** en los archivos de este trabajo.

- [ ] **Step 7: Commit**

```bash
git add electron/integrations/team-thread-paths.ts electron/__tests__/team-thread-run.test.ts electron/main.ts electron/preload.ts
git commit -m "feat(team-thread): pase de regeneracion por worktree + IPC"
```

---

### Task 8: La promoción — que el handoff nazca `team`

**Files:**
- Modify: `electron/main.ts` (handler `handoff:write`)
- Test: `electron/__tests__/team-thread-promotion.test.ts`

**Interfaces:**
- Consumes: `loadTeamThreadSettings` (Task 4); `redact` de `../memory-redaction`.
- Produces: `function scopeForCapture(settings: TeamThreadSettings, type: ObservationType, title: string, content: string): { scope: 'personal' | 'team'; heldBack: boolean }`.

Spec §6.2 y §6.3. Es el único cambio en la ruta de captura, y el gate de redacción va acá: una fila con pinta de secreto **no se promueve sola**.

- [ ] **Step 1: Write the failing test**

```typescript
// electron/__tests__/team-thread-promotion.test.ts
import { describe, it, expect } from 'vitest'
import { scopeForCapture } from '../integrations/team-thread-promotion'
import type { TeamThreadSettings } from '../integrations/team-thread-config'

const ON: TeamThreadSettings = { enabled: true, includedTypes: ['handoff', 'decision'], writeAgentsPointer: true }
const OFF: TeamThreadSettings = { ...ON, enabled: false }

describe('scopeForCapture', () => {
  it('con el hilo apagado todo sigue naciendo personal', () => {
    expect(scopeForCapture(OFF, 'handoff', 'Un handoff', 'Cuerpo.')).toEqual({ scope: 'personal', heldBack: false })
  })

  it('con el hilo prendido, un handoff nace team', () => {
    expect(scopeForCapture(ON, 'handoff', 'Un handoff', 'Cuerpo.')).toEqual({ scope: 'team', heldBack: false })
  })

  it('un tipo que no esta en la lista sigue naciendo personal', () => {
    expect(scopeForCapture(ON, 'bugfix', 'Un fix', 'Cuerpo.')).toEqual({ scope: 'personal', heldBack: false })
  })

  it('EL GATE: algo con pinta de secreto NO se promueve solo', () => {
    const r = scopeForCapture(ON, 'handoff', 'Deploy', 'export GITHUB_TOKEN=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(r.scope).toBe('personal')
    expect(r.heldBack).toBe(true)
  })

  it('el gate mira tambien el titulo, no solo el cuerpo', () => {
    const r = scopeForCapture(ON, 'handoff', 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Cuerpo limpio.')
    expect(r.heldBack).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/team-thread-promotion.test.ts`
Expected: FAIL — `Failed to resolve import "../integrations/team-thread-promotion"`

- [ ] **Step 3: Write minimal implementation**

```typescript
// electron/integrations/team-thread-promotion.ts
// El unico cambio en la ruta de captura (spec §6.2) y el gate de redaccion (spec §6.3).
//
// Por que el gate va ACA y no en el planner: en el vault personal un secreto que se filtra
// te lo filtras a vos mismo; una vez que la fila nace `team` sale de la maquina en el
// proximo push y ya no hay como volver atras. El gate tiene que estar antes del push, no
// antes del render.
import type { ObservationType } from '../memory-protocol'
import { redact } from '../memory-redaction'
import type { TeamThreadSettings } from './team-thread-config'

export interface CaptureScope {
  scope: 'personal' | 'team'
  /** true = daba para team pero se retuvo por sospecha de secreto. */
  heldBack: boolean
}

export function scopeForCapture(
  settings: TeamThreadSettings,
  type: ObservationType,
  title: string,
  content: string,
): CaptureScope {
  if (!settings.enabled) return { scope: 'personal', heldBack: false }
  if (!settings.includedTypes.includes(type)) return { scope: 'personal', heldBack: false }

  const { redacted } = redact(`${title}\n${content}`)
  if (redacted) return { scope: 'personal', heldBack: true }

  return { scope: 'team', heldBack: false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/team-thread-promotion.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Wire it into the handoff write path**

En `electron/main.ts`, en el handler `handoff:write`, donde hoy guarda la observación `type:'handoff'`, calcular el scope antes del `save`:

```typescript
const ttSettings = loadTeamThreadSettings(teamThreadSettingsPath(ravenHome(), memory.store.getOwnerUserId()), projectKey)
const { scope, heldBack } = scopeForCapture(ttSettings, 'handoff', title, content)
// ... pasar `scope` al save existente ...
if (heldBack) {
  console.warn('[team-thread] handoff retenido como personal: matchea un patron de secreto')
}
```

- [ ] **Step 6: Commit**

```bash
git add electron/integrations/team-thread-promotion.ts electron/__tests__/team-thread-promotion.test.ts electron/main.ts
git commit -m "feat(team-thread): el handoff nace team, con gate de redaccion antes del push"
```

---

### Task 9: El grafo — nodos, aristas y layout

**⚠️ Este módulo vive en `src/lib/`, no en `electron/integrations/`.** El grafo es
puramente presentacional: el proceso main nunca lo construye. Y `src/` **nunca** importa de
`electron/` — es un patrón establecido del repo, documentado en `src/types.ts:76`, `:104`,
`:123` y `:218`. Por eso el tipo de entrada se **duplica** en `src/types.ts` con el
comentario de rigor, igual que ya se hace con `ticket-types`, `worktree-signals`,
`bus-types` y `recipes`.

**Files:**
- Create: `src/lib/team-thread-graph.ts`
- Modify: `src/types.ts` (agregar `TeamThreadBranch`)
- Test: `src/__tests__/lib/team-thread-graph.test.ts`

**Interfaces:**
- Consumes: `TeamThreadBranch` de `../types` (duplicado del `ThreadIndexBranch` de Task 1).
- Produces: `interface GraphNode { id: string; label: string; estado: EstadoRama; frescura: 'hoy' | 'semana' | 'mes' | 'viejo'; autor: string; x: number; y: number; foco: boolean }`, `interface GraphEdge { from: string; to: string }`, `interface ThreadGraph { nodes: GraphNode[]; edges: GraphEdge[]; recortados: number }`, `function buildThreadGraph(input: BuildGraphInput): ThreadGraph`, `const GRAPH_NODE_CAP = 200`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/lib/team-thread-graph.test.ts
import { describe, it, expect } from 'vitest'
import { buildThreadGraph, GRAPH_NODE_CAP } from '../../lib/team-thread-graph'
import type { TeamThreadBranch } from '../../types'

const AHORA = Date.UTC(2026, 8, 8, 12, 0)

function branch(over: Partial<TeamThreadBranch> = {}): TeamThreadBranch {
  return { slug: 'main', branch: 'main', estado: 'activa', ultimoAutor: 'Gero', ultimaEntrada: AHORA, entradas: 1, ...over }
}

describe('buildThreadGraph', () => {
  it('el indice va al centro y las ramas alrededor', () => {
    const g = buildThreadGraph({ branches: [branch({ slug: 'a' }), branch({ slug: 'b' })], focus: null, ahora: AHORA, global: true })

    const centro = g.nodes.find((n) => n.id === '_index')!
    expect(centro.x).toBe(0)
    expect(centro.y).toBe(0)
    expect(g.nodes.filter((n) => n.id !== '_index')).toHaveLength(2)
    expect(g.edges).toEqual(expect.arrayContaining([{ from: '_index', to: 'a' }, { from: '_index', to: 'b' }]))
  })

  it('el layout es DETERMINISTICO: mismas entradas, mismas coordenadas', () => {
    const input = { branches: [branch({ slug: 'a' }), branch({ slug: 'b' }), branch({ slug: 'c' })], focus: null, ahora: AHORA, global: true }
    expect(buildThreadGraph(input).nodes.map((n) => [n.id, n.x, n.y]))
      .toEqual(buildThreadGraph(input).nodes.map((n) => [n.id, n.x, n.y]))
  })

  it('clasifica la frescura por antiguedad de la ultima entrada', () => {
    const g = buildThreadGraph({
      branches: [
        branch({ slug: 'hoy', ultimaEntrada: AHORA - 3 * 3600_000 }),
        branch({ slug: 'semana', ultimaEntrada: AHORA - 3 * 86400_000 }),
        branch({ slug: 'mes', ultimaEntrada: AHORA - 20 * 86400_000 }),
        branch({ slug: 'viejo', ultimaEntrada: AHORA - 90 * 86400_000 }),
      ],
      focus: null, ahora: AHORA, global: true,
    })

    const f = (id: string): string => g.nodes.find((n) => n.id === id)!.frescura
    expect(f('hoy')).toBe('hoy')
    expect(f('semana')).toBe('semana')
    expect(f('mes')).toBe('mes')
    expect(f('viejo')).toBe('viejo')
  })

  it('el modo local muestra solo el foco y sus vecinos', () => {
    const g = buildThreadGraph({
      branches: [branch({ slug: 'a' }), branch({ slug: 'b' }), branch({ slug: 'c' })],
      focus: 'a', ahora: AHORA, global: false,
    })

    expect(g.nodes.map((n) => n.id).sort()).toEqual(['_index', 'a'])
    expect(g.nodes.find((n) => n.id === 'a')!.foco).toBe(true)
  })

  it('arriba del techo recorta por recencia y lo informa', () => {
    const branches = Array.from({ length: GRAPH_NODE_CAP + 40 }, (_, i) =>
      branch({ slug: `r${i}`, ultimaEntrada: i }))
    const g = buildThreadGraph({ branches, focus: null, ahora: AHORA, global: true })

    expect(g.nodes.length).toBe(GRAPH_NODE_CAP + 1) // +1 por el indice
    expect(g.recortados).toBe(40)
    expect(g.nodes.some((n) => n.id === `r${GRAPH_NODE_CAP + 39}`)).toBe(true) // el mas reciente sobrevive
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/team-thread-graph.test.ts`
Expected: FAIL — `Failed to resolve import "../../lib/team-thread-graph"`

- [ ] **Step 3: Add the duplicated type to `src/types.ts`**

Siguiendo el patrón de los otros cuatro duplicados del archivo:

```typescript
// === Hilo del equipo — espejo de ThreadIndexBranch/EstadoRama de
// electron/integrations/team-thread-note.ts (src/ nunca importa de electron/, mismo
// patron que arriba). Si cambia alla, cambia aca. ===
export type TeamThreadEstado = 'activa' | 'sin-worktree' | 'cerrada'

export interface TeamThreadBranch {
  slug: string
  branch: string
  estado: TeamThreadEstado
  ultimoAutor: string
  ultimaEntrada: number
  entradas: number
}
```

- [ ] **Step 4: Write minimal implementation**

```typescript
// src/lib/team-thread-graph.ts
// Ramas -> nodos, aristas y COORDENADAS. Puro y deterministico, para que el layout se
// testee con vectores fijos en vez de snapshots de pixeles (spec §7.4).
//
// Vive en src/ y no en electron/ porque es puramente presentacional: el proceso main nunca
// construye un grafo. Y src/ nunca importa de electron/ (ver src/types.ts).
//
// Sin librerias de grafos: no hay ninguna en package.json y no se agrega. Radial por
// anillos alcanza para el tamano que esta feature tiene por diseno.
import type { TeamThreadBranch, TeamThreadEstado } from '../types'

/** Arriba de esto la evidencia es unanime: se convierte en una bola de pelo (spec §7.3). */
export const GRAPH_NODE_CAP = 200

const RADIO_ANILLO = 120
const NODOS_POR_ANILLO = 12

export type Frescura = 'hoy' | 'semana' | 'mes' | 'viejo'

export interface GraphNode {
  id: string
  label: string
  estado: TeamThreadEstado
  frescura: Frescura
  autor: string
  x: number
  y: number
  foco: boolean
}

export interface GraphEdge {
  from: string
  to: string
}

export interface ThreadGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  recortados: number
}

export interface BuildGraphInput {
  branches: TeamThreadBranch[]
  /** Slug de la rama del worktree actual, o null. */
  focus: string | null
  ahora: number
  /** false = grafo local (foco + vecinos), que es el default (spec §7.3). */
  global: boolean
}

function frescuraDe(ultimaEntrada: number, ahora: number): Frescura {
  const dias = (ahora - ultimaEntrada) / 86400_000
  if (dias < 1) return 'hoy'
  if (dias < 7) return 'semana'
  if (dias < 30) return 'mes'
  return 'viejo'
}

export function buildThreadGraph(input: BuildGraphInput): ThreadGraph {
  const { branches, focus, ahora, global } = input

  const visibles = global ? branches : branches.filter((b) => b.slug === focus)

  // Recorte por recencia: sobrevive lo mas nuevo, que es lo que alguien necesita para
  // ponerse al dia.
  const ordenadas = [...visibles].sort((a, b) => b.ultimaEntrada - a.ultimaEntrada)
  const dentro = ordenadas.slice(0, GRAPH_NODE_CAP)
  const recortados = ordenadas.length - dentro.length

  const nodes: GraphNode[] = [
    { id: '_index', label: 'índice', estado: 'activa', frescura: 'hoy', autor: '', x: 0, y: 0, foco: false },
  ]
  const edges: GraphEdge[] = []

  dentro.forEach((b, i) => {
    const anillo = Math.floor(i / NODOS_POR_ANILLO) + 1
    const enAnillo = i % NODOS_POR_ANILLO
    const angulo = (enAnillo / NODOS_POR_ANILLO) * Math.PI * 2
    nodes.push({
      id: b.slug,
      label: b.branch,
      estado: b.estado,
      frescura: frescuraDe(b.ultimaEntrada, ahora),
      autor: b.ultimoAutor,
      // Redondeado: coordenadas exactas para que el test de vector fijo no dependa de
      // como imprime floats esta version de Node.
      x: Math.round(Math.cos(angulo) * RADIO_ANILLO * anillo),
      y: Math.round(Math.sin(angulo) * RADIO_ANILLO * anillo),
      foco: b.slug === focus,
    })
    edges.push({ from: '_index', to: b.slug })
  })

  return { nodes, edges, recortados }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/team-thread-graph.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/team-thread-graph.ts src/__tests__/lib/team-thread-graph.test.ts src/types.ts
git commit -m "feat(team-thread): grafo puro — nodos, aristas y layout deterministico"
```

---

### Task 10: El panel — grafo en SVG y toggle por proyecto

**Files:**
- Create: `src/components/TeamThreadGraph.tsx`
- Create: `src/__tests__/components/TeamThreadGraph.test.tsx`
- Modify: `src/components/MemoryHub.tsx` (montar el panel)

**Interfaces:**
- Consumes: `buildThreadGraph`, `GraphNode`, `ThreadGraph` (Task 9); `window.memory.teamThreadGetSettings` / `teamThreadSetSettings` (Task 7).
- Produces: componente `<TeamThreadGraph branches focus onOpenNote enabled onToggle />`.

Copy en inglés (regla global). El grafo navega; el click abre la nota, que es donde está el relato.

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/components/TeamThreadGraph.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TeamThreadGraph } from '../../components/TeamThreadGraph'
import type { TeamThreadBranch } from '../../types'

const AHORA = Date.UTC(2026, 8, 8, 12, 0)

const BRANCHES: TeamThreadBranch[] = [
  { slug: 'sidebar', branch: 'feat/sidebar-tabs', estado: 'activa', ultimoAutor: 'Bauti', ultimaEntrada: AHORA - 3600_000, entradas: 2 },
  { slug: 'bridge', branch: 'smoke/memory-bridge', estado: 'cerrada', ultimoAutor: 'Gero', ultimaEntrada: AHORA - 40 * 86400_000, entradas: 5 },
]

describe('TeamThreadGraph', () => {
  it('dibuja un nodo por rama mas el indice', () => {
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /open note/i })).toHaveLength(2)
  })

  it('el click en un nodo abre la nota de esa rama', () => {
    const onOpenNote = vi.fn()
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={onOpenNote} />)
    fireEvent.click(screen.getByRole('button', { name: /open note for feat\/sidebar-tabs/i }))
    expect(onOpenNote).toHaveBeenCalledWith('sidebar')
  })

  it('distingue visualmente lo cerrado y lo viejo', () => {
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    const cerrada = screen.getByRole('button', { name: /open note for smoke\/memory-bridge/i })
    expect(cerrada).toHaveAttribute('data-estado', 'cerrada')
    expect(cerrada).toHaveAttribute('data-frescura', 'viejo')
  })

  it('apagado muestra el llamado a activarlo y ningun nodo', () => {
    render(<TeamThreadGraph branches={[]} focus={null} ahora={AHORA} enabled={false} onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    expect(screen.getByText(/share this project's thread/i)).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /open note/i })).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components/TeamThreadGraph.test.tsx`
Expected: FAIL — `Failed to resolve import "../../components/TeamThreadGraph"`

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/TeamThreadGraph.tsx
// El grafo del hilo del equipo. SVG a mano, sin dependencias (spec §7.4).
//
// Lo que este panel ES: un navegador donde se ve de un vistazo que rama esta viva, de
// quien y que tan fresca. Lo que NO es: la via de ponerse al dia — para eso esta la nota,
// que se abre al hacer click (spec §7.6).
import { useMemo, useState } from 'react'
import { buildThreadGraph } from '../lib/team-thread-graph'
import type { TeamThreadBranch } from '../types'

interface Props {
  branches: TeamThreadBranch[]
  focus: string | null
  ahora: number
  enabled: boolean
  onToggle: (next: boolean) => void
  onOpenNote: (slug: string) => void
}

const COLOR_FRESCURA: Record<string, string> = {
  hoy: 'var(--accent, #22c55e)',
  semana: 'var(--accent-dim, #16a34a)',
  mes: 'var(--muted, #64748b)',
  viejo: 'var(--muted-dim, #334155)',
}

export function TeamThreadGraph({ branches, focus, ahora, enabled, onToggle, onOpenNote }: Props): JSX.Element {
  const [showGlobal, setShowGlobal] = useState(false)
  const graph = useMemo(
    () => buildThreadGraph({ branches, focus, ahora, global: showGlobal }),
    [branches, focus, ahora, showGlobal],
  )

  if (!enabled) {
    return (
      <div className="team-thread-empty">
        <p>Share this project's thread with your team so everyone's context arrives on its own.</p>
        <button type="button" onClick={() => onToggle(true)}>Turn on</button>
      </div>
    )
  }

  return (
    <div className="team-thread-graph">
      <header>
        <button type="button" onClick={() => setShowGlobal((v) => !v)}>
          {showGlobal ? 'Show current branch' : 'Show all branches'}
        </button>
        {graph.recortados > 0 && <span>{graph.recortados} older branches hidden</span>}
      </header>

      <svg viewBox="-400 -400 800 800" role="img" aria-label="Team thread graph">
        {graph.edges.map((e) => {
          const from = graph.nodes.find((n) => n.id === e.from)!
          const to = graph.nodes.find((n) => n.id === e.to)!
          return <line key={`${e.from}-${e.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="var(--border, #334155)" />
        })}

        {graph.nodes.map((n) =>
          n.id === '_index' ? (
            <circle key={n.id} cx={n.x} cy={n.y} r={14} fill="var(--fg, #e2e8f0)" />
          ) : (
            <g key={n.id}>
              <circle
                cx={n.x}
                cy={n.y}
                r={n.foco ? 16 : 10}
                fill={COLOR_FRESCURA[n.frescura]}
                stroke={n.estado === 'cerrada' ? 'var(--border, #334155)' : 'none'}
                strokeDasharray={n.estado === 'sin-worktree' ? '3 3' : undefined}
                role="button"
                tabIndex={0}
                aria-label={`Open note for ${n.label}`}
                data-estado={n.estado}
                data-frescura={n.frescura}
                onClick={() => onOpenNote(n.id)}
                onKeyDown={(ev) => { if (ev.key === 'Enter') onOpenNote(n.id) }}
              />
              <text x={n.x} y={n.y + 26} textAnchor="middle" fontSize={11} fill="var(--fg, #e2e8f0)">
                {n.label}
              </text>
              <text x={n.x} y={n.y + 39} textAnchor="middle" fontSize={9} fill="var(--muted, #64748b)">
                {n.autor}
              </text>
            </g>
          ),
        )}
      </svg>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/components/TeamThreadGraph.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Mount it in MemoryHub**

En `src/components/MemoryHub.tsx`, junto a `MemoryVaultCard`, montar `<TeamThreadGraph />` alimentado por `window.memory.teamThreadGetSettings(projectKey)` y con `onToggle` llamando a `teamThreadSetSettings`. `onOpenNote` abre `.nest/team/ramas/<slug>.md` con el mismo camino que ya usa el explorador de archivos para abrir un archivo en el editor.

- [ ] **Step 6: Full suite + typecheck**

```bash
npm test
git add src/components/TeamThreadGraph.tsx src/__tests__/components/TeamThreadGraph.test.tsx
npx tsc -b
git clean -fd
npm run native:electron
```
Expected: suite entera verde (877+ los nuevos), sin errores de tipo nuevos.

- [ ] **Step 7: Commit**

```bash
git add src/components/TeamThreadGraph.tsx src/__tests__/components/TeamThreadGraph.test.tsx src/components/MemoryHub.tsx
git commit -m "feat(team-thread): panel del hilo — grafo por estado y frescura, click abre la nota"
```

---

## Self-Review

**Cobertura de la spec:**

| Sección | Task |
|---|---|
| §4 layout en disco | 1, 2, 7 |
| §4.1 unidad = rama | 2 |
| §4.2 nota y frontmatter | 1 |
| §4.3 techo del índice | 1 |
| §5 módulo nuevo, no flag | 2 (y el test-guardia) |
| §6.1 qué entra | 2, 4 |
| §6.2 el handoff nace `team` | 8 |
| §6.3 redacción antes de promover | 8 |
| §6.4 append, no reescritura | 1, 2 |
| §6.5 checkpoints por turno | **ver hueco abajo** |
| §7 el grafo | 9, 10 |
| §8.2 tabla de fallas | 2, 5, 7 |
| §8.3 `synchronous = FULL` | 6 |
| §9 los cuatro tests que importan | 2 (guardia, concurrencia), 8 (gate), 9 (vector fijo) |
| §10.1 briefing de arranque | **ver hueco abajo** |
| §10.2 puntero AGENTS.md | 5 |
| §10.3 roles | **ver hueco abajo** |

**Tres huecos, dejados fuera a propósito y con motivo:**

1. **§6.5 checkpoints por turno** y **§10.1 el briefing entrega el hilo** tocan
   `memory-rollup.ts` y el handler `session-start`, que son la ruta de captura compartida
   con la memoria personal. Meterlos acá mezclaría dos superficies de riesgo distintas en
   el mismo plan. **Van en un plan hermano, después de que éste esté verde**, cuando el
   hilo ya exista y se pueda verificar que lo que se inyecta es lo que se escribió.
2. **§10.3 roles**: `team_memberships.role` ya existe y se sincroniza; aplicarlo es una
   regla de autorización en el servidor, no cliente. **Va con el plan del servidor**, junto
   al smoke de 2 cuentas reales que Layer 1 todavía debe.

Los tres están en la spec y no se pierden; simplemente no entran en este plan, que ya
produce software funcionando por sí solo: con las 10 tasks, el hilo se escribe, se
sincroniza, se ve y se puede prender y apagar.
