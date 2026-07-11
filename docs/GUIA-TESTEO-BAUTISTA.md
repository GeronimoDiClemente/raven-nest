# Bauti — Cómo codear y probar Nest en local antes de tirar un PR

> Tu área: **memoria de contextos + editor de código embebido**. Complementa a
> `docs/GUIA-EQUIPO.md` (convenciones y flujo de PRs) — leé esa primero.

## Setup inicial (una sola vez)

```bash
git clone https://github.com/GeronimoDiClemente/raven-nest.git
cd raven-nest
npm install          # Node 20+ (compila node-pty en el postinstall)
```

Config (sin archivos `.env`, todo por Doppler):

```bash
brew install dopplerhq/cli/doppler   # (Windows: winget install doppler.doppler)
doppler login                        # Gero te invita al workplace Nestmux
doppler setup --project nest --config dev
```

**Tu área casi no toca la nube**: panes, terminales, sesiones y el editor son 100%
locales (Electron main process + renderer). Para la mayoría de tu trabajo ni siquiera
necesitás Docker/Supabase — con `npm run dev` alcanza. Doppler es para cuando toques
algo que cruce con features cloud.

## El ciclo de trabajo diario

```bash
git checkout main && git pull
git checkout -b feat/mi-cambio

doppler run -- npm run dev    # la app Electron se abre; hot reload al guardar
```

1. Cambios en `src/` (React) → recarga sola. Cambios en `electron/` (main process,
   stores, pty) → **cerrá y volvé a abrir la app**, el main process no tiene hot reload.
2. **Probás el cambio en la app de verdad**: creás panes, escribís en la terminal,
   cerrás la app, la volvés a abrir y verificás que todo se restaure. En tu área,
   "sobrevive al reinicio" ES el test que importa.
3. Iterás hasta que esté bien.

### Particularidades de tu área

- **La sesión vive en `~/.raven-nest/session.json`** y los stores guardan JSON en esa
  misma carpeta. Tu app de desarrollo comparte esa carpeta con tu instalación real de
  Nest — si vas a experimentar con el formato de persistencia, **hacé backup de
  `~/.raven-nest/` antes**, o probá con una copia.
- **Probar persistencia**: el ciclo es siempre el mismo — crear estado (panes, contexto,
  archivo abierto en el editor) → cerrar la app del todo (Cmd+Q) → reabrir → verificar
  que se restauró. Automatizalo en un test de `electron/__tests__/` (mirá
  `worktree-store.test.ts` como referencia de cómo se testean los stores).
- **Un store nuevo** (para memoria de contextos): patrón exacto en
  `electron/conversation-store.ts` — clase + JSON bajo `ravenHome()` + handlers IPC
  `contexto:<accion>` en `main.ts` + namespace en `preload.ts` + tipos en `src/types.ts`.
- **El editor como pane nuevo**: el precedente es `BrowserCell.tsx` (el pane de browser).
  Antes de elegir Monaco vs CodeMirror, escribí la spec en `docs/superpowers/specs/` y
  charlala con Gero — la librería afecta el peso del bundle para todos.
- **Tests que fallan solo en Mac**: los de worktree-store pueden fallar localmente por un
  symlink de macOS (`/private/var`). Si te pasa, fijate el CI del PR — el que manda es
  el resultado en Linux.

## Pitfalls del área electron / panes / persistencia

- **No hagas teardown en `before-quit`.** En macOS el quit se puede cancelar después (nuestro `win.on('close')` en `electron/main.ts` hace `preventDefault()` y esconde la ventana al tray), y encima los caminos de salida real usan `app.exit(0)`, que **no emite `before-quit`**. Si tenés que liberar recursos al salir, hacelo en una función explícita de "quit de verdad" (o detrás de un flag `isReallyQuitting`), no en el evento.
- **Cuidado con `removeAllListeners()` sobre emitters de larga vida.** Varios listeners del main (broadcasts de setup/spotlight) se registran una sola vez al inicio del módulo y nadie los re-registra. Si los volás, la feature queda muda en silencio hasta reiniciar la app. Preferí desuscribir handlers puntuales que conocés.
- **En handlers IPC async, no chequees un Map antes de un `await` y lo setees después.** Dos invokes concurrentes pasan el guard los dos (patrón TOCTOU). Ejemplo real: `PtyManager.create` en `electron/pty-manager.ts` — el guard está antes de un `await` de hasta 1.5s y el set del map después, y un doble click en "Sync cwd" spawnea dos shells con el mismo paneId (output duplicado + proceso huérfano). Regla: registrá una promesa in-flight por key antes del primer `await`, o hacé chequeo+set síncronos.
- **Los botones del renderer que disparan flujos kill→create (Restart, Sync cwd) tienen que deshabilitarse mientras el flujo corre.** No confíes en que el usuario no va a hacer doble click.
- **Todo lo que llega por IPC desde el renderer es untrusted, aunque "nuestro renderer nunca mandaría eso".** Un `undefined` coercionado a `''` en un estado de React alcanza para disparar una operación destructiva en el main. Antes de cualquier `rmSync`/`writeFileSync` con un path armado a partir de input del renderer: validá el segmento (rechazá `''`, `'.'`, `'..'` explícitamente — `''.includes('..')` es `false` y `path.join` ignora segmentos vacíos, así que "no contiene `..`" no te salva). Ejemplo del review: `electron/account-store.ts` (guard agregado en PR #14 — usalo de referencia del patrón).
- **Para chequear que un path está dentro de un directorio, nunca uses `startsWith` a secas.** `/Users/gero-otro` empieza con `/Users/gero`. Usá `path.relative()` o compará contra `base + path.sep`. Ejemplo del review: `electron/mcp-store.ts`.
- **Archivos de config del usuario: leé defensivamente y escribí atómico.** Si un "leer + mergear + escribir" cae en `catch { existing = {} }`, un archivo que no parsea se reemplaza entero en silencio. Si no parsea, abortá con error en vez de pisar. Y escribí con tmp + rename, no `writeFileSync` directo — el patrón está en `electron/session-store.ts` (PR #15): copiá ese.
- **`app.exit()` vs `app.quit()`: no son intercambiables.** `app.exit()` sale ya y se saltea `before-quit`/`will-quit`. Antes de agregar cleanup a un evento de ciclo de vida, verificá por qué caminos reales sale la app (tray, updater, Cmd+Q).
- **node-pty es módulo nativo**: si tocás deps o versiones de Electron, acordate del `@electron/rebuild` del postinstall, y que main/preload no bundlean nativos (`externalizeDepsPlugin`).

## Antes de abrir el PR (obligatorio)

```bash
npx tsc --noEmit   # limpio
npm test           # verde
```

- Probaste el flujo completo en la app corriendo, incluyendo **cerrar y reabrir**.
- Te leíste tu propio diff entero (si lo generó un agente, con más razón).
- Descripción del PR escrita por vos: qué, por qué, cómo lo probaste, qué NO pudiste
  probar.
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
