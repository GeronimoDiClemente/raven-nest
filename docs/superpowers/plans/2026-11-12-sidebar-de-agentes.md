# Sidebar de agentes — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estado por agente (hooks por CLI + señales genéricas) en un store de main, mostrado como árbol en la sidebar de Worktrees, con subagentes nativos, avisos de escritorio y workers con cualquier CLI con MCP.

**Architecture:** Los hooks de cada CLI llaman al shim de orquestación (`hook <evento>`), que manda `status.event` al socket con token por pane; el `PaneStatusStore` de main combina eso con señales del PTY (actividad, OSC 9/777/BEL, proceso en primer plano, exit). El renderer lee snapshot + ping `pane-status:changed`, arma el árbol con una función pura y lo dibuja con shadcn + CSS.

**Tech Stack:** Electron, node-pty, React, TypeScript, Tailwind v4 (sin preflight), shadcn, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-sidebar-de-agentes-design.md` (léelo entero antes de cada tarea; las secciones §6.x se citan abajo).

## Global Constraints

- Worktree `/Users/geronimodiclemente/RavenProjects/raven-nest-orq`, rama `feat/orquestacion-panes`. Nunca tocar el checkout compartido `/Users/geronimodiclemente/RavenProjects/raven-nest`. Sin push.
- Node: `PATH=/opt/homebrew/opt/node@22/bin:$PATH`. Tests: `npx vitest run <archivo>` (antes `npm run native:node` si toca sqlite). Antes de levantar la app: `npm run native:electron`.
- Typecheck: `npx tsc -p tsconfig.node.json --noEmit --composite false` y `npx tsc -p tsconfig.web.json --noEmit --composite false`. Nunca `tsc -b`.
- UI en inglés. shadcn + utilidades; **ninguna clase nueva en `global.css`**; keyframes en `src/styles/tailwind.css`. Todo cambio de UI pasa `e2e/04-contraste.spec.ts` (con `npm run build` antes: los e2e corren contra `dist/`).
- Color = estado: `--ok`/`--warn`/`--destructive`; color de worker sólo por `src/lib/worker-palette.ts`.
- Nunca modificar `~/.claude*`, `~/.codex`, ni los `settings.json`/`config.toml` reales de las cuentas salvo las fusiones marcadas que el spec permite (§6.3, §6.8). Nest nunca agrega ni saca flags de permisos; `--dangerously-bypass-hook-trust` sólo donde Memories ya lo pone.
- Hooks: salen siempre con 0, timeout 5 s (Qwen: 5000 ms). El shim nunca reenvía prompt ni salida de tools.
- Estilo: comentarios y nombres en español como el código vecino (`orchestration/*`).
- Nombre del módulo nuevo: `electron/pane-status/` (ya existe `electron/integrations/agent-status.ts`, que es otra cosa: no reusar ese nombre).

## Review Focus

1. Un pane cuyo CLI no tiene hooks (copilot, custom) o cuyos hooks nunca llegan: tiene que verse `working`/`idle` por actividad y nunca quedar `working` pegado. Test en Task 3 (timeout de 10 min y genérico).
2. Apagar Memories con panes abiertos: los hooks de estado siguen (no viven en `{accountDir}/.nest/`). Test en Task 5.
3. Un subagente en background: no hay SubagentStop; termina por `<task-notification>` y no por `Stop`. Test en Task 3.
4. Dos ventanas o la ventana enfocada: ningún aviso con foco; uno solo por transición aunque lleguen Notification + PermissionRequest juntos. Test en Task 9.
5. Un worker en un worktree `nest/*`: aparece una sola vez, bajo su coordinador. Test en Task 7.

---

### Task 0: Dos verificaciones antes de codear (manual, sin commit de código)

**Files:** Modify: `docs/superpowers/specs/2026-11-12-sidebar-de-agentes-design.md` (§6.3 y §9, con el resultado)

- [ ] **Step 1:** En un tmpdir con un repo git de prueba, armar dos archivos de settings, cada uno con un hook `UserPromptSubmit` distinto que haga append a un log, y correr `claude --settings a.json --settings b.json -p "hi"` con una cuenta de prueba (`HOME`/`CLAUDE_CONFIG_DIR` a un dir temporal con un symlink sólo a la credencial, no a la config real). Esperado: el log muestra si corrieron los dos o sólo el último.
- [ ] **Step 2:** Mirar `electron/memory-provisioner-codex.ts`: ¿cómo se loguea Codex con `CODEX_HOME={accountDir}/.nest/codex-home` sin `auth.json`? Si no hay mecanismo, lanzar en un tmp `CODEX_HOME` sin auth y ver si `codex exec "hi"` pide login.
- [ ] **Step 3:** Escribir los dos resultados en el spec (§6.3: cuál de las dos variantes de Claude queda; §9.2: respuesta) y commitear `docs(spec): resultados de las verificaciones previas`. Si Codex sin `auth.json` no arranca logueado, anotarlo como bug de Memories en el spec y avisarle a Gero; no arreglarlo en este plan.

### Task 1: Canal por pane independiente de la orquestación

**Files:**
- Create: `electron/pane-channel.ts`
- Modify: `electron/orchestration/wire-orchestration.ts` (usa el canal en vez de crear tokens/servidor), `electron/main.ts:~723-775`, `electron/pty-manager.ts` (`setOrchestration` → el token se emite con el canal aunque no haya servicio)
- Test: `electron/__tests__/pane-channel.test.ts`, ajustar `orchestration-wiring.test.ts`

**Interfaces:**
- Produces: `startPaneChannel(deps: { socketPath: string; handle: (paneId: string, method: string, params: unknown) => Promise<unknown> }): Promise<PaneChannel>`; `interface PaneChannel { tokens: PaneTokenRegistry; socketPath: string; setHandler(prefix: 'worker.' | 'inbox.' | 'status.', h: Handler): void; stop(): Promise<void> }`. Un método sin handler registrado responde `{ ok: false, error: 'orchestration_unavailable' }`.

- [ ] **Step 1:** Test `el canal responde status.* aunque la orquestación no se haya registrado` y `un método worker.* sin handler da orchestration_unavailable` (socket real en tmpdir, como `orchestration-ipc-server.test.ts`).
- [ ] **Step 2:** Correr, ver que falla.
- [ ] **Step 3:** Implementar envolviendo `OrchestrationIpcServer` y `PaneTokenRegistry`; `wireOrchestration` recibe el `PaneChannel` en sus deps y registra `worker.`/`inbox.`. En `main.ts` el canal se crea en su propio `try` antes del de orquestación; `ptyManager` recibe socket+tokens del canal para emitir `NEST_ORCH_SOCKET`/`NEST_ORCH_TOKEN` a todo pane de agente aunque `orchestration === null`.
- [ ] **Step 4:** `npx vitest run electron/__tests__/pane-channel.test.ts electron/__tests__/orchestration-*.test.ts electron/__tests__/pty-manager-*.test.ts` en verde; typecheck.
- [ ] **Step 5:** Commit `refactor(estado): canal por pane aparte de la orquestación`.

### Task 2: Protocolo `status.event` y subcomando `hook` del shim

**Files:**
- Modify: `electron/orchestration/protocol.ts` (agregar `'status.event'` a `ORCH_METHODS`), `electron/orchestration-mcp/index.ts`
- Create: `electron/orchestration-mcp/hook.ts`
- Test: `electron/__tests__/pane-status-hook.test.ts`

**Interfaces:**
- Produces: `type HookCli = 'claude' | 'codex' | 'gemini' | 'qwen'`; `interface HookEvent { cli: HookCli; event: string; notificationType?: string; agentId?: string; agentType?: string; description?: string; toolName?: string; taskIds?: string[]; backgroundTaskIds?: string[] }`; `extraerEventoDeHook(cli: HookCli, event: string, raw: string): HookEvent` (pura). Uso del shim: `nest-orchestration hook <cli> <evento>`.

- [ ] **Step 1:** Tests de `extraerEventoDeHook` con payloads reales (copiar la forma de los JSON del 12-nov: SubagentStart `{agent_id, agent_type}`, Notification `{notification_type:'permission_prompt'}`, UserPromptSubmit cuyo `prompt` trae `<task-notification><task-id>abc</task-id>` → `taskIds: ['abc']`, Stop con `background_tasks`), JSON roto → `{cli, event}` sin más campos, y `el evento nunca lleva prompt ni tool_input` (`JSON.stringify(res)` no contiene el texto del prompt). `description` truncada a 120 caracteres.
- [ ] **Step 2:** Correr, ver que falla.
- [ ] **Step 3:** Implementar. En `index.ts`, si `argv[2] === 'hook'`: leer stdin (tope 1 MB), extraer, mandar `status.event` con `OrchestrationClient`, timeout 3 s, `process.exit(0)` siempre (también sin socket/token, sin imprimir a stdout). Si no, el MCP de siempre.
- [ ] **Step 4:** Tests en verde; typecheck.
- [ ] **Step 5:** Commit `feat(estado): los hooks avisan su evento por el socket del pane`.

### Task 3: `PaneStatusStore` (puro, con reloj inyectado)

**Files:**
- Create: `electron/pane-status/pane-status-store.ts`, `src/pane-status-types.ts` (tipos compartidos, importables desde main y renderer)
- Test: `electron/__tests__/pane-status-store.test.ts`

**Interfaces:**
- Produces (en `src/pane-status-types.ts`): `type PaneAgentState = 'working' | 'needs_you' | 'idle' | 'exited' | 'failed'`; `type NeedsYouReason = 'permission' | 'question' | 'attention'`; `interface NativeSubagent { id: string; type: string; description: string; state: 'running' | 'done'; startedAt: number; endedAt?: number }`; `interface PaneStatus { paneId: string; aiType: string; cwd: string; state: PaneAgentState; reason?: NeedsYouReason; since: number; unread: boolean; source: 'hooks' | 'generic'; subagents: NativeSubagent[] }`; `rangoDeEstado(s: Pick<PaneStatus,'state'|'unread'>): number` (orden §6.4: needs_you > failed > no leído > working > idle > exited).
- Produces (store): `class PaneStatusStore extends EventEmitter` con `constructor(opts: { now: () => number; isFocused: (paneId: string) => boolean })`; `registrar(paneId, aiType, cwd)`, `quitar(paneId)`, `aplicarHook(paneId, e: HookEvent)`, `actividad(paneId, at: number)`, `aviso(paneId)` (OSC/BEL), `finDeAgente(paneId)`, `salida(paneId, code: number)`, `marcarLeido(paneId)`, `tick()` (timers: actividad 3500 ms, `working` pegado 10 min, subagente `done` 60 s, fila `exited` por SessionEnd 60 s), `snapshot(): PaneStatus[]`. Emite `'changed'` y `'transition'` `(prev: PaneStatus | undefined, next: PaneStatus)`.

- [ ] **Step 1:** Tests, uno por fila de la tabla de mapeo del spec §6.4, más: `con source hooks la actividad no cambia el estado`, `working sin eventos ni salida 10 min vuelve a idle`, `Stop con el pane sin foco marca unread y con foco no`, `subagente en background sigue running después del Stop y termina por task-notification`, `un subagente done se quita a los 60 s`, `SessionEnd deja exited y la fila se quita a los 60 s`, `salida con código 1 → failed`, `rangoDeEstado ordena según §6.4`, `no emite changed si nada cambió`.
- [ ] **Step 2:** Correr, ver que falla.
- [ ] **Step 3:** Implementar como reductor sobre un `Map<string, PaneStatus>`; `tick()` lo llama main cada 1 s sólo mientras haya algún pane `working` o subagente/fila con vencimiento (sin timer al vacío).
- [ ] **Step 4:** Tests en verde; typecheck.
- [ ] **Step 5:** Commit `feat(estado): modelo de estado por pane`.

### Task 4: Señales genéricas y cableado en main

**Files:**
- Create: `electron/pane-status/senales.ts`, `electron/pane-status/wire-pane-status.ts`
- Modify: `electron/main.ts` (crear store + wiring, registrar `status.` en el canal), `electron/pty-manager.ts` (emitir el `cmd`/bin del pane al crear, para `registrar`)
- Test: `electron/__tests__/pane-status-senales.test.ts`, `electron/__tests__/pane-status-wiring.test.ts`

**Interfaces:**
- Produces: `detectarAviso(chunk: string): boolean` (OSC 9 `\x1b]9;`, OSC 777 `\x1b]777;notify;`, BEL `\x07` suelto, **no** el BEL que termina una secuencia OSC); `hayActividadVisible(chunk: string): boolean` (mover `hasVisibleOutput` de `src/lib/terminal-chrome.ts` a un módulo compartido o reexportarlo); `wirePaneStatus(deps: { pty: PtyManager; channel: PaneChannel; store: PaneStatusStore; send: (ch: string, p?: unknown) => boolean; pollForeground?: number /* ms, default 2000 */ }): { stop(): void }`.

- [ ] **Step 1:** Tests de `detectarAviso`: OSC 9 sí, OSC 777 sí, `\x1b]0;title\x07` no, BEL suelto sí, partido entre dos chunks (`'\x1b]'` + `'9;hi\x07'`) sí. Test de wiring con un `pty` falso: `data` visible → `actividad`; `exit` → `salida`; el proceso en primer plano pasa de `claude` a `zsh` → `finDeAgente`; `status.event` del canal → `aplicarHook` con el `paneId` del token; `changed` del store → `send('pane-status:changed')`.
- [ ] **Step 2:** Correr, ver que falla.
- [ ] **Step 3:** Implementar. El poll de primer plano corre sólo para panes con `cmd` no vacío y sólo mientras el pane esté registrado.
- [ ] **Step 4:** Tests en verde; typecheck.
- [ ] **Step 5:** Commit `feat(estado): señales del PTY y cableado en main`.

### Task 5: Instalar los hooks de estado por CLI

**Files:**
- Create: `electron/pane-status/hooks-por-cli.ts`
- Modify: `electron/pty-manager.ts` (args/env de estado al armar `launchCmd`, después de los de Memories), `electron/memory-provisioner-codex.ts` (si Memories armó el `config.toml`, sumar los hooks de estado al mismo archivo), `electron/main.ts` (pasar paths del shim de orquestación)
- Test: `electron/__tests__/pane-status-hooks-por-cli.test.ts`

**Interfaces:**
- Produces: `hooksDeEstado(bin: string, accountDir: string, p: { execPath: string; shimPath: string; isWin: boolean; memoriesArgs: string[] }): { args: string[]; env: Record<string,string> }`. Wrapper propio `{accountDir}/.nest-status/nest-status.sh|.cmd` que corre `ELECTRON_RUN_AS_NODE=1 exec "<execPath>" "<shimPath>" hook <cli> "$@"`.
- Claude: archivo `{accountDir}/.nest-status/claude-settings.json` regenerado en cada arranque con los eventos del spec §6.3; según Task 0, se pasan dos `--settings` o uno solo que incluye además los hooks de memoria leídos de `memory-settings.json`.
- Codex: sólo si `memoriesArgs` incluye `--dangerously-bypass-hook-trust`; los bloques `[[hooks.X]]` de estado se agregan al `config.toml` de Memories con un comentario marcador `# nest-status`. Nunca agregar el flag.
- Gemini/Qwen: fusión en el `settings.json` de cuenta (paths del spec §6.3), identificando lo propio por `/nest-status\.(cmd|sh)/` como Memories usa `/nest-memory\.(cmd|sh)/`; Qwen timeout 5000.

- [ ] **Step 1:** Tests: `claude recibe --settings de estado aunque Memories esté apagado`; `deprovisionar Memories no borra .nest-status` (llamar `deprovisionClaudeAccount` y ver que el archivo sigue); `codex sin el flag de Memories no recibe hooks ni flag`; `codex con Memories suma hooks de estado sin duplicar al re-provisionar`; `gemini: la fusión conserva hooks ajenos y los de nest-memory`; `qwen usa timeout 5000`; `un bin desconocido devuelve args y env vacíos`; `el settings.json real de claude no cambia` (como el test de regresión de `memory-provisioner.ts`).
- [ ] **Step 2:** Correr, ver que falla.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Tests en verde, incluidos `electron/__tests__/memory-provisioner*.test.ts`; typecheck.
- [ ] **Step 5:** Commit `feat(estado): hooks de estado para claude, codex, gemini y qwen`.

### Task 6: IPC, preload, hook del renderer y API para el teléfono

**Files:**
- Modify: `electron/main.ts`, `electron/preload.ts` (bloque como el de `orchestration`, :228-257), `src/types.ts` (`Window['paneStatus']`)
- Create: `electron/pane-status/control.ts`, `src/pane-status/usePaneStatus.ts`
- Test: `electron/__tests__/pane-status-control.test.ts`, `src/__tests__/hooks/usePaneStatus.test.ts`

**Interfaces:**
- Canales: `pane-status:snapshot` (invoke → `PaneStatus[]`), `pane-status:changed` (ping), `pane-status:markRead` (invoke, `paneId`), `pane-status:focus-pane` (main → renderer, `{ paneId }`).
- Preload: `window.paneStatus = { snapshot(), markRead(paneId), onChanged(cb): () => void, onFocusPane(cb): () => void }`.
- `control.ts`: `crearControlDeAgentes(deps): AgentControl` con `snapshot(): { panes: PaneStatus[]; workers: OrchestrationWorker[] }` y acciones `markRead`, `write(paneId, text)` (vía `pty.write` con `fromUser: true`), `send(workerId, text)`, `merge`, `discard`, `openPr`, `keepOpen` (delegan en lo que ya existe). Valida todos los ids. Es la puerta que va a exponer Bauti; nada la expone fuera del proceso todavía (comentarlo).
- `usePaneStatus(): Map<string, PaneStatus>` con el patrón de `useOrchestrationList` (fetch al montar, re-fetch en cada `onChanged`), vía `useBridge()`.

- [ ] **Step 1:** Tests: `control rechaza un paneId desconocido`; `write marca fromUser`; `usePaneStatus re-lee en cada changed y se desuscribe al desmontar`.
- [ ] **Step 2:** Correr, ver que falla.
- [ ] **Step 3:** Implementar. En `App.tsx`, al enfocar un pane llamar `paneStatus.markRead(paneId)`; `onFocusPane` cambia al tab del pane y lo enfoca. `isFocused` del store = ventana enfocada y pane activo (el renderer informa el pane activo con `pane-status:active-pane`).
- [ ] **Step 4:** Tests en verde; typecheck.
- [ ] **Step 5:** Commit `feat(estado): IPC y API de control de agentes`.

### Task 7: Modelo del árbol (puro)

**Files:**
- Create: `src/pane-status/arbol-de-agentes.ts`
- Test: `src/__tests__/lib/arbol-de-agentes.test.ts`

**Interfaces:**
- Produces: `interface NodoAgente { paneId: string; tabId: string; nombre: string; aiType: string; status: PaneStatus | undefined; workers: NodoAgente[]; subagentes: NativeSubagent[]; colorIndex?: number }`; `interface NodoWorktree { repoPath: string; agentes: NodoAgente[]; peor: PaneStatus | undefined; total: number }`; `armarArbol(worktreePaths: string[], tabs: WorkspaceTab[], estados: Map<string, PaneStatus>): Map<string, NodoWorktree>`.
- Reglas: pane de agente = `cmd` no vacío y `aiType` distinto de `terminal`/`browser`/`editor`; cruce por `PaneNode.repoPath` (normalizar barra final); un pane con `orchestration.role === 'worker'` va sólo bajo su `coordinatorPaneId` (Review Focus 5) y, si el coordinador ya no está, bajo el worktree del worker; nombre = `customLabel` o el nombre del CLI; hijos ordenados por `rangoDeEstado`; `peor` = el de mayor rango entre agentes, workers y subagentes; `total` cuenta agentes + workers.

- [ ] **Step 1:** Tests: los del párrafo de reglas, uno cada uno, más `un worktree sin agentes no aparece en el mapa`.
- [ ] **Step 2–4:** fallar, implementar, verde, typecheck.
- [ ] **Step 5:** Commit `feat(sidebar): árbol de agentes por worktree`.

### Task 8: UI del árbol y movimiento

**Files:**
- Create: `src/components/agent-tree/AgentTree.tsx`, `AgentRow.tsx`, `SubagentRow.tsx`, `AgentStatusDot.tsx`
- Modify: `src/components/WorktreesSection.tsx` (fila desplegable + `AgentTree` debajo; recibe `tabs` y `onFocusPane` desde `Sidebar.tsx`/`App.tsx`), `src/styles/tailwind.css` (keyframes)
- Test: `src/__tests__/components/AgentTree.test.tsx`, `e2e/04-contraste.spec.ts` (sembrar estados con un gancho e2e como `__nestOrchestrationE2E`)

Valores fijos (spec §6.6, referencia visual `sidebar-motion.html`): pulso 2 s `steps(6)` opacidad 1→0,5, en fase (`animation-delay` negativo calculado con `Date.now() % 2000` al montar); desplegar 180 ms `cubic-bezier(0.16,1,0.3,1)`; filas 150 ms ease-out; shimmer en el nombre del agente `working`; todo apagado con `prefers-reduced-motion: reduce`. Punto: `needs_you` `--warn`, `failed` `--destructive`, no leído `--ok`, `working` neutro con pulso, `idle`/`exited` apagado. Chip `question`/`permission` con `Badge` de shadcn. Plegado: `+N`. Negrita si `unread`. Click en agente: `onFocusPane(tabId, paneId)`; en subagente: el del padre. El punto de setup (`STATUS_DOT_CLASS`) queda como está.

- [ ] **Step 1:** Tests de componente: `muestra +N plegado`, `negrita si unread`, `click en subagente enfoca al padre`, `chip permission cuando reason es permission`, `sin animación con reduced motion` (clase/atributo, no tiempos).
- [ ] **Step 2–4:** fallar, implementar, verde, typecheck.
- [ ] **Step 5:** `npm run build` y `npx playwright test e2e/04-contraste.spec.ts` en verde; captura del árbol a `/private/tmp/claude-501/-Users-geronimodiclemente-RavenProjects-raven-nest/7ee5362d-ffc4-4d93-93f6-51af4d2f4b07/scratchpad/ui/arbol.png` para revisión.
- [ ] **Step 6:** Commit `feat(sidebar): árbol de agentes con estado y subagentes`.

### Task 9: Avisos de escritorio

**Files:**
- Create: `electron/pane-status/avisos.ts`
- Modify: `electron/main.ts` (`notifyDesktop({title, body, paneId?})` con click → `win.show()/focus()` + `pane-status:focus-pane`), `electron/orchestration/wire-orchestration.ts` (el aviso de needs-input usa la firma nueva), settings (interruptor "Agent notifications", default on, en el store de settings que ya existe — buscar dónde vive el toggle de otros avisos)
- Test: `electron/__tests__/pane-status-avisos.test.ts`

**Interfaces:**
- Produces: `decidirAviso(prev: PaneStatus | undefined, next: PaneStatus, ctx: { esWorker: boolean; ventanaEnfocada: boolean; workersActivosDelCoordinador?: number; habilitado: boolean }): { title: string; body: string } | null`. Textos en inglés: `"<name> needs you"` (permission/question/attention), `"<name> finished"`, `"All workers done"`.

- [ ] **Step 1:** Tests: `needs_you avisa una vez aunque lleguen Notification y PermissionRequest seguidos`; `con la ventana enfocada no avisa`; `genérico working→idle no avisa`; `aviso OSC sí`; `Stop de un worker no avisa pero el último worker terminado sí ("All workers done")`; `deshabilitado no avisa`.
- [ ] **Step 2–4:** fallar, implementar, verde, typecheck.
- [ ] **Step 5:** Commit `feat(estado): avisos de escritorio por agente`.

### Task 10: Workers con gemini, qwen y opencode

**Files:**
- Modify: `electron/orchestration/mcp-launch-args.ts`, `electron/orchestration/wire-orchestration.ts` (`CMD_DE_AGENTE`, `defaultAccount`), `electron/orchestration-mcp/tools.ts` (enum de agentes de `launch worker` si existe)
- Create: `electron/orchestration/mcp-en-config.ts` (fusión marcada del server `nest_orchestration` en gemini `settings.json`, qwen `settings.json`, opencode config — paths: los que usa cada adapter en `electron/memory-cli-adapters.ts`/provisioners)
- Test: `electron/__tests__/orchestration-mcp-en-config.test.ts`, ajustar `orchestration-wiring.test.ts`

Reglas: marca propia (`_nestOrchestration` o el mecanismo que use cada formato), alta en cada arranque, baja al cerrar Nest o con `orchestration === null`; la baja de Memories no la toca ni viceversa; `env` con `NEST_ORCH_SOCKET`/`NEST_ORCH_TOKEN` (el token del pane se pasa por env del proceso, no se escribe en el archivo: verificar que cada CLI hereda env al server MCP o usa su sintaxis de `env` con referencia a variable; si un CLI no lo permite sin escribir el token, ese CLI queda fuera y se documenta).

- [ ] **Step 1:** Tests: `gemini: agrega nest_orchestration y conserva nest-memory y servers ajenos`; `el token nunca se escribe en el archivo`; `quitar orquestación deja intacto lo de Memories`; `launch worker con agent gemini usa la cuenta por defecto de gemini`; `agente sin cuenta → error claro (no_account_for_agent)`.
- [ ] **Step 2–4:** fallar, implementar, verde, typecheck.
- [ ] **Step 5:** Commit `feat(orquestacion): workers con gemini, qwen y opencode`.

### Task 11: Prueba en vivo con Gero (dev build, manual)

- [ ] **Step 1:** Dev build junto a Nest instalado según `memory/dev-build-junto-a-nest` (RAVEN_HOME fuera del home real), `npm run native:electron`.
- [ ] **Step 2:** Verificar con Gero: la tarea del worker se envía (fix 9156c642); árbol con coordinador Claude + 2 workers; un subagente nativo aparece y desaparece; Notification `permission_prompt` → chip `permission` + aviso; Codex coordinador: ¿pide aprobar cada `nest_*`?; PermissionRequest de Codex; Gemini/Qwen si hay cuenta.
- [ ] **Step 3:** Anotar resultados en el spec §8; lo que falle para un CLI lo deja "sin confirmar" (genérico). Apagar el dev build y verificar con `ps` que no quede nada.
- [ ] **Step 4:** Commit `docs(spec): resultados de la prueba en vivo de la sidebar`. Avisar a raven-nest-5a cuando Gero apruebe integrar a `feat/memories-settings`.
