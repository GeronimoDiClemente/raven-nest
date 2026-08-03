# Handoff — Hub perf + roster de Analytics (2026-08-02)

Doc para retomar en otra PC. Todo vive en la rama **`review/hub-stats`**
(pusheada a `origin/review/hub-stats`).

> Nota: los handoffs viejos están en `docs/superpowers/plans/` pero esa carpeta
> ahora está gitignored (`.gitignore:14`), así que este va en `docs/` para que
> viaje por git.

## Cómo retomar
```bash
git fetch origin
git checkout review/hub-stats && git pull
npm install
# dev con userData separado (convive con la Nest instalada, ver nota abajo):
npx electron-vite dev -- --user-data-dir=/tmp/nest-dev-userdata
```
- Login en la ventana de dev: **email/password** (los botones sociales y "Connect
  GitHub" usan deep links `nest://` que pueden caer en la Nest instalada).
- El token de GitHub se lee por-usuario de Supabase (`profiles.github_token`), así
  que con loguearte alcanza — no hace falta reconectar GitHub.

### Nota: correr dev en paralelo a la Nest instalada
La instancia de dev usaba el mismo `userData` y el mismo `requestSingleInstanceLock()`
que `/Applications/Nest.app`, así que si la app instalada está abierta, el dev veía el
lock tomado y hacía `app.quit()` en silencio (sin ventana). Solución: `--user-data-dir`
propio vía el passthrough de electron-vite (`electron-vite dev -- --user-data-dir=…`).
electron-vite lo pasa a electron vía `ELECTRON_CLI_ARGS` (seteado por lo que va después
de `--`; exportarlo a mano NO sirve, `cli.cjs` lo sobrescribe). Consecuencia: esa
instancia arranca "limpia" (sin tu login) porque tiene su propio userData.

---

## 1) Hub — reducción de recursos (HECHO, commiteado)

Contexto: el rediseño del Hub-como-workspace queda **como está**. Se probó
overlay-como-única-opción + minimizar con pill flotante, pero se descartó por ahora
("se ve feo", se reacomodará más adelante) y se revirtió al estado de la rama.

Lo que SÍ se hizo y quedó commiteado — **bajar el consumo del clasificador de
actividad del Hub**, que corre para toda la sesión (se monta en `App.tsx:125
useHubActivity()` y alimenta los dots del picker del Hub en el sidebar, que está
siempre montado), procesando cada chunk de PTY de cada terminal:

1. **`src/lib/terminal-chrome.ts` — `hasVisibleOutput`**: short-circuit con
   `/\S/.test(...)` en vez de `.replace(/\s/g,'').length > 0`. Una allocation menos
   de string por chunk. Mismo comportamiento.
2. **`src/hub-activity.ts` — throttle por-pane (250ms)**: un pane ya activo no
   re-corre la regex en cada chunk (bajo salida pesada baja de cientos de
   clasificaciones/seg a ~4/seg). El dot puede apagarse hasta 250ms antes (dentro
   de la tolerancia de `ACTIVE_QUIET_MS = 3500`). Un pane aún no activo siempre se
   clasifica → activación nunca se demora.

Verificado: `tsc -b --noEmit` en 19 (baseline, 0 nuevos), tests `hub-activity` +
`terminal-chrome` verdes.

### Ideas de perf NO aplicadas (pendientes si hace falta)
- **Teardown del bus cuando no hay listeners** en `hub-activity.ts` (ref-count;
  hoy App siempre escucha, así que solo ayuda si se mueve el consumo).
- **Dispatch O(1) por `paneId`** en `pty-events.ts` (hoy cada mirror agrega un
  subscriber global que filtra por id → O(tiles) por chunk, solo con overlay abierto).

---

## 2) Analytics — el roster de "Team members" NO aparece (DIAGNOSTICADO, falta fix)

### Síntoma (confirmado por screenshot, 2026-08-02)
En **Teams → Stats**: las tarjetas agregadas SÍ traen datos (PR size 4/7/5/33, "348
commits in the period", gráfico de commits/día OK) → **la data de GitHub (GraphQL)
funciona**. Pero bajo el título **"TEAM MEMBERS" NO hay ninguna fila** (solo el título
y una línea vacía). O sea el problema NO es de actividad ni de `github_login`: es que
la lista de **miembros de Supabase llega vacía**.

### Camino de datos (verificado)
1. Miembros: `useTeam.loadMembers()` → `select('*') from team_members where team_id`
   (`src/hooks/useTeam.ts:67-78`). Si el select falla (RLS/red) devuelve `null` y
   `refresh` **mantiene el `members` previo** (`useTeam.ts:190-191`, que puede ser `[]`).
2. Mapeo a props: `TeamsWorkspace.tsx:1311` →
   `members.filter(m => m.status === 'active').map(...)`. **Doble gate**: miembros
   vacíos O ninguno con `status === 'active'` → lista vacía.
3. Roster: `TeamStats.tsx` arma `memberRows` (left-join contra stats por `login`,
   default 0) y renderiza `<TeamMemberList>` **sin gate** (siempre). Por eso se ve el
   título pero cero filas cuando `members` filtrado es `[]`.

### Causa raíz = miembros vacíos tras el filtro. Falta distinguir cuál de las dos:
- (a) `team_members` viene **vacío** por RLS/red (`loadMembers` → null → previo `[]`).
- (b) `team_members` tiene filas pero **ninguna con `status === 'active'`** (¿'pending'?).

### Próximo paso concreto (en la otra PC, con la cuenta de Gero)
1. **Chequeo cruzado rápido:** abrí Teams → **pestaña "Members"** y el sidebar de
   presencia. Si ahí TAMPOCO se ven miembros → es (a) (carga/RLS de `team_members`).
   Si ahí SÍ se ven pero en Stats no → es (b) (filtro `status === 'active'`).
2. **Log en el boundary correcto** (antes del filtro, en `TeamsWorkspace.tsx:1311`):
   ```ts
   console.log('[members]', members.map(m => ({ email: m.email, status: m.status, gh: m.github_login })))
   ```
   - array vacío → (a): revisar consola por `[useTeam.loadMembers] ... failed` y la
     RLS de SELECT de `team_members` (ver `supabase/migrations/020_fix_team_members_recursion.sql`).
   - filas con `status !== 'active'` → (b): decidir si el roster debe incluir otros
     estados o si el dato de status está mal.
3. **Aparte (no bloquea el roster, pero apaga el drill-down):** confirmar que la
   migración `20260730000000_team_members_github_login.sql` esté aplicada y
   `profiles.github_login` poblado; si `github_login` es null, cada fila cae al branch
   "No GitHub linked" (`TeamMemberList.tsx:53`) — sin trend/chip/click.

---

## Housekeeping
- Stash local en **feat/integrations**: `wip CLAUDE.md pre dev` (cambio de la sección
  "Hacer una release" del CLAUDE.md). Es ajeno a este trabajo y NO viaja por git;
  restaurarlo con `git stash pop` al volver a `feat/integrations` en ESTA PC.
- `.mcp.json` untracked en el working tree — config local de MCP, no commitear.
- El diseño overlay/minimizar del Hub quedó descartado por ahora (se reacomodará).
