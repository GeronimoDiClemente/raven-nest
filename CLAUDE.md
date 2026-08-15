# Raven Nest — Instrucciones para Claude

## Typecheck — OJO

`npx tsc --noEmit` en la raíz NO CHEQUEA NADA (tsconfig solution-style con
`files: []`). El chequeo real es `npx tsc -b` — que además emite .js/.d.ts
junto a los sources (composite): limpiar con `git clean -fd` después. Hay
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
