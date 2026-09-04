# Graph Review in the Editor — diseño

> Fecha: 2026-08-20 · Ramas: `feat/integrations` (capa motor) + `feat/code-editor-integration` (capa UI) · Estado: aprobado por Gero (brainstorming interactivo)
> Extiende: `docs/superpowers/specs/2026-08-17-graph-orchestration-design.md` (retoma lo que ese spec dejó fuera de MVP: *"Loops de feedback Reviewer→Coder automáticos"*).
> Contexto de producto: memorias `integrations-orchestration-redesign`, `graph-orchestration-research`, `code-editor-branch-state`, `worker-spec-feature-wip`.
> Señal de mercado: **Slack Code** (lanzado 2026-08-20) valida el loop *agentes-codean → humano-revisa-y-aprueba-in-app*. Nuestro diferencial: **editar + orquestar en un IDE real**, no solo revisar en el chat (Slack Code es *review-only*, "collaborative review over direct editing").

## 1. Objetivo

Cerrar el círculo de la orquestación. Hoy el motor (2026-08-17) corre el grafo `Architect → Coder → N Reviewers → Gate → Tester`, pero:

- **(a)** nadie lee el `{concerns, blocking}` que los reviewers escriben — `graph-orchestrator.ts` dice literal *"blocked/failed decided elsewhere"* y ese *elsewhere* no existe → **el gate siempre pasa**.
- **(b)** no hay superficie para que el humano **evalúe** el resultado.

Esta feature agrega (a) un **eval-loop auto-first con auto-reparación** y (b) una **card de review** (board → run) que deja *visualizar* y *decidir*. Es lo que en el aviso de mercado ("AI Platform Engineer") llaman **evaluation frameworks** — la pieza que hoy está escrita pero sin cerrar.

**Principio rector (definido por Gero):** el sistema es **automático por default**; el humano interviene **solo si el programador se configura para tomar decisiones**. Todo lo que el humano puede hacer manualmente (aprobar / pedir cambios), el auto-loop lo hace solo.

## 2. Alcance

**En el MVP:**
- `graph-verdict.ts` (nuevo, puro): parseo de `review-*.json` → `Verdict`.
- Eval-loop dentro de `planTick`: reviewer con `blocking` → nodo `blocked`; concerns persistidas en el nodo.
- **Auto-loop de auto-reparación:** blocking (o veredicto faltante) → re-inyecta al coder → re-corre → re-revisa, hasta `maxReviewRounds` (default **2**), luego **escala a humano**.
- Distinguir `failed` de `done` vía **exit code** del PTY.
- `GraphRun.mode`: `'auto' | 'gate' | 'step'` + default por repo (store JSON).
- **Card de review (dirección C)** en el board (F6): master-detail, mini-DAG + concerns como chips + CTAs. Sirve 3 contextos: *visualizar* / *review mode* / *escalación*.
- Puente al editor: `Open diff in editor` reusa `openFileFromHub` + `EditorPane`.
- Decisión = orquestación: `Request changes → re-run` (mismo mecanismo que el auto-loop) y `Approve → PR` (reusa IPC de `PRReview.tsx`).
- Modelo **single-writer**: acciones humanas dejan `pendingDecision`; `planTick` lo aplica.

**Fuera del MVP (YAGNI, puerta abierta):**
- **file/line anchors** en las concerns (`{file, line, message}`) + marcadores inline sobre la línea en Monaco. La card muestra concerns como chips; saltar a la línea exacta es follow-up (requiere upgrade del shape del veredicto + del prompt del reviewer en `graph-handoff.ts`).
- El **editar-a-mano** en Monaco como flujo principal (queda como escape hatch secundario; el flujo primario es delegar de vuelta al grafo).
- Race de N modelos sobre el mismo nodo (cancha de Orca, ya conceded).
- Worktree remoto / SSH.

## 3. Arquitectura — 3 capas

**① Motor (electron, `feat/integrations`) — sin UI, puro/testeable**
- `graph-verdict.ts` (nuevo): `parseVerdict`.
- Extensión de `planTick` (`graph-orchestrator.ts`): lee veredictos en la transición reviewer→done.
- Extensión de `GraphRun` / `NodeRuntime` (`graph-runner.ts`): `mode`, `round`, `revisionNotes`, `pendingDecision`, `verdict`, `exitCode`.
- `graph-config` store (nuevo, patrón `recipes.ts`/`worker-specs.ts`): default por repo.
- IPC: `graph:run:list`, `graph:run:get`, `graph:run:setMode`, `graph:gate:approve`, `graph:gate:requestChanges`.

**② Card de review (renderer) — dirección C**
- `GraphReviewCard.tsx` (nuevo) dentro del board headless (F6).

**③ Puente al editor (renderer) — reuso**
- `Open diff in editor` → `openFileFromHub` (`hub-open-file.ts`) → `EditorPane` (ya pinta diff-vs-HEAD).
- `Approve → PR` → patrones de IPC de `PRReview.tsx`.

**Reuso ~70%:** board F6, `EditorPane`, `openFileFromHub`, `gitDiff`, `PRReview`, `eventBus`/Slack (H5). **Nuevo real:** `graph-verdict.ts`, `GraphReviewCard.tsx`, 5 IPC, `graph-config`, el transform de re-run.

## 4. Eval-loop auto-first

```ts
// graph-verdict.ts (nuevo, puro)
export interface Verdict { concerns: string[]; blocking: boolean }
export function parseVerdict(raw: string | null): Verdict | null // JSON + valida shape; null si falta/roto
```

**Dónde se engancha — dentro de `planTick`, sin motor nuevo:** `planTick` ya recibe el port `readArtifact` y ya detecta la transición de un nodo a `done`. Se agrega: cuando un nodo **reviewer** pasa a `done`, se lee `readArtifact(worktree, artifactPath(node))` (→ `.nest/graph/review-<focus>.json`), se parsea, y:

- `blocking: true` → nodo queda **`blocked`** (no `done`).
- `blocking: false` → **`done`**, concerns viajan igual.
- **veredicto faltante / roto → `blocked`** con concern sintética *"reviewer produced no parseable verdict"* (política conservadora; nunca "sin veredicto = sin objeciones").
- El `Verdict` se guarda en `NodeRuntime.verdict` → la card lo lee del run persistido.

**Cómo llega al gate — ya funciona:** `gateState()` trata `blocked` como "resolved-pero-no-done" → un reviewer `blocked` da gate `blocked`. **No se toca `advanceGraph` ni `gateState`**, solo se alimenta el estado correcto.

**Auto-reparación (default `auto`):** un gate `blocked` **no espera a un humano**. Dispara el **mismo transform de re-run** de la §6 con las blocking concerns como feedback → coder re-corre → reviewers re-miran. Hasta `maxReviewRounds` (2). Si no converge → **escala** (`needs_input` + evento `graph.escalated` + notif Slack; aparece en el board como "needs you").

## 5. La card de review (C)

`GraphReviewCard.tsx`, dentro del board (F6). Master-detail: strip de runs + detalle del seleccionado.

**Detalle:** header (ticket · branch · template · agentes · tiempo · pill de gate) · **mini-DAG** con estados (reusa render de nodos) · **concerns como chips** (de `NodeRuntime.verdict`, blocking resaltado) · CTAs `Open diff in editor →` / `Request changes → re-run` / `Approve → open PR`.

**3 contextos, misma card:**
1. **Visualizar** (auto, mientras corre) — read-only, la abrís cuando querés.
2. **Review mode** (opt-in) — frenó en el gate, UI de decisión completa.
3. **Escalación** (auto no convergió) — flag *"escalated: couldn't converge after N rounds"*.

**Puente al editor:** `git diff --name-only` del worktree → cada archivo cambiado se abre con `openFileFromHub` en un `EditorPane`.

**IPC:** `graph:run:list` (strip) + `graph:run:get` (run + concerns parseadas).

## 6. La decisión = orquestación

**Request changes → re-run (corazón; lo comparten auto y humano).** Transform puro sobre `GraphRun`:
1. Feedback = texto del humano, o blocking concerns agregadas (auto).
2. Rama a re-correr = nodo `coder` + descendientes (reviewers, gate, tester).
3. Esos nodos → `queued` (limpia `paneId`, `verdict`, `endedAt`); el effect layer mata sus PTYs (best-effort).
4. `revisionNotes[coderId] = feedback` → `composeNodeInput` lo antepone: *"Revision requested: …"* + plan original.
5. `round++`.
6. Next tick: `planTick` ve el coder `queued` con deps `done` → lo relanza. El grafo re-fluye.

**Approve → PR.** Marca reviewers `blocked` + gate como `done` (override) → next tick el gate pasa → corre `tester` → si pasa → abre PR desde la branch del run (IPC estilo `PRReview.tsx`) → `graph.completed` → notif Slack. En `auto` toda la cola es automática; en `gate` arranca al apretar Approve.

## 7. Modo `auto` / `gate` / `step`

- **`auto` (default):** gate limpio se auto-resuelve → tester → PR. Blocking → auto-loop (§4). Solo escala si no converge.
- **`gate` (opt-in):** aunque el gate esté limpio, **espera tu OK** (un gate `passed` no se auto-resuelve; se muestra "awaiting approval").
- **`step` (opt-in):** pausa después de cada nodo.
- `graph:run:setMode` (por run) + default por repo en `graph-config` (patrón `recipes.ts`). Override desde la card/board.

## 8. Manejo de errores

- **Single-writer (evita races con el tick de 3s):** acciones humanas dejan `pendingDecision` en el run; **`planTick` lo aplica**. El tick es el único escritor → sin lost-updates. Puro/testeable.
  ```ts
  type PendingDecision =
    | { kind: 'approve'; gateId: string }
    | { kind: 'requestChanges'; feedback: string }
  ```
- **Nodo que crashea (`failed`):** hoy PTY-ausente = `done` indistinto. Se captura el **exit code** por pane; exit≠0 → `failed` → `descendantsOfFailed` (ya existe) corta la rama y escala.
- **Re-run mata PTYs viejos:** best-effort, warn-no-throw (patrón `saveWorkerSpecs`).
- **Worktree/git roto:** `Open diff` degrada a estado vacío/error en la card, sin crash (`EditorPane` ya maneja ENOENT).
- **Approve→PR falla:** el PR es acción terminal **después** del tester, no lo bloquea. Falla → error + retry en la card (como `submitError` de `PRReview`). El gate no queda a medias.
- **Loop infinito / costo:** `maxReviewRounds` (2) + escalación. Dedup de `gate_blocked`/`needs_input`/`escalated` vía el `seen` que ya persiste el run.

## 9. Testing

**Unit / TDD (el grueso — núcleo puro):**
- `parseVerdict`: válido / faltante / roto / campos extra.
- `planTick` extendido: reviewer→`blocked` con blocking; concerns persistidas; veredicto faltante→`blocked`; `done` en limpio.
- Transform de re-run: reset coder+descendientes, `revisionNotes`, `round++`.
- Gating por modo: `auto` auto-resuelve gate limpio; `gate`/`step` frenan; escala al tope.
- Aplicación de `pendingDecision`: `approve` → overrides; `requestChanges` → re-run.
- Exit-code → `failed` → propagación.

**Componente (RTL, como `EditorPane.test.tsx` / `ExplorerPanel.test.tsx`):** la card renderiza concerns, los CTAs disparan el IPC correcto, los 3 contextos.

**Live smoke (deuda honesta, igual que F6 T7):** graph real → veredicto blocking real → ver auto-loop re-correr → en `gate`, approve/request. **Este feature da la razón para cerrar el smoke de F6.**

## 10. Dependencias y secuencia

- Capa ① (motor) → `feat/integrations`. Capas ② y ③ (card + editor) → necesitan `feat/code-editor-integration` mergeado (de ahí `EditorPane`/`openFileFromHub`).
- **Secuencia sugerida:** (1) editor → main · (2) graph orchestration → main · (3) este feature encima (o en una rama que combine ambas).
- La capa ① (eval-loop + auto-loop) **se puede empezar ya** sobre `feat/integrations` sin esperar al editor: cierra el gap de mercado y es 100% testeable en puro.

## 11. Resumen de superficie nueva

| Módulo / IPC | Tipo | Capa |
|---|---|---|
| `graph-verdict.ts` | nuevo, puro | motor |
| `planTick` (extensión) | edit | motor |
| `NodeRuntime`/`GraphRun` (campos: `verdict`, `exitCode`, `mode`, `round`, `revisionNotes`, `pendingDecision`) | edit | motor |
| `graph-config` store | nuevo | motor |
| re-run transform | nuevo, puro | motor |
| `graph:run:list` · `graph:run:get` · `graph:run:setMode` · `graph:gate:approve` · `graph:gate:requestChanges` | IPC nuevos | motor↔UI |
| `GraphReviewCard.tsx` | nuevo | UI |
| bridge `Open diff in editor` (reusa `openFileFromHub`) | reuso | UI |
| `Approve → PR` (reusa IPC `PRReview`) | reuso | UI |

## 12. Mockups

`Desktop/nest-mockups-deck.html` (deck completo: flow map, board, auto-vs-review, DAG live, review A/B/C, eval-loop) y `Desktop/nest-review-mockups.html` (las 3 direcciones de review). Dirección elegida: **C · board card**.
