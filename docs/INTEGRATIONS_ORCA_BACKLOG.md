# Integrations — Backlog inspirado en Orca (hooks del power-dev)

> Origen: deep-research de Orca (onorca.dev / Stably AI) del **2026-08-06** (23 fuentes, 20 claims verificados). Ver competidor en memoria `competitor-orca`.
>
> **Problema:** el hook de Orca engancha al **power-dev individual** (delegás a una flota de agentes que corre sola, la mirás por estado, jugás con las cuotas, corre de noche). Ese perfil hoy con Nest **no lo capturamos** — y es justo quien después mete la herramienta en su equipo. Perdemos el *beachhead individual*.
>
> **Objetivo de este backlog:** sumar a `feat/integrations` los 4 loops single-dev que enganchan, **pero cableados al bus de eventos (H8) → Slack accionable / Notion**, que es lo que Orca estructuralmente no hace. Enganchar al individuo → convertir a la historia de equipo.

## Principio de diseño (lo que nos diferencia de copiar)

Todo estado nuevo que introduzcamos **emite un `DomainEvent` al `EventBus`** (`electron/integrations/event-bus.ts`) y se resuelve por recipe a un `Command` (`notify` a Slack, `logOutcome` a Calendar, etc.). Orca deja esos estados dentro de la app single-dev; nosotros los sacamos al equipo. Cada épica agrega su(s) evento(s) al vocabulario en `electron/integrations/bus-types.ts` y su recipe default en `electron/integrations/recipes.ts`.

## Priorización (por ROI de enganche / costo)

| # | Épica | Hook que replica | Esfuerzo | Encaje integrations | Hito sugerido |
|---|-------|------------------|----------|---------------------|---------------|
| **A** | **Model Usage / Quota bar** | la barra `98% left 2h6m` | **S** | evento `quota.threshold` → Slack | **H9** (quick win) |
| **B** | **Agent Status Dashboard ("Needs You")** | tablero que te llama solo cuando hace falta | **M** | evento `agent.needs_input`/`agent.done` → Slack | **H10** |
| **C** | **Automations recurrentes (cron)** | auditorías nocturnas, "fábrica de noche" | **M** | reactiva `scheduleBlock`/`block.started` (ya declarados) | **H11** |
| **D** | **Fan-out + Race-and-merge** | "5 agentes, mergeo el ganador" | **L** | D1 atado a ticket-loop (H3) | **H12** |
| **—** | **Higiene** (follow-ups conocidos) | — | **XS** | — | continuo |

**Conceder (fuera de scope — cancha de Orca, funde al equipo chico):** app mobile iOS/Android, worktrees remotos SSH/VPS, paridad de 30+ CLIs. Ver sección final.

---

## Épica A — Model Usage / Quota bar `H9` · esfuerzo S

Replica la barra inferior de la captura (`98% left 2h6m`, `20% left 3d 2h`, `0% left Fable`). **No existe nada hoy** (`metrics-collector.ts` mide CPU/RAM, no tokens/cuota). Orca lo hace leyendo state files locales sin API. Quick win sticky y muy visible.

> **⛔ BLOCKED (2026-08-15, run autónomo) — falta la fuente de datos.** Research en disco (Windows, PC de Gero): **ningún CLI persiste localmente una ventana de cuota/rate-limit con reset**.
> - **Claude:** `.credentials.json` trae `rateLimitTier`/`subscriptionType` (etiquetas estáticas, no cuota); `stats-cache.json` trae actividad diaria histórica; los transcripts `projects/**/*.jsonl` traen `usage.*_tokens` por mensaje (agregables) **pero sin límite ni `resetAt`**.
> - **Codex/Gemini/Copilot/OpenCode:** nada de uso/cuota en disco (Codex ni siquiera tiene `sessions/`/`auth.json` acá).
>
> Conclusión: A1 tal como está especificado (`{ windows:{fiveHour,daily,weekly}, resetAt, pct }`) es **inviable** sin la fuente; sin límite no hay `pct` ni warning al 80%. **Requiere decisión de producto** (rediseño), opciones:
> 1. **Usage counter Claude-only** (real pero distinto): sumar `usage.*_tokens` de los transcripts del día → chip "N msgs / T tokens hoy". Sin cuota/reset.
> 2. **Parsear el rate-limit en vivo** desde la salida del terminal / headers de la API mientras el CLI corre (mucho más complejo, fuera del approach "state file").
> 3. **Esperar** a que los CLIs persistan cuota en disco (no depende de nosotros).
>
> No se implementa en el run autónomo: cambia el alcance de la feature y es llamada de Gero. Retomar cuando elija approach.

- [ ] **A1 — Reader de state files de CLIs.** Nuevo `electron/integrations/model-usage.ts`: lee y parsea el uso/rate-limit que cada CLI persiste en disco (`~/.claude`, `~/.codex`, y los demás soportados en `PaneAILogo`: gemini/copilot/opencode). Sin API calls, sin auth extra (igual que Orca). Salida: `{ provider, account, windows: { fiveHour, daily, weekly, fable? }, resetAt, pct }`. Robustez: archivo ausente/ilegible → `null` silencioso, nunca crashea.
- [ ] **A2 — Ventanas + warning 80%.** Derivar time-to-reset por ventana (5h/día/semana + Fable) y un flag `warning` al cruzar 80% de un límite. Refrescar cuando el agente escribe el file (watch/poll suave), no en tiempo real.
- [ ] **A3 — UI: chip de cuota.** Mostrar por pane/CLI activo. Extender `src/components/ResourceBarPopover.tsx` (ya arma el árbol repo→worktree→pane con logo del `aiType`) con un chip de cuota + color al 80%. Alternativa: chip en el header del pane.
- [ ] **A4 — Multi-account read-only.** Si hay varias cuentas por CLI, listar cada una con su readout (el status refleja la activa). *Hot-swap de cuentas = fast-follow, no bloquea A.*
- [ ] **A5 — Puente a bus.** Agregar `quota.threshold` a `bus-types.ts` (`DomainEvent`), emitirlo al cruzar 80%, y recipe default en `recipes.ts`: `quota.threshold → notify` ("⚠️ Claude al 80%, resetea en 2h"). **Esto es el diferencial: Orca te lo muestra a vos; nosotros lo tiramos al Slack del equipo.**
- **Aceptación / tests:** `model-usage.test.ts` con state files fake por inyección (patrón vitest node del repo, sin Electron). Casos: parse OK por provider, archivo ausente→null, cálculo de reset, umbral 80% emite evento una sola vez (dedup).

## Épica B — Agent Status Dashboard "Needs You" `H10` · esfuerzo M

El corazón del hook: el tablero de Orca es **Needs You / Working / Done / Idle** y **te llama solo cuando "Needs You"**. En Nest un "agente" es un `SessionPane` corriendo un CLI (no hay tipo `Agent`); el único estado semántico hoy es `WorktreeMeta.setupState`. **No existe** un panel de agentes por estado ni noción de "esperando input".

- [ ] **B1 — Inferencia de estado del agente.** Nuevo `electron/integrations/agent-status.ts`: derivar estado por pane a partir de (a) actividad del PTY (`pty-manager.ts`: timestamp del último output), (b) CPU del árbol de procesos (`metrics-collector.ts`), (c) `WorktreeMeta.setupState`. Estados: `working` (output/CPU activos), `needs_input` (output detenido esperando prompt del CLI / permiso), `idle` (sin output > N min), `done` (proceso salió / setup done).
- [ ] **B2 — Heurística "needs input".** Detectar que el CLI está esperando al humano (patrón de prompt de permiso/pregunta en el buffer del PTY, o quiescencia tras output sin exit). Es la parte fina — empezar conservador (falsos negativos > falsos positivos) e iterar.
- [ ] **B3 — UI: panel de agentes por estado.** Nuevo `src/components/AgentDashboard.tsx` con columnas Needs You / Working / Idle / Done (Idle oculto por default, como Orca). Cada tarjeta = pane+worktree; click → focus del pane. Reutilizar el árbol/estilo de `ResourceBarPopover.tsx` y logos de `AILogos`. Entrada desde sidebar (junto a `WorktreesSection.tsx`).
- [ ] **B4 — Eventos al bus.** Agregar `agent.needs_input` y `agent.done` a `bus-types.ts`; emitir en las transiciones. Recipes default: `agent.needs_input → notify` ("🙋 worktree `<branch>`: el agente necesita tu OK") y `agent.done → notify`. **Diferencial: te enterás por Slack que un agente te espera, sin tener la app abierta** (Orca necesita el desktop prendido y no tiene Slack).
- [ ] **B5 — Acción desde Slack (opcional, atado a H7).** Como ya existe Socket Mode (`slack-socket.ts` + `slack-envelopes.ts`), permitir responder el "Needs You" desde Slack (aprobar / mandar follow-up) → `SlackMentionsBridge`. Fast-follow de alto valor.
- **Aceptación / tests:** `agent-status.test.ts` (node) con PTY/metrics fake inyectados: transiciones de estado, dedup de eventos, umbral idle. Test de componente `AgentDashboard.test.tsx` (jsdom).

## Épica C — Automations recurrentes (cron) `H11` · esfuerzo M

> **✅ DONE (2026-08-15, run autónomo).** C1 (scheduler), C3 (handler `scheduleBlock` + emit `block.started`) y C4 (UI `AutomationsView` + IPC end-to-end) **ya existían**. El único gap real era **C2 (ejecución headless)**, ahora implementado: `electron/integrations/automation-runner.ts` (lógica pura, 27 tests) + puertos reales en `main.ts` reemplazando el `runAutomationStub`. Seguridad: prompt untrusted por **stdin** (nunca en el shell); solo `claude -p` soportado (otros providers degradan limpio). Fast-follows: (1) **smoke test en vivo** del child-process en Windows (`claude.cmd` + prompt por stdin) — es integración sin unit tests; (2) mostrar `lastResult`/`lastSummary` en la UI (el tipo ya los tiene; falta render + CSS, más útil tras el smoke test).

Replica las auditorías nocturnas ("de noche corren agentes que auditan y me dejan un resumen"). Hoy **no hay scheduler** (solo `setInterval` de polling). El bus **ya declara** `scheduleBlock` (Command) y `block.started` (Event) **sin handler ni recipe** (`bus-commands.ts:188` "llega en un hito futuro") → base ideal para reactivar.

- [ ] **C1 — Scheduler.** Nuevo `electron/integrations/scheduler.ts`: cron/RRULE + presets (hourly/daily/weekdays/weekly) + timezone. Persistencia `<ravenHome>/.raven-nest/automations.json`. Modelo: `{ id, name, schedule, prompt, repo, provider, enabled }`. Robustez de load igual a `recipes.ts` (ausente→[], ilegible→warn+[]).
- [ ] **C2 — Ejecución headless.** Al disparar: crear un worktree efímero (`worktree-create.ts`), correr el CLI del `provider` con el `prompt` (`pty-manager.ts`/`setup-runner.ts`), capturar output → resumen, limpiar el worktree. Sin intervención humana (pero la máquina tiene que estar prendida — igual que Orca).
- [ ] **C3 — Handler del bus.** Implementar el handler de `scheduleBlock` y emitir `block.started` al arrancar cada run; emitir un `error.detected`/resumen al terminar. Recipe default: run terminado → `notify` a Slack con el resumen + `logOutcome` a Calendar (reutiliza `GcalOutcomeSink`).
- [ ] **C4 — UI de automations.** Sección en `MyReposPanel.tsx` (nav interno ya tiene `SectionState`) o en el marketplace: crear/editar/togglear automations (nombre, schedule, prompt, repo, provider). Presets sugeridos: "auditar seguridad cada noche → Slack", "triage de issues 9am".
- **Aceptación / tests:** `scheduler.test.ts` (node): parse de cron/RRULE/presets, next-run, timezone, load robusto, dispatch emite `block.started`. Handler cubierto en `bus-commands.test.ts`.

## Épica D — Fan-out + Race-and-merge `H12` · esfuerzo L

El feature más "Orca-core": *"fan one prompt across N agents, merge the winner"*. Hoy solo existe **broadcast mode** (`App.tsx:86` — teclas a todos los panes del **mismo** workspace; no crea worktrees, no compara, no mergea). Partir en dos: D1 encaja limpio con integrations (ticket-loop); D2 es el grande.

- [ ] **D1 — Multi-issue → multi-worktree (lotes paralelos).** Seleccionar N tickets del ticket-loop (`TicketsBridge` / `ticket-loop.ts`) → crear N worktrees en paralelo, cada uno bindeado a su ticket (esto es el "Motor 3 / lotes paralelos" del spec, **no implementado**). Reutiliza `startWork` y `worktree-create`. **Puro integrations** — el diferencial es que arranca desde tickets reales del equipo.
- [ ] **D2 — Race same-prompt sobre N agentes.** Lanzar un prompt a N worktrees desde el mismo base ref, cada uno con un CLI (posiblemente distinto). Reutiliza worktree-create (crear N) + broadcast (mandar el prompt) + pty-manager (correr).
- [ ] **D3 — UI de comparación + merge/discard.** Ver los N diffs lado a lado, **merge del ganador / discard de perdedores** (git). Es la pieza nueva pesada. Reutilizar los componentes de worktree/diff existentes donde se pueda.
- [ ] **D4 — Puente a bus.** `pr.opened`/`pr.merged` ya existen; agregar señal de "race resuelto" → `notify`/`logOutcome` para que quede en el registro del equipo.
- **Aceptación / tests:** `worktree-integration.test.ts` extendido para D1 (N tickets → N worktrees). D2/D3 con tests de orquestación + componente de comparación.

## Higiene — follow-ups conocidos (esfuerzo XS)

- [x] **Recipes: swap-not-merge es INTENCIONAL (verificado 2026-08-15).** `loadRecipes` (`recipes.ts`): si el usuario tiene recetas stored válidas se usan **sólo esas** (no se mergean con las defaults). No es un bug — está documentado en `recipes.ts` (~L311-316: "same swap-not-merge semantics"). El follow-up queda cerrado: es una decisión de diseño, no requiere cambio.
- [x] **checkCi/worktree-signals: set-antes-de-emit es INTENCIONAL (verificado 2026-08-15).** En `worktree-signals.ts:166-169` el `ciNotified.set` + `saveNotified()` van **antes** del `emit` de `ci.failed`. Prioriza no-duplicar sobre no-perder (si el emit fallara, ese SHA queda marcado y no se re-emite), con persistencia tmp+rename. No es un bug — trade-off deliberado. Follow-up cerrado.
- [ ] **Cablear estados nuevos a las recipes default** de forma consistente (A5/B4/C3) para que el marketplace de recipes (bus v2, `StoredRecipe` editable) las exponga.

## Fuera de scope (conceder explícitamente)

Perseguir esto en la cancha de Orca funde al equipo chico y **no** es nuestro wedge:

- **App mobile companion (iOS/Android).** Además Orca la tiene atada al desktop prendido (no corre agentes en la nube) — no es el foso que parece.
- **Worktrees remotos SSH/VPS.**
- **Paridad de marketplace de 30+ CLIs.** (Bring-your-own ya es table stakes; no competir por cantidad.)

**Watch-list (si Orca shippea esto, se angosta nuestro foso):** (1) colaboración humana real, (2) un "Orca Cloud" que corra agentes sin el desktop. Hoy **ninguno existe**.
