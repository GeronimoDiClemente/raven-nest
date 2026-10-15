# Cifrado de memoria de equipo (`scope: 'team'`)

## 1. Por qué ahora

`docs/superpowers/specs/2026-09-09-nest-memories-plugin-y-cifrado.md` §9.1 dejó explícitamente
afuera el cifrado de `scope: 'team'` y lo documentó como decisión consciente — `server/README.md`
todavía lo anuncia así. Gero pidió retomarlo el 2026-10-14 para destrabar el camino a clientes
corporativos: el objetivo no es sólo simetría con la memoria personal, es **compliance** — poder
decirle a un cliente enterprise que ni Nest ni quien tenga acceso al Postgres compartido de
Railway puede leer su memoria de equipo, hoy en el servicio compartido y mañana en una instancia
Railway dedicada para ese cliente. El modelo de amenaza para v1 cubre las dos cosas: Nest/el
operador del servicio, y cualquier filtración cruzada entre equipos que compartan la misma
instancia — no asume todavía que el cliente tenga su propio servidor.

## 2. Modelo de clave — reusa la infraestructura personal, no inventa una nueva

Una clave maestra simétrica **por equipo**, envuelta **por device** (no por persona) con la MISMA
clave pública X25519 que cada device ya publica en `device_keys` al activar el cifrado personal
(`server/src/keys.ts`). No hay un segundo par de claves por device: el cifrado de equipo en un
device **depende de que ese device ya tenga el cifrado personal activo** — es un prerrequisito
explícito, no un detalle de implementación a esconder en la UI.

Dos tablas nuevas, sin tocar `users`/`key_wraps`/`device_keys` (schema real: migraciones
`009_team_keys.sql` y `010_team_key_verifier.sql`):

```sql
create table team_keys (
  team_id      uuid primary key,
  activated_by uuid not null references users(id),
  activated_at timestamptz not null default now(),
  verifier     text            -- 010: SHA-256 de la prueba de posesión (§2.1)
);

-- Una fila por destinatario: `slot` es el device_id como texto o el literal 'recovery', mismo
-- espacio de nombres que `key_wraps` personal.
create table team_key_wraps (
  team_id    uuid not null references team_keys(team_id) on delete cascade,
  slot       text not null,
  kind       text not null check (kind in ('device', 'recovery')),
  wrapped    text not null,
  wrap_meta  jsonb,
  created_at timestamptz not null default now(),
  primary key (team_id, slot)
);
```

Sin épocas: v1 no soporta rotar la clave de equipo (§8). Si hiciera falta rotación v2, se suma
una columna `key_epoch` entonces — no se paga ese costo ahora.

### 2.1 Prueba de posesión (Task 15, C2 de la review final)

Ser `leader` no prueba tener la clave: el rol se transfiere y la clave no (§6), así que existe
por diseño un leader sin maestra. Sin una prueba, ese leader podía pisar la envoltura de un
device con SU maestra (sellar no requiere ningún secreto, y el device la readopta solo al
arrancar) o re-cifrar el histórico con basura. Mismo agujero que `rotate_proof` cerró en
personal, con una diferencia:

- `proof = HMAC-SHA256(maestra, "nest-memory/team-proof-v1/<team_id>")` — sólo la calcula quien
  tiene la maestra; el `team_id` en la etiqueta hace que no sirva para otro equipo.
- `verifier = SHA-256(proof)` — lo que guarda `team_keys.verifier` al activar.
- `authorize` y `recrypt` exigen `proof` y comparan su hash contra el verificador
  (`403 must_hold_team_key`). Un equipo sin verificador falla cerrado.
- El `GET /v1/teams/key` le devuelve el verificador a todo miembro activo, y el cliente
  rechaza (`TeamKeyMismatchError`) toda maestra desenvuelta cuyo verificador no coincida, antes
  de adoptarla: al adoptar, en la readopción de arranque y al recuperar con el código.

Por eso prueba y verificador son DOS valores: en personal son el mismo porque el servidor no lo
muestra nunca; acá se muestra, y si fueran iguales un leader sin clave lo leería y lo reenviaría.
Límite que no cambia: quien tenga escritura sobre la base puede reemplazar envoltura y verificador
juntos; contra eso están las huellas (de la maestra y de la clave pública), igual que en personal.

## 3. Activación — sólo el `leader`

Gateado por rol: el servidor verifica `team_memberships.role = 'leader' AND status = 'active'`
para ese `team_id` (el espejo que ya sincroniza `registerDevice()`, Team Memory Layer 1 Parte 2).
Cualquier otro rol que llame a activar recibe `403 leader_required`.

Flujo:

1. El client del leader genera la clave maestra del equipo localmente.
2. Envuelve esa clave con la pública de su PROPIO device (mismo mecanismo de sellado que
   `enrollDeviceKey`/`publishWraps` ya usan para personal).
3. Genera el **código de recuperación de equipo** (§6) y se lo muestra al leader UNA vez.
4. Llama `POST /v1/teams/key/activate` (`team_id` en el body) con el wrap propio, la envoltura
   de recuperación y el `verifier` (§2.1). El servidor exige exactamente esas dos envolturas —un
   slot `device` que sea el device que llama, y el `recovery`— y crea la fila en `team_keys` y
   las dos en `team_key_wraps`, en una sola transacción.
5. El client dispara solo la migración del §4 (Task 15, I3): antes dependía de que el leader
   encontrara un botón, y si no lo tocaba lo viejo quedaba en claro con la tarjeta diciendo
   "Team encryption on".

## 4. Migración retroactiva de lo ya subido en claro

Gero eligió re-cifrar lo existente al activar (no dejarlo en claro para siempre). Esto es lo más
nuevo y lo más delicado del diseño, así que se marca aparte.

**Por qué es delicado**: hoy nadie reescribe el contenido de una fila que no escribió — el `push`
normal es por autor, idempotente por `(device_id, seq)`. La migración necesita que el leader
reescriba `title`/`content`/`tags` de observaciones subidas por OTROS miembros del equipo. Se
acota con un endpoint dedicado, nunca el `push` genérico:

`POST /v1/teams/key/recrypt` — gateado a `leader` igual que la activación, y con `proof` (§2.1).
Body: `{ team_id, proof, items: [{ sync_id, title, content, tags, content_hash, origin_account,
lamport }] }` (ya cifrados por el client del leader con la clave de equipo nueva; `content` puede
ser `null`, un tombstone). El servidor, por cada `sync_id`, en una transacción corta con la fila
bloqueada:

- Verifica que la fila exista, que su `project.team_id` sea exactamente el equipo, y que
  `scope = 'team'` — si no, `not_found_in_team`, rechazo individual (no aborta el lote).
- Si ya está sellada (`title` con `nmc1:`): `already_sealed`. Si su `lamport` no es el que manda
  el cliente —se editó después de que el leader la leyó—: `stale`. Las dos para no pisar una
  edición más nueva con contenido viejo (Task 15, I1).
- Sobreescribe únicamente `title`, `content`, `tags`, `content_hash`, `origin_account`.
- Bumpea `project_seq` para que el resto de los devices del equipo la vuelva a bajar. El
  `lamport` NO se toca: re-cifrar no es editar, y subirlo haría ganar esta versión en LWW contra
  una edición concurrente.
- Nunca toca `scope`, `type`, `author_id`, ni ningún otro campo de metadata/autoría.

**Qué migrar lo dice el servidor** (Task 15, C1): `GET /v1/teams/key/recrypt-pending?team_id=
&after=` (sólo leader) devuelve `{ total, items }` con las filas `scope: 'team'` de CUALQUIER
proyecto del equipo cuyo `title` o `content` no empiece con `nmc1:`, con su contenido y su
`lamport`, paginado por `sync_id`. La primera versión armaba el lote con la base LOCAL del leader
filtrada por su `projects.team_id` local, que sólo existe para lo que ÉL compartió: lo que un
member compartió desde su copia quedaba en claro para siempre. Buscar local por `sync_id` tampoco
alcanza — el pull sólo baja filas de los `project_key` que el device ya tiene, así que una fila de
un repo que el leader no clonó no le llega nunca. Devolver el contenido no amplía lo que el leader
puede leer (es miembro activo, y el pull ya le sirve cualquier fila de equipo del equipo), y en el
servidor está en claro de todos modos: es exactamente lo que se va a sellar. El client sella esa
versión, la manda con su `lamport` en lotes de hasta 200 filas o 1 MiB, reintenta ante 429
(`Retry-After`; `recrypt`/`recrypt-pending` tienen su propio limiter, 60/min por device), y
devuelve lo aplicado aunque falle a mitad. La migración está terminada cuando `total` da 0, y la
tarjeta no dice otra cosa hasta entonces.

## 5. Un miembro nuevo se suma a un equipo ya cifrado

Mismo patrón que hoy entre dos devices de una cuenta personal, pero cruzando personas, y con la
decisión explícita de Gero: **sólo el leader autoriza**, nunca cualquier miembro ya autorizado.

1. El nuevo member entra al equipo (invite + `accept_invite`, ya existe desde antes). Su client ve
   `team_keys` activo para ese equipo pero sin wrap para su device → la memoria de equipo de ese
   proyecto se muestra como pendiente de autorización (mismo tratamiento visual que hoy una fila
   `nmc1:` personal que este device no puede abrir todavía).
2. El leader ve, la próxima vez que abre Nest, una lista de devices de su equipo sin wrap
   (`GET /v1/teams/:id/key` responde `pendingDevices`, mismo shape que `getKeyState.devices` hoy).
3. El leader autoriza con un click por device: `POST /v1/teams/key/authorize` con el wrap
   nuevo y la `proof` (§2.1), gateado a `leader`. Antes compara la huella de la clave pública del
   device con la que el miembro le dicta por otro canal, y esa huella viaja con el pedido: si la
   pública que el client vuelve a pedir para envolver no da la MISMA huella, no se envuelve nada
   (Task 15, I4 — antes se envolvía para la pública de ese segundo fetch, que el servidor podía
   cambiar después de mostrar la real). Lo mismo vale desde Task 15 para autorizar en personal.
4. Un device sin cifrado personal no publica su clave pública, así que nunca aparece en la lista
   del leader: la tarjeta le pide activar el personal primero en vez de mandarlo a esperar.
   Recuperar con el código sólo lo ofrece a un leader: termina en auto-autorizarse, y eso el
   servidor sólo se lo deja a un leader.

**Consecuencia aceptada explícitamente**: si el leader no abre Nest, el miembro nuevo no ve
memoria de equipo hasta que lo haga. No hay autorización por ningún otro miembro en v1.

## 6. Código de recuperación de equipo

Mismo mecanismo que el personal: un slot `recovery` en `team_key_wraps`, sellado con una clave
derivada del código que se le muestra al leader UNA sola vez al activar (§3, paso 3). Si el leader
pierde todos sus devices sin haber guardado ese código, la memoria de equipo cifrada de ese equipo
queda irrecuperable para siempre — mismo trade-off ya aceptado y documentado para la memoria
personal (`_global` o no, el diseño no esconde esto). Transferir el rol de `leader` a otro miembro
no transfiere la clave: ese nuevo leader sigue necesitando que alguien con la clave lo autorice, o
el código de recuperación, como cualquier otro device nuevo.

## 7. Push / pull — qué cambia en el wire

Nada en el contrato de autorización. `scope` sigue viajando en claro (el servidor lo necesita para
decidir quién puede leer qué, como hoy — cifrarlo rompería el modelo de permisos, misma razón que
ya vale para la memoria personal). Lo único que cambia: si el equipo tiene `team_keys` activo, el
client cifra `title`/`content`/`tags` con la clave de equipo antes de subir, con el mismo prefijo
`nmc1:` que ya usa el cifrado personal — un solo chequeo (`¿empieza con nmc1:?`) sigue sirviendo
para los dos casos, sin bifurcar el código de pull. Cuota, límites, `team_scope_not_allowed`,
`project_not_shared_with_team`: sin cambios, ven ciphertext en vez de texto en claro.

**Agregado en Task 14 (2026-10-15).** Tres cambios de wire, todos ADITIVOS (un cliente viejo
ignora los campos nuevos):

- `POST /v1/sync/pull`: toda fila `scope: 'team'` trae `team_id` (el `projects.team_id` del
  proyecto de ORIGEN en el servidor). Las filas `personal`/`project` no traen el campo. El cliente
  elige con esto la clave de equipo para abrir la fila (`EnvelopeContext.teamKeysById`); su
  `projects.team_id` local sólo existe si ÉL compartió su copia, y un compañero no tiene por qué
  haberlo hecho. Sin el campo (servicio viejo) se cae al `project_key` local, como antes.
- `GET /v1/sync/status`: `encrypted_teams: [{ team_id, has_wrap }]` — los equipos con
  `team_keys` donde quien llama es miembro ACTIVO, y si ESTE device tiene envoltura. Sin época
  (§8: v1 no rota). Y cada proyecto del roster trae su `team_id` (o `null`), para que la OTRA
  máquina de quien compartió sepa a qué equipo van sus filas de equipo.
- `POST /v1/sync/push`: rechazo nuevo por mutación, `team_encryption_required`, REVERSIBLE:
  una fila `scope: 'team'` cuyo título, contenido o tags no vienen con `nmc1:` para un proyecto
  cuyo equipo tiene `team_keys`. El servidor no la guarda; el cliente la retiene hasta tener la
  clave y la vuelve a mandar sellada.

## 8. Fuera de alcance para v1 (decisión explícita, no olvido)

- **Rotación de la clave de equipo.** No hay épocas, no hay "sospecho que se filtró, regenerar".
  Si hace falta en v2, se suma `key_epoch` a `team_keys` entonces.
- **Re-cifrado al salir o ser expulsado un miembro.** Gero lo decidió explícitamente: salir corta
  memorias NUEVAS (la autorización por fila que ya existe hoy alcanza para eso) pero no invalida
  lo que ese miembro ya tiene localmente de antes — igual que cualquier documento compartido que
  alguien ya descargó. Esto reemplaza lo que §5.4 de la spec de personal/cifrado asumía ("sacarlo
  es rotarla y volver a envolverla"): se decidió NO pagar ese costo en v1.

## 9. Riesgos conocidos

1. **El leader es un punto único de autorización.** Un equipo sin leader activo (de vacaciones,
   dejó la empresa sin transferir el rol) no puede sumar miembros nuevos a la memoria cifrada
   hasta que alguien asuma `leader`. Mitigación: nada en v1 — es consistente con que sólo el
   leader puede activar/autorizar, decisión explícita de Gero.
2. **El endpoint de migración (`recrypt`) es la única vía del sistema donde alguien reescribe
   contenido ajeno.** Cualquier bug en el chequeo de `project.team_id`/`scope` ahí es un vector de
   sobreescritura cruzada. Necesita tests adversariales dedicados (un `sync_id` de OTRO equipo, un
   `sync_id` de scope personal, un `team_id` que no es el del caller) antes de mergear. Desde
   Task 15 además exige la prueba de la maestra (un leader sin clave no puede escribir basura),
   y rechaza lo ya sellado y lo editado después de leído (`already_sealed`, `stale`).
3. **La migración puede ser un lote grande** (todo el histórico de un equipo activo hace rato).
   Mismo techo de tamaño de batch que ya existe en `push.ts` (`batch_too_large`, 500 mutaciones)
   aplicaría acá también — paginar desde el client si un equipo supera eso.
4. **Ventana de texto en claro entre el arranque de la app y la readopción de la clave de
   equipo (encontrado en la ejecución, 2026-10-14).** La clave de equipo vive SÓLO en memoria
   (§2) — nada la persiste a disco — y lo único que la repuebla al abrir la app es el efecto
   de montaje de la tarjeta de UI (`TeamEncryptionCard`, Task 12). Si una mutación de equipo
   sale ANTES de que esa tarjeta se monte (la app arranca, un agente guarda algo de inmediato,
   el usuario nunca abrió el overlay Memories), `sealMutationPayload` no tiene `teamKeys` todavía
   y la sube EN CLARO — indistinguible, del lado del servidor, de un equipo que nunca activó el
   cifrado. Es la MISMA clase de bug que CLAUDE.md documenta para el cifrado personal ("el gate
   no se armaba nunca en la máquina que importa"), sin el gate fail-closed que el personal
   terminó necesitando (ahí se arma por `key_epoch` de `/v1/sync/status`, no por que el usuario
   abra el overlay). **Decisión explícita: se documenta y se difiere a v1.1, no se bloquea v1
   por esto.** Arreglarlo bien requiere que `sealMutationPayload` pueda distinguir "el equipo
   nunca cifró" (sube en claro, correcto) de "el equipo cifra pero ESTE device todavía no
   adoptó" (debería retener la mutación, mismo patrón reversible que ya usa
   `project_not_shared_with_team`) — eso es un cambio de diseño a Task 9, no un fix de una
   línea, y excede el alcance que esta ejecución puede resolver sin una decisión de producto
   nueva.

   **CERRADO en Task 14 (2026-10-15).** Cuatro capas, de afuera hacia adentro:
   1. *Saber, sin depender de la UI.* `status` trae `encrypted_teams` y el store lo recuerda en
      `meta` (`rememberEncryptedTeams`, nunca olvida, igual que `known_key_epoch`; en `meta` y
      no en una tabla nueva para no subir `SCHEMA_VERSION`). Una fila de equipo ilegible en el
      pull también lo enseña, sólo como provisorio y sólo contra un servicio viejo (ver los
      ajustes de la review, abajo) — y ya NO arma la época personal, que dejaba a un miembro sin
      cifrado personal con todo el push en `needs_key`.
   2. *Retener, no descartar.* `doPush` bloquea con `team_key_missing` toda fila `scope: 'team'`
      de un equipo que cifra si este device no tiene su clave (mismo mecanismo reversible que
      `project_not_shared_with_team`). `onTeamKeysChanged()` la libera al entrar la clave.
      El equipo sale de `projects.team_id` local, que `doStatus` ahora mantiene al día desde el
      roster. Con filas de equipo pendientes, el primer push espera al primer `status` aunque
      no haya gate personal cableado (el paquete portátil).
   3. *Achicar la ventana.* `main.ts` readopta solo, dentro del `status` de arranque
      (`readoptarClavesDeEquipo`, esperado con tope de 10s), toda clave con `has_wrap: true`,
      así que en el caso normal la clave está ANTES del pull y del push del primer drain. El
      gate queda para el device sin autorizar.
   4. *El servidor no guarda texto en claro* para un equipo con `team_keys`
      (`team_encryption_required`, decisión D1 de Gero).

   **Ajustes de la review de Tasks 13–14 (2026-10-15):**
   - *La fuente de verdad es el status.* Una fila de equipo ilegible ya no marca su equipo como
     cifrado si trae `team_id` (servicio nuevo): un proyecto re-compartido de T1 (cifra) a T2 (no
     cifra) sirve sus filas viejas como de T2, y T2 quedaba retenido para siempre. Contra un
     servicio viejo (sin `team_id` ni `encrypted_teams`) lo inferido entra como PROVISORIO
     (`meta.encrypted_team_ids_provisional`): arma el gate igual, también offline y en el
     arranque, pero el primer status con `encrypted_teams` lo reemplaza y devuelve a la cola lo
     retenido por él. Lo que dijo el servidor (status o rechazo) sigue sin olvidarse nunca.
   - *Un rechazo `team_encryption_required` enseña el equipo.* Con `team_id` local, el equipo
     queda confirmado y la fila retenida como `team_key_missing`: ya no se reenvía en claro en
     cada liberación. Sin `team_id` local queda como rechazo y el roster la devuelve al gate.
   - *El servidor mira todos los campos sellados* (`title`, `content`, `project_display_name`,
     `content_hash`, `origin_account` y los tags), no sólo título, contenido y tags.

   **Lo que queda abierto:** si el `projects.team_id` local está desactualizado dentro de la
   ventana de un `status` (se compartió desde otra máquina entre el status y el push), la fila
   viaja en claro por TLS y el servidor la rechaza SIN guardarla — el proceso del servidor la ve.
   **Misma ventana del lado del leader:** entre que el leader ACTIVA el cifrado de un equipo y
   el próximo `status` de cada device del equipo (hasta `next_poll_ms`: 5 min en los planes
   pagos), un device que todavía no sabe que el equipo cifra sube sus filas de equipo en claro
   por TLS; el servidor las rechaza sin guardarlas (`team_encryption_required`), y desde ese
   rechazo el device ya lo sabe y las retiene. Lo expuesto es lo que viaje en ESE primer push
   (un lote), no un goteo en cada ciclo. Cerrarla del todo exige que el servidor empuje el aviso (no hay
   canal push hoy) o que el cliente pida status antes de cada push de equipo.
   **Re-share entre equipos (de diseño, no arreglado):** si un proyecto compartido con T1, que
   cifra, se re-comparte con T2 (`share.ts` hace `update set team_id` sin chequeo), las filas ya
   selladas con la clave de T1 se sirven como de T2 y quedan ilegibles para todo miembro de T2
   que no tenga la de T1 — y el `team_id` de la fila ya no sirve para elegir la clave. Pide una
   decisión: prohibir el re-share de un proyecto con filas selladas, re-cifrarlas como parte del
   re-share, o guardar el equipo sellador por fila. Además, si el `team_id` local está
   desactualizado justo cuando llega un `team_encryption_required`, el equipo que se confirma es
   el local (el servidor no dice cuál): un falso positivo así deja ese equipo retenido.
   Y un cliente anterior a Task 14 que empuja a un equipo cifrado no conoce el rechazo nuevo: lo
   trata como terminal y esa fila no llega a la nube (sigue local). Las mutaciones retenidas por
   `team_key_missing` no tienen contador en la UI todavía.

## 10. Decisiones cerradas el 2026-10-14 (con Gero, antes de escribir el plan)

- Objetivo: compliance/enterprise, cubre Nest + otros tenants del servicio compartido (no sólo
  la instancia dedicada futura).
- Salir de un equipo corta memorias nuevas; NO re-cifra lo existente.
- El device depende de tener el cifrado personal activo — reusa su clave pública, no un par nuevo.
- Sólo el `leader` activa el cifrado de un equipo.
- Sólo el `leader` autoriza devices nuevos (no cualquier miembro ya autorizado).
- Al activar, lo ya subido en claro se re-cifra retroactivamente (no queda en claro para siempre).
- Hay código de recuperación de equipo, mismo mecanismo que el personal.
