# Raven Nest — Instrucciones para Claude

## Typecheck — OJO

`npx tsc --noEmit` en la raíz NO CHEQUEA NADA (tsconfig solution-style con
`files: []`).

**El chequeo real son los DOS comandos que corre CI** (`.github/workflows/ci.yml:25-26`):

```bash
npx tsc -p tsconfig.node.json --noEmit --composite false
npx tsc -p tsconfig.web.json --noEmit --composite false
```

Medido en un worktree limpio de `feat/nest-terminal-ui` el 2026-09-10: los dos
dan **exit 0 y cero errores**. Ese es el baseline — **no hay errores
preexistentes**. Si ves uno, lo agregaste vos.

**`npx tsc -b` NO sirve como chequeo hoy: falla con exit 1** por tres errores
`TS6307` de configuración de project references — `graph-template.ts`,
`worker-spec-store.ts` y `raven-home.ts` no están listados en
`tsconfig.web.json`. Son de configuración, no de tipos, y **abortan el build
antes de chequear el código**, así que `tsc -b` en verde no prueba nada y en
rojo no dice nada sobre tu cambio.

> Esta sección decía antes que el chequeo real era `tsc -b` y que había "~15
> errores preexistentes (pidusage, metrics-collector)". Las dos cosas eran
> falsas al 2026-09-10 y el combo es peligroso: hacía que alguien corriera
> `tsc -b`, viera los 3 TS6307, los diera por preexistentes y siguiera —
> cuando el chequeo que importa estaba limpio y ese comando estaba roto.

Si aun así corrés `tsc -b`, ojo: emite .js/.d.ts junto a los sources
(composite) y hay que limpiar con `git clean -fd` después. **`git add` los
archivos fuente NUEVOS ANTES del `git clean`** — clean borra todo lo untracked
y no distingue un .tsx recién creado de un .js emitido (pasó el 2026-08-18: se
llevó un componente nuevo y su test).

## v1.2 — per-device local paths

A partir de v1.2 los paths locales de los repos se guardan **por máquina** en `~/.raven-nest/local-paths.json`, no en Supabase. Al actualizar desde v1.1.x, el primer arranque importa los paths existentes desde Supabase (solo los que existan en disco) y los guarda en el store local. Una segunda PC entrando a la misma cuenta partirá sin paths y ofrecerá **Clone** o **Link existing folder** por repo. Las columnas Supabase `user_repos.local_path` y la tabla `team_repo_local_paths` quedan deprecated en v1.2 (read-only para clientes viejos) y serán dropeadas en v1.3.

## Hacer una release

**El workflow `release.yml` hace TODO solo**: buildea las 3 plataformas **firmadas**,
notariza y grapa el DMG de Mac, borra la release/tag anterior y crea la release nueva con
todos los artifacts. Se dispara automáticamente al pushear a `main` un cambio de
`package.json`. El proceso es solo bumpear la versión:

1. Subir el campo `"version"` en `package.json` a la nueva versión.
2. Commitear y pushear a `main`:
   ```bash
   VERSION=$(node -p "require('./package.json').version")
   git commit -am "chore(release): v$VERSION — <resumen>"
   git push origin main
   ```
   Eso dispara `release.yml` solo (por el cambio en `package.json`).
3. (Opcional) Re-disparar a mano si hace falta: `gh workflow run release.yml --repo GeronimoDiClemente/raven-nest`
4. Verificar que la release tiene los artifacts y que el DMG de Mac quedó notarizado:
   ```bash
   gh release view "v$VERSION" --repo GeronimoDiClemente/raven-nest
   gh workflow run "Check Apple Notary Status" --repo GeronimoDiClemente/raven-nest
   ```

> **NUNCA correr el workflow "Build (Windows, Mac, Linux)" (`build.yml`) como parte de un
> release.** Ese workflow genera un DMG de Mac **sin firmar** y lo sube con `--clobber`,
> pisando el DMG firmado de `release.yml` → la notarización falla con `Invalid`. Fue la
> causa de que v1.3.1 y v1.3.2 quedaran sin notarizar. `build.yml` es solo un build manual
> de diagnóstico; `release.yml` ya cubre las 3 plataformas firmadas.

## Requisitos del usuario (dependencias externas)

- **Voice input**: requiere [openai-whisper](https://github.com/openai/whisper) instalado en Python.
  - Instalación: `pip install openai-whisper`
  - La app lo detecta automáticamente vía PATH, `~/Library/Python/3.x/bin/whisper`, o `python3 -m whisper`
  - Primera vez: descarga el modelo `tiny` (~150MB). Después es instantáneo.
  - Si no está instalado, el botón de micrófono simplemente no transcribe (sin crash).
  - En releases: documentar en README y en el onboarding que voice input requiere whisper.

## better-sqlite3: binarios nativos — OJO

**El problema:** `better-sqlite3` compila un binding nativo que depende del **ABI de Node**.
`npm install` corre el `postinstall`, que deja el binding de **Electron** (que tiene su propio
ABI). Pero `npm test` corre bajo Node puro, que usa otro ABI. Con el binding de Electron puesto,
los tests mueren con `NODE_MODULE_VERSION` mismatch.

**La solución:** dos scripts que swapean el binding.
- `npm run native:node` — deja el binding de Node puro (hace falta antes de correr los tests)
- `npm run native:electron` — deja el binding de Electron (hace falta antes de levantar la app)

**El flujo:**
1. `npm test` dispara `pretest` solo, que corre `npm run native:node`.
2. `native:node` intenta bajar un prebuild de `better-sqlite3` para el ABI de Node del runner.
3. Si ese prebuild no existe, cae a compilar desde source con node-gyp.
4. Vitest corre con el binding correcto.

**Cuándo NO hay prebuild.** `better-sqlite3@12.11.1` publica prebuilds de Node sólo para las ABI
**127, 137, 141 y 147**, y la lista es la misma en Windows, Mac y Linux. Node 20 es ABI 115 y no
está: o sea que el CI (pineado a Node 20) **y también una máquina Windows corriendo el
`engines.node >=20.19` del repo** caen a compilar. Node 22 es 127, 24 es 137 y 25 es 141, así que
esos sí bajan prebuild. En Windows compilar puede fallar por falta del toolset ClangCL de Visual
Studio; si te pasa, la salida es usar un Node cuyo ABI tenga prebuild.

**Después de `npm test` en local:** la app no arranca hasta que corras `npm run native:electron`.
`pretest` automatiza un solo lado del swap, el de los tests.

## Stack
- Electron + Vite + React + TypeScript
- Terminal: xterm.js con PTY (node-pty)
- Build: electron-builder (NSIS para Windows, DMG para Mac, AppImage/deb para Linux)
- Secretos: en `.env` / `.env.local` (gitignored) o vía Doppler (`doppler run -- npm run dev`); el repo **ya no usa git-crypt**, nada está encriptado en git

## Estructura
- `src/hooks/useXterm.ts` — terminal xterm.js
- `src/` — renderer (React)
- `.github/workflows/build-windows.yml` — CI para Windows, Mac y Linux

## UI — Tailwind y shadcn conviven con global.css

La app está migrando a Tailwind v4 + shadcn/ui. Reglas que muerden:

- **Tailwind está SIN preflight** (`src/styles/tailwind.css`). No importes
  `"tailwindcss"` entero: trae el reset y rompe las 12k líneas de `global.css`.
- **Los tokens viven en `global.css`**, y `@theme inline` los expone al motor.
  No los redefinas en `tailwind.css`: habría dos fuentes de verdad.
- **Un componente nuevo se escribe con shadcn + utilidades**, nunca con clases
  nuevas en `global.css`.
- **Un literal de color cromático no se prohíbe siempre, se decide.** El
  acento es acromático (el color es estado: `--ok`/`--warn`/`--destructive`),
  pero hay una allow-list justificada: leyenda categórica de un estado no
  binario (`.pr-badge.closed`/`.feed-type-badge.pr` en `global.css` usan
  violeta/azul para distinguir *tipo* de evento, no severidad), paleta de
  íconos por extensión, o marca de un tercero (el `#0052CC` de Atlassian en
  `builtinCatalog.ts`, el botón de GitHub en `global.css`). Un barrido
  automático por regex ya se llevó puesto ese azul de Atlassian una vez y
  hubo que revertirlo — cada literal se mira antes de tocarlo.
- **Todo cambio de UI pasa `e2e/04-contraste.spec.ts`** antes de commitear.
- La receta para migrar un componente (con las trampas que ya mordieron):
  `docs/RECETA-MIGRACION-UI.md`.

## Memoria cifrada — nota operativa

Desde el 2026-09-11 la memoria que va a la nube se cifra **en el cliente** (spec
`docs/superpowers/specs/2026-09-09-nest-memories-plugin-y-cifrado.md`). Lo que hay que tener
presente al trabajar acá:

- **La clave nunca sale del cliente.** El servidor guarda envolturas que no puede abrir. Si
  el usuario pierde todas sus máquinas y el código de recuperación, la memoria de la nube es
  irrecuperable — es la consecuencia inevitable del diseño, no un defecto.
- **La base local sigue en claro y tiene que seguirlo**: la búsqueda es FTS5 local y el
  agente necesita el texto. La máquina del usuario está fuera del modelo de amenaza.
- **`SCHEMA_VERSION` 6** suma `topic_key_hmac`. Una fila que vino del pull tiene el HMAC y
  `topic_key = null`; una local tiene el tema en claro y, si hay clave, también el HMAC.
- **El scope `team` NO se cifra** en esta versión, y está anunciado como tal.
- Para probarlo hace falta el servicio arriba: ver `server/README.md` y
  `scripts/smoke-cifrado-e2e.mjs` (que hoy está en rojo por temporización — leer su
  encabezado antes de creerle a la salida).

## Seguridad — pendiente crítico

### GitHub token en Supabase (PENDIENTE)
La columna `github_token` de la tabla `profiles` en Supabase guarda el OAuth token en texto plano.
**Acción requerida antes de release pública:**
- Verificar en el dashboard de Supabase que la política RLS de `profiles` restrinja `SELECT` de `github_token` solo al propio usuario: `auth.uid() = id`.
- Confirmar que ningún rol de servicio (service_role) exponga la columna a otros usuarios.
- A largo plazo: migrar a tokens efímeros o encriptación a nivel de aplicación.
