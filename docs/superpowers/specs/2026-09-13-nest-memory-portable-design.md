# Nest Memory portátil — diseño

**Fecha:** 2026-09-13
**Estado:** propuesta, sin implementar
**Spec hermana:** `2026-09-09-nest-memories-plugin-y-cifrado.md` (el cifrado, que este documento
da por hecho y no re-discute)

---

## 1. Qué es y por qué

Hoy la memoria se lleva a otro editor copiando tres líneas de JSON a mano:

```json
"nest_memory": {
  "command": "<binario de Nest>",
  "args": ["<...>/dist-electron/memory-mcp.js"],
  "env": { "ELECTRON_RUN_AS_NODE": "1" }
}
```

Funciona —está verificado— pero tiene dos problemas que lo vuelven inservible como producto:

1. **Apunta a un binario de Nest.** Si Nest no está instalado en esa máquina, no hay nada que
   apuntar. La memoria sigue siendo, en la práctica, una función de la app.
2. **Nadie va a copiar tres líneas de JSON.** El usuario que evaluamos —alguien que abre
   Cursor y espera que las cosas anden— no edita `.claude.json` a mano.

Este diseño convierte la memoria en algo **exportable**: un paquete de npm que se instala
solo, funciona sin Nest, y se conecta a la nube si el usuario paga.

**La decisión de producto que lo enmarca**, y que ordena todo lo que sigue: *queremos que usen
Nest, pero no queriendo que la falta de Nest sea un limitante*. El paquete portátil tiene que
ser bueno de verdad —no una demo mutilada— y Nest tiene que ganarse su lugar por lo que
agrega, no por lo que el otro no puede hacer. El §8 dice exactamente qué agrega.

---

## 2. La restricción que define el diseño

**La memoria de la nube está cifrada de punta a punta y la clave nunca sale del cliente.**

De ahí se sigue algo que no tiene vuelta: un paquete de npm en una máquina nueva **no puede
leer tus memorias de la nube** por el solo hecho de tener tu token. El token dice quién sos;
no abre nada.

Para leer, ese paquete **tiene que ser un dispositivo más**: publicar su clave pública,
esperar a que una máquina que ya tiene la maestra le selle una copia, y recién ahí descifrar.
Exactamente el mismo camino que una segunda laptop.

No hay atajo. Si lo hubiera, el cifrado no serviría para nada — y es lo que estamos vendiendo.

Esto no es un costo del diseño: es el diseño. Lo único que se puede hacer es que el camino sea
corto y esté bien explicado, que es lo que resuelve el §6.

---

## 3. Las tres superficies

Un solo paquete, tres formas de usarlo. Comparten todo el código; lo que cambia es la puerta.

### 3.1 `npx nest-memory` — la CLI

La forma más directa, y la que no necesita instalar nada permanente.

```
npx nest-memory setup            # detecta editores y se instala en todos
npx nest-memory setup --cursor   # sólo en uno
npx nest-memory login            # conecta la cuenta de nube
npx nest-memory status           # qué ve, de dónde, y si puede descifrar
npx nest-memory search "auth"    # leer sin pasar por un agente
npx nest-memory doctor           # por qué no anda
```

`setup` es el corazón: **escribe la configuración MCP en los editores que encuentra**, que es
justo lo que hoy el usuario tiene que hacer a mano. Detecta por archivo de config, no por
proceso: `.claude.json`, `~/.codex/config.toml`, `~/.gemini/settings.json`, el
`settings.json` de Cursor, el de VS Code, y los de Qwen y opencode — los mismos que
`memory-provisioner*.ts` ya sabe escribir del lado de Nest.

Idempotente: correrlo dos veces no duplica nada, y `setup --undo` lo saca todo.

### 3.2 El servidor MCP

Lo que los agentes consumen. Las mismas seis herramientas de hoy
(`memory_save`, `memory_search`, `memory_context`, `memory_get`, `memory_update`,
`memory_graph`), la misma instrucción de servidor, el mismo presupuesto de contexto del §
"tres escalones".

Es el mismo código que hoy vive en `electron/memory-mcp/`. Lo que cambia es de dónde saca los
datos (§5) y que corre bajo Node y no bajo el binario de Electron (§4).

### 3.3 La extensión de Cursor / VS Code

Un `.vsix` que hace lo mismo que la CLI con botones. No es un producto aparte: **empaqueta la
CLI y le pone una cara**.

- Al activarse, corre el equivalente de `setup` sobre el editor que la hospeda.
- Un panel con el estado: cuántas memorias, de dónde salen, si puede descifrar, y el botón de
  conectar la nube.
- El código de autorización de dispositivo (§6) mostrado para copiar, en vez de un comando.

**La extensión es la puerta, no el motor.** Todo lo que hace se puede hacer desde la CLI, y
eso es a propósito: el que vive en la terminal no tiene que instalar una extensión, y el que
vive en el editor no tiene que abrir una terminal.

---

## 4. Cero dependencias nativas

El obstáculo técnico que hacía inviable un paquete de npm era `better-sqlite3`: compila un
binding contra el ABI de Node, y ese ABI cambia con cada versión mayor. `npx` sobre un Node
cualquiera es exactamente el escenario donde eso explota (ver la sección de `better-sqlite3`
en `CLAUDE.md`, que documenta que los prebuilds cubren las ABI 127/137/141/147 y **no** la
115 de Node 20).

**`node:sqlite` lo resuelve**: viene con Node y no compila nada. Verificado en la máquina de
desarrollo el 2026-09-13: `DatabaseSync`, `StatementSync`, `Session`, `backup`.

> **Corrección (2026-09-18).** Este párrafo decía que estaba disponible "desde la 20.19 que el
> repo ya exige". **Es falso**: `node:sqlite` se agregó en **v22.5.0** y no hubo backport a la
> 20.x, que además ya está fuera de soporte. Confirmado contra la documentación de Node. O sea
> que el paquete portátil **no hereda el `engines.node` del repo**: tiene que pedir `>=22.5` y
> fallar con un mensaje que lo explique, no con un `MODULE_NOT_FOUND` sobre `node:sqlite`.
> Esto no cambia la decisión —sigue siendo cero dependencias nativas— sólo el piso, y el piso
> hay que decirlo en el `package.json` y en el error. Dentro de este repo el punto es inocuo:
> el typecheck de CI corre en Node 20 pero sólo necesita los tipos (`@types/node` los trae), y
> el job de tests corre en Node 22, donde el módulo existe.

La superficie a adaptar es chica y está medida. En `memory-store.ts`:

| API de better-sqlite3 | Usos | Equivalente en `node:sqlite` |
|---|---|---|
| `.prepare()` | 68 | `prepare()`, misma forma (`.all/.get/.run`) |
| `.transaction(fn)` | 10 | `exec('BEGIN')` / `COMMIT` / `ROLLBACK` a mano |
| `.exec()` | 7 | `exec()`, igual |
| `.pragma()` | 4 | `exec('PRAGMA …')` o `prepare('PRAGMA …').get()` |

O sea: **un adaptador de ~100 líneas**, no una reescritura. Vive en el paquete portátil y la
app de Electron sigue con `better-sqlite3` (donde ya funciona y está probado) hasta que haya
una razón para mover eso también.

> **Ojo con `.transaction()`.** La versión de better-sqlite3 es reentrante y hace rollback
> sola ante una excepción. El reemplazo a mano tiene que replicar las dos cosas o hay
> transacciones que quedan abiertas ante un error — con la base compartida entre procesos, una
> transacción abierta bloquea al otro escritor hasta que el proceso muera.

---

## 5. De dónde salen los datos: dos modos

El paquete decide solo, en este orden, y lo dice en `status`:

### 5.1 Con Nest corriendo en la misma máquina

Habla con el daemon por el socket local, como hoy. Nest es el escritor único y el que
sincroniza. **Este camino no cambia** y es el que ya está verificado.

Detección: `NEST_MEMORY_SOCKET` + `NEST_MEMORY_TOKEN` en el entorno (lo que Nest le inyecta a
sus terminales), o el socket en su ruta conocida.

### 5.2 Sin Nest: base local propia

El paquete abre su propio SQLite —el mismo esquema, la misma versión— en
`~/.nest-memory/`.

- **Si hay una base de Nest en esta máquina** (`~/.raven-nest/memory/…`), la usa a ella: son
  las mismas memorias y duplicarlas sería el peor resultado posible.
- **Si no hay**, crea la suya. Es una máquina que nunca tuvo Nest, y lo que llene esa base va
  a salir de la nube (§6) o de lo que escriban los agentes de esa máquina.

---

## 6. Escribir sin Nest: el problema del escritor único

Es la parte difícil, y la razón por la que hasta hoy el modo sin daemon es de sólo lectura.

La decisión 2 de `docs/nest-memory-architecture.md` dice que el daemon vive en el proceso
principal de Electron porque *"N CLI processes each syncing would mean N token copies and N
racing pushers"*, y la 3 que *"one write path → one place to trigger sync, one place to
enforce redaction"*.

Eso sigue siendo cierto **para sincronizar**. Para *escribir en la base local*, resulta que el
problema es mucho más chico de lo que parecía. Lo verificado el 2026-09-13:

| Preocupación | Estado real |
|---|---|
| Corrupción por dos procesos | **No es un problema.** El store abre en WAL, que admite lectores concurrentes y serializa escritores. SQLite lo resuelve con locking de archivo. |
| `mutation_log.seq` colisionando | **No es un problema.** Es `INTEGER PRIMARY KEY AUTOINCREMENT`: lo asigna la base, no el proceso. |
| Redacción de secretos | **No es un problema** si el paquete usa el mismo `MemoryStore.save()`, que la aplica adentro. Es una razón más para compartir código y no reimplementar. |
| **El reloj de Lamport** | **Sí es el problema.** `memory-store.ts:817` lo carga con `SELECT MAX(lamport)` **una vez al abrir** y después lo incrementa en memoria (`:850`). Dos procesos abiertos sobre la misma base arrancan del mismo número y emiten lamports duplicados — que es lo que ordena los conflictos. |

### 6.1 El arreglo

**El lamport se asigna desde la base, adentro de la transacción de escritura**, en vez de
desde un contador en memoria.

```sql
-- dentro de la misma transacción que inserta la observación
SELECT COALESCE(MAX(lamport), 0) + 1 FROM observations
```

La transacción de escritura de SQLite serializa a los dos procesos, así que el segundo lee el
máximo que dejó el primero. El contador en memoria pasa a ser una caché de lectura, o se va.

**Esto es un cambio en el núcleo compartido, no en el paquete portátil**, y hay que hacerlo
primero: mientras el lamport viva en memoria, dos escritores producen un orden de conflictos
incorrecto, y eso no se nota hasta que dos máquinas disputan el mismo `topic_key`.

> El costo es un `SELECT MAX` por escritura. Sobre una columna indexada y con el lock ya
> tomado, es despreciable comparado con el `save()` que lo rodea (redacción + hash + FTS).
> Hay que medirlo igual antes de darlo por gratis.

### 6.2 Quién sincroniza

La cola es el `mutation_log`, y ya existe. Una escritura sin Nest **encola** igual que una con
Nest. Lo que cambia es quién la drena:

- **Nest corriendo** → el daemon, como siempre.
- **Sin Nest, paquete sin cuenta** → nadie. Queda en la cola local hasta que aparezca un
  daemon. No se pierde nada y el `status` lo dice: *"12 memorias esperando para sincronizar —
  conectá tu cuenta o abrí Nest"*.
- **Sin Nest, paquete con cuenta** → el paquete, con un `push` al final de cada operación de
  escritura y un `pull` perezoso al arrancar. **No corre un daemon de fondo**: un `npx` no deja
  procesos vivos, y un agente de MCP tiene un ciclo de vida corto y conocido.

**Dos daemons no pueden correr sobre la misma cuenta y la misma base.** Si el paquete detecta
un socket de Nest vivo, no sincroniza él: delega (§5.1). Es la misma regla que hoy, dicha para
un actor más.

> **Nota de campo, 2026-09-13:** la app instalada (`/Applications/Nest.app`) y un build de
> desarrollo corriendo a la vez comparten `~/.raven-nest` y ponen **dos daemons sobre la misma
> cuenta**. O sea que este riesgo ya existe hoy, sin paquete portátil de por medio, y no hay
> nada que lo detecte. El §6.3 lo cierra para todos los casos, no sólo para el nuevo.

### 6.3 El candado

Un archivo de lock por base, con el PID y el momento adentro, que toma quien va a sincronizar.
Quien lo encuentra vivo, no sincroniza —escribe local y encola— y lo dice. Un lock con un PID
que ya no existe se considera muerto y se toma.

Es la única pieza de coordinación nueva, y cubre tres casos que hoy están abiertos: dos Nest,
Nest + paquete, y dos paquetes.

---

## 7. Enrolarse como dispositivo

El camino corto para lo que el §2 hace inevitable.

```
$ npx nest-memory login
→ Abrí esto para conectar tu cuenta:  https://…/link?code=WXYZ-1234
→ Esperando…

✓ Cuenta conectada: gerodc06@gmail.com (plan Cloud)

Esta máquina todavía no puede leer tus memorias cifradas.
Su huella es:  7K4M-92QP-XR3T

Autorizala desde Nest en otra máquina (Memories → Encryption → Authorize),
comparando esa huella. O usá tu código de recuperación:

  npx nest-memory recover
```

Tres cosas de ese texto son decisiones, no redacción:

1. **La huella se muestra siempre**, no sólo cuando falla. Es el mecanismo que hace visible la
   sustitución de clave (el ataque que la tercera revisión encontró y que se cerró del lado
   del servidor): el usuario compara dos strings cortos antes de autorizar.
2. **El código de recuperación es el camino B, no el principal.** Usarlo es gastar la única
   copia de emergencia; se ofrece, pero segundo.
3. **Lo que no puede leer, lo dice.** Bajar filas cifradas y mostrarlas vacías, o peor, no
   mostrarlas, es el modo de falla que más confianza destruye. El `status` cuenta las memorias
   ilegibles, igual que la tarjeta de Nest.

Mientras no esté autorizado, el paquete **funciona igual para lo local**: guarda, busca y lee
lo de esta máquina. Lo cifrado de la nube no lo puede abrir, y no pretende.

---

## 8. Qué te da Nest que el paquete no

La pregunta que el §1 dejó abierta, respondida en concreto. Nada de esta lista es una
capacidad recortada a propósito en el paquete: son cosas que **no tienen sentido sin una
aplicación**.

| | Nest | Paquete portátil |
|---|---|---|
| Guardar, buscar, leer, corregir | Sí | **Sí** |
| El grafo | Interactivo, 3D, con el buscador que resalta | En texto (`memory_graph` ya lo devuelve así) |
| Autorizar otra máquina | Con la huella al lado, en dos clics | Mostrando la huella para que la autorices desde Nest |
| Activar el cifrado por primera vez | Sí, con el código de recuperación en pantalla | **No.** Generar la maestra de la cuenta es un acto que necesita una pantalla que le muestre al usuario el código una única vez |
| El vault de Markdown (Obsidian) | Sí | No |
| Importar `CLAUDE.md` / engram | Sí | No |
| Resúmenes de sesión automáticos | Sí (hooks de `SessionStart`/`Stop`) | No: no hay quién los enganche |
| Compartir con el equipo | Sí | Sólo promover una memoria ya guardada |
| Varias cuentas de IA a la vez | Sí | Una |
| Sincronizar de fondo | Continuo | Al escribir y al arrancar |

La lectura honesta de esa tabla: **el paquete es una memoria completa para una persona en una
máquina**; Nest es lo que la convierte en la memoria de todo tu trabajo, en todas tus máquinas,
con todos tus agentes. El que sólo quiere Cursor con contexto está bien servido, y ése es el
punto.

---

## 9. Qué se publica

Un solo paquete, `nest-memory`, con dos binarios (`nest-memory` y el shim MCP) y la extensión
como artefacto aparte que lo depende.

- **Sin telemetría.** Nest promete no medir el uso y el paquete no puede ser la puerta
  trasera de eso.
- **El paquete no lleva secretos.** La URL del servicio es configurable y tiene un default; el
  token lo pone el usuario y se guarda con los permisos del SO (0600), igual que hoy.
- **Versionado contra el esquema.** El paquete declara qué `SCHEMA_VERSION` entiende y se
  niega a abrir una base más nueva, igual que hace el store hoy (que lanza en vez de escribir
  contra un esquema que no conoce). Una base vieja la migra.

---

## 10. Fuera de alcance

- **Activar el cifrado desde el paquete** (§8). Necesita mostrar el código de recuperación una
  vez y asegurarse de que el usuario lo guardó; eso es una pantalla.
- **Un daemon de fondo en el paquete.** Sincroniza al escribir y al arrancar. Un servicio
  permanente es otro producto y otra conversación sobre el consumo.
- **Bidireccional con el vault de Markdown.** Ya estaba fuera de alcance y sigue.
- **Reescribir la app de Electron sobre `node:sqlite`.** El adaptador vive en el paquete; la
  app sigue con `better-sqlite3` hasta que haya una razón.

---

## 11. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| P-R1 | **El lamport desde la base sale caro.** Un `SELECT MAX` por escritura, en el camino caliente | Medirlo antes de dar el cambio por bueno. Si pesa, un contador en una fila de `meta` actualizado en la misma transacción da lo mismo con un índice de una fila |
| P-R2 | **`.transaction()` a mano deja transacciones abiertas.** better-sqlite3 hace rollback solo ante excepción; el reemplazo tiene que replicarlo, y con la base compartida una transacción abierta bloquea al otro escritor | El adaptador envuelve en try/catch con ROLLBACK y tiene su propio test de "una excepción adentro no deja la base bloqueada" |
| P-R3 | **Dos bases en la misma máquina.** El paquete crea la suya sin ver la de Nest y el usuario termina con dos memorias distintas | Buscar la de Nest primero (§5.2), y que `status` diga siempre cuál está usando y dónde está |
| P-R4 | **`node:sqlite` cambia de API.** Es reciente | Está detrás del adaptador: un solo archivo que tocar. Y el pin de `engines.node` del paquete dice desde qué versión |
| P-R5 | **El usuario cree que tiene sus memorias y no las tiene.** Enrolado pero no autorizado, bajando ciphertext que no puede abrir | `status` y la extensión lo dicen con un número, no con un ícono. Es el mismo contador de ilegibles que ya existe |
| P-R6 | **La extensión se desactualiza respecto de la CLI** | La extensión depende del paquete por versión exacta y no reimplementa nada |

---

## 12. Orden de implementación

Cada paso deja algo que funciona y se puede probar solo.

1. **El lamport desde la base** (§6.1). Es del núcleo compartido y hay que hacerlo primero:
   sin esto, dos escritores dan un orden de conflictos incorrecto. Con su medición al lado.
2. **El candado de sincronización** (§6.3). Cierra el caso que ya existe hoy con dos Nest.
3. **El adaptador de `node:sqlite`** (§4), con el test de la transacción abortada.
   **Hecho** (2026-09-18): `electron/sqlite-sin-compilar.ts`, 22 tests. Vive en `electron/`
   —y no en un directorio nuevo— porque ahí lo alcanzan el typecheck y los tests de CI,
   igual que `memory-protocol.ts` y `memory-merge.ts`, que también son núcleo compartido sin
   dependencias. El paso 4 lo mueve o lo importa desde el paquete.
4. **El paquete, en modo local** (§5.2): leer y escribir la base de esta máquina, sin nube.
   Ya es útil y ya es demostrable.
5. **`setup`** (§3.1): la detección y escritura de configs. Es lo que lo vuelve instalable.
   **Núcleo hecho** (2026-09-18): `electron/setup-del-paquete.ts`, 38 tests — el catálogo de
   los 7 destinos, el plan de `setup` y el de `--undo`, y las transformaciones de JSON, JSONC
   y TOML, todo puro. **Falta** la capa que escribe a disco y el parseo de argumentos, que
   dependen de que exista el paquete (paso 4).

   Dos cosas que este paso descubrió y que el spec no decía:
   - **VS Code anida bajo `servers`, no bajo `mcpServers`** como los otros seis. Verificado
     contra su documentación. Una entrada con la clave equivocada no da error: el editor la
     ignora y el usuario espera una memoria que nunca llega. Cursor sí usa `mcpServers`, en
     `~/.cursor/mcp.json`.
   - **Detectar por archivo de config no alcanza.** Un editor recién instalado todavía no
     guardó ningún ajuste, así que se vería ausente justo cuando `setup` más sirve. La
     detección mira el archivo O su directorio.
6. **La nube** (§7): login, enrolamiento, autorización, pull con descifrado, push.
   **El `login` tenía un agujero de diseño**: el §7 lo dibuja del lado del cliente, pero el
   servicio no tenía nada que lo sostuviera. `/v1/devices` exige un JWT de Supabase —o sea
   una sesión de navegador— y un `npx` en una terminal remota no tiene dónde abrirlo. No
   existía ningún endpoint de vinculación por código.

   **Hecho** (2026-09-18): las dos mitades del login.
   - Servidor: `server/migrations/008_link_requests.sql` y `server/src/link.ts`, con
     `/v1/link/start`, `/v1/link/approve` y `/v1/link/poll`. 25 tests contra Postgres real.
   - Cliente: `electron/login-del-paquete.ts`, el bucle de espera, puro. 12 tests.

   - La cara que aprueba: `src/components/LinkDeviceCard.tsx`, en el overlay Memories al
     lado de la tarjeta de cifrado, más `memory:linkApprove` en main. 19 tests.
   - El sync de una sola pasada: `electron/sync-del-paquete.ts`, 8 tests. **No reimplementa
     nada** — `MemoryDaemon.pull()` y `.push()` ya eran públicos, así que el paquete arma el
     daemon con las mismas dependencias y no llama a `start()`. Un test de tipos fija que el
     daemon real cumple la interfaz, para que la premisa no se rompa en silencio.

   - El enrolamiento: `electron/llavero-del-sistema.ts` (23 tests, 5 contra el llavero REAL
     de macOS) y `electron/enrolamiento-del-paquete.ts` (8 tests).

   **El hueco que nadie había mirado**: el paquete corre bajo Node pelado y no tiene
   `electron.safeStorage`, y `memory-key-store.ts` **lanza** si no hay cifrado del sistema
   —«guardar una maestra en texto plano sería peor que no cifrar nada»—. O sea que sin
   resolver eso, el paquete no podía guardar ninguna clave. La salida es la misma que usa
   Electron por debajo, pero por línea de comandos: el llavero del SO guarda una clave al
   azar y con ella se cifra `keys.bin` con AES-256-GCM. Verificado contra el `security` real
   de macOS; Windows (DPAPI) y Linux (`secret-tool`) están escritos y no ejecutados, y si
   alguno está mal `disponible()` da `false` y el paquete queda en modo local, que es la
   falla segura.

   **Lo que se creía infraestructura era código** (2026-09-21). El pendiente decía «falta
   `SUPABASE_JWT_SECRET`» y era falso: Supabase movió la firma de los tokens de sesión de un
   secreto simétrico compartido a una clave por proyecto, así que los que emite el proyecto
   de Nest vienen con `alg: ES256` y un `kid` que resuelve contra
   `/auth/v1/.well-known/jwks.json`. `verifySupabaseJwt` sólo aceptaba HS256 → `/v1/devices` y
   `/v1/link/approve` rechazaban **todo** login legítimo, y ningún valor de ese secreto lo
   arreglaba porque ese secreto ya no firma nada.

   Resuelto en `server/src/jwks.ts` (las claves públicas, cacheadas) y
   `verificarJwtDeSupabase` en `devices.ts` (los dos algoritmos, eligiendo por lo que el
   servicio TIENE y no por lo que el token dice). 26 tests. `SUPABASE_URL` ya estaba seteada
   en Railway, así que no hizo falta ningún secreto nuevo.
7. **La extensión** (§3.3), que a esta altura es una cara sobre lo anterior.
   **Núcleo hecho** (2026-09-18): `electron/panel-de-la-extension.ts`, 13 tests — qué
   titular, qué detalle y qué acción ofrece el panel dado el estado del mundo. Es lo único
   propio que tiene la extensión, y se prueba sin levantar un editor.

   De paso se cerró lo que los pasos 4 y 5 habían dejado colgando, que es de lo que la
   extensión depende para existir:
   - `electron/aplicar-setup.ts` (10 tests contra un directorio temporal real): escribe el
     plan a disco, atómico, y un destino que falla no aborta a los demás.
   - `electron/argumentos-del-paquete.ts` (14 tests): el parseo de `argv`.

   **El paquete existe y corre** (`packages/nest-memory`): los siete comandos están
   cableados. `setup`, `status`, `search`, `doctor` y `mcp` andan sin cuenta ni red; `login`
   y `recover` hablan con el servicio que diga `NEST_MEMORY_SYNC_URL`.

   **El `login` se probó de punta a punta el 2026-09-18** contra el servicio corriendo en
   local con Postgres real: la CLI mostró el código, la aprobación con un JWT lo ató, la CLI
   levantó el token y lo guardó cifrado con 0600, y quedó la fila en `devices`. Es la primera
   vez que ese camino se recorre entero.

   **La extensión existe** (`packages/nest-memory-vscode`): se arma el `.vsix` sin `vsce`
   —con `adm-zip`, que ya era dependencia— y **VS Code lo instala**, verificado con su propio
   CLI (`code --install-extension` → aparece como `nest.nest-memory`, con el `main` apuntando
   a un archivo que existe). Lo único que no se puede probar desde acá es que la ventana se
   dibuje: por eso el único archivo que importa `vscode` tiene cinco líneas y todo lo que
   decide algo vive en `extension-vscode.ts` (12 tests) y `panel-de-la-extension.ts` (13).

   **El servicio desplegado ya corre esta versión** (2026-09-21): `/v1/link/start` emite
   códigos contra el Postgres de Railway (migración 008 aplicada al arrancar) y el login se
   verifica por JWKS.

   **La extensión ya se prueba en un editor de verdad** (2026-09-21): `npm run test:vscode`
   levanta el VS Code instalado con `--extensionDevelopmentPath` y `--extensionTestsPath` —sin
   `@vscode/test-electron` y sin descargar nada— y comprueba que active, que registre los dos
   comandos, que escriba el `mcp.json` bajo `servers` y que `status` deje un webview abierto.
   Dos trampas que sólo aparecieron corriéndolo: el `code` del PATH vuelve con 0 sin haber
   corrido nada, y redirigir `HOME` para aislar la prueba abre un modal del llavero de macOS
   que espera un clic.

   **Falta** recorrer el `login` entero contra el servicio desplegado —o sea, correr
   `npx nest-memory login` y aprobar desde Nest, que es la parte que necesita una sesión de
   usuario de verdad. Y lo que la P-3 ya recomendaba: no publicar hasta que la CLI esté en uso.

---

## 13. Preguntas abiertas

**P-1 — ¿El paquete se llama `nest-memory` o algo que no dependa del nombre del producto?**
Si mañana Nest cambia de nombre, el paquete queda con el viejo y renombrar un paquete de npm
que ya tiene instalaciones es feo. **Recomendación**: `nest-memory`, y asumir el costo. Que el
nombre del paquete sea el del producto es parte de que la gente lo encuentre.

**P-2 — ¿El modo local sin cuenta es para siempre gratis?** Hoy la memoria local no tiene
límite y no necesita cuenta. El paquete portátil hereda eso, lo que significa que alguien puede
usarlo sin pagar nunca. **Recomendación**: sí, y decirlo fuerte. Es el mismo argumento del
plan gratuito — lo que se paga es que viaje entre máquinas, no que exista.

**P-3 — ¿La extensión va al marketplace de VS Code o se instala por `.vsix`?** El marketplace
es la única forma de que la encuentren, y trae revisión, política de publicación, y un nombre
público que hay que sostener. **Recomendación**: marketplace, pero después de que la CLI esté
en uso — la extensión sin la CLI probada es una cara sobre algo que no se validó.

**P-4 — ¿Qué pasa si el usuario borra la cuenta de la nube desde Nest y el paquete sigue
instalado en otra máquina?** Hoy el `delete-data` borra la copia de nube y no toca lo local.
El paquete se quedaría con su copia local, legítimamente. **Recomendación**: que sea eso, y que
el `status` lo diga. Borrar la nube no es borrar lo tuyo, y nunca lo fue.
