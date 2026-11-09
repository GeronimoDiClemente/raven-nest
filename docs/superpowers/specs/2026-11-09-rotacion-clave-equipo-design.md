# Rotación de la clave de equipo al salir o ser expulsado un miembro

Estado: borrador de diseño, 2026-11-09. Sin código. Parte de
`docs/superpowers/specs/2026-10-14-cifrado-de-equipo-design.md` (en adelante "spec de equipo"),
que en §8 dejó **afuera de v1** tanto la rotación como el re-cifrado al salir un miembro. Este
documento mide qué cubre eso hoy de verdad y qué costaría cambiarlo.

## 1. Estado actual (con evidencia)

### 1.1 Qué pasa al sacar a un miembro

La cadena es: `DELETE`/`UPDATE` en `public.team_members` (Supabase) → trigger →
`POST /internal/memberships` → el servidor de sync reemplaza su espejo.

- El trigger dispara en insert/update/delete y manda el set COMPLETO de membresías activas del
  usuario: `supabase/migrations/20261102000000_membership_sync.sql:45-53` y `:75-106`.
- El servidor borra TODO el espejo del usuario y vuelve a insertar sólo lo activo:
  `server/src/membership-sync.ts:62-70`. Avisos fuera de orden se descartan por `as_of`
  (`:56-61`) y la carrera con `registerDevice` la cierra `memberships_version`
  (`server/migrations/015_memberships_version.sql`).

**Qué se borra:** sólo la fila de `team_memberships`. **Qué NO se borra:**

| Cosa | ¿Se toca al salir? | Evidencia |
|---|---|---|
| `team_key_wraps` de los devices del ex-miembro | **No**. Nada fuera de `keys.ts` borra envolturas de equipo, y ahí sólo cuando un device regenera su par. | `grep "delete from team_key_wraps"` → único hit `server/src/keys.ts:88` |
| `team_keys` (maestra, verificador) | No. Sin épocas. | `server/migrations/009_team_keys.sql:2-3`, `:5-9` |
| Envoltura `recovery` del equipo | No. Sólo se escribe al activar; `authorize` la prohíbe. | `server/src/team-keys.ts:212-216` |
| `projects.team_id` de los proyectos del ex-miembro | No (queda apuntando al equipo). | comentario en `server/src/push.ts:248-250` y `server/src/pull.ts:278-279` |
| Filas que el ex-miembro subió | No. Siguen en su proyecto, selladas con la misma maestra. | — |
| Revocar un device | Sólo `devices.revoked_at`; tampoco borra envolturas. | `server/src/devices.ts:661`, `:672`, `:676` |

### 1.2 ¿Puede seguir bajando filas?

**No, una vez que el aviso llegó.** El corte es por fila y en las dos direcciones:

- Pull de filas ajenas: exige que quien pide sea miembro activo del equipo del proyecto
  (`server/src/pull.ts:273-276`) **y** que el autor también lo sea (`:280-283`). Mismo
  predicado en el camino viejo sin `team_cursors` (`:177-183`).
- Sus propias filas las sigue bajando (`p.user_id = $1`, `:234`): son suyas.
- Push: `scope: 'team'` exige membresía activa del autor sobre el `team_id` del proyecto
  (`server/src/push.ts:251-256`), si no `project_not_shared_with_team` (`:359`). Un ex-miembro
  no puede inyectar filas en el equipo.
- `GET /v1/teams/key`: 403 `not_a_team_member` (`server/src/team-keys.ts:66-68`), así que no
  puede volver a pedir su envoltura. `status` deja de listarle el equipo en `encrypted_teams`
  (`server/src/status.ts:105-115`, filtro `tm.status = 'active'`).

**Hueco: el aviso puede perderse.** `pg_net` no reintenta y el espejo sólo se corrige en el
próximo `registerDevice` de esa persona
(`supabase/migrations/20261102000000_membership_sync.sql:16-17`). No hay reconciliación
periódica: el único otro llamador de la sincronización es `server/src/devices.ts:271`
(registro). Si el sync estaba caído en el momento de la expulsión, el ex-miembro **sigue siendo
miembro activo para el servidor de sync indefinidamente**: baja filas, readopta la maestra
(`team-keys.ts:66` pasa) y puede seguir escribiendo filas de equipo.

### 1.3 ¿Puede descifrar lo que ya tenía y lo nuevo?

- **Lo que ya bajó: sí, y sin necesitar ninguna clave.** La base local está en claro por diseño
  (CLAUDE.md, "Memoria cifrada": "La base local sigue en claro y tiene que seguirlo"). La maestra
  no le agrega nada sobre lo que ya tiene en disco.
- **La maestra en un cliente honesto** vive sólo en memoria (`electron/main.ts:374-380`,
  `teamMasterKeys`) y se readopta en cada arranque desde el servidor (`:405-412`). Tras salir, el
  próximo arranque no la recupera (403 de arriba). Dentro de la sesión en curso el `Map` no se
  vacía al desaparecer el equipo del status (`electron/memory-daemon.ts:1567-1584` sólo llama al
  hook con los equipos listados), pero sin pull de equipo no tiene qué abrir.
- **Un cliente modificado** guarda la maestra para siempre: es un `Buffer` de 32 bytes en el
  proceso main. Además, su envoltura sigue en `team_key_wraps` (1.1), sellada para la pública
  de un device cuyo privado él conserva.
- **Lo nuevo:** sin rotación, toda fila de equipo escrita después de su salida se sella con la
  **misma maestra** (no hay épocas, `009_team_keys.sql:2-3`; el cliente lo dice en
  `electron/memory-team-keys-client.ts:5-8`). Si consigue el ciphertext, lo abre.

### 1.4 ¿Hay épocas de clave de equipo?

No. Ni en el esquema (`009_team_keys.sql`, `010_team_key_verifier.sql`), ni en el status
(`encrypted_teams: [{ team_id, has_wrap }]`, spec de equipo §7), ni en el sobre: `nmc1:` no
lleva identificador de clave (`electron/memory-crypto.ts:16`, `:68-74`), así que el servidor no
puede saber con qué maestra se selló una fila.

## 2. Modelo de amenaza concreto

El objetivo declarado del cifrado de equipo es compliance: que ni Nest ni quien tenga acceso al
Postgres de Railway lea la memoria de equipo, incluyendo filtraciones cruzadas entre tenants
(spec de equipo §1). El ex-miembro es un actor nuevo dentro de ese modelo.

### 2.1 Ex-miembro SIN acceso al servidor

Gana **nada** respecto de lo que ya tiene en su disco, siempre que el aviso de membresía haya
llegado: el servidor le corta pull, push y envoltura (1.2). La maestra es inútil sin
ciphertext. Lo que conserva en claro localmente es la consecuencia aceptada en spec §8 ("igual
que cualquier documento compartido que alguien ya descargó"), y ninguna rotación lo cambia.

Excepción real: **si el aviso se perdió** (1.2), conserva acceso total y vivo. Eso no es un
problema de cripto, es un problema de revocación, y es el hueco más concreto de hoy.

### 2.2 Ex-miembro CON acceso al ciphertext del servidor

"Acceso" = un dump/filtración del Postgres, un backup de R2 (incluye `observations`,
`team_keys` y `team_key_wraps`, `server/src/backup.ts:22`; 30 días de retención,
`server/src/r2.ts:85`), un empleado de Nest o del cliente con acceso a la base, o un bug de
autorización en el pull (exactamente la "filtración cruzada" que §1 quiere cubrir con cifrado
como segunda capa).

Con la maestra vieja gana:

1. **Todo lo escrito después de su salida**, para siempre, mientras el equipo no rote. Es lo
   que la frase de spec §8 "salir corta memorias NUEVAS" no cubre: las corta el servidor, no la
   cripto. Contra el operador, que es justo el adversario del modelo, el ex-miembro + el
   operador (o una filtración) leen todo el futuro del equipo.
2. **Lo histórico que nunca bajó**: filas de equipo de repos que no clonó (el pull sólo baja
   `project_key` que el device ya tiene, spec §4). La maestra abre todo el equipo, no sólo lo
   que él vio.
3. Aunque un cliente honesto no persista la maestra, **su envoltura sigue en la base** (1.1):
   dump + el privado del device del ex-miembro (que está en su máquina) = maestra.
4. **Si era leader**, además conoce el código de recuperación de equipo: dump (slot
   `recovery`) + código = maestra, sin necesitar ningún device.
5. No gana escritura: `authorize`/`recrypt` exigen rol `leader` activo además de la prueba
   (`team-keys.ts:190-208`, `team-keys-recrypt.ts:136`, `:192`).

### 2.3 Re-ingreso

Si lo vuelven a invitar, su envoltura vieja sigue ahí: `status` le dice `has_wrap: true`
(`status.ts:109-110`) y readopta sola en el arranque (`main.ts:405-425`), sin que el leader
autorice nada ni vea el device en `pendingDevices` (`team-keys.ts:77-86` lista sólo los SIN
envoltura). Es consistente con el estado actual (misma maestra), pero si se rota, esas
envolturas viejas tienen que desaparecer o el re-ingreso se salta al leader.

## 3. Opciones

Restricciones que cualquier opción tiene que respetar (todas vienen de bugs ya pagados):

- **Gate fail-closed** (CLAUDE.md; `electron/memory-daemon.ts:94`, `:946`, `:1131`): un device
  que sabe que el equipo cifra y no tiene la clave correcta **retiene** (`team_key_missing`), no
  sube en claro ni con otra clave. Con épocas, "tener la clave" pasa a ser "tener la de la
  época vigente".
- **LWW/lamport**: re-cifrar no es editar; el `lamport` no se toca
  (`team-keys-recrypt.ts:348`) y lo editado entre la lectura y el envío se rechaza `stale`
  (`:289-291`). El push ignora mutaciones que pierden por `updated_at` y después lamport
  (CLAUDE.md). Cualquier re-cifrado tiene que seguir ese mismo contrato.
- **Tema (HMAC)**: una fila bajada guarda sólo `topic_key_hmac`, con `topic_key = null`
  (`electron/memory-store.ts:1944-1951`). Sólo el autor, en su máquina, conoce el tema en claro
  de su fila. Si la subclave de tema cambia, **nadie puede recalcular el HMAC de filas ajenas**,
  y el supersede por tema (`resolveTopicCollision`, spec de equipo §4) deja de unir una fila
  nueva con una vieja del mismo tema.

### Opción A — Endurecer el corte de acceso (sin cripto nueva)

Aceptar la decisión de §8 tal cual, pero hacer que el corte del servidor sea confiable y
limpiar el material que sobra.

1. **Reconciliación de membresías**: un job periódico (o en cada `status`, con caché) que
   compare el espejo contra Supabase, para que un aviso perdido no deje a nadie adentro para
   siempre. Alternativa barata: que `/internal/memberships` responda y Supabase registre fallos
   en una tabla que un cron reintente.
2. **Borrar las envolturas al salir**: en `aplicarMembresias` (y en `syncTeamMemberships`),
   `delete from team_key_wraps where team_id = <equipo perdido> and slot in (devices del
   usuario)`, en la misma transacción. Lo mismo al revocar un device (`devices.ts:661-676`).
   Cierra 2.2.3 y obliga a que el re-ingreso (2.3) pase por el leader.
3. Opcional: vaciar `teamMasterKeys` de los equipos que el status deja de listar.

- **Archivos**: `server/src/membership-sync.ts`, `server/src/devices.ts`, quizá un cron en
  `server/src/index.ts` o `.github/workflows/`, `electron/main.ts` (3), tests en
  `server/__tests__/membership-sync-http.test.ts`, `devices-team-sync.test.ts`,
  `team-keys.test.ts` (nuevo: "al salir, su envoltura desaparece y vuelve a pendingDevices al
  re-ingresar"). Estimado: 1-2 días.
- **Riesgos**: casi ninguno con el gate ni con LWW (no toca push/pull). Ojo con un aviso
  espurio (falso "salió") que borre envolturas de un miembro real: es reversible, el leader
  re-autoriza, pero el miembro queda con su memoria de equipo retenida hasta entonces.
- **Qué ve el usuario**: nada nuevo. Un miembro que vuelve aparece en la lista del leader para
  autorizar, como uno nuevo.
- **Qué NO cubre**: 2.2.1, 2.2.2, 2.2.4. El ex-miembro con un dump sigue leyendo todo el
  equipo, pasado y futuro.

### Opción B — Rotación con época nueva; sólo lo nuevo se sella con la nueva

El leader rota (a mano, o el cliente se lo propone cuando alguien sale). Lo viejo queda con la
maestra vieja; todo lo escrito después, con la nueva.

**Modelo:**

- Migración nueva: `team_keys.key_epoch int not null default 1`; tabla `team_key_epochs
  (team_id, key_epoch, verifier, created_by, created_at)`; `team_key_wraps` suma `key_epoch` a la
  PK. El verificador pasa a ser por época (la prueba ya lleva el `team_id` en la etiqueta;
  sumarle la época: `nest-memory/team-proof-v2/<team_id>/<epoch>`).
- **Cadena de claves**: la envoltura de la época N+1 lleva, sellada con la maestra N+1, la
  lista de maestras anteriores (en `wrap_meta` o en una fila `slot = 'history'` cifrada). Así
  un miembro nuevo autorizado sólo en N+1 lee todo el histórico, y el ex-miembro no recibe
  nada de N+1.
- **Subclave de tema estable**: `deriveKeys` (`memory-crypto.ts`) deriva `topic` de la maestra
  de la **época 1** siempre, y la cadena la transporta. Por la restricción de arriba, rotarla
  rompería el supersede de toda fila vieja. Costo aceptado: el ex-miembro con un dump puede
  confirmar si una fila nueva habla de un tema que él adivina (igualdad de HMAC), no leerla.
- **Sobre**: con `nmc1:` sin id de clave, abrir prueba la época vigente y después las viejas
  (GCM falla rápido). Más limpio: `nmc2:<epoch>:` para lo nuevo; `isCiphertext` acepta los dos
  (el comentario de `memory-crypto.ts:12-15` ya lo prevé).
- **Rotar** = `POST /v1/teams/key/rotate` (leader + `proof` de la época vigente): crea la época
  N+1, su verificador, una envoltura por cada device **activo** del equipo (los que hoy tienen
  envoltura menos los del que salió), y una envoltura `recovery` nueva (el código viejo muere:
  cierra 2.2.4). Borra las envolturas de épocas anteriores de los devices que ya no están.
- **Huellas**: el leader envuelve para las públicas que el servidor le da. Para no abrir un
  MITM en la rotación (el servidor cambia una pública justo ahí), guardar en `wrap_meta` la
  huella con la que se autorizó cada device y exigir que la pública de la rotación dé la misma
  (mismo espíritu que `memory-authorize-target.ts`). Si no coincide, ese device queda pendiente.

**Gate y push:**

- `status` agrega `key_epoch` por equipo y `has_wrap` pasa a significar "envoltura de la época
  vigente". El store lo recuerda en `meta` (como `encrypted_teams`, nunca olvida hacia atrás).
- `doPush` retiene con `team_key_missing` si el device tiene la maestra de una época anterior a
  la vigente. **Este es el punto delicado**: hoy el gate pregunta "¿tengo clave de este
  equipo?"; con épocas, un device con la clave vieja respondería "sí" y sellaría lo nuevo con la
  maestra que el ex-miembro conoce. Tiene que preguntar por la época.
- Servidor, segunda capa: cada mutación de equipo declara `team_key_epoch`; si es menor a la
  vigente, rechazo REVERSIBLE `team_key_stale` (sumarlo a `TEAM_KEY_HOLD_REASONS`,
  `memory-daemon.ts:94`). El servidor no puede verificar la declaración (el sobre es opaco),
  pero el adversario aquí es el ex-miembro, que ya no puede pushear; la capa protege contra un
  cliente honesto desactualizado, que es el caso real.
- La cola local no se sella al encolar sino en el push (`currentEnvelopeContext`,
  `main.ts:458-475`), así que lo retenido se re-sella con la época nueva al liberarse
  (`onTeamKeysChanged`). Sin cambio de lamport.
- Pull: una fila `nmc2:<N+1>` en un device que sólo tiene N cae en `undecryptable` (camino que
  ya existe); al adoptar N+1, `hayIlegiblesDeEquipos` + `resetPullCursors`
  (`main.ts:442-445`) la vuelven a bajar. Hay que asegurar que eso dispare también al adoptar
  una época nueva de un equipo que ya tenía clave (hoy sólo mira "recién adoptado").

- **Archivos**: `server/migrations/017_team_key_epochs.sql`, `server/src/team-keys.ts`
  (rotate, epoch en get/authorize/verificador), `server/src/status.ts`, `server/src/push.ts`
  (`team_key_stale`), `server/src/http.ts` (ruta), `electron/memory-team-keys-client.ts`,
  `electron/memory-crypto.ts` (prueba v2, `nmc2`), `electron/memory-envelope.ts` (elegir época
  al sellar, probar épocas al abrir), `electron/memory-daemon.ts` (gate por época),
  `electron/memory-store.ts` (meta de época), `electron/main.ts` (`teamMasterKeys` pasa a
  `Map<teamId, Map<epoch, Buffer>>`), `src/components/TeamEncryptionCard.tsx`; el paquete
  portátil comparte daemon/envelope. Tests: `server/__tests__/team-keys*.test.ts`,
  `push-team-encryption.test.ts`, `status-team-keys.test.ts`,
  `electron/__tests__/memory-team-keys-client.test.ts`, `memory-daemon-cifrado-equipo.test.ts`,
  `e2e/16-cifrado-de-equipo.spec.ts`. Estimado: 1,5-2 semanas con revisión adversarial.
- **Riesgos**: (1) el gate por época mal hecho es exactamente el bug de "subía en claro a una
  cuenta cifrada", pero con la clave del ex-miembro en vez de en claro, e igual de silencioso;
  necesita su test dedicado ("con la maestra N y status en N+1, nada sale"). (2) Ventana entre
  la rotación y el próximo `status` de cada device (hasta `next_poll_ms`): lo que suba en esa
  ventana va con N; el rechazo `team_key_stale` lo convierte en retención, no en fuga
  persistente. (3) Rotaciones concurrentes de dos devices del leader: mismo advisory lock que
  `activateTeamKey` (`team-keys.ts:154`) + `409 stale_team_epoch`. (4) Un leader sin la maestra
  vigente no puede rotar (prueba), y si el leader perdió todo, el código de recuperación nuevo
  es el único camino.
- **Qué ve el usuario**: el leader, al sacar a alguien, ve "X left the team. Rotate the team key
  so X cannot read new team memories." Al rotar: código de recuperación nuevo (mostrar una vez),
  y "N machines re-authorized, M pending" si alguna huella no coincidió. Los miembros: nada si
  su device estaba autorizado y online; si estaba offline, sus filas de equipo nuevas se ven
  "waiting for authorization" hasta el próximo arranque.
- **Qué cubre**: 2.2.1 y 2.2.4. **No cubre**: 2.2.2 (lo histórico sigue con la maestra vieja).

### Opción C — Rotación + re-cifrado total del histórico

B, más: el leader re-sella con N+1 todas las filas de épocas anteriores.

- Reusa el endpoint de migración con un modo nuevo: `recrypt-pending?mode=rotate` lista filas
  selladas con época < vigente (requiere guardar `key_epoch` por fila en `observations`, o el
  prefijo `nmc2:<e>:`; con `nmc1:` el servidor no distingue), el leader descifra con la vieja y
  sella con la nueva, y `recrypt` acepta "sellada con época vieja" donde hoy rechaza
  `already_sealed` (`team-keys-recrypt.ts:281-287`). Mismo `stale` por lamport, mismo
  no-bump de lamport, sí bump de `project_seq`.
- El tema **no** se puede re-hashear (restricción de arriba): igual que en B, la subclave de
  tema queda estable.
- **Archivos**: todo B + `server/src/team-keys-recrypt.ts`, `electron/memory-team-reencrypt.ts`,
  migración con `observations.team_key_epoch`, tests de `team-keys-recrypt.test.ts` y
  `memory-team-reencrypt.test.ts`. Estimado: +1 semana sobre B.
- **Riesgos**: bump de `project_seq` sobre TODO el equipo → cada device de cada miembro re-baja
  todo el histórico (ancho de banda, y el limiter de 60/min del recrypt para equipos grandes);
  un equipo con mucha edición concurrente deja filas `stale` que necesitan otra vuelta; durante
  la migración conviven dos épocas (la tarjeta no puede decir "rotado" hasta pendientes = 0,
  misma regla que hoy). Es la única ruta que reescribe contenido ajeno, ahora sobre filas ya
  selladas: los tests adversariales de §9.2 del spec de equipo tienen que repetirse en el modo
  nuevo.
- **Límite que no cambia**: los backups de R2 conservan el ciphertext viejo y las envolturas
  viejas por 30 días (`r2.ts:85`); la maestra vieja los abre hasta que expiren. Y lo que el
  ex-miembro ya tiene en disco, en claro, sigue ahí.
- **Qué ve el usuario**: lo de B, más una barra "Re-encrypting team history… 1 240 / 3 100" en la
  tarjeta del leader, y que la memoria de equipo se re-sincroniza entera en cada máquina.
- **Qué cubre**: 2.2.1, 2.2.2 y 2.2.4 (pasados 30 días de backup).

## 4. Recomendación

1. **Hacer A ya**, independientemente de lo demás. Es barata y cierra los dos huecos reales que
   no dependen de ninguna decisión de producto: el aviso perdido que deja a un ex-miembro
   adentro para siempre, y las envolturas que sobreviven a la salida (que además hacen que el
   re-ingreso se saltee al leader).
2. **Diseñar B como el siguiente paso, y hacerlo antes de vender "compliance" a un cliente
   enterprise.** El argumento de spec §1 ("ni Nest ni quien tenga acceso al Postgres lee la
   memoria de equipo") hoy es falso para la memoria posterior a la salida de cualquier
   miembro, que es el escenario que un auditor va a preguntar primero. B lo hace verdadero
   para lo nuevo, que es lo que importa: lo viejo el ex-miembro ya lo tiene en claro en su
   disco en la mayoría de los casos. La rotación conviene ofrecerla, no forzarla: el leader
   decide, la tarjeta la propone al ver una salida.
3. **C sólo como "rotación profunda" ante sospecha de filtración**, no como reacción por
   defecto a una salida: el costo (re-bajar todo el equipo en cada máquina) es alto y el
   beneficio marginal sobre B es lo histórico de repos que el ex-miembro no clonó, acotado
   además por la retención de backups.

Decisiones que necesita Gero antes de un plan de B:

- Rotación manual vs. automática al salir alguien (recomiendo manual con aviso).
- Aceptar que la subclave de tema no rota (filtra igualdad de temas al ex-miembro con dump).
- `nmc2:<epoch>:` (limpio, toca el sobre) vs. probar épocas con `nmc1:` (sin cambio de wire,
  y C necesitaría igual la columna por fila).

## 5. Hallazgo lateral: `git_branch` de equipo queda en claro tras la migración

No es de rotación pero salió leyendo el recrypt. Desde el spec del 2026-11-02 `git_branch` se
sella (`electron/memory-envelope.ts:42`, y el servidor lo exige en
`server/src/push.ts:178`). Pero la migración de equipo no lo mira ni lo reescribe: el predicado
`enClaro` no lo incluye (`server/src/team-keys-recrypt.ts:83-91`) y el `update` sólo toca
`title, content, tags, content_hash, origin_account, topic_key` (`:352-358`). El
`plaintext_pending` del status excluye `scope = 'team'` (`server/src/status.ts:123`), así
que el re-upload personal tampoco lo cubre. Resultado: una fila de equipo subida en claro
antes de activar conserva su rama en claro en el servidor después de que la tarjeta dice
"todo cifrado". Arreglo chico: sumar `git_branch` al predicado y al `update` (el cliente ya la
sella en `memory-team-reencrypt.ts` si se agrega al item), con su test en
`team-keys-recrypt.test.ts`.
