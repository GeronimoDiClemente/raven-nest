# Memories — que se entienda qué es y qué guardó

**Problema:** hoy la pantalla de Memories no muestra ni una sola memoria.

Lo que ocupa el espacio es diagnóstico técnico: arriba una fila de estado de sincronización
con badges rojos (`4 sessions not writing`, `4 terminals not writing to memory` seguido de
IDs como `PANE-3-1789095333962`), abajo la configuración del Memory Vault con un path
absoluto, dos botones del ancho completo y dos checkboxes que dicen *"Include superseded
(historical) versions"*. Lo único accionable —"Link a repo"— flota en el medio del vacío.

Es el panel de control de la máquina, no el producto. El usuario, mirándola: *"no se
entiende nada"*, *"no puede ser tan básico"*.

Y hay una capacidad entera construida que es **invisible**: el MCP de memoria ya expone
cuatro herramientas, o sea que los agentes ya leen y escriben ahí — y nada en la UI lo
dice.

**Referencias:** Obsidian para el grafo; Engram
(`github.com/Gentleman-Programming/engram`, ver `docs/nest-memory-architecture.md:27`)
para la superficie MCP, de la que este proyecto ya tomó conceptos.

---

## Decisiones ya tomadas (del usuario, 2026-09-11)

No se revisitan durante la implementación:

1. **Las memorias se muestran todas juntas**, de todos los proyectos — no siempre dentro
   del contexto de un repo.
2. **El grafo es 3D.**
3. **El grafo vive en un cuadro de tamaño acotado que no se come la pantalla** — como el
   panel local de Obsidian. Hoy ocupa demasiado y es "0 intuitiva".
4. **Las dos herramientas MCP que faltan del contrato entran en la misma pasada.**

---

## Qué hay hoy (verificado)

- `MemoriesWorkspace.tsx` (134 líneas) monta: `MemoriesStatusRow`, `MemoryVaultCard`,
  `ShareProjectCard` y `TeamThreadPanel`.
- El grafo que se ve es `TeamThreadGraph` — **de ramas de git**, no de memorias.
- `electron/memory-graph.ts` (commits `1c7b948`, `4440f0f`) ya tiene
  `buildMemoryGraph(db, query)` con cuatro tipos de arista (`revision`, `topic`, `branch`,
  `similar`) y su puente IPC en `window.memory.graph()`.
- `memory-store.ts` tiene `search(projectKey, …)`, `context(projectKey, …)`,
  `get(syncId)`, `listProjects()`, `count()`, `memoryGraph(query)`.
  **Todos los de lectura toman `projectKey`** salvo `get` y `count`.
- El MCP (`electron/memory-mcp/tools.ts`) expone hoy: `memory_save`, `memory_search`,
  `memory_context`, `memory_promote`.

## Restricciones del proyecto

- Tailwind SIN preflight; nunca importar `"tailwindcss"` entero.
- Los tokens viven en `global.css`; `@theme inline` los expone. Una sola fuente de verdad.
- El acento es acromático: **el color es estado** (`--ok`/`--warn`/`--destructive`), nunca
  marca.
- Un componente nuevo se escribe con shadcn + utilidades, nunca con clases nuevas en
  `global.css`.
- Todo cambio de UI pasa `e2e/04-contraste.spec.ts`.
- Los estilos inline y el CSS sin capa le ganan a cualquier utilidad de Tailwind.
- Escala de filas vigente: 32 / 28 / 24 px. La pantalla no inventa una propia.

---

## Solución

### 1. La pantalla muestra memorias

Lo primero y lo que ocupa el espacio principal es **la lista de lo que se guardó**, de
todos los proyectos, lo más reciente primero.

Cada fila dice, en una línea: **el título**, y como metadatos secundarios **de qué
proyecto**, **qué agente la escribió** y **cuándo**. El tipo (`decision`, `bugfix`,
`architecture`, `discovery`, `pattern`, `config`, `preference`) se distingue sin leer —
son siete valores fijos, así que califican como leyenda categórica, la excepción
justificada a la regla del color.

El agente se muestra con su logo (`AILogos.tsx`), que es lo que hace visible de un vistazo
que esto lo escribieron las IAs y no un humano.

Hay **búsqueda**. Es la acción principal de esta pantalla: la memoria sirve cuando
encontrás lo que sabés que está.

### 2. El diagnóstico se corre a una línea

El estado de sincronización, el vault y los errores dejan de ser bloques y pasan a **una
fila discreta** que sólo llama la atención cuando algo está roto de verdad.

Dos correcciones concretas a lo que hoy grita:

- **Los pane-ids se van.** `PANE-3-1789095333962` es un timestamp en milisegundos: no le
  dice a nadie cuál de sus terminales cerrar, que es exactamente lo que el comentario del
  componente dice que quiere lograr. Se reemplazan por el número de pane y la CLI que
  corre adentro, que es lo único accionable.
- **La configuración del vault sale de la vista principal.** Un path absoluto y dos
  checkboxes de opciones históricas son ajustes de una sola vez, no información diaria.

### 3. El grafo: 3D, acotado

Vive en **un cuadro de tamaño fijo**, no a pantalla completa ni expandiéndose con el
contenido. Es una vista de la lista, no su reemplazo: seleccionar una memoria en la lista
la resalta en el grafo y viceversa.

Los cuatro tipos de arista **se distinguen visualmente**, y esto no es decoración:
`revision` es dirigida (el linaje de una idea), `topic` y `branch` son agrupamientos, y
`similar` es **inferencia, no un hecho afirmado**. Mezclar las cuatro en la misma línea
gris es lo que hace que un grafo se vea rico y no signifique nada. `similar` además va
detrás de un toggle, apagada por default, como ya está en la capa de datos.

**La dependencia de render 3D: medida y decidida (2026-09-11).**

El proyecto no tenía ninguna (ni three.js ni d3); el grafo actual usa una simulación propia
en SVG. La decisión se tomó **midiendo**, con cuatro builds de Vite aislados sobre una misma
base de React 18.3.1, midiendo el costo *marginal* sobre esa base:

| Opción | En el arranque | Diferido al abrir el grafo |
|---|---|---|
| `react-force-graph-3d` importado arriba | +1379.8 KB crudos / +368.3 gzip | — |
| `3d-force-graph` (vanilla, sin wrapper) | +1371.9 KB crudos / +366.0 gzip | — |
| `three` a mano + `d3-force-3d` | +534.6 KB crudos / +134.6 gzip | — |
| **`react-force-graph-3d` con `import()` diferido** | **+1.4 KB crudos / +0.7 gzip** | 1376.6 KB crudos / 367.3 gzip |

El chunk que la app carga hoy al arrancar es de **3190.3 KB crudos / 642.3 KB gzip** de JS
(más 319.9 / 45.2 de CSS). O sea que la última fila cuesta **0.04% del arranque**.

**Decisión: `react-force-graph-3d`, detrás de un `import()` diferido y memoizado**, con el
mismo patrón que ya usa Monaco en `EditorPane.tsx:35` (`monacoSetupPromise ??= import(…)`).

Tres cosas que el número de gzip esconde y que pesan más que él:

1. **Esto es Electron, cargando de disco local.** El gzip —el número que todo el mundo
   cita— es el menos relevante de los tres: no hay red. Lo que se paga es parsear y evaluar,
   y el `import()` lo saca del arranque por completo. Es exactamente lo que la app ya hace
   con Monaco, cuyo chunk de 7.3 MB no está en `index.html`.
2. **Entre las dos opciones diferidas, la diferencia son 842 KB que se pagan una vez**, de
   disco, la primera vez que alguien abre el grafo. Lo que compran esos 842 KB es no
   escribir a mano los controles de cámara, el *picking* por raycast (que es lo que hace
   funcionar "seleccionar una memoria la resalta en el grafo"), las etiquetas y el estilo
   por tipo de arista. El ahorro en KB se paga en código propio que hay que mantener.
3. **Su peer de React es `*`** — no cae en la trampa de los primitivos de React 19 que ya
   nos mordió (ver `docs/RECETA-MIGRACION-UI.md`). Y `width`/`height` son props explícitas,
   que es literalmente el requisito del cuadro acotado.

**El riesgo a cubrir:** 1.37 MB de parseo la primera vez que se monta el grafo se sienten.
La mitigación es disparar el `import()` **al abrir Memories**, no al montar el grafo, para
que la descarga ocurra mientras el usuario mira la lista.

### 4. Completar el contrato MCP

La arquitectura (`docs/nest-memory-architecture.md:101`) especifica seis herramientas y
hay cuatro. Se agregan las dos que faltan:

- **`memory_get`** — traer una memoria por su id. El store **ya tiene** `get(syncId)`:
  es exponerlo.
- **`memory_update`** — modificar una memoria existente. Hoy la única vía es `memory_save`
  con el mismo `topic_key`, que reemplaza vía merge; eso funciona para temas que
  evolucionan pero **no** para corregir una memoria puntual sin `topic_key`.

Además, `memory_promote` quedó con otro nombre que el documentado
(`memory_suggest_promotion`). **Se alinea el documento al código, no al revés**: el nombre
`memory_promote` ya está en uso por agentes reales y renombrarlo rompe lo que funciona.

### 5. Que la capacidad deje de ser invisible

La pantalla dice, en una línea y sin jerga, que **tus agentes leen y escriben acá solos**.
No un tutorial: una frase y, cuando una memoria fue escrita por un agente, su logo en la
fila — que es la prueba.

---

## Datos que hay que construir

**Una consulta de listado cross-project.** Es lo único que la capa de datos no tiene: todos
los métodos de lectura del store toman `projectKey`, y la decisión 1 pide todos los
proyectos juntos. Va en `memory-store.ts` junto a los otros, con su puente IPC siguiendo el
patrón de `hubStats` (main, preload, tipo espejado a mano en `src/types.ts` — `src/` no
importa de `electron/`).

Requisitos de esa consulta:
- Ordena por `updated_at DESC`.
- Pagina (la lista puede tener miles de filas; no se traen todas).
- Excluye `deleted = 1` siempre, y las reemplazadas (`superseded_by` no nulo) salvo que se
  pidan explícitamente — igual que `buildMemoryGraph`.
- Devuelve el `project_key` de cada fila, porque ahora la lista es de todos y hay que poder
  decir de cuál viene.
- La búsqueda usa la tabla FTS5 `observations_fts` que ya existe, no un `LIKE`.

## Manejo de errores

- Lista vacía **con** memorias en otros lados no existe: la lista es global, así que vacía
  significa vacía de verdad. El estado vacío dice qué hacer para que se llene: los agentes
  guardan solos cuando la memoria está activa en ese pane.
- Un `aiType` sin logo conocido no renderiza ícono: `AILogo` (`AILogos.tsx:218`) devuelve
  `null`, no hay genérico.
- Si la consulta falla, la lista muestra el error; **no se cae la pantalla entera** ni se
  muestra una lista vacía mentirosa.
- El grafo con cero nodos no dibuja un cuadro vacío: no se monta.

## Testing

- `e2e/04-contraste.spec.ts` es el gate.
- Tests de la consulta cross-project con SQLite en memoria, siguiendo
  `electron/__tests__/memory-graph.test.ts`: orden, paginado, exclusión de borradas y
  reemplazadas, y que devuelve el `project_key` correcto con filas de varios proyectos.
- Tests de las dos tools MCP nuevas contra un store en memoria.
- Capturas antes/después de la pantalla, en
  `.superpowers/sdd/<plan>/shots/` — que **ya no está gitignoreado** (commit `6d487d6`).

## Fuera de alcance

- La cáscara compartida de los tres workspaces: es su propia spec
  (`2026-09-10-workspace-shell-design.md`) y va antes.
- El grafo de **ramas** (`TeamThreadGraph`, `team-thread-graph.ts`). Es otro grafo y sigue
  existiendo.
- Sync a la nube, cifrado y todo lo que cobra el plan Cloud.
- Eliminar los overlays (anotado en la spec de la cáscara; es reestructurar la app).
