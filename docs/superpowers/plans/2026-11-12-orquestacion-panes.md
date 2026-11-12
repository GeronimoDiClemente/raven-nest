# Orquestación de panes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un agente en un pane de Nest lanza workers como panes visibles del mismo tab, cada uno en su rama + worktree, se entera solo de lo que reportan, y Gero revisa y decide cada rama.

**Architecture:** Un subsistema nuevo `electron/orchestration/`, independiente de Memories: socket local propio con **token por pane**, un shim MCP stdio propio (`electron/orchestration-mcp/`), un servicio en main que tiene el estado (coordinadores, workers, bandeja) y le pide al renderer que agregue/cierre panes. El aviso al coordinador es un puntero de una línea escrito en su PTY cuando está quieto (portado de Orca). La revisión es un panel en el renderer con Diff / Merge / PR / Discard.

**Tech Stack:** Electron main (Node, `net`, `crypto`), node-pty vía `PtyManager`, React + shadcn/Tailwind en el renderer, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-orquestacion-panes-design.md` (leerlo entero antes de empezar; las secciones se citan como §N).

**Dónde se trabaja:** worktree propio que sale de `feat/memories-settings` (NO de main, NO en la carpeta compartida):
`git worktree add ../raven-nest-orq -b feat/orquestacion-panes feat/memories-settings`. Nunca `git clean` ni cambio de rama en `/Users/geronimodiclemente/RavenProjects/raven-nest`.

## Global Constraints

- UI en inglés: etiquetas, botones, mensajes al agente, textos de error.
- Componentes nuevos con shadcn (`src/components/ui/*`) + utilidades Tailwind; **ninguna clase nueva en `global.css`**. Cada cambio de UI pasa `e2e/04-contraste.spec.ts`.
- Color por worker = leyenda categórica (allow-list, §5); estado del worker sólo con `--ok`/`--warn`/`--destructive`.
- **La UI de orquestación se ve como Memories** [Gero, 12-nov]. Antes de escribir un componente, leer `src/components/MemoriesStatusRow.tsx`, `MemoriesItem.tsx`, `MemoriesWorkspace.tsx` y `src/components/memories/settings/` (`SettingsSection`, `SettingRow`) y reusar su vocabulario: `Badge variant="outline"` con punto + texto y `text-ok`/`text-warn`/`text-destructive` para estado; `microlabel text-muted-foreground` para etiquetas; `font-mono tabular-nums` para números (diffstat, contadores); fila de estado chica arriba; secciones con `SettingsSection`/`SettingRow`. Las clases que ya existen en `global.css` para Memories se pueden reusar; no se crean nuevas. Si algo de Memories se repite tal cual, extraerlo a un componente compartido en vez de copiarlo.
- El trabajo se hace sobre la rama de Memories: el worktree sale de `feat/memories-settings` y la integración vuelve a `feat/memories-settings` (la hace la sesión dueña de esa carpeta). Antes de Tasks 8 y 9, `git merge feat/memories-settings` en el worktree para tomar los últimos cambios visuales de Memories.
- Orquestación funciona con Memories apagado, desconectado o `memory === null` (§6.8). Ningún import de `memory-*` en `electron/orchestration/` salvo utilidades puras (`writeFileAtomic`, `quoteShellArg`).
- Límites: máx **4** workers vivos por coordinador; sin anidar; **12** panes por tab (`MAX_PANES`, `src/types.ts:19`) (§6.5).
- Nest nunca agrega ni saca flags de permisos al comando del agente (§6.3).
- Nada llega a main sin un click de Gero (§4).
- Código portado de Orca/T3 conserva su aviso MIT en cabecera y se lista en `THIRD_PARTY_NOTICES.md` (§7.1).
- Typecheck = `npx tsc -p tsconfig.node.json --noEmit --composite false` **y** `npx tsc -p tsconfig.web.json --noEmit --composite false`, los dos exit 0. Nunca `tsc -b`.
- Tests: `npx vitest run <archivo>`; leer la línea de resumen (`Tests N passed`), el exit code de vitest no alcanza. Antes de un e2e: `npm run build` (los e2e corren contra `dist/`) y `npm run native:electron`.

## Review Focus

1. **Gero tecleando en el coordinador cuando toca el puntero** → el puntero nunca se intercala con su borrador ni se manda su Enter (Task 6: `no escribe con borrador pendiente`).
2. **El coordinador se cierra con un puntero a medio entregar o workers vivos** → no se escribe a un PTY muerto; se matan los workers, quedan ramas (Task 5: `stopCoordinator mata workers y conserva ramas`; Task 6: `cancela entregas del coordinador muerto`).
3. **Token de un pane ya cerrado o de otro pane** → `unauthorized`, nunca actúa sobre otro coordinador (Task 1, Task 2: `rechaza token revocado`).
4. **Dos workers con la misma etiqueta** → ramas distintas, sin reusar el worktree del primero (Task 5: `misma etiqueta da ramas distintas`).
5. **Reinicio de Nest con workers terminados sin decidir** → aparecen en el panel de revisión al volver (Task 9: `review store sobrevive reinicio`).

---

### Task 1: Tokens por pane

**Files:**
- Create: `electron/orchestration/pane-tokens.ts`
- Test: `electron/__tests__/orchestration-pane-tokens.test.ts`

Portado del modelo de T3 `apps/server/src/mcp/McpSessionRegistry.ts` (reescrito sin Effect, con cabecera MIT de T3 Tools Inc.).

**Interfaces:**
- Produces:
  - `class PaneTokenRegistry { issue(paneId: string): string; resolve(token: string): string | null; revoke(paneId: string): void; revokeAll(): void }`
  - Token = 32 bytes `randomBytes` en base64url; se guarda sólo `sha256(token)` → paneId. `issue` para un pane que ya tenía token revoca el anterior.

- [ ] **Step 1: Write the failing tests** — `issue+resolve devuelve el paneId`; `resolve de un token inventado da null`; `revoke invalida el token`; `reissue invalida el anterior`; `no guarda el token en claro` (inspeccionar el Map interno por un getter de test `_hashesForTest()`: no contiene el token).
- [ ] **Step 2: Run** `npx vitest run electron/__tests__/orchestration-pane-tokens.test.ts` → FAIL (módulo no existe).
- [ ] **Step 3: Implement `PaneTokenRegistry`** con `crypto.randomBytes`, `createHash('sha256')`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(orquestacion): tokens por pane`.

### Task 2: Protocolo y socket de orquestación

**Files:**
- Create: `electron/orchestration/protocol.ts`, `electron/orchestration/orchestration-ipc-server.ts`
- Test: `electron/__tests__/orchestration-ipc-server.test.ts`

Mismo framing que `electron/memory-ipc-server.ts` (una línea JSON por request, `MAX_LINE_BYTES` 1 MiB, socket `0o600`, unlink de socket viejo), pero server distinto y socket distinto: `<ravenHome>/.raven-nest/orchestration.sock` (Windows: `\\.\pipe\nest-orchestration-<uid>`, como resuelva `memory-local-auth.ts` el suyo).

**Interfaces:**
- Produces (`protocol.ts`):
  ```ts
  export type OrchMethod =
    | 'worker.launch' | 'worker.list' | 'worker.read' | 'worker.send' | 'worker.stop'
    | 'inbox.read' | 'inbox.wait' | 'worker.report'
  export interface OrchRequest { id: string; method: OrchMethod; params: unknown; token: string }
  export type OrchResponse = { id: string; ok: true; result: unknown } | { id: string; ok: false; error: string }
  export interface LaunchParams { task: string; label: string; agent?: 'claude' | 'codex' }
  export interface ReportParams { kind: 'done' | 'question' | 'blocked'; text: string }
  export interface SendParams { workerId: string; text: string }
  export interface StopParams { workerId?: string }   // sin workerId = todos
  export interface WaitParams { timeoutMs?: number }  // default 60_000, máx 240_000 (T3: fetch corta a 300 s)
  ```
  Errores como strings fijos: `unauthorized`, `not_a_coordinator`, `nesting_not_allowed`, `worker_limit` , `tab_full`, `no_account_for_agent`, `worktree_dirty`, `unknown_worker`.
- Produces (`orchestration-ipc-server.ts`):
  `class OrchestrationIpcServer { constructor(deps: { socketPath: string; tokens: PaneTokenRegistry; handle: (callerPaneId: string, method: OrchMethod, params: unknown) => Promise<unknown> }); start(): void; stop(): void }`
  El `callerPaneId` sale **sólo** de `tokens.resolve(request.token)`; cualquier `paneId` en `params` se ignora.
- Consumes: `PaneTokenRegistry` (Task 1).

- [ ] **Step 1: Write the failing tests** (socket en tmpdir, cliente `net.connect`): `rechaza sin token` → `{ok:false,error:'unauthorized'}`; `rechaza token revocado`; `pasa el paneId resuelto a handle` (handle espía recibe el paneId del token aunque params traiga `paneId:'otro'`); `error de handle vuelve como ok:false con el mensaje`; `línea de más de 1 MiB cierra la conexión`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** copiando `handleConnection`/`handleLine` de `memory-ipc-server.ts:231-285` sin el resto.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(orquestacion): socket con token por pane`.

### Task 3: Estado de orquestación (lógica pura)

**Files:**
- Create: `electron/orchestration/orchestration-state.ts`
- Test: `electron/__tests__/orchestration-state.test.ts`

Sin IO. Tiene coordinadores, workers y la bandeja. La máquina de entrega se porta de Orca `mailbox/terminal-pointer/mailbox-pointer-state.ts` (cabecera MIT Lovecast Inc.).

**Interfaces:**
- Produces:
  ```ts
  export type WorkerStatus = 'starting' | 'working' | 'needs_input' | 'done' | 'exited' | 'stopped'
  export interface WorkerRecord {
    workerId: string; coordinatorPaneId: string; paneId: string; label: string; colorIndex: number
    branch: string; worktreePath: string; baseBranch: string; agent: string; status: WorkerStatus
    createdAt: number; finishedAt?: number
  }
  export type InboxKind = 'done' | 'question' | 'blocked' | 'exited' | 'waiting_permission'
  export interface InboxMessage { msgId: string; workerId: string; kind: InboxKind; text: string; at: number; delivery: 'pending' | 'pointed' | 'delivered' }
  export class OrchestrationState {
    canLaunch(coordinatorPaneId: string, tabPaneCount: number): { ok: true } | { ok: false; error: 'nesting_not_allowed' | 'worker_limit' | 'tab_full' }
    addWorker(w: Omit<WorkerRecord, 'colorIndex' | 'status' | 'createdAt'>, now: number): WorkerRecord
    workerByPane(paneId: string): WorkerRecord | undefined
    workersOf(coordinatorPaneId: string): WorkerRecord[]
    setStatus(workerId: string, s: WorkerStatus, now: number): void
    push(workerId: string, kind: InboxKind, text: string, now: number): InboxMessage  // msgId estable (uuid)
    pending(coordinatorPaneId: string): InboxMessage[]          // delivery !== 'delivered', FIFO
    markPointed(coordinatorPaneId: string): void
    markDelivered(coordinatorPaneId: string): InboxMessage[]     // devuelve los que entregó
    dropCoordinator(coordinatorPaneId: string): WorkerRecord[]   // saca todo y devuelve los workers
  }
  ```
  `colorIndex`: el menor índice 0..3 que no use otro worker **vivo** del mismo coordinador. Un pane que es worker no puede ser coordinador (`nesting_not_allowed`). `worker_limit` cuenta workers con status `starting|working|needs_input`. `tab_full` si `tabPaneCount >= 12`.

- [ ] **Step 1: Write the failing tests**: `quinto worker vivo da worker_limit`; `worker terminado libera cupo y color`; `un worker no puede lanzar` → `nesting_not_allowed`; `tab con 12 panes da tab_full`; `pending es FIFO y markDelivered los vacía`; `push después de markPointed vuelve a dejar pendiente`; `dropCoordinator devuelve sus workers y borra su bandeja`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(orquestacion): estado de workers y bandeja`.

### Task 4: Prompts portados

**Files:**
- Create: `electron/orchestration/prompts.ts`, `THIRD_PARTY_NOTICES.md`
- Test: `electron/__tests__/orchestration-prompts.test.ts`

Fuentes: Orca `src/main/runtime/orchestration/workers/launch/worker-dispatch-preamble.ts` y `skill-guides/orchestration.md`; T3 `packages/provider-core/src/server/orchestrationInstructions.ts`. Adaptar nombres de tools a los de Task 7. Usar los 42 casos de T3 `evals/mcp-tool-use/cases/orchestration.ndjson` como checklist al redactar (no se ejecutan).

**Interfaces:**
- Produces:
  - `export const COORDINATOR_INSTRUCTIONS: string` — va al `instructions` del `initialize` MCP. Debe decir: lanzá un worker por tarea independiente; **después de lanzar, terminá tu turno: Nest te despierta; no hagas polling ni scripts que esperen**; cuando llegue un puntero llamá `nest_inbox`; al terminar todos, resumile al usuario cada rama (qué hizo, rama, commits); nunca merges ni push a main.
  - `export function workerPreamble(p: { label: string; branch: string; baseBranch: string; task: string }): string` — trabajás en `branch` (salió de `baseBranch`); commiteá antes de reportar; reportá una sola vez con `nest_report` (`done`/`question`/`blocked`); no uses la herramienta de preguntas al usuario, preguntá con `nest_report question`; después de `done` quedate quieto; no merges ni push a main. Termina con la tarea literal.
  - `export function pointerLine(n: number): string` → `` `You have ${n} worker message${n === 1 ? '' : 's'}. Call nest_inbox.` `` (§6.9).

- [ ] **Step 1: Write the failing tests**: `instrucciones prohíben polling` (contiene `end your turn` y `do not poll`); `preámbulo nombra rama y base`; `preámbulo exige commit antes de done`; `preámbulo termina con la tarea literal`; `pointerLine singular y plural`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; cabecera MIT de Orca y de T3 en `prompts.ts`; `THIRD_PARTY_NOTICES.md` con el texto MIT completo de ambos y la lista de archivos portados (se va completando en Tasks 3, 6, 8).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(orquestacion): prompts de coordinador y worker`.

### Task 5: Servicio de orquestación (launch, report, stop)

**Files:**
- Create: `electron/orchestration/orchestration-service.ts`, `electron/orchestration/branch-name.ts`
- Modify: `electron/main.ts` — extraer `createWorktreeForBot` (`main.ts:2031`) a `electron/worktree-create.ts` como `createWorktreeFromHead(repoPath, branch)` exportada; main.ts la importa.
- Test: `electron/__tests__/orchestration-service.test.ts`

**Interfaces:**
- Consumes: `OrchestrationState` (Task 3), `workerPreamble`, `COORDINATOR_INSTRUCTIONS` (Task 4), protocolo (Task 2).
- Produces:
  ```ts
  export interface PaneInfo { paneId: string; cmd: string; accountDir: string; aiType: string; cwd: string }
  export interface OrchestrationDeps {
    paneInfo(paneId: string): PaneInfo | undefined                       // de PtyManager (Task 7)
    defaultAccount(aiType: string): { accountDir: string; cmd: string; accountName: string } | null
    createWorktree(repoPath: string, branch: string): Promise<{ ok: true; worktreePath: string } | { ok: false; error: string }>
    currentBranch(repoPath: string): Promise<string>
    isClean(worktreePath: string): Promise<boolean>                      // git status --porcelain vacío
    requestPane(req: LaunchPaneRequest): Promise<{ ok: true; tabPaneCount: number } | { ok: false; error: 'tab_full' | 'no_tab' }>
    closePane(paneId: string): void
    killPane(paneId: string): void
    writePty(paneId: string, data: string): void
    now(): number
    onChange(): void                                                     // avisa al renderer
  }
  export interface LaunchPaneRequest {
    coordinatorPaneId: string; paneId: string; aiType: string; accountName: string; accountDir: string
    cmd: string; repoPath: string; label: string; colorIndex: number; initialInput: string; workerId: string
  }
  export class OrchestrationService {
    constructor(deps: OrchestrationDeps)
    handle(callerPaneId: string, method: OrchMethod, params: unknown): Promise<unknown>  // se pasa a OrchestrationIpcServer
    onPaneExit(paneId: string, exitCode: number): void
    onAgentNeedsInput(paneId: string): void                               // Task 6 lo llama
    stopCoordinator(paneId: string): void
    snapshot(): WorkerRecord[]
  }
  export function branchName(label: string, workerId: string): string    // `nest/<slug(label)>-<workerId.slice(0,6)>`
  ```
  Reglas (§6.2–6.6):
  - `worker.launch`: agente = `params.agent ?? info.aiType`; mismo agente → `info.cmd` y `info.accountDir` **sin tocar**; otro agente → `defaultAccount(agent)` o `no_account_for_agent`. Base = `currentBranch(info.cwd)`; worktree desde `info.cwd` (HEAD del coordinador). Devuelve `{ workerId, branch, label }`.
  - `worker.report` desde un pane worker: `done` exige `isClean` → si no, error `worktree_dirty` (el worker lo ve y commitea). `done` → status `done`, `push`, `closePane` lo programa Task 8 (no acá: el servicio emite `onChange` y el renderer arranca el banner de 2 min). `question`/`blocked` → status `needs_input`, `push`.
  - `worker.send` → `writePty(worker.paneId, text)` + `\r` a los 500 ms (mismo helper que Task 6).
  - `inbox.read` → `markDelivered`. `inbox.wait` → resuelve con el primer mensaje pendiente o `{timedOut:true}` al `timeoutMs`.
  - `onPaneExit`: si es worker sin `done` → status `exited`, `push(…,'exited', 'exit code N')`; si es coordinador → `stopCoordinator`.
  - `stopCoordinator` → `killPane` + `closePane` de cada worker vivo, `dropCoordinator`. **No** borra worktrees ni ramas.

- [ ] **Step 1: Write the failing tests** con deps falsas: `launch usa cmd y accountDir del coordinador sin cambios`; `launch con otro agente usa su cuenta por defecto`; `launch con agente sin cuenta da no_account_for_agent`; `misma etiqueta da ramas distintas`; `done con worktree sucio da worktree_dirty y no cambia status`; `done limpio deja status done y mensaje pendiente`; `params.paneId ajeno se ignora` (caller = token); `worker que muere sin done genera exited`; `stopCoordinator mata workers y conserva ramas` (no llama a nada que borre worktree); `cerrar el pane coordinador dispara stopCoordinator`; `inbox.wait vence con timedOut`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; extraer `createWorktreeFromHead` sin cambiar su comportamiento (los tests de `worktree-create` existentes siguen verdes).
- [ ] **Step 4: Run** test nuevo + `npx vitest run electron/__tests__/worktree` → PASS.
- [ ] **Step 5: Commit** `feat(orquestacion): servicio de workers`.

### Task 6: Entrega del puntero al coordinador

**Files:**
- Create: `electron/orchestration/pointer-delivery.ts`
- Modify: `electron/integrations/agent-status.ts` (ya exporta `detectNeedsInput`; no cambia)
- Test: `electron/__tests__/orchestration-pointer-delivery.test.ts`

Portado de Orca `mailbox/terminal-pointer/` (`-eligibility.ts`, `-delivery.ts`, `-stage.ts`, `-submit.ts`) con cabecera MIT. Simplificación de Nest [decisión del plan]: el "borrador sin enviar" no se lee de un screen model; se infiere de lo que el **usuario** escribió por `pty:write` desde el último `\r`.

**Interfaces:**
- Consumes: `OrchestrationState.pending/markPointed` (Task 3), `pointerLine` (Task 4), `detectNeedsInput`.
- Produces:
  ```ts
  export interface PointerDeps {
    now(): number; setTimer(fn: () => void, ms: number): () => void
    writePty(paneId: string, data: string): void
    bufferTail(paneId: string): string; lastOutputAt(paneId: string): number | null; isAlive(paneId: string): boolean
  }
  export class PointerDelivery {
    constructor(deps: PointerDeps, state: OrchestrationState)
    notify(coordinatorPaneId: string): void        // hay mensaje nuevo
    onUserInput(paneId: string, data: string): void // desde pty:write del renderer
    onOutput(paneId: string): void
    cancel(coordinatorPaneId: string): void
  }
  export const QUIET_MS = 3_000, ENTER_DELAY_MS = 500, RECHECK_MS = 2_000, DRAFT_HOLD_MAX_MS = 600_000
  ```
  Entregable si: `isAlive`, `now - lastOutputAt >= QUIET_MS` (o nunca hubo output), `!detectNeedsInput(bufferTail)`, y sin borrador (no hubo input del usuario sin `\r` posterior, o pasaron `DRAFT_HOLD_MAX_MS`). Si no, reintenta a `RECHECK_MS`. Entrega = `writePty(pointerLine(n))`, `markPointed`, y `ENTER_DELAY_MS` después **re-chequea** (borrador o diálogo nuevo → difiere el `\r` al próximo chequeo); luego `writePty('\r')`. Un solo puntero en vuelo por coordinador; mensajes que llegan mientras tanto no generan otro (el número lo da `inbox.read`).
  Los workers usan el mismo helper para `needs_input`: `PointerDelivery` también expone `watchWorker(paneId, onNeedsInput)` que llama `onNeedsInput` cuando `detectNeedsInput` + quieto, una vez por episodio → `OrchestrationService.onAgentNeedsInput` → mensaje `waiting_permission` (§6.4).

- [ ] **Step 1: Write the failing tests** (reloj y timers falsos): `entrega cuando lleva 3 s quieto`; `no entrega con output reciente y reintenta`; `no escribe con borrador pendiente`; `entrega después de que el usuario manda Enter`; `no entrega con prompt de permiso en pantalla`; `Enter va 500 ms después del texto`; `difiere el Enter si apareció un borrador en esos 500 ms`; `un solo puntero en vuelo`; `cancela entregas del coordinador muerto` (isAlive false → nunca escribe); `watchWorker avisa una vez por episodio`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(orquestacion): aviso al coordinador por puntero`.

### Task 7: Inyección en el PTY y shim MCP

**Files:**
- Create: `electron/orchestration-mcp/index.ts`, `electron/orchestration-mcp/tools.ts`, `electron/orchestration-mcp/client.ts`, `electron/orchestration/mcp-launch-args.ts`
- Modify: `electron/pty-manager.ts:144-330` (create), `electron.vite.config.ts:25` (entry `orchestration-mcp`)
- Test: `electron/__tests__/orchestration-mcp-tools.test.ts`, `electron/__tests__/pty-manager-orchestration.test.ts`

**Interfaces:**
- Produces (`tools.ts`): `TOOL_MANIFEST` con `nest_launch_worker {task, label, agent?}`, `nest_inbox {}`, `nest_wait {timeoutMs?}`, `nest_list_workers {}`, `nest_read_worker {workerId}`, `nest_send_worker {workerId, text}`, `nest_stop_worker {workerId?}`, `nest_report {kind, text}`; y `toolToMethod(name): OrchMethod`. Descripciones adaptadas de T3 `apps/server/src/mcp/toolkits/orchestrator/tools.ts`; `nest_launch_worker` repite "after launching, end your turn".
- Produces (`index.ts`): server MCP stdio con el mismo JSON-RPC a mano que `electron/memory-mcp/servidor.ts` (`initialize` con `instructions: COORDINATOR_INSTRUCTIONS`, `tools/list`, `tools/call`). Lee `NEST_ORCH_SOCKET`/`NEST_ORCH_TOKEN`. `client.ts` = `memory-mcp/client.ts` sin el retry de `store_swapping`, timeout = `WaitParams.timeoutMs + 5_000` para `inbox.wait`, 5 s el resto.
- Produces (`mcp-launch-args.ts`): `orchestrationLaunchArgs(bin: string, paths: { execPath: string; shimPath: string; configDir: string }): string[]`
  - `claude` → `['--mcp-config', <configDir>/orchestration-mcp.json]` (archivo `{mcpServers:{nest_orchestration:{command, args:[shimPath], env:{ELECTRON_RUN_AS_NODE:'1'}}}}`, escrito con `writeFileAtomic`).
  - `codex` → `['-c', "mcp_servers.nest_orchestration.command='<execPath>'", '-c', "mcp_servers.nest_orchestration.args=['<shimPath>']", '-c', "mcp_servers.nest_orchestration.env.ELECTRON_RUN_AS_NODE='1'"]`.
  - otro bin → `[]` (Gemini/Qwen/OpenCode quedan fuera de esta entrega).
- Modify `PtyManager`:
  - `setOrchestration(o: { socketPath: string; tokens: PaneTokenRegistry; launchArgs: (bin: string) => string[] }): void`
  - En `create`, para todo pane con `cmd` de agente (no TUI, no shell vacío), **antes y fuera** del bloque `if (cmd && this.memory …)`: `env.NEST_ORCH_SOCKET`, `env.NEST_ORCH_TOKEN = tokens.issue(paneId)`, y `launchArgs(bin)` agregados al comando igual que hoy se agregan los de memoria. Revocar en `kill` y `onExit`.
  - `paneInfo(paneId): PaneInfo | undefined` — guarda `cmd` (el original, sin args inyectados), `accountDir`, `aiType` (de `parseAccountDir`), `cwd`.
  - Nuevo evento `this.emit('input', paneId, data)` en `write()` cuando lo llama el handler `pty:write` del renderer (`main.ts:1798`); las escrituras del servicio usan un `writeInternal` que no emite.

- [ ] **Step 1: Spike de verificación (sin commit)**: en una cuenta de prueba, comprobar a mano que `claude --mcp-config <archivo>` **suma** `nest_orchestration` sin perder `nest_memory` de `.claude.json` (`/mcp` dentro de claude lista los dos), y que `codex -c …` registra el server (`codex mcp list` con esos `-c`). Si alguno no suma, parar y avisar: cambia el diseño de esta tarea.
- [ ] **Step 2: Write the failing tests**: `orchestrationLaunchArgs claude apunta al json`; `codex usa tres -c`; `gemini da []`; `tools/list trae las 8 tools`; `initialize lleva COORDINATOR_INSTRUCTIONS`; `pane de claude recibe NEST_ORCH_TOKEN con memory deshabilitado` (PtyManager sin `setMemoryIntegration`); `pane de shell no recibe token`; `exit revoca el token`; `paneInfo guarda el cmd original`; `pty:write emite input y writeInternal no`.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement**.
- [ ] **Step 5: Run** los dos tests + `npx vitest run electron/__tests__/pty-manager` (los existentes siguen verdes) → PASS.
- [ ] **Step 6: Commit** `feat(orquestacion): shim MCP e inyección en panes`.

### Task 8: Cableado en main y renderer (panes de worker)

**Files:**
- Modify: `electron/main.ts` (crear registry, server, service, delivery **fuera** del `try` de Memories, cerca de `main.ts:640`; handlers IPC), `electron/preload.ts`, `src/types.ts` (`PaneNode`), `src/App.tsx`
- Create: `src/orchestration/useOrchestration.ts`, `src/lib/worker-palette.ts`
- Test: `electron/__tests__/orchestration-wiring.test.ts` (si el cableado de main se puede aislar en una función `wireOrchestration(deps)`; si no, cubierto por el e2e de Task 10)

**Interfaces:**
- Consumes: `OrchestrationService`, `PointerDelivery`, `OrchestrationIpcServer`, `PtyManager.paneInfo/setOrchestration` (Tasks 2–7).
- IPC main→renderer: `orchestration:launch-pane` (`LaunchPaneRequest` + `requestId`), respuesta por `ipcMain.handle('orchestration:launch-pane-result', {requestId, ok, error?, tabPaneCount?})`; `orchestration:close-pane {paneId}`; `orchestration:changed` (sin payload; el renderer pide `orchestration:snapshot`).
- Preload: `window.orchestration = { onLaunchPane(cb), replyLaunchPane(res), onClosePane(cb), onChanged(cb), snapshot(): Promise<WorkerRecord[]>, keepOpen(workerId), merge(workerId), openPr(workerId), discard(workerId) }`.
- `PaneNode` suma `orchestration?: { role: 'worker'; workerId: string; coordinatorPaneId: string; colorIndex: number }`.
- `src/lib/worker-palette.ts`, **igual que Memories** (`src/lib/memory-type-legend.ts`): el color sale del **índice ANSI del tema de terminal del usuario**, no de un hex ni de tokens nuevos. `WORKER_ANSI: readonly [number, number, number, number] = [4, 2, 5, 3]` (azul, verde, magenta, amarillo: evita el 1 rojo, que se lee como error). `workerSwatch(colorIndex: number, ansi?: readonly string[]): string` = `subirContraste(paleta[WORKER_ANSI[i]], FONDO_DE_LA_TARJETA)` con el fallback `TEMA_NEST.ansi`, como `memoryTypeSwatch`. Comentario de allow-list de §5 al estilo de ese archivo.
- App.tsx: handler de `onLaunchPane` busca el tab que contiene `coordinatorPaneId` (no el activo), responde `tab_full` si `panes.length >= MAX_PANES`, agrega el pane con `id = req.paneId`, `customLabel = label`, `borderColor = workerSwatch(colorIndex, ansiDelTema)`, `repoPath`, `initialInput`, **sin** `setAddingPane`/`NewPaneDialog` y **sin cambiar el foco**. `onClosePane` → `removePaneAnywhere`. Cerrar a mano un pane coordinador ya termina en `pty exit` → `stopCoordinator` (no hace falta handler extra).

- [ ] **Step 1: Write the failing tests** para lo aislable: `orquestación arranca con memory null`; `launch-pane sin respuesta en 10 s da error al agente`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** main + preload + types + App.tsx + palette.
- [ ] **Step 4: Run** tests + los dos `tsc -p` → PASS / exit 0.
- [ ] **Step 5: Commit** `feat(orquestacion): workers como panes del tab del coordinador`.

### Task 9: Estado en el pane, cierre automático y panel de revisión

**Files:**
- Create: `src/components/orchestration/WorkerPaneBadge.tsx`, `src/components/orchestration/WorkerAutoCloseBanner.tsx`, `src/components/orchestration/WorkerReviewPanel.tsx`, `electron/orchestration/review-store.ts`, `electron/orchestration/review-actions.ts`
- Modify: el header de pane donde hoy se pinta `customLabel` (TerminalPane/PaneHeader), `src/App.tsx` (montar el panel), `electron/main.ts` (handlers `orchestration:merge|openPr|discard|keepOpen`)
- Test: `electron/__tests__/orchestration-review.test.ts`, `src/__tests__/worker-auto-close.test.ts`

Auto-close portado de Orca `shared/orchestration/workers/worker-auto-close.ts` + `db/worker-terminal/worker-terminal-auto-release.ts` (cabecera MIT).

**Interfaces:**
- `review-store.ts`: `class ReviewStore { constructor(path: string); list(): ReviewEntry[]; upsert(e: ReviewEntry): void; remove(workerId: string): void }`, JSON en `<ravenHome>/.raven-nest/orchestration-review.json` con `writeFileAtomic`. `ReviewEntry = Pick<WorkerRecord, 'workerId'|'label'|'colorIndex'|'branch'|'worktreePath'|'baseBranch'|'status'|'finishedAt'> & { repoPath: string }`. El servicio hace `upsert` al pasar un worker a `done|exited|stopped`.
- `review-actions.ts` (deps git inyectadas):
  - `merge(e)` → falla con `coordinator_dirty` si el worktree de `baseBranch` tiene cambios; si `git merge --no-ff <branch>` da conflicto → `git merge --abort` y `merge_conflict`. Corre en el worktree donde está `baseBranch` checked out (de `git worktree list --porcelain`). Éxito → borra worktree del worker y `remove`.
  - `openPr(e)` → reusa `git:pushBranch` (`main.ts:1243`) y abre `https://github.com/<owner>/<repo>/compare/<baseBranch>...<branch>?expand=1` con `shell.openExternal` (no hay creación de PR por API en Nest; decisión del plan). No borra nada.
  - `discard(e)` → `git worktree remove --force` + `git branch -D`, después de confirmación en UI. `remove`.
- `WorkerAutoCloseBanner`: aparece en el pane worker con status `done`; cuenta 120 s; botón **Keep open** (→ `keepOpen`, no cierra nunca); si el pane vuelve a tener output (status distinto de `done`) se suspende. Al llegar a 0 → `orchestration:close-pane`.
- `WorkerPaneBadge`: punto con color del worker + texto de estado (`Working` / `Needs input` / `Done` / `Exited`), estado con token (`--warn` para needs input, `--ok` done, `--destructive` exited).
- `WorkerReviewPanel`: lista de `ReviewEntry` del repo del tab (etiqueta, punto de color, rama, `git:shortstat` contra `baseBranch`), botones **View diff** (abre `DiffViewerPanel` con `worktreePath`), **Merge** (si `baseBranch === 'main'` el texto es **Merge into main** y pide confirmación con `alert-dialog`), **Open PR**, **Discard** (confirmación). Errores (`coordinator_dirty`, `merge_conflict`) se muestran en línea en inglés.
- Notificación de escritorio sólo para `needs_input`/`waiting_permission`, nunca para `done` (§6.9).

- [ ] **Step 1: Write the failing tests**: `review store sobrevive reinicio` (nueva instancia sobre el mismo archivo lista lo guardado); `merge bloqueado con base sucia`; `merge con conflicto aborta y no deja merge a medias` (repo git real en tmpdir); `merge ok borra el worktree del worker`; `discard borra rama y worktree`; `openPr arma la URL compare`; `banner cierra a los 120 s`; `Keep open cancela el cierre`; `output nuevo suspende la cuenta`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** tests + los dos `tsc -p` → PASS / exit 0.
- [ ] **Step 5: Run** `npm run build && npx playwright test e2e/04-contraste.spec.ts` → PASS (agregar al spec los estados nuevos del badge y del panel si el spec enumera componentes).
- [ ] **Step 6: Commit** `feat(orquestacion): estado del worker, cierre automático y revisión`.

### Task 10: E2E de punta a punta

**Files:**
- Create: `e2e/20-orquestacion-panes.spec.ts`, `e2e/helpers/fake-agent.mjs`

`fake-agent.mjs` es un CLI falso que se registra como `claude` en el PATH del test: lee la línea de tarea del `initialInput`, crea un archivo, `git commit`, y llama al socket con `NEST_ORCH_TOKEN` (`worker.report done`) como lo haría el shim. Para el coordinador, el test llama directo a `worker.launch` con el token del pane coordinador.

- [ ] **Step 1: Write the test**: `lanza un worker visible en el tab del coordinador` (aparece un pane con la etiqueta y el color 1, foco sigue en el coordinador); `done cierra el pane a los 2 min y la rama queda` (reloj adelantado o constante de test); `el coordinador recibe el puntero` (buffer del coordinador contiene `You have 1 worker message`); `cerrar el coordinador cierra al worker y deja la rama`; `funciona con Memories apagado`.
- [ ] **Step 2: Run** `npm run build && npm run native:electron && npx playwright test e2e/20-orquestacion-panes.spec.ts` → PASS.
- [ ] **Step 3: Commit** `test(orquestacion): e2e de punta a punta`.

### Task 11: Prueba real con Gero

- [ ] **Step 1**: build de desarrollo junto a la Nest instalada (ver memoria "Dev build junto a Nest": usar el accountDir, no RAVEN_HOME en el home real). Gero le pide a un Claude coordinador dos tareas chicas en un repo de prueba.
- [ ] **Step 2**: verificar con él: panes visibles con etiqueta/color, puntero sin pisarle lo que escribe, permisos como su config, resumen del coordinador, panel de revisión con Merge/PR/Discard.
- [ ] **Step 3**: apagar el dev build y sus hijos (`ps` sin restos).
