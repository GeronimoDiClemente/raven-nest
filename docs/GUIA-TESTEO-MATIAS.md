# Matías — Cómo codear y probar Nest en local antes de tirar un PR

> Tu área: **analytics + menú de Teams**. Complementa a `docs/GUIA-EQUIPO.md` (convenciones
> y flujo de PRs) — leé esa primero.

## Setup inicial (una sola vez)

```bash
git clone https://github.com/GeronimoDiClemente/raven-nest.git
cd raven-nest
npm install          # Node 20+
```

Config (sin archivos `.env`, todo por Doppler):

```bash
winget install doppler.doppler   # (Mac: brew install dopplerhq/cli/doppler)
doppler login                    # Gero te invita al workplace Nestmux
doppler setup --project nest --config dev
```

Backend local (tu área es cloud, esto lo vas a necesitar casi siempre):

```bash
# Requiere Docker Desktop corriendo
npx supabase start     # levanta Postgres + Auth + Realtime local con las migraciones del repo
npx supabase db reset  # cuando quieras la base como nueva
```

El config `dev` de Doppler ya apunta a este Supabase local. **Nunca desarrolles contra
producción** — si algo de tu feature parece necesitar datos reales, hablalo con Gero.

## El ciclo de trabajo diario

```bash
git checkout main && git pull
git checkout -b feat/mi-cambio

doppler run -- npm run dev       # la app Electron se abre; hot reload al guardar
```

1. Tocás código en `src/` → la UI se recarga sola. Cambios en `electron/` requieren
   reiniciar la app.
2. **Probás el cambio en la app de verdad**: abrís Teams, navegás a tu sección, hacés
   click en lo que agregaste. "Los tests pasan" no reemplaza haberlo visto andando.
3. Iterás hasta que esté bien.

### Probar cosas de Teams en local

- **Crear un team de prueba**: registrate en la app con un mail cualquiera (el Supabase
  local no manda emails de verdad; el correo de confirmación aparece en
  `http://127.0.0.1:54324` — Inbucket captura todo).
- **Presencia / "online now"**: abrí una segunda instancia de la app logueada con otro
  usuario de prueba y vas a ver a los dos conectados.
- **Datos con volumen** (dashboards, stats): generá seed en `supabase/seed.sql` —
  usuarios y actividad falsos. Si necesitás "un team de 45 devs", se scriptea, no se pide
  acceso a datos reales.
- **GitHub API**: conectá TU cuenta de GitHub desde la app y probá contra tus propios
  repos o repos públicos. Ojo con el rate limit (5000 req/hora): si tu feature fetchea
  en loop, lo vas a notar — y es un bug a arreglar, no un límite a esquivar.

## Pitfalls del área Teams / cloud

- **Los paths locales de repos NO van a Supabase desde v1.2.** Se guardan por máquina en `~/.raven-nest/local-paths.json`. Las columnas viejas (`user_repos.local_path` y `team_repo_local_paths`) quedaron deprecated read-only para clientes viejos y se dropean en v1.3 — no leas ni escribas ahí en código nuevo.
- **Si tocás schema o formatos persistidos, seguí el patrón de deprecación por versión**: lo viejo queda read-only una versión entera antes del drop, porque hay clientes viejos auto-actualizándose en el campo. Nunca un drop en la misma versión que introduce el reemplazo.
- **Todo dato que viaja renderer → main → cloud es untrusted en cada salto.** El review encontró handlers IPC donde un string vacío o `undefined` coercionado disparaba una operación destructiva (ej: `electron/account-store.ts`, corregido en PR #14). Aplicá lo mismo a tus flujos de Teams: antes de un delete/update por id o nombre, validá que el identificador no sea vacío ni un valor "por defecto" que matchee más de lo que debe. Un filtro vacío que borra "todo lo que matchea" es el mismo bug con otra ropa.
- **Las operaciones destructivas (deletes en cloud, `rmSync` local de datos de cuenta/equipo) necesitan un guard explícito y un test que pruebe el caso `''`/`undefined`**, no solo el caso feliz.
- **No agregues React Query/SWR ni un state manager para el sync cloud.** Acá el estado vive en hooks de React (`src/hooks/`) y el cliente de Supabase se usa directo. Si un flujo de Teams te parece que "necesita" una lib nueva, es una conversación de spec primero, no un `npm install`.
- **Los broadcasts main → renderer pueden morir en silencio.** El review encontró que un teardown mal ubicado deja emitters sin listeners y las features cloud-adyacentes (progress de setup, métricas) dejan de reportar sin ningún error visible. Si tu feature depende de eventos del main, verificá el flujo completo después de esconder/restaurar la ventana del tray, no solo en el arranque limpio.
- **Verificación con evidencia**: para features de Teams, el checklist del PR tiene que incluir el escenario multi-dispositivo (segunda máquina entrando a la misma cuenta arranca sin paths locales y ofrece Clone / Link existing folder). Es el caso que más se rompe y el que menos se prueba.

## Qué te va a quedar sin poder validar (y qué hacer con eso)

Hay cosas que por diseño no se validan desde tu entorno local:

- **macOS y Linux** (desarrollás en Windows).
- **El flujo completo de "Connect GitHub" (OAuth)** y todo lo de **billing**.
- **Comportamiento con datos y volumen reales** (tu seed simula, no replica).
- **Builds empaquetados, firma y auto-update** (territorio de release).

Qué hacer: en la sección `## Verificación` de tu PR, dejá cada pendiente como checkbox
sin marcar, con el prefijo explícito:

```
- [ ] Pendiente de validación: smoke en macOS/Linux
- [ ] Pendiente de validación: comportamiento con datos reales
```

Gero cubre esos puntos en su pasada de review. Declarar lo que no probaste no es quedar
mal — es lo que hace que tu PR sea confiable.

**Importante — el repo es público.** En PRs e issues NO se discuten detalles de
seguridad, credenciales, infraestructura ni configuración interna. Si encontrás algo que
te parece un problema de seguridad, o necesitás validar algo que involucra el entorno de
producción, va por mensaje privado a Gero. Nunca en el PR.

## Antes de abrir el PR (obligatorio)

```bash
npx tsc --noEmit   # limpio
npm test           # verde
```

- Probaste el flujo completo en la app corriendo, no solo en tests.
- Te leíste tu propio diff entero (si lo generó un agente, con más razón).
- Descripción del PR escrita por vos: qué, por qué, cómo lo probaste, qué NO pudiste
  probar (ej: "solo validé en Windows").
- Screenshots antes/después si tocaste UI.
- Diff dentro de ~200-400 líneas. Más grande → partilo en PRs apilados.

El CI corre typecheck + tests + build en cada PR y bloquea el merge si algo falla.

## Credenciales — las 4 reglas

1. **No existe `.env`** en tu máquina y así se queda. Todo por `doppler run`.
2. **Nunca imprimas variables de entorno** en terminal ni las pegues en un chat/issue/PR
   — y frená a tu agente de AI si lo intenta "para debuggear".
3. **Nada de valores hardcodeados** en el código, ni "temporalmente". GitHub rechaza
   pushes con API keys (push protection), pero no dependas de eso.
4. Si algo se te filtró igual: avisale a Gero **al toque**. Rotar un valor tarda 2
   minutos; enterarse tarde es lo caro. Nadie se enoja por el aviso temprano.

## Cómo laburamos acá

Esto no es un template genérico: es cómo se labura de verdad en este repo. Si seguís estas convenciones, tus commits y PRs van a encajar con todo el historial existente.

### Idioma

- **Commits, PRs, specs y docs internos: en español.** Los términos técnicos quedan en inglés (adapter, worktree, race guard), pero el subject y las descripciones van en español.
- **Excepciones**: los commits `ci:` puros van en inglés (`ci: pin Windows builds to windows-2022 runner`), y la UI de la app es English-only.

### Ramas

- Convención `tipo/nombre-kebab`: `feat/integrations`, `feat/team-stats`, `docs/readme-v1.1`, `chore/capture-script-fix`. Siempre `feat/`, no `feature/`.
- Para features grandes con tareas paralelizables, **sub-ramas por tarea que se mergean a la rama feature, no a main**: `adapter/slack`, `adapter/jira`, `adapter/github` → merge a `feat/integrations`. A veces esas sub-ramas las laburan agentes en git worktrees en paralelo.
- Mucho trabajo va directo por ramas `feat/*` con merges locales; el PR se tira cuando el feature está redondo o cuando hace falta review.

### Commits

Conventional Commits estricto, subject en español, **scope = nombre del feature/área** (`integrations`, `tutorial`, `cli`, `worktrees`, `release`), no el archivo:

- `feat(integrations): adapter GitHub real (issues, PRs, comments) (Task G)`
- `fix(integrations): race guard + error states del shell y captura real del terminal (F2)`
- `chore(release): v1.3.0 — interactive tutorial + worktree registry fix`

Rasgos de la casa:

- **Marcador de fase entre paréntesis al final** — `(hito 1)`, `(Task A)`, `(F2)` — que traza el commit al plan escrito. Si estás ejecutando un plan, poné el marcador.
- Subjects densos con `+` para enumerar cosas relacionadas del mismo cambio.
- Commits chicos y atómicos, mapeados a las tareas del plan, con TDD visible en el historial: `test(...)` intercalados con `feat(...)`.

### Specs y planes antes de codear

Para cualquier feature grande, **primero se escribe, después se codea**:

1. **Spec/design doc** fechado `YYYY-MM-DD-nombre.md` en `docs/superpowers/specs/` o `docs/design/<feature>/` (puede incluir research previo y mockups).
2. **Plan de implementación** en `docs/superpowers/plans/` o `docs/design/<feature>/`, escrito para ser ejecutable por agentes: tareas con checkboxes, secciones Goal/Architecture/Tech Stack, link al spec, y pasos TDD explícitos (el plan incluye el código del test que falla).
3. El plan se commitea con `docs(scope): ...` **antes** del primer commit de código.
4. Los pivotes también se documentan como spec nuevo antes del commit de pivote.

Hay un `docs/superpowers/ROADMAP.md` con la foto general.

### Pull requests

- **Título** con el mismo formato conventional que los commits, en español. Las releases usan formato libre (`Release v1.1 — tiling layouts, ...`).
- **Descripción** con estructura fija:
  - `## Summary` / `## Resumen` — qué hace y por qué, bullets por capa (Backend / IPC / UI).
  - `## Verificación` — checklist con evidencia concreta y números: `[x] npm test — 125/125 (incluye 8 tests nuevos)`, `[x] npm run build — OK`. Lo pendiente se deja explícito como `[ ]`, no se esconde.
  - `## Notas` — deuda conocida y limitaciones ("tsc -b arrastra 19 errores preexistentes ajenos a este PR; este feature agrega 0").
  - Si hay una advertencia operativa (ej: "no mergear hasta que termine la release X"), va en el PR en negrita, arriba.

La regla de oro de la verificación: **evidencia antes de afirmaciones**. Nunca "debería andar"; siempre el output del comando.

### Releases

- Semver con tags `vX.Y.Z`, cadencia alta de patches. Commit de release dedicado: `chore(release): vX.Y.Z — resumen con em-dash`.
- El proceso paso a paso está en `CLAUDE.md` del repo: verificar `version` en `package.json` → `gh release create` → disparar el workflow de build (Windows, Mac y Linux en paralelo) → `gh release view` para confirmar los artifacts.
- **Ojo con las races del workflow de release**: el push a main puede pisar la release en curso. Si hay una release corriendo, coordiná el merge (preguntá antes de mergear a main durante una release).
- Las deprecaciones se planifican por versión: se deja lo viejo read-only una versión (v1.2) y se dropea en la siguiente (v1.3). Si tocás schema o formatos persistidos, seguí ese patrón.

## Stack y frameworks

Nest es una app de escritorio Electron (v1.3.1, Node >= 20.19), todo en **TypeScript 5.7 strict**.

**Núcleo**
- **Electron 33**: proceso main en `electron/main.ts`, preload en `electron/preload.ts`, output a `dist-electron/`.
- **React 18** en el renderer (`src/`). Project references: `tsconfig.node.json` (main/preload + `src/types.ts` compartido) y `tsconfig.web.json` (renderer).

**Terminal (el corazón de la app)**
- **@xterm/xterm 5.5** en el renderer (`src/hooks/useXterm.ts`) con addons `fit`, `search` y `web-links`.
- **node-pty 1.1** en el main (`electron/pty-manager.ts`). Es módulo nativo: se recompila con `@electron/rebuild` en el postinstall.

**Datos y sistema**
- **@supabase/supabase-js 2** para auth, perfiles, equipos y sync. Ojo: desde v1.2 los paths locales de repos van **por máquina** a `~/.raven-nest/local-paths.json`, no a Supabase.
- **electron-updater** para auto-updates vía GitHub Releases.
- **pidtree + pidusage** para árbol de procesos y métricas CPU/RAM (`electron/metrics-collector.ts`); **koffi** (FFI) cargado lazy solo en Windows (`electron/cwd-reader.ts`).

**UI auxiliar**: **@dnd-kit** (drag & drop de tabs/paneles), **react-resizable-panels** (splits del multiplexer), **@paddle/paddle-js** (billing, integración incipiente).

**Build y testing**
- **electron-vite 3** (Vite 6) para dev y build de los 3 targets; `externalizeDepsPlugin` en main/preload para no bundlear módulos nativos.
- **electron-builder 25**: NSIS (Win), DMG+zip (Mac), AppImage/deb (Linux). Registra el deep-link `nest://`.
- **Vitest 4** con 2 proyectos: `node` (lógica de `electron/` y `src/__tests__/`) y `jsdom` (components/hooks/tutorial).
- **@testing-library/react** para componentes; **Playwright 1.59** para e2e en `e2e/` con la app Electron real (serial, `workers: 1`; correr `npm run pre-e2e` antes).

**Lo que NO usamos (a propósito — no lo agregues sin charlarlo)**
- Sin gestor de estado externo (nada de Redux/Zustand/Jotai): estado con hooks en `src/hooks/`.
- Sin router: app de ventana única.
- Sin CSS-in-JS ni Tailwind: un solo `src/styles/global.css` + inline styles.
- Sin React Query/SWR, sin i18n, sin ESLint/Prettier en deps.
