# Nest — propuestas de Codex, entrega ampliada

Abrir **[index.html](index.html)**: 17 direcciones, cada una con una pantalla, motivo y riesgo. HTML offline, Geist/Geist Mono locales y logos reales del repo. Todas las acciones de producto son muestras deshabilitadas; funcionan los enlaces de revisión y las notas desplegables.

**Lectura de producto:** [PRODUCT-NOTES.md](PRODUCT-NOTES.md). Contiene el problema de cada idea, qué ya existe, qué falta, riesgos, dependencias, orden recomendado y comparación con fuentes oficiales de Warp, Cursor, Ghostty e iTerm2.

## Recomendación

**A1 + H1 + S1** para orientarse. **M2 + M5** para encontrar una decisión y diagnosticar Memories sin salir del trabajo. Después **M1 + M4**: recibos por sesión y continuidad por rama. M3/M6 dependen de esos recibos; W1/W2 exploran evidencia de resultados y coordinación sobre un checkout compartido.

No apilar todos los paneles. Un único dock contextual, una palette a demanda y una línea de salud. El diferencial potencial es procedencia y continuidad entre agentes, no la apariencia de una tarjeta ni el hecho de tener memoria.

## Pantallas

| ID | Pantalla local | Por qué | Riesgo |
|---|---|---|---|
| A1 | [Attention rail](attention-rail.html) | A persistent summary keeps the terminal grid visible and gives attention a predictable home. | Counts omit the question itself; opening a pane still costs a context switch. |
| A2 | [Attention palette](attention-palette.html) | Search and keyboard selection make occasional triage fast without occupying the workspace. | Hidden until invoked; new users may miss agents waiting for input. |
| A3 | [Triage stack](attention-stack.html) | Persistent task previews let you choose the next interruption before entering its terminal. | The extra column reduces terminal width, especially with twelve panes. |
| H1 | [Compact identity](header-compact.html) | A stable pane number and compact context line identify the task without enlarging the 32px header. | Long task and branch names compete for the same horizontal space. |
| H2 | [Task first](header-task.html) | A task-first context strip makes task and branch legible while the native header stays 32px. | The separate 42px context strip consumes more terminal height. |
| H3 | [Fixed identity dock](header-zones.html) | Fixed pane numbers connect a dense grid to one shared identity dock for the selected pane. | Unselected task details are hidden until focus changes. |
| S1 | [Workspace tree](sidebar-tree.html) | Repository and worktree ownership stay explicit as agents change state. | Deep nesting truncates names; collapsed branches can hide waiting panes. |
| S2 | [Triage groups](sidebar-state.html) | Grouping by needs-you, unread and working turns navigation into a work queue. | Rows move when state changes, weakening spatial memory. |
| S3 | [Agent roster](sidebar-agent.html) | Agent groups suit workflows where each assistant has a known role. | Repository ownership is weaker and urgent work can be buried in another agent group. |
| M1 | [Context receipt](memory-receipt.html) | See the exact decisions retrieved and saved by this session, with source and version. | A retrieved memory does not prove the agent applied it. |
| M2 | [Recall in place](memory-recall.html) | Find and prepare a decision for one agent without leaving the terminal grid. | Wrong target pane or excessive context can undo the benefit. |
| M3 | [Decision beside the question](memory-decision.html) | Answer a repeated question with the current decision and its reason. | A similar question may require a different decision on this branch. |
| M4 | [Branch brief](memory-branch.html) | Read what teammates learned on this branch before taking the next step. | Private notes must never enter a team brief by implication. |
| M5 | [Memory health](memory-health.html) | Distinguish local memory, session bridge and cloud sync without visiting Settings. | A green session bridge cannot certify memory reads or writes. |
| M6 | [First real reuse](memory-first-reuse.html) | Show the first cross-agent retrieval of an actual project decision. | Demo activity or a retrieval must not masquerade as verified application. |
| W1 | [Result with evidence](workspace-evidence.html) | Separate a quiet agent from a change that is ready for review. | Test results become stale as soon as the checked files change. |
| W2 | [Shared worktree awareness](workspace-ownership.html) | Expose two agents editing the same checkout before people overwrite each other. | Being in the same checkout is only a risk signal, not proof of a file conflict. |

## Corrección visual solicitada

Se conservaron las nueve ideas anteriores y se reconstruyó su shell usando la captura real en [ref/nest-pane-real.png](ref/nest-pane-real.png) y las medidas del brief. Terminal negro puro, app #0a0a0a, sidebar #141414; borde de pane 1.5px al 55%, radio 4px, glow al 38%; todos los headers de 32px con fondo al 10% y divisor al 27%; controles de 20px, logo de 14px, punto de 10px y nombre uppercase 11px. Estados amarillo/verde según el pedido y working gris; tabs con subrayado de 3px y RAM. Sidebar 200px, rail 44px y filas de 32px. Logos reales presentados monocromáticos para respetar el acento acromático.

H2 ya **no** tiene header de 48px: mantiene 32px y agrega una tira de contexto independiente de 42px. H1 usa tira compacta de 28px; H3 centraliza la tarea/rama en un dock de selección para ganar densidad. La barra superior de revisión y las notas son del entregable, no del producto.

El código actual de PaneHeader ya retiró algunos controles persistentes que aparecen en la captura. Para esta comparación se siguió la anatomía explícita del brief (capas, copiar, descargar, compartir, maximizar, cerrar); no se propone reintroducirlos en producción sin evaluar su uso.

## Superdesign y procedencia

[Canvas con las 17 pantallas](https://superdesign.dev/teams/5c845e5a-51b2-4840-ba0c-2bf218ff0336/projects/5eb42c61-2309-4070-81c2-2657f6203e01). Los nueve borradores existentes se actualizaron; los ocho nuevos se importaron como HTML propio. Las referencias remotas y versiones están en [directions.json](directions.json); los resultados de importación en [canvas-imports.json](canvas-imports.json).

La generación de la ampliación con gpt-5.6-luna fue rechazada dos veces por **Team has insufficient credits**. Se completó mediante la ruta de autoría propia/importación del CLI, que sí funcionó sin créditos. No hay login pendiente ni compra necesaria. No se atribuyen las pantallas nuevas a una generación remota que no ocurrió. No se inventó identificador de modelo para la autoría del HTML.

Los originales de la primera corrida permanecen en superdesign-originals/. Las copias actuales fueron normalizadas sobre un shell común en render.cjs; la versión para canvas lleva fuentes y logos embebidos en canvas-html/. La versión local no necesita CDN. En el canvas, los enlaces de revisión son placeholders: navegar entre direcciones desde los nodos o usar la galería local.

Se usó el flujo de [Superdesign](https://superdesign.dev/) y corrección determinista; no se inició otra ronda de imágenes con 12ui ni se escribió inicialización fuera de la carpeta autorizada.

## Validación y reproducción

Ejecutar desde el repo:

```sh
node design/codex/render.cjs
node design/codex/gallery.cjs
node design/codex/verify.cjs
```

El render es el build de estos artefactos. prepare.cjs y bake.cjs pertenecen a la primera ronda y **no** son el pipeline vigente. No ejecutar generate-expansion.cjs para reconstruir: llama al servicio remoto. import-canvas.cjs publica versiones y tampoco hace falta para ver o reconstruir localmente.

QA proporcional sobre el tema oscuro pedido explícitamente: 18 páginas (galería + 17 pantallas), fuentes y logos locales, enlaces, carga sin red, sin errores JS ni overflow del documento a 1440 × 960; medidas de headers y sidebar y fondo negro de panes. [Resultados](verification.json). Capturas: [header](review-header.png), [Memories](review-memory.png) y [galería](review-gallery.png). La revisión visual fue local; la importación remota y su contenido se verifican por CLI, sin afirmar QA visual del renderer remoto. No es una matriz de accesibilidad ni una aplicación integrada.

No se ejecutó el build de Electron: este trabajo sólo produce diseño y ese build escribiría fuera del directorio autorizado. Sin cambios en src/, electron/, package.json, rama, commits o push; sin cerrar Nest ni matar procesos. Rama confirmada: feat/memories-settings. El working tree compartido tenía otros directorios sin seguimiento que no se tocaron.

Estado para la otra sesión: [PARA-CLAUDE.md](PARA-CLAUDE.md). **Conviene hacer clear** al cerrar esta tarea y abrir otro hilo para la implementación elegida.

## Segunda pasada de piel — 30/10

Se volvió a comparar con la captura real tras el nuevo pedido de Gero. Terminal en Geist Mono de 13px, prompts en banda gris #262626 y preguntas como salida de terminal, sin tarjetas decorativas. Los chips de estado ahora están dentro del header teñido de 32px. Se quitaron las tiras de identidad adicionales de A1–A3, S1–S3, M1–M6 y W1–W2; sólo H1/H2 conservan su contexto adicional como parte de la idea explorada. Chips de puertos redondeados, pestañas más legibles y espacios entre panes de 8px. Se preservaron todas las ideas y se actualizaron los mismos nodos del canvas.

Ronda 3 ya entregada por separado: [cinco estudios animados](delight/index.html), con costos y validación en [delight/README.md](delight/README.md).

Última verificación remota de esta corrección: 17 importaciones correctas y 16 relecturas comprobadas. La relectura de W1 agotó 30 segundos dos veces; su importación fue confirmada, pero no se afirma verificación posterior de contenido remoto. W1 local pasó el QA junto a las otras pantallas.

## Ronda 3 — cinco momentos animados

[Galería interactiva](delight/index.html): working, needs you, unread, recibo de memoria y llegada de pane. Sólo transform/opacity sobre indicadores pequeños, pausa al ocultar, sin timers en movimiento reducido, replay y repetición opcional. Recomiendo D2 + D3; D4 cuando existan eventos atribuibles. Se reutilizó la piel de Superdesign con comportamiento escrito localmente, sin otra generación ni créditos. [Detalles y costos](delight/README.md). Seis páginas verificadas offline, movimiento efectivo y gates de visibilidad/preferencia. No son mediciones de consumo real ni integración Electron.
