# Nest Memories como plugin, y el cifrado que pidió Bauti

> Rama: `feat/nest-memories` (worktree `memory-smoke`, local, sin pushear)
> Fecha: 2026-09-09
> Reemplaza: el §6 ("Fase 2 — el plugin suelto") de `2026-09-09-nest-memories-plugin-design.md`, que se queda corto
> Construye sobre: esa misma spec (fase 1), `2026-08-31-memory-sync-backend-design.md` (el servidor), `2026-09-07-opencode-memory-mcp-design.md` (los adapters)
> Origen: las respuestas de Bauti del 2026-09-09 al cuestionario de decisiones, más la dirección de producto que dio Gero el mismo día

## 1. Qué cambió respecto de la spec de la mañana

Dos cosas, y las dos agrandan la fase 2.

**Primera: el plugin no es sólo "que ande sin Nest abierta". Es un producto con su propia cara.**
La spec anterior planteaba un daemon headless para que la memoria sobreviviera sin Electron.
Gero lo corrigió: la idea es que alguien que trabaja en Cursor, o en cualquier corredor de
terminales, **corra Nest Memories ahí y tenga una vista en la terminal**, pague los 10 dólares y
tenga su memoria sincronizada. En sus palabras:

> "la idea es que nosotros lo usemos en nest y sea una herramienta que funcione también como
> engram en cualquier terminal, como plugin, donde Nest tiene la opción de grafos y nodos pero si
> otro desde Cursor corre Memories de Nest pueda tener una visual en terminal, pagar los 10
> dólares y acceder al plugin de memorias desde cualquier corredor de terminales onda Nest."

O sea: **Nest deja de ser la única cara de la memoria y pasa a ser la mejor.** El grafo sigue
siendo exclusivo de la app; la terminal tiene su propia vista, más chica y suficiente.

**Segunda: hay que cifrar.** Bauti eligió una sola instancia para todos, pero el motivo que dio
fue *"que una persona con acceso al railway no pueda ver las memorias de los users"*. Eso no lo
arregla la topología: si nosotros operamos las instancias (lo que él mismo eligió), en cualquier
modelo tenemos acceso a la base. Lo que pidió, sin nombrarlo, es **cifrado del lado del cliente**.

Las dos van juntas en un solo documento porque el cifrado define el formato de lo que el plugin
escribe y lee, y sería un error diseñarlos por separado y después casarlos.

## 2. Lo medido antes de diseñar

Verificado en disco el 2026-09-09.

### 2.1 Hoy no existe ningún CLI de Nest

`package.json` no tiene `bin`. `electron/cli-install-runner.ts` **no** instala un CLI nuestro:
instala los CLIs de las IAs (claude, gemini, codex, qwen, opencode). El paquete npm de la fase 2
es código nuevo, no un rename de algo que ya está.

### 2.2 Los tres amarres a Electron, ubicados

1. `electron/memory-mcp/index.ts:23` — sin `NEST_MEMORY_SOCKET` hace `process.exit(1)`. No
   degrada: muere.
2. `electron/memory-provisioner.ts:124-127` — la entrada MCP que escribe es
   `{ command: paths.execPath, args: [paths.shimPath] }`. O sea **el binario de Electron y una
   ruta adentro de la instalación de Nest**. Esa entrada persiste en `.claude.json` aunque Nest
   no esté corriendo, y ese desajuste es exactamente el `CONNECTION_CLOSED` del §2.2 de la spec
   anterior.
3. `electron/memory-store.ts` — la base es propiedad exclusiva del daemon en Electron main.

### 2.3 El servidor nunca lee el contenido

Recorrido completo de `server/src/`:

- `push.ts:196` y `status.ts:38` hacen `octet_length(content)` para la cuota. Miden bytes, no leen.
- `push.ts:296` corta arriba de `MAX_OBSERVATION_BYTES` (1 MB). Mide bytes.
- `push.ts:575-610` hace el upsert por `sync_id`. Guarda y pisa.
- `pull.ts:104-139` devuelve las columnas tal cual.
- **No hay FTS, ni embeddings, ni ninguna consulta que mire adentro de `content` o `title`.**

La búsqueda es **FTS5 local**, en el SQLite del cliente. Conclusión: **cifrar `title` y `content`
no rompe nada de lo que el servidor hace hoy.** Es la razón por la que esto es viable.

### 2.4 Lo que sí mira el servidor, y por lo tanto no puede cifrarse a lo bruto

- **`topic_key`**: `push.ts:537` hace `where project_id = $1 and scope = $2 and topic_key = $3`
  para superseder la versión anterior de un tema. Necesita **igualdad**, no lectura. Un hash
  determinístico alcanza; el texto en claro no hace falta.
- **`project_display_name`**: `push.ts:115-116` y `342` lo guardan tal cual. **Esto es una fuga
  que ya existe y que contradice el diseño propio**: `memory-project-key.ts:25` dice textual
  *"Cloud never learns the repo name"* y hashea el remote a `sha256(...)[0:16]`, y después el
  display name viaja al lado en texto plano. Se arregla acá.
- `tags`, `type`, `scope`, `git_branch` y las marcas de tiempo: metadata, hoy en claro.

### 2.5 Lo que ya está a favor

- La redacción de secretos (`memory-redaction.ts`) ya corre **en el cliente**, antes de guardar.
  El cifrado va después de eso en la misma cadena.
- `deriveImportSyncId` deriva la identidad de un hash del contenido, no del contenido: sigue
  funcionando cifrado.
- La resolución de conflictos (`memory-merge.ts`, LWW por lamport y timestamp) mira metadata, no
  contenido.
- El servidor ya tiene revoke de devices, purge, borrado de datos y backups a R2.

## 3. El producto: tres caras de la misma memoria

| Cara | Qué es | Quién la usa |
|---|---|---|
| **El plugin** | Paquete npm con un binario, un daemon y el shim MCP. TUI propia. | Cualquiera, en cualquier terminal o IDE |
| **Nest** | La app. El grafo, los nodos, el vault, el hilo de equipo. | Quien usa Nest |
| **El servidor** | Donde vive la memoria sincronizada, cifrada. | Los dos, si pagan |

**La regla que ordena todo**: la memoria es del usuario y vive en su máquina. Nest y el plugin
son dos ventanas a la misma base local. El servidor es el que las mantiene iguales entre
máquinas, y **no puede leer lo que guarda**.

**Lo que NO hacemos**: reimplementar el grafo en la terminal. El grafo es de Nest y es una de las
razones para abrir la app. La terminal tiene una vista de lista y búsqueda, que es lo que sirve
cuando estás adentro de una sesión.

## 4. El paquete

### 4.1 Forma

`@nestmux/memories`, un paquete npm con `bin: { "nest-memories": "./bin/nest-memories.js" }`.
Node puro, sin Electron. La única dependencia nativa es `better-sqlite3`, que ya usamos.

Comandos:

| Comando | Qué hace |
|---|---|
| `nest-memories` | Abre la TUI |
| `nest-memories init` | Provisiona los hooks y el MCP en la CLI de IA que detecte |
| `nest-memories doctor` | Lo bloqueado, con código de razón, y el estado de las sesiones |
| `nest-memories login` | Conecta con la cuenta y baja el device token |
| `nest-memories mcp` | El shim stdio, para la entrada de `mcpServers` |
| `nest-memories hook <name>` | El destino de los hooks de sesión |

`init` reemplaza a `memory-provisioner.ts` en el caso sin Nest: escribe
`{ command: "nest-memories", args: ["mcp"] }` en vez de la ruta al binario de Electron. **Eso
sólo ya mata el `CONNECTION_CLOSED`**: una entrada que apunta a un comando del PATH no se rompe
porque la app no esté abierta.

### 4.2 Convivencia con la app: un solo escritor

La regla es **un solo proceso escribe la base**. El plugin busca el daemon de la app (el socket
de `memory-ipc-server.ts`) y si lo encuentra le habla; si no, levanta el suyo.

Para que dos plugins no levanten dos daemons, **lease en SQLite**, el patrón que engram ya usa en
producción (`internal/cloud/autosync/manager.go`): una fila con dueño y vencimiento, renovada
mientras se trabaja. Copiamos el patrón, no el código.

### 4.3 La TUI

Cuatro pantallas, ninguna decorativa:

1. **Estado**. Lo mismo que la fila de Memories en Nest: items, sync, cuota, conflictos, y el
   indicador de sesión activa o apagada del §2.2 de la spec de la mañana. Es la razón principal
   por la que un usuario de terminal abriría esto.
2. **Buscar**. FTS5 sobre la base local. Es lo que la gente hace de verdad con su memoria.
3. **Lo último**. Las observaciones recientes del proyecto donde estás parado, que es lo que se
   le inyecta a la sesión.
4. **Doctor**. Lo bloqueado con su razón, en el mismo formato que el panel de Nest.

Sin dependencias de UI pesadas: escritura directa a la terminal con códigos ANSI y lectura de
teclas. Todo lo que la TUI muestra sale del mismo daemon por el mismo protocolo que ya existe
(`memory-protocol.ts`), así que **no hay una segunda fuente de verdad**.

### 4.4 Cómo se cobra

Bauti cerró D2 así: **gratis y abierto con memoria local; la nube se paga.** Coincide con los tres
tiers del 2026-09-02 y no crea un cuarto producto.

Traducido a código, el gate ya existe y no hay que inventarlo: **sin device token no hay push ni
pull**, y todo lo demás anda. Un usuario Free instala el plugin, captura, busca y tiene su vault
local. Paga los 10 y la misma base empieza a viajar.

> ⚠️ Punto chico a confirmar con Bauti: él escribió "gratis con memoria local pero sin memoria en
> servidor"; Gero escribió "pagar los 10 dólares y acceder al plugin desde cualquier corredor de
> terminales". Son la misma cosa **si el plugin local es gratis**. Si la idea es que el plugin
> entero sea del tier de 10, es otra decisión y hay que decirlo antes de escribir el gate.

## 5. El cifrado

### 5.1 Qué amenaza cubre, dicho sin vueltas

**Cubre**: que alguien con acceso a la base de datos del servicio (nosotros, un proveedor, un
intruso con el dashboard, un backup robado) pueda leer las memorias de un usuario.

**No cubre**: la máquina del usuario. Ahí la base está en claro, y tiene que estarlo, porque la
búsqueda es local y el agente necesita el texto. Un atacante con la máquina del usuario ya ganó.

Decirlo así importa porque es lo que vamos a poder afirmar en la landing sin mentir.

### 5.2 Qué se cifra y qué no

| Campo | Hoy | Después | Por qué |
|---|---|---|---|
| `content` | claro | **cifrado** | El servidor sólo mide sus bytes |
| `title` | claro | **cifrado** | Ídem |
| `project_display_name` | claro | **cifrado** | Cierra la fuga del §2.4 |
| `topic_key` | claro | **HMAC con la clave del usuario** | El servidor necesita igualdad (`push.ts:537`), no el texto |
| `tags` | claro | **cifrados como un blob** | Nadie los consulta del lado del servidor |
| `project_key` | ya es `sha256[0:16]` | igual | Ya no dice el nombre del repo |
| `type`, `scope`, `git_branch` | claro | **en claro** | Ver abajo |
| lamport, timestamps, `sync_id` | claro | **en claro** | Los necesita el merge |

**`type`, `scope` y `git_branch` se quedan en claro a propósito.** `scope` decide autorización del
lado del servidor (personal contra equipo) y cifrarlo rompería el modelo de permisos. `type` y
`git_branch` filtran poco y sirven para diagnóstico. Es una concesión deliberada, no un olvido, y
va escrita en la landing junto a la promesa: *ciframos lo que escribiste; el servidor sigue
sabiendo cuántas memorias tenés, de qué tipo y en qué rama*.

### 5.3 Dónde vive la clave — la decisión de fondo

Tres caminos. Todos cumplen lo que pidió Bauti; se diferencian en qué pasa cuando el usuario
pierde el acceso.

**Camino A — clave derivada de la contraseña de la cuenta.**
Se deriva con Argon2id de la contraseña, del lado del cliente, y nunca sale de ahí. Segunda
máquina: entra con su contraseña y deriva la misma clave.
· A favor: cero fricción, la experiencia no cambia en nada.
· En contra: **si cambia la contraseña hay que reencriptar**, y el login con GitHub (que es el que
usa Nest) no tiene contraseña de la cual derivar. Con OAuth, este camino no existe.

**Camino B — clave aleatoria, envuelta por dispositivo (recomendado).**
Se genera una clave maestra aleatoria una sola vez. Cada dispositivo tiene su propio par de
claves; la maestra viaja **envuelta** con la pública de cada dispositivo autorizado. Sumar una
máquina es autorizarla desde una que ya tenés, igual que un mensajero cifrado.
· A favor: funciona con OAuth, sobrevive al cambio de contraseña, y ya tenemos la mitad
construida (`devices`, `POST /v1/devices/revoke`, el device token).
· En contra: **la primera máquina nueva necesita a otra viva para autorizarse.** Se resuelve con
un código de recuperación que el usuario guarda al activar el cifrado.

**Camino C — la clave la guardamos nosotros.**
· A favor: cero fricción, recuperación trivial.
· En contra: **no cumple lo que pidió Bauti.** Si nosotros tenemos la clave, quien administre el
servidor puede leer las memorias. Se documenta para descartarlo por escrito, no como opción.

**Recomendación: camino B**, con código de recuperación obligatorio al activar. Es el único que
convive con el login de GitHub y con la promesa que queremos hacer.

### 5.4 La memoria de equipo

Es la parte que se complica y hay que decidirla antes de escribir código.

Una memoria de scope `team` la tienen que leer todos los miembros, así que no puede ir cifrada
con la clave de una persona. Hace falta **una clave por equipo**, envuelta con la clave pública de
cada miembro. Sumar a alguien es envolverle la clave del equipo; sacarlo es rotarla y volver a
envolverla para los que quedan (lo viejo que ya bajó, ya lo tiene: eso es inevitable en cualquier
sistema de este tipo y hay que decirlo).

Eso apoya sobre `team_memberships`, que ya existe de Layer 1. Lo que **no** existe todavía es el
par de claves por usuario, y es la pieza nueva más grande de esta spec.

### 5.5 Lo que se rompe, y lo que no

**No se rompe**: el push, el pull, la cuota, los límites, el merge LWW, el import de engram y de
markdown, el vault, la búsqueda local, el borrado de datos, los backups a R2 (pasan a ser backups
de texto cifrado, que es mejor).

**Sí se rompe o cambia**:

1. **El back-office deja de poder mostrar contenido.** Es exactamente el objetivo, pero hay que
   revisar qué muestra hoy `aira-admin` antes de romperlo sin querer.
2. **La cuota mide ciphertext**, que es un poco más grande. El tope de 1 MB por observación pasa a
   ser sobre el cifrado. Con los números medidos (1.506 B por observación) no cambia nada práctico.
3. **Lo ya subido en claro hay que migrarlo.** Hoy es una sola cuenta, la de Gero: se reencripta
   desde el cliente y se re-sube. Con usuarios reales hubiera sido un proyecto; ahora es una tarde.
   **Esta es la razón por la que el cifrado va antes de abrir a usuarios y no después.**
4. **Aparece un modo de falla nuevo**: memoria en la nube que el dispositivo no puede descifrar
   (todavía no autorizado, clave rotada). Tiene que fallar en voz alta, con su `reason_code`, en el
   mismo doctor del §7.1 de la spec de la mañana. Ese camino ya está construido: `blocked_reason`.

## 6. Alcance

**Entra en esta spec:**

- El paquete `@nestmux/memories` con daemon headless, lease en SQLite, shim MCP sin Electron y
  `init` que provisiona apuntando a un comando del PATH.
- La TUI con sus cuatro pantallas.
- El gate de nube por device token (que ya existe; acá sólo se respeta desde el plugin).
- El cifrado del camino B: clave maestra envuelta por dispositivo, código de recuperación,
  `topic_key` por HMAC, y la migración de lo ya subido.
- La clave por equipo del §5.4.

**No entra:**

- El grafo en la terminal. Es de Nest a propósito (§3).
- Embeddings, re-ranking o búsqueda del lado del servidor. Con el servidor ciego, la búsqueda
  remota deja de ser posible tal como se la piensa hoy, y no la necesitamos: el corpus vive local.
- Cifrar `type`, `scope` y `git_branch` (§5.2).
- Compatibilidad con el protocolo de engram. Sigue descartada.

## 7. Orden de trabajo

Es importante y no es el orden en que se escribió esto.

1. **El cifrado primero.** Define el formato de lo que se guarda, y migrar una cuenta hoy cuesta
   una tarde. Cada usuario que sumemos antes multiplica ese costo.
2. **La fase 1 de la spec de la mañana** (la pantalla Memories), que no depende del cifrado salvo
   en un detalle: el contador de conflictos y el doctor tienen que poder mostrar el modo de falla
   nuevo del §5.5.4.
3. **El paquete y la TUI.** Es lo más grande y lo que menos se rompe si llega último, porque
   consume el protocolo que ya existe.

## 8. Riesgos

1. **El código de recuperación es un momento de fricción en el onboarding**, justo cuando el
   usuario todavía no confía en el producto. Si se lo salteamos, el primer usuario que cambie de
   máquina pierde su memoria.
2. **`better-sqlite3` fuera de Electron** vuelve a traer el problema de siempre: no hay prebuild
   para el ABI de Node 20 y compila desde source. Un plugin que tarda dos minutos en instalar
   porque invoca node-gyp pierde contra un binario Go de engram. Hay que resolver esto antes de
   publicar el paquete.
3. **La ventana competitiva sigue abierta**: engram v2 sale esta semana y su cliente ya corre en
   ocho agentes.
4. **La clave por equipo del §5.4 es la pieza menos diseñada** de este documento. Si se complica,
   una v1 defendible es cifrar sólo lo personal y dejar el scope `team` en claro, **diciéndolo**.

## 9. Lo que queda abierto

1. **El scope `team` en la v1**: cifrado desde el día uno, o en claro y anunciado (§8.4). Es la
   única pregunta que cambia el tamaño del trabajo de manera grande.
2. **El plugin local, ¿gratis o parte del tier de 10?** (§4.4). Bauti y Gero lo dijeron distinto.
3. **Qué muestra hoy el back-office** que vaya a quedar cifrado (§5.5.1).
4. D8 de las respuestas de Bauti sigue sin cerrar: dijo que el backup lo tiene el usuario en su
   PC, y eso no cubre al usuario que entra desde una máquina nueva ni la memoria de equipo escrita
   por otros.
5. D9 (el límite de bytes por cuenta) no lo contestó, y ahora depende de este documento y no del
   hosting.
