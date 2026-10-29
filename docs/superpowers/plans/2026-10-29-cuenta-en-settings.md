# Cuenta en Settings (2b-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings › Account muestra plan, uso y máquinas (con Disconnect por máquina), y se cierran los huecos de 2b-2 (back-office sin avisar al sync, customer de Stripe borrado, e2e/04 sin toast ni Keep syncing).

**Architecture:** Las fechas e intervalo de la suscripción las escribe el webhook en `profiles` (3 columnas nuevas, protegidas por el trigger). El servidor de sync suma `GET /v1/devices` y revoke por id; el daemon los expone por dos IPC. La UI es un componente nuevo `AccountPlanSection` en `SettingsPanel`, armado con shadcn + utilidades y alimentado por `useProfile`, `useMemory` y el IPC de máquinas. Toda decisión con ramas vive en módulos puros testeados con vitest.

**Tech Stack:** Supabase Edge Functions (Deno, módulos puros testeados con vitest en Node), Postgres (server/ con `pg`), Electron IPC, React + shadcn + Tailwind v4 sin preflight, Playwright headless.

**Spec:** `docs/superpowers/specs/2026-10-29-cuenta-en-settings-design.md`

## Global Constraints

- Copy visible **en inglés y verbatim** de la tabla §3.5 del spec. Lo cubre el test `la-app-es-en-ingles`.
- Componentes nuevos con shadcn + utilidades; **ninguna clase nueva en `global.css`**. Sin literales de color cromáticos: el estado usa `text-warn` / `text-destructive` / `text-muted-foreground`.
- Typecheck = los dos de CI: `npx tsc -p tsconfig.node.json --noEmit --composite false` y `npx tsc -p tsconfig.web.json --noEmit --composite false` (baseline 0 errores). Server: `cd server && npx tsc --noEmit`.
- Node: en esta Mac anteponer `PATH=/opt/homebrew/opt/node@22/bin:$PATH` (con Node 26 falla electron-rebuild). `npm test` corre `pretest` → `native:node`; después de los tests, `npm run native:electron` antes de levantar la app.
- Tests de `server/` necesitan Postgres 16 en `127.0.0.1:55432` (postgresql@16 de Homebrew; ver memoria `postgres-tests-server-mac`). Verificar que corrieron con `\dt` (12+ tablas), no por el tiempo.
- e2e siempre **headless** (sin `RAVEN_E2E_SHOW=1`) y **después de `npm run build`**: los e2e corren contra `dist/`.
- API de Stripe `2024-11-20.acacia`: `current_period_end` está en la suscripción, no en los items.
- Fecha larga `en-US`: `new Date(x).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })` → `Nov 29, 2026`.
- Nada externo (migraciones, deploys, secrets) se ejecuta en este plan: va al runbook (Task 11), con el OK de Gero paso por paso.

## Desvíos del spec decididos en el plan

- **Portal con customer borrado → 404 `no_subscription`**, no 409. Es el mismo código y el mismo status que ya devuelve `decidirPortal` sin customer; la app decide por el código, así que un status distinto para el mismo código no le sirve a nadie.
- **`last seen {relative}` usa `relativeTime()`** de `src/lib/memories-status.ts` (`3d ago`, `2h ago`), que ya es la forma de decir "hace cuánto" en la app. El `3 days ago` del mockup era ilustrativo.
- **Test de la migración sin Postgres de Supabase**: no hay infraestructura SQL de `supabase/` en el repo. Se testea el texto de la migración (cada columna se revierte en las dos ramas del trigger) y el comportamiento real va al smoke del runbook contra Supabase local.

## Review Focus

1. **Suscripción legacy (Pro/Team) sin intervalo de Cloud**: la línea de Plan muestra el nombre del plan, sin `· Monthly` inventado ni `Renews on` vacío. → test en Task 7.
2. **Desconectar la máquina actual desde la lista**: la fila actual no ofrece `Disconnect`, y el servidor devuelve 400 `use_self_revoke` aunque el cliente mande su propio id. → tests en Task 4 y Task 8.
3. **`current_period_end` en el pasado** (webhook atrasado, o suscripción vencida sin `deleted` todavía): no se muestra `Renews on` con una fecha vieja; se cae a la fila sin fecha. → test en Task 7.
4. **La lista de máquinas mientras el sync se desconecta o cambia de cuenta**: un `memory:devices` que vuelve con la cuenta anterior no pisa la lista. → test en Task 5 (`account_changed`).
5. **Doble click en `Disconnect`** confirmado: un solo POST, botón deshabilitado mientras vuela. → test en Task 8.

---

### Task 1: Migración — intervalo y fechas en `profiles`

**Files:**
- Create: `supabase/migrations/20261029000000_profiles_billing_period.sql`
- Test: `supabase/functions/_shared/__tests__/migracion-periodo-de-cobro.test.ts`

**Interfaces:**
- Produces: columnas `profiles.billing_interval text null check in ('monthly','annual')`, `profiles.current_period_end timestamptz null`, `profiles.cancel_at_period_end boolean not null default false`.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const sql = readFileSync(resolve(__dirname, '../../../migrations/20261029000000_profiles_billing_period.sql'), 'utf8')
const COLUMNAS = ['billing_interval', 'current_period_end', 'cancel_at_period_end']

it('agrega las tres columnas', () => {
  expect(sql).toMatch(/billing_interval\s+text[^;]*check\s*\(\s*billing_interval\s+in\s*\('monthly',\s*'annual'\)\)/i)
  expect(sql).toMatch(/current_period_end\s+timestamptz/i)
  expect(sql).toMatch(/cancel_at_period_end\s+boolean\s+not\s+null\s+default\s+false/i)
})
it('el trigger revierte cada columna en la rama del trial Y en la del cliente', () => {
  const cuerpo = sql.slice(sql.search(/create or replace function protect_profile_billing_columns/i))
  for (const c of COLUMNAS) expect(cuerpo.match(new RegExp(`NEW\\.${c}\\s*:=\\s*OLD\\.${c}`, 'gi'))?.length).toBe(2)
})
it('no esconde las columnas del select propio', () => {
  expect(sql).not.toMatch(/revoke\s+select/i)
})
```

- [ ] **Step 2: Run it:** `npx vitest run supabase/functions/_shared/__tests__/migracion-periodo-de-cobro.test.ts`. Expected: FAIL (ENOENT).
- [ ] **Step 3: Write the migration:** `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS …` (las tres), y `CREATE OR REPLACE FUNCTION protect_profile_billing_columns()` copiada de `20260601000000_trial_15_days_fix_and_gift.sql:59-88`, con las tres reversiones sumadas a la rama `app.allow_trial_write` y a la rama del cliente sin confianza. El trigger no se recrea (ya apunta a la función).
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(supabase): profiles guarda intervalo y fin del período de la suscripción`.

---

### Task 2: El webhook escribe intervalo, fin del período y cancelación

**Files:**
- Modify: `supabase/functions/stripe-webhook/eventos.ts`
- Modify: `supabase/functions/stripe-webhook/index.ts` (upsert de `activar`, update de `bajar_a_free`)
- Test: `supabase/functions/stripe-webhook/__tests__/eventos.test.ts`

**Interfaces:**
- Consumes: columnas de Task 1.
- Produces:
  ```ts
  export interface PeriodoDeCobro { billing_interval: 'monthly' | 'annual' | null; current_period_end: string | null; cancel_at_period_end: boolean }
  export const PERIODO_VACIO: PeriodoDeCobro // { null, null, false }
  export function periodoDeCobro(sub: { items?: { data?: Array<{ price?: { id?: string } }> }; current_period_end?: number | null; cancel_at_period_end?: boolean | null }, env: PreciosDeCloudEnv): PeriodoDeCobro
  ```

- [ ] **Step 1: Write the failing tests** en `eventos.test.ts`, bloque `describe('periodoDeCobro')`:
  - precio `== STRIPE_PRICE_CLOUD_ANNUAL` → `billing_interval: 'annual'`; `== MONTHLY` → `'monthly'`; un precio legacy (`price_1TJmwsJarRYFmNbKh7G6JXnF`) → `null`; un secret vacío no matchea `''`.
  - `current_period_end: 1795910400` → `'2026-11-29T00:00:00.000Z'` (segundos → ISO); ausente o `null` → `null`.
  - `cancel_at_period_end: true` → `true`; ausente → `false`.
  - `PERIODO_VACIO` es `{ billing_interval: null, current_period_end: null, cancel_at_period_end: false }`.
- [ ] **Step 2: Run:** `npx vitest run supabase/functions/stripe-webhook`. Expected: FAIL (`periodoDeCobro` no existe).
- [ ] **Step 3: Implement** `periodoDeCobro` y `PERIODO_VACIO` en `eventos.ts` (trimear los secrets como `armarPrecioAPlan`). En `index.ts`: la suscripción que ya se relee para `suscripcionSigueViva` (la variable `sub` del `try`, guardarla fuera del bloque) alimenta `...periodoDeCobro(sub, env)` en el `upsert` de `activar`. El `update` de `bajar_a_free` suma `...PERIODO_VACIO`. Agregar un comentario en la lectura: en API `basil` `current_period_end` pasa a los items.
- [ ] **Step 4: Run** `npx vitest run supabase/functions/stripe-webhook`. Expected: PASS, y los tests existentes siguen verdes (precio desconocido sigue ignorado).
- [ ] **Step 5: Commit** `feat(stripe-webhook): guarda intervalo, fin del período y cancelación en profiles`.

---

### Task 3: El back-office avisa el plan al servidor de sync

**Files:**
- Move: `supabase/functions/stripe-webhook/aviso-de-plan.ts` → `supabase/functions/_shared/aviso-de-plan.ts` (y su test `stripe-webhook/__tests__/aviso-de-plan.test.ts` → `_shared/__tests__/aviso-de-plan.test.ts`, con `git mv`)
- Modify: `supabase/functions/stripe-webhook/index.ts` (import)
- Modify: `supabase/functions/admin-api/index.ts:682-727` (`PUT /plan`)
- Test: `supabase/functions/_shared/__tests__/aviso-de-plan.test.ts`

**Interfaces:**
- Produces (en `_shared/aviso-de-plan.ts`):
  ```ts
  export async function avisarCambioManual(fetchImpl: typeof fetch, env: { PLAN_SYNC_URL?: string; PLAN_SYNC_SECRET?: string }, userId: string, plan: string, ahoraSeg: number): Promise<{ notificado: true } | { notificado: false; motivo: string }>
  ```
  Sin config → `{ notificado: false, motivo: 'sin_config' }`. Si no, `avisarPlan` y `ok` → `notificado: true`, si no `motivo` = el de `ResultadoDeAviso`.

- [ ] **Step 1: `git mv` los dos archivos y corregir los imports** (el test y `stripe-webhook/index.ts`). Correr `npx vitest run supabase/functions` → PASS sin cambios de comportamiento.
- [ ] **Step 2: Write the failing tests** para `avisarCambioManual`: sin `PLAN_SYNC_SECRET` no llama a fetch y da `sin_config`; fetch 200 → `{ notificado: true }` y el body firmado es `{"user_id":…,"plan":"cloud"}`; fetch 500 → `{ notificado: false, motivo: 'HTTP 500' }`; fetch que lanza → `notificado: false` con el mensaje.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement** `avisarCambioManual`. En `admin-api/index.ts`, `PUT /plan`: cuando `ok` es true, después del update y **antes** de `auditar`, `const aviso = await avisarCambioManual(fetch, { PLAN_SYNC_URL: Deno.env.get('PLAN_SYNC_URL'), PLAN_SYNC_SECRET: Deno.env.get('PLAN_SYNC_SECRET') }, id, plan, Math.floor(Date.now()/1000))`. El `after` del audit pasa a `{ plan, sync_notificado: aviso.notificado, ...(aviso.notificado ? {} : { sync_motivo: aviso.motivo }) }`. Si no se notificó: `console.error('[admin-api] el plan cambió pero no llegó al servidor de sync', { id, plan, motivo })`, y la respuesta 200 suma `sync_notificado: false`. Sumar los dos secrets al comentario de cabecera de `admin-api/index.ts`.
- [ ] **Step 5: Run** `npx vitest run supabase/functions`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(admin-api): PUT /plan avisa el plan al servidor de sync`.

---

### Task 4: Customer de Stripe borrado — checkout reintenta, portal da no_subscription

**Files:**
- Modify: `supabase/functions/stripe-checkout/checkout.ts`, `supabase/functions/stripe-checkout/index.ts`
- Modify: `supabase/functions/stripe-portal/portal.ts`, `supabase/functions/stripe-portal/index.ts`
- Test: `supabase/functions/stripe-checkout/__tests__/checkout.test.ts`, `supabase/functions/stripe-portal/__tests__/portal.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // checkout.ts
  export function esClienteInexistente(err: unknown): boolean   // err.code === 'resource_missing' && err.param === 'customer'
  export function sinCliente(sesion: ParametrosDeSesion, email: string | null): ParametrosDeSesion  // saca `customer`, pone `customer_email` si hay email
  // portal.ts
  export function decidirPortalTrasError(err: unknown): { limpiarCliente: true; status: 404; error: 'no_subscription' } | { limpiarCliente: false; status: 502; error: 'stripe_error' }
  ```

- [ ] **Step 1: Write the failing tests:** `esClienteInexistente({ code: 'resource_missing', param: 'customer' })` → true; con `param: 'price'` → false; `null` / `Error` común → false. `sinCliente` con `customer: 'cus_x'` y email → sin `customer`, `customer_email: email`; sin email → ninguno de los dos. `decidirPortalTrasError` con el error de customer → `limpiarCliente: true, 404, no_subscription`; otro → `502 stripe_error`.
- [ ] **Step 2: Run** `npx vitest run supabase/functions/stripe-checkout supabase/functions/stripe-portal`. Expected: FAIL.
- [ ] **Step 3: Implement** las tres funciones. Shells:
  - `stripe-checkout/index.ts`: en el `catch` de `sessions.create`, si `esClienteInexistente(e) && decision.sesion.customer` → `update profiles set stripe_customer_id = null where id = user.id and stripe_customer_id = <el viejo>`, después `sessions.create(sinCliente(decision.sesion, user.email ?? null))` **una vez**. Si eso también falla → 502. Loguear el reintento.
  - `stripe-portal/index.ts`: en el `catch`, `decidirPortalTrasError(e)`; con `limpiarCliente` → mismo update condicionado, y responder `json(404, { error: 'no_subscription' })`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `fix(stripe): un customer borrado en Stripe no traba checkout ni portal`.

---

### Task 5: Servidor — listar máquinas y revocar por id

**Files:**
- Modify: `server/src/devices.ts` (`revokeDevices` + `listDevices` nueva)
- Modify: `server/src/http.ts` (ruta `GET /v1/devices`; `handleRevokeDevice` lee `deviceId`)
- Test: `server/__tests__/devices-revoke.test.ts` (sumar casos), `server/__tests__/devices-list.test.ts` (nuevo)

**Interfaces:**
- Produces:
  ```ts
  export interface DeviceListado { id: string; name: string; platform: string | null; last_seen_at: string | null; current: boolean }
  export async function listDevices(pool: Pool, token: string): Promise<{ ok: true; devices: DeviceListado[] } | { ok: false; status: 401; error: 'unauthorized' }>
  // revokeDevices: opts pasa a { all?: boolean; deviceId?: string }
  export type RevokeResult =
    | { ok: true; revoked: number }
    | { ok: false; status: 401; error: 'unauthorized' }
    | { ok: false; status: 404; error: 'not_found' }
    | { ok: false; status: 400; error: 'use_self_revoke' | 'invalid_device_id' }
  ```
  HTTP: `GET /v1/devices` → `200 { devices: DeviceListado[] }` (`last_seen_at` como ISO). `POST /v1/devices/revoke` con `{ deviceId }` → `200 { ok: true, revoked: 1 }` / 404 / 400. Ninguna de las dos pasa por `authenticate` (mismo motivo que el revoke: tiene que funcionar fuera del plan o del beta).

- [ ] **Step 1: Write the failing tests:**
  - `devices-list.test.ts`: con tres devices de la cuenta (uno revocado) y uno de otra cuenta → lista los 2 vivos de la cuenta; `current: true` sólo en el del token; orden por `last_seen_at desc nulls last` (setear `last_seen_at` a mano con `update`); token inválido → 401.
  - `devices-revoke.test.ts`: `{ deviceId: <otra máquina de la cuenta> }` → `{ ok: true, revoked: 1 }` y ese token deja de autenticar (`authenticate` → 401) mientras el que llama sigue autenticando; ajena → 404 `not_found`; uuid inexistente → 404; ya revocada → 404; la propia → 400 `use_self_revoke` y sigue autenticando; `'no-uuid'` → 400 `invalid_device_id`; `all` y sin body, sin cambios.
  - `http.test.ts` (o el archivo HTTP de devices): `GET /v1/devices` con Bearer → 200 con `devices`; `POST` → 405 en GET de revoke y viceversa.
- [ ] **Step 2: Run** (Postgres arriba) `cd server && npx vitest run __tests__/devices-list.test.ts __tests__/devices-revoke.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Extraer de `revokeDevices` el lookup del token a `deviceDelToken(pool, token): Promise<{ id: string; user_id: string } | null>` y usarlo en las dos funciones. El revoke por id: validar uuid → `update devices set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null`; `rowCount 0` → 404. Si `deviceId === caller.id` → 400 antes del update. `deviceId` gana sobre `all` sólo si `all` no es `true`: con los dos → 400 `invalid_device_id` (ambiguo).
- [ ] **Step 4: Run** la suite entera de `server/`. Expected: PASS, y `\dt` confirma que corrió.
- [ ] **Step 5: Commit** `feat(sync): GET /v1/devices y revocar otra máquina de la cuenta por id`.

---

### Task 6: Daemon e IPC — `memory:devices` y `memory:revokeDevice`

**Files:**
- Modify: `electron/memory-daemon.ts` (dos métodos, junto a `keepProject`)
- Modify: `electron/main.ts` (dos handlers junto a `memory:keepProject`)
- Modify: `electron/preload.ts` (`devices`, `revokeDevice` en el bridge `memory`)
- Modify: `src/types.ts` (tipos opcionales en `window.memory`, junto a `keepProject`)
- Test: `electron/__tests__/memory-daemon-devices.test.ts` (patrón de `memory-daemon-proyecto-elegido.test.ts`)

**Interfaces:**
- Consumes: HTTP de Task 5.
- Produces:
  ```ts
  // src/types.ts (también exportado para el renderer)
  export interface MaquinaDeLaCuenta { id: string; name: string; platform: string | null; lastSeenAt: number | null; current: boolean }
  // daemon
  listDevices(): Promise<{ ok: true; devices: MaquinaDeLaCuenta[] } | { ok: false; error: string }>
  revokeDevice(deviceId: string): Promise<{ ok: true } | { ok: false; error: string }>
  // window.memory
  devices?: () => Promise<{ ok: true; devices: MaquinaDeLaCuenta[] } | { ok: false; error: string }>
  revokeDevice?: (deviceId: string) => Promise<{ ok: true } | { ok: false; error: string }>
  ```
  Errores: `'not_connected'`, `'offline'`, `'account_changed'`, el `error` del body del servidor (`not_found`, `use_self_revoke`), o `HTTP <n>`. `lastSeenAt` en ms (`Date.parse`).

- [ ] **Step 1: Write the failing tests:** `listDevices` hace GET `${url}/v1/devices` con Bearer y mapea `last_seen_at` ISO → ms (`null` → `null`); sin token → `not_connected` sin fetch; offline → `offline`; un cambio de store mientras vuela (subir `generacionDeStore` como en el test de `keepProject`) → `account_changed`. `revokeDevice('d2')` hace POST `${url}/v1/devices/revoke` con body `{"deviceId":"d2"}`; un 404 `{ error: 'not_found' }` → `{ ok: false, error: 'not_found' }`.
- [ ] **Step 2: Run** `npx vitest run electron/__tests__/memory-daemon-devices.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** los dos métodos con `fetchWithTimeout` y la guarda de `generacionDeStore` igual que `keepProject` (nunca lanzan). Handlers: `if (!memory) return { ok: false, error: 'Memory is not available' }`; `revokeDevice` valida que `deviceId` sea string no vacío.
- [ ] **Step 4: Run** el test y los dos `tsc` de CI. Expected: PASS / 0 errores.
- [ ] **Step 5: Commit** `feat(memory): el daemon lista las máquinas de la cuenta y revoca por id`.

---

### Task 7: `useProfile` con el período, y la línea de Plan como módulo puro

**Files:**
- Modify: `src/hooks/useProfile.ts`
- Modify: `electron/preload.ts:277` (`e2eBilling`), `src/types.ts:1283` (`e2eBilling?: string | null`)
- Create: `src/lib/plan-de-cuenta.ts`
- Test: `src/__tests__/lib/plan-de-cuenta.test.ts`, `src/__tests__/hooks/useProfile.test.tsx` (sumar casos; crear si no existe, mock de supabase como `CloudMemoryCard.test.tsx`)

**Interfaces:**
- Produces:
  ```ts
  // Profile suma:
  billingInterval: 'monthly' | 'annual' | null
  currentPeriodEnd: string | null   // ISO
  cancelAtPeriodEnd: boolean
  recargar: () => void              // la misma lectura que dispara `focus`, respetando `enVuelo`
  // src/lib/checkout.ts: ResultadoDeCobro de error suma `code: string | null` (el de la función)
  // plan-de-cuenta.ts
  export type AccionDePlan = 'upgrade' | 'manage' | null
  export interface LineaDePlan { titulo: string; detalle: string | null; accion: AccionDePlan }
  export function lineaDePlan(p: { rawPlan: string; isTrialActive: boolean; billingInterval: 'monthly' | 'annual' | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean }, ahora: number): LineaDePlan
  export function fechaLarga(iso: string): string   // 'Nov 29, 2026'
  ```
  E2E: `RAVEN_E2E_BILLING` = JSON `{ billingInterval, currentPeriodEnd, cancelAtPeriodEnd }`, expuesto como `appFlags.e2eBilling` con el mismo doble gate que `e2ePlan`. En modo e2e, `useProfile` además escucha `window` `'nest:e2e-plan'` (`CustomEvent<{ plan: string }>`) y cambia `plan`/`rawPlan`. **Sólo** con `appFlags.e2eBypass`. Es lo que deja al e2e producir el paso free → cloud que dispara el toast.

- [ ] **Step 1: Write the failing tests** de `lineaDePlan` (ahora = `Date.UTC(2026, 9, 29)`):
  - `free` → `{ titulo: 'Free', detalle: '1 project in the cloud. Cloud syncs all of them.', accion: 'upgrade' }`.
  - `cloud` monthly con fin `2026-11-29T00:00:00Z` → `{ 'Cloud · Monthly', 'Renews on Nov 29, 2026', 'manage' }`; annual → `'Cloud · Annual'`.
  - cancelando → detalle `'Cancels on Nov 29, 2026 — you keep Cloud until then.'`.
  - `cloud` sin fecha → `{ 'Cloud', null, 'manage' }`; con intervalo y sin fecha → `'Cloud · Monthly'`, `null`.
  - **Review Focus 3:** fin en el pasado → detalle `null` (no `Renews on` viejo).
  - **Review Focus 1:** `pro` con `billingInterval: null` → `{ 'Pro', null, 'manage' }`; `team` → `{ 'Team', null, accion: null }` (`tieneSuscripcionPropia('team')` es false); `enterprise` → `{ 'Enterprise', null, null }`.
  - trial activo (`rawPlan: 'free'`, `isTrialActive: true`) → `{ 'Trial', null, 'upgrade' }`.
  - `fechaLarga('2026-11-29T00:00:00Z')` → `'Nov 29, 2026'` (formatear en UTC: `timeZone: 'UTC'`, para que el test no dependa del huso).
  Y de `useProfile`: el select pide `plan, trial_started_at, billing_interval, current_period_end, cancel_at_period_end` y los mapea; sin fila → `null, null, false`.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/lib/plan-de-cuenta.test.ts src/__tests__/hooks/useProfile.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Mapa de nombres: `{ free: 'Free', cloud: 'Cloud', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' }`; uno desconocido se capitaliza. `accion`: `free`/trial → `'upgrade'`; `tieneSuscripcionPropia(rawPlan)` → `'manage'`; si no, `null`. Intervalo: `Monthly` / `Annual`.
- [ ] **Step 4: Run** los tests y los dos `tsc`. Expected: PASS / 0.
- [ ] **Step 5: Commit** `feat(cuenta): el perfil trae intervalo y fin del período, y la línea de Plan`.

---

### Task 8: `AccountPlanSection` — Plan, Usage y Machines en Settings › Account

**Files:**
- Create: `src/components/account/AccountPlanSection.tsx` (orquesta), `src/components/account/MachinesBlock.tsx` (lista + confirmación)
- Create: `src/lib/uso-de-cuenta.ts` (puro: las líneas de Usage)
- Modify: `src/components/SettingsPanel.tsx:521-546` (entre el email y `Memory settings`)
- Test: `src/__tests__/lib/uso-de-cuenta.test.ts`, `src/__tests__/components/AccountPlanSection.test.tsx`

**Interfaces:**
- Consumes: `lineaDePlan`/`fechaLarga` (Task 7), `useProfile`, `useMemory` (`state`, `error`, `cloudProjects`, `limits`, `localOnlyProjects`, `overLimit`), `window.memory.devices`/`revokeDevice` (Task 6), `abrirPortal` (`src/lib/checkout.ts`), `UpgradeModal`, `descripcionDeProyectosEnLaNube`/`soloLocales` (`src/lib/proyectos-en-la-nube.ts`), `relativeTime` (`src/lib/memories-status.ts`).
- Produces:
  ```ts
  export default function AccountPlanSection(p: { onOpenMemorySync: () => void }): JSX.Element
  // uso-de-cuenta.ts
  export type EstadoDeUso =
    | { tipo: 'apagado' }                // 'Cloud sync is off.' + 'Turn on in Memory settings ›'
    | { tipo: 'beta' }                   // 'Cloud sync is invite-only during the beta.'
    | { tipo: 'conectado'; proyectos: string | null; soloLocales: number }
  export function estadoDeUso(m: { state: string; error: string | null; cloudProjects: ProyectoEnLaNube[] | null; maxProjects: number | null; localOnly: ProyectoEnLaNube[]; overLimit: boolean }): EstadoDeUso
  ```
  `onOpenMemorySync` lo cablea Task 9. Mientras tanto `SettingsPanel` pasa `() => onOpenMemories?.('settings')`.

- [ ] **Step 1: Write the failing tests** de `estadoDeUso`: `state: 'error', error: 'not_in_beta'` → `beta`; `disconnected` → `apagado`; conectado sin roster → `proyectos: null`; con roster y tope 1 → `proyectos: '1 of 1 · raven-nest'`; `soloLocales` cuenta los de `localOnly` que no están en el roster.
- [ ] **Step 2: Write the failing component tests** (mocks de supabase y `window.memory` como en `CloudMemoryCard.test.tsx`; perfil fingido mockeando `useProfile`):
  - Free → `Free`, el detalle, botón `Upgrade` que abre `UpgradeModal`.
  - Cloud renovando / cancelando / sin fecha → los textos de Task 7 y `Manage subscription` → llama `abrirPortal`; un error del portal se muestra en una línea `text-destructive`.
  - Cargando (`loading: true`) → `data-testid="plan-cargando"` y **no** aparece `Free`.
  - Usage: `Projects in the cloud` `1 of 1 · raven-nest`; con 2 solo locales → `2 local only — Keep syncing in Memory settings ›`, y el click llama a `onOpenMemorySync`; sin solo locales no aparece; `Machines` `3 connected`.
  - Sync apagado → `Cloud sync is off.` + `Turn on in Memory settings ›`, y no se llama `window.memory.devices`. Beta → `Cloud sync is invite-only during the beta.`
  - Machines: `Gero-PC · Windows · This machine` sin botón; `MacBook · macOS · last seen 3d ago` con `Disconnect`; `never` si `lastSeenAt: null`; el pie fijo.
  - Confirmación: `Disconnect` → `Disconnect MacBook?` · `Cancel` · `Disconnect`; Cancel vuelve sin llamar.
  - **Review Focus 5:** confirmar dos veces seguidas → `revokeDevice` llamado **una** vez; el botón queda `disabled` mientras vuela; al volver ok la máquina sale de la lista.
  - Error al desconectar → `Couldn't disconnect MacBook. Try again.` y la fila sigue. `not_found` → vuelve a pedir `devices()`.
  - Error al cargar → `Couldn't load your machines.` + `Retry` (vuelve a pedir), y Usage sigue visible.
  - **Review Focus 2:** la fila con `current: true` nunca muestra `Disconnect`, aunque sea la única.
- [ ] **Step 3: Run** `npx vitest run src/__tests__/lib/uso-de-cuenta.test.ts src/__tests__/components/AccountPlanSection.test.tsx`. Expected: FAIL.
- [ ] **Step 4: Implement.** Títulos `Plan` · `Usage` · `Machines` con el mismo estilo de subtítulo que las secciones de `SettingsPanel` (utilidades, sin clases nuevas). Las filas reusan `SettingRow` (`src/components/memories/settings/SettingRow.tsx`). Plataforma legible: `darwin|mac*` → `macOS`, `win*` → `Windows`, `linux` → `Linux`, otra → tal cual, `null` → se omite el segmento. `devices()` se pide al montar y cuando `useMemory().state` pasa a conectado. Si `abrirPortal()` vuelve con `code: 'no_subscription'` (Task 4), se muestra el error y se llama `profile.recargar()`. Cuando Stripe borra el customer también borra la suscripción, y el `deleted` del webhook deja el plan en `free`: la relectura muestra `Upgrade`. Test: portal con `no_subscription` → `recargar` llamado una vez.
- [ ] **Step 5: Insert** `<AccountPlanSection onOpenMemorySync={() => onOpenMemories?.('settings')} />` en `SettingsPanel` después de `sp-email`.
- [ ] **Step 6: Run** los tests, `src/__tests__/components/SettingsPanel.test.tsx`, `la-app-es-en-ingles` y los dos `tsc`. Expected: PASS / 0.
- [ ] **Step 7: Commit** `feat(cuenta): Plan, Usage y Machines en Settings › Account`.

---

### Task 9: Navegación — Keep syncing abre Sync, y Plan & billing abre Account

**Files:**
- Modify: `src/App.tsx:255-271` (`abrirMemories` con sección; `pedidoDeCuenta` nuevo), `src/App.tsx:2219-2235` (props a `MemoriesWorkspace`)
- Modify: `src/hooks/useMemoryTabs.ts` (el pedido trae sección)
- Modify: `src/components/Sidebar.tsx` (pasa `pedidoDeCuenta` a `SettingsPanel`, y el tipo de `onMemoriesOpen`)
- Modify: `src/components/SettingsPanel.tsx` (prop `pedidoDeCuenta?: number`: al subir, `setOpen(true)` + `setSeccionActiva('account')`; `onOpenMemories` acepta sección)
- Modify: `src/components/MemoriesWorkspace.tsx`, `src/components/MemorySettingsTab.tsx` (prop `onPlanYFacturacion?: () => void` hasta `CloudMemoryCard`)
- Modify: `src/components/CloudMemoryCard.tsx` (sale `Manage subscription` y su estado; entra el link `Plan & billing ›`)
- Modify: `src/components/account/AccountPlanSection.tsx` (cablear `onOpenMemorySync` a `onOpenMemories('settings', 'sync')`)
- Test: `src/__tests__/hooks/useMemoryTabs.test.ts` (o el existente), `src/__tests__/components/CloudMemoryCard.test.tsx`, `src/__tests__/components/SettingsPanel.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // App / Sidebar / SettingsPanel
  onOpenMemories?: (vista?: 'memorias' | 'settings', seccion?: SeccionDeSettings) => void
  // useMemoryTabs(conHilo, pedidoDeSettings, pedidoDelGrafo, seccionPedida?: SeccionDeSettings)
  //   cada pedido nuevo despacha { type: 'openSettings', section: seccionPedida }
  // MemoriesWorkspace prop: seccionDeSettings?: SeccionDeSettings; onPlanYFacturacion?: () => void
  // SettingsPanel prop: pedidoDeCuenta?: number
  ```
  App: `abrirPlanYFacturacion = () => { setMemoriesOpen(false); setPedidoDeCuenta(n => n + 1) }`.

- [ ] **Step 1: Write the failing tests:**
  - `useMemoryTabs`: con una pestaña Settings abierta en `encryption`, un pedido nuevo con `seccionPedida: 'sync'` la deja en `sync`; un pedido sin sección conserva `encryption` (lo de hoy).
  - `CloudMemoryCard` con plan `cloud`: no hay botón `Manage subscription`; hay un botón/link `Plan & billing ›` que llama `onPlanYFacturacion`; con `plan_required` sigue el `Upgrade`. Actualizar los tests existentes que esperaban `Manage subscription` en la card.
  - `SettingsPanel`: subir `pedidoDeCuenta` abre el panel con la sección Account activa.
- [ ] **Step 2: Run** los tres. Expected: FAIL.
- [ ] **Step 3: Implement.** `abrirMemories` guarda `seccionDeSettings` en estado junto al contador. Mantener la defensa de "sólo el literal `'settings'`" (`App.tsx:265`). `Plan & billing ›` sólo se muestra si `tieneSuscripcionPropia(plan)` o el plan es `free` (para Free es el camino a ver su plan). Mismo `variant="link"` que el resto de los links de settings.
- [ ] **Step 4: Run** los tests de Task 8 y 9, `la-app-es-en-ingles` y los dos `tsc`. Expected: PASS / 0.
- [ ] **Step 5: Commit** `feat(cuenta): Keep syncing abre Memory settings › Sync y Plan & billing abre Account`.

---

### Task 10: e2e — Account, toast de Cloud y Keep syncing en la app real

**Files:**
- Modify: `e2e/04-contraste.spec.ts` (pantallas nuevas)
- Modify: `e2e/03-memories-in-app.spec.ts` (test funcional de Account)
- Create (si conviene compartir): `e2e/helpers/fingir-cuenta.ts`

**Interfaces:**
- Consumes: `RAVEN_E2E_PLAN`, `RAVEN_E2E_BILLING` y el evento `'nest:e2e-plan'` (Task 7). Handlers fingidos de `memory:status`, `memory:doctor` y `memory:devices` desde `h.app.evaluate`, con el patrón de `fingirFreeConUnProyecto` (`e2e/03-memories-in-app.spec.ts:434`).
- Produces: `fingirCloudSobreElTope(h)` (status conectado con 2 proyectos en la nube, `limits.max_projects: 1`, `overLimit: true`, `keptProjectKey`) y `fingirMaquinas(h)` (3 máquinas, una `current`).

- [ ] **Step 1: e2e/03, test nuevo `Account muestra Cloud, el uso y las máquinas`:** launch con `RAVEN_E2E_PLAN=cloud` y `RAVEN_E2E_BILLING={"billingInterval":"monthly","currentPeriodEnd":"2026-11-29T00:00:00Z","cancelAtPeriodEnd":false}`; abrir Settings → ver `Cloud · Monthly`, `Renews on Nov 29, 2026`, `Manage subscription`, `3 connected`, `This machine`; `Disconnect` en otra → `Disconnect MacBook?` → `Cancel`. Click en `… local only — Keep syncing in Memory settings ›` → overlay con heading `Sync` y la fila `Keep syncing`.
- [ ] **Step 2: e2e/04, pantallas nuevas en `pantallas`:** `'account-cloud'` (Settings abierto con el fingido de Cloud + máquinas + la confirmación de Disconnect abierta), `'memory-settings-keep-syncing'` (Sync con `overLimit`) y `'toast-cloud'` (arranca en `free`, `page.evaluate(() => window.dispatchEvent(new CustomEvent('nest:e2e-plan', { detail: { plan: 'cloud' } })))` y espera `Cloud is active — syncing all your projects.`).
- [ ] **Step 3: Build y correr headless:** `npm run build && npx playwright test e2e/03-memories-in-app.spec.ts e2e/04-contraste.spec.ts`. Expected: todo verde, 0 ofensores de contraste.
- [ ] **Step 4: Commit** `test(e2e): Account, el toast de Cloud y Keep syncing en la app real`.

---

### Task 11: Runbook y handoff

**Files:**
- Modify: `docs/RUNBOOK-PAGAR-CLOUD.md`
- Modify: `docs/HANDOFF-2026-10-20-memories-obsidian.md` (addendum)

- [ ] **Step 1: Runbook**, sección nueva "2b-3", cada paso con su OK de Gero: aplicar `20261029000000_profiles_billing_period.sql`; deploy de `stripe-webhook`, `stripe-checkout`, `stripe-portal`, `admin-api`; `supabase secrets set PLAN_SYNC_URL=… PLAN_SYNC_SECRET=…` (ahora también los usa admin-api: son secrets del proyecto, ya quedan para todas las functions); deploy del servidor en Railway. Smoke contra Supabase local: update de `billing_interval` con el JWT de un usuario → no cambia; un `checkout.session.completed` de prueba deja las tres columnas; `PUT /plan` desde el back-office → el servidor recibe el plan; customer borrado en el sandbox → checkout crea la sesión con email. Repetir el bloqueante: no mergear a main sin secrets de prod y servidor nuevo.
- [ ] **Step 2: Addendum del handoff:** commits de 2b-3, qué quedó verificado (con números) y qué no (el smoke).
- [ ] **Step 3: Commit** `docs(runbook): salida de 2b-3 junto con la de 2b-2`.
