# H5 — Slack accionable (Motor 4 v1) + Notion spec-to-worktree (Motor 2 v1)

**Fecha**: 2026-07-30
**Estado**: diseño autónomo (Gero delegó: "seguí con las 4 y avisame cuando esté todo"). Decisiones tomadas por Claude según la spec madre `2026-07-11-integrations-task-loop-design.md` §Motor 2 y §Motor 4.
**Depende de**: H4 (eventos `ci.failed`, `changes.requested`, `review.requested` en el bus; `initialInput` en el pane) y H8 (bus + handler `notify` ya existente en `bus-commands.ts`).
**Alcance por motor**: "motor + UI cableada" (TDD unitario + UI mínima; testeo en vivo al final).

## Parte A — Slack accionable (Motor 4 v1: notificar/reflejar)

### A.1 Objetivo
Eventos del ciclo propio → Slack, **dirigidos** (no canal global de actividad). El handler
`notify` (`chat.postMessage`) ya existe; H5 agrega las **recetas** que enrutan eventos a `notify`
con mensajes de contexto, más el auto-status del terminal.

### A.2 Recetas default nuevas (`recipes.ts` / `defaultRecipes`)
Se agregan al set default (junto a las H3 de `pr.opened/pr.merged→updateStatus`):
- `pr.merged`      → `notify` ("✅ PR mergeado en `<repo>` (`<branch>`) — ticket a Done").
- `ci.failed`      → `notify` ("🔴 CI rojo en `<branch>` — <runUrl>").
- `changes.requested` → `notify` ("✏️ Te pidieron cambios en PR #<n> (`<repo>`)").
- `review.requested`  → `notify` ("👀 Te pidieron revisar PR #<n>: <título>").

El canal destino es `deps.getConfig('slack').channel` (ya usado por el adapter Slack); sin canal
o sin token, `notify` degrada a no-op con warn (comportamiento actual del handler). El texto lo
arma la receta a partir del evento (las recetas ya reciben el `DomainEvent` en `then(ev)`).

**Mensaje dirigido, no espejo**: solo eventos del worktree/tarea propia (que es lo que estos
eventos representan). NUNCA un feed de commits (spec madre §Motor 4 / §6).

### A.3 Botones / accionable en v1
Block Kit con botones que **ejecutan** acciones requiere interactividad ENTRANTE (Slack manda un
POST al hacer click) → eso es el socket de H7. En H5 v1 los mensajes llevan **links** en el texto:
`runUrl`/URL del PR y un deep link `nest://worktree?path=<...>` ("Abrir en Nest"). Los botones que
relanzan/arreglan desde Slack llegan con H7. Decisión documentada para no bloquear H5 en el socket.

### A.4 Auto-status del terminal (opcional, mínimo)
Nuevo comando de bus `setPresence` (tipo + guard en `bus-types.ts`) y su handler
(`users.profile.set` de Slack: `status_text`/`status_emoji`). Emisores: `block.started`/
`session.opened` → `🔨 focus: <label>`; `session.closed` → clear. **Requiere scope
`users.profile:write`**; si el token no lo tiene, `profile.set` devuelve no-ok y el handler
degrada a no-op con warn (como `notify`). Si al testear el scope no está, queda como no-op — no
bloquea el resto. Dedup para no re-setear el mismo status cada ciclo.

### A.5 Archivos (Parte A)
- Modify: `electron/integrations/recipes.ts` — recetas default nuevas (arma texto por evento).
- Modify: `electron/integrations/bus-types.ts` — `SetPresenceCommand` + guard.
- Modify: `electron/integrations/bus-commands.ts` — handler `setPresence` (Slack profile.set) + registrar.
- Modify: `electron/integrations/worktree-signals.ts` — **emitir** `changes.requested`/`review.requested`
  al bus (en H4 solo se tipaban; acá se emiten, con dedup por estado), y el query
  `search/issues?q=review-requested:@me` que alimenta `review.requested`.
- Tests: `recipes.test.ts` (nuevas recetas → comandos correctos), `bus-commands.test.ts` (setPresence),
  `worktree-signals.test.ts` (emisión de changes/review con dedup).

## Parte B — Notion spec-to-worktree (Motor 2 v1)

### B.1 Objetivo
`doc de Notion → contexto del agente`. Al abrir una página de Notion como sesión: bajar su
contenido a markdown, escribirlo en `<worktree>/.nest/spec.md` e inyectarlo al prompt inicial del
agente (reusa `initialInput` de H4).

### B.2 Mecánica
- Nuevo método en el adapter Notion (`notion.ts`): `fetchPageMarkdown(pageId)` — reusa
  `notionFetch` + `notionBlocksToDetail`, serializa los `DetailBlock[]` a markdown
  (text→línea, code→bloque ```). Exportado y testeable puro (dado un `blocks[]` → markdown).
- Nuevo IPC `notion:specToWorktree(pageId, worktreePath)` en main: baja el markdown, escribe
  `<worktreePath>/.nest/spec.md` (mismo patrón que `TASK.md` en `tickets:startWork`), y devuelve
  el markdown para inyectarlo como `initialInput`.
- UI: botón **"Work on this"** en el detalle de una página Notion (`IntegrationPanelShell`), visible
  cuando el panel es de `notion`. Flujo idéntico a `MyTicketsView.workOn`: `worktree.create` →
  `notion:specToWorktree` → `onOpenWorktree` con `initialInput = spec.md`.

### B.3 Archivos (Parte B)
- Modify: `electron/integrations/notion.ts` — `fetchPageMarkdown` + helper `blocksToMarkdown`.
- Modify: `electron/main.ts` + `electron/preload.ts` — IPC `notion:specToWorktree`, `window.notion`.
- Modify: `src/components/IntegrationPanel/IntegrationPanelShell.tsx` — botón "Work on this" para notion.
- Tests: `notion.test.ts` (`blocksToMarkdown`: text/code/heading/list → markdown correcto).

## Fuera de alcance (a H7 / follow-up)
- Botones de Slack que ejecutan acciones (necesitan el socket entrante — H7).
- `@Nest` desde Slack (H7).
- Sync bidireccional de Notion (spec madre §6).

## Riesgos / notas
- `users.profile:write` puede no estar en el token OAuth actual → auto-status queda no-op (aceptable v1).
- El deep link `nest://` debe estar registrado como protocolo (verificar si ya lo está por el OAuth
  callback `nest://slack-callback`; reusar el handler de protocolo existente).
- Repo público: nada de infra en mensajes de Slack de ejemplo.
