# Pagar Cloud con Stripe — diseño (2b-2)

Fecha: 2026-10-21 · Rama: `feat/memories-settings` (local) · Segundo proyecto de 2b:
2b-1 Free con 1 proyecto en la nube (hecho) → **2b-2 pagar Cloud** (este) → 2b-3 UI de cuenta →
2b-4 Teams autoservicio.

## 1. Objetivo

Un usuario Free toca **Upgrade**, paga Cloud (US$ 10/mes o US$ 96/año = US$ 8/mes), vuelve a
Nest y la nube ya le sincroniza todos los proyectos — sin que nadie toque nada a mano. Si
cancela, vuelve a Free con 1 proyecto, que elige él. Cloud es individual: cantidad 1, sin
compartir.

## 2. Estado de partida (verificado el 2026-10-21)

- `supabase/functions/stripe-checkout` crea la sesión con `mode: 'subscription'`, cantidad 1,
  **14 días de trial** y `success_url`/`cancel_url` a la landing. **No autentica**: confía en el
  `userId` del body y acepta el `priceId` que mande el cliente.
- `supabase/functions/stripe-webhook` (`eventos.ts` puro + `index.ts` shell) mapea sólo los
  precios viejos de Pro/Team (`PRECIO_A_PLAN`); un precio sin mapear se ignora. Escribe
  `profiles.plan`, `stripe_customer_id`, `stripe_subscription_id`; baja a `free` en
  `customer.subscription.deleted`.
- **El servidor de sync no se entera de ningún pago.** Su plan es `users.plan` en su propio
  Postgres, y lo único que lo escribe es `server/scripts/mint-device-token.mjs`
  (`server/src/devices.ts:197-200` lo anota como pendiente).
- `src/lib/stripe.ts`: `STRIPE_PRICES.cloud_monthly = ''` deshabilita el botón;
  `CLOUD_MONTHLY_PRICE = 10`. No hay precio anual.
- `UpgradeModal` invoca `stripe-checkout` con `{priceId, userId, email}` y abre la URL afuera.
  Los errores sólo van a la consola. No hay portal ni "Manage subscription".
- `useProfile` relee `profiles.plan` al recuperar el foco de la ventana.
- En push (`server/src/push.ts` ~L431-451) el tope de proyectos sólo frena proyectos **nuevos**:
  uno que ya está en la nube sigue aceptando mutaciones aunque el plan haya bajado.
- Gates de Supabase con `'pro'`: los de `nest_memory` (`memory-token`/`memory-sync`) son del
  camino viejo, nunca deployado y que la app ya no usa; los de `user_has_plan` protegen
  snippets compartidos, que son compartir (no le tocan a Cloud). **No se tocan.** Sólo
  `supabase/functions/admin-api/pricing.ts` `PLANES_VALIDOS` necesita `cloud`.

## 3. Decisiones de Gero (2026-10-21)

1. **Sin trial**: el checkout cobra al toque. Free con 1 proyecto ya es la prueba.
2. **Cancelar/gestionar entra en 2b-2**, con un botón mínimo al Customer Portal de Stripe.
3. **Vuelta a la app**: página "You're on Cloud — go back to Nest" y la app se entera sola al
   recuperar el foco. Sin deep link.
4. **Propagación al servidor de sync: opción A** — el webhook le avisa por un endpoint
   interno firmado; el registro de device relee el plan como red de seguridad.
5. **Pagar te mete en la allowlist** de la beta. Al cancelar se queda.
6. **Al bajar de plan, el usuario elige qué proyecto sigue sincronizando.** Hasta que elija,
   sigue el más viejo. Nada se borra.

## 4. Diseño

### 4.1 Precios en Stripe

Producto **Nest Cloud** con dos precios recurrentes en USD: `$10 / month` y `$96 / year`.
Los IDs viven en secrets de las edge functions, no en el código:
`STRIPE_PRICE_CLOUD_MONTHLY`, `STRIPE_PRICE_CLOUD_ANNUAL`. Se crean primero en modo test.

### 4.2 `stripe-checkout` (endurecido)

Se parte en módulo puro (`checkout.ts`, testeable con vitest como `eventos.ts`) + shell.

- **Autenticación**: exige `Authorization: Bearer <JWT de Supabase>`; el usuario sale de
  `auth.getUser()`. Sin JWT válido → 401. El body ya no trae `userId` ni `email`.
- **Body**: `{ interval: 'monthly' | 'annual' }`. Cualquier otro valor → 400
  `invalid_interval`. El precio lo elige la función desde los secrets.
- **Sin secrets de precio** → 503 `checkout_unavailable`.
- **Ya suscripto** (`profiles.stripe_subscription_id` no nulo y `plan` ∈ pagos) → 409
  `already_subscribed`. Evita el doble cobro.
- **Cliente**: si el perfil tiene `stripe_customer_id`, se pasa `customer`; si no,
  `customer_email` con el email del JWT.
- **Sesión**: `mode: 'subscription'`, `line_items: [{ price, quantity: 1 }]`, **sin**
  `trial_period_days`, `metadata.user_id` en la sesión y en `subscription_data`.
- `success_url = https://nestmux.com/checkout/success`,
  `cancel_url = https://nestmux.com/checkout/cancelled`.
- Respuesta: `{ url }`.

### 4.3 `stripe-portal` (nueva)

- Mismo esquema de JWT. Lee `profiles.stripe_customer_id` con service role.
- Sin customer → 404 `no_subscription`. Con customer → crea una sesión de Billing Portal con
  `return_url = https://nestmux.com/checkout/portal-return` y devuelve `{ url }`.
- La configuración del portal (cancelar al fin del período, cambiar tarjeta, facturas, pasar
  de mensual a anual entre los dos precios de Cloud) se hace en el dashboard de Stripe.

### 4.4 `stripe-webhook`

- `PRECIO_A_PLAN` pasa a armarse con los precios viejos (fijos, como hoy) **más** los dos de
  Cloud desde los secrets → `'cloud'`. `decidir` recibe el mapa como parámetro para seguir
  siendo puro.
- Tras aplicar la decisión en `profiles`:
  - `activar`: relee `profiles.plan` de ese usuario y avisa al servidor de sync (§4.5).
  - `bajar_a_free`: el `update` devuelve (`.select('id')`) los usuarios afectados; avisa por
    cada uno con el plan releído.
- **Se manda lo que quedó en `profiles`, no lo que dice el evento**: aunque Stripe entregue
  eventos repetidos o desordenados, cada aviso lleva la verdad del momento y el servidor
  converge a Supabase.
- Si el aviso falla (red, no-2xx) → 500, Stripe reintenta (mismo criterio que hoy con la base).
- Sin `PLAN_SYNC_URL`/`PLAN_SYNC_SECRET` configurados → loguea un error y devuelve 500: un pago
  que no llega a la nube no se puede tragar en silencio.

### 4.5 Servidor de sync: `POST /internal/plan`

- **Firma**: header `X-Nest-Signature: t=<unix segundos>,v1=<hex>` con
  `v1 = HMAC-SHA256(PLAN_SYNC_SECRET, "<t>.<body crudo>")`. Se rechaza (401) si falta, si
  `|now - t| > 300 s`, o si no coincide (comparación en tiempo constante).
- **Sin `PLAN_SYNC_SECRET`** en el entorno → la ruta responde 404, como si no existiera.
- **Body**: `{ "user_id": "<uuid>", "plan": "<plan>" }`. `plan` fuera de `CLOUD_PLANS` → 400.
- **Efecto**, en una transacción:
  - `insert into users (id, plan) … on conflict (id) do update set plan = excluded.plan`.
  - Si `plan` es pago (`cloud`, `pro`, `team`, `enterprise`): `insert into allowlist (user_id)
    … on conflict do nothing`.
  - Bajar a `free` no saca de la allowlist.
- Idempotente. Responde `{ ok: true }`.
- Se registra en el logger del servidor (sin el body completo): user_id y plan.

### 4.6 Red de seguridad al registrar un device

`registerDevice` ya hace un fetch a Supabase con el JWT del usuario para `team_memberships`
(best effort, fuera de la transacción). Se suma, por el mismo camino, la lectura de
`profiles.plan` del propio usuario (RLS lo permite; el trigger de billing impide que el
cliente lo escriba). Si la lectura funciona y el plan leído es **pago**, se escribe
`users.plan` y la allowlist — **antes** del chequeo de allowlist, para que alguien que pagó y
perdió el aviso no reciba `not_in_beta`. Si falla, todo sigue como hoy.

**La red de seguridad sólo sube, nunca baja.** Un `free` leído de Supabase no toca
`users.plan`: los testers de la beta tienen el plan puesto a mano en el servidor
(`mint-device-token.mjs`) con `profiles.plan = 'free'`, y bajarlos al registrar una máquina
sería una regresión. Bajar de plan es trabajo del webhook (§4.4), que sí sabe que hubo una
cancelación.

Orden resultante en `registerDevice`: verificar JWT → leer plan de Supabase (best effort,
fuera de la transacción) → transacción: upsert user (+plan si se leyó) → allowlist (+alta si
pago) → chequeo de allowlist → device → commit → `syncTeamMemberships`.

### 4.7 Bajar de plan: qué proyecto sigue

- **Migración `011_kept_project.sql`**: `alter table users add column kept_project_key text`.
- **Regla en push** (dentro del lock `project-limit:<user>` que ya existe): si los proyectos
  propios (sin `__global__`) superan `maxProjects`, sólo aceptan mutaciones los "permitidos":
  - si `kept_project_key` está seteado y sigue siendo un proyecto del usuario: ese, más los
    `maxProjects - 1` más viejos restantes por `projects.created_at` (hoy `maxProjects = 1`
    para Free → sólo el elegido);
  - si no: los `maxProjects` más viejos.
  
  El resto recibe `project_limit_reached` (rechazo reversible, igual que 2b-1). Pull no cambia:
  todo lo que ya está en la nube se sigue leyendo.
- **`POST /v1/projects/keep`** (auth con token `nmk_`, como el resto de `/v1`):
  body `{ project_key }`. Si no es un proyecto del usuario o es `__global__` → 400
  `unknown_project`. Si el usuario no está por encima del tope → 409 `not_over_limit`. Si no,
  guarda `kept_project_key` y responde `{ ok: true }`.
- **`/v1/sync/status`** suma `kept_project_key` (o `null`) y un flag `over_limit: boolean`
  (proyectos propios > `maxProjects`). Aditivo.
- Al volver a pagar, el tope sube y la regla deja de aplicar; `kept_project_key` queda guardado
  sin efecto.

### 4.8 App

**`src/lib/stripe.ts`**: se va `STRIPE_PRICES`; quedan `CLOUD_MONTHLY_PRICE = 10`,
`CLOUD_ANNUAL_MONTHLY_PRICE = 8`, `CLOUD_ANNUAL_PRICE = 96` y el tipo
`BillingInterval = 'monthly' | 'annual'`.

**`UpgradeModal`**:
- Toggle `Monthly` / `Annual` en la card de Cloud (default Monthly). Precio:
  `$10` `/mo`, o `$8` `/mo` + línea `billed $96 yearly`.
- Botón `Upgrade to Cloud` → `stripe-checkout` con `{ interval }` → `openExternal(url)`.
- Si el plan actual es `cloud` (o `pro`): el CTA es `Manage subscription` → `stripe-portal`.
- `already_subscribed` → abre el portal en vez de fallar.
- Errores visibles en el modal (no sólo consola), y el botón vuelve a habilitarse.
- Teams sin cambios (`Custom` / `Book a demo`) hasta 2b-4.

**Aviso de activación**: cuando `useProfile` ve el plan pasar de un no-pago a `cloud` (relectura
por foco), la app muestra un toast `Cloud is active — syncing all your projects.` y pide un
status nuevo al daemon. Con eso actúa lo de 2b-1: el tope sube y lo retenido converge solo.
Mismo camino a la inversa: al bajar a `free`, pedir status (sin toast).

**Settings › Sync, fila `Projects in the cloud`** (`CloudProjectsRow`): con `over_limit`:
- Descripción `Your plan syncs {max} of {n} projects.`
- Control `Keep syncing` con un select de los proyectos del roster (nombres del store local,
  como en 2b-1), valor = `kept_project_key` o el más viejo. Cambiarlo llama a
  `/v1/projects/keep` por el daemon (IPC nuevo `memory:keepProject(projectKey)`) y refresca
  el status.
- `Upgrade` al lado, como en 2b-1.
- Un Free que nunca pagó no está `over_limit`: no ve el select (2b-1 intacto).

**Settings › Sync, plan pago**: si el plan es `cloud`/`pro`, la fila de plan (o donde hoy está
Upgrade en `CloudMemoryCard`) muestra `Manage subscription` → portal. El lugar definitivo es
de 2b-3.

### 4.9 Back-office

`admin-api/pricing.ts`: `PLANES_VALIDOS` suma `'cloud'`; su monto mensual sale de los precios de
Cloud (anual / 12).

### 4.10 Copy (inglés, verbatim)

| Lugar | Texto |
|---|---|
| Toggle | `Monthly` · `Annual` |
| Precio anual | `$8` `/mo` · `billed $96 yearly` |
| CTA pago | `Upgrade to Cloud` |
| CTA plan actual | `Manage subscription` |
| Error checkout | `Checkout isn't available right now — try again later.` |
| Error genérico | `Couldn't reach checkout. Check your connection and try again.` |
| Toast | `Cloud is active — syncing all your projects.` |
| Fila over limit | `Your plan syncs {max} of {n} projects.` |
| Control | `Keep syncing` |
| Página éxito (landing) | `You're on Cloud — go back to Nest.` |
| Página cancelado (landing) | `Checkout cancelled — nothing was charged.` |

## 5. Seguridad

- Checkout y portal: identidad sólo del JWT; precio sólo desde secrets. Un cliente no puede
  pagar por otro ni elegir un precio arbitrario.
- `/internal/plan`: HMAC con ventana de 5 min, comparación en tiempo constante, fail-closed sin
  secreto. Nunca acepta un plan fuera de `CLOUD_PLANS`.
- La red de seguridad lee el plan con el JWT del propio usuario; `profiles.plan` está bloqueado
  para escritura del cliente por `protect_profile_billing_columns`.
- `/v1/projects/keep` sólo acepta proyectos propios.
- Ningún secreto en git ni en el handoff (1Password / secrets de Supabase y Railway).

## 6. Tests

- **Webhook** (`eventos.test.ts`): los dos precios de Cloud → `cloud`; precio desconocido sigue
  ignorado; legacy intacto.
- **Checkout** (`checkout.test.ts`, módulo puro): intervalo → precio; intervalo inválido;
  sin secrets → `checkout_unavailable`; ya suscripto → `already_subscribed`; reusa customer;
  sin trial; metadata con user_id.
- **Servidor**:
  - `/internal/plan`: firma válida, vieja (>300 s), inválida, ausente; sin secreto → 404; plan
    inválido → 400; pago agrega a allowlist; `free` no la saca; usuario inexistente queda creado.
  - Registro: un plan pago leído de Supabase se aplica y destraba `not_in_beta`; un `free`
    leído NO baja un `users.plan` pago puesto a mano; fallo del fetch no rompe el registro.
  - Push con más proyectos que el tope: sólo pasa el elegido; sin elección pasa el más viejo;
    elegido que ya no existe → el más viejo; `__global__` siempre pasa.
  - `/v1/projects/keep`: proyecto ajeno o `__global__` → 400; no over limit → 409.
  - `status` trae `kept_project_key` y `over_limit`.
- **Renderer**: toggle e importes; CTA `Manage subscription` con plan cloud; errores visibles;
  `already_subscribed` abre portal; toast al pasar a cloud; `CloudProjectsRow` con
  `over_limit` muestra el select y llama `keepProject`.
- `la-app-es-en-ingles`, los dos `tsc` de CI, `e2e/04-contraste` **headless**.

## 7. Salida (acciones externas — cada una con OK explícito de Gero)

1. Stripe **test**: producto + 2 precios, configuración del Customer Portal, endpoint del
   webhook con `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`,
   `customer.subscription.deleted`.
2. Secrets en Supabase staging (`STRIPE_PRICE_CLOUD_*`, `PLAN_SYNC_URL`, `PLAN_SYNC_SECRET`) y en
   Railway staging (`PLAN_SYNC_SECRET`). Deploy de `stripe-checkout`, `stripe-portal`,
   `stripe-webhook` (este con `--no-verify-jwt`) y del servidor.
3. Compra de punta a punta con tarjeta de test: pagar → la nube pasa a 100 proyectos y lo
   retenido sube; cancelar → vuelve a 1 y aparece `Keep syncing`.
4. Páginas `/checkout/success`, `/checkout/cancelled`, `/checkout/portal-return` en
   `pagina-nest` (deploy de Gero: Vercel bloquea commits de colaboradores).
5. Recién después: live y prod.

## 8. Fuera de alcance

- Pantalla de cuenta completa, facturas en la app (2b-3).
- Teams autoservicio, asientos, precio de Teams (2b-4).
- Impuestos (`automatic_tax`), cupones, moneda local.
- Gates de Supabase con `'pro'` (camino viejo de memoria y snippets compartidos).
- Migrar suscripciones existentes (no hay: ninguna suscripción activa al 2026-09-02).
