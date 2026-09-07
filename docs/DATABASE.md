# Nest Memory — tablas de Supabase

Este documento describe las tablas del sistema de memoria persistente de Raven Nest
("Nest Memory") en el schema `public` de Supabase (Postgres). Nest Memory es local-first:
las observaciones se guardan primero en SQLite local (`~/.raven-nest/memory/memory.db`) y
un daemon las sincroniza con Supabase (push/pull incremental). Generado a partir de la
migración `supabase/migrations/20260730000000_nest_memory.sql` y verificado contra el
schema real corriendo en el stack local de Supabase (Docker).

Todas las tablas tienen RLS habilitado. Los gates de plan de Nest Memory usan
`ARRAY['pro','team','enterprise']` (a diferencia del resto del schema, que aún no incluye
`'enterprise'` — ver hallazgos al final).

---

## Visión general del flujo

1. El usuario conecta la memoria desde Settings → se emite un token de dispositivo
   (`nmk_...`) vía la edge function `memory-token` y se registra el dispositivo
   (`memory_devices` + `memory_tokens`).
2. El daemon local (`electron/memory-daemon.ts`) empuja mutaciones encoladas a la edge
   function `memory-sync`, que resuelve el Bearer `nmk_...` a un `user_id` y llama RPCs
   `SECURITY DEFINER` (`memory_sync_push` / `memory_sync_pull`).
3. Las observaciones se particionan por proyecto (`memory_projects`) y llevan un scope
   (`personal` / `project` / `team`) que controla su visibilidad.
4. El pull incremental usa cursors por proyecto (`project_seq`), garantizando que ningún
   dispositivo se pierda filas.
5. Compartir con el equipo es siempre una acción manual: promoción de scope
   (`memory_promotions`) y share explícito del proyecto (`memory_project_shares`).

---

## `memory_projects`

Un proyecto de memoria (normalmente un repo/carpeta local) para el cual el usuario guarda observaciones.

| Columna | Significado |
|---|---|
| `owner_id` | Dueño del proyecto. |
| `project_key` | Identificador estable del proyecto en el cliente (único por owner: `UNIQUE (owner_id, project_key)`). |
| `display_name` | Nombre legible del proyecto (el cliente lo envía en el push; sin él, la UI mostraría el hash del `project_key`). |
| `remote_url` | URL remota del repo asociado, si aplica. |
| `team_id` | Si no es `NULL`, el proyecto está vinculado a ese equipo (ver también `memory_project_shares`). |
| `seq_counter` | Contador incremental de secuencia (`project_seq`) para las observaciones de este proyecto — se incrementa atómicamente bajo un advisory lock por proyecto (`nextval_project_seq`) para que el pull por cursor nunca "salte" una fila. |

---

## `memory_observations`

Cada observación (nota/decisión/hallazgo) guardada, particionada por proyecto y con soporte de sincronización multi-dispositivo (Lamport clock + last-write-wins).

| Columna | Significado |
|---|---|
| `sync_id` | PK — id estable generado por el cliente (no es un UUID de servidor), permite idempotencia en el push. |
| `scope` | `'personal' \| 'project' \| 'team'` (CHECK). Determina visibilidad: `personal` solo el autor; `team` compartido con el equipo del proyecto vía RLS (ver nota sobre `project` en hallazgos). |
| `topic_key` | Clave opcional para "temas" evolutivos (upsert por tema en vez de crear observaciones sueltas). |
| `content_hash` | Hash del contenido, para detectar duplicados/cambios. |
| `origin_ai`, `origin_account`, `git_branch` | Metadata de contexto de dónde se generó la observación. |
| `author_display` | Nombre mostrado del autor (denormalizado). |
| `client_created_at`, `client_updated_at` | Timestamps del cliente (no del servidor) — la resolución de conflictos (`memory_sync_push`) usa `client_updated_at` como criterio primario. |
| `lamport` | Lamport clock del cliente. Criterio de desempate cuando `client_updated_at` coincide. |
| `deleted` | Borrado lógico (tombstone), no `DELETE` físico. |
| `superseded_by` | FK a otra fila `memory_observations.sync_id` — encadena una observación reemplazada por otra más nueva (ej. tras promoción de scope). |
| `project_seq` | Número de secuencia asignado por servidor dentro del proyecto, usado por el pull incremental por cursor. |
| `server_updated_at` | Timestamp de servidor de la última escritura (distinto de `client_updated_at`). |
| `topic_owner` | Columna **generada** (`GENERATED ALWAYS AS ... STORED`): `user_id` si `scope = 'personal'`, si no un UUID nulo (`00000000-...`). Existe solo para poder expresar el índice único de abajo sin que choquen los `topic_key` personales de distintos usuarios con los de scope `project`/`team`. |

**Índice único notable**: `memory_obs_topic_uniq` sobre `(project_id, scope, topic_owner, topic_key)` — garantiza un solo "tema" activo (no borrado, no reemplazado) por combinación de proyecto/scope/dueño.

**Orden de desempate LWW** (push) y de lectura (`context()`/`search()` en el daemon): `client_updated_at` → `lamport` → `sync_id`. La resolución de empates por `lamport` en las consultas de lectura fue un fix reciente (commit `2e20773`) — antes de eso, dos observaciones con el mismo `updated_at` podían ordenarse de forma no determinística.

**RLS**: `memory_obs_read` permite ver filas propias (`user_id = auth.uid()`) o, si `scope = 'team'`, filas de proyectos vinculados a un equipo donde el usuario es miembro activo.

---

## `memory_project_shares`

Registro explícito de qué `memory_projects` fueron compartidos con qué equipo (además del `team_id` directo en `memory_projects`).

| Columna | Significado |
|---|---|
| `project_id`, `team_id` | PK compuesta. |
| `shared_by` | Quién hizo el share. |

---

## `memory_promotions`

Historial de promoción manual de una observación a un scope más amplio (ej. de `personal` a `team`). Requisito de producto: la promoción a team es **siempre manual**, nunca automática.

| Columna | Significado |
|---|---|
| `sync_id` | Observación promovida (sin FK formal a `memory_observations`). |
| `from_scope`, `to_scope` | Transición de scope. |
| `by_user` | Quién promovió. |

**RLS**: solo lectura de las propias promociones (`by_user = auth.uid()`).

---

## `memory_devices`

Dispositivo/instalación de Raven Nest desde el cual se sincroniza memoria.

| Columna | Significado |
|---|---|
| `name`, `platform`, `app_version` | Identificación del dispositivo. |
| `last_seen_at` | Última vez que sincronizó. |

---

## `memory_tokens`

Tokens de autenticación por dispositivo para el daemon de sincronización (prefijo `nmk_`).

| Columna | Significado |
|---|---|
| `token_hash` | Hash del token (nunca el token en texto plano). |
| `token_prefix` | Primeros caracteres del token (`"nmk_" + 6 chars`) para mostrar en UI sin revelar el token completo. |
| `minted_epoch` | Snapshot de `profiles.memory_token_epoch` al momento de emitir el token. El backend compara este valor contra el epoch actual en cada llamada; si no coincide (porque el usuario perdió acceso a un equipo), el token se considera inválido y debe re-emitirse — sin necesidad de una lista de revocación explícita. |
| `expires_at`, `revoked_at` | Expiración/revocación del token. |

**RLS**: solo permite `SELECT` de las filas propias, pero **nunca expone `token_hash`** — para eso existe la vista `memory_tokens_public`.

Columnas relacionadas en `profiles`: `memory_token_epoch` (contador que invalida tokens en
masa al perder acceso a un equipo) y `memory_plan_lapsed_at` (timestamp de cuándo el plan
cayó por debajo de pro/team, para un futuro job de purga por retención, aún no
implementado).

---

## `memory_tokens_public` (VIEW)

Vista de solo lectura sobre `memory_tokens` que excluye `token_hash`. Existe para que el cliente pueda listar sus dispositivos/tokens (prefijo, fechas) sin que el hash del token viaje nunca a través de PostgREST. Definida con `security_invoker = true` (Postgres 15+): sin esto, una vista corre con los privilegios del *dueño* de la vista (semántica "security definer" implícita) y podría saltarse por completo la RLS de `memory_tokens`, exponiendo dispositivos de otros usuarios. Con `security_invoker`, la vista respeta la RLS de la tabla base para el usuario que consulta; el `WHERE user_id = auth.uid()` explícito en la vista es una segunda capa de defensa, no un sustituto de la RLS subyacente.

**Columnas expuestas**: `id, user_id, device_id, token_prefix, created_at, last_used_at, expires_at, revoked_at`.

---

## Funciones / RPCs relevantes

No son tablas, pero son parte del contrato de seguridad de Nest Memory:

- `memory_effective_plan(user_id)` — resuelve el plan efectivo considerando el trial de 15 días (trial activo cuenta como `'team'`); prioriza `'enterprise'` si el usuario ya lo es. Evita que usuarios en trial queden con caps de plan `'free'`.
- `memory_sync_push` / `memory_sync_pull` / `memory_sync_bootstrap` / `memory_resolve_project` — RPCs `SECURITY DEFINER` que implementan el push/pull; toda la autorización de plan y de scope de equipo vive ahí, no en RLS de tabla, porque las llama la edge function `memory-sync` con la service role tras resolver el Bearer `nmk_...` a un `user_id`.
- `memory_delete_all_user_data(user_id)` — borra solo las observaciones/proyectos propios del usuario (soporte de "derecho al olvido"); nunca borra contenido de scope `team` aportado por otros miembros.
- `nextval_project_seq(project_id)` — incrementa `seq_counter` bajo advisory lock por proyecto para asignar `project_seq` sin huecos ni saltos en el pull por cursor.

---

## Hallazgos no obvios

- **`scope = 'project'` no amplía visibilidad vía RLS**: solo `scope = 'team'` es tomado en cuenta por la política `memory_obs_read` para compartir con otros miembros del equipo. Una observación con `scope = 'project'` sigue siendo visible solo para su autor a nivel de base de datos, aunque el proyecto esté vinculado a un equipo (`memory_projects.team_id`) — la distinción entre "proyecto compartido" y "observación de scope project" no es simétrica.
- **Enterprise no está uniformemente habilitado en el resto del schema**: solo las tablas `memory_*` incluyen `'enterprise'` en los gates de plan (commit `555a778`). Los gates de `teams`, `shared_snippets`, `shared_workspaces`, `shared_mcp_configs` y `user_repos` siguen con `ARRAY['pro','team']` (o `ARRAY['team']`), por lo que un usuario `enterprise` hoy solo puede usar Nest Memory. Verificado contra `pg_policies` en la DB local (2026-07-31); pendiente de decidir si se propaga.
- **`topic_owner` es una columna generada** solo para poder expresar un índice único parcial que trata scope `personal` distinto de `project`/`team` (que comparten un UUID "nulo" ficticio como `topic_owner`). Es una técnica no obvia para modelar "unicidad condicional según otro campo" en Postgres.
