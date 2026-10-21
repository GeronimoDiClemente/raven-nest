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
> llegue nunca. No mergear hasta tildar los cinco.

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
  recibiendo. Se arregla en 2b-3; mientras tanto, limpiar `profiles.stripe_customer_id` a mano.

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
precios y secretos nuevos (ver el bloque bloqueante de arriba: es previo al merge a `main`).
Un smoke de compra real con una tarjeta propia y reembolso.

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
