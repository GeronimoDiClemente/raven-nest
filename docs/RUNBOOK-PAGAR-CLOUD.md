# Runbook — pagar Cloud con Stripe (2b-2)

Spec: `docs/superpowers/specs/2026-10-21-pagar-cloud-stripe-design.md` §7. **Cada paso es una
acción externa y necesita el OK explícito de Gero antes de correrlo.** Ningún secreto va a git
ni a este archivo: todos salen de 1Password (o de variables de entorno), y acá sólo figuran los
nombres.

> **BLOQUEANTE — leer antes de mergear a `main`.** `release.yml` deploya TODAS las edge
> functions de Stripe a **producción** (incluida `stripe-portal`, todas con `--no-verify-jwt`:
> cada función autentica en código) cada vez que corre en canal estable: un push a `main` **que
> cambie `package.json`** (el bump de versión) o un `workflow_dispatch` con `canal=estable`. Un
> merge que no toca `package.json` no dispara nada; el bump siguiente publica el webhook nuevo en
> prod automáticamente. **Antes de ese merge tienen que estar cargados en prod**
> (Supabase prod) `STRIPE_PRICE_CLOUD_MONTHLY`, `STRIPE_PRICE_CLOUD_ANNUAL`, `PLAN_SYNC_URL` y
> `PLAN_SYNC_SECRET`, **y en Railway prod** `PLAN_SYNC_SECRET` (el mismo valor). **Si falta
> alguno, cada activación de suscripción devuelve 500** y Stripe la reintenta sin que el plan
> llegue nunca.
>
> **Y Railway prod tiene que estar corriendo el servidor NUEVO** (la ruta `/internal/plan` y la
> migración `011_kept_project.sql`). Con el servidor viejo `/internal/plan` contesta **404**, y
> el webhook devuelve **500 a TODA activación, incluidas las renovaciones de Pro/Team legacy**.
> Verificación: un `POST <PLAN_SYNC_URL>/internal/plan` **sin firma** contra prod tiene que
> devolver **401**, no 404. No mergear hasta tildar los seis.

## 1. Stripe en modo TEST

1. Producto **Nest Cloud** con dos precios recurrentes en USD: `$10 / month` y `$96 / year`.
   Anotar los dos `price_…` en 1Password.
2. Customer Portal (Settings › Billing › Customer portal): cancelar **al fin del período**,
   cambiar tarjeta, ver facturas, y cambiar de plan **sólo entre los dos precios de Cloud**.
3. Endpoint de webhook → `https://<ref>.supabase.co/functions/v1/stripe-webhook`, con los eventos
   `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Anotar el `whsec_…` en 1Password.

## 2. Secrets y deploy en STAGING

Generar `PLAN_SYNC_SECRET` (≥ 32 caracteres, p. ej. `openssl rand -hex 32`) y guardarlo en
1Password. `PLAN_SYNC_URL` es la **base** del servicio (sin ruta): el webhook le agrega
`/internal/plan`.

Supabase staging:

```bash
supabase secrets set --project-ref <staging> \
  STRIPE_PRICE_CLOUD_MONTHLY=<price_ de 1Password> STRIPE_PRICE_CLOUD_ANNUAL=<price_ de 1Password> \
  PLAN_SYNC_URL=<base del servicio de sync de staging> PLAN_SYNC_SECRET=<1Password>
# STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET: los de modo test, si no están ya.
supabase functions deploy stripe-checkout --project-ref <staging> --no-verify-jwt
supabase functions deploy stripe-portal --project-ref <staging> --no-verify-jwt
supabase functions deploy stripe-webhook --project-ref <staging> --no-verify-jwt
```

Las tres van con `--no-verify-jwt` (igual que en `release.yml` y `supabase/config.toml`): el
webhook se autentica con la firma de Stripe; checkout y portal con `auth.getUser` sobre el JWT del
usuario, dentro del código.

Railway staging (servicio de sync): variable `PLAN_SYNC_SECRET` = el mismo valor. Deploy del
servidor (corre la migración `011_kept_project.sql` sola al arrancar). Verificar que
`SUPABASE_URL` y `SUPABASE_ANON_KEY` estén seteadas: sin ellas la red de seguridad del registro
(§4.6) no corre.

### Smoke de las funciones y del endpoint (sin cobrar nada)

- `POST /internal/plan` sin firma → **401** (con el secreto puesto) y no 404.
- `stripe-checkout` y `stripe-portal` **sin token** → **401**; con **token malo** → **401**.
  (No hay test wire de este 401 en el repo: el Deno shell sólo se cubre acá.)
- Ventana de replay de `/internal/plan`: **300 s**. Un aviso firmado válido repetido dentro de
  esa ventana se acepta. Riesgo aceptado: exige romper TLS y el efecto es idempotente (reescribe
  el mismo plan). No hay nonce ni rate limiter en el endpoint.
- Limitación conocida: un perfil cuyo `stripe_customer_id` **ya no existe en Stripe** (cliente
  borrado a mano, cambio de cuenta de Stripe) recibe **502** en `stripe-checkout`, y lo seguirá
  recibiendo. Se arregla en 2b-3 (§6); mientras tanto, limpiar `profiles.stripe_customer_id` a mano.

## 3. Compra de punta a punta (tarjeta de test `4242 4242 4242 4242`)

1. Cuenta Free conectada a la nube con 2+ repos (uno en la nube, los otros `Local only`).
2. Upgrade → Cloud → Monthly → pagar. Volver a Nest: aparece `Cloud is active — syncing all
   your projects.`; Settings › Sync muestra `N projects` y lo retenido sube solo.
   Ojo: el toast sale apenas cambia `profiles.plan`, **aunque el aviso al servidor de sync haya
   fallado**. En ese caso la sincronización se destraba sola con el reintento de Stripe o con el
   próximo poll de status (hasta 15 min en Free): converge, pero no es instantáneo. Un toast sin
   proyectos subiendo no es un pago perdido; mirar los logs de `stripe-webhook` antes de tocar
   nada.
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
precios y secretos nuevos (ver el bloque bloqueante de arriba: es previo al merge a `main`).
Un smoke de compra real con una tarjeta propia y reembolso.

## 6. 2b-3 — cuenta en Settings (sale junto con 2b-2)

Spec: `docs/superpowers/specs/2026-10-29-cuenta-en-settings-design.md`. Rama
`feat/memories-settings` (commits `839954e..1a374a0`). **Mismo régimen: cada paso es una acción
externa con OK explícito de Gero, y el BLOQUEANTE de arriba sigue vigente**: no mergear a `main`
(el bump de versión que lo acompaña dispara `release.yml`) sin los secrets de prod cargados y el servidor nuevo corriendo en Railway
prod. 2b-3 agrega un servidor más nuevo todavía (ver paso 4).

**Orden de salida** (la migración antes que las functions; el servidor antes que el merge). Cada
paso se hace dos veces: primero contra el **entorno local** (Supabase local + servidor de sync
local, para el smoke de abajo) y recién con el smoke en verde contra **prod** (Supabase prod
`qkqlsytxtshgjxwmafpw`, Railway prod).

> **La migración de prod va antes que CUALQUIER build de esta rama que apunte a prod**
> (`useProfile` pide las columnas nuevas). Una beta (`release.yml` con `canal=beta`) o un
> `npm run dev` contra prod también cuentan. Sin la migración, `useProfile` reintenta sin las
> columnas y el plan se ve bien, pero sin período (`Renews on` / `Cancels on` no aparecen).

1. **Migración** `supabase/migrations/20261029000000_profiles_billing_period.sql`: tres columnas
   en `profiles` (intervalo, fin del período, cancelación al fin del período) y el trigger que
   las protege de updates del propio usuario.
   - Local: `supabase migration up` contra el stack local.
   - Prod: `supabase db push --project-ref qkqlsytxtshgjxwmafpw`. **`release.yml` no corre
     migraciones**: esto es siempre a mano.
2. **Secrets**: `PLAN_SYNC_URL` y `PLAN_SYNC_SECRET` ya son secrets del proyecto, pero **ahora los
   lee también `admin-api`** (antes sólo `stripe-webhook`). Si ya están cargados por 2b-2 no hay
   nada que hacer; si no, cargarlos (mismo valor que `PLAN_SYNC_SECRET` del Railway de ese
   entorno):
   - Local: en `supabase/functions/.env` (lo lee `supabase functions serve --env-file`).
   - Prod:
     ```bash
     supabase secrets set --project-ref qkqlsytxtshgjxwmafpw PLAN_SYNC_URL=<base del sync de prod> PLAN_SYNC_SECRET=<1Password>
     ```
3. **Deploy de las cuatro functions**, todas con `--no-verify-jwt` como en `release.yml`:
   `stripe-webhook`, `stripe-checkout`, `stripe-portal`, `admin-api`.
   - Local: `supabase functions serve --no-verify-jwt --env-file supabase/functions/.env`.
   - Prod: `release.yml` las deploya cuando corre en canal estable (ver el BLOQUEANTE de arriba:
     sólo con el bump de `package.json` o a mano); si hace falta antes,
     `supabase functions deploy <nombre> --no-verify-jwt --project-ref qkqlsytxtshgjxwmafpw`.
4. **Servidor de sync**: `GET /v1/devices` (lista de máquinas de la cuenta) y revocar
   por `deviceId` en `POST /v1/devices/revoke`. Sin migración nueva de la base del servidor. Con
   el servidor viejo (`GET /v1/devices` → 405) Settings › Account esconde el bloque Machines y no
   puede desconectar máquinas.
   - Local: `server/` contra el Postgres de desarrollo (ver `server/README.md`).
   - Prod: deploy en Railway prod (`nest-memory-sync`).
5. Recién ahí, mergear a `main`. El merge solo no deploya nada: las functions llegan a prod con el
   próximo bump de versión (`release.yml`), así que los pasos 1–4 de prod tienen que estar hechos
   antes de ese bump, no sólo antes del merge.

**Smoke contra Supabase local**: **corrido en verde el 2026-10-30 en la Mac**, los cinco puntos
de abajo, sobre `bff4d01`. El entorno se rearmó siguiendo el addendum del 22-10 del handoff
`docs/HANDOFF-2026-10-20-memories-obsidian.md`. Lo que no estaba escrito y hizo falta:

- **Puertos:** otro proyecto ya ocupaba los 54xxx y los 55xxx, así que Supabase corrió en los
  56xxx y el servidor de sync en el 8788.
- **`PLAN_SYNC_URL` desde las functions:** las functions corren en Docker sobre colima y ven al host
  como `http://192.168.5.2:<puerto>`. Con `host.docker.internal` el aviso nunca llega y
  `admin-api` contesta `sync_notificado: false` aunque el sync esté arriba.
- **Stripe CLI:** la clave restringida del `.env` no alcanza para `stripe listen` (pide *Debugging
  Tools Write*); hace falta `stripe login`. El CLI actual exige `--events` en `listen` (los cuatro
  de `stripe-webhook`: `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.paid`) y `--confirm` en `cancel`/`delete`, que si no
  se quedan esperando una confirmación interactiva.
- **Probar el reintento de checkout:** hace falta dejar un customer borrado en el perfil. El trigger
  revierte `stripe_customer_id` salvo que `auth.role()` sea `service_role`, y eso lo leen los
  claims, no el rol de Postgres: `set_config('request.jwt.claims', '{"role":"service_role"}', true)`
  en la misma transacción. Ojo: el portal con customer borrado ya limpia el id, así que si se
  prueba primero el portal, el checkout no pasa por el reintento.
- **Nest dev sin tocar la Nest instalada:** se levanta en un `git worktree` aparte, con su propio
  `.env` y `RAVEN_HOME`, `--user-data-dir` separado y `RAVEN_E2E_HEADLESS=1`, y se maneja por
  CDP. En el repo principal, `npm run dev` pisaría `dist-electron/`, que es de donde los panes de
  Nest sacan el `memory-mcp.js`.
- **Después de pagar:** el `success_url` (`https://nestmux.com/checkout/success`) da 404, porque la
  página no existe en el sitio. Esto no forma parte del smoke, pero hay que resolverlo antes de prod.

- Con el JWT de un usuario común, un update con valores **válidos** (si viola el `CHECK` falla
  igual con el trigger roto y no prueba nada):
  ```sql
  -- psql contra la base local; el rol y los claims son los que pone PostgREST con ese JWT.
  BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);
  UPDATE profiles SET billing_interval = 'annual',
    current_period_end = now() + interval '1 year', cancel_at_period_end = true
  WHERE id = '<uuid>';
  SELECT billing_interval, current_period_end, cancel_at_period_end FROM profiles WHERE id = '<uuid>';
  ROLLBACK;
  ```
  → las tres columnas **no cambian** (el trigger las revierte). Control: lo mismo con
  `SET LOCAL ROLE service_role` y `"role":"service_role"` en los claims **sí** las cambia (si el
  control tampoco cambia, el update no llegó a la fila y la prueba no dice nada). Cubre también
  el texto de la migración, que el test unitario solo valida con regex.
- Una compra con la tarjeta `4242 4242 4242 4242` **desde la app** (Upgrade › Cloud) deja las
  **tres columnas** (`billing_interval`, `current_period_end`, `cancel_at_period_end`) pobladas;
  `customer.subscription.deleted` las limpia al bajar a free. (No sirve `stripe trigger
  checkout.session.completed`: no trae `metadata.user_id` ni el precio de Cloud, y `decidir` lo
  ignora.)
- `PUT /plan` desde el back-office → el servidor de sync **recibe** el plan (`POST /internal/plan`
  firmado). Con el sync caído la respuesta suma `sync_notificado: false` y el `audit` lo registra
  (el PUT espera hasta 10 s).
- Customer borrado en el sandbox → `stripe-checkout` crea la sesión **con email** (sin `customer`)
  y `stripe-portal` contesta **404 `no_subscription`**. Confirma que Stripe devuelve
  `code: resource_missing, param: customer`: se vio en vivo el 2026-10-30, porque el checkout entró
  al reintento.
- Nest dev: Settings › Account muestra Plan, Usage y Machines; `Disconnect` en otra máquina de la
  misma cuenta la saca de la lista; `Manage subscription` abre el portal.

**Desvíos respecto del spec** (decididos al ejecutar):

- Portal con customer borrado → **404 `no_subscription`**, no 409; la app lo distingue por `code`
  y recarga el perfil.
- Formato `last seen 3d ago` (y `last seen never` si es null).
- En trial activo la fila dice `Trial` y **muestra Upgrade** (quien está en trial quiere poder pagar).
- `error` (`device_limit`, `needs_key`, `auth`, red) y `plan_required` cuentan como cuenta
  conectada: Usage y Machines se ven y la lista se pide (con `device_limit` es justo cuando hay
  que desconectar otra máquina). La beta se detecta por `statusDetail === 'not_in_beta'` del
  status del daemon. Reemplaza el Ruling de la Task 8 ("`plan_required` como `Cloud sync is
  off.`").
- Portal con `no_subscription` → `No subscription found for this account.` (no el genérico de red).
- Servidor sin `GET /v1/devices` (405 `method_not_allowed`) → el bloque Machines y el
  `{n} connected` no se muestran, en vez de un `Couldn't load your machines.` que ningún Retry
  arregla.
- `{k} local only` con `over_limit` suma los del roster por encima del tope.
- Bug previo arreglado: el preload `memory:status` aceptaba un solo oyente
  (`removeStatusListener` hacía `removeAllListeners`), así que al desmontar `CloudMemoryCard`,
  `SettingsPanel` quedaba sordo y Account no se actualizaba. Ahora `onStatus` admite varios
  oyentes y cada uno se da de baja solo (patrón de `onMemoryChanged`).
- `GET` y `POST` conviven en `/v1/devices` (POST ya era el registro); el 405 se testea con PUT.

**Entorno Mac**: el node de Homebrew es 26 y rompe `electron-rebuild`; usar
`export PATH=/opt/homebrew/opt/node@22/bin:$PATH` antes de npm/npx.

## Cómo responde el webhook al aviso de plan

El webhook avisa al servidor de sync (`POST <PLAN_SYNC_URL>/internal/plan`, firmado con
`X-Nest-Signature: t=<seg>,v1=<hex>` sobre el cuerpo crudo) después de activar o bajar a free.
Lo que devuelve a Stripe según la respuesta:

| Respuesta del servidor de sync | El webhook devuelve | Por qué |
|---|---|---|
| 2xx | 200 | Aviso entregado. |
| **400** (`invalid_plan`, `invalid_user_id`, `bad_json`) | **200**, con error en el log | El dato es inválido de forma determinística: reintentar tres días no lo arregla. |
| **401 / 404** | **500** (Stripe reintenta) | Config mal puesta (secreto distinto, `PLAN_SYNC_URL` equivocada); se corrige dentro de la ventana de reintentos. |
| 5xx, error de red o timeout | **500** (reintenta) | Falla transitoria. |
| Cualquier otro (405, 413, otros 4xx) | **500** (reintenta) | Por defecto se falla hacia el reintento. |
| Falta `PLAN_SYNC_URL` o `PLAN_SYNC_SECRET` en Supabase | **500** (reintenta) | Fail-closed: nunca se da por avisado sin config. |

Un 400 es el único caso que queda **sólo en el log** (`stripe-webhook`): revisarlo si alguien
paga y su plan no aparece.

Antes de activar, el webhook **relee la suscripción en Stripe**: si ya no está `active`,
`trialing` ni `past_due` (un `invoice.paid` o `subscription.updated` viejo que Stripe reintentó
después de la cancelación), no toca `profiles` ni avisa, y devuelve 200 con
`activación descartada` en el log. Si esa lectura falla, devuelve 500 y Stripe reintenta.

## Recuperación

- **Un pago que no llegó al servidor**: el webhook devuelve 500 y Stripe reintenta hasta 3 días.
  Mientras tanto, registrar una máquina relee el plan (red de seguridad §4.6; sólo sube, nunca
  baja un plan pago). A mano: `server/scripts/mint-device-token.mjs` o un `POST /internal/plan`
  firmado.
- **Cancelación cuyos avisos siguieron fallando** (se agotaron los reintentos de Stripe): la baja
  a free se hace en dos pasos (primero `plan = 'free'`, y sólo si todos los avisos salieron bien
  se limpia `stripe_subscription_id`). Si los avisos no salieron, el perfil queda con
  `plan = 'free'` **y el `stripe_subscription_id` viejo**, y el servidor de sync sigue en plan
  pago (la red de seguridad nunca baja). Recuperación: mirar los logs de `stripe-webhook` en
  Supabase, y **reenviar el evento** `customer.subscription.deleted` desde el dashboard de Stripe
  (Developers › Webhooks › el evento › Resend) una vez arreglada la causa; o bien setear
  `users.plan` a mano en el servidor de sync y limpiar `profiles.stripe_subscription_id`. Mientras
  está en ese estado intermedio, checkout NO queda bloqueado (el 409 exige plan pago).
- **Rotar `PLAN_SYNC_SECRET`**: setear el nuevo en Railway y en Supabase en el mismo minuto; los
  avisos firmados con el viejo fallan con 401 y Stripe los reintenta.
