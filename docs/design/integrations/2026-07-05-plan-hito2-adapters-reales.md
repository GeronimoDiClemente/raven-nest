# Hito 2+: adapters reales (Slack, GitHub, Jira, Notion) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Base en serie, adapters en paralelo (worktrees).

**Goal:** Los 4 paneles del spec funcionan contra APIs reales en `npm run dev`. Tokens solo en main process (spec §6/§7): el renderer consume adapters proxy que van por IPC `plugins:panel:*` a un host main-side.

**Auth por servicio (decisión para poder testear local sin infra):**
- **Slack**: OAuth existente (`slack:open-oauth`) + exchange `oauth.v2.access` en main con `MAIN_VITE_SLACK_CLIENT_SECRET` de `.env` (la Edge Function del spec queda para producción; el exchange main-side es equivalente local). Scopes: sumar `channels:history,groups:read,im:read,users:read`.
- **GitHub**: reutiliza el OAuth ya integrado en la app; al "Connect" se persiste el token en `pluginCreds('github')` para uso main-side.
- **Jira**: `auth.kind: 'apiKey'` con fields (email + API token + site URL) — funcional sin crear OAuth app.
- **Notion**: `auth.kind: 'apiKey'` con field (internal integration token).

## Fase 1 — Base común (serie)

### Task F1: Host IPC de paneles + connect state
- `electron/integration-panels.ts`: host genérico `registerPanelAdapter(pluginId, adapter)` donde adapter implementa el contrato server-side (`fetchSections/fetchDetail/resolveWorktreeEntity/actions/runAction/compose`) con deps inyectadas `{ getToken, getConfig, fetch }` (patrón `plugin-actions.ts`).
- Handlers `plugins:panel:call` (pluginId, method, args) en main.ts + preload `window.pluginPanels.call(...)`. Errores tipados: `{ ok:false, error: 'NOT_CONNECTED' | 'API_ERROR' | ... , message }`.
- `src/integrations/ipcAdapter.ts`: `createIpcAdapter(pluginId, displayName)` — proxy renderer que implementa `IntegrationAdapter` llamando `window.pluginPanels.call`; errores se propagan como throw tipado.
- Connect state en el marketplace: `window.pluginCreds.has(id)` → badge "Connected"/botón "Connect". Connect por `auth.kind`: `oauth` (slack → `window.slack.openOAuth()` + exchange; github → reutilizar flujo existente y persistir en pluginCreds) y `apiKey` (form con los fields del manifest, guarda JSON en pluginCreds).
- Slack OAuth exchange en main: `slack:exchange-code` (code → `oauth.v2.access` con client secret de env → `pluginCreds.set('slack', access_token)`); fix del listener `onOAuthCode` (hoy apila listeners y no devuelve unsubscribe, preload.ts:253-260).

### Task F2: Shell hardening + captura real del terminal
- `IntegrationPanelShell`: guard de carreras en `select/runAction/compose` (useRef del ref vigente, ignorar resoluciones viejas); estado de error visible (banner `ip-error` con retry) cuando el adapter rechaza; estado loading.
- Captura real: `App.tsx` pasa `focusedPaneId` a `MyReposPanel`; `getTerminalOutput` usa `getTerminal(paneId)` (src/terminal-instances.ts) y lee las últimas ~30 líneas no vacías vía `buffer.active.getLine(...).translateToString(true)` (guard buffer alternate como useXterm.ts:129).
- `MyReposPanel` pasa al panel `activeCellRepoPath` en vez de `activeTab.repoPath` (App.tsx:93-98) para que el contexto sea el del pane enfocado.

## Fase 2 — Adapters en paralelo (worktrees aislados, uno por servicio)

Cada task: adapter main-side en `electron/integrations/<svc>.ts` registrado en el host + entrada `<svc>: () => createIpcAdapter('<svc>', '<Name>')` en `src/integrations/registry.ts` + catálogo actualizado + tests (vitest, fetch mockeado, sin red). Merge posterior resuelve los puntos de contacto (registry, host registration, catálogo).

### Task S (Slack)
- Sections: canales (conversations.list, types public/private) con unread aproximado, DMs. Detail: historial del canal (conversations.history, límite 1req/min fuera del Marketplace — cachear y refrescar manual), autores resueltos con users.list cacheado. resolveWorktreeEntity: canal cuyo nombre matchee el repo o config `channel` del manifest. Actions: refresh. Compose: chat.postMessage (texto + bloque de código con terminalOutput).

### Task G (GitHub)
- Sections: "Assigned to me" (issues), "My PRs", "Recent" del repo del worktree (owner/repo derivado del remote `githubUrl` de git:info o del config). Detail: issue/PR con body, labels, estado, comentarios. resolveWorktreeEntity: branch → PR cuyo head matchee, o issue `#N` si el branch contiene el número. Actions: close/reopen issue, merge no (fuera de alcance). Compose: comment en issue/PR.
- Catálogo: agregar entrada `github` (type integration, auth oauth) si no existe.

### Task J (Jira)
- Sections: "My work" (assignee = me, por estado), "Recent". API REST v3 con Basic auth email:token sobre el site del config. Detail: issue con descripción (ADF → texto plano), estado, prioridad, comentarios. resolveWorktreeEntity: clave `ABC-123` en el nombre del branch. Actions: transiciones reales (GET transitions → botones). Compose: comment.

### Task N (Notion)
- Sections: páginas recientes compartidas con la integración (search API), databases configuradas. Detail: página con bloques (párrafos, code, headings → DetailBlocks). resolveWorktreeEntity: null (no hay mapeo natural, ok). Actions: refresh. Compose: append paragraph/code block a la página.

## Fase 3 — Integración (serie)
- Merge de los 4 worktrees a `feat/integrations`, resolver contactos (registry/host/catálogo), suite completa + build + e2e (el demo e2e sigue igual; los adapters reales se testean unit con fetch mock).
- `.env.example`: sumar `MAIN_VITE_SLACK_CLIENT_SECRET`. README corto de prueba local en Windows al final del plan.

## Prueba local (Windows)
1. `git pull` + `npm install` en `feat/integrations`.
2. `.env`: el existente de esa PC + `MAIN_VITE_SLACK_CLIENT_ID`/`MAIN_VITE_SLACK_CLIENT_SECRET` (Slack app propia) — GitHub funciona con la sesión de siempre; Jira/Notion piden API token en el Connect (form).
3. `npm run dev` → My Repos → Integrations → Install + Connect por servicio.

## Qué NO entra
- Edge Function de exchange (producción), webhooks/realtime, badges inbound, gate Pro server-side, detail-pages del marketplace.
