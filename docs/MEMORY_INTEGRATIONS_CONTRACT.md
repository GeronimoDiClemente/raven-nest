# Nest Memory + Integrations — contrato

> Para: Bauti (dueño de `feat/nest-memory-phase1`)
> De: Gero (dueño de `feat/integrations`)
> Creado: 2026-08-26 · **Actualizado: 2026-08-26 (segunda pasada, el puente ya está construido)**

## Estado

Leímos `feat/nest-memory-phase1` entera. Phase 1 está implementada y el diseño se sostiene solo,
así que **no tocamos nada tuyo** y no vamos a hacerlo.

Desde la primera versión de este doc pasó esto: **el puente ya está construido, revisado y
pusheado** en `feat/integrations` (`25ce17a..a6fc8e9`, 12 commits, suite en 925 verdes). Es la
Layer C de tu §2.3, la que quedó diseñada y sin implementar. Ya no es un plan, es código que anda.

Lo único que le falta para escribir de verdad son **veinte líneas**: el adapter que implementa
nuestro puerto sobre tu `MemoryStore.save()`. Hoy inyectamos un no-op, así que el puente corre y
no escribe en ningún lado.

**Regla que nos autoimponemos, sin cambios**: cero modificaciones a `electron/memory-*.ts`, a
`supabase/migrations/20260730000000_nest_memory.sql` y a las edge functions. Todo lo nuestro vive
en `electron/integrations/`. Escribimos únicamente por `store.save()`, nunca un INSERT directo.

---

## 1. Lo que necesitamos de vos

Ordenado por lo que nos frena. **Nada de esto nos bloquea hoy**: podemos seguir trabajando sin
respuesta, pero cada punto que resuelvas nos ahorra una vuelta.

### 1.1 — Avisanos si vas a cambiar el schema

Es lo único que nos puede romper de verdad. Para el vault de markdown y la vista de grafo vamos a
abrir `memory.db` con un handle propio en `readonly: true` (WAL admite varios lectores con un
escritor, no te bloqueamos ni te pedimos nada). Eso significa que **dependemos de la forma de la
tabla `observations`**. Si le cambiás columnas, avisanos y listo.

Si preferís que no leamos la base directo, la alternativa es que expongas un método de lectura y
lo usamos. Nos da igual, decidilo vos.

### 1.2 — Un método de lectura que incluya los superseded, y con procedencia

`context()` (`memory-store.ts:676`) y `search()` (`:658`) filtran `superseded_by IS NULL`, que es
correcto para un agente. Pero para dibujar el grafo, **los superseded son las aristas**: son la
única relación explícita entre dos memorias que existe en el schema.

Y hay un segundo problema: `ObservationSummary` (`memory-protocol.ts:72-82`) lleva `syncId`,
`title`, `content`, `type`, `topicKey`, `tags`, `updatedAt`, `originAi` y `gitBranch`, pero **no
lleva** `source`, `source_ref`, `scope`, `created_at`, `superseded_by`, `deleted`,
`revision_count`, `origin_account` ni `project_key`. O sea, casi toda la procedencia. Para el
vault necesitamos todo eso en el frontmatter.

Podemos resolverlo del lado nuestro con el handle read-only, y es lo que vamos a hacer salvo que
digas lo contrario. Te lo contamos para que sepas de dónde sale.

### 1.3 — Que el shim resuelva socket y token por archivo cuando no hay env

`memory-mcp/index.ts:23` y `:32` leen `NEST_MEMORY_SOCKET` y `NEST_MEMORY_TOKEN` del entorno, que
se los inyecta `pty-manager`. Fuera de un pane de Nest ese env no existe y el shim se apaga solo.

Pero `pipe-auth.json` ya vive en `~/.raven-nest/memory/` con mode 0600 y tiene el `pipeId` y el
`token`, así que un fallback a leer ese archivo cuando el env falta habilita usar la memoria desde
Cursor o desde una terminal común, con Nest abierto en la bandeja. Son diez líneas y no cambian el
modelo de seguridad: el archivo ya es la fuente de verdad y ya está protegido por permisos de
usuario.

Esto responde tu **O-7 en positivo**: Gero quiere que la memoria se use fuera de Nest.

### 1.4 — Aristas como wikilinks en el `content`

El puente ya escribe `[[run-<runId>]]` dentro del texto de las memorias que genera, para que todas
las de un mismo run converjan en un nodo del grafo. Elegimos ese formato en vez de una tabla
porque replica gratis por tu sync, se exporta gratis a markdown, no necesita schema, y es lo que
Obsidian entiende nativo.

Si te parece bien, tu importer de markdown podría parsearlos también cuando lee `CLAUDE.md`.

### 1.5 — Definir qué proyecto resuelve un `cwd` vacío

Nuestro puerto declara `cwd` como lo que el adapter usa para resolver el `projectKey`, igual que
hace `memory-ipc-server`. Hay dos casos donde no tenemos un path local que pasar (una falla de CI
que llega por webhook, por ejemplo) y mandamos `''`. Nadie definió qué debe resolver eso:
`__global__` es lo razonable, pero es tu decisión y hoy no está escrita en ningún lado.

---

## 2. Hallazgos en tu código

Todo lo de abajo lo **verificamos leyendo el código**, no es inferencia. Ninguno es urgente, la
rama no está mergeada. Los ordenamos por lo que costaría arreglarlos después.

### 2.1 — `source_ref` filtra paths absolutos al servidor

`memory-importers/markdown.ts:51` guarda `sourceRef: \`${sourceLabel}:${filePath}#${topicKey}\``
con el path **absoluto**. Y `appendMutation` (`memory-store.ts:393-397`) serializa la fila
**entera** con `JSON.stringify(row)`, que incluye `source_ref`. El daemon postea ese payload tal
cual (`memory-daemon.ts:308-314`).

Resultado: `C:\Users\<nombre real>\...` viaja al servidor en el cuerpo del POST.

**El matiz que importa**: `source_ref` **no existe como columna en Postgres** y
`memory_sync_push` no la inserta (verificado en la migración, líneas 386-398). O sea que **no
queda guardado**. Es una fuga de transmisión, no de almacenamiento: puede aparecer en logs de la
edge function o de cualquier proxy intermedio, nada más.

Igual contradice tu propio §3.3, que dice que `root_path` se guarda solo local *"never uploaded —
a path can contain a real name or a client name"*. Cerraste la puerta de adelante y quedó abierta
la de atrás. Se arregla con una línea en cualquiera de las dos puntas: guardar un path relativo o
un basename en el `source_ref`, o podar ese campo del payload antes de postear.

**Consecuencia secundaria que quizá no viste**: como `source_ref` no se replica, la idempotencia
por `source_ref` es **solo local**. Un segundo dispositivo que pullea la fila no la tiene. Para
imports lo salva `deriveImportSyncId`; para cualquier otro origen, no.

### 2.2 — `redacted` no se persiste en ningún lado

Tu §6.6 dice que la observación queda taggeada `redacted`. En el código, `redacted` es solo un
valor de retorno de `save()` (`memory-store.ts:423`, y los returns de `:452`, `:469`, `:499`,
`:507`, `:533`, `:575`, `:616`): no va a ninguna columna ni a `tags`.

Hoy no hay forma de saber qué memorias fueron scrubbeadas, y eso rompe una promesa concreta del
diseño: el diálogo de promoción de tu §7.3 tenía que **resaltar los spans redactados** antes de
compartir con el equipo. Sin el dato persistido, esa UI no se puede construir.

### 2.3 — `display_name` se puede congelar con el nombre de un worktree

`memory-ipc-server.ts:203` llama a `ensureProject` con el último segmento del cwd como
`displayName`. Y `ensureProject` (`memory-store.ts:372-374`) hace early return si la fila ya
existe, así que **el primer valor gana para siempre**.

Si la primera captura de un repo ocurre desde un worktree (algo bastante probable en este
producto, donde el orquestador crea worktrees por ticket), el proyecto queda llamándose
`ticket-1234` en vez del nombre del repo, y no hay forma de corregirlo salvo tocando la base.

Nosotros lo esquivamos prefiriendo el remote, pero el problema sigue del lado tuyo.

### 2.4 — `slugify()` del chunker conserva la barra

`memory-importers/chunker.ts:23`: `.replace(/[^a-z0-9\s/-]/g, '')` deja pasar el `/`. Para
`topic_key` está perfecto (es jerárquico a propósito), pero hace que la función sea inservible
para derivar nombres de archivo. No es un bug tuyo, es un aviso: nosotros traemos el nuestro para
el vault, no reusamos ese.

### 2.5 — El round-trip del vault duplicaría, hoy

Cuando escribamos el vault (memorias a `.md`), alguien va a apuntar tu importer de markdown a esa
carpeta, a propósito o sin querer. Rastreamos la cascada de `save()` y **fallaría los cuatro
guards de idempotencia**: tu importer fuerza `type='pattern'` (`markdown.ts:34`) y deriva su propio
`topic_key` del heading (`chunker.ts:79`), así que no matchea ni por `source_ref`, ni por el
`syncId` derivado, ni por `topic_key`, ni por la ventana de `content_hash` (que además exige
`created_at >= now - 7 días`, `memory-store.ts:550-556`).

Lo salva **de casualidad** que el chunker solo corte en `##` y `###` y que nuestras notas
arranquen con `#`: la nota típica produce cero chunks. Vamos a poner cuatro defensas del lado
nuestro, pero si querés blindarlo de tu lado, alcanza con que el importer respete un
`nest-memory:` en el frontmatter y saltee el archivo.

---

## 3. Cuatro bugs que solo aparecen al juntar las ramas

No los podés ver desde la tuya porque necesitan el orquestador de graph. **Ya hicimos el merge de
verdad** en un worktree de prueba (`smoke/memory-bridge`, descartable): dio **un solo conflicto y
fue `.env.example`**, y los cuatro bugs de abajo son todo lo que apareció.

**3.1 — `cmd === 'claude'` es comparación exacta.** `pty-manager.ts:185`. Los nodos del graph se
lanzan con `launchCommand()`, que devuelve `claude --model <x>` cuando el nodo tiene modelo
asignado. Ese caso no matchea, así que el nodo arranca **sin `--settings`**: sin hooks de memoria,
en silencio. Los nodos sin modelo sí funcionan, lo que lo hace peor porque falla de a ratos. Fix:
comparar contra `cmd.split(' ')[0]` e insertar el flag en vez de reconstruir el comando.

**3.2 — `accountDir` vacío saltea el bloque completo.** `pty-manager.ts:133` envuelve toda la
inyección de memoria en `if (accountDir && cmd)`. En integrations, `accountDirForAgent()` devuelve
`''` cuando el agente no tiene ninguna cuenta guardada. Resultado: un nodo headless corriendo con
el HOME real queda afuera de memoria por completo.

**3.3 — El coder del template `full` corre con codex, que no está provisionado.** Solo `claude`
recibe el shim MCP en Phase 1. El nodo que más decisiones toma en el pipeline por defecto es justo
el que no tiene memoria. No es un bug tuyo: es tu Phase 2 llegando antes de lo previsto.

**3.4 — `useMemory` explota si `window.memory` no existe.** Este apareció al correr la suite sobre
el merge real, y es el único que rompe tests en verde: `src/__tests__/components/Sidebar-integrations.test.tsx`
falla con `TypeError: Cannot read properties of undefined (reading 'onStatus')`.

La causa está en `src/hooks/useMemory.ts`: la línea 32 hace `window.memory.status()` y la 51
`window.memory.onStatus(...)`, las dos sin guard. Cuando `SettingsPanel` monta el hook y esa API del
preload no está expuesta, el componente entero se cae y arrastra a cualquier árbol que lo contenga.

**Es tentador arreglarlo como un mock faltante en el test de la otra rama, y creemos que sería el
fix equivocado.** El test solo expuso el problema: `window.memory` es una API del preload, y un hook
de renderer no debería asumir que existe. Cualquier contexto donde el preload no la haya expuesto
(un preload viejo tras un update parcial, un render fuera de Electron, un harness de test que no la
conoce) tumba la pantalla de Settings completa. Un par de optional chainings en esas dos líneas, más
un estado inicial de "memoria no disponible", lo cierran de raíz. De hecho `main.ts` ya trata la
memoria como algo que puede fallar y degradar a deshabilitado (todo el try/catch alrededor de
`new MemoryStore(...)`); el hook es la única pieza que no sigue esa misma regla.

---

## 4. Decisiones de producto

Son de Gero, y caen de tu lado para implementar.

**4.1 — El backend NO va a ser Supabase.** Decisión tomada, reemplazo **todavía sin definir**.
Esto reemplaza lo que decía la primera versión de este doc (que recomendaba separar el proyecto de
Supabase); esa recomendación ya no aplica.

Lo que se cae: la migración, las dos edge functions, la emisión del token `nmk_`, la RLS, y la
parte HTTP del daemon. Lo que sobrevive intacto, que es el grueso: el store completo, el
`mutation_log` y la cola offline, el shim, el IPC server, el provisioner, la UI, y **todo el
modelo de sync** (LWW con lamport, `superseded_by`, cursores por proyecto), que es conceptual y se
porta a cualquier backend.

Candidato con menos fricción, para lo que valga: Turso o libSQL, porque es SQLite replicado y tu
diseño ya es SQLite local con log de mutaciones.

**4.2 — El backend tiene que ser configurable por el usuario.** Hoy la URL sale de
`MAIN_VITE_SUPABASE_URL`, que es build-time. Tres niveles: local sin sync (ya está, es el default),
sync contra el backend del propio usuario (no existe), y self-hosted entero (otra conversación). El
del medio es el pedido enterprise clásico, y ese tier ya existe.

**4.3 — El disparador de conversión no es multi-device, es el equipo.** Si el free local es el
producto completo menos replicación, nadie paga por "quiero memoria". Pagan por "quiero que mi
equipo la vea", y eso además es lo único que ninguno de los competidores tiene. Vale que el peso
del diseño de Teams refleje eso.

**4.4 — Preguntas tuyas ya respondidas**: **O-3** (techo del free) queda **ilimitado**, no capado;
tu argumento de §7.1 quedó adoptado tal cual. **O-7** (uso fuera de la app): **sí**, ver 1.3.
**O-9** (caps de enterprise) sigue abierta, es de ventas.

---

## 5. Qué hacemos nosotros mientras

En `feat/integrations`, sin tocar nada tuyo:

1. **Un smoke real.** Vamos a armar un worktree de prueba con las dos ramas mergeadas, cablear el
   adapter y correr la app para ver memorias escribiéndose de verdad. **Esa rama de prueba no se
   mergea a ningún lado** y tu rama no se toca. Te lo avisamos para que no te sorprenda ver un
   merge tuyo en algún worktree local.
2. **El vault markdown**: proyección de las memorias a una carpeta de `.md` con wikilinks, en una
   sola dirección (el store manda, los archivos son espejo). Es la prueba verificable de la
   promesa de portabilidad, y de paso le da vista de grafo gratis a cualquiera que ya use Obsidian.
   Spec: `docs/superpowers/specs/2026-08-26-memory-vault-design.md` en `feat/integrations`.
3. **La vista de grafo propia**: condicional, después de medir si la gente abre el vault con
   Obsidian.

## 6. Qué te vamos a entregar

**El adapter del sink**, unas veinte líneas sobre tu `MemoryStore.save()` con `source: 'pty'`.
Cuando las ramas se junten, es lo único que hay que conectar. Te lo vamos a pasar para que lo
revises antes de que quede fijo, porque es el punto donde nuestro código escribe en tu store y
querés tener opinión sobre eso.

Tu `SaveInput` ya acepta todo lo que necesitamos, no hay que agregarle un campo. En particular
`sourceRef` con el índice `UNIQUE (source, source_ref)` nos da idempotencia gratis: un evento
re-emitido actualiza en vez de duplicar, y todo nuestro esquema de claves se apoya en eso.

Cualquier objeción es más barata ahora que cuando esto se merge.
