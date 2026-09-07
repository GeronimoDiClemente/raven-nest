# Nest Memory — backend de sync propio · diseño

> Rama: `smoke/memory-bridge`
> Fecha: 2026-08-31
> Reemplaza: `supabase/migrations/20260730000000_nest_memory.sql` y `supabase/functions/memory-{token,sync}/`
> Relacionados: `docs/nest-memory-architecture.md` (Bauti), `docs/MEMORY_INTEGRATIONS_CONTRACT.md`, `docs/superpowers/specs/2026-08-26-memory-bridge-design.md`

## 1. Qué es

El servicio que reemplaza a Supabase como backend de sincronización de Nest Memory, después
de la decisión del 2026-08-26 de no hostear la memoria ahí.

Es deliberadamente chico: **dos handlers HTTP y una base Postgres**. Todo lo difícil (el
merge LWW, el contador lamport, la colisión de topic, los tombstones, la cola offline) ya
está resuelto y testeado del lado del cliente, en `electron/memory-merge.ts` y
`electron/memory-store.ts`. El servidor no vuelve a decidir nada de eso: guarda, ordena y
devuelve.

**Arranca sirviendo a una sola cuenta, la del dueño, pero se diseña multi-tenant desde la
primera línea.** Abrirlo a usuarios reales tiene que ser cambiar una fila en una tabla, no
reescribir el servicio. La sección 9 define exactamente qué gatea eso y la 12 qué tiene que
ser verdad antes de tocarlo.

## 2. Restricciones de base

1. **El modelo de sync no se rediseña.** `memory-merge.ts` implementa un LWW determinista
   (mayor `updatedAt`, luego mayor `lamport`, luego mayor `syncId` lexicográfico) que todas
   las réplicas computan igual e independientemente. Adoptar Turso, Electric, CR-SQLite o
   Automerge significa tirar ese archivo y reescribir la parte de más riesgo por línea del
   sistema. No se hace.
2. **El servicio corre en cualquier lado.** Un contenedor y un Postgres. Eso permite mudar
   de plataforma cuando el costo lo justifique, y convierte el self-hosted que pide el tier
   enterprise en un `docker compose up` en vez de un proyecto aparte.
3. **Nada de esto toca `electron/memory-store.ts` ni `memory-merge.ts`.** Los cambios de
   cliente que sí hacen falta están acotados en la sección 10 y son de `memory-daemon.ts`,
   `main.ts` y la UI.
4. **El servidor viejo tenía dos bugs de diseño que no se portan**: rechazaba la colisión de
   topic en vez de resolverla, y no aceptaba `content` nulo, con lo cual los tombstones
   nunca replicaban. Los dos se arreglan acá (sección 8).

## 3. La forma medida de la carga

Todo el dimensionamiento sale de dos mediciones, no de estimaciones.

**Corpus real** (`OneDrive/nest-memory`, el usuario más pesado que va a existir, seis meses):
530 memorias, 3.007.922 bytes de markdown, 1212 secciones, 11 proyectos.

**Benchmark contra Postgres** (PGlite, 5000 observaciones con la distribución de tamaños del
corpus real, schema y consultas de esta spec):

| Medición | Valor |
|---|---|
| Bytes en disco por observación, índices incluidos | 1506 B |
| Contenido crudo promedio | 3407 B (Postgres lo comprime 2,3x) |
| Push, batches de 50 | 1465 observaciones/segundo |
| Pull incremental con cursor, 11 proyectos | 52 ms |
| Pull vacío, que es lo que devuelve el 99% de los syncs | 0,319 ms |

Proyección: **1,8 MB por usuario pesado**, 18 GB para diez mil. El almacenamiento no es el
costo. El costo es el goteo constante: cada device pide sync cada 5 minutos, o sea 8640
requests por mes, y casi todos vuelven vacíos. Por eso la sección 11.4 hace que el intervalo
lo controle el servidor.

## 4. Arquitectura

```
Nest (Electron)                        Servicio de sync                 Postgres
┌────────────────────┐                ┌──────────────────┐            ┌──────────────┐
│ MemoryStore        │                │ POST /v1/sync/   │            │ users        │
│  (SQLite + FTS5)   │                │      push        │            │ devices      │
│  mutation_log ─────┼── push ───────▶│      pull        │───────────▶│ projects     │
│                    │◀── pull ───────│      status      │            │ observations │
│ MemoryDaemon       │                │                  │            │ allowlist    │
│  LWW + lamport     │                │ auth por token   │            └──────────────┘
└────────────────────┘                └──────────────────┘
                                       un contenedor, sin estado
```

El servicio no tiene estado propio: todo vive en Postgres, así que escala horizontal sin
coordinación y se reinicia sin ceremonia. Node con el runtime que ya usa el repo, sin
framework pesado.

## 5. El contrato de wire

Sacado del cliente actual, no inventado. Lo que sigue es lo que `memory-daemon.ts` ya manda y
ya espera, así que el servicio se puede probar contra un cliente sin modificar.

### 5.1 `POST /v1/sync/push`

```jsonc
// request
{
  "device_id": "uuid",
  "mutations": [
    { "seq": 41, "sync_id": "obs_...", "op": "upsert",   // op ∈ upsert | delete
      "payload": { /* la fila entera de observations, snake_case, más project_display_name */ } }
  ]
}
// response
{ "results": [ { "sync_id": "obs_...", "outcome": "applied", "project_seq": 128 } ] }
```

`outcome` es `applied`, `superseded` o `rejected`. El cliente marca como pushed tanto las
aceptadas como las rechazadas (una rechazada guarda el `error` y no se reintenta para siempre),
y **deja en la cola las que no aparecen en `results`**. O sea: omitir una mutación es la forma
correcta de decir "no la procesé, mandámela de nuevo". Un rechazo es terminal y hay que usarlo
sólo cuando reintentar no puede funcionar.

Tope de batch del cliente: 200 mutaciones. El servicio acepta hasta 500 y responde 413 arriba
de eso.

**Idempotencia**: un reintento del mismo `(device_id, seq)` no vuelve a aplicar nada, devuelve el
`outcome` que quedó guardado en `push_receipts`. Hace falta porque el cliente reintenta cualquier
mutación que no aparezca en `results`, y una respuesta perdida en la red es indistinguible de una
mutación no procesada.

### 5.2 `POST /v1/sync/pull`

```jsonc
// request
{ "cursors": { "<project_key>": 128 }, "limit": 500 }
// response
{ "rows": [ { "sync_id": "...", "project_key": "...", "project_seq": 129,
              "client_updated_at": "2026-08-31T18:00:00Z", "lamport": 44,
              "scope": "personal", "type": "decision", "topic_key": null,
              "title": "...", "content": "...", "tags": ["a","b"],
              "deleted": false, "superseded_by": null,
              "origin_ai": "claude", "origin_account": "...", "git_branch": "...",
              "author_display": "...", "content_hash": "..." } ],
  "cursors": { "<project_key>": 129 } }
```

Tres cosas que el servidor está obligado a cumplir y que el servidor viejo no cumplía:

- **`project_key` en cada fila.** El cliente mapea por clave, no por id, y no hace lookup.
- **`tags` viaja como array JSON de verdad.** Hoy el store lo guarda como string JSON, el
  servidor lo mete en una columna jsonb y vuelve como string, y el cliente descarta todo lo que
  no sea `Array`, así que los tags se pierden en cada round trip. El servicio parsea al entrar
  y devuelve array al salir.
- **`client_updated_at` es el timestamp del cliente, no el del servidor.** El cliente acepta
  número epoch o ISO 8601. Se guarda aparte de `server_created_at`, que es de auditoría.

### 5.3 `GET /v1/sync/status`

Devuelve `{ device_id, user_id, plan, next_poll_ms, server_time, quota: { used_bytes, max_bytes },
projects: [{ project_key, display_name }] }`.

Existe por tres razones: es el health check del device (hoy la UI no tiene forma de diagnosticar
nada), es donde el servidor le dice al cliente cada cuánto volver (sección 11.4), y — agregado el
2026-09-01 — **es el único lugar donde un device puede enterarse de que un proyecto existe**.

### 5.3.1 Descubrimiento de proyectos — el agujero que hace que un device nuevo no reciba nada

**Encontrado el 2026-09-01, después de construir el servicio.** El pull sólo devuelve filas de los
proyectos cuyo cursor el device mandó, y eso es correcto: el servidor viejo iteraba todos los
proyectos de la cuenta y defaulteaba a 0 los no enviados, lo que hacía que el cliente entrara en un
hot loop re-puleando la misma página para siempre (es el fix M25 de `memory-daemon.ts`).

Pero el cliente arma esos cursores desde `store.listProjects()`, o sea desde lo que **ya** tiene
local, y `doPull` arranca con `if (projects.length === 0) return`. Las dos cosas juntas dan:

- **Un device recién instalado no pulea NADA, nunca**, hasta que el usuario escriba algo local que
  cree la primera fila de `projects`. No hay error, no hay síntoma: la card dice "connected" y no
  baja una sola memoria.
- **Un proyecto que sólo existe en la otra máquina no cruza jamás**, aunque las dos estén
  sincronizando bien todo lo demás.

El round trip de §13 pasa igual porque las dos máquinas del test ya tienen los mismos repos abiertos
y por lo tanto los mismos `project_key` derivados del remote de git.

**La solución no puede ser que el pull devuelva proyectos no pedidos**, porque eso es exactamente el
hot loop que M25 arregló. Va separada: **el status devuelve el ROSTER — sólo claves y nombres, sin
filas.** El cliente hace `ensureProject()` de las que no conoce, y en el pull siguiente esas claves
viajan en `cursors` de forma natural, en 0. Ninguna fila se devuelve sin cursor pedido, así que la
garantía de M25 se mantiene intacta.

Eso obliga a algo que igual había que hacer: **el daemon tiene que llamar a `status`**, cosa que hoy
no hace. Hasta el 2026-09-01 el endpoint no tenía un solo caller, y por lo tanto `next_poll_ms` — la
única palanca de costo real que tiene este diseño, la razón por la que el intervalo lo manda el
servidor — se calculaba y nadie la leía. Los dos huecos se cierran con el mismo cambio.

### 5.4 Compatibilidad para el bring up

El cliente hoy pega contra `{base}/functions/v1/memory-sync/{push,pull}`, que es la forma de
Supabase. El servicio **sirve esas dos rutas como alias** de las de arriba. Eso permite levantar
el backend y probarlo contra un Nest sin recompilar, y se borra cuando el cliente cambie la URL.

### 5.5 El borrado de datos de nube — agujero de esta spec, hay que cerrarlo

**Agregado el 2026-09-01, encontrado en el review final del plan de cliente.** Las §5.1 a §5.3
definen push, pull y status, y nada más. Pero el cliente tiene una cuarta llamada que nadie
enumeró: `memory:disconnect` postea a `{base}/functions/v1/memory-sync/delete-cloud-data`
(`electron/main.ts:2716`) cuando el usuario desconecta pidiendo borrar la copia de nube. Es el
"derecho al borrado" de §6.6 y §7.5 del doc de arquitectura, o sea un requisito, no un extra.

Verificado con grep: es **la única** ruta con forma de Supabase que queda en el cliente después
del C4.

Esto es un **release blocker con fecha de activación**: el día que `syncBaseUrl` apunte fuera de
Supabase, esa llamada pega contra un host que no la sirve y el borrado se rompe **en silencio**,
que es exactamente la clase de falla que esta spec existe para eliminar. No se migró del lado
cliente a propósito: no hay endpoint definido al cual migrarla, e inventar el contrato del
servidor desde el cliente sería adivinar.

**El servicio nuevo tiene que hacer una de las dos, y decidirlo antes de la primera release:**

1. Definir `POST /v1/sync/delete-data` (o el nombre que sea) y migrar el cliente en la misma
   release. Es lo correcto.
2. Servir `/functions/v1/memory-sync/delete-cloud-data` como alias, igual que §5.4 hace con push
   y pull, y migrarlo después.

Lo que **no** es una opción es dejarlo como está y mover `syncBaseUrl`.

## 6. Schema

Multi-tenant desde el día uno: `user_id` en todo, aunque hoy haya una sola fila.

```sql
create table users (
  id            uuid primary key,
  email         text,
  plan          text not null default 'free',
  created_at    timestamptz not null default now()
);

create table devices (
  id            uuid primary key,
  user_id       uuid not null references users(id) on delete cascade,
  name          text not null,              -- hostname real, no navigator.platform
  platform      text,
  token_hash    text not null,              -- sha256 del token, nunca el token
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);
create index devices_by_user on devices (user_id) where revoked_at is null;

create table projects (
  id            bigserial primary key,
  user_id       uuid not null references users(id) on delete cascade,
  project_key   text not null,
  display_name  text not null,
  seq_counter   bigint not null default 0,  -- ver sección 7
  unique (user_id, project_key)
);

create table observations (
  sync_id           text primary key,
  project_id        bigint not null references projects(id) on delete cascade,
  project_seq       bigint not null,
  scope             text not null,          -- personal | project | team
  type              text not null,
  topic_key         text,
  title             text not null,
  content           text,                   -- NULLABLE: un tombstone nulea el content
  tags              jsonb,
  content_hash      text,
  origin_ai         text,
  origin_account    text,
  git_branch        text,
  author_id         uuid not null references users(id),
  author_display    text,
  lamport           bigint not null,
  client_updated_at timestamptz not null,
  client_created_at timestamptz not null,
  server_created_at timestamptz not null default now(),
  deleted           boolean not null default false,
  superseded_by     text,
  unique (project_id, project_seq)
);

-- el slot activo de un topic: un solo dueño vivo por (proyecto, scope, topic)
create unique index obs_topic_uniq on observations (project_id, scope, topic_key)
  where topic_key is not null and superseded_by is null and deleted = false;

-- el índice que sirve al pull por cursor (verificado: Index Scan, 3 buffers)
create index obs_pull on observations (project_id, project_seq);

create table push_receipts (              -- idempotencia de reintentos
  device_id  uuid not null references devices(id) on delete cascade,
  seq        bigint not null,
  sync_id    text not null,
  outcome    text not null,
  created_at timestamptz not null default now(),
  primary key (device_id, seq)
);

create table allowlist (                  -- sección 9
  user_id    uuid primary key references users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
```

`source_ref` **no entra**. Hoy el cliente lo manda en el payload (lleva paths absolutos con el
nombre real del usuario) y el servidor viejo ni lo guardaba: viajaba y se tiraba. El servicio lo
descarta explícitamente al entrar, y el cliente deja de mandarlo (sección 10).

## 7. `project_seq`: por qué no un bigserial global

El cursor del pull es `project_seq > n`. Eso obliga a que la secuencia sea **monótona y sin
agujeros visibles** dentro de un proyecto.

Un `bigserial` global no sirve, y el modo de falla es silencioso: las secuencias en Postgres se
consumen fuera de transacción, así que dos transacciones concurrentes pueden commitear 105 antes
que 104. Un cliente que pulea justo en el medio ve 105, avanza el cursor, y **la fila 104 no se
pulea nunca**. Es exactamente la clase de pérdida silenciosa que ya nos costó tres bloqueantes.

La asignación es por rango, un lock de fila por batch:

```sql
update projects set seq_counter = seq_counter + $n where id = $1 returning seq_counter;
-- el batch usa [seq_counter - n + 1 .. seq_counter], y el insert va en la MISMA transacción
```

Un solo `UPDATE` por push, no uno por observación. Serializa los push del mismo proyecto, que es
correcto y barato: un proyecto tiene un puñado de devices, no miles. Medido en el benchmark: 1465
observaciones por segundo con batches de 50.

## 8. Los dos arreglos que el servidor viejo no hacía

### 8.1 Colisión de topic: superseder, no rechazar

El diseño declara append first: nada se descarta nunca. El servidor viejo hacía un INSERT plano
contra `obs_topic_uniq`, la segunda memoria volvía `rejected`, el cliente la marcaba pushed y no
la reintentaba más. Resultado: las dos máquinas quedaban mostrando memorias distintas para el
mismo topic, para siempre.

El servicio aplica la misma regla que el cliente, dentro de la transacción del push:

1. Buscar el dueño activo del topic `(project_id, scope, topic_key)`.
2. Si no hay, insertar normal.
3. Si hay, resolver con la regla LWW (mayor `client_updated_at`, luego mayor `lamport`, luego
   mayor `sync_id`).
4. Si gana el entrante: `update` del viejo con `superseded_by = <entrante>`, después insertar.
   Outcome `applied`.
5. Si gana el existente: insertar el entrante ya con `superseded_by = <existente>`. Outcome
   `superseded`. **Nada se pierde**, y el cliente aprende cuál ganó porque la fila supersedida
   vuelve en el pull.

### 8.2 Tombstones

`content` es nullable. Un `op: "delete"` escribe `deleted = true` y `content = null`, y el pull
lo devuelve como cualquier otra fila. Borrar cruza de una máquina a otra.

El servicio **lee `op`**, cosa que el viejo nunca hacía: la distinción entre upsert y delete no
existía del lado servidor.

## 9. Tenancy, auth y el interruptor

### 9.1 Ahora: una cuenta

- El token de device se genera con `openssl rand` y se pega a mano en Settings. El servicio
  guarda sólo el `sha256`.
- No hay flujo de login, no hay emisión de credenciales, no hay dependencia de ningún proveedor
  de identidad. **Esta es la razón por la que arrancar con una cuenta es barato de verdad**: la
  parte cara del backend viejo era la emisión del token, y acá no existe todavía.
- El `allowlist` arranca con una fila. Un push o un pull de un `user_id` que no está en la tabla
  responde 403 `not_in_beta`.

### 9.2 Cuando se abra: sin reescribir nada

El único camino nuevo es la emisión del token, y es aditivo: `POST /v1/devices` recibe el JWT del
login que Nest ya tiene, verifica la firma, crea la fila en `devices` y devuelve el token una sola
vez. Todo lo demás (auth por token, tenancy por `user_id`, cuotas, allowlist) ya está escrito y
ejercitado desde el día uno por la cuenta única.

Decisión que queda abierta y no bloquea: si el emisor verifica el JWT de Supabase (barato, ya
existe) o si la identidad se muda también. Se puede decidir el día que se abra.

### 9.3 El gate de plan es del servidor

Hoy `memoryCloud` se chequea en el renderer, que es un release blocker viejo de integrations. El
servicio chequea `users.plan` en cada push y responde 403 `plan_required`. El cliente ya sabe
distinguir ese caso si se lo damos con un código propio, y ahí se cuelga el botón de upgrade que
hoy no existe (P-13).

## 10. Los cambios del lado del cliente

Sin esto el backend nuevo no sirve de nada. Ordenados por lo que bloquea.

| # | Cambio | Archivo | Por qué |
|---|---|---|---|
| C1 | Separar `memoryLocalEnabled` de `connected` | `main.ts`, `pty-manager.ts`, `account-store.ts` | Hoy sin nube no se captura nada, y la UI del plan free miente. Es lo que hace que la memoria local exista para todos |
| C2 | Colisión de topic en el pull apply | `memory-daemon.ts` | Cuando la fila entrante gana, hay que supersedir la local antes de insertar. Hoy explota y **congela el cursor de todos los proyectos del device** |
| C3 | Versionado de `migrate()` | `memory-store.ts` | `PRAGMA user_version` más pasos idempotentes. Sin esto no hay camino para ningún cambio de schema después de la release |
| C4 | URL configurable y rutas nuevas | `memory-daemon.ts` | Hoy la base es build time y las rutas tienen forma de Supabase |
| C5 | `tags` como array, y dejar de mandar `source_ref` | `memory-daemon.ts` | Los tags se pierden en cada round trip; `source_ref` filtra paths absolutos |
| C6 | Timeout y `AbortSignal` en los dos fetch | `memory-daemon.ts` | Un backend colgado deja el daemon trabado hasta reiniciar la app, porque el dedupe de in flight cachea una promesa que nunca resuelve |
| C7 | Token pegado a mano en la card, y estado `unavailable` | `useMemory.ts`, `SettingsPanel.tsx` | Reemplaza el Connect contra la edge function; y con el subsistema caído la card hoy se disfraza de sana |
| C8 | Nombre de device real | `main.ts` | `navigator.platform` da `Win32` en las dos PCs y el servidor las colapsa en una |

**Los ocho son nuestros.** El contrato del 26-ago (`docs/MEMORY_INTEGRATIONS_CONTRACT.md`) nos
prohibía tocar `electron/memory-*.ts` para no pisarle trabajo a Bauti mientras su rama estaba viva.
Verificado el 2026-09-01: `feat/nest-memory-phase1` entró entera en `smoke/memory-bridge` (0 commits
afuera), su último commit es de Gero, y Bauti no toca un archivo de memoria desde el 1 de agosto.
No hay con qué conflictuar, así que la regla venció. Queda la cortesía de avisarle que tomamos el
subsistema, que no bloquea código.

## 11. Operación

### 11.1 Deploy
Railway, un proyecto con dos servicios: el contenedor y Postgres. Deploy desde git. El mismo
`Dockerfile` corre en Hetzner y en la máquina de un cliente enterprise.

### 11.2 Migraciones de schema
SQL numerado en `server/migrations/`, aplicado al arrancar dentro de una transacción con lock de
advisory. Sin ORM.

### 11.3 Backups
Dump diario a almacenamiento externo, retención 30 días, y **una restauración probada antes de
abrir a usuarios**. Un backup que nunca se restauró no es un backup.

### 11.4 El intervalo lo manda el servidor
`next_poll_ms` en la respuesta de `status` y de `pull`. Es la única palanca de costo que tenemos:
el 99% de los pulls vuelven vacíos, y hoy el intervalo está clavado en 5 minutos del lado del
cliente. Con esto se puede aflojar a 15 o 30 minutos sin actualizar a nadie, y apretarlo cuando
hay actividad.

### 11.5 Observabilidad
Hoy es cero: `mutation_log.last_error` no tiene un solo lector. Mínimo para abrir: log
estructurado de cada rechazo con motivo, contador de push/pull por device, y una consulta que
liste devices con mutaciones rechazadas.

### 11.6 Límites
Cuota por usuario en bytes (rechazo con `quota_exceeded`, no borrado silencioso), tope de 1 MB por
observación, rate limit por device, y purga de tombstones más viejos que la ventana de retención.

## 12. Qué tiene que ser verdad para abrir a usuarios

Esta es la lista que convierte el beta de una persona en un producto. Ninguno es opcional.

1. C1 a C8 shippeados, y los tests de memoria corriendo en CI (hoy nunca corrieron).
   **Estado al 2026-09-01**: C1, C2, C3, C5 hechos; C4, C6, C7, C8 parciales — el detalle y la
   razón de cada parcial están en el review final del plan de cliente. La suite pasó de 41 tests
   que no podían ni ejecutarse a 198 verdes.
2. **El endpoint de borrado de nube resuelto** (5.5). Es la única llamada del cliente que la spec
   nunca definió, y se rompe en silencio el día que `syncBaseUrl` se mueva.
3. Emisión de token contra el login (9.2) y gate de plan server side (9.3).
4. Backup restaurado en una prueba real.
5. Rate limits y cuotas activas.
6. Observabilidad de rechazos.
7. Un mes de datos del beta de una cuenta: bytes reales, requests reales, costo real por usuario.
8. Prueba de carga a 100x el tráfico medido.

## 13. Testing

- **Unit del servicio**: resolución de colisión en las cuatro combinaciones, tombstone, rangos de
  `project_seq`, idempotencia por `(device_id, seq)`, allowlist, cuota.
- **Integración contra Postgres real en Docker**: el benchmark de esta spec corrió en PGlite, que
  es de una sola conexión. La asignación por rango **hay que verificarla con conexiones peleando
  de verdad**: N clientes pusheando al mismo proyecto no pueden producir un hueco ni un duplicado
  en la secuencia.
- **Round trip contra el cliente real**: dos instancias de Nest con `~/.raven-nest` distintos
  contra el mismo servicio, verificando que una memoria escrita en A aparece en B, que un borrado
  cruza, y que una colisión de topic deja las dos filas con el mismo ganador de los dos lados.
- **El caso que hoy rompe**: dos devices escriben el mismo `topic_key` offline y sincronizan. Es
  el walkthrough §4.6 del doc de arquitectura y es lo primero que va a pasar entre tu PC y tu Mac.

## 14. Qué queda afuera

Memoria de equipo (el schema la contempla con `scope`, el flujo de promoción no existe), el
dashboard de memoria, el vault markdown, la captura pasiva de PTY, y el backend configurable por
el usuario. Todos tienen lugar reservado en el schema o en la config, ninguno se construye acá.

## 15. Riesgos

| Riesgo | Mitigación |
|---|---|
| El beta de una cuenta esconde problemas de concurrencia | La prueba de integración con Postgres real y conexiones concurrentes es obligatoria, no opcional |
| Mudar de plataforma después duele | El contenedor y `pg_dump` son la única superficie; nada de la lógica vive en la plataforma |
| El cliente y el servidor divergen en la regla LWW | La regla se implementa una sola vez en el servidor **portando el archivo del cliente**, con los mismos casos de test |
| Rechazos silenciosos como los de hoy | Un rechazo es terminal por contrato, así que sólo se usa donde reintentar no puede funcionar; todo lo demás se omite de `results` y se reintenta |

## 16. Decisiones abiertas

1. ~~El contrato de no invasión con Bauti.~~ **Cerrada el 2026-09-01**: la rama está mergeada y él
   no toca memoria desde el 1 de agosto. Los ocho cambios de cliente son nuestros (ver §10).
2. **Identidad cuando se abra** (9.2), sin apuro.
3. **Retención de tombstones y de prompts**, que toca schema y conviene cerrarla antes de la
   primera release.
