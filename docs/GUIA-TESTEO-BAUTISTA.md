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
