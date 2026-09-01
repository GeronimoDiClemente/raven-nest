# Raven Nest — Instrucciones para Claude

## Typecheck — OJO

`npx tsc --noEmit` en la raíz NO CHEQUEA NADA (tsconfig solution-style con
`files: []`). El chequeo real es `npx tsc -b` — que además emite .js/.d.ts
junto a los sources (composite): limpiar con `git clean -fd` después.
**OJO: `git add` los archivos fuente NUEVOS ANTES del `git clean`** — clean
borra todo lo untracked y no distingue un .tsx recién creado de un .js
emitido (pasó el 2026-08-18: se llevó un componente nuevo y su test). Hay
~15 errores de tipo preexistentes bajo `tsc -b` en código de main
(pidusage, metrics-collector, etc.) anteriores al branch del editor.

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

**El problema:** `better-sqlite3` compila un binding nativo que varía según el **Node ABI**. Cuando corres `npm install`, el script `postinstall` deja el binding para **Electron** (que tiene su propio ABI). Pero `npm test` corre bajo Node puro, que tiene otro ABI distinto. Si dejas el binding de Electron, los tests fallan con `NODE_MODULE_VERSION` mismatch.

**La solución:** Dos scripts que swapean el binding:
- `npm run native:node` — baja/compila el binding para Node puro (requisito antes de correr tests)
- `npm run native:electron` — deja el binding de Electron (requisito antes de correr la app)

**El flujo:**
1. `npm test` dispara automáticamente `pretest`, que corre `npm run native:node`
2. `pretest` intenta bajar un prebuild de mejor-sqlite3 para el Node ABI de este runner
3. Si el prebuild NO existe (ej: Node 20 es ABI 115, pero mejor-sqlite3 solo publica prebuilds para 127/137/141/147), el script fallback compila desde source con node-gyp
4. Luego vitest corre con el binding correcto y los tests pasan

**Después de `npm test` en local:** el app no arranca hasta que corras `npm run native:electron`. Es el swap manual al revés; `pretest` sólo automatiza un lado.

**En CI:** el fallback a compilación desde source corre una sola vez por cambio de Node ABI, nunca en Windows (los prebuilds de Windows siempre existen).

## Stack
- Electron + Vite + React + TypeScript
- Terminal: xterm.js con PTY (node-pty)
- Build: electron-builder (NSIS para Windows, DMG para Mac, AppImage/deb para Linux)
- Secretos: en `.env` / `.env.local` (gitignored) o vía Doppler (`doppler run -- npm run dev`); el repo **ya no usa git-crypt**, nada está encriptado en git

## Estructura
- `src/hooks/useXterm.ts` — terminal xterm.js
- `src/` — renderer (React)
- `.github/workflows/build-windows.yml` — CI para Windows, Mac y Linux

## Seguridad — pendiente crítico

### GitHub token en Supabase (PENDIENTE)
La columna `github_token` de la tabla `profiles` en Supabase guarda el OAuth token en texto plano.
**Acción requerida antes de release pública:**
- Verificar en el dashboard de Supabase que la política RLS de `profiles` restrinja `SELECT` de `github_token` solo al propio usuario: `auth.uid() = id`.
- Confirmar que ningún rol de servicio (service_role) exponga la columna a otros usuarios.
- A largo plazo: migrar a tokens efímeros o encriptación a nivel de aplicación.
