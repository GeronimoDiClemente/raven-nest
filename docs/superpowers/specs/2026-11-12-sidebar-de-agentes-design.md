# Sidebar de agentes: estado por agente, subagentes nativos y avisos — diseño

Fecha: 2026-11-12. Rama: `feat/orquestacion-panes` (sigue a
`docs/superpowers/specs/2026-11-12-orquestacion-panes-design.md`). Origen: brainstorming con Gero el
12-nov, con investigación de Orca y T3 Code y pruebas con Claude y Codex reales.

Convención: **[Gero]** = lo decidió él. **[Claude]** = propuesta de Claude que Gero vio en las
maquetas y aprobó. **[Claude, builder check]** = decisión de Claude sin pasar por Gero; revisarla.

Maquetas (abrir en el navegador): `.superpowers/brainstorm/97570-1794526483/content/` del worktree
— `sidebar-layout.html` (opciones A/B/C), `sidebar-motion.html` (la B animada, la aprobada) y
`decisions.html` (resumen de decisiones y tabla por CLI).

## 1. Intención

Gero corre varios agentes a la vez: un coordinador, sus workers y los subagentes que cada CLI
lanza por su cuenta. Hoy, para saber quién trabaja, quién lo espera y quién terminó, tiene que
mirar pane por pane. Lo que pidió:

> "No cumple ni de lejos T3 y Orca aún." "Tiene que ser útil, no una feature que no se invoque
> salvo una palabra específica." "Tiene que funcionar para cualquier CLI, como Memories y como
> promete Nest en sí."

Y sobre lo que viene después: Bauti va a armar la app de teléfono sobre esta rama, estilo Orca,
pero que pueda "tomar decisión o seguir laburando como la app de T3", o sea **actuar**, no sólo
mirar. [Gero]

El porqué: ver de un vistazo el estado de todos los agentes, enterarse sin mirar cuando uno lo
necesita, y que el mismo dato sirva mañana para el teléfono.

## 2. Metas

1. **Sidebar en árbol** (opción B): bajo cada worktree, sus panes de agente; bajo cada
   coordinador, sus workers; bajo cada agente, sus subagentes nativos. [Gero]
2. **Estado por agente**: trabajando / te necesita (permiso o pregunta) / terminó sin leer /
   quieto / falló o salió. El padre muestra el peor estado de sus hijos; plegado muestra `+N`;
   negrita = no leído. [Gero, sobre la maqueta]
3. **Cualquier CLI**: los CLIs con hooks dan estado exacto; el resto tiene una fila genérica
   (actividad de salida, aviso de terminal OSC 9/BEL, fin del proceso). [Gero]
4. **Subagentes nativos** como filas de sólo lectura bajo su agente: tipo, descripción corta,
   estado, duración. Click = ir al pane padre. [Gero]
5. **Aviso de escritorio** cuando un agente te necesita y cuando un agente o un grupo de workers
   termina, si la ventana de Nest no tiene foco. [Gero]
6. **Un solo modelo de estado en el proceso main**, que lee la sidebar hoy y la app de teléfono
   después; ese modelo expone también las acciones (contestar, mandar texto, mergear, descartar,
   abrir PR) para que el teléfono pueda actuar. [Gero]
7. **Workers con cualquier CLI que tenga MCP**, ya en esta etapa: gemini, qwen y opencode además
   de claude y codex. [Gero: "ahora"]

Ya hecho en esta rama: el coordinador decide solo cuándo lanzar workers (a27778c5) y la tarea
del worker espera a que el agente escuche (9156c642).

## 3. No-metas

- **El transporte al teléfono** (servidor remoto, emparejar, auth del celular). Lo arma Bauti. Acá
  sólo queda la API del modelo de estado y de las acciones lista para que la consuma. [Claude]
- Reemplazar los indicadores que ya existen en el header del pane (`WorkerPaneBadge`, el estado
  `waiting` de `src/lib/pane-state.ts`). Pueden migrar después al modelo nuevo. [Claude, builder check]
- Hooks de opencode (son un plugin JS): opencode va con la fila genérica. [Claude]
- Sonidos, badge en el dock, historial de eventos.
- Abrir un pane para un subagente nativo: vive adentro de su agente. [Gero]

## 4. Anti-metas

- **Una feature que sólo aparece con una palabra mágica.** El árbol y los estados se ven siempre,
  con o sin orquestación. [Gero]
- **Romper o cambiar la config del usuario.** Nada en `~/.claude*`, `~/.codex` ni en los
  `settings.json` reales de las cuentas; todo va en archivos que Nest ya posee (los de Memories) o
  en fusiones quirúrgicas marcadas, como hace Memories con gemini/qwen.
- **Agregar o quitar un flag de permisos.** Incluye `--dangerously-bypass-hook-trust` de Codex:
  hoy sólo lo pone Memories cuando está prendido; esta feature no lo suma donde no estaba (§6.3).
- **Un estado que miente.** Mejor "quieto" que un "trabajando" pegado. Si los hooks dejan de
  llegar, el estado vuelve a lo genérico (§6.4).
- **Animaciones que gastan batería en reposo.** Sólo CSS, sin rAF ni librería (ver
  `memory/browsercell-raf-permanente`, el bug de 63 frames por segundo al vacío).
- **Notificaciones que molestan**: nada con la ventana enfocada, una sola por transición.

## 5. Restricciones

- UI en inglés. shadcn + utilidades Tailwind; **ninguna clase nueva en `global.css`**; los
  keyframes van en `src/styles/tailwind.css`. Pasa `e2e/04-contraste.spec.ts`.
- Color = estado (`--ok`/`--warn`/`--destructive`); el color de worker sigue en la allow-list
  categórica que ya existe (`src/lib/worker-palette.ts`).
- Typecheck: los dos `tsc -p … --noEmit --composite false` de CI.
- Windows: el canal de hooks usa el mismo wrapper `.cmd`/`.sh` y named pipe que Memories y
  orquestación.
- Los hooks nunca rompen el CLI: salen con 0 siempre y con timeout corto (5 s, en Qwen 5000 ms).

## 6. Cómo funciona

### 6.1 Flujo [Claude]

```
CLI con hooks  ─┐  (hook → shim → socket con token por pane)
                ├─► AgentStatusStore (main) ─► sidebar (snapshot + changed)
PTY de cualquier CLI ─┘  (actividad, OSC 9/777, BEL, exit)       └─► app de teléfono (después)
```

### 6.2 El canal de los hooks [Claude, builder check]

- Los hooks de estado llaman al **shim de orquestación** (`electron/orchestration-mcp/`), con un
  subcomando `hook <evento>`, que lee el JSON del hook por stdin y lo manda como
  `status.event` al `OrchestrationIpcServer` con `NEST_ORCH_TOKEN`. Ese token ya existe **por
  pane** para todo pane de agente (`pane-tokens.ts`), así que el `paneId` sale del token y no se
  puede falsificar. No se usa el socket de Memories: su token es compartido y sus hooks no saben
  qué pane llama.
- El shim reenvía sólo lo que el modelo usa (nombre del evento, `notification_type`/`matcher`,
  `agent_id`, `agent_type`, descripción corta del subagente, `background_tasks`, el
  `<task-id>` de un `<task-notification>`, `tool_name`); nunca el prompt ni la salida de tools.
- Orquestación y estado comparten el socket, pero el estado **no depende de que haya
  orquestación**: el registro de tokens y el `OrchestrationIpcServer` se inicializan aparte del
  servicio de orquestación, y si la orquestación falla al arrancar el canal de estado igual
  existe. Si el que falla es el socket, todos los panes quedan en genérico y el hook sale con 0.
  [Claude, builder check]

### 6.3 Qué hooks se instalan por CLI [Gero: cualquier CLI; mecanismo: Claude, builder check]

| CLI | Dónde | Eventos de estado | Probado el 12-nov |
|---|---|---|---|
| claude | el mismo `{accountDir}/.nest/memory-settings.json` que Memories pasa con `--settings`, que pasa a armarse aunque Memories esté apagado (sin los hooks de memoria) | SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Notification, SubagentStart, SubagentStop, Stop, SessionEnd | sí: se SUMAN a los hooks del proyecto; Subagent* con id y tipo |
| codex | `config.toml` del `CODEX_HOME` propio de Memories | los mismos + PermissionRequest | sí, con `--dangerously-bypass-hook-trust` |
| gemini | `{accountDir}/gemini/.gemini/settings.json`, fusión marcada como hace Memories | los que gemini tenga (BeforeAgent/AfterAgent, Notification…) | no (no hay cuenta logueada) |
| qwen | `{accountDir}/.qwen/settings.json`, fusión marcada | los de Claude que qwen soporte | no |
| resto | — | fila genérica | — |

- **Claude**: los hooks de estado van en un archivo propio, fuera de `{accountDir}/.nest/`
  (porque apagar Memories borra ese directorio entero, `memory-provisioner.ts:205`), y se
  regenera en cada arranque del pane. Primera tarea del plan: probar si Claude acepta dos
  `--settings` y los suma. Si sí, se pasan los dos archivos; si no, el archivo de estado se arma
  en cada arranque con los hooks de estado **más** los de memoria cuando Memories está prendido, y
  se pasa sólo ese. [Claude, builder check]
- **Codex sólo tiene hooks de estado donde Memories ya armó su `CODEX_HOME`** (y por lo tanto ya
  pasa el flag de confianza). Con Memories apagado, Codex queda con la fila genérica. Motivo:
  prenderle a todo Codex un `CODEX_HOME` propio y el bypass de confianza de hooks es un cambio de
  seguridad (correría hooks que traiga un repo clonado) y además ese `CODEX_HOME` hoy no tiene
  `auth.json` (posible problema de Memories, sin verificar). **Pregunta abierta para Gero (§9).**
- **Gemini y Qwen**: se instalan, pero hasta verificarlos con una cuenta real el modelo los trata
  como "sin confirmar": si en la primera sesión no llega ningún evento, el pane queda en genérico.

### 6.4 El modelo de estado [Claude]

Un `AgentStatusStore` en main, por `paneId`:

- `state`: `working` | `needs_you` | `idle` | `exited` | `failed`, con `reason` para `needs_you`
  (`permission` | `question` | `attention`) y `since`.
- `unread`: el agente terminó un turno (`Stop`, o `working → idle` en genérico) sin que el pane
  tuviera foco. Se limpia al enfocar el pane.
- `source`: `hooks` | `generic`. Pasa a `hooks` con el primer evento de hook. Si con `source:
  hooks` el pane queda en `working` y no llega ningún evento ni salida durante 10 minutos, vuelve a
  `idle`.
- `subagents`: `{id, type, description, state: running|done, startedAt, endedAt}`. Un `done` se
  quita 60 s después de terminar. [Claude, builder check]
- Datos del pane para armar el árbol: `aiType`, `cwd`. El tab y el worktree los cruza el
  renderer con su `PaneNode.repoPath` (main no conoce los tabs).

Mapeo de hooks (Claude; Codex igual más PermissionRequest):

| Evento | Efecto |
|---|---|
| SessionStart | `idle` |
| UserPromptSubmit / PreToolUse | `working`; si el prompt trae `<task-notification><task-id>X`, el subagente X pasa a `done` |
| Notification `permission_prompt` / PermissionRequest | `needs_you` + `permission` |
| Notification `idle_prompt` | `idle` (sin aviso: ya avisó el Stop) |
| PostToolUse | `working` (sale de `needs_you` cuando se aprobó) |
| SubagentStart / SubagentStop | agrega / termina un subagente |
| Stop | `idle` + `unread`; los subagentes en `background_tasks` siguen `running` (un subagente en background no dispara SubagentStop: probado) |
| SessionEnd | `exited`; la fila se va del árbol a los 60 s (el pane vuelve a ser un shell) |
| exit del PTY | `exited` (código 0) o `failed` (código ≠ 0) |

Genérico (todo pane, y lo único para los CLIs sin hooks): salida visible en los últimos 3,5 s =
`working`, si no `idle` (el mismo criterio de `src/hub-activity.ts`, pasado a main); OSC 9, OSC
777 o BEL = `needs_you` + `attention`. Fuera de los workers el agente corre adentro de un shell,
así que "el agente terminó" no es el exit del PTY: es que el proceso en primer plano del pane
(`PtyManager.foregroundProcess`) deja de ser el CLI y vuelve el shell; eso cuenta como
`SessionEnd`. Con `source: hooks` el genérico sólo aporta ese fin y el exit. [Claude, builder
check]

**Workers**: `OrchestrationState` sigue siendo la verdad de los workers (`needs_input`, `done`…);
el árbol usa su relación coordinador → worker (`PaneNode.orchestration.coordinatorPaneId`) y el
estado del pane del worker sale del mismo store.

**Peor estado** (orden para el padre y para ordenar hijos): `needs_you` > `failed` > no leído >
`working` > `idle` > `exited`.

### 6.5 La API que lee la sidebar y después el teléfono [Claude]

- `agentStatus:snapshot` → lista de estados; `agentStatus:changed` (ping, como
  `orchestration:changed`); `agentStatus:markRead(paneId)`.
- Las acciones del teléfono son las que ya existen (escribir en un pane, `worker.send`, merge,
  discard, open PR, keepOpen) y la nueva `markRead`. El spec deja una sola función en main que
  agrupa estado + acciones para que Bauti la exponga por su transporte; no se construye el
  transporte.

### 6.6 La sidebar [Gero sobre la maqueta B]

- En la pestaña Worktrees, cada fila de worktree que tenga panes de agente se puede desplegar.
  Hijos: los panes de agente de ese worktree (todos los tabs), los workers debajo de su
  coordinador, los subagentes debajo de su agente.
- Fila de agente: punto de estado, nombre (etiqueta del pane, o el del CLI), CLI chico a la
  derecha, chip `question`/`permission` cuando te necesita, duración si trabaja. Negrita si no
  leído. Click = ir a su tab y enfocarlo (y lo marca leído).
- **Un worker aparece una sola vez**: bajo su coordinador, en la fila del worktree del
  coordinador, como en la maqueta B, aunque corra en su propio worktree `nest/*`. Esa fila
  `nest/*` no lo repite. [Gero, maqueta B]
- Fila de worktree: el peor estado de sus hijos; plegada, `+N` con cuántos agentes. El punto de
  setup de preset que ya existe (`STATUS_DOT_CLASS`) se queda; el de agentes es otro. [Claude,
  builder check]
- Movimiento, todo CSS en `tailwind.css`: pulso de `working` 2 s `steps(6)`, opacidad 1 → 0,5,
  todos los puntos en fase; desplegar 180 ms `cubic-bezier(0.16,1,0.3,1)`; filas entran/salen
  150 ms ease-out; texto con brillo (shimmer) en el agente que trabaja. Respeta
  `prefers-reduced-motion`. La referencia exacta es `sidebar-motion.html`.

### 6.7 Avisos de escritorio [Gero; detalles: Claude, builder check]

- Se avisa en: entrada a `needs_you`; fin de turno (`Stop`) de un pane que no es worker; y cuando
  el último worker activo de un coordinador termina ("All workers done"). Nunca con la ventana
  enfocada; uno por transición. Un CLI sin hooks **no** avisa al pasar a `idle` (3,5 s sin
  salida da falsos "terminó"): sólo queda no leído. Sí avisa con OSC 9/777/BEL. [Claude, builder
  check]
- Click en el aviso = traer Nest al frente y enfocar ese pane: hace falta un canal nuevo de main
  al renderer para enfocar un pane.
- El `notifyDesktop` de `main.ts:762` hoy recibe sólo `(title, body)`: se le suma el `paneId`
  para el click. El aviso de "Worker needs input" de orquestación pasa por el mismo camino para
  no duplicar.
- Un interruptor "Agent notifications" en Settings, prendido por defecto.

### 6.8 Workers con cualquier CLI con MCP [Gero: ahora]

- `orchestrationLaunchArgs` hoy sólo arma claude y codex, por flags de arranque
  (`--mcp-config`, `-c mcp_servers.*`) que no tocan la config de Memories. Gemini, qwen y
  opencode no tienen ese flag: el server `nest_orchestration` se escribe en sus archivos de
  config de cuenta con una fusión marcada, como hace Memories, pero con marca, alta y baja
  propias (apagar Memories no lo borra, y viceversa). El env lleva
  `NEST_ORCH_SOCKET`/`NEST_ORCH_TOKEN`. [Claude, builder check]
- `CMD_DE_AGENTE` y la elección de cuenta (`defaultAccount`) se abren a esos CLIs.
- Cómo le llegan las instrucciones de coordinador: por el `instructions` del MCP (Claude y Codex
  lo leen, probado). Si un CLI no lo lee, el builder lo pasa por el canal propio de ese CLI o lo
  deja documentado como límite.
- Cada CLI nuevo se marca "sin confirmar" hasta probarlo de verdad, igual que en §6.3.

## 7. Lo que queda al builder

Nombres de archivos, tipos y canales; cómo se parte el `WorktreesSection` en componentes; cómo
se cruza `cwd`/`repoPath`; el umbral exacto de los timers salvo los fijados acá; tests.

## 8. Hallazgos de las pruebas reales (12-nov)

- Claude 2.1.322: los hooks de `--settings` se suman a los del proyecto. SubagentStart/Stop
  traen `agent_id` y `agent_type`. Un subagente en background no dispara SubagentStop; su fin
  llega en el próximo UserPromptSubmit como `<task-notification><task-id>` y el `Stop` trae
  `background_tasks`.
- Codex 0.167.2: hooks en `CODEX_HOME` propio + bypass funcionan, incluidos SubagentStart/Stop.
  Lee el `instructions` del MCP (la investigación decía que no) y también `-c
  developer_instructions`. En `codex exec` las tools MCP piden aprobación: ver en vivo si un Codex
  coordinador interactivo pide aprobar cada `nest_*`.
- Sin probar: Gemini, Qwen, Notification `permission_prompt`/`idle_prompt`, PermissionRequest
  (sólo salen en modo interactivo).

## 9. Preguntas abiertas para Gero

1. **Codex con Memories apagado**: ¿le prendemos `CODEX_HOME` propio + bypass de confianza de
   hooks a todo Codex para tener estado exacto, o queda genérico (lo que propone este spec)?
2. **¿El `CODEX_HOME` de Memories arranca logueado?** No tiene `auth.json`; hay que verificarlo
   antes de cualquier prueba con Codex desde Nest.
