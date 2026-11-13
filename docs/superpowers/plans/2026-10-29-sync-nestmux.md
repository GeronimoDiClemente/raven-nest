# `sync.nestmux.com` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la app y el plugin hablen con `https://sync.nestmux.com` por default, y que todo lo que ya
apunta a la dirección de Railway prod siga andando sin re-login ni avisos.

**Architecture:** El default cambia en `electron/base-de-sync.ts` y la dirección vieja se alias-a
**dentro de `normalizarBaseDeSync`**: es el único embudo por el que pasan la base guardada, la del
build, la del env y la del login del plugin, así que un solo lugar cubre a todos. La variable de build
se renombra (D10). Lo externo (Railway + DNS de Vercel) va en un runbook nuevo y se ejecuta con OK de
Gero.

**Tech Stack:** TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-dominios-propios-design.md` (§4.1, D4, D9, D10; la parte
de sync del barrido §4.2b). §4.2 (`api.nestmux.com`) queda fuera: depende de D3.

## Global Constraints

- Default nuevo: `https://sync.nestmux.com`.
- Alias: sólo `https://sync-production-54ba.up.railway.app` → `https://sync.nestmux.com`. Staging
  (`sync-production-75a4` y cualquier otra) **no** se alias-a.
- Variable de build: `MAIN_VITE_SUPABASE_URL` → `MAIN_VITE_SYNC_URL`, sin fallback a la vieja (D10:
  la vieja con una URL de Supabase es justamente el bug).
- Textos de UI en inglés; no cambian.
- **No buildear `dist/` hasta que el DNS esté activo**: el MCP de memoria de los agentes corre el
  `dist` del repo, y con el default nuevo sin DNS se queda sin sync.

## Review Focus

1. Una base guardada como `HTTPS://SYNC-PRODUCTION-54BA.UP.RAILWAY.APP/` (mayúsculas, barra final) → tiene que dar la nueva.
2. Plugin con login contra Railway y `NEST_MEMORY_SYNC_URL` = la nueva → `avisoDeServicioDistinto` no avisa.
3. Railway con un path (`.../algo`) → no se alias-a (es otra ruta, no el mismo servicio).
4. Escribir la de Railway en el campo de la UI → `decidirCambioDeBase` guarda la nueva.
5. Staging `https://sync-production-75a4.up.railway.app` → queda igual.

---

### Task 1: Default nuevo y alias

**Files:**
- Modify: `electron/base-de-sync.ts`
- Test: `electron/__tests__/base-de-sync.test.ts`, `electron/__tests__/servicio-del-paquete.test.ts`,
  `src/__tests__/components/SyncServiceCard.test.tsx` (sólo la constante `POR_DEFECTO`)

**Interfaces:**
- Produces: `BASE_DE_SYNC_POR_DEFECTO = 'https://sync.nestmux.com'`; `normalizarBaseDeSync` con la
  misma firma, que ahora devuelve la nueva para la dirección vieja.

- [ ] **Step 1: Tests que fallan** — en `base-de-sync.test.ts`, un `describe('alias de la dirección vieja')` con:
  - `normalizarBaseDeSync('https://sync-production-54ba.up.railway.app')` → `'https://sync.nestmux.com'`
  - lo mismo con `'  HTTPS://SYNC-PRODUCTION-54BA.UP.RAILWAY.APP//  '`
  - `normalizarBaseDeSync('https://sync-production-54ba.up.railway.app/algo')` → `'https://sync-production-54ba.up.railway.app/algo'`
  - `normalizarBaseDeSync('https://sync-production-75a4.up.railway.app')` → sin cambios
  - `resolverBaseDeSync({ guardada: 'https://sync-production-54ba.up.railway.app', delBuild: null })` → la nueva
  - `decidirCambioDeBase('https://sync-production-54ba.up.railway.app')` → `{ ok: true, guardar: 'https://sync.nestmux.com' }`
  - `BASE_DE_SYNC_POR_DEFECTO` → `'https://sync.nestmux.com'`

  En `servicio-del-paquete.test.ts`: login guardado contra Railway sin env → la nueva; y
  `avisoDeServicioDistinto({ env: 'https://sync.nestmux.com', guardada: 'https://sync-production-54ba.up.railway.app' })` → `null`.
- [ ] **Step 2:** `npx vitest run electron/__tests__/base-de-sync.test.ts electron/__tests__/servicio-del-paquete.test.ts` → FAIL.
- [ ] **Step 3:** En `base-de-sync.ts`: cambiar el default, sumar `const ALIAS_DE_BASE: Record<string, string>`
  (dirección vieja → `BASE_DE_SYNC_POR_DEFECTO`) y aplicarlo al resultado normalizado al final de
  `normalizarBaseDeSync`. Actualizar el comentario del default (ya se mudó). `POR_DEFECTO` del test de
  `SyncServiceCard` pasa a la nueva.
- [ ] **Step 4:** los dos tests de arriba + `npx vitest run src/__tests__/components/SyncServiceCard.test.tsx` → PASS.
- [ ] **Step 5:** commit `feat(sync): sync.nestmux.com por default y la dirección de Railway como alias`.

### Task 2: `MAIN_VITE_SYNC_URL`, barrido y runbook

**Files:**
- Modify: `electron/main.ts:255`, `electron/base-de-sync.ts` (comentarios), `electron/memory-connection-state.ts:24`,
  `src/components/SyncServiceCard.tsx:5`, `.env.example`, `server/README.md` (la URL `75a4` vieja → la nueva),
  `docs/HANDOFF-2026-10-19-prueba-plugin.md:74`
- Create: `docs/RUNBOOK-DOMINIOS.md`

- [ ] **Step 1:** `main.ts` lee `import.meta.env.MAIN_VITE_SYNC_URL`. Comentarios que nombran la variable vieja
  como base de sync pasan a la nueva (los que cuentan la historia pueden decir "antes `MAIN_VITE_SUPABASE_URL`").
  `.env.example`: renombrar la línea, con un comentario de una línea (base de sync para builds de dev; vacío = default).
- [ ] **Step 2:** `docs/RUNBOOK-DOMINIOS.md` con la parte de sync: (1) Railway: dominio propio
  `sync.nestmux.com` en el servicio `sync` de `nest-memory-sync` (CLI `railway domain`), anotar el CNAME
  destino; (2) Vercel DNS: `CNAME sync → <destino>`; (3) verificar `curl -i https://sync.nestmux.com/v1/sync/status` → 401;
  (4) recién entonces `npm run build`. Cada paso con su casilla de "hecho / fecha". Un apartado
  "api.nestmux.com — espera D3".
- [ ] **Step 3:** typecheck (`npx tsc -p tsconfig.node.json --noEmit --composite false` y `-p tsconfig.web.json`) → exit 0.
  `git grep -n "MAIN_VITE_SUPABASE_URL" -- electron src .env.example` → sólo menciones históricas.
- [ ] **Step 4:** commit `refactor(sync): MAIN_VITE_SYNC_URL y runbook de dominios`.
