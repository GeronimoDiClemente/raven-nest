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

## 2) Analytics — roster de "Team members" casi vacío (FIX APLICADO, verificar en vivo)

### Síntoma (screenshot 2026-08-02)
En **Teams → Stats**: las tarjetas agregadas SÍ traen datos (PR size 4/7/5/33, "348
commits in the period", gráfico OK) → la data de GitHub (GraphQL) funciona. Pero bajo
"TEAM MEMBERS" no se veían miembros.

### Diagnóstico final (corregido)
La primera hipótesis ("`members` vacío") era **incorrecta**: la pestaña Stats solo
renderiza si `isTeamLeader` (`TeamsWorkspace.tsx:314`), que exige al menos al líder
(vos) con `status === 'active'` en `members` → o sea `members` NO está vacío.

Causa real: el roster se armaba **solo** desde `team_members` de Supabase
(`members.filter(status === 'active')`, `TeamsWorkspace.tsx:1311`), así que si el equipo
tiene pocos (o solo el líder) registrados en Nest, la lista queda casi vacía aunque en
GitHub contribuyan muchos devs (que sí aparecen en las tarjetas agregadas).

### Fix aplicado
Nuevo helper puro **`buildRoster(members, developers, prevByLogin)`** en
`src/lib/employee-analytics.ts` (con tests): **une** los miembros registrados con los
**contribuidores reales de GitHub** (`stats.developers`), match de login
**case-insensitive** (los logins de GitHub no distinguen mayúsculas — de paso arregla
el bug latente de casing que zeroeaba stats) y excluye bots (`[bot]`) y `unknown`.
- `TeamStats.tsx`: `memberRows = buildRoster(...)` en vez del `.map` sobre members.
- `selectedEmp` (drawer) hecho robusto: soporta un login seleccionado que NO es miembro
  registrado (cae a la data de GitHub) y hace lookups case-insensitive.
- Verificado: tsc en 19 (baseline), tests `employee-analytics` (16) + `useTeamStats` /
  `team-stats-graphql` / `team-flow-metrics` (35) verdes.

### A verificar en vivo mañana (no pude correrlo acá)
1. Abrir Teams → Stats: ahora el roster debería listar a los contribuidores de GitHub
   (los mismos que suman los 348 commits), clickeables → drawer de coaching.
2. Confirmar que el líder/miembros registrados salgan una sola vez (dedup por login).
3. Si querés que el roster sea SOLO miembros registrados de Nest (no todos los
   contribuidores del repo), es una decisión de producto — se revierte fácil volviendo
   `buildRoster` a solo `members`. Lo dejé unido porque es lo que pediste ("ver los
   miembros") y es lo útil para un dashboard de coaching del equipo.
4. **Aparte (drill-down de miembros registrados):** para que un miembro registrado
   traiga su avatar/online y no dependa del match por GitHub, conviene tener la
   migración `20260730000000_team_members_github_login.sql` aplicada y
   `profiles.github_login` poblado.

---

## Housekeeping
- Stash local en **feat/integrations**: `wip CLAUDE.md pre dev` (cambio de la sección
  "Hacer una release" del CLAUDE.md). Es ajeno a este trabajo y NO viaja por git;
  restaurarlo con `git stash pop` al volver a `feat/integrations` en ESTA PC.
- `.mcp.json` untracked en el working tree — config local de MCP, no commitear.
- El diseño overlay/minimizar del Hub quedó descartado por ahora (se reacomodará).
