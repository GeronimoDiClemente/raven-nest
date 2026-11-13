# Guía de desarrollo del equipo — Nest

> Para Matías y Bautista. Cómo está armada la app, qué convenciones seguimos y cómo llevar
> sus desarrollos sin romper `main`. Gero actúa de PM/tech lead y es quien mergea.
>
> Complementa a `CONTRIBUTING.md` (setup del entorno) y `CLAUDE.md` (instrucciones para agentes).

## 1. Cómo está armada Nest

Electron + electron-vite + React + TypeScript estricto. Tres capas:

### Main process (`electron/`)
- **`electron/main.ts`** — punto de entrada. Registra TODOS los IPC handlers con
  `ipcMain.handle('<domain>:<action>', ...)`. Ejemplos: `pty:create`, `session:save`,
  `git:clone`, `workspace:list`. Si agregás un canal nuevo, seguí ese naming.
- **Stores**: patrón `electron/<domain>-store.ts` — clases con `list/save/delete/get` que
  persisten JSON bajo `~/.raven-nest/` (`ravenHome()`). Existentes: `account-store`,
  `conversation-store`, `settings-store`, `snippet-store`, `workspace-store`,
  `worktree-store`, `mcp-store`, `preset-store`, `local-paths-store`, `plugins-store`,
  `custom-cli-store`. Un dominio nuevo de persistencia = un store nuevo con este patrón,
  no un JSON suelto.
- **`pty-manager.ts`** — clase `PtyManager extends EventEmitter`; maneja los PTYs y retiene
  scrollback en `buffers: Map<paneId, string[]>`.
- Integraciones externas en `electron/integrations/` (github, slack, notion, jira + `register.ts`).

### Bridge (preload)
`electron/preload.ts` expone namespaces con `contextBridge.exposeInMainWorld('<domain>', ...)`;
cada método envuelve `ipcRenderer.invoke('<domain>:<action>')`. El renderer usa
`window.pty`, `window.session`, `window.github`, etc. **Los tipos de esos globals viven en
`src/types.ts`** — si agregás un método al bridge, tipalo ahí.

### Renderer (`src/`)
- `src/App.tsx` — orquestador central (tabs, layout, carga/guardado de sesión con debounce).
- `src/components/` — componentes React (uno por archivo).
- `src/hooks/` — hooks `use<Cosa>.ts`; la lógica de datos va acá, no en los componentes.
- `src/lib/` — utilidades (`supabase.ts`, `bridge.ts`, `ci/`, `plugins/`).
- `src/layout/` — motor de layouts puro (sin React), testeable en aislamiento.
- `src/styles/global.css` — **único archivo de estilos**. Clases nuevas al final, con prefijo
  por feature (ej: `.ts-*` para team stats). Usar los tokens CSS existentes
  (`var(--text-muted)`, etc.), nunca colores hardcodeados.

### Supabase (`supabase/`)
- Cliente en `src/lib/supabase.ts` (proxy swappeable para tests/tutorial).
- Migraciones SQL numeradas en `supabase/migrations/` — **no crear migraciones sin hablar con Gero**
  (afectan a todos los usuarios en producción).
- Edge functions en `supabase/functions/` (`github-oauth`, `stripe-webhook`, etc.).

## 2. Convenciones

| Tema | Regla |
|---|---|
| Idioma | Código, comentarios y strings de UI en **inglés**. (Los PRs y el chat entre nosotros, en español.) |
| TypeScript | Estricto, sin `any`. `npx tsc --noEmit` limpio antes de pedir review. |
| Tests unit | `src/__tests__/hooks/` y `src/__tests__/components/` (jsdom), `electron/__tests__/` (node). Corren con `npm test`. |
| Tests e2e | Playwright en `e2e/` (`npm run e2e`). Al menos un smoke test si tu feature agrega UI navegable. |
| Estilos | Todo en `global.css`, tokens CSS, prefijo por feature. |
| Specs y planes | `docs/superpowers/specs/YYYY-MM-DD-<tema>-design.md` y `docs/superpowers/plans/`. |
| Commits | Estilo conventional: `feat: ...`, `fix: ...`, `test: ...`. Se squashea al mergear, así que priorizá el título del PR. |
| IPC | Canales `<domain>:<action>`; método tipado en `preload.ts` + `src/types.ts`. |

## 3. Flujo de trabajo

Trunk-based con ramas cortas. `main` está protegida: PR obligatorio, 1 aprobación,
checks verdes, sin force-push.

1. **Rama por tarea** desde `main` actualizado: `feat/<tema>`, `fix/<tema>`.
   Vida corta: días, no semanas. Rebaseá sobre `main` seguido.
2. **PRs chicos**: target ~200 líneas de diff real (sin contar docs/tests), techo 400.
   Un feature grande se corta en PRs apilados que se mergean en orden. Un PR = una cosa.
3. **Antes de pedir review** (checklist obligatorio):
   - [ ] `npm test` verde y `npx tsc --noEmit` limpio
   - [ ] Probaste el feature **en la app real** (`npm run dev`), no solo en tests
   - [ ] Te leíste tu propio diff completo — si lo generó un agente, más razón
   - [ ] La descripción del PR la escribiste/editaste vos: qué, por qué, cómo lo probaste,
         qué NO pudiste probar (plataforma, datos reales). Nada de scaffolding del agente.
   - [ ] Screenshots antes/después si tocás UI
4. **Review**: Gero revisa dentro de las 24h. Mergea Gero, siempre con **squash**.
5. **Si tu rama vive más de 2-3 días**, avisá en el chat: probablemente haya que cortarla.

### Reglas específicas para código generado con AI

La mayoría del código acá sale de agentes. Eso está bien — estas reglas existen porque
los PRs de AI traen más defectos por línea y más sutiles:

- **Nunca** borrar, skipear o debilitar un test para que pase CI. Es rechazo automático.
- Antes de escribir un helper, buscá si ya existe (`grep` / pedirle al agente que explore).
  Los agentes reimplementan cosas que ya están en `src/lib/` o en hooks existentes.
- Todo cambio de lógica lleva un test que **falle sin el cambio**.
- El agente lee `CLAUDE.md` al arrancar: si te desvía de las convenciones, el fix es
  mejorar `CLAUDE.md`, avisale a Gero.
- No dejes que el agente toque archivos fuera de tu área (sección 6) "de paso".

## 4. Área de Matías — Analytics + menú de Teams

Componente raíz: `src/components/TeamsWorkspace.tsx`. Las secciones se definen en el
union `WorkspaceSection` + `NAV_ITEMS`, y cada una renderiza su componente:
`ActivityFeed`, `DailyStandup`, `TeamChat`, `PRList`/`PRReview`, `IssueList`/`IssueDetail`,
`RepoStatusPanel`, `NotificationPanel`.

Hooks del área (en `src/hooks/`): `useTeam` (members, invites, roles), `useTeamChat`,
`useTeamPresence`, `useTeamRepos`, `useTeamJoinCode`, `usePendingInvitesCount`,
`useSharedSnippets/Workspaces/McpConfigs`.

Flujo de datos:
- **Supabase Realtime** para presencia (`supabase.channel('team-presence:${teamId}')`) y
  chat (tablas `team_chat_*` + canal `postgres_changes`).
- **GitHub REST API** directo desde hooks/componentes con `fetch`, token por props desde
  `useGitHub` (que lo lee de `profiles.github_token`). Ese es el patrón: no crear otro
  mecanismo de acceso a GitHub.
- Permisos: `isTeamLeader` ya existe en `TeamsWorkspace`. Ojo: gatear por UI no es
  seguridad real (DevTools está habilitado); si algo es confidencial de verdad, se
  enforcea con RLS en Supabase — hablarlo con Gero.

Para agregar una sección al menú de Teams: agregar el id a `WorkspaceSection`, la entrada
en `NAV_ITEMS`, el bloque de render, y el componente + hook nuevos en sus carpetas.
El PR #13 (Team Stats) es el ejemplo de referencia de este patrón.

## 5. Área de Bautista — Memoria de contextos + editor de código

### Cómo se persiste hoy la sesión
- El layout/panes se serializa como `SessionData`/`SessionPane` (ver `src/types.ts`) y se
  guarda en `~/.raven-nest/session.json` vía `session:save`/`session:load`
  (handlers en `electron/main.ts`). La restauración vive en `src/App.tsx`
  (`window.session.load()` → `sessionToPane`).
- El scrollback de cada terminal vive en memoria en `PtyManager.buffers`
  (`electron/pty-manager.ts`); `getBuffer(paneId)` lo devuelve.
- Las conversaciones de IA se archivan aparte en `electron/conversation-store.ts`.

**Para "memoria de contextos"**: el patrón correcto es un store nuevo
(`electron/context-store.ts` o extender `conversation-store`), handlers IPC
`context:<action>`, namespace en `preload.ts`, tipos en `src/types.ts`, y un hook
`useContexts` en el renderer. Mirá `conversation-store.ts` como referencia 1:1.

### Cómo enchufar el editor de código
Hoy **no existe editor** en Nest (nada de Monaco/CodeMirror; solo xterm y el
`DiffViewerPanel`). El punto de integración es el sistema de panes:

1. `src/types.ts`: agregar el tipo al union `AIType` (o campo análogo a `url` del browser
   pane en `SessionPane`) para que la sesión lo persista.
2. `src/components/NewPaneDialog.tsx`: opción para crear el pane editor.
3. `src/App.tsx` → `renderPane`: rama nueva que monte `EditorPane` — **seguí el patrón de
   `BrowserCell.tsx`**, que es el precedente exacto de un pane no-terminal.
4. El motor de layout (`src/layout/`, `PaneLayoutEngine.tsx`) no se toca: es agnóstico
   del contenido del pane.
5. Elección de librería de editor (Monaco vs CodeMirror, peso del bundle): **decisión con
   spec previa** — escribir `docs/superpowers/specs/` y charlarla antes de codear.

Docs de referencia del sistema de panes:
`docs/superpowers/specs/2026-05-13-pane-layout-design.md` y su plan.

## 6. Zonas sensibles — no tocar sin hablar con Gero

- `electron/main.ts` fuera de agregar tus propios handlers IPC
- `supabase/migrations/` (afecta producción)
- `.github/workflows/`, `package.json` (dependencias nuevas), `signing/`
- `src/App.tsx` fuera del punto de integración que te toca
- Todo lo de billing (`stripe-*`), auth y OAuth

Si tu feature necesita cambios ahí, se coordina primero — no es que no se pueda, es que
se decide junto.

## 7. Cómo probar localmente (env y Supabase)

Casi nada del `.env` es secreto de verdad: la URL/anon key de Supabase, los client IDs de
OAuth y la publishable key de Stripe son **públicos por diseño** (ya viajan en el binario
de Nest; la seguridad real es RLS). Aun así, los valores se comparten por Doppler,
**nunca por chat**.

### Config con Doppler (setup una sola vez)

La config de entornos vive en Doppler (workplace `Nestmux`, proyecto `nest`). No hace
falta ningún archivo `.env` local: las variables se inyectan al correr la app.

1. Instalar la CLI: `brew install dopplerhq/cli/doppler` (Mac) o
   `winget install doppler.doppler` (Windows). Gero te invita al workplace.
2. `doppler login`
3. En la carpeta del repo: `doppler setup --project nest --config dev`
4. Correr la app: `doppler run -- npm run dev`

El config `dev` apunta al Supabase **local** (`supabase start`), nunca a producción.
Regla: los secretos no se imprimen en terminal, no se pegan en chats y no se commitean —
GitHub además rechaza pushes que contengan API keys (push protection activo).

- **Features locales** (panes, terminales, MCP, snippets): no necesitan `.env` — corré
  `npm run dev` y listo.
- **Features cloud** (Teams, analytics, chat): usá un Supabase **local** con
  `supabase start` (requiere Docker) — levanta el stack entero, aplica las migraciones de
  `supabase/migrations/` y el seed. `supabase db reset` te deja la base como nueva.
  **Nunca desarrolles contra el proyecto de producción.**
- **Datos de prueba**: si tu feature necesita volumen (ej: un team con 45 devs), se genera
  seed determinístico (`supabase/seed.sql` o `@snaplet/seed`), no se piden datos reales.
- Si necesitás probar contra un entorno compartido (OAuth real, Stripe test), pedile a
  Gero acceso al proyecto de **staging**.

## 8. Flujo de release

Los PRs aprobados se van acumulando en `main` (squash merge, un commit por PR). Cuando hay
un conjunto que amerita release, **Gero** corre el proceso: bump de `version` en
`package.json`, tag `vX.Y.Z`, release en GitHub y el workflow de build (Windows/Mac/Linux).
Los pasos exactos están en `CLAUDE.md` → "Hacer una release". Los devs no tocan
`min-version.json`, tags ni releases.

Para revisar un PR de punta a punta, Gero usa el comando `/revisar-pr <numero>`
(definido en `.claude/commands/revisar-pr.md`): trae el PR, corre typecheck + tests,
prueba la app, y lanza code review + security review.

## 9. Comandos de referencia

```bash
npm run dev        # app en modo desarrollo
npm test           # unit tests (vitest)
npm run e2e        # Playwright (buildea antes via pre-e2e)
npx tsc --noEmit   # typecheck estricto
npm run build      # build completo
```
