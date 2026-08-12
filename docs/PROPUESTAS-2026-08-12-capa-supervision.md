# Propuestas: la capa de supervisión multi-agente

> **Qué es esto**: 14 propuestas de features priorizadas, con el problema que ataca cada una, por qué vale la pena, y cómo se implementaría sobre el código actual.
> **Cómo se armó**: investigación de mercado (competidores 2025-26, tendencias, dolores documentados de usuarios en HN/Reddit/issues de los CLIs) + verificación de cada afirmación contra este repo (main y ramas remotas, con paths citados). Elaborado por Elise, 2026-08-12.
> **Qué NO es**: un compromiso de roadmap. Es material de discusión — cada propuesta se puede promover a spec en `docs/specs/` si les cierra.

---

## La tesis

El mercado ya resolvió *ejecutar* agentes en paralelo: los first-party lo están comoditizando (Claude Code Agent Teams, flag `--worktree`, cloud agents de Cursor/Codex/Jules). El cuello de botella documentado se movió a **supervisarlos**: saber qué hace cada uno, revisar lo que producen (telemetría citada en dev.to: review time +91%, pickup de PRs agénticos 5,3x más lento), controlar costos, detectar conflictos entre ramas, y tener confianza para desatenderlos.

Nest ya construyó la capa de ejecución: panes, worktrees con presets, diff viewer, MCP panel, equipos con Realtime. Lo que falta es exactamente la capa de supervisión — y por eso 9 de las 14 propuestas son señales y loops sobre infraestructura que ya está pagada.

Tres fosos defendibles que salieron del análisis competitivo:

1. **Cross-platform.** Conductor, Sculptor, cmux y Superset son Mac-first. Agent Teams ni siquiera funciona en Windows Terminal. "El orquestador visual para Windows/Linux" es un posicionamiento regalado.
2. **La capa de equipo sobre Supabase Realtime.** Nadie la shippeó (Conductor la promete; Superset cobra $15/seat por menos), y es la única monetización que sobrevivió en el segmento — Bloop (vibe-kanban) y Terragon murieron gratis.
3. **La posición de host de todas las terminales.** Cost tracking cross-vendor, tripwire de secretos y arena de agentes son estructuralmente imposibles para los first-party (Claude nunca va a medir a Codex) y para las herramientas cloud.

---

## Resumen

| # | Propuesta | Tema | Esfuerzo |
|---|-----------|------|----------|
| 1 | Semáforo de agentes + cola de atención | Supervisión | M |
| 2 | Radar de conflictos entre worktrees | Worktrees | S |
| 3 | Baton Pass: handoff de contexto | Contexto | S |
| 4 | Review Inbox con feedback al agente | Revisión | L |
| 5 | Cost & Limits HUD | Costos | M |
| 6 | Quality Gates locales | Calidad | M |
| 7 | GC de worktrees + recetas versionadas | Worktrees | S |
| 8 | Rewind visual por worktree | Confianza | M |
| 9 | Tripwire de secretos | Seguridad | M |
| 10 | Mission Board: kanban ejecutable | Orquestación | L |
| 11 | Team Playbooks + Branch Guard | Gobernanza | M |
| 12 | Arena de agentes | Evaluación | L |
| 13 | Panes blindados: sandbox por pane | Seguridad | XL |
| 14 | Nido Supervisor: frontend de Agent Teams | Posicionamiento | XL |

---

## 1. Semáforo de agentes + cola de atención — `M`

**Problema.** Hoy Nest tiene dos señales binarias de actividad: el dot activo/inactivo del Hub (`src/hub-activity.ts`, throttle 250ms) y el `busy` por pane (`src/components/TerminalPane.tsx:146-195`, con umbral propio). Ninguna distingue *por qué* un pane está quieto: un agente esperando que aprueben un permiso se ve igual que uno que terminó o uno colgado. Es el dolor más citado en los flujos multi-agente ("perder track de qué agente hace qué"); existen 3+ herramientas comunitarias (code-notify, agent-notify, ccnudge) solo para avisar cuándo Claude Code se frena — demanda insatisfecha probada.

**Propuesta.** Una state machine por pane con estados semánticos — *working, waiting-for-input, needs-permission, error, done, idle* — clasificando los chunks de PTY con heurísticas regex por CLI. Badge en el header del pane + mini-mapa en la status bar. Los panes bloqueados entran a una **cola de atención** ordenada por tiempo de espera: notificación nativa del SO con click-to-focus, hotkey para saltar al siguiente pendiente, modo digest/no-molestar. Encima, una métrica de utilización (% de tiempo produciendo vs bloqueado).

**Cómo, sobre el código actual.**
- La clasificación se suscribe al bus de PTY del renderer (`src/pty-events.ts`, `subscribeToPtyData`), igual que hace `hub-activity.ts` — y unifica las dos señales binarias existentes en vez de agregar una tercera capa.
- Ya hay regexes que reconocen prompts de permiso y spinners: `UI_CHROME_RE` en `src/lib/terminal-chrome.ts:12` (hoy filtran chrome; son el punto de partida para clasificar estado). Heurísticas por provider en un módulo de patterns, extensible a los Custom CLIs.
- Click-to-focus: ya existen `window.pty.write` y el registro de foco por pane (`registerTerminalFocus`, `TerminalPane.tsx:117-120`). Notificaciones con la Notification API de Electron.
- De paso se puede aplicar el pendiente documentado en `docs/HANDOFF-2026-08-02-hub-perf-roster.md` (dispatch O(1) para los suscriptores globales del overlay).
- Cero dependencias nuevas.

**Por qué primero.** Es infraestructura: las propuestas 4, 6, 8 y 12 consumen sus señales. Ningún multiplexer cross-platform con GUI tiene estados semánticos cross-vendor; se está volviendo table-stakes de la categoría.

---

## 2. Radar de conflictos entre worktrees — `S`

**Problema.** Los worktrees no eliminan conflictos: los difieren al merge. "Merge hell puede negar los beneficios de los agentes en paralelo" (HN); hay un Show HN dedicado solo a esto (Clash). Hoy Nest no cruza información entre worktrees: `WorktreesSection.tsx` ya consulta diff stats de todos en paralelo (`git:shortstat`), pero nada detecta que dos panes están tocando los mismos archivos.

**Propuesta.** Detección en tiempo real de archivos dirty solapados entre worktrees: chip de alerta en los headers de ambos panes con la lista de archivos en colisión, matriz de solapamiento en el Hub, y sugerencia de orden de merge (`git merge-tree` en seco). Opcional: botón para avisarle por su terminal al agente que va segundo.

**Cómo.** Los bloques de datos ya existen: `git:status` porcelain por worktree (`electron/main.ts:335-369`) da los archivos dirty, y `diff-engine` da los paths modificados. El radar es *cruzar* datos existentes con un watcher con debounce — no construir recolección nueva. El aviso al agente reutiliza la escritura al PTY (`window.pty.write`, misma mecánica de snippets/broadcast).

**Por qué.** La mejor relación esfuerzo/valor de la lista: protege la propuesta de valor central del producto (paralelismo con worktrees) y es shippeable en días.

---

## 3. Baton Pass: handoff de contexto — `S`

**Problema.** Cuando el contexto de un agente se llena, se auto-compacta y pierde precisión sin avisar. Y pasar trabajo entre agentes o sesiones es copy-paste artesanal — el "session handoff doc" es el patrón dominante de 2026, pero manual. El equipo ya lo practica a mano: `docs/HANDOFF-2026-08-02-hub-perf-roster.md` es exactamente ese formato.

**Propuesta.** Un comando de un click por pane que le pide al propio agente (prompt template configurable) generar un handoff doc — resumen, decisiones, archivos tocados, próximos pasos — guardado en el worktree e inyectable como prompt inicial en otro pane. Complemento: detectar cuándo Claude Code se acerca al auto-compact (expone % de contexto en su status line) y ofrecer generar el handoff antes de perder detalle, con badge ámbar.

**Cómo.**
- Inyección: `window.pty.write` (ojo: los CLIs submitean con `\r`; el broadcast actual manda `\n`). Para panes nuevos, `feat/integrations` ya trae `initialInput` (`src/types.ts:40` en esa rama) — inyección one-shot al arrancar el pane, exactamente la mecánica que esto necesita. Conviene decidir si Baton Pass espera ese merge o arranca solo con panes existentes.
- El archivo puede seguir el patrón `.nest/TASK.md` que `feat/integrations` valida (o la convención `.raven/` de main — a definir con Gero).
- La detección pre-compact es un regex más sobre el mismo stream que consume el semáforo (#1).
- **Deslinde**: la memoria de contextos persistente es el área de Bautista (`docs/GUIA-EQUIPO.md` §5, patrón `context-store` + IPC `context:*`). Esto no la pisa: transfiere contexto vivo entre panes *ahora*; si se persiste algo, debería alinearse al patrón de §5.

---

## 4. Review Inbox con feedback al agente — `L`

**Problema.** El dolor #1 documentado del mercado: revisar lo que N agentes producen. Hoy `DiffViewerPanel` es read-only, muestra **un** worktree (el del pane con foco) y diffea contra HEAD; revisar 6 panes = saltar de uno a otro. Y el feedback es manual: ir al terminal del agente y escribirle.

**Propuesta.** En dos fases.
- **Fase 1 (local)**: panel único que agrega los diffs sin commitear de todos los worktrees activos, ordenados por tamaño y riesgo (archivos sensibles, tests tocados), con quién lo produjo. Aprobación selectiva por hunk antes de commit, y comentarios inline que vuelven como prompt al pane del agente.
- **Fase 2 (equipo)**: estados needs-review/changes-requested/approved por Supabase Realtime, routing de comentarios a panes remotos, métricas de pickup/review time en Team Analytics.

**Cómo, y relación con el PR #20.** La spec del editor integrado (PR #20, draft, `docs/specs/2026-07-13-editor-integrado-review-design.md`) **ya especifica** el changeset view por worktree (§3) y "Fix with agent" (§4) — esta propuesta lo reconoce y va más allá: bandeja *agregada multi-worktree*, orden por riesgo y staging por hunk (`git apply --cached`), que la spec no cubre (y deliberadamente excluye commit/push de la UI — ese alcance habría que consensuarlo). Implementación: watcher por worktree (infra compartida con #2) + evolución de `diff-engine`; el comentario→prompt reutiliza `window.pty.write`. Precedente interno de review asistido: el botón "✦ AI Review" de `PRReview.tsx:202-222`. Fase 2: tabla `review_items` con RLS por team (atención a la recursión que arregla el PR #17).

**Por qué.** Ataca el dolor más grande del mercado, adelanta la mitad de la spec del editor, y la fase 2 es la feature que hace valer los seats de equipo.

---

## 5. Cost & Limits HUD — `M`

**Problema.** Nest no muestra nada de tokens ni costos (verificado: cero referencias en main y en las 18 ramas). Cada CLI tiene lo suyo por separado; nadie suma cross-vendor ni atribuye por rama. Los dolores documentados: "bills de $200 overnight" y los rate limits dobles de Claude (ventana de 5h + tope semanal) como frustración principal de power users. Y Nest multiplica el consumo por diseño: broadcast a todos los panes sin ninguna confirmación.

**Propuesta.** Chip por pane (junto a los port chips) con tokens y costo estimado USD de la sesión, desglose por modelo, acumulado por worktree/rama — todo parseado **on-device** de los logs que cada CLI ya escribe. Gauges de rate limits de Claude en la status bar. Aviso pre-broadcast ("esto quemaría ~X% de tu ventana de 5h"). Presupuestos con alertas. Fase 2: rollups opt-in a Team Analytics con costo-por-PR-mergeado.

**Cómo.** Detalle clave que descubrimos verificando: Nest redirige el HOME de los panes de IA al accountDir (`electron/pty-manager.ts:67-78`), así que los JSONL de Claude generados desde Nest viven bajo `~/.raven-nest/accounts/<ai>/<cuenta>/.claude/projects/` — el colector debe recorrer los accountDirs (y el `~/.claude` real solo para terminales planas). Colector en main siguiendo el patrón de `metrics-collector.ts` (que ya tiene el árbol repo→worktree→pane y es el lugar natural donde colgar esto); chip imitando `PortChip.tsx` en `PaneHeader.tsx`; persistencia local en `~/.raven-nest` (patrón `settings-store`). Empezar solo con Claude y abrir la interfaz de providers a contribuciones.

**Por qué.** Posición estructural: solo el host de todas las terminales puede medir cross-vendor con atribución por rama. Coherente con local-first: los datos crudos no salen de la máquina. El aviso pre-broadcast no lo tiene nadie.

---

## 6. Quality Gates locales — `M`

**Problema.** La validación hoy es remota: `src/lib/ci/` muestra runs de GitHub Actions/GitLab — te enterás del rojo *después* de commitear y pushear. La mitigación documentada contra el código "estilo tutorial" de los agentes son checks automáticos como checkpoint; hoy correrlos localmente tras cada tarea de agente es disciplina manual.

**Propuesta.** Pipeline configurable por repo (`.raven/gates.json`: lint, typecheck, tests, build, secret-scan) que corre en el worktree cuando el agente llega a un stopping point (señal del #1) o a demanda. Semáforo verde/rojo en el header; en rojo, el changeset no se aprueba en el Review Inbox (#4). Botón "que lo arregle el agente" que manda el output del fallo como prompt al pane.

**Cómo.** El motor **ya existe**: `electron/setup-runner.ts` ejecuta comandos configurables en un worktree con timeout, estados running/done/failed, log con redacción de secretos y progreso por IPC — hoy solo se dispara al crear el worktree desde los presets (`.raven/presets/*.json`). Gates = reutilizar SetupRunner con otro schema y otro trigger. El trigger "agente terminó" no existe como concepto: usar la transición a *done/idle* del semáforo (#1) — hay que definirlo explícitamente porque un CLI interactivo no termina su proceso al acabar una respuesta. El botón de fix es UI sobre `window.pty.write`. Bonus: el "AI Error Explain" del `docs/ROADMAP.md` (Phase 2 #4) cae casi gratis con la misma pieza.

---

## 7. GC de worktrees + recetas versionadas — `S`

**Corrección honesta**: la versión original de esta propuesta pedía "provisioning declarativo por repo"… que **ya existe** y está bien resuelto: presets en `.raven/presets/*.json` con `setup[]`, `postCreate[]`, `dev`, `ports[]`, `env{}` auto-ejecutados al crear el worktree vía SetupRunner, más copiado de `.env` untracked (`NewWorktreeModal` + `worktree:copyFiles`) y editor de presets en UI. Lo que queda es más chico y sigue valiendo:

**Problema.** (a) No hay GC: los worktrees viejos se acumulan ocupando gigas y el remove es manual uno por uno (`worktree:remove`); `pruneMissing` solo limpia entradas del store. (b) No hay *reserva* de puertos — solo `declaredPorts` del preset y `detectedPorts` en runtime; dos dev servers pueden pelearse el mismo puerto igual. (c) Los presets son locales al repo de cada uno: no viajan al equipo.

**Propuesta.** (a) Recolector de worktrees: lista por último commit/acceso con tamaño en disco y borrado en lote — la estimación de disco ya existe (`metrics-collector.refreshDisk` con breakdown). (b) Asignación de puerto libre al crear el worktree, inyectado como env var del preset (encadenado a `port-monitor.ts`). (c) Fase 2: elevar los presets a **Workspace Blueprints** de equipo vía Supabase ("Join workspace" → clonar + provisionar + layout listo), con secretos siempre referenciados, nunca almacenados.

---

## 8. Rewind visual por worktree — `M`

**Problema.** Los checkpoints se volvieron estándar 2026 (Claude Code tiene `/rewind`) pero Gemini, Codex, Copilot y OpenCode no tienen equivalente — y Nest corre los cinco. Si un agente rompe el worktree, hoy es arqueología de git a mano. Es el freno #1 para desatender agentes.

**Propuesta.** Snapshot automático del worktree antes de cada ráfaga de edición del agente (commit plumbing a `refs/nestmux/checkpoints`, sin ensuciar historial ni index), disparado por el estado *working* del semáforo (#1) + watcher de filesystem. Timeline horizontal por pane con preview del diff de cada checkpoint y restore de un click. Idéntico para los cinco CLIs.

**Cómo.** `git stash create` / `commit-tree` / `update-ref` hacia refs propios con GC configurable, con el patrón `execFileSync` sin shell que ya usa todo `main.ts`. El preview necesita extender `diff-engine.getDiff` para aceptar dos refs (hoy solo recibe una base). **Interacción a resolver**: Spotlight (`electron/spotlight-engine.ts`) es un espejo de archivos worktree→repo raíz vía `fs.watch` + copyFile; restaurar un checkpoint con Spotlight activo propagaría los archivos restaurados al repo raíz — hay que pausarlo durante el restore.

**Por qué.** Sería el único rewind cross-agente y visual del mercado, apalancando dos activos (worktrees + diff viewer) que un competidor sin ambos no puede copiar.

---

## 9. Tripwire de secretos — `M`

**Problema.** Los agentes copian secretos a código y a prompts; con muchos panes y broadcast el riesgo se multiplica. Hoy existe redacción de secretos **solo en logs de setup** (`SECRET_RE` + `redact()`, duplicado en `setup-runner.ts:29-32` y `cli-install-runner.ts:18-21`) y detección de *archivos* `.env` al crear worktrees — pero nada escanea diffs ni el input que va a los agentes.

**Propuesta.** Dos frentes: (1) escanear los diffs de cada worktree (patrones tipo gitleaks + entropía) y marcar el pane / bloquear en el Review Inbox si un agente escribió una key; (2) interceptar el input hacia los panes — si un prompt o broadcast contiene un valor presente en los `.env` del repo, enmascararlo y pedir confirmación. Reglas versionadas y compartibles por equipo (patrón `shared_snippets`).

**Cómo.** Extraer y DRY-ficar el `SECRET_RE` existente como base del motor. El chokepoint correcto para (2) está en **main**: `ipcMain.on('pty:write')` (`electron/main.ts:883`) → `PtyManager.write` — en el renderer hay 6+ call sites de write, no sirve interceptar ahí. Eso cubre de regalo el input de invitados remotos del terminal sharing (`terminalShareService.ts:68`). Ojo: `PtyManager.create` escribe el comando inicial sin pasar por `write()` — cubrir ese caso también. El frente (1) comparte el watcher de worktrees con #2/#4/#8.

**Por qué.** Ningún competidor lo tiene, y la dirección (2) — evitar fugar secretos *hacia* el LLM — solo la puede hacer quien controla el PTY.

---

## 10. Mission Board: kanban ejecutable — `L`

**Contexto real**: `feat/integrations` **ya tiene** un `OrchestrationBoard` (lista de tareas con estados todo/working/needs_you/done derivados de CI/review/worktrees, presencia por rama) y el flujo tarjeta→worktree+`.nest/TASK.md`+pane desde `MyTicketsView` ("Work on this"). Esta propuesta es la **evolución** de eso, no algo paralelo.

**Problema.** Dos huecos del board actual: (a) las transiciones de estado dependen de *polling* de PRs de GitHub cada ~90s — el agente no puede reportar "terminé" o "necesito ayuda" directamente; (b) es una lista clickeable, no un tablero: no hay columnas ni drag & drop como gesto de despacho.

**Propuesta.** (a) Un **servidor MCP local embebido** (stdio, en main) que exponga `claim_task`/`update_task`/`list_tasks` con lock atómico, auto-registrado en las configs MCP de cada CLI vía el `MCPPanel` existente — los agentes actualizan el board solos, sin polling. (b) Vista kanban por columnas donde arrastrar una tarjeta a "In Progress" lanza worktree+pane+prompt (reutilizando las IPC `tickets:*` del Ticket Loop, no duplicando el pipeline). Sincronizado al equipo por Realtime con fallback local.

**Cómo.** El MCP server es infraestructura genuinamente nueva (hoy `MCPPanel` solo *edita* archivos de config; Nest no corre ningún server MCP, ni está `@modelcontextprotocol/sdk` en package.json). El drag & drop tiene precedente directo: `@dnd-kit/*` ya está en dependencies y se usa en `App.tsx` para reordenar panes. Los estados nuevos deberían mapearse al enum `AgentStatus` de `src/integrations/board.ts` (cuyo propio comentario ya anticipa estados idle/needs_input para un "epic B") en vez de inventar otro.

**Por qué.** vibe-kanban validó el concepto y murió con Bloop; nadie más tiene las tres piezas (MCP + worktrees + Realtime de equipo). Y depende de mergear `feat/integrations` — un motivo más para destrabar ese merge.

---

## 11. Team Playbooks + Branch Guard — `M`

**Problema.** Hoy se comparten snippets, configs MCP y workspaces por equipo (`useSharedSnippets`, `useSharedMcpConfigs`, `useSharedWorkspaces`), pero no *reglas*: cada uno mantiene su CLAUDE.md a mano y los equipos divergen. Y la única protección de main es la de GitHub (descrita en `GUIA-EQUIPO.md`: PR obligatorio, 1 aprobación) — **remota**: nada local impide que un agente en modo autónomo commitee a main o haga force-push en un repo sin protección configurada.

**Propuesta.** Bundles versionados de guardrails de equipo — reglas CLAUDE.md/AGENTS.md, tests inmutables que ningún agente puede tocar, reglas de secret-scan (#9), ramas protegidas, perfil de sandbox (#13) — publicados por el líder, sincronizados por Realtime, auto-inyectados en cada worktree nuevo con pin de versión. Enforcement local vía git hooks gestionados (`core.hooksPath` propio): el intento bloqueado se muestra en la UI con opción de crear la rama correcta en un click.

**Cómo.** Los dos mecanismos de inyección ya existen a medias: los presets auto-ejecutan comandos al crear worktrees (`setup-runner`), y `account-store.ts` (`setupClaudeConfig`, `CLAUDE_SHARED_ITEMS`) ya symlinkea CLAUDE.md/settings/skills por *cuenta* Claude. El gap es por-worktree, por-equipo y versionado. Tabla `policy_packs` con RLS por team — secuenciar después del merge del PR #17 (fix de recursión de políticas de líder, migración 024; main ya tiene los fixes 019/020/022).

**Por qué.** Previene el accidente más barato de evitar y más caro de sufrir, y es la feature de tier Team más barata de construir — la lección de Bloop/Terragon es que la capa de equipo es la única monetización que sobrevive.

---

## 12. Arena de agentes — `L`

**Problema.** "¿Codex o Claude para este refactor?" se decide por vibes: la varianza por harness es de 10-20 puntos con los mismos pesos de modelo, y los benchmarks ajenos no reflejan tu codebase. Nest ya tiene las primitivas del experimento (broadcast de input/snippets a todos los panes, worktrees, 33 layouts) pero comparar resultados es manual.

**Propuesta.** Formalizar el broadcast en un experimento medido: definir una tarea, despacharla a N panes (cada uno en su worktree), y al terminar armar la vista de comparación — diffs lado a lado, resultado de gates (#6), tokens/costo (#5), tiempo total y tiempo bloqueado (#1). El usuario (u opcionalmente un agente juez, precedente: el "✦ AI Review" de `PRReview.tsx`) elige ganador y mergea ese worktree. Scoreboard histórico por modelo y tipo de tarea, local y compartible.

**Cómo.** Orquesta primitivas existentes; la comparación es un layout nuevo del motor de `src/layout/presets.ts`. Hay un precedente interno directo que conviene extender: `BenchmarkDashboard.tsx` + `benchmark-recorder.ts` ya comparan CPU/RSS entre cells en una tabla — les falta persistencia (hoy todo en memoria) y las dimensiones de resultado (diff/tests/costo/modelo). Scoreboard persistido en `~/.raven-nest`. Nota: el broadcast actual replica keystrokes a *todos* los panes; la Arena necesita despacho a un subconjunto — pieza chica nueva.

**Por qué.** Estructuralmente imposible para los first-party (Claude nunca va a rutear tareas a Codex). Feature de composición: su calidad depende de que #1, #5 y #6 existan — por eso va después.

---

## 13. Panes blindados: sandbox por pane — `XL` (fase 1: `L`)

**Problema.** Los shells se spawnean sin ningún aislamiento (`pty.spawn` en `electron/pty-manager.ts:121`): un agente en modo autónomo tiene acceso total al filesystem y la red. El "Nest sandbox" que menciona `raven-home.ts` es redirección de HOME por cuenta — aislamiento de *configuración*, no de seguridad (y los `sandbox: true` de `main.ts`/`browser-pane-manager.ts` son el sandbox de Chromium para renderers, otra cosa). El sandboxing es table-stakes 2026 (Codex y Gemini CLI ya sandboxean su propio proceso) y es el prerrequisito para desatender flotas.

**Propuesta.** Perfiles declarativos de aislamiento por pane: filesystem limitado al worktree, red on/off o allowlist, deny-list de comandos. **Fase 1 acotada (esfuerzo real L)**: wrapper Docker/Podman por worktree (bind-mount + red configurable) — cubre el 80% del valor. Fase 2: sandboxes nativos por SO (Seatbelt/bubblewrap+Landlock/AppContainer). Perfiles compartibles por equipo y referenciables desde los Playbooks (#11).

**Cómo.** `pty-manager.ts:121` es el punto exacto: anteponer el wrapper al `spawnBin`/`spawnArgs` según perfil y SO (`electron/platform.ts` ya centraliza la definición del shell). **Atención**: `setup-runner.ts` también ejecuta comandos arbitrarios de presets sin aislamiento — si se blindan los panes pero no el setup, queda un bypass.

**Por qué.** Nest sería el único que sandboxea *cualquier* agente CLI, por pane, cross-platform. Junto con el rewind (#8) forma el paquete de confianza que habilita dejar agentes solos.

---

## 14. Nido Supervisor: frontend de Agent Teams — `XL` (empezar con spike)

**Problema/oportunidad.** Claude Code Agent Teams (2-16 agentes coordinados) requiere tmux o iTerm2 para verse en split-panes y **no funciona en Windows Terminal ni en VS Code**. Nest ya es una grilla de panes multiplataforma: puede ser *la* forma de ver Agent Teams en Windows/Linux. Estratégicamente: integrarse con la orquestación first-party que va a comoditizar lo básico, y quedarse con la capa visual multi-vendor durable.

**Propuesta.** Modo supervisor: Nest detecta una sesión de Agent Teams y renderiza cada agente del team como pane propio, con la task list compartida y el mailbox como panel lateral. Fase 2: supervisor agnóstico (task list + mailbox propios sobre el MCP server del #10) para swarms mixtos Claude+Codex+Gemini.

**Cómo.** **Fase 0 obligada: spike de 1-2 semanas** para validar el parsing del protocolo (estado en los archivos de sesión de Claude Code), aislado en un adapter versionado — Agent Teams es experimental y su formato puede cambiar; ese es el riesgo principal, junto con que Anthropic shipee su propia GUI. Detalle verificado: como Nest redirige HOME por cuenta, los archivos de sesión viven bajo `~/.raven-nest/accounts/claude/<cuenta>/`, no en el `~/.claude` global. Naming: "teammates" ya significa miembros humanos del equipo en el código (`useTeam`, `useTeamPresence`) — elegir otro término para no colisionar. La co-edición CRDT/Yjs del roadmap del README es una iniciativa vecina pero distinta.

---

## Ideas evaluadas y descartadas del top

- **Dispatcher (auto-ruteo de tareas al mejor agente)**: necesita el historial que la Arena (#12) genera; construirlo antes es especulativo.
- **Modo Focus / Standup 2.0 / digest**: absorbidos en la cola de atención del #1.
- **Caja negra / replay de sesiones**: solapa con el daemon PTY persistente ya planificado (`docs/ROADMAP.md` Phase 1) — diseñarlo como parte de ese ítem.
- **Agent Audit Trail / RBAC granular**: argumentos enterprise reales pero prematuros sin pipeline de ventas que los pida; derivarlos de #9/#11 cuando haga falta.
- **Memoria de proyecto compartida**: área asignada (Bautista, `GUIA-EQUIPO.md` §5); #3 entrega la parte pane→pane sin pisarla.
- **Pane Pipes (pipelines agente→agente)**: solapa con #4 y #10; reevaluar cuando estén en producción.
- **Leader key / which-key**: construirlo como parte del import de tmux ya anunciado en el README.

## Observaciones sueltas del repo (al margen de las propuestas)

Salieron de la verificación; las dejo por si sirven:

- `feat/integrations` suma ~370 tests netos (619 totales en la rama) y sigue activa (último commit 2026-08-07), divergida de main desde el 2026-07-11 y sin PR abierto. Varias propuestas de este doc (#3, #10) se apoyan en piezas de esa rama — destrabar ese merge multiplica el valor de todo lo demás.
- `CONTRIBUTING.md:57` dice "we don't currently run an automated test suite", pero main tiene vitest configurado con 246 tests y la GUIA-EQUIPO exige `npm test` verde — desactualizado.
- `README.md:92` dice "11 built-in presets" pero `src/layout/presets.ts` define 33 — desactualizado.
- El `SECRET_RE` + `redact()` está duplicado en `setup-runner.ts` y `cli-install-runner.ts` — candidato a extraer a un módulo común (lo aprovecharía #9).

## Secuencia sugerida

1. **Quick wins** #2 → #3 → #1 (S, S, M): ocupan el espacio de "supervisión" antes de que sea table-stakes, y #1 desbloquea #4/#6/#8/#12.
2. **Primera apuesta L**: Review Inbox (#4), consensuando alcance con la spec del PR #20.
3. **Apuestas XL** (#13, #14): validar con spikes, no con builds.

El riesgo real no es elegir mal una feature — es dispersarse en 14 con un equipo de 3 y cadencia de ~11 releases/mes. Este doc es para elegir 2 o 3.
