# Orquestación: un agente lanza panes visibles en Nest — diseño

Fecha: 2026-11-12. Origen: brainstorming con Gero el 12-nov
(`docs/HANDOFF-2026-11-12-orquestacion-panes.md`, que tiene el recon completo y el prior art).

Convención de este documento: **[Gero]** = lo decidió él. **[Claude]** = lo propuso Claude, Gero
lo vio en la playback y dijo "dale". **[Claude, builder check]** = lo resolvió Claude después,
sin pasar por Gero; revisarlo al leer.

## 1. Intención

Gero trabaja con un agente en un pane de Nest. Hoy, si quiere repartir trabajo en paralelo, tiene
que abrir él cada pane, elegir repo, crear la rama y pegar la tarea. Lo que pide, en sus palabras:

> "Si yo te digo hagamos tal y tal cosa, que puedas crear terminales y que se vean en Nest, que no
> sean headless y sea por repo." Que se abran "en sus ramas, con etiqueta y color, y cuando
> terminen las tareas que las cierres." La rama "que quede para revisarla yo y que el coordinador
> me avise".

El porqué: **ver** lo que hacen los agentes mientras trabajan, y que nada llegue a main sin que él
lo mire. Es el flujo que ya usa la industria (Orca, T3 Code, Conductor), dentro de Nest.

## 2. Metas

1. Un agente en un pane (Claude o Codex) que recibe "hagamos X, Y y Z" queda como **coordinador**
   y lanza **workers**, uno por tarea. [Gero]
2. Cada worker es un **pane visible en el grid**, en el **mismo tab y mismo repo** que el
   coordinador. [Gero]
3. Cada worker trabaja en **su propia rama + worktree**. [Gero]
4. Cada pane worker lleva **etiqueta** (nombre de la tarea) y **color**. [Gero]
5. Cuando el worker termina, avisa y **Nest cierra su pane solo**. [Gero]
6. La **rama queda** para que Gero la revise; el **coordinador le avisa con un resumen**. [Gero]
7. **Permisos heredados del coordinador**: si el coordinador corre con bypass, los workers
   también; si corre normal, cada worker pide permiso en su propio pane. Nest no inventa un modo
   de permisos propio. [Gero]

## 3. No-metas (por ahora)

- **Remoto**: manejar coordinador/workers desde el teléfono u otra máquina. Proyecto aparte,
  después. [Gero] El diseño no tiene que bloquearlo, pero no se construye nada para eso.
- Anidar: un worker no lanza workers. [Claude]
- Workers en otro tab, otro repo o varios repos a la vez. [Gero: mismo tab, mismo repo]
- Reemplazar o integrar el graph orchestrator F6 / `GraphBoard`. Se reusan piezas, no el modelo.
- Merge automático, resolver conflictos entre ramas de workers, o que el coordinador integre las
  ramas por su cuenta.
- Persistir una orquestación a través de un reinicio de Nest (ver §8.6 para qué pasa entonces).

## 4. Anti-metas (si pasa esto, fracasó aunque funcione)

- **Workers headless o invisibles.** Si un worker corre sin un pane real en el grid que Gero
  pueda mirar y en el que pueda escribir, es un fracaso. Es la diferencia con F6
  (`claude -p … --dangerously-skip-permissions`, visible sólo en `GraphBoard`). [Gero]
- **Algo llega a main sin decisión de Gero.** Ni merge, ni push a main, ni PR mergeado solo. [Claude]
- **Escalar permisos.** Un worker con más permisos que su coordinador (p. ej. bypass cuando el
  coordinador pide permiso). [Gero, por "heredan"]
- **Perder trabajo.** Cerrar el pane o borrar el worktree con cambios sin commitear, o borrar una
  rama que Gero no descartó explícitamente.
- **Interrumpir a Gero con diálogos.** El alta de un worker no pasa por `NewPaneDialog`. [Claude]

## 5. Restricciones

- UI en inglés (etiquetas, mensajes, botones, textos del agente que Nest genere).
- Componente nuevo con shadcn + utilidades Tailwind; nunca clases nuevas en `global.css`. Todo
  cambio de UI pasa `e2e/04-contraste.spec.ts`. Receta: `docs/RECETA-MIGRACION-UI.md`.
- Color = estado, salvo allow-list justificada. **El color por worker entra en la allow-list
  como leyenda categórica**: identifica *qué* worker es (para cruzar el pane con lo que reporta el
  coordinador), no severidad ni estado. Los estados del worker (trabajando / pregunta / bloqueado
  / listo) se marcan con los tokens de estado (`--ok`/`--warn`/`--destructive`), no con el color
  del worker. Agregar la justificación al lado de la paleta en el código, igual que
  `memory-type-legend.ts`.
- Typecheck = los dos `tsc -p … --noEmit --composite false` de CI.
- Límite duro de Nest: 12 panes por tab (`src/types.ts:19`).
- El trabajo sale de `feat/memories-settings` (main no tiene `MemoryIpcServer`).
- Funciona con Claude y con Codex como coordinador y como worker.

## 6. Cómo funciona (lo decidido)

### 6.1 Transporte [Claude]

Orquestación y Memories son **dos features distintas** [Gero]: comparten, a lo sumo, código de
infraestructura, nunca el estado ni el encendido (§6.8). Las acciones se exponen como **tools
MCP** por un shim stdio como el de `electron/memory-mcp/`, sobre un socket local autenticado
como el `MemoryIpcServer` (`electron/memory-ipc-server.ts`). Cada pane de AI recibe su
`paneId` (hoy existe `NEST_MEMORY_PANE`, `pty-manager.ts:257-262`), así que Nest sabe
**qué pane llama** y de ahí resuelve tab, repo, agente y cuenta del coordinador. El agente no
manda esos datos; si los mandara, se ignoran.

**Identidad del pane no falsificable** [Claude, builder check]. Hoy eso no es cierto: el token
del socket es uno solo para todos los panes (`pty-manager.ts:188,258`) y el request
(`memory-mcp/client.ts:68`) no dice quién llama. Con `NEST_MEMORY_PANE` mandado por el shim,
cualquier agente podría hacerse pasar por otro pane y escribir en el PTY de un worker con bypass.
Por eso las acciones de orquestación exigen un **token por pane**, emitido por `PtyManager` al
crear el PTY, revocado al cerrarlo, y que el IPC server mapea a `paneId`. Las acciones `memory.*`
y `hook.*` pueden seguir con el token compartido. Es el primer bloque del plan.

Tools (nombres finales al builder, inspirados en T3 Code `t3_thread_*`):

| Tool | Qué hace |
|---|---|
| launch worker | tarea (texto), etiqueta corta; opcional: agente ("que lo haga Codex"). Crea rama + worktree, abre el pane, le pasa la tarea. Devuelve id del worker. |
| inbox | lee los mensajes pendientes de los workers propios y los marca entregados (§6.9). |
| wait | bloquea hasta el próximo mensaje (timeout corto). Sólo para casos puntuales; el camino normal es el push del §6.9. |
| list | workers del coordinador con estado, rama y último mensaje. |
| read | detalle de un worker: mensajes, rama, commits, diffstat. |
| stop | frena un worker (o todos). |

Y del lado del worker: una tool **report** con `done` / `question` / `blocked` + texto.

Sólo un pane que es coordinador ve las tools de coordinador con efecto; un pane worker que llama
a "launch" recibe un error claro (sin anidar).

### 6.2 Alta del worker [Gero + Claude]

- Sin `NewPaneDialog`. [Claude] Nest arma el `PaneNode` y lo agrega al tab del coordinador por el
  mismo camino que `addPane` (`App.tsx:341`) → `pty:create` → `PtyManager.create`.
- Rama + worktree nuevos por worker, saliendo del **HEAD actual del worktree del coordinador**
  [Claude, builder check]. Reusar `createWorktreeForBot` / `worktree-store.ts`
  (`main.ts:1942`, `main.ts:2031`).
- Mismo agente y misma cuenta (`aiType`, `accountDir`) que el coordinador, salvo que el pedido
  diga otro. [Claude] Si pide otro agente, se usa la cuenta de ese agente que Gero tenga por
  defecto en Nest; si no tiene ninguna, "launch" falla con un mensaje claro. [Claude, builder check]
- La tarea entra por `initialInput` (se escribe al primer output, `TerminalPane.tsx:191-197`),
  envuelta en un preámbulo fijo que le dice al worker: trabajás en esta rama, commiteá antes de
  reportar, reportá con la tool `report`, no hagas merge ni push a main.
- Etiqueta en el header del pane (`customLabel`/`note` ya existen en `PaneNode`) y color de la
  paleta de workers en `borderColor`. Coordinador **neutro**, un color distinto por worker
  activo. [Claude]

### 6.3 Permisos [Gero, mecanismo: Claude, builder check]

"Heredar" = el worker arranca con **el mismo comando que el pane del coordinador**
(`PaneNode.cmd`, que en Nest es el binario pelado, sin flags de permisos) y con la misma cuenta,
o sea la misma config del agente (`settings.json`/`config.toml` de esa cuenta). Nest nunca agrega
ni saca un flag de permisos.

Si el pedido elige otro agente ("que lo haga Codex"), el worker usa la config de esa cuenta tal
como Gero la tiene: es "según tu config" para ese agente. Nest no traduce ni compara niveles de
permisos entre agentes. [Claude, builder check]

Consecuencia que hay que saber: si Gero activa bypass **a mitad de sesión** en el coordinador
(p. ej. shift+tab en Claude), Nest no lo ve y los workers arrancan con el modo de la config, no
con el de ese momento. Elegido así porque la alternativa —que el agente declare su modo— deja que
un coordinador sin bypass lance workers con bypass.

### 6.4 Canal de vuelta [Claude]

Por **mensajes**, no leyendo la pantalla. El worker manda `done` / `question` / `blocked` con
texto. El worker **hace commit antes de `done`**; Nest verifica que el worktree esté limpio antes
de aceptar el `done` y, si no lo está, le devuelve el error al worker para que commitee.

- `done` → Nest marca el worker como listo, **cierra su pane** y el mensaje le llega al
  coordinador por la bandeja (§6.9). El worktree y la rama quedan.
- `question` / `blocked` → el pane **queda abierto y marcado** (estado "needs input" con token de
  estado). Le llega al coordinador. Gero puede contestarle escribiendo en el pane del worker; el
  coordinador también puede contestarle. [Claude, builder check: el coordinador contesta con una
  tool `send` al worker, que Nest escribe en su PTY. Así no hay que leer pantalla.]
- Si el worker queda parado en un **prompt de permiso** de su CLI, nunca llama a `report`. Nest
  lo detecta con `deriveAgentState` (estado del agente, no el contenido de la pantalla), marca el
  pane "needs input" y le manda al coordinador un mensaje sintético `waiting_permission`. Los
  mensajes con contenido siguen saliendo sólo de `report`. [Claude, builder check]
- Si el proceso del worker muere sin `done` (crash, Ctrl+C, Gero cierra el pane), Nest le manda
  al coordinador un mensaje sintético `exited` con el código de salida. El pane cerrado por Gero
  no borra nada.

### 6.5 Límites [Claude]

- Máx **4 workers simultáneos** por coordinador.
- Sin anidar.
- Si el tab llega a **12 panes**, no lanza más y el "launch" devuelve el motivo para que el
  coordinador le avise a Gero.

### 6.6 Frenar [Claude]

Frenar al coordinador (cerrar su pane o que muera) frena a todos sus workers: se matan sus
procesos y se cierran sus panes. **Las ramas y worktrees quedan.** `stop` de un worker hace lo
mismo con ese solo.

### 6.7 Revisión y cierre [Gero + Claude]

- Cuando todos terminaron, el coordinador le escribe a Gero un resumen (qué hizo cada uno, rama,
  commits). [Gero]
- Gero ve el **diff** de cada rama y elige **PR / merge / descartar**. [Claude] El worktree se
  borra recién ahí. Sin decisión de Gero nada llega a main.
- Dónde vive eso: una lista de workers terminados del tab (rama, etiqueta, color, diffstat) con
  las tres acciones. [Claude, builder check] "Merge" mergea en la **rama del coordinador** (la
  rama de donde salió el worker), no en main. "PR" abre un PR contra esa misma rama con lo que
  Nest ya tiene de GitHub (suposición del handoff; el builder confirma que alcanza). "Discard"
  borra worktree y rama, con confirmación.
- Guardas del "Merge" [Claude, builder check]: se bloquea, con el motivo, si el worktree del
  coordinador tiene cambios sin commitear o si el merge da conflicto (se aborta, no se deja a
  medias). Si la rama del coordinador es `main`, el botón dice "Merge into main" explícito y pide
  confirmación: clickearlo es la decisión de Gero.
- Gero también puede decirle al coordinador "mergealo" y el coordinador lo hace con git en su
  propio pane, como hoy: eso ya es decisión de Gero.

### 6.8 Independiente de Memories [Gero]

La orquestación funciona con Memories apagado, desconectado o sin plan. Hoy el socket y el MCP se
inyectan sólo con Memories prendido (`pty-manager.ts:278`, `memory` puede ser `null` en
`main.ts:705`): el canal de orquestación se conecta a **todo pane de agente**, siempre. Puede
reusar la infraestructura del `MemoryIpcServer` (socket, framing, shim MCP) o ser un server
hermano; eso queda al builder, mientras apagar Memories no apague la orquestación ni al revés.
Así lo hacen Orca y T3: cada uno tiene su propio canal.

### 6.9 Cómo se entera el coordinador: push al estilo Orca [Gero]

El coordinador **no** espera en un loop. Lanza los workers y **termina su turno**; Nest lo
despierta. Mecanismo, tomado de Orca (`src/main/runtime/orchestration/mailbox/terminal-pointer/`):

- Cada mensaje de un worker (`done`, `question`, `blocked`, y los sintéticos `exited` /
  `waiting_permission`) entra a una **bandeja** del coordinador, con id estable y estado de
  entrega.
- Nest le escribe al PTY del coordinador un **puntero de una línea**, no el mensaje: p. ej.
  `You have 2 worker messages. Call nest_worker_inbox.` Escribe el texto, y el Enter va
  **por separado ~500 ms después**.
- Sólo entrega si el agente está quieto (o trabajando: Claude y Codex encolan lo que llega a
  mitad de turno), **sin diálogo de permiso abierto** y **sin un borrador de Gero sin enviar** en
  el input. Si no se puede, reintenta más tarde; antes del Enter vuelve a chequear.
- Leer la bandeja marca los mensajes como entregados. No reenvía un puntero si no puede
  verificar que el anterior no llegó (no duplicar).
- El prompt del coordinador le dice, como el de Orca: "no hagas polling ni scripts que esperen;
  terminá el turno, Nest te despierta". `wait` queda para casos puntuales, con timeout corto.
- Cuando termina todo, el coordinador le escribe a Gero el resumen en su pane. El `done` de un
  worker **no** genera notificación de escritorio para Gero (es noticia para el coordinador); sí
  la genera un worker que queda esperando input. [Claude, tomado de Orca]

Riesgo conocido (lo marca Orca): esto depende de una buena señal de "quieto" por pane y de poder
leer la línea del input. El builder verifica primero qué da hoy `deriveAgentState` y el buffer
de xterm, antes de portar.

### 6.10 Cierre del pane [Claude, tomado de Orca]

"Nest cierra el pane solo" con la mecánica de Orca: el `done` aceptado programa el cierre a los
**2 minutos**, con un banner en el pane con la cuenta regresiva y **"Keep open"**. Si el agente
vuelve a trabajar, la cuenta se suspende. Así Gero puede mirar la última pantalla antes de que
desaparezca.

## 7. Prior art que guía los detalles

- **Orca** (`stablyai/orca`, orca.dev/docs/cli/orchestration): workers = panes reales, id de tarea
  clickeable que enfoca el pane, mensajes tipados (`worker_done`, `escalation`, `question`) con
  `check --wait`, stop en cascada. Lo más parecido a esto.
- **T3 Code** (`pingdotgg/t3code`): el set de tools MCP `launch/wait/list/read/send/stop`, worktree
  por thread.
- Lo que **no** tomamos: profundidad 4 de Orca (acá 1), permisos por niveles de T3 (acá heredan),
  "coordinator approvals" de Orca (el coordinador aprueba permisos de workers: acá cada worker
  pide permiso en su pane, como decidió Gero).

### 7.1 Código a portar [Gero: "sacar código de ellos"]

Los dos son MIT. Se porta lo que se pueda en vez de escribirlo de cero, **conservando el aviso
de copyright** (cabecera en cada archivo portado + `THIRD_PARTY_NOTICES`). Clones de referencia:
`stablyai/orca` y `pingdotgg/t3code`.

De **Orca** (TS plano, inyectado por deps; lo más portable):
- `workers/launch/worker-dispatch-preamble.ts` → preámbulo del worker.
- `skill-guides/orchestration.md` → prompt del coordinador.
- `mailbox/terminal-pointer/` (`mailbox-pointer-state.ts`, `-eligibility.ts`, `-delivery.ts`,
  `-stage.ts`, `-submit.ts`) y `mailbox/formatting/message-formatting.ts` → la entrega del §6.9.
- `db/messages/mailbox-pointer-enter-state.ts` + tabla `messages` → estado de entrega (SQL puro).
- `db/worker-terminal/worker-terminal-auto-release.ts`, su scheduler y
  `shared/orchestration/workers/worker-auto-close.ts` → el cierre del §6.10.
- Con más trabajo: `terminal/wait/terminal-wait-settlements.ts` y `claude-open-dialog-hold.ts`
  (detectar diálogo/borrador), `workers/turn-stops/terminal-worker-turn-stops.ts`.
- No: `legacy-*`, `federation/`, `remote-owned`, `structured-*`.

De **T3 Code** (servidor en Effect-TS: se porta el texto y los contratos, no el runtime):
- Descripciones de tools (`apps/server/src/mcp/toolkits/orchestrator/tools.ts`) y schemas
  (`packages/contracts/src/orchestratorMcp.ts`) → traducir a zod para el shim MCP.
- `apps/server/src/mcp/McpSessionRegistry.ts` → modelo del token por pane del §6.1 (32 bytes
  aleatorios, se guarda sólo el hash, revocado al cerrar).
- `evals/mcp-tool-use/cases/orchestration.ndjson` → 42 errores reales de agentes orquestando,
  como checklist de los prompts.
- Para Codex: exponer la tool de espera como tool directa (T3 lo hace por Code Mode).

## 8. Lo que queda al builder

1. Nombres de las tools, forma exacta de los mensajes y del protocolo sobre el socket.
2. Nombre de rama (sugerido: `nest/<etiqueta-slug>-<id corto>`) y dónde van los worktrees (lo que
   ya usa `worktree-store.ts`).
3. Texto del preámbulo que recibe el worker.
4. Paleta de colores de worker (4 colores, distinguibles en tema claro y oscuro, que pasen
   contraste), y cómo se ve el estado "needs input".
5. Ubicación de los panes nuevos en el grid y si el foco se queda en el coordinador (sugerido:
   se queda; lanzar no le roba el foco a Gero).
6. Cómo detectar que un proceso murió (reusar `deriveAgentState`, `pty:data`/exit de F6).
7. Cómo exponer el estado de coordinación al renderer (store nuevo vs. extender el de tabs).
8. Reinicio de Nest con workers vivos: los procesos mueren como cualquier pane; los worktrees y
   ramas quedan y aparecen en la lista de revisión al volver si se pueden reconstruir del
   worktree-store. No hace falta retomar la orquestación.
9. Tests: unit del protocolo en el IPC server, y un e2e que lance un worker con un CLI falso,
   reciba `done` y verifique que el pane se cerró y la rama quedó.
