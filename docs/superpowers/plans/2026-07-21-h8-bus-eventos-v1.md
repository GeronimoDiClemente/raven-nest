# H8 — Bus de eventos v1 (local) + Motor 1 como primer ciudadano

**Fecha:** 2026-07-21 · **Rama:** `feat/integrations` (base `bf0f49d`) · **Estado:** plan aprobado para ejecución autónoma
**Spec:** `docs/superpowers/specs/2026-07-11-integrations-task-loop-design.md` (§2 "4 motores + bus", §3 hito H8)

## Objetivo

Construir el **bus de eventos** que la spec pone como "capa enterprise": los adapters y el core
emiten **eventos estándar**, y **recetas** (event→comandos) los enrutan a **comandos estándar** que
ejecutan los adapters. Cablear el **Motor 1 (ticket loop)** como primer emisor/consumidor real, sin
regresionar H3. Todo **credential-free y unit-testeable** — los comandos que necesitan red real
(Slack notify, etc.) se testean con `fetch` fake; el end-to-end con credenciales queda para cuando
haya tokens.

Al terminar: `npm test` verde, el bus enruta los eventos del ticket loop por recetas por defecto que
**replican** el comportamiento actual (PR abierto→in_review, merge→done), y un test de integración
demuestra "integrations con todos los buses" disparando una secuencia de eventos y verificando los
comandos resultantes.

## Arquitectura existente (del mapa, para no reinventar)

- Motor y providers en **`electron/`** (no `src/main`). `TicketLoop` + singleton `ticketLoop` en
  **`electron/ticket-loop.ts`**. Choke-points: `startWork` (`:105`) y `onPrStateChanged` (`:160`) —
  HOY es el único lugar donde "PR abierto/mergeado" se materializa y dispara `provider.transition`.
- Providers implementan `TicketProvider { listMyTickets, transition }` (`electron/integrations/ticket-types.ts:19`).
  `TicketState = 'todo'|'in_progress'|'in_review'|'done'`.
- Poll de PRs por branch: `setInterval` en `electron/main.ts:2323-2327`, `TICKET_POLL_MS=90_000`,
  recorre `ticketLoop.trackedRepos()` → `ticketLoop.pollOnce(repo, panelDeps())`.
- Deps inyectadas (tokens nunca salen del main): `panelDeps() = { getToken, getConfig, fetch }`
  (`main.ts:2265`). `getToken(id)` = `pluginCreds.getToken(id)`.
- Persistencia del loop: `<ravenHome>/.raven-nest/ticket-loop.json` (patrón para `recipes.json`).
- Panel adapters: `callPanel(pluginId, method, args, deps)` (`electron/integration-panels.ts:116`) —
  patrón de routing (pluginId, method, args)→adapter que el bus imita para los comandos.
- Tests: **vitest**, `npm test` = `vitest run`. Project `node` corre `electron/__tests__/**`.
  Patrón: `new TicketLoop()` + `loop.register('jira', () => provider)` con `provider` de `vi.fn`,
  deps con `fetch: vi.fn` devolviendo `new Response(JSON.stringify(...), {status})`. Ver
  `electron/__tests__/ticket-loop.test.ts`. `resetPanelAdapters()` limpia el registry global.
  **101 tests de integraciones verdes hoy — no regresionar.**

## Reglas de ejecución (para cada task)

1. **TDD**: escribir el test que falla → implementar → test verde.
2. Correr **`npm test`** completo antes de commitear. Si algo que pasaba antes se rompe, es regresión → arreglar, no commitear roja.
3. **Commit por task** (español, prefijo `feat(bus):` / `test(bus):`), con trailer
   `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
4. **NO pushear** (lo hace el humano tras revisar). **NO tocar** archivos del rebrand
   (AuthScreen, AuthArt, fonts, brandLogos, `.nx-*` de global.css) — viven en `feat/login-redesign`.
5. Tokens/red: SOLO vía `deps` inyectadas; nada hardcodeado. El repo es público — cero secretos.

---

### T1 — Tipos de eventos y comandos
**Create:** `electron/integrations/bus-types.ts` · **Test:** `electron/__tests__/bus-types.test.ts`

- `DomainEvent` (unión discriminada por `type`): `task.created` `{taskId, pluginId, providerId, repoFullName|null, branch, title?}`,
  `session.opened` `{branch, repoPath, pluginId?, providerId?}`, `session.closed` `{branch}`,
  `pr.opened` `{branch, repoFullName}`, `pr.merged` `{branch, repoFullName}`,
  `ci.failed` `{branch, repoFullName, runUrl?, summary?}`, `error.detected` `{source, ref, summary}`,
  `block.started` `{taskId?, label}`, `meeting.transcribed` `{title, items: string[]}`.
- `Command` (unión discriminada por `cmd`): `createTask` `{pluginId, title, body?}`,
  `openSession` `{pluginId?, providerId?, branch?, repoFullName?, context?}`,
  `notify` `{channel, message, buttons?: {label,action}[]}`,
  `updateStatus` `{pluginId, providerId, to: TicketState}`,
  `logOutcome` `{ref, summary}`, `scheduleBlock` `{when, label}`.
- Guards runtime mínimos: `isDomainEvent(x)`, `isCommand(x)`. Reusar `TicketState` de `ticket-types.ts`.

### T2 — EventBus (routing por recetas)
**Create:** `electron/integrations/event-bus.ts` · **Test:** `electron/__tests__/event-bus.test.ts`

- `type CommandHandler = (cmd: Command, ev: DomainEvent, deps: PanelAdapterDeps) => Promise<void>`.
- `class EventBus`:
  - `registerHandler(cmd: Command['cmd'], handler: CommandHandler)`.
  - `setRecipes(recipes: Recipe[])` (de T3).
  - `async emit(ev: DomainEvent, deps): Promise<Command[]>` — resuelve recetas que matchean `ev`,
    genera los comandos, invoca el handler de cada uno **best-effort** (un handler que tira NO
    interrumpe a los demás ni al emit; loguear vía `console.warn` con contexto). Devuelve los comandos
    disparados (para test/observabilidad).
  - Sin dependencias de Electron (testeable en node puro). Sin estado global (instancia inyectable).
- Tests: emit sin recetas → []; emit con receta → handler llamado con el comando resuelto; handler que
  tira → los otros igual corren y emit no rechaza; orden de comandos preservado.

### T3 — Motor de recetas
**Create:** `electron/integrations/recipes.ts` · **Test:** `electron/__tests__/recipes.test.ts`

- `interface Recipe { id: string; when: DomainEvent['type']; match?: (ev)=>boolean; then: (ev)=>Command[] }`
  (`then` como función del evento para resolver params — p.ej. mapear `ev.branch`→ticket trackeado).
- `DEFAULT_RECIPES` que **replican H3**:
  - `pr.opened` → `updateStatus(to:'in_review')` (resolviendo pluginId/providerId del tracking del branch).
  - `pr.merged` → `updateStatus(to:'done')`.
  - `task.created` → (v1 no-op o `notify` opcional; dejar comentado el gancho).
- `loadRecipes(filePath)` / `saveRecipes(filePath, recipes)` (JSON en `<ravenHome>/.raven-nest/recipes.json`,
  escritura atómica tmp+rename como `plugin-credentials.ts:33`). Si el archivo no existe → `DEFAULT_RECIPES`.
- **La resolución branch→ticket** necesita el tracking del `TicketLoop`; pasar un lookup
  `(branch)=>Tracked|undefined` a las recetas por defecto (inyección, no import global).
- Tests: default recipes matchean los tipos correctos; `then(ev)` produce el comando con los campos
  resueltos; load inexistente → defaults; round-trip save/load.

### T4 — Cablear TicketLoop al bus (sin regresionar H3)
**Modify:** `electron/ticket-loop.ts` · **Test:** ampliar `electron/__tests__/ticket-loop.test.ts`

- `TicketLoop` acepta un `bus?: EventBus` opcional (constructor o setter `attachBus`).
- `onPrStateChanged`: en vez de llamar `provider.transition` directo, **emitir** `pr.opened`/`pr.merged`
  por el bus. El handler `updateStatus` (registrado en T5/main) hace la transición. **Preservar** el
  guard `lastPr` (no re-emitir `in_review`) y el borrado de tracking en merge.
- `startWork`: emitir `task.created` + `session.opened` además de (o en vez de) la transición directa a
  `in_progress`. Mantener la transición `in_progress` (es sincrónica y esperada por los tests) — puede
  quedar directa O vía un `updateStatus` emitido; elegir lo que deje los 101 tests verdes.
- **Compat**: si `bus` es `undefined` (tests viejos que construyen `new TicketLoop()` sin bus),
  mantener el comportamiento actual (transición directa). Así los tests existentes no cambian.
  Los tests nuevos construyen el loop CON bus y verifican que se emiten los eventos correctos.
- Correr `npm test` — **los 101 deben seguir verdes** + los nuevos.

### T5 — Handlers de comandos
**Create:** `electron/integrations/bus-commands.ts` · **Test:** `electron/__tests__/bus-commands.test.ts`

- `registerBusCommands(bus, { ticketLoop, worktreeStore?, ... })` que registra:
  - `updateStatus` → `provider.transition(providerId, to)` (resolviendo el provider vía el pluginId del
    tracking; reusar la lógica de `ticketLoop`). **Real y testeable.**
  - `openSession` → gancho al path de "Work on this" (crear worktree + `.nest/TASK.md`); en v1 puede
    delegar a un callback inyectado (el wiring real de worktree:create vive en main). Testeable con fake.
  - `notify` → adapter Slack: `POST chat.postMessage` con `deps.getToken('slack')`. **Testeable con
    `fetch` fake**; si no hay token, no-op con warn (no romper el bus).
  - `createTask` → si el provider soporta crear (Jira/Linear), llamar; si no, no-op con warn. Testeable.
- Best-effort: ningún handler que falle debe romper el emit (ya garantizado por T2, pero los handlers
  no deben tirar por token ausente — degradar con warn).

### T6 — Test de integración "todos los buses"
**Test:** `electron/__tests__/bus-integration.test.ts` · **(opcional)** `electron/integrations/bus-demo.ts`

- Armar `EventBus` real + `DEFAULT_RECIPES` + handlers espiados (`vi.fn`), tracking fake de un branch.
- Emitir la secuencia: `task.created` → `pr.opened` → `pr.merged` y **assert** que se dispararon los
  comandos correctos en orden (`updateStatus in_review`, luego `updateStatus done`), con los IDs del
  tracking resueltos. Este test ES la demostración de "integrations con todos los buses".
- (Opcional) `bus-demo.ts`: función pura `runBusDemo()` que arma el bus con handlers que logean, para
  correr desde un script y ver el enrutamiento. No se cablea a la UI en este hito.

### T7 — Registro en main (mínimo, guardado) — *stretch*
**Modify:** `electron/main.ts` (junto a `main.ts:2254-2327`)

- Instanciar `const bus = new EventBus()`, `bus.setRecipes(loadRecipes(recipesPath))`,
  `registerBusCommands(bus, { ticketLoop, ... })`, `ticketLoop.attachBus(bus)`. Un solo bloque, junto al
  wiring existente del ticket loop. Sin cambiar la firma del poll. Smoke: `npm run build` compila.
- Si el riesgo de tocar `main.ts` es alto para un agente, **dejar T7 documentado como el único paso
  manual pendiente** y NO forzarlo — el bus + tests (T1-T6) ya prueban la lógica.

### T8 — Motor 3: señal CI (ci.failed) en el poll — *stretch*
**Modify:** `electron/ticket-loop.ts` (`pollOnce`) · **Test:** ticket-loop.test.ts

- Extender `pollOnce` para consultar checks del PR (`GET /repos/{repo}/commits/{sha}/check-runs` o
  `/commits/{ref}/status`) y, si hay fallo en el branch propio, emitir `ci.failed` por el bus.
  Receta futura: `ci.failed → notify` (+ botón "que el agente arregle el rojo" con el log). Testeable
  con `fetch` fake. Solo GitHub (como el resto de la inferencia v1).

---

## Fuera de alcance de esta noche (necesitan credenciales / research por tanda) → plan aparte

- **Motor 4 real** (Slack DM accionable end-to-end, status/DND) — H5. Requiere token Slack + verificación de UX.
- **Motor 2 real** (Notion/Confluence/GDocs → `.nest/spec.md`) — H5. Requiere apiKey y research de render de blocks.
- **H6 Calendar** (OAuth loopback+PKCE, verificación Google, extended properties).
- **H7 `@Nest` desde Slack** (mención→worktree+agente asignable).
- **Bus v2**: recetas compartidas por team (Supabase RLS por team) + UI de recetas (JSON editable primero).

## Verificación final

- `npm test` verde (101 previos + nuevos).
- `npm run build` compila (typecheck de electron-vite).
- El test de integración T6 demuestra el enrutamiento evento→comando.
- Reporte de qué tasks entraron, cuáles quedaron, y el estado de `feat/integrations` (commits locales, sin pushear).
