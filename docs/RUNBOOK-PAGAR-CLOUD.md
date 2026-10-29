# Runbook — pagar Cloud con Stripe (2b-2)

Spec: `docs/superpowers/specs/2026-10-21-pagar-cloud-stripe-design.md` §7. **Cada paso es una
acción externa y necesita el OK explícito de Gero antes de correrlo.** Ningún secreto va a git
ni a este archivo: todos salen de 1Password (o de variables de entorno), y acá sólo figuran los
nombres.

> **BLOQUEANTE — leer antes de mergear a `main`.** `release.yml` deploya TODAS las edge
> functions de Stripe a **producción** en cada push a `main` (incluida `stripe-portal`, todas con
> `--no-verify-jwt`: cada función autentica en código). El próximo merge publica el webhook
> nuevo en prod automáticamente. **Antes de ese merge tienen que estar cargados en prod**
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
(dispara `release.yml`) sin los secrets de prod cargados y el servidor nuevo corriendo en Railway
prod. 2b-3 agrega un servidor más nuevo todavía (ver paso 4).

**Orden de salida** (la migración antes que las functions; el servidor antes que el merge):

1. **Migración** `supabase/migrations/20261029000000_profiles_billing_period.sql`: tres columnas
   en `profiles` (intervalo, fin del período, cancelación al fin del período) y el trigger que
   las protege de updates del propio usuario. Staging primero (`supabase db push`), después prod.
2. **Secrets**: `PLAN_SYNC_URL` y `PLAN_SYNC_SECRET` ya son secrets del proyecto, pero **ahora los
   lee también `admin-api`** (antes sólo `stripe-webhook`). Si ya están cargados por 2b-2 no hay
   nada que hacer; si no, cargarlos (mismo valor que `PLAN_SYNC_SECRET` de Railway):
   ```bash
   supabase secrets set --project-ref <ref> PLAN_SYNC_URL=<base del sync> PLAN_SYNC_SECRET=<1Password>
   ```
3. **Deploy de las cuatro functions**, todas con `--no-verify-jwt` como en `release.yml`:
   `stripe-webhook`, `stripe-checkout`, `stripe-portal`, `admin-api`.
4. **Servidor de sync en Railway**: `GET /v1/devices` (lista de máquinas de la cuenta) y revocar
   por `deviceId` en `POST /v1/devices/revoke`. Sin migración nueva de la base del servidor. Con
   el servidor viejo, Settings › Account no puede listar ni desconectar máquinas.
5. Recién ahí, mergear (release.yml deploya las functions a prod).

**Smoke contra Supabase local** (PENDIENTE, no corrido; ningún test de 2b-3 toca Stripe ni una
base real salvo los del servidor). El entorno local de 2b-2 vivía en la PC Windows (Supabase en
55xxx, Stripe CLI por winget): en la Mac hay que reconstruirlo siguiendo el addendum del 22-10 del
handoff `docs/HANDOFF-2026-10-20-memories-obsidian.md`.

- `UPDATE profiles SET billing_interval = 'year'` con el JWT de un usuario común → **no cambia**
  (el trigger lo revierte). Cubre también el texto de la migración, que el test unitario solo
  valida con regex.
- Un `checkout.session.completed` de prueba (`stripe trigger` o una compra con 4242) deja las
  **tres columnas** (`billing_interval`, `current_period_end`, `cancel_at_period_end`) pobladas;
  `customer.subscription.deleted` las limpia al bajar a free.
- `PUT /plan` desde el back-office → el servidor de sync **recibe** el plan (`POST /internal/plan`
  firmado). Con el sync caído la respuesta suma `sync_notificado: false` y el `audit` lo registra
  (el PUT espera hasta 10 s).
- Customer borrado en el sandbox → `stripe-checkout` crea la sesión **con email** (sin `customer`)
  y `stripe-portal` contesta **404 `no_subscription`**. Confirma que Stripe devuelve
  `code: resource_missing, param: customer` (supuesto documentado, nunca visto en vivo).
- Nest dev: Settings › Account muestra Plan, Usage y Machines; `Disconnect` en otra máquina de la
  misma cuenta la saca de la lista; `Manage subscription` abre el portal.

**Desvíos respecto del spec** (decididos al ejecutar):

- Portal con customer borrado → **404 `no_subscription`**, no 409; la app lo distingue por `code`
  y recarga el perfil.
- Formato `last seen 3d ago` (y `last seen never` si es null).
- En trial activo la fila dice `Trial` y **muestra Upgrade** (quien está en trial quiere poder pagar).
- `plan_required` se muestra como `Cloud sync is off.` (el spec no lo cubre; hoy sólo lo produce un
  plan que esta versión no conoce).
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
