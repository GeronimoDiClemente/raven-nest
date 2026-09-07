# Memory Vault — diseño

> Rama: `feat/integrations`
> Fecha: 2026-08-26
> Contrato con la rama de memoria: `docs/MEMORY_INTEGRATIONS_CONTRACT.md`
> Spec hermano: `docs/superpowers/specs/2026-08-26-memory-bridge-design.md`

## 1. Qué es

La proyección de las observaciones del store a una carpeta de archivos `.md` con
wikilinks `[[...]]`, en formato que Obsidian entiende nativo. Un archivo por
observación, una carpeta por proyecto, y la procedencia completa en el frontmatter.

Sirve dos propósitos que no se pisan:

1. **Producto**: el usuario abre su memoria con Obsidian y tiene graph view, backlinks,
   búsqueda full-text y plugins sin que nosotros construyamos nada. Es la vista de grafo
   del punto 3 de `MEMORY_INTEGRATIONS_CONTRACT.md` §7, gratis, antes de decidir cuánto
   invertir en una propia.
2. **Comercial**: es la prueba *verificable* de "tu memoria es tuya y te la podés llevar".
   No es una promesa en la landing, es una carpeta que el usuario puede abrir, `grep`ear,
   copiar a un pendrive y leer dentro de diez años sin Nest instalado. Es el argumento
   contra "no dejo mi contexto en una caja negra", y ningún competidor de los ocho de la
   lista lo tiene.

**Alcance**: solo la proyección. El puente (quién escribe las observaciones) es el spec
hermano. La vista de grafo propia sigue siendo condicional a que midamos si la gente
efectivamente abre esto con Obsidian.

## 2. Restricciones de base

Las mismas del puente, más dos propias:

- **Cero modificaciones a `electron/memory-*.ts`**, a la migración de Supabase y a las
  edge functions. Todo lo nuestro vive en `electron/integrations/` y en archivos nuevos.
- **Ninguna tabla nueva dentro de `memory.db`.** El estado del vault vive en archivos
  nuestros.
- **One-way en v1.** El store es la fuente de verdad; los `.md` son espejo. Editar un
  archivo a mano no vuelve al store. §10 define cómo se comunica y cómo se evita que el
  usuario pierda trabajo por sorpresa.
- **El vault es portable por diseño**, así que hay que asumir que sale de la máquina
  (zip, Dropbox, un repo privado). Todo lo que decidimos escribir se decide con esa
  suposición, no con "igual es local". §8.

## 3. Arquitectura

### 3.1 El puerto de lectura, ampliado

El puente definió `MemoryReader` con un solo método
(`2026-08-26-memory-bridge-design.md` §3.1):

```ts
export interface MemoryReader {
  listForProject(projectKey: string, opts?: { includeSuperseded?: boolean }): ObservationSummary[]
}
```

**No alcanza, y el motivo es concreto**: `ObservationSummary`
(`memory-protocol.ts:72`) es lo que devuelve `toSummary()` (`memory-store.ts:399`) y
lleva únicamente `syncId`, `title`, `content`, `type`, `topicKey`, `tags`, `updatedAt`,
`originAi` y `gitBranch`. No lleva `source`, `source_ref`, `scope`, `created_at`,
`project_key`, `superseded_by`, `deleted`, `revision_count`, `duplicate_count`,
`origin_account` ni `author_display` — es decir, **casi toda la procedencia**, que es
justamente lo que el frontmatter tiene que llevar y lo único que Obsidian no puede
inferir del texto.

Ampliación propuesta, en el spec del puente §3.1 (no una vía paralela):

```ts
// electron/integrations/memory-port.ts

/** Proyección completa de una fila de `observations`. Superset de ObservationSummary. */
export interface MemoryRecord {
  syncId: string
  projectKey: string
  scope: 'personal' | 'project' | 'team'
  topicKey: string | null
  type: ObservationType
  title: string
  content: string | null          // null = tombstone (deleteObservation nulea el content)
  tags: string[]
  source: 'mcp' | 'hook' | 'pty' | 'import' | 'ui'
  originAi: string | null
  originAccount: string | null
  gitBranch: string | null
  authorDisplay: string | null
  contentHash: string
  revisionCount: number
  duplicateCount: number
  createdAt: number
  updatedAt: number
  deleted: boolean
  supersededBy: string | null
}

export interface MemoryProject {
  projectKey: string
  displayName: string
  /** Sólo el segmento `org/repo` del remote, nunca la URL completa. Ver §4.2. */
  remoteSlug: string | null
  enrolled: boolean
}

export interface MemoryReader {
  listForProject(projectKey: string, opts?: { includeSuperseded?: boolean }): ObservationSummary[]

  // Nuevos, para el vault:
  listProjects(): MemoryProject[]
  /** TODAS las filas del proyecto, incluidos superseded y tombstones. `since` filtra por updated_at. */
  listRecords(projectKey: string, opts?: { since?: number }): MemoryRecord[]
  /** Watermark barato para decidir si hace falta regenerar. Ver §7. */
  watermark(projectKey: string): { maxUpdatedAt: number; count: number }
}

export const NULL_READER: MemoryReader = { /* devuelve [] / ceros */ }
```

`listProjects()` y `listRecords()` **no existen en el store** y no se los vamos a pedir a
Bauti: se implementan del lado nuestro contra un handle propio (§3.2). El puerto es
nuestro, la implementación es nuestra, la otra rama no se entera.

### 3.2 El handle readonly

El contrato §3.1 ya dejó abierta esta opción explícitamente ("que nos digas que abramos un
handle `readonly: true` aparte y hagamos el query nosotros"). La tomamos.

```ts
// electron/integrations/memory-readonly-reader.ts  (archivo nuestro)
new Database(join(ravenHome(), '.raven-nest', 'memory', 'memory.db'),
             { readonly: true, fileMustExist: true })
```

- El store abre con `journal_mode = WAL` (`memory-store.ts:206`), que admite N lectores
  concurrentes con un escritor. El daemon escribe, nosotros leemos, nadie se bloquea.
- Vive en el **mismo proceso** (Electron main) que el `MemoryStore` real
  (`main.ts:201`), así que ni siquiera hay contención entre procesos.
- **Modos de falla y degradación** (ninguno rompe la app):
  - `memory.db` no existe (la otra rama no está mergeada, o memoria nunca se usó) →
    `fileMustExist: true` tira, se captura, el reader queda en `NULL_READER` y el vault
    reporta "memoria no disponible".
  - Un handle readonly necesita poder mapear el `-shm`; si el archivo está en un FS de
    solo lectura, falla. Se captura igual.
  - **Nunca** un `PRAGMA` de escritura, nunca `wal_checkpoint`, nunca un `ATTACH`.
    Consultas `SELECT` y nada más.
- Las tres consultas que necesitamos son las que ya tienen índice:
  `SELECT * FROM observations WHERE project_key = ? AND updated_at > ?` usa
  `idx_obs_project_updated` (`memory-store.ts:251`), y `MAX(updated_at)` por proyecto
  también. `SELECT * FROM projects` es una tabla de decenas de filas
  (`memory-store.ts:297`).

### 3.3 Dónde vive el código

Todo puro salvo el aplicador. El generador se parte en **plan** (puro) y **apply**
(efectos), igual que el resto del motor de graph:

```
MemoryRecord[]  ──planVault()──►  VaultPlan {writes, moves, deletes, conflicts}  ──applyVault()──►  disco
                    (puro)                                                            (fs)
```

`planVault()` recibe las filas y el manifiesto anterior y devuelve un objeto; no toca
disco, no importa `fs`, no importa Electron. Es el 80% de la lógica y el 100% de los bugs
posibles. §13.

## 4. Layout de la carpeta

### 4.1 La raíz

Default: **`{ravenHome()}/.raven-nest/memory-vault/`**.

Deliberadamente **fuera** de `.raven-nest/memory/`, que es el directorio de la otra rama y
donde viven `memory.db`, `connection.json`, `credential.bin` y `pipe-auth.json`
(`memory-local-auth.ts:26`, `memory-connection-state.ts:19` y `:55`). Es un requisito de
seguridad, no de prolijidad: el vault está *diseñado* para que el usuario lo comprima y se
lo lleve, y no puede haber ninguna versión de esa acción que arrastre el token del pipe y
la credencial de sync.

Configurable en `{ravenHome()}/.raven-nest/memory-vault.json` (archivo nuestro, mismo
patrón JSON validado/atómico que `graph-config.json:13` y `worker-spec-store.ts:123`):

```jsonc
{
  "version": 1,
  "enabled": false,          // opt-in, ver §7
  "root": null,              // null = el default de arriba
  "includeSuperseded": true,
  "includeTeamScope": true   // ver pregunta abierta V-2
}
```

**Validador de raíz** (`isForbiddenVaultRoot()`, puro y testeable). Se rechaza una raíz
que resuelva a, o esté dentro de:

| Prohibido | Por qué |
|---|---|
| `{ravenHome}/.raven-nest/memory/` | Contiene la credencial y el token del pipe |
| `{ravenHome}/.claude/` | Es una fuente de descubrimiento del importer (`markdown.ts:93`) |
| `{accountDir}/.claude/` (cualquiera) | Ídem (`markdown.ts:96-102`); `memory/*.md` se escanea entero |
| La raíz de cualquier repo enrolado | El importer busca `CLAUDE.md`/`AGENTS.md` ahí (`markdown.ts:105-110`) |
| Un path que ya contiene un `.git/` | El vault no es código y no se versiona por accidente |
| En Windows, una raíz de más de 120 chars | Presupuesto de path, §4.4 |

Los primeros cuatro son la defensa estructural contra el round-trip accidental (§9).

### 4.2 Carpeta por proyecto

`project_key` es `sha256(...)[0:16]` (`memory-project-key.ts:26` y `:33`): 16 chars de
hex, ilegible. Una carpeta por proyecto, nombrada:

```
{slug(nombre legible)}--{project_key[0:8]}/
```

El nombre legible se resuelve en este orden:

1. **`projects.remote_url`** → el último segmento de `org/repo`. Es el mejor nombre y
   además es estable entre worktrees.
2. **`projects.display_name`** (`memory-store.ts:299`) si no hay remote.
3. El `project_key` completo si no hay fila en `projects` (pasa: ver `__global__` abajo).

**Por qué el remote antes que el display_name, con un motivo concreto**: `display_name`
lo escribe `projectKeyForCwd()` como el último segmento del cwd
(`memory-ipc-server.ts:203`), y `ensureProject()` **sale temprano si la fila ya existe**
(`memory-store.ts:373-374`). Consecuencia real en esta máquina: todos los worktrees de
raven-nest comparten un `project_key` (sale del remote), pero el `display_name` queda
congelado con el nombre del **primer cwd que lo creó** — que puede ser `integrations` o
`nest-memory`, no `raven-nest`. Usar el remote arregla eso sin tocar nada de la otra rama.

El sufijo de 8 chars del `project_key` no es decorativo: dos repos distintos pueden
llamarse igual (`api` en dos orgs), y sin sufijo colisionarían en una sola carpeta.

`__global__` (`memory-project-key.ts:38`) es un caso especial: casi con seguridad **no
tiene fila en `projects`**, porque el único lugar que llama `ensureProject()` siempre pasa
un `rootPath`, y con `rootPath` presente `resolveProjectKey()` nunca devuelve el sentinela
(`memory-project-key.ts:41-47`). Se mapea a mano a `_global/`. El guión bajo lo ordena
primero y nunca choca con un slug (los slugs no empiezan con `_`, §4.3).

Proyectos con `enrolled = 0` (el usuario sacó ese repo de memoria) **no se espejan**, y si
tenían carpeta, se mueve entera a `_disabled/` en vez de borrarse.

```
memory-vault/
  README.md                       ← generado, ver §10
  _global/
    _index.md
    prefiere-respuestas-cortas--a1b2c3d4.md
  raven-nest--3f9a12c7/
    _index.md
    release-flow--7e21ab90.md
    stripe-webhook-rechazado-por-jwt--0c4d19fa.md
    _superseded/
      release-flow--11b7c3e0.md
  .nest-vault/                    ← Obsidian ignora los dot-dirs
    manifest.json
    tombstones.jsonl
```

### 4.3 Nombre de archivo

**`{slug(title)}--{sync_id[-8:]}.md`**, y el `sync_id` completo como *alias* en el
frontmatter.

Ni `sync_id` puro ni slug puro:

- **`sync_id` puro** (`obs-3f9a...md`) resuelve `[[obs-3f9a...]]` trivialmente, pero el
  graph view de Obsidian etiqueta los nodos con el **nombre de archivo**. Un grafo de
  10.000 nodos rotulados `obs-3f9a12c7…` es exactamente tan útil como no tener grafo. Mata
  el propósito 1 entero.
- **Slug puro** es legible pero colisiona: dos observaciones con el mismo título son
  comunes (un `topic_key` reescrito vs. su versión superseded tienen el mismo título por
  construcción, §6).

El mixto resuelve las dos cosas, y los wikilinks siguen funcionando porque **Obsidian
resuelve `[[X]]` contra el basename del archivo o contra cualquier valor de la propiedad
`aliases` del frontmatter**. Escribimos `aliases: ["obs-3f9a12c7…"]` en cada nota y
`[[obs-3f9a12c7…]]` (el formato de arista que fijó el contrato §3.3) resuelve solo, sin
tocar un byte del `content`.

Reglas del slug — **función propia, `vaultSlug()`, no la de ellos**:

- `slugify()` del chunker (`chunker.ts:19-27`) **conserva la barra**: su clase de caracteres
  es `[^a-z0-9\s/-]`, porque el `headingPath` que le entra puede tener jerarquía. Reusarla
  para un nombre de archivo crearía subdirectorios accidentales en los tres SO. No se reusa
  (y además no podríamos importarla: el vault tiene que compilar sin la otra rama).
- Salida restringida a `[a-z0-9-]`. Se cae todo lo demás, incluidos los inválidos de
  Windows `<>:"/\|?*`, los caracteres de control, y el punto y el espacio finales.
- ASCII only. Un título en japonés o con emoji produce slug vacío → se usa `untitled`.
  Motivo: macOS normaliza a NFD y Windows a NFC, y un nombre Unicode "igual" en dos
  máquinas termina siendo dos archivos distintos en una carpeta sincronizada. El título
  completo vive igual en el frontmatter y en el `# ` del cuerpo: no se pierde nada.
- Tope de 60 chars, cortando en el último guión.
- Los **nombres reservados de Windows** (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`)
  son imposibles por construcción: siempre se concatena `--{8 hex}`, así que el basename
  nunca es un nombre reservado desnudo. No hace falta una lista negra.
- **Case-insensitivity**: el slug se emite en minúsculas y el hex también, así que dos
  nombres que difieran solo en mayúsculas no pueden existir. Es lo que hace que la misma
  carpeta funcione igual en NTFS/APFS (case-insensitive) y en ext4 (case-sensitive).

**Colisiones**: el sufijo son los últimos 8 hex del `sync_id`. Una colisión requiere
*mismo slug* **y** *mismo sufijo* — a 10.000 observaciones es del orden de 1 en 10⁵, pero
tiene que ser determinista igual. Regla: entre los colisionados gana el `sync_id`
lexicográficamente menor (se queda con 8 chars) y los demás usan el `sync_id` completo. La
regla no depende del orden de inserción ni del orden de generación, así que dos máquinas
con las mismas filas producen exactamente los mismos nombres.

**Presupuesto de path en Windows**: `C:\Users\{user}\.raven-nest\memory-vault\` ≈ 45
chars, + carpeta de proyecto ≤ 50, + `_superseded\` = 12, + nombre ≤ 60+2+8+3 = 73.
Total ≈ 180, con margen sobre 260. Por eso el validador rechaza raíces custom de más de
120 chars en Windows en vez de fallar en el archivo 4.000.

### 4.4 Granularidad: un archivo por observación

Un `.md` por observación, **no** agrupado por `topic_key`. Cuatro razones, la última
decisiva:

1. **Agrupar por `topic_key` no agrupa nada.** `idx_obs_topic` (`memory-store.ts:247`) es
   `UNIQUE (project_key, scope, topic_key)` para las filas activas, y el Paso 1 de
   `save()` reescribe la fila en el lugar conservando el `sync_id`
   (`memory-store.ts:511-535`). Es decir: para las filas con topic, "un archivo por topic"
   y "un archivo por observación" son **el mismo archivo**. La agrupación no compra nada.
2. **La mayoría no tiene topic.** De las nueve formas de memoria del puente (§4 del spec
   hermano), siete usan `sourceRef` y ninguna `topicKey`. Agruparlas exigiría inventar una
   jerarquía (por tipo, por fecha) que el store no tiene.
3. **Contra el chunker**: el importer parte un archivo en `##`/`###` y cada chunk es una
   observación candidata (`chunker.ts:60-83`). La inversa exacta de "una sección = una
   observación" es "una observación = un archivo con una sección". Si agrupáramos N
   observaciones en un archivo con N secciones, la estructura round-trippearía pero la
   identidad no: el `topicKey` que el chunker deriva sale del `headingPath`
   (`chunker.ts:79`), no del `topic_key` original, y **toda observación de menos de 40
   caracteres se cae en silencio** (`chunker.ts:10` y `:73`). Con un archivo por
   observación, la identidad vive en el frontmatter y no depende de la posición de un
   heading.
4. **Los wikilinks apuntan a archivos.** El contrato §3.3 fijó `[[sync-id]]` como formato
   de arista. En Obsidian un wikilink resuelve a una *nota*: si agrupamos, `[[obs-x]]`
   apunta a un archivo que contiene diez memorias y el graph view muestra **un nodo por
   diez memorias**. Eso destruye el propósito 1. Es el argumento que cierra la discusión.

Costo: 10.000 observaciones son 10.000 archivos. Se aborda en §7, no negando el costo sino
haciendo que la pasada incremental escriba cero archivos cuando no cambió nada.

## 5. El formato de una nota

### 5.1 Frontmatter

```markdown
---
nest_sync_id: obs-3f9a12c7d4e5b6a78901234567890abc
aliases: ["obs-3f9a12c7d4e5b6a78901234567890abc"]
title: "Webhook de Stripe rechazado por JWT"
type: bugfix
scope: personal
project: raven-nest
project_key: 3f9a12c7d4e5b6a7
topic_key: null
tags: [stripe, webhook]
source: pty
source_ref: "graph:run-8812:rev-security:0"
origin_ai: claude
origin_account: "Gero Personal"
git_branch: feat/integrations
author: "Gero"
created: 2026-08-24T18:03:11.402Z
updated: 2026-08-26T11:22:40.918Z
revision_count: 3
duplicate_count: 0
superseded_by: null
supersedes: ["[[obs-11b7c3e0...]]"]
nest_content_hash: 4f3a9c...
nest_vault_version: 1
nest_generated: true
---
```

Correspondencia campo a campo con `observations` (`memory-store.ts:219-244`); todo lo que
está en la tabla y **no** está acá está deliberadamente afuera (§8). Notas:

- `created`/`updated` en ISO-8601 UTC, no en epoch-ms. El store guarda ms
  (`memory-store.ts:238-239`), pero el vault es para que lo lea una persona y Obsidian
  ordena y filtra por fechas ISO nativamente. La conversión es exacta y reversible.
- `supersedes` es **derivado**, no una columna: se calcula en la pasada de generación
  invirtiendo los `superseded_by` de todas las filas del proyecto. Da la arista en las dos
  direcciones sin schema nuevo. §6.
- `nest_content_hash` es la reimplementación de `contentHash()` (`memory-store.ts:104`):
  `sha256(title.trim().toLowerCase() + '\n' + content.trim().toLowerCase())`. Se
  reimplementa (no se importa) porque el vault tiene que compilar sin la otra rama, con un
  test de vector fijo que fija la fórmula. Es lo que hace posible la detección de ediciones
  de §10.
- **No hay campo `redacted`, a propósito.** El doc de arquitectura §6.6 dice que "la
  observación se taggea `redacted`", pero `save()` nunca agrega ese tag: el flag es un
  valor de retorno (`memory-store.ts:423`, `:616`) y no persiste en ninguna columna ni en
  `tags`. Un `redacted: false` en el frontmatter sería mentira en la mitad de los casos.
  Ver §14, hallazgo H-1.

### 5.2 Cuerpo

```markdown
# {title}

{content, byte por byte como está en el store}
```

El `content` va **verbatim**. Es la condición de que el vault sea "prueba verificable": si
lo reescribiéramos, el archivo dejaría de ser la memoria y pasaría a ser nuestra versión de
la memoria. También es lo que hace que `nest_content_hash` sirva para algo.

El `# {title}` es un `h1`, no un `##`. No es cosmético: el chunker trata `#` como título de
documento y **no** como frontera de sección (`chunker.ts:36-38`), así que una nota cuyo
`content` no tenga sus propios `##` produce **cero chunks** si alguien apunta el importer
acá. Es la mitad de la defensa de §9.

### 5.3 Aristas

- **Del contenido**: los `[[obs-...]]` que el puente ya escribe adentro del `content`
  (contrato §3.3) viajan solos y resuelven por el `aliases`.
- **De supersede**: `superseded_by: "[[obs-ganador]]"` y `supersedes: ["[[obs-perdedor]]"]`
  en el frontmatter. Obsidian cuenta los wikilinks que aparecen en propiedades del
  frontmatter como links reales: salen en el graph view y en los backlinks. Así la arista
  más importante que existe hoy en el schema queda dibujada **sin tocar el `content`**.
- **`_index.md` por proyecto**: una nota de índice con el listado de cada nota del
  proyecto, para que el vault sea navegable en herramientas que no resuelven aliases
  (Foam, Logseq). Caveat honesto en el README: en el graph view el índice es un hub
  conectado a todo; quien quiera el grafo limpio lo filtra con `-file:_index`.

## 6. Superseded y tombstones

`context()` (`memory-store.ts:672`) y `search()` (`:651`) filtran
`deleted = 0 AND superseded_by IS NULL`. Correcto para un agente, insuficiente para el
vault: **los superseded son la única relación explícita entre dos memorias que existe en el
schema** (contrato §3.1), y tirarlos sería tirar el grafo.

| Estado de la fila | Dónde va | Qué pasa con el archivo |
|---|---|---|
| `deleted=0`, `superseded_by IS NULL` | `{proyecto}/` | Se escribe/actualiza normal |
| `deleted=0`, `superseded_by` seteado | `{proyecto}/_superseded/` | Se escribe con `superseded_by: [[ganador]]`; el ganador recibe `supersedes: [...]` |
| `deleted=1` (tombstone) | — | **El archivo se borra** y se anota en `.nest-vault/tombstones.jsonl` |

**Por qué los superseded se escriben**: son versiones históricas reales con su propio
`created_at` y su propia procedencia; en Obsidian la cadena "esto lo dijo el reviewer en el
run 8812 → lo reemplazó esto otro" es navegable. Van a subcarpeta y no a la raíz del
proyecto para que la carpeta principal sea "lo que vale hoy": el usuario que abre el vault
para leer su memoria no quiere ver tres versiones de cada cosa. `_superseded/` empieza con
guión bajo y es fácil de excluir del graph view.

**Por qué el archivo se mantiene con el mismo nombre al mudarse a `_superseded/`**: los
wikilinks de Obsidian son independientes del path mientras el nombre sea único en el
vault. Mover la carpeta no rompe ni un link. Es otro punto a favor de resolver por alias
en vez de por ruta.

**Por qué el tombstone borra el archivo en vez de dejar una lápida**: `deleteObservation()`
nulea el `content` (`memory-store.ts:808`) y deja la fila. Un archivo con frontmatter y
cuerpo vacío no es una nota, es basura en el graph view. Y sobre todo: "tu memoria es tuya"
incluye "borrar es borrar". Dejar el archivo con el título puesto es el peor resultado
posible, porque **el título suele ser justamente la parte sensible** ("Credenciales del
cliente X"). El registro en `tombstones.jsonl` (`{syncId, deletedAt, file}`) es local, sirve
para que la regeneración sea idempotente y no contiene ni título ni contenido.

**Un archivo editado a mano nunca se borra ni se pisa**: la detección de ediciones de §10
corre *antes* del borrado y de la mudanza. Si el usuario editó la nota de una observación
que después se tombstoneó, el archivo se va a `_conflicts/`, no al tacho.

## 7. Cuándo se regenera

**Opt-in.** El vault está apagado hasta que el usuario lo prende (Settings → Memory →
"Mirror my memory to Markdown"). La mayoría de los usuarios no va a usar Obsidian, y no
hay ninguna razón para que paguen 10.000 archivos por una feature que no piden. El
descubrimiento va en la Connect Memory card (§8.1 del doc de arquitectura), con un botón
que en un click prende + genera + abre la carpeta: ese es el momento "probámelo" del
argumento comercial.

Cuatro disparadores, ninguno "en cada escritura":

| # | Disparador | Alcance |
|---|---|---|
| 1 | Al prender el vault, o botón **Regenerate now** | Pasada completa |
| 2 | Debounce de **5 s** después de una escritura del puente (lo sabemos: pasa por nuestro `MemorySink`) | Incremental |
| 3 | **Poll de 60 s** del watermark por proyecto | Incremental, y sólo si el watermark cambió |
| 4 | Arranque de la app, **sólo si** el vault está prendido y `manifest.rowCount !== reader.watermark().count` | Reconciliación completa |

**Por qué no en cada escritura**: un run del template `full` deja hasta diez memorias en
dos segundos (riesgo B-1 del puente). Diez pasadas seguidas es el peor caso posible.

**Por qué hace falta el poll y no alcanza con el disparador 2**: nuestro `MemorySink` sólo
ve lo que escribe el puente. Las escrituras de `mcp`, `hook` y `ui` pasan por el store sin
avisarnos, y no podemos engancharnos ahí sin tocar su código. El watermark
(`SELECT MAX(updated_at), COUNT(*) FROM observations WHERE project_key = ?`) usa
`idx_obs_project_updated` (`memory-store.ts:251`) y es sub-milisegundo.

**El detalle sucio del watermark**: `applyIncomingObservation()` escribe el `updated_at`
que viene del servidor, que puede ser **anterior** al máximo local. Un pull podría meter
una fila y no mover el watermark. Por eso la pasada incremental consulta
`updated_at > watermark - 5 min` (slack), y por eso existe el disparador 4: `COUNT(*)`
detecta cualquier fila que el `MAX` se haya comido. `COUNT(*)` sobre 10.000 filas es del
orden del milisegundo.

**Costo de la pasada completa, con números**: 10.000 `writeFileSync` de ~1 KB son ~3-8 s en
SSD en Linux/macOS y 20-60 s en Windows con Defender en tiempo real (el escaneo por archivo
nuevo domina todo lo demás). Tres mitigaciones:

- La pasada completa corre **por lotes de 200 con `setImmediate` entre lotes**, así el
  event loop de main no se bloquea y la UI no se congela. Es un mirror, no una transacción:
  que tarde 40 s no le importa a nadie mientras la app responda.
- A partir de la segunda pasada, `planVault()` compara el hash de cada fila contra el
  manifiesto y **no emite escritura si no cambió**. Una reconciliación de 10.000 filas sin
  cambios escribe cero archivos y hace cero `stat` (el manifiesto tiene el hash; no hace
  falta leer el disco para saber que está bien).
- El README recomienda una exclusión de Defender para la carpeta en Windows.

## 8. Redacción: qué sí y qué no llega al vault

El store ya redacta al escribir (`computeContentIdentity` → `redact`,
`memory-store.ts:117-123`) y otra vez al aplicar un pull. `title` y `content` llegan
limpios. Pero hay tres cosas que la redacción no cubre y que **sí** llegarían al vault:

**8.1 — `source_ref` contiene paths absolutos.** El importer de markdown escribe
`sourceRef: '{sourceLabel}:{filePath}#{topicKey}'` con `filePath` **absoluto**
(`markdown.ts:51`). Es decir: `claude-md:C:\Users\gerod\Dev\clientes\acme-bank\CLAUDE.md#...`.
Eso es exactamente lo que el doc de arquitectura §3.3 dice que nunca se sube ("a path can
contain a real name or a client name"), pero se cuela por otra columna. Decisión: el vault
emite `source_ref` **con todo segmento de path reemplazado por su basename**
(`claude-md:CLAUDE.md#imported/...`). Función pura, testeable. Rompe el round-trip exacto
de `source_ref`, y está bien: un importer vault-aware resuelve identidad por
`nest_sync_id`, no por `source_ref` (§9).

**8.2 — `projects.root_path` no se emite nunca.** La columna existe
(`memory-store.ts:300`) y `ensureProject()` la llena con el cwd
(`memory-ipc-server.ts:204`), así que nuestro handle readonly la puede leer. No la
escribimos. El razonamiento es el que abre §2: el vault se asume portable, y "es local
así que no importa" deja de valer en el momento en que el usuario hace zip y lo manda como
prueba de portabilidad. `display_name` sí va (es lo único que hace legible la carpeta, y es
el mismo dato que el usuario ya acepta subir a la nube cuando pone un display name), pero
la ruta absoluta no.

**8.3 — Filas viejas pueden tener secretos que los patrones de hoy no atajaban.** La
redacción corre una sola vez, en el momento de guardar (`memory-redaction.ts:9-29`). Una
fila guardada antes de que existiera un patrón se queda con el secreto adentro, y el vault
la escribiría a un archivo portable.

Decisión: **no re-redactamos**. Si el vault redactara, el archivo dejaría de ser el espejo
de lo que dice el store, el `nest_content_hash` no cerraría, y estaríamos mintiendo en la
única feature cuyo valor entero es ser verificable. En cambio, la pasada de generación
**cuenta** las filas cuyo `title`/`content` todavía matchea un patrón de secreto y lo
reporta en la UI: *"3 observaciones parecen contener secretos. Revisalas antes de compartir
este vault."*, con link a los archivos. Honesto, no bifurca los datos, y le da al usuario la
decisión.

**Lo que sí va y decidimos conscientemente que vaya**: `origin_account` y `author_display`
(pueden ser el nombre real de una persona) y `git_branch` (puede tener un nombre de
cliente). Son identidad y contexto, no secretos, y sin ellos la procedencia — que es el
diferencial contra Obsidian solo (contrato §7) — no existe.

## 9. Round-trip con el importer de markdown

La pregunta concreta: si alguien apunta `importMarkdownFile()` (`markdown.ts:24`) al
vault, ¿qué pasa?

### 9.1 Los guards de idempotencia NO alcanzan. Por qué

Recorriendo la cascada de `save()` (`memory-store.ts:421`) con un archivo del vault:

| Paso | Qué haría | Resultado |
|---|---|---|
| 0 — `(source, source_ref)` | El importer arma `sourceRef` = `{label}:{path del vault}#{topicKey nuevo}` (`markdown.ts:51`). Ese par nunca se vio | **No matchea** |
| 0.5 — `syncId` determinístico | `deriveImportSyncId(projectKey, scope, type, hash, topicKey)` (`memory-store.ts:85`). El `topicKey` es `imported/{label}/{slug(headingPath)}` (`chunker.ts:79`), **no** el `topic_key` original, y el `type` está forzado a `'pattern'` (`markdown.ts:34`). Semilla distinta → id distinto | **No matchea** |
| 1 — upsert por `topic_key` | Mismo problema: el topic derivado no es el original | **No matchea** |
| 2 — ventana de dedupe | Exige `type = ?` **y** `topic_key IS ?` **y** `created_at >= now - 7 días` (`memory-store.ts:550-556`, ventana en `:23`). Falla por las tres: type forzado a `pattern`, topic derivado distinto, y cualquier memoria de más de una semana queda afuera por fecha | **No matchea** |
| 3 | Insert | **Duplicado** |

Y el `UNIQUE (source, source_ref)` (`memory-store.ts:253`) tampoco ayuda: es único, no
detector de duplicados semánticos — garantiza que *reimportar el vault dos veces* no
duplique otra vez, pero la primera importación ya duplicó todo.

Conclusión sin vueltas: **hoy, apuntar el importer al vault duplica la memoria**. La única
razón por la que no duplica *todo* es que el cuerpo usa `#` y el chunker sólo corta en
`##`/`###` (`chunker.ts:36-38` y `:46`): una nota cuyo `content` no traiga sus propios
subtítulos produce **cero chunks**. Pero una nota larga (el plan de un architect, un
artefacto de handoff) sí trae `##` adentro, y esas sí se duplicarían, partidas en pedazos.

### 9.2 Las cuatro defensas

1. **Estructural**: `importAllMarkdownSources()` descubre en cinco lugares fijos
   (`markdown.ts:93-110`) y el vault no está en ninguno. Nadie llega al vault por accidente.
2. **El validador de raíz** (§4.1) rechaza configurar el vault en cualquiera de esos cinco
   lugares. Es la defensa contra el usuario que apunta el vault a su carpeta de Obsidian que
   *casualmente* es la raíz de un repo con `CLAUDE.md`.
3. **El cuerpo empieza en `#`** (§5.2): degrada de "duplica todo" a "duplica sólo las notas
   con subtítulos propios".
4. **Los anclajes de identidad en el frontmatter**: `nest_sync_id`, `nest_content_hash`,
   `topic_key`, `type`, `scope`, `created`. Con esos seis campos, un importer *vault-aware*
   round-trippea **perfecto y sin cambios en el store**, porque `SaveInput`
   (`memory-store.ts:126-147`) ya acepta `syncId`, `sourceRef`, `topicKey`, `type`,
   `createdAt` y `updatedAt`. Pasándolos, el Paso 0.5 matchea por `sync_id` y la
   reimportación es un update en el lugar, no un insert.

### 9.3 El pedido a Bauti (contrato, no cambio nuestro)

Dos líneas en `importMarkdownFile()`, en su rama, cuando quiera:

> Si el archivo empieza con un frontmatter YAML que tiene `nest_sync_id`, saltearlo (o, si
> se quiere el round-trip completo, importarlo pasando `syncId`, `sourceRef`, `topicKey`,
> `type`, `createdAt` y `updatedAt` desde el frontmatter en vez de derivarlos del chunker).

Es la contrapartida natural del pedido 3.3 del contrato ("tu importer de markdown podría
parsear los wikilinks también"). No bloquea nada de lo nuestro: sin ese cambio el vault
funciona igual, sólo que el round-trip queda cerrado por convención en vez de por código.

## 10. Una sola dirección, sin perder trabajo

El riesgo de un mirror one-way es obvio: el usuario edita una nota en Obsidian, la próxima
pasada la pisa, y perdió el trabajo. Cuatro capas, en orden de cuánto lo salvan:

1. **`README.md` en la raíz**, generado, primera línea en negrita: *"This folder is a
   mirror. Nest regenerates it. Edits made here do not reach Nest yet — they are preserved
   in `_conflicts/`, not applied."* También lleva: qué es cada carpeta, cómo abrirlo con
   Obsidian, y la recomendación de exclusión de Defender.
2. **`nest_generated: true`** en cada nota. Es la marca de que el archivo tiene dueño.
3. **Detección de ediciones, que es la que de verdad importa.** Antes de escribir, mover o
   borrar cualquier archivo, la pasada compara el hash del cuerpo en disco contra el hash
   que el manifiesto registró la última vez que ese archivo se escribió. Si difieren, el
   usuario lo editó: el archivo **se mueve a `_conflicts/{nombre}`** (nunca se borra, nunca
   se pisa), se escribe el espejo fresco al lado, y la UI avisa: *"2 notes you edited were
   preserved in `_conflicts/`"*. La promesa "no perdés trabajo por sorpresa" deja de ser
   una frase y pasa a ser un mecanismo.
4. **Considerado y descartado: marcar los archivos read-only** (`0444` / `FILE_ATTRIBUTE_READONLY`).
   Previene la edición pero rompe flujos legítimos de Obsidian, y en Windows deja archivos
   molestos de borrar si el usuario decide abandonar el vault. La capa 3 protege lo mismo
   sin pelearse con el usuario.

Bidireccional es una fase posterior y su gate está fuera de este spec: el sync multi-device
tiene que tener property tests de convergencia primero. Cuando llegue, la entrada de datos
ya está construida — `_conflicts/` es exactamente la cola de cambios pendientes de aplicar.

## 11. Multi-OS

| | Windows | macOS | Linux |
|---|---|---|---|
| Raíz default | `%USERPROFILE%\.raven-nest\memory-vault\` | `~/.raven-nest/memory-vault/` | `~/.raven-nest/memory-vault/` |
| ¿Cae en una carpeta sincronizada por default? | **No**: OneDrive Known Folder Move cubre Desktop/Documents/Pictures, no la raíz del perfil | No: iCloud Drive cubre Desktop/Documents si está activado, no `~` | No |
| Chars inválidos en nombre | `<>:"/\|?*`, control, punto/espacio final, nombres reservados | `:` y `/` | `/` |
| Nuestra regla | La misma en los tres: slug `[a-z0-9-]` + `--{8 hex}`. Es el mínimo común denominador, así que un vault generado en Linux se copia a Windows y abre igual | | |
| Case sensitivity | NTFS insensible | APFS insensible por default | ext4 sensible |
| Nuestra regla | Todo en minúscula: no puede haber dos nombres que difieran sólo en caso | | |
| Límite de path | ~260 chars sin opt-in de long paths | 1024 | 4096 |
| Nuestra regla | Presupuesto de §4.3 + validador que rechaza raíces custom > 120 chars **sólo en Windows** | | |
| Costo de la pasada completa (10k) | 20-60 s con Defender activo | 3-8 s | 3-8 s |
| Mitigación | Lotes de 200 con `setImmediate` + README recomienda exclusión de Defender | Lotes igual | Lotes igual |
| Fin de línea | Se escribe **`\n` siempre**, en los tres | | |

`\n` en Windows también, a propósito: los `.md` del vault son datos portables, no fuentes;
Obsidian, VS Code y Git los manejan igual, y usar CRLF sólo en Windows haría que el mismo
vault tuviera hashes distintos según la máquina que lo generó.

## 12. Módulos

| Archivo | Qué | Puro |
|---|---|---|
| `electron/integrations/memory-port.ts` | Extensión de `MemoryReader` con `MemoryRecord`, `MemoryProject`, `listRecords`, `listProjects`, `watermark`, y `NULL_READER` | Sí |
| `electron/integrations/memory-readonly-reader.ts` | Implementación de `MemoryReader` sobre un handle `readonly: true` a `memory.db`. Es lo **único** que toca SQLite | No |
| `electron/integrations/vault-naming.ts` | `vaultSlug`, `vaultFileName`, resolución de colisiones, `projectFolderName`, `isForbiddenVaultRoot`, presupuesto de path | Sí |
| `electron/integrations/vault-note.ts` | `renderNote(record, edges)` y `parseNote(text)` (frontmatter + cuerpo), `scrubSourceRef`, `vaultContentHash` | Sí |
| `electron/integrations/vault-plan.ts` | `planVault(records, projects, manifest, config) → VaultPlan {writes, moves, deletes, conflicts, warnings}`. **El corazón** | Sí |
| `electron/integrations/vault-apply.ts` | `applyVaultPlan(plan)`: escritura atómica por `rename`, lotes de 200, manifiesto, `tombstones.jsonl`, `README.md` | No |
| `electron/integrations/vault-config.ts` | `memory-vault.json`, mismo patrón validado/atómico que `worker-spec-store.ts:123` | Casi |
| `electron/main.ts` | Inyección del reader, timers de los cuatro disparadores, IPC de `enable`/`regenerate`/`reveal`, estado para la UI | No |

Mismo reparto que el puente: el grueso es puro y testeable con vitest sin
`better-sqlite3` y sin Electron; los efectos quedan en dos archivos y en `main.ts`.

## 13. Testing

**Puro, sin filesystem** (la mayoría, y lo que de verdad cubre los bugs):

- `vaultSlug`: chars inválidos de Windows, `/` (el caso que `chunker.ts:19` deja pasar),
  Unicode → `untitled`, corte a 60 en el guión, string vacío, título que empieza con `_`.
- `vaultFileName`: colisión mismo-slug-mismo-sufijo → el `sync_id` menor gana; el resultado
  no depende del orden del array de entrada (test con el array barajado).
- `projectFolderName`: remote antes que display_name; `__global__` → `_global`; sin fila en
  `projects` → el key crudo; dos repos homónimos en orgs distintas no colisionan.
- `isForbiddenVaultRoot`: los seis casos de la tabla de §4.1, con separadores de los tres
  SO y con mayúsculas/minúsculas mezcladas.
- `renderNote` / `parseNote`: round-trip de frontmatter con valores raros (comillas en el
  título, `content` que empieza con `---`, tags vacíos, `topic_key` null, content null).
- `scrubSourceRef`: el caso real de `markdown.ts:51` con un path de Windows y uno POSIX;
  un `sourceRef` del puente (`graph:{runId}:{nodeId}:{i}`) queda **intacto**.
- `vaultContentHash`: vector fijo asertado contra la fórmula de `memory-store.ts:104-108`.
  Es el test que detecta una divergencia si esa función cambia del otro lado.
- `planVault`, y acá está el volumen:
  - una fila activa nueva → un write;
  - la misma fila sin cambios → cero writes;
  - una fila que pasa a superseded → un move a `_superseded/` + un write del ganador con
    `supersedes`;
  - un tombstone → un delete + una línea de tombstone;
  - un archivo con hash distinto al del manifiesto → un `conflict`, nunca un write ni un
    delete sobre él;
  - un proyecto que pasa a `enrolled = 0` → move a `_disabled/`;
  - una fila con secreto aparente → un `warning`, y **igual se escribe** (§8.3);
  - cadena de tres supersedes → tres archivos, dos aristas, sin ciclos;
  - `content: null` con `deleted: 0` (no debería pasar, pero el tipo lo permite) → no
    rompe: se trata como cuerpo vacío y se emite warning.

**Con filesystem** (vitest + `makeTmpDir()` de `electron/__tests__/setup.ts:9`, y
`process.env.RAVEN_HOME` apuntado al tmp como hacen `account-store.test.ts:12` y
`local-paths-store.test.ts:12`):

- `applyVaultPlan` end-to-end: plan → archivos en disco → releer con `parseNote` → mismos
  datos.
- Atomicidad: matar la escritura a mitad no deja un `.md` truncado (write a `.tmp` +
  `rename`).
- Detección de ediciones: escribir, editar el archivo a mano, correr la pasada, verificar
  que el original está en `_conflicts/` y el espejo fresco al lado.
- Colisión case-insensitive: `describe.skipIf(process.platform === 'linux')`.
- Path largo en Windows: `describe.runIf(process.platform === 'win32')`, raíz de 200 chars
  → el validador la rechaza antes de escribir nada.

**Que necesita la otra rama** (no corre acá, va como `.live.test.ts` siguiendo la
convención de `graph-eval-loop.live.test.ts`):

- `memory-readonly-reader` contra un `memory.db` real con un escritor concurrente.
- La degradación cuando `memory.db` no existe.

El reader se mockea en todo lo demás: `planVault` recibe `MemoryRecord[]` fabricados a
mano, igual que `memory-bridge.test.ts` fabrica `GraphRun`s.

## 14. Preguntas abiertas

**V-1 — ¿El vault espeja las filas de scope `team`?** Hoy no hay ninguna (Teams es fase 3),
pero la decisión define el modelo. Espejarlas hace que el zip de "mi memoria" contenga
texto escrito por compañeros de equipo, con su `author_display` adentro. No espejarlas hace
que el vault deje de ser "toda mi memoria" justo para el tier que paga.
**Recomendación**: espejarlas, en una subcarpeta `_team/` por proyecto, y que el README
diga explícitamente que ese contenido es del equipo. El flag `includeTeamScope` ya está en
el config para poder apagarlo. Es una decisión de producto, no técnica.

**V-2 — ¿Los tombstones tienen un `_trash/` con 30 días de gracia?** §6 decide borrar el
archivo. Un usuario que borra una memoria por error y ya la había abierto en Obsidian no
tiene forma de recuperarla desde el vault (el store igual conserva la fila con el content
nulo, así que tampoco desde ahí).
**Recomendación**: borrar, sin `_trash/`. Un `_trash/` con el contenido adentro es
exactamente el "borré pero no se borró" que arruina la promesa, y el ciclo de vida del
tombstone ya está definido del lado del store (§3.1 del doc de arquitectura: purga a los
90 días con el delete confirmado en el servidor). Pero es la clase de decisión donde el
fundador puede querer lo contrario, así que queda marcada.

**V-3 — ¿El vault se ofrece como "carpeta nuestra" o como "apuntá a tu vault de Obsidian"?**
El diseño soporta las dos (la raíz es configurable), pero el default marca la expectativa.
**Recomendación**: default nuestro, con un "Change location…" visible. Apuntar a un vault
de Obsidian existente mete nuestras carpetas entre las notas del usuario y hace que
`_conflicts/` conviva con su trabajo real, que es peor UX y peor primera impresión. El que
quiera integrarlo a su vault existente hace un symlink o mueve la carpeta, y lo va a
entender.

**V-4 — ¿Se genera también un `.obsidian/` con configuración (graph filtrado, propiedades
visibles)?** Un `graph.json` con `-file:_index -path:_superseded` ya preconfigurado y las
propiedades de procedencia visibles en el panel haría que la primera apertura se vea
espectacular en vez de se vea como un montón de archivos.
**Recomendación**: sí, pero después de medir. Es puro polish y agrega un formato propietario
de un tercero a nuestro contrato de salida. Vale la pena sólo si el dato de uso dice que la
gente efectivamente abre esto con Obsidian — que es exactamente la medición que el
contrato §7 puso como condición para invertir en la vista de grafo propia. Misma señal, dos
decisiones.

## 15. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| V-R1 | **Reimportar el vault duplica la memoria.** §9.1 lo prueba paso a paso contra la cascada de `save()` | Cuatro capas de §9.2: el vault está fuera de las rutas de descubrimiento, el validador rechaza ponerlo ahí, el cuerpo arranca en `#` (cero chunks para la nota típica), y el frontmatter lleva los anclajes para un importer vault-aware. Más el pedido de dos líneas de §9.3 |
| V-R2 | **10.000 archivos.** La primera pasada en Windows con Defender puede tardar un minuto y parecer un cuelgue | Opt-in (nadie lo paga sin pedirlo), lotes de 200 con `setImmediate`, progreso honesto estilo §5.4 del doc de arquitectura, y a partir de la segunda pasada cero escrituras si nada cambió |
| V-R3 | **El usuario edita y pierde el trabajo.** Es el riesgo estructural del one-way | Detección de edición por hash antes de cada write/move/delete, `_conflicts/` en vez de sobreescritura, aviso en la UI, README explícito (§10). Un archivo editado nunca se pisa ni se borra |
| V-R4 | **Fuga de datos por un campo que no es el content.** `source_ref` con paths absolutos, `root_path`, filas viejas con secretos que los patrones de hoy no atajaban | `source_ref` scrubbeado a basenames, `root_path` nunca emitido, y un contador de "esto parece un secreto" en la UI sin re-redactar (§8). El vault vive fuera de `.raven-nest/memory/` para que un zip nunca arrastre `credential.bin` ni `pipe-auth.json` |
| V-R5 | **Deriva de `contentHash`.** Reimplementamos la fórmula de `memory-store.ts:104` para no depender de la otra rama. Si Bauti la cambia, nuestra detección de ediciones empieza a dar falsos positivos y todo el vault se va a `_conflicts/` | Test de vector fijo que falla ruidosamente ante cualquier cambio de fórmula, y `nest_vault_version` en cada nota: un bump de versión fuerza una regeneración completa que reescribe los hashes en vez de tratarlos como ediciones |
| V-R6 | **El handle readonly falla** (db inexistente, `-shm` no mapeable, FS de solo lectura) | `NULL_READER` por default, todo capturado, el vault reporta "memoria no disponible" y no se genera. Nunca tira la app, exactamente como `NULL_SINK` en el puente |
| V-R7 | **Renombres que rompen links del usuario.** Una colisión nueva puede cambiar el nombre de un archivo existente (§4.3), y un supersede lo muda de carpeta (§6) | La mudanza de carpeta no rompe nada (los wikilinks resuelven por nombre y por alias, no por path). El renombre por colisión es raro (mismo slug *y* mismo sufijo de 8 hex), es determinístico, y el manifiesto lo registra para poder reportarlo en la UI |
| V-R8 | **Obsidian es el único que resuelve `aliases`.** En Logseq o Foam, `[[obs-...]]` queda como link sin destino | `_index.md` por proyecto da navegación en cualquier herramienta, y `nest_sync_id` está en el frontmatter en texto plano para que `grep` funcione siempre. Obsidian es el target declarado; el resto degrada, no rompe |

---

### Hallazgos en el código que este diseño tuvo que absorber

**H-1 — El doc de arquitectura y el código no coinciden sobre el tag `redacted`.** §6.6
dice "the observation is tagged `redacted`", pero `save()` nunca agrega ese tag: el flag
existe sólo como valor de retorno (`memory-store.ts:423`, `:616`) y no persiste en ninguna
columna ni dentro de `tags`. Por eso el frontmatter no lleva campo `redacted` (§5.1). Es
para Bauti: o el doc se corrige, o `save()` agrega el tag.

**H-2 — `ObservationSummary` no alcanza para el vault**, y por eso el `MemoryReader` del
puente necesita los tres métodos nuevos de §3.1. No es un defecto del puente: el puente
sólo necesitaba dibujar aristas.

**H-3 — `slugify()` del chunker conserva la barra** (`chunker.ts:23`), lo que la hace
inservible para nombres de archivo en los tres SO. No es un bug de ellos — su entrada es
un `headingPath` jerárquico — pero es la razón por la que el vault tiene su propio
`vaultSlug()` y no reusa el suyo.

**H-4 — `display_name` puede quedar congelado con el nombre de un worktree**, porque
`ensureProject()` sale temprano si la fila existe (`memory-store.ts:373-374`) y el nombre
sale del último segmento del cwd (`memory-ipc-server.ts:203`). Se esquiva prefiriendo el
remote (§4.2), sin tocar nada de la otra rama.
