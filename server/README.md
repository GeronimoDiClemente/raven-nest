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
| `GET /v1/sync/status` | — | §5.3 — identidad del device, plan, cuota y `next_poll_ms`. |
| `POST /v1/sync/delete-data` | `/functions/v1/memory-sync/delete-cloud-data` | §5.5 — el derecho al borrado (§6.6/§7.5 del doc de arquitectura). Borra las observaciones, los proyectos y los push receipts del usuario autenticado en **una** transacción y devuelve los conteos. **No** borra el usuario ni sus devices: es "borrá mi copia de nube", no "borrá mi cuenta", así que el token con el que llamó sigue sirviendo. El alias existe porque `electron/main.ts` todavía postea a la ruta vieja y sólo mira `res.ok` — un 404 ahí rompe el borrado **en silencio**. |
| `GET /health` | — | Sin token. |

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
| `NEXT_POLL_MS` | `300000` (5 min) | El intervalo que el servidor le dice al cliente que espere antes del próximo `pull`, devuelto en la respuesta de `pull` y de `status` (§11.4). Es la única palanca de costo real: ~99% de los pulls vuelven vacíos. Se puede aflojar a 15-30 min sin tocar ningún cliente. |
| `MAX_BYTES_PER_USER` | `1073741824` (1 GiB) | Tope de cuota por usuario, informado en `status.quota.max_bytes`. **Hoy sólo se reporta — no se aplica.** Rechazar pushes por cuota excedida es trabajo de §11.6, todavía no implementado. Un valor no numérico, vacío o ≤ 0 cae al default en vez de mandar `NaN` en cada respuesta de status (que es lo que hacía antes, y el usuario lo veía). |
| `PG_POOL_MAX` | `10` | Tamaño máximo del pool de conexiones a Postgres (`pg.Pool`). |

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

- `plan` tiene que ser uno de `pro`, `team` o `enterprise` — el servidor gatea el acceso a
  sync por plan del lado del servidor (§9.3), `free` responde 403 `plan_required` aunque el
  device esté en el allowlist.
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
