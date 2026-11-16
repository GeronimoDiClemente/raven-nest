# Nest Memories — la pantalla propia y el plugin suelto

> Rama: `feat/nest-memories` (worktree `memory-smoke`, local, sin pushear)
> Fecha: 2026-09-09
> Construye sobre: `2026-09-08-team-memory-layer-2-design.md` (el hilo), `2026-08-26-memory-vault-design.md` (el motor de notas), `2026-08-31-memory-sync-backend-design.md` (el servidor)
> Evidencia externa: research de engram del 2026-09-09 (repo público, docs de cloud, datos de GitHub)

## 1. Qué es

Dos fases sobre lo que ya existe.

**Fase 1** — Nest deja de esconder la memoria en Settings y pasa a ser **la cara gráfica**
de esa memoria: una pantalla propia, tipo Obsidian, donde ves el grafo de nodos de lo que
los agentes aprendieron en un proyecto. El servidor propio es el estante donde eso vive,
en tiempo real.

**Fase 2** — el plugin de Nest Memories se despega de la app. Hoy, sin Nest abierta no hay
memoria ni siquiera local. Después, el plugin corre solo en cualquier CLI y Nest deja de
ser obligatoria.

En palabras del usuario que lo pidió:

> "La idea es mantener la funcionalidad de engram en el sentido de que localmente funcione
> de esa manera, pero la debilidad que tiene engram es que esa memoria se aloja en GitHub.
> Nosotros lo que buscamos es que esa memoria se aloje en un servidor, que es el servidor
> que montamos donde va a vivir esa memoria. Que Nest funcione como UI para mostrar el
> Obsidian, o sea la parte gráfica de esa memoria y que puedan ver los gráficos, los nodos
> de las distintas acciones de la memoria o de los features que se están manejando en un
> proyecto, que esa memoria se guarde en tiempo real en la nube que sería el servidor
> propio. Y después, como segundo paso una vez que eso ya esté funcionando, sería que el
> plugin de Nest sea exportable y que nosotros cobremos ese plugin por fuera de Nest, y
> que Nest deje de ser 100% necesario para usar el plugin de Nest Memories."

Y la dirección de producto, cerrada en la misma conversación:

> "seguimos con la idea de ser Nest Memories y ofrecer todo"

O sea: no somos una capa de compatibilidad de otro producto. Somos el producto.

## 2. Lo que se midió antes de diseñar

Todo lo de abajo está verificado en disco el 2026-09-09, no supuesto.

### 2.1 Lo que funciona

- Base real: `~/.raven-nest/memory/8afc1ed1.../memory.db`, **28 MB**, última escritura
  2026-09-08 22:19.
- **866 entradas** en el manifiesto del vault, **876 `.md`** en disco — cierra exacto
  (866 notas + README + 9 índices de proyecto).
- Captura repartida en 9 proyectos: `_global` 315, `sti-api` 172, `app-script-lan` 129,
  `raven-nest` 98, `sti-travel-console` 67, `airamed` 47, resto menor.
- Hooks provisionados (`SessionStart`, `Stop`, `PreCompact`) en el archivo aislado
  `.nest/memory-settings.json`, como manda el diseño de §2.5 (nunca en el
  `settings.json` del usuario).
- **"Tiempo real" ya está resuelto**: `memory-daemon.ts` empuja con debounce de 3 s
  (tope 30 s), más intervalo de 5 min y pull al enfocar la ventana. Una memoria escrita
  sube ~3 segundos después. No hay nada que construir ahí.

### 2.2 El fallo mudo — el hallazgo que ordena la fase 1

El MCP `nest_memory` murió al abrir la sesión del 2026-09-09 con `CONNECTION_CLOSED`.
Corriendo el hook a mano:

```
[nest-memory] NEST_MEMORY_SOCKET not set — memory is disabled for this session
exit 1
```

Confirmado: no había ninguna variable `NEST_*` en el entorno de esa sesión.

El mecanismo: `pty-manager.ts:231` setea `NEST_MEMORY_SOCKET` sólo para terminales
lanzadas desde adentro de Nest con el bridge vivo. La entrada del MCP, en cambio, vive
en `.claude.json` y **persiste**. Cuando los dos no coinciden, el agente reporta
`CONNECTION_CLOSED` — indistinguible de un server roto.

**El usuario nunca se entera de que la memoria está simplemente apagada para esa sesión.**
Una conversación entera puede correr sin memoria sin que nadie lo note. Este es el peor
modo de falla del sistema y hoy es completamente invisible.

### 2.3 Lo que no se pudo confirmar

- **El vault está 1,5 h atrás de la base**: DB escrita 22:19, vault regenerado 20:50.
  Falta determinar si se regenera solo o sólo a pedido.
- **`_conflicts/` y `_superseded/` están en 0.** Nada roto, pero ese camino **nunca se
  ejercitó de verdad** — y es el que depende de la segunda máquina, todavía pendiente.
- El contenido de las 866 notas no se auditó.

## 3. La competencia: engram

Research del 2026-09-09 sobre `Gentleman-Programming/engram`, el que el socio usa a diario
y que no estaba en el cuadro de competencia anterior.

**Ojo con el nombre**: hay al menos tres cosas llamadas Engram. La relevante es la de
Alan Buscaglia (Gentleman Programming). **No confundir** con la empresa que salió de
stealth el 2026-06-23 con USD 98M (General Catalyst, Kleiner Perkins, Sequoia, Karpathy
de ángel, valuada en 600M) — esa hace memoria empresarial por compresión de contexto y no
tiene nada que ver. Hay una tercera más (`rawcontext` / engram-mcp.com).

### 3.1 Qué son

- Marca registrada de Alan Buscaglia. Google Developer Expert, Microsoft MVP, +100K en
  YouTube. Creador citado en la landing: Juan Veron. 26 contributors.
- Repo creado el **2026-02-16** (7 meses). **6.450 stars**, 673 forks. Go, MIT.
- Pusheado el 2026-09-08, `v2.0.0-rc.9`. **v2 sale esta semana.**
- **Patrocinadores: ninguno.** Sin `FUNDING.yml`, sin sección de sponsors, la landing no
  lista uno solo. Su combustible es la audiencia del autor, no capital.

### 3.2 Su arquitectura de servidor

SQLite local sigue siendo la verdad; la nube es replicación opt-in **por proyecto**
(`engram cloud enroll <proyecto>`). Servidor Go (`internal/cloud/cloudserver`) contra
**Postgres** (`cloudstore`), imagen oficial en `ghcr.io/gentleman-programming/engram`.

Rutas: `/health`, `/sync/pull`, `/sync/pull/{chunkID}`, `/sync/push`,
`/sync/mutations/push`, `/sync/mutations/pull`, `/dashboard/*`.

El autosync (`internal/cloud/autosync/manager.go`) hace push de mutaciones pendientes,
pull por cursor, replay diferido, backoff con jitter, **lease en SQLite para que no corran
dos workers**, y estado degradado con `reason_code`. Chunks de 4 MiB, tope de push 8 MiB.

Está bien hecho. **En el motor estamos parejos**: ellos SQLite + FTS5, nosotros SQLite +
FTS5. Ninguno de los dos usa embeddings.

### 3.3 El hueco: no hay servicio gestionado

Engram Cloud es **self-hosted y nada más**. No existe oferta comercial, ni pricing, ni
signup, ni lista de espera, ni instancia administrada.

Verificado el 2026-09-09 en dos fuentes independientes: su `docs/engram-cloud/*` y su
propia landing, que lo dice sin vueltas — *"Engram Cloud is an opt-in, self-hosted
replication layer"* y *"Deploy on your infrastructure — Dokploy, Coolify, Portainer, or
bare VPS."*

Su *production checklist* tiene una tabla de responsabilidades donde Engram pone la API de
sync y el dashboard, y el operador pone todo lo demás:

- **7 variables de entorno obligatorias**: `ENGRAM_DATABASE_URL`, `ENGRAM_CLOUD_TOKEN`,
  `ENGRAM_CLOUD_ADMIN`, `ENGRAM_JWT_SECRET`, `ENGRAM_CLOUD_ALLOWED_PROJECTS`,
  `ENGRAM_CLOUD_HOST`, `ENGRAM_PORT`. Más `ENGRAM_CLOUD_TOKEN_PEPPER` para tokens
  gestionados.
- TLS con tu propio reverse proxy. Firewall e ingress tuyos.
- Postgres durable, backups, retención, copia off-host. Textual: *"Engram does not provide
  backup tooling or recovery objectives."*
- Ensayo de restore documentado, en entorno aislado.
- Rotación de secretos: *"Operators own rotation and redeployment; this guide does not
  provide a secret manager."*

Recomiendan Dokploy, Coolify, Portainer o un VPS. **Para tener memoria de equipo con
engram, alguien del equipo se convierte en sysadmin.**

### 3.4 Dónde ya les ganamos, sin escribir una línea

La columna "el operador se hace cargo" de su checklist **es literalmente el listado de
archivos de nuestro `server/src/`**: `backup.ts`, `pg-dump.ts`, `r2.ts`, `rate-limit.ts`,
`limits.ts`, `purge.ts`, `delete-data.ts`, `devices.ts`.

Y en rutas tenemos tres que ellos no: `/v1/projects/share`, `/v1/team_members`,
`/v1/devices/revoke`.

Diferencia estructural que no pueden cerrar sin rehacer el modelo: su servidor usa
**`ENGRAM_CLOUD_ALLOWED_PROJECTS`**, una lista blanca de proyectos **por deployment** — o
sea un deployment por equipo. Nosotros somos multi-tenant por cuenta desde el diseño.

**Conclusión estratégica: el producto no es el motor de memoria, es la operación.** Cada
ítem de su checklist es una línea de nuestro pitch. El diferencial no es "memoria de
equipo" — es **memoria de equipo sin que tengas que administrar nada**.

### 3.5 Lo incómodo, que no hay que tapar

1. 7 meses, 6.450 stars, 673 forks. Nosotros no tenemos distribución; ellos tienen 100K de
   audiencia propia.
2. Sacan v2 esta semana.
3. Su cliente es **un binario Go único, sin dependencias**, corriendo en Claude Code,
   OpenCode, Gemini CLI, Codex, Copilot, Cursor, Windsurf y Antigravity. Lo nuestro
   necesita Electron abierto. **Esa comparación nos gana hasta que exista la fase 2.**
4. Un MIT con esa audiencia puede agregar hosted cloud cuando quiera. Hoy no lo hacen
   porque no quieren cobrar, no porque no puedan.

Por (3) y (4), la fase 2 no es "más adelante": es la que define si competimos.

## 4. Las decisiones tomadas

Todas cerradas con el usuario el 2026-09-09.

1. **Memory es una vista dedicada, hermana de Personal.** No una sección adentro de
   `PersonalWorkspace`, y **no** una cuarta pestaña en `SidebarTabBar`. Razón: las 3
   pestañas (`REPO_TABS` = worktrees/explorer/tools, `HUB_TABS` = hub/explorer/tools) son
   todas del **repo abierto** y se intercambian por contexto; Memory es de la cuenta y del
   equipo, igual que Personal. Meterla ahí mezclaría dos ejes y dejaría 4 chips con label
   en una sidebar angosta, en los dos modos.
2. **Fila propia con estado inline** (la "mini vista" pedida). Colapsada: ícono + punto de
   color. Expandida: además el texto corto. Click abre la pantalla completa. Cero clicks
   para el estado, un click para todo lo demás.
3. **Vista única, sin chips de scope.** El grafo dibuja las ramas con autor y fecha, así
   que "tuyo vs del equipo" se ve por color en vez de por filtro. Además evita heredar el
   acoplamiento de `PersonalWorkspace.tsx:306`, donde elegir un equipo llama a
   `switchTeam` y cambia chat, presencia y stats de **toda la app**.
4. **Dirección C — "el hilo es la pantalla"** (decidida el 2026-09-08): el grafo al centro,
   sync y vault en una fila de estado chica arriba. Onda Obsidian.
5. **Los conflictos van en la fila de estado**, no escondidos en una carpeta.
6. **Camino B para la fase 2**: daemon headless propio, no cliente directo al servidor.
   Razón: local-first es la mitad de por qué esto le gana a lo hosteado, y el modelo de
   sync que ya existe (LWW + append-first) está diseñado para varias réplicas escribiendo.
7. **No copiamos el git-sync por chunks.** Es elegante, pero es la vía "arreglátelas vos"
   — justo el fallback que el research anterior identificó como el síntoma del problema.

## 5. Fase 1 — Nest es la cara, el servidor es el estante

### 5.1 La fila

Debajo de `PersonalItem` en `Sidebar.tsx`, mismo patrón visual
(`sidebar-item sidebar-item-panel`).

- Colapsada: ícono + punto de color. Verde `synced` · ámbar `pending` o conflictos ·
  gris desconectado · **rojo `memoria apagada en esta sesión`**.
- Expandida: además el texto corto — `142 items · synced`, `3 pending`, `2 conflicts`.
- Click abre el overlay de Memory.
- Variante opcional: hover → flyout chico con quota y "Open Memory", reusando el patrón
  del flyout de "More tools" (no es infra nueva).

⚠️ **Choque de nombre**: `ResourceBar` ya tiene una métrica llamada "Memory" que es la RAM.
Decidir si la fila queda "Memory" o pasa a "Memories" / "Knowledge" antes de escribirla.

### 5.2 La pantalla

Reusa lo que ya existe, mudándolo fuera de Settings: `MemoryHub`, `MemoryVaultCard`,
`TeamThreadPanel` y **`TeamThreadGraph`** (el grafo ya está construido, hoy colgado del
panel de Settings).

- **Fila de estado arriba**: estado de sync, quota, ruta del vault, contador de conflictos,
  y el indicador de sesión activa/apagada.
- **Grafo al centro**: nodos de observaciones por proyecto, coloreados por autor y
  frescura. Click en un nodo abre la nota.
- Sin chips de scope (decisión 3).

**Nota sobre el grafo, del research anterior**: la graph view **no sirve para navegar** —
lo dice hasta su defensora pública— pero **sí sirve para higiene**, y se degrada arriba de
200 nodos. La crítica más fuerte a Obsidian ("no muestra estado, ni prioridad, ni qué está
obsoleto") es nuestra oportunidad: Nest **sí** tiene estado y frescura, así que colorear
por eso convierte la crítica en feature. Con 866 notas en 9 proyectos, el grafo **tiene que
ser por proyecto**, nunca global.

### 5.3 Datos: qué hay sin IPC nuevo

Ya disponible: `state`, `itemCount`, `pendingCount`, `deviceId`, `quota {used_bytes,
max_bytes}` (todo de `useMemory`) · ramas del hilo con autor y fecha
(`memory:teamThread:read`) · ruta del vault (`memory:vault:getSettings` + `:reveal`).

Hace falta IPC nuevo para: **el estado de sesión activa/apagada** (§2.2), **el contador de
conflictos** y **qué se inyectó en esta sesión**.

### 5.4 El z-index

Con Memory como tercer overlay, el `1100` de `.teams-workspace--front` no alcanza. Escala
explícita: **1000 base / 1100 front / 1200 lo que se abra encima**. El test que hoy cubre
el orden **modela el CSS a mano**, así que una regresión pasaría sin fallar — hay que
mirarlo en la app real.

## 6. Fase 2 — el plugin suelto

### 6.1 Los tres bloqueantes, ubicados

1. `electron/memory-mcp/index.ts:23` — sin `NEST_MEMORY_SOCKET` hace `process.exit(1)`.
   No degrada: muere.
2. `electron/memory-mcp/client.ts` — es un cliente flaco de `net.connect` **a un socket
   local**. No sabe hablarle al servidor.
3. `electron/memory-store.ts` — la base es propiedad **exclusiva** del daemon en Electron
   main.

O sea: **sin la app abierta no hay memoria, ni siquiera local.**

### 6.2 La salida

Un **daemon headless** que el plugin levante solo, con la misma base y el mismo protocolo
de sync. La regla de convivencia es **un solo escritor**: el plugin detecta el daemon de
la app y le habla; si no hay app, levanta el suyo.

**Robado de engram**: el `autosync/manager.go` resuelve exactamente esto con un **lease en
SQLite** para evitar workers duplicados. Copiamos el patrón, no el código.

### 6.3 Lo que hay que decidir antes

Cobrar el plugin por fuera toca el pricing de 3 tiers cerrado el 2026-09-02 (Free /
Cloud $10 / Teams a medida). Un plugin vendido aparte es un cuarto producto. **Decisión
de negocio, pendiente, y va antes de la fase 2 — no después.**

## 7. Lo que le robamos a engram

Las tres entran en la fase 1, no en la 2.

### 7.1 "Fail loudly, no silent drops" — prioridad alta

Su regla de negocio, textual: *"if sync is blocked, fail loudly and visibly. No silent
drops."* Cada mutación bloqueada lleva `reason_code`, queda en cuarentena en
`sync_apply_deferred`, y `engram doctor` la reporta como finding.

Es exactamente lo contrario de §2.2, donde nuestro MCP muere mudo.

Concretamente:
- **`nest memory doctor`** — un comando/panel que lista todo lo que está bloqueado, con
  código de razón. Ya tenemos la mitad: `mutation_log.blocked_reason` existe
  (`memory-store.ts:1213`), y `REVERSIBLE_REJECTIONS` distingue terminal de reversible
  (`memory-daemon.ts:62`). Falta **mostrarlo**.
- **El estado de sesión** de §2.2 en la fila de la sidebar.

### 7.2 El lease en SQLite

Para la convivencia daemon-app / daemon-plugin de §6.2. Patrón ya probado en producción
por ellos.

### 7.3 Chunks con tope y ack por chunk

Un replay inicial grande se reanuda **desde la primera mutación sin confirmar**, no desde
cero. Ellos: chunks de 4 MiB, tope de 8 MiB, ack por chunk. Nosotros hoy mandamos de a
200 mutaciones (`pendingMutations(limit = 200)`) sin tope de bytes explícito por request.
Relevante para el import de §8.

## 8. Import y onboarding — que nadie arranque en 0

### 8.1 La cadena ya existe y cierra

Verificado el 2026-09-09:

1. **`runLocalMemoryImport`** corre en el **arranque de la app**, no sólo al conectar a la
   nube (se sacó del handler `memory:connect` justo para que un usuario Free también
   importe).
2. Dos importers: **markdown** (`CLAUDE.md`, `AGENTS.md`, `MEMORY.md`, más los `.md` de
   memoria por cuenta y por proyecto) y **engram** (`engram.db`, sobre una **copia
   read-only** — nunca abre la original, porque el MCP de engram puede tenerla tomada con
   WAL vivo).
3. Los dos escriben por `store.save()`, que en `memory-store.ts:852` hace
   **`appendMutation('upsert')`** → entra al `mutation_log`.
4. El daemon manda las pendientes de a 200, con el debounce de 3 s.
5. El servidor hace **upsert por `sync_id`**.

**La pieza que evita duplicar sin coordinar nada** es `deriveImportSyncId`: el id sale de
`sha256(projectKey:scope:type[:topic]:contentHash)` — determinístico y derivado del
contenido. La misma fila de engram importada en la PC y en la Mac produce **el mismo
`sync_id`**. Importar dos veces no rompe.

Y el viaje completo funciona en los dos sentidos: una fila de engram entra como observación
y **sale como nota `.md`** en el vault, con índice por proyecto y wikilinks. Entra desde
SQLite ajeno, sale como Obsidian.

**Esto es un activo comercial que hoy no se está contando: "traete tu engram" ya funciona.**

### 8.2 Los riesgos del onboarding

1. **La cuota.** El servidor rechaza con `project_limit_reached` y `quota_exceeded`, más un
   tope de 1 MB por observación (`push.ts:296`). Los dos primeros son **reversibles**: la
   mutación queda con `blocked_reason` y se reintenta sola cuando sube el plan. O sea que
   un usuario Free que importa una `engram.db` grande **no pierde nada, pero tampoco sube
   nada**. Ese momento tiene que decir *"importé 866, subí 50, 816 esperando plan"* — es el
   caso de uso más concreto de §7.1.
2. **`maxProjects`.** El vault de referencia tiene 9 proyectos. Si el plan permite menos, el
   import choca ahí antes que por bytes.
3. **Nunca se probó con volumen real.** El camino está testeado por unidad, pero el import
   engram → servidor de punta a punta no está entre los smokes cerrados. **Es el primer
   ítem del plan de implementación.**

## 9. Anexo — la jugada de compatibilidad (opcional, NO es el camino)

Se documenta porque puede interesarle a alguien, pero **la dirección elegida es ser Nest
Memories y ofrecer todo**, no ser una capa de compatibilidad de otro producto.

La idea: su protocolo es HTTP, está documentado y el repo es MIT. Se podría exponer un
endpoint compatible con `engram cloud`, de modo que un usuario haga
`engram cloud config --server https://<lo nuestro>` y sincronice contra nosotros **sin
cambiar de binario**. Ellos mantienen el cliente, nosotros cobramos el hosting que ellos no
quieren dar.

Por qué no es el camino:

- **Marca**: el código es MIT, pero Engram es marca registrada de Alan Buscaglia y el aviso
  de licencia dice explícitamente que no permite implicar endorsement oficial. Implementar
  un protocolo no es usar la marca, pero la comunicación tendría que ser muy prolija.
- **Dependencia**: quedás atado a un protocolo que mueven ellos, con v2 saliendo esta
  semana.
- **Posicionamiento**: nos define como el hosting de otro producto en vez de como producto.

Si alguna vez se retoma, el camino barato ya existe por otro lado: el importador de §8 lee
la `engram.db` directo, sin tocar su protocolo.

## 10. Alcance de la v1 (fase 1)

**Entra:**

- Fila Memory a nivel Personal con estado inline y punto de color.
- Overlay Memory con fila de estado + grafo por proyecto.
- Indicador de **sesión activa/apagada** (§2.2) — el único fallo hoy invisible.
- Contador de conflictos en la fila de estado.
- Escala de z-index explícita (1000 / 1100 / 1200).
- Mudanza de `MemoryHub`, `MemoryVaultCard`, `TeamThreadPanel` y `TeamThreadGraph` fuera
  de Settings.
- IPC nuevo: estado de sesión, conteo de conflictos, qué se inyectó en esta sesión.

**No entra (fase 2 o después):**

- El daemon headless y el plugin suelto.
- La decisión de pricing del plugin.
- Cualquier cosa del anexo §9.
- Embeddings o re-ranking. Hoy la inyección es por recencia (`store.context(projectKey,
  limit = 10)`) y la búsqueda es FTS5. Con el corpus actual alcanza; cuando crezca, se
  revisa.

## 11. Riesgos

1. **El código del rediseño nunca corrió en la app real** — sólo en jsdom. Los 5 pasos a
   mirar: la fila Personal encima del avatar · el selector cambiando de scope sin parpadeo
   · "Open team workspace" abriendo algo visible · el badge de invitaciones · Free → modal
   de upgrade. Memory suma un overlay más a ese mismo terreno sin verificar.
2. **El desfasaje del vault** (§2.3) puede significar que la pantalla muestre datos viejos.
   Hay que resolverlo antes de que el grafo sea la cara del producto.
3. **Conflictos nunca ejercitados** (§2.3): la pantalla va a mostrar un contador de algo
   que nunca ocurrió de verdad. El smoke con la segunda máquina es el que lo valida.
4. **Ventana competitiva**: v2 de engram sale esta semana y su cliente ya corre en 8
   agentes. Cada semana que la fase 2 no existe, la comparación técnica nos gana.
5. **Choque de nombre** con la métrica "Memory" de `ResourceBar` (§5.1).

## 12. Lo que queda abierto para Gero

1. El nombre de la fila: "Memory" vs "Memories" vs "Knowledge" (§5.1).
2. Si el plugin de la fase 2 se cobra aparte, y cómo entra en los 3 tiers (§6.3).
3. Si el smoke de import con volumen real se corre antes del plan o como primera tarea
   del plan (§8.2.3).
