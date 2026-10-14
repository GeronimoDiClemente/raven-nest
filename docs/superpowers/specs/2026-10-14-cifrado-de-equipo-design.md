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

Dos tablas nuevas, sin tocar `users`/`key_wraps`/`device_keys`:

```sql
create table team_keys (
  team_id      uuid primary key,
  activated_by uuid not null references users(id),
  activated_at timestamptz not null default now()
);

create table team_key_wraps (
  team_id    uuid not null references team_keys(team_id) on delete cascade,
  device_id  uuid not null references devices(id) on delete cascade,
  wrapped    text not null,
  wrap_meta  jsonb,
  created_at timestamptz not null default now(),
  primary key (team_id, device_id)
);
```

Sin épocas ni `rotate_verifier`: v1 no soporta rotar la clave de equipo (§8). Si hiciera falta
rotación v2, se suma una columna `key_epoch` entonces — no se paga ese costo ahora.

## 3. Activación — sólo el `leader`

Gateado por rol: el servidor verifica `team_memberships.role = 'leader' AND status = 'active'`
para ese `team_id` (el espejo que ya sincroniza `registerDevice()`, Team Memory Layer 1 Parte 2).
Cualquier otro rol que llame a activar recibe `403 leader_required`.

Flujo:

1. El client del leader genera la clave maestra del equipo localmente.
2. Envuelve esa clave con la pública de su PROPIO device (mismo mecanismo de sellado que
   `enrollDeviceKey`/`publishWraps` ya usan para personal).
3. Genera el **código de recuperación de equipo** (§6) y se lo muestra al leader UNA vez.
4. Llama `POST /v1/teams/:id/key/activate` con el wrap propio + la envoltura de recuperación.
   El servidor crea la fila en `team_keys` y las dos en `team_key_wraps` (slot del device propio
   + slot `recovery`), en una sola transacción.

## 4. Migración retroactiva de lo ya subido en claro

Gero eligió re-cifrar lo existente al activar (no dejarlo en claro para siempre). Esto es lo más
nuevo y lo más delicado del diseño, así que se marca aparte.

**Por qué es delicado**: hoy nadie reescribe el contenido de una fila que no escribió — el `push`
normal es por autor, idempotente por `(device_id, seq)`. La migración necesita que el leader
reescriba `title`/`content`/`tags` de observaciones subidas por OTROS miembros del equipo. Se
acota con un endpoint dedicado, nunca el `push` genérico:

`POST /v1/teams/:id/key/recrypt` — gateado a `leader` igual que la activación. Body:
`{ items: [{ sync_id, title, content, tags }] }` (ya cifrados por el client del leader con la
clave de equipo nueva). El servidor, por cada `sync_id`:

- Verifica que la fila exista, que su `project.team_id` sea exactamente `:id`, y que
  `scope = 'team'` — si no matchea alguna, esa fila se rechaza individualmente (no aborta el lote).
- Sobreescribe únicamente `title`, `content`, `tags`.
- Bumpea `lamport`/`project_seq` igual que una mutación común, para que el resto de los devices
  del equipo se enteren de que tienen que volver a bajar esa fila (ahora en ciphertext) aunque su
  cursor ya la hubiera visto.
- Nunca toca `scope`, `type`, `author_id`, ni ningún otro campo de metadata/autoría.

El client del leader arma el lote paginando sobre **todo** lo existente con `scope: 'team'` de ese
equipo (no por cursor — es una migración de todo el histórico, una sola vez por equipo, el día que
activa).

## 5. Un miembro nuevo se suma a un equipo ya cifrado

Mismo patrón que hoy entre dos devices de una cuenta personal, pero cruzando personas, y con la
decisión explícita de Gero: **sólo el leader autoriza**, nunca cualquier miembro ya autorizado.

1. El nuevo member entra al equipo (invite + `accept_invite`, ya existe desde antes). Su client ve
   `team_keys` activo para ese equipo pero sin wrap para su device → la memoria de equipo de ese
   proyecto se muestra como pendiente de autorización (mismo tratamiento visual que hoy una fila
   `nmc1:` personal que este device no puede abrir todavía).
2. El leader ve, la próxima vez que abre Nest, una lista de devices de su equipo sin wrap
   (`GET /v1/teams/:id/key` responde `pendingDevices`, mismo shape que `getKeyState.devices` hoy).
3. El leader autoriza con un click por device: `POST /v1/teams/:id/key/authorize` con el wrap
   nuevo, gateado a `leader`.

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
   `sync_id` de scope personal, un `team_id` que no es el del caller) antes de mergear.
3. **La migración puede ser un lote grande** (todo el histórico de un equipo activo hace rato).
   Mismo techo de tamaño de batch que ya existe en `push.ts` (`batch_too_large`, 500 mutaciones)
   aplicaría acá también — paginar desde el client si un equipo supera eso.

## 10. Decisiones cerradas el 2026-10-14 (con Gero, antes de escribir el plan)

- Objetivo: compliance/enterprise, cubre Nest + otros tenants del servicio compartido (no sólo
  la instancia dedicada futura).
- Salir de un equipo corta memorias nuevas; NO re-cifra lo existente.
- El device depende de tener el cifrado personal activo — reusa su clave pública, no un par nuevo.
- Sólo el `leader` activa el cifrado de un equipo.
- Sólo el `leader` autoriza devices nuevos (no cualquier miembro ya autorizado).
- Al activar, lo ya subido en claro se re-cifra retroactivamente (no queda en claro para siempre).
- Hay código de recuperación de equipo, mismo mecanismo que el personal.
