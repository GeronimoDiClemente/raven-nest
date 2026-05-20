# Raven Nest — Instrucciones para Claude

## v1.2 — per-device local paths

A partir de v1.2 los paths locales de los repos se guardan **por máquina** en `~/.raven-nest/local-paths.json`, no en Supabase. Al actualizar desde v1.1.x, el primer arranque importa los paths existentes desde Supabase (solo los que existan en disco) y los guarda en el store local. Una segunda PC entrando a la misma cuenta partirá sin paths y ofrecerá **Clone** o **Link existing folder** por repo. Las columnas Supabase `user_repos.local_path` y la tabla `team_repo_local_paths` quedan deprecated en v1.2 (read-only para clientes viejos) y serán dropeadas en v1.3.

## Hacer una release

1. Asegurarse de que `package.json` tiene la versión correcta (campo `"version"`)
2. Crear el tag y la release en GitHub:
   ```bash
   VERSION=$(node -p "require('./package.json').version")
   gh release create "v$VERSION" --title "v$VERSION" --notes "" --repo GeronimoDiClemente/raven-nest
   ```
3. Triggerear el workflow de build (buildea Windows, Mac y Linux en paralelo):
   ```bash
   gh workflow run "Build (Windows, Mac, Linux)" --repo GeronimoDiClemente/raven-nest
   ```
4. Verificar que los artifacts se subieron a la release:
   ```bash
   gh release view "v$VERSION" --repo GeronimoDiClemente/raven-nest
   ```

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
- El repo usa git-crypt — los archivos sensibles están encriptados

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
