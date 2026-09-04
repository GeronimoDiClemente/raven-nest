# H6 — Google Calendar (Motor 4 salida, empezando por la inversa)

**Fecha**: 2026-07-30
**Estado**: diseño autónomo (Gero delegó los 4). Decisiones según spec madre `2026-07-11` §H6.
**Depende de**: bus (comando `logOutcome` ya tipado en `bus-types.ts`), `pluginCreds`, `initialInput` (H4).
**Alcance**: "motor + UI cableada", TDD unitario (fetch mockeado). No hay credenciales Google en el
entorno → NO se testea en vivo; se deja implementado y verificado por unit tests.

## 1. Principio (spec madre)
Empezar por la **inversa**: registrar *outcomes* reales en el calendario ("45 min en RAV-123, 3
commits, PR #456") — la agenda miente, el registro real no. "Block → Session" como prompt de **un
click, JAMÁS automático**. Arrancar en modo lectura donde se pueda; el registro necesita escritura.

## 2. Auth — OAuth desktop loopback + PKCE
El client secret no puede vivir en el binario → **PKCE** (sin secret). Flujo en main:
1. Servidor HTTP efímero en `127.0.0.1:<puerto libre>` (loopback) como `redirect_uri`.
2. `code_verifier`/`code_challenge` (S256). Abrir el browser del sistema a la URL de consent.
3. El loopback recibe `?code=...`, se hace el exchange (`oauth2.googleapis.com/token`, con
   `code_verifier`) → `{access_token, refresh_token}`. Guardar en `pluginCreds('gcal')` como JSON
   `{accessToken, refreshToken, expiresAt}`. Refresh cuando expira (401 → refrescar → reintentar).
- Scope: `https://www.googleapis.com/auth/calendar.events` (leer + escribir description de eventos).
  Documentar que la verificación de Google (sensitive scope) queda pendiente pre-release.
- Client id: `import.meta.env.MAIN_VITE_GCAL_CLIENT_ID` (igual patrón que Slack). Sin él → "not configured".

## 3. Adapter `electron/integrations/gcal.ts`
Credential-free vía `deps` (token desde `pluginCreds('gcal')`, con refresh). Métodos:
- `listEvents(timeMin, timeMax)` → eventos del rango (`calendar/v3/calendars/primary/events`).
- `findEventByTask(taskId)` → busca por `privateExtendedProperty=taskId=<id>` (extended properties
  privadas guardan `{taskId, repo, branch}` sin DB extra — spec madre).
- `appendOutcome(eventId, summary)` → PATCH `description` del evento (append de una línea de outcome).
- `createOutcomeEvent(summary, when)` → crea un evento corto de registro si no hay uno asociado.

Parseo/armado testeable puro: `formatOutcome({repo, branch, prNumber, commits, testsGreen})` → string.

## 4. Motor 4 salida — handler `logOutcome`
El comando `logOutcome {ref, summary}` (YA tipado en `bus-types.ts`) obtiene su handler en
`bus-commands.ts`: resuelve el evento por `ref` (taskId) con `findEventByTask`; si existe →
`appendOutcome`; si no → `createOutcomeEvent`. Credential-free; sin token gcal → no-op con warn.
Receta default nueva: `pr.merged` → `logOutcome` (además de `updateStatus`+`notify` de H3/H5).

## 5. Block → Session (entrada, un click)
- Panel de Calendar (nuevo, mínimo) o sección en el shell: lista los bloques del día (`listEvents`).
- Botón **"Start session"** en un bloque → crea worktree (si el bloque tiene extended prop `repo`/
  `branch`, los usa; si no, pide repo destino) + inyecta el título/descr del evento como
  `initialInput` (reusa H4). **Nunca automático**: siempre requiere el click (spec madre).

## 6. Archivos
- Create: `electron/integrations/gcal.ts` (adapter + OAuth helpers PKCE), `electron/__tests__/gcal.test.ts`.
- Modify: `electron/main.ts` — IPC `gcal:openOAuth`, `gcal:listEvents`, `gcal:startSession`; loopback server.
- Modify: `electron/preload.ts` — `window.gcal`.
- Modify: `electron/integrations/bus-commands.ts` — handler `logOutcome` (Calendar) + registrar.
- Modify: `electron/integrations/recipes.ts` — `pr.merged → logOutcome`.
- Modify (opcional/mínimo): `src/components/` — panel/lista de bloques con "Start session".
- Tests: `formatOutcome`, PKCE `code_challenge` (S256 determinístico dado un verifier fijo),
  `findEventByTask`/`appendOutcome` (fetch mock), handler `logOutcome` (append vs create).

## 7. Riesgos
- **Sin credenciales Google** → sin testeo en vivo; cobertura por unit tests. El OAuth loopback y el
  refresh se testean con fetch/servidor mockeado, no contra Google real.
- Verificación de scope sensitive de Google: semanas; decisión de release, no bloquea el código.
- El loopback server debe cerrarse siempre (timeout + al recibir el code) para no dejar puertos abiertos.
