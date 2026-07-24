# Handoff — cerrar Hub + Analytics (2026-07-24)

Doc para retomar en otra PC. Todo vive en la rama **`review/hub-stats`** (pusheada a
`origin/review/hub-stats`).

## Cómo retomar en la otra PC
```bash
git fetch origin
git checkout review/hub-stats     # o: git pull si ya la tenés
npm install                       # en Windows: node-pty puede necesitar los fixes de la memoria
```
- `.env` / `.env.local` **NO viajan por git** → copiarlos a mano (o usar Doppler).
- La clave de git-crypt tampoco viaja (irrelevante para Hub/Analytics).
- Comandos: dev `npm run dev` · tests `npx vitest run` · tipos `npx tsc -b --noEmit`.

---

## 1) Hub — HECHO, falta probar en vivo + decidir merge

**Modelo final** (commit `54165d9`, tras 3 iteraciones): el Hub = **un workspace normal
de tus terminales más usadas**. Mismo `PaneLayoutEngine` + `TerminalPane` real (zoom /
notes / PR / resize / close). La única diferencia: sus panes son un **subset curado**
(`hubPanes`, ordenado, membership + orden de drag, capeado a `MAX_PANES` = 12) que pinchás
de cualquier workspace. El Hub tab reemplaza toda la vista, así que monta panes reales (no
mirrors).

- Picker rediseñado: sin checkboxes → pin/star al hover, sección "In the Hub (N)", logos de
  agente + pulse de "busy".
- Archivos: `src/components/HubWorkspace.tsx`, `src/components/HubSidebarPanel.tsx`,
  `src/lib/hub-compose.ts` (overlay + hub-compose todavía usan el `HubTile` mirror),
  `src/types.ts` (`WorkspaceTab.hubPanes`), `src/App.tsx` (handlers del include-model),
  `src/styles/global.css` (`.hub-picker` / `.hub-sec` / `.hub-row` / `.hub-av` / `.hub-pin`).
- Según el commit: **257 tests verde, sin errores tsc nuevos** (re-verificar al retomar).

**Falta:**
1. `npm run dev` → abrir el Hub tab → probar: pin/unpin de terminales, drag-reorder, cap de
   12 ("+N more pinned"), empty state, ↗ abrir en workspace.
2. Decidir **merge del combo `review/hub-stats` a `main`** vs **split** a
   `feat/hub-overlay` + `feat/team-stats`.

---

## 2) Analytics (team-stats) — HECHO pero con BUG: "no se ve nada"

**Pivot** (commit `37e305b`): TeamStats = **flujo & salud del equipo**, sin ranking por dev.
7 tarjetas (Online / Commits / PRs merged / Reviews / Cycle time / Review latency / Review
coverage) + distribución de tamaño de PR + gráfico de commits/día.

### Bug reportado (Gero, 2026-07-24)
Abrió **Teams → Stats** y las tarjetas **aparecían pero TODO en `0` / `—`**, "No merged PRs",
sin gráfico.

### Investigación hecha (systematic-debugging, Fase 1)
**Descartado:**
- No es crash / ErrorBoundary → las tarjetas SÍ renderizan.
- No es token faltante → no salió el cartel "Connect your GitHub account".
- No es gate de leader → el panel apareció (requiere leader activo del team).
- No es scope OAuth → `electron/main.ts:2173` pide `repo read:org read:user`, o sea repos
  **privados accesibles**.
- Token presente → `src/hooks/useGitHub.ts` lo lee de `profiles.github_token` (Supabase) al
  montar.

**Conclusión parcial:** el panel renderiza pero **llegan CERO eventos de GitHub**. Toda la
data sale de una sola fuente: `GET /repos/{owner}/{repo}/events`
(`src/hooks/useTeamStats.ts:329`, 3 páginas, ~60 días), filtrada client-side.

**Sospechas restantes (en orden):**
1. **El team activo NO tiene repos linkeados** → `repos` vacío → el `useEffect` corta temprano
   (`if (!githubToken || !repoNames) return`, `useTeamStats.ts:315`) → `events = []` → todo 0.
   *Es lo más probable si probaste en un team sin repos.*
2. **Repos linkeados pero sin eventos recientes** en la ventana (el endpoint `/events` es
   limitado: ~90 días, delay de hasta 6h, puede venir casi vacío para repos poco activos).
3. **Token inválido/expirado** → fetch 401/403 → cada repo a `failed` → mostraría el aviso
   amarillo "Could not load N of N repos". (Gero no mencionó aviso → menos probable, confirmar.)

### Próximo paso concreto (hacer en la otra PC, con la cuenta de Gero)
Instrumentar el boundary de la fetch para ver **dónde** se rompe. En
`src/hooks/useTeamStats.ts`, dentro de `load()`, agregar temporalmente:
```ts
console.log('[team-stats] repos:', repoList)
// ...después del pool de fetch (antes de setEvents):
console.log('[team-stats] events:', all.length, 'failed:', failed)
```
Abrir Teams → Stats con DevTools y leer la consola:
- `repos: []` → **causa #1** (team sin repos): linkear un repo con actividad y reprobar.
- `events: 0, failed: [...]` → **causa #3** (token/acceso): revisar / re-conectar GitHub.
- `events: 0, failed: []` → **causa #2** (repos sin eventos en `/events`): evaluar cambiar de
  fuente de datos.
- `events: >0` pero tarjetas en 0 → bug de filtrado/agregación (revisar `isWithinWindow` /
  `CONTRIB_TYPES` en `useTeamStats.ts`).

### Riesgo de diseño a verificar (independiente de la cuenta)
Aún con eventos, las cards de **flujo** (Cycle time, Review latency, PR size, Review coverage)
dependen de campos del payload de `PullRequestEvent` / `PullRequestReviewEvent`:
`pull_request.created_at / merged_at / additions / deletions / number` y `review.submitted_at`.
**Falta confirmar que la Events API realmente los trae.** Si no los trae, esas 4 métricas
quedan siempre en `—` aunque haya actividad, y habría que leerlas de la API de PRs/reviews
(más llamadas). Probar contra un repo real antes de dar Analytics por cerrado.

---

## Housekeeping
- Stash `wip CLAUDE.md pre-review PR21` pendiente para restaurar al volver a
  `feat/tutorial-interactivo`.
- Sin decidir: merge vs split de `review/hub-stats`.
- Untracked no relacionados en el working tree (`.claude/hooks/`, `capture/`, `pitch-neutron.md`,
  etc.) — no forman parte de este trabajo, no commitear.
