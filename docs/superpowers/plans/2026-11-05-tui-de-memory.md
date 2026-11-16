# La TUI de Nest Memory — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que `nestmux-memory` sin argumentos en una TTY abra una TUI (Ink) para ver, buscar, crear, editar y borrar memorias, y que Nest la abra en un pane desde la paleta y desde la vista Memories.

**Architecture:** el núcleo de la TUI (estado puro, frontmatter, editor externo y pantallas Ink) vive en `electron/tui-del-paquete/` y no sabe de dónde salen los datos: recibe una `FuenteDeLaTui`. Hay dos fuentes: la del paquete (daemon de Nest si está vivo y, si no, la base con `MemoryLocalClient` + sync de una pasada) y la de Nest (sólo el daemon, por las variables del pane). Cada fuente tiene su entrada: `cli-del-paquete.ts` (el paquete, que compila a CommonJS con tsc) y `tui-de-nest.ts` (un entry nuevo de electron-vite que corre con el Electron de Nest en modo Node).

**Tech Stack:** Ink 5.2.1, React 18.3 (el que ya tiene la raíz), ink-testing-library 4.0.0, vitest, Playwright para el e2e.

**Spec:** `docs/superpowers/specs/2026-11-02-tui-de-memory-design.md`, con DOS correcciones que este plan incorpora y la Task 9 escribe en el spec:
1. **§5 (decisión de Gero, 2026-11-05):** el pane NO corre `cli-del-paquete.js`. Electron 33 trae Node 20.18, que no tiene `node:sqlite` (el CLI lo carga al arrancar) ni puede hacer `require` de un ESM con top-level await (Ink), y el CLI tampoco viaja en la app: electron-builder empaqueta sólo `dist/` y `dist-electron/`. Lo que corre es un entry propio, `dist-electron/memory-tui.js`, que sólo le habla al daemon.
2. **Errores y bordes, "memoria de equipo cifrada sin clave":** una fila ilegible nunca llega a `observations` (`memory-store.ts:1264`: "una fila ilegible no se aplica"), así que no hay título que listar. Lo que la TUI muestra es el conteo, en Status.

## Global Constraints

- Todo texto visible va en **inglés**: pantallas, mensajes, ayuda.
- `packages/nest-memory/package.json`: `engines.node` pasa a `">=22.12"`. `NODE_MINIMO` en el doctor pasa a `'22.12.0'` y el mensaje lo nombra.
- Dependencias nuevas: `ink@5.2.1` y `react@^18.3.1` en `dependencies` del paquete; `ink@5.2.1` en `dependencies` de la raíz (para que viaje en el asar), y `ink-testing-library@4.0.0` en `devDependencies` de la raíz. Nada más: sin `ink-text-input`.
- **Ink se carga con un `import()` real, nunca con `require`.** El paquete compila a CommonJS, y tsc transforma un `import('ink')` en `require('ink')`, que falla con `ERR_REQUIRE_ASYNC_MODULE` porque la carga de yoga tiene top-level await. Se usa `new Function('m', 'return import(m)')` (Task 7). React es CommonJS y se importa normal.
- `mcp`, `login`, `status`, `search`, `doctor`, `setup`, `recover` y los hooks no cargan `ink` ni `react`: la TUI entra por un `import()` dinámico de `./tui-del-paquete/arrancar` sólo en el camino sin argumentos.
- JSX: `"jsx": "react-jsx"` en `packages/nest-memory/tsconfig.json` y en `tsconfig.node.json`, que además suma `electron/**/*.tsx` a `include`. El proyecto `node` de `vitest.config.ts` suma `electron/__tests__/**/*.test.tsx`.
- Debounce de búsqueda: **150 ms**. Ancho: con menos de **60** columnas se oculta la fecha; con menos de **40**, "Window too narrow".
- Temporal del editor: `join(os.tmpdir(), 'memory-<id>.md')`, modo **0600**, borrado en `finally`. Con una memoria nueva, `<id>` es `new-<randomUUID>`.
- El tipo por defecto de una memoria nueva es `decision`. Los tipos válidos son los de `ObservationType` (`memory-protocol.ts:15`).
- Typecheck: los dos comandos de CI (`npx tsc -p tsconfig.node.json --noEmit --composite false` y `npx tsc -p tsconfig.web.json --noEmit --composite false`). El baseline es cero errores.
- Después de `npm test`, la app no levanta hasta correr `npm run native:electron`. El e2e corre contra `dist/`, así que va con `npm run build` antes.

## Review Focus

1. **Ctrl+C o una excepción con el editor abierto, o durante el render:** la terminal tiene que quedar restaurada (cursor visible, fuera del modo crudo y de la pantalla alternativa) y el temporal borrado. → test en la Task 5 (`editarEnEditor` borra el temporal cuando el editor sale con código ≠ 0 o tira) y en la Task 8 (`restaurarTerminal` se registra en `process.on('exit')` y en `SIGINT`).
2. **`$EDITOR` con argumentos y espacios** (`code --wait`, `"/Applications/Sublime Text.app/.../subl" -w`): partir respetando las comillas y sin shell. → test en la Task 5 (`partirComando`).
3. **Nest se cierra con la TUI abierta**: la escritura que falla por conexión (`ECONNREFUSED`/`ENOENT` del socket) no puede perder lo escrito; la fuente del paquete reintenta una vez con la base local. → test en la Task 6.
4. **Una base que no existe** (máquina nueva): leer no tiene que crear `~/.nest-memory`. Sólo una escritura la crea. → test en la Task 6.
5. **Un `[[link]]` dentro de un bloque de código** no se resalta ni se recorre. → test en la Task 3 (`segmentosDeContenido`).

---

### Task 1: el protocolo da lo que la TUI necesita

Tres cambios aditivos en el despacho del daemon (`MemoryIpcServer.responder`), que usan tanto el daemon de Nest como `MemoryLocalClient`.

**Files:**
- Modify: `electron/memory-protocol.ts` (`ContextMemoryParams`, `GetMemoryResult`, `UpdateMemoryParams`)
- Modify: `electron/memory-ipc-server.ts:399-452` (casos `memory.context`, `memory.get` y `memory.update`)
- Modify: `electron/memory-store.ts` (`context()` acepta `projectKey: string | null`; `update()` acepta `type`)
- Test: `electron/__tests__/memory-ipc-server.test.ts`, agregados al archivo que ya existe (si el despacho se prueba en otro archivo, va ahí)

**Interfaces:**
- Produces:
  - `ContextMemoryParams.allProjects?: boolean`: con `true`, `store.context(null, limit)`, o sea todos los proyectos.
  - `GetMemoryResult.resolvedLinks: WikilinkResuelto[]` (`{ name: string; syncId: string | null }`, de `memory-vecinos.ts`), en el orden en que aparecen en el texto. El tipo se mueve a `memory-protocol.ts` y `memory-vecinos.ts` lo re-exporta, igual que ya pasa con `VecinoDeMemoria`. El store expone `linksResueltos(syncId)`, que envuelve `linksResueltosDe`.
  - `UpdateMemoryParams.type?: ObservationType`: si viene y es distinto, se cambia. Cambiar sólo el tipo cuenta como cambio (`updated: true`) y entra al `mutation_log` por el mismo camino que título y contenido.

- [ ] **Step 1: tests que fallan.**
  - `memory.context con allProjects trae memorias de otro proyecto`: guardar en dos `cwd` con remotes distintos y verificar que `allProjects: true` devuelve las dos, y que sin el flag devuelve sólo la del `cwd`.
  - `memory.get devuelve resolvedLinks en orden, con null para el hueco`: A con contenido `see [[B]] and [[Nope]]` y B existente da `[{ name: 'B', syncId: B }, { name: 'Nope', syncId: null }]`.
  - `memory.update cambia sólo el tipo`: `{ syncId, type: 'bugfix' }` da `updated: true`; un `memory.get` posterior trae `type: 'bugfix'`, y `mutation_log` creció en 1.
  - `memory.update con el mismo tipo y nada más es unchanged`: da `reason: 'unchanged'`.
- [ ] **Step 2:** `npx vitest run electron/__tests__/memory-ipc-server.test.ts` → FAIL en los 4.
- [ ] **Step 3:** implementar. En `update()`, `type` entra en la comparación de "¿cambió algo?" junto con `content_hash` y `tags`. La línea 244 ya compara `existing.type` en `save()`: seguí ese criterio.
- [ ] **Step 4:** el mismo comando da PASS, y la suite de memoria sigue verde: `npx vitest run electron/__tests__/memory-`.
- [ ] **Step 5:** commit `feat(memoria): context de todos los proyectos, links resueltos en get y tipo en update`.

---

### Task 2: Status y Doctor como datos, no como `console.log`

Hoy `comandoStatus` y `comandoDoctor` (`cli-del-paquete.ts:180-378`) imprimen mientras calculan. El spec pide que la TUI reuse "las funciones que ya arman esas salidas", y esas funciones no existen. Esta task las crea, deja al CLI imprimiendo exactamente lo mismo y suma al doctor la lista de lo bloqueado (el spec dice que el Doctor de la TUI tiene el "mismo contenido que `nestmux-memory doctor`" y además muestra "lo bloqueado con su razón").

**Files:**
- Create: `electron/donde-esta-la-base.ts`: `dondeEstaLaBase()` sale de `cli-del-paquete.ts:167` sin cambios.
- Create: `electron/status-del-paquete.ts`
- Create: `electron/doctor-del-paquete.ts`
- Modify: `electron/cli-del-paquete.ts`: `comandoStatus` y `comandoDoctor` pasan a llamar y pintar.
- Test: `electron/__tests__/status-del-paquete.test.ts`, `electron/__tests__/doctor-del-paquete.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Marca = 'ok' | 'aviso' | 'pendiente' | 'nada' | 'falla'
  export interface FilaDeEstado { marca: Marca; etiqueta: string; detalle: string }
  export interface DatosDeStatus {
    modo: 'daemon' | 'nest' | 'propia'
    vacia: boolean                     // base propia nueva: "No memory on this machine yet"
    total: number
    porGrupo: Partial<Record<GrupoDeTipo, number>>
    personal: number; deEquipo: number
    guardadaEn: string | null          // el path, ya acortado con acortarHome
    servicio: string | null
    filas: FilaDeEstado[]              // Sync, Upgrade, Encrypted, Team, en ese orden y con los mismos textos de hoy
    ilegiblesDeEquipo: number          // `undecryptable` ∩ `undecryptable_team_ids`; 0 si no hay tabla
    recientes: ObservationSummary[]    // las 3 de LATELY
    resumen: string                    // una línea para el encabezado de la TUI: "synced", "3 waiting to sync", "needs encryption setup", "Nest owns this memory"
  }
  export async function leerStatusDelPaquete(d: DependenciasDeStatus): Promise<DatosDeStatus>

  export interface Bloqueada { syncId: string | null; titulo: string; motivo: string }
  export interface DatosDeDoctor {
    filas: FilaDeEstado[]              // Node, Home, Nest, Memory, Keyring
    homeDeNest: boolean                // el aviso "This HOME looks like a Nest account folder"
    bloqueadas: Bloqueada[]            // mutation_log con blocked_reason y pushed_at IS NULL; título sacado del payload, o '(untitled)'
    problemas: number; avisos: number
  }
  export async function leerDoctorDelPaquete(d: DependenciasDeDoctor): Promise<DatosDeDoctor>
  ```
  `DependenciasDeStatus` y `DependenciasDeDoctor` reciben lo que hoy se lee del proceso (`home`, `env`, la `base` ya decidida, `abrirSoloLectura`, `safe`, `version` de Node, el `llavero`, `urlUpgrade`), así los tests no tocan el disco real.
- Status con `ilegiblesDeEquipo > 0` agrega la fila `{ marca: 'aviso', etiqueta: 'Team', detalle: '<N> encrypted for your team — this machine doesn't have the team key yet' }`.

- [ ] **Step 1: tests que fallan**, con una base temporal armada con `MemoryStore` y `node:sqlite` (como los tests de `estado-de-sync-del-paquete.test.ts`):
  - `status de base propia con 2 en cola`: `filas[0]` es `{ marca: 'pendiente', etiqueta: 'Sync' }` con el detalle de `lineaDeSync`, y `resumen` es `'2 waiting to sync'`.
  - `status en modo daemon`: `filas` es sólo `[{ marca: 'ok', etiqueta: 'Nest', detalle: 'open here — it owns this memory and syncs it live' }]`.
  - `status cuenta los ilegibles de equipo`.
  - `doctor con Node 22.11 es un problema que nombra 22.12`: el detalle contiene `needs 22.12.0 or newer`.
  - `doctor lista lo bloqueado con su motivo`: una fila de `mutation_log` con `blocked_reason = 'team_key_missing'` y un payload con `title: 'X'` da `bloqueadas = [{ titulo: 'X', motivo: 'team_key_missing' }]`.
- [ ] **Step 2:** `npx vitest run electron/__tests__/status-del-paquete.test.ts electron/__tests__/doctor-del-paquete.test.ts` → FAIL.
- [ ] **Step 3:** implementar moviendo la lógica, no reescribiéndola. El CLI mapea `Marca` a `marcas[m](e)` y sigue imprimiendo lo mismo; el doctor del CLI suma al final un bloque `BLOCKED` con `fila(marcas.aviso(e), titulo, motivo)` por bloqueada. `NODE_MINIMO = '22.12.0'`, y la comparación pasa a menor ≥ 12.
- [ ] **Step 4:** PASS. Después, en la Mac: `npm run build -w packages/nest-memory` (o `npx tsc -p packages/nest-memory/tsconfig.json`), `node packages/nest-memory/dist/cli-del-paquete.js status` y `... doctor`. La salida tiene que ser la de antes, más la línea de Node y el bloque BLOCKED si hay bloqueadas.
- [ ] **Step 5:** commit `refactor(paquete): status y doctor devuelven datos; doctor lista lo bloqueado y pide Node 22.12`.

---

### Task 3: el estado puro de la TUI

Todo lo que la TUI decide, sin Ink: así se prueba con vitest a secas.

**Files:**
- Create: `electron/tui-del-paquete/estado.ts`
- Test: `electron/__tests__/tui-estado.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Pestana = 'recent' | 'search' | 'status' | 'doctor'
  export interface Vista { tipo: 'detalle'; syncId: string; linkEnfocado: number | null; scroll: number }
  export interface EstadoDeLaTui {
    pestana: Pestana
    todosLosProyectos: boolean
    lista: ObservationSummary[]; cursor: number
    consulta: string
    pila: Vista[]                       // vacía = se ve la pestaña; tope = el detalle visible
    detalle: DetalleDeMemoria | null    // el del tope de la pila
    aviso: { texto: string; tipo: 'info' | 'error' } | null   // la barra inferior
    confirmando: { syncId: string; titulo: string } | null    // "Delete …? y/N"
    errorDeEditor: { mensaje: string; archivo: string } | null // Reopen / Discard
    ayuda: boolean
    cargando: boolean
  }
  export type Accion = /* una por tecla o resultado: 'tecla' con { input, key } de Ink, 'lista-cargada', 'detalle-cargado', 'escrito', 'fallo', 'tick-de-busqueda' … */
  export function estadoInicial(): EstadoDeLaTui
  export function reducir(e: EstadoDeLaTui, a: Accion): { estado: EstadoDeLaTui; efectos: Efecto[] }
  export type Efecto =
    | { tipo: 'cargar-recientes'; todos: boolean }
    | { tipo: 'buscar'; consulta: string; enMs: 150 }
    | { tipo: 'abrir'; syncId: string }
    | { tipo: 'editar'; syncId: string | null }       // null = nueva
    | { tipo: 'reabrir-editor'; archivo: string }
    | { tipo: 'borrar'; syncId: string }
    | { tipo: 'cargar-status' } | { tipo: 'cargar-doctor' }
    | { tipo: 'salir' }
  export function segmentosDeContenido(texto: string, links: WikilinkResuelto[]): Array<{ texto: string; link?: { indice: number; syncId: string | null } }>
  export function columnas(ancho: number): { conFecha: boolean; demasiadoAngosta: boolean }
  ```
  `DetalleDeMemoria` = `{ item: ObservationSummary; resolvedLinks: WikilinkResuelto[]; pendingLinks: string[] }` (lo que devuelve `memory.get`, sin `neighbors`).
- Teclas (spec §1): `1`–`4` y `Tab` cambian de pestaña cuando no hay detalle abierto; dentro del detalle, `Tab` y `Shift+Tab` recorren los links. `↑`/`↓`/`j`/`k` mueven; `⏎` abre; `n`, `e` y `d` crean, editan y borran; `/` salta a Search; `g` alterna "this project" / "all projects" en Recent; `Esc` saca el tope de la pila; `?` muestra u oculta la ayuda; `q` y `Ctrl+C` salen. En Search, las letras se escriben en `consulta` (salvo `Esc`, flechas y `⏎`), así que ahí `q`, `n`, `e`, `d` y `g` son texto.

- [ ] **Step 1: tests que fallan.**
  - `⏎ sobre la fila 2 apila el detalle y pide abrirlo`: `pila = [{ syncId: lista[1].syncId, linkEnfocado: null }]` y `efectos = [{ tipo: 'abrir', … }]`.
  - `⏎ sobre un link resuelto apila otra vista; Esc vuelve a la memoria anterior, no a la lista`.
  - `Tab y Shift+Tab recorren sólo los links con syncId y dan la vuelta`; un hueco (`syncId: null`) se saltea.
  - `escribir en Search pide una búsqueda a 150 ms`: el efecto `buscar` lleva la consulta completa, y escribir de nuevo reemplaza el pedido (la cancelación la hace el runner con el `enMs`).
  - `q en Search escribe la letra; q en Recent sale`.
  - `d pide confirmación; y borra; cualquier otra tecla cancela`.
  - `segmentosDeContenido no marca un link dentro de un bloque de código`: el texto ``"```\n[[B]]\n```\n[[B]]"`` con `B` resuelto da un único segmento con `link`, el segundo. (Review Focus 5.)
  - `columnas(59).conFecha === false`, `columnas(39).demasiadoAngosta === true` y `columnas(60).conFecha === true`.
- [ ] **Step 2:** `npx vitest run electron/__tests__/tui-estado.test.ts` → FAIL.
- [ ] **Step 3:** implementar. Para no marcar código, `segmentosDeContenido` usa la misma regla que `parsearWikilinks`: exportar desde `wikilinks.ts` `sinBloquesDeCodigo` y `sinCodigoEnLinea` (hoy privadas) o un `rangosDeCodigo(texto)`, sin duplicarlas. Un link se identifica por nombre, sin distinguir mayúsculas, contra `resolvedLinks`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(tui): estado puro de la TUI de memoria`.

---

### Task 4: el frontmatter del archivo del editor

**Files:**
- Create: `electron/tui-del-paquete/frontmatter.ts`
- Test: `electron/__tests__/tui-frontmatter.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MemoriaEscrita { title: string; type: ObservationType; tags: string[]; content: string }
  export const AYUDA_DE_NUEVA: string   // el comentario de ayuda del cuerpo: "<!-- Write the memory here … -->"
  export function serializarMemoria(m: MemoriaEscrita): string
  export function plantillaDeNueva(): string   // type: decision, title vacío, tags: [], cuerpo = AYUDA_DE_NUEVA
  export function parsearMemoria(texto: string): { ok: true; memoria: MemoriaEscrita } | { ok: false; error: string }
  ```
- Formato exacto: el del spec §2 (`---` / `title:` / `type:` / `tags: [a, b]` / `---` / cuerpo).
- Errores, con estos textos: `'Missing frontmatter (--- … ---) at the top'`, `'title can't be empty'`, `'Unknown type "<x>". Use one of: decision, bugfix, …'` (la lista sale de `ObservationType`, mantenida en un array `TIPOS` exportado de `memory-protocol.ts`), `'tags must be a list like [a, b]'`.
- Si el cuerpo es exactamente `AYUDA_DE_NUEVA`, el `content` es `''`. Si el comentario aparece junto a otro texto, se le saca el comentario.

- [ ] **Step 1: tests que fallan.** Ida y vuelta (`parsearMemoria(serializarMemoria(m))` da `m`); un título con `:` y `#` sobrevive a la ida y vuelta; cada uno de los 4 errores; `tags: []` es una lista vacía; si falta `tags`, es `[]`; CRLF de Windows parsea igual.
- [ ] **Step 2:** `npx vitest run electron/__tests__/tui-frontmatter.test.ts` → FAIL.
- [ ] **Step 3:** implementar a mano, sin dependencia de YAML: sólo hay tres claves y la lista es de una línea. Al serializar, el título va entre comillas dobles si contiene `:`, `#`, `[` o empieza con comillas, y el parser las saca.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(tui): frontmatter de la memoria para el editor externo`.

---

### Task 5: el editor externo

**Files:**
- Create: `electron/tui-del-paquete/editor-externo.ts`
- Create: `electron/__tests__/fixtures/editor-falso.mjs`: un "editor" que lee `EDITOR_FALSO_MODO` (`igual` | `valido` | `invalido` | `falla`) y reescribe el archivo que le llega en `argv` o sale con 3.
- Test: `electron/__tests__/tui-editor-externo.test.ts`

**Interfaces:**
- Consumes: `serializarMemoria`, `plantillaDeNueva` y `parsearMemoria` (Task 4).
- Produces:
  ```ts
  export function elegirEditor(env: NodeJS.ProcessEnv, plataforma: NodeJS.Platform, existe: (bin: string) => boolean): string[]
  export function partirComando(s: string): string[]
  export type ResultadoDeEdicion =
    | { tipo: 'sin-cambios' }
    | { tipo: 'lista'; memoria: MemoriaEscrita }
    | { tipo: 'invalida'; error: string; archivo: string }   // el archivo NO se borra: lo necesita Reopen
    | { tipo: 'fallo-el-editor'; error: string }
  export function editarEnEditor(o: {
    inicial: string; id: string; editor: string[]
    lanzar?: (bin: string, args: string[]) => { status: number | null; error?: Error }   // default: spawnSync con stdio 'inherit' y shell: false
  }): ResultadoDeEdicion
  export function reabrirEnEditor(archivo: string, editor: string[], lanzar?: …): ResultadoDeEdicion
  export function descartar(archivo: string): void
  ```
- Elección (spec §2): `VISUAL`, después `EDITOR`; si no hay ninguno, `['notepad']` en `win32` y `['nano']` en el resto, o `['vi']` si `existe('nano')` da false.
- `partirComando` respeta comillas dobles y simples, sin shell: `code --wait` da `['code', '--wait']`, y `"/A B/subl" -w` da `['/A B/subl', '-w']`.
- El archivo se borra en un `finally` salvo en `invalida`. Si después el escritor falla (Task 8: escritura rechazada), la TUI pasa a `invalida`-like con Reopen sobre el mismo archivo, así que el que borra en ese caso es `descartar`.

- [ ] **Step 1: tests que fallan.**
  - `sin cambios no escribe y borra el temporal`.
  - `cambios válidos devuelven la memoria y borran el temporal`.
  - `frontmatter inválido conserva el archivo; reabrir con el editor válido lo resuelve y lo borra`.
  - `el editor que sale con 3 o tira ENOENT borra el temporal`. (Review Focus 1.)
  - `el temporal se crea con modo 0600`: en Unix, chequeado con `statSync(...).mode & 0o777` desde un `lanzar` falso. Con `it.skipIf(process.platform === 'win32')`.
  - `elegirEditor` cubre los cuatro casos y `partirComando` los dos de arriba. (Review Focus 2.)
- [ ] **Step 2:** `npx vitest run electron/__tests__/tui-editor-externo.test.ts` → FAIL.
- [ ] **Step 3:** implementar. "No cambió" se decide comparando el contenido del archivo, no el mtime (hay editores que guardan sin cambios).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(tui): editar memorias con $EDITOR, con temporal 0600 que se borra siempre`.

---

### Task 6: las dos fuentes de datos

**Files:**
- Create: `electron/tui-del-paquete/fuente.ts`: sólo la interfaz y `ErrorDeEscritura`.
- Create: `electron/tui-del-paquete/fuente-del-paquete.ts`
- Create: `electron/tui-del-paquete/fuente-del-daemon.ts`
- Create: `electron/sync-del-paquete-tras-escribir.ts`: sale de `cli-del-paquete.ts:414-428` el closure `alAbrir` de `comandoMcp` (credencial → `armarDaemonDelPaquete` → `SyncDelMcp`), como `alAbrirConSync(base, deps)`, y `comandoMcp` pasa a usarlo.
- Test: `electron/__tests__/tui-fuentes.test.ts`

**Interfaces:**
- Consumes: `DatosDeStatus`, `DatosDeDoctor`, `leerStatusDelPaquete`, `leerDoctorDelPaquete` y `dondeEstaLaBase` (Task 2); `MemoriaEscrita` (Task 4); `DetalleDeMemoria` (Task 3).
- Produces:
  ```ts
  export interface FuenteDeLaTui {
    proyecto(): string                                     // basename de la raíz git del cwd, o del cwd
    recientes(o: { todos: boolean; limite: number }): Promise<ObservationSummary[]>   // memory.context
    buscar(consulta: string, limite: number): Promise<ObservationSummary[]>          // memory.search
    obtener(syncId: string): Promise<DetalleDeMemoria | null>                        // memory.get
    guardar(m: MemoriaEscrita): Promise<void>              // memory.save con source: 'ui'
    actualizar(syncId: string, m: MemoriaEscrita): Promise<void>   // memory.update con title, content, tags y type
    borrar(syncId: string): Promise<void>                  // memory.delete
    status(): Promise<DatosDeStatus>
    doctor(): Promise<DatosDeDoctor>
    cerrar(): void
  }
  export class ErrorDeEscritura extends Error {}           // el mensaje es el motivo que se muestra en la barra
  export function crearFuenteDelPaquete(deps: DependenciasDeFuente): FuenteDeLaTui
  export function crearFuenteDelDaemon(socket: string, token: string, cwd: string): FuenteDeLaTui
  ```
  `DependenciasDeFuente` inyecta `buscarNest(): Promise<DondeHablarle | null>`, `crearDaemon(d) → { call }`, `crearLocal(path) → { call; close }`, la `base` decidida, `existe(path)` y `cwd`, así los tests usan clientes falsos.
- **Fuente del paquete:** lee del daemon si `base.modo === 'daemon'`; si no, del local. Con `base.modo === 'propia' && base.nueva` y la base inexistente, `recientes` y `buscar` devuelven `[]` sin crear el local (Review Focus 4). **Cada escritura vuelve a llamar a `buscarNest()`**: si contesta, va al daemon; si no, al local (creado con `alAbrirConSync` cuando `base.modo === 'propia'`). Si el daemon falla con `ECONNREFUSED`, `ENOENT`, `EPIPE` o "timed out", reintenta una vez con el local (Review Focus 3). Cualquier otro error (candado, base de sólo lectura, un `ok: false` del daemon) se tira como `ErrorDeEscritura` con su mensaje. Un `memory.update` que vuelve con `updated: false` y `reason` `not_found`, `deleted` o `superseded` es un `ErrorDeEscritura('This memory changed elsewhere (<reason>). Your text is kept.')`; con `unchanged` no es error.
- **Fuente del daemon** (la de Nest): sólo `MemoryDaemonClient`. `status()` devuelve `{ modo: 'daemon', filas: [la fila de Nest], resumen: 'Nest owns this memory', … }` y `doctor()` devuelve `filas: [{ ok, 'Nest', 'open — memory goes through it' }]` y `bloqueadas: []`, con una fila `{ nada, 'Blocked', 'see Memory settings in Nest' }`. No importa nada que llegue a `node:sqlite` (lo fija un test en la Task 9).

- [ ] **Step 1: tests que fallan**, con clientes falsos que registran las llamadas:
  - `leer con base propia nueva no crea el local`: `crearLocal` no se llama.
  - `guardar re-busca a Nest: la primera va al local, y la segunda, con Nest vivo, al daemon`.
  - `si el daemon da ECONNREFUSED al guardar, reintenta en el local una sola vez`.
  - `un error de candado del local es ErrorDeEscritura con el mensaje original`.
  - `actualizar sobre una superseded tira ErrorDeEscritura y no reintenta`.
  - `guardar manda source: 'ui', el cwd y los cuatro campos`.
- [ ] **Step 2:** `npx vitest run electron/__tests__/tui-fuentes.test.ts` → FAIL.
- [ ] **Step 3:** implementar. Verificá que `comandoMcp` siga igual corriendo el test del MCP local que ya existe (`npx vitest run electron/__tests__/ -t "mcp"` o el archivo `memory-mcp-local*.test.ts`).
- [ ] **Step 4:** PASS en la nueva suite y en la del MCP.
- [ ] **Step 5:** commit `feat(tui): fuentes de datos del paquete y del daemon; el sync tras escribir sale de comandoMcp`.

---

### Task 7: Ink en el repo y las pantallas

**Files:**
- Modify: `package.json` de la raíz (`ink` en `dependencies` e `ink-testing-library` en `devDependencies`), `packages/nest-memory/package.json` (`ink`, `react` y `engines >=22.12`), `packages/nest-memory/tsconfig.json` y `tsconfig.node.json` (`jsx`, y `*.tsx` en include), `vitest.config.ts` (`electron/__tests__/**/*.test.tsx` en el proyecto `node`).
- Create: `electron/tui-del-paquete/ink.ts`
- Create: `electron/tui-del-paquete/app.tsx` (encabezado, pestañas, barra de teclas y ayuda), `lista.tsx` (Recent y Search), `detalle.tsx`, `status.tsx`, `doctor.tsx`
- Create: `electron/tui-del-paquete/runner.ts`: une el `reducir` con la `FuenteDeLaTui` y ejecuta los `Efecto` (debounce con `setTimeout`/`clearTimeout`). `editar` llama a un callback `suspenderYEditar` que provee la Task 8.
- Test: `electron/__tests__/tui-pantallas.test.tsx`

**Interfaces:**
- Consumes: `reducir`, `estadoInicial`, `segmentosDeContenido` y `columnas` (Task 3); `FuenteDeLaTui` (Task 6).
- Produces:
  ```ts
  // ink.ts
  export type Ink = typeof import('ink')
  export function cargarInk(): Promise<Ink>   // new Function('m', 'return import(m)')('ink'); memoiza
  export function ink(): Ink                 // tira 'Ink not loaded — call cargarInk() first' si no se cargó
  // app.tsx
  export function App(p: { fuente: FuenteDeLaTui; ancho: number; suspenderYEditar: (e: Efecto & { tipo: 'editar' | 'reabrir-editor' }) => Promise<Accion> }): JSX.Element
  ```
  Los componentes toman `Box`, `Text`, `useInput`, `useApp` y `useStdout` de `ink()` al renderizar, nunca con `import ... from 'ink'`: el paquete compila a CommonJS. `import type` sí se puede.
- Dibujo: el del spec §1. El encabezado es `Nest Memory · <proyecto>` a la izquierda y `● <resumen> · <total> items` a la derecha; la barra inferior muestra las teclas de la pantalla actual, o el `aviso` si hay uno. Los colores salen del tipo (`grupoDeTipo` de `estilo-del-paquete.ts`) y con `NO_COLOR` se dibuja sin color. El detalle muestra título, tipo, tags, proyecto, `hace(updatedAt)` y el contenido con scroll; un link resuelto va subrayado y el enfocado, invertido; un hueco va `dimColor` y no se enfoca. Recent vacía dice `No memories yet. Agents save them through the MCP, or press n.`.

- [ ] **Step 1: tests que fallan**, con `ink-testing-library` y una fuente falsa con 3 memorias (`beforeAll(() => cargarInk())`):
  - `Recent dibuja las 3 filas con su tipo y la barra de teclas`: `lastFrame()` contiene `decision`, el título y `n new`.
  - `con 50 columnas no hay fecha; con 39 dice Window too narrow`.
  - `escribir "enc" en Search filtra a los 150 ms`, con `vi.useFakeTimers()`.
  - `⏎ abre el detalle con el contenido completo de memory.get`, no el truncado de `context`.
  - `Status pinta las filas de DatosDeStatus y Doctor pinta lo bloqueado`.
  - `Recent vacía muestra el mensaje de bienvenida`.
- [ ] **Step 2:** `npm install`, después `npx vitest run electron/__tests__/tui-pantallas.test.tsx` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** PASS. Typecheck con los dos comandos de CI, en 0 errores.
- [ ] **Step 5:** commit `feat(tui): pantallas Ink de la TUI de memoria`.

---

### Task 8: `nestmux-memory` sin argumentos abre la TUI

**Files:**
- Create: `electron/tui-del-paquete/arrancar.ts`
- Modify: `electron/argumentos-del-paquete.ts`: nuevo comando `{ comando: 'tui' }`. Sin argumentos devuelve `'tui'`; `--help` y `-h` siguen devolviendo `'ayuda'`.
- Modify: `electron/cli-del-paquete.ts`: `case 'tui'`.
- Modify: `electron/__tests__/paquete-sin-nativas.test.ts`, o un test nuevo junto a él, `paquete-carga-diferida.test.ts`.
- Test: `electron/__tests__/argumentos-del-paquete.test.ts` (actualizar el caso de "sin argumentos") y `electron/__tests__/tui-arrancar.test.ts`.

**Interfaces:**
- Consumes: `App` y `cargarInk` (Task 7); `editarEnEditor`, `reabrirEnEditor`, `descartar` y `elegirEditor` (Task 5); `FuenteDeLaTui` (Task 6).
- Produces:
  ```ts
  export type Decision = 'abrir' | 'ayuda' | 'sin-modo-crudo'
  export function decidirArranque(t: { stdinTTY: boolean; stdoutTTY: boolean; tieneSetRawMode: boolean }): Decision
  export async function arrancarTui(fuente: FuenteDeLaTui, io?: { stdin; stdout; env; plataforma }): Promise<void>
  export function restaurarTerminal(stdout: NodeJS.WriteStream): void   // '\x1b[?1049l' + '\x1b[?25h'; setRawMode(false) si aplica
  ```
- `case 'tui'` en el CLI: `decidirArranque` → `'ayuda'` imprime `textoDeAyuda` como hoy; `'sin-modo-crudo'` imprime `This terminal can't run the interactive view. Use \`nestmux-memory search\` or open Nest.` y sale con 1; `'abrir'` hace `const { arrancarTui } = await import('./tui-del-paquete/arrancar')` con la fuente del paquete.
- `arrancarTui`: entra a la pantalla alternativa (`\x1b[?1049h`) y llama a `render(<App/>)` con `exitOnCtrlC: false` (el `q`/`Ctrl+C` lo maneja el reducer). Registra `restaurarTerminal` en `process.on('exit')`, `SIGINT` y `SIGTERM`. `suspenderYEditar` hace `instance.unmount()` → `restaurarTerminal` → editor (síncrono) → vuelve a entrar → `render` otra vez con el MISMO estado (el estado vive en el runner, fuera de React). Después escribe por la fuente. Si eso tira `ErrorDeEscritura`, el archivo se conserva: se re-serializa la memoria a un temporal y se entra en `errorDeEditor` con Reopen/Discard. `SIGWINCH` re-dibuja (con `useStdout().stdout.columns` y su evento `resize` alcanza).

- [ ] **Step 1: tests que fallan.**
  - `decidirArranque`: las 3 combinaciones.
  - `parsearArgumentos([])` da `{ comando: 'tui' }`.
  - `paquete-carga-diferida`: caminar los imports **estáticos** desde `cli-del-paquete.ts` (el mismo walker de `paquete-sin-nativas`) no llega nunca a `ink` ni a `react`, y sí hay un `import('./tui-del-paquete/arrancar')` en el texto del CLI.
  - `el ida y vuelta con el editor falso`: con `arrancarTui` y stdin/stdout de `ink-testing-library` (o el runner sin Ink), `EDITOR="node <fixture>"` y modo `valido`, `n` → la fuente falsa recibe `guardar` con lo que escribió el editor; con modo `igual`, nada; con modo `invalido`, el frame muestra el error y `Reopen`.
- [ ] **Step 2:** `npx vitest run electron/__tests__/tui-arrancar.test.ts electron/__tests__/argumentos-del-paquete.test.ts electron/__tests__/paquete-carga-diferida.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** PASS. Después, build del paquete y prueba a mano en la Mac (con node@22 de Homebrew, ≥22.12): `node packages/nest-memory/dist/cli-del-paquete.js` abre la TUI; `q` deja la terminal bien; `n` con `EDITOR=nano` crea una memoria que aparece en Recent; `... status` sigue funcionando y `node -e` con `require.cache` confirma que no cargó ink. `echo | node …/cli-del-paquete.js` (sin TTY) imprime la ayuda. Correr también `npx vitest run electron/__tests__/paquete-sin-nativas.test.ts electron/__tests__/paquete-bin-ejecutable.test.ts`.
- [ ] **Step 5:** commit `feat(paquete): nestmux-memory sin argumentos abre la TUI`.

---

### Task 9: el entry de Nest y el pane

**Files:**
- Create: `electron/tui-de-nest.ts`: lee `NEST_MEMORY_SOCKET` y `NEST_MEMORY_TOKEN` (si faltan: `Open this from Nest — the pane didn't get Nest's memory variables.` y salida 1), llama a `decidirArranque` y después `arrancarTui(crearFuenteDelDaemon(…, process.cwd()))`.
- Create: `electron/comando-de-la-tui.ts`
- Modify: `electron.vite.config.ts`: un entry `'memory-tui': resolve(__dirname, 'electron/tui-de-nest.ts')` junto a `memory-mcp`. `ink` queda externo porque está en `dependencies` y `externalizeDepsPlugin` lo deja afuera; igual se carga con el `import()` de `ink.ts`.
- Modify: `src/types.ts`: `export const NEST_MEMORY_TUI_CMD = 'nest-memory-tui'`.
- Modify: `electron/pty-manager.ts`: `PtyMemoryIntegration.tui?: { execPath: string; scriptPath: string }` y el caso del centinela en `create()`.
- Modify: `electron/main.ts`: pasar `tui: { execPath: process.execPath, scriptPath: pathJoin(__dirname, 'memory-tui.js') }` donde arma la integración de memoria (cerca de `main.ts:244`).
- Modify: `docs/superpowers/specs/2026-11-02-tui-de-memory-design.md`: reescribir §5 y el borde de la memoria de equipo según las dos correcciones de arriba.
- Test: `electron/__tests__/comando-de-la-tui.test.ts`, `electron/__tests__/pty-manager-tui.test.ts` (o los casos agregados al test de pty-manager que ya existe) y un caso en `paquete-sin-nativas.test.ts`: desde `tui-de-nest.ts` no se llega a `node:sqlite`, `better-sqlite3` ni `electron`.

**Interfaces:**
- Produces:
  ```ts
  export type FamiliaDeShell = 'posix' | 'powershell' | 'cmd'
  export function familiaDeShell(bin: string): FamiliaDeShell   // basename sin .exe: pwsh|powershell → powershell, cmd → cmd, el resto → posix
  export function comandoDeLaTui(execPath: string, script: string, familia: FamiliaDeShell): string
  ```
  - posix: `ELECTRON_RUN_AS_NODE=1 "<exec>" "<script>"`
  - powershell: `$env:ELECTRON_RUN_AS_NODE='1'; & "<exec>" "<script>"; Remove-Item Env:ELECTRON_RUN_AS_NODE`
  - cmd: `set "ELECTRON_RUN_AS_NODE=1" && "<exec>" "<script>" & set "ELECTRON_RUN_AS_NODE="`

  Las comillas, con `quoteShellArg` (`pty-manager.ts:60`). La variable queda sólo para ese comando: el shell del pane sigue sin `ELECTRON_RUN_AS_NODE`, así que un `code` lanzado después desde ahí no arranca en modo Node.
- `PtyManager.create` con `cmd === NEST_MEMORY_TUI_CMD`: ignora el `shell` que llegue y usa el shell por defecto de la plataforma (WSL no puede correr el `.exe` de Windows con su path). Inyecta sólo `NEST_MEMORY_SOCKET` y `NEST_MEMORY_TOKEN`, y NO entra al bloque de AI/provisioning (no registra `memoryPanes` ni llama a `ensureProvisioned`). `launchCmd = comandoDeLaTui(...)`. Sin `this.memory?.tui`, devuelve `{ ok: false, error: 'Memory is not available in this build' }`.

- [ ] **Step 1: tests que fallan.**
  - `comandoDeLaTui`: los tres formatos exactos con un path que tiene espacios y `"`.
  - `familiaDeShell('C:\\…\\pwsh.exe') === 'powershell'`, `familiaDeShell('/bin/zsh') === 'posix'`.
  - `el centinela inyecta socket y token, no registra memoryPanes y escribe el comando de la TUI`, con node-pty mockeado como en los tests de pty-manager que ya existen.
  - `sin tui en la integración, create devuelve el error`.
  - `tui-de-nest no llega a node:sqlite`.
- [ ] **Step 2:** `npx vitest run electron/__tests__/comando-de-la-tui.test.ts electron/__tests__/pty-manager-tui.test.ts electron/__tests__/paquete-sin-nativas.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** PASS. `npm run build` y verificar que exista `dist-electron/memory-tui.js`; después `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron dist-electron/memory-tui.js` sin variables imprime el mensaje de "Open this from Nest" y sale con 1. Eso prueba que Ink y el entry cargan con el Node 20 de Electron.
- [ ] **Step 5:** commit `feat(nest): entry memory-tui y pane que lo corre con las variables de memoria`.

---

### Task 10: "Open Memory in terminal" en la paleta y en Memories, con e2e

**Files:**
- Modify: `src/components/CommandPalette.tsx`: prop `onMemoryTerminalOpen?: () => void` e ítem `action-memory-tui` en `actions`: label `Open Memory in terminal`, sublabel `Browse and edit memories in a terminal pane`, keywords `memory terminal tui`.
- Modify: `src/components/MemoriesWorkspace.tsx:523` (`tw-header-right`): un botón shadcn `Button` `variant="outline" size="sm"` con el texto `Open Memory in terminal`. Prop `onOpenInTerminal`.
- Modify: `src/App.tsx`: `abrirMemoriaEnTerminal = () => { cerrar el overlay de Memories si está abierto; addPane('terminal', '', '', AI_CONFIG.terminal.color, NEST_MEMORY_TUI_CMD, 'Memory') }`, cableado a los dos.
- Test: `src/__tests__/components/CommandPalette.test.tsx` (el ítem aparece y llama al callback) y `e2e/19-tui-de-memoria.spec.ts`.

- [ ] **Step 1: tests que fallan.**
  - CommandPalette: `muestra Open Memory in terminal y lo ejecuta`.
  - e2e (seguir el armado de `e2e/18-mcp-en-un-panel.spec.ts`: launch con HOME aislado, Memories conectado): lanzar Nest con `EDITOR="node <ruta absoluta a e2e/helpers/editor-falso.mjs>"` en el env, en modo `valido` con título `E2E from the TUI`. Paleta → `Open Memory in terminal` → el pane muestra `Nest Memory` → tecla `n` → el pane muestra `E2E from the TUI` en Recent, y por la API de memoria del renderer (la que usa el resto del e2e de Memories) la memoria existe en el store. Después, `q`: el pane vuelve al prompt del shell.
- [ ] **Step 2:** `npx vitest run src/__tests__/components/CommandPalette.test.tsx` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** PASS en el unit. `npm run build`, después `npx playwright test e2e/19-tui-de-memoria.spec.ts e2e/04-contraste.spec.ts` → PASS (el 04 porque hay cambio de UI). Después `npm run native:electron`.
- [ ] **Step 5:** commit `feat(memories): abrir la TUI de memoria desde la paleta y desde Memories`.

---

### Cierre

- [ ] Suite completa: `npm test` (raíz) y `npm test` en `server/` si alguna task tocó algo de ahí (no debería). Typecheck con los dos comandos de CI.
- [ ] Una vez, `npm run package:mac` y abrir la TUI desde la app empaquetada: confirma que `ink` y su yoga cargan desde el asar con `ELECTRON_RUN_AS_NODE`, cosa que el e2e contra `dist/` no prueba.
- [ ] Apagar todo lo que se levantó (Electron de los e2e, `ps` limpio) y `npm run native:electron`.
