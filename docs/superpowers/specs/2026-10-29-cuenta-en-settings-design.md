# Cuenta en Settings — diseño (2b-3)

Fecha: 2026-10-29 · Rama: `feat/memories-settings` · Tercer proyecto de 2b:
2b-1 Free con 1 proyecto en la nube (hecho) → 2b-2 pagar Cloud (código hecho, salida pendiente) →
**2b-3 cuenta en Settings** (este) → 2b-4 Teams autoservicio.

## 1. Objetivo

Que alguien entienda **quién es, qué paga y qué le da su plan** sin entrar a Memories. Hoy
Settings › Account muestra sólo el email; el plan y `Manage subscription` están escondidos en
`CloudMemoryCard` (Memories › Settings › Sync) y las máquinas conectadas no se ven en ningún lado.

Además cierra los dos huecos que dejó 2b-2:
- el back-office cambia `profiles.plan` a mano sin avisar al servidor de sync;
- un `stripe_customer_id` que ya no existe en Stripe da 502 en checkout para siempre;

y la deuda de tests de 2b-2: e2e/04 no renderiza el toast `Cloud is active` ni `Keep syncing`.

## 2. Decisiones de Gero (29-10)

| # | Decisión |
|---|---|
| D1 | Alcance **B**: plan + uso (proyectos en la nube, máquinas). Facturas, tarjeta y cancelar siguen en el portal de Stripe. |
| D2 | Vive en **Settings › Account**. `Projects in the cloud` y `Keep syncing` se quedan en Memories › Settings › Sync; `Manage subscription` sale de `CloudMemoryCard`. |
| D3 | Intervalo y fechas de la suscripción se **guardan en `profiles` desde el webhook** (no se consulta Stripe en vivo). |
| D4 | La lista de máquinas permite **`Disconnect` por máquina** (revoke por id). |

## 3. UI — Settings › Account

Orden: email · **Plan** · **Usage** · **Machines** · `Memory settings` · `Sign out`.

```
  Plan
  Cloud · Monthly                     [Manage subscription]
  Renews on Nov 29, 2026

  Usage
  Projects in the cloud     1 of 1 · raven-nest
                            2 local only — Keep syncing in Memory settings ›
  Machines                  3 connected

  Machines
  Gero-PC  · Windows · This machine
  MacBook  · macOS   · last seen 3 days ago     [Disconnect]
  build-vm · Linux   · last seen 2 months ago   [Disconnect]
  Disconnecting stops syncing on that machine. Memory it already downloaded stays there.
```

### 3.1 Plan

Fuente: `useProfile` (`plan`, `billing_interval`, `current_period_end`, `cancel_at_period_end`).

| Estado | Línea 1 | Línea 2 | Botón |
|---|---|---|---|
| Free | `Free` | `1 project in the cloud. Cloud syncs all of them.` | `Upgrade` → `UpgradeModal` |
| Cloud renovando | `Cloud · Monthly` / `Cloud · Annual` | `Renews on {fecha}` | `Manage subscription` → portal |
| Cloud cancelando | ídem | `Cancels on {fecha} — you keep Cloud until then.` | `Manage subscription` |
| Cloud sin fecha (suscripción previa a la migración) | `Cloud` (+ intervalo si lo hay) | — (no se inventa) | `Manage subscription` |
| Perfil cargando | esqueleto de una línea (no parpadea `Free`) | | |

Planes legacy (`pro`, `team`, trial) se muestran por su nombre con el mismo botón que hoy decide
`tieneSuscripcionPropia(plan)`. Fecha en formato largo del locale `en-US` (`Nov 29, 2026`).

### 3.2 Usage

Fuente: el `status` del daemon que ya existe (roster, `maxProjects`, `over_limit`).

- `Projects in the cloud` — `{n} of {max} · {nombre}` (nombres del store local, como en 2b-1);
  con plan pago, `{n} projects`.
- Con `over_limit` o proyectos `Local only`: segunda línea
  `{k} local only — Keep syncing in Memory settings ›`, que abre Memories con la pestaña Settings
  en la sección Sync (`onOpenMemories('settings')`).
- `Machines` — `{n} connected`.
- Sin sync conectado: Usage y Machines se reemplazan por `Cloud sync is off.` +
  `Turn on in Memory settings ›`.
- Build beta con `not_in_beta`: `Cloud sync is invite-only during the beta.`

### 3.3 Machines

Fuente: IPC nuevo `memory:devices` → `GET /v1/devices`.

- Fila: `{name} · {platform}` + `This machine` o `last seen {relativo}` (`never` si es null).
- `Disconnect` en todas menos la actual. Confirmación en línea:
  `Disconnect {name}?` · `Cancel` · `Disconnect`.
- Pie fijo: `Disconnecting stops syncing on that machine. Memory it already downloaded stays there.`
- Error al cargar: `Couldn't load your machines.` + `Retry`. Usage sigue visible.
- Error al desconectar: mensaje en la fila, la máquina sigue listada. Un 404 refresca la lista
  (probablemente ya estaba desconectada).

### 3.4 `CloudMemoryCard`

Sale `Manage subscription`. Entra un link `Plan & billing ›` que abre Settings › Account. El
`Upgrade` de `plan_required` se queda (es la acción en contexto del error de sync).

### 3.5 Copy (inglés, verbatim)

| Lugar | Texto |
|---|---|
| Títulos | `Plan` · `Usage` · `Machines` |
| Free | `Free` · `1 project in the cloud. Cloud syncs all of them.` |
| Renueva | `Renews on {date}` |
| Cancela | `Cancels on {date} — you keep Cloud until then.` |
| Proyectos | `Projects in the cloud` · `{n} of {max} · {name}` · `{n} projects` |
| Retenidos | `{k} local only — Keep syncing in Memory settings ›` |
| Máquinas | `Machines` · `{n} connected` · `This machine` · `last seen {relative}` · `never` |
| Confirmar | `Disconnect {name}?` · `Cancel` · `Disconnect` |
| Pie | `Disconnecting stops syncing on that machine. Memory it already downloaded stays there.` |
| Errores | `Couldn't load your machines.` · `Retry` · `Couldn't disconnect {name}. Try again.` |
| Sin sync | `Cloud sync is off.` · `Turn on in Memory settings ›` |
| Beta | `Cloud sync is invite-only during the beta.` |
| Link en la card | `Plan & billing ›` |

## 4. Datos y backend

### 4.1 Migración Supabase

`profiles` suma:

```sql
billing_interval      text check (billing_interval in ('monthly','annual')),
current_period_end    timestamptz,
cancel_at_period_end  boolean not null default false
```

Las tres se agregan a `protect_profile_billing_columns` (el cliente no las escribe). **No** se
ocultan del `SELECT` propio, a diferencia de los IDs de Stripe (`20260502120200_hide_stripe_ids`):
la app las necesita.

### 4.2 Webhook

En `checkout.session.completed`, `invoice.paid` y `customer.subscription.updated`, además del
plan, escribe los tres campos desde la suscripción:
- intervalo desde el precio (`STRIPE_PRICE_CLOUD_ANNUAL` → `annual`, monthly → `monthly`;
  legacy → `null`);
- `current_period_end` de la suscripción (API `2024-11-20.acacia`; **en `basil` pasa a los
  items** — si se sube la versión, mover esta lectura);
- `cancel_at_period_end` tal cual.

`customer.subscription.deleted` los limpia (`null`, `null`, `false`) junto con la baja a `free`
que ya existe. Cancelar en el portal llega como `updated` con `cancel_at_period_end=true`: el plan
no cambia hasta el fin del período.

### 4.3 Back-office

- `stripe-webhook/aviso-de-plan.ts` → `supabase/functions/_shared/aviso-de-plan.ts` (lo importan
  webhook y admin-api).
- `admin-api` `PUT /plan`: después de actualizar `profiles.plan`, `avisarPlan(userId, plan)`.
  Si falla o faltan `PLAN_SYNC_URL`/`PLAN_SYNC_SECRET`: responde **200** igual (el plan cambió),
  con `sync_notificado: false`, lo registra en la auditoría y loguea error como el webhook.
- Secrets nuevos de admin-api: `PLAN_SYNC_URL`, `PLAN_SYNC_SECRET` (los mismos del webhook).

### 4.4 Customer de Stripe borrado

- `stripe-checkout`: si la creación de la sesión falla con `resource_missing` sobre `customer`,
  pone `profiles.stripe_customer_id = null`, rearma con `customer_email` y **reintenta una vez**.
  Cualquier otro error: 502 como hoy.
- `stripe-portal`: mismo caso → limpia el ID y responde **409 `no_subscription`**. La app
  refresca el perfil y muestra `Upgrade`.
- La decisión vive en los módulos puros (`checkout.ts`, y uno nuevo o existente del portal) para
  testearla sin Deno.

### 4.5 Servidor de sync

- `GET /v1/devices` (token de device): máquinas de la cuenta con `revoked_at is null`, ordenadas
  por `last_seen_at desc nulls last`: `{ id, name, platform, last_seen_at, current }`.
- `POST /v1/devices/revoke` acepta `{ deviceId }`:
  - de la misma cuenta y no revocada → la revoca, `{ ok: true, revoked: 1 }`;
  - ajena o inexistente → **404** `not_found` (no distingue);
  - la propia → **400** `use_self_revoke` (para eso está el revoke sin body);
  - `all` y el revoke sin body, sin cambios.

### 4.6 App

- `useProfile` suma `billingInterval`, `currentPeriodEnd`, `cancelAtPeriodEnd` (y el modo e2e los
  acepta fingidos, como hoy `plan`).
- IPC nuevos en el daemon: `memory:devices` → lista, `memory:revokeDevice(deviceId)`.
- Componente nuevo `AccountPlanSection` (shadcn + utilidades, sin clases nuevas en `global.css`),
  partido en `PlanBlock`, `UsageBlock`, `MachinesBlock` si pasa de ~200 líneas.
- `SettingsPanel` recibe lo necesario para abrir Memories › Settings (ya tiene `onOpenMemories`).

## 5. Seguridad

- Revoke por id: sólo máquinas de la misma cuenta, 404 indistinto para ajena/inexistente. No
  amplía el riesgo actual: un token robado ya puede `all`.
- Desconectar **no rota** la clave de cifrado; el copy lo dice. Rotación queda fuera.
- Las columnas nuevas no se escriben desde el cliente (trigger). No son secretas.
- `avisarPlan` desde admin-api usa el mismo HMAC; ningún secreto en git ni en el handoff.

## 6. Tests

- **Webhook** (`eventos.test.ts`): cada evento escribe intervalo/fin/cancelación; `deleted`
  los limpia; precio desconocido sigue ignorado.
- **Checkout/portal** (módulos puros): `resource_missing` → limpia ID y reintenta una vez;
  otros errores → 502; portal → 409 `no_subscription`.
- **admin-api**: `PUT /plan` llama `avisarPlan`; fallo → 200 + `sync_notificado:false` + auditoría.
- **Servidor**: `GET /v1/devices` sólo propias no revocadas, `current` correcto; revoke por id:
  ajena/inexistente 404, propia 400, válida deja de autenticar.
- **Migración**: el trigger revierte las tres columnas en un update del cliente.
- **Renderer**: Account en Free / Cloud renovando / Cloud cancelando / Cloud sin fecha / cargando;
  sync apagado; `not_in_beta`; máquinas + confirmación + error de Disconnect; link a Keep syncing
  sólo con `over_limit`; `CloudMemoryCard` con `Plan & billing ›` y sin `Manage subscription`.
- **e2e/04 headless**: toast `Cloud is active`, `Keep syncing` y Account con Cloud + máquinas.
- `la-app-es-en-ingles` y los dos `tsc` de CI.

## 7. Salida

Junto con la salida de 2b-2, en `docs/RUNBOOK-PAGAR-CLOUD.md` (con OK de Gero por paso):
migración, deploy de `stripe-webhook`/`stripe-checkout`/`stripe-portal`/`admin-api`, secrets
`PLAN_SYNC_*` en admin-api y deploy del servidor. Sigue vigente el bloqueante de 2b-2: no mergear
a main sin secrets de prod y servidor nuevo en Railway.

## 8. Fuera de alcance

- Facturas y tarjeta dentro de la app (portal de Stripe).
- Rotar la clave al desconectar una máquina.
- Renombrar máquinas.
- Teams, asientos (2b-4).
