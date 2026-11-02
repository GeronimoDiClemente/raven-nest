# Nest Memory — servicio de sync

Backend propio para la sincronización de memoria entre devices (spec:
`docs/superpowers/specs/2026-08-31-memory-sync-backend-design.md`). Un contenedor sin
estado propio — todo vive en Postgres — que habla el contrato de wire §5: `push`, `pull`,
`status` y `delete-data`, más los alias con forma de Supabase para el bring-up (§5.4/§5.5).

## Rutas

| Ruta | Alias con forma de Supabase | Qué hace |
|---|---|---|
| `POST /v1/sync/push` | `/functions/v1/memory-sync/push` | §5.1 — aplica mutaciones, una transacción por mutación, idempotente por `(device_id, seq)`. |
| `POST /v1/sync/pull` | `/functions/v1/memory-sync/pull` | §5.2 — filas nuevas por cursor de proyecto. |
| `GET /v1/sync/status` | — | §5.3 — identidad del device, plan, cuota, `next_poll_ms` y el tope de proyectos del plan (`limits.max_projects`, spec 2b-1), `kept_project_key` y `over_limit` (spec 2b-2), `key_epoch`, `encrypted_teams` y `plaintext_pending` (spec 2026-11-02: cuántas observaciones propias, personales y no borradas siguen con algún campo sellable en claro; el cliente no dice "Encrypted" hasta que es 0). |
| `POST /v1/projects/keep` | — | Spec 2b-2 §4.7 — `{ project_key }`: con más proyectos que el tope, cuál sigue sincronizando. Sólo proyectos propios y nunca `__global__` (400 `unknown_project`); sin estar por encima del tope, 409 `not_over_limit`. |
| `POST /internal/plan` | — | Spec 2b-2 §4.5 — el aviso de plan del webhook de Stripe. Firmado con `X-Nest-Signature: t=<seg>,v1=HMAC-SHA256(PLAN_SYNC_SECRET, "<t>.<cuerpo crudo>")`, ventana de 300 s. Escribe `users.plan` y, si es pago, la allowlist (bajar a `free` no saca de la allowlist). Sin `PLAN_SYNC_SECRET` responde 404. |
| `POST /internal/memberships` | — | El aviso de membresía de equipos que manda Supabase (trigger en `team_members`, migración `20261102000000_membership_sync.sql`). Misma firma y mismo secreto que `/internal/plan`. Cuerpo `{ user_id, as_of, memberships: [{ team_id, team_name, role }] }` con el set COMPLETO de equipos activos: reemplaza `team_memberships` del usuario, así un miembro sacado deja de bajar la memoria del equipo. Un `as_of` más viejo que el último aplicado responde 200 `{ ok: true, ignored: 'stale' }` sin tocar nada. Sin `PLAN_SYNC_SECRET` responde 404. |
| `POST /v1/sync/delete-data` | `/functions/v1/memory-sync/delete-cloud-data` | §5.5 — el derecho al borrado (§6.6/§7.5 del doc de arquitectura). Borra las observaciones, los proyectos y los push receipts del usuario autenticado en **una** transacción y devuelve los conteos. **No** borra el usuario ni sus devices: es "borrá mi copia de nube", no "borrá mi cuenta", así que el token con el que llamó sigue sirviendo. El alias existe porque `electron/main.ts` todavía postea a la ruta vieja y sólo mira `res.ok` — un 404 ahí rompe el borrado **en silencio**. |
| `POST /v1/link/start` | — | Vincular una máquina sin navegador. Sin credenciales. Cuerpo opcional `{ name, platform }` (nombre recortado a 100; `platform` sólo `win32`/`darwin`/`linux`, si no null). Devuelve `{ user_code, device_code, expires_in, interval }`. 20 por hora por IP (ver `TRUST_PROXY`). |
| `POST /v1/link/check` | — | Con el JWT de Supabase y `{ user_code }` (o `{ code }`): lo que la página `nestmux.com/link` muestra antes de aprobar — `{ device_name, platform, created_at, expires_at, expires_in, eligibility, plan }`, con `eligibility` = `ok` / `not_in_beta` / `plan_required` / `device_limit_reached`, el mismo veredicto que `authenticate` (`src/elegibilidad.ts`), y `plan` el plan efectivo de la cuenta. No crea `users` ni emite token. 404 `unknown_code`, 400 `expired`, 409 `already_approved`. 20 por hora por `userId` verificado (no por IP: detrás del proxy de Railway todos comparten IP, y un 401 no gasta el cupo). CORS: ver `LINK_WEB_ORIGINS`. |
| `POST /v1/link/approve` | — | Con el JWT de Supabase y `{ user_code }`: ata el pedido a la cuenta, aplicando antes la red de seguridad del plan pago de Supabase (igual que `registerDevice`), para que lo que `check` dijo `ok` sea lo que el reclamo acepte. No emite nada. La misma escalera de errores que `check` (404/400/409); si otra aprobación concurrente ató el pedido primero, también 409 `already_approved`. 20 por hora por `userId` verificado, en un balde aparte del de `check` (un 401 no lo gasta). CORS: ver `LINK_WEB_ORIGINS`. |
| `POST /v1/link/poll` | — | Con `{ device_code, name?, platform? }`: 400 `authorization_pending`, 429 `slow_down`, 410 `expired`, 403 `denied`, o 200 con el token (lo emite `registerDevice`, con sus controles). |
| `GET /health` | — | Sin token. |

## Cifrado del lado del cliente — qué deja de ser legible

Desde el 2026-09-11 el cliente cifra antes de subir (spec
`2026-09-09-nest-memories-plugin-y-cifrado.md` §5.2). **El servicio no necesita la clave**: sólo
mide `octet_length(content)` para la cuota y nunca mira adentro de `content` ni de `title`.

**Desde el 2026-11-02 el cifrado es obligatorio** (spec `2026-11-02-cifrado-obligatorio-design.md`),
y eso sí cambió lo que el servicio hace:

- **El push rechaza toda fila personal (`scope <> 'team'`) que no venga sellada**, cifre la cuenta
  o no, con `encryption_required`. "Sellada" = todo campo sellable con texto (`title`, `content`,
  `project_display_name`, `content_hash`, `origin_account`, `git_branch`) empieza con `nmc1:`, y
  los tags viajan como UN sobre (`["nmc1:…"]`). Es reversible: el cliente no la descarta, la
  sube sellada cuando tiene la maestra. La única salida es `ALLOW_PLAINTEXT_PERSONAL=1` con la
  cuenta en época 0, y **sólo la setea `server/vitest.config.ts`** (ver Variables de entorno).
- **`status` trae `plaintext_pending`** (ver Rutas). La migración de una cuenta vieja es el
  re-upload del cliente: re-encola todo lo propio (las filas superseded incluidas) y el upsert
  por `sync_id` pisa cada fila en claro con la sellada — `origin_account`, `git_branch`,
  `origin_ai` y `author_display` incluidos. Una fila que llega superseded y acá ya lo está
  conserva su `superseded_by` sin pasar por la colisión de temas: re-cifrar no es editar.
- **Guarda de LWW en el push** (N1): una mutación que PIERDE contra la fila guardada (mismo
  autor) por el orden de `resolveLWW` —`updated_at` primero, `lamport` después, igual que el
  cliente y la colisión de temas— no escribe nada y vuelve con `outcome: "stale"` y el `project_seq` que
  la fila ya tenía (no se pide seq nuevo, así que ningún pull la vuelve a bajar). El cliente la
  da por hecha, como `applied`. El empate total pasa: el re-upload sellado lleva el mismo
  `updated_at` y lamport que la fila en claro que reemplaza. Con sólo lamport, una máquina
  atrasada en el pull que edita más tarde con lamport más bajo quedaba stale acá pero ganaba
  en su LWW local: divergencia permanente. Cubre los dos sentidos: un upsert viejo no pisa una edición
  nueva ni resucita un borrado nuevo, y un borrado viejo no mata una fila nueva. El cliente,
  además, hace un pull completo antes de tomar el snapshot del re-upload.
- **Un tombstone no guarda texto**: el delete vacía `title` (`''`, es NOT NULL), `content`,
  `tags`, `topic_key`, `content_hash`, `origin_account` y `git_branch`. La migración `013` hizo lo
  mismo con los tombstones que ya estaban.
- **`POST /v1/keys/publish` tiene un modo `recovery`** para regenerar el código de recuperación
  sin rotar: un único wrap con `slot` y `kind` `recovery` (si no, 400 `invalid_recovery_wrap`),
  la época vigente (409 `stale_key_epoch`, o `not_activated` en época 0) y `rotate_proof` contra
  `users.rotate_verifier` (403 `must_hold_master`). Toca sólo el slot `recovery`: el código viejo
  deja de abrir. `authorize` sigue sin poder pisarlo (`cannot_overwrite_recovery`).

Lo que cualquier consumidor de esta base tiene que saber antes de romperse solo — en
particular el back-office, que vive en otro repo (`RavenProjects/aira-admin`):

| Columna de `observations` | Después del cifrado |
|---|---|
| `title`, `content` | Texto cifrado con prefijo `nmc1:`. **No legible, no buscable.** |
| `tags` | Blob cifrado, no un array consultable. |
| `origin_account` | Cifrado desde el 2026-09-12. Cerraba una fuga que nadie había decidido: sale de `NEST_MEMORY_ACCOUNT`, que se arma con el nombre del directorio de cuenta, y en una máquina real **ese nombre es el email del usuario**. Subía en claro en cada observación guardada por un agente. El servicio sólo lo almacena y lo devuelve — no lo consulta ni filtra por él. |
| `topic_key` | HMAC hex de 32 caracteres. Sirve para igualdad; no se puede volver al tema. |
| `projects.display_name` | Cifrado. Cerraba una fuga: `memory-project-key.ts` dice "Cloud never learns the repo name" y el display name viajaba en claro al lado. |
| `git_branch` | Cifrado desde el 2026-11-02 (cifrado obligatorio). Antes viajaba en claro, y un nombre de rama dice de qué se está trabajando. |
| `type`, `scope`, `lamport`, timestamps, `sync_id`, `project_key`, `superseded_by`, `deleted`, `origin_ai`, `author_display` | **Sin cambios, en claro.** `scope` decide autorización del lado del servidor y cifrarlo rompería el modelo de permisos; el resto lo necesita para ordenar, mezclar y repartir. `project_key` es un sha256 sin sal (pendiente de otro spec). |

Durante la migración conviven filas cifradas y en claro: `nmc1:` es lo único que las separa, y
`plaintext_pending` dice cuántas personales quedan.
Una observación con `scope = 'team'` se cifra desde el 2026-10-15 con la clave del EQUIPO, si el
equipo la activó (`team_keys`; spec `docs/superpowers/specs/2026-10-14-cifrado-de-equipo-design.md`):
mismas columnas cifradas y mismo prefijo `nmc1:` que la tabla de arriba. Un equipo que no la
activó sigue subiendo en claro, y para uno que sí, el push rechaza el claro con
`team_encryption_required`. Las rutas `/v1/teams/key*` (sólo `leader` para activar, autorizar y
migrar) exigen además probar la maestra: `proof` contra `team_keys.verifier`. La migración del
histórico es la única vía que reescribe filas ajenas (`team-keys-recrypt.ts`), y
`GET /v1/teams/key/recrypt-pending` le devuelve al leader el contenido de lo que sigue en claro
(con el tema y el `project_key`: la migración también re-sella `topic_key` como HMAC y resuelve
el supersede igual que `push.ts`).

## Límites por plan

La única fuente de verdad es `src/limits.ts` (`limitsFor(plan)`), verificado en producción
el 2026-09-02 contra `https://sync-production-75a4.up.railway.app` (ver
`.superpowers/sdd/2026-09-02-limites-del-servicio-de-sync/task-9-report.md`). El nombre de
plan que efectivamente llega en `auth.plan` sigue siendo el histórico: `pro` mapea a los
límites de **Cloud** y `team`/`enterprise` mapean a los de **Teams** — el rename comercial
(`pro` → `cloud`) es trabajo aparte, no tocado acá.

| Límite | Free | Cloud | Teams |
|---|---|---|---|
| Proyectos en la nube | 1 | 100 | 100 |
| Máquinas (devices) | 3 | 10 | 10 |
| Cuota total (bytes de contenido) | 100 MiB | 1 GiB | 5 GiB |
| Tamaño máximo por observación | 1 MB | 1 MB | 1 MB |
| `next_poll_ms` (intervalo entre `pull`) | 900000 (15 min) | 300000 (5 min) | 300000 (5 min) |
| Rate limit | 60 push/min y 60 pull/min por device | igual | igual |
| Memoria compartida (`scope: 'team'`) | no | no | sí |

Notas:

- El tope de proyectos y el de bytes se aplican en `push.ts` (`project_limit_reached` y
  `quota_exceeded`); el de devices en `auth.ts` (`device_limit_reached`); el de tamaño por
  observación también en `push.ts` (`observation_too_large`); el de `scope: 'team'` en
  `push.ts` (`team_scope_not_allowed`); y el rate limit en `http.ts`, por verbo (push y
  pull tienen cada uno su propio contador de 60/min, así que agotar uno no bloquea al otro).
- `MAX_BYTES_PER_USER` pisa el techo de bytes de la tabla de arriba para una **instancia
  dedicada**, y lo pisa en los **dos** caminos: lo que `status.quota.max_bytes` reporta y lo
  que `push` hace cumplir con `quota_exceeded`. Ver la tabla de variables de entorno más
  abajo.

## Códigos de error

Un `push` nunca corta la conexión por un error de negocio: cada mutación mala vuelve con
`outcome: "rejected"` y un `error` dentro de `results[]`, junto a las mutaciones que sí
aplicaron en el mismo batch.

| `error` (dentro de `results[]` de un push) | Cuándo |
|---|---|
| `missing_sync_id` | La mutación no trae `sync_id` ni `payload.sync_id`. |
| `team_scope_not_allowed` | `payload.scope: 'team'` en un plan sin memoria compartida (todo menos `team`/`enterprise`). |
| `project_limit_reached` | El `project_key` es nuevo para esa cuenta y ya no quedan lugares (tope de proyectos del plan), **o** la cuenta tiene más proyectos que el tope (bajó de plan) y éste no es uno de los permitidos: el elegido con `POST /v1/projects/keep` o, sin elección, los más viejos (spec 2b-2). |
| `observation_too_large` | `payload.content` supera 1 MB medido en bytes utf-8 (no en `.length`). |
| `quota_exceeded` | La suma de bytes de contenido del usuario ya llegó al tope de su plan. Sólo frena mutaciones nuevas — un `op: 'delete'` siempre pasa, porque es la única forma de liberar espacio. |
| `encryption_required` | Fila personal con algún campo sellable en claro (spec 2026-11-02, cifrado obligatorio). Reversible: el cliente la retiene y la sube sellada cuando tiene la maestra. |
| `team_encryption_required` | Fila de equipo en claro para un equipo que activó su clave (`team_keys`). Reversible. |

| HTTP | `error` | Cuándo |
|---|---|---|
| 401 | `unauthorized` | Sin token, o un token que no resuelve a ningún device (`d.token_hash` no matchea, o el device tiene `revoked_at` seteado). |
| 403 | `not_in_beta` | El token es válido pero el usuario no está en la tabla `allowlist`. |
| 403 | `plan_required` | El plan del usuario no incluye sync (hoy todos los planes conocidos lo incluyen; cae acá un plan desconocido, porque `limitsFor` falla cerrado a Free y Free SÍ está en `CLOUD_PLANS`, así que en la práctica este código está reservado para el día que exista un plan sin nube). |
| 403 | `device_limit_reached` | El device autenticado no está entre las N máquinas más antiguas (por `created_at`, `id`) que el tope de su plan permite. |
| 413 | `batch_too_large` | El `push` trae más de 500 mutaciones en un solo batch. Se rechaza el batch entero antes de abrir ninguna transacción. |
| 429 | `rate_limited` | Más de 60 requests en 60 segundos del mismo verbo (push o pull) para el mismo device. Vuelve con el header `Retry-After` (segundos hasta que se libera la ventana). |

## Levantarlo en local

Necesita un Postgres 16 accesible. La forma más rápida es un contenedor descartable:

```bash
docker run -d --name nest-memory-pg -e POSTGRES_PASSWORD=nestmem \
  -e POSTGRES_DB=nest_memory -p 55432:5432 postgres:16-alpine
```

Con Postgres arriba, desde `server/`:

```bash
npm install
DATABASE_URL="postgres://postgres:nestmem@127.0.0.1:55432/nest_memory" npx tsx src/index.ts
```

El proceso corre las migraciones pendientes **antes** de abrir el puerto (ver más abajo) y
después loguea `[sync] listening on 8080`. `curl http://127.0.0.1:8080/health` tiene que
devolver `{"ok":true}`.

Para correrlo dentro de Docker en vez de con `tsx` local, el `Dockerfile` de esta carpeta
ya está listo:

```bash
docker build -t nest-memory-sync .
docker run --rm -p 8080:8080 \
  -e DATABASE_URL="postgres://postgres:nestmem@host.docker.internal:55432/nest_memory" \
  nest-memory-sync
```

Es el mismo Dockerfile pensado para correr sin cambios en Railway, en Hetzner o en la
máquina de un cliente enterprise (§11.1 de la spec).

## Variables de entorno

Ninguna es obligatoria — todas tienen un default razonable para desarrollo local — pero
en producción hay que fijar al menos `DATABASE_URL`.

| Variable | Default | Qué hace |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:nestmem@127.0.0.1:55432/nest_memory` | Connection string de Postgres. El default apunta al contenedor de desarrollo local — nunca usarlo en producción. |
| `PORT` | `8080` | Puerto donde escucha el servidor HTTP. |
| `MAX_BYTES_PER_USER` | ninguno (manda el plan) | Override de **instancia dedicada** (§10 de la spec de pricing): cuando un deploy sirve a un solo cliente, el techo por usuario de la tabla de planes no significa nada y el disco de la máquina es el límite real. Si está seteada, gana sobre `limitsFor(plan).maxBytes` **en los dos caminos que dependen de ese número**: lo que `GET /v1/sync/status` informa (`quota.max_bytes`) y el rechazo real de pushes por cuota (`quota_exceeded`, en `push.ts`). Los dos lo resuelven por la misma función, `maxBytesFor(plan)` en `limits.ts`. Sin setear — el caso del servicio compartido — manda el plan. Un valor no numérico, vacío o ≤ 0 se ignora y cae **al límite del plan** (antes caía a 1 GiB fijo, así que un `MAX_BYTES_PER_USER=abc` le reportaba 1 GiB a todo plan, Free incluido: un typo aflojaba el techo en vez de ignorarse). |
| `PG_POOL_MAX` | `10` | Tamaño máximo del pool de conexiones a Postgres (`pg.Pool`). |
| `R2_ACCOUNT_ID` | ninguno | ID de cuenta de Cloudflare, la primera parte del endpoint S3 de R2. **Sin las cuatro `R2_*` el servicio arranca igual pero no hace backups**, y lo dice en el log al arrancar. |
| `R2_ACCESS_KEY_ID` | ninguno | Access key del API token de R2, **acotado al bucket de backups**. |
| `R2_SECRET_ACCESS_KEY` | ninguno | Secret del mismo token. |
| `R2_BUCKET` | ninguno | Nombre del bucket, por ejemplo `nest-memory-backups`. **La retención de 30 días es una regla de ciclo de vida del bucket, no del código.** |
| `R2_BETAS_BUCKET` | ninguno | Bucket **privado** con los instaladores de la beta cerrada (ver `src/betas.ts`). Separado del de backups, cuya regla de ciclo de vida los borraría. El token `R2_*` tiene que poder LEER este bucket. Sin esto (o sin `BETA_LINK_SECRET`) las rutas `/beta/*` y `/v1/beta/*` contestan 503 y el resto anda igual. |
| `BETA_LINK_SECRET` | ninguno | Firma los links personales de descarga (`scripts/beta-link.mjs`). Al menos 32 caracteres. Rotarlo corta todos los links de una vez. |
| `PG_DUMP_CMD` | `pg_dump` | Con qué correr `pg_dump`, como lista de palabras. Existe para desarrollo en máquinas sin cliente de Postgres instalado: `docker exec -i nest-memory-pg pg_dump`. En el contenedor del servicio no se setea. |
| `PG_RESTORE_CMD` | `pg_restore` | Lo mismo para `pg_restore`, que usa el script de restauración. |
| `PG_BIN_DATABASE_URL` | el valor de `DATABASE_URL` | La URL que ven los **binarios** de Postgres, que no siempre es la que ve el driver `pg`. En producción son la misma y esto no hace falta. En desarrollo sí: el driver corre en Windows y llega por `127.0.0.1:55432`, mientras que `pg_dump` corre adentro del contenedor por `docker exec` y desde ahí la base es `127.0.0.1:5432`. |
| `SUPABASE_URL` | ninguno | Base de la API REST de Supabase (`https://<ref>.supabase.co`), usada para sincronizar `team_memberships` en cada `POST /v1/devices` (Team Memory Layer 1, Parte 2). **Sin ella, el registro de device funciona exactamente igual que hoy** — la sincronización de membresía es best-effort y simplemente no escribe nada. |
| `SUPABASE_ANON_KEY` | ninguno | La anon key pública del mismo proyecto de Supabase. Va como header `apikey`; la identidad real la aporta el JWT del propio login del usuario como `Authorization: Bearer`, así que la consulta a `team_members` respeta la RLS de Supabase — nunca se usa una `service_role` key acá. Sin `SUPABASE_URL` **y** `SUPABASE_ANON_KEY` juntas, la sincronización no corre. |
| `PLAN_SYNC_SECRET` | ninguno | Secreto compartido con el webhook de Stripe (`stripe-webhook`, secret `PLAN_SYNC_SECRET` en Supabase) para firmar `POST /internal/plan`. **Sin él la ruta responde 404** y los pagos no llegan solos al plan del servidor. Al menos 32 caracteres, desde 1Password. |
| `LINK_WEB_ORIGINS` | `https://nestmux.com,http://localhost:4321` | Orígenes (separados por coma) a los que `/v1/link/check` y `/v1/link/approve` les contestan CORS: sólo `POST`, headers `authorization, content-type`, sin credenciales. **Seteada, manda sólo esa lista**: en producción va `https://nestmux.com` para sacar `localhost`. Si el sitio se sirve también en `www.`, sumarlo. Ninguna otra ruta tiene CORS. |
| `TRUST_PROXY` | ninguno | Con `1`, los limitadores por IP (`/v1/link/start` y `POST /v1/devices`) toman la IP del cliente de `X-Forwarded-For`, de su entrada de **más a la derecha** (la que agrega el proxy; las de la izquierda las escribe el cliente). Sin `1` el header se ignora y manda la IP del socket; con `1` y sin header (o con la última entrada vacía), también. **Antes de setearla en Railway, verificar qué IP ve el proceso y qué trae `X-Forwarded-For`**, y setearla sólo si Railway agrega la IP del cliente al final — con OK de Gero (`docs/RUNBOOK-LOGIN-SIN-NEST.md` §1). Detrás de un proxy que no la agrega, o sin proxy, dejarla sin setear: cualquiera podría elegir su clave de límite. |
| `ALLOW_PLAINTEXT_PERSONAL` | ninguno | **Sólo para tests. Nunca en un deploy.** Con `1`, el push acepta filas personales en claro de una cuenta en época 0 (con la cuenta ya cifrando, ni así). Existe porque 24 archivos de tests del servidor suben filas en claro para probar otras cosas (cuota, tope, pull, supersede); la setea `server/vitest.config.ts` y nada más. En producción reabriría exactamente el hueco que cierra el cifrado obligatorio. |

`NEXT_POLL_MS` existió como env var pero ya no se lee en ningún lado del código: el
intervalo que ve el cliente sale siempre de `next_poll_ms` en la tabla de límites por plan
(ver abajo), no de una variable de entorno global.

## Dar de alta una cuenta y un device a mano

Todavía no existe `POST /v1/devices` (§9.2 de la spec) — la emisión de tokens contra el
login queda afuera de este plan. Mientras tanto, una cuenta se siembra directo en
Postgres. El token se genera aparte (por ejemplo con `openssl rand -hex 32`) y el
servicio guarda sólo su hash — nunca el token en texto plano.

```sql
-- si la base no tiene pgcrypto todavía:
create extension if not exists pgcrypto;

insert into users (id, plan) values ('11111111-1111-1111-1111-111111111111', 'pro')
  on conflict do nothing;

-- sin esto, cualquier request de esa cuenta responde 403 not_in_beta (§9.1)
insert into allowlist (user_id) values ('11111111-1111-1111-1111-111111111111')
  on conflict do nothing;

insert into devices (id, user_id, name, token_hash)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        'nombre-del-device',
        encode(digest('EL_TOKEN_ELEGIDO', 'sha256'), 'hex'))
  on conflict do nothing;
```

Notas:

- `plan` tiene que ser uno de `free`, `cloud`, `pro`, `team` o `enterprise` (los que están
  en `CLOUD_PLANS`, `src/auth.ts`) — cualquier otro valor responde 403 `plan_required`
  aunque el device esté en el allowlist. `free` SÍ está habilitado a propósito: la spec de
  pricing le da 1 proyecto en la nube, el gancho para que alguien note que su memoria
  sincroniza al abrir una segunda máquina. Lo que lo acota no es este gate sino los límites
  de la tabla de arriba (1 proyecto, 100 MiB, poll cada 15 min).
- Si `digest()` no existe y `create extension pgcrypto` no es una opción, se puede calcular
  el sha256 fuera de Postgres y pegar el hex resultante en `token_hash` directamente:
  ```bash
  node -e "console.log(require('crypto').createHash('sha256').update('EL_TOKEN_ELEGIDO').digest('hex'))"
  ```
- El cliente manda el token como `Authorization: Bearer EL_TOKEN_ELEGIDO` en cada request.

## Correr el contract check contra este servicio

`scripts/memory-sync-contract-check.mjs` (en la raíz del repo) drivea el servicio como dos
devices y verifica 19 propiedades del contrato §5 — cada una un bug real que tenía el
backend viejo de Supabase (colisión de topic, tombstones, idempotencia, tags como array,
el reloj del cliente preservado, `project_seq` sin agujeros, el pull incremental vacío).
No sabe contra qué está hablando: le alcanza con el contrato de wire, así que sirve igual
contra este servicio o contra el stub (`scripts/memory-sync-stub.mjs`).

Con el servicio corriendo y una cuenta sembrada como en el paso anterior:

```bash
node scripts/memory-sync-contract-check.mjs --base http://127.0.0.1:8080 --token EL_TOKEN_ELEGIDO
```

Salida esperada: **19 OK y exit 0**.

Cada corrida usa identificadores (`sync_id`, `project_key`, y el `seq` de cada mutación)
derivados del timestamp del proceso, así que **correrlo varias veces seguidas contra la
misma cuenta es seguro** — ninguna corrida pisa los receipts de idempotencia de la
anterior. Ojo con una cosa: la identidad de device que importa para esa idempotencia es
siempre la que resuelve el token (`auth.deviceId` en `src/auth.ts`), nunca el `device_id`
que manda el body de cada request — es una decisión de seguridad deliberada (un device no
puede spoofear la identidad de otro sólo cambiando ese campo), así que todas las
mutaciones de una corrida del checker, sin importar qué "device" simulen, terminan
autenticadas como el único device real detrás de `--token`.

## Orden de despliegue (cifrado obligatorio, 2026-11-02)

**Publicar primero la app y el plugin (`@nestmux/memory`), y el servidor al final.** La decisión
final es de Gero; esto es lo que la sostiene.

El servidor nuevo rechaza con `encryption_required` toda fila personal en claro. Si sale antes
que los clientes, frena a todo el que todavía no actualizó:

- Las versiones con `276148b` retienen la fila en la cola y no la descartan: no se pierde nada,
  pero su sync personal queda parado hasta que actualicen y activen.
- Las anteriores la marcan como rechazada (terminal) y siguen como si nada: la memoria sigue en
  la máquina, pero no llega a la nube. Al actualizar y conseguir la maestra, la app re-encola
  los borrados que quedaron así y corre el re-upload, que vuelve a subir las filas vivas
  (`asegurar-en-el-main.ts`, F4 de la review final). El `mutation_log` purga lo acusado a los 7
  días, así que un borrado más viejo que eso ya no vuelve: su fila queda viva en la nube.

Al revés no hay ese riesgo: una app nueva contra el servidor viejo sube todo sellado y el
servidor viejo lo acepta (sin pisar `origin_account` ni `git_branch` en el re-upload: eso lo
arregla el servidor nuevo, y su `plaintext_pending` dispara otra pasada). Lo único que la app
nueva necesita del servidor nuevo es que conserve
la marca de las filas superseded al re-subirlas (`conservaSupersede` en `push.ts`; uno viejo las
resucita), y por eso no las re-sube hasta ver `plaintext_pending` en el status
(`opcionesDeReupload` en `electron/main.ts`). La migración `013` corre sola al arrancar el
servidor nuevo (ver abajo).

## Migraciones — corren solas al arrancar

**No hay que correr nada a mano.** `src/index.ts` llama `migrate(pool)` antes de abrir el
puerto (`src/db.ts`): toma un `pg_advisory_lock`, crea `schema_migrations` si no existe,
aplica en orden cada archivo `.sql` de `migrations/` que todavía no esté registrado ahí
(cada uno en su propia transacción), y libera el lock. Si dos instancias arrancan al mismo
tiempo, la segunda espera el lock en vez de pelear por crear las mismas tablas.

Si una migración falla, el proceso **no llega a abrir el puerto** — sale con código
distinto de 0 antes de aceptar tráfico contra un schema a medio migrar. La próxima vez que
arranque reintenta exactamente esa migración (nunca quedó registrada en
`schema_migrations`), no las que ya se aplicaron.

Migraciones nuevas van en `migrations/`, numeradas (`002_...sql`, `003_...sql`, ...) — no
hay ORM ni herramienta de migraciones, es SQL plano leído en orden alfabético.

## Backups y restauración

El servicio hace un `pg_dump -Fc` por día y lo sube a Cloudflare R2. La retención de 30 días la
hace **la regla de ciclo de vida del bucket**, no el código.

Cada intento deja una fila en `backups`, buena o mala. El último backup bueno:

```sql
select object_key, finished_at, bytes, row_counts from backups where ok order by id desc limit 1;
```

Y los que fallaron, que es la consulta que de verdad importa:

```sql
select started_at, error from backups where not ok order by id desc limit 10;
```

**Restaurar y verificar** (`scripts/restore-check.mjs`). Crea una base nueva, restaura ahí,
compara los conteos contra los que se guardaron cuando se tomó el dump, imprime el checksum del
contenido y borra la base. No toca la base de origen.

```bash
npx tsx scripts/restore-check.mjs --from-r2          # el último dump real
npx tsx scripts/restore-check.mjs --file x.dump      # un dump local, sin R2
npx tsx scripts/restore-check.mjs --from-r2 --keep   # deja la base para inspeccionarla
```

Va con `npx tsx` y no con `node` pelado porque importa módulos TypeScript de `src/`.

En una máquina sin cliente de Postgres instalado (Windows), apuntar los binarios al contenedor
de la base **y darles su propia URL**, que no es la del driver:

```bash
export PG_RESTORE_CMD="docker exec -i nest-memory-pg pg_restore"
export PG_BIN_DATABASE_URL="postgres://postgres:nestmem@127.0.0.1:5432/nest_memory"
```
