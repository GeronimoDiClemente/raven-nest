# Login y compra de Nest Memories sin Nest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que alguien sin Nest instalado conecte una máquina corriendo `npx @nestmux/memory login`, aprobando el código en `nestmux.com/link` con su cuenta de Nest, y pueda pagar Cloud desde esa página o desde `nestmux.com/upgrade`.

**Architecture:** el servidor de sync guarda el nombre y el sistema de la máquina que pide el código, suma `POST /v1/link/check` (mismo control de elegibilidad que el alta de un device, extraído a una función compartida, sin crear nada) y abre CORS sólo en `check` y `approve` para el origen de la página. La CLI imprime el link y abre el navegador; `status` y el MCP imprimen el link de upgrade cuando chocan con un límite. En `pagina-nest`, una isla React (`LinkFlow`) maneja sign in → confirmar → aprobar → plan/checkout con una máquina de estados pura (`siguienteEstado`) probada con vitest.

**Tech Stack:** Servidor: Node + `pg` + vitest contra Postgres real (Docker `nest-memory-pg`, puerto 55432). CLI: TypeScript en `electron/` compilado a CommonJS por `packages/nest-memory`, vitest. Edge function `stripe-checkout` (Deno; módulo puro probado con vitest de la raíz). `pagina-nest`: Astro 6 + React 19 + Tailwind 4 + `@supabase/supabase-js` 2.112, vitest nuevo.

**Spec:** `docs/superpowers/specs/2026-11-02-login-y-compra-sin-nest-design.md`

## Global Constraints

- raven-nest: rama `feat/memories-settings`, worktree `C:\Users\gerod\Dev\raven-nest\.claude\worktrees\memory-smoke`. Commits locales, **sin push**.
- pagina-nest: rama nueva `feat/link-page` creada **desde `origin/feat/checkout-pages`** (PR #10), en un worktree nuevo `C:\Users\gerod\Dev\pagina-nest-link`. **Nunca** tocar el checkout de `master` en `C:\Users\gerod\Dev\pagina-nest`. Sin push.
- Typecheck raven-nest = los DOS comandos de CI: `npx tsc -p tsconfig.node.json --noEmit --composite false` y `npx tsc -p tsconfig.web.json --noEmit --composite false` (baseline 0 errores). Servidor: `cd server && npx tsc --noEmit -p tsconfig.json`. `npx tsc --noEmit` en la raíz no chequea nada; `tsc -b` está roto (TS6307) y no sirve.
- Tests de la raíz: `npm run native:node` antes; `npm run native:electron` al terminar la sesión de tests.
- Tests del servidor: `docker start nest-memory-pg` (puerto 55432) y `cd server && npx vitest run <archivo>`. `server/vitest.config.ts` ya setea `ALLOW_PLAINTEXT_PERSONAL=1`.
- Archivos LF. Nada de `git stash` ni `git clean`. `docs/superpowers` se agrega con `git add -f`.
- Toda la UI, el copy de la CLI y los datos de prueba visibles en **inglés**. Comentarios de código en español, como el resto del repo.
- Precios de Cloud: **US$15/mes, US$144/año** (espejo de `src/lib/stripe.ts`: `CLOUD_MONTHLY_PRICE = 15`, `CLOUD_ANNUAL_PRICE = 144`).
- Base web por defecto `https://nestmux.com` (constante `BASE_WEB_POR_DEFECTO`, el `NEST_WEB_BASE` del spec), override por env `NEST_MEMORY_WEB_URL`.
- El link de la CLI es `https://nestmux.com/link?code=WXYZ-1234`; el de upgrade, `https://nestmux.com/upgrade`.
- `link_requests.device_name` y `platform`: nullables, nombre recortado a **100** caracteres, `platform` sólo `win32` / `darwin` / `linux` o null.
- `eligibility ∈ ok | not_in_beta | plan_required | device_limit_reached`. Errores de `check`: 404 `unknown_code`, 400 `expired`, 409 `already_approved`.
- CORS sólo en `/v1/link/check` y `/v1/link/approve`: orígenes de `LINK_WEB_ORIGINS` (coma), por defecto `https://nestmux.com` y `http://localhost:4321`; sólo `POST`; headers `authorization, content-type`; sin credenciales. El resto de las rutas sin CORS.
- `/v1/link/approve` no cambia de contrato.
- `/link` y `/upgrade`: `noindex` y fuera del sitemap. Sólo en inglés (sin `/es/link`).
- Un error que el mapa de copy no conoce se muestra tal cual (misma regla que `LinkDeviceCard`).
- Nada de la configuración externa (Supabase prod, Railway, Vercel, deploy de edge functions, merge del PR #10) se ejecuta en este plan: queda escrito en el runbook para que lo haga Gero.

## Review Focus

1. **El código llega en minúsculas, sin guión o con espacios** (alguien lo tipea o un cliente de mail lo reescribe en la URL): la página lo normaliza y el servidor lo acepta en minúsculas. → tests en Task 7 (`codigoDeLaUrl`) y Task 2 (`consultarVinculacion` en minúsculas).
2. **El viaje de OAuth pisa `?code=`** (con flujo PKCE Supabase agrega su propio `code` a la URL de vuelta): el código de vinculación sobrevive porque la vuelta usa `?link_code=` y la página ignora un `code` que no tiene forma de código. → test en Task 7.
3. **El código vence mientras la persona está en la pantalla de confirmación** (se fue a buscar la tarjeta, volvió a los 12 minutos): pasa a "That code expired… run login again" sin dejarla apretar Approve, y un `approve` que vuelve `expired` hace lo mismo. → tests en Task 7.
4. **La cuenta ya es Cloud y aprieta Upgrade** (vino desde `/upgrade` o la tarjeta de plan no cargó): `already_subscribed` abre el portal de Stripe, nunca un error ni un segundo cobro. → test en Task 8.
5. **Un origen no permitido le pega a `check`/`approve`** (otra página que robó un JWT, o el sitio en `www.`): la respuesta no lleva `Access-Control-Allow-Origin`, el preflight tampoco, y ninguna otra ruta aprende CORS. → tests en Task 3.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `server/migrations/014_link_request_device.sql` (nuevo) | `device_name` y `platform` en `link_requests` |
| `server/src/link.ts` (mod) | `leerDatosDelPedido`, `iniciarVinculacion` con datos, `consultarVinculacion`, `limpiarCodigoDeUsuario` |
| `server/src/elegibilidad.ts` (nuevo) | `CLOUD_PLANS` (movido) y `veredictoDeElegibilidad`, puro |
| `server/src/auth.ts` (mod) | `authenticate` decide con `veredictoDeElegibilidad` |
| `server/src/devices.ts` (mod) | `planPagoDeSupabase` exportada, `elegibilidadDeMaquinaNueva` |
| `server/src/cors.ts` (nuevo) | Orígenes permitidos y cabeceras CORS de las rutas de vinculación |
| `server/src/http.ts` (mod) | `start` lee el cuerpo, ruta `check`, CORS + preflight en `check`/`approve` |
| `server/__tests__/link.test.ts`, `link-http.test.ts` (mod), `link-check.test.ts`, `link-check-http.test.ts`, `cors.test.ts` (nuevos) | Tests |
| `server/README.md` (mod) | Rutas de vinculación y `LINK_WEB_ORIGINS` |
| `electron/vinculacion-web-del-paquete.ts` (nuevo) | URL de la página, texto del login, abrir el navegador |
| `electron/estado-de-sync-del-paquete.ts` (mod) | Línea de upgrade y su lectura de la base |
| `electron/daemon-del-paquete.ts` (mod) | Persistir `plan_required` / `device_limit_reached` del daemon |
| `electron/sync-del-mcp.ts` (mod) | Callback `alTerminar` tras cada operación |
| `electron/cli-del-paquete.ts` (mod) | `login`, `status` y `mcp` usan lo anterior |
| `electron/__tests__/…` | Tests de cada pieza |
| `supabase/functions/stripe-checkout/checkout.ts` (mod) | `from` opcional → `?from=` en las URLs de vuelta |
| `docs/RUNBOOK-LOGIN-SIN-NEST.md` (nuevo) | Configuración externa + smoke manual de punta a punta |
| pagina-nest `vitest.config.ts`, `package.json` (mod) | vitest |
| pagina-nest `src/lib/link/codigo.ts`, `flujo.ts`, `api.ts`, `precios.ts`, `vuelta.ts` (nuevos) | Lógica pura y red |
| pagina-nest `src/components/link/LinkFlow.tsx`, `VueltaALaTerminal.tsx` (nuevos) | Islas React |
| pagina-nest `src/pages/link.astro`, `src/pages/upgrade.astro` (nuevos) | Páginas |
| pagina-nest `astro.config.mjs`, `.env.example`, `src/components/sections/CheckoutResult.astro` (mod) | Sitemap, env, vuelta del checkout |

---

### Task 1: Servidor — migración 014 y `start` guarda nombre y sistema

**Files:**
- Create: `server/migrations/014_link_request_device.sql`
- Modify: `server/src/link.ts` (constantes nuevas arriba de `iniciarVinculacion`, `iniciarVinculacion` ~línea 68-77)
- Modify: `server/src/http.ts` (`handleLinkStart`, ~líneas 449-467)
- Test: `server/__tests__/link.test.ts`, `server/__tests__/link-http.test.ts`

**Interfaces:**
- Produces:
  - `export const LARGO_MAXIMO_DEL_NOMBRE = 100`
  - `export const PLATAFORMAS_CONOCIDAS: ReadonlySet<string>` (`'win32' | 'darwin' | 'linux'`)
  - `export interface DatosDelPedido { nombre: string | null; plataforma: string | null }`
  - `export function leerDatosDelPedido(body: Record<string, unknown>): DatosDelPedido`
  - `iniciarVinculacion(pool: Pool, ahora: number, datos?: DatosDelPedido): Promise<VinculacionIniciada>`
  - Columnas `link_requests.device_name text null`, `link_requests.platform text null`.

- [ ] **Step 1: Escribir los tests que fallan (lógica)**

Agregar al final de `server/__tests__/link.test.ts` (y sumar `leerDatosDelPedido, LARGO_MAXIMO_DEL_NOMBRE` al import de `../src/link`):

```ts
describe('los datos del pedido (spec login sin Nest §3)', () => {
  it('guarda el nombre recortado y la plataforma conocida', () => {
    expect(leerDatosDelPedido({ name: '  gero-laptop  ', platform: 'darwin' }))
      .toEqual({ nombre: 'gero-laptop', plataforma: 'darwin' })
  })

  it('el nombre se corta en 100 caracteres', () => {
    const largo = 'x'.repeat(250)
    expect(leerDatosDelPedido({ name: largo }).nombre).toHaveLength(LARGO_MAXIMO_DEL_NOMBRE)
  })

  it('una plataforma fuera de la lista, o que no es texto, es null', () => {
    expect(leerDatosDelPedido({ platform: 'Win32' }).plataforma).toBeNull()
    expect(leerDatosDelPedido({ platform: 'freebsd' }).plataforma).toBeNull()
    expect(leerDatosDelPedido({ platform: { malo: true } }).plataforma).toBeNull()
  })

  it('sin nombre, vacío, o con sólo caracteres de control, es null', () => {
    expect(leerDatosDelPedido({}).nombre).toBeNull()
    expect(leerDatosDelPedido({ name: '   ' }).nombre).toBeNull()
    expect(leerDatosDelPedido({ name: '\u0000\u001b' }).nombre).toBeNull()
    expect(leerDatosDelPedido({ name: 42 }).nombre).toBeNull()
  })

  it('iniciar guarda los datos en la fila', async () => {
    const r = await iniciarVinculacion(pool, Date.now(), { nombre: 'build-box', plataforma: 'linux' })
    const { rows } = await pool.query('select device_name, platform from link_requests where user_code = $1', [r.codigoDeUsuario])
    expect(rows[0]).toEqual({ device_name: 'build-box', platform: 'linux' })
  })

  it('un cliente viejo que no manda nada deja las dos columnas en null', async () => {
    const r = await iniciarVinculacion(pool, Date.now())
    const { rows } = await pool.query('select device_name, platform from link_requests where user_code = $1', [r.codigoDeUsuario])
    expect(rows[0]).toEqual({ device_name: null, platform: null })
  })
})
```

- [ ] **Step 2: Escribir los tests que fallan (HTTP)**

Agregar dentro de `describe('POST /v1/link/start', …)` en `server/__tests__/link-http.test.ts`:

```ts
  it('guarda el nombre y la plataforma que manda la CLI', async () => {
    const r = await post('/v1/link/start', { name: 'gero-laptop', platform: 'win32' })
    expect(r.status).toBe(201)
    const { user_code } = await r.json()
    const { rows } = await pool.query('select device_name, platform from link_requests where user_code = $1', [user_code])
    expect(rows[0]).toEqual({ device_name: 'gero-laptop', platform: 'win32' })
  })

  it('un JSON roto es 400, no 500', async () => {
    const r = await fetch(`${base}/v1/link/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{roto' })
    expect(r.status).toBe(400)
  })
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `docker start nest-memory-pg; cd server && npx vitest run __tests__/link.test.ts __tests__/link-http.test.ts`
Expected: FAIL — `leerDatosDelPedido is not a function` / `column "device_name" does not exist` / el JSON roto devuelve 201.

- [ ] **Step 4: Escribir la migración**

`server/migrations/014_link_request_device.sql`:

```sql
-- Login sin Nest (spec 2026-11-02-login-y-compra-sin-nest §3): la página que aprueba
-- muestra QUÉ máquina pidió el código —nombre y sistema— para que la persona note un código
-- que no salió de su terminal. Nullables: un cliente viejo no los manda y el pedido vale igual.
alter table link_requests add column if not exists device_name text;
alter table link_requests add column if not exists platform text;
```

- [ ] **Step 5: Implementar en `link.ts`**

Arriba de `export interface VinculacionIniciada` en `server/src/link.ts`:

```ts
/** Largo máximo del nombre de la máquina que manda la CLI al arrancar (spec §3). */
export const LARGO_MAXIMO_DEL_NOMBRE = 100

/**
 * Los `process.platform` que la CLI manda y la página sabe nombrar. Otra cosa se guarda como
 * null: el campo se MUESTRA a alguien que decide si aprobar, y un texto libre ahí es un lugar
 * donde el que pidió el código escribe lo que quiera.
 */
export const PLATAFORMAS_CONOCIDAS: ReadonlySet<string> = new Set(['win32', 'darwin', 'linux'])

export interface DatosDelPedido {
  nombre: string | null
  plataforma: string | null
}

/** Lo que `/v1/link/start` acepta del cuerpo. Nunca lanza: lo que no sirve es null. */
export function leerDatosDelPedido(body: Record<string, unknown>): DatosDelPedido {
  const nombre = typeof body.name === 'string'
    // eslint-disable-next-line no-control-regex
    ? body.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, LARGO_MAXIMO_DEL_NOMBRE).trim()
    : ''
  const plataforma = typeof body.platform === 'string' && PLATAFORMAS_CONOCIDAS.has(body.platform)
    ? body.platform
    : null
  return { nombre: nombre === '' ? null : nombre, plataforma }
}
```

Reemplazar `iniciarVinculacion`:

```ts
export async function iniciarVinculacion(
  pool: Pool,
  ahora: number,
  datos: DatosDelPedido = { nombre: null, plataforma: null }
): Promise<VinculacionIniciada> {
  const codigoDeUsuario = generarCodigoDeUsuario()
  const codigoDeDispositivo = randomBytes(BYTES_DEL_CODIGO_DE_DISPOSITIVO).toString('base64url')
  await pool.query(
    `insert into link_requests (id, user_code, device_code_hash, created_at, expires_at, device_name, platform)
     values ($1, $2, $3, to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0), $6, $7)`,
    [randomUUID(), codigoDeUsuario, hashToken(codigoDeDispositivo), ahora, ahora + VIGENCIA_MS, datos.nombre, datos.plataforma]
  )
  return { codigoDeUsuario, codigoDeDispositivo, venceEn: VIGENCIA_MS, intervalo: INTERVALO_MS }
}
```

- [ ] **Step 6: `handleLinkStart` lee el cuerpo**

En `server/src/http.ts`, sumar `leerDatosDelPedido` al import de `./link` y reemplazar `handleLinkStart`:

```ts
/** `POST /v1/link/start` — sin credenciales, porque quien llama todavía no tiene ninguna. */
async function handleLinkStart(pool: Pool, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const verdict = linkLimiter.check(req.socket.remoteAddress ?? 'sin-ip')
    if (!verdict.ok) {
      return send(res, 429, { error: 'rate_limited' }, { 'Retry-After': String(verdict.retryAfterSeconds) })
    }
    // Un cliente viejo manda `{}`: `leerDatosDelPedido` lo convierte en dos null.
    const body = (await readBody(req)) as Record<string, unknown>
    const r = await iniciarVinculacion(pool, Date.now(), leerDatosDelPedido(body))
    return send(res, 201, {
      user_code: r.codigoDeUsuario,
      device_code: r.codigoDeDispositivo,
      expires_in: Math.floor(r.venceEn / 1000),
      interval: Math.ceil(r.intervalo / 1000),
    })
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    if (status === 500) console.error('[http] /v1/link/start', err)
    return send(res, status, { error: status === 500 ? 'internal_error' : (err as Error).message })
  }
}
```

- [ ] **Step 7: Correr los tests y el typecheck**

Run: `cd server && npx vitest run __tests__/link.test.ts __tests__/link-http.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, 0 errores de tipos.

- [ ] **Step 8: Commit**

```bash
git add server/migrations/014_link_request_device.sql server/src/link.ts server/src/http.ts server/__tests__/link.test.ts server/__tests__/link-http.test.ts
git commit -m "$(cat <<'EOF'
feat(link): el pedido de vinculación guarda nombre y sistema de la máquina (migración 014)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Servidor — elegibilidad compartida y `POST /v1/link/check`

**Files:**
- Create: `server/src/elegibilidad.ts`
- Modify: `server/src/auth.ts` (definición de `CLOUD_PLANS` ~línea 26 y cuerpo de `authenticate` ~líneas 43-65)
- Modify: `server/src/devices.ts` (`planPagoDeSupabase` ~línea 380 pasa a `export`; función nueva al final del bloque de plan)
- Modify: `server/src/link.ts` (`aprobarVinculacion` usa `limpiarCodigoDeUsuario`; `consultarVinculacion` nueva)
- Modify: `server/src/http.ts` (ruta + `handleLinkCheck` + limitador)
- Test: `server/__tests__/link-check.test.ts`, `server/__tests__/link-check-http.test.ts`

**Interfaces:**
- Consumes: `iniciarVinculacion(pool, ahora, datos?)` (Task 1).
- Produces:
  - `server/src/elegibilidad.ts`: `export const CLOUD_PLANS: Set<string>`, `export type Elegibilidad = 'ok' | 'not_in_beta' | 'plan_required' | 'device_limit_reached'`, `export function veredictoDeElegibilidad(e: { enAllowlist: boolean; plan: string; maquinasPrevias: number }): Elegibilidad`.
  - `server/src/auth.ts` sigue exportando `CLOUD_PLANS` (re-export).
  - `server/src/devices.ts`: `export async function planPagoDeSupabase(userId: string, supabaseJwt: string | undefined): Promise<string | null>`, `export async function elegibilidadDeMaquinaNueva(pool: Pool, identity: JwtIdentity, supabaseJwt?: string): Promise<Elegibilidad>`.
  - `server/src/link.ts`: `export function limpiarCodigoDeUsuario(c: string): string`, `export interface PedidoConsultado { deviceName: string | null; platform: string | null; createdAt: string; expiresAt: string; expiresIn: number; eligibility: Elegibilidad }`, `export type ResultadoDeConsultar`, `export async function consultarVinculacion(pool, identidad: JwtIdentity, codigoDeUsuario: string, ahora: number, supabaseJwt?: string): Promise<ResultadoDeConsultar>`.
  - HTTP `POST /v1/link/check` con `Authorization: Bearer <JWT de Supabase>` y cuerpo `{ user_code }` (también acepta `{ code }`). 200 → `{ device_name, platform, created_at, expires_at, expires_in, eligibility }` (ISO 8601 en las fechas, `expires_in` en segundos medido por el servidor). Errores: 401 `unauthorized`, 400 `missing_user_code`, 404 `unknown_code`, 400 `expired`, 409 `already_approved`, 429 `rate_limited`, 503 `issuer_unavailable`.

**Por qué compartida y no copiada:** `registerDevice` sólo aplica la beta (con la red de seguridad del plan pago de Supabase); el plan y el tope de máquinas los aplica `authenticate` en cada request. `check` tiene que decir de antemano lo que esas DOS harían con una máquina nueva. El veredicto puro vive en un solo lugar y lo usan `authenticate` y `check`; el test de acuerdo de abajo compara `check` contra registrar + autenticar de verdad, así que si alguien cambia una regla en un solo lado, falla.

- [ ] **Step 1: Escribir los tests que fallan (lógica)**

`server/__tests__/link-check.test.ts`:

```ts
// `check`: lo que la página ve antes de aprobar. NECESITA POSTGRES.
//
// El test que importa es el de acuerdo: para cada estado de cuenta, lo que dice `check` es lo
// que de verdad pasaría registrando la máquina y autenticándola. Si alguien cambia una regla
// sólo en `authenticate` o sólo en `registerDevice`, falla acá.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { authenticate, hashToken } from '../src/auth'
import { registerDevice, elegibilidadDeMaquinaNueva } from '../src/devices'
import { veredictoDeElegibilidad } from '../src/elegibilidad'
import { iniciarVinculacion, aprobarVinculacion, consultarVinculacion, VIGENCIA_MS } from '../src/link'

const pool = getPool()
// Sin Supabase de fondo: un SUPABASE_URL heredado de la shell haría que `planPagoDeSupabase`
// salga a la red de verdad. El test que lo necesita lo setea con un fetch falso.
delete process.env.SUPABASE_URL
delete process.env.SUPABASE_ANON_KEY
const ENV_ANTES = { ...process.env }
const FETCH_ANTES = global.fetch

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })
afterEach(() => {
  process.env = { ...ENV_ANTES }
  global.fetch = FETCH_ANTES
})

/** Una cuenta en el estado pedido. Sin `plan`, la cuenta no existe todavía en el servicio. */
async function cuenta(o: { plan?: string; allowlist?: boolean; maquinas?: number }) {
  const userId = randomUUID()
  if (o.plan !== undefined) await pool.query('insert into users (id, plan) values ($1, $2)', [userId, o.plan])
  if (o.allowlist) await pool.query('insert into allowlist (user_id) values ($1)', [userId])
  for (let i = 0; i < (o.maquinas ?? 0); i++) {
    await pool.query('insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)',
      [randomUUID(), userId, `m${i}`, hashToken(randomUUID())])
  }
  return { userId, email: null }
}

/** Lo que de verdad le pasa a una máquina nueva: registrarla y autenticar su token. */
async function loQueHaceRegistrar(identity: { userId: string; email: null }): Promise<string> {
  const alta = await registerDevice(pool, identity, { name: 'nueva' })
  if (!alta.ok) return alta.error
  const auth = await authenticate(pool, `Bearer ${alta.token}`)
  return auth.ok ? 'ok' : auth.error
}

describe('veredictoDeElegibilidad', () => {
  it('beta antes que plan, plan antes que tope', () => {
    expect(veredictoDeElegibilidad({ enAllowlist: false, plan: 'legacy', maquinasPrevias: 99 })).toBe('not_in_beta')
    expect(veredictoDeElegibilidad({ enAllowlist: true, plan: 'legacy', maquinasPrevias: 99 })).toBe('plan_required')
    expect(veredictoDeElegibilidad({ enAllowlist: true, plan: 'free', maquinasPrevias: 3 })).toBe('device_limit_reached')
    expect(veredictoDeElegibilidad({ enAllowlist: true, plan: 'free', maquinasPrevias: 2 })).toBe('ok')
    expect(veredictoDeElegibilidad({ enAllowlist: true, plan: 'cloud', maquinasPrevias: 9 })).toBe('ok')
  })
})

describe('elegibilidadDeMaquinaNueva — el mismo control que registrar + autenticar', () => {
  const CASOS: Array<[string, { plan?: string; allowlist?: boolean; maquinas?: number }, string]> = [
    ['cuenta Cloud en la beta', { plan: 'cloud', allowlist: true }, 'ok'],
    ['cuenta que el servicio todavía no conoce', {}, 'not_in_beta'],
    ['cuenta fuera de la beta', { plan: 'free' }, 'not_in_beta'],
    ['Free con 2 máquinas', { plan: 'free', allowlist: true, maquinas: 2 }, 'ok'],
    ['Free con 3 máquinas', { plan: 'free', allowlist: true, maquinas: 3 }, 'device_limit_reached'],
    ['Cloud con 10 máquinas', { plan: 'cloud', allowlist: true, maquinas: 10 }, 'device_limit_reached'],
    ['un plan sin nube', { plan: 'legacy', allowlist: true }, 'plan_required'],
  ]

  it.each(CASOS)('%s', async (_nombre, estado, esperado) => {
    const identity = await cuenta(estado)
    const dicho = await elegibilidadDeMaquinaNueva(pool, identity)
    expect(dicho).toBe(esperado)
    expect(await loQueHaceRegistrar(identity)).toBe(dicho)
  })

  it('un plan pago en Supabase cuenta como beta, igual que en registerDevice, sin escribir nada', async () => {
    process.env.SUPABASE_URL = 'https://ejemplo.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'anon-key-de-prueba'
    global.fetch = vi.fn(async (url: string) => new Response(
      JSON.stringify(String(url).includes('/rest/v1/profiles') ? [{ plan: 'cloud' }] : []),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as unknown as typeof fetch
    const identity = await cuenta({})

    expect(await elegibilidadDeMaquinaNueva(pool, identity, 'jwt-de-prueba')).toBe('ok')
    expect((await pool.query('select 1 from users where id = $1', [identity.userId])).rowCount).toBe(0)
    expect((await pool.query('select 1 from allowlist where user_id = $1', [identity.userId])).rowCount).toBe(0)
  })
})

describe('consultarVinculacion', () => {
  it('devuelve lo que la página muestra, y la elegibilidad', async () => {
    const identity = await cuenta({ plan: 'cloud', allowlist: true })
    const ahora = Date.now()
    const r = await iniciarVinculacion(pool, ahora, { nombre: 'build-box', plataforma: 'linux' })
    const c = await consultarVinculacion(pool, identity, r.codigoDeUsuario, ahora + 60_000)
    expect(c.ok).toBe(true)
    if (!c.ok) return
    expect(c.pedido).toMatchObject({ deviceName: 'build-box', platform: 'linux', eligibility: 'ok' })
    expect(c.pedido.expiresIn).toBe(Math.floor((VIGENCIA_MS - 60_000) / 1000))
    expect(new Date(c.pedido.expiresAt).getTime() - new Date(c.pedido.createdAt).getTime()).toBe(VIGENCIA_MS)
  })

  it('consultar no crea la cuenta, no emite nada y no aprueba', async () => {
    const identity = await cuenta({})
    const r = await iniciarVinculacion(pool, Date.now())
    const c = await consultarVinculacion(pool, identity, r.codigoDeUsuario, Date.now())
    expect(c).toMatchObject({ ok: true, pedido: { eligibility: 'not_in_beta' } })
    expect((await pool.query('select 1 from users where id = $1', [identity.userId])).rowCount).toBe(0)
    expect((await pool.query('select 1 from devices where user_id = $1', [identity.userId])).rowCount).toBe(0)
    const { rows } = await pool.query('select user_id from link_requests where user_code = $1', [r.codigoDeUsuario])
    expect(rows[0].user_id).toBeNull()
  })

  it('acepta el código en minúsculas y con espacios (Review Focus 1)', async () => {
    const identity = await cuenta({ plan: 'cloud', allowlist: true })
    const r = await iniciarVinculacion(pool, Date.now())
    const c = await consultarVinculacion(pool, identity, `  ${r.codigoDeUsuario.toLowerCase()} `, Date.now())
    expect(c.ok).toBe(true)
  })

  it('desconocido 404, vencido 400, ya aprobado 409', async () => {
    const identity = await cuenta({ plan: 'cloud', allowlist: true })
    expect(await consultarVinculacion(pool, identity, 'ZZZZ-ZZZZ', Date.now()))
      .toEqual({ ok: false, status: 404, error: 'unknown_code' })

    const ahora = Date.now()
    const viejo = await iniciarVinculacion(pool, ahora)
    expect(await consultarVinculacion(pool, identity, viejo.codigoDeUsuario, ahora + VIGENCIA_MS + 1))
      .toEqual({ ok: false, status: 400, error: 'expired' })

    const aprobado = await iniciarVinculacion(pool, ahora)
    await aprobarVinculacion(pool, identity, aprobado.codigoDeUsuario, ahora + 1000)
    expect(await consultarVinculacion(pool, identity, aprobado.codigoDeUsuario, ahora + 2000))
      .toEqual({ ok: false, status: 409, error: 'already_approved' })
  })
})
```

- [ ] **Step 2: Escribir los tests que fallan (HTTP)**

`server/__tests__/link-check-http.test.ts` (Task 3 le agrega los tests de CORS a este mismo archivo):

```ts
// `POST /v1/link/check` de punta a punta. NECESITA POSTGRES.
//
// El limitador de `check` es por IP y este archivo pega siempre desde 127.0.0.1: los pedidos
// se crean con `iniciarVinculacion` directo y sólo `check` va por HTTP. Mantener el total de
// POST a `check` del archivo por debajo de 20.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID, createHmac } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { getPool, migrate } from '../src/db'
import { createApp } from '../src/http'
import { iniciarVinculacion, VIGENCIA_MS } from '../src/link'

const pool = getPool()
const SECRET = 'secreto-de-prueba'
let base: string
let server: ReturnType<typeof createApp>
let userId: string

function jwtDe(sub: string, role = 'authenticated'): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub, email: 'gero@nestmux.com', role, exp: Math.floor(Date.now() / 1000) + 3600 })
  const firma = createHmac('sha256', SECRET).update(`${head}.${payload}`).digest('base64url')
  return `${head}.${payload}.${firma}`
}

beforeAll(async () => {
  process.env.SUPABASE_JWT_SECRET = SECRET
  delete process.env.SUPABASE_URL
  await migrate(pool)
  userId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'cloud')`, [userId])
  await pool.query('insert into allowlist (user_id) values ($1)', [userId])
  server = createApp(pool)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  await pool.end()
})

const check = (body: unknown, jwt?: string, extra: Record<string, string> = {}) =>
  fetch(`${base}/v1/link/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}), ...extra },
    body: JSON.stringify(body),
  })

describe('POST /v1/link/check', () => {
  it('sin JWT es 401 y no dice nada del pedido', async () => {
    const r = await iniciarVinculacion(pool, Date.now(), { nombre: 'secreta', plataforma: 'linux' })
    const res = await check({ user_code: r.codigoDeUsuario })
    expect(res.status).toBe(401)
    expect(JSON.stringify(await res.json())).not.toContain('secreta')
  })

  it('la anon key no alcanza', async () => {
    const r = await iniciarVinculacion(pool, Date.now())
    expect((await check({ user_code: r.codigoDeUsuario }, jwtDe(userId, 'anon'))).status).toBe(401)
  })

  it('con JWT devuelve la forma del contrato', async () => {
    const r = await iniciarVinculacion(pool, Date.now(), { nombre: 'build-box', plataforma: 'darwin' })
    const res = await check({ user_code: r.codigoDeUsuario }, jwtDe(userId))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j).toMatchObject({ device_name: 'build-box', platform: 'darwin', eligibility: 'ok' })
    expect(typeof j.created_at).toBe('string')
    expect(typeof j.expires_at).toBe('string')
    expect(j.expires_in).toBeGreaterThan(0)
    expect(j.expires_in).toBeLessThanOrEqual(VIGENCIA_MS / 1000)
  })

  it('también acepta `code` en vez de `user_code`', async () => {
    const r = await iniciarVinculacion(pool, Date.now())
    expect((await check({ code: r.codigoDeUsuario }, jwtDe(userId))).status).toBe(200)
  })

  it('sin código es 400 missing_user_code', async () => {
    const res = await check({}, jwtDe(userId))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('missing_user_code')
  })

  it('desconocido 404 y vencido 400, con el error en el cuerpo', async () => {
    const res404 = await check({ user_code: 'ZZZZ-ZZZZ' }, jwtDe(userId))
    expect(res404.status).toBe(404)
    expect((await res404.json()).error).toBe('unknown_code')

    const viejo = await iniciarVinculacion(pool, Date.now() - VIGENCIA_MS - 1000)
    const res400 = await check({ user_code: viejo.codigoDeUsuario }, jwtDe(userId))
    expect(res400.status).toBe(400)
    expect((await res400.json()).error).toBe('expired')
  })

  it('rechaza los métodos que no son POST ni OPTIONS', async () => {
    expect((await fetch(`${base}/v1/link/check`)).status).toBe(405)
  })
})
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `cd server && npx vitest run __tests__/link-check.test.ts __tests__/link-check-http.test.ts`
Expected: FAIL — `Cannot find module '../src/elegibilidad'` / `elegibilidadDeMaquinaNueva is not a function` / la ruta da 404.

- [ ] **Step 4: Crear `server/src/elegibilidad.ts`**

Mover acá `CLOUD_PLANS` con su comentario completo (copiarlo tal cual desde `auth.ts`), y sumar el veredicto:

```ts
// Qué le pasa a una máquina de una cuenta: el veredicto de beta, plan y tope de máquinas.
//
// Puro, y en UN solo lugar, porque lo usan dos caminos que tienen que decir lo mismo:
// `authenticate` (cada request de un device ya registrado) y `/v1/link/check` (lo que la
// página le muestra a alguien ANTES de aprobar una máquina nueva). Spec
// 2026-11-02-login-y-compra-sin-nest §3: "el mismo control… para que no haya dos verdades".
import { limitsFor } from './limits'

// (acá va el comentario original de CLOUD_PLANS, movido desde auth.ts sin cambios)
export const CLOUD_PLANS = new Set(['free', 'cloud', 'pro', 'team', 'enterprise'])

export type Elegibilidad = 'ok' | 'not_in_beta' | 'plan_required' | 'device_limit_reached'

/**
 * `maquinasPrevias`: las máquinas vivas de la cuenta que van ANTES que la juzgada. Para un
 * device registrado son las más viejas que él (`authenticate`); para una máquina que todavía
 * no existe son todas las vivas, porque la nueva sería la última.
 *
 * El orden de los chequeos es el de `authenticate` desde siempre: beta, plan, tope.
 */
export function veredictoDeElegibilidad(e: { enAllowlist: boolean; plan: string; maquinasPrevias: number }): Elegibilidad {
  if (!e.enAllowlist) return 'not_in_beta'
  if (!CLOUD_PLANS.has(e.plan)) return 'plan_required'
  if (e.maquinasPrevias >= limitsFor(e.plan).maxDevices) return 'device_limit_reached'
  return 'ok'
}
```

- [ ] **Step 5: `authenticate` usa el veredicto**

En `server/src/auth.ts`: borrar la definición de `CLOUD_PLANS` (y su comentario, ya movido), borrar `import { limitsFor } from './limits'`, y sumar:

```ts
import { veredictoDeElegibilidad } from './elegibilidad'

// `plan-sync.ts` y los tests lo importan de acá desde siempre.
export { CLOUD_PLANS } from './elegibilidad'
```

En `authenticate`, reemplazar desde `const row = rows[0]` hasta el `return { ok: false, status: 403, error: 'device_limit_reached' }` inclusive por:

```ts
  const row = rows[0]

  // (conservar acá, sin cambios, los dos comentarios sobre el orden por antigüedad y el
  // desempate (created_at, id) que estaban arriba de esta consulta)
  const { rows: olderRows } = await pool.query(
    `select count(*)::int as n
       from devices
      where user_id = $1
        and revoked_at is null
        and (created_at, id) < (select created_at, id from devices where id = $2)`,
    [row.user_id, row.device_id]
  )
  const veredicto = veredictoDeElegibilidad({
    enAllowlist: Boolean(row.allowed),
    plan: row.plan,
    maquinasPrevias: olderRows[0].n,
  })
  if (veredicto !== 'ok') return { ok: false, status: 403, error: veredicto }
```

(La consulta de antigüedad ahora corre también para cuentas fuera de la beta o sin plan: es una consulta indexada más sólo en el camino que ya falla.)

- [ ] **Step 6: `elegibilidadDeMaquinaNueva` en `devices.ts`**

En `server/src/devices.ts`: cambiar `async function planPagoDeSupabase(` por `export async function planPagoDeSupabase(`, sumar `import { veredictoDeElegibilidad, type Elegibilidad } from './elegibilidad'`, y agregar después de `planPagoDeSupabase`:

```ts
/**
 * Spec login-y-compra-sin-nest §3: lo que `registerDevice` + `authenticate` le harían a una
 * máquina NUEVA de esta cuenta, sin crear nada — ni `users`, ni allowlist, ni token.
 *
 * La red de seguridad del plan pago se aplica igual que en `registerDevice`, pero en memoria:
 * un plan pago leído de Supabase sube a uno que no lo es y cuenta como beta (pagar te mete en
 * la allowlist, decisión 5). El test de acuerdo de `link-check.test.ts` compara esto contra
 * registrar y autenticar de verdad.
 */
export async function elegibilidadDeMaquinaNueva(
  pool: Pool,
  identity: JwtIdentity,
  supabaseJwt?: string
): Promise<Elegibilidad> {
  const planPago = await planPagoDeSupabase(identity.userId, supabaseJwt)
  const { rows } = await pool.query(
    `select u.plan,
            exists (select 1 from allowlist a where a.user_id = $1) as allowed,
            (select count(*)::int from devices d where d.user_id = $1 and d.revoked_at is null) as vivas
       from (select 1) as uno
       left join users u on u.id = $1`,
    [identity.userId]
  )
  const fila = rows[0] as { plan: string | null; allowed: boolean; vivas: number }
  // Una cuenta que el servicio no conoce entraría como `free` (el default de `users.plan`).
  const planGuardado = fila.plan ?? 'free'
  const plan = planPago && !PLANES_PAGOS.has(planGuardado) ? planPago : planGuardado
  return veredictoDeElegibilidad({
    enAllowlist: fila.allowed || planPago !== null,
    plan,
    maquinasPrevias: fila.vivas,
  })
}
```

- [ ] **Step 7: `consultarVinculacion` en `link.ts`**

En `server/src/link.ts`, cambiar el import a `import { registerDevice, elegibilidadDeMaquinaNueva, type JwtIdentity } from './devices'`, sumar `import type { Elegibilidad } from './elegibilidad'`, y agregar arriba de `aprobarVinculacion`:

```ts
/** Cómo se busca un código que alguien tipeó: sin espacios alrededor y en mayúsculas. */
export function limpiarCodigoDeUsuario(codigo: string): string {
  return codigo.trim().toUpperCase()
}
```

En `aprobarVinculacion`, reemplazar las dos apariciones de `codigoDeUsuario.trim().toUpperCase()` por `limpiarCodigoDeUsuario(codigoDeUsuario)`.

Agregar después de `aprobarVinculacion`:

```ts
export interface PedidoConsultado {
  deviceName: string | null
  platform: string | null
  createdAt: string
  expiresAt: string
  /** Segundos que le quedan, medidos con el reloj del SERVIDOR: el del navegador puede estar corrido. */
  expiresIn: number
  eligibility: Elegibilidad
}

export type ResultadoDeConsultar =
  | { ok: true; pedido: PedidoConsultado }
  | { ok: false; status: 400 | 404 | 409; error: 'unknown_code' | 'expired' | 'already_approved' }

/**
 * `POST /v1/link/check`: lo que la página muestra ANTES de aprobar (spec §3 y §4.2). No toca
 * la fila ni crea nada; los tres errores salen en el mismo orden que en `aprobarVinculacion`,
 * así una página que consulta y después aprueba nunca ve dos respuestas distintas para el
 * mismo código.
 */
export async function consultarVinculacion(
  pool: Pool,
  identidad: JwtIdentity,
  codigoDeUsuario: string,
  ahora: number,
  supabaseJwt?: string
): Promise<ResultadoDeConsultar> {
  const { rows } = await pool.query(
    `select user_id, device_name, platform, created_at, expires_at from link_requests where user_code = $1`,
    [limpiarCodigoDeUsuario(codigoDeUsuario)]
  )
  const fila = rows[0]
  if (!fila) return { ok: false, status: 404, error: 'unknown_code' }
  const vence = new Date(fila.expires_at).getTime()
  if (vence <= ahora) return { ok: false, status: 400, error: 'expired' }
  if (fila.user_id) return { ok: false, status: 409, error: 'already_approved' }

  const eligibility = await elegibilidadDeMaquinaNueva(pool, identidad, supabaseJwt)
  return {
    ok: true,
    pedido: {
      deviceName: fila.device_name ?? null,
      platform: fila.platform ?? null,
      createdAt: new Date(fila.created_at).toISOString(),
      expiresAt: new Date(fila.expires_at).toISOString(),
      expiresIn: Math.max(0, Math.floor((vence - ahora) / 1000)),
      eligibility,
    },
  }
}
```

- [ ] **Step 8: La ruta en `http.ts`**

Sumar `consultarVinculacion` al import de `./link`. Debajo de `const linkLimiter = …`:

```ts
// `check` tiene el mismo techo que `start` pero su propio contador: una persona que recarga la
// página de aprobación no tiene por qué dejar sin poder pedir un código a la terminal de al
// lado, que sale por la misma IP de la casa.
const linkCheckLimiter = createRateLimiter({ limit: 20, windowMs: 60 * 60_000 })
```

En `handleRequest`, debajo del bloque de `/v1/link/approve`:

```ts
  if (path === '/v1/link/check') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
    return handleLinkCheck(pool, req, res)
  }
```

Debajo de `handleLinkApprove`:

```ts
/** `POST /v1/link/check` — con el JWT de Supabase; lo que la página muestra antes de aprobar. */
async function handleLinkCheck(pool: Pool, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    // El limitador va antes del JWT: probar códigos al azar sin login también lo gasta.
    const verdict = linkCheckLimiter.check(req.socket.remoteAddress ?? 'sin-ip')
    if (!verdict.ok) {
      return send(res, 429, { error: 'rate_limited' }, { 'Retry-After': String(verdict.retryAfterSeconds) })
    }
    const emisor = emisorDelEntorno()
    if (!emisor) {
      console.error('[http] /v1/link/check sin SUPABASE_URL ni SUPABASE_JWT_SECRET')
      return send(res, 503, { error: 'issuer_unavailable' })
    }
    const jwt = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim()
    const identity = await verificarJwtDeSupabase(jwt, Date.now(), emisor)
    if (!identity) return send(res, 401, { error: 'unauthorized' })

    const body = (await readBody(req)) as Record<string, unknown>
    // `user_code` como `approve`; `code` es el nombre del spec, aceptado igual.
    const codigo = typeof body.user_code === 'string' ? body.user_code
      : typeof body.code === 'string' ? body.code : ''
    if (!codigo) return send(res, 400, { error: 'missing_user_code' })

    const r = await consultarVinculacion(pool, identity, codigo, Date.now(), jwt)
    if (!r.ok) return send(res, r.status, { error: r.error })
    return send(res, 200, {
      device_name: r.pedido.deviceName,
      platform: r.pedido.platform,
      created_at: r.pedido.createdAt,
      expires_at: r.pedido.expiresAt,
      expires_in: r.pedido.expiresIn,
      eligibility: r.pedido.eligibility,
    })
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    if (status === 500) console.error('[http] /v1/link/check', err)
    return send(res, status, { error: status === 500 ? 'internal_error' : (err as Error).message })
  }
}
```

- [ ] **Step 9: Correr los tests nuevos, los que tocan `authenticate` y el typecheck**

Run: `cd server && npx vitest run __tests__/link-check.test.ts __tests__/link-check-http.test.ts __tests__/auth.test.ts __tests__/auth-device-limit.test.ts __tests__/link.test.ts __tests__/plan-sync.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, 0 errores.

- [ ] **Step 10: Correr la suite completa del servidor**

Run: `cd server && npx vitest run`
Expected: PASS (el refactor de `authenticate` no cambia ningún resultado).

- [ ] **Step 11: Commit**

```bash
git add server/src/elegibilidad.ts server/src/auth.ts server/src/devices.ts server/src/link.ts server/src/http.ts server/__tests__/link-check.test.ts server/__tests__/link-check-http.test.ts
git commit -m "$(cat <<'EOF'
feat(link): POST /v1/link/check con la elegibilidad compartida con authenticate

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Servidor — CORS en `check` y `approve`

**Files:**
- Create: `server/src/cors.ts`
- Modify: `server/src/http.ts` (ruteo de `/v1/link/approve` y `/v1/link/check`; `handleLinkApprove` y `handleLinkCheck` reciben las cabeceras)
- Test: `server/__tests__/cors.test.ts`, `server/__tests__/link-check-http.test.ts`

**Interfaces:**
- Consumes: `handleLinkCheck` (Task 2).
- Produces:
  - `export const ORIGENES_POR_DEFECTO: readonly string[]` (`https://nestmux.com`, `http://localhost:4321`)
  - `export function origenesDeVinculacion(env: string | undefined): string[]`
  - `export function cabecerasCors(origen: string | undefined, permitidos: readonly string[]): Record<string, string>`
  - Comportamiento HTTP: `OPTIONS /v1/link/check|approve` → 204; con origen permitido lleva `Access-Control-Allow-Origin: <origen>`, `Access-Control-Allow-Methods: POST`, `Access-Control-Allow-Headers: authorization, content-type`, `Access-Control-Max-Age: 600`, `Vary: Origin`. Toda respuesta de esas dos rutas (también 4xx/5xx) lleva las mismas cabeceras. Sin `Access-Control-Allow-Credentials`.

**"Fuera de producción" sin `NODE_ENV`:** el servicio no tiene noción de entorno. Sin `LINK_WEB_ORIGINS` (desarrollo) valen los dos por defecto; en Railway se setea `LINK_WEB_ORIGINS=https://nestmux.com` y ahí manda sólo esa lista.

- [ ] **Step 1: Escribir los tests puros que fallan**

`server/__tests__/cors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { cabecerasCors, origenesDeVinculacion, ORIGENES_POR_DEFECTO } from '../src/cors'

describe('origenesDeVinculacion', () => {
  it('sin la variable valen nestmux.com y el astro dev local', () => {
    expect(origenesDeVinculacion(undefined)).toEqual(['https://nestmux.com', 'http://localhost:4321'])
    expect(origenesDeVinculacion('  ')).toEqual([...ORIGENES_POR_DEFECTO])
  })

  it('con la variable manda SÓLO la lista: así se saca localhost en producción', () => {
    expect(origenesDeVinculacion('https://nestmux.com')).toEqual(['https://nestmux.com'])
    expect(origenesDeVinculacion(' https://a.com/ , https://b.com ')).toEqual(['https://a.com', 'https://b.com'])
  })
})

describe('cabecerasCors', () => {
  const permitidos = ['https://nestmux.com']

  it('a un origen permitido le devuelve ESE origen, sólo POST y los dos headers', () => {
    expect(cabecerasCors('https://nestmux.com', permitidos)).toEqual({
      'Access-Control-Allow-Origin': 'https://nestmux.com',
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    })
  })

  it('a otro origen (también www. o http://) no le abre nada (Review Focus 5)', () => {
    for (const o of ['https://evil.example', 'https://www.nestmux.com', 'http://nestmux.com', 'null', undefined]) {
      const h = cabecerasCors(o, permitidos)
      expect(h['Access-Control-Allow-Origin']).toBeUndefined()
      expect(h.Vary).toBe('Origin')
    }
  })

  it('nunca habilita credenciales: el JWT viaja en Authorization, no en cookies', () => {
    expect(cabecerasCors('https://nestmux.com', permitidos)['Access-Control-Allow-Credentials']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Escribir los tests HTTP que fallan**

Agregar al final de `server/__tests__/link-check-http.test.ts`:

```ts
describe('CORS de las rutas de vinculación (Review Focus 5)', () => {
  const preflight = (path: string, origin: string) =>
    fetch(`${base}${path}`, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' },
    })

  it('el preflight desde nestmux.com abre check y approve', async () => {
    for (const path of ['/v1/link/check', '/v1/link/approve']) {
      const r = await preflight(path, 'https://nestmux.com')
      expect(r.status).toBe(204)
      expect(r.headers.get('access-control-allow-origin')).toBe('https://nestmux.com')
      expect(r.headers.get('access-control-allow-methods')).toBe('POST')
      expect(r.headers.get('access-control-allow-headers')).toBe('authorization, content-type')
      expect(r.headers.get('access-control-allow-credentials')).toBeNull()
    }
  })

  it('el preflight desde otro origen no lleva Allow-Origin', async () => {
    const r = await preflight('/v1/link/check', 'https://evil.example')
    expect(r.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('el POST desde nestmux.com lleva Allow-Origin, también cuando es un error', async () => {
    const ok = await iniciarVinculacion(pool, Date.now())
    const r200 = await check({ user_code: ok.codigoDeUsuario }, jwtDe(userId), { Origin: 'https://nestmux.com' })
    expect(r200.headers.get('access-control-allow-origin')).toBe('https://nestmux.com')
    const r401 = await check({ user_code: ok.codigoDeUsuario }, undefined, { Origin: 'https://nestmux.com' })
    expect(r401.status).toBe(401)
    expect(r401.headers.get('access-control-allow-origin')).toBe('https://nestmux.com')
  })

  it('el POST desde otro origen no lleva Allow-Origin', async () => {
    const r = await iniciarVinculacion(pool, Date.now())
    const res = await check({ user_code: r.codigoDeUsuario }, jwtDe(userId), { Origin: 'https://evil.example' })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('approve desde nestmux.com lleva Allow-Origin', async () => {
    const r = await iniciarVinculacion(pool, Date.now())
    const res = await fetch(`${base}/v1/link/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwtDe(userId)}`, Origin: 'https://nestmux.com' },
      body: JSON.stringify({ user_code: r.codigoDeUsuario }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://nestmux.com')
  })

  it('LINK_WEB_ORIGINS se lee en cada request y reemplaza los de por defecto', async () => {
    const antes = process.env.LINK_WEB_ORIGINS
    process.env.LINK_WEB_ORIGINS = 'https://staging.nestmux.com'
    try {
      expect((await preflight('/v1/link/check', 'https://nestmux.com')).headers.get('access-control-allow-origin')).toBeNull()
      expect((await preflight('/v1/link/check', 'https://staging.nestmux.com')).headers.get('access-control-allow-origin'))
        .toBe('https://staging.nestmux.com')
    } finally {
      if (antes === undefined) delete process.env.LINK_WEB_ORIGINS
      else process.env.LINK_WEB_ORIGINS = antes
    }
  })

  it('las demás rutas no aprenden CORS', async () => {
    const start = await fetch(`${base}/v1/link/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://nestmux.com' }, body: '{}',
    })
    expect(start.headers.get('access-control-allow-origin')).toBeNull()
    const opt = await preflight('/v1/link/start', 'https://nestmux.com')
    expect(opt.status).toBe(405)
    expect(opt.headers.get('access-control-allow-origin')).toBeNull()
    const status = await fetch(`${base}/v1/sync/status`, { headers: { Origin: 'https://nestmux.com' } })
    expect(status.headers.get('access-control-allow-origin')).toBeNull()
  })
})
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `cd server && npx vitest run __tests__/cors.test.ts __tests__/link-check-http.test.ts`
Expected: FAIL — `Cannot find module '../src/cors'` y los preflight dan 405.

- [ ] **Step 4: Crear `server/src/cors.ts`**

```ts
// CORS para las DOS rutas que llama la página `nestmux.com/link` (spec login sin Nest §3).
//
// Cerrado a orígenes conocidos y sin credenciales: el JWT viaja en `Authorization`, nunca en
// una cookie, así que no hay nada que un `Allow-Credentials` habilite que haga falta. El resto
// del servicio no tiene CORS y no lo necesita: lo llaman Nest y la CLI, que no son navegadores.

/** Sin `LINK_WEB_ORIGINS`: la landing y el `astro dev` local (desarrollo). */
export const ORIGENES_POR_DEFECTO: readonly string[] = ['https://nestmux.com', 'http://localhost:4321']

/**
 * La lista de orígenes permitidos. Con la variable seteada manda SÓLO ella: es como producción
 * deja afuera a localhost. Se lee en cada request, igual que el resto del entorno del servicio.
 */
export function origenesDeVinculacion(env: string | undefined): string[] {
  const lista = (env ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o !== '')
  return lista.length > 0 ? lista : [...ORIGENES_POR_DEFECTO]
}

/**
 * Las cabeceras para una respuesta a `origen`. `Vary: Origin` va siempre: la respuesta cambia
 * según quién pregunta, y un caché intermedio que no lo sepa le serviría a un origen la
 * respuesta armada para otro.
 */
export function cabecerasCors(origen: string | undefined, permitidos: readonly string[]): Record<string, string> {
  if (!origen || !permitidos.includes(origen)) return { Vary: 'Origin' }
  return {
    'Access-Control-Allow-Origin': origen,
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}
```

- [ ] **Step 5: Cablearlo en `http.ts`**

Sumar `import { cabecerasCors, origenesDeVinculacion } from './cors'`. En `handleRequest`, reemplazar los bloques de `/v1/link/approve` y `/v1/link/check` por uno solo:

```ts
  // Las dos puertas que llama la página `nestmux.com/link`: llevan CORS (preflight incluido)
  // y ninguna otra ruta lo tiene.
  if (path === '/v1/link/approve' || path === '/v1/link/check') {
    const origen = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
    const cors = cabecerasCors(origen, origenesDeVinculacion(process.env.LINK_WEB_ORIGINS))
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors)
      res.end()
      return
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, cors)
    return path === '/v1/link/check'
      ? handleLinkCheck(pool, req, res, cors)
      : handleLinkApprove(pool, req, res, cors)
  }
```

Cambiar las firmas a `handleLinkApprove(pool: Pool, req: IncomingMessage, res: ServerResponse, cors: Record<string, string>)` y lo mismo en `handleLinkCheck`, y pasar `cors` como cuarto argumento en **cada** `send(...)` de esas dos funciones. En el 429 de `handleLinkCheck`: `send(res, 429, { error: 'rate_limited' }, { ...cors, 'Retry-After': String(verdict.retryAfterSeconds) })`.

- [ ] **Step 6: Correr los tests y el typecheck**

Run: `cd server && npx vitest run __tests__/cors.test.ts __tests__/link-check-http.test.ts __tests__/link-http.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, 0 errores.

- [ ] **Step 7: Commit**

```bash
git add server/src/cors.ts server/src/http.ts server/__tests__/cors.test.ts server/__tests__/link-check-http.test.ts
git commit -m "$(cat <<'EOF'
feat(link): CORS cerrado a LINK_WEB_ORIGINS en /v1/link/check y /v1/link/approve

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: CLI — `login` imprime el link, abre el navegador y manda nombre y sistema

**Files:**
- Create: `electron/vinculacion-web-del-paquete.ts`
- Modify: `electron/cli-del-paquete.ts` (`comandoLogin`, ~líneas 509-535)
- Test: `electron/__tests__/vinculacion-web-del-paquete.test.ts`

**Interfaces:**
- Consumes: `normalizarBaseDeSync` de `electron/base-de-sync.ts`; `/v1/link/start` acepta `{ name, platform }` (Task 1).
- Produces:
  - `export const BASE_WEB_POR_DEFECTO = 'https://nestmux.com'`
  - `export function webDelPaquete(env: string | undefined): string`
  - `export function urlDeVinculacion(baseWeb: string, codigo: string): string`
  - `export function urlDeUpgrade(baseWeb: string): string`
  - `export function textoDeVinculacion(e: { url: string; codigo: string; venceEnSeg: number }): string[]`
  - `export function cuerpoDeInicio(nombre: string, plataforma: string): { name: string; platform: string }`
  - `export function hayDondeAbrir(env: Record<string, string | undefined>, plataforma: NodeJS.Platform): boolean`
  - `export function comandoParaAbrir(plataforma: NodeJS.Platform, url: string): { cmd: string; args: string[] }`
  - `export interface ProcesoLanzado { on(evento: 'error', cb: (err: Error) => void): unknown; unref(): void }`
  - `export type Lanzador = (cmd: string, args: string[]) => ProcesoLanzado`
  - `export function abrirNavegador(url: string, plataforma: NodeJS.Platform, lanzar?: Lanzador): boolean`

**Windows:** `start` es un builtin de `cmd.exe` y no existe sin shell. Para abrir sin shell se usa `rundll32.exe url.dll,FileProtocolHandler <url>`.

- [ ] **Step 1: Escribir los tests que fallan**

`electron/__tests__/vinculacion-web-del-paquete.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import {
  BASE_WEB_POR_DEFECTO, webDelPaquete, urlDeVinculacion, urlDeUpgrade, textoDeVinculacion,
  cuerpoDeInicio, hayDondeAbrir, comandoParaAbrir, abrirNavegador, type ProcesoLanzado,
} from '../vinculacion-web-del-paquete'

describe('la base de la página', () => {
  it('sin env es nestmux.com; con env, la del env sin barra final', () => {
    expect(webDelPaquete(undefined)).toBe(BASE_WEB_POR_DEFECTO)
    expect(BASE_WEB_POR_DEFECTO).toBe('https://nestmux.com')
    expect(webDelPaquete('http://localhost:4321/')).toBe('http://localhost:4321')
  })

  it('un env que no es http(s) se ignora: no se abre un file: ni un javascript:', () => {
    expect(webDelPaquete('javascript:alert(1)')).toBe(BASE_WEB_POR_DEFECTO)
    expect(webDelPaquete('file:///etc/passwd')).toBe(BASE_WEB_POR_DEFECTO)
  })
})

describe('el link y el texto del login', () => {
  it('el link lleva el código como ?code=', () => {
    expect(urlDeVinculacion('https://nestmux.com', 'WXYZ-1234')).toBe('https://nestmux.com/link?code=WXYZ-1234')
    expect(urlDeUpgrade('https://nestmux.com')).toBe('https://nestmux.com/upgrade')
  })

  it('el texto es el del spec, con el código y los minutos', () => {
    expect(textoDeVinculacion({ url: 'https://nestmux.com/link?code=WXYZ-1234', codigo: 'WXYZ-1234', venceEnSeg: 600 })).toEqual([
      'To connect this machine, open:',
      '  https://nestmux.com/link?code=WXYZ-1234',
      'and sign in with your Nest account. Code: WXYZ-1234 (expires in 10 minutes)',
    ])
    expect(textoDeVinculacion({ url: 'u', codigo: 'c', venceEnSeg: 60 })[2]).toMatch(/expires in 1 minute\)$/)
  })

  it('al arrancar manda el nombre y la plataforma', () => {
    expect(cuerpoDeInicio('gero-laptop', 'darwin')).toEqual({ name: 'gero-laptop', platform: 'darwin' })
  })
})

describe('abrir el navegador', () => {
  it('por SSH o en un Linux sin pantalla no intenta', () => {
    expect(hayDondeAbrir({ SSH_CONNECTION: '1.2.3.4 22 5.6.7.8 22' }, 'darwin')).toBe(false)
    expect(hayDondeAbrir({ SSH_TTY: '/dev/pts/0' }, 'win32')).toBe(false)
    expect(hayDondeAbrir({}, 'linux')).toBe(false)
    expect(hayDondeAbrir({ DISPLAY: ':0' }, 'linux')).toBe(true)
    expect(hayDondeAbrir({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux')).toBe(true)
    expect(hayDondeAbrir({}, 'darwin')).toBe(true)
  })

  it('un comando por sistema, sin shell: la URL va como argumento suelto', () => {
    const url = 'https://nestmux.com/link?code=WXYZ-1234'
    expect(comandoParaAbrir('win32', url)).toEqual({ cmd: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] })
    expect(comandoParaAbrir('darwin', url)).toEqual({ cmd: 'open', args: [url] })
    expect(comandoParaAbrir('linux', url)).toEqual({ cmd: 'xdg-open', args: [url] })
  })

  it('lanza desacoplado y escucha el error para que no tumbe el proceso', () => {
    const on = vi.fn()
    const unref = vi.fn()
    const lanzar = vi.fn((): ProcesoLanzado => ({ on, unref }))
    expect(abrirNavegador('https://x', 'darwin', lanzar)).toBe(true)
    expect(lanzar).toHaveBeenCalledWith('open', ['https://x'])
    expect(on).toHaveBeenCalledWith('error', expect.any(Function))
    expect(unref).toHaveBeenCalled()
    // El error asíncrono (no hay xdg-open) se traga: el link ya está impreso.
    expect(() => (on.mock.calls[0]![1] as (e: Error) => void)(new Error('ENOENT'))).not.toThrow()
  })

  it('si el abridor tira, devuelve false y no lanza: el login sigue esperando', () => {
    const lanzar = vi.fn((): ProcesoLanzado => { throw new Error('spawn EACCES') })
    expect(abrirNavegador('https://x', 'linux', lanzar)).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm run native:node; npx vitest run electron/__tests__/vinculacion-web-del-paquete.test.ts`
Expected: FAIL — `Cannot find module '../vinculacion-web-del-paquete'`.

- [ ] **Step 3: Implementar `electron/vinculacion-web-del-paquete.ts`**

```ts
// La mitad web de `npx @nestmux/memory login` (spec 2026-11-02-login-y-compra-sin-nest §1).
//
// La terminal no puede abrir un login, así que imprime un link a `nestmux.com/link` con el
// código y —si hay dónde— abre el navegador. Lo que se puede equivocar está acá y probado; la
// CLI sólo imprime lo que esto arma.
//
// Sin dependencias nativas (ver `paquete-sin-nativas.test.ts`): `child_process` es de Node.
import { spawn } from 'child_process'
import { normalizarBaseDeSync } from './base-de-sync'

/** La página por defecto. Override por `NEST_MEMORY_WEB_URL`, igual que el sync por `NEST_MEMORY_SYNC_URL`. */
export const BASE_WEB_POR_DEFECTO = 'https://nestmux.com'

/**
 * La misma normalización que la base del sync: sólo http(s) y sin barra final. Un env con
 * `file:` o `javascript:` no puede convertirse en algo que la CLI le pasa al abridor del sistema.
 */
export function webDelPaquete(env: string | undefined): string {
  return normalizarBaseDeSync(env) ?? BASE_WEB_POR_DEFECTO
}

export function urlDeVinculacion(baseWeb: string, codigo: string): string {
  return `${baseWeb}/link?code=${encodeURIComponent(codigo)}`
}

export function urlDeUpgrade(baseWeb: string): string {
  return `${baseWeb}/upgrade`
}

/** Las tres líneas del spec §1. Quien llama les pone la sangría. */
export function textoDeVinculacion(e: { url: string; codigo: string; venceEnSeg: number }): string[] {
  const minutos = Math.max(1, Math.round(e.venceEnSeg / 60))
  return [
    'To connect this machine, open:',
    `  ${e.url}`,
    `and sign in with your Nest account. Code: ${e.codigo} (expires in ${minutos} ${minutos === 1 ? 'minute' : 'minutes'})`,
  ]
}

/** El cuerpo de `/v1/link/start`: lo que la página muestra para que la persona reconozca su máquina. */
export function cuerpoDeInicio(nombre: string, plataforma: string): { name: string; platform: string } {
  return { name: nombre, platform: plataforma }
}

/**
 * Si tiene sentido intentar abrir un navegador ACÁ. Por SSH abriría (con suerte) uno en la
 * máquina remota, que nadie está mirando; en un Linux sin pantalla, nada.
 */
export function hayDondeAbrir(env: Record<string, string | undefined>, plataforma: NodeJS.Platform): boolean {
  if (env.SSH_CONNECTION || env.SSH_TTY) return false
  if (plataforma === 'linux') return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY)
  return true
}

/**
 * Sin shell en ningún sistema: la URL viaja como argumento suelto y no se interpreta. Por eso
 * en Windows no es `start` (un builtin de `cmd.exe`) sino el manejador de URLs de rundll32.
 */
export function comandoParaAbrir(plataforma: NodeJS.Platform, url: string): { cmd: string; args: string[] } {
  if (plataforma === 'win32') return { cmd: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
  if (plataforma === 'darwin') return { cmd: 'open', args: [url] }
  return { cmd: 'xdg-open', args: [url] }
}

export interface ProcesoLanzado {
  on(evento: 'error', cb: (err: Error) => void): unknown
  unref(): void
}
export type Lanzador = (cmd: string, args: string[]) => ProcesoLanzado

const lanzarDesacoplado: Lanzador = (cmd, args) =>
  spawn(cmd, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: true })

/**
 * Intenta abrir `url`. **Nunca lanza**: el link ya está impreso, así que un navegador que no
 * aparece no es un error — la persona lo abre a mano en cualquier dispositivo.
 */
export function abrirNavegador(url: string, plataforma: NodeJS.Platform, lanzar: Lanzador = lanzarDesacoplado): boolean {
  try {
    const { cmd, args } = comandoParaAbrir(plataforma, url)
    const hijo = lanzar(cmd, args)
    // Sin este listener, un `ENOENT` (no hay xdg-open) llega como evento 'error' sin dueño y
    // tumba el proceso en medio de la espera.
    hijo.on('error', () => { /* sin navegador: el link ya está impreso */ })
    hijo.unref()
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Correr el test**

Run: `npx vitest run electron/__tests__/vinculacion-web-del-paquete.test.ts`
Expected: PASS.

- [ ] **Step 5: Cablear `comandoLogin`**

En `electron/cli-del-paquete.ts`, sumar al bloque de imports:

```ts
import {
  webDelPaquete, urlDeVinculacion, textoDeVinculacion, cuerpoDeInicio, hayDondeAbrir, abrirNavegador,
} from './vinculacion-web-del-paquete'
```

En `comandoLogin`, el `fetch` de `/v1/link/start` pasa a mandar el cuerpo:

```ts
  const inicio = await fetch(`${base}/v1/link/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // El nombre y el sistema los muestra la página que aprueba: así la persona reconoce SU
    // máquina y no aprueba un código que le mandó otro.
    body: JSON.stringify(cuerpoDeInicio(hostname(), process.platform)),
  })
```

Y reemplazar las cinco líneas desde `console.log(\`  Your code:  …\`)` hasta `console.log('')` (la que va antes de `process.stdout.write('  Waiting…')`) por:

```ts
  const url = urlDeVinculacion(webDelPaquete(process.env.NEST_MEMORY_WEB_URL), arranque.user_code)
  for (const linea of textoDeVinculacion({ url, codigo: arranque.user_code, venceEnSeg: arranque.expires_in ?? 600 })) {
    console.log(`  ${linea}`)
  }
  console.log(`  ${e.tenue('No browser here? Open the link on any device, or approve the code from Nest › Memory settings.')}`)
  console.log('')
  // Ignora el resultado a propósito: si no se abre, el link está impreso y el bucle sigue igual.
  if (hayDondeAbrir(process.env, process.platform)) abrirNavegador(url, process.platform)
```

- [ ] **Step 6: Typecheck, tests del paquete y build del paquete**

Run: `npx tsc -p tsconfig.node.json --noEmit --composite false; npx vitest run electron/__tests__/paquete-sin-nativas.test.ts electron/__tests__/login-del-paquete.test.ts electron/__tests__/vinculacion-web-del-paquete.test.ts; npm --prefix packages/nest-memory run build`
Expected: 0 errores, PASS, build sin errores.

- [ ] **Step 7: Commit**

```bash
git add electron/vinculacion-web-del-paquete.ts electron/cli-del-paquete.ts electron/__tests__/vinculacion-web-del-paquete.test.ts
git commit -m "$(cat <<'EOF'
feat(paquete): login imprime el link a nestmux.com/link, abre el navegador y manda nombre y sistema

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: CLI y MCP — el link de upgrade al chocar con un límite

**Files:**
- Modify: `electron/estado-de-sync-del-paquete.ts` (funciones nuevas al final)
- Modify: `electron/daemon-del-paquete.ts` (`depsDelDaemonDelPaquete`, objeto `deps`)
- Modify: `electron/sync-del-mcp.ts` (constructor y `encolar`)
- Modify: `electron/cli-del-paquete.ts` (`comandoStatus` después de la fila `Sync`; `comandoMcp`)
- Test: `electron/__tests__/estado-de-sync-del-paquete.test.ts`, `electron/__tests__/daemon-del-paquete.test.ts`, `electron/__tests__/sync-del-mcp.test.ts`

**Interfaces:**
- Consumes: `webDelPaquete`, `urlDeUpgrade` (Task 4); `MOTIVO_TOPE_DE_PROYECTOS` de `electron/memory-daemon.ts`; `MemoryDaemon.getStatus()` / `getStatusDetail()`; `MemoryStore.setSyncState`, `MemoryStore.blockedMutations()`.
- Produces (en `estado-de-sync-del-paquete.ts`):
  - `export type MotivoDeUpgrade = 'plan_required' | 'project_limit_reached' | 'device_limit_reached'`
  - `export const MAQUINAS_POR_PLAN = { free: 3, cloud: 10 } as const`
  - `export const PRECIO_CLOUD_MENSUAL = 15`
  - `export function errorDeCuentaDelDaemon(status: string, detalle?: string): 'plan_required' | 'device_limit_reached' | null`
  - `export function motivoDeUpgrade(e: { ultimoError: string | null; bloqueadasPorTope: number }): MotivoDeUpgrade | null`
  - `export function lineaDeUpgrade(motivo: MotivoDeUpgrade, urlUpgrade: string): string`
  - `export interface LectorSql { prepare(sql: string): { get(...p: unknown[]): unknown } }`
  - `export function leerDatosDeUpgrade(db: LectorSql): { ultimoError: string | null; bloqueadasPorTope: number }`
  - `SyncDelMcp` acepta un tercer argumento opcional `alTerminar?: () => void`.

**Por qué persistir:** `plan_required` y `device_limit` hoy viven sólo en memoria del daemon (`setStatus`), y `status` no toca la red. El hook `onStatusChange` del daemon del paquete los escribe en `sync_state['__account__'].last_error`; el daemon ya lo pone en `null` en cada push o pull exitoso, así que el aviso se borra solo cuando el problema se va. `project_limit_reached` ya queda en `mutation_log.blocked_reason`. **"El resumen del MCP" no existe**: el MCP no tiene una salida de estado. Se imprime por stderr (el log del servidor MCP en el editor), una vez por motivo y por sesión; stdout es el protocolo y no se toca.

- [ ] **Step 1: Escribir los tests que fallan (estado)**

Agregar a `electron/__tests__/estado-de-sync-del-paquete.test.ts` (y ampliar el import):

```ts
import { readFileSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryStore } from '../memory-store'
import { abrirSoloLecturaConBetterSqlite3 } from '../sqlite-better'
import { MOTIVO_TOPE_DE_PROYECTOS } from '../memory-daemon'
import {
  lineaDeUpgrade, motivoDeUpgrade, errorDeCuentaDelDaemon, leerDatosDeUpgrade,
  MAQUINAS_POR_PLAN, PRECIO_CLOUD_MENSUAL,
} from '../estado-de-sync-del-paquete'

const URL_UP = 'https://nestmux.com/upgrade'

describe('lineaDeUpgrade (spec login sin Nest §2)', () => {
  it('plan_required y project_limit_reached: el texto del spec con el link', () => {
    const esperado = 'Upgrade to Cloud ($15/mo) to sync every project: https://nestmux.com/upgrade'
    expect(lineaDeUpgrade('plan_required', URL_UP)).toBe(esperado)
    expect(lineaDeUpgrade('project_limit_reached', URL_UP)).toBe(esperado)
  })

  it('device_limit_reached dice cuántas máquinas permite cada plan y apunta al mismo link', () => {
    const linea = lineaDeUpgrade('device_limit_reached', URL_UP)
    expect(linea).toMatch(/Free: 3, Cloud: 10/)
    expect(linea).toMatch(/https:\/\/nestmux\.com\/upgrade$/)
  })

  it('los números espejan al servidor y al precio de la app', () => {
    const limites = readFileSync(join(__dirname, '../../server/src/limits.ts'), 'utf8')
    expect(Number(/const FREE[\s\S]*?maxDevices:\s*(\d+)/.exec(limites)![1])).toBe(MAQUINAS_POR_PLAN.free)
    expect(Number(/const CLOUD[\s\S]*?maxDevices:\s*(\d+)/.exec(limites)![1])).toBe(MAQUINAS_POR_PLAN.cloud)
    const stripe = readFileSync(join(__dirname, '../../src/lib/stripe.ts'), 'utf8')
    expect(Number(/CLOUD_MONTHLY_PRICE\s*=\s*(\d+)/.exec(stripe)![1])).toBe(PRECIO_CLOUD_MENSUAL)
  })
})

describe('motivoDeUpgrade', () => {
  it('lo que guardó el daemon gana; si no, lo retenido por el tope de proyectos', () => {
    expect(motivoDeUpgrade({ ultimoError: 'plan_required', bloqueadasPorTope: 0 })).toBe('plan_required')
    expect(motivoDeUpgrade({ ultimoError: 'device_limit_reached', bloqueadasPorTope: 2 })).toBe('device_limit_reached')
    expect(motivoDeUpgrade({ ultimoError: null, bloqueadasPorTope: 2 })).toBe('project_limit_reached')
    expect(motivoDeUpgrade({ ultimoError: 'fetch failed', bloqueadasPorTope: 0 })).toBeNull()
  })

  it('el estado del daemon que se persiste', () => {
    expect(errorDeCuentaDelDaemon('plan_required')).toBe('plan_required')
    expect(errorDeCuentaDelDaemon('error', 'device_limit')).toBe('device_limit_reached')
    expect(errorDeCuentaDelDaemon('error', 'not_in_beta')).toBeNull()
    expect(errorDeCuentaDelDaemon('idle')).toBeNull()
  })
})

describe('leerDatosDeUpgrade', () => {
  it('lee el error de cuenta y cuenta lo retenido por el tope', () => {
    const dir = makeTmpDir('nest-upgrade-')
    const dbPath = join(dir, 'memory.db')
    const store = new MemoryStore(dbPath)
    try {
      store.setSyncState('__account__', { lastError: 'plan_required' })
      const db = abrirSoloLecturaConBetterSqlite3(dbPath)
      try {
        expect(leerDatosDeUpgrade(db)).toEqual({ ultimoError: 'plan_required', bloqueadasPorTope: 0 })
      } finally { db.close() }
    } finally { store.close(); cleanupTmp(dir) }
  })

  it('una base sin las tablas devuelve nada que avisar, no lanza', () => {
    const roto = { prepare: () => { throw new Error('no such table') } }
    expect(leerDatosDeUpgrade(roto)).toEqual({ ultimoError: null, bloqueadasPorTope: 0 })
  })

  it('el motivo del tope es el mismo literal que usa el daemon', () => {
    expect(MOTIVO_TOPE_DE_PROYECTOS).toBe('project_limit_reached')
  })
})
```

(`BaseSqlite` tiene `close()`; si el tipo no lo expone, cerrar con `(db as { close(): void }).close()`.)

- [ ] **Step 2: Escribir los tests que fallan (daemon y MCP)**

En `electron/__tests__/daemon-del-paquete.test.ts`, dentro de `describe('depsDelDaemonDelPaquete', …)` (sumar `import { abrirSoloLecturaConBetterSqlite3 } from '../sqlite-better'` y `import { leerDatosDeUpgrade } from '../estado-de-sync-del-paquete'`):

```ts
  it('guarda plan_required y device_limit para que `status` los vea sin red', () => {
    const { deps } = armar()
    const leer = () => {
      const db = abrirSoloLecturaConBetterSqlite3(dbPath)
      try { return leerDatosDeUpgrade(db).ultimoError } finally { (db as { close(): void }).close() }
    }
    deps.onStatusChange!('plan_required')
    expect(leer()).toBe('plan_required')
    deps.onStatusChange!('error', 'device_limit')
    expect(leer()).toBe('device_limit_reached')
    // Otros estados no pisan lo guardado: lo borra el daemon al sincronizar bien.
    deps.onStatusChange!('syncing')
    expect(leer()).toBe('device_limit_reached')
  })
```

En `electron/__tests__/sync-del-mcp.test.ts`, dentro de `describe('SyncDelMcp', …)`:

```ts
  it('avisa al terminar cada operación, después de soltar el candado', async () => {
    const { s, orden } = falso()
    const sync = new SyncDelMcp(s, true, () => { orden.push('aviso') })
    sync.alArrancar()
    sync.trasEscribir()
    await sync.enCurso()
    expect(orden).toEqual(['pull', 'stop', 'aviso', 'push', 'stop', 'aviso'])
  })

  it('un aviso que tira no rompe la fila', async () => {
    const { s } = falso()
    const sync = new SyncDelMcp(s, true, () => { throw new Error('boom') })
    sync.trasEscribir()
    await sync.enCurso()
    sync.trasEscribir()
    await sync.enCurso()
    expect(s.push).toHaveBeenCalledTimes(2)
  })
```

- [ ] **Step 3: Correr y verificar que fallan**

Run: `npx vitest run electron/__tests__/estado-de-sync-del-paquete.test.ts electron/__tests__/daemon-del-paquete.test.ts electron/__tests__/sync-del-mcp.test.ts`
Expected: FAIL — `lineaDeUpgrade is not a function`, `deps.onStatusChange is not a function`, el orden no incluye `'aviso'`.

- [ ] **Step 4: Implementar en `estado-de-sync-del-paquete.ts`**

Agregar al final:

```ts
// ── Upgrade (spec 2026-11-02-login-y-compra-sin-nest §2) ─────────────────────────────

export type MotivoDeUpgrade = 'plan_required' | 'project_limit_reached' | 'device_limit_reached'

/**
 * Espejo, sólo para el copy, del tope de máquinas de `server/src/limits.ts`. Un test lee ese
 * archivo como texto y falla si se separan. El cliente no sabe el plan cuando choca con el
 * tope (el status también contesta 403), por eso el texto nombra los dos.
 */
export const MAQUINAS_POR_PLAN = { free: 3, cloud: 10 } as const

/** Espejo de `CLOUD_MONTHLY_PRICE` (`src/lib/stripe.ts`); mismo test. */
export const PRECIO_CLOUD_MENSUAL = 15

/** Lo que del estado del daemon vale guardar para que `status` lo cuente sin red. */
export function errorDeCuentaDelDaemon(status: string, detalle?: string): 'plan_required' | 'device_limit_reached' | null {
  if (status === 'plan_required') return 'plan_required'
  if (status === 'error' && detalle === 'device_limit') return 'device_limit_reached'
  return null
}

export function motivoDeUpgrade(e: { ultimoError: string | null; bloqueadasPorTope: number }): MotivoDeUpgrade | null {
  if (e.ultimoError === 'plan_required' || e.ultimoError === 'device_limit_reached') return e.ultimoError
  if (e.bloqueadasPorTope > 0) return 'project_limit_reached'
  return null
}

export function lineaDeUpgrade(motivo: MotivoDeUpgrade, urlUpgrade: string): string {
  if (motivo === 'device_limit_reached') {
    return `This account already syncs the most machines its plan allows ` +
      `(Free: ${MAQUINAS_POR_PLAN.free}, Cloud: ${MAQUINAS_POR_PLAN.cloud}). ` +
      `Upgrade to Cloud ($${PRECIO_CLOUD_MENSUAL}/mo) for up to ${MAQUINAS_POR_PLAN.cloud}: ${urlUpgrade}`
  }
  return `Upgrade to Cloud ($${PRECIO_CLOUD_MENSUAL}/mo) to sync every project: ${urlUpgrade}`
}

/** Lo mínimo de una base que hace falta para leer: lo cumplen `node:sqlite` y better-sqlite3. */
export interface LectorSql {
  prepare(sql: string): { get(...p: unknown[]): unknown }
}

/**
 * De la base: el error de cuenta que guardó el daemon y cuántas escrituras retiene el tope de
 * proyectos. Una base vieja sin alguna de las tablas no tiene nada que avisar — nunca lanza.
 * `'project_limit_reached'` es `MOTIVO_TOPE_DE_PROYECTOS` del daemon (no se importa: este
 * archivo no carga el daemon entero); un test los compara.
 */
export function leerDatosDeUpgrade(db: LectorSql): { ultimoError: string | null; bloqueadasPorTope: number } {
  let ultimoError: string | null = null
  try {
    const fila = db.prepare("SELECT last_error FROM sync_state WHERE partition_key = '__account__'").get() as
      | { last_error?: string | null } | undefined
    ultimoError = fila?.last_error ?? null
  } catch { /* sin `sync_state` todavía */ }
  let bloqueadasPorTope = 0
  try {
    const fila = db.prepare(
      "SELECT COUNT(*) AS c FROM mutation_log WHERE pushed_at IS NULL AND blocked_reason = 'project_limit_reached'"
    ).get() as { c?: number } | undefined
    bloqueadasPorTope = fila?.c ?? 0
  } catch { /* sin `mutation_log` todavía */ }
  return { ultimoError, bloqueadasPorTope }
}
```

- [ ] **Step 5: Persistir en `daemon-del-paquete.ts`**

Sumar `import { errorDeCuentaDelDaemon } from './estado-de-sync-del-paquete'` y, dentro del objeto `deps` de `depsDelDaemonDelPaquete`, antes del spread de `fetchImpl`:

```ts
    // `status` no toca la red: lo que el daemon aprendió de un 403 (plan o tope de máquinas)
    // queda en la base para que lo cuente. El daemon mismo lo vuelve a `null` en el próximo
    // push o pull exitoso, así que el aviso se va solo cuando el problema se va.
    onStatusChange: (status, detalle) => {
      const error = errorDeCuentaDelDaemon(status, detalle)
      if (error) e.store.setSyncState('__account__', { lastError: error })
    },
```

- [ ] **Step 6: `alTerminar` en `sync-del-mcp.ts`**

Reemplazar el constructor:

```ts
  constructor(
    private readonly s: SincronizadorSoltable,
    private readonly hayCuenta: boolean,
    /** Corre después de cada operación (y de soltar el candado): el MCP lo usa para avisar de un límite. */
    private readonly alTerminar?: () => void,
  ) {}
```

y el `finally` de `encolar`:

```ts
      } finally {
        this.s.stop()
        try {
          this.alTerminar?.()
        } catch {
          // Un aviso que falla no puede romper la fila de sincronización.
        }
      }
```

- [ ] **Step 7: `status` y `mcp` en `cli-del-paquete.ts`**

Ampliar imports:

```ts
import { lineaDeSync, lineaDeEquipoRetenido, lineaDeUpgrade, motivoDeUpgrade, leerDatosDeUpgrade, errorDeCuentaDelDaemon, type MotivoDeUpgrade } from './estado-de-sync-del-paquete'
import { TEAM_KEY_HOLD_REASONS, MOTIVO_TOPE_DE_PROYECTOS } from './memory-daemon'
```

(y sumar `urlDeUpgrade` al import de `./vinculacion-web-del-paquete` de Task 4).

En `comandoStatus`, inmediatamente después del `console.log(fila(marcaDeSync, 'Sync', …))`:

```ts
    if (base.modo === 'propia' && hayCredencial) {
      const motivo = motivoDeUpgrade(leerDatosDeUpgrade(db))
      if (motivo) {
        console.log(fila(marcas.aviso(e), 'Upgrade', lineaDeUpgrade(motivo, urlDeUpgrade(webDelPaquete(process.env.NEST_MEMORY_WEB_URL)))))
      }
    }
```

En `comandoMcp`, reemplazar `const sync = new SyncDelMcp(daemon, hayCuenta)` por:

```ts
    // Un aviso por motivo y por sesión, por stderr: stdout es el protocolo, y repetirlo en
    // cada escritura llenaría el log del editor.
    const avisados = new Set<MotivoDeUpgrade>()
    const sync = new SyncDelMcp(daemon, hayCuenta, () => {
      const motivo = motivoDeUpgrade({
        ultimoError: errorDeCuentaDelDaemon(daemon.getStatus(), daemon.getStatusDetail()),
        bloqueadasPorTope: store.blockedMutations().filter((m) => m.blocked_reason === MOTIVO_TOPE_DE_PROYECTOS).length,
      })
      if (!motivo || avisados.has(motivo)) return
      avisados.add(motivo)
      console.error(`[nest-memory] ${lineaDeUpgrade(motivo, urlDeUpgrade(webDelPaquete(process.env.NEST_MEMORY_WEB_URL)))}`)
    })
```

- [ ] **Step 8: Correr tests, typecheck y build del paquete**

Run: `npx vitest run electron/__tests__/estado-de-sync-del-paquete.test.ts electron/__tests__/daemon-del-paquete.test.ts electron/__tests__/sync-del-mcp.test.ts electron/__tests__/paquete-sin-nativas.test.ts; npx tsc -p tsconfig.node.json --noEmit --composite false; npm --prefix packages/nest-memory run build`
Expected: PASS, 0 errores, build sin errores.

- [ ] **Step 9: Commit**

```bash
git add electron/estado-de-sync-del-paquete.ts electron/daemon-del-paquete.ts electron/sync-del-mcp.ts electron/cli-del-paquete.ts electron/__tests__/estado-de-sync-del-paquete.test.ts electron/__tests__/daemon-del-paquete.test.ts electron/__tests__/sync-del-mcp.test.ts
git commit -m "$(cat <<'EOF'
feat(paquete): status y el MCP imprimen el link de upgrade al chocar con un límite

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `stripe-checkout` — `from` opcional en las URLs de vuelta

**Files:**
- Modify: `supabase/functions/stripe-checkout/checkout.ts` (`decidirCheckout`)
- Test: `supabase/functions/stripe-checkout/__tests__/checkout.test.ts`

**Interfaces:**
- Produces: el cuerpo de `stripe-checkout` acepta `from?: 'link' | 'upgrade'`. Con `from` válido: `success_url = 'https://nestmux.com/checkout/success?from=<from>'` y `cancel_url = 'https://nestmux.com/checkout/cancelled?from=<from>'`. Sin `from` (Nest) o con cualquier otro valor: URLs sin cambios. `export type OrigenDelPago = 'link' | 'upgrade'`.

**Por qué acá:** `success_url` está fija en la edge function; sin esto la página de vuelta no puede saber que el pago vino de `/link` o `/upgrade` (spec §4, parámetro `from`). Es una lista cerrada: el cliente no elige la URL, sólo un sufijo de dos valores. Requiere redeploy de la función (runbook, Task 10).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar dentro de `describe('decidirCheckout', …)`:

```ts
  it('from=link|upgrade viaja como ?from= en las dos URLs de vuelta', () => {
    for (const from of ['link', 'upgrade'] as const) {
      const d = base({ body: { interval: 'monthly', from } })
      expect(d.ok).toBe(true)
      if (!d.ok) return
      expect(d.sesion.success_url).toBe(`${URL_EXITO}?from=${from}`)
      expect(d.sesion.cancel_url).toBe(`${URL_CANCELADO}?from=${from}`)
    }
  })

  it('cualquier otro from se ignora: el cliente no arma la URL de vuelta', () => {
    for (const from of ['https://evil.example', 'link&x=1', 1, null]) {
      const d = base({ body: { interval: 'annual', from } })
      expect(d.ok && d.sesion.success_url).toBe(URL_EXITO)
      expect(d.ok && d.sesion.cancel_url).toBe(URL_CANCELADO)
    }
  })
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run supabase/functions/stripe-checkout/__tests__/checkout.test.ts`
Expected: FAIL — `success_url` sin `?from=link`.

- [ ] **Step 3: Implementar**

En `checkout.ts`, debajo de `leerIntervalo`:

```ts
/** De dónde vino el pago, para que la página de vuelta ofrezca volver a la terminal (spec login sin Nest §4). */
export type OrigenDelPago = 'link' | 'upgrade'

function leerOrigen(body: unknown): OrigenDelPago | null {
  if (!body || typeof body !== 'object') return null
  const f = (body as { from?: unknown }).from
  return f === 'link' || f === 'upgrade' ? f : null
}
```

En `decidirCheckout`, antes de armar `sesion`:

```ts
  // Lista cerrada de dos valores: el cliente marca de dónde vino, nunca elige la URL.
  const origen = leerOrigen(e.body)
  const sufijo = origen ? `?from=${origen}` : ''
```

y en el objeto `sesion`: `success_url: \`${URL_EXITO}${sufijo}\`,` y `cancel_url: \`${URL_CANCELADO}${sufijo}\`,`.

- [ ] **Step 4: Correr el test**

Run: `npx vitest run supabase/functions/stripe-checkout/__tests__/checkout.test.ts supabase/functions/stripe-portal`
Expected: PASS (el test viejo de URLs sin `from` sigue verde).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/stripe-checkout/checkout.ts supabase/functions/stripe-checkout/__tests__/checkout.test.ts
git commit -m "$(cat <<'EOF'
feat(checkout): from=link|upgrade vuelve como ?from= en las URLs de Stripe

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: pagina-nest — worktree, vitest y la máquina de estados pura

**Files (todo en `C:\Users\gerod\Dev\pagina-nest-link`):**
- Modify: `package.json` (script `test`, devDependency `vitest`)
- Create: `vitest.config.ts`
- Create: `src/lib/link/codigo.ts`, `src/lib/link/flujo.ts`
- Test: `src/lib/link/codigo.test.ts`, `src/lib/link/flujo.test.ts`

**Interfaces:**
- Produces (`src/lib/link/codigo.ts`):
  - `export const LOGIN_COMMAND = 'npx @nestmux/memory login'`
  - `export const CLAVE_DEL_CODIGO_PENDIENTE = 'nest:link-code'`
  - `export type CodigoNormalizado = { ok: true; codigo: string } | { ok: false; motivo: 'incompleto' | 'largo' | 'simbolo' }`
  - `export function normalizarCodigo(texto: string): CodigoNormalizado`
  - `export function codigoDeLaUrl(search: string): string | null`
  - `export function copyDeError(codigo: string): string`
- Produces (`src/lib/link/flujo.ts`):
  - `export type Modo = 'link' | 'upgrade'`
  - `export type Elegibilidad = 'ok' | 'not_in_beta' | 'plan_required' | 'device_limit_reached'`
  - `export interface Pedido { deviceName: string | null; platform: string | null; ageSeconds: number; expiresIn: number; eligibility: Elegibilidad }`
  - `export type Estado` y `export type Evento` (abajo)
  - `export function estadoInicial(codigo: string | null): Estado`
  - `export function siguienteEstado(modo: Modo, estado: Estado, evento: Evento): Estado`
  - `export function haceCuanto(segundos: number): string`
  - `export function nombreDeSistema(platform: string | null): string`
  - `export function urlDeVuelta(origen: string, modo: Modo, codigo: string | null): string`
  - `export function textoDelPlan(plan: string | null): { titulo: string; ofrecerUpgrade: boolean; ofrecerPortal: boolean }`

- [ ] **Step 1: Crear el worktree desde la rama del PR #10**

El `fetch` del clon sólo trae `master` (refspec), así que la rama del PR se pide explícitamente:

```bash
git -C C:/Users/gerod/Dev/pagina-nest fetch origin feat/checkout-pages:refs/remotes/origin/feat/checkout-pages
git -C C:/Users/gerod/Dev/pagina-nest worktree add -b feat/link-page C:/Users/gerod/Dev/pagina-nest-link origin/feat/checkout-pages
cd C:/Users/gerod/Dev/pagina-nest-link && npm ci
```

Expected: `git -C C:/Users/gerod/Dev/pagina-nest-link log --oneline -1` muestra `118d287` (o el head actual del PR #10) y existe `src/pages/checkout/success.astro`.

- [ ] **Step 2: Agregar vitest**

```bash
cd C:/Users/gerod/Dev/pagina-nest-link && npm install -D vitest@^4.1.5
```

En `package.json`, dentro de `"scripts"`, sumar `"test": "vitest run"`.

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Sólo lógica pura (src/lib/**): sin Astro ni DOM. Las islas se prueban a mano (runbook).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 3: Escribir los tests que fallan (código)**

`src/lib/link/codigo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizarCodigo, codigoDeLaUrl, copyDeError, LOGIN_COMMAND } from "./codigo";

describe("normalizarCodigo", () => {
  it("perdona minúsculas, sin guión y espacios (Review Focus 1)", () => {
    expect(normalizarCodigo("wxyz1234")).toEqual({ ok: true, codigo: "WXYZ-1234" });
    expect(normalizarCodigo(" wxyz - 1234 ")).toEqual({ ok: true, codigo: "WXYZ-1234" });
  });

  it("a medio tipear es incompleto; de más, largo; con símbolos, simbolo", () => {
    expect(normalizarCodigo("")).toEqual({ ok: false, motivo: "incompleto" });
    expect(normalizarCodigo("WXY")).toEqual({ ok: false, motivo: "incompleto" });
    expect(normalizarCodigo("WXYZ12345")).toEqual({ ok: false, motivo: "largo" });
    expect(normalizarCodigo("WXYZ-12$4")).toEqual({ ok: false, motivo: "simbolo" });
  });
});

describe("codigoDeLaUrl", () => {
  it("lee ?code= en minúsculas y sin guión (Review Focus 1)", () => {
    expect(codigoDeLaUrl("?code=wxyz1234")).toBe("WXYZ-1234");
    expect(codigoDeLaUrl("?code=WXYZ+1234")).toBe("WXYZ-1234");
  });

  it("prefiere ?link_code=, que es como vuelve del OAuth (Review Focus 2)", () => {
    // Con flujo PKCE Supabase agrega su propio `code` (un UUID) a la URL de vuelta.
    expect(codigoDeLaUrl("?link_code=WXYZ-1234&code=0b9c3a52-8f0e-4d55-9a3e-7c1f2b6d4e11")).toBe("WXYZ-1234");
  });

  it("un `code` que no tiene forma de código no se toma por uno", () => {
    expect(codigoDeLaUrl("?code=0b9c3a52-8f0e-4d55-9a3e-7c1f2b6d4e11")).toBeNull();
    expect(codigoDeLaUrl("")).toBeNull();
  });
});

describe("copyDeError", () => {
  it("los del flujo dicen qué pasó y cómo seguir", () => {
    expect(copyDeError("expired")).toContain(LOGIN_COMMAND);
    expect(copyDeError("unknown_code")).toContain(LOGIN_COMMAND);
    expect(copyDeError("already_approved")).toContain(LOGIN_COMMAND);
    expect(copyDeError("network_error")).toMatch(/Couldn't reach/);
  });

  it("uno desconocido se muestra tal cual, como LinkDeviceCard", () => {
    expect(copyDeError("team_encryption_required")).toBe("The sync service refused the code: team_encryption_required");
  });
});
```

- [ ] **Step 4: Escribir los tests que fallan (flujo)**

`src/lib/link/flujo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  estadoInicial, siguienteEstado, haceCuanto, nombreDeSistema, urlDeVuelta, textoDelPlan,
  type Estado, type Evento, type Modo, type Pedido,
} from "./flujo";

const pedido = (o: Partial<Pedido> = {}): Pedido => ({
  deviceName: "build-box", platform: "linux", ageSeconds: 30, expiresIn: 570, eligibility: "ok", ...o,
});

/** Aplica una lista de eventos desde el estado inicial. */
function correr(modo: Modo, codigo: string | null, eventos: Evento[]): Estado {
  return eventos.reduce((e, ev) => siguienteEstado(modo, e, ev), estadoInicial(codigo));
}

describe("siguienteEstado — /link", () => {
  it("sin sesión pide login conservando el código; con sesión chequea", () => {
    expect(correr("link", "WXYZ-1234", [{ tipo: "sesion", haySesion: false }]))
      .toEqual({ tipo: "sign-in", codigo: "WXYZ-1234" });
    expect(correr("link", "WXYZ-1234", [{ tipo: "sesion", haySesion: false }, { tipo: "sesion", haySesion: true }]))
      .toEqual({ tipo: "chequeando", codigo: "WXYZ-1234" });
  });

  it("sin código lo pide a mano después del login", () => {
    const e = correr("link", null, [{ tipo: "sesion", haySesion: true }]);
    expect(e).toEqual({ tipo: "pedir-codigo" });
    expect(siguienteEstado("link", e, { tipo: "codigo-tipeado", codigo: "WXYZ-1234" }))
      .toEqual({ tipo: "chequeando", codigo: "WXYZ-1234" });
  });

  it("el camino feliz: chequeo, aprobar, listo", () => {
    const e = correr("link", "WXYZ-1234", [
      { tipo: "sesion", haySesion: true },
      { tipo: "chequeo-ok", pedido: pedido() },
      { tipo: "aprobar" },
      { tipo: "aprobacion-ok" },
    ]);
    expect(e).toEqual({ tipo: "listo" });
  });

  it("refrescos de sesión mientras confirma no vuelven a chequear", () => {
    // onAuthStateChange dispara SIGNED_IN / TOKEN_REFRESHED al volver a la pestaña.
    const confirmando = correr("link", "WXYZ-1234", [{ tipo: "sesion", haySesion: true }, { tipo: "chequeo-ok", pedido: pedido() }]);
    expect(siguienteEstado("link", confirmando, { tipo: "sesion", haySesion: true })).toBe(confirmando);
  });

  it("no deja aprobar si la cuenta no entra", () => {
    for (const eligibility of ["not_in_beta", "plan_required", "device_limit_reached"] as const) {
      const e = correr("link", "WXYZ-1234", [{ tipo: "sesion", haySesion: true }, { tipo: "chequeo-ok", pedido: pedido({ eligibility }) }]);
      expect(siguienteEstado("link", e, { tipo: "aprobar" })).toBe(e);
    }
  });

  it("después de pagar se vuelve a chequear", () => {
    const e = correr("link", "WXYZ-1234", [
      { tipo: "sesion", haySesion: true },
      { tipo: "chequeo-ok", pedido: pedido({ eligibility: "not_in_beta" }) },
      { tipo: "chequear-de-nuevo" },
    ]);
    expect(e).toEqual({ tipo: "chequeando", codigo: "WXYZ-1234" });
  });

  it("el código vence en la pantalla de confirmar (Review Focus 3)", () => {
    const e = correr("link", "WXYZ-1234", [
      { tipo: "sesion", haySesion: true },
      { tipo: "chequeo-ok", pedido: pedido() },
      { tipo: "vencio" },
    ]);
    expect(e).toEqual({ tipo: "error", error: "expired" });
  });

  it("approve que vuelve expired termina en el mismo error (Review Focus 3)", () => {
    const e = correr("link", "WXYZ-1234", [
      { tipo: "sesion", haySesion: true },
      { tipo: "chequeo-ok", pedido: pedido() },
      { tipo: "aprobar" },
      { tipo: "aprobacion-fallo", error: "expired" },
    ]);
    expect(e).toEqual({ tipo: "error", error: "expired" });
  });

  it("vencer con la aprobación en vuelo no corta: decide el servidor", () => {
    const aprobando = correr("link", "WXYZ-1234", [{ tipo: "sesion", haySesion: true }, { tipo: "chequeo-ok", pedido: pedido() }, { tipo: "aprobar" }]);
    expect(siguienteEstado("link", aprobando, { tipo: "vencio" })).toBe(aprobando);
  });

  it("un 401 del servicio vuelve al login sin perder el código", () => {
    const e = correr("link", "WXYZ-1234", [{ tipo: "sesion", haySesion: true }, { tipo: "chequeo-fallo", error: "unauthorized" }]);
    expect(e).toEqual({ tipo: "sign-in", codigo: "WXYZ-1234" });
  });

  it("los errores del chequeo van a la pantalla de error", () => {
    for (const error of ["unknown_code", "expired", "already_approved", "network_error"]) {
      const e = correr("link", "WXYZ-1234", [{ tipo: "sesion", haySesion: true }, { tipo: "chequeo-fallo", error }]);
      expect(e).toEqual({ tipo: "error", error });
    }
  });

  it("cerrar sesión en otra pestaña vuelve al login; en listo no", () => {
    const confirmando = correr("link", "WXYZ-1234", [{ tipo: "sesion", haySesion: true }, { tipo: "chequeo-ok", pedido: pedido() }]);
    expect(siguienteEstado("link", confirmando, { tipo: "sesion", haySesion: false })).toEqual({ tipo: "sign-in", codigo: "WXYZ-1234" });
    expect(siguienteEstado("link", { tipo: "listo" }, { tipo: "sesion", haySesion: false })).toEqual({ tipo: "listo" });
  });

  it("cancelar no aprueba nada", () => {
    const e = correr("link", "WXYZ-1234", [{ tipo: "sesion", haySesion: true }, { tipo: "chequeo-ok", pedido: pedido() }, { tipo: "cancelar" }]);
    expect(e).toEqual({ tipo: "cancelado" });
  });
});

describe("siguienteEstado — /upgrade", () => {
  it("después del login va a la tarjeta de plan, aunque haya un ?code=", () => {
    expect(correr("upgrade", null, [{ tipo: "sesion", haySesion: true }])).toEqual({ tipo: "plan" });
    expect(correr("upgrade", "WXYZ-1234", [{ tipo: "sesion", haySesion: true }])).toEqual({ tipo: "plan" });
  });
});

describe("helpers", () => {
  it("haceCuanto", () => {
    expect(haceCuanto(20)).toBe("requested just now");
    expect(haceCuanto(65)).toBe("requested 1 minute ago");
    expect(haceCuanto(300)).toBe("requested 5 minutes ago");
  });

  it("nombreDeSistema", () => {
    expect(nombreDeSistema("win32")).toBe("Windows");
    expect(nombreDeSistema("darwin")).toBe("macOS");
    expect(nombreDeSistema("linux")).toBe("Linux");
    expect(nombreDeSistema(null)).toBe("Unknown system");
  });

  it("urlDeVuelta usa link_code para sobrevivir al OAuth (Review Focus 2)", () => {
    expect(urlDeVuelta("https://nestmux.com", "link", "WXYZ-1234")).toBe("https://nestmux.com/link?link_code=WXYZ-1234");
    expect(urlDeVuelta("https://nestmux.com", "link", null)).toBe("https://nestmux.com/link");
    expect(urlDeVuelta("http://localhost:4321", "upgrade", "WXYZ-1234")).toBe("http://localhost:4321/upgrade");
  });

  it("textoDelPlan: Free ofrece upgrade; Cloud, el portal", () => {
    expect(textoDelPlan("free")).toEqual({ titulo: "You're on Free — 1 cloud project.", ofrecerUpgrade: true, ofrecerPortal: false });
    expect(textoDelPlan(null)).toEqual(textoDelPlan("free"));
    expect(textoDelPlan("cloud")).toEqual({ titulo: "You're on Cloud.", ofrecerUpgrade: false, ofrecerPortal: true });
    expect(textoDelPlan("pro")).toEqual(textoDelPlan("cloud"));
    expect(textoDelPlan("team")).toEqual({ titulo: "You're on Team.", ofrecerUpgrade: false, ofrecerPortal: false });
    expect(textoDelPlan("enterprise")).toEqual({ titulo: "You're on Enterprise.", ofrecerUpgrade: false, ofrecerPortal: false });
  });
});
```

- [ ] **Step 5: Correr y verificar que fallan**

Run: `cd C:/Users/gerod/Dev/pagina-nest-link && npm test`
Expected: FAIL — `Failed to resolve import "./codigo"` / `"./flujo"`.

- [ ] **Step 6: Implementar `src/lib/link/codigo.ts`**

```ts
// The code someone reads in a terminal and approves here. Mirrors `src/lib/codigo-de-vinculacion.ts`
// in raven-nest: it checks the SHAPE (8 alphanumerics) and never the server's alphabet, so a
// server change can't make this page reject valid codes.

export const LOGIN_COMMAND = "npx @nestmux/memory login";

/** Where the page keeps an UNAPPROVED code while the person is in Stripe Checkout. */
export const CLAVE_DEL_CODIGO_PENDIENTE = "nest:link-code";

const LARGO = 8;

export type CodigoNormalizado =
  | { ok: true; codigo: string }
  | { ok: false; motivo: "incompleto" | "largo" | "simbolo" };

export function normalizarCodigo(texto: string): CodigoNormalizado {
  const limpio = texto.replace(/[\s-]/g, "").toUpperCase();
  if (limpio === "") return { ok: false, motivo: "incompleto" };
  if (!/^[A-Z0-9]*$/.test(limpio)) return { ok: false, motivo: "simbolo" };
  if (limpio.length < LARGO) return { ok: false, motivo: "incompleto" };
  if (limpio.length > LARGO) return { ok: false, motivo: "largo" };
  return { ok: true, codigo: `${limpio.slice(0, 4)}-${limpio.slice(4)}` };
}

/**
 * The link code from the URL. `link_code` first: it's what our OAuth `redirectTo` uses,
 * because with PKCE Supabase appends its own `code` (a UUID) to the return URL. A `code`
 * that doesn't have the shape of a link code is ignored instead of being sent to the server.
 */
export function codigoDeLaUrl(search: string): string | null {
  const params = new URLSearchParams(search);
  for (const clave of ["link_code", "code"]) {
    const valor = params.get(clave);
    if (!valor) continue;
    const n = normalizarCodigo(valor);
    if (n.ok) return n.codigo;
  }
  return null;
}

/** What the services answer, said so a person can act on it. Unknown codes are shown as-is. */
export function copyDeError(codigo: string): string {
  switch (codigo) {
    case "unknown_code":
      return `That code doesn't exist or already expired. Run \`${LOGIN_COMMAND}\` again to get a new one.`;
    case "expired":
      return `That code expired — codes last 10 minutes. Run \`${LOGIN_COMMAND}\` again.`;
    case "already_approved":
      return `That code was already approved. If it was you, go back to your terminal. If not, run \`${LOGIN_COMMAND}\` again.`;
    case "unauthorized":
      return "Your session expired. Sign in again.";
    case "rate_limited":
      return "Too many attempts. Wait a few minutes and try again.";
    case "issuer_unavailable":
      return "The sync service can't verify sign-ins right now. This is on our side — try again in a few minutes.";
    case "network_error":
      return "Couldn't reach the Nest sync service. Check your connection and try again.";
    case "config_missing":
      return "This page isn't configured to sign in yet.";
    case "checkout_unavailable":
    case "stripe_error":
      return "Checkout isn't available right now. Try again in a few minutes.";
    case "no_subscription":
      return "There's no subscription to manage on this account.";
    case "unexpected_response":
      return "The sync service answered something this page doesn't understand. Try again, or update the CLI.";
    default:
      return `The sync service refused the code: ${codigo}`;
  }
}
```

- [ ] **Step 7: Implementar `src/lib/link/flujo.ts`**

```ts
// The /link and /upgrade flow as a pure state machine (spec login-y-compra-sin-nest §4).
// The island only runs effects (network, timers) and dispatches events; every decision is here.

export type Modo = "link" | "upgrade";
export type Elegibilidad = "ok" | "not_in_beta" | "plan_required" | "device_limit_reached";

export interface Pedido {
  deviceName: string | null;
  platform: string | null;
  /** Seconds since the CLI asked for the code, by the SERVER clock. */
  ageSeconds: number;
  /** Seconds left, by the SERVER clock (the browser's may be off). */
  expiresIn: number;
  eligibility: Elegibilidad;
}

export type Estado =
  | { tipo: "cargando"; codigo: string | null }
  | { tipo: "sign-in"; codigo: string | null }
  | { tipo: "pedir-codigo" }
  | { tipo: "chequeando"; codigo: string }
  | { tipo: "confirmar"; codigo: string; pedido: Pedido }
  | { tipo: "aprobando"; codigo: string; pedido: Pedido }
  | { tipo: "listo" }
  | { tipo: "plan" }
  | { tipo: "cancelado" }
  | { tipo: "error"; error: string };

export type Evento =
  | { tipo: "sesion"; haySesion: boolean }
  | { tipo: "codigo-tipeado"; codigo: string }
  | { tipo: "chequeo-ok"; pedido: Pedido }
  | { tipo: "chequeo-fallo"; error: string }
  | { tipo: "aprobar" }
  | { tipo: "aprobacion-ok" }
  | { tipo: "aprobacion-fallo"; error: string }
  | { tipo: "vencio" }
  | { tipo: "chequear-de-nuevo" }
  | { tipo: "cancelar" };

export function estadoInicial(codigo: string | null): Estado {
  return { tipo: "cargando", codigo };
}

function trasLaSesion(modo: Modo, codigo: string | null): Estado {
  if (modo === "upgrade") return { tipo: "plan" };
  return codigo ? { tipo: "chequeando", codigo } : { tipo: "pedir-codigo" };
}

function codigoDe(estado: Estado): string | null {
  return "codigo" in estado ? estado.codigo : null;
}

/** A 401 from a service means the session died: back to sign in, keeping the code. */
function falla(codigo: string, error: string): Estado {
  return error === "unauthorized" ? { tipo: "sign-in", codigo } : { tipo: "error", error };
}

export function siguienteEstado(modo: Modo, estado: Estado, evento: Evento): Estado {
  if (evento.tipo === "sesion" && !evento.haySesion) {
    if (estado.tipo === "listo" || estado.tipo === "cancelado" || estado.tipo === "error") return estado;
    return { tipo: "sign-in", codigo: codigoDe(estado) };
  }
  switch (estado.tipo) {
    case "cargando":
    case "sign-in":
      return evento.tipo === "sesion" ? trasLaSesion(modo, estado.codigo) : estado;
    case "pedir-codigo":
      return evento.tipo === "codigo-tipeado" ? { tipo: "chequeando", codigo: evento.codigo } : estado;
    case "chequeando":
      if (evento.tipo === "chequeo-ok") return { tipo: "confirmar", codigo: estado.codigo, pedido: evento.pedido };
      if (evento.tipo === "chequeo-fallo") return falla(estado.codigo, evento.error);
      return estado;
    case "confirmar":
      if (evento.tipo === "aprobar") {
        return estado.pedido.eligibility === "ok" ? { tipo: "aprobando", codigo: estado.codigo, pedido: estado.pedido } : estado;
      }
      if (evento.tipo === "vencio") return { tipo: "error", error: "expired" };
      if (evento.tipo === "chequear-de-nuevo") return { tipo: "chequeando", codigo: estado.codigo };
      if (evento.tipo === "cancelar") return { tipo: "cancelado" };
      return estado;
    case "aprobando":
      if (evento.tipo === "aprobacion-ok") return { tipo: "listo" };
      if (evento.tipo === "aprobacion-fallo") return falla(estado.codigo, evento.error);
      // `vencio` with the approval in flight: the server decides.
      return estado;
    default:
      return estado;
  }
}

export function haceCuanto(segundos: number): string {
  const minutos = Math.floor(segundos / 60);
  if (minutos < 1) return "requested just now";
  return `requested ${minutos} ${minutos === 1 ? "minute" : "minutes"} ago`;
}

export function nombreDeSistema(platform: string | null): string {
  switch (platform) {
    case "win32": return "Windows";
    case "darwin": return "macOS";
    case "linux": return "Linux";
    default: return "Unknown system";
  }
}

/** Where OAuth and email confirmation send the person back. `link_code`, never `code` (PKCE uses it). */
export function urlDeVuelta(origen: string, modo: Modo, codigo: string | null): string {
  if (modo === "upgrade") return `${origen}/upgrade`;
  return codigo ? `${origen}/link?link_code=${encodeURIComponent(codigo)}` : `${origen}/link`;
}

export function textoDelPlan(plan: string | null): { titulo: string; ofrecerUpgrade: boolean; ofrecerPortal: boolean } {
  switch (plan) {
    case "cloud":
    case "pro":
      return { titulo: "You're on Cloud.", ofrecerUpgrade: false, ofrecerPortal: true };
    case "team":
      return { titulo: "You're on Team.", ofrecerUpgrade: false, ofrecerPortal: false };
    case "enterprise":
      return { titulo: "You're on Enterprise.", ofrecerUpgrade: false, ofrecerPortal: false };
    default:
      return { titulo: "You're on Free — 1 cloud project.", ofrecerUpgrade: true, ofrecerPortal: false };
  }
}
```

- [ ] **Step 8: Correr los tests**

Run: `cd C:/Users/gerod/Dev/pagina-nest-link && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd C:/Users/gerod/Dev/pagina-nest-link
git add package.json package-lock.json vitest.config.ts src/lib/link/codigo.ts src/lib/link/flujo.ts src/lib/link/codigo.test.ts src/lib/link/flujo.test.ts
git commit -m "$(cat <<'EOF'
feat(link): vitest y la máquina de estados pura del flujo /link y /upgrade

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: pagina-nest — la isla `LinkFlow`, las páginas `/link` y `/upgrade`, checkout y sitemap

**Files (en `C:\Users\gerod\Dev\pagina-nest-link`):**
- Create: `src/lib/link/api.ts`, `src/lib/link/precios.ts`
- Create: `src/components/link/LinkFlow.tsx`
- Create: `src/pages/link.astro`, `src/pages/upgrade.astro`
- Modify: `astro.config.mjs` (`filter` del sitemap), `.env.example`
- Test: `src/lib/link/api.test.ts`

**Interfaces:**
- Consumes: todo `codigo.ts` y `flujo.ts` (Task 7); `getSupabaseClient()` de `src/lib/supabase.ts`; el contrato de `POST /v1/link/check` (Task 2) y `/v1/link/approve`; `stripe-checkout` con `{ interval, from }` (Task 6) y `stripe-portal`.
- Produces (`api.ts`):
  - `export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string }`
  - `export type Intervalo = 'monthly' | 'annual'`
  - `export function leerPedido(c: Record<string, unknown>): Resultado<Pedido>`
  - `export function chequearCodigo(baseSync: string, jwt: string, codigo: string, f?: typeof fetch): Promise<Resultado<Pedido>>`
  - `export function aprobarCodigo(baseSync: string, jwt: string, codigo: string, f?: typeof fetch): Promise<Resultado<true>>`
  - `export function abrirPortal(o: { supabaseUrl: string; anonKey: string; jwt: string }, f?: typeof fetch): Promise<Resultado<string>>`
  - `export function iniciarCompra(o: { supabaseUrl: string; anonKey: string; jwt: string; interval: Intervalo; from: Modo }, f?: typeof fetch): Promise<Resultado<string>>`
- Produces (`precios.ts`): `CLOUD_MONTHLY_PRICE = 15`, `CLOUD_ANNUAL_PRICE = 144`, `CLOUD_ANNUAL_MONTHLY_PRICE = 12`.
- Env nuevo: `PUBLIC_SYNC_BASE_URL` (default `https://sync.nestmux.com`).

- [ ] **Step 1: Escribir los tests que fallan**

`src/lib/link/api.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { chequearCodigo, aprobarCodigo, iniciarCompra, leerPedido } from "./api";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const CHECK_OK = {
  device_name: "build-box", platform: "linux",
  created_at: "2026-11-02T12:00:00.000Z", expires_at: "2026-11-02T12:10:00.000Z",
  expires_in: 420, eligibility: "ok",
};

describe("chequearCodigo", () => {
  it("manda el JWT y user_code, y calcula la edad con el reloj del servidor", async () => {
    const f = vi.fn(async () => json(200, CHECK_OK));
    const r = await chequearCodigo("https://sync.nestmux.com", "jwt-1", "WXYZ-1234", f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, valor: { deviceName: "build-box", platform: "linux", ageSeconds: 180, expiresIn: 420, eligibility: "ok" } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sync.nestmux.com/v1/link/check");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-1");
    expect(JSON.parse(String(init.body))).toEqual({ user_code: "WXYZ-1234" });
  });

  it("un error del servicio vuelve con su código", async () => {
    const f = vi.fn(async () => json(404, { error: "unknown_code" }));
    expect(await chequearCodigo("b", "j", "c", f as unknown as typeof fetch)).toEqual({ ok: false, error: "unknown_code" });
  });

  it("sin red (o CORS bloqueado) es network_error", async () => {
    const f = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    expect(await chequearCodigo("b", "j", "c", f as unknown as typeof fetch)).toEqual({ ok: false, error: "network_error" });
  });
});

describe("leerPedido", () => {
  it("una elegibilidad que no conoce no se toma por ok", () => {
    expect(leerPedido({ ...CHECK_OK, eligibility: "maybe" })).toEqual({ ok: false, error: "unexpected_response" });
    expect(leerPedido({ ...CHECK_OK, expires_in: "420" })).toEqual({ ok: false, error: "unexpected_response" });
  });
});

describe("aprobarCodigo", () => {
  it("ok sólo con 200", async () => {
    const ok = vi.fn(async () => json(200, { ok: true }));
    expect(await aprobarCodigo("b", "j", "WXYZ-1234", ok as unknown as typeof fetch)).toEqual({ ok: true, valor: true });
    const vencido = vi.fn(async () => json(400, { error: "expired" }));
    expect(await aprobarCodigo("b", "j", "WXYZ-1234", vencido as unknown as typeof fetch)).toEqual({ ok: false, error: "expired" });
  });
});

describe("iniciarCompra", () => {
  const base = { supabaseUrl: "https://x.supabase.co", anonKey: "anon", jwt: "jwt-1", interval: "monthly" as const, from: "link" as const };

  it("manda intervalo y from, y devuelve la url de Stripe", async () => {
    const f = vi.fn(async () => json(200, { url: "https://checkout.stripe.com/c/abc" }));
    expect(await iniciarCompra(base, f as unknown as typeof fetch)).toEqual({ ok: true, valor: "https://checkout.stripe.com/c/abc" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.supabase.co/functions/v1/stripe-checkout");
    expect((init.headers as Record<string, string>).apikey).toBe("anon");
    expect(JSON.parse(String(init.body))).toEqual({ interval: "monthly", from: "link" });
  });

  it("ya es Cloud: already_subscribed abre el portal, no un error (Review Focus 4)", async () => {
    const f = vi.fn(async (url: string) => url.endsWith("/stripe-checkout")
      ? json(409, { error: "already_subscribed" })
      : json(200, { url: "https://billing.stripe.com/p/session/xyz" }));
    expect(await iniciarCompra(base, f as unknown as typeof fetch)).toEqual({ ok: true, valor: "https://billing.stripe.com/p/session/xyz" });
    expect((f.mock.calls[1] as unknown as [string])[0]).toBe("https://x.supabase.co/functions/v1/stripe-portal");
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd C:/Users/gerod/Dev/pagina-nest-link && npm test`
Expected: FAIL — `Failed to resolve import "./api"`.

- [ ] **Step 3: Implementar `src/lib/link/precios.ts` y `src/lib/link/api.ts`**

`precios.ts`:

```ts
// Mirror of raven-nest `src/lib/stripe.ts`. Stripe price IDs live in the `stripe-checkout`
// secrets, never here: the page only shows numbers and sends an interval.
export const CLOUD_MONTHLY_PRICE = 15;
export const CLOUD_ANNUAL_PRICE = 144;
export const CLOUD_ANNUAL_MONTHLY_PRICE = 12;
```

`api.ts`:

```ts
// Network calls of the /link and /upgrade flow. `fetch` is injected so the tests run in Node.
import type { Elegibilidad, Modo, Pedido } from "./flujo";

export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string };
export type Intervalo = "monthly" | "annual";

type Fetch = typeof fetch;
// Called through a wrapper: some browsers throw "Illegal invocation" on a detached `fetch`.
const fetchPorDefecto: Fetch = (...a) => fetch(...a);

const ELEGIBILIDADES: readonly Elegibilidad[] = ["ok", "not_in_beta", "plan_required", "device_limit_reached"];

async function postJson(f: Fetch, url: string, headers: Record<string, string>, body: unknown) {
  try {
    const r = await f(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const cuerpo: unknown = await r.json().catch(() => ({}));
    return { status: r.status, cuerpo: (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown> };
  } catch {
    // Offline, DNS, or a CORS block: the browser shows all three the same way.
    return null;
  }
}

function errorDe(r: { status: number; cuerpo: Record<string, unknown> }): string {
  return typeof r.cuerpo.error === "string" ? r.cuerpo.error : `http_${r.status}`;
}

/** The `/v1/link/check` body. Age comes from server timestamps, so a skewed browser clock can't lie. */
export function leerPedido(c: Record<string, unknown>): Resultado<Pedido> {
  const creado = typeof c.created_at === "string" ? Date.parse(c.created_at) : NaN;
  const vence = typeof c.expires_at === "string" ? Date.parse(c.expires_at) : NaN;
  const eligibility = c.eligibility as Elegibilidad;
  if (Number.isNaN(creado) || Number.isNaN(vence) || typeof c.expires_in !== "number" || !ELEGIBILIDADES.includes(eligibility)) {
    return { ok: false, error: "unexpected_response" };
  }
  return {
    ok: true,
    valor: {
      deviceName: typeof c.device_name === "string" ? c.device_name : null,
      platform: typeof c.platform === "string" ? c.platform : null,
      ageSeconds: Math.max(0, Math.round((vence - creado) / 1000) - c.expires_in),
      expiresIn: c.expires_in,
      eligibility,
    },
  };
}

export async function chequearCodigo(baseSync: string, jwt: string, codigo: string, f: Fetch = fetchPorDefecto): Promise<Resultado<Pedido>> {
  const r = await postJson(f, `${baseSync}/v1/link/check`, { Authorization: `Bearer ${jwt}` }, { user_code: codigo });
  if (!r) return { ok: false, error: "network_error" };
  if (r.status !== 200) return { ok: false, error: errorDe(r) };
  return leerPedido(r.cuerpo);
}

export async function aprobarCodigo(baseSync: string, jwt: string, codigo: string, f: Fetch = fetchPorDefecto): Promise<Resultado<true>> {
  const r = await postJson(f, `${baseSync}/v1/link/approve`, { Authorization: `Bearer ${jwt}` }, { user_code: codigo });
  if (!r) return { ok: false, error: "network_error" };
  return r.status === 200 ? { ok: true, valor: true } : { ok: false, error: errorDe(r) };
}

export async function abrirPortal(o: { supabaseUrl: string; anonKey: string; jwt: string }, f: Fetch = fetchPorDefecto): Promise<Resultado<string>> {
  const r = await postJson(f, `${o.supabaseUrl}/functions/v1/stripe-portal`, { Authorization: `Bearer ${o.jwt}`, apikey: o.anonKey }, {});
  if (!r) return { ok: false, error: "network_error" };
  if (r.status === 200 && typeof r.cuerpo.url === "string") return { ok: true, valor: r.cuerpo.url };
  return { ok: false, error: errorDe(r) };
}

/** Stripe Checkout URL. Already subscribed (409) means "manage it", so it opens the portal instead. */
export async function iniciarCompra(
  o: { supabaseUrl: string; anonKey: string; jwt: string; interval: Intervalo; from: Modo },
  f: Fetch = fetchPorDefecto,
): Promise<Resultado<string>> {
  const r = await postJson(f, `${o.supabaseUrl}/functions/v1/stripe-checkout`, { Authorization: `Bearer ${o.jwt}`, apikey: o.anonKey }, { interval: o.interval, from: o.from });
  if (!r) return { ok: false, error: "network_error" };
  if (r.status === 200 && typeof r.cuerpo.url === "string") return { ok: true, valor: r.cuerpo.url };
  if (r.status === 409 && r.cuerpo.error === "already_subscribed") return abrirPortal(o, f);
  return { ok: false, error: errorDe(r) };
}
```

- [ ] **Step 4: Correr los tests**

Run: `cd C:/Users/gerod/Dev/pagina-nest-link && npm test`
Expected: PASS.

- [ ] **Step 5: La isla `src/components/link/LinkFlow.tsx`**

```tsx
// /link and /upgrade (spec login-y-compra-sin-nest §4-5). All decisions live in the pure
// `siguienteEstado`; this component runs the effects and renders. Mounted with `client:only`.
import { useEffect, useMemo, useReducer, useState, type FormEvent } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase";
import {
  estadoInicial, siguienteEstado, haceCuanto, nombreDeSistema, urlDeVuelta, textoDelPlan,
  type Estado, type Evento, type Modo, type Pedido,
} from "@/lib/link/flujo";
import { codigoDeLaUrl, normalizarCodigo, copyDeError, LOGIN_COMMAND, CLAVE_DEL_CODIGO_PENDIENTE } from "@/lib/link/codigo";
import { chequearCodigo, aprobarCodigo, iniciarCompra, abrirPortal, type Intervalo } from "@/lib/link/api";
import { CLOUD_MONTHLY_PRICE, CLOUD_ANNUAL_PRICE } from "@/lib/link/precios";

const BASE_SYNC = String(import.meta.env.PUBLIC_SYNC_BASE_URL || "https://sync.nestmux.com").replace(/\/+$/, "");
const SUPABASE_URL = String(import.meta.env.PUBLIC_SUPABASE_URL ?? "");
const SUPABASE_ANON = String(import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? "");

const SCOPES = { google: "openid email profile", github: "read:user user:email", gitlab: "read_user" } as const;
type Proveedor = keyof typeof SCOPES;

const boton = "inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none";
const primario = `${boton} bg-brand text-fg-inverse hover:bg-brand-hover`;
const secundario = `${boton} border border-line text-fg hover:border-brand/50 bg-layer-1/60`;
const tarjeta = "rounded-xl border border-line bg-layer-1/80 p-6 backdrop-blur";
const campo = "w-full rounded-lg border border-line bg-layer-0 px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-brand";

function guardarCodigoPendiente(codigo: string | null): void {
  try {
    if (codigo) sessionStorage.setItem(CLAVE_DEL_CODIGO_PENDIENTE, codigo);
    else sessionStorage.removeItem(CLAVE_DEL_CODIGO_PENDIENTE);
  } catch { /* no storage: the return page falls back to "back to your terminal" */ }
}

export default function LinkFlow({ modo }: { modo: Modo }) {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [estado, despachar] = useReducer(
    (e: Estado, ev: Evento) => siguienteEstado(modo, e, ev),
    null,
    () => estadoInicial(modo === "link" ? codigoDeLaUrl(window.location.search) : null),
  );
  const [sesion, setSesion] = useState<Session | null>(null);
  const jwt = sesion?.access_token ?? null;

  useEffect(() => {
    if (!supabase) return;
    let vivo = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      setSesion(data.session);
      despachar({ tipo: "sesion", haySesion: data.session !== null });
    });
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => {
      setSesion(s);
      despachar({ tipo: "sesion", haySesion: s !== null });
    });
    return () => { vivo = false; data.subscription.unsubscribe(); };
  }, [supabase]);

  useEffect(() => {
    if (estado.tipo !== "chequeando" || !jwt) return;
    let vivo = true;
    chequearCodigo(BASE_SYNC, jwt, estado.codigo).then((r) => {
      if (vivo) despachar(r.ok ? { tipo: "chequeo-ok", pedido: r.valor } : { tipo: "chequeo-fallo", error: r.error });
    });
    return () => { vivo = false; };
  }, [estado, jwt]);

  useEffect(() => {
    if (estado.tipo !== "aprobando" || !jwt) return;
    let vivo = true;
    aprobarCodigo(BASE_SYNC, jwt, estado.codigo).then((r) => {
      if (vivo) despachar(r.ok ? { tipo: "aprobacion-ok" } : { tipo: "aprobacion-fallo", error: r.error });
    });
    return () => { vivo = false; };
  }, [estado, jwt]);

  // Expiry by the server's own countdown (Review Focus 3): no Approve on a dead code.
  useEffect(() => {
    if (estado.tipo !== "confirmar") return;
    const t = window.setTimeout(() => despachar({ tipo: "vencio" }), estado.pedido.expiresIn * 1000);
    return () => window.clearTimeout(t);
  }, [estado]);

  // Approved: a code kept for the trip through Stripe has nothing left to finish.
  useEffect(() => {
    if (estado.tipo === "listo") guardarCodigoPendiente(null);
  }, [estado.tipo]);

  if (!supabase) return <Mensaje titulo="Something's missing" texto={copyDeError("config_missing")} />;

  const codigoActual = "codigo" in estado ? estado.codigo : null;

  switch (estado.tipo) {
    case "cargando":
      return <p className="text-center text-fg-muted">Loading…</p>;
    case "sign-in":
      return <SignIn supabase={supabase} modo={modo} volverA={urlDeVuelta(window.location.origin, modo, codigoActual)} />;
    case "pedir-codigo":
      return <PedirCodigo onListo={(codigo) => despachar({ tipo: "codigo-tipeado", codigo })} />;
    case "chequeando":
      return <p className="text-center text-fg-muted">Checking the code…</p>;
    case "confirmar":
    case "aprobando":
      return (
        <Confirmar
          codigo={estado.codigo}
          pedido={estado.pedido}
          aprobando={estado.tipo === "aprobando"}
          onAprobar={() => despachar({ tipo: "aprobar" })}
          onCancelar={() => despachar({ tipo: "cancelar" })}
          onChequearDeNuevo={() => despachar({ tipo: "chequear-de-nuevo" })}
          jwt={jwt}
        />
      );
    case "listo":
      return (
        <div className="space-y-6">
          <Mensaje titulo="This machine is connected." texto="Go back to your terminal — it picks up the connection within a few seconds." />
          <TarjetaDePlan supabase={supabase} sesion={sesion} modo={modo} codigoPendiente={null} />
        </div>
      );
    case "plan":
      return <TarjetaDePlan supabase={supabase} sesion={sesion} modo={modo} codigoPendiente={null} />;
    case "cancelado":
      return <Mensaje titulo="Not approved." texto="Nothing was connected. You can close this tab." />;
    case "error":
      return <Mensaje titulo="That didn't work." texto={copyDeError(estado.error)} />;
  }
}

function Mensaje({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className={tarjeta}>
      <h1 className="text-xl font-semibold text-fg mb-2">{titulo}</h1>
      <p className="text-sm text-fg-muted leading-relaxed">{texto}</p>
    </div>
  );
}

function SignIn({ supabase, modo, volverA }: { supabase: SupabaseClient; modo: Modo; volverA: string }) {
  const [crear, setCrear] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [revisarMail, setRevisarMail] = useState(false);

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    setOcupado(true);
    if (crear) {
      // Same `signUp` as the Nest app, same Supabase: one account.
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: volverA } });
      if (error) setError(error.message);
      else if (!data.session) setRevisarMail(true);
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    }
    setOcupado(false);
  }

  async function oauth(proveedor: Proveedor) {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({ provider: proveedor, options: { redirectTo: volverA, scopes: SCOPES[proveedor] } });
    if (error) setError(error.message);
  }

  if (revisarMail) {
    return <Mensaje titulo="Check your email." texto="Confirm your account from the link we sent, and you'll land back here." />;
  }

  return (
    <div className={tarjeta}>
      <h1 className="text-xl font-semibold text-fg mb-1">{modo === "link" ? "Connect a machine" : "Upgrade to Cloud"}</h1>
      <p className="text-sm text-fg-muted mb-6">Sign in with your Nest account.</p>
      <div className="grid gap-2 mb-6">
        <button type="button" className={secundario} onClick={() => void oauth("google")}>Continue with Google</button>
        <button type="button" className={secundario} onClick={() => void oauth("github")}>Continue with GitHub</button>
        <button type="button" className={secundario} onClick={() => void oauth("gitlab")}>Continue with GitLab</button>
      </div>
      <form onSubmit={(ev) => void enviar(ev)} className="grid gap-3">
        <label className="grid gap-1 text-sm text-fg-muted">Email
          <input className={campo} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm text-fg-muted">Password
          <input className={campo} type="password" autoComplete={crear ? "new-password" : "current-password"} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button type="submit" className={primario} disabled={ocupado}>{ocupado ? "…" : crear ? "Create account" : "Sign in"}</button>
      </form>
      <button type="button" className="mt-4 text-sm text-fg-muted hover:text-fg" onClick={() => { setCrear(!crear); setError(null); }}>
        {crear ? "I already have an account" : "Create account"}
      </button>
    </div>
  );
}

function PedirCodigo({ onListo }: { onListo: (codigo: string) => void }) {
  const [tipeado, setTipeado] = useState("");
  const n = normalizarCodigo(tipeado);
  const aviso = !n.ok && n.motivo === "simbolo" ? "Codes are letters and numbers only."
    : !n.ok && n.motivo === "largo" ? "That is longer than a code — they are 8 characters." : null;
  return (
    <form className={tarjeta} onSubmit={(ev) => { ev.preventDefault(); if (n.ok) onListo(n.codigo); }}>
      <h1 className="text-xl font-semibold text-fg mb-1">Enter your code</h1>
      <p className="text-sm text-fg-muted mb-4">Run <code className="font-mono">{LOGIN_COMMAND}</code> and type the code it shows.</p>
      <input className={`${campo} font-mono uppercase`} placeholder="WXYZ-1234" autoComplete="off" spellCheck={false} value={tipeado} onChange={(e) => setTipeado(e.target.value)} />
      {aviso && <p className="mt-2 text-sm text-fg-muted">{aviso}</p>}
      <button type="submit" className={`${primario} mt-4 w-full`} disabled={!n.ok}>Continue</button>
    </form>
  );
}

function Confirmar(p: {
  codigo: string; pedido: Pedido; aprobando: boolean;
  onAprobar: () => void; onCancelar: () => void; onChequearDeNuevo: () => void;
  jwt: string | null;
}) {
  const { pedido } = p;
  return (
    <div className="space-y-6">
      <div className={tarjeta}>
        <h1 className="text-xl font-semibold text-fg mb-4">Approve this machine?</h1>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm mb-4">
          <dt className="text-fg-subtle">Code</dt><dd className="font-mono text-fg">{p.codigo}</dd>
          <dt className="text-fg-subtle">Machine</dt><dd className="text-fg">{pedido.deviceName ?? "Unnamed machine"}</dd>
          <dt className="text-fg-subtle">System</dt><dd className="text-fg">{nombreDeSistema(pedido.platform)}</dd>
          <dt className="text-fg-subtle">When</dt><dd className="text-fg">{haceCuanto(pedido.ageSeconds)}</dd>
        </dl>
        <p className="text-sm text-fg-muted mb-6">
          Approve only if you just ran <code className="font-mono">login</code> yourself. Never approve a code someone sent you.
        </p>
        {pedido.eligibility === "ok" ? (
          <div className="flex gap-3">
            <button type="button" className={primario} disabled={p.aprobando} onClick={p.onAprobar}>{p.aprobando ? "Approving…" : "Approve this machine"}</button>
            <button type="button" className={secundario} disabled={p.aprobando} onClick={p.onCancelar}>Cancel</button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-fg">
              {pedido.eligibility === "not_in_beta"
                ? "Nest Memories Cloud is in private beta. Your local memory already works on this machine. Upgrade to Cloud to get in now."
                : pedido.eligibility === "device_limit_reached"
                  ? "Your account already syncs the most machines its plan allows (Free: 3, Cloud: 10). Upgrade to Cloud to add this one."
                  : "Your plan doesn't include cloud sync. Upgrade to Cloud to connect this machine."}
            </p>
            <BotonesDeCompra jwt={p.jwt} modo="link" codigoPendiente={p.codigo} />
            <div className="flex gap-3">
              <button type="button" className={secundario} onClick={p.onChequearDeNuevo}>I already paid — check again</button>
              <button type="button" className={secundario} onClick={p.onCancelar}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TarjetaDePlan({ supabase, sesion, modo, codigoPendiente }: { supabase: SupabaseClient; sesion: Session | null; modo: Modo; codigoPendiente: string | null }) {
  // undefined = loading. A failed read shows the Free card: worst case the checkout says
  // already_subscribed and opens the portal (Review Focus 4).
  const [plan, setPlan] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!sesion) return;
    let vivo = true;
    supabase.from("profiles").select("plan").eq("id", sesion.user.id).maybeSingle().then(({ data }) => {
      if (vivo) setPlan((data?.plan as string | undefined) ?? null);
    });
    return () => { vivo = false; };
  }, [supabase, sesion]);

  if (plan === undefined) return <p className="text-center text-fg-muted">Loading your plan…</p>;
  const texto = textoDelPlan(plan);
  return (
    <div className={tarjeta}>
      <h2 className="text-lg font-semibold text-fg mb-2">{texto.titulo}</h2>
      {texto.ofrecerUpgrade && (
        <>
          <p className="text-sm text-fg-muted mb-4">Upgrade to Cloud: ${CLOUD_MONTHLY_PRICE}/mo or ${CLOUD_ANNUAL_PRICE}/yr — every project, up to 10 machines.</p>
          <BotonesDeCompra jwt={sesion?.access_token ?? null} modo={modo} codigoPendiente={codigoPendiente} />
        </>
      )}
      {texto.ofrecerPortal && <BotonDePortal jwt={sesion?.access_token ?? null} />}
    </div>
  );
}

function BotonesDeCompra({ jwt, modo, codigoPendiente }: { jwt: string | null; modo: Modo; codigoPendiente: string | null }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function comprar(interval: Intervalo) {
    if (!jwt) return;
    setOcupado(true);
    setError(null);
    // Only an UNAPPROVED code is kept: the return page sends the person back to approve it.
    guardarCodigoPendiente(codigoPendiente);
    const r = await iniciarCompra({ supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON, jwt, interval, from: modo });
    if (r.ok) { window.location.assign(r.valor); return; }
    setError(copyDeError(r.error));
    setOcupado(false);
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3">
        <button type="button" className={primario} disabled={ocupado || !jwt} onClick={() => void comprar("monthly")}>${CLOUD_MONTHLY_PRICE}/mo</button>
        <button type="button" className={secundario} disabled={ocupado || !jwt} onClick={() => void comprar("annual")}>${CLOUD_ANNUAL_PRICE}/yr</button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function BotonDePortal({ jwt }: { jwt: string | null }) {
  const [error, setError] = useState<string | null>(null);
  async function abrir() {
    if (!jwt) return;
    const r = await abrirPortal({ supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON, jwt });
    if (r.ok) window.location.assign(r.valor);
    else setError(copyDeError(r.error));
  }
  return (
    <>
      <button type="button" className={secundario} onClick={() => void abrir()}>Manage subscription</button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </>
  );
}
```

- [ ] **Step 6: Las páginas**

`src/pages/link.astro`:

```astro
---
// `nestmux.com/link?code=…` — where `npx @nestmux/memory login` sends people (spec §4).
// English only, noindex, out of the sitemap. No Nav: its language switcher would point to a
// /es/link that doesn't exist.
import BaseLayout from "../layouts/BaseLayout.astro";
import AuroraBackground from "../components/ui/AuroraBackground";
import LinkFlow from "../components/link/LinkFlow";
---
<BaseLayout title="Connect a machine · NestMux" description="Approve a machine that ran npx @nestmux/memory login." noindex>
  <AuroraBackground client:load variant="page" />
  <header class="relative px-6 pt-8">
    <a href="/" class="inline-flex items-center gap-2 text-fg">
      <img src="/nest-logo.png" alt="NestMux" width="28" height="28" class="h-7 w-7 rounded-lg" />
      <span class="font-semibold">NestMux</span>
    </a>
  </header>
  <main class="relative px-6 pt-16 pb-32">
    <div class="max-w-md mx-auto">
      <LinkFlow client:only="react" modo="link" />
    </div>
  </main>
</BaseLayout>
```

`src/pages/upgrade.astro`: idéntico salvo el comentario (`// nestmux.com/upgrade — the link the plugin prints when it hits a limit (spec §5).`), `title="Upgrade to Cloud · NestMux"`, `description="Upgrade Nest Memories to Cloud."` y `<LinkFlow client:only="react" modo="upgrade" />`.

- [ ] **Step 7: Sitemap y `.env.example`**

En `astro.config.mjs`, reemplazar el comentario y la línea `filter` que trajo el PR #10 por:

```js
      // Stripe's return pages and the /link + /upgrade flow stay out of the sitemap (they're also noindex).
      filter: (page) => !page.includes('/checkout/') && !/\/(link|upgrade)\/?$/.test(page),
```

En `.env.example`, sumar al final:

```
# Nest Memory sync service, for /link (default https://sync.nestmux.com; local: http://127.0.0.1:8099)
PUBLIC_SYNC_BASE_URL=
```

- [ ] **Step 8: Tests y build**

Run: `cd C:/Users/gerod/Dev/pagina-nest-link && npm test && npm run build`
Expected: PASS y build verde.

- [ ] **Step 9: Verificar el resultado del build**

Run (bash): `cd C:/Users/gerod/Dev/pagina-nest-link && ls dist/link/index.html dist/upgrade/index.html && grep -c 'noindex' dist/link/index.html dist/upgrade/index.html && ! grep -E 'nestmux.com/(link|upgrade)/?<' dist/sitemap-*.xml`
Expected: los dos archivos existen, `noindex` aparece en ambos (≥1), y el último `grep` no encuentra nada (sale 0 gracias al `!`).

- [ ] **Step 10: Commit**

```bash
cd C:/Users/gerod/Dev/pagina-nest-link
git add src/lib/link/api.ts src/lib/link/precios.ts src/lib/link/api.test.ts src/components/link/LinkFlow.tsx src/pages/link.astro src/pages/upgrade.astro astro.config.mjs .env.example
git commit -m "$(cat <<'EOF'
feat(link): páginas /link y /upgrade — sign in, confirmar, aprobar y pagar Cloud

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: pagina-nest — la vuelta del checkout ofrece volver a la terminal

**Files (en `C:\Users\gerod\Dev\pagina-nest-link`):**
- Create: `src/lib/link/vuelta.ts`, `src/components/link/VueltaALaTerminal.tsx`
- Modify: `src/components/sections/CheckoutResult.astro` (del PR #10)
- Test: `src/lib/link/vuelta.test.ts`

**Interfaces:**
- Consumes: `normalizarCodigo`, `CLAVE_DEL_CODIGO_PENDIENTE` (Task 7); `?from=link|upgrade` en las URLs de vuelta (Task 6).
- Produces:
  - `export type Vuelta = { tipo: 'nada' } | { tipo: 'terminal' } | { tipo: 'terminar-vinculacion'; href: string } | { tipo: 'volver-a-upgrade'; href: string }`
  - `export function vueltaDelPago(kind: 'success' | 'cancelled', search: string, codigoGuardado: string | null): Vuelta`

**Por qué no sólo "Back to your terminal":** quien pagó desde `not_in_beta` todavía no aprobó la máquina. Mandarlo a la terminal lo dejaría esperando para siempre; la vuelta lo lleva de nuevo a `/link?code=…`, que re-chequea solo. Si el código ya venció ahí, la página dice cómo pedir otro.

- [ ] **Step 1: Escribir los tests que fallan**

`src/lib/link/vuelta.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { vueltaDelPago } from "./vuelta";

describe("vueltaDelPago", () => {
  it("pagó desde /link con un código sin aprobar: volver a aprobarlo", () => {
    expect(vueltaDelPago("success", "?from=link", "WXYZ-1234")).toEqual({ tipo: "terminar-vinculacion", href: "/link?code=WXYZ-1234" });
    expect(vueltaDelPago("cancelled", "?from=link", "WXYZ-1234")).toEqual({ tipo: "terminar-vinculacion", href: "/link?code=WXYZ-1234" });
  });

  it("pagó desde /link ya aprobado, o desde /upgrade: volver a la terminal", () => {
    expect(vueltaDelPago("success", "?from=link", null)).toEqual({ tipo: "terminal" });
    expect(vueltaDelPago("success", "?from=upgrade", "WXYZ-1234")).toEqual({ tipo: "terminal" });
  });

  it("canceló desde /upgrade: volver a /upgrade; desde /link sin código, nada", () => {
    expect(vueltaDelPago("cancelled", "?from=upgrade", null)).toEqual({ tipo: "volver-a-upgrade", href: "/upgrade" });
    expect(vueltaDelPago("cancelled", "?from=link", null)).toEqual({ tipo: "nada" });
  });

  it("sin from (vino de Nest) o con uno desconocido, nada", () => {
    expect(vueltaDelPago("success", "", "WXYZ-1234")).toEqual({ tipo: "nada" });
    expect(vueltaDelPago("success", "?from=evil", "WXYZ-1234")).toEqual({ tipo: "nada" });
  });

  it("un código guardado que no tiene forma de código no arma un link", () => {
    expect(vueltaDelPago("success", "?from=link", "<script>")).toEqual({ tipo: "terminal" });
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd C:/Users/gerod/Dev/pagina-nest-link && npm test`
Expected: FAIL — `Failed to resolve import "./vuelta"`.

- [ ] **Step 3: Implementar `src/lib/link/vuelta.ts`**

```ts
// What the Stripe return pages offer when the payment started on /link or /upgrade
// (`?from=`, set by `stripe-checkout`). Pure, so it's tested without a browser.
import { normalizarCodigo } from "./codigo";

export type Vuelta =
  | { tipo: "nada" }
  | { tipo: "terminal" }
  | { tipo: "terminar-vinculacion"; href: string }
  | { tipo: "volver-a-upgrade"; href: string };

export function vueltaDelPago(kind: "success" | "cancelled", search: string, codigoGuardado: string | null): Vuelta {
  const from = new URLSearchParams(search).get("from");
  if (from !== "link" && from !== "upgrade") return { tipo: "nada" };
  if (from === "upgrade") return kind === "success" ? { tipo: "terminal" } : { tipo: "volver-a-upgrade", href: "/upgrade" };
  const n = codigoGuardado ? normalizarCodigo(codigoGuardado) : null;
  if (n?.ok) return { tipo: "terminar-vinculacion", href: `/link?code=${encodeURIComponent(n.codigo)}` };
  return kind === "success" ? { tipo: "terminal" } : { tipo: "nada" };
}
```

- [ ] **Step 4: La isla `src/components/link/VueltaALaTerminal.tsx`**

```tsx
// Rendered inside CheckoutResult (success / cancelled). Reads `?from=` and the code /link kept
// in sessionStorage before going to Stripe. Renders nothing for payments started in the app.
import { useEffect, useState } from "react";
import { vueltaDelPago, type Vuelta } from "@/lib/link/vuelta";
import { CLAVE_DEL_CODIGO_PENDIENTE } from "@/lib/link/codigo";

export default function VueltaALaTerminal({ kind }: { kind: "success" | "cancelled" }) {
  const [vuelta, setVuelta] = useState<Vuelta>({ tipo: "nada" });
  useEffect(() => {
    let guardado: string | null = null;
    try { guardado = sessionStorage.getItem(CLAVE_DEL_CODIGO_PENDIENTE); } catch { /* no storage */ }
    setVuelta(vueltaDelPago(kind, window.location.search, guardado));
  }, [kind]);

  const enlace = "inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-fg-inverse hover:bg-brand-hover";
  switch (vuelta.tipo) {
    case "nada":
      return null;
    case "terminal":
      return <p className="mt-6 text-base text-fg">Back to your terminal — the plugin picks up your plan on its next sync.</p>;
    case "terminar-vinculacion":
      return (
        <div className="mt-6 space-y-3">
          <p className="text-base text-fg">{kind === "success" ? "One more step: approve the machine that ran login." : "Your machine isn't connected yet."}</p>
          <a className={enlace} href={vuelta.href}>{kind === "success" ? "Finish connecting →" : "Back to connecting →"}</a>
        </div>
      );
    case "volver-a-upgrade":
      return <p className="mt-6 text-sm"><a className="text-brand hover:underline underline-offset-4" href={vuelta.href}>Back to upgrade</a></p>;
  }
}
```

- [ ] **Step 5: Montarla en `CheckoutResult.astro`**

En el frontmatter, sumar `import VueltaALaTerminal from "../link/VueltaALaTerminal";`. Debajo del bloque `{kind === "success" && (<p …>{t(locale, "checkout.successReceipt")}</p>)}`:

```astro
    {(kind === "success" || kind === "cancelled") && <VueltaALaTerminal client:only="react" kind={kind} />}
```

- [ ] **Step 6: Tests y build**

Run: `cd C:/Users/gerod/Dev/pagina-nest-link && npm test && npm run build`
Expected: PASS y build verde.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/gerod/Dev/pagina-nest-link
git add src/lib/link/vuelta.ts src/lib/link/vuelta.test.ts src/components/link/VueltaALaTerminal.tsx src/components/sections/CheckoutResult.astro
git commit -m "$(cat <<'EOF'
feat(checkout): la vuelta de Stripe ofrece volver a la terminal o terminar de aprobar la máquina

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Docs — rutas del servidor, runbook de configuración externa y smoke de punta a punta

**Files (raven-nest):**
- Modify: `server/README.md` (tabla `## Rutas`, tabla `## Variables de entorno`)
- Create: `docs/RUNBOOK-LOGIN-SIN-NEST.md`
- Modify: `docs/superpowers/plans/2026-11-02-login-y-compra-sin-nest.md` (este plan: tildar lo hecho)

**Interfaces:**
- Consumes: todo lo anterior. Ningún paso de este task ejecuta configuración externa.

- [ ] **Step 1: Rutas en `server/README.md`**

Agregar a la tabla de `## Rutas`, antes de la fila de `GET /health`:

```markdown
| `POST /v1/link/start` | — | Vincular una máquina sin navegador. Sin credenciales. Cuerpo opcional `{ name, platform }` (nombre recortado a 100; `platform` sólo `win32`/`darwin`/`linux`, si no null). Devuelve `{ user_code, device_code, expires_in, interval }`. 20 por hora por IP. |
| `POST /v1/link/check` | — | Con el JWT de Supabase y `{ user_code }` (o `{ code }`): lo que la página `nestmux.com/link` muestra antes de aprobar — `{ device_name, platform, created_at, expires_at, expires_in, eligibility }`, con `eligibility` = `ok` / `not_in_beta` / `plan_required` / `device_limit_reached`, el mismo veredicto que `authenticate` (`src/elegibilidad.ts`). No crea `users` ni emite token. 404 `unknown_code`, 400 `expired`, 409 `already_approved`. 20 por hora por IP. CORS: ver `LINK_WEB_ORIGINS`. |
| `POST /v1/link/approve` | — | Con el JWT de Supabase y `{ user_code }`: ata el pedido a la cuenta. No emite nada. CORS: ver `LINK_WEB_ORIGINS`. |
| `POST /v1/link/poll` | — | Con `{ device_code, name?, platform? }`: 400 `authorization_pending`, 429 `slow_down`, 410 `expired`, 403 `denied`, o 200 con el token (lo emite `registerDevice`, con sus controles). |
```

Agregar a la tabla de `## Variables de entorno`, después de `PLAN_SYNC_SECRET`:

```markdown
| `LINK_WEB_ORIGINS` | `https://nestmux.com,http://localhost:4321` | Orígenes (separados por coma) a los que `/v1/link/check` y `/v1/link/approve` les contestan CORS: sólo `POST`, headers `authorization, content-type`, sin credenciales. **Seteada, manda sólo esa lista**: en producción va `https://nestmux.com` para sacar `localhost`. Si el sitio se sirve también en `www.`, sumarlo. Ninguna otra ruta tiene CORS. |
```

- [ ] **Step 2: Escribir `docs/RUNBOOK-LOGIN-SIN-NEST.md`**

```markdown
# Runbook — login y compra de Nest Memories sin Nest

Spec: `docs/superpowers/specs/2026-11-02-login-y-compra-sin-nest-design.md`.
Plan: `docs/superpowers/plans/2026-11-02-login-y-compra-sin-nest.md`.

Código en dos repos: raven-nest (`feat/memories-settings`: servidor, CLI, `stripe-checkout`) y
pagina-nest (`feat/link-page`, sobre el PR #10). **Cada paso externo, con OK de Gero.**

## 1. Orden de salida

1. Mergear el PR #10 de pagina-nest (`feat/checkout-pages`). `feat/link-page` sale de él.
2. Servidor de sync (Railway): deploy de la rama con la migración 014 (corre sola al arrancar)
   y la variable `LINK_WEB_ORIGINS=https://nestmux.com`. Verificar:
   `curl -i -X OPTIONS https://sync.nestmux.com/v1/link/check -H 'Origin: https://nestmux.com' -H 'Access-Control-Request-Method: POST'`
   → `204` con `access-control-allow-origin: https://nestmux.com`. Con `-H 'Origin: https://evil.example'` → sin esa cabecera.
3. Supabase prod — Auth → URL Configuration → Redirect URLs: sumar
   `https://nestmux.com/link**` y `https://nestmux.com/upgrade**` (con `**`: la vuelta lleva
   `?link_code=…`, y sin comodín Supabase cae al Site URL).
4. Supabase prod: `supabase functions deploy stripe-checkout` (acepta `from`). Sin este deploy
   la compra funciona igual, pero la página de vuelta no ofrece volver a la terminal.
5. Vercel (`pagina-nest`): confirmar `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY` (ya
   están por la encuesta) y sumar `PUBLIC_SYNC_BASE_URL=https://sync.nestmux.com`. Mergear
   `feat/link-page` y deployar (Vercel bloquea commits de colaboradores: lo hace Gero).
6. Publicar `@nestmux/memory` con el `login` nuevo (flujo de release del paquete, aparte).

## 2. Smoke local de punta a punta (sin tocar prod)

Requisitos: Docker, Supabase local (`npx supabase start` en raven-nest), Postgres
`nest-memory-pg` en 55432.

1. **Supabase local**: anotar `API URL`, `anon key` y el JWT secret de `npx supabase status`.
   Crear un usuario con email y contraseña desde Studio (Auth → Add user, auto-confirm).
   OAuth no se prueba en local salvo que se configuren los proveedores: si se quiere, sumar
   `http://localhost:4321/**` a `additional_redirect_urls` de `supabase/config.toml` **sin
   commitearlo**.
2. **Servidor de sync en 8099** (desde `server/`):
   `SUPABASE_URL=<API URL> SUPABASE_ANON_KEY=<anon> SUPABASE_JWT_SECRET=<jwt secret> DATABASE_URL=postgres://postgres:nestmem@127.0.0.1:55432/nest_memory PORT=8099 npx tsx src/index.ts`
   (sin `LINK_WEB_ORIGINS`: vale `http://localhost:4321`).
3. **pagina-nest** (en `C:\Users\gerod\Dev\pagina-nest-link`): `.env` con
   `PUBLIC_SUPABASE_URL=<API URL>`, `PUBLIC_SUPABASE_ANON_KEY=<anon>`,
   `PUBLIC_SYNC_BASE_URL=http://127.0.0.1:8099`; `npm run dev` (puerto 4321).
4. **Paquete**: `npm --prefix packages/nest-memory run build` y, en una terminal con un HOME
   aislado (ver la trampa del llavero en `docs/HANDOFF-2026-10-19-prueba-plugin.md`):
   `NEST_MEMORY_SYNC_URL=http://127.0.0.1:8099 NEST_MEMORY_WEB_URL=http://localhost:4321 node packages/nest-memory/dist/cli-del-paquete.js login`

Checklist (cada punto, visto):

- [ ] La CLI imprime `To connect this machine, open:` / `  http://localhost:4321/link?code=XXXX-XXXX` / `and sign in… (expires in 10 minutes)` y abre el navegador.
- [ ] La página pide login; entrar con email y contraseña vuelve a la misma página con el código.
- [ ] Usuario **fuera** de la allowlist: la confirmación muestra el aviso de beta privada y el botón de checkout, sin Approve.
- [ ] Insertar el usuario en `allowlist` (`docker exec -i nest-memory-pg psql -U postgres nest_memory -c "insert into users (id) values ('<uuid>') on conflict do nothing; insert into allowlist (user_id) values ('<uuid>');"`) y apretar "I already paid — check again": aparece Approve.
- [ ] La confirmación muestra el nombre de la máquina (hostname), el sistema y "requested … ago".
- [ ] Approve → "This machine is connected." + tarjeta "You're on Free — 1 cloud project." con $15/mo y $144/yr.
- [ ] La CLI pasa a `Connected` y corre el enrolamiento del cifrado (muestra el código de recuperación y pide `saved`).
- [ ] Recargar la página con el mismo `?code=` → "That code was already approved…".
- [ ] Correr `login` otra vez en otro HOME, dejar pasar 10 minutos en la confirmación → "That code expired…" sin poder aprobar.
- [ ] `http://localhost:4321/link?code=xxxx1111` (minúsculas, sin guión, inventado) → se normaliza y el servicio contesta "That code doesn't exist…".
- [ ] `http://localhost:4321/link` sin código → pide el código a mano.
- [ ] `http://localhost:4321/upgrade` → login → tarjeta de plan.
- [ ] Desde la consola del navegador en otra página (`https://example.com`):
      `fetch('http://127.0.0.1:8099/v1/link/check',{method:'POST'})` → bloqueado por CORS.
- [ ] `status` del paquete con `users.plan = 'legacy'` en esa cuenta (después de un push que
      devuelva `plan_required`) muestra la fila `Upgrade` con `http://localhost:4321/upgrade`.

Checkout real (Stripe en modo test) se prueba contra staging con `docs/RUNBOOK-PAGAR-CLOUD.md`
§3, sumando: pagar desde `/link` con un usuario fuera de la beta → la vuelta muestra
"Finish connecting →" → vuelve a `/link?code=…` → Approve habilitado.

## 3. Recuperación

- Página caída o mal deployada: la tarjeta de Nest (Memory settings → "Machine without a
  browser") sigue aprobando códigos; el `login` lo dice en su línea tenue.
- CORS mal configurado (`LINK_WEB_ORIGINS` sin el origen real): la página muestra
  "Couldn't reach the Nest sync service". Corregir la variable en Railway; no hace falta deploy
  de la página.
- Revertir: la migración 014 sólo agrega columnas nullables; un servidor viejo las ignora.
```

- [ ] **Step 3: Verificación final de raven-nest**

Run: `npx tsc -p tsconfig.node.json --noEmit --composite false; npx tsc -p tsconfig.web.json --noEmit --composite false; cd server && npx tsc --noEmit -p tsconfig.json && npx vitest run; cd ..; npx vitest run electron/__tests__ supabase/functions; npm run native:electron`
Expected: 0 errores en los tres typechecks; suites verdes; el binding vuelve al de Electron.

- [ ] **Step 4: Commit**

```bash
git add server/README.md docs/RUNBOOK-LOGIN-SIN-NEST.md
git add -f docs/superpowers/plans/2026-11-02-login-y-compra-sin-nest.md
git commit -m "$(cat <<'EOF'
docs(link): rutas de vinculación, LINK_WEB_ORIGINS y runbook del login sin Nest

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (hecho al escribir el plan)

**Cobertura del spec:**
- §1 CLI: `name`/`platform` en `start` (T1, T4), texto + abrir navegador sin shell (T4), `NEST_WEB_BASE` / `NEST_MEMORY_WEB_URL` (T4), el resto del bucle sin cambios (T4 sólo toca el inicio).
- §2 Upgrade desde el plugin: `status` y MCP con `plan_required` / `project_limit_reached` / `device_limit_reached` (T5).
- §3 Servidor: migración 014 (T1), `check` con el mismo control y sin crear nada (T2), errores 404/400/409 (T2), mismo rate limit (T2), `approve` sin cambio de contrato (T3 sólo suma cabeceras), CORS (T3).
- §4 Página `/link`: estados sign in / confirm / done / errores (T7 lógica, T8 UI), `redirectTo` que conserva el código (T7), código a mano (T7/T8), checkout + `already_subscribed` → portal (T8), plan de `profiles.plan` y precios espejados (T8), `noindex` y fuera del sitemap (T8), vuelta con `from` (T6, T9).
- §5 `/upgrade` (T8).
- §6 Configuración externa (T10, runbook; nada ejecutado).
- Seguridad: aviso explícito en la confirmación (T8), `device_code` nunca sale de la máquina (sin cambios), `check` sin JWT no revela nada (T2), CORS cerrado y JWT en header (T3, T8).
- Tests del spec: servidor (T1-T3), CLI (T4-T5), pagina-nest `siguienteEstado` + `astro build` (T7-T9), smoke manual (T10).

**Placeholders:** ninguno; cada paso de código trae el código.

**Consistencia de tipos:** `Elegibilidad` (servidor, T2) y su espejo en pagina-nest (T7) tienen los mismos cuatro valores; `Pedido.expiresIn` (página) sale de `expires_in` (servidor); `MotivoDeUpgrade` y `errorDeCuentaDelDaemon` se usan con los mismos nombres en T5; `CLAVE_DEL_CODIGO_PENDIENTE` se define en T7 y la usan T8 y T9; `urlDeUpgrade`/`webDelPaquete` se definen en T4 y los usa T5.
