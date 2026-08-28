# Nest en el back-office de Aira — diseño

> Fecha: 2026-08-28. Estado: **diseño aprobado, sin implementar**.
> Reemplaza a `raven-admin` como back-office de Nest.

## Por qué

El admin de Nest es hoy `GeronimoDiClemente/raven-admin`: una app Electron local, de un
solo usuario, que **embebe la `SUPABASE_SERVICE_ROLE_KEY` y la key de Stripe dentro del
instalador**. Con un solo operador era aceptable. Repartirlo a los socios no lo es: la
`service_role` saltea todo el RLS de la base de Nest.

Lucas armó un back-office multi-producto (`aira-org/aira-admin`) que resuelve exactamente
eso: el admin sólo tiene un token del producto, revocable, y las keys del producto nunca
salen del producto. Nest y AiraMed son dos proyectos de la misma sociedad, así que Nest
entra como un producto más de esa plataforma.

`raven-admin` queda como **referencia de qué pantallas hay que cubrir**, no como destino.

## Decisiones

| Decisión | Elección | Por qué |
|---|---|---|
| Dónde corre el contrato | **Una Edge Function `admin-api`** con router interno | La `service_role` no sale de Supabase, que es el motivo de la mudanza. Un servicio en Vercel crearía un segundo lugar donde vive la llave |
| Una función o seis | **Una**, con router | Seis funciones son seis copias del guard de auth; el riesgo es que una quede sin él |
| Qué es una "cuenta" | **El usuario** | Ahí viven el plan y la suscripción. 82 usuarios contra 7 equipos, y el plan `team` es del usuario, no del equipo |
| Alcance v1 | **Paridad completa**, con las dos escrituras | Es lo único que permite apagar el `.exe`. Read-only dejaría el agujero abierto |
| Cambios al core de `aira-admin` | **Sólo los dos métodos que exigen las escrituras bespoke** de Nest en `ProductClient`. Ni schemas, ni páginas genéricas, ni RBAC | Son dos proyectos distintos: Nest se adapta al contrato que hay. Los dos métodos son aditivos y no cambian nada de AiraMed |
| Aislamiento entre productos | **No hace falta** | Misma sociedad, mismos dueños |

## Arquitectura

```
admin (Vercel)                        Supabase de Nest (qkqlsytxtshgjxwmafpw)
  ProductClient  ──HTTPS──►  functions/v1/admin-api  ──service_role──►  base
   Bearer NEST_ADMIN_API_TOKEN            router + guard
   X-Admin-Actor / X-Admin-Motivo
```

`ProductClient` hace `fetch(baseUrl + ruta)`, así que con
`NEST_BASE_URL = https://<ref>.supabase.co/functions/v1/admin-api` la llamada cae en
`/admin-api/api/internal/manifest` y el router matchea el sufijo `/api/internal/*`.
**Por eso no hace falta tocar el core del admin.**

Las llamadas van **admin → Nest, jamás al revés**: si el back-office está caído, Nest no
se degrada.

### La pieza que destraba todo

**No existe `supabase/config.toml` en el repo.** Las funciones se deployan a mano y
`verify_jwt` queda en su default `true`. El contrato usa `Authorization: Bearer <token de
producto>`, que **no es un JWT de Supabase**: sin el config, toda llamada muere en 401
antes de llegar al código.

Es el mismo bug que hoy tiene el webhook de Stripe —por el que ningún checkout activa un
plan— así que el `config.toml` arregla las dos cosas:

```toml
[functions.admin-api]
verify_jwt = false

[functions.stripe-webhook]
verify_jwt = false
```

## El contrato

### Manifest

```json
{
  "product": "nest",
  "account_label": { "singular": "usuario", "plural": "usuarios" },
  "capabilities": ["accounts"],
  "flags": [],
  "usage_meters": [
    { "key": "seats", "label": "Seats",            "unit": "seats" },
    { "key": "repos", "label": "Repos conectados", "unit": "repos" },
    { "key": "teams", "label": "Equipos",          "unit": "equipos" }
  ],
  "sections": [{ "key": "equipos", "label": "Equipos", "module": "nest.equipos" }]
}
```

`flags: []` — Nest no tiene flags de staff. `user_preferences` es configuración de UI del
usuario y el back-office no tiene por qué tocarla.

**No declara `usage-index`.** El `consumoSchema` del core es enteramente de AiraMed
(`fx.mep_ars`, `credito_min`, `usados_min`, `mensajes`, `gracia_usd`) y no hay forma
honesta de mapearlo a Nest. Los números de Nest van como `meters` de la ficha, que sí son
genéricos (`key/label/unit/used/quota/pct`).

`voz_suspendida` es obligatorio en `accountSummarySchema` del core y es un concepto de
AiraMed. **Nest manda `false` fijo.** Es un campo muerto en una columna: costo cosmético
contra tocar el core de otro proyecto.

### Endpoints

| Método | Ruta | Fuente en Nest |
|---|---|---|
| `GET` | `/api/internal/manifest` | Constante |
| `GET` | `/api/internal/accounts` | `auth.users` + `profiles` + `user_last_activity` |
| `GET` | `/api/internal/accounts/:id` | Lo anterior + `user_repos`, `team_members`, Stripe |
| `PUT` | `/api/internal/accounts/:id/plan` | `profiles.plan` — **bespoke de Nest** |
| `DELETE` | `/api/internal/accounts/:id` | `auth.admin.deleteUser` — **bespoke de Nest** |

Las dos escrituras no existen en el contrato de AiraMed y suman métodos al `ProductClient`.
Lo bespoke en el cliente core es un patrón que ese repo ya arrastra (`vapi-config`,
`republish`); seguirlo es más barato que refactorizarle el cliente a Lucas de paso.

`user_last_activity` es una **vista** y ya está aplicada en producción (migración 024 de
raven-admin). Da el `last_refresh_at` con el que se calculan DAU/WAU/MAU.

### Headers

- `Authorization: Bearer ${NEST_ADMIN_API_TOKEN}` — **mínimo 32 caracteres**, fail-closed:
  un token corto se rechaza aunque coincida.
- `X-Admin-Actor` — obligatorio **siempre**, también en lecturas. Sin actor no hay auditoría.
- `X-Admin-Actor-Email` — opcional, sólo para el audit.
- `X-Admin-Motivo` — obligatorio en **toda** escritura. Sin motivo, 400.

## Reglas de pricing de Nest

Lo que el contrato tiene que respetar, sacado del código (`src/lib/stripe.ts` y
`supabase/functions/stripe-webhook/index.ts`), no de la memoria:

| Regla | Consecuencia |
|---|---|
| 4 tiers (`free`, `pro`, `team`, `enterprise`) pero **sólo 3 self-serve**: Enterprise no tiene price y se asigna a mano | Cambiar el plan a `enterprise` desde el back-office es la **única** forma de darlo de alta, no un extra |
| **Team y Enterprise se cobran por seat** (mínimo 2 y 4) | El monto es `unit_amount × quantity`. Sin `quantity` el número miente |
| Cada plan tiene mensual y anual, y hay **2 prices anuales legacy** al 15% off | `plan_label` incluye el ciclo ("Team (anual)") y se expone el `price_id`: es lo único que distingue a un suscriptor legacy |
| Trial de **15 días** | `trial_ends_at = trial_started_at + 15 días` |

**Bug que no se porta:** `getMonthlyAmount` de raven-admin (`lib/stripe.ts:79`) ignora
`item.quantity`. Un equipo de 5 seats figura como $35 en vez de $175, así que el MRR que
muestra hoy está subestimado. La implementación nueva multiplica por `quantity`.

### Lo que el contrato deja a la vista

Al 2026-08-28 los 82 profiles tienen `stripe_customer_id` en **cero**, incluidos los 16 en
plan `team` y el 1 en `pro`: esos planes se asignaron a mano y no hay ninguna suscripción
detrás. Va como item de `health`: *"plan asignado sin suscripción de Stripe"*.

No es un caso raro que haya que esconder: es el síntoma visible del webhook caído, y el
back-office existe para que eso se vea sin entrar a la base.

## Invariantes

- **Ningún endpoint devuelve secretos.** `profiles` guarda `github_token` y `gitlab_token`
  **en texto plano**. Se copia el patrón de allowlist de AiraMed (`ACCOUNT_ALLOWED_KEYS`,
  que vive en el repo `airamed`, no en `aira-admin`: es del lado del producto) con un test
  que recorre el árbol serializado entero y falla si aparece una clave no declarada. Sin
  eso, el back-office se convierte en un lector de tokens de GitHub de 82 personas y el
  problema queda peor que antes de la mudanza.
- El audit registra los **nombres** de los campos tocados, nunca sus valores.
- El back-office **no persiste datos de negocio de Nest**: todo es proxy en vivo.

## Auditoría

Doble registro. El core ya escribe `audit_events` del lado del admin.

Del lado de Nest, `admin_audit_log` existe (16 filas) con `action / target_type /
target_id / target_label / before / after / created_at`, pero **le faltan el actor y el
motivo**, que son justamente lo que el contrato exige. Migración nueva:

```sql
alter table admin_audit_log
  add column if not exists actor       text,
  add column if not exists actor_email text,
  add column if not exists motivo      text;
```

Se registra **también cuando la acción falla**: un intento fallido de borrar un usuario es
información operativa.

## Errores y degradación

| Situación | Respuesta |
|---|---|
| Token ausente, corto o distinto | `401`, sin detalle |
| Falta `X-Admin-Actor` | `400` |
| Escritura sin `X-Admin-Motivo` | `400` |
| Cuenta inexistente | `404` |
| **Stripe caído** | `200` con los datos de Supabase y lo de Stripe marcado **no disponible** — nunca `$0`: cero es un monto válido y mentiría en la pantalla donde se decide sobre una cuenta |
| Función caída | El `ProductClient` no tira; la pantalla dice "Nest no responde" |

## Testing

- **La traducción del modelo de Nest al shape del contrato es un módulo puro** — sin Deno,
  sin red, sin Supabase — testeado con vitest, que ya está en el repo. La cáscara HTTP
  queda fina a propósito: routing, auth y nada más.
- Test de allowlist sobre el árbol serializado (ver Invariantes).
- Test del guard: token de 31 caracteres → 401.
- Smoke real con `curl` contra la función deployada, antes de tocar el repo del admin.

## Reparto por repo

| Repo | Qué entra |
|---|---|
| `raven-nest` | Edge Function `admin-api` · `supabase/config.toml` · migración del audit |
| `aira-admin` | Entrada en `registry.ts` · `src/products/nest/` · 2 métodos aditivos en `core/products/client.ts` · 2 env vars en Infisical |

**Orden:** primero el contrato en Nest, verificado con `curl` contra la función deployada.
Recién con eso verde, el PR al repo del admin — así el contrato no queda esperando review
para saber si anda. El PR pasa por el CI de Lucas: `aislamiento.test.ts`, lint, typecheck,
tests y build.

## Lo que NO entra

- **Cancelar cobros desde el back-office.** Las escrituras cambian `profiles.plan` y nada
  más; cancelar una suscripción sigue siendo manual en el dashboard de Stripe. Que el panel
  no dé la ilusión contraria.
- **Generalizar `voz_suspendida`** ni ningún otro campo del core.
- **Renombrar el repo o mover el dominio** del back-office.
- **Arreglar el webhook de Stripe** más allá de lo que el `config.toml` destraba solo.
- **La sección de equipos** (`nest.equipos`) queda declarada en el manifest pero se
  implementa después: el core no rompe con una sección declarada que el admin no
  implementa (`seccionesSinImplementar`).

## Riesgos conocidos

- **El `config.toml` toca `stripe-webhook`.** Es la corrección de un bug abierto, pero
  cambia el comportamiento de una función en producción: se verifica que el webhook siga
  validando la firma de Stripe (que es su verdadero guard) antes de dar por buena la tanda.
- **`admin_audit_log` no tiene migración en el repo**: la tabla se creó a mano en la base.
  Por eso la migración usa `add column if not exists`.
- **Enterprise no existe en `PRICE_TO_PLAN`.** Si algún día se vende self-serve, el webhook
  lo pisaría con `'pro'` (su fallback). Fuera de alcance, anotado.
