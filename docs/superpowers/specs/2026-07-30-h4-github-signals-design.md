# H4 — GitHub señales accionable (Motor 3)

**Fecha**: 2026-07-30
**Estado**: aprobado en conversación (Gero + Claude).
**Base**: `feat/integrations` con H1-H3 (adapters + ticket loop) y H8 (bus de eventos v1) ya implementados. Spec madre: `2026-07-11-integrations-task-loop-design.md` (Motor 3 = señal → fix).
**Alcance por motor** (decisión de Gero): "motor + UI cableada" — lógica completa con tests unitarios TDD + UI mínima funcional (sin pulido visual). Testeo en vivo y pulido al final, junto con H5-H7.

## 1. Objetivo

`algo se rompió en mi branch → contexto del error listo para el agente`. Cada worktree es un
branch, cada branch tiene un estado de checks. H4 hace ese estado **visible** (badge por
worktree) y **accionable** ("arreglá el rojo": el log del run fallido inyectado al agente).

**Piezas en alcance** (elegidas por Gero de las 4 de la spec madre):
1. Badge de CI por worktree (verde / rojo / running / unknown).
2. Señales por-worktree: CI rojo propio + `changes requested` en el PR propio; y `review requested` (global, me piden revisar).
3. "Arreglá el rojo": botón que baja el log del run fallido y lo inyecta como prompt al agente del worktree.

**Fuera de alcance** (difta a H5 / follow-up): notificaciones Slack accionables, UI de la lista "te pidieron revisar", draft-PR-con-plan (el agente pushea su plan como checklist).

## 2. Arquitectura — decisión central

**El motor vive en el main process** (elegido sobre "hook en el renderer" y "extender el
ticket-loop"). Razones:
- Token solo en main (principio de la spec madre §5). El CI badge por-repo existente
  (`useRepoCI`) hace `fetch` en el renderer con el token expuesto — H4 **no** repite eso.
- "Arreglá el rojo" baja el log de GitHub Actions (redirect + texto grande) — se maneja en main.
- Integra con el bus (Motor 3 emite `ci.failed`; H5/Motor 4 lo consume).

### 2.1 Módulo nuevo: `electron/integrations/worktree-signals.ts`

Responsabilidad única: observar el estado de CI/review de cada worktree vivo y exponerlo.

- **Poller** cada 90s sobre `worktreeStore.list()` (todos los worktrees, no solo los con ticket).
  Por worktree:
  - Resuelve `owner/repo` con `getRemoteUrl` + `parseOwnerRepo` (ya existen en `github.ts`;
    se exportan/reusan) y el `branch` del worktree. Remotes no-GitHub → se saltan (v1 solo GitHub).
  - **CI del branch**: `GET /repos/{o}/{r}/actions/runs?branch=<branch>&per_page=1` → mapea a
    `CIStatus` ('success'|'failure'|'running'|'unknown') con la MISMA lógica que `useRepoCI`
    (extraída a un helper puro y testeable, compartido).
  - **changes requested**: si hay PR abierto del branch, `GET /repos/{o}/{r}/pulls/<n>/reviews`
    → `changesRequested = true` si el review más reciente por autor es `CHANGES_REQUESTED`.
- **Query personal** (no por-worktree, una vez por ciclo):
  `GET /search/issues?q=review-requested:@me+type:pr+state:open` → lista de review-requests.
- Mantiene `Map<branch, WorktreeSignal>` con `{ ci: CIStatus, runId?, runUrl?, changesRequested, prNumber? }`
  + `reviewRequests: ReviewRequest[]` global.
- **Dedup**: por `(branch, headSha)` para CI (igual que el `ciNotified` actual) y por estado
  de review, para no re-emitir en cada ciclo.
- Credential-free: `PanelAdapterDeps` inyectadas (`getToken`/`getConfig`/`fetch`).

### 2.2 Fuente única de CI

Se **retira `checkCi` / `ciNotified` / la emisión de `ci.failed`** del `ticket-loop.ts` y se
traslada a `worktree-signals.ts`. Hoy el ticket-loop solo cubre branches con ticket; el motor
nuevo cubre todos los worktrees, así que dejar ambos duplicaría `ci.failed` para branches con
ticket. El ticket-loop queda como Motor 1 puro (transiciones por PR). Los tests de `checkCi`
(T8) se migran al test del módulo nuevo.

### 2.3 Eventos del bus

- `ci.failed` (ya existe en `bus-types.ts`) se sigue emitiendo, ahora desde `worktree-signals`.
- Se agregan los **tipos** `ChangesRequestedEvent` y `ReviewRequestedEvent` a `bus-types.ts`
  (+ sus guards), pero su **emisión al bus y recetas `notify` son H5**. En H4 el estado de
  changes/review viaja por **IPC directo** (no bus) para alimentar la UI — así no se emiten
  eventos huérfanos sin consumidor.

  ```ts
  interface ChangesRequestedEvent { type: 'changes.requested'; branch: string; repoFullName: string; prNumber: number }
  interface ReviewRequestedEvent  { type: 'review.requested'; repoFullName: string; prNumber: number; prTitle: string }
  ```

## 3. UI cableada (renderer)

### 3.1 Badge por worktree
- Reuso `CIStatusBadge` (presentacional puro, ya existe) en `WorktreesSection.tsx:263-291`,
  junto a los chips actuales (`wt-dot`, `wt-diff-chip`, `wt-pr-chip`).
- Nuevo hook `useWorktreeSignals()` que consume **IPC** `signals:list` (no `fetch`); refresca
  con un push `signals:update` que el poller de main emite al cambiar (patrón de `onSetupState`).
- Indicador extra (dot/tag) cuando `changesRequested` en ese worktree.

### 3.2 "Arreglá el rojo"
- `onClick` del badge en estado `failure` → IPC `signals:fixCiPrompt(branch)`.
- En main: toma el `runId` del último run fallido del worktree → `GET /actions/runs/<id>/jobs`
  → primer job fallido → `GET /actions/jobs/<jobId>/logs` (sigue el redirect; texto plano),
  trunca a las últimas ~200 líneas / ~8KB, y devuelve un **prompt armado** (título del check +
  URL + log) — no ejecuta nada.
- El renderer inyecta el prompt al pane del worktree con `window.pty.write(paneId, prompt+'\r')`.
  - Si hay un pane cuyo `repoPath === worktreePath` → escribe ahí y lo enfoca.
  - Si no hay → abre `NewPaneDialog` con el `worktreePath` y un `pendingPrompt` (campo nuevo,
    ~pocas líneas en el estado `addingPane` de `App.tsx`): cuando el PTY del nuevo pane
    arranca, se escribe el prompt una vez.

## 4. IPC nuevo

- `preload.ts`: `window.signals.list()` → `signals:list`; `window.signals.fixCiPrompt(branch)`
  → `signals:fixCiPrompt`; listener `signals:update`.
- `main.ts`: handlers que delegan en la instancia de `worktreeSignals` con `panelDeps()`; el
  poller arranca junto al del ticket-loop (mismo `setInterval` de 90s o uno propio).

## 5. Testing (TDD, vitest)

- Helper puro `runsToStatus(workflowRuns)` → `CIStatus` (extraído de `useRepoCI`, testeado con
  runs success/failure/running/vacío).
- `worktree-signals`: detección de CI por branch, `changesRequested` desde reviews, dedup por
  `(branch, sha)`, salteo de remotes no-GitHub, review-requests del search.
- Armado del prompt de "arreglá el rojo": log truncado correctamente, prompt con título+URL+log.
- Migración de los tests de `checkCi` (hoy en `ticket-loop.test.ts`) al nuevo módulo.
- El path sin cambios del ticket-loop (transiciones) sigue verde.

## 6. Riesgos / notas

- **Rate limit**: N worktrees × ~2-3 requests/ciclo. Con el volumen real (pocos worktrees) y
  5000 req/h autenticado, holgado. Dedup evita trabajo redundante; remotes no-GitHub se saltan.
- **Retiro de `checkCi` del ticket-loop** toca el T8 recién hecho — refactor con tests migrados,
  no reescritura de comportamiento.
- **`pendingPrompt`** es aditivo y reusable (también sirve para inyectar contexto en "Work on
  this" a futuro); se mantiene mínimo.
- El repo es público: nada de infra en issues/PRs de este feature (spec madre §5).
