# Memory settings como pestaña (2a) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Memory settings deje de ser una vista que reemplaza el overlay y pase a ser una pestaña del workspace de Memories, con seis secciones (Sync · Encryption · Editor & graph · This project · Notes on disk · Advanced) armadas con filas `SettingRow`, copy nuevo en inglés y preferencias nuevas de editor y grafo que se guardan por máquina.

**Architecture:** El modelo de pestañas (`src/lib/memory-tabs.ts`) suma `{ kind: 'settings'; section }` y la acción `openSettings`. Con esa pestaña activa el explorer muestra la lista de secciones y el panel derecho se colapsa solo (mismo mecanismo que Team thread). Lo puro (fila, sección, lista de secciones, sección Editor & graph) vive en `src/components/memories/settings/` y recibe todo por props; lo que habla con IPC (`MemorySettingsTab.tsx` y las tarjetas reescritas en su mismo archivo) vive en `src/components/`. Las preferencias (`MemoryPrefs`) van en `AppSettings` vía `window.settings`, con un hook `useMemoryPrefs` que el workspace usa y reparte por props.

**Tech Stack:** React 18.3, TypeScript, Tailwind v4 sin preflight + shadcn (Radix vía el paquete `radix-ui`, que ya trae `Switch` y `Select`), CodeMirror 6, `react-force-graph-2d`, `react-resizable-panels`, Vitest + Testing Library (jsdom), Playwright contra `dist/`.

**Spec:** `docs/superpowers/specs/2026-10-21-memory-settings-como-pestana-design.md` (commit `383bde1`). Manda el spec; donde es ambiguo, manda la lista **Decisiones** de abajo.

## Decisiones (donde el spec no alcanza)

- **D1 — Una sección por vez.** La pestaña guarda `section`; el centro dibuja sólo esa sección y el explorer la lista. Elegir otra en la lista es `openSettings(seccion)`.
- **D2 — Dónde vive cada cosa.** En `src/components/memories/settings/` sólo lo puro: `SettingRow`, `SettingsSection`, `SettingsSectionList`, `EditorGraphSection`. Las secciones con IPC se arman en `src/components/MemorySettingsTab.tsx`, y las tarjetas se reescriben **en su mismo archivo** (`CloudMemoryCard.tsx`, etc.) para que sus tests de comportamiento sigan apuntando al mismo módulo.
- **D3 — Las tarjetas siguen self-contained** (cada una con sus hooks) y el contenido de la pestaña Settings se monta sólo mientras está activa: al volver relee estado, igual que la vista vieja. **Excepción: el hilo.** `useTeamThreadSettings` sube al workspace y llega por props al toggle: así la pestaña Team thread se entera del toggle en memoria (arreglo de Task 10 del 20-10) sin el `nonce` de "releer al volver".
- **D4 — `cargaFallida`.** `useTeamThreadSettings` separa el error de lectura del error al cambiar. La pestaña Team thread depende sólo del primero: un rechazo del toggle (p. ej. el plan) muestra el error y **no** saca la pestaña.
- **D5 — Account → Memory settings** pasa por un contador `pedidoDeSettings` (App) que `useMemoryTabs` atiende una vez por sesión, en vez de `vistaInicial` + `key`: el workspace no se remonta. La bienvenida no se auto-muestra si Memories se abrió desde Account (`abiertaEnSettings`); «How it works» la muestra siempre (ahora está siempre en el header).
- **D6 — Un solo motivo de colapso por pestaña.** Los motivos `hilo` y `settings` del panel derecho son uno (`pestana`): cualquier pestaña sin panel lo colapsa y al salir vuelve el ancho de antes. Pasar de Team thread a Settings no lo reabre en el medio.
- **D7 — Sync token (Advanced)** se muestra con `disconnected` + nube disponible, o con `error` (las condiciones del campo de hoy), y tiene su propio «Connect» → `connectWithToken`. El «Retry» de Cloud sync usa siempre `connectWithLogin` (con el campo en otra sección, Retry no puede leerlo).
- **D8 — «Machine without a browser»** se muestra con la nube `connected` o `paused`, y la dibuja `CloudMemoryCard` (que tiene el estado de `useMemory`).
- **D9 — Encryption.** «Encrypt your memory» muestra «On · key #N» cuando la cuenta tiene clave, también en la máquina sin autorizar (con la fila de autorizar debajo). El botón dice «Turn on» con `aria-label="Turn on encryption"` (contrato de tests y de `e2e/12`). Máquinas esperando: una fila por máquina. «Re-upload old memories» queda visible siempre que el cifrado está activo: no hay señal de "re-subida pendiente" (ver *Gaps*). En `TeamEncryptionCard` cambia sólo el marco (fila); los textos internos se quedan como están.
- **D10 — Share.** `puedeCompartirMemoria === undefined` ⇒ no se muestra (spec §5). Revierte una decisión vieja ("mientras no se sabe, mostrar el control"); el test que la fijaba se invierte. «See plans» abre el `UpgradeModal` existente desde `MemorySettingsTab` (`ShareProjectCard` recibe `onSeePlans`). Sale la constante `CONTACTO`.
- **D11 — Live preview off** = sin decoraciones y sin clic sobre el texto del link: en Markdown crudo un clic tiene que poner el cursor. Navegar un link queda en «Links to» del panel derecho. El tema del editor (colores, fuente, autocompletado de `[[`) sigue.
- **D12 — Readable line width on** = el ancho de hoy (`max-w-[720px]`, ≈72ch a la letra del cuerpo); off = `max-w-none`. **Font size** default 13 (= `--fs`), aplicado con `EditorView.editorAttributes` (atributo `style`) en un `Compartment`.
- **D13 — Labels y Animate** aplican al grafo global (pestaña Graph); el local del panel no cambia. Animate off = `warmupTicks` 300 (sin acomodo) / 120 (con acomodo) y `cooldownTicks` 0. Con la animación apagada, mover un slider de fuerza se ve recién en el próximo armado.
- **D14 — Filtros recordados** = `colorBy`, `hideOrphans`, `tiposOcultos`, `escalaDeNodo`, `distanciaDeLinks` e `inferidas` («Guessed links»). El foco (proyecto/tag) no: es navegación. Apagar Remember borra lo guardado. La persistencia (debounce 300 ms y flush al desmontar) vive en el workspace; `useGraphFilters` sólo toma `inicial` y expone `aplicar`/`restablecer`.
- **D15 — Escritura read-modify-write.** `useSettings` y `useMemoryPrefs` escriben sobre lo que está guardado ahora (`get` → merge → `set`), nunca el objeto entero de su estado local.
- **D16 — MemoryHub.** Sale «Learn more». No se cablea a «How it works» (§7 deja un solo «How it works», que abre MemoriesWelcome). Queda sólo el primer arranque (ver *Gaps*).
- **D17 — El e2e "hub encima del overlay"** pasa a medir el `UpgradeModal` (mismo `.modal-backdrop`, mismo z-index); se saltea con motivo si el build trae la nube habilitada (beta) y no hay Upgrade.
- **D18 — Único estilo inline en lo reescrito:** el ancho dinámico de la barra de cuota (`style={{ width }}`).
- **D19 — «Settings for `<repo>`»** usa el basename de `activeRepoPath`.

**Gaps del spec (avisarle a Gero):**
1. §5 Encryption nombra una fila «re-subida pendiente» que aparece "cuando aplica", pero ningún estado dice si hay algo pendiente: queda siempre visible con el cifrado activo (D9).
2. §5 Sync dice que MemoryHub sigue apareciendo "con «How it works»"; hoy ese botón abre MemoriesWelcome y §7 dice que queda uno solo. MemoryHub queda sólo en el primer arranque (D16).
3. §5 "This project": `undefined` ⇒ no se muestra contradice la decisión documentada en `share-project-card.test.tsx` (D10).

## Global Constraints

- Copy de la UI **en inglés**, exactamente el de spec §5 (tabla de abajo). Ningún literal de string de 4–200 caracteres en `src/**` (fuera de `__tests__` y `src/tutorial/`) puede tener `áéíóúñ¿¡` (`src/__tests__/la-app-es-en-ingles.test.ts`). Los comentarios pueden ir en español.
- **Componentes nuevos con shadcn + utilidades Tailwind**, nunca clases nuevas en `global.css`. Colores sólo por tokens (`text-muted-foreground`, `border-border`, `bg-accent`, `text-warn`, `text-destructive`, `text-ok`…). **Ningún `sp-*` ni estilo inline en lo nuevo o reescrito** (única excepción: D18).
- Tailwind **sin preflight**: no importar `"tailwindcss"` entero. Un `<button>` propio lleva `border-0` (y `bg-transparent` si no tiene fondo).
- Nada en `src/components/memories/` (incluida `memories/settings/`) importa `window.memory`, `window.settings`, `electron` ni hooks que lo hagan. Las preferencias entran por props.
- **El comportamiento de las tarjetas no cambia:** mismos IPC, mismas máquinas de estado del cifrado, mismo compartir, mismo diálogo de Turn off. Cambia dónde están, cuándo aparecen y qué dicen. Los tests de comportamiento se conservan; sólo se tocan las queries de copy que el spec cambia (cada tarea lo dice).
- `localStorage` siempre dentro de try/catch (`src/lib/almacen-seguro.ts`); si falla, valores por defecto.
- **Sin dependencias nuevas.** `Switch` sale de `radix-ui` (ya instalado). Si por algo hay que correr `npm install`, después correr `node .superpowers/sdd/2026-10-20-memories-estilo-obsidian/tools/restaurar-libc.mjs`.
- Typecheck real (los dos de CI): `npx tsc -p tsconfig.node.json --noEmit --composite false` y `npx tsc -p tsconfig.web.json --noEmit --composite false`. Baseline: 0 errores. **No usar `tsc -b`.**
- Tests de componentes y lógica: `npx vitest run <archivo>`. Tests que tocan SQLite: `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts <archivo>` (este plan no debería necesitarlo). Suite completa al cierre de cada tarea: `npx vitest run`.
- **Hay `electron.exe` vivos de este worktree** que tienen tomado el binding de better-sqlite3: `npm run native:*` puede dar `EBUSY`. **No matarlos**: avisar y seguir con lo que no lo necesita.
- e2e corre contra `dist/`: `npm run build` antes y el binding de Electron puesto (`npm run native:electron`).
- Commits locales en `feat/memories-settings`, sin push. Mensaje terminado en `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. `git add` **sólo los archivos de la tarea**: el árbol tiene cambios ajenos sin commitear (`.superpowers/sdd/.gitignore`, PNGs de `.superpowers/sdd/shots/`, `docs/HANDOFF-2026-10-20-memories-obsidian.md`) que no se tocan.

### Copy (spec §5, verbatim)

| Lugar | Texto |
|---|---|
| Pestaña | `Settings` |
| Secciones (lista y `h2`) | `Sync` · `Encryption` · `Editor & graph` · `This project` · `Notes on disk` · `Advanced` |
| Bajada Sync | `Your memory on every machine you sign in to.` |
| Cloud sync | `Cloud sync` — `Keeps a copy in the cloud so what your agents learn here is there on your other machines.` Controles: `Connect` / `Turn off` / `Retry` / `Upgrade` / `Unavailable` |
| Estado de Cloud sync | `Up to date · N memories` · `Uploading N changes…` (punto `bg-warn`) · `Offline — N changes waiting` · `Another Nest is syncing this memory — N changes queued` · `Couldn't sync — …` · `Your plan doesn't include cloud sync` |
| Cloud space | `Cloud space` — `X of Y` |
| Machine without a browser | `Machine without a browser` — `A server, VM or SSH box. Run <comando login> there and approve the code it shows.` Control: input + `Approve` |
| Aviso sin repos | `Link your repos before connecting — memory imported without them goes to Global and stays there.` |
| Bajada Encryption | `The server stores your memory without being able to read it.` |
| Encrypt your memory | `Encrypt your memory` — `Only your machines hold the key. On this machine it stays readable, so search and agents work as usual.` Control: `Turn on` / `On · key #N`. Sin nube: `Needs cloud sync` + `Set up sync` |
| Equipo | `Encrypt what <team> shares` — `Only the team leader can turn it on.` |
| Live preview | `Live preview` — `Hide Markdown syntax except on the line you're editing.` |
| Readable line width | `Readable line width` — `Cap note width so long lines are easy to read.` |
| Spellcheck | `Spellcheck` — `Underline misspelled words while you write.` |
| Font size | `Font size` — `Size of the note text.` |
| Remember graph filters | `Remember graph filters` — `Keep orphans, guessed links, colours and forces as you left them.` |
| Labels | `Labels` — `When node names show on the graph.` Opciones: `Always` · `When zoomed in` · `On hover` |
| Animate graph | `Animate graph` — `Turn off on slow machines: nodes appear already in place.` |
| Reset | `Reset graph to defaults` (botón `Reset`) |
| Bajada This project | `Settings for <repo>.` |
| Branch notes | `Branch notes` — `Writes a short note per branch into .nest/team/. It travels with git, so it's readable without Nest, and adds a branch map under the graph.` |
| Share sin plan | `Share with a team` — `Sharing with a team needs a Teams plan.` + link `See plans` |
| Sin repo | `Open a repo in this tab to see its settings.` + `Link a repo` |
| Mirror to Markdown | `Mirror to Markdown` — `One file per memory in a folder you can open in Obsidian or grep.` Controles `Enable`/`Disable`; switches `Include old versions` / `Include teammates' memories` |
| Bajada Advanced | `Only if your company runs its own Nest server.` |
| Sync server | `Sync server` — URL + `Change` |
| Sync token | `Sync token` — `Connect with a token instead of signing in.` |

## Review Focus

1. **Una instancia vieja de `useSettings` pisa `memoryPrefs`.** `App.tsx` tiene su `useSettings` montado desde el arranque y hoy `markMemoriesWelcomeSeen` escribe su objeto entero: cambiar el tamaño de letra y después cerrar la bienvenida borraría el cambio. La persona espera que sus preferencias sobrevivan. Test en Task 1 (read-modify-write).
2. **Filtros recordados contra la carga asíncrona de las prefs.** En la primera apertura las prefs llegan después del primer render; un guardado de los defaults en ese hueco pisaría lo recordado, y un cambio hecho dentro de los 300 ms antes de cerrar el overlay se perdería. La persona espera encontrar el grafo como lo dejó. Tests en Task 11.
3. **El toggle de Branch notes falla** (plan sin equipo): la persona espera ver el motivo y que la pestaña Team thread no desaparezca, porque el hilo sigue prendido. Test en Task 6 (D4).
4. **Ctrl/Cmd+W con Settings activa** tiene que cerrar la pestaña y morir en el overlay (nunca la ventana), y el panel derecho tiene que volver a su ancho. Test en Task 6.
5. **Abrir Settings con una nota sin guardar**: la nota sigue montada detrás y se autoguarda; volver muestra lo escrito. Test en Task 6.

---

## Mapa de archivos

**Nuevos**
- `src/lib/memory-prefs.ts` — tipos `MemoryPrefs`, defaults, `normalizarMemoryPrefs`, `conFiltros`.
- `src/hooks/useMemoryPrefs.ts` — leer/escribir `memoryPrefs` con `window.settings` (caché de sesión).
- `src/lib/pestana-del-hilo.ts` — si la pestaña Team thread va, desde el estado compartido del hilo.
- `src/components/ui/switch.tsx` — shadcn sobre `radix-ui`.
- `src/components/memories/settings/SettingRow.tsx`, `SettingsSection.tsx`, `SettingsSectionList.tsx`, `EditorGraphSection.tsx`.
- `src/components/MemorySettingsTab.tsx` — las seis secciones (fuera de `memories/`: monta tarjetas con IPC).
- `src/components/SyncTokenRow.tsx` — la fila «Sync token» de Advanced.
- Tests: `src/__tests__/lib/memory-prefs.test.ts`, `src/__tests__/hooks/useMemoryPrefs.test.tsx`, `src/__tests__/hooks/useMemoryTabs.test.tsx`, `src/__tests__/lib/pestana-del-hilo.test.ts`, `src/__tests__/components/memory-settings-primitivos.test.tsx`, `src/__tests__/components/EditorGraphSection.test.tsx`, `src/__tests__/components/MemorySettingsTab.test.tsx`, `src/__tests__/components/SyncTokenRow.test.tsx`, `src/__tests__/components/memory-settings-sin-sp.test.ts`, `src/__tests__/components/MemoryGraph2D-prefs.test.tsx`.

**Modificados**
- `src/lib/keybindings.ts`, `src/types.ts` (tipo de `window.settings.get`), `src/hooks/useSettings.ts`.
- `src/lib/memory-tabs.ts`, `src/hooks/useMemoryTabs.ts`, `src/components/memories/MemoryTabs.tsx`.
- `src/hooks/useTeamThreadSettings.ts`, `src/components/TeamThreadToggle.tsx`.
- `src/components/MemoriesWorkspace.tsx`, `src/App.tsx`, `src/lib/memoriesWelcome.ts`, `src/hooks/useGraphFilters.ts`.
- `src/components/CloudMemoryCard.tsx`, `LinkDeviceCard.tsx`, `SyncServiceCard.tsx`, `MemoryEncryptionCard.tsx`, `TeamEncryptionCard.tsx`, `ShareProjectCard.tsx`, `MemoryVaultCard.tsx`.
- `src/lib/cm-live-preview.ts`, `src/components/memories/MemoryNoteEditor.tsx`, `src/components/MemoriesNoteTab.tsx`.
- `src/lib/memory-graph-2d.ts`, `src/components/memories/MemoryGraph2D.tsx`.
- `src/tutorial/registry.ts`, `src/tutorial/types.ts`, `src/tutorial/tours/memories.ts`, `src/components/MemoriesWelcome.tsx`.
- `e2e/03-memories-in-app.spec.ts`, `e2e/04-contraste.spec.ts`, `e2e/12-cifrado-dos-maquinas.spec.ts`.

**Borrados:** `src/components/MemorySettingsView.tsx`, `src/__tests__/components/MemorySettingsView.test.tsx`, `src/tutorial/tours/memory-settings.ts`, `src/hooks/useTeamThreadEnabled.ts`.

---

### Task 1: Preferencias de Memories (`MemoryPrefs`, `useSettings`, `useMemoryPrefs`)

**Files:**
- Create: `src/lib/memory-prefs.ts`, `src/hooks/useMemoryPrefs.ts`
- Modify: `src/lib/keybindings.ts:16-28`, `src/hooks/useSettings.ts` (entero), `src/types.ts:1501-1517` (tipo de `settings.get`)
- Test: `src/__tests__/lib/memory-prefs.test.ts`, `src/__tests__/hooks/useMemoryPrefs.test.tsx`, `src/__tests__/hooks/useSettings.test.tsx` (suma un `describe`)

**Interfaces:**
- Produces (`src/lib/memory-prefs.ts`):
  - `type EtiquetasDelGrafo = 'always' | 'zoom' | 'hover'`
  - `interface PrefsDelEditor { livePreview: boolean; readableWidth: boolean; spellcheck: boolean; fontSize: number }`
  - `interface FiltrosGuardados { colorBy: ColorBy; hideOrphans: boolean; tiposOcultos: string[]; escalaDeNodo: number; distanciaDeLinks: number; inferidas: boolean }`
  - `interface PrefsDelGrafo { remember: boolean; labels: EtiquetasDelGrafo; animate: boolean; filtros?: FiltrosGuardados }`
  - `interface MemoryPrefs { editor: PrefsDelEditor; graph: PrefsDelGrafo }`
  - `const TAMANOS_DE_LETRA: readonly [12, 13, 14, 15, 16, 17, 18]`, `const DEFAULT_MEMORY_PREFS: MemoryPrefs`, `const FILTROS_POR_DEFECTO: FiltrosGuardados`
  - `normalizarMemoryPrefs(raw: unknown): MemoryPrefs`, `normalizarFiltros(raw: unknown): FiltrosGuardados | undefined`, `conFiltros(p: MemoryPrefs, f: FiltrosGuardados | undefined): MemoryPrefs`
- Produces (`src/hooks/useMemoryPrefs.ts`): `useMemoryPrefs(): { prefs: MemoryPrefs; cargadas: boolean; actualizar: (cambio: (p: MemoryPrefs) => MemoryPrefs) => void }` (`actualizar` estable) y `__reiniciarMemoryPrefs(): void` (sólo tests).
- Produces: `AppSettings.memoryPrefs: MemoryPrefs`; los updaters de `useSettings` devuelven `Promise<void>`.

- [ ] **Step 1: Tests que fallan — el modelo.** Crear `src/__tests__/lib/memory-prefs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MEMORY_PREFS, FILTROS_POR_DEFECTO, conFiltros, normalizarFiltros, normalizarMemoryPrefs,
} from '../../lib/memory-prefs'

describe('normalizarMemoryPrefs', () => {
  it('sin nada guardado da los defaults', () => {
    expect(normalizarMemoryPrefs(undefined)).toEqual(DEFAULT_MEMORY_PREFS)
    expect(normalizarMemoryPrefs('basura')).toEqual(DEFAULT_MEMORY_PREFS)
  })

  it('un campo que no estaba guardado sale del default (merge de campos nuevos)', () => {
    const p = normalizarMemoryPrefs({ editor: { livePreview: false } })
    expect(p.editor).toEqual({ ...DEFAULT_MEMORY_PREFS.editor, livePreview: false })
    expect(p.graph).toEqual(DEFAULT_MEMORY_PREFS.graph)
  })

  it('un tipo roto vuelve al default de ese campo', () => {
    const p = normalizarMemoryPrefs({ editor: { livePreview: 'yes', fontSize: 40 }, graph: { labels: 'nunca', animate: 0 } })
    expect(p.editor.livePreview).toBe(true)
    expect(p.editor.fontSize).toBe(13)
    expect(p.graph.labels).toBe('zoom')
    expect(p.graph.animate).toBe(true)
  })

  it('el tamaño de letra sólo acepta 12–18 enteros', () => {
    expect(normalizarMemoryPrefs({ editor: { fontSize: 16 } }).editor.fontSize).toBe(16)
    expect(normalizarMemoryPrefs({ editor: { fontSize: 15.5 } }).editor.fontSize).toBe(13)
    expect(normalizarMemoryPrefs({ editor: { fontSize: 11 } }).editor.fontSize).toBe(13)
  })

  it('sin filtros guardados no inventa unos', () => {
    expect(normalizarMemoryPrefs({ graph: { remember: true } }).graph.filtros).toBeUndefined()
  })

  it('no comparte objetos con los defaults', () => {
    const p = normalizarMemoryPrefs(undefined)
    p.editor.fontSize = 18
    expect(DEFAULT_MEMORY_PREFS.editor.fontSize).toBe(13)
  })
})

describe('normalizarFiltros', () => {
  it('conserva unos filtros válidos', () => {
    const f = { colorBy: 'project', hideOrphans: false, tiposOcultos: ['gotcha'], escalaDeNodo: 1.5, distanciaDeLinks: 80, inferidas: false }
    expect(normalizarFiltros(f)).toEqual(f)
  })
  it('cada campo roto cae a su default; lo que no es objeto se descarta', () => {
    expect(normalizarFiltros({ colorBy: 'rojo', escalaDeNodo: 5, distanciaDeLinks: 'x', tiposOcultos: [1, 'bug'] }))
      .toEqual({ ...FILTROS_POR_DEFECTO, tiposOcultos: ['bug'] })
    expect(normalizarFiltros(null)).toBeUndefined()
    expect(normalizarFiltros([])).toBeUndefined()
  })
})

describe('conFiltros', () => {
  it('pone y saca los filtros sin tocar lo demás', () => {
    const con = conFiltros(DEFAULT_MEMORY_PREFS, FILTROS_POR_DEFECTO)
    expect(con.graph.filtros).toEqual(FILTROS_POR_DEFECTO)
    expect(con.graph.labels).toBe('zoom')
    const sin = conFiltros(con, undefined)
    expect('filtros' in sin.graph).toBe(false)
  })
})
```

- [ ] **Step 2:** `npx vitest run src/__tests__/lib/memory-prefs.test.ts` → FAIL (no existe el módulo).

- [ ] **Step 3: El modelo.** Crear `src/lib/memory-prefs.ts`:

```ts
// Preferencias de Memories (spec "Memory settings como pestaña" §6). Viven en AppSettings y se
// guardan con window.settings: por máquina, sobreviven al reinicio. Puro: el hook
// useMemoryPrefs es el único que habla con el preload.
import type { ColorBy } from './memory-graph-visuals'

export type EtiquetasDelGrafo = 'always' | 'zoom' | 'hover'

export interface PrefsDelEditor { livePreview: boolean; readableWidth: boolean; spellcheck: boolean; fontSize: number }

/** Lo que "Remember graph filters" guarda (decisión D14): el foco no, es navegación. */
export interface FiltrosGuardados {
  colorBy: ColorBy
  hideOrphans: boolean
  tiposOcultos: string[]
  escalaDeNodo: number
  distanciaDeLinks: number
  /** «Guessed links»: las aristas inferidas se ven. */
  inferidas: boolean
}

export interface PrefsDelGrafo { remember: boolean; labels: EtiquetasDelGrafo; animate: boolean; filtros?: FiltrosGuardados }
export interface MemoryPrefs { editor: PrefsDelEditor; graph: PrefsDelGrafo }

export const TAMANOS_DE_LETRA = [12, 13, 14, 15, 16, 17, 18] as const

export const DEFAULT_MEMORY_PREFS: MemoryPrefs = {
  // 13 = --fs, el cuerpo de la UI: el tamaño que el editor tenía antes de esta preferencia.
  editor: { livePreview: true, readableWidth: true, spellcheck: false, fontSize: 13 },
  graph: { remember: true, labels: 'zoom', animate: true },
}

/** Los valores de arranque de useGraphFilters y del interruptor de inferidas del workspace. */
export const FILTROS_POR_DEFECTO: FiltrosGuardados = {
  colorBy: 'type', hideOrphans: true, tiposOcultos: [], escalaDeNodo: 1, distanciaDeLinks: 50, inferidas: true,
}

const COLOR_BY: readonly ColorBy[] = ['type', 'project', 'tag']
const ETIQUETAS: readonly EtiquetasDelGrafo[] = ['always', 'zoom', 'hover']

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
// Los rangos son los de los sliders de GraphFiltersPanel: un valor de afuera no se dibuja.
const enRango = (v: unknown, d: number, min: number, max: number): number =>
  (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : d)

export function normalizarFiltros(raw: unknown): FiltrosGuardados | undefined {
  if (!esObjeto(raw)) return undefined
  const d = FILTROS_POR_DEFECTO
  return {
    colorBy: COLOR_BY.includes(raw.colorBy as ColorBy) ? (raw.colorBy as ColorBy) : d.colorBy,
    hideOrphans: bool(raw.hideOrphans, d.hideOrphans),
    tiposOcultos: Array.isArray(raw.tiposOcultos) ? raw.tiposOcultos.filter((x): x is string => typeof x === 'string') : [],
    escalaDeNodo: enRango(raw.escalaDeNodo, d.escalaDeNodo, 0.5, 2),
    distanciaDeLinks: enRango(raw.distanciaDeLinks, d.distanciaDeLinks, 20, 120),
    inferidas: bool(raw.inferidas, d.inferidas),
  }
}

/** Merge contra los defaults, campo por campo: un settings.json de una versión vieja (sin un
 *  campo nuevo) o tocado a mano no rompe nada ni pierde lo que sí es válido. */
export function normalizarMemoryPrefs(raw: unknown): MemoryPrefs {
  const r = esObjeto(raw) ? raw : {}
  const e = esObjeto(r.editor) ? r.editor : {}
  const g = esObjeto(r.graph) ? r.graph : {}
  const de = DEFAULT_MEMORY_PREFS.editor
  const dg = DEFAULT_MEMORY_PREFS.graph
  const fontSize = typeof e.fontSize === 'number' && (TAMANOS_DE_LETRA as readonly number[]).includes(e.fontSize) ? e.fontSize : de.fontSize
  const filtros = normalizarFiltros(g.filtros)
  return {
    editor: {
      livePreview: bool(e.livePreview, de.livePreview),
      readableWidth: bool(e.readableWidth, de.readableWidth),
      spellcheck: bool(e.spellcheck, de.spellcheck),
      fontSize,
    },
    graph: {
      remember: bool(g.remember, dg.remember),
      labels: ETIQUETAS.includes(g.labels as EtiquetasDelGrafo) ? (g.labels as EtiquetasDelGrafo) : dg.labels,
      animate: bool(g.animate, dg.animate),
      ...(filtros ? { filtros } : {}),
    },
  }
}

export function conFiltros(p: MemoryPrefs, filtros: FiltrosGuardados | undefined): MemoryPrefs {
  const { filtros: _anteriores, ...resto } = p.graph
  return { ...p, graph: filtros ? { ...resto, filtros } : resto }
}
```

- [ ] **Step 4:** `npx vitest run src/__tests__/lib/memory-prefs.test.ts` → PASS.

- [ ] **Step 5: Tests que fallan — `useSettings` no pisa `memoryPrefs` (Review Focus 1).** Al final de `src/__tests__/hooks/useSettings.test.tsx`:

```ts
describe('useSettings — memoryPrefs', () => {
  it('carga memoryPrefs con merge contra los defaults', async () => {
    ;(window as unknown as { settings: unknown }).settings = {
      get: vi.fn().mockResolvedValue({ voiceLanguage: 'en', keybindings: {}, memoryPrefs: { editor: { fontSize: 16 } } }),
      set: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.settings.memoryPrefs.editor.fontSize).toBe(16))
    expect(result.current.settings.memoryPrefs.editor.livePreview).toBe(true)
  })

  it('cambiar el idioma no pisa las memoryPrefs guardadas', async () => {
    const guardadas = { editor: { livePreview: false }, graph: { remember: false } }
    const set = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { settings: unknown }).settings = {
      get: vi.fn().mockResolvedValue({ voiceLanguage: 'en', keybindings: {}, memoryPrefs: guardadas }),
      set,
    }
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.settings.voiceLanguage).toBe('en'))
    await act(async () => { await result.current.updateVoiceLanguage('es') })
    expect(set).toHaveBeenLastCalledWith(expect.objectContaining({ voiceLanguage: 'es', memoryPrefs: guardadas }))
  })

  it('una instancia montada desde antes no pisa lo que otra guardó después', async () => {
    let store: Record<string, unknown> = { voiceLanguage: 'en', keybindings: {}, hasSeenMemoriesWelcome: false }
    const get = vi.fn(async () => store)
    ;(window as unknown as { settings: unknown }).settings = {
      get,
      set: vi.fn(async (d: Record<string, unknown>) => { store = d }),
    }
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(get).toHaveBeenCalled())
    // useMemoryPrefs escribió mientras tanto (por ejemplo, desde Memories).
    store = { ...store, memoryPrefs: { editor: { fontSize: 16 } } }
    await act(async () => { await result.current.markMemoriesWelcomeSeen() })
    expect(store).toMatchObject({ hasSeenMemoriesWelcome: true, memoryPrefs: { editor: { fontSize: 16 } } })
  })
})
```

- [ ] **Step 6:** `npx vitest run src/__tests__/hooks/useSettings.test.tsx` → FAIL (`memoryPrefs` undefined; el set lleva el objeto viejo).

- [ ] **Step 7: `AppSettings` y `useSettings`.** En `src/lib/keybindings.ts`, arriba: `import { DEFAULT_MEMORY_PREFS, type MemoryPrefs } from './memory-prefs'`; en `interface AppSettings` sumar `memoryPrefs: MemoryPrefs` y en `DEFAULT_SETTINGS` sumar `memoryPrefs: DEFAULT_MEMORY_PREFS,` (después de `hasSeenMemoriesWelcome`). En `src/types.ts`, dentro del tipo de retorno de `settings.get` (línea ~1505, junto a `hasSeenMemoriesWelcome?: boolean`), sumar `memoryPrefs?: unknown`. Reemplazar `src/hooks/useSettings.ts` entero:

```ts
import { useState, useEffect, useCallback, useRef } from 'react'
import { AppSettings, DEFAULT_SETTINGS, Keybindings } from '../lib/keybindings'
import { normalizarMemoryPrefs } from '../lib/memory-prefs'

/**
 * Escribe SÓLO lo que cambió, sobre lo que está guardado AHORA (decisión D15). App y
 * SettingsPanel tienen cada uno su instancia de este hook, y useMemoryPrefs escribe
 * `memoryPrefs` por su lado: con el objeto entero del estado local, el próximo `set` de una
 * instancia montada desde el arranque pisaba lo que otra había guardado después.
 */
async function guardar(patch: Partial<AppSettings>): Promise<void> {
  try {
    const actual = ((await window.settings.get()) ?? {}) as Partial<AppSettings>
    await window.settings.set({ ...DEFAULT_SETTINGS, ...actual, ...patch })
  } catch (err) {
    console.error('[useSettings] save failed:', err)
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const actual = useRef(settings)
  actual.current = settings

  useEffect(() => {
    (async () => {
      try {
        const s = ((await window.settings.get()) ?? {}) as Partial<AppSettings>
        setSettings({
          voiceLanguage: s.voiceLanguage ?? DEFAULT_SETTINGS.voiceLanguage,
          hasSeenMemoryHub: s.hasSeenMemoryHub ?? DEFAULT_SETTINGS.hasSeenMemoryHub,
          hasSeenMemoriesWelcome: s.hasSeenMemoriesWelcome ?? DEFAULT_SETTINGS.hasSeenMemoriesWelcome,
          keybindings: { ...DEFAULT_SETTINGS.keybindings, ...s.keybindings },
          // Spec §6: sin leerlo acá, el estado arrancaba con los defaults y el próximo set lo pisaba.
          memoryPrefs: normalizarMemoryPrefs(s.memoryPrefs),
        })
      } catch (err) {
        console.error('[useSettings] load failed:', err)
        // Keep DEFAULT_SETTINGS as the initial state on failure.
      }
    })()
  }, [])

  const cambiar = useCallback((patch: Partial<AppSettings>): Promise<void> => {
    actual.current = { ...actual.current, ...patch }
    setSettings((prev) => ({ ...prev, ...patch }))
    return guardar(patch)
  }, [])

  const updateKeybinding = useCallback((action: keyof Keybindings, key: string) => {
    return cambiar({ keybindings: { ...DEFAULT_SETTINGS.keybindings, ...actual.current.keybindings, [action]: key } })
  }, [cambiar])

  const updateVoiceLanguage = useCallback((lang: string) => cambiar({ voiceLanguage: lang }), [cambiar])
  const markMemoryHubSeen = useCallback(() => cambiar({ hasSeenMemoryHub: true }), [cambiar])
  const markMemoriesWelcomeSeen = useCallback(() => cambiar({ hasSeenMemoriesWelcome: true }), [cambiar])

  return { settings, updateKeybinding, updateVoiceLanguage, markMemoryHubSeen, markMemoriesWelcomeSeen }
}
```

- [ ] **Step 8:** `npx vitest run src/__tests__/hooks/useSettings.test.tsx` → PASS (los cuatro tests viejos y los tres nuevos).

- [ ] **Step 9: Tests que fallan — `useMemoryPrefs`.** Crear `src/__tests__/hooks/useMemoryPrefs.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useMemoryPrefs, __reiniciarMemoryPrefs } from '../../hooks/useMemoryPrefs'
import { DEFAULT_MEMORY_PREFS } from '../../lib/memory-prefs'

let store: Record<string, unknown>
const set = vi.fn(async (d: Record<string, unknown>) => { store = d })
beforeEach(() => {
  __reiniciarMemoryPrefs()
  store = { voiceLanguage: 'en', otro: 1, memoryPrefs: { editor: { fontSize: 15 } } }
  set.mockClear()
  ;(window as unknown as { settings: unknown }).settings = { get: vi.fn(async () => store), set }
})
afterEach(() => { delete (window as unknown as { settings?: unknown }).settings })

describe('useMemoryPrefs', () => {
  it('carga lo guardado con merge contra los defaults', async () => {
    const { result } = renderHook(() => useMemoryPrefs())
    expect(result.current.cargadas).toBe(false)
    await waitFor(() => expect(result.current.cargadas).toBe(true))
    expect(result.current.prefs.editor).toEqual({ ...DEFAULT_MEMORY_PREFS.editor, fontSize: 15 })
  })

  it('actualizar escribe sólo memoryPrefs, sobre lo que está guardado ahora', async () => {
    const { result } = renderHook(() => useMemoryPrefs())
    await waitFor(() => expect(result.current.cargadas).toBe(true))
    store = { ...store, voiceLanguage: 'es' } // otra instancia cambió el idioma
    act(() => { result.current.actualizar((p) => ({ ...p, editor: { ...p.editor, spellcheck: true } })) })
    expect(result.current.prefs.editor.spellcheck).toBe(true)
    await waitFor(() => expect(set).toHaveBeenCalled())
    expect(store).toMatchObject({ voiceLanguage: 'es', otro: 1, memoryPrefs: { editor: { spellcheck: true, fontSize: 15 } } })
  })

  it('la segunda apertura en la misma sesión arranca cargada, sin esperar al preload', async () => {
    const a = renderHook(() => useMemoryPrefs())
    await waitFor(() => expect(a.result.current.cargadas).toBe(true))
    a.unmount()
    const b = renderHook(() => useMemoryPrefs())
    expect(b.result.current.cargadas).toBe(true)
    expect(b.result.current.prefs.editor.fontSize).toBe(15)
  })

  it('sin window.settings (tests, renderer fuera de Electron) da los defaults y no rompe', async () => {
    delete (window as unknown as { settings?: unknown }).settings
    const { result } = renderHook(() => useMemoryPrefs())
    await waitFor(() => expect(result.current.cargadas).toBe(true))
    expect(result.current.prefs).toEqual(DEFAULT_MEMORY_PREFS)
    act(() => { result.current.actualizar((p) => ({ ...p, editor: { ...p.editor, fontSize: 18 } })) })
    expect(result.current.prefs.editor.fontSize).toBe(18)
  })
})
```

- [ ] **Step 10:** `npx vitest run src/__tests__/hooks/useMemoryPrefs.test.tsx` → FAIL (no existe el hook).

- [ ] **Step 11: El hook.** Crear `src/hooks/useMemoryPrefs.ts`:

```ts
// Lee y escribe las preferencias de Memories (spec §6). Lo usa MemoriesWorkspace y las
// reparte por props: nada de components/memories/ importa este hook (requisito del plugin).
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_MEMORY_PREFS, normalizarMemoryPrefs, type MemoryPrefs } from '../lib/memory-prefs'

type PuenteDeSettings = { get: () => Promise<unknown>; set: (data: unknown) => Promise<unknown> }

function puente(): PuenteDeSettings | null {
  const s = (window as unknown as { settings?: PuenteDeSettings }).settings
  return s && typeof s.get === 'function' && typeof s.set === 'function' ? s : null
}

// Caché de sesión, como las pestañas: reabrir el overlay no espera al preload ni dibuja un
// cuadro con los defaults antes de lo guardado.
let cache: MemoryPrefs | null = null
// Las escrituras van en fila: dos cambios seguidos no se pisan con lecturas cruzadas.
let cola: Promise<void> = Promise.resolve()

async function persistir(next: MemoryPrefs): Promise<void> {
  const api = puente()
  if (!api) return
  try {
    // Read-modify-write (D15): sólo memoryPrefs, sobre lo que está guardado AHORA.
    const actual = ((await api.get()) ?? {}) as Record<string, unknown>
    await api.set({ ...actual, memoryPrefs: next })
  } catch (err) {
    console.error('[useMemoryPrefs] save failed:', err)
  }
}

export function useMemoryPrefs() {
  const [prefs, setPrefs] = useState<MemoryPrefs>(cache ?? DEFAULT_MEMORY_PREFS)
  const [cargadas, setCargadas] = useState(cache !== null)
  const prefsRef = useRef(prefs)

  useEffect(() => {
    if (cache) return
    let vivo = true
    void (async () => {
      let leidas = DEFAULT_MEMORY_PREFS
      try {
        const s = (await puente()?.get()) as { memoryPrefs?: unknown } | null | undefined
        leidas = normalizarMemoryPrefs(s?.memoryPrefs)
      } catch { /* sin settings: defaults */ }
      cache = leidas
      if (!vivo) return
      prefsRef.current = leidas
      setPrefs(leidas)
      setCargadas(true)
    })()
    return () => { vivo = false }
  }, [])

  /** Estable. Sirve también después de desmontar (el flush de los filtros del grafo). */
  const actualizar = useCallback((cambio: (p: MemoryPrefs) => MemoryPrefs) => {
    const next = normalizarMemoryPrefs(cambio(prefsRef.current))
    prefsRef.current = next
    cache = next
    setPrefs(next)
    cola = cola.then(() => persistir(next))
  }, [])

  return { prefs, cargadas, actualizar }
}

/** Sólo para tests: vacía la caché de sesión. */
export function __reiniciarMemoryPrefs(): void { cache = null; cola = Promise.resolve() }
```

- [ ] **Step 12:** `npx vitest run src/__tests__/hooks/useMemoryPrefs.test.tsx src/__tests__/hooks/useSettings.test.tsx src/__tests__/lib/memory-prefs.test.ts src/__tests__/components/SettingsPanel.test.tsx` → PASS. Los dos `tsc` de CI → 0.

- [ ] **Step 13: Commit.**

```bash
git add src/lib/memory-prefs.ts src/hooks/useMemoryPrefs.ts src/lib/keybindings.ts src/hooks/useSettings.ts src/types.ts src/__tests__/lib/memory-prefs.test.ts src/__tests__/hooks/useMemoryPrefs.test.tsx src/__tests__/hooks/useSettings.test.tsx
git commit -m "feat(memories): preferencias de editor y grafo en AppSettings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: La pestaña `settings` en el modelo de pestañas

**Files:**
- Modify: `src/lib/memory-tabs.ts`, `src/hooks/useMemoryTabs.ts`, `src/components/memories/MemoryTabs.tsx:2,16-18`, `src/components/MemoriesWorkspace.tsx` (sólo la función `etiqueta`, ~línea 234)
- Test: `src/__tests__/lib/memory-tabs.test.ts`, `src/__tests__/hooks/useMemoryTabs.test.tsx` (nuevo), `src/__tests__/components/MemoryTabs.test.tsx`

**Interfaces:**
- Produces (`memory-tabs.ts`):
  - `type SeccionDeSettings = 'sync' | 'encryption' | 'editor' | 'project' | 'disk' | 'advanced'`
  - `const SECCIONES_DE_SETTINGS: ReadonlyArray<{ id: SeccionDeSettings; titulo: string }>` — en orden: Sync, Encryption, Editor & graph, This project, Notes on disk, Advanced.
  - `MemoryTab` suma `{ kind: 'settings'; section: SeccionDeSettings }`; `tabId` → `'settings'`; `esFija` → `false`.
  - `TabsAction` suma `{ type: 'openSettings'; section?: SeccionDeSettings }`.
- Produces (`useMemoryTabs`): firma `useMemoryTabs(conHilo: boolean | null, pedidoDeSettings = 0)`; devuelve además `openSettings: (section?: SeccionDeSettings) => void` (estable). Cada valor nuevo de `pedidoDeSettings` mayor que el último atendido en la sesión abre Settings una vez. `__reiniciarPestanas()` también resetea ese contador.

- [ ] **Step 1: Tests que fallan.** Al final de `src/__tests__/lib/memory-tabs.test.ts` (los imports ya traen `tabsReducer`, `ESTADO_INICIAL`; sumar `tabId`, `esFija`, `SECCIONES_DE_SETTINGS` al import):

```ts
describe('pestaña Settings', () => {
  it('openSettings la agrega al final, la activa y arranca en Sync', () => {
    let s = tabsReducer(ESTADO_INICIAL, { type: 'open', tab: { kind: 'note', syncId: 'a' } })
    s = tabsReducer(s, { type: 'openSettings' })
    expect(s.tabs[s.tabs.length - 1]).toEqual({ kind: 'settings', section: 'sync' })
    expect(s.activeId).toBe('settings')
  })

  it('si ya existe la activa sin duplicarla, y cambia de sección si se pide una', () => {
    let s = tabsReducer(ESTADO_INICIAL, { type: 'openSettings', section: 'disk' })
    s = tabsReducer(s, { type: 'activate', id: 'graph' })
    s = tabsReducer(s, { type: 'openSettings' })
    expect(s.tabs.filter((t) => t.kind === 'settings')).toEqual([{ kind: 'settings', section: 'disk' }])
    expect(s.activeId).toBe('settings')
    s = tabsReducer(s, { type: 'openSettings', section: 'advanced' })
    expect(s.tabs.filter((t) => t.kind === 'settings')).toEqual([{ kind: 'settings', section: 'advanced' }])
  })

  it('se cierra como una común: no es fija y la activa pasa a la de la izquierda', () => {
    const tab = { kind: 'settings' as const, section: 'sync' as const }
    expect(tabId(tab)).toBe('settings')
    expect(esFija(tab)).toBe(false)
    let s = tabsReducer(ESTADO_INICIAL, { type: 'openSettings' })
    s = tabsReducer(s, { type: 'close', id: 'settings' })
    expect(s.tabs.some((t) => t.kind === 'settings')).toBe(false)
    expect(s.activeId).toBe('graph')
  })

  it('las secciones van en el orden del spec, sin números', () => {
    expect(SECCIONES_DE_SETTINGS.map((x) => x.titulo)).toEqual(['Sync', 'Encryption', 'Editor & graph', 'This project', 'Notes on disk', 'Advanced'])
  })
})
```

Crear `src/__tests__/hooks/useMemoryTabs.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMemoryTabs, __reiniciarPestanas } from '../../hooks/useMemoryTabs'

beforeEach(() => { __reiniciarPestanas() })

describe('useMemoryTabs — pedido de Settings (Account → Memory settings)', () => {
  it('un pedido nuevo abre Settings al montar', () => {
    const { result } = renderHook(() => useMemoryTabs(false, 1))
    expect(result.current.activeId).toBe('settings')
  })

  it('el mismo pedido no se atiende dos veces: cerrar y reabrir no vuelve a Settings', () => {
    const a = renderHook(() => useMemoryTabs(false, 1))
    act(() => { a.result.current.close('settings') })
    a.unmount()
    const b = renderHook(() => useMemoryTabs(false, 1))
    expect(b.result.current.tabs.some((t) => t.kind === 'settings')).toBe(false)
    expect(b.result.current.activeId).toBe('graph')
  })

  it('con el workspace ya montado, un pedido nuevo activa Settings', () => {
    const { result, rerender } = renderHook(({ n }) => useMemoryTabs(false, n), { initialProps: { n: 0 } })
    expect(result.current.activeId).toBe('graph')
    rerender({ n: 1 })
    expect(result.current.activeId).toBe('settings')
  })

  it('openSettings(seccion) cambia la sección de la pestaña', () => {
    const { result } = renderHook(() => useMemoryTabs(false))
    act(() => { result.current.openSettings('encryption') })
    expect(result.current.tabs.find((t) => t.kind === 'settings')).toEqual({ kind: 'settings', section: 'encryption' })
  })
})
```

En `src/__tests__/components/MemoryTabs.test.tsx`, dentro del `describe`:

```tsx
  it('Settings se puede cerrar como una pestaña común', () => {
    const onClose = vi.fn()
    render(<MemoryTabs tabs={[{ kind: 'graph' }, { kind: 'settings', section: 'sync' }]} activeId="settings"
      etiqueta={(t) => ({ texto: t.kind === 'graph' ? 'Graph' : 'Settings' })} onActivate={vi.fn()} onClose={onClose} />)
    expect(screen.getByRole('tab', { name: /Settings/, selected: true })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))
    expect(onClose).toHaveBeenCalledWith('settings')
  })
```

- [ ] **Step 2:** `npx vitest run src/__tests__/lib/memory-tabs.test.ts src/__tests__/hooks/useMemoryTabs.test.tsx src/__tests__/components/MemoryTabs.test.tsx` → FAIL (`openSettings` / `settings` no existen; error de tipos en el test).

- [ ] **Step 3: El reducer.** En `src/lib/memory-tabs.ts`: actualizar el comentario de cabecera ("…Settings, cerrable, es la configuración de Memories (spec 2026-10-21)"), y:

```ts
export type SeccionDeSettings = 'sync' | 'encryption' | 'editor' | 'project' | 'disk' | 'advanced'

/** Las secciones de la pestaña Settings, en el orden del spec §2.1 (sin números). */
export const SECCIONES_DE_SETTINGS: ReadonlyArray<{ id: SeccionDeSettings; titulo: string }> = [
  { id: 'sync', titulo: 'Sync' },
  { id: 'encryption', titulo: 'Encryption' },
  { id: 'editor', titulo: 'Editor & graph' },
  { id: 'project', titulo: 'This project' },
  { id: 'disk', titulo: 'Notes on disk' },
  { id: 'advanced', titulo: 'Advanced' },
]

export type MemoryTab =
  | { kind: 'graph' }
  | { kind: 'thread' }
  | { kind: 'note'; syncId: string }
  | { kind: 'new'; key: string; titulo: string }
  | { kind: 'settings'; section: SeccionDeSettings }
```

Sumar `| { type: 'openSettings'; section?: SeccionDeSettings }` a `TabsAction`, `case 'settings': return 'settings'` a `tabId`, y en `tabsReducer`:

```ts
    case 'openSettings': {
      // Una sola pestaña Settings: si está, se activa (y cambia de sección si se pidió una).
      const i = s.tabs.findIndex((t) => t.kind === 'settings')
      if (i === -1) return { tabs: [...s.tabs, { kind: 'settings', section: a.section ?? 'sync' }], activeId: 'settings' }
      const actual = s.tabs[i]
      const cambia = a.section !== undefined && actual.kind === 'settings' && actual.section !== a.section
      const tabs = cambia ? s.tabs.map((t, j) => (j === i ? { kind: 'settings' as const, section: a.section! } : t)) : s.tabs
      return { tabs, activeId: 'settings' }
    }
```

- [ ] **Step 4: El hook.** Reemplazar `src/hooks/useMemoryTabs.ts`:

```ts
import { useCallback, useEffect, useReducer } from 'react'
import { ESTADO_INICIAL, tabsReducer, type MemoryTab, type SeccionDeSettings, type TabsState } from '../lib/memory-tabs'

// Vive mientras la app está abierta: cerrar y reabrir el overlay vuelve a las mismas
// pestañas; reiniciar la app vuelve a sólo Graph (spec §3).
let ultimo: TabsState = ESTADO_INICIAL
// El último pedido de Settings atendido (decisión D5): App cuenta los pedidos de Account →
// "Memory settings"; cada uno abre Settings UNA vez, aunque el overlay se cierre y se reabra.
let pedidoAtendido = 0

/**
 * @param conHilo `null` = todavía no se sabe: no se toca la pestaña Team thread.
 * @param pedidoDeSettings sube cada vez que algo de afuera pide abrir Memory settings.
 */
export function useMemoryTabs(conHilo: boolean | null, pedidoDeSettings = 0) {
  const [state, dispatch] = useReducer(tabsReducer, ultimo)
  useEffect(() => { ultimo = state }, [state])
  useEffect(() => { if (conHilo !== null) dispatch({ type: 'setThread', on: conHilo }) }, [conHilo])
  useEffect(() => {
    if (pedidoDeSettings <= pedidoAtendido) return
    pedidoAtendido = pedidoDeSettings
    dispatch({ type: 'openSettings' })
  }, [pedidoDeSettings])
  return {
    ...state,
    open: useCallback((tab: MemoryTab, opts?: { background?: boolean }) => dispatch({ type: 'open', tab, background: opts?.background }), []),
    close: useCallback((id: string) => dispatch({ type: 'close', id }), []),
    activate: useCallback((id: string) => dispatch({ type: 'activate', id }), []),
    replace: useCallback((id: string, tab: MemoryTab) => dispatch({ type: 'replace', id, tab }), []),
    openSettings: useCallback((section?: SeccionDeSettings) => dispatch({ type: 'openSettings', section }), []),
  }
}

/** Sólo para tests: vuelve la caché de sesión al inicio. */
export function __reiniciarPestanas(): void { ultimo = ESTADO_INICIAL; pedidoAtendido = 0 }
```

- [ ] **Step 5: La marca y la etiqueta.** En `MemoryTabs.tsx`: import `{ GitBranch, Network, Settings, X } from 'lucide-react'` y en `Marca`, después de la línea de `thread`: `if (tab.kind === 'settings') return <Settings className="size-3.5 shrink-0" aria-hidden="true" />`. En `MemoriesWorkspace.tsx`, en la función `etiqueta`, sumar `case 'settings': return { texto: 'Settings' }` (sin esto el `switch` deja de ser exhaustivo y `tsc` falla).

- [ ] **Step 6:** `npx vitest run src/__tests__/lib/memory-tabs.test.ts src/__tests__/hooks/useMemoryTabs.test.tsx src/__tests__/components/MemoryTabs.test.tsx src/__tests__/components/MemoriesWorkspace-obsidian.test.tsx` → PASS. Los dos `tsc` → 0.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/memory-tabs.ts src/hooks/useMemoryTabs.ts src/components/memories/MemoryTabs.tsx src/components/MemoriesWorkspace.tsx src/__tests__/lib/memory-tabs.test.ts src/__tests__/hooks/useMemoryTabs.test.tsx src/__tests__/components/MemoryTabs.test.tsx
git commit -m "feat(memories): la pestana Settings en el modelo de pestanas

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Primitivos de la pestaña: `Switch`, `SettingRow`, `SettingsSection`, `SettingsSectionList`

**Files:**
- Create: `src/components/ui/switch.tsx`, `src/components/memories/settings/SettingRow.tsx`, `src/components/memories/settings/SettingsSection.tsx`, `src/components/memories/settings/SettingsSectionList.tsx`
- Modify: `src/__tests__/components/MemoriesWorkspace-tokens.test.tsx` (lee también `memories/settings/`)
- Test: `src/__tests__/components/memory-settings-primitivos.test.tsx`

**Interfaces:**
- Produces:
  - `Switch` (`@/components/ui/switch`): props de `radix-ui` `Switch.Root` (`checked`, `onCheckedChange`, `disabled`, `aria-labelledby`, `id`…). Rol `switch` con `aria-checked`.
  - `SettingRow` (default export): `{ id?: string; nombre: ReactNode; descripcion?: ReactNode; control?: ReactNode; children?: ReactNode }`. `id` va en el elemento del nombre (para `aria-labelledby`). Raíz con `data-slot="setting-row"` y `border-b border-border last:border-b-0`.
  - `SettingsSection` (default export): `{ titulo: string; bajada?: ReactNode; children: ReactNode }` → `<section aria-label={titulo}>` con `<h2>{titulo}</h2>`.
  - `SettingsSectionList<T extends string>` (default export): `{ secciones: ReadonlyArray<{ id: T; titulo: string }>; activa: T; onElegir: (id: T) => void }` → `<nav aria-label="Settings sections">`, un botón por sección, la activa con `aria-current="page"` y `bg-accent`.

- [ ] **Step 1: Tests que fallan.** Crear `src/__tests__/components/memory-settings-primitivos.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Switch } from '@/components/ui/switch'
import SettingRow from '../../components/memories/settings/SettingRow'
import SettingsSection from '../../components/memories/settings/SettingsSection'
import SettingsSectionList from '../../components/memories/settings/SettingsSectionList'

describe('SettingRow', () => {
  it('nombre a la izquierda, qué es debajo, control a la derecha y el detalle a todo el ancho', () => {
    render(
      <SettingRow id="fila" nombre="Spellcheck" descripcion="Underline misspelled words while you write."
        control={<Switch aria-labelledby="fila" checked={false} onCheckedChange={() => {}} />}>
        <p>detalle</p>
      </SettingRow>,
    )
    expect(screen.getByRole('switch', { name: 'Spellcheck' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('Underline misspelled words while you write.').className).toMatch(/text-muted-foreground/)
    expect(screen.getByText('Spellcheck').className).toMatch(/font-medium/)
    const fila = document.querySelector('[data-slot="setting-row"]')!
    expect(fila.className).toMatch(/border-b/)
    expect(fila.className).toMatch(/border-border/)
    expect(within(fila as HTMLElement).getByText('detalle')).toBeInTheDocument()
  })

  it('sin detalle no deja un contenedor vacío', () => {
    render(<SettingRow nombre="Reset graph to defaults">{null}{false}</SettingRow>)
    const fila = document.querySelector('[data-slot="setting-row"]')!
    expect(fila.children).toHaveLength(1)
  })
})

describe('Switch', () => {
  it('cambia con un click', () => {
    const onCheckedChange = vi.fn()
    render(<Switch aria-label="Live preview" checked={true} onCheckedChange={onCheckedChange} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Live preview' }))
    expect(onCheckedChange).toHaveBeenCalledWith(false)
  })
})

describe('SettingsSection y SettingsSectionList', () => {
  it('la sección tiene su título como heading y su bajada', () => {
    render(<SettingsSection titulo="Sync" bajada="Your memory on every machine you sign in to."><p>filas</p></SettingsSection>)
    expect(screen.getByRole('heading', { name: 'Sync' })).toBeInTheDocument()
    expect(screen.getByText('Your memory on every machine you sign in to.')).toBeInTheDocument()
  })

  it('la lista marca la activa y avisa la elegida', () => {
    const onElegir = vi.fn()
    render(<SettingsSectionList secciones={[{ id: 'sync', titulo: 'Sync' }, { id: 'disk', titulo: 'Notes on disk' }]} activa="sync" onElegir={onElegir} />)
    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getByRole('button', { name: 'Sync' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('button', { name: 'Sync' }).className).toMatch(/bg-accent/)
    fireEvent.click(within(nav).getByRole('button', { name: 'Notes on disk' }))
    expect(onElegir).toHaveBeenCalledWith('disk')
  })
})

describe('memories/settings no trae estilos sueltos', () => {
  const dir = resolve(process.cwd(), 'src/components/memories/settings')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.tsx'))) {
    it(`${f}: sin style inline, sin sp-*, sin window.*`, () => {
      const src = readFileSync(resolve(dir, f), 'utf8')
      expect(src).not.toMatch(/style=\{/)
      expect(src).not.toMatch(/\bsp-[a-z]/)
      expect(src).not.toMatch(/window\.(memory|settings)/)
    })
  }
})
```

- [ ] **Step 2:** `npx vitest run src/__tests__/components/memory-settings-primitivos.test.tsx` → FAIL (módulos inexistentes).

- [ ] **Step 3: `Switch`.** Crear `src/components/ui/switch.tsx`:

```tsx
import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"
import { cn } from "cn"

// shadcn sobre `radix-ui`. Root reenvía su ref (Radix), así que no cae en la trampa del
// `asChild` de React 18 (docs/RECETA-MIGRACION-UI.md). Acromático como el resto: prendido es
// `bg-foreground`, no un color de acento.
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border bg-muted p-0 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-foreground",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-background transition-transform data-[state=checked]:translate-x-4"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
```

- [ ] **Step 4: Las tres piezas.** Crear `src/components/memories/settings/SettingRow.tsx`:

```tsx
// Una fila de Memory settings (spec §4): a la izquierda qué es y para qué sirve, a la derecha
// el control, y abajo, a todo el ancho, el detalle (estado, barra, listas). Presentación pura.
import { Children, type ReactNode } from 'react'

export interface SettingRowProps {
  /** Va en el nombre, para que el control lo use de `aria-labelledby`. */
  id?: string
  nombre: ReactNode
  descripcion?: ReactNode
  control?: ReactNode
  children?: ReactNode
}

export default function SettingRow({ id, nombre, descripcion, control, children }: SettingRowProps) {
  // `toArray` descarta null/false: una fila sin detalle no deja un hueco con gap.
  const detalle = Children.toArray(children)
  return (
    <div data-slot="setting-row" className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p id={id} className="m-0 text-fs font-medium text-foreground">{nombre}</p>
          {descripcion && <p className="m-0 mt-0.5 line-clamp-2 text-fs-sm text-muted-foreground">{descripcion}</p>}
        </div>
        {control && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{control}</div>}
      </div>
      {detalle.length > 0 && <div className="flex min-w-0 flex-col gap-2">{detalle}</div>}
    </div>
  )
}
```

`src/components/memories/settings/SettingsSection.tsx`:

```tsx
// El marco de una sección de la pestaña Settings: título, bajada de una línea y las filas.
import type { ReactNode } from 'react'

export interface SettingsSectionProps { titulo: string; bajada?: ReactNode; children: ReactNode }

export default function SettingsSection({ titulo, bajada, children }: SettingsSectionProps) {
  return (
    <section aria-label={titulo} className="mx-auto flex w-full max-w-[720px] flex-col p-6">
      <h2 className="m-0 text-fs-lg font-semibold text-foreground">{titulo}</h2>
      {bajada && <p className="m-0 mt-1 text-fs-sm text-muted-foreground">{bajada}</p>}
      <div className="mt-3 flex flex-col">{children}</div>
    </section>
  )
}
```

`src/components/memories/settings/SettingsSectionList.tsx`:

```tsx
// Lo que muestra el explorer mientras la pestaña Settings está activa (spec §3): las
// secciones, con el mismo ancho y la misma fila que las carpetas.
import { cn } from 'cn'

export interface SettingsSectionListProps<T extends string> {
  secciones: ReadonlyArray<{ id: T; titulo: string }>
  activa: T
  onElegir: (id: T) => void
}

export default function SettingsSectionList<T extends string>({ secciones, activa, onElegir }: SettingsSectionListProps<T>) {
  return (
    <nav aria-label="Settings sections" className="flex h-full min-h-0 flex-col gap-0.5 overflow-y-auto p-2">
      {secciones.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-current={s.id === activa ? 'page' : undefined}
          onClick={() => onElegir(s.id)}
          className={cn(
            // `border-0 bg-transparent`: sin preflight un <button> trae borde y fondo del navegador.
            'flex w-full cursor-pointer items-center rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-fs-sm font-medium text-foreground hover:bg-accent/50',
            s.id === activa && 'bg-accent',
          )}
        >
          {s.titulo}
        </button>
      ))}
    </nav>
  )
}
```

- [ ] **Step 5: El gate de tokens lee la carpeta nueva.** En `src/__tests__/components/MemoriesWorkspace-tokens.test.tsx`, después del `readdirSync(dirMemories)…`, sumar en `files`:

```ts
  ...Object.fromEntries(
    readdirSync(resolve(dirMemories, 'settings'))
      .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
      .map((f) => [`memories/settings/${f}`, readFileSync(resolve(dirMemories, 'settings', f), 'utf8')]),
  ),
```

- [ ] **Step 6:** `npx vitest run src/__tests__/components/memory-settings-primitivos.test.tsx src/__tests__/components/MemoriesWorkspace-tokens.test.tsx src/__tests__/styles/ui-primitivos-tokens.test.ts` → PASS. Los dos `tsc` → 0.

- [ ] **Step 7: Commit.**

```bash
git add src/components/ui/switch.tsx src/components/memories/settings/SettingRow.tsx src/components/memories/settings/SettingsSection.tsx src/components/memories/settings/SettingsSectionList.tsx src/__tests__/components/memory-settings-primitivos.test.tsx src/__tests__/components/MemoriesWorkspace-tokens.test.tsx
git commit -m "feat(memories): fila, seccion y lista de secciones de Settings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: La sección «Editor & graph»

**Files:**
- Create: `src/components/memories/settings/EditorGraphSection.tsx`
- Test: `src/__tests__/components/EditorGraphSection.test.tsx`

**Interfaces:**
- Consumes: `MemoryPrefs`, `PrefsDelEditor`, `PrefsDelGrafo`, `EtiquetasDelGrafo`, `TAMANOS_DE_LETRA`, `DEFAULT_MEMORY_PREFS` (Task 1); `SettingRow`, `Switch` (Task 3).
- Produces: `EditorGraphSection` (default export): `{ prefs: MemoryPrefs; disabled?: boolean; onChange: (cambio: (p: MemoryPrefs) => MemoryPrefs) => void; onResetGraph: () => void }`. Devuelve las filas (sin el marco de sección: lo pone `MemorySettingsTab`). Apagar Remember manda `filtros: undefined` (D14).

- [ ] **Step 1: Tests que fallan.** Crear `src/__tests__/components/EditorGraphSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import EditorGraphSection from '../../components/memories/settings/EditorGraphSection'
import { DEFAULT_MEMORY_PREFS, FILTROS_POR_DEFECTO, type MemoryPrefs } from '../../lib/memory-prefs'

const montar = (prefs: MemoryPrefs = DEFAULT_MEMORY_PREFS, extra: { disabled?: boolean } = {}) => {
  const onChange = vi.fn()
  const onResetGraph = vi.fn()
  render(<EditorGraphSection prefs={prefs} onChange={onChange} onResetGraph={onResetGraph} {...extra} />)
  /** Aplica el último cambio a las prefs con que se montó. */
  const ultimo = (): MemoryPrefs => onChange.mock.calls[onChange.mock.calls.length - 1][0](prefs)
  return { onChange, onResetGraph, ultimo }
}

describe('EditorGraphSection', () => {
  it('muestra las filas del spec con sus defaults', () => {
    montar()
    expect(screen.getByRole('switch', { name: 'Live preview' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Readable line width' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Spellcheck' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('switch', { name: 'Remember graph filters' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Animate graph' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText("Hide Markdown syntax except on the line you're editing.")).toBeInTheDocument()
    expect(screen.getByText('Turn off on slow machines: nodes appear already in place.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Font size' })).toHaveTextContent('13 px')
    expect(screen.getByRole('combobox', { name: 'Labels' })).toHaveTextContent('When zoomed in')
  })

  it('cada switch cambia sólo su campo', () => {
    const { ultimo } = montar()
    fireEvent.click(screen.getByRole('switch', { name: 'Live preview' }))
    expect(ultimo().editor).toEqual({ ...DEFAULT_MEMORY_PREFS.editor, livePreview: false })
    fireEvent.click(screen.getByRole('switch', { name: 'Animate graph' }))
    expect(ultimo().graph.animate).toBe(false)
  })

  it('el tamaño de letra y las etiquetas se eligen de su lista', async () => {
    const { ultimo } = montar()
    fireEvent.click(screen.getByRole('combobox', { name: 'Font size' }))
    fireEvent.click(await screen.findByRole('option', { name: '16 px' }))
    expect(ultimo().editor.fontSize).toBe(16)
    fireEvent.click(screen.getByRole('combobox', { name: 'Labels' }))
    fireEvent.click(await screen.findByRole('option', { name: 'On hover' }))
    expect(ultimo().graph.labels).toBe('hover')
  })

  it('apagar Remember borra los filtros guardados', () => {
    const conFiltros: MemoryPrefs = { ...DEFAULT_MEMORY_PREFS, graph: { ...DEFAULT_MEMORY_PREFS.graph, filtros: FILTROS_POR_DEFECTO } }
    const { ultimo } = montar(conFiltros)
    fireEvent.click(screen.getByRole('switch', { name: 'Remember graph filters' }))
    expect(ultimo().graph.remember).toBe(false)
    expect(ultimo().graph.filtros).toBeUndefined()
  })

  it('Reset avisa; deshabilitada no deja tocar nada', () => {
    const { onResetGraph } = montar()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(onResetGraph).toHaveBeenCalled()
  })

  it('mientras las prefs no cargaron, todo está deshabilitado', () => {
    montar(DEFAULT_MEMORY_PREFS, { disabled: true })
    expect(screen.getByRole('switch', { name: 'Live preview' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
  })
})
```

- [ ] **Step 2:** `npx vitest run src/__tests__/components/EditorGraphSection.test.tsx` → FAIL.

- [ ] **Step 3: La sección.** Crear `src/components/memories/settings/EditorGraphSection.tsx`:

```tsx
// Editor & graph (spec §5): las preferencias del editor de notas y del grafo. Presentación
// pura: las prefs entran y salen por props (el workspace las guarda con useMemoryPrefs).
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import SettingRow from './SettingRow'
import {
  TAMANOS_DE_LETRA, type EtiquetasDelGrafo, type MemoryPrefs, type PrefsDelEditor, type PrefsDelGrafo,
} from '../../../lib/memory-prefs'

export interface EditorGraphSectionProps {
  prefs: MemoryPrefs
  /** true mientras las prefs no cargaron: un cambio ahí lo pisaría la carga. */
  disabled?: boolean
  onChange: (cambio: (p: MemoryPrefs) => MemoryPrefs) => void
  onResetGraph: () => void
}

const ETIQUETAS: ReadonlyArray<{ id: EtiquetasDelGrafo; texto: string }> = [
  { id: 'always', texto: 'Always' },
  { id: 'zoom', texto: 'When zoomed in' },
  { id: 'hover', texto: 'On hover' },
]

function Subtitulo({ children }: { children: string }) {
  return <h3 className="m-0 mt-4 text-fs-xs font-medium uppercase tracking-wide text-muted-foreground first:mt-0">{children}</h3>
}

export default function EditorGraphSection({ prefs, disabled = false, onChange, onResetGraph }: EditorGraphSectionProps) {
  const editor = (patch: Partial<PrefsDelEditor>) => onChange((p) => ({ ...p, editor: { ...p.editor, ...patch } }))
  const grafo = (patch: Partial<PrefsDelGrafo>) => onChange((p) => ({ ...p, graph: { ...p.graph, ...patch } }))
  const interruptor = (id: string, checked: boolean, alCambiar: (v: boolean) => void) => (
    <Switch aria-labelledby={id} checked={checked} disabled={disabled} onCheckedChange={alCambiar} />
  )

  return (
    <>
      <Subtitulo>Editor</Subtitulo>
      <SettingRow id="pref-live-preview" nombre="Live preview" descripcion="Hide Markdown syntax except on the line you're editing."
        control={interruptor('pref-live-preview', prefs.editor.livePreview, (v) => editor({ livePreview: v }))} />
      <SettingRow id="pref-readable-width" nombre="Readable line width" descripcion="Cap note width so long lines are easy to read."
        control={interruptor('pref-readable-width', prefs.editor.readableWidth, (v) => editor({ readableWidth: v }))} />
      <SettingRow id="pref-spellcheck" nombre="Spellcheck" descripcion="Underline misspelled words while you write."
        control={interruptor('pref-spellcheck', prefs.editor.spellcheck, (v) => editor({ spellcheck: v }))} />
      <SettingRow nombre="Font size" descripcion="Size of the note text."
        control={
          <Select value={String(prefs.editor.fontSize)} disabled={disabled} onValueChange={(v) => editor({ fontSize: Number(v) })}>
            <SelectTrigger size="sm" aria-label="Font size"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TAMANOS_DE_LETRA.map((n) => <SelectItem key={n} value={String(n)}>{n} px</SelectItem>)}
            </SelectContent>
          </Select>
        } />

      <Subtitulo>Graph</Subtitulo>
      <SettingRow id="pref-remember" nombre="Remember graph filters" descripcion="Keep orphans, guessed links, colours and forces as you left them."
        control={interruptor('pref-remember', prefs.graph.remember, (v) => grafo(v ? { remember: true } : { remember: false, filtros: undefined }))} />
      <SettingRow nombre="Labels" descripcion="When node names show on the graph."
        control={
          <Select value={prefs.graph.labels} disabled={disabled} onValueChange={(v) => grafo({ labels: v as EtiquetasDelGrafo })}>
            <SelectTrigger size="sm" aria-label="Labels"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ETIQUETAS.map((e) => <SelectItem key={e.id} value={e.id}>{e.texto}</SelectItem>)}
            </SelectContent>
          </Select>
        } />
      <SettingRow id="pref-animate" nombre="Animate graph" descripcion="Turn off on slow machines: nodes appear already in place."
        control={interruptor('pref-animate', prefs.graph.animate, (v) => grafo({ animate: v }))} />
      <SettingRow nombre="Reset graph to defaults"
        control={<Button variant="outline" size="sm" disabled={disabled} onClick={onResetGraph}>Reset</Button>} />
    </>
  )
}
```

- [ ] **Step 4:** `npx vitest run src/__tests__/components/EditorGraphSection.test.tsx src/__tests__/components/memory-settings-primitivos.test.tsx src/__tests__/components/MemoriesWorkspace-tokens.test.tsx` → PASS. Los dos `tsc` → 0.

- [ ] **Step 5: Commit.**

```bash
git add src/components/memories/settings/EditorGraphSection.tsx src/__tests__/components/EditorGraphSection.test.tsx
git commit -m "feat(memories): seccion Editor & graph de Settings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `MemorySettingsTab` y el estado del hilo compartido

**Files:**
- Create: `src/components/MemorySettingsTab.tsx`, `src/lib/pestana-del-hilo.ts`
- Modify: `src/hooks/useTeamThreadSettings.ts` (exporta la interfaz y suma `cargaFallida`), `src/components/TeamThreadToggle.tsx` (recibe `hilo` por props; el markup se reescribe en Task 9)
- Test: `src/__tests__/components/MemorySettingsTab.test.tsx`, `src/__tests__/lib/pestana-del-hilo.test.ts`, `src/__tests__/hooks/useTeamThreadSettings.test.tsx`, `src/__tests__/components/TeamThreadToggle.test.tsx`

**Interfaces:**
- Consumes: `SeccionDeSettings` (Task 2), `MemoryPrefs` (Task 1), `SettingsSection`, `SettingRow` (Task 3), `EditorGraphSection` (Task 4).
- Produces:
  - `export interface UseTeamThreadSettings { ready; projectKey; enabled; error; cargaFallida: boolean; setEnabled }` (`useTeamThreadSettings.ts`). `cargaFallida` = la lectura falló; `error` sigue cubriendo los dos casos (mismo texto que hoy).
  - `pestanaDelHilo(activeRepoPath: string | null, hilo: Pick<UseTeamThreadSettings, 'ready' | 'enabled' | 'cargaFallida'>): boolean | null` (`src/lib/pestana-del-hilo.ts`) — misma regla que el viejo `useTeamThreadEnabled`, sin tratar un error del toggle como "apagado" (D4).
  - `TeamThreadToggle({ hilo }: { hilo: UseTeamThreadSettings })`.
  - `MemorySettingsTab` (default export), props:

```ts
export interface MemorySettingsTabProps {
  seccion: SeccionDeSettings
  onSeccion: (s: SeccionDeSettings) => void
  activeRepoPath: string | null
  onLinkRepo?: () => void
  hilo: UseTeamThreadSettings
  prefs: MemoryPrefs
  prefsCargadas: boolean
  onPrefs: (cambio: (p: MemoryPrefs) => MemoryPrefs) => void
  onResetGraph: () => void
}
```

- [ ] **Step 1: Tests que fallan.** Crear `src/__tests__/lib/pestana-del-hilo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pestanaDelHilo } from '../../lib/pestana-del-hilo'

describe('pestanaDelHilo', () => {
  it('sin repo no hay pestaña', () => {
    expect(pestanaDelHilo(null, { ready: true, enabled: true, cargaFallida: false })).toBe(false)
  })
  it('leyendo = no se sabe (null): la pestaña de la sesión no se cae', () => {
    expect(pestanaDelHilo('/r', { ready: false, enabled: false, cargaFallida: false })).toBeNull()
  })
  it('prendido y leído: sí; una lectura fallida: no', () => {
    expect(pestanaDelHilo('/r', { ready: true, enabled: true, cargaFallida: false })).toBe(true)
    expect(pestanaDelHilo('/r', { ready: true, enabled: true, cargaFallida: true })).toBe(false)
  })
})
```

En `src/__tests__/hooks/useTeamThreadSettings.test.tsx`, dentro del `describe`:

```ts
  it('cargaFallida distingue la lectura rota del rechazo al cambiar (D4)', async () => {
    ;(window as any).memory.teamThreadSetSettings.mockResolvedValue({ ok: false, message: 'Your plan does not include it' })
    const { result } = renderHook(() => useTeamThreadSettings('/repo'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.cargaFallida).toBe(false)
    await act(() => result.current.setEnabled(true))
    expect(result.current.error).toBe('Your plan does not include it')
    expect(result.current.cargaFallida).toBe(false)
  })
  it('una lectura que falla marca cargaFallida', async () => {
    ;(window as any).memory.teamThreadGetSettings.mockResolvedValue({ ok: false })
    const { result } = renderHook(() => useTeamThreadSettings('/repo'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.cargaFallida).toBe(true)
  })
```

Reemplazar los dos `render(<TeamThreadToggle activeRepoPath="/repo" />)` de `src/__tests__/components/TeamThreadToggle.test.tsx` por `render(<ConHilo />)`, con este helper arriba de los tests:

```tsx
import { useTeamThreadSettings } from '../../hooks/useTeamThreadSettings'
function ConHilo() {
  const hilo = useTeamThreadSettings('/repo')
  return <TeamThreadToggle hilo={hilo} />
}
```

Crear `src/__tests__/components/MemorySettingsTab.test.tsx` (las tarjetas, mockeadas como lo hacía `MemorySettingsView.test.tsx`; sus tests propios cubren lo de adentro):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MemorySettingsTab, { type MemorySettingsTabProps } from '../../components/MemorySettingsTab'
import { DEFAULT_MEMORY_PREFS } from '../../lib/memory-prefs'

vi.mock('../../components/CloudMemoryCard', () => ({ default: () => <div>cloud-card</div> }))
vi.mock('../../components/LinkDeviceCard', () => ({ default: () => <div>link-card</div> }))
vi.mock('../../components/SyncServiceCard', () => ({ default: () => <div>service-card</div> }))
vi.mock('../../components/MemoryEncryptionCard', () => ({ default: () => <div>enc-card</div> }))
vi.mock('../../components/TeamEncryptionCard', () => ({ default: () => <div>team-enc-card</div> }))
vi.mock('../../components/ShareProjectCard', () => ({ default: () => <div>share-card</div> }))
vi.mock('../../components/TeamThreadToggle', () => ({ default: (p: { hilo: { enabled: boolean } }) => <div>thread-toggle {String(p.hilo.enabled)}</div> }))
vi.mock('../../components/MemoryVaultCard', () => ({ default: () => <div>vault-card</div> }))
const team = vi.hoisted(() => ({ activeTeam: null as null | { id: string; name: string } }))
vi.mock('../../hooks/useTeam', () => ({ useTeam: () => team }))

const hilo = { ready: true, projectKey: 'pk', enabled: true, error: null, cargaFallida: false, setEnabled: vi.fn() }
const montar = (over: Partial<MemorySettingsTabProps> = {}) => {
  const p: MemorySettingsTabProps = {
    seccion: 'sync', onSeccion: vi.fn(), activeRepoPath: '/repos/raven-nest', onLinkRepo: vi.fn(), hilo,
    prefs: DEFAULT_MEMORY_PREFS, prefsCargadas: true, onPrefs: vi.fn(), onResetGraph: vi.fn(), ...over,
  }
  render(<MemorySettingsTab {...p} />)
  return p
}

beforeEach(() => { team.activeTeam = null })

describe('MemorySettingsTab', () => {
  it('Sync: título, bajada y sus tarjetas', () => {
    montar()
    expect(screen.getByRole('heading', { name: 'Sync' })).toBeInTheDocument()
    expect(screen.getByText('Your memory on every machine you sign in to.')).toBeInTheDocument()
    expect(screen.getByText('cloud-card')).toBeInTheDocument()
  })

  it('Encryption: la de equipo sólo con un equipo activo', () => {
    montar({ seccion: 'encryption' })
    expect(screen.getByText('The server stores your memory without being able to read it.')).toBeInTheDocument()
    expect(screen.getByText('enc-card')).toBeInTheDocument()
    expect(screen.queryByText('team-enc-card')).toBeNull()
  })

  it('Encryption con equipo activo muestra la de equipo', () => {
    team.activeTeam = { id: 't', name: 'STI' }
    montar({ seccion: 'encryption' })
    expect(screen.getByText('team-enc-card')).toBeInTheDocument()
  })

  it('Editor & graph: sus filas, y un cambio va a onPrefs', () => {
    const p = montar({ seccion: 'editor' })
    expect(screen.getByRole('heading', { name: 'Editor & graph' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Spellcheck' }))
    expect(p.onPrefs).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(p.onResetGraph).toHaveBeenCalled()
  })

  it('This project con repo: «Settings for <repo>.», compartir y el toggle con el hilo compartido', () => {
    montar({ seccion: 'project' })
    expect(screen.getByText(/Settings for/)).toBeInTheDocument()
    expect(screen.getByText('raven-nest').className).toMatch(/font-mono/)
    expect(screen.getByText('share-card')).toBeInTheDocument()
    expect(screen.getByText('thread-toggle true')).toBeInTheDocument()
  })

  it('This project sin repo: sólo ofrece vincular uno', () => {
    const p = montar({ seccion: 'project', activeRepoPath: null })
    expect(screen.getByText('Open a repo in this tab to see its settings.')).toBeInTheDocument()
    expect(screen.queryByText('share-card')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Link a repo' }))
    expect(p.onLinkRepo).toHaveBeenCalled()
  })

  it('Notes on disk y Advanced', () => {
    montar({ seccion: 'disk' })
    expect(screen.getByText('vault-card')).toBeInTheDocument()
  })

  it('Advanced lleva el servidor propio', () => {
    montar({ seccion: 'advanced' })
    expect(screen.getByText('Only if your company runs its own Nest server.')).toBeInTheDocument()
    expect(screen.getByText('service-card')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2:** `npx vitest run src/__tests__/lib/pestana-del-hilo.test.ts src/__tests__/hooks/useTeamThreadSettings.test.tsx src/__tests__/components/TeamThreadToggle.test.tsx src/__tests__/components/MemorySettingsTab.test.tsx` → FAIL.

- [ ] **Step 3: `cargaFallida` y la regla de la pestaña.** En `src/hooks/useTeamThreadSettings.ts`: `export interface UseTeamThreadSettings` con `cargaFallida: boolean` (doc: "La LECTURA falló. Un rechazo al cambiar no la marca: el hilo sigue como estaba."); `const [cargaFallida, setCargaFallida] = useState(false)`; en el efecto, junto a `setError(null)` del principio, `setCargaFallida(false)`; en cada rama que hace `setError(LOAD_ERROR)` (las tres), sumar `setCargaFallida(true)`; devolver `{ ready, projectKey, enabled, error, cargaFallida, setEnabled }`. Actualizar el doc de `nonce`: ya no lo usa Memories (queda para un caller que necesite releer). Crear `src/lib/pestana-del-hilo.ts`:

```ts
// ¿Va la pestaña «Team thread» de Memories? Sale del MISMO estado que usa el toggle de
// Branch notes (el workspace lo levanta y se lo pasa a la pestaña Settings): prender o apagar
// el hilo se ve en el acto, sin releer al volver (spec 2026-10-21 §3, arreglo de Task 10).
//
// `null` = todavía no se sabe (leyendo): al reabrir el overlay la pestaña viene de la caché de
// sesión, y tratar "leyendo" como "apagado" la sacaba antes de que llegara la respuesta.
// Sólo una LECTURA fallida cuenta como apagado (D4): un rechazo al cambiarlo no saca la
// pestaña, porque el hilo sigue prendido.
import type { UseTeamThreadSettings } from '../hooks/useTeamThreadSettings'

export function pestanaDelHilo(
  activeRepoPath: string | null,
  hilo: Pick<UseTeamThreadSettings, 'ready' | 'enabled' | 'cargaFallida'>,
): boolean | null {
  if (!activeRepoPath) return false
  if (!hilo.ready) return null
  return hilo.enabled && !hilo.cargaFallida
}
```

(`src/lib/pestana-del-hilo.ts` importa sólo un tipo: no arrastra el hook al bundle de la lib.)

- [ ] **Step 4: `TeamThreadToggle` por props.** En `src/components/TeamThreadToggle.tsx`: `import type { UseTeamThreadSettings } from '../hooks/useTeamThreadSettings'`, `interface Props { hilo: UseTeamThreadSettings }`, `export default function TeamThreadToggle({ hilo: t }: Props)` y borrar la línea `const t = useTeamThreadSettings(activeRepoPath)` (y su import). El markup no cambia en esta tarea. Comentario de cabecera: "el estado lo levanta MemoriesWorkspace (lo comparte con la pestaña Team thread)".

- [ ] **Step 5: La pestaña.** Crear `src/components/MemorySettingsTab.tsx`:

```tsx
// La pestaña Settings de Memories (spec 2026-10-21 §3-§5): una sección por vez (D1). Vive
// FUERA de components/memories/ porque monta las tarjetas que hablan con window.memory; las
// piezas puras (fila, sección, Editor & graph) sí están allá y entran por props.
import CloudMemoryCard from './CloudMemoryCard'
import LinkDeviceCard from './LinkDeviceCard'
import SyncServiceCard from './SyncServiceCard'
import MemoryEncryptionCard from './MemoryEncryptionCard'
import TeamEncryptionCard from './TeamEncryptionCard'
import ShareProjectCard from './ShareProjectCard'
import TeamThreadToggle from './TeamThreadToggle'
import MemoryVaultCard from './MemoryVaultCard'
import SettingsSection from './memories/settings/SettingsSection'
import SettingRow from './memories/settings/SettingRow'
import EditorGraphSection from './memories/settings/EditorGraphSection'
import { useTeam } from '../hooks/useTeam'
import type { UseTeamThreadSettings } from '../hooks/useTeamThreadSettings'
import type { SeccionDeSettings } from '../lib/memory-tabs'
import type { MemoryPrefs } from '../lib/memory-prefs'
import { Button } from '@/components/ui/button'

export interface MemorySettingsTabProps {
  seccion: SeccionDeSettings
  onSeccion: (s: SeccionDeSettings) => void
  activeRepoPath: string | null
  onLinkRepo?: () => void
  /** El estado del hilo del workspace: el mismo que decide la pestaña Team thread. */
  hilo: UseTeamThreadSettings
  prefs: MemoryPrefs
  prefsCargadas: boolean
  onPrefs: (cambio: (p: MemoryPrefs) => MemoryPrefs) => void
  onResetGraph: () => void
}

/** D19: el nombre de la carpeta del repo, que es como lo reconoce la persona. */
function nombreDelRepo(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export default function MemorySettingsTab(p: MemorySettingsTabProps) {
  const { activeTeam } = useTeam()
  switch (p.seccion) {
    case 'sync':
      return (
        <SettingsSection titulo="Sync" bajada="Your memory on every machine you sign in to.">
          <CloudMemoryCard />
          <LinkDeviceCard />
        </SettingsSection>
      )
    case 'encryption':
      return (
        <SettingsSection titulo="Encryption" bajada="The server stores your memory without being able to read it.">
          <MemoryEncryptionCard />
          {activeTeam && <TeamEncryptionCard />}
        </SettingsSection>
      )
    case 'editor':
      return (
        <SettingsSection titulo="Editor & graph">
          <EditorGraphSection prefs={p.prefs} disabled={!p.prefsCargadas} onChange={p.onPrefs} onResetGraph={p.onResetGraph} />
        </SettingsSection>
      )
    case 'project':
      return p.activeRepoPath ? (
        <SettingsSection titulo="This project" bajada={<>Settings for <span className="font-mono">{nombreDelRepo(p.activeRepoPath)}</span>.</>}>
          <ShareProjectCard activeRepoPath={p.activeRepoPath} />
          <TeamThreadToggle hilo={p.hilo} />
        </SettingsSection>
      ) : (
        <SettingsSection titulo="This project">
          <SettingRow
            nombre="Open a repo in this tab to see its settings."
            control={p.onLinkRepo && <Button variant="outline" size="sm" onClick={p.onLinkRepo}>Link a repo</Button>}
          />
        </SettingsSection>
      )
    case 'disk':
      return (
        <SettingsSection titulo="Notes on disk">
          <MemoryVaultCard />
        </SettingsSection>
      )
    case 'advanced':
      return (
        <SettingsSection titulo="Advanced" bajada="Only if your company runs its own Nest server.">
          <SyncServiceCard />
        </SettingsSection>
      )
  }
}
```

- [ ] **Step 6:** `npx vitest run src/__tests__/lib/pestana-del-hilo.test.ts src/__tests__/hooks/useTeamThreadSettings.test.tsx src/__tests__/components/TeamThreadToggle.test.tsx src/__tests__/components/MemorySettingsTab.test.tsx src/__tests__/components/TeamThreadPanel.test.tsx` → PASS. **`MemorySettingsView.tsx` todavía monta `<TeamThreadToggle activeRepoPath=…>`**: los dos `tsc` van a marcarlo. Arreglo transitorio de esta tarea (la vista se borra en Task 6): en `MemorySettingsView.tsx`, `import { useTeamThreadSettings } from '../hooks/useTeamThreadSettings'`, `const hilo = useTeamThreadSettings(activeRepoPath)` junto a `useTeam()`, y `<TeamThreadToggle hilo={hilo} />`. Con eso los dos `tsc` → 0 y `npx vitest run src/__tests__/components/MemorySettingsView.test.tsx` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/components/MemorySettingsTab.tsx src/lib/pestana-del-hilo.ts src/hooks/useTeamThreadSettings.ts src/components/TeamThreadToggle.tsx src/components/MemorySettingsView.tsx src/__tests__/components/MemorySettingsTab.test.tsx src/__tests__/lib/pestana-del-hilo.test.ts src/__tests__/hooks/useTeamThreadSettings.test.tsx src/__tests__/components/TeamThreadToggle.test.tsx
git commit -m "feat(memories): pestana Settings con sus seis secciones y el hilo por props

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: El workspace: Settings como pestaña (sale la vista, el Back y el tour del rail)

**Files:**
- Modify: `src/components/MemoriesWorkspace.tsx`, `src/App.tsx` (líneas ~61, 250-268, 303-310, 600-620, 2227-2252, 2355-2361), `src/lib/memoriesWelcome.ts`, `src/hooks/useGraphFilters.ts` (suma `restablecer`), `src/tutorial/registry.ts`, `src/tutorial/types.ts:5`
- Delete: `src/components/MemorySettingsView.tsx`, `src/__tests__/components/MemorySettingsView.test.tsx`, `src/tutorial/tours/memory-settings.ts`, `src/hooks/useTeamThreadEnabled.ts`
- Test: `src/__tests__/components/MemoriesWorkspace.test.tsx`, `src/__tests__/components/MemoriesWorkspace-obsidian.test.tsx`, `src/__tests__/components/MemoriesWorkspace-columnas.test.tsx`, `src/__tests__/lib/memoriesWelcome.test.ts`, `src/__tests__/tutorial/section-tours.test.ts`

**Interfaces:**
- Consumes: `useMemoryTabs(conHilo, pedidoDeSettings)` + `openSettings` (Task 2), `SECCIONES_DE_SETTINGS` (Task 2), `SettingsSectionList` (Task 3), `MemorySettingsTab` (Task 5), `useTeamThreadSettings` + `pestanaDelHilo` (Task 5), `useMemoryPrefs` (Task 1), `FILTROS_POR_DEFECTO` (Task 1).
- Produces:
  - `MemoriesWorkspace` props: **salen** `vistaInicial`, `onMemorySettingsTour`, `onVistaChange`; **entra** `pedidoDeSettings?: number`.
  - `useGraphFilters(...)` devuelve además `restablecer: () => void` (estable): colorBy `type`, foco `null`, hideOrphans `true`, sin tipos ocultos, escala 1, distancia 50.
  - `shouldShowMemoriesWelcome(opts: { memoriesOpen: boolean; abiertaEnSettings: boolean; forced: boolean; hasSeenMemoriesWelcome: boolean; e2eBypass: boolean }): boolean`.
  - `TourId` sin `'memory-settings'`.

- [ ] **Step 1: Tests que fallan — el workspace.** En `src/__tests__/components/MemoriesWorkspace.test.tsx`: sacar `vistaInicial`, `onVistaChange` y `onMemorySettingsTour` de `renderWorkspace` (y sumar `pedidoDeSettings?: number`, pasado tal cual). **Borrar** los tests `'Settings abre la vista de settings y Back vuelve a los nodos'`, `'vistaInicial=settings abre directo en settings'`, `'onVistaChange avisa la vista inicial al montar y cada navegacion interna'` y `'onVistaChange con vistaInicial=settings avisa "settings" desde el montaje'` (con su comentario de "IMPORTANT #5"). Sumar (importar `within` de Testing Library):

```tsx
  it('el engranaje abre la pestaña Settings: secciones a la izquierda, Sync en el centro', async () => {
    setMemoryApi(api({ onStatus: () => {}, removeStatusListener: () => {} }))
    renderWorkspace({ activeRepoPath: '/r' })
    fireEvent.click(screen.getByRole('button', { name: 'Memory settings' }))
    expect(screen.getByRole('tab', { name: /Settings/, selected: true })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getByRole('button', { name: 'Sync' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Sync' })).toBeInTheDocument()
    // El header no cambia: no hay "vista" de settings, sólo una pestaña más.
    expect(screen.getByText('Memories', { selector: '.tw-header-title' })).toBeInTheDocument()
  })

  it('pedidoDeSettings (Account → Memory settings) abre directo en la pestaña Settings', () => {
    setMemoryApi(api({ onStatus: () => {}, removeStatusListener: () => {} }))
    renderWorkspace({ activeRepoPath: null, pedidoDeSettings: 1 })
    expect(screen.getByRole('tab', { name: /Settings/, selected: true })).toBeInTheDocument()
  })

  it('con Settings activa, Back cierra el overlay entero', () => {
    setMemoryApi(api({ onStatus: () => {}, removeStatusListener: () => {} }))
    const onClose = vi.fn()
    renderWorkspace({ onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Memory settings' }))
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
```

En `src/__tests__/components/MemoriesWorkspace-obsidian.test.tsx`: sacar `onMemorySettingsTour` de `props()`; sumar al `api()` base `onStatus: () => {}, removeStatusListener: () => {}, encryptionStatus: vi.fn().mockResolvedValue({ available: false, active: false, keyEpoch: 0, pendingDevices: [], undecryptable: 0 })` (lo mínimo para que monte la sección Sync). Reemplazar el `describe('Team thread y Memory settings', …)` entero por:

```tsx
  // El toggle de Branch notes vive en una pestaña del MISMO workspace: comparte el estado del
  // hilo, así que la pestaña Team thread se entera en el acto (arreglo de Task 10 del 20-10).
  describe('Team thread y la pestaña Settings', () => {
    let prendido = false
    const apiDelHilo = (over: Record<string, unknown> = {}) => api({
      graph: vi.fn().mockResolvedValue(grafoAB()),
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue({ ok: true, projectKey: 'proj1111aaaaaaaa' }),
      teamThreadGetSettings: vi.fn().mockImplementation(async () => ({ ok: true, settings: { enabled: prendido, includedTypes: [], writeAgentsPointer: false } })),
      teamThreadSetSettings: vi.fn().mockResolvedValue({ ok: true }),
      teamThreadRead: vi.fn().mockResolvedValue({ ok: true, branches: [] }),
      ...over,
    })
    beforeEach(() => {
      ;(window as unknown as { git: unknown }).git = { info: vi.fn().mockResolvedValue({ branch: 'main', remoteUrl: null, githubUrl: null, isDirty: false }) }
    })
    const abrirBranchNotes = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Memory settings' }))
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: 'This project' }))
      const sw = await screen.findByRole('switch', { name: /Branch notes/ })
      await waitFor(() => expect(sw).not.toBeDisabled())
      return sw
    }

    it('prenderlo en Settings hace aparecer la pestaña Team thread, sin volver a ningún lado', async () => {
      prendido = false
      const m = apiDelHilo()
      setMemoryApi(m)
      render(<MemoriesWorkspace {...props({ activeRepoPath: '/r' })} />)
      await screen.findByRole('button', { name: 'node Otra' })
      expect(screen.queryByRole('tab', { name: /Team thread/ })).toBeNull()
      fireEvent.click(await abrirBranchNotes())
      expect(await screen.findByRole('tab', { name: /Team thread/ })).toBeInTheDocument()
      expect(m.teamThreadSetSettings).toHaveBeenCalledWith('proj1111aaaaaaaa', '/r', { enabled: true })
      expect(screen.getByRole('tab', { name: /Settings/, selected: true })).toBeInTheDocument()
    })

    it('apagarlo saca la pestaña; cerrar Settings vuelve a Graph', async () => {
      prendido = true
      setMemoryApi(apiDelHilo())
      render(<MemoriesWorkspace {...props({ activeRepoPath: '/r' })} />)
      fireEvent.click(await screen.findByRole('tab', { name: /Team thread/ }))
      fireEvent.click(await abrirBranchNotes())
      await waitFor(() => expect(screen.queryByRole('tab', { name: /Team thread/ })).toBeNull())
      fireEvent.click(within(screen.getByRole('tab', { name: /Settings/ })).getByRole('button', { name: 'Close tab' }))
      expect(screen.getByRole('tab', { name: /Graph/, selected: true })).toBeInTheDocument()
    })

    it('un rechazo al cambiarlo muestra el motivo y no saca la pestaña (Review Focus 3)', async () => {
      prendido = true
      setMemoryApi(apiDelHilo({ teamThreadSetSettings: vi.fn().mockResolvedValue({ ok: false, message: 'Your plan does not include team sharing.' }) }))
      render(<MemoriesWorkspace {...props({ activeRepoPath: '/r' })} />)
      expect(await screen.findByRole('tab', { name: /Team thread/ })).toBeInTheDocument()
      fireEvent.click(await abrirBranchNotes())
      expect(await screen.findByText('Your plan does not include team sharing.')).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /Team thread/ })).toBeInTheDocument()
    })

    it('al reabrir el overlay, la pestaña del hilo no se cae mientras se vuelve a leer', async () => {
      prendido = true
      setMemoryApi(apiDelHilo())
      const { unmount } = render(<MemoriesWorkspace {...props({ activeRepoPath: '/r' })} />)
      fireEvent.click(await screen.findByRole('tab', { name: /Team thread/ }))
      unmount()

      let responder: ((v: unknown) => void) | null = null
      setMemoryApi(apiDelHilo({ teamThreadGetSettings: vi.fn().mockImplementation(() => new Promise((r) => { responder = r })) }))
      render(<MemoriesWorkspace {...props({ activeRepoPath: '/r' })} />)
      await waitFor(() => expect(responder).not.toBeNull())
      expect(screen.getByRole('tab', { name: /Team thread/, selected: true })).toBeInTheDocument()
      responder!({ ok: true, settings: { enabled: true, includedTypes: [], writeAgentsPointer: false } })
      await waitFor(() => expect(screen.getByRole('tab', { name: /Team thread/, selected: true })).toBeInTheDocument())
    })
  })

  describe('la pestaña Settings', () => {
    const conGrafo = (over: Record<string, unknown> = {}) => api({
      graph: vi.fn().mockResolvedValue(grafoAB()),
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      observation: vi.fn().mockImplementation(async (id: string) => detalle(id)),
      ...over,
    })

    it('el explorer muestra las secciones; al volver, las carpetas y la búsqueda siguen', async () => {
      setMemoryApi(conGrafo())
      render(<MemoriesWorkspace {...props()} />)
      fireEvent.change(await screen.findByRole('textbox', { name: 'Search memories' }), { target: { value: 'auth' } })
      fireEvent.click(screen.getByRole('button', { name: 'Memory settings' }))
      const nav = screen.getByRole('navigation', { name: 'Settings sections' })
      expect(within(nav).getAllByRole('button').map((b) => b.textContent))
        .toEqual(['Sync', 'Encryption', 'Editor & graph', 'This project', 'Notes on disk', 'Advanced'])
      expect(screen.queryByRole('textbox', { name: 'Search memories' })).toBeNull()
      fireEvent.click(within(nav).getByRole('button', { name: 'Advanced' }))
      expect(within(nav).getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-current', 'page')
      expect(screen.getByRole('heading', { name: 'Advanced' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('tab', { name: /Graph/ }))
      expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull()
      expect(screen.getByRole('textbox', { name: 'Search memories' })).toHaveValue('auth')
    })

    it('Ctrl+W con Settings activa cierra la pestaña y no llega a la ventana (Review Focus 4)', async () => {
      setMemoryApi(conGrafo())
      render(<MemoriesWorkspace {...props()} />)
      fireEvent.click(screen.getByRole('button', { name: 'Memory settings' }))
      const enWindow = vi.fn()
      window.addEventListener('keydown', enWindow)
      try {
        const ev = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true })
        fireEvent(raiz(), ev)
        await waitFor(() => expect(screen.queryByRole('tab', { name: /Settings/ })).toBeNull())
        expect(ev.defaultPrevented).toBe(true)
        expect(enWindow).not.toHaveBeenCalled()
        expect(screen.getByRole('tab', { name: /Graph/, selected: true })).toBeInTheDocument()
      } finally {
        window.removeEventListener('keydown', enWindow)
      }
    })

    it('una nota sin guardar sigue montada detrás de Settings y se guarda (Review Focus 5)', async () => {
      const updateFromUi = vi.fn().mockResolvedValue({ ok: true, saved: { title: 'Escrito antes', content: 'Cuerpo' } })
      setMemoryApi(conGrafo({ updateFromUi }))
      render(<MemoriesWorkspace {...props()} />)
      await abrirA()
      fireEvent.change(screen.getByRole('textbox', { name: 'Memory title' }), { target: { value: 'Escrito antes' } })
      fireEvent.click(screen.getByRole('button', { name: 'Memory settings' }))
      await waitFor(() => expect(updateFromUi).toHaveBeenCalledWith(expect.objectContaining({ syncId: 'a', title: 'Escrito antes' })), { timeout: 3000 })
      fireEvent.click(screen.getByRole('tab', { name: /Escrito antes|Auth pasa a cookies/ }))
      expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveValue('Escrito antes')
    })
  })
```

(Si el `updateFromUi` de los tests existentes de ese archivo devuelve otra forma, usar la misma que `'guardar pasa el resultado entero de updateFromUi al editor'`.)

En `src/__tests__/components/MemoriesWorkspace-columnas.test.tsx`: sacar `onMemorySettingsTour={() => {}}` de `montar`. En `'el colapso por ventana angosta es solo al montar: volver de Settings no lo repite'`, reemplazar las dos líneas de Settings → Memories por:

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'Memory settings' }))
    await waitFor(() => expect(tamDerecho()).toBe(0))
    fireEvent.click(screen.getByRole('tab', { name: /Graph/ }))
```

y sumar:

```tsx
  it('con Settings activa el panel derecho se oculta y vuelve al salir, sin guardarlo', async () => {
    ancho(1400)
    montar()
    await screen.findByRole('tab', { name: /Graph/ })
    expect(tamDerecho()).toBe(22)
    fireEvent.click(screen.getByRole('button', { name: 'Memory settings' }))
    await waitFor(() => expect(tamDerecho()).toBe(0))
    expect(guardado()?.[2]).toBe(22)
    fireEvent.click(screen.getByRole('tab', { name: /Graph/ }))
    await waitFor(() => expect(tamDerecho()).toBe(22))
  })

  it('de Team thread directo a Settings el panel sigue cerrado (un solo motivo, D6)', async () => {
    ancho(1400)
    montar()
    fireEvent.click(await screen.findByRole('tab', { name: /Team thread/ }))
    await waitFor(() => expect(tamDerecho()).toBe(0))
    fireEvent.click(screen.getByRole('button', { name: 'Memory settings' }))
    await waitFor(() => expect(tamDerecho()).toBe(0))
    fireEvent.click(screen.getByRole('tab', { name: /Graph/ }))
    await waitFor(() => expect(tamDerecho()).toBe(22))
  })
```

En `src/__tests__/lib/memoriesWelcome.test.ts`: en `base`, `vista: 'memorias' as const` → `abiertaEnSettings: false`; reemplazar el último test por:

```ts
  it('no se auto-muestra si Memories abrió desde Account → Memory settings, pero How it works sí', () => {
    expect(shouldShowMemoriesWelcome({ ...base, abiertaEnSettings: true })).toBe(false)
    expect(shouldShowMemoriesWelcome({ ...base, abiertaEnSettings: true, forced: true })).toBe(true)
  })
```

En `src/__tests__/tutorial/section-tours.test.ts`: borrar el import de `SECCIONES_DE_MEMORIA_IDS`, la entrada `'memory-settings'` de `SECTION_TOURS`, la línea `for (const seccion of SECCIONES_DE_MEMORIA_IDS) …`; el `describe` pasa a `'section tours (my-repos, teams, memories)'` y el registro esperado a `['memories', 'my-repos', 'teams', 'worktrees']`.

- [ ] **Step 2:** `npx vitest run src/__tests__/components/MemoriesWorkspace.test.tsx src/__tests__/components/MemoriesWorkspace-obsidian.test.tsx src/__tests__/components/MemoriesWorkspace-columnas.test.tsx src/__tests__/lib/memoriesWelcome.test.ts src/__tests__/tutorial/section-tours.test.ts` → FAIL.

- [ ] **Step 3: `restablecer` en `useGraphFilters`.** En `src/hooks/useGraphFilters.ts`, `import { FILTROS_POR_DEFECTO } from '../lib/memory-prefs'`, usar `FILTROS_POR_DEFECTO.*` como valores de arranque de los `useState` (mismos valores de hoy) y sumar antes del `return`:

```ts
  /** «Reset graph to defaults» (spec §5): filtros y fuerzas al arranque, y sin foco. */
  const restablecer = useCallback(() => {
    setColorBy(FILTROS_POR_DEFECTO.colorBy)
    setFoco(null)
    setHideOrphans(FILTROS_POR_DEFECTO.hideOrphans)
    setTiposOcultos(new Set())
    setEscalaDeNodo(FILTROS_POR_DEFECTO.escalaDeNodo)
    setDistanciaDeLinks(FILTROS_POR_DEFECTO.distanciaDeLinks)
  }, [])
```

y `restablecer` en el objeto que devuelve.

- [ ] **Step 4: El workspace.** En `src/components/MemoriesWorkspace.tsx`:
  - Comentario de cabecera: reemplazar el párrafo "2026-10-19: la vista principal YA NO tiene configuracion…" por "2026-10-21 (spec Memory settings como pestaña): la configuración es una PESTAÑA más (Settings, cerrable). Con ella activa el explorer muestra las secciones y el panel derecho se colapsa solo; ya no hay una segunda vista ni un Back que vuelva a los nodos."
  - Imports: sacar `MemorySettingsView` y `useTeamThreadEnabled`; sumar:

```ts
import { useTeamThreadSettings } from '../hooks/useTeamThreadSettings'
import { useMemoryPrefs } from '../hooks/useMemoryPrefs'
import { pestanaDelHilo } from '../lib/pestana-del-hilo'
import { SECCIONES_DE_SETTINGS, tabId, type MemoryTab } from '../lib/memory-tabs'
import MemorySettingsTab from './MemorySettingsTab'
import SettingsSectionList from './memories/settings/SettingsSectionList'
```

  - `Props`: borrar `vistaInicial`, `onMemorySettingsTour` y `onVistaChange` (con sus comentarios) y sumar:

```ts
  /** Sube cada vez que algo de afuera (Account → "Memory settings") pide abrir la pestaña
   *  Settings; useMemoryTabs atiende cada pedido una vez por sesión (D5). */
  pedidoDeSettings?: number
```

  - Firma: `onClose, activeRepoPath, onOpenFile, onLinkRepo, closing = false, ansi, onHowItWorks, pedidoDeSettings = 0`.
  - Borrar el `useState` de `vista` y su `useEffect` de `onVistaChange`.
  - Reemplazar el bloque de `releerHilo` / `useTeamThreadEnabled` / `useMemoryTabs(conHilo)` por:

```ts
  // El estado del hilo, UNO solo para la pestaña Team thread y el toggle de Branch notes de la
  // pestaña Settings (D3): prender o apagar se ve en el acto.
  const hilo = useTeamThreadSettings(activeRepoPath)
  const conHilo = pestanaDelHilo(activeRepoPath, hilo)
  const tabs = useMemoryTabs(conHilo, pedidoDeSettings)
  const activa: MemoryTab = tabs.tabs.find((t) => tabId(t) === tabs.activeId) ?? tabs.tabs[0]
  const settingsActiva = activa.kind === 'settings'
  const prefsMem = useMemoryPrefs()
```

  - Después de `const filtros = useGraphFilters(…)`:

```ts
  const restablecerFiltros = filtros.restablecer
  const restablecerGrafo = useCallback(() => { restablecerFiltros(); setIncludeSimilar(true) }, [restablecerFiltros])
```

  - `const { open: abrirPestana, close: cerrarPestana, replace: reemplazarPestana, openSettings: abrirSettings } = tabs`
  - En `alTeclear`, borrar `if (vista !== 'memorias') return`.
  - Colapso del panel derecho (D6): `motivosDelAuto = useRef({ angosto: false, pestana: false })`; los tipos de `colapsarSolo`/`liberarAuto` pasan a `'angosto' | 'pestana'`; en `liberarAuto`, `if (motivosDelAuto.current.angosto || motivosDelAuto.current.pestana) return`; en `alCambiarColumnas`, `motivosDelAuto.current = { angosto: false, pestana: false }`; el efecto del hilo pasa a:

```ts
  // Spec §3: con Team thread o Settings activa el panel derecho se oculta; al salir vuelve
  // como estaba, sin guardar ese colapso (Ruling 11).
  const pestanaSinPanel = activa.kind === 'thread' || activa.kind === 'settings'
  useEffect(() => {
    if (pestanaSinPanel) colapsarSolo('pestana')
    else liberarAuto('pestana')
  }, [pestanaSinPanel, colapsarSolo, liberarAuto])
```

  (y el comentario del efecto de ventana angosta: "SOLO al montar el grupo, que vive mientras el overlay está abierto".)
  - Header, reemplazar desde `<button className="tw-back-btn"` hasta el cierre del `tw-header-right` por:

```tsx
        <button className="tw-back-btn" onClick={onClose}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 5 }}>
            <path d="M8 2L4 6.5L8 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>

        <div className="tw-header-center">
          <span className="tw-header-title">Memories</span>
        </div>

        <div className="tw-header-right">
          <Button variant="ghost" size="sm" onClick={onHowItWorks} data-tour-id="memories-how">
            How it works
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Memory settings"
            onClick={() => abrirSettings()}
            data-tour-id="memories-settings"
          >
            <Settings size={ICON_SIZE.sm} aria-hidden />
            Settings
          </Button>
        </div>
```

  (el comentario del título se conserva.)
  - Borrar `{vista === 'settings' && (<MemorySettingsView …/>)}` y su comentario. El `<div hidden={vista !== 'memorias'} …>` que envuelve la fila de estado y el cuerpo pasa a `<div className="flex min-h-0 flex-1 flex-col">` (siempre visible).
  - Panel izquierdo, el contenido pasa a:

```tsx
                {/* Con Settings activa, la lista de secciones. El explorer queda MONTADO (oculto):
                    carpetas abiertas/cerradas, scroll y búsqueda siguen al volver (spec §3). */}
                <div hidden={settingsActiva} className={cn('h-full', settingsActiva && 'hidden')}>
                  <MemoriesExplorer
                    {/* …las mismas props de hoy… */}
                  />
                </div>
                {activa.kind === 'settings' && (
                  <SettingsSectionList secciones={SECCIONES_DE_SETTINGS} activa={activa.section} onElegir={abrirSettings} />
                )}
```

  (las props de `MemoriesExplorer` no cambian; el comentario JSX de arriba no va dentro de la lista de props.)
  - Centro, junto a `activa.kind === 'thread'`:

```tsx
                  {/* Settings: se monta sólo mientras está activa, así cada vuelta relee el estado
                      de sync/cifrado/compartir (D3). Las notas siguen montadas detrás. */}
                  {activa.kind === 'settings' && (
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      <MemorySettingsTab
                        seccion={activa.section}
                        onSeccion={abrirSettings}
                        activeRepoPath={activeRepoPath}
                        onLinkRepo={onLinkRepo}
                        hilo={hilo}
                        prefs={prefsMem.prefs}
                        prefsCargadas={prefsMem.cargadas}
                        onPrefs={prefsMem.actualizar}
                        onResetGraph={restablecerGrafo}
                      />
                    </div>
                  )}
```

  - El comentario del `<aside>` derecho: "Con Team thread, Settings o New memory: vacío."

- [ ] **Step 5: App, bienvenida y tours.** En `src/lib/memoriesWelcome.ts`:

```ts
export function shouldShowMemoriesWelcome(opts: {
  memoriesOpen: boolean
  /** Memories se abrió desde Account → "Memory settings" (D5): no se tapa Settings con la
   *  bienvenida de la primera vez. */
  abiertaEnSettings: boolean
  forced: boolean
  hasSeenMemoriesWelcome: boolean
  e2eBypass: boolean
}): boolean {
  const { memoriesOpen, abiertaEnSettings, forced, hasSeenMemoriesWelcome, e2eBypass } = opts
  if (!memoriesOpen) return false
  // "How it works" vive siempre en el header: un pedido explícito se muestra siempre.
  if (forced) return true
  return !abiertaEnSettings && !hasSeenMemoriesWelcome && !e2eBypass
}
```

En `src/App.tsx`:
  - Borrar `import { EVENTO_SECCION } from './components/MemorySettingsView'`.
  - Reemplazar `memoriesVista`, `memoriesVistaActual` y `abrirMemories` (líneas ~251-268) por:

```ts
  // 2026-10-21 (spec Memory settings como pestaña §3, D5): Account → "Memory settings" abre
  // Memories con la pestaña Settings activa. `pedidoDeSettings` cuenta los pedidos (el
  // workspace atiende cada uno una vez); `memoriesEnSettings` sólo evita que la bienvenida de
  // la primera vez tape Settings.
  const [pedidoDeSettings, setPedidoDeSettings] = useState(0)
  const [memoriesEnSettings, setMemoriesEnSettings] = useState(false)
  const abrirMemories = (vista?: 'memorias' | 'settings') => {
    // Defensa en profundidad (fix round 1, Task 6 del 19-10): SOLO el literal 'settings' abre
    // Settings. Un caller que pase el SyntheticEvent de un click cae al grafo.
    const enSettings = vista === 'settings'
    setMemoriesEnSettings(enSettings)
    if (enSettings) setPedidoDeSettings((n) => n + 1)
    setMemoriesOpen(true)
  }
```

  - En `shouldShowMemoriesWelcome({…})`: `vista: memoriesVistaActual` → `abiertaEnSettings: memoriesEnSettings`.
  - Borrar el bloque de `ultimoPasoDelTourRef` / `handleTourStepChange` (líneas ~606-620, con su comentario) y, en `<OnboardingTour …>`, la prop `onStepChange={handleTourStepChange}` con su comentario.
  - En `<MemoriesWorkspace …>`: borrar `key={memoriesVista}` (y su comentario), `vistaInicial={memoriesVista}`, `onMemorySettingsTour={…}`, `onVistaChange={setMemoriesVistaActual}`; sumar `pedidoDeSettings={pedidoDeSettings}`; el comentario de `onHowItWorks` queda: "el botón "How it works" del header reabre la bienvenida a pedido (forced)".
  - Tours: borrar `src/tutorial/tours/memory-settings.ts`; en `src/tutorial/registry.ts` sacar su import y su entrada; en `src/tutorial/types.ts:5` sacar `| 'memory-settings'` de `TourId`.
  - Borrar `src/components/MemorySettingsView.tsx`, `src/__tests__/components/MemorySettingsView.test.tsx` y `src/hooks/useTeamThreadEnabled.ts`. Verificar: `grep -rn "MemorySettingsView\|EVENTO_SECCION\|useTeamThreadEnabled\|memory-settings'\|vistaInicial\|onVistaChange\|onMemorySettingsTour" src` → sin resultados.

- [ ] **Step 6:** `npx vitest run src/__tests__/components/MemoriesWorkspace.test.tsx src/__tests__/components/MemoriesWorkspace-obsidian.test.tsx src/__tests__/components/MemoriesWorkspace-columnas.test.tsx src/__tests__/lib/memoriesWelcome.test.ts src/__tests__/tutorial/section-tours.test.ts src/__tests__/components/SettingsPanel.test.tsx src/__tests__/components/Sidebar-memories.test.tsx` → PASS. Después `npx vitest run` (suite entera) → PASS. Los dos `tsc` → 0. Los e2e de Memories quedan desactualizados hasta Task 13 (no se corren acá).

- [ ] **Step 7: Commit.**

```bash
git add src/components/MemoriesWorkspace.tsx src/App.tsx src/lib/memoriesWelcome.ts src/hooks/useGraphFilters.ts src/tutorial/registry.ts src/tutorial/types.ts src/__tests__/components/MemoriesWorkspace.test.tsx src/__tests__/components/MemoriesWorkspace-obsidian.test.tsx src/__tests__/components/MemoriesWorkspace-columnas.test.tsx src/__tests__/lib/memoriesWelcome.test.ts src/__tests__/tutorial/section-tours.test.ts
git rm src/components/MemorySettingsView.tsx src/__tests__/components/MemorySettingsView.test.tsx src/tutorial/tours/memory-settings.ts src/hooks/useTeamThreadEnabled.ts
git commit -m "feat(memories): Memory settings es una pestana del workspace

Sale la vista de settings, su Back y el tour del rail.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Sync y Advanced en filas

**Files:**
- Modify: `src/components/CloudMemoryCard.tsx` (entero), `src/components/LinkDeviceCard.tsx:79-116`, `src/components/SyncServiceCard.tsx:165-252`, `src/components/MemorySettingsTab.tsx` (sync y advanced)
- Create: `src/components/SyncTokenRow.tsx`
- Test: `src/__tests__/components/CloudMemoryCard.test.tsx`, `src/__tests__/components/SyncTokenRow.test.tsx` (nuevo), `src/__tests__/components/MemorySettingsTab.test.tsx`, `src/__tests__/components/memory-settings-sin-sp.test.ts` (nuevo)

**Interfaces:**
- Consumes: `SettingRow` (Task 3), `useMemory` (sin cambios), `MemorySettingsTab` (Task 5).
- Produces: `CloudMemoryCard()` devuelve filas (Cloud sync, Cloud space, Machine without a browser vía `<LinkDeviceCard />`); `SyncTokenRow()` (default export, sin props); `LinkDeviceCard()` y `SyncServiceCard()` devuelven una `SettingRow`. Sync en `MemorySettingsTab` = `<CloudMemoryCard />`; Advanced = `<SyncServiceCard /><SyncTokenRow />`.

**Tests de comportamiento que se conservan intactos** (`CloudMemoryCard.test.tsx`): Turn off desde `plan_required`/`error`/`connected`/`paused`, el diálogo con «Also delete my cloud memory», el reseteo del checkbox, el botón destructivo sólo con el checkbox, la cuota del servidor (incluido `max_bytes` 0), «Uploading» con punto `bg-warn`, «Retry» pide token con el login, «Cloud feature». **Cambian sólo por copy:** los dos tests de `lock_held` (`/another instance/i` → `/another nest is syncing/i`, también en el `queryByText` del test de "offline"). **Se mudan a `SyncTokenRow.test.tsx`:** el `describe` "memory token input stays reachable in the error state" y el test "con un token pegado usa ese y no molesta al servicio". **Se borran por spec:** el `describe` "reabrir el hub de memoria" (sale «Learn more») y el de "la bajada de Cloud sync no promete cifrado" se reemplaza (abajo). `LinkDeviceCard.test.tsx` y `SyncServiceCard.test.tsx` no cambian.

- [ ] **Step 1: Tests que fallan.** En `src/__tests__/components/CloudMemoryCard.test.tsx`: hacer los cambios de arriba y reemplazar el `describe('CloudMemoryCard — la bajada de Cloud sync no promete cifrado…')` por:

```tsx
describe('CloudMemoryCard — filas del spec 2026-10-21', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    mockLocalPaths()
  })
  afterEach(() => { delete (window as unknown as { memory?: unknown }).memory })

  it('la fila dice qué es, sin repetir lo del cifrado ni ofrecer Learn more', async () => {
    mockMemoryBridge({ connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)
    expect(await screen.findByText('Keeps a copy in the cloud so what your agents learn here is there on your other machines.')).toBeInTheDocument()
    expect(screen.queryByText(/encrypt/i)).toBeNull()
    expect(screen.queryByText('Learn more')).toBeNull()
    expect(screen.queryByPlaceholderText(/sync token/i)).toBeNull()
  })

  it('conectado y al día dice «Up to date · N memories»', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'd', itemCount: 1, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)
    expect(await screen.findByText('Up to date · 1 memory')).toBeInTheDocument()
  })

  it('offline dice cuántos cambios esperan', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'd', itemCount: 3, pendingCount: 2, daemonStatus: 'paused' })
    render(<CloudMemoryCard />)
    expect(await screen.findByText('Offline — 2 changes waiting')).toBeInTheDocument()
  })

  it('sin repos vinculados, el aviso corto', async () => {
    mockMemoryBridge({ connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)
    expect(await screen.findByText('Link your repos before connecting — memory imported without them goes to Global and stays there.')).toBeInTheDocument()
  })

  it('la cuota es una fila «Cloud space» con «X of Y»', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'd', itemCount: 12, pendingCount: 0, daemonStatus: 'idle', quota: { used_bytes: 1024 ** 2, max_bytes: 1024 ** 3 } })
    render(<CloudMemoryCard />)
    expect(await screen.findByText('1 MB of 1 GB')).toBeInTheDocument()
    expect(screen.getByText('Cloud space', { selector: 'p' })).toBeInTheDocument()
  })

  it('«Machine without a browser» sólo con la nube conectada', async () => {
    const memoria = mockMemoryBridge({ connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle' })
    ;(memoria as unknown as { linkApprove: unknown }).linkApprove = vi.fn()
    const { unmount } = render(<CloudMemoryCard />)
    await screen.findByText(/Keeps a copy in the cloud/)
    expect(screen.queryByText('Machine without a browser')).toBeNull()
    unmount()
    const conectada = mockMemoryBridge({ connected: true, deviceId: 'd', itemCount: 0, pendingCount: 0, daemonStatus: 'idle' })
    ;(conectada as unknown as { linkApprove: unknown }).linkApprove = vi.fn()
    render(<CloudMemoryCard />)
    expect(await screen.findByText('Machine without a browser')).toBeInTheDocument()
  })
})
```

Crear `src/__tests__/components/SyncTokenRow.test.tsx`: copiar de `CloudMemoryCard.test.tsx` el `supabaseMock` + `vi.mock('../../lib/supabase', …)`, `mockMemoryBridge` y `mockLocalPaths` (tal cual), y:

```tsx
import SyncTokenRow from '../../components/SyncTokenRow'

describe('SyncTokenRow (Advanced)', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-de-login' } } })
    mockLocalPaths()
  })
  afterEach(() => { delete (window as unknown as { memory?: unknown }).memory })

  // C7 fix round 1: en `error` (al que se llega conectado) el campo tiene que estar aunque el
  // plan ya no incluya nube — si no, no hay forma de pegar un token nuevo.
  it('en error el campo está aunque el plan no tenga nube', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 0, pendingCount: 0, daemonStatus: 'error' })
    render(<SyncTokenRow />)
    expect(await screen.findByPlaceholderText('Paste a sync token')).toBeInTheDocument()
    expect(screen.getByText('Connect with a token instead of signing in.')).toBeInTheDocument()
  })

  it('con un token pegado conecta con ese y no le pide uno al servicio', async () => {
    const memoria = mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 0, pendingCount: 0, daemonStatus: 'error' })
    render(<SyncTokenRow />)
    fireEvent.change(await screen.findByPlaceholderText('Paste a sync token'), { target: { value: 'nmk_a_mano' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(memoria.connect).toHaveBeenCalledWith('nmk_a_mano', expect.anything()))
    expect(memoria.registerDevice).not.toHaveBeenCalled()
  })

  it('Connect está apagado sin token', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 0, pendingCount: 0, daemonStatus: 'error' })
    render(<SyncTokenRow />)
    await screen.findByPlaceholderText('Paste a sync token')
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
  })

  it('conectado no se muestra', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'd', itemCount: 3, pendingCount: 0, daemonStatus: 'idle' })
    const { container } = render(<SyncTokenRow />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
```

En `src/__tests__/components/MemorySettingsTab.test.tsx`: sumar `vi.mock('../../components/SyncTokenRow', () => ({ default: () => <div>token-row</div> }))`; en "Sync…" sumar `expect(screen.queryByText('link-card')).toBeNull()` (ahora la dibuja Cloud) y en "Advanced…" `expect(screen.getByText('token-row')).toBeInTheDocument()`.

Crear `src/__tests__/components/memory-settings-sin-sp.test.ts` (Tasks 8 y 9 suman archivos a la lista):

```ts
// Spec 2026-10-21 §4: las tarjetas de Memory settings se reescriben en filas con shadcn +
// utilidades — ningún sp-* ni estilo inline. La barra de cuota es la única excepción (D18):
// su ancho es un dato.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PERMITIDOS: Record<string, number> = {
  'CloudMemoryCard.tsx': 1,
  'LinkDeviceCard.tsx': 0,
  'SyncServiceCard.tsx': 0,
  'SyncTokenRow.tsx': 0,
}

describe.each(Object.entries(PERMITIDOS))('%s', (archivo, estilos) => {
  const src = readFileSync(resolve(process.cwd(), 'src/components', archivo), 'utf8')
  it('no usa clases sp-*', () => { expect(src).not.toMatch(/\bsp-[a-z]/) })
  it(`tiene a lo sumo ${estilos} style inline`, () => { expect((src.match(/style=\{/g) ?? []).length).toBeLessThanOrEqual(estilos) })
  it('arma sus filas con SettingRow', () => { expect(src).toMatch(/SettingRow/) })
})
```

- [ ] **Step 2:** `npx vitest run src/__tests__/components/CloudMemoryCard.test.tsx src/__tests__/components/SyncTokenRow.test.tsx src/__tests__/components/MemorySettingsTab.test.tsx src/__tests__/components/memory-settings-sin-sp.test.ts` → FAIL.

- [ ] **Step 3: `CloudMemoryCard`.** Reemplazar el archivo entero (se conserva `formatBytes` y los comentarios de "right to delete" junto a sus botones; salen `MemoryHub`, `logoUrl`, `Cloud`, `ICON_SIZE` y el estado del token):

```tsx
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMemory } from '../hooks/useMemory'
import { useProfile } from '../hooks/useProfile'
import { useUserRepos } from '../hooks/useUserRepos'
import { PLAN_LIMITS } from '../lib/stripe'
import { nubeDeMemoriaDisponible, textoDeErrorDeMemoria } from '../lib/beta-de-memoria'
import UpgradeModal from './UpgradeModal'
import LinkDeviceCard from './LinkDeviceCard'
import SettingRow from './memories/settings/SettingRow'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// Bytes legibles. Un valor entero no lleva decimal ("1 GB"), uno fraccionario lleva uno
// ("3.0 MB"): la cuota tope suele ser redondo y el usado nunca lo es.
function formatBytes(bytes: number): string {
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < unidades.length - 1) { v /= 1024; i++ }
  return `${Number.isInteger(v) ? v : v.toFixed(1)} ${unidades[i]}`
}

/**
 * Sync de Memory settings (spec 2026-10-21 §5): las filas Cloud sync, Cloud space y Machine
 * without a browser. Self-contained como antes: lee sus hooks. Lo que NO cambia: los mismos
 * estados de `useMemory`, el mismo diálogo de Turn off con el borrado de la nube adentro.
 * El campo de token se mudó a Advanced (SyncTokenRow, D7) y "Learn more" salió (D16).
 */
export default function CloudMemoryCard() {
  const memory = useMemory()
  const { repos: userRepos } = useUserRepos()
  const { plan } = useProfile()
  // En un build beta la nube no depende del plan: la habilita el allowlist del servicio.
  const nubeDisponible = nubeDeMemoriaDisponible(PLAN_LIMITS[plan].memoryCloud)
  const [memoryUpgradeOpen, setMemoryUpgradeOpen] = useState(false)
  // M10 / §6.6 "Right to delete": disconnect never touches local data regardless of this — it
  // only controls whether main also calls memory-sync's delete-cloud-data action.
  const [deleteCloudOnDisconnect, setDeleteCloudOnDisconnect] = useState(false)
  const [turnOffOpen, setTurnOffOpen] = useState(false)

  const confirmarTurnOff = () => {
    setTurnOffOpen(false)
    void memory.disconnect(deleteCloudOnDisconnect)
  }
  // El checkbox arranca destildado CADA VEZ que el diálogo se abre: tildarlo y cancelar no
  // puede dejar armado un borrado de la nube para la próxima.
  const abrirTurnOff = () => {
    setDeleteCloudOnDisconnect(false)
    setTurnOffOpen(true)
  }

  const conectada = memory.state === 'connected' || memory.state === 'paused'
  const n = memory.pendingCount
  const cambios = `${n} change${n === 1 ? '' : 's'}`
  const turnOff = <Button variant="destructive" size="sm" onClick={abrirTurnOff}>Turn off</Button>

  const control: ReactNode =
    memory.state === 'unavailable' ? <Button size="sm" disabled>Unavailable</Button>
    : conectada ? turnOff
    // §6.6/§7.5: `error` y `plan_required` son conexiones que EXISTEN (token válido, device
    // registrado): Turn off tiene sentido y el borrado de la nube autentica.
    : memory.state === 'error' ? <><Button size="sm" onClick={() => void memory.connectWithLogin()}>Retry</Button>{turnOff}</>
    : memory.state === 'plan_required' ? <><Button size="sm" onClick={() => setMemoryUpgradeOpen(true)}>Upgrade</Button>{turnOff}</>
    : memory.state === 'connecting' || memory.state === 'migrating' ? <Button size="sm" disabled>…</Button>
    : nubeDisponible ? <Button size="sm" onClick={() => void memory.connectWithLogin()}>Connect</Button>
    : <Button size="sm" onClick={() => setMemoryUpgradeOpen(true)}>Upgrade</Button>

  const linea = (texto: ReactNode, tono: 'muted' | 'warn' | 'destructive' = 'muted') => (
    <p className={`m-0 text-fs-sm ${tono === 'warn' ? 'text-warn' : tono === 'destructive' ? 'text-destructive' : 'text-muted-foreground'}`}>{texto}</p>
  )

  // La línea de estado (spec §5). `paused` tiene dos motivos desde el candado de
  // sincronización (§6.3): sin red, u otra instancia de Nest lo tiene tomado.
  const estado: ReactNode =
    memory.state === 'connected' && n > 0 ? (
      <p className="m-0 flex items-center gap-1.5 text-fs-sm text-warn">
        {/* El mismo punto ámbar que la fila de estado de la sidebar (`.memories-dot`). */}
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warn" />
        Uploading {cambios}…
      </p>
    )
    : memory.state === 'connected' ? linea(`Up to date · ${memory.itemCount} ${memory.itemCount === 1 ? 'memory' : 'memories'}`)
    : memory.state === 'paused' && memory.statusDetail === 'lock_held' ? linea(`Another Nest is syncing this memory — ${cambios} queued`, 'warn')
    : memory.state === 'paused' ? linea(`Offline — ${cambios} waiting`, 'warn')
    : memory.state === 'error' ? linea(`Couldn't sync${memory.error ? ` — ${textoDeErrorDeMemoria(memory.error)}` : ''}`, 'destructive')
    : memory.state === 'plan_required' ? linea("Your plan doesn't include cloud sync", 'warn')
    : memory.state === 'unavailable' ? linea("Memory didn't start on this machine — restart Nest", 'warn')
    : memory.state === 'connecting' ? linea('Connecting…')
    : memory.state === 'migrating' ? linea('Importing your memory…')
    : !nubeDisponible ? linea('Local memory active — cloud sync is a Cloud feature')
    : null

  // La cuota la manda el servidor; NO cuelga de PLAN_LIMITS a propósito. `max_bytes = 0` es un
  // tope sin asignar: sin tope conocido la barra va vacía, nunca NaN%.
  const quota = memory.quota
  const pct = quota && quota.max_bytes > 0 ? (quota.used_bytes / quota.max_bytes) * 100 : 0

  return (
    <>
      <SettingRow
        nombre="Cloud sync"
        descripcion="Keeps a copy in the cloud so what your agents learn here is there on your other machines."
        control={control}
      >
        {estado}
        {memory.state === 'disconnected' && userRepos.length === 0 && (
          <p className="m-0 rounded-md border border-warn/40 px-3 py-2 text-fs-sm text-warn">
            Link your repos before connecting — memory imported without them goes to Global and stays there.
          </p>
        )}
      </SettingRow>

      {quota && conectada && (
        <SettingRow
          nombre="Cloud space"
          control={<span className="text-fs-sm tabular-nums text-muted-foreground">{formatBytes(quota.used_bytes)} of {formatBytes(quota.max_bytes)}</span>}
        >
          <div role="meter" aria-label="Cloud space" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            {/* D18: el único estilo inline — el ancho es el dato, a escala real. */}
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(pct, 0.5)}%` }} />
          </div>
        </SettingRow>
      )}

      {/* D8: aprobar otra máquina tiene sentido con la nube conectada. */}
      {conectada && <LinkDeviceCard />}

      <AlertDialog open={turnOffOpen} onOpenChange={setTurnOffOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off cloud sync?</AlertDialogTitle>
            <AlertDialogDescription>
              Your memory keeps working on this machine. You can reconnect any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-fs-sm text-foreground">
            <input type="checkbox" checked={deleteCloudOnDisconnect} onChange={(e) => setDeleteCloudOnDisconnect(e.target.checked)} />
            Also delete my cloud memory (your local memory is never affected)
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/* Rojo SOLO si también va a borrar la nube. */}
            <AlertDialogAction variant={deleteCloudOnDisconnect ? 'destructive' : 'default'} onClick={confirmarTurnOff}>
              Turn off
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {memoryUpgradeOpen && createPortal(
        <UpgradeModal currentPlan={plan} onClose={() => setMemoryUpgradeOpen(false)} />,
        document.body,
      )}
    </>
  )
}
```

- [ ] **Step 4: `LinkDeviceCard` y `SyncServiceCard` en fila.** En `LinkDeviceCard.tsx`: sacar `marco`, importar `SettingRow from './memories/settings/SettingRow'`, y el `return` pasa a:

```tsx
  return (
    <SettingRow
      nombre="Machine without a browser"
      descripcion={<>A server, VM or SSH box. Run <code className="font-mono">{comando('login')}</code> there and approve the code it shows.</>}
      control={
        <>
          <label htmlFor="link-code" className="sr-only">Code</label>
          <Input
            id="link-code"
            value={tipeado}
            onChange={(e) => { setTipeado(e.target.value); setAprobado(false); setError(null) }}
            placeholder="WXYZ-1234"
            autoComplete="off"
            spellCheck={false}
            className="w-32 font-mono uppercase"
            disabled={ocupado}
          />
          <Button size="sm" onClick={() => void aprobar()} disabled={!normalizado.ok || ocupado}>
            {ocupado ? 'Approving…' : 'Approve'}
          </Button>
        </>
      }
    >
      {avisoDeTipeo && <p className="m-0 text-fs-sm text-muted-foreground">{avisoDeTipeo}</p>}
      {error && <p className="m-0 text-fs-sm text-destructive">{error}</p>}
      {aprobado && (
        <p className="m-0 text-fs-sm text-ok">
          Approved. The other machine picks it up within a few seconds — go back to that terminal.
        </p>
      )}
    </SettingRow>
  )
```

En `SyncServiceCard.tsx`: sacar `Badge` y `marco`, importar `SettingRow`, y el `return` pasa a:

```tsx
  return (
    <SettingRow
      nombre="Sync server"
      descripcion={<span className="break-all font-mono text-foreground">{estado.url}</span>}
      control={!abierto && (
        <Button size="sm" variant="secondary" onClick={() => { setAbierto(true); setTipeado(estado.elegida ?? ''); setError(null) }}>
          Change
        </Button>
      )}
    >
      {estado.elegida === null && !abierto && (
        <p className="m-0 text-fs-sm text-muted-foreground">This is the address that comes with Nest.</p>
      )}
      {abierto && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="sync-service-url" className="sr-only">Service address</label>
          <Input
            id="sync-service-url"
            value={tipeado}
            onChange={(e) => { setTipeado(e.target.value); setError(null) }}
            placeholder={estado.porDefecto}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 font-mono"
            disabled={ocupado}
          />
          <Button size="sm" onClick={() => void guardar()} disabled={ocupado}>{ocupado ? 'Saving…' : 'Save'}</Button>
          <Button size="sm" variant="ghost" onClick={() => { setAbierto(false); setError(null) }} disabled={ocupado}>Cancel</Button>
        </div>
      )}
      {error && <p className="m-0 text-fs-sm text-destructive">{error}</p>}
      {reconectar && (
        <p className="m-0 text-fs-sm text-warn">
          Saved. This machine’s access was issued by the previous service — if the new one does not
          know it, you will have to connect this machine again.
        </p>
      )}
    </SettingRow>
  )
```

(Si un test de `SyncServiceCard.test.tsx` espera "comes with Nest" con el formulario abierto, sacar `&& !abierto` de esa condición: el comportamiento a conservar es el del test.)

- [ ] **Step 5: `SyncTokenRow` y la pestaña.** Crear `src/components/SyncTokenRow.tsx`:

```tsx
// Advanced → Sync token (spec §5, D7): conectar con un token en vez de con el login. Es el
// campo que vivía en la tarjeta de Cloud; mismas condiciones para mostrarse y la misma
// llamada (`connectWithToken`).
import { useEffect, useState } from 'react'
import { useMemory } from '../hooks/useMemory'
import { useProfile } from '../hooks/useProfile'
import { PLAN_LIMITS } from '../lib/stripe'
import { nubeDeMemoriaDisponible } from '../lib/beta-de-memoria'
import SettingRow from './memories/settings/SettingRow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function SyncTokenRow() {
  const memory = useMemory()
  const { plan } = useProfile()
  const nubeDisponible = nubeDeMemoriaDisponible(PLAN_LIMITS[plan].memoryCloud)
  const [token, setToken] = useState('')
  // Cumplió su trabajo: main lo guarda en el almacén de credenciales, así que tenerlo en el
  // estado de React sólo lo deja en cada heap snapshot.
  useEffect(() => { if (memory.state === 'connected') setToken('') }, [memory.state])

  // `error` siempre (C7 fix round 1: se llega conectado, con cualquier plan).
  const visible = (memory.state === 'disconnected' && nubeDisponible) || memory.state === 'error'
  if (!visible) return null
  const pegado = token.trim()

  return (
    <SettingRow
      nombre="Sync token"
      descripcion="Connect with a token instead of signing in."
      control={
        <>
          <Input
            type="password"
            aria-label="Memory sync token"
            placeholder="Paste a sync token"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-48"
          />
          <Button size="sm" disabled={!pegado} onClick={() => void memory.connectWithToken(pegado)}>Connect</Button>
        </>
      }
    />
  )
}
```

En `MemorySettingsTab.tsx`: sacar el import y el `<LinkDeviceCard />` de Sync (queda sólo `<CloudMemoryCard />`), importar `SyncTokenRow from './SyncTokenRow'` y Advanced pasa a `<SyncServiceCard /><SyncTokenRow />`.

- [ ] **Step 6:** `npx vitest run src/__tests__/components/CloudMemoryCard.test.tsx src/__tests__/components/SyncTokenRow.test.tsx src/__tests__/components/LinkDeviceCard.test.tsx src/__tests__/components/SyncServiceCard.test.tsx src/__tests__/components/MemorySettingsTab.test.tsx src/__tests__/components/memory-settings-sin-sp.test.ts src/__tests__/la-app-es-en-ingles.test.ts` → PASS. `npx vitest run` → PASS. Los dos `tsc` → 0.

- [ ] **Step 7: Commit.**

```bash
git add src/components/CloudMemoryCard.tsx src/components/LinkDeviceCard.tsx src/components/SyncServiceCard.tsx src/components/SyncTokenRow.tsx src/components/MemorySettingsTab.tsx src/__tests__/components/CloudMemoryCard.test.tsx src/__tests__/components/SyncTokenRow.test.tsx src/__tests__/components/MemorySettingsTab.test.tsx src/__tests__/components/memory-settings-sin-sp.test.ts
git commit -m "feat(memories): Sync y Advanced de Settings en filas

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Encryption en filas

**Files:**
- Modify: `src/components/MemoryEncryptionCard.tsx:127-363` (los `return`; la lógica de arriba no se toca), `src/components/TeamEncryptionCard.tsx:83-379` (sólo los marcos), `src/components/MemorySettingsTab.tsx` (pasa `onSetUpSync`)
- Test: `src/__tests__/components/MemoryEncryptionCard.test.tsx`, `src/__tests__/components/TeamEncryptionCard.test.tsx` (sólo si algún query de copy falla), `src/__tests__/components/MemorySettingsTab.test.tsx`, `src/__tests__/components/memory-settings-sin-sp.test.ts`

**Interfaces:**
- Consumes: `SettingRow` (Task 3), `MemorySettingsTab.onSeccion` (Task 5).
- Produces: `MemoryEncryptionCard({ onSetUpSync }: { onSetUpSync?: () => void })`. `TeamEncryptionCard()` sin cambios de firma.

**Tests de comportamiento que se conservan intactos:** activar → código una vez + Done sólo con el checkbox; el aviso cuando la clave no se pudo guardar; autorizar manda la huella mostrada (I4); recuperar con código equivocado deja el formulario; la adopción automática y "I've been authorised"; no ofrecer activar sin leer el estado del servidor; la marca de la clave; las huellas de máquina propia y pendientes; todo `TeamEncryptionCard.test.tsx` (sus textos internos no cambian, D9). **Cambian por copy:** "sin disponibilidad" (`/connect cloud memory/i` → `'Needs cloud sync'`), "sin activar ofrece activarlo" (bajada nueva; "Type, scope and branch" ya no está ahí), "la promesa se lee con su apóstrofo" (el aviso del código pasa al paso «Save this code»), "activo muestra la época" (`/encryption on/i` → `'On · key #1'`).

- [ ] **Step 1: Tests que fallan.** En `MemoryEncryptionCard.test.tsx` reemplazar esos cuatro tests por:

```tsx
  it('sin nube: «Needs cloud sync» y «Set up sync» lleva a Sync', async () => {
    montarCon({ available: false })
    const onSetUpSync = vi.fn()
    render(<MemoryEncryptionCard onSetUpSync={onSetUpSync} />)
    expect(await screen.findByText('Needs cloud sync')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /turn on/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Set up sync' }))
    expect(onSetUpSync).toHaveBeenCalled()
  })

  it('sin activar ofrece «Turn on» y dice qué hace, sin repetir lo que viaja en claro', async () => {
    montarCon({})
    render(<MemoryEncryptionCard />)
    const boton = await screen.findByRole('button', { name: 'Turn on encryption' })
    expect(boton).toHaveTextContent('Turn on')
    expect(screen.getByText('Only your machines hold the key. On this machine it stays readable, so search and agents work as usual.')).toBeInTheDocument()
    expect(screen.queryByText(/type, scope and branch/i)).toBeNull()
  })

  it('el aviso del código de recuperación va en el paso «Save this code»', async () => {
    montarCon({})
    render(<MemoryEncryptionCard />)
    expect(screen.queryByText(/if you lose every machine and the code/i)).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on encryption' }))
    expect(await screen.findByText('Save this code')).toBeInTheDocument()
    expect(screen.getByText(/if you lose every machine and the code, the cloud copy can never be opened again/i)).toBeInTheDocument()
  })

  it('activo muestra «On · key #N», lo que viaja en claro UNA vez, y ofrece re-subir lo viejo', async () => {
    const api = montarCon({ active: true, keyEpoch: 1 })
    render(<MemoryEncryptionCard />)
    expect(await screen.findByText('On · key #1')).toBeInTheDocument()
    expect(screen.getAllByText(/type, scope and branch/i)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /re-upload/i }))
    await waitFor(() => expect(api.encryptionReencrypt).toHaveBeenCalled())
    expect(await screen.findByText(/866/)).toBeInTheDocument()
  })

  it('cada máquina que espera es una fila con su huella y su botón', async () => {
    montarCon({
      active: true, keyEpoch: 1,
      pendingDevices: [{ deviceId: 'pc', name: 'la PC' }, { deviceId: 'mac', name: 'la Mac' }],
      huellasPorDevice: { pc: 'A1B2-C3D4-E5F6', mac: 'F6E5-D4C3-B2A1' },
    })
    render(<MemoryEncryptionCard />)
    expect(await screen.findByText('la Mac')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'They match — authorise' })).toHaveLength(2)
  })
```

En `MemorySettingsTab.test.tsx`, cambiar el mock de la tarjeta de cifrado a `default: (p: { onSetUpSync?: () => void }) => <button type="button" onClick={p.onSetUpSync}>enc-card</button>` y sumar:

```tsx
  it('«Set up sync» desde Encryption cambia la sección a Sync', () => {
    const p = montar({ seccion: 'encryption' })
    fireEvent.click(screen.getByRole('button', { name: 'enc-card' }))
    expect(p.onSeccion).toHaveBeenCalledWith('sync')
  })
```

En `memory-settings-sin-sp.test.ts`, sumar a `PERMITIDOS`: `'MemoryEncryptionCard.tsx': 0, 'TeamEncryptionCard.tsx': 0`.

- [ ] **Step 2:** `npx vitest run src/__tests__/components/MemoryEncryptionCard.test.tsx src/__tests__/components/MemorySettingsTab.test.tsx src/__tests__/components/memory-settings-sin-sp.test.ts` → FAIL.

- [ ] **Step 3: `MemoryEncryptionCard`.** Firma `export default function MemoryEncryptionCard({ onSetUpSync }: { onSetUpSync?: () => void } = {})`; imports: sacar los íconos `Shield*` e `ICON_SIZE`, sumar `import SettingRow from './memories/settings/SettingRow'`; borrar `marco`; sumar constantes junto a `LO_QUE_QUEDA_EN_CLARO`:

```ts
const NOMBRE = 'Encrypt your memory'
const QUE_HACE = 'Only your machines hold the key. On this machine it stays readable, so search and agents work as usual.'
```

y reemplazar todo desde `// ── El código de recuperación, una sola vez` hasta el final de la función por:

```tsx
  const epoca = <span className="font-mono text-fs-sm tabular-nums text-muted-foreground">On · key #{estado.keyEpoch}</span>
  const huellaGrande = (h: string) => (
    <p className="m-0 select-all text-center font-mono text-fs tracking-[0.08em] text-foreground">{h}</p>
  )
  const fallo = error && <p className="m-0 text-fs-sm text-destructive">{error}</p>

  // ── El código de recuperación, una sola vez ────────────────────────────────
  if (codigo) {
    return (
      <SettingRow nombre="Save this code" descripcion="It is the only thing that recovers your memories if you lose every machine. You will not see it again.">
        {/* Spec §5: el aviso del código va en ESTE paso, no antes de activar. */}
        <p className="m-0 rounded-md border border-warn/40 px-2 py-1 text-fs-sm text-warn">
          Keep it somewhere safe: if you lose every machine and the code, the cloud copy can never be opened again.
        </p>
        {avisoDeCodigo && <p className="m-0 rounded-md border border-warn/40 px-2 py-1 text-fs-sm text-warn">{avisoDeCodigo}</p>}
        <p className="m-0 select-all rounded-md border border-border bg-muted/30 px-3 py-2 text-center font-mono text-fs tracking-[0.08em] text-foreground">{codigo}</p>
        <label className="flex items-center gap-2 text-fs-sm text-foreground">
          <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
          I have saved it somewhere safe
        </label>
        <div><Button size="sm" disabled={!confirmado} onClick={() => setCodigo(null)}>Done</Button></div>
      </SettingRow>
    )
  }

  // ── Sin nube conectada: no hay nada que cifrar todavía ─────────────────────
  if (!estado.available) {
    return (
      <SettingRow
        nombre={NOMBRE}
        descripcion="Needs cloud sync"
        control={onSetUpSync && <Button size="sm" variant="outline" onClick={onSetUpSync}>Set up sync</Button>}
      />
    )
  }

  // ── Hay una clave en la cuenta pero esta máquina no la tiene ───────────────
  if (!estado.active && estado.keyEpoch > 0) {
    return (
      <>
        <SettingRow nombre={NOMBRE} descripcion={QUE_HACE} control={epoca} />
        <SettingRow
          nombre="This machine is not authorised yet"
          descripcion="Authorise it from another machine that already has the key, or use your recovery code."
          control={!recuperando && adoptar && (
            <Button
              size="sm"
              disabled={buscandoAutorizacion}
              onClick={() => void (async () => {
                setBuscandoAutorizacion(true)
                setError(null)
                try {
                  const res = await adoptar()
                  if (res.ok && res.adoptada) await refrescar()
                  else if (res.ok) setError('No authorisation for this machine yet.')
                  else setError(res.error ?? 'Could not check.')
                } finally { setBuscandoAutorizacion(false) }
              })()}
            >
              {buscandoAutorizacion ? 'Checking…' : "I've been authorised"}
            </Button>
          )}
        >
          {estado.undecryptable > 0 && (
            <p className="m-0 text-fs-sm text-muted-foreground">
              <span className="font-mono tabular-nums text-foreground">{estado.undecryptable}</span> {estado.undecryptable === 1 ? 'memory' : 'memories'} cannot be read from here.
            </p>
          )}
          {estado.huellaPropia && (
            <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
              <p className="m-0 text-fs-xs text-muted-foreground">Before authorising from the other machine, check that it shows this same code:</p>
              {huellaGrande(estado.huellaPropia)}
            </div>
          )}
          {fallo}
          {recuperando ? (
            <div className="flex flex-col gap-2">
              <Input value={codigoTipeado} onChange={(e) => setCodigoTipeado(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" aria-label="Recovery code" className="font-mono" />
              <div className="flex gap-2">
                <Button size="sm" disabled={ocupado} onClick={() => void recuperar()}>Recover</Button>
                <Button size="sm" variant="ghost" onClick={() => setRecuperando(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div><Button size="sm" variant="outline" onClick={() => setRecuperando(true)}>Use the recovery code</Button></div>
          )}
        </SettingRow>
      </>
    )
  }

  // ── Activo ────────────────────────────────────────────────────────────────
  if (estado.active) {
    return (
      <>
        <SettingRow nombre={NOMBRE} descripcion={QUE_HACE} control={epoca}>
          {/* Lo que viaja en claro, UNA vez y donde ya está activo (spec §5). */}
          <p className="m-0 text-fs-sm text-muted-foreground">{LO_QUE_QUEDA_EN_CLARO}</p>
          {/* La marca de la clave: dos máquinas de la misma cuenta muestran la misma. */}
          {estado.huellaDeLaClave && (
            <p className="m-0 text-fs-xs text-muted-foreground">
              This account key:{' '}
              <span className="select-all font-mono text-foreground">{estado.huellaDeLaClave}</span>
              {' '}— must be the same on all your machines.
            </p>
          )}
          {fallo}
        </SettingRow>

        {/* Una fila por máquina que espera (D9). Comparar la huella es la única defensa contra
            una clave pública sustituida en el servidor. */}
        {estado.pendingDevices.map((d) => (
          <SettingRow
            key={d.deviceId}
            nombre={d.name}
            descripcion="Waiting for authorisation"
            control={<Button size="sm" variant="outline" disabled={ocupado} onClick={() => void autorizar(d.deviceId)}>They match — authorise</Button>}
          >
            {estado.huellasPorDevice?.[d.deviceId] && (
              <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
                <p className="m-0 text-fs-xs text-muted-foreground">Authorise it only if that machine shows exactly this code:</p>
                {huellaGrande(estado.huellasPorDevice[d.deviceId])}
              </div>
            )}
          </SettingRow>
        ))}

        <SettingRow
          nombre="Re-upload old memories"
          descripcion="Encrypts and uploads again what reached the cloud before encryption was on."
          control={<Button size="sm" variant="outline" disabled={ocupado} onClick={() => void reencriptar()}>Re-upload</Button>}
        >
          {reencriptadas !== null && (
            <p className="m-0 text-fs-sm text-muted-foreground">
              <span className="font-mono tabular-nums text-foreground">{reencriptadas}</span> memories queued
            </p>
          )}
        </SettingRow>
      </>
    )
  }

  // ── No sabemos en qué estado está la cuenta ───────────────────────────────
  // No se ofrece activar a ciegas: activar desde una máquina sin clave rota la época y borra
  // las envolturas de todas las demás, incluida la de recuperación.
  if (estado.estadoRemotoLeido === false) {
    return (
      <SettingRow nombre={NOMBRE} descripcion={<>Could not read this account&rsquo;s encryption state. Come back when you are online.</>} />
    )
  }

  // ── Se puede activar ──────────────────────────────────────────────────────
  return (
    <SettingRow
      nombre={NOMBRE}
      descripcion={QUE_HACE}
      control={<Button size="sm" aria-label="Turn on encryption" disabled={ocupado} onClick={() => void activar()}>Turn on</Button>}
    >
      {fallo}
    </SettingRow>
  )
}
```

(Si `e2e/12` o un test pide «the PC» / `p.select-all` primero en la máquina sin autorizar, el primer `.select-all` sigue siendo la huella propia: la fila de arriba no tiene ninguno.)

- [ ] **Step 4: `TeamEncryptionCard`: sólo el marco.** Importar `SettingRow`; sacar `Shield*`, `ICON_SIZE` y `marco`. Sumar después de `pendientes`:

```tsx
  const nombre = <>Encrypt what <span className="font-mono">{truncateWithEllipsis(activeTeam.name)}</span> shares</>
  const soloElLeader = 'Only the team leader can turn it on.'
```

Cada `return (<div className={marco}>…</div>)` (y el de `estadoRemotoLeido === false`, que usa su propio `div`) pasa a una `SettingRow`; el encabezado `<div className="flex items-center gap-2"><Shield…/><p …>TÍTULO</p></div>` sale y su título va a `nombre`; todo lo demás queda **igual y en el mismo orden** como hijos, con `m-0` sumado a cada `<p>`. Rama por rama:

| Rama | `nombre` | `descripcion` | `control` | hijos (sin cambios de texto) |
|---|---|---|---|---|
| `estadoRemotoLeido === false` | `nombre` | `<>Could not read this team&rsquo;s encryption state. Come back when you are online.</>` | — | — |
| `codigo` | `"Save this team code"` | `<>It is the only thing that recovers this team&rsquo;s memories if you lose every leader machine.</>` | — | código, checkbox, Done |
| `!activated && !esLeader` | `nombre` | `soloElLeader` | — | "Ask your team leader to turn on encryption…" |
| `!activated && esLeader` | `nombre` | `soloElLeader` | el botón «Turn on team encryption» | "Once it&rsquo;s on…", `sinCifradoPersonal`, error |
| `!hasMaster && sinCifradoPersonal` | `<>This machine can&rsquo;t read team memory yet</>` | "Turn on memory encryption for your account first. After that, your team leader can authorise this machine." | — | `avisoRetenidas` |
| `!hasMaster` | `"This machine is not authorised yet"` | el texto de leader/member que hoy va en el `<p>` | el botón «I've been authorised» (con su misma condición `!recuperando && adoptar`) | retenidas, mismatch, huella, error, recuperación |
| activo | `nombre` | `soloElLeader` | `<span className="text-fs-sm text-ok">Team encryption on</span>` | error, máquinas esperando (bloque igual), bloque del leader |

- [ ] **Step 5: La pestaña pasa `onSetUpSync`.** En `MemorySettingsTab.tsx`: `<MemoryEncryptionCard onSetUpSync={() => p.onSeccion('sync')} />`.

- [ ] **Step 6:** `npx vitest run src/__tests__/components/MemoryEncryptionCard.test.tsx src/__tests__/components/TeamEncryptionCard.test.tsx src/__tests__/components/MemorySettingsTab.test.tsx src/__tests__/components/memory-settings-sin-sp.test.ts src/__tests__/la-app-es-en-ingles.test.ts` → PASS (si un test de equipo falla, es por un `<p>` que cambió de lugar: devolverlo a hijo, no tocar el test). `npx vitest run` → PASS. Los dos `tsc` → 0.

- [ ] **Step 7: Commit.**

```bash
git add src/components/MemoryEncryptionCard.tsx src/components/TeamEncryptionCard.tsx src/components/MemorySettingsTab.tsx src/__tests__/components/MemoryEncryptionCard.test.tsx src/__tests__/components/MemorySettingsTab.test.tsx src/__tests__/components/memory-settings-sin-sp.test.ts
git commit -m "feat(memories): Encryption de Settings en filas

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: This project y Notes on disk en filas

**Files:**
- Modify: `src/components/ShareProjectCard.tsx:23-192`, `src/components/TeamThreadToggle.tsx` (markup), `src/components/MemoryVaultCard.tsx:276-350`, `src/components/MemorySettingsTab.tsx` (See plans)
- Test: `src/__tests__/components/ShareProjectCard.test.tsx`, `src/__tests__/components/share-project-card.test.tsx`, `src/__tests__/components/TeamThreadToggle.test.tsx`, `src/__tests__/components/MemoryVaultCard.test.tsx`, `src/__tests__/components/MemorySettingsTab.test.tsx`, `src/__tests__/components/memory-settings-sin-sp.test.ts`

**Interfaces:**
- Consumes: `SettingRow`, `Switch` (Task 3), `UseTeamThreadSettings` (Task 5).
- Produces: `ShareProjectCard({ activeRepoPath, onSeePlans }: { activeRepoPath: string | null; onSeePlans?: () => void })`; `TeamThreadToggle({ hilo })` en fila con `role="switch"` de nombre «Branch notes»; `MemoryVaultCard()` en fila con switches «Include old versions» / «Include teammates' memories».

**Tests que se conservan:** compartir con el equipo elegido, el error del servidor, sin equipos, los equipos como destino, el nombre truncado en `span.font-mono`, sin repo nada; el switch del hilo prende y refleja; todos los de `MemoryVaultCard` (Enable, Regenerate, Open folder, conflictos, error, el flag de teammates). **Cambian:** en `ShareProjectCard.test.tsx` el `api()` base suma `status: vi.fn().mockResolvedValue({ puedeCompartirMemoria: true })` (D10: sin saber, no se muestra) y "sin permiso…" se reescribe; en `share-project-card.test.tsx` "sin permiso…" y "mientras no se sabe…" se reescriben; en `TeamThreadToggle.test.tsx` el nombre pasa a «Branch notes»; en `MemoryVaultCard.test.tsx` `getByLabelText(/superseded/i)` → `getByLabelText(/old versions/i)`.

- [ ] **Step 1: Tests que fallan.** En `ShareProjectCard.test.tsx`: sumar `status` al `api()` base (arriba) y reemplazar "sin permiso de compartir, explica el gate de plan…" por:

```tsx
  it('sin permiso: una fila sin control que dice qué falta, y See plans', async () => {
    const onSeePlans = vi.fn()
    setMemoryApi(api({ status: vi.fn().mockResolvedValue({ puedeCompartirMemoria: false }) }))
    render(<ShareProjectCard activeRepoPath="/repo" onSeePlans={onSeePlans} />)
    expect(await screen.findByText('Sharing with a team needs a Teams plan.')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByText(/Get in touch/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'See plans' }))
    expect(onSeePlans).toHaveBeenCalled()
  })
```

En `share-project-card.test.tsx`, reemplazar los dos tests:

```tsx
  it('sin permiso dice qué plan hace falta y no ofrece compartir', async () => {
    conStatus(false)
    render(<ShareProjectCard activeRepoPath="/repos/x" />)
    await waitFor(() => expect(screen.getByText('Sharing with a team needs a Teams plan.')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^Share with/ })).toBeNull()
    expect(screen.queryByLabelText('Team')).toBeNull()
  })

  /** Spec 2026-10-21 §5 (D10): mientras no se sabe, la fila no se muestra — ni el control ni
   *  el cartel. Antes se mostraba el control. */
  it('mientras no se sabe, no muestra nada', async () => {
    conStatus(undefined)
    const { container } = render(<ShareProjectCard activeRepoPath="/repos/x" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
  })
```

En `TeamThreadToggle.test.tsx`: `{ name: /Branch notes in the repo/ }` → `{ name: 'Branch notes' }`, `getByText('Branch notes in the repo')` → `getByText('Branch notes')`, y sumar:

```tsx
it('la fila dice qué hace y un rechazo se ve', async () => {
  ;(window as any).memory = {
    teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue({ ok: true, projectKey: 'pk' }),
    teamThreadGetSettings: vi.fn().mockResolvedValue({ ok: true, settings: { enabled: false } }),
    teamThreadSetSettings: vi.fn().mockResolvedValue({ ok: false, message: 'Your plan does not include it' }),
  }
  render(<ConHilo />)
  expect(screen.getByText(/It travels with git, so it's readable without Nest/)).toBeInTheDocument()
  const sw = await screen.findByRole('switch', { name: 'Branch notes' })
  await waitFor(() => expect(sw).not.toBeDisabled())
  fireEvent.click(sw)
  expect(await screen.findByText('Your plan does not include it')).toBeInTheDocument()
})
```

En `MemoryVaultCard.test.tsx`: `/superseded/i` → `/old versions/i`, y sumar:

```tsx
  it('la fila dice qué es y los dos flags son switches', async () => {
    // mismo setup del test "shows the root path…" (vault prendido)
    expect(await screen.findByText('Mirror to Markdown')).toBeInTheDocument()
    expect(screen.getByText('One file per memory in a folder you can open in Obsidian or grep.')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Include old versions' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: "Include teammates' memories" })).toBeInTheDocument()
  })
```

(copiar el `beforeEach`/mock del test "shows the root path, Regenerate/Open folder and the config checkboxes when enabled" al principio de este test.)

En `MemorySettingsTab.test.tsx`: cambiar el mock de `ShareProjectCard` a `default: (p: { onSeePlans?: () => void }) => <button type="button" onClick={p.onSeePlans}>share-card</button>`, mockear el modal (`vi.mock('../../components/UpgradeModal', () => ({ default: () => <div>upgrade-modal</div> }))` y `vi.mock('../../hooks/useProfile', () => ({ useProfile: () => ({ plan: 'free' }) }))`) y sumar:

```tsx
  it('See plans abre el UpgradeModal existente', () => {
    montar({ seccion: 'project' })
    fireEvent.click(screen.getByRole('button', { name: 'share-card' }))
    expect(screen.getByText('upgrade-modal')).toBeInTheDocument()
  })
```

En `memory-settings-sin-sp.test.ts`, sumar `'ShareProjectCard.tsx': 0, 'TeamThreadToggle.tsx': 0, 'MemoryVaultCard.tsx': 0`.

- [ ] **Step 2:** `npx vitest run src/__tests__/components/ShareProjectCard.test.tsx src/__tests__/components/share-project-card.test.tsx src/__tests__/components/TeamThreadToggle.test.tsx src/__tests__/components/MemoryVaultCard.test.tsx src/__tests__/components/MemorySettingsTab.test.tsx src/__tests__/components/memory-settings-sin-sp.test.ts` → FAIL.

- [ ] **Step 3: `ShareProjectCard`.** Props `interface Props { activeRepoPath: string | null; onSeePlans?: () => void }`; borrar `CONTACTO` (y su doc), `marco`, y el `return` del `puedeCompartir === false` y el final; en su lugar (después de `if (!activeRepoPath) return null` y de `share`):

```tsx
  // Spec 2026-10-21 §5 (D10): sin saber todavía si la cuenta puede compartir, no se muestra.
  if (puedeCompartir === undefined) return null

  // El gate real es de plan (`teamScope` en server/src/limits.ts), no técnico. Sin callejón
  // sin salida: la fila dice qué falta y lleva a los planes (el modal es de 2b, no se toca).
  if (puedeCompartir === false) {
    return (
      <SettingRow
        nombre="Share with a team"
        descripcion="Sharing with a team needs a Teams plan."
        control={onSeePlans && <Button variant="link" size="sm" className="h-auto p-0" onClick={onSeePlans}>See plans</Button>}
      />
    )
  }

  const destino = teams.find((t) => t.id === teamId)?.name ?? 'team'
  return (
    <SettingRow
      nombre="Share with a team"
      descripcion={teams.length === 0 ? 'You are not in a team yet. Team memories need one.' : undefined}
      control={teams.length > 0 && (
        <>
          <Select value={teamId} onValueChange={setTeamId} disabled={busy}>
            {/* `size="sm"` para emparejar con el <Button size="sm"> de al lado. */}
            <SelectTrigger size="sm" aria-label="Team"><SelectValue /></SelectTrigger>
            <SelectContent>
              {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={share} disabled={busy || !projectKey}>
            {busy ? 'Sharing…' : <>Share with <span className="font-mono">{truncateWithEllipsis(destino)}</span></>}
          </Button>
        </>
      )}
    >
      <div className="grid grid-cols-2 gap-2 text-fs-sm">
        <div className="rounded-md border border-border p-2 text-foreground">
          <p className="m-0 font-medium">The team will see</p>
          {/* IMPORTANT #7b: compartir el proyecto no mueve ninguna fila por sí solo; sólo
              viaja lo que alguien promueve (`promoteToTeam`). */}
          <p className="m-0 mt-1 text-muted-foreground">Only memories someone promotes to the team from here on. Nothing already saved moves on its own.</p>
        </div>
        <div className="rounded-md border border-border p-2 text-foreground">
          <p className="m-0 font-medium">Stays only yours</p>
          <p className="m-0 mt-1 text-muted-foreground">Everything already saved here, anything nobody promotes, your other projects and your code.</p>
        </div>
      </div>
      {result && <p className={`m-0 text-fs-sm ${result.ok ? 'text-ok' : 'text-warn'}`}>{result.text}</p>}
    </SettingRow>
  )
```

Importar `SettingRow from './memories/settings/SettingRow'`. Actualizar el comentario de cabecera ("La card tiene dos caras…") a las tres: no se sabe → nada; sin permiso → fila con See plans; con permiso → el control.

- [ ] **Step 4: `TeamThreadToggle` y `MemoryVaultCard`.** `TeamThreadToggle.tsx` entero:

```tsx
// Branch notes (spec 2026-10-21 §5): el toggle del hilo de equipo, en fila. El estado lo
// levanta MemoriesWorkspace y lo comparte con la pestaña Team thread (D3).
import type { UseTeamThreadSettings } from '../hooks/useTeamThreadSettings'
import SettingRow from './memories/settings/SettingRow'
import { Switch } from '@/components/ui/switch'

interface Props { hilo: UseTeamThreadSettings }

export default function TeamThreadToggle({ hilo }: Props) {
  return (
    <SettingRow
      id="branch-notes-label"
      nombre="Branch notes"
      descripcion={<>Writes a short note per branch into <code className="font-mono">.nest/team/</code>. It travels with git, so it&apos;s readable without Nest, and adds a branch map under the graph.</>}
      control={
        <Switch
          aria-labelledby="branch-notes-label"
          checked={hilo.enabled}
          disabled={!hilo.ready || !hilo.projectKey}
          onCheckedChange={(v) => void hilo.setEnabled(v)}
        />
      }
    >
      {hilo.error && <p className="m-0 text-fs-sm text-warn">{hilo.error}</p>}
    </SettingRow>
  )
}
```

En `MemoryVaultCard.tsx`: importar `SettingRow` y `Switch`; el `return` pasa a:

```tsx
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
```

- [ ] **Step 5: See plans en la pestaña.** En `MemorySettingsTab.tsx`: `import { useState } from 'react'`, `import { createPortal } from 'react-dom'`, `import UpgradeModal from './UpgradeModal'`, `import { useProfile } from '../hooks/useProfile'`; arriba del componente:

```tsx
/** El UpgradeModal de siempre (spec §5: no se toca, es 2b). Se monta sólo abierto, así la
 *  lectura del perfil no corre en cada vuelta a This project. */
function PlanesModal({ onClose }: { onClose: () => void }) {
  const { plan } = useProfile()
  return createPortal(<UpgradeModal currentPlan={plan} onClose={onClose} />, document.body)
}
```

En el componente, `const [planes, setPlanes] = useState(false)` (antes del `switch`), y la rama `project` con repo pasa a:

```tsx
        <SettingsSection titulo="This project" bajada={<>Settings for <span className="font-mono">{nombreDelRepo(p.activeRepoPath)}</span>.</>}>
          <ShareProjectCard activeRepoPath={p.activeRepoPath} onSeePlans={() => setPlanes(true)} />
          <TeamThreadToggle hilo={p.hilo} />
          {planes && <PlanesModal onClose={() => setPlanes(false)} />}
        </SettingsSection>
```

- [ ] **Step 6:** `npx vitest run src/__tests__/components/ShareProjectCard.test.tsx src/__tests__/components/share-project-card.test.tsx src/__tests__/components/TeamThreadToggle.test.tsx src/__tests__/components/MemoryVaultCard.test.tsx src/__tests__/components/MemorySettingsTab.test.tsx src/__tests__/components/memory-settings-sin-sp.test.ts src/__tests__/components/MemoriesWorkspace-obsidian.test.tsx src/__tests__/la-app-es-en-ingles.test.ts` → PASS. `npx vitest run` → PASS. Los dos `tsc` → 0.

- [ ] **Step 7: Commit.**

```bash
git add src/components/ShareProjectCard.tsx src/components/TeamThreadToggle.tsx src/components/MemoryVaultCard.tsx src/components/MemorySettingsTab.tsx src/__tests__/components/ShareProjectCard.test.tsx src/__tests__/components/share-project-card.test.tsx src/__tests__/components/TeamThreadToggle.test.tsx src/__tests__/components/MemoryVaultCard.test.tsx src/__tests__/components/MemorySettingsTab.test.tsx src/__tests__/components/memory-settings-sin-sp.test.ts
git commit -m "feat(memories): This project y Notes on disk de Settings en filas

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: El editor respeta Live preview, Readable width, Spellcheck y Font size

**Files:**
- Modify: `src/lib/cm-live-preview.ts:138-224`, `src/components/memories/MemoryNoteEditor.tsx`, `src/components/MemoriesNoteTab.tsx`, `src/components/MemoriesWorkspace.tsx` (pasa `prefsDelEditor`)
- Test: `src/__tests__/components/MemoryNoteEditor.test.tsx`, `src/__tests__/lib/cm-live-preview.test.ts` (sólo si importa el tema)

**Interfaces:**
- Consumes: `PrefsDelEditor`, `DEFAULT_MEMORY_PREFS` (Task 1); `useMemoryPrefs` ya montado en el workspace (Task 6).
- Produces:
  - `cm-live-preview.ts`: `livePreview(opts)` devuelve `[plugin, click]` (sin tema); `export const temaDelEditor: Extension` (el `EditorView.theme(..., { dark: true })` de hoy **sin** `fontSize` en `'&'`).
  - `MemoryNoteEditorProps.prefs?: PrefsDelEditor` (default `DEFAULT_MEMORY_PREFS.editor`).
  - `MemoriesNoteTabProps.prefsDelEditor?: PrefsDelEditor`.

- [ ] **Step 1: Tests que fallan.** Al final de `src/__tests__/components/MemoryNoteEditor.test.tsx` (sumar `import { DEFAULT_MEMORY_PREFS } from '../../lib/memory-prefs'`):

```tsx
describe('preferencias del editor', () => {
  const ed = DEFAULT_MEMORY_PREFS.editor
  it('live preview prendido (default) oculta las marcas', () => {
    render(<MemoryNoteEditor detail={det({ content: '**hola**', links: [] })} {...props()} />)
    expect(document.querySelector('.cm-content')?.textContent).toBe('hola')
    expect(document.querySelector('.cm-lp-strong')).not.toBeNull()
  })

  it('live preview apagado muestra el Markdown crudo, sin decoraciones ni links clickeables', () => {
    render(<MemoryNoteEditor detail={det({ content: '**hola** [[Otra]]' })} {...props()} prefs={{ ...ed, livePreview: false }} />)
    expect(document.querySelector('.cm-content')?.textContent).toBe('**hola** [[Otra]]')
    expect(document.querySelector('.cm-lp-strong')).toBeNull()
    expect(document.querySelector('[data-wikilink]')).toBeNull()
  })

  it('cambiarlo con la nota abierta reconfigura sin perder lo escrito', () => {
    const p = props()
    const { rerender } = render(<MemoryNoteEditor detail={det({ content: '**hola**', links: [] })} {...p} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Memory title' }), { target: { value: 'Titulo nuevo' } })
    rerender(<MemoryNoteEditor detail={det({ content: '**hola**', links: [] })} {...p} prefs={{ ...ed, livePreview: false }} />)
    expect(document.querySelector('.cm-content')?.textContent).toBe('**hola**')
    expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveValue('Titulo nuevo')
  })

  it('spellcheck sigue la preferencia', () => {
    const p = props()
    const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
    expect(document.querySelector('.cm-content')?.getAttribute('spellcheck')).toBe('false')
    rerender(<MemoryNoteEditor detail={det()} {...p} prefs={{ ...ed, spellcheck: true }} />)
    expect(document.querySelector('.cm-content')?.getAttribute('spellcheck')).toBe('true')
  })

  it('el tamaño de letra va al editor', () => {
    render(<MemoryNoteEditor detail={det()} {...props()} prefs={{ ...ed, fontSize: 16 }} />)
    expect(document.querySelector('.cm-editor')?.getAttribute('style')).toContain('font-size: 16px')
  })

  it('readable width limita el ancho; apagado lo libera', () => {
    const p = props()
    const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
    const caja = () => screen.getByRole('textbox', { name: 'Memory title' }).parentElement!
    expect(caja().className).toMatch(/max-w-\[720px\]/)
    rerender(<MemoryNoteEditor detail={det()} {...p} prefs={{ ...ed, readableWidth: false }} />)
    expect(caja().className).toMatch(/max-w-none/)
  })
})
```

- [ ] **Step 2:** `npx vitest run src/__tests__/components/MemoryNoteEditor.test.tsx -t "preferencias del editor"` → FAIL.

- [ ] **Step 3: Separar el tema del live preview.** En `src/lib/cm-live-preview.ts`: sacar `const tema = EditorView.theme({...}, { dark: true })` de adentro de `livePreview` y exportarlo a nivel de módulo como `export const temaDelEditor: Extension = EditorView.theme({...}, { dark: true })` (mismo contenido y mismo comentario, salvo `'&': { color: 'var(--foreground)', backgroundColor: 'transparent' }`: el `fontSize` sale, lo pone el editor con la preferencia). `livePreview` termina en `return [plugin, click]`. Doc de `livePreview`: "Decoraciones + clic en los links. El tema va aparte (`temaDelEditor`): con Live preview apagado el editor lo sigue usando (D11)." Si `src/__tests__/lib/cm-live-preview.test.ts` arma un `EditorView` con `livePreview(...)` y mira colores/fuente del tema, sumarle `temaDelEditor` a sus extensiones.

- [ ] **Step 4: El editor.** En `MemoryNoteEditor.tsx`:
  - Imports: `import { livePreview, refrescarLivePreview, temaDelEditor, type Resolver } from '../../lib/cm-live-preview'`, `import { DEFAULT_MEMORY_PREFS, type PrefsDelEditor } from '../../lib/memory-prefs'`.
  - En `MemoryNoteEditorProps`: `/** Live preview, ancho, ortografía y letra (spec §5, Editor & graph). */ prefs?: PrefsDelEditor`.
  - En la desestructuración de `EditorDeNota`: `prefs = DEFAULT_MEMORY_PREFS.editor,`.
  - Junto a `historiaComp`:

```ts
  const vistaComp = useRef(new Compartment()).current
  const ortografiaComp = useRef(new Compartment()).current
  const letraComp = useRef(new Compartment()).current
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  // Una sola instancia por editor (reconfigurar con otra instancia reinicia el plugin). Los
  // refs se leen recién al decorar/clickear, así que declararlos más abajo no importa.
  const extLivePreview = useMemo(() => livePreview({ resolver: () => resolverRef.current, onWikilink: (n, bg) => onWikilinkRef.current(n, bg) }), []) // eslint-disable-line react-hooks/exhaustive-deps
  const ortografia = (on: boolean) => EditorView.contentAttributes.of({ spellcheck: on ? 'true' : 'false' })
  // Con `editorAttributes` (atributo style) y no con otro theme: dos themes que ponen
  // font-size en '&' empatan en especificidad y gana el orden de montaje, que no controlamos.
  const letra = (px: number) => EditorView.editorAttributes.of({ style: `font-size: ${px}px` })
```

  - En las `extensions` del `EditorState.create`, reemplazar la línea `livePreview({...}),` por:

```ts
          temaDelEditor,
          // D11: apagado = Markdown crudo, sin decoraciones ni clic sobre el link.
          vistaComp.of(prefsRef.current.livePreview ? extLivePreview : []),
          ortografiaComp.of(ortografia(prefsRef.current.spellcheck)),
          letraComp.of(letra(prefsRef.current.fontSize)),
```

    y sumar `vistaComp, ortografiaComp, letraComp, extLivePreview` a las dependencias de ese `useEffect` (son estables).
  - Después del efecto de `soloLectura`:

```ts
  useEffect(() => {
    viewRef.current?.dispatch({ effects: vistaComp.reconfigure(prefs.livePreview ? extLivePreview : []) })
  }, [prefs.livePreview, vistaComp, extLivePreview])
  useEffect(() => {
    viewRef.current?.dispatch({ effects: ortografiaComp.reconfigure(ortografia(prefs.spellcheck)) })
  }, [prefs.spellcheck, ortografiaComp])
  useEffect(() => {
    viewRef.current?.dispatch({ effects: letraComp.reconfigure(letra(prefs.fontSize)) })
  }, [prefs.fontSize, letraComp])
```

    (`ortografia` y `letra` son funciones puras del render: no van en las dependencias; agregar `// eslint-disable-line react-hooks/exhaustive-deps` si el lint lo pide.)
  - El contenedor del título y el cuerpo: `<div className="mx-auto w-full max-w-[720px] px-10 py-9">` → `<div className={cn('mx-auto w-full px-10 py-9', prefs.readableWidth ? 'max-w-[720px]' : 'max-w-none')}>` (importar `cn` de `'cn'`; D12).

- [ ] **Step 5: Hasta la pestaña.** En `MemoriesNoteTab.tsx`: `import type { PrefsDelEditor } from '../lib/memory-prefs'`, prop `/** Spec §5, Editor & graph. */ prefsDelEditor?: PrefsDelEditor`, desestructurarla y pasar `prefs={prefsDelEditor}` a `<MemoryNoteEditor …>`. En `MemoriesWorkspace.tsx`, en `<MemoriesNoteTab …>`: `prefsDelEditor={prefsMem.prefs.editor}`.

- [ ] **Step 6:** `npx vitest run src/__tests__/components/MemoryNoteEditor.test.tsx src/__tests__/lib/cm-live-preview.test.ts src/__tests__/components/MemoriesWorkspace-obsidian.test.tsx src/__tests__/components/MemoriesWorkspace-tokens.test.tsx` → PASS. `npx vitest run` → PASS. Los dos `tsc` → 0.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/cm-live-preview.ts src/components/memories/MemoryNoteEditor.tsx src/components/MemoriesNoteTab.tsx src/components/MemoriesWorkspace.tsx src/__tests__/components/MemoryNoteEditor.test.tsx
git commit -m "feat(memories): el editor respeta live preview, ancho, ortografia y letra

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(Sumar `src/__tests__/lib/cm-live-preview.test.ts` al `git add` si se tocó.)

---

### Task 11: El grafo respeta Labels y Animate, y recuerda sus filtros

**Files:**
- Modify: `src/lib/memory-graph-2d.ts` (suma dos funciones puras), `src/components/memories/MemoryGraph2D.tsx`, `src/hooks/useGraphFilters.ts` (`inicial` + `aplicar`), `src/components/MemoriesWorkspace.tsx`
- Test: `src/__tests__/lib/memory-graph-2d.test.ts`, `src/__tests__/components/MemoryGraph2D-prefs.test.tsx` (nuevo), `src/__tests__/components/MemoriesWorkspace-obsidian.test.tsx`

**Interfaces:**
- Consumes: `EtiquetasDelGrafo`, `FiltrosGuardados`, `FILTROS_POR_DEFECTO`, `conFiltros` (Task 1); `useMemoryPrefs` en el workspace (Task 6); `restablecer` (Task 6).
- Produces:
  - `memory-graph-2d.ts`: `export const ZOOM_RELATIVO_DE_ETIQUETAS = 1.5`; `muestraEtiqueta(o: { modo: 'global' | 'local'; etiquetas: EtiquetasDelGrafo; escala: number; zoomDeEncuadre: number | null; destacado: boolean }): boolean`; `ticksDelMotor(o: { modo: 'global' | 'local'; sinAcomodo: boolean; animar: boolean }): { warmupTicks: number; cooldownTicks: number }`.
  - `MemoryGraph2DProps` suma `etiquetas?: EtiquetasDelGrafo` (default `'zoom'`) y `animar?: boolean` (default `true`); sólo afectan a `modo="global"` (D13).
  - `useGraphFilters(graph, ansi?, conInferidas = true, inicial?: FiltrosGuardados | null)` y devuelve además `aplicar: (f: FiltrosGuardados) => void` (estable; ignora `f.inferidas`, que es del workspace).

- [ ] **Step 1: Tests que fallan — lo puro.** En `src/__tests__/lib/memory-graph-2d.test.ts`:

```ts
import { muestraEtiqueta, ticksDelMotor, ZOOM_RELATIVO_DE_ETIQUETAS } from '../../lib/memory-graph-2d'

describe('muestraEtiqueta', () => {
  const base = { modo: 'global' as const, etiquetas: 'zoom' as const, escala: 1, zoomDeEncuadre: 1, destacado: false }
  it('When zoomed in: aparece pasando el umbral relativo al encuadre', () => {
    expect(muestraEtiqueta(base)).toBe(false)
    expect(muestraEtiqueta({ ...base, escala: ZOOM_RELATIVO_DE_ETIQUETAS })).toBe(true)
    expect(muestraEtiqueta({ ...base, zoomDeEncuadre: null, escala: 10 })).toBe(false)
  })
  it('Always siempre; On hover sólo el destacado', () => {
    expect(muestraEtiqueta({ ...base, etiquetas: 'always' })).toBe(true)
    expect(muestraEtiqueta({ ...base, etiquetas: 'hover', escala: 10 })).toBe(false)
    expect(muestraEtiqueta({ ...base, etiquetas: 'hover', destacado: true })).toBe(true)
  })
  it('el local siempre tiene etiquetas (D13)', () => {
    expect(muestraEtiqueta({ ...base, modo: 'local', etiquetas: 'hover' })).toBe(true)
  })
})

describe('ticksDelMotor', () => {
  it('animado: los ticks de siempre', () => {
    expect(ticksDelMotor({ modo: 'global', sinAcomodo: true, animar: true })).toEqual({ warmupTicks: 80, cooldownTicks: 150 })
    expect(ticksDelMotor({ modo: 'global', sinAcomodo: false, animar: true })).toEqual({ warmupTicks: 0, cooldownTicks: 150 })
    expect(ticksDelMotor({ modo: 'local', sinAcomodo: true, animar: false })).toEqual({ warmupTicks: 40, cooldownTicks: 60 })
  })
  it('sin animación el global se acomoda sin dibujar y aparece quieto', () => {
    expect(ticksDelMotor({ modo: 'global', sinAcomodo: true, animar: false })).toEqual({ warmupTicks: 300, cooldownTicks: 0 })
    expect(ticksDelMotor({ modo: 'global', sinAcomodo: false, animar: false })).toEqual({ warmupTicks: 120, cooldownTicks: 0 })
  })
})
```

Crear `src/__tests__/components/MemoryGraph2D-prefs.test.tsx`:

```tsx
import { forwardRef, useImperativeHandle } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

type Recibidas = { warmupTicks: number; cooldownTicks: number; nodeCanvasObject: (n: unknown, ctx: unknown, escala: number) => void }
const recibidas: Recibidas[] = []
vi.mock('react-force-graph-2d', () => ({
  default: forwardRef(function FG(props: Recibidas & { graphData: { nodes: Array<{ id: string }> } }, ref) {
    useImperativeHandle(ref, () => ({ d3Force: () => ({ distance: () => {}, strength: () => {} }), d3ReheatSimulation: () => {} }))
    recibidas.push(props)
    return <div data-testid="fg2d" />
  }),
}))

import MemoryGraph2D from '../../components/memories/MemoryGraph2D'

const nodo = { id: 'a', label: 'Alfa', color: '#fff', val: 1, degree: 1, superseded: false, type: 'decision', projectKey: 'p', projectLabel: 'p', tags: [], gitBranch: null, pending: false, x: 0, y: 0 }
const data = { nodes: [nodo], links: [], orphansHidden: 0 }
const ctx = () => ({ beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn(), globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '' })
const ultima = () => recibidas[recibidas.length - 1]

beforeEach(() => { recibidas.length = 0 })

describe('MemoryGraph2D — preferencias', () => {
  it('Animate off: se acomoda en warmup y no anima (cooldown 0)', async () => {
    render(<MemoryGraph2D modo="global" data={data} onOpen={vi.fn()} animar={false} />)
    await screen.findByTestId('fg2d')
    expect(ultima().cooldownTicks).toBe(0)
    expect(ultima().warmupTicks).toBeGreaterThan(0)
  })

  it('Labels: Always dibuja el nombre sin zoom; On hover no', async () => {
    const { rerender } = render(<MemoryGraph2D modo="global" data={data} onOpen={vi.fn()} etiquetas="always" />)
    await screen.findByTestId('fg2d')
    const c1 = ctx()
    ultima().nodeCanvasObject(nodo, c1, 1)
    expect(c1.fillText).toHaveBeenCalledWith('Alfa', expect.any(Number), expect.any(Number))
    rerender(<MemoryGraph2D modo="global" data={data} onOpen={vi.fn()} etiquetas="hover" />)
    const c2 = ctx()
    ultima().nodeCanvasObject(nodo, c2, 1)
    expect(c2.fillText).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2:** `npx vitest run src/__tests__/lib/memory-graph-2d.test.ts src/__tests__/components/MemoryGraph2D-prefs.test.tsx` → FAIL.

- [ ] **Step 3: Lo puro y el componente.** En `src/lib/memory-graph-2d.ts` sumar `import type { EtiquetasDelGrafo } from './memory-prefs'` y:

```ts
/** Las etiquetas del global aparecen al acercarse esto respecto del encuadre (spec §4 del 20-10). */
export const ZOOM_RELATIVO_DE_ETIQUETAS = 1.5

/** ¿Se dibuja el nombre de este nodo? (preferencia «Labels», spec 2026-10-21 §5). El local
 *  siempre lleva nombres (D13); el nodo bajo el mouse o enfocado también. */
export function muestraEtiqueta(o: {
  modo: 'global' | 'local'; etiquetas: EtiquetasDelGrafo; escala: number; zoomDeEncuadre: number | null; destacado: boolean
}): boolean {
  if (o.modo === 'local' || o.destacado) return true
  if (o.etiquetas === 'always') return true
  if (o.etiquetas === 'hover') return false
  return o.zoomDeEncuadre !== null && o.escala >= o.zoomDeEncuadre * ZOOM_RELATIVO_DE_ETIQUETAS
}

/** «Animate graph» (D13): apagado, el global corre la simulación sin dibujar y aparece quieto. */
export function ticksDelMotor(o: { modo: 'global' | 'local'; sinAcomodo: boolean; animar: boolean }): { warmupTicks: number; cooldownTicks: number } {
  if (o.modo === 'global' && !o.animar) return { warmupTicks: o.sinAcomodo ? 300 : 120, cooldownTicks: 0 }
  return { warmupTicks: o.sinAcomodo ? (o.modo === 'local' ? 40 : 80) : 0, cooldownTicks: o.modo === 'local' ? 60 : 150 }
}
```

En `MemoryGraph2D.tsx`: importar `muestraEtiqueta, ticksDelMotor` (junto a los imports de `memory-graph-2d`) y `type EtiquetasDelGrafo` de `../../lib/memory-prefs`; borrar la constante local `ZOOM_RELATIVO_DE_ETIQUETAS`; sumar a las props `/** «Labels» (sólo global). */ etiquetas?: EtiquetasDelGrafo` y `/** «Animate graph» (sólo global). */ animar?: boolean`, con defaults `etiquetas = 'zoom', animar = true` en la desestructuración; `const ticks = ticksDelMotor({ modo, sinAcomodo, animar })` y en `<ForceGraph2D>` `warmupTicks={ticks.warmupTicks}` y `cooldownTicks={ticks.cooldownTicks}`; en `nodeCanvasObject` reemplazar las líneas de `encuadre`/`porZoom`/`conEtiqueta` por:

```ts
              const conEtiqueta = muestraEtiqueta({
                modo, etiquetas, escala, zoomDeEncuadre: zoomDeEncuadre.current, destacado: n.id === hover || n.id === foco,
              })
```

- [ ] **Step 4:** `npx vitest run src/__tests__/lib/memory-graph-2d.test.ts src/__tests__/components/MemoryGraph2D-prefs.test.tsx src/__tests__/components/MemoryGraph2D.test.tsx` → PASS.

- [ ] **Step 5: Tests que fallan — recordar filtros.** En `src/__tests__/components/MemoriesWorkspace-obsidian.test.tsx`: importar `{ __reiniciarMemoryPrefs } from '../../hooks/useMemoryPrefs'` y `{ FILTROS_POR_DEFECTO } from '../../lib/memory-prefs'`; en el `beforeEach` sumar `__reiniciarMemoryPrefs()`; en el `afterEach`, `delete (window as unknown as { settings?: unknown }).settings`. Sumar:

```tsx
  describe('Remember graph filters', () => {
    const conGrafo = () => api({
      graph: vi.fn().mockResolvedValue(grafoAB()),
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    })
    const conSettings = (memoryPrefs: unknown, opts: { get?: () => Promise<unknown> } = {}) => {
      let store: Record<string, unknown> = { voiceLanguage: 'en', memoryPrefs }
      const set = vi.fn(async (d: Record<string, unknown>) => { store = d })
      ;(window as unknown as { settings: unknown }).settings = { get: opts.get ?? (async () => store), set }
      return { set, leer: () => store }
    }

    it('con Remember on, los filtros guardados vuelven al abrir', async () => {
      conSettings({ graph: { remember: true, filtros: { ...FILTROS_POR_DEFECTO, hideOrphans: false, inferidas: false } } })
      setMemoryApi(conGrafo())
      render(<MemoriesWorkspace {...props()} />)
      expect(await screen.findByRole('button', { name: /Showing unconnected/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Guessed links/ })).toHaveAttribute('aria-pressed', 'false')
    })

    it('un cambio se guarda a los 300 ms, y nada se guarda antes de que lleguen las prefs (Review Focus 2)', async () => {
      let soltar: (v: unknown) => void = () => {}
      const guardadas = { graph: { remember: true, filtros: { ...FILTROS_POR_DEFECTO, hideOrphans: false } } }
      const s = conSettings(guardadas, { get: () => new Promise((r) => { soltar = r }) })
      setMemoryApi(conGrafo())
      render(<MemoriesWorkspace {...props()} />)
      await screen.findByRole('button', { name: /Guessed links/ })
      await new Promise((r) => setTimeout(r, 400))
      expect(s.set).not.toHaveBeenCalled()
      soltar({ voiceLanguage: 'en', memoryPrefs: guardadas })
      expect(await screen.findByRole('button', { name: /Showing unconnected/ })).toBeInTheDocument()
      // Lo restaurado no se pisa con defaults.
      for (const [d] of s.set.mock.calls) expect((d.memoryPrefs as { graph: { filtros: { hideOrphans: boolean } } }).graph.filtros.hideOrphans).toBe(false)
      fireEvent.click(screen.getByRole('button', { name: /Guessed links/ }))
      await waitFor(() => expect(s.set).toHaveBeenCalledWith(expect.objectContaining({
        memoryPrefs: expect.objectContaining({ graph: expect.objectContaining({ filtros: expect.objectContaining({ inferidas: false, hideOrphans: false }) }) }),
      })))
    })

    it('cerrar el overlay dentro de los 300 ms guarda igual el último cambio', async () => {
      const s = conSettings({ graph: { remember: true } })
      setMemoryApi(conGrafo())
      const { unmount } = render(<MemoriesWorkspace {...props()} />)
      fireEvent.click(await screen.findByRole('button', { name: /Guessed links/ }))
      unmount()
      await waitFor(() => expect((s.leer().memoryPrefs as { graph: { filtros?: { inferidas: boolean } } }).graph.filtros?.inferidas).toBe(false))
    })

    it('con Remember off no se guarda nada', async () => {
      const s = conSettings({ graph: { remember: false } })
      setMemoryApi(conGrafo())
      render(<MemoriesWorkspace {...props()} />)
      fireEvent.click(await screen.findByRole('button', { name: /Guessed links/ }))
      await new Promise((r) => setTimeout(r, 400))
      expect(s.set).not.toHaveBeenCalled()
    })

    it('Reset graph to defaults vuelve filtros y fuerzas al arranque', async () => {
      conSettings({ graph: { remember: true, filtros: { ...FILTROS_POR_DEFECTO, hideOrphans: false, inferidas: false } } })
      setMemoryApi(conGrafo())
      render(<MemoriesWorkspace {...props()} />)
      await screen.findByRole('button', { name: /Showing unconnected/ })
      fireEvent.click(screen.getByRole('button', { name: 'Memory settings' }))
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: 'Editor & graph' }))
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
      fireEvent.click(screen.getByRole('tab', { name: /Graph/ }))
      expect(await screen.findByRole('button', { name: /unconnected hidden/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Guessed links/ })).toHaveAttribute('aria-pressed', 'true')
    })
  })
```

- [ ] **Step 6:** `npx vitest run src/__tests__/components/MemoriesWorkspace-obsidian.test.tsx -t "Remember graph filters"` → FAIL.

- [ ] **Step 7: `inicial` y `aplicar` en el hook.** En `src/hooks/useGraphFilters.ts`: `import { FILTROS_POR_DEFECTO, type FiltrosGuardados } from '../lib/memory-prefs'`; firma `useGraphFilters(graph: MemoryGraph | null, ansi?: readonly string[], conInferidas = true, inicial?: FiltrosGuardados | null)`; los `useState` arrancan de `inicial` (sólo se lee al montar):

```ts
  const ini = inicial ?? FILTROS_POR_DEFECTO
  const [colorBy, setColorBy] = useState<ColorBy>(ini.colorBy)
  const [foco, setFoco] = useState<Foco>(null)
  const [hideOrphans, setHideOrphans] = useState(ini.hideOrphans)
  const [tiposOcultos, setTiposOcultos] = useState<ReadonlySet<string>>(() => new Set(ini.tiposOcultos))
  const [escalaDeNodo, setEscalaDeNodo] = useState(ini.escalaDeNodo)
  const [distanciaDeLinks, setDistanciaDeLinks] = useState(ini.distanciaDeLinks)
```

y junto a `restablecer`:

```ts
  /** Lo recordado, cuando las prefs llegan después del primer render (primera apertura). Las
   *  inferidas no: ese interruptor es del workspace, que también decide qué pide a main. */
  const aplicar = useCallback((f: FiltrosGuardados) => {
    setColorBy(f.colorBy)
    setHideOrphans(f.hideOrphans)
    setTiposOcultos(new Set(f.tiposOcultos))
    setEscalaDeNodo(f.escalaDeNodo)
    setDistanciaDeLinks(f.distanciaDeLinks)
  }, [])
```

(`aplicar` en el objeto devuelto.)

- [ ] **Step 8: Restaurar y guardar en el workspace.** En `MemoriesWorkspace.tsx`: importar `conFiltros, FILTROS_POR_DEFECTO, type FiltrosGuardados` de `../lib/memory-prefs`. **Mover** `const prefsMem = useMemoryPrefs()` arriba de `useState(true)` de `includeSimilar`, y reemplazar `const [includeSimilar, setIncludeSimilar] = useState(true)` … `const filtros = useGraphFilters(grafo.graph, ansi, includeSimilar)` por:

```ts
  // Lo recordado (D14). Con las prefs ya en la caché de sesión arranca de ahí; en la primera
  // apertura llegan después y se aplican abajo, una vez.
  const recordadosAlMontar = useRef<FiltrosGuardados | null>(
    prefsMem.cargadas && prefsMem.prefs.graph.remember ? prefsMem.prefs.graph.filtros ?? null : null,
  )
  const [includeSimilar, setIncludeSimilar] = useState(recordadosAlMontar.current?.inferidas ?? FILTROS_POR_DEFECTO.inferidas)
  const grafo = useMemoryGraph(includeSimilar)
  // El mismo interruptor decide qué se le pide a main (similar) y qué se dibuja (todas las
  // inferidas): ver useGraphFilters.
  const filtros = useGraphFilters(grafo.graph, ansi, includeSimilar, recordadosAlMontar.current)

  /** true cuando lo guardado ya se aplicó: antes, guardar pisaría lo recordado con defaults
   *  (Review Focus 2). */
  const restaurado = useRef(prefsMem.cargadas)
  const aplicarFiltros = filtros.aplicar
  useEffect(() => {
    if (restaurado.current || !prefsMem.cargadas) return
    restaurado.current = true
    const g = prefsMem.prefs.graph
    if (g.remember && g.filtros) { aplicarFiltros(g.filtros); setIncludeSimilar(g.filtros.inferidas) }
  }, [prefsMem.cargadas, prefsMem.prefs.graph, aplicarFiltros])

  const guardables = useMemo<FiltrosGuardados>(() => ({
    colorBy: filtros.filtros.colorBy,
    hideOrphans: filtros.filtros.hideOrphans,
    tiposOcultos: [...filtros.filtros.tiposOcultos].sort(),
    escalaDeNodo: filtros.filtros.escalaDeNodo,
    distanciaDeLinks: filtros.filtros.distanciaDeLinks,
    inferidas: includeSimilar,
  }), [filtros.filtros, includeSimilar])
  const recordar = prefsMem.prefs.graph.remember
  const actualizarPrefs = prefsMem.actualizar
  /** Lo que falta guardar, para el flush al desmontar (cerrar el overlay dentro de los 300 ms). */
  const pendienteDeGuardar = useRef<FiltrosGuardados | null>(null)
  useEffect(() => {
    if (!restaurado.current || !recordar) { pendienteDeGuardar.current = null; return }
    pendienteDeGuardar.current = guardables
    const t = setTimeout(() => {
      pendienteDeGuardar.current = null
      actualizarPrefs((p) => conFiltros(p, guardables))
    }, 300)
    return () => clearTimeout(t)
  }, [guardables, recordar, actualizarPrefs])
  useEffect(() => () => {
    const f = pendienteDeGuardar.current
    if (f) actualizarPrefs((p) => conFiltros(p, f))
  }, [actualizarPrefs])
```

(`useMemo` ya está importado.) En `<MemoryGraph2D modo="global" …>` sumar `etiquetas={prefsMem.prefs.graph.labels}` y `animar={prefsMem.prefs.graph.animate}`.

- [ ] **Step 9:** `npx vitest run src/__tests__/components/MemoriesWorkspace-obsidian.test.tsx src/__tests__/components/MemoriesWorkspace-columnas.test.tsx src/__tests__/components/MemoriesWorkspace.test.tsx src/__tests__/components/GraphFiltersPanel.test.tsx` → PASS. `npx vitest run` → PASS. Los dos `tsc` → 0.

- [ ] **Step 10: Commit.**

```bash
git add src/lib/memory-graph-2d.ts src/components/memories/MemoryGraph2D.tsx src/hooks/useGraphFilters.ts src/components/MemoriesWorkspace.tsx src/__tests__/lib/memory-graph-2d.test.ts src/__tests__/components/MemoryGraph2D-prefs.test.tsx src/__tests__/components/MemoriesWorkspace-obsidian.test.tsx
git commit -m "feat(memories): el grafo respeta etiquetas y animacion y recuerda sus filtros

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Un solo «How it works»: tour y bienvenida

**Files:**
- Modify: `src/tutorial/tours/memories.ts:41-49`, `src/components/MemoriesWelcome.tsx:1-6,58`
- Test: `src/__tests__/components/MemoriesWelcome.test.tsx`, `src/__tests__/tutorial/section-tours.test.ts` (sin cambios: debe seguir verde)

**Interfaces:**
- Consumes: `memoriesTour` (`src/tutorial/tours/memories.ts`).
- Produces: el botón de la bienvenida dice `Show me around · ${memoriesTour.steps.length} steps`; el último paso del tour describe qué hay en Settings.

- [ ] **Step 1: Test que falla.** En `src/__tests__/components/MemoriesWelcome.test.tsx` (sumar `import { memoriesTour } from '../../tutorial/tours/memories'`):

```tsx
  it('el botón dice la cantidad real de pasos del tour', () => {
    render(<MemoriesWelcome onTour={() => {}} onSkip={() => {}} />)
    expect(screen.getByRole('button', { name: `Show me around · ${memoriesTour.steps.length} steps` })).toBeInTheDocument()
  })
```

Y en `src/__tests__/tutorial/section-tours.test.ts`, dentro del `describe` principal:

```ts
  it('el último paso de memories apunta al engranaje y dice qué hay en Settings', () => {
    const ultimo = getTour('memories')!.steps.at(-1)!
    expect(ultimo.anchor).toBe('[data-tour-id="memories-settings"]')
    expect(ultimo.body.en).toMatch(/editor/i)
    expect(ultimo.body.en).not.toMatch(/How Memories works/)
  })
```

- [ ] **Step 2:** `npx vitest run src/__tests__/components/MemoriesWelcome.test.tsx src/__tests__/tutorial/section-tours.test.ts` → FAIL ("5 steps" con un tour de 6; el body viejo menciona "How Memories works").

- [ ] **Step 3: Implementar.** En `src/tutorial/tours/memories.ts`, el paso `settings`:

```ts
    {
      id: 'settings',
      anchor: '[data-tour-id="memories-settings"]',
      title: en('Everything else lives here'),
      body: en('Settings opens as a tab: sync between your machines, encryption, editor and graph options, and the settings of the project you have open.'),
      placement: 'left',
    },
```

En `src/components/MemoriesWelcome.tsx`: `import { memoriesTour } from '@/tutorial/tours/memories'`; el botón pasa a `<Button onClick={onTour}>Show me around · {memoriesTour.steps.length} steps</Button>`; el comentario de cabecera: "…y la salida a la acción: el tour (tantos pasos como tenga) o seguir solo. Es el único «How it works» de Memories (spec 2026-10-21 §7)."

- [ ] **Step 4:** `npx vitest run src/__tests__/components/MemoriesWelcome.test.tsx src/__tests__/tutorial/section-tours.test.ts` → PASS. Los dos `tsc` → 0.

- [ ] **Step 5: Commit.**

```bash
git add src/tutorial/tours/memories.ts src/components/MemoriesWelcome.tsx src/__tests__/components/MemoriesWelcome.test.tsx src/__tests__/tutorial/section-tours.test.ts
git commit -m "feat(memories): un solo How it works, con la cantidad real de pasos

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: e2e a la pestaña, contraste y revisión visual

**Files:**
- Modify: `e2e/03-memories-in-app.spec.ts`, `e2e/04-contraste.spec.ts`, `e2e/12-cifrado-dos-maquinas.spec.ts`

**Interfaces:**
- Consumes: todo lo anterior. Selectores estables: botón `Memory settings` (engranaje), `tab` `/Settings/`, `navigation` `Settings sections` con botones exactos por sección, `switch` `Branch notes`, botón `Turn on encryption` (aria-label), texto `On · key #N`, `.tw-back-btn`.

- [ ] **Step 1: Guard de selectores muertos.** `grep -rn "This project & team\|How Memories works\|Branch notes in the repo\|Learn more\|'Memories', exact: true\|tw-header-title')).toHaveText('Memory settings')" e2e` → lista de lo que hay que cambiar. Correr `npx vitest run src/__tests__/e2e/dead-selectors.test.ts` → PASS (no se agregan clases nuevas a los specs).

- [ ] **Step 2: `e2e/03-memories-in-app.spec.ts`.**
  - "el overlay se dibuja…": reemplazar desde `await overlay.getByRole('button', { name: 'Memory settings' }).click()` hasta el `expect(page.locator('.memories-workspace')).toHaveCount(0)` por:

```ts
    await overlay.getByRole('button', { name: 'Memory settings' }).click()
    await overlay.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'This project', exact: true }).click()
    // Con repo: la fila de compartir (con o sin plan, se llama igual). Sin repo: vincular uno.
    const conRepo = await overlay.getByText('Share with a team', { exact: true }).count()
    const sinRepo = await overlay.getByRole('button', { name: /link a repo/i }).count()
    expect(conRepo + sinRepo).toBeGreaterThan(0)

    await page.screenshot({ path: join(SHOTS, '05-overlay-cuerpo.png') })

    // Y cierra: Back cierra el overlay entero, también con la pestaña Settings activa.
    await overlay.locator('.tw-back-btn').click()
    await expect(page.locator('.memories-workspace')).toHaveCount(0)
```

  - "Settings ya no tiene las tarjetas…": `await expect(page.locator('.tw-header-title')).toHaveText('Memory settings')` → `await expect(page.locator('.memories-workspace').getByRole('tab', { name: /Settings/, selected: true })).toBeVisible()`; el comentario "abre Memories directo en la vista de settings" → "abre Memories con la pestaña Settings activa".
  - "con un repo vinculado…": pasos 3 y 4 →

```ts
    // 3. La puerta a settings vive en el header: abre la pestaña Settings.
    await overlay.getByRole('button', { name: 'Memory settings' }).click()
    await expect(overlay.getByRole('tab', { name: /Settings/, selected: true })).toBeVisible()
    await overlay.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'This project', exact: true }).click()

    // 4. La fila de compartir: que se vea prueba que status y projectKeyForWorktree contestaron
    //    contra el main de verdad.
    await expect(overlay.getByText('Share with a team', { exact: true })).toBeVisible()
```

    paso 5: `{ name: /Branch notes in the repo/ }` → `{ name: 'Branch notes' }`; paso 7 →

```ts
    // 7. El toggle vive en una pestaña del mismo workspace: la pestaña Team thread aparece en
    //    el acto, sin volver a ningún lado.
    await overlay.getByRole('tab', { name: /Team thread/ }).click()
```

  - "Learn more en Memory settings › Sync abre el hub ENCIMA del overlay" → reemplazar el test entero (D17):

```ts
// Review final de rama, CRITICAL #1 (19-10): lo que se abre desde ADENTRO de
// `.memories-workspace` y porta a `document.body` (`.modal-backdrop`) tiene que quedar encima.
// Antes lo medía el hub de "Learn more", que salió (spec 2026-10-21 §5); el UpgradeModal usa
// el mismo backdrop y la misma escala de z-index.
test('Upgrade desde la pestaña Settings abre el modal ENCIMA del overlay', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    await page.locator('.sidebar-item-settings').first().click()
    const puerta = page.getByRole('button', { name: 'Memory settings' })
    await expect(puerta).toBeVisible({ timeout: 10_000 })
    await puerta.click()

    const overlay = page.locator('.memories-workspace')
    await expect(overlay.getByRole('heading', { name: 'Sync' })).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(500)
    const upgrade = overlay.getByRole('button', { name: 'Upgrade', exact: true })
    test.skip((await upgrade.count()) === 0, 'build con la nube habilitada (beta): Cloud sync no ofrece Upgrade')
    await upgrade.first().click()

    const modal = page.locator('.upgrade-modal')
    await expect(modal).toBeVisible({ timeout: 10_000 })
    const arriba = await page.evaluate(() =>
      Boolean(document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)?.closest('.modal-backdrop')))
    expect(arriba).toBe(true)
    expect(await modal.evaluate((el) => Number(getComputedStyle(el.parentElement!).zIndex)))
      .toBeGreaterThan(await overlay.evaluate((el) => Number(getComputedStyle(el).zIndex)))

    await page.screenshot({ path: join(SHOTS, '12-upgrade-sobre-settings.png') })
  } finally {
    await teardown(h)
  }
})
```

  - Sumar un test de capturas para la revisión visual:

```ts
test('la pestaña Settings: una captura por sección', async () => {
  const h = await launchHarness()
  const { page } = h
  try {
    await page.evaluate((dir) => {
      ;(window as unknown as { __e2e_linkRepo?: (p: string) => void }).__e2e_linkRepo?.(dir)
    }, h.repoDir)
    await page.getByTitle(/^Memories/).first().click()
    const overlay = page.locator('.memories-workspace')
    await overlay.getByRole('button', { name: 'Memory settings' }).click()
    const nav = overlay.getByRole('navigation', { name: 'Settings sections' })
    for (const [i, s] of ['Sync', 'Encryption', 'Editor & graph', 'This project', 'Notes on disk', 'Advanced'].entries()) {
      await nav.getByRole('button', { name: s, exact: true }).click()
      await expect(overlay.getByRole('heading', { name: s })).toBeVisible()
      await page.waitForTimeout(600)
      await page.screenshot({ path: join(SHOTS, `20-settings-${i + 1}-${s.toLowerCase().replace(/[^a-z]+/g, '-')}.png`) })
    }
  } finally {
    await teardown(h)
  }
})
```

- [ ] **Step 3: `e2e/04-contraste.spec.ts`.** En `pantallas`, reemplazar las entradas `memory-settings-sync` … `memories-welcome` por:

```ts
      // Spec 2026-10-21: Memory settings es una pestaña con seis secciones; se mide cada una.
      ['memory-settings-sync', async () => {
        // Sync es la sección con que abre la pestaña.
        await page.locator('.memories-workspace').getByRole('button', { name: 'Memory settings' }).click()
        await page.waitForTimeout(600)
      }],
      ...(['Encryption', 'Editor & graph', 'This project', 'Notes on disk', 'Advanced'] as const).map((s): [string, () => Promise<void>] => [
        `memory-settings-${s}`,
        async () => {
          await page.locator('.memories-workspace').getByRole('navigation', { name: 'Settings sections' })
            .getByRole('button', { name: s, exact: true }).click()
          // This project encadena tres IPC (projectKeyForWorktree → getSettings → status).
          await page.waitForTimeout(800)
        },
      ]),
      ['memories-welcome', async () => {
        // "How it works" está siempre en el header. Bajo RAVEN_E2E=1 la bienvenida no se
        // auto-muestra; el botón la fuerza.
        await page.getByRole('button', { name: 'How it works' }).click()
        await page.waitForTimeout(800)
      }],
```

  y en "el estado vacio de Memories (sin repo)…": `getByRole('button', { name: /This project & team/ })` → `getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'This project', exact: true })` (y el comentario: "Memory settings → This project").

- [ ] **Step 4: `e2e/12-cifrado-dos-maquinas.spec.ts`.** `abrirEncryption`: el segundo click pasa a `await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Encryption', exact: true }).click()` (doc: "Settings es una pestaña; cada apertura nueva arranca donde quedó, así que se elige la sección igual"). `cerrarMemories`: borrar las dos líneas de `backDeSettings` y su comentario; queda `await overlay.locator('.tw-back-btn').click()` + el `expect`. Texto: `a.page.getByText('Turn on encryption')` → `a.page.getByRole('button', { name: 'Turn on encryption' })`; los dos `getByText('Encryption on')` → `getByText(/^On · key #\d+$/)`; `getByText('Machines waiting for authorisation:')` → `getByRole('button', { name: 'They match — authorise' })` (en el `toBeVisible` y en el `toHaveCount(0)`).

- [ ] **Step 5: Correr.** `npm run build`; `npm run native:electron` (si da `EBUSY` por un `electron.exe` vivo de este worktree: **no matarlo**, avisar a Gero y esperar a que lo cierre). Después `npx playwright test e2e/03-memories-in-app.spec.ts e2e/04-contraste.spec.ts e2e/08-memory-graph.spec.ts` → PASS (el test del Upgrade puede salir *skipped* con su motivo, D17). `e2e/12` necesita el servicio de sync arriba (`server/README.md`); si no está, no se corre y se reporta así. Volver a `npx vitest run` (el `pretest` deja el binding de Node) → PASS.

- [ ] **Step 6: Revisión visual.** Abrir con `Read` las capturas `20-settings-*.png`, `05-overlay-cuerpo.png` y `07-overlay-con-repo.png` de `test-results/` (la carpeta `SHOTS` del spec 03) y verificar contra el spec §3–§4: lista de secciones a la izquierda con la activa en `bg-accent`; pestaña «Settings» con ×; panel derecho colapsado; cada fila con nombre en `font-medium`, la descripción atenuada en ≤ 2 líneas, el control a la derecha y separadores `border-border` entre filas; nada con el aspecto de `sp-card`; sin bordes ni fondos de botón del navegador (trampa del preflight). Lo que no coincida se arregla en el componente correspondiente (con su test) antes de commitear.

- [ ] **Step 7: Commit.**

```bash
git add e2e/03-memories-in-app.spec.ts e2e/04-contraste.spec.ts e2e/12-cifrado-dos-maquinas.spec.ts
git commit -m "test(e2e): Memory settings como pestana

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(Si el Step 6 tocó componentes, sumarlos al `git add` con sus tests.)

---

## Self-review

**Cobertura del spec.**
- §3 pestaña: modelo + `openSettings` (T2), engranaje y Account (T6), sale vista/Back/`onVistaChange`/`MemorySettingsView` (T6), Task 10 del hilo (T5–T6, D3/D4), explorer con secciones y estado intacto (T3, T6), panel derecho (T6, D6), notas montadas detrás (T6, Review Focus 5).
- §4 filas: `SettingRow` (T3); reescritura sin `sp-card` ni inline (T7–T9, guard `memory-settings-sin-sp`).
- §5: Sync (T7), Encryption (T8), Editor & graph (T4, T10, T11), This project (T5, T9), Notes on disk (T9), Advanced (T7), "Sale" (T7–T9: textos repetidos, compartir sin salida, token en Sync, badge, numeración, bajadas largas).
- §6 prefs: `AppSettings.memoryPrefs`, merge, `useSettings`, `useMemoryPrefs`, props en `memories/` (T1, T6, T10, T11); `useGraphFilters` con estado inicial + debounce 300 ms (T11, con la persistencia en el workspace por D14).
- §7: tour `memory-settings` y evento salen (T6), último paso del tour y cantidad real de pasos (T12).
- §8: cada test pedido tiene tarea; `la-app-es-en-ingles` y `04-contraste` (T7–T9, T13); typecheck en cada tarea.

**Placeholders:** ninguno; donde una tarea toca un archivo grande sin reescribirlo entero (TeamEncryptionCard, App) se da la transformación rama por rama o el bloque exacto.

**Consistencia de tipos:** `SeccionDeSettings`/`SECCIONES_DE_SETTINGS`/`openSettings` (T2) se usan igual en T3, T5, T6; `MemoryPrefs`/`PrefsDelEditor`/`FiltrosGuardados`/`conFiltros`/`FILTROS_POR_DEFECTO` (T1) en T4, T6, T10, T11; `UseTeamThreadSettings.cargaFallida` (T5) en T6 y T9; `restablecer` (T6) y `aplicar`/`inicial` (T11) en `useGraphFilters`; `etiquetas`/`animar` (T11) en `MemoryGraph2D`.

**Review Focus:** 1 → T1 Step 5; 2 → T11 Step 5 (dos tests); 3 → T6 Step 1; 4 → T6 Step 1 (+ columnas); 5 → T6 Step 1.
