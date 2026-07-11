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
