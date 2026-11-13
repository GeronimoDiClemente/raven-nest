# Pagar Cloud con Stripe (2b-2) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un usuario Free pague Cloud (US$ 10/mes o US$ 96/año) desde la app, vuelva a Nest y la nube le sincronice todos sus proyectos sin intervención manual; y que al cancelar vuelva a Free eligiendo qué proyecto sigue sincronizando.

**Architecture:** Tres piezas que hoy no se hablan quedan conectadas. Supabase: `stripe-checkout` se endurece (JWT, precio desde secrets, sin trial), nace `stripe-portal`, y `stripe-webhook` mapea los precios de Cloud y, después de escribir `profiles`, le avisa al servidor de sync por `POST /internal/plan` firmado con HMAC. Servidor de sync: aplica el aviso (plan + allowlist), relee el plan al registrar un device como red de seguridad (sólo sube), y con más proyectos que el tope deja sincronizar sólo los "permitidos" (`kept_project_key` o los más viejos), con `POST /v1/projects/keep` y dos campos nuevos en `status`. App: el modal cobra mensual/anual o abre el portal, un toast avisa la activación y pide un status nuevo, y Settings › Sync muestra `Keep syncing` cuando el plan quedó por debajo de lo que hay en la nube.

**Tech Stack:** Edge functions Deno (Supabase) con módulos puros testeados con Vitest en Node. Servidor Node + `pg` + Vitest contra Postgres real. App Electron + Vite + React 18.3 + TypeScript, Tailwind v4 sin preflight + shadcn, Vitest + Testing Library (jsdom), Playwright headless contra `dist/`.

**Spec:** `docs/superpowers/specs/2026-10-21-pagar-cloud-stripe-design.md` (commit `3f8f143`). Manda el spec; donde es ambiguo o choca con el código, manda la lista **Decisiones** de abajo.

## Decisiones (donde el spec no alcanza)

- **D1 — "El más viejo" es `projects.id`, no `projects.created_at`.** El spec §4.7 ordena por `projects.created_at`, pero **esa columna no existe** (`server/migrations/001_init.sql`: `projects` tiene `id bigserial`, sin `created_at`). `id` es un `bigserial` que se asigna al insertar y los altas de proyecto de una cuenta ya corren serializadas bajo el lock `project-limit:<user>` (`push.ts`), así que es el orden de alta. La migración 011 sólo agrega `users.kept_project_key`.
- **D2 — El roster de `status` sale ordenado por `id`** (antes `order by project_key`). Es lo que le deja a la app saber "el más viejo" para el valor por defecto del select (`kept_project_key ?? roster[0]`) sin un campo nuevo. Ningún test ni cliente depende del orden alfabético (los tests usan `arrayContaining`/`find`).
- **D3 — `status.kept_project_key` es el guardado sólo si sigue siendo un proyecto propio**; si no, `null` (así la app cae al más viejo, igual que la regla del push).
- **D4 — La red de seguridad del registro (§4.6) sólo escribe si `users.plan` actual NO es pago.** El spec dice "si el plan leído es pago, se escribe `users.plan`" y también "sólo sube, nunca baja". Con un `enterprise` puesto a mano y `profiles.plan = 'cloud'`, escribir sería bajar. Regla: plan leído pago **y** plan actual no pago → se escribe. La allowlist se agrega siempre que el leído sea pago.
- **D5 — `PLAN_SYNC_URL` es la BASE del servicio** (p. ej. `https://sync.nestmux.com`); el webhook le agrega `/internal/plan`.
- **D6 — `/internal/plan` valida `user_id` como uuid** (400 `invalid_user_id`), igual que `UUID_RE` en `http.ts`: sin eso un id roto llega a Postgres como 22P02 y sale 500. Body que no es JSON → 400 `bad_json`. Tope de cuerpo: 64 KiB.
- **D7 — Body ilegible en `stripe-checkout`** → 400 `invalid_interval` (no hay intervalo que leer). El orden de chequeos es: JWT (401) → intervalo (400) → precio del intervalo en secrets (503) → ya suscripto (409).
- **D8 — Errores del portal** usan el mismo copy genérico del checkout (`Couldn't reach checkout. Check your connection and try again.`): el spec no da otro y el portal es parte del mismo flujo de cobro.
- **D9 — Segundo IPC nuevo: `memory:refreshStatus`.** El spec §4.8 pide "pedir un status nuevo al daemon" al cambiar de plan y sólo nombra `memory:keepProject`. No hay hoy ningún IPC que fuerce un `status()`; se agrega uno, que además emite el evento `memory:status` para que `useMemory` se refresque.
- **D10 — `Manage subscription` en Settings › Sync** va en el control de la fila `Cloud sync`, antes de `Turn off`/`Connect`, para `cloud` y `pro` (spec: "la fila de plan o donde hoy está Upgrade"; el lugar definitivo es de 2b-3).
- **D11 — El toast vive en `App.tsx`** (la única instancia de `useProfile` que está siempre montada). No hay servicio de toasts en la app: componente propio `CloudActivadoToast` (shadcn + utilidades, `role="status"`, se cierra solo a los 8 s). La primera lectura del perfil NO cuenta como cambio (Review Focus 1).
- **D12 — `admin-api`**: `PLANES_VALIDOS` y `ETIQUETAS` suman `cloud`. El "monto mensual = anual / 12" del spec §4.9 ya lo hace `montoMensualCents` a partir del `unit_amount` e `interval` de la suscripción (no de IDs de precio): se fija con un test, sin código nuevo.
- **D13 — Firma compartida por vector fijo.** El firmador (Deno/WebCrypto, `aviso-de-plan.ts`) y el verificador (Node, `plan-sync.ts`) no comparten código; los dos tests fijan el MISMO vector: secreto `test-secret`, `t = 1700000000`, cuerpo `{"user_id":"00000000-0000-4000-8000-000000000001","plan":"cloud"}` → `v1 = 8b149a93534d60ed7fb23268c484647e3a5a939afa9a2fe94402be2161e7fee8` (calculado con `node:crypto` el 21-10).
- **D14 — `keepProject` vive en el daemon** (no en `main.ts`): usa su `fetchWithTimeout`, su token y su store, y así se testea con el `fetchImpl` falso como el resto del daemon. Al volver ok devuelve a la cola lo retenido por `project_limit_reached` (el proyecto recién elegido lo tenía retenido), pide `status()` y agenda un push.

**Contradicciones spec ↔ código (avisarle a Gero):**
1. §4.7 `projects.created_at` no existe (D1).
2. §4.7 pide que la app muestre "el más viejo" sin decir cómo lo sabe: el roster venía en orden alfabético (D2).
3. §4.6 "si es pago se escribe" choca con "sólo sube" para planes pagos distintos (D4).
4. §4.8 necesita un segundo IPC (D9).
5. §4.6 asume que la RLS de `profiles` deja leer `plan` con el JWT del usuario: no se puede verificar desde este repo sin Supabase; si la lectura falla, la red de seguridad no hace nada y el registro sigue igual (best effort), y el smoke de §7.3 lo confirma.
6. `admin-api` deja setear `plan = 'cloud'` a mano (D12), pero ese camino NO avisa al servidor de sync (fuera de alcance; anotarlo para 2b-3).

## Global Constraints

- Copy de la UI **en inglés**, exactamente el de spec §4.10 (tabla de abajo). Ningún literal de string de 4–200 caracteres en `src/**` (fuera de `__tests__` y `src/tutorial/`) puede tener `áéíóúñ¿¡` (`src/__tests__/la-app-es-en-ingles.test.ts`). **Los comentarios del código van en español**, como el código que los rodea.
- **Componentes nuevos con shadcn + utilidades Tailwind**, nunca clases nuevas en `global.css`. Tailwind **sin preflight**: no importar `"tailwindcss"` entero. Colores sólo por tokens (`text-muted-foreground`, `text-destructive`, `bg-ok`…). Las clases `upgrade-*` existentes de `UpgradeModal` se conservan; lo NUEVO adentro del modal va con utilidades.
- **Sin dependencias nuevas.** Si por algo hay que correr `npm install`, después correr `node .superpowers/sdd/2026-10-20-memories-estilo-obsidian/tools/restaurar-libc.mjs`.
- **Typecheck real** (los dos de CI): `npx tsc -p tsconfig.node.json --noEmit --composite false` y `npx tsc -p tsconfig.web.json --noEmit --composite false`. Baseline: 0 errores. **Nunca `tsc -b`.** Servidor: `cd server && npx tsc --noEmit`. Las edge functions (`supabase/functions/**`) no las typechequea CI: se prueban por sus módulos puros con Vitest.
- **Suite unitaria** (Node, jsdom y los de `supabase/functions`): `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts <path>` (config verificada: existe y mergea `vitest.config.ts`, que ya incluye `supabase/functions/**/__tests__/**/*.test.ts`). Suite completa al cierre de cada tarea de la app: el mismo comando sin path. No usar `npm test` (su `pretest` corre `native:node`).
- **Tests del servidor** van contra Postgres REAL (nunca mocks de la base), salvo los puros (`limits.test.ts`, `plan-sync.test.ts`, `proyectos-permitidos.test.ts`). Antes: `docker start nest-memory-pg` (si no existe, el `docker run -d --name nest-memory-pg -e POSTGRES_PASSWORD=nestmem -e POSTGRES_DB=nest_memory -p 55432:5432 postgres:16-alpine` de `server/README.md`). Desde `server/`: `npx vitest run __tests__/<archivo>`. Las migraciones corren solas en `beforeAll`. **Al terminar cada tarea de servidor: `docker stop nest-memory-pg`.** Si Docker no levanta: avisar, dejar corridos los tests puros y el `tsc` del servidor, y seguir.
- **e2e SIEMPRE headless**: nunca setear `RAVEN_E2E_SHOW=1`. Corre contra `dist/`: `npm run build` antes y el binding de Electron puesto (`npm run native:electron`). **Todo cambio de UI pasa `e2e/04-contraste.spec.ts`** antes de su commit.
- **No matar procesos `electron.exe`**: si `npm run native:*` da `EBUSY`, avisar y seguir con lo que no lo necesita.
- **Ningún secreto en git** (ni en tests: los secretos de test son literales obvios como `test-secret`). **Ninguna acción externa**: nada de llamadas a la API de Stripe, deploys, `supabase` CLI contra un proyecto remoto, Railway ni push. Spec §7 queda FUERA de este plan salvo el runbook escrito (Task 11).
- Commits **locales** en `feat/memories-settings`. Cada mensaje termina con la línea `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. `git add` **sólo los archivos de la tarea**: el árbol tiene cambios ajenos sin commitear (`.superpowers/sdd/.gitignore`, PNGs de `.superpowers/sdd/shots/`, `docs/HANDOFF-2026-10-20-memories-obsidian.md`) que no se tocan. `docs/superpowers/` está en `.gitignore`: si una tarea toca algo ahí, `git add -f`.

### Copy (spec §4.10, verbatim)

| Lugar | Texto |
|---|---|
| Toggle | `Monthly` · `Annual` |
| Precio mensual | `$10` `/mo` |
| Precio anual | `$8` `/mo` · `billed $96 yearly` |
| CTA pago | `Upgrade to Cloud` |
| CTA plan actual | `Manage subscription` |
| Error checkout | `Checkout isn't available right now — try again later.` |
| Error genérico | `Couldn't reach checkout. Check your connection and try again.` |
| Toast | `Cloud is active — syncing all your projects.` |
| Fila over limit | `Your plan syncs {max} of {n} projects.` |
| Control | `Keep syncing` |
| Página éxito (landing, fuera de este repo) | `You're on Cloud — go back to Nest.` |
| Página cancelado (landing, fuera de este repo) | `Checkout cancelled — nothing was charged.` |

## Review Focus

1. **Arrancar la app con una cuenta que YA es Cloud.** `useProfile` arranca en `plan: 'free'` con `loading: true` y después lee `cloud`: eso no es una activación. La persona espera NO ver `Cloud is active` en cada arranque. Test en Task 10 (`cambioDePlan(null, 'cloud')` y el hook ignorando lo leído mientras carga).
2. **El HMAC se calcula sobre el cuerpo CRUDO.** Un servidor que re-serializa el JSON parseado (orden de claves, espacios) rechazaría avisos legítimos y los pagos no llegarían nunca. Test en Task 4 (cuerpo con espacios y claves en otro orden, firmado tal cual, pasa).
3. **Alguien que canceló y vuelve a pagar.** Tiene `stripe_customer_id` y `stripe_subscription_id = null`, `plan = 'free'`: no es `already_subscribed` y se reusa su customer (no un segundo cliente en Stripe). Test en Task 2.
4. **Un Free con `__global__` más su único proyecto no está `over_limit`.** `__global__` no ocupa lugar (2b-1); si contara, todo Free vería `Keep syncing`. Test en Task 7.
5. **Un aviso con `user_id` que no es uuid o cuerpo que no es JSON** devuelve 400, no 500 (un 500 haría que Stripe reintente días un aviso que nunca va a funcionar… y el webhook lo trata como falla). Test en Task 4.

---

## Mapa de archivos

**Nuevos**
- Supabase: `supabase/functions/stripe-checkout/checkout.ts`, `supabase/functions/stripe-checkout/__tests__/checkout.test.ts`, `supabase/functions/stripe-portal/portal.ts`, `supabase/functions/stripe-portal/index.ts`, `supabase/functions/stripe-portal/__tests__/portal.test.ts`, `supabase/functions/stripe-webhook/aviso-de-plan.ts`, `supabase/functions/stripe-webhook/__tests__/aviso-de-plan.test.ts`.
- Servidor: `server/src/plan-sync.ts`, `server/src/proyectos-permitidos.ts`, `server/src/keep.ts`, `server/migrations/011_kept_project.sql`, `server/__tests__/plan-sync.test.ts`, `server/__tests__/plan-sync-http.test.ts`, `server/__tests__/devices-plan-de-supabase.test.ts`, `server/__tests__/proyectos-permitidos.test.ts`, `server/__tests__/proyecto-elegido.test.ts`.
- App: `src/lib/checkout.ts`, `src/lib/cambio-de-plan.ts`, `src/hooks/useAvisoDeCambioDePlan.ts`, `src/components/CloudActivadoToast.tsx`, tests `src/__tests__/lib/checkout.test.ts`, `src/__tests__/lib/cambio-de-plan.test.ts`, `src/__tests__/hooks/useAvisoDeCambioDePlan.test.tsx`, `src/__tests__/hooks/useMemory-proyecto-elegido.test.tsx`, `electron/__tests__/memory-daemon-proyecto-elegido.test.ts`.
- Docs: `docs/RUNBOOK-PAGAR-CLOUD.md`.

**Modificados**
- Supabase: `supabase/functions/stripe-checkout/index.ts`, `supabase/functions/stripe-webhook/{eventos.ts,index.ts,__tests__/eventos.test.ts}`, `supabase/functions/admin-api/{pricing.ts,__tests__/pricing.test.ts}`.
- Servidor: `server/src/{auth.ts,http.ts,devices.ts,push.ts,status.ts}`, `server/README.md`, `server/__tests__/{devices-team-sync.test.ts,http.test.ts}`.
- App: `electron/{memory-daemon.ts,main.ts,preload.ts}`, `src/types.ts`, `src/lib/stripe.ts`, `src/lib/proyectos-en-la-nube.ts`, `src/components/{UpgradeModal.tsx,CloudMemoryCard.tsx,memories/settings/CloudProjectsRow.tsx}`, `src/hooks/useMemory.ts`, `src/App.tsx`, tests `src/__tests__/components/{UpgradeModal.test.tsx,CloudProjectsRow.test.tsx,CloudMemoryCard.test.tsx}`, `src/__tests__/lib/proyectos-en-la-nube.test.ts`.

---

### Task 1: El webhook mapea los precios de Cloud desde los secrets

**Files:**
- Modify: `supabase/functions/stripe-webhook/eventos.ts` (el mapa `PRECIO_A_PLAN` líneas 8-16, `activar` ~líneas 55-66, firma de `decidir` ~línea 83 y las cuatro llamadas a `activar`)
- Modify: `supabase/functions/stripe-webhook/index.ts` (import y la llamada a `decidir`)
- Test: `supabase/functions/stripe-webhook/__tests__/eventos.test.ts`

**Interfaces:**
- Produces (`eventos.ts`):
  - `export const PRECIOS_LEGACY: Readonly<Record<string, string>>` (los seis precios de hoy, renombrado de `PRECIO_A_PLAN`).
  - `export interface PreciosDeCloudEnv { STRIPE_PRICE_CLOUD_MONTHLY?: string; STRIPE_PRICE_CLOUD_ANNUAL?: string }`
  - `export function armarPrecioAPlan(env: PreciosDeCloudEnv): Record<string, string>`
  - `export function decidir(evento: EventoStripe, precioAPlan: Readonly<Record<string, string>>, priceIdDeRespaldo?: string | null): Decision` — **el mapa pasa a ser el 2º argumento, obligatorio.**

- [ ] **Step 1: Tests que fallan.** En `eventos.test.ts`, cambiar el import a:

```ts
import { decidir, armarPrecioAPlan, PRECIOS_LEGACY } from '../eventos.ts'
```

y debajo de `const TEAM_MENSUAL = ...` sumar:

```ts
const CLOUD_MENSUAL = 'price_cloud_mensual_test'
const CLOUD_ANUAL = 'price_cloud_anual_test'
// El mapa que arma el shell en producción: los precios viejos más los dos de Cloud.
const MAPA = armarPrecioAPlan({ STRIPE_PRICE_CLOUD_MONTHLY: CLOUD_MENSUAL, STRIPE_PRICE_CLOUD_ANNUAL: CLOUD_ANUAL })
```

En todo el archivo, cada llamada existente pasa el mapa como **segundo** argumento: `decidir(X)` → `decidir(X, MAPA)` y `decidir(X, PRO_MENSUAL)` → `decidir(X, MAPA, PRO_MENSUAL)`. Son: `decidir(invoicePagada())`, `decidir(e)` (cuatro veces: sin user_id, precio desconocido, deleted, cambio de precio), `decidir({ type: 'payment_intent.succeeded', … })`, `decidir(sesion(), PRO_MENSUAL)`, `decidir(sesion())`, `decidir(sesion({ metadata: {} }), PRO_MENSUAL)`, `decidir(sub('active'))`, `decidir(sub('trialing'))`, `decidir(sub('past_due'))`. Al final del archivo:

```ts
// Spec 2b-2 §4.4: los precios de Cloud viven en secrets, no en el código.
describe('precios de Cloud (2b-2)', () => {
  it('los dos precios de Cloud activan el plan cloud', () => {
    for (const precio of [CLOUD_MENSUAL, CLOUD_ANUAL]) {
      const d = decidir(invoicePagada({ lines: { data: [{ price: { id: precio } }] } }), MAPA)
      expect(d).toEqual({ tipo: 'activar', userId: 'u-1', plan: 'cloud', customerId: 'cus_1', subscriptionId: 'sub_1' })
    }
  })

  it('checkout.session.completed con el anual de Cloud resuelto por el shell', () => {
    const e = { type: 'checkout.session.completed', data: { object: { customer: 'cus_1', subscription: 'sub_1', metadata: { user_id: 'u-1' } } } }
    const d = decidir(e, MAPA, CLOUD_ANUAL)
    expect(d.tipo === 'activar' && d.plan).toBe('cloud')
  })

  it('un precio desconocido sigue ignorado aunque haya precios de Cloud', () => {
    const d = decidir(invoicePagada({ lines: { data: [{ price: { id: 'price_otro' } }] } }), MAPA)
    expect(d.tipo).toBe('ignorar')
  })

  it('los precios legacy siguen intactos', () => {
    expect(MAPA[PRO_MENSUAL]).toBe('pro')
    expect(MAPA[TEAM_MENSUAL]).toBe('team')
    for (const [precio, plan] of Object.entries(PRECIOS_LEGACY)) expect(MAPA[precio]).toBe(plan)
  })

  it('sin secrets (o vacíos) no se mapea ningún precio de Cloud', () => {
    expect(armarPrecioAPlan({})).toEqual({ ...PRECIOS_LEGACY })
    expect(armarPrecioAPlan({ STRIPE_PRICE_CLOUD_MONTHLY: '', STRIPE_PRICE_CLOUD_ANNUAL: '  ' })).toEqual({ ...PRECIOS_LEGACY })
  })

  it('un secret no puede pisar un precio legacy', () => {
    const mapa = armarPrecioAPlan({ STRIPE_PRICE_CLOUD_MONTHLY: PRO_MENSUAL })
    expect(mapa[PRO_MENSUAL]).toBe('pro')
  })
})
```

- [ ] **Step 2:** `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts supabase/functions/stripe-webhook/__tests__/eventos.test.ts` → FAIL (`armarPrecioAPlan is not a function` / import de `PRECIOS_LEGACY`).

- [ ] **Step 3: El mapa.** En `eventos.ts`, reemplazar el bloque `/** Price ID de Stripe -> plan de Nest. */ export const PRECIO_A_PLAN … }` por:

```ts
/**
 * Los precios viejos de Pro/Team, fijos en el código como siempre. Los de Cloud NO van acá:
 * viven en los secrets de la función (spec 2b-2 §4.1) y se suman con `armarPrecioAPlan`.
 */
export const PRECIOS_LEGACY: Readonly<Record<string, string>> = {
  price_1TJmwsJarRYFmNbKh7G6JXnF: 'pro',   // pro mensual $20
  price_1TJmy8JarRYFmNbKeScj4mwX: 'pro',   // pro anual $204 (legacy 15% off)
  price_1TbX45JarRYFmNbKXYSBT3Yn: 'pro',   // pro anual $180 (actual 25% off)
  price_1TJmyRJarRYFmNbKeiOLrXss: 'team',  // team mensual $35
  price_1TJmyyJarRYFmNbKq9mRgrdz: 'team',  // team anual $348 (legacy 15% off)
  price_1TbX66JarRYFmNbKqTA1AoEA: 'team',  // team anual $312 (actual 25% off)
}

export interface PreciosDeCloudEnv {
  STRIPE_PRICE_CLOUD_MONTHLY?: string
  STRIPE_PRICE_CLOUD_ANNUAL?: string
}

/**
 * Price ID de Stripe -> plan de Nest: los legacy más los dos de Cloud (spec 2b-2 §4.4).
 *
 * Un secret vacío no mapea nada: `''` como clave haría "activar" un evento sin precio. Y un
 * secret no pisa un precio legacy: un copy-paste equivocado en el dashboard le daría Cloud a
 * quien compró Team.
 */
export function armarPrecioAPlan(env: PreciosDeCloudEnv): Record<string, string> {
  const mapa: Record<string, string> = { ...PRECIOS_LEGACY }
  for (const precio of [env.STRIPE_PRICE_CLOUD_MONTHLY, env.STRIPE_PRICE_CLOUD_ANNUAL]) {
    const id = precio?.trim()
    if (id && !(id in mapa)) mapa[id] = 'cloud'
  }
  return mapa
}
```

En `activar`, la firma pasa a `function activar(d: DatosActivacion, precioAPlan: Readonly<Record<string, string>>): Decision` y la línea del plan a `const plan = d.priceId ? precioAPlan[d.priceId] : undefined`; en su comentario, `PRECIO_A_PLAN` → `el mapa`. La firma de `decidir` pasa a:

```ts
export function decidir(
  evento: EventoStripe,
  precioAPlan: Readonly<Record<string, string>>,
  priceIdDeRespaldo: string | null = null,
): Decision {
```

y sus tres `return activar({...})` pasan a `return activar({...}, precioAPlan)`.

- [ ] **Step 4: El shell.** En `stripe-webhook/index.ts`: el import pasa a `import { armarPrecioAPlan, decidir, type EventoStripe } from './eventos.ts'` y la línea de la decisión a:

```ts
  // El mapa se arma por request: un secret seteado después del deploy aplica sin redeploy.
  const precioAPlan = armarPrecioAPlan({
    STRIPE_PRICE_CLOUD_MONTHLY: Deno.env.get('STRIPE_PRICE_CLOUD_MONTHLY'),
    STRIPE_PRICE_CLOUD_ANNUAL: Deno.env.get('STRIPE_PRICE_CLOUD_ANNUAL'),
  })
  const decision = decidir(event as unknown as EventoStripe, precioAPlan, priceIdDeRespaldo)
```

En el comentario de cabecera del archivo sumar `//   supabase secrets set STRIPE_PRICE_CLOUD_MONTHLY=price_... STRIPE_PRICE_CLOUD_ANNUAL=price_...`.

- [ ] **Step 5:** `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts supabase/functions/stripe-webhook/__tests__/eventos.test.ts` → PASS. `rg -n "PRECIO_A_PLAN" supabase` → sin resultados.

- [ ] **Step 6: Commit.**

```bash
git add supabase/functions/stripe-webhook/eventos.ts supabase/functions/stripe-webhook/index.ts supabase/functions/stripe-webhook/__tests__/eventos.test.ts
git commit -m "feat(stripe): el webhook mapea los precios de Cloud desde los secrets

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `stripe-checkout` endurecido (JWT, intervalo, sin trial)

**Files:**
- Create: `supabase/functions/stripe-checkout/checkout.ts`
- Modify (reescritura completa): `supabase/functions/stripe-checkout/index.ts`
- Test: `supabase/functions/stripe-checkout/__tests__/checkout.test.ts`

**Interfaces:**
- Produces (`checkout.ts`, puro, sin imports):
  - `export type Intervalo = 'monthly' | 'annual'`
  - `export const PLANES_PAGOS: readonly string[]` = `['cloud', 'pro', 'team', 'enterprise']`
  - `export const URL_EXITO = 'https://nestmux.com/checkout/success'`, `export const URL_CANCELADO = 'https://nestmux.com/checkout/cancelled'`
  - `export function jwtDelHeader(header: string | null): string | null`
  - `export interface PerfilDeCobro { plan: string | null; stripe_customer_id: string | null; stripe_subscription_id: string | null }`
  - `export interface ParametrosDeSesion { mode: 'subscription'; line_items: Array<{ price: string; quantity: 1 }>; metadata: { user_id: string }; subscription_data: { metadata: { user_id: string } }; success_url: string; cancel_url: string; customer?: string; customer_email?: string }`
  - `export type DecisionDeCheckout = { ok: true; sesion: ParametrosDeSesion } | { ok: false; status: 400 | 409 | 503; error: 'invalid_interval' | 'already_subscribed' | 'checkout_unavailable' }`
  - `export function decidirCheckout(e: { body: unknown; precios: { monthly?: string; annual?: string }; perfil: PerfilDeCobro | null; userId: string; email: string | null }): DecisionDeCheckout`
- Produces (wire): `POST stripe-checkout` con `Authorization: Bearer <JWT>` y body `{ interval }` → `200 { url }` | `401 { error: 'unauthorized' }` | `400/409/503 { error }` | `502 { error: 'stripe_error' }`.

- [ ] **Step 1: Tests que fallan.** Crear `supabase/functions/stripe-checkout/__tests__/checkout.test.ts`:

```ts
// Spec 2b-2 §4.2: la decisión del checkout, pura. El shell (index.ts) sólo autentica, lee el
// perfil y le pasa esto a Stripe.
import { describe, it, expect } from 'vitest'
import { decidirCheckout, jwtDelHeader, URL_CANCELADO, URL_EXITO, type PerfilDeCobro } from '../checkout.ts'

const PRECIOS = { monthly: 'price_m', annual: 'price_a' }
const SIN_PERFIL: PerfilDeCobro = { plan: 'free', stripe_customer_id: null, stripe_subscription_id: null }
const base = (over: Partial<Parameters<typeof decidirCheckout>[0]> = {}) =>
  decidirCheckout({ body: { interval: 'monthly' }, precios: PRECIOS, perfil: SIN_PERFIL, userId: 'u-1', email: 'gero@x.com', ...over })

describe('decidirCheckout', () => {
  it('el intervalo elige el precio de los secrets', () => {
    const m = base()
    const a = base({ body: { interval: 'annual' } })
    expect(m.ok && m.sesion.line_items).toEqual([{ price: 'price_m', quantity: 1 }])
    expect(a.ok && a.sesion.line_items).toEqual([{ price: 'price_a', quantity: 1 }])
  })

  it('un intervalo inválido (o un body que no es objeto) es 400 invalid_interval', () => {
    for (const body of [{ interval: 'weekly' }, {}, null, 'monthly', { interval: 1 }, { priceId: 'price_x' }]) {
      expect(base({ body })).toEqual({ ok: false, status: 400, error: 'invalid_interval' })
    }
  })

  it('sin el secret del precio pedido es 503 checkout_unavailable', () => {
    expect(base({ precios: {} })).toEqual({ ok: false, status: 503, error: 'checkout_unavailable' })
    expect(base({ precios: { monthly: 'price_m', annual: '' }, body: { interval: 'annual' } }))
      .toEqual({ ok: false, status: 503, error: 'checkout_unavailable' })
  })

  it('ya suscripto (suscripción viva y plan pago) es 409 already_subscribed', () => {
    for (const plan of ['cloud', 'pro', 'team', 'enterprise']) {
      expect(base({ perfil: { plan, stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' } }))
        .toEqual({ ok: false, status: 409, error: 'already_subscribed' })
    }
  })

  // Review Focus 3: canceló (sub en null, plan free) y vuelve a pagar con el MISMO customer.
  it('quien canceló y vuelve no es already_subscribed y reusa su customer', () => {
    const d = base({ perfil: { plan: 'free', stripe_customer_id: 'cus_1', stripe_subscription_id: null } })
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.sesion.customer).toBe('cus_1')
    expect(d.sesion.customer_email).toBeUndefined()
  })

  it('una sub guardada con plan free (webhook a medias) no bloquea el pago', () => {
    expect(base({ perfil: { plan: 'free', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_viejo' } }).ok).toBe(true)
  })

  it('sin customer usa el email del JWT; sin email, ninguno de los dos', () => {
    const d = base()
    expect(d.ok && d.sesion.customer_email).toBe('gero@x.com')
    expect(d.ok && 'customer' in d.sesion).toBe(false)
    const sinEmail = base({ email: null, perfil: null })
    expect(sinEmail.ok && 'customer_email' in sinEmail.sesion).toBe(false)
  })

  it('sin trial, cantidad 1, metadata con el user_id en la sesión y en la suscripción, URLs de nestmux', () => {
    const d = base()
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.sesion).toMatchObject({
      mode: 'subscription',
      metadata: { user_id: 'u-1' },
      subscription_data: { metadata: { user_id: 'u-1' } },
      success_url: URL_EXITO,
      cancel_url: URL_CANCELADO,
    })
    expect(JSON.stringify(d.sesion)).not.toContain('trial')
    expect(URL_EXITO).toBe('https://nestmux.com/checkout/success')
    expect(URL_CANCELADO).toBe('https://nestmux.com/checkout/cancelled')
  })
})

describe('jwtDelHeader', () => {
  it('saca el token del Bearer; sin header o vacío, null', () => {
    expect(jwtDelHeader('Bearer abc.def.ghi')).toBe('abc.def.ghi')
    expect(jwtDelHeader('bearer   abc')).toBe('abc')
    expect(jwtDelHeader(null)).toBeNull()
    expect(jwtDelHeader('Bearer ')).toBeNull()
    expect(jwtDelHeader('Basic abc')).toBeNull()
  })
})
```

- [ ] **Step 2:** `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts supabase/functions/stripe-checkout/__tests__/checkout.test.ts` → FAIL (no existe `../checkout.ts`).

- [ ] **Step 3: El módulo puro.** Crear `supabase/functions/stripe-checkout/checkout.ts`:

```ts
/**
 * Spec 2b-2 §4.2: qué sesión de Stripe se crea, o por qué no. Módulo puro —sin SDK, sin red,
 * sin Deno— para testearlo con vitest en Node, igual que `stripe-webhook/eventos.ts`.
 *
 * La identidad sale SÓLO del JWT y el precio SÓLO de los secrets: el cliente ya no puede
 * pagar por otro (`userId` del body) ni elegir un precio arbitrario (`priceId` del body).
 */

export type Intervalo = 'monthly' | 'annual'

/** Planes que se cobran. Misma lista que `PLANES_PAGOS` del servidor de sync. */
export const PLANES_PAGOS: readonly string[] = ['cloud', 'pro', 'team', 'enterprise']

export const URL_EXITO = 'https://nestmux.com/checkout/success'
export const URL_CANCELADO = 'https://nestmux.com/checkout/cancelled'

/** El token de `Authorization: Bearer <jwt>`, o null. */
export function jwtDelHeader(header: string | null): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '')
  const token = m?.[1]?.trim()
  return token ? token : null
}

export interface PerfilDeCobro {
  plan: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
}

export interface ParametrosDeSesion {
  mode: 'subscription'
  line_items: Array<{ price: string; quantity: 1 }>
  metadata: { user_id: string }
  subscription_data: { metadata: { user_id: string } }
  success_url: string
  cancel_url: string
  customer?: string
  customer_email?: string
}

export type DecisionDeCheckout =
  | { ok: true; sesion: ParametrosDeSesion }
  | { ok: false; status: 400 | 409 | 503; error: 'invalid_interval' | 'already_subscribed' | 'checkout_unavailable' }

function leerIntervalo(body: unknown): Intervalo | null {
  if (!body || typeof body !== 'object') return null
  const i = (body as { interval?: unknown }).interval
  return i === 'monthly' || i === 'annual' ? i : null
}

export function decidirCheckout(e: {
  body: unknown
  precios: { monthly?: string; annual?: string }
  perfil: PerfilDeCobro | null
  userId: string
  email: string | null
}): DecisionDeCheckout {
  const intervalo = leerIntervalo(e.body)
  if (!intervalo) return { ok: false, status: 400, error: 'invalid_interval' }

  // Sin el secret el botón no puede cobrar nada correcto: 503, configuración faltante.
  const precio = e.precios[intervalo]?.trim()
  if (!precio) return { ok: false, status: 503, error: 'checkout_unavailable' }

  // Doble cobro: hace falta la suscripción Y un plan pago. Una sub guardada con plan free es
  // un webhook a medias, y bloquear ahí dejaría a la persona sin poder pagar.
  const p = e.perfil
  if (p?.stripe_subscription_id && p.plan && PLANES_PAGOS.includes(p.plan)) {
    return { ok: false, status: 409, error: 'already_subscribed' }
  }

  const sesion: ParametrosDeSesion = {
    mode: 'subscription',
    line_items: [{ price: precio, quantity: 1 }],
    // Sin `trial_period_days` (decisión 1 de Gero): Free con un proyecto ya es la prueba.
    metadata: { user_id: e.userId },
    subscription_data: { metadata: { user_id: e.userId } },
    success_url: URL_EXITO,
    cancel_url: URL_CANCELADO,
  }
  // Reusar el customer evita un segundo cliente en Stripe para quien canceló y vuelve.
  if (p?.stripe_customer_id) sesion.customer = p.stripe_customer_id
  else if (e.email) sesion.customer_email = e.email
  return { ok: true, sesion }
}
```

- [ ] **Step 4:** el test del Step 2 → PASS.

- [ ] **Step 5: El shell.** Reemplazar **todo** `supabase/functions/stripe-checkout/index.ts` por:

```ts
// Supabase Edge Function — crea la sesión de Stripe Checkout de Cloud (spec 2b-2 §4.2).
// Deploy: supabase functions deploy stripe-checkout
// Secrets:
//   supabase secrets set STRIPE_SECRET_KEY=sk_...
//   supabase secrets set STRIPE_PRICE_CLOUD_MONTHLY=price_... STRIPE_PRICE_CLOUD_ANNUAL=price_...
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.

import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno'
import { decidirCheckout, jwtDelHeader } from './checkout.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-11-20.acacia',
  httpClient: Stripe.createFetchHttpClient(),
})

// Service role: valida el JWT (auth.getUser) y lee las columnas de cobro, que el cliente no
// puede escribir (`protect_profile_billing_columns`).
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  // La identidad sale SÓLO del JWT: el body ya no trae userId ni email.
  const jwt = jwtDelHeader(req.headers.get('Authorization'))
  if (!jwt) return json(401, { error: 'unauthorized' })
  const { data: auth, error: authError } = await admin.auth.getUser(jwt)
  const user = auth?.user
  if (authError || !user) return json(401, { error: 'unauthorized' })

  let body: unknown = null
  try {
    body = await req.json()
  } catch {
    // Body ilegible: no hay intervalo que leer (D7 del plan).
  }

  const { data: perfil, error: perfilError } = await admin
    .from('profiles')
    .select('plan, stripe_customer_id, stripe_subscription_id')
    .eq('id', user.id)
    .maybeSingle()
  if (perfilError) {
    console.error('[stripe-checkout] no se pudo leer el perfil', { userId: user.id, error: perfilError.message })
    return json(500, { error: 'internal_error' })
  }

  const decision = decidirCheckout({
    body,
    precios: {
      monthly: Deno.env.get('STRIPE_PRICE_CLOUD_MONTHLY'),
      annual: Deno.env.get('STRIPE_PRICE_CLOUD_ANNUAL'),
    },
    perfil,
    userId: user.id,
    email: user.email ?? null,
  })
  if (!decision.ok) {
    if (decision.error === 'checkout_unavailable') {
      console.error('[stripe-checkout] faltan los secrets STRIPE_PRICE_CLOUD_*')
    }
    return json(decision.status, { error: decision.error })
  }

  try {
    const session = await stripe.checkout.sessions.create(decision.sesion)
    if (!session.url) return json(502, { error: 'stripe_error' })
    return json(200, { url: session.url })
  } catch (e) {
    console.error('[stripe-checkout] Stripe rechazó la sesión', { userId: user.id, error: e instanceof Error ? e.message : String(e) })
    return json(502, { error: 'stripe_error' })
  }
})
```

- [ ] **Step 6:** `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts supabase/functions` → PASS (incluye los de Task 1 y `admin-api`).

- [ ] **Step 7: Commit.**

```bash
git add supabase/functions/stripe-checkout/checkout.ts supabase/functions/stripe-checkout/index.ts supabase/functions/stripe-checkout/__tests__/checkout.test.ts
git commit -m "feat(stripe): checkout autenticado, por intervalo y sin trial

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `stripe-portal` nueva y `cloud` en el back-office

**Files:**
- Create: `supabase/functions/stripe-portal/portal.ts`, `supabase/functions/stripe-portal/index.ts`
- Modify: `supabase/functions/admin-api/pricing.ts:2` (`PLANES_VALIDOS`) y `:6-8` (`ETIQUETAS`)
- Test: `supabase/functions/stripe-portal/__tests__/portal.test.ts`, `supabase/functions/admin-api/__tests__/pricing.test.ts`

**Interfaces:**
- Consumes: `jwtDelHeader` de `../stripe-checkout/checkout.ts` (Task 2).
- Produces (`portal.ts`): `export const URL_DE_VUELTA = 'https://nestmux.com/checkout/portal-return'`; `export type DecisionDePortal = { ok: true; sesion: { customer: string; return_url: string } } | { ok: false; status: 404; error: 'no_subscription' }`; `export function decidirPortal(perfil: { stripe_customer_id: string | null } | null): DecisionDePortal`.
- Produces (wire): `POST stripe-portal` con JWT → `200 { url }` | `401` | `404 { error: 'no_subscription' }` | `502 { error: 'stripe_error' }`.
- Produces (`pricing.ts`): `PLANES_VALIDOS = ['free', 'cloud', 'pro', 'team', 'enterprise']`; `planLabel('cloud', …)` = `Cloud …`.

- [ ] **Step 1: Tests que fallan.** Crear `supabase/functions/stripe-portal/__tests__/portal.test.ts`:

```ts
// Spec 2b-2 §4.3: el portal de Stripe sólo existe para quien tiene customer.
import { describe, it, expect } from 'vitest'
import { decidirPortal, URL_DE_VUELTA } from '../portal.ts'

describe('decidirPortal', () => {
  it('con customer, una sesión que vuelve a nestmux', () => {
    expect(decidirPortal({ stripe_customer_id: 'cus_1' })).toEqual({ ok: true, sesion: { customer: 'cus_1', return_url: URL_DE_VUELTA } })
    expect(URL_DE_VUELTA).toBe('https://nestmux.com/checkout/portal-return')
  })

  it('sin customer (o sin perfil) es 404 no_subscription', () => {
    expect(decidirPortal({ stripe_customer_id: null })).toEqual({ ok: false, status: 404, error: 'no_subscription' })
    expect(decidirPortal({ stripe_customer_id: '' })).toEqual({ ok: false, status: 404, error: 'no_subscription' })
    expect(decidirPortal(null)).toEqual({ ok: false, status: 404, error: 'no_subscription' })
  })
})
```

En `admin-api/__tests__/pricing.test.ts`, reemplazar el test `'los 4 tiers son los validos'` por:

```ts
it('los tiers validos incluyen cloud (spec 2b-2 §4.9)', () => {
  expect([...PLANES_VALIDOS]).toEqual(['free', 'cloud', 'pro', 'team', 'enterprise'])
})
```

y dentro de `describe('planLabel', …)` sumar:

```ts
  it('cloud tiene su etiqueta, con el ciclo', () => {
    expect(planLabel('cloud', sub({ interval: 'year' }))).toBe('Cloud (anual)')
    expect(planLabel('cloud', null)).toBe('Cloud')
  })
```

y dentro de `describe('montoMensualCents', …)` sumar (D12: el monto ya sale del anual / 12):

```ts
  it('Cloud anual de $96 son $8 por mes', () => {
    expect(montoMensualCents(sub({ unit_amount: 9600, interval: 'year', quantity: 1 }))).toBe(800)
    expect(montoMensualCents(sub({ unit_amount: 1000, interval: 'month', quantity: 1 }))).toBe(1000)
  })
```

(`sub(...)` es el helper que ya existe arriba en ese archivo, con `status: 'active'` por defecto.)

- [ ] **Step 2:** `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts supabase/functions/stripe-portal supabase/functions/admin-api/__tests__/pricing.test.ts` → FAIL.

- [ ] **Step 3: Implementación.** Crear `supabase/functions/stripe-portal/portal.ts`:

```ts
/**
 * Spec 2b-2 §4.3: la sesión del Customer Portal de Stripe, o por qué no hay. Puro, como
 * `stripe-checkout/checkout.ts`. Lo que el portal deja hacer (cancelar al fin del período,
 * tarjeta, facturas, mensual <-> anual) se configura en el dashboard de Stripe, no acá.
 */
export const URL_DE_VUELTA = 'https://nestmux.com/checkout/portal-return'

export type DecisionDePortal =
  | { ok: true; sesion: { customer: string; return_url: string } }
  | { ok: false; status: 404; error: 'no_subscription' }

export function decidirPortal(perfil: { stripe_customer_id: string | null } | null): DecisionDePortal {
  const customer = perfil?.stripe_customer_id
  if (!customer) return { ok: false, status: 404, error: 'no_subscription' }
  return { ok: true, sesion: { customer, return_url: URL_DE_VUELTA } }
}
```

Crear `supabase/functions/stripe-portal/index.ts`:

```ts
// Supabase Edge Function — abre el Customer Portal de Stripe (spec 2b-2 §4.3).
// Deploy: supabase functions deploy stripe-portal
// Secrets: STRIPE_SECRET_KEY (el mismo de stripe-checkout).

import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno'
import { jwtDelHeader } from '../stripe-checkout/checkout.ts'
import { decidirPortal } from './portal.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-11-20.acacia',
  httpClient: Stripe.createFetchHttpClient(),
})

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const jwt = jwtDelHeader(req.headers.get('Authorization'))
  if (!jwt) return json(401, { error: 'unauthorized' })
  const { data: auth, error: authError } = await admin.auth.getUser(jwt)
  const user = auth?.user
  if (authError || !user) return json(401, { error: 'unauthorized' })

  const { data: perfil, error } = await admin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle()
  if (error) {
    console.error('[stripe-portal] no se pudo leer el perfil', { userId: user.id, error: error.message })
    return json(500, { error: 'internal_error' })
  }

  const decision = decidirPortal(perfil)
  if (!decision.ok) return json(decision.status, { error: decision.error })

  try {
    const session = await stripe.billingPortal.sessions.create(decision.sesion)
    return json(200, { url: session.url })
  } catch (e) {
    console.error('[stripe-portal] Stripe rechazó la sesión', { userId: user.id, error: e instanceof Error ? e.message : String(e) })
    return json(502, { error: 'stripe_error' })
  }
})
```

En `admin-api/pricing.ts`:

```ts
/** Los tiers de Nest. `cloud` es el único self-serve (spec 2b-2); `enterprise` se asigna a mano. */
export const PLANES_VALIDOS = ['free', 'cloud', 'pro', 'team', 'enterprise'] as const
```

y `ETIQUETAS` suma `cloud: 'Cloud',` después de `free`.

- [ ] **Step 4:** el comando del Step 2 → PASS. Además `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts supabase/functions` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add supabase/functions/stripe-portal supabase/functions/admin-api/pricing.ts supabase/functions/admin-api/__tests__/pricing.test.ts
git commit -m "feat(stripe): portal de Stripe y cloud en el back-office

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Servidor de sync — `POST /internal/plan` firmado

**Files:**
- Create: `server/src/plan-sync.ts`
- Modify: `server/src/auth.ts:26` (`export` de `CLOUD_PLANS`), `server/src/http.ts` (import, `readRawBody`, ruta antes del bloque de `/v1/devices`, handler nuevo al final), `server/README.md` (tabla de rutas y de variables)
- Test: `server/__tests__/plan-sync.test.ts` (puro), `server/__tests__/plan-sync-http.test.ts` (Postgres)

**Interfaces:**
- Produces (`auth.ts`): `export const CLOUD_PLANS: Set<string>`.
- Produces (`plan-sync.ts`):
  - `export const VENTANA_DE_FIRMA_SEG = 300`
  - `export const PLANES_PAGOS: ReadonlySet<string>` = `cloud, pro, team, enterprise`
  - `export function verificarFirmaDePlan(cabecera: string | undefined, cuerpo: string, secreto: string, ahoraSeg: number): boolean`
  - `export type AvisoDePlan = { userId: string; plan: string }`
  - `export function leerAvisoDePlan(cuerpo: string): { ok: true; aviso: AvisoDePlan } | { ok: false; error: 'bad_json' | 'invalid_user_id' | 'invalid_plan' }`
  - `export async function aplicarPlan(pool: Pool, aviso: AvisoDePlan): Promise<void>`
- Produces (wire): `POST /internal/plan` con `X-Nest-Signature: t=<seg>,v1=<hex>` → `200 { ok: true }` | `401 { error: 'unauthorized' }` | `400 { error }` | `404` sin `PLAN_SYNC_SECRET` | `405`.

- [ ] **Step 1: Tests puros que fallan.** Crear `server/__tests__/plan-sync.test.ts`:

```ts
// Spec 2b-2 §4.5: la firma del aviso de plan y la lectura del cuerpo. Puro: sin Postgres.
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { leerAvisoDePlan, verificarFirmaDePlan, VENTANA_DE_FIRMA_SEG } from '../src/plan-sync'

const SECRETO = 'test-secret'
const T = 1_700_000_000
const CUERPO = '{"user_id":"00000000-0000-4000-8000-000000000001","plan":"cloud"}'
// D13: el MISMO vector que fija el firmador del webhook (aviso-de-plan.test.ts).
const V1_DEL_VECTOR = '8b149a93534d60ed7fb23268c484647e3a5a939afa9a2fe94402be2161e7fee8'
const firmar = (cuerpo: string, t = T, secreto = SECRETO) =>
  `t=${t},v1=${createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex')}`

describe('verificarFirmaDePlan', () => {
  it('acepta el vector fijo compartido con el webhook', () => {
    expect(verificarFirmaDePlan(`t=${T},v1=${V1_DEL_VECTOR}`, CUERPO, SECRETO, T)).toBe(true)
  })

  it('acepta dentro de la ventana de 300 s, para los dos lados', () => {
    expect(verificarFirmaDePlan(firmar(CUERPO), CUERPO, SECRETO, T + VENTANA_DE_FIRMA_SEG)).toBe(true)
    expect(verificarFirmaDePlan(firmar(CUERPO), CUERPO, SECRETO, T - VENTANA_DE_FIRMA_SEG)).toBe(true)
  })

  it('rechaza una firma vieja (> 300 s)', () => {
    expect(verificarFirmaDePlan(firmar(CUERPO), CUERPO, SECRETO, T + VENTANA_DE_FIRMA_SEG + 1)).toBe(false)
  })

  it('rechaza una firma inválida, de otro secreto o de otro cuerpo', () => {
    expect(verificarFirmaDePlan(`t=${T},v1=${'0'.repeat(64)}`, CUERPO, SECRETO, T)).toBe(false)
    expect(verificarFirmaDePlan(firmar(CUERPO, T, 'otro'), CUERPO, SECRETO, T)).toBe(false)
    expect(verificarFirmaDePlan(firmar(CUERPO), CUERPO.replace('cloud', 'team'), SECRETO, T)).toBe(false)
  })

  it('rechaza sin cabecera, sin secreto o con cabecera mal formada', () => {
    expect(verificarFirmaDePlan(undefined, CUERPO, SECRETO, T)).toBe(false)
    expect(verificarFirmaDePlan(firmar(CUERPO), CUERPO, '', T)).toBe(false)
    for (const mala of ['', 'v1=abc', `t=${T}`, `t=abc,v1=${V1_DEL_VECTOR}`, `t=${T},v1=zz`, `t=${T},v1=${V1_DEL_VECTOR}00`]) {
      expect(verificarFirmaDePlan(mala, CUERPO, SECRETO, T)).toBe(false)
    }
  })

  // Review Focus 2: el HMAC es sobre los bytes que llegaron, no sobre un JSON re-serializado.
  it('un cuerpo con espacios y claves en otro orden, firmado tal cual, pasa', () => {
    const crudo = '{ "plan" : "cloud",\n  "user_id": "00000000-0000-4000-8000-000000000001" }'
    expect(verificarFirmaDePlan(firmar(crudo), crudo, SECRETO, T)).toBe(true)
  })
})

describe('leerAvisoDePlan', () => {
  it('lee user_id y plan', () => {
    expect(leerAvisoDePlan(CUERPO)).toEqual({ ok: true, aviso: { userId: '00000000-0000-4000-8000-000000000001', plan: 'cloud' } })
  })

  // Review Focus 5: entrada rota es 400, nunca 500.
  it('JSON roto o que no es objeto: bad_json', () => {
    for (const c of ['', '{', 'null', '[]', '"x"']) expect(leerAvisoDePlan(c)).toEqual({ ok: false, error: 'bad_json' })
  })

  it('user_id que no es uuid: invalid_user_id', () => {
    for (const id of ['', 'u-1', 42, null, "'; drop table users;--"]) {
      expect(leerAvisoDePlan(JSON.stringify({ user_id: id, plan: 'cloud' }))).toEqual({ ok: false, error: 'invalid_user_id' })
    }
  })

  it('plan fuera de CLOUD_PLANS: invalid_plan', () => {
    for (const plan of ['diamante', '', 'CLOUD', 3]) {
      expect(leerAvisoDePlan(JSON.stringify({ user_id: '00000000-0000-4000-8000-000000000001', plan }))).toEqual({ ok: false, error: 'invalid_plan' })
    }
  })
})
```

- [ ] **Step 2:** `cd server && npx vitest run __tests__/plan-sync.test.ts` → FAIL (no existe `../src/plan-sync`). No necesita Postgres.

- [ ] **Step 3: El módulo.** En `server/src/auth.ts`, `const CLOUD_PLANS = …` pasa a `export const CLOUD_PLANS = …`. Crear `server/src/plan-sync.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Pool } from 'pg'
import { CLOUD_PLANS } from './auth'

/**
 * Spec 2b-2 §4.5: el webhook de Stripe le avisa a este servicio qué plan quedó en
 * `profiles`. Hasta acá lo único que escribía `users.plan` era `mint-device-token.mjs`: un
 * pago no llegaba nunca a la nube.
 *
 * La firma es la de Stripe en chico: `X-Nest-Signature: t=<unix seg>,v1=<hex>` con
 * `v1 = HMAC-SHA256(PLAN_SYNC_SECRET, "<t>.<cuerpo crudo>")`.
 */
export const VENTANA_DE_FIRMA_SEG = 300

/** Los planes que se cobran: pagar te mete en la allowlist de la beta (decisión 5). */
export const PLANES_PAGOS: ReadonlySet<string> = new Set(['cloud', 'pro', 'team', 'enterprise'])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * ¿La cabecera firma ESTE cuerpo crudo, con este secreto, hace menos de 5 minutos?
 *
 * Sobre el cuerpo CRUDO a propósito: re-serializar el JSON parseado cambia espacios y orden de
 * claves, y rechazaría avisos legítimos. Nunca lanza.
 */
export function verificarFirmaDePlan(
  cabecera: string | undefined,
  cuerpo: string,
  secreto: string,
  ahoraSeg: number,
): boolean {
  if (!secreto || !cabecera) return false
  const partes = new Map<string, string>()
  for (const parte of cabecera.split(',')) {
    const i = parte.indexOf('=')
    if (i > 0) partes.set(parte.slice(0, i).trim(), parte.slice(i + 1).trim())
  }
  const tCrudo = partes.get('t') ?? ''
  const v1 = partes.get('v1') ?? ''
  if (!/^\d+$/.test(tCrudo) || !/^[0-9a-f]{64}$/i.test(v1)) return false
  const t = Number(tCrudo)
  if (Math.abs(ahoraSeg - t) > VENTANA_DE_FIRMA_SEG) return false

  const esperada = createHmac('sha256', secreto).update(`${tCrudo}.${cuerpo}`).digest()
  const recibida = Buffer.from(v1, 'hex')
  // Mismo largo garantizado por la regex (64 hex = 32 bytes); igual se chequea antes de
  // `timingSafeEqual`, que tira con largos distintos.
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada)
}

export type AvisoDePlan = { userId: string; plan: string }

export function leerAvisoDePlan(
  cuerpo: string,
): { ok: true; aviso: AvisoDePlan } | { ok: false; error: 'bad_json' | 'invalid_user_id' | 'invalid_plan' } {
  let parsed: unknown
  try {
    parsed = JSON.parse(cuerpo)
  } catch {
    return { ok: false, error: 'bad_json' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'bad_json' }
  const { user_id: userId, plan } = parsed as { user_id?: unknown; plan?: unknown }
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) return { ok: false, error: 'invalid_user_id' }
  // Nunca un plan que `authenticate` no conoce: quedaría como `plan_required` para siempre.
  if (typeof plan !== 'string' || !CLOUD_PLANS.has(plan)) return { ok: false, error: 'invalid_plan' }
  return { ok: true, aviso: { userId, plan } }
}

/**
 * Aplica el aviso. Idempotente: el mismo aviso dos veces deja lo mismo. El usuario que todavía
 * no registró ninguna máquina queda creado, así su primer registro ya lo encuentra pago.
 * Bajar a `free` NO lo saca de la allowlist (decisión 5: al cancelar se queda).
 */
export async function aplicarPlan(pool: Pool, aviso: AvisoDePlan): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      `insert into users (id, plan) values ($1, $2)
       on conflict (id) do update set plan = excluded.plan`,
      [aviso.userId, aviso.plan],
    )
    if (PLANES_PAGOS.has(aviso.plan)) {
      await client.query('insert into allowlist (user_id) values ($1) on conflict do nothing', [aviso.userId])
    }
    await client.query('commit')
  } catch (err) {
    await client.query('rollback').catch(() => { /* la conexión ya puede estar rota */ })
    throw err
  } finally {
    client.release()
  }
}
```

- [ ] **Step 4:** `cd server && npx vitest run __tests__/plan-sync.test.ts` → PASS.

- [ ] **Step 5: Test HTTP que falla (Postgres).** `docker start nest-memory-pg`. Crear `server/__tests__/plan-sync-http.test.ts`:

```ts
// Spec 2b-2 §4.5 de punta a punta: la ruta, la firma y lo que queda en la base.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createHmac, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { getPool, migrate } from '../src/db'
import { createApp } from '../src/http'

const pool = getPool()
const SECRETO = 'test-secret-plan-sync'
const SECRETO_ANTES = process.env.PLAN_SYNC_SECRET
let base: string
let server: ReturnType<typeof createApp>

beforeAll(async () => {
  await migrate(pool)
  server = createApp(pool)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterEach(() => { process.env.PLAN_SYNC_SECRET = SECRETO })
afterAll(async () => {
  if (SECRETO_ANTES === undefined) delete process.env.PLAN_SYNC_SECRET
  else process.env.PLAN_SYNC_SECRET = SECRETO_ANTES
  await new Promise<void>((r) => server.close(() => r()))
  await pool.end()
})

process.env.PLAN_SYNC_SECRET = SECRETO

const ahora = () => Math.floor(Date.now() / 1000)
function avisar(cuerpo: string, opts: { t?: number; secreto?: string; firma?: string | null } = {}) {
  const t = opts.t ?? ahora()
  const v1 = createHmac('sha256', opts.secreto ?? SECRETO).update(`${t}.${cuerpo}`).digest('hex')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.firma !== null) headers['X-Nest-Signature'] = opts.firma ?? `t=${t},v1=${v1}`
  return fetch(`${base}/internal/plan`, { method: 'POST', headers, body: cuerpo })
}
const cuerpo = (userId: string, plan: string) => JSON.stringify({ user_id: userId, plan })

async function estado(userId: string) {
  const { rows: u } = await pool.query('select plan from users where id = $1', [userId])
  const { rows: a } = await pool.query('select 1 from allowlist where user_id = $1', [userId])
  return { plan: (u[0]?.plan as string | undefined) ?? null, enAllowlist: a.length > 0 }
}

describe('POST /internal/plan', () => {
  it('firma válida y plan pago: crea el usuario, le pone el plan y lo mete en la allowlist', async () => {
    const userId = randomUUID()
    const res = await avisar(cuerpo(userId, 'cloud'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(await estado(userId)).toEqual({ plan: 'cloud', enAllowlist: true })
  })

  it('es idempotente', async () => {
    const userId = randomUUID()
    expect((await avisar(cuerpo(userId, 'cloud'))).status).toBe(200)
    expect((await avisar(cuerpo(userId, 'cloud'))).status).toBe(200)
    expect(await estado(userId)).toEqual({ plan: 'cloud', enAllowlist: true })
  })

  it('bajar a free baja el plan pero no saca de la allowlist', async () => {
    const userId = randomUUID()
    await avisar(cuerpo(userId, 'cloud'))
    expect((await avisar(cuerpo(userId, 'free'))).status).toBe(200)
    expect(await estado(userId)).toEqual({ plan: 'free', enAllowlist: true })
  })

  it('free para alguien que nunca pagó no lo mete en la allowlist', async () => {
    const userId = randomUUID()
    expect((await avisar(cuerpo(userId, 'free'))).status).toBe(200)
    expect(await estado(userId)).toEqual({ plan: 'free', enAllowlist: false })
  })

  it('firma vieja (> 300 s), inválida o ausente: 401 y nada escrito', async () => {
    const userId = randomUUID()
    const c = cuerpo(userId, 'cloud')
    expect((await avisar(c, { t: ahora() - 301 })).status).toBe(401)
    expect((await avisar(c, { secreto: 'otro' })).status).toBe(401)
    expect((await avisar(c, { firma: null })).status).toBe(401)
    expect(await estado(userId)).toEqual({ plan: null, enAllowlist: false })
  })

  it('plan inválido: 400', async () => {
    const res = await avisar(cuerpo(randomUUID(), 'diamante'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_plan' })
  })

  // Review Focus 5.
  it('user_id que no es uuid o cuerpo que no es JSON: 400, no 500', async () => {
    const r1 = await avisar(JSON.stringify({ user_id: 'u-1', plan: 'cloud' }))
    expect(r1.status).toBe(400)
    expect(await r1.json()).toEqual({ error: 'invalid_user_id' })
    const r2 = await avisar('no es json')
    expect(r2.status).toBe(400)
    expect(await r2.json()).toEqual({ error: 'bad_json' })
  })

  it('GET: 405', async () => {
    const res = await fetch(`${base}/internal/plan`)
    expect(res.status).toBe(405)
  })

  it('sin PLAN_SYNC_SECRET la ruta no existe: 404', async () => {
    delete process.env.PLAN_SYNC_SECRET
    const res = await avisar(cuerpo(randomUUID(), 'cloud'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })
})
```

- [ ] **Step 6:** `cd server && npx vitest run __tests__/plan-sync-http.test.ts` → FAIL (404 en todo: la ruta no existe).

- [ ] **Step 7: La ruta.** En `server/src/http.ts`:

import: `import { aplicarPlan, leerAvisoDePlan, verificarFirmaDePlan } from './plan-sync'`.

Debajo de `readBody`, la lectura cruda:

```ts
/** Tope del cuerpo de `/internal/plan`: un aviso son dos campos, 64 KiB sobra. */
const MAX_PLAN_BODY_BYTES = 64 * 1024

/**
 * El cuerpo TAL CUAL llegó, como un solo decode utf8. Para `/internal/plan`, cuya firma es
 * sobre los bytes crudos: `readBody` parsea, y re-serializar cambiaría lo firmado.
 */
function readRawBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let done = false
    req.on('data', (chunk: Buffer) => {
      if (done) return
      bytes += chunk.length
      if (bytes > maxBytes) {
        done = true
        chunks.length = 0
        reject(Object.assign(new Error('too large'), { status: 413 }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { if (!done) resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}
```

En `handleRequest`, justo después del bloque de `/beta/` y ANTES de `if (path === '/v1/devices')`:

```ts
  // Spec 2b-2 §4.5: el aviso de plan del webhook de Stripe. Fuera de `authenticate`: la
  // credencial es la firma HMAC, no un token de device.
  if (path === '/internal/plan') return handleInternalPlan(pool, req, res)
```

Al final del archivo, antes de `export function createApp`:

```ts
/**
 * `POST /internal/plan` (spec 2b-2 §4.5). Sin `PLAN_SYNC_SECRET` la ruta no existe (404): un
 * secreto vacío verificaría contra HMAC(''), que cualquiera calcula.
 */
async function handleInternalPlan(pool: Pool, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const secreto = process.env.PLAN_SYNC_SECRET ?? ''
  if (!secreto) return send(res, 404, { error: 'not_found' })
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
  try {
    const cuerpo = await readRawBody(req, MAX_PLAN_BODY_BYTES)
    const firma = req.headers['x-nest-signature']
    const cabecera = Array.isArray(firma) ? firma[0] : firma
    if (!verificarFirmaDePlan(cabecera, cuerpo, secreto, Math.floor(Date.now() / 1000))) {
      return send(res, 401, { error: 'unauthorized' })
    }
    const leido = leerAvisoDePlan(cuerpo)
    if (!leido.ok) return send(res, 400, { error: leido.error })
    await aplicarPlan(pool, leido.aviso)
    // Sólo user_id y plan: el cuerpo entero no se loguea.
    console.log('[plan-sync] plan aplicado', { user_id: leido.aviso.userId, plan: leido.aviso.plan })
    return send(res, 200, { ok: true })
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    if (status === 500) console.error('[http] /internal/plan', err)
    return send(res, status, { error: status === 500 ? 'internal_error' : (err as Error).message })
  }
}
```

En `server/README.md`, tabla de rutas (después de la fila de `GET /v1/sync/status`):

```
| `POST /internal/plan` | — | Spec 2b-2 §4.5 — el aviso de plan del webhook de Stripe. Firmado con `X-Nest-Signature: t=<seg>,v1=HMAC-SHA256(PLAN_SYNC_SECRET, "<t>.<cuerpo crudo>")`, ventana de 300 s. Escribe `users.plan` y, si es pago, la allowlist (bajar a `free` no saca de la allowlist). Sin `PLAN_SYNC_SECRET` responde 404. |
```

y en la tabla de variables (después de `SUPABASE_ANON_KEY`):

```
| `PLAN_SYNC_SECRET` | ninguno | Secreto compartido con el webhook de Stripe (`stripe-webhook`, secret `PLAN_SYNC_SECRET` en Supabase) para firmar `POST /internal/plan`. **Sin él la ruta responde 404** y los pagos no llegan solos al plan del servidor. Al menos 32 caracteres, desde 1Password. |
```

- [ ] **Step 8:** `cd server && npx vitest run __tests__/plan-sync.test.ts __tests__/plan-sync-http.test.ts __tests__/http.test.ts __tests__/auth.test.ts` → PASS. `cd server && npx tsc --noEmit` → 0. `docker stop nest-memory-pg`.

- [ ] **Step 9: Commit.**

```bash
git add server/src/plan-sync.ts server/src/auth.ts server/src/http.ts server/README.md server/__tests__/plan-sync.test.ts server/__tests__/plan-sync-http.test.ts
git commit -m "feat(sync): POST /internal/plan firmado aplica el plan pagado

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: El webhook le avisa al servidor de sync

**Files:**
- Create: `supabase/functions/stripe-webhook/aviso-de-plan.ts`
- Modify: `supabase/functions/stripe-webhook/index.ts` (import, helper `avisarPlanDe`, ramas `activar` y `bajar_a_free`)
- Test: `supabase/functions/stripe-webhook/__tests__/aviso-de-plan.test.ts`

**Interfaces:**
- Consumes: el contrato de `POST /internal/plan` (Task 4) y el vector fijo de D13.
- Produces (`aviso-de-plan.ts`, puro: WebCrypto, corre en Deno y en Node):
  - `export interface ConfigDeAviso { url: string; secreto: string }`
  - `export function configDeAviso(env: { PLAN_SYNC_URL?: string; PLAN_SYNC_SECRET?: string }): ConfigDeAviso | null`
  - `export async function firmarAviso(secreto: string, cuerpo: string, t: number): Promise<string>` → `'t=<t>,v1=<hex>'`
  - `export async function avisarPlan(fetchImpl: typeof fetch, config: ConfigDeAviso, userId: string, plan: string, ahoraSeg: number): Promise<{ ok: true } | { ok: false; motivo: string }>`

- [ ] **Step 1: Tests que fallan.** Crear `supabase/functions/stripe-webhook/__tests__/aviso-de-plan.test.ts`:

```ts
// Spec 2b-2 §4.4: después de escribir `profiles`, el webhook le avisa al servidor de sync.
import { describe, it, expect, vi } from 'vitest'
import { avisarPlan, configDeAviso, firmarAviso } from '../aviso-de-plan.ts'

const CUERPO = '{"user_id":"00000000-0000-4000-8000-000000000001","plan":"cloud"}'
// D13: el MISMO vector que verifica el servidor (server/__tests__/plan-sync.test.ts).
const V1_DEL_VECTOR = '8b149a93534d60ed7fb23268c484647e3a5a939afa9a2fe94402be2161e7fee8'
const CONFIG = { url: 'https://sync.test/', secreto: 'test-secret' }

describe('firmarAviso', () => {
  it('produce la firma del vector fijo', async () => {
    expect(await firmarAviso('test-secret', CUERPO, 1_700_000_000)).toBe(`t=1700000000,v1=${V1_DEL_VECTOR}`)
  })
})

describe('configDeAviso', () => {
  it('sin url o sin secreto (o en blanco) no hay config', () => {
    expect(configDeAviso({})).toBeNull()
    expect(configDeAviso({ PLAN_SYNC_URL: 'https://sync.test' })).toBeNull()
    expect(configDeAviso({ PLAN_SYNC_SECRET: 's' })).toBeNull()
    expect(configDeAviso({ PLAN_SYNC_URL: ' ', PLAN_SYNC_SECRET: 's' })).toBeNull()
  })

  it('con las dos, la config', () => {
    expect(configDeAviso({ PLAN_SYNC_URL: 'https://sync.test', PLAN_SYNC_SECRET: 's' })).toEqual({ url: 'https://sync.test', secreto: 's' })
  })
})

describe('avisarPlan', () => {
  it('postea a <base>/internal/plan el cuerpo firmado con user_id y plan', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    const r = await avisarPlan(fetchImpl as unknown as typeof fetch, CONFIG, '00000000-0000-4000-8000-000000000001', 'cloud', 1_700_000_000)
    expect(r).toEqual({ ok: true })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://sync.test/internal/plan')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(CUERPO)
    expect(init.headers['X-Nest-Signature']).toBe(`t=1700000000,v1=${V1_DEL_VECTOR}`)
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('un no-2xx es una falla con el status', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }))
    expect(await avisarPlan(fetchImpl as unknown as typeof fetch, CONFIG, 'u', 'cloud', 1)).toEqual({ ok: false, motivo: 'HTTP 401' })
  })

  it('un error de red es una falla, sin lanzar', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    expect(await avisarPlan(fetchImpl as unknown as typeof fetch, CONFIG, 'u', 'cloud', 1)).toEqual({ ok: false, motivo: 'ECONNREFUSED' })
  })
})
```

- [ ] **Step 2:** `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts supabase/functions/stripe-webhook/__tests__/aviso-de-plan.test.ts` → FAIL (no existe el módulo).

- [ ] **Step 3: El módulo.** Crear `supabase/functions/stripe-webhook/aviso-de-plan.ts`:

```ts
/**
 * Spec 2b-2 §4.4/§4.5: el aviso al servidor de sync. Puro salvo por el `fetch` que se inyecta:
 * WebCrypto (`crypto.subtle`) existe igual en Deno y en Node, así que se testea con vitest.
 *
 * Se manda lo que quedó en `profiles`, no lo que dice el evento: aunque Stripe entregue
 * eventos repetidos o desordenados, cada aviso lleva la verdad del momento y el servidor
 * converge a Supabase.
 */
export interface ConfigDeAviso {
  /** La BASE del servicio de sync (D5); acá se le suma `/internal/plan`. */
  url: string
  secreto: string
}

export function configDeAviso(env: { PLAN_SYNC_URL?: string; PLAN_SYNC_SECRET?: string }): ConfigDeAviso | null {
  const url = env.PLAN_SYNC_URL?.trim()
  const secreto = env.PLAN_SYNC_SECRET?.trim()
  if (!url || !secreto) return null
  return { url, secreto }
}

/** `t=<t>,v1=<hex de HMAC-SHA256(secreto, "<t>.<cuerpo>")>`. */
export async function firmarAviso(secreto: string, cuerpo: string, t: number): Promise<string> {
  const codificador = new TextEncoder()
  const clave = await crypto.subtle.importKey('raw', codificador.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const firma = await crypto.subtle.sign('HMAC', clave, codificador.encode(`${t}.${cuerpo}`))
  const hex = [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `t=${t},v1=${hex}`
}

const TIMEOUT_MS = 10_000

export async function avisarPlan(
  fetchImpl: typeof fetch,
  config: ConfigDeAviso,
  userId: string,
  plan: string,
  ahoraSeg: number,
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const cuerpo = JSON.stringify({ user_id: userId, plan })
  try {
    const res = await fetchImpl(`${config.url.replace(/\/+$/, '')}/internal/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Nest-Signature': await firmarAviso(config.secreto, cuerpo, ahoraSeg) },
      body: cuerpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.ok ? { ok: true } : { ok: false, motivo: `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) }
  }
}
```

- [ ] **Step 4:** el test del Step 2 → PASS.

- [ ] **Step 5: El shell.** En `stripe-webhook/index.ts`: sumar `import { avisarPlan, configDeAviso } from './aviso-de-plan.ts'` y en el comentario de cabecera `//   supabase secrets set PLAN_SYNC_URL=https://<servicio de sync> PLAN_SYNC_SECRET=<mismo que Railway>`. Después del `const supabase = createClient(...)`:

```ts
/**
 * Relee el plan que quedó en `profiles` y se lo avisa al servidor de sync (spec 2b-2 §4.4).
 * `false` = el aviso no llegó: el llamador devuelve 500 y Stripe reintenta. Un pago que no
 * llega a la nube no se puede tragar en silencio.
 */
async function avisarPlanDe(userId: string): Promise<boolean> {
  const config = configDeAviso({
    PLAN_SYNC_URL: Deno.env.get('PLAN_SYNC_URL'),
    PLAN_SYNC_SECRET: Deno.env.get('PLAN_SYNC_SECRET'),
  })
  if (!config) {
    console.error('[stripe-webhook] faltan PLAN_SYNC_URL/PLAN_SYNC_SECRET: el plan no llega al servidor de sync', { userId })
    return false
  }
  const { data, error } = await supabase.from('profiles').select('plan').eq('id', userId).maybeSingle()
  if (error || !data) {
    console.error('[stripe-webhook] no se pudo releer el plan para avisar', { userId, error: error?.message ?? 'sin perfil' })
    return false
  }
  const r = await avisarPlan(fetch, config, userId, data.plan, Math.floor(Date.now() / 1000))
  if (!r.ok) {
    console.error('[stripe-webhook] el servidor de sync no tomó el plan', { userId, plan: data.plan, motivo: r.motivo })
    return false
  }
  return true
}
```

En la rama `activar`, después del `console.log('[stripe-webhook] plan activado', …)` y dentro del mismo `if`:

```ts
    if (!(await avisarPlanDe(decision.userId))) {
      return new Response('Could not notify sync service', { status: 500 })
    }
```

La rama `bajar_a_free` completa pasa a:

```ts
  if (decision.tipo === 'bajar_a_free') {
    // `.select('id')`: los usuarios que efectivamente bajaron, para avisar por cada uno.
    const { data: bajados, error } = await supabase
      .from('profiles')
      .update({ plan: 'free', stripe_subscription_id: null, updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', decision.subscriptionId)
      .select('id')
    if (error) {
      console.error('[stripe-webhook] fallo al bajar el plan a free', {
        subscription: decision.subscriptionId, error: error.message,
      })
      return new Response('Could not downgrade plan', { status: 500 })
    }
    for (const fila of bajados ?? []) {
      if (!(await avisarPlanDe(fila.id as string))) {
        return new Response('Could not notify sync service', { status: 500 })
      }
    }
  }
```

(Ninguna fila afectada —la suscripción ya no estaba en ningún perfil— no avisa nada y devuelve 200: no hay plan que propagar.)

- [ ] **Step 6:** `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts supabase/functions` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add supabase/functions/stripe-webhook/aviso-de-plan.ts supabase/functions/stripe-webhook/index.ts supabase/functions/stripe-webhook/__tests__/aviso-de-plan.test.ts
git commit -m "feat(stripe): el webhook avisa el plan al servidor de sync

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Red de seguridad — el registro de device relee el plan (sólo sube)

**Files:**
- Modify: `server/src/devices.ts` (import; `fetchPlanDeSupabase` y `planPagoDeSupabase` nuevos junto a `fetchActiveTeamMemberships`; `registerDevice` ~líneas 213-270; su docstring ~líneas 191-212)
- Modify: `server/__tests__/devices-team-sync.test.ts:80-81` (ahora hay dos fetch)
- Test: `server/__tests__/devices-plan-de-supabase.test.ts` (Postgres)

**Interfaces:**
- Consumes: `PLANES_PAGOS` de `server/src/plan-sync.ts` (Task 4).
- Produces (`devices.ts`): `export async function fetchPlanDeSupabase(supabaseUrl: string, anonKey: string, userId: string, jwt: string): Promise<string | null>`. `registerDevice` mantiene su firma.

- [ ] **Step 1: Tests que fallan.** `docker start nest-memory-pg`. Crear `server/__tests__/devices-plan-de-supabase.test.ts`:

```ts
// Spec 2b-2 §4.6: al registrar un device se relee `profiles.plan` con el JWT del usuario.
// Si es pago, se aplica ANTES del chequeo de allowlist. Sólo sube, nunca baja (D4).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { registerDevice } from '../src/devices'

const pool = getPool()
const ENV_ANTES = { ...process.env }
const FETCH_ANTES = global.fetch

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })
afterEach(() => {
  process.env = { ...ENV_ANTES }
  global.fetch = FETCH_ANTES
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Supabase falso que contesta por ruta: `profiles` con lo pedido, `team_members` vacío. */
function mockSupabase(profiles: unknown | Error) {
  process.env.SUPABASE_URL = 'https://ejemplo.supabase.co'
  process.env.SUPABASE_ANON_KEY = 'anon-key-de-prueba'
  const impl = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.includes('/rest/v1/profiles')) {
      if (profiles instanceof Error) throw profiles
      return json(profiles)
    }
    return json([])
  })
  global.fetch = impl as unknown as typeof fetch
  return impl
}

async function estado(userId: string) {
  const { rows: u } = await pool.query('select plan from users where id = $1', [userId])
  const { rows: a } = await pool.query('select 1 from allowlist where user_id = $1', [userId])
  return { plan: (u[0]?.plan as string | undefined) ?? null, enAllowlist: a.length > 0 }
}

describe('registerDevice — el plan de Supabase como red de seguridad', () => {
  it('un plan pago leído se aplica y destraba not_in_beta', async () => {
    const userId = randomUUID()
    const impl = mockSupabase([{ plan: 'cloud' }])

    const r = await registerDevice(pool, { userId, email: null }, { name: 'Mac' }, 'jwt-de-prueba')

    expect(r.ok).toBe(true)
    expect(await estado(userId)).toEqual({ plan: 'cloud', enAllowlist: true })
    const llamada = impl.mock.calls.find(([url]) => String(url).includes('/rest/v1/profiles'))!
    expect(String(llamada[0])).toContain(`id=eq.${userId}`)
    expect(String(llamada[0])).toContain('select=plan')
    const headers = (llamada[1] as { headers: Record<string, string> }).headers
    expect(headers.Authorization).toBe('Bearer jwt-de-prueba')
    expect(headers.apikey).toBe('anon-key-de-prueba')
  })

  it('un free leído NO baja un users.plan pago puesto a mano', async () => {
    const userId = randomUUID()
    await pool.query(`insert into users (id, plan) values ($1, 'team')`, [userId])
    await pool.query('insert into allowlist (user_id) values ($1)', [userId])
    mockSupabase([{ plan: 'free' }])

    const r = await registerDevice(pool, { userId, email: null }, { name: 'Mac' }, 'jwt-de-prueba')

    expect(r.ok).toBe(true)
    expect(await estado(userId)).toEqual({ plan: 'team', enAllowlist: true })
  })

  it('un pago leído no pisa otro pago (D4: sólo sube desde un plan no pago)', async () => {
    const userId = randomUUID()
    await pool.query(`insert into users (id, plan) values ($1, 'enterprise')`, [userId])
    await pool.query('insert into allowlist (user_id) values ($1)', [userId])
    mockSupabase([{ plan: 'cloud' }])

    await registerDevice(pool, { userId, email: null }, { name: 'Mac' }, 'jwt-de-prueba')

    expect(await estado(userId)).toEqual({ plan: 'enterprise', enAllowlist: true })
  })

  it('el fetch que falla no rompe el registro: todo sigue como hoy', async () => {
    const permitido = randomUUID()
    await pool.query('insert into users (id) values ($1)', [permitido])
    await pool.query('insert into allowlist (user_id) values ($1)', [permitido])
    mockSupabase(new Error('ECONNREFUSED'))
    expect((await registerDevice(pool, { userId: permitido, email: null }, { name: 'Mac' }, 'jwt')).ok).toBe(true)

    const fuera = randomUUID()
    expect(await registerDevice(pool, { userId: fuera, email: null }, { name: 'Mac' }, 'jwt'))
      .toEqual({ ok: false, status: 403, error: 'not_in_beta' })
  })

  it('sin perfil, plan desconocido o respuesta rara: no hace nada', async () => {
    for (const respuesta of [[], [{ plan: 'diamante' }], [{}], { plan: 'cloud' }]) {
      const fuera = randomUUID()
      mockSupabase(respuesta)
      expect(await registerDevice(pool, { userId: fuera, email: null }, { name: 'Mac' }, 'jwt'))
        .toEqual({ ok: false, status: 403, error: 'not_in_beta' })
      // `not_in_beta` hace rollback: ni el usuario queda creado.
      expect(await estado(fuera)).toEqual({ plan: null, enAllowlist: false })
    }
  })

  it('sin JWT (vinculación por código) no consulta Supabase', async () => {
    const impl = mockSupabase([{ plan: 'cloud' }])
    const fuera = randomUUID()
    await registerDevice(pool, { userId: fuera, email: null }, { name: 'Mac' })
    expect(impl).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2:** `cd server && npx vitest run __tests__/devices-plan-de-supabase.test.ts` → FAIL (`not_in_beta` en el primer test).

- [ ] **Step 3: La lectura y la escritura.** En `server/src/devices.ts`: import `import { PLANES_PAGOS } from './plan-sync'`. Debajo de `fetchActiveTeamMemberships`:

```ts
/**
 * `profiles.plan` del propio usuario, leído con SU JWT (spec 2b-2 §4.6): la RLS lo deja leer y
 * `protect_profile_billing_columns` impide que el cliente lo escriba, así que es la verdad de
 * Stripe. `null` si no hay fila o el plan no es un string. Lanza en un no-2xx o error de red.
 */
export async function fetchPlanDeSupabase(
  supabaseUrl: string,
  anonKey: string,
  userId: string,
  jwt: string
): Promise<string | null> {
  const url = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=plan`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SUPABASE_MEMBERSHIPS_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey }, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(`supabase profiles respondió ${res.status}`)
  const body = (await res.json()) as unknown
  if (!Array.isArray(body)) return null
  const plan = (body[0] as { plan?: unknown } | undefined)?.plan
  return typeof plan === 'string' ? plan : null
}

/**
 * Best effort, como `syncTeamMemberships`: sin config, sin JWT o con cualquier falla devuelve
 * `null` y el registro sigue exactamente como antes. Sólo devuelve planes PAGOS: un `free`
 * leído no se usa nunca (la red de seguridad sólo sube; bajar es trabajo del webhook).
 */
async function planPagoDeSupabase(userId: string, supabaseJwt: string | undefined): Promise<string | null> {
  const supabaseUrl = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey || !supabaseJwt) return null
  try {
    const plan = await fetchPlanDeSupabase(supabaseUrl, anonKey, userId, supabaseJwt)
    return plan && PLANES_PAGOS.has(plan) ? plan : null
  } catch (err) {
    console.warn('[devices] no se pudo leer el plan de Supabase', err)
    return null
  }
}
```

En `registerDevice`, ANTES de `const client = await pool.connect()`:

```ts
  // Spec 2b-2 §4.6: fuera de la transacción, por lo mismo que `syncTeamMemberships`: colgar el
  // registro de la red de Supabase convertiría su timeout en el del registro.
  const planPago = await planPagoDeSupabase(identity.userId, supabaseJwt)
```

y adentro, justo después del `insert into users (id, email) …` existente y ANTES del `select 1 from allowlist`:

```ts
    if (planPago) {
      // Sólo sube (D4): se escribe si el plan actual NO es pago. Un `enterprise` o `team`
      // puesto a mano no lo pisa un `cloud` leído de Supabase.
      await client.query(
        `update users set plan = $2 where id = $1 and plan <> all($3::text[])`,
        [identity.userId, planPago, [...PLANES_PAGOS]]
      )
      // Pagar te mete en la beta (decisión 5) ANTES del chequeo: alguien que pagó y perdió el
      // aviso del webhook no recibe `not_in_beta`.
      await client.query('insert into allowlist (user_id) values ($1) on conflict do nothing', [identity.userId])
    }
```

En el docstring de `registerDevice`, reemplazar el párrafo "Sobre el plan: … está anotado como pendiente." por:

```
 * Sobre el plan: el JWT de Supabase no lo trae, así que un usuario nuevo entra como `free`.
 * Desde 2b-2 el plan llega por `POST /internal/plan` (webhook de Stripe) y, como red de
 * seguridad, acá se relee `profiles.plan` con el JWT: si es pago y el actual no lo es, se
 * escribe junto con la allowlist, ANTES del chequeo de allowlist. Nunca baja un plan.
```

En `server/__tests__/devices-team-sync.test.ts`, el test `(a)` ahora ve DOS fetch (profiles y team_members). Reemplazar las líneas

```ts
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
```

por

```ts
    // 2b-2: además de team_members se lee profiles (la red de seguridad del plan).
    const llamadaDeEquipos = fetchImpl.mock.calls.filter(([u]) => String(u).includes('/rest/v1/team_members'))
    expect(llamadaDeEquipos).toHaveLength(1)
    const [url, init] = llamadaDeEquipos[0]
```

- [ ] **Step 4:** `cd server && npx vitest run __tests__/devices-plan-de-supabase.test.ts __tests__/devices-team-sync.test.ts __tests__/devices-register.test.ts __tests__/link.test.ts __tests__/link-http.test.ts` → PASS. `cd server && npx tsc --noEmit` → 0. `docker stop nest-memory-pg`.

- [ ] **Step 5: Commit.**

```bash
git add server/src/devices.ts server/__tests__/devices-plan-de-supabase.test.ts server/__tests__/devices-team-sync.test.ts
git commit -m "feat(sync): el registro de device relee el plan pago de Supabase

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Servidor — bajar de plan: qué proyecto sigue (`kept_project_key`, push, keep, status)

**Files:**
- Create: `server/migrations/011_kept_project.sql`, `server/src/proyectos-permitidos.ts`, `server/src/keep.ts`
- Modify: `server/src/push.ts:157` (`export` de `GLOBAL_PROJECT_KEY`) y el bloque del lock `project-limit` (~líneas 430-460), `server/src/status.ts` (`StatusResponse`, query de `users`, `order by`, `return`), `server/src/http.ts` (ruta `/v1/projects/keep`), `server/README.md`
- Test: `server/__tests__/proyectos-permitidos.test.ts` (puro), `server/__tests__/proyecto-elegido.test.ts` (Postgres), `server/__tests__/http.test.ts`

**Interfaces:**
- Produces (`push.ts`): `export const GLOBAL_PROJECT_KEY = '__global__'`.
- Produces (`proyectos-permitidos.ts`): `export function proyectosPermitidos(propios: ReadonlyArray<{ projectKey: string; id: number }>, keptProjectKey: string | null, maxProjects: number): Set<string>` — `propios` SIN `__global__`.
- Produces (`keep.ts`): `export type KeepResult = { ok: true } | { ok: false; status: 400 | 409; error: 'unknown_project' | 'not_over_limit' }`; `export async function handleKeepProject(pool: Pool, auth: { userId: string; plan: string }, body: Record<string, unknown>): Promise<KeepResult>`.
- Produces (wire): `POST /v1/projects/keep` `{ project_key }` → `200 { ok: true }` | `400 { error: 'unknown_project' }` | `409 { error: 'not_over_limit' }`. `GET /v1/sync/status` suma `kept_project_key: string | null` y `over_limit: boolean`; `projects` sale ordenado por `id` (D2).

- [ ] **Step 1: Test puro que falla.** Crear `server/__tests__/proyectos-permitidos.test.ts`:

```ts
// Spec 2b-2 §4.7: con más proyectos que el tope, cuáles siguen aceptando mutaciones. Puro.
import { describe, it, expect } from 'vitest'
import { proyectosPermitidos } from '../src/proyectos-permitidos'

const p = (projectKey: string, id: number) => ({ projectKey, id })
const PROPIOS = [p('c', 30), p('a', 10), p('b', 20)] // desordenados a propósito

describe('proyectosPermitidos', () => {
  it('sin pasarse del tope, todos', () => {
    expect([...proyectosPermitidos(PROPIOS, null, 3)].sort()).toEqual(['a', 'b', 'c'])
    expect([...proyectosPermitidos(PROPIOS, 'b', 100)].sort()).toEqual(['a', 'b', 'c'])
  })

  it('pasado y sin elección: los maxProjects más viejos por id', () => {
    expect([...proyectosPermitidos(PROPIOS, null, 1)]).toEqual(['a'])
    expect([...proyectosPermitidos(PROPIOS, null, 2)].sort()).toEqual(['a', 'b'])
  })

  it('pasado y con elección: el elegido más los maxProjects - 1 más viejos restantes', () => {
    expect([...proyectosPermitidos(PROPIOS, 'c', 1)]).toEqual(['c'])
    expect([...proyectosPermitidos(PROPIOS, 'c', 2)].sort()).toEqual(['a', 'c'])
  })

  it('un elegido que ya no es propio cae a los más viejos', () => {
    expect([...proyectosPermitidos(PROPIOS, 'borrado', 1)]).toEqual(['a'])
  })

  it('sin proyectos, ninguno', () => {
    expect(proyectosPermitidos([], 'a', 1).size).toBe(0)
  })
})
```

- [ ] **Step 2:** `cd server && npx vitest run __tests__/proyectos-permitidos.test.ts` → FAIL.

- [ ] **Step 3: El módulo puro.** Crear `server/src/proyectos-permitidos.ts`:

```ts
/**
 * Spec 2b-2 §4.7: con más proyectos propios que el tope del plan (alguien que bajó de Cloud a
 * Free), cuáles siguen aceptando mutaciones. El resto recibe `project_limit_reached`, el mismo
 * rechazo reversible de 2b-1: nada se borra y pull no cambia.
 *
 * "Más viejo" es el menor `projects.id` (D1 del plan: `projects` no tiene `created_at`, y
 * `id` es un bigserial asignado al dar de alta, bajo el lock `project-limit:<user>`).
 *
 * `propios` va SIN `__global__`: no ocupa lugar (ver GLOBAL_PROJECT_KEY en push.ts).
 */
export function proyectosPermitidos(
  propios: ReadonlyArray<{ projectKey: string; id: number }>,
  keptProjectKey: string | null,
  maxProjects: number
): Set<string> {
  const porAntiguedad = [...propios].sort((x, y) => x.id - y.id).map((x) => x.projectKey)
  if (porAntiguedad.length <= maxProjects) return new Set(porAntiguedad)
  const elegido = keptProjectKey !== null && porAntiguedad.includes(keptProjectKey) ? keptProjectKey : null
  if (elegido === null) return new Set(porAntiguedad.slice(0, maxProjects))
  const resto = porAntiguedad.filter((k) => k !== elegido).slice(0, Math.max(0, maxProjects - 1))
  return new Set([elegido, ...resto])
}
```

- [ ] **Step 4:** `cd server && npx vitest run __tests__/proyectos-permitidos.test.ts` → PASS.

- [ ] **Step 5: Test de punta a punta que falla (Postgres).** `docker start nest-memory-pg`. Crear `server/__tests__/proyecto-elegido.test.ts`:

```ts
// Spec 2b-2 §4.7 contra Postgres real: la regla del push, POST /v1/projects/keep y status.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'
import { handleStatus } from '../src/status'
import { handleKeepProject } from '../src/keep'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const GLOBAL = '__global__'
let seq = 0

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })

async function seed(plan: string) {
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query('insert into users (id, plan) values ($1, $2)', [userId, plan])
  await pool.query(`insert into devices (id, user_id, name, token_hash) values ($1, $2, 'keep', $3)`, [deviceId, userId, `hash-${deviceId}`])
  return { deviceId, userId, plan }
}

const mut = (projectKey: string) => {
  const syncId = `${RUN}-keep-${++seq}`
  return {
    seq, sync_id: syncId, op: 'upsert' as const,
    payload: {
      sync_id: syncId, project_key: projectKey, project_display_name: projectKey, scope: 'personal',
      type: 'decision', topic_key: null, title: 't', content: 'c', tags: [], lamport: 1,
      updated_at: Date.now(), created_at: Date.now(),
    },
  }
}

const empujar = async (auth: { deviceId: string; userId: string; plan: string }, key: string) =>
  (await handlePush(pool, auth, { mutations: [mut(key)] })).results[0]

/** Cuenta Cloud con tres proyectos (en orden de alta A, B, C) que baja a Free. */
async function bajadaConTres() {
  const cloud = await seed('cloud')
  const [A, B, C] = ['a', 'b', 'c'].map((x) => `${RUN}-${x}-${cloud.userId.slice(0, 4)}`)
  for (const k of [A, B, C]) expect((await empujar(cloud, k)).outcome).toBe('applied')
  await pool.query(`update users set plan = 'free' where id = $1`, [cloud.userId])
  return { free: { ...cloud, plan: 'free' }, A, B, C }
}

describe('push con más proyectos que el tope', () => {
  it('sin elección pasa sólo el más viejo; __global__ siempre pasa', async () => {
    const { free, A, B, C } = await bajadaConTres()
    expect((await empujar(free, A)).outcome).toBe('applied')
    expect(await empujar(free, B)).toMatchObject({ outcome: 'rejected', error: 'project_limit_reached' })
    expect(await empujar(free, C)).toMatchObject({ outcome: 'rejected', error: 'project_limit_reached' })
    expect((await empujar(free, GLOBAL)).outcome).toBe('applied')
  })

  it('con elección pasa sólo el elegido', async () => {
    const { free, A, B } = await bajadaConTres()
    expect(await handleKeepProject(pool, free, { project_key: B })).toEqual({ ok: true })
    expect((await empujar(free, B)).outcome).toBe('applied')
    expect(await empujar(free, A)).toMatchObject({ outcome: 'rejected', error: 'project_limit_reached' })
  })

  it('un elegido que ya no existe cae al más viejo', async () => {
    const { free, A, B } = await bajadaConTres()
    await pool.query('update users set kept_project_key = $2 where id = $1', [free.userId, `${RUN}-borrado`])
    expect((await empujar(free, A)).outcome).toBe('applied')
    expect(await empujar(free, B)).toMatchObject({ outcome: 'rejected', error: 'project_limit_reached' })
  })

  it('al volver a pagar la regla deja de aplicar y kept_project_key queda guardado', async () => {
    const { free, A, B, C } = await bajadaConTres()
    await handleKeepProject(pool, free, { project_key: C })
    await pool.query(`update users set plan = 'cloud' where id = $1`, [free.userId])
    const cloud = { ...free, plan: 'cloud' }
    for (const k of [A, B, C]) expect((await empujar(cloud, k)).outcome).toBe('applied')
    const { rows } = await pool.query('select kept_project_key from users where id = $1', [free.userId])
    expect(rows[0].kept_project_key).toBe(C)
  })
})

describe('POST /v1/projects/keep', () => {
  it('un proyecto ajeno, inexistente, vacío o __global__ es 400 unknown_project', async () => {
    const { free } = await bajadaConTres()
    const otro = await bajadaConTres()
    for (const project_key of [otro.A, `${RUN}-nada`, '', GLOBAL, 42]) {
      expect(await handleKeepProject(pool, free, { project_key })).toEqual({ ok: false, status: 400, error: 'unknown_project' })
    }
  })

  it('sin estar por encima del tope es 409 not_over_limit', async () => {
    const f = await seed('free')
    const K = `${RUN}-solo-${f.userId.slice(0, 4)}`
    await empujar(f, K)
    expect(await handleKeepProject(pool, f, { project_key: K })).toEqual({ ok: false, status: 409, error: 'not_over_limit' })
  })
})

describe('status — kept_project_key y over_limit', () => {
  it('por encima del tope: over_limit y el elegido; el roster por antigüedad (D2)', async () => {
    const { free, A, B, C } = await bajadaConTres()
    const antes = await handleStatus(pool, free)
    expect(antes.over_limit).toBe(true)
    expect(antes.kept_project_key).toBeNull()
    expect(antes.projects.map((p) => p.project_key).filter((k) => k !== GLOBAL)).toEqual([A, B, C])

    await handleKeepProject(pool, free, { project_key: B })
    expect((await handleStatus(pool, free)).kept_project_key).toBe(B)
  })

  it('un kept_project_key que ya no es propio sale como null (D3)', async () => {
    const { free } = await bajadaConTres()
    await pool.query('update users set kept_project_key = $2 where id = $1', [free.userId, `${RUN}-borrado`])
    expect((await handleStatus(pool, free)).kept_project_key).toBeNull()
  })

  // Review Focus 4: __global__ no ocupa lugar.
  it('un Free con __global__ y su único proyecto NO está over_limit', async () => {
    const f = await seed('free')
    await empujar(f, GLOBAL)
    await empujar(f, `${RUN}-uno-${f.userId.slice(0, 4)}`)
    const s = await handleStatus(pool, f)
    expect(s.over_limit).toBe(false)
    expect(s.kept_project_key).toBeNull()
  })
})
```

En `server/__tests__/http.test.ts`, dentro de `describe('http', …)`:

```ts
  it('rutea POST /v1/projects/keep (spec 2b-2): un proyecto que no es mío es 400', async () => {
    const res = await post('/v1/projects/keep', { project_key: `${RUN}-no-es-mio` })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'unknown_project' })
  })
```

- [ ] **Step 6:** `cd server && npx vitest run __tests__/proyecto-elegido.test.ts __tests__/http.test.ts` → FAIL (no existe `../src/keep`).

- [ ] **Step 7: Migración, keep, push, status, ruta.** Crear `server/migrations/011_kept_project.sql`:

```sql
-- Spec 2b-2 §4.7: al bajar de plan, el usuario elige qué proyecto sigue sincronizando.
--
-- Nullable y sin default: null = "no eligió", y entonces siguen los más viejos (por
-- `projects.id`: la tabla no tiene `created_at`). Queda guardado aunque el usuario vuelva a
-- pagar: con el tope alto la regla no aplica y la columna no tiene efecto.
alter table users add column if not exists kept_project_key text;
```

En `server/src/push.ts:157`: `const GLOBAL_PROJECT_KEY = '__global__'` → `export const GLOBAL_PROJECT_KEY = '__global__'`. Import arriba: `import { proyectosPermitidos } from './proyectos-permitidos'`. Dentro del lock `project-limit`, reemplazar

```ts
      const { rows: existing } = await client.query(
        'select project_key from projects where user_id = $1',
        [auth.userId]
      )
      const known = new Set(existing.map((r) => r.project_key as string))
      const maxProjects = limitsFor(auth.plan).maxProjects
```

por

```ts
      const { rows: existing } = await client.query(
        'select project_key, id from projects where user_id = $1 order by id',
        [auth.userId]
      )
      const known = new Set(existing.map((r) => r.project_key as string))
      const maxProjects = limitsFor(auth.plan).maxProjects
      // Spec 2b-2 §4.7: quien bajó de plan con más proyectos que el tope sólo sigue escribiendo
      // en los permitidos (el elegido, o los más viejos). Se lee DENTRO del lock: un keep
      // concurrente toma el mismo lock (keep.ts), así que la elección y el push no se cruzan.
      const { rows: keptRows } = await client.query('select kept_project_key from users where id = $1', [auth.userId])
      const permitidos = proyectosPermitidos(
        existing
          .filter((r) => r.project_key !== GLOBAL_PROJECT_KEY)
          .map((r) => ({ projectKey: r.project_key as string, id: Number(r.id) })),
        (keptRows[0]?.kept_project_key as string | null | undefined) ?? null,
        maxProjects
      )
```

y al principio del `for (const [key, displayName] of displayNames) {`, antes del `if (key !== GLOBAL_PROJECT_KEY && !known.has(key))` existente:

```ts
        // Ya está en la nube pero quedó fuera de lo permitido: mismo rechazo reversible.
        if (key !== GLOBAL_PROJECT_KEY && known.has(key) && !permitidos.has(key)) {
          overLimit.add(key)
          continue
        }
```

Crear `server/src/keep.ts`:

```ts
import type { Pool } from 'pg'
import { limitsFor } from './limits'
import { GLOBAL_PROJECT_KEY } from './push'

export type KeepResult =
  | { ok: true }
  | { ok: false; status: 400 | 409; error: 'unknown_project' | 'not_over_limit' }

/**
 * `POST /v1/projects/keep` (spec 2b-2 §4.7): qué proyecto sigue sincronizando quien quedó por
 * encima del tope. Sólo proyectos PROPIOS (la consulta es por `user_id`), nunca `__global__`.
 *
 * Bajo el mismo lock `project-limit:<user>` que el push: la elección y el chequeo de
 * permitidos de un push concurrente no se cruzan.
 */
export async function handleKeepProject(
  pool: Pool,
  auth: { userId: string; plan: string },
  body: Record<string, unknown>
): Promise<KeepResult> {
  const projectKey = typeof body.project_key === 'string' ? body.project_key : ''
  if (!projectKey || projectKey === GLOBAL_PROJECT_KEY) return { ok: false, status: 400, error: 'unknown_project' }

  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`project-limit:${auth.userId}`])
    const { rows } = await client.query('select project_key from projects where user_id = $1', [auth.userId])
    const propios = rows.map((r) => r.project_key as string).filter((k) => k !== GLOBAL_PROJECT_KEY)
    if (!propios.includes(projectKey)) {
      await client.query('rollback')
      return { ok: false, status: 400, error: 'unknown_project' }
    }
    if (propios.length <= limitsFor(auth.plan).maxProjects) {
      await client.query('rollback')
      return { ok: false, status: 409, error: 'not_over_limit' }
    }
    await client.query('update users set kept_project_key = $2 where id = $1', [auth.userId, projectKey])
    await client.query('commit')
    return { ok: true }
  } catch (err) {
    await client.query('rollback').catch(() => { /* la conexión ya puede estar rota */ })
    throw err
  } finally {
    client.release()
  }
}
```

En `server/src/status.ts`:
- import: `import { GLOBAL_PROJECT_KEY } from './push'`.
- En `interface StatusResponse`, después de `limits`:

```ts
  /**
   * Spec 2b-2 §4.7: el proyecto que el usuario eligió para seguir sincronizando cuando quedó
   * por encima del tope, o null (no eligió, o el elegido ya no es suyo: D3). Aditivo.
   */
  kept_project_key: string | null
  /** Spec 2b-2 §4.7: proyectos propios (sin `__global__`) > tope del plan. Aditivo. */
  over_limit: boolean
```

- El roster: `order by project_key` → `order by id` y su comentario suma: `// Spec 2b-2 (D2): por antigüedad, así la app sabe cuál es "el más viejo" sin otro campo.`
- La query de la época pasa a `'select key_epoch, kept_project_key from users where id = $1'`.
- Antes del `return`:

```ts
  const propios = projectRows.map((r) => r.project_key as string).filter((k) => k !== GLOBAL_PROJECT_KEY)
  const guardado = (epochRows[0]?.kept_project_key as string | null | undefined) ?? null
```

- En el `return`, después de `limits: statusLimitsFor(auth.plan),`:

```ts
    kept_project_key: guardado !== null && propios.includes(guardado) ? guardado : null,
    over_limit: propios.length > limits.maxProjects,
```

En `server/src/http.ts`: import `import { handleKeepProject } from './keep'`. Junto a `const isShare = …`:

```ts
  // Spec 2b-2 §4.7: qué proyecto sigue sincronizando quien bajó de plan.
  const isKeep = path === '/v1/projects/keep'
```

sumar `&& !isKeep` a la condición del 404 (`if (!isPush && !isPull && … && !isTeamKeyRecryptPending)`), y debajo del bloque `if (isShare) { … }`:

```ts
    if (isKeep) {
      if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
      const body = (await readBody(req)) as Record<string, unknown>
      const result = await handleKeepProject(pool, auth, body)
      if (!result.ok) return send(res, result.status, { error: result.error })
      return send(res, 200, { ok: true })
    }
```

En `server/README.md`: la fila de `GET /v1/sync/status` suma al final `, \`kept_project_key\` y \`over_limit\` (spec 2b-2)`; nueva fila después:

```
| `POST /v1/projects/keep` | — | Spec 2b-2 §4.7 — `{ project_key }`: con más proyectos que el tope, cuál sigue sincronizando. Sólo proyectos propios y nunca `__global__` (400 `unknown_project`); sin estar por encima del tope, 409 `not_over_limit`. |
```

y la fila de `project_limit_reached` pasa a:

```
| `project_limit_reached` | El `project_key` es nuevo para esa cuenta y ya no quedan lugares (tope de proyectos del plan), **o** la cuenta tiene más proyectos que el tope (bajó de plan) y éste no es uno de los permitidos: el elegido con `POST /v1/projects/keep` o, sin elección, los más viejos (spec 2b-2). |
```

- [ ] **Step 8:** `cd server && npx vitest run __tests__/proyectos-permitidos.test.ts __tests__/proyecto-elegido.test.ts __tests__/http.test.ts __tests__/push-project-limit.test.ts __tests__/push-project-limit-concurrency.test.ts __tests__/status.test.ts __tests__/status-team-keys.test.ts __tests__/limits-status.test.ts __tests__/push.test.ts` → PASS. Después la suite entera del servidor: `cd server && npx vitest run` → PASS. `cd server && npx tsc --noEmit` → 0. `docker stop nest-memory-pg`.

- [ ] **Step 9: Commit.**

```bash
git add server/migrations/011_kept_project.sql server/src/proyectos-permitidos.ts server/src/keep.ts server/src/push.ts server/src/status.ts server/src/http.ts server/README.md server/__tests__/proyectos-permitidos.test.ts server/__tests__/proyecto-elegido.test.ts server/__tests__/http.test.ts
git commit -m "feat(sync): al bajar de plan el usuario elige qué proyecto sigue

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Daemon, main y preload — `keptProjectKey`, `overLimit`, `keepProject`, `refreshStatus`

**Files:**
- Modify: `electron/memory-daemon.ts` (`StatusResponseBody` ~línea 106; campos privados ~línea 363; `setStore` ~línea 503; getters junto a `getCloudProjectKeys` ~línea 595; `doStatus` después del bloque de `limits` ~línea 1306; método nuevo `keepProject` después de `status()` ~línea 1186)
- Modify: `electron/main.ts` (handler `memory:status` ~línea 3789; handlers nuevos `memory:keepProject` y `memory:refreshStatus` después de `memory:status`)
- Modify: `electron/preload.ts` (después de `status:` ~línea 92), `src/types.ts` (tipo de `status` ~línea 1065 y dos métodos nuevos junto a `shareProjectWithTeam` ~línea 1167)
- Test: `electron/__tests__/memory-daemon-proyecto-elegido.test.ts`

**Interfaces:**
- Consumes (wire, Task 7): `status.kept_project_key`, `status.over_limit`, `POST /v1/projects/keep`.
- Produces (`MemoryDaemon`): `getKeptProjectKey(): string | null`; `isOverLimit(): boolean`; `keepProject(projectKey: string): Promise<{ ok: true } | { ok: false; error: string }>`.
- Produces (IPC / `window.memory`): `status()` suma `keptProjectKey?: string | null` y `overLimit?: boolean`; `keepProject?: (projectKey: string) => Promise<{ ok: boolean; error?: string }>`; `refreshStatus?: () => Promise<{ ok: boolean }>`.

- [ ] **Step 1: Tests que fallan.** Crear `electron/__tests__/memory-daemon-proyecto-elegido.test.ts`:

```ts
// Spec 2b-2 §4.7/§4.8: el daemon guarda el proyecto elegido y si la cuenta está por encima del
// tope, y elige proyecto contra POST /v1/projects/keep.
import { describe, it, expect, vi } from 'vitest'
import { MemoryDaemon, MOTIVO_TOPE_DE_PROYECTOS } from '../memory-daemon'
import type { MemoryStore } from '../memory-store'

function fakeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    pendingMutations: vi.fn(() => []),
    markPushed: vi.fn(),
    blockMutations: vi.fn(),
    blockedMutations: vi.fn(() => []),
    unblockMutations: vi.fn(),
    listProjects: vi.fn(() => []),
    ensureProject: vi.fn(),
    teamIdForProjectKey: vi.fn(() => null),
    setLocalTeamId: vi.fn(),
    knownKeyEpoch: vi.fn(() => 0),
    rememberKeyEpoch: vi.fn(),
    ...overrides,
  } as unknown as MemoryStore
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const falla = (status: number, body: unknown) => ({ ok: false, status, json: async () => body })

function daemonCon(store: MemoryStore, fetchImpl: ReturnType<typeof vi.fn>): MemoryDaemon {
  return new MemoryDaemon({
    store,
    getSyncBaseUrl: () => 'https://example.test',
    getToken: () => 'nmk_test',
    getDeviceId: () => 'device-1',
    isOnline: () => true,
    fetchImpl,
  } as unknown as ConstructorParameters<typeof MemoryDaemon>[0])
}

describe('MemoryDaemon — proyecto elegido (2b-2 §4.7)', () => {
  it('guarda kept_project_key y over_limit; por defecto null y false', async () => {
    const daemon = daemonCon(fakeStore(), vi.fn().mockResolvedValue(ok({ plan: 'free', kept_project_key: 'k2', over_limit: true })))
    expect(daemon.getKeptProjectKey()).toBeNull()
    expect(daemon.isOverLimit()).toBe(false)
    await daemon.status()
    expect(daemon.getKeptProjectKey()).toBe('k2')
    expect(daemon.isOverLimit()).toBe(true)
  })

  it('un servicio viejo (sin los campos) no los cambia; null explícito sí', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok({ plan: 'free', kept_project_key: 'k2', over_limit: true }))
      .mockResolvedValueOnce(ok({ plan: 'free' }))
      .mockResolvedValueOnce(ok({ plan: 'free', kept_project_key: null, over_limit: false }))
    const daemon = daemonCon(fakeStore(), fetchImpl)
    await daemon.status()
    await daemon.status()
    expect(daemon.getKeptProjectKey()).toBe('k2')
    await daemon.status()
    expect(daemon.getKeptProjectKey()).toBeNull()
    expect(daemon.isOverLimit()).toBe(false)
  })

  it('cambiar de cuenta los vacía', async () => {
    const daemon = daemonCon(fakeStore(), vi.fn().mockResolvedValue(ok({ plan: 'free', kept_project_key: 'k2', over_limit: true })))
    await daemon.status()
    daemon.setStore(fakeStore())
    expect(daemon.getKeptProjectKey()).toBeNull()
    expect(daemon.isOverLimit()).toBe(false)
  })

  it('keepProject postea, devuelve a la cola lo retenido por el tope, pide status y agenda push', async () => {
    const store = fakeStore()
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok({ ok: true }))
      .mockResolvedValueOnce(ok({ plan: 'free', kept_project_key: 'k2', over_limit: true }))
    const daemon = daemonCon(store, fetchImpl)
    const push = vi.spyOn(daemon, 'scheduleMutationPush').mockImplementation(() => {})

    expect(await daemon.keepProject('k2')).toEqual({ ok: true })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://example.test/v1/projects/keep')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer nmk_test')
    expect(JSON.parse(String(init.body))).toEqual({ project_key: 'k2' })
    expect(store.unblockMutations).toHaveBeenCalledWith([MOTIVO_TOPE_DE_PROYECTOS])
    expect(fetchImpl.mock.calls[1][0]).toBe('https://example.test/v1/sync/status')
    expect(daemon.getKeptProjectKey()).toBe('k2')
    expect(push).toHaveBeenCalled()
  })

  it('keepProject con un rechazo devuelve el código y no toca la cola', async () => {
    const store = fakeStore()
    const daemon = daemonCon(store, vi.fn().mockResolvedValue(falla(409, { error: 'not_over_limit' })))
    expect(await daemon.keepProject('k2')).toEqual({ ok: false, error: 'not_over_limit' })
    expect(store.unblockMutations).not.toHaveBeenCalled()
  })

  it('keepProject sin conexión o con la red caída no lanza', async () => {
    const sinToken = new MemoryDaemon({
      store: fakeStore(), getSyncBaseUrl: () => 'https://example.test', getToken: () => null,
      getDeviceId: () => 'device-1', isOnline: () => true, fetchImpl: vi.fn(),
    } as unknown as ConstructorParameters<typeof MemoryDaemon>[0])
    expect(await sinToken.keepProject('k2')).toEqual({ ok: false, error: 'not_connected' })

    const caida = daemonCon(fakeStore(), vi.fn().mockRejectedValue(new Error('ECONNRESET')))
    expect(await caida.keepProject('k2')).toEqual({ ok: false, error: 'ECONNRESET' })
  })
})
```

- [ ] **Step 2:** `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts electron/__tests__/memory-daemon-proyecto-elegido.test.ts` → FAIL (`getKeptProjectKey is not a function`).

- [ ] **Step 3: El daemon.** En `electron/memory-daemon.ts`:

`StatusResponseBody`, después de `limits?`:

```ts
  /** Spec 2b-2 §4.7: el proyecto elegido para seguir sincronizando, o null. Ausente = servicio viejo. */
  kept_project_key?: string | null
  /** Spec 2b-2 §4.7: la cuenta tiene más proyectos propios que el tope del plan. */
  over_limit?: boolean
```

Campos privados, después de `lastCloudProjectKeys`:

```ts
  // Spec 2b-2 §4.7: qué proyecto eligió seguir sincronizando quien bajó de plan, y si la cuenta
  // está por encima del tope. De la cuenta del store actual: `setStore` los vacía.
  private lastKeptProjectKey: string | null = null
  private lastOverLimit = false
```

En `setStore`, después de `this.lastCloudProjectKeys = null`:

```ts
    this.lastKeptProjectKey = null
    this.lastOverLimit = false
```

Getters, después de `getCloudProjectKeys()`:

```ts
  /** El proyecto elegido para seguir sincronizando (spec 2b-2), o null. */
  getKeptProjectKey(): string | null {
    return this.lastKeptProjectKey
  }

  /** Si la cuenta tiene más proyectos en la nube que los que su plan sincroniza (spec 2b-2). */
  isOverLimit(): boolean {
    return this.lastOverLimit
  }
```

En `doStatus`, justo después del `if (typeof maxProjects === 'number' …) { this.lastLimits = … }`:

```ts
      // Spec 2b-2 §4.7. Un campo ausente es un servicio viejo: se conserva lo conocido.
      if (body.kept_project_key === null || typeof body.kept_project_key === 'string') {
        this.lastKeptProjectKey = body.kept_project_key
      }
      if (typeof body.over_limit === 'boolean') this.lastOverLimit = body.over_limit
```

Método nuevo, después de `status()`:

```ts
  /**
   * Spec 2b-2 §4.7/§4.8 (D14): elige qué proyecto sigue sincronizando quien quedó por encima
   * del tope. Al volver ok, lo retenido por `project_limit_reached` vuelve a la cola —el recién
   * elegido lo tenía retenido— y el push re-retiene lo que siga fuera; después se pide un
   * status para que la UI vea la elección. Nunca lanza.
   */
  async keepProject(projectKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const { getSyncBaseUrl, getToken, isOnline } = this.deps
    const url = getSyncBaseUrl()
    const token = getToken()
    if (!url || !token) return { ok: false, error: 'not_connected' }
    if (!isOnline()) return { ok: false, error: 'offline' }

    let release: (() => void) | null = null
    try {
      const { response, release: releaseTimer } = await this.fetchWithTimeout(`${url}/v1/projects/keep`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_key: projectKey }),
      })
      release = releaseTimer
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null
        return { ok: false, error: typeof body?.error === 'string' ? body.error : `HTTP ${response.status}` }
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      release?.()
    }

    this.deps.store.unblockMutations([MOTIVO_TOPE_DE_PROYECTOS])
    await this.status()
    this.scheduleMutationPush()
    return { ok: true }
  }
```

- [ ] **Step 4:** el test del Step 2 → PASS. Además `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts electron/__tests__/memory-daemon-tope-de-proyectos.test.ts` → PASS.

- [ ] **Step 5: main, preload y tipos.** En `electron/main.ts`, handler `memory:status`, después de `cloudProjects: …,`:

```ts
    /** Spec 2b-2 §4.7: el proyecto elegido al bajar de plan, y si la cuenta está por encima
     *  del tope (con `overLimit` la fila «Projects in the cloud» muestra `Keep syncing`). */
    keptProjectKey: memory.daemon.getKeptProjectKey(),
    overLimit: memory.daemon.isOverLimit(),
```

Después del handler `memory:status`:

```ts
// Spec 2b-2 §4.8: elegir qué proyecto sigue sincronizando. Lo hace el daemon (D14), que tiene
// el token, el store y el timeout.
ipcMain.handle('memory:keepProject', async (_e, projectKey: string) => {
  if (!memory) return { ok: false, error: 'Memory is not available' }
  if (typeof projectKey !== 'string' || !projectKey.trim()) return { ok: false, error: 'Missing project_key' }
  return memory.daemon.keepProject(projectKey)
})

// Spec 2b-2 §4.8 (D9): la app vio cambiar el plan (pagó o canceló) y pide un status nuevo, para
// que el tope suba —y lo retenido converja— sin esperar al próximo poll (15 min en Free). El
// evento `memory:status` hace que el renderer vuelva a leer por `memory:status`.
ipcMain.handle('memory:refreshStatus', async () => {
  if (!memory) return { ok: false }
  await memory.daemon.status()
  const win = BrowserWindow.getAllWindows()[0]
  if (win) win.webContents.send('memory:status', memory.daemon.getStatus())
  return { ok: true }
})
```

En `electron/preload.ts`, después de `status: () => ipcRenderer.invoke('memory:status'),`:

```ts
  // Spec 2b-2 §4.8: elegir el proyecto que sigue sincronizando, y pedir un status nuevo cuando
  // la app ve cambiar el plan.
  keepProject: (projectKey: string) => ipcRenderer.invoke('memory:keepProject', projectKey),
  refreshStatus: () => ipcRenderer.invoke('memory:refreshStatus'),
```

En `src/types.ts`, tipo de `status`, después de `cloudProjects?: …`:

```ts
        /** Spec 2b-2 §4.7: el proyecto elegido al bajar de plan, o null. */
        keptProjectKey?: string | null
        /** Spec 2b-2 §4.7: más proyectos en la nube que los que el plan sincroniza. */
        overLimit?: boolean
```

y después de `shareProjectWithTeam?: …`:

```ts
      /** Spec 2b-2 §4.8: elegir el proyecto que sigue sincronizando (POST /v1/projects/keep).
       *  Opcional: un preload viejo no lo expone. */
      keepProject?: (projectKey: string) => Promise<{ ok: boolean; error?: string }>
      /** Spec 2b-2 §4.8: pedirle al daemon un status nuevo (al cambiar el plan). */
      refreshStatus?: () => Promise<{ ok: boolean }>
```

- [ ] **Step 6:** los dos `tsc` de CI → 0. `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts electron/__tests__` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add electron/memory-daemon.ts electron/main.ts electron/preload.ts src/types.ts electron/__tests__/memory-daemon-proyecto-elegido.test.ts
git commit -m "feat(memory): el daemon expone el proyecto elegido y elige contra el servicio

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: App — precios de Cloud, checkout por intervalo y portal en el modal

**Files:**
- Modify: `src/lib/stripe.ts` (se va `STRIPE_PRICES` y su comentario; constantes y tipo nuevos; `tieneSuscripcionPropia`)
- Create: `src/lib/checkout.ts`
- Modify: `src/components/UpgradeModal.tsx`
- Test: `src/__tests__/lib/checkout.test.ts` (nuevo), `src/__tests__/components/UpgradeModal.test.tsx`

**Interfaces:**
- Produces (`stripe.ts`): `CLOUD_MONTHLY_PRICE = 10`, `CLOUD_ANNUAL_MONTHLY_PRICE = 8`, `CLOUD_ANNUAL_PRICE = 96`, `export type BillingInterval = 'monthly' | 'annual'`, `export function tieneSuscripcionPropia(plan: string): boolean` (`cloud` | `pro`).
- Produces (`checkout.ts`): `COPY_CHECKOUT_NO_DISPONIBLE`, `COPY_CHECKOUT_SIN_RED` (strings del spec), `export type ResultadoDeCobro = { ok: true } | { ok: false; error: string }`, `export function textoDeErrorDeCobro(code: string | null): string`, `export async function abrirCheckout(interval: BillingInterval): Promise<ResultadoDeCobro>`, `export async function abrirPortal(): Promise<ResultadoDeCobro>`.

- [ ] **Step 1: Tests que fallan.** Crear `src/__tests__/lib/checkout.test.ts`:

```ts
// Spec 2b-2 §4.8: el cobro desde la app. Las funciones de Supabase devuelven el código del
// error en el cuerpo; acá se traduce a copy y `already_subscribed` cae al portal.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const supabaseMock = vi.hoisted(() => ({ functions: { invoke: vi.fn() } }))
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

import { abrirCheckout, abrirPortal, COPY_CHECKOUT_NO_DISPONIBLE, COPY_CHECKOUT_SIN_RED, textoDeErrorDeCobro } from '../../lib/checkout'

const conCodigo = (error: string) => ({ data: null, error: { context: { json: async () => ({ error }) } } })
let openExternal: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  openExternal = vi.fn()
  ;(globalThis as unknown as { window: { electronShell: unknown } }).window.electronShell = { openExternal }
})

describe('textoDeErrorDeCobro', () => {
  it('checkout_unavailable tiene su copy; cualquier otro, el genérico', () => {
    expect(COPY_CHECKOUT_NO_DISPONIBLE).toBe("Checkout isn't available right now — try again later.")
    expect(COPY_CHECKOUT_SIN_RED).toBe("Couldn't reach checkout. Check your connection and try again.")
    expect(textoDeErrorDeCobro('checkout_unavailable')).toBe(COPY_CHECKOUT_NO_DISPONIBLE)
    expect(textoDeErrorDeCobro('stripe_error')).toBe(COPY_CHECKOUT_SIN_RED)
    expect(textoDeErrorDeCobro(null)).toBe(COPY_CHECKOUT_SIN_RED)
  })
})

describe('abrirCheckout', () => {
  it('manda sólo el intervalo y abre la URL afuera', async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: { url: 'https://checkout.stripe.test/s' }, error: null })
    expect(await abrirCheckout('annual')).toEqual({ ok: true })
    expect(supabaseMock.functions.invoke).toHaveBeenCalledWith('stripe-checkout', { body: { interval: 'annual' } })
    expect(openExternal).toHaveBeenCalledWith('https://checkout.stripe.test/s')
  })

  it('already_subscribed abre el portal en vez de fallar', async () => {
    supabaseMock.functions.invoke
      .mockResolvedValueOnce(conCodigo('already_subscribed'))
      .mockResolvedValueOnce({ data: { url: 'https://billing.stripe.test/p' }, error: null })
    expect(await abrirCheckout('monthly')).toEqual({ ok: true })
    expect(supabaseMock.functions.invoke).toHaveBeenNthCalledWith(2, 'stripe-portal', { body: {} })
    expect(openExternal).toHaveBeenCalledWith('https://billing.stripe.test/p')
  })

  it('checkout_unavailable, un error sin cuerpo, una URL ausente o una excepción: copy y nada abierto', async () => {
    supabaseMock.functions.invoke.mockResolvedValueOnce(conCodigo('checkout_unavailable'))
    expect(await abrirCheckout('monthly')).toEqual({ ok: false, error: COPY_CHECKOUT_NO_DISPONIBLE })
    supabaseMock.functions.invoke.mockResolvedValueOnce({ data: null, error: new Error('Failed to send a request') })
    expect(await abrirCheckout('monthly')).toEqual({ ok: false, error: COPY_CHECKOUT_SIN_RED })
    supabaseMock.functions.invoke.mockResolvedValueOnce({ data: {}, error: null })
    expect(await abrirCheckout('monthly')).toEqual({ ok: false, error: COPY_CHECKOUT_SIN_RED })
    supabaseMock.functions.invoke.mockRejectedValueOnce(new Error('offline'))
    expect(await abrirCheckout('monthly')).toEqual({ ok: false, error: COPY_CHECKOUT_SIN_RED })
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('abrirPortal', () => {
  it('abre el portal; sin suscripción, el genérico (D8)', async () => {
    supabaseMock.functions.invoke.mockResolvedValueOnce({ data: { url: 'https://billing.stripe.test/p' }, error: null })
    expect(await abrirPortal()).toEqual({ ok: true })
    supabaseMock.functions.invoke.mockResolvedValueOnce(conCodigo('no_subscription'))
    expect(await abrirPortal()).toEqual({ ok: false, error: COPY_CHECKOUT_SIN_RED })
  })
})
```

Reemplazar **todo** `src/__tests__/components/UpgradeModal.test.tsx` por:

```tsx
// El modal de planes. Desde 2b-2 Cloud se cobra mensual o anual, y quien ya paga Cloud ve
// «Manage subscription» (el portal de Stripe) en vez de «Current plan».
//
// `UpgradeModal` es un default export sin prop `open` (se monta condicionalmente), y "Book a
// demo" es un <button> que abre el navegador por `electronShell.openExternal`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const supabaseMock = vi.hoisted(() => ({
  auth: { getUser: vi.fn() },
  functions: { invoke: vi.fn() },
}))
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

import UpgradeModal from '../../components/UpgradeModal'

let openExternal: ReturnType<typeof vi.fn>

describe('UpgradeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    openExternal = vi.fn()
    ;(window as unknown as { electronShell: { openExternal: ReturnType<typeof vi.fn> } }).electronShell = { openExternal }
  })

  it('muestra los tres planes y ninguno mas', () => {
    render(<UpgradeModal onClose={() => {}} currentPlan="free" />)
    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(screen.getByText('Cloud')).toBeInTheDocument()
    expect(screen.getByText('Teams')).toBeInTheDocument()
    expect(screen.queryByText('Pro')).not.toBeInTheDocument()
  })

  it('Teams no muestra precio: es venta asistida', () => {
    render(<UpgradeModal onClose={() => {}} currentPlan="free" />)
    expect(screen.getByRole('button', { name: /book a demo/i })).toBeInTheDocument()
    expect(screen.queryByText('$35')).toBeNull()
  })

  it('marca el plan actual en Free', () => {
    render(<UpgradeModal onClose={() => {}} currentPlan="free" />)
    expect(screen.getByText('Current plan')).toBeInTheDocument()
  })

  it('el toggle arranca en Monthly ($10 /mo) y Annual muestra $8 /mo billed $96 yearly', () => {
    render(<UpgradeModal onClose={() => {}} currentPlan="free" />)
    expect(screen.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('$10')).toBeInTheDocument()
    expect(screen.queryByText('billed $96 yearly')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Annual' }))
    expect(screen.getByRole('button', { name: 'Annual' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('$8')).toBeInTheDocument()
    expect(screen.getByText('billed $96 yearly')).toBeInTheDocument()
  })

  it('Upgrade to Cloud cobra el intervalo elegido, abre la URL y cierra', async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: { url: 'https://checkout.stripe.test/s' }, error: null })
    const onClose = vi.fn()
    render(<UpgradeModal onClose={onClose} currentPlan="free" />)
    fireEvent.click(screen.getByRole('button', { name: 'Annual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Cloud' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(supabaseMock.functions.invoke).toHaveBeenCalledWith('stripe-checkout', { body: { interval: 'annual' } })
    expect(openExternal).toHaveBeenCalledWith('https://checkout.stripe.test/s')
  })

  it('con plan cloud (o pro) el CTA es Manage subscription y abre el portal', async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: { url: 'https://billing.stripe.test/p' }, error: null })
    for (const plan of ['cloud', 'pro'] as const) {
      const { unmount } = render(<UpgradeModal onClose={() => {}} currentPlan={plan} />)
      expect(screen.queryByRole('button', { name: 'Upgrade to Cloud' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Manage subscription' }))
      await waitFor(() => expect(supabaseMock.functions.invoke).toHaveBeenCalledWith('stripe-portal', { body: {} }))
      unmount()
    }
  })

  it('already_subscribed abre el portal en vez de fallar', async () => {
    supabaseMock.functions.invoke
      .mockResolvedValueOnce({ data: null, error: { context: { json: async () => ({ error: 'already_subscribed' }) } } })
      .mockResolvedValueOnce({ data: { url: 'https://billing.stripe.test/p' }, error: null })
    render(<UpgradeModal onClose={() => {}} currentPlan="free" />)
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Cloud' }))
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith('https://billing.stripe.test/p'))
  })

  it('un error se ve en el modal y el botón vuelve a habilitarse', async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: 'checkout_unavailable' }) } } })
    render(<UpgradeModal onClose={() => {}} currentPlan="free" />)
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Cloud' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Checkout isn't available right now — try again later.")
    expect(screen.getByRole('button', { name: 'Upgrade to Cloud' })).toBeEnabled()
  })

  it('mientras carga no se puede volver a pedir (doble click)', async () => {
    let resolver!: (v: unknown) => void
    supabaseMock.functions.invoke.mockImplementation(() => new Promise((r) => { resolver = r }))
    render(<UpgradeModal onClose={() => {}} currentPlan="free" />)
    const boton = screen.getByRole('button', { name: 'Upgrade to Cloud' })
    fireEvent.click(boton)
    fireEvent.click(screen.getByRole('button', { name: '…' }))
    expect(supabaseMock.functions.invoke).toHaveBeenCalledTimes(1)
    resolver({ data: { url: 'https://checkout.stripe.test/s' }, error: null })
    await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1))
  })
})
```

- [ ] **Step 2:** `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts src/__tests__/lib/checkout.test.ts src/__tests__/components/UpgradeModal.test.tsx` → FAIL.

- [ ] **Step 3: `stripe.ts`.** Borrar el bloque `// Price IDs from Stripe dashboard … export const STRIPE_PRICES = { cloud_monthly: '', }` y reemplazar el bloque de `CLOUD_MONTHLY_PRICE` (su docstring incluido) por:

```ts
/**
 * Los precios de Cloud, la fuente de verdad de los números que se muestran (spec 2b-2 §4.1).
 * Los IDs de precio de Stripe NO viven en la app: los elige `stripe-checkout` desde sus
 * secrets según el intervalo, así un cliente no puede pedir un precio arbitrario.
 */
export const CLOUD_MONTHLY_PRICE = 10
/** Anual: US$ 96 por año, que se muestra como US$ 8 por mes. */
export const CLOUD_ANNUAL_MONTHLY_PRICE = 8
export const CLOUD_ANNUAL_PRICE = 96

export type BillingInterval = 'monthly' | 'annual'

/** Si el plan tiene una suscripción de Stripe propia que gestionar desde el portal. */
export function tieneSuscripcionPropia(plan: string): boolean {
  return plan === 'cloud' || plan === 'pro'
}
```

- [ ] **Step 4: `checkout.ts`.** Crear `src/lib/checkout.ts`:

```ts
// Spec 2b-2 §4.8: el cobro de Cloud desde la app. Las dos edge functions autentican con la
// sesión de Supabase (supabase-js manda el JWT solo) y devuelven `{ url }` o `{ error: <código> }`.
import { supabase } from './supabase'
import type { BillingInterval } from './stripe'

export const COPY_CHECKOUT_NO_DISPONIBLE = "Checkout isn't available right now — try again later."
export const COPY_CHECKOUT_SIN_RED = "Couldn't reach checkout. Check your connection and try again."

export type ResultadoDeCobro = { ok: true } | { ok: false; error: string }

/** El copy de un código de error de las funciones. D8: el portal usa el genérico. */
export function textoDeErrorDeCobro(code: string | null): string {
  return code === 'checkout_unavailable' ? COPY_CHECKOUT_NO_DISPONIBLE : COPY_CHECKOUT_SIN_RED
}

/** supabase-js pone la Response del no-2xx en `error.context`; el código va en su cuerpo. */
async function codigoDeError(error: unknown): Promise<string | null> {
  const contexto = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context
  if (!contexto || typeof contexto.json !== 'function') return null
  try {
    const cuerpo = (await contexto.json()) as { error?: unknown } | null
    return typeof cuerpo?.error === 'string' ? cuerpo.error : null
  } catch {
    return null
  }
}

async function invocar(funcion: 'stripe-checkout' | 'stripe-portal', body: object): Promise<{ url: string } | { code: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke(funcion, { body })
    if (error) return { code: await codigoDeError(error) }
    const url = (data as { url?: unknown } | null)?.url
    return typeof url === 'string' && url ? { url } : { code: null }
  } catch {
    return { code: null }
  }
}

export async function abrirPortal(): Promise<ResultadoDeCobro> {
  const r = await invocar('stripe-portal', {})
  if ('url' in r) {
    window.electronShell.openExternal(r.url)
    return { ok: true }
  }
  return { ok: false, error: textoDeErrorDeCobro(r.code) }
}

export async function abrirCheckout(interval: BillingInterval): Promise<ResultadoDeCobro> {
  const r = await invocar('stripe-checkout', { interval })
  if ('url' in r) {
    window.electronShell.openExternal(r.url)
    return { ok: true }
  }
  // Ya paga: el servidor evita el doble cobro y acá se abre su suscripción en vez de fallar.
  if (r.code === 'already_subscribed') return abrirPortal()
  return { ok: false, error: textoDeErrorDeCobro(r.code) }
}
```

- [ ] **Step 5: `UpgradeModal`.** En `src/components/UpgradeModal.tsx`:
- Imports: sacar `useEffect` y el import de `supabase`; el import de `../lib/stripe` pasa a:

```ts
import {
  CLOUD_MONTHLY_PRICE,
  CLOUD_ANNUAL_MONTHLY_PRICE,
  CLOUD_ANNUAL_PRICE,
  BOOK_DEMO_URL,
  TEAM_MIN_SEATS,
  tieneSuscripcionPropia,
  type BillingInterval,
  type Plan,
} from '../lib/stripe'
import { abrirCheckout, abrirPortal } from '../lib/checkout'
import { Button } from '@/components/ui/button'
```

- Reemplazar desde `export default function UpgradeModal(...) {` hasta el final de `handleUpgrade` (incluye `userId`, `userEmail`, el `useEffect`, `checkoutReady` y su comentario) por:

```tsx
export default function UpgradeModal({ currentPlan, onClose }: Props) {
  // `setIntervalo` y no `setInterval`: no tapar el global del navegador.
  const [interval, setIntervalo] = useState<BillingInterval>('monthly')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Spec 2b-2 §4.8: la identidad sale del JWT de la sesión (supabase-js lo manda solo) y el
  // precio lo elige la función según el intervalo. Los errores se ven en el modal.
  const cobrar = async (accion: () => ReturnType<typeof abrirCheckout>) => {
    if (loading) return
    setLoading(true)
    setError(null)
    const r = await accion()
    setLoading(false)
    if (r.ok) onClose()
    else setError(r.error)
  }
  const handleUpgrade = () => cobrar(() => abrirCheckout(interval))
  const handleManage = () => cobrar(abrirPortal)
```

- En el `map`, el cálculo de `isCurrent` queda igual; sumar debajo `const gestiona = plan.id === 'cloud' && tieneSuscripcionPropia(currentPlan)`.
- El bloque de precio (rama no-team) pasa a:

```tsx
                    <>
                      {plan.id === 'cloud' && (
                        <div role="group" aria-label="Billing" className="mb-2 inline-flex gap-1 rounded-lg border border-border p-0.5">
                          {(['monthly', 'annual'] as const).map((i) => (
                            <Button key={i} type="button" size="xs" variant={interval === i ? 'secondary' : 'ghost'}
                              aria-pressed={interval === i} onClick={() => setIntervalo(i)}>
                              {i === 'monthly' ? 'Monthly' : 'Annual'}
                            </Button>
                          ))}
                        </div>
                      )}
                      <span className="upgrade-plan-price">
                        {plan.id === 'cloud' ? `$${interval === 'annual' ? CLOUD_ANNUAL_MONTHLY_PRICE : CLOUD_MONTHLY_PRICE}` : '$0'}
                      </span>
                      {plan.id === 'cloud' && <span className="upgrade-plan-period">/mo</span>}
                      {plan.id === 'cloud' && interval === 'annual' && (
                        <span className="block w-full text-fs-sm text-muted-foreground">billed ${CLOUD_ANNUAL_PRICE} yearly</span>
                      )}
                    </>
```

(El contenedor `.upgrade-plan-pricing` es flex en `global.css`: si `block w-full` no baja de línea, envolver el toggle y la línea anual en `<div className="flex w-full flex-col">…</div>` alrededor del precio — verificarlo con la captura del e2e del Step 7.)

- El bloque del CTA pasa a:

```tsx
                <div className="upgrade-plan-cta">
                  {gestiona ? (
                    <button className="upgrade-plan-btn" onClick={handleManage} disabled={loading}>
                      {loading ? '…' : 'Manage subscription'}
                    </button>
                  ) : isCurrent ? (
                    <span className="upgrade-plan-badge">Current plan</span>
                  ) : plan.id === 'free' ? (
                    <button className="upgrade-plan-btn ghost" disabled>Free forever</button>
                  ) : plan.id === 'team' ? (
                    <button className="upgrade-plan-btn" onClick={handleBookDemo}>Book a demo</button>
                  ) : (
                    <button
                      className={`upgrade-plan-btn${plan.popular ? ' primary' : ''}`}
                      onClick={handleUpgrade}
                      disabled={loading}
                    >
                      {loading ? '…' : `Upgrade to ${plan.name}`}
                    </button>
                  )}
                </div>
```

- Después del `</div>` que cierra `.upgrade-plans`:

```tsx
        {error && <p role="alert" className="m-0 mt-3 text-center text-fs-sm text-destructive">{error}</p>}
```

- [ ] **Step 6:** `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts src/__tests__/lib/checkout.test.ts src/__tests__/components/UpgradeModal.test.tsx src/__tests__/components/MemoryHub.test.tsx src/__tests__/la-app-es-en-ingles.test.ts` → PASS. Los dos `tsc` de CI → 0 (confirma que nada más usaba `STRIPE_PRICES`).

- [ ] **Step 7: e2e de contraste (UI).** `npm run build`; `npm run native:electron` (si `EBUSY`: no matar nada, avisar y saltear este step dejándolo anotado para Task 10, que corre el mismo e2e). `npx playwright test e2e/04-contraste.spec.ts` → PASS (headless).

- [ ] **Step 8: Commit.**

```bash
git add src/lib/stripe.ts src/lib/checkout.ts src/components/UpgradeModal.tsx src/__tests__/lib/checkout.test.ts src/__tests__/components/UpgradeModal.test.tsx
git commit -m "feat(memories): pagar Cloud mensual o anual y gestionar la suscripción

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: App — aviso de activación, `Keep syncing` y `Manage subscription` en Settings › Sync

**Files:**
- Create: `src/lib/cambio-de-plan.ts`, `src/hooks/useAvisoDeCambioDePlan.ts`, `src/components/CloudActivadoToast.tsx`
- Modify: `src/App.tsx` (import; hook debajo de `useProfile()` ~línea 242; render junto a `{showUpgrade && …}` ~línea 2167)
- Modify: `src/lib/proyectos-en-la-nube.ts` (dos funciones al final), `src/components/memories/settings/CloudProjectsRow.tsx`, `src/hooks/useMemory.ts`, `src/components/CloudMemoryCard.tsx`
- Test: `src/__tests__/lib/cambio-de-plan.test.ts`, `src/__tests__/hooks/useAvisoDeCambioDePlan.test.tsx`, `src/__tests__/hooks/useMemory-proyecto-elegido.test.tsx` (nuevos); `src/__tests__/lib/proyectos-en-la-nube.test.ts`, `src/__tests__/components/CloudProjectsRow.test.tsx`, `src/__tests__/components/CloudMemoryCard.test.tsx`

**Interfaces:**
- Consumes: `window.memory.keepProject`, `window.memory.refreshStatus`, `status().keptProjectKey/overLimit` (Task 8); `abrirPortal`, `tieneSuscripcionPropia` (Task 9).
- Produces:
  - `cambio-de-plan.ts`: `export function esPlanPago(plan: string): boolean`; `export type CambioDePlan = 'activado' | 'bajado' | null`; `export function cambioDePlan(antes: string | null, ahora: string): CambioDePlan`.
  - `useAvisoDeCambioDePlan(plan: string, cargando: boolean): { avisoVisible: boolean; cerrarAviso: () => void }`.
  - `CloudActivadoToast({ onClose }: { onClose: () => void })`.
  - `proyectos-en-la-nube.ts`: `descripcionSobreElTope(max: number, n: number): string`; `proyectoQueSigue(enLaNube: readonly ProyectoEnLaNube[], kept: string | null): string | null`.
  - `CloudProjectsRowProps` suma `overLimit?: boolean`, `keptProjectKey?: string | null`, `onKeep?: (projectKey: string) => void`.
  - `useMemory()` suma `keptProjectKey: string | null`, `overLimit: boolean`, `keepProject(projectKey: string): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Tests puros que fallan.** Crear `src/__tests__/lib/cambio-de-plan.test.ts`:

```ts
// Spec 2b-2 §4.8: cuándo un cambio de plan merece el aviso y cuándo sólo un status nuevo.
import { describe, it, expect } from 'vitest'
import { cambioDePlan, esPlanPago } from '../../lib/cambio-de-plan'

describe('cambioDePlan', () => {
  it('de un no-pago a cloud: activado', () => {
    expect(cambioDePlan('free', 'cloud')).toBe('activado')
  })

  // Review Focus 1: la primera lectura no es un cambio.
  it('sin plan anterior (primera lectura) no es un cambio', () => {
    expect(cambioDePlan(null, 'cloud')).toBeNull()
    expect(cambioDePlan(null, 'free')).toBeNull()
  })

  it('de un pago a free: bajado', () => {
    expect(cambioDePlan('cloud', 'free')).toBe('bajado')
    expect(cambioDePlan('pro', 'free')).toBe('bajado')
  })

  it('sin cambio, o entre pagos, o de free a team: nada', () => {
    expect(cambioDePlan('cloud', 'cloud')).toBeNull()
    expect(cambioDePlan('pro', 'cloud')).toBeNull()
    expect(cambioDePlan('free', 'team')).toBeNull()
  })

  it('esPlanPago', () => {
    for (const p of ['cloud', 'pro', 'team', 'enterprise']) expect(esPlanPago(p)).toBe(true)
    for (const p of ['free', 'diamante', '']) expect(esPlanPago(p)).toBe(false)
  })
})
```

En `src/__tests__/lib/proyectos-en-la-nube.test.ts`, sumar al import `descripcionSobreElTope, proyectoQueSigue` y al final:

```ts
describe('por encima del tope (spec 2b-2 §4.8)', () => {
  it('la descripción', () => {
    expect(descripcionSobreElTope(1, 3)).toBe('Your plan syncs 1 of 3 projects.')
  })

  it('sigue el elegido; si no está en el roster (o no hay), el primero = el más viejo (D2)', () => {
    const roster = [{ projectKey: 'k-a', name: 'a' }, { projectKey: 'k-b', name: 'b' }]
    expect(proyectoQueSigue(roster, 'k-b')).toBe('k-b')
    expect(proyectoQueSigue(roster, null)).toBe('k-a')
    expect(proyectoQueSigue(roster, 'k-borrado')).toBe('k-a')
    expect(proyectoQueSigue([], null)).toBeNull()
  })
})
```

- [ ] **Step 2:** `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts src/__tests__/lib/cambio-de-plan.test.ts src/__tests__/lib/proyectos-en-la-nube.test.ts` → FAIL.

- [ ] **Step 3: Las reglas puras.** Crear `src/lib/cambio-de-plan.ts`:

```ts
// Spec 2b-2 §4.8: el plan lo cambia el webhook de Stripe en `profiles` y la app lo ve al
// recuperar el foco (useProfile). Acá se decide qué hacer con ese cambio.

/** Los planes que se cobran. Misma lista que `PLANES_PAGOS` del servidor y del checkout. */
export function esPlanPago(plan: string): boolean {
  return plan === 'cloud' || plan === 'pro' || plan === 'team' || plan === 'enterprise'
}

export type CambioDePlan = 'activado' | 'bajado' | null

/**
 * `activado` = de un no-pago a `cloud` (toast + status nuevo). `bajado` = de un pago a uno que
 * no lo es (status nuevo, sin toast). `antes === null` es la primera lectura: no es un cambio
 * (Review Focus 1: abrir la app con una cuenta que ya es Cloud no la "activa").
 */
export function cambioDePlan(antes: string | null, ahora: string): CambioDePlan {
  if (antes === null || antes === ahora) return null
  if (!esPlanPago(antes) && ahora === 'cloud') return 'activado'
  if (esPlanPago(antes) && !esPlanPago(ahora)) return 'bajado'
  return null
}
```

Al final de `src/lib/proyectos-en-la-nube.ts`:

```ts
/** Spec 2b-2 §4.8: la descripción de la fila cuando hay más proyectos en la nube que el tope. */
export function descripcionSobreElTope(max: number, n: number): string {
  return `Your plan syncs ${max} of ${n} projects.`
}

/**
 * El valor del select `Keep syncing`: el elegido si sigue en el roster; si no, el primero, que
 * es el más viejo porque `status` ordena el roster por antigüedad (D2/D3 del plan 2b-2).
 */
export function proyectoQueSigue(enLaNube: readonly ProyectoEnLaNube[], kept: string | null): string | null {
  if (kept !== null && enLaNube.some((p) => p.projectKey === kept)) return kept
  return enLaNube[0]?.projectKey ?? null
}
```

- [ ] **Step 4:** el comando del Step 2 → PASS.

- [ ] **Step 5: Tests de hook y componentes que fallan.** Crear `src/__tests__/hooks/useAvisoDeCambioDePlan.test.tsx`:

```tsx
// Spec 2b-2 §4.8: el toast de activación y el status nuevo al cambiar de plan.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAvisoDeCambioDePlan } from '../../hooks/useAvisoDeCambioDePlan'

let refreshStatus: ReturnType<typeof vi.fn>

beforeEach(() => {
  refreshStatus = vi.fn().mockResolvedValue({ ok: true })
  ;(window as unknown as { memory: unknown }).memory = { refreshStatus }
})
afterEach(() => { vi.useRealTimers() })

const montar = (plan: string, cargando: boolean) =>
  renderHook(({ plan, cargando }) => useAvisoDeCambioDePlan(plan, cargando), { initialProps: { plan, cargando } })

describe('useAvisoDeCambioDePlan', () => {
  // Review Focus 1: useProfile arranca en 'free' cargando y después lee 'cloud'.
  it('el arranque de una cuenta que ya es Cloud no muestra el aviso ni pide status', () => {
    const { result, rerender } = montar('free', true)
    rerender({ plan: 'cloud', cargando: false })
    expect(result.current.avisoVisible).toBe(false)
    expect(refreshStatus).not.toHaveBeenCalled()
  })

  it('de free a cloud (relectura por foco): aviso y status nuevo', () => {
    const { result, rerender } = montar('free', false)
    rerender({ plan: 'cloud', cargando: false })
    expect(result.current.avisoVisible).toBe(true)
    expect(refreshStatus).toHaveBeenCalledTimes(1)
  })

  it('de cloud a free: status nuevo, sin aviso', () => {
    const { result, rerender } = montar('cloud', false)
    rerender({ plan: 'free', cargando: false })
    expect(result.current.avisoVisible).toBe(false)
    expect(refreshStatus).toHaveBeenCalledTimes(1)
  })

  it('el aviso se cierra a mano o solo a los 8 s', () => {
    vi.useFakeTimers()
    const { result, rerender } = montar('free', false)
    rerender({ plan: 'cloud', cargando: false })
    act(() => { result.current.cerrarAviso() })
    expect(result.current.avisoVisible).toBe(false)

    rerender({ plan: 'free', cargando: false })
    rerender({ plan: 'cloud', cargando: false })
    expect(result.current.avisoVisible).toBe(true)
    act(() => { vi.advanceTimersByTime(8000) })
    expect(result.current.avisoVisible).toBe(false)
  })

  it('sin window.memory (preload viejo) no explota', () => {
    ;(window as unknown as { memory: unknown }).memory = undefined
    const { result, rerender } = montar('free', false)
    rerender({ plan: 'cloud', cargando: false })
    expect(result.current.avisoVisible).toBe(true)
  })
})
```

Crear `src/__tests__/hooks/useMemory-proyecto-elegido.test.tsx`:

```tsx
// Spec 2b-2 §4.8: useMemory expone el proyecto elegido y elige por el daemon.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useMemory } from '../../hooks/useMemory'

const supabaseMock = vi.hoisted(() => ({
  functions: { invoke: vi.fn() },
  auth: {
    getSession: vi.fn(), getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  },
}))
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

const memoryMock = {
  status: vi.fn(),
  doctor: vi.fn().mockResolvedValue({ ok: true, blockedTotal: 0, groups: [], localOnlyProjects: [] }),
  keepProject: vi.fn().mockResolvedValue({ ok: true }),
  onStatus: vi.fn(),
  removeStatusListener: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { memory: unknown }).memory = memoryMock
  memoryMock.status.mockResolvedValue({
    connected: true, deviceId: 'd', itemCount: 0, pendingCount: 0, daemonStatus: 'idle',
    limits: { max_projects: 1 }, cloudProjects: [{ projectKey: 'k-a', name: 'a' }, { projectKey: 'k-b', name: 'b' }],
    keptProjectKey: 'k-b', overLimit: true,
  })
})

describe('useMemory — proyecto elegido', () => {
  it('expone keptProjectKey y overLimit del status', async () => {
    const { result } = renderHook(() => useMemory())
    await waitFor(() => expect(result.current.overLimit).toBe(true))
    expect(result.current.keptProjectKey).toBe('k-b')
  })

  it('un status sin los campos los deja en null y false', async () => {
    memoryMock.status.mockResolvedValue({ connected: true, deviceId: 'd', itemCount: 0, pendingCount: 0, daemonStatus: 'idle' })
    const { result } = renderHook(() => useMemory())
    await waitFor(() => expect(result.current.state).toBe('connected'))
    expect(result.current.keptProjectKey).toBeNull()
    expect(result.current.overLimit).toBe(false)
  })

  it('keepProject llama al daemon y refresca', async () => {
    const { result } = renderHook(() => useMemory())
    await waitFor(() => expect(result.current.overLimit).toBe(true))
    const llamadasAntes = memoryMock.status.mock.calls.length
    await act(async () => { expect(await result.current.keepProject('k-a')).toEqual({ ok: true }) })
    expect(memoryMock.keepProject).toHaveBeenCalledWith('k-a')
    expect(memoryMock.status.mock.calls.length).toBeGreaterThan(llamadasAntes)
  })
})
```

En `src/__tests__/components/CloudProjectsRow.test.tsx`, sumar al final del `describe`:

```tsx
  describe('por encima del tope (spec 2b-2 §4.8)', () => {
    const tres = [{ projectKey: 'k-a', name: 'api' }, { projectKey: 'k-n', name: 'raven-nest' }, { projectKey: 'k-w', name: 'web' }]

    it('descripción, Keep syncing con el elegido y Upgrade', () => {
      const onUpgrade = vi.fn()
      render(<CloudProjectsRow enLaNube={tres} maxProyectos={1} fuera={[]} onUpgrade={onUpgrade} overLimit keptProjectKey="k-n" onKeep={vi.fn()} />)
      expect(screen.getByText('Your plan syncs 1 of 3 projects.')).toBeInTheDocument()
      expect(screen.getByText('Keep syncing')).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Keep syncing' })).toHaveTextContent('raven-nest')
      fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
      expect(onUpgrade).toHaveBeenCalledTimes(1)
    })

    it('sin elección muestra el primero del roster (el más viejo)', () => {
      render(<CloudProjectsRow enLaNube={tres} maxProyectos={1} fuera={[]} onUpgrade={vi.fn()} overLimit keptProjectKey={null} onKeep={vi.fn()} />)
      expect(screen.getByRole('combobox', { name: 'Keep syncing' })).toHaveTextContent('api')
    })

    it('elegir otro llama onKeep con su key', async () => {
      const onKeep = vi.fn()
      render(<CloudProjectsRow enLaNube={tres} maxProyectos={1} fuera={[]} onUpgrade={vi.fn()} overLimit keptProjectKey="k-n" onKeep={onKeep} />)
      fireEvent.click(screen.getByRole('combobox', { name: 'Keep syncing' }))
      fireEvent.click(await screen.findByRole('option', { name: 'web' }))
      expect(onKeep).toHaveBeenCalledWith('k-w')
    })

    it('un Free que nunca pagó (sin overLimit) no ve el select: 2b-1 intacto', () => {
      render(<CloudProjectsRow enLaNube={[tres[1]]} maxProyectos={1} fuera={[]} onUpgrade={vi.fn()} />)
      expect(screen.getByText('1 of 1 · raven-nest')).toBeInTheDocument()
      expect(screen.queryByText('Keep syncing')).toBeNull()
    })
  })
```

En `src/__tests__/components/CloudMemoryCard.test.tsx`: en el `vi.hoisted` del mock de supabase sumar `functions: { invoke: vi.fn() },` al objeto devuelto; en el tipo del parámetro `status` de `mockMemoryBridge` sumar `keptProjectKey?: string | null` y `overLimit?: boolean`; en el objeto `memory` de `mockMemoryBridge` sumar `keepProject: vi.fn().mockResolvedValue({ ok: true }),`. Al final del archivo:

```tsx
describe('CloudMemoryCard — 2b-2', () => {
  const flagsAntes = window.appFlags
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
  })
  afterEach(() => {
    (window as { appFlags?: unknown }).appFlags = flagsAntes
    delete (window as unknown as { memory?: unknown }).memory
  })

  const conectadaSobreElTope = {
    connected: true, deviceId: 'dev-1', itemCount: 3, pendingCount: 0, daemonStatus: 'idle' as const,
    limits: { max_projects: 1 },
    cloudProjects: [{ projectKey: 'k-a', name: 'api' }, { projectKey: 'k-b', name: 'web' }],
    keptProjectKey: null, overLimit: true,
  }

  it('por encima del tope: Keep syncing y elegir llama al daemon', async () => {
    mockLocalPaths()
    const memory = mockMemoryBridge(conectadaSobreElTope)
    render(<CloudMemoryCard />)
    expect(await screen.findByText('Your plan syncs 1 of 2 projects.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('combobox', { name: 'Keep syncing' }))
    fireEvent.click(await screen.findByRole('option', { name: 'web' }))
    await waitFor(() => expect(memory.keepProject).toHaveBeenCalledWith('k-b'))
  })

  it('con plan cloud, Manage subscription abre el portal (D10)', async () => {
    ;(window as unknown as { appFlags: unknown }).appFlags = { e2eBypass: true, e2ePlan: 'cloud' }
    supabaseMock.functions.invoke.mockResolvedValue({ data: { url: 'https://billing.stripe.test/p' }, error: null })
    const openExternal = vi.fn()
    ;(window as unknown as { electronShell: unknown }).electronShell = { openExternal }
    mockLocalPaths()
    mockMemoryBridge({ ...conectadaSobreElTope, overLimit: false })
    render(<CloudMemoryCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage subscription' }))
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith('https://billing.stripe.test/p'))
  })

  it('con plan free no hay Manage subscription', async () => {
    mockLocalPaths()
    mockMemoryBridge({ ...conectadaSobreElTope, overLimit: false })
    render(<CloudMemoryCard />)
    await screen.findByText('Cloud sync')
    expect(screen.queryByRole('button', { name: 'Manage subscription' })).toBeNull()
  })
})
```

(Si `afterEach` no está importado en ese archivo, ya lo está: el import de la línea 1 trae `afterEach`.)

- [ ] **Step 6:** `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts src/__tests__/hooks/useAvisoDeCambioDePlan.test.tsx src/__tests__/hooks/useMemory-proyecto-elegido.test.tsx src/__tests__/components/CloudProjectsRow.test.tsx src/__tests__/components/CloudMemoryCard.test.tsx` → FAIL.

- [ ] **Step 7: Hook, toast y App.** Crear `src/hooks/useAvisoDeCambioDePlan.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { cambioDePlan } from '../lib/cambio-de-plan'

const DURACION_DEL_AVISO_MS = 8000

/**
 * Spec 2b-2 §4.8: cuando `useProfile` ve el plan pasar a `cloud` (relectura por foco al volver
 * del navegador de pagar), aviso + status nuevo al daemon: con eso actúa lo de 2b-1 —el tope
 * sube y lo retenido converge solo—. Al bajar de un pago, sólo el status.
 *
 * Lo leído mientras `cargando` no cuenta: `useProfile` arranca en `free` y la primera lectura
 * real no es un cambio (Review Focus 1).
 */
export function useAvisoDeCambioDePlan(plan: string, cargando: boolean): { avisoVisible: boolean; cerrarAviso: () => void } {
  const anterior = useRef<string | null>(null)
  const [avisoVisible, setAvisoVisible] = useState(false)

  useEffect(() => {
    if (cargando) return
    const cambio = cambioDePlan(anterior.current, plan)
    anterior.current = plan
    if (cambio === null) return
    void window.memory?.refreshStatus?.()
    if (cambio === 'activado') setAvisoVisible(true)
  }, [plan, cargando])

  useEffect(() => {
    if (!avisoVisible) return
    const t = setTimeout(() => setAvisoVisible(false), DURACION_DEL_AVISO_MS)
    return () => clearTimeout(t)
  }, [avisoVisible])

  const cerrarAviso = useCallback(() => setAvisoVisible(false), [])
  return { avisoVisible, cerrarAviso }
}
```

Crear `src/components/CloudActivadoToast.tsx`:

```tsx
// Spec 2b-2 §4.8: el aviso de que Cloud quedó activo. No hay servicio de toasts en la app (D11):
// componente propio, shadcn + utilidades, por encima de cualquier overlay.
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'

export default function CloudActivadoToast({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[var(--z-overlay-modal)] flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-fs-sm text-popover-foreground shadow-lg"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ok" />
      Cloud is active — syncing all your projects.
      <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onClose}>×</Button>
    </div>,
    document.body,
  )
}
```

En `src/App.tsx`: imports `import { useAvisoDeCambioDePlan } from './hooks/useAvisoDeCambioDePlan'` y `import CloudActivadoToast from './components/CloudActivadoToast'`. Debajo de `const { plan, isTrialActive, trialDaysLeft, loading: profileLoading } = useProfile()`:

```ts
  // Spec 2b-2 §4.8 (D11): el aviso de Cloud activo vive acá, la instancia de useProfile que
  // está siempre montada.
  const avisoDeCloud = useAvisoDeCambioDePlan(plan, profileLoading)
```

y antes de `{showUpgrade && (`:

```tsx
      {avisoDeCloud.avisoVisible && <CloudActivadoToast onClose={avisoDeCloud.cerrarAviso} />}
```

- [ ] **Step 8: useMemory.** En `src/hooks/useMemory.ts`:
- `MemoryHookState` suma, después de `localOnlyProjects`:

```ts
  /** Spec 2b-2 §4.7: el proyecto elegido para seguir sincronizando, o null. */
  keptProjectKey: string | null
  /** Spec 2b-2 §4.7: más proyectos en la nube que los que el plan sincroniza. */
  overLimit: boolean
```

- El estado inicial suma `keptProjectKey: null, overLimit: false,`.
- En `refresh`, después de `localOnlyProjects: …`:

```ts
      // Como el roster: no se conservan, el daemon los vacía al cambiar de cuenta.
      keptProjectKey: status.keptProjectKey ?? null,
      overLimit: status.overLimit === true,
```

- Antes del `return` final:

```ts
  /** Spec 2b-2 §4.8: elegir el proyecto que sigue sincronizando. Refresca pase lo que pase. */
  const keepProject = useCallback(async (projectKey: string): Promise<{ ok: boolean; error?: string }> => {
    const api = memoryApi()
    if (!api?.keepProject) return { ok: false, error: 'This build cannot choose a project' }
    const r = await api.keepProject(projectKey)
    await refresh()
    return r
  }, [refresh])
```

- El `return` suma `keepProject`.

- [ ] **Step 9: CloudProjectsRow.** Reemplazar **todo** `src/components/memories/settings/CloudProjectsRow.tsx` por:

```tsx
// Spec 2b-1 §4.4: la fila «Projects in the cloud» de Settings › Sync. Presentación pura: el
// roster, el tope y lo que quedó afuera entran por props (no le habla al bridge de memoria).
// Spec 2b-2 §4.8: por encima del tope (bajó de plan), `Keep syncing` elige qué proyecto sigue.
import SettingRow from './SettingRow'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  descripcionDeProyectosEnLaNube, descripcionSobreElTope, lineaSoloLocales, proyectoQueSigue, soloLocales, tieneTope,
  type ProyectoEnLaNube,
} from '@/lib/proyectos-en-la-nube'

export interface CloudProjectsRowProps {
  /** El roster de la nube, sin `__global__`, con nombres locales, del más viejo al más nuevo. */
  enLaNube: readonly ProyectoEnLaNube[]
  /** `limits.max_projects` del servidor; null = todavía no lo informó. */
  maxProyectos: number | null
  /** Los repos retenidos por el tope (`memory:doctor`). */
  fuera: readonly ProyectoEnLaNube[]
  onUpgrade: () => void
  /** Spec 2b-2: hay más proyectos en la nube que los que el plan sincroniza. */
  overLimit?: boolean
  /** Spec 2b-2: el proyecto elegido; null = no eligió (sigue el más viejo). */
  keptProjectKey?: string | null
  onKeep?: (projectKey: string) => void
}

export default function CloudProjectsRow({
  enLaNube, maxProyectos, fuera, onUpgrade, overLimit = false, keptProjectKey = null, onKeep,
}: CloudProjectsRowProps) {
  // D4 (2b-1): sólo con tope. A un Cloud con retenidas viejas no se le ofrece pasar a Cloud.
  const afuera = tieneTope(maxProyectos) ? soloLocales(fuera, enLaNube) : []
  const sobreElTope = overLimit && tieneTope(maxProyectos) && enLaNube.length > 0
  const sigue = sobreElTope ? proyectoQueSigue(enLaNube, keptProjectKey) : null

  const upgrade = <Button size="sm" onClick={onUpgrade}>Upgrade</Button>
  const control = sobreElTope ? (
    <>
      <span className="text-fs-sm text-muted-foreground">Keep syncing</span>
      <Select value={sigue ?? undefined} onValueChange={(v) => { if (v !== sigue) onKeep?.(v) }}>
        <SelectTrigger size="sm" aria-label="Keep syncing"><SelectValue /></SelectTrigger>
        <SelectContent>
          {enLaNube.map((p) => <SelectItem key={p.projectKey} value={p.projectKey}>{p.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {upgrade}
    </>
  ) : afuera.length > 0 ? upgrade : null

  return (
    <SettingRow
      nombre="Projects in the cloud"
      descripcion={sobreElTope
        ? descripcionSobreElTope(maxProyectos as number, enLaNube.length)
        : descripcionDeProyectosEnLaNube(enLaNube, maxProyectos)}
      control={control}
    >
      {afuera.length > 0 && <p className="m-0 text-fs-sm text-muted-foreground">{lineaSoloLocales(afuera)}</p>}
    </SettingRow>
  )
}
```

- [ ] **Step 10: CloudMemoryCard.** En `src/components/CloudMemoryCard.tsx`:
- Imports: `import { planIncluyeNube, tieneSuscripcionPropia } from '../lib/stripe'` y `import { abrirPortal } from '../lib/checkout'`.
- Debajo de `const [turnOffOpen, setTurnOffOpen] = useState(false)`:

```ts
  // Spec 2b-2 §4.8 (D10): quien paga Cloud gestiona la suscripción desde acá hasta 2b-3.
  const [errorDeCobro, setErrorDeCobro] = useState<string | null>(null)
  const [abriendoPortal, setAbriendoPortal] = useState(false)
  const gestionar = async () => {
    setAbriendoPortal(true)
    setErrorDeCobro(null)
    const r = await abrirPortal()
    setAbriendoPortal(false)
    if (!r.ok) setErrorDeCobro(r.error)
  }
  const manage = tieneSuscripcionPropia(plan) && (
    <Button variant="outline" size="sm" disabled={abriendoPortal} onClick={() => void gestionar()}>Manage subscription</Button>
  )
```

- En el `SettingRow` de «Cloud sync», `control={control}` pasa a `control={<>{manage}{control}</>}` y, dentro de sus hijos, debajo de `{estado}`:

```tsx
        {errorDeCobro && linea(errorDeCobro, 'destructive')}
```

- En el `<CloudProjectsRow … />`, sumar:

```tsx
          overLimit={memory.overLimit}
          keptProjectKey={memory.keptProjectKey}
          onKeep={(projectKey) => void memory.keepProject(projectKey)}
```

- [ ] **Step 11:** el comando del Step 6 → PASS. Suite completa: `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts` → PASS (incluye `la-app-es-en-ingles`). Los dos `tsc` de CI → 0.

- [ ] **Step 12: e2e de contraste (UI).** `npm run build`; `npm run native:electron` (si `EBUSY`: no matar nada; si la app viva ya corre con el binding de Electron, seguir; si no, avisar a Gero y saltear). `npx playwright test e2e/04-contraste.spec.ts` → PASS (headless, sin `RAVEN_E2E_SHOW`). Si Task 9 salteó su Step 7, este lo cubre.

- [ ] **Step 13: Commit.**

```bash
git add src/lib/cambio-de-plan.ts src/hooks/useAvisoDeCambioDePlan.ts src/components/CloudActivadoToast.tsx src/App.tsx src/lib/proyectos-en-la-nube.ts src/components/memories/settings/CloudProjectsRow.tsx src/hooks/useMemory.ts src/components/CloudMemoryCard.tsx src/__tests__/lib/cambio-de-plan.test.ts src/__tests__/hooks/useAvisoDeCambioDePlan.test.tsx src/__tests__/hooks/useMemory-proyecto-elegido.test.tsx src/__tests__/lib/proyectos-en-la-nube.test.ts src/__tests__/components/CloudProjectsRow.test.tsx src/__tests__/components/CloudMemoryCard.test.tsx
git commit -m "feat(memories): aviso de Cloud activo, Keep syncing y Manage subscription

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Runbook de salida (spec §7) — sólo escrito, sin ejecutar

**Files:**
- Create: `docs/RUNBOOK-PAGAR-CLOUD.md`

**Interfaces:**
- Consumes: los nombres reales de todo lo anterior (secrets, funciones, rutas, eventos).

- [ ] **Step 1: Escribir el runbook.** Crear `docs/RUNBOOK-PAGAR-CLOUD.md` con este contenido (nada se ejecuta en esta tarea; cada paso lleva el OK explícito de Gero):

````markdown
# Runbook — pagar Cloud con Stripe (2b-2)

Spec: `docs/superpowers/specs/2026-10-21-pagar-cloud-stripe-design.md` §7. **Cada paso es una
acción externa y necesita el OK explícito de Gero antes de correrlo.** Ningún secreto va a git
ni a este archivo: todos salen de 1Password.

## 1. Stripe en modo TEST

1. Producto **Nest Cloud** con dos precios recurrentes en USD: `$10 / month` y `$96 / year`.
   Anotar los dos `price_…` en 1Password.
2. Customer Portal (Settings › Billing › Customer portal): cancelar **al fin del período**,
   cambiar tarjeta, ver facturas, y cambiar de plan **sólo entre los dos precios de Cloud**.
3. Endpoint de webhook → `https://<ref>.supabase.co/functions/v1/stripe-webhook`, con los eventos
   `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Anotar el `whsec_…` en 1Password.

## 2. Secrets y deploy en STAGING

Generar `PLAN_SYNC_SECRET` (≥ 32 caracteres, p. ej. `openssl rand -hex 32`) y guardarlo en 1Password.

Supabase staging:

```bash
supabase secrets set --project-ref <staging> \
  STRIPE_PRICE_CLOUD_MONTHLY=price_... STRIPE_PRICE_CLOUD_ANNUAL=price_... \
  PLAN_SYNC_URL=https://<servicio de sync de staging> PLAN_SYNC_SECRET=<1Password>
# STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET: los de modo test, si no están ya.
supabase functions deploy stripe-checkout --project-ref <staging>
supabase functions deploy stripe-portal --project-ref <staging>
supabase functions deploy stripe-webhook --project-ref <staging> --no-verify-jwt
```

Railway staging (servicio de sync): variable `PLAN_SYNC_SECRET` = el mismo valor. Deploy del
servidor (corre la migración `011_kept_project.sql` sola al arrancar). Verificar que
`SUPABASE_URL` y `SUPABASE_ANON_KEY` estén seteadas: sin ellas la red de seguridad del registro
(§4.6) no corre.

Comprobación rápida: `POST /internal/plan` sin firma → 401 (con el secreto puesto) y no 404.

## 3. Compra de punta a punta (tarjeta de test `4242 4242 4242 4242`)

1. Cuenta Free conectada a la nube con 2+ repos (uno en la nube, los otros `Local only`).
2. Upgrade → Cloud → Monthly → pagar. Volver a Nest: aparece `Cloud is active — syncing all
   your projects.`; Settings › Sync muestra `N projects` y lo retenido sube solo.
3. En el servidor: `users.plan = 'cloud'` y la fila en `allowlist`.
4. Manage subscription → cancelar en el portal. Con "al fin del período", Stripe manda
   `customer.subscription.deleted` recién al vencer: para probarlo ya, cancelar inmediatamente
   desde el dashboard de Stripe (modo test).
5. Volver a Nest (foco): la fila dice `Your plan syncs 1 of N projects.` con `Keep syncing`;
   elegir otro proyecto y comprobar que ése sincroniza y los demás quedan retenidos.
6. Repetir con Annual y con una cuenta que nunca estuvo en la allowlist (pagar la mete).

## 4. Landing (`pagina-nest`, deploy de Gero)

Páginas `/checkout/success` (`You're on Cloud — go back to Nest.`), `/checkout/cancelled`
(`Checkout cancelled — nothing was charged.`) y `/checkout/portal-return`. Vercel bloquea los
commits de colaboradores: el deploy lo hace Gero.

## 5. Recién después: LIVE y prod

Repetir 1–2 en modo live y en los proyectos de producción (Supabase prod, Railway prod), con
precios y secretos nuevos. Un smoke de compra real con una tarjeta propia y reembolso.

## Recuperación

- Un pago que no llegó al servidor: el webhook devuelve 500 y Stripe reintenta hasta 3 días.
  Mientras tanto, registrar una máquina relee el plan (red de seguridad). A mano:
  `server/scripts/mint-device-token.mjs` o un `POST /internal/plan` firmado.
- Rotar `PLAN_SYNC_SECRET`: setear el nuevo en Railway y en Supabase en el mismo minuto; los
  avisos firmados con el viejo fallan con 401 y Stripe los reintenta.
````

- [ ] **Step 2: Verificar** que cada nombre del runbook existe en el código: `rg -n "STRIPE_PRICE_CLOUD_MONTHLY|PLAN_SYNC_URL|PLAN_SYNC_SECRET|011_kept_project|/internal/plan" supabase server/src server/migrations` → coincidencias en todos.

- [ ] **Step 3: Commit.**

```bash
git add docs/RUNBOOK-PAGAR-CLOUD.md
git commit -m "docs(runbook): salida de pagar Cloud con Stripe (2b-2)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Cierre de la rama (después de Task 11)

- [ ] Los dos `tsc` de CI → 0. `cd server && npx tsc --noEmit` → 0.
- [ ] `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts` → PASS (app + electron + `supabase/functions`).
- [ ] `docker start nest-memory-pg`; `cd server && npx vitest run` → PASS; `docker stop nest-memory-pg`.
- [ ] `npx playwright test e2e/04-contraste.spec.ts` headless → PASS.
- [ ] Nada pusheado, nada deployado, ninguna llamada a Stripe. El handoff del repo registra estado, pruebas y que spec §7 sigue pendiente con el runbook.
