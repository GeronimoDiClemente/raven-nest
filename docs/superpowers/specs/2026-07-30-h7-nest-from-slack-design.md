# H7 — @Nest desde Slack + agente asignable

**Fecha**: 2026-07-30
**Estado**: diseño autónomo (Gero delegó los 4). Decisiones según spec madre `2026-07-11` §H7.
**Depende de**: adapter Slack (H2), bus (H8), flujo worktree+pane con `initialInput` (H4), notify (H5).
**Alcance**: "motor + UI cableada", TDD unitario (websocket + fetch mockeados). Sin app Slack real con
Socket Mode en el entorno → NO se testea en vivo; se deja implementado y cubierto por unit tests.

## 1. Objetivo
Mención `@Nest` en un thread de Slack → worktree + agente local con el contexto del thread; el agente
postea updates al thread; link "Abrir en Nest". Diferencial vs Cursor/Devin (VMs remotas): el dev
puede **tomar el control del terminal** cuando el agente se traba. Modelo de responsabilidad Linear:
humano assignee, agente contributor.

## 2. Transporte — Slack Socket Mode (entrante, sin endpoint público)
Desktop no puede exponer un webhook público → **Socket Mode**: un WebSocket saliente autenticado con
un **app-level token** (`xapp-...`, scope `connections:write`). Se usa el `WebSocket` global de Node
(Electron/Node reciente lo trae — **sin dependencia nueva**). Flujo:
1. `apps.connections.open` (POST, Bearer app-level token) → devuelve una `wss://` URL efímera.
2. Abrir el WebSocket a esa URL. Slack manda envelopes `{type, envelope_id, payload}`.
3. Por cada envelope hay que **ACK** (`{envelope_id}`) inmediato, o Slack reintenta.
4. Reconexión: en `disconnect`/cierre, re-`open` y reconectar (backoff simple).

El app-level token vive en `pluginCreds('slack-app')` (distinto del bot token). Sin él → Socket Mode
no arranca (feature off), sin romper el resto de Slack.

## 3. Eventos que consume
- **`app_mention`** (`@Nest ...` en un canal/thread): parsear el texto tras la mención como
  instrucción. Extraer `channel`, `thread_ts`, `user`, `text`.
- **`block_actions`** (clicks de los botones que H5 dejó como links → en H7 pasan a botones Block Kit
  reales): "Relanzar" / "Arreglar el rojo" / "Abrir en Nest". El payload trae la acción + contexto.

## 4. Puente Slack → worktree/pane
El main recibe el evento pero **no** abre panes (eso es del renderer). Camino:
1. Handler de `app_mention` en main → arma un `SlackMentionRequest {channel, threadTs, user, text,
   repoHint?}` y lo **empuja al renderer** por IPC (`slack:mention`, patrón push como `signals:update`).
2. El renderer resuelve el repo (por `repoHint` o el activo), crea worktree, abre pane con el agente
   y `initialInput` = contexto del thread (reusa H4), y registra `{paneId → {channel, threadTs}}`.
3. **Updates al thread**: cuando el agente produce hitos (PR abierto, CI verde, terminó) el bus ya
   emite esos eventos; una receta `→ notify` con `thread_ts` postea al MISMO thread. Para v1 el
   "update" mínimo es: al crear la sesión, postear "🪺 Trabajando en esto — <deep link Abrir en Nest>";
   al `pr.opened`/`ci.failed` del branch, postear al thread.

## 5. Comandos/acciones desde Slack (botones reales)
Con el socket entrante ya disponible, los botones de H5 se vuelven accionables:
- "Arreglar el rojo" → dispara el mismo `fixCiPrompt` de H4 en el worktree asociado.
- "Relanzar" → re-inyecta el prompt al pane.
Ejecución: `block_actions` → IPC al renderer → acción sobre el pane. ACK inmediato + respuesta al thread.

## 6. Archivos
- Create: `electron/integrations/slack-socket.ts` — cliente Socket Mode (open/connect/ack/reconnect,
  parseo de envelopes, callbacks tipados `onAppMention`/`onBlockAction`). Testeable con un
  WebSocket fake inyectado.
- Create: `electron/__tests__/slack-socket.test.ts`.
- Modify: `electron/main.ts` — arrancar el socket si hay app-level token; rutear a IPC push
  `slack:mention`/`slack:action`; handler para postear al thread (reusa `chat.postMessage` con `thread_ts`).
- Modify: `electron/preload.ts` — `window.slackMentions.onMention/onAction`.
- Modify: `src/App.tsx` — consumir `slack:mention` → crear worktree + pane con `initialInput` + registrar
  el mapeo pane→thread; consumir `slack:action` → acción sobre el pane.
- Modify: `electron/integrations/recipes.ts` / `bus-commands.ts` — postear updates al thread por evento.
- Tests: parseo de envelopes (`app_mention`, `block_actions`), ACK, reconexión, extracción de
  instrucción de la mención, armado del mensaje de update con `thread_ts`.

## 7. Riesgos
- **Sin app Slack con Socket Mode** en el entorno → sin testeo en vivo; cobertura por unit tests con
  WebSocket fake. Es el motor de mayor riesgo de integración real.
- El app-level token y el manifest de la app Slack (scopes `app_mentions:read`, `connections:write`,
  interactividad) son setup manual del usuario, documentar en onboarding.
- Reconexión y ACK son la fuente de bugs típica de Socket Mode: cubrir con tests dedicados.
- Seguridad: validar que la mención viene de un usuario/workspace autorizado antes de abrir sesión
  (evitar que cualquiera dispare worktrees). v1: restringir al workspace del token instalado.
