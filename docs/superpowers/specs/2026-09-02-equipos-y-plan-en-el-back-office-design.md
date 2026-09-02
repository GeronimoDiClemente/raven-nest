# Equipos y cambio de plan en el back-office de Aira

**Fecha:** 2026-09-02
**Repos:** `raven-nest` (Edge Function `admin-api`) y `aira-org/aira-admin` (por PR)
**Antecedente:** [`2026-08-28-nest-en-aira-backoffice-design.md`](./2026-08-28-nest-en-aira-backoffice-design.md)

## Qué se construye y por qué

El back-office de Aira ya muestra Nest, pero **sólo se puede mirar**. El contrato
`/api/internal/*` implementa escrituras que del otro lado nadie llama: el `ProductClient`
del admin tiene ocho métodos de escritura y los ocho son de AiraMed.

Esto agrega las dos cosas que faltan para operar Nest desde ahí: **cambiar el plan de un
usuario** y **una sección de Equipos** con sus miembros, sus repos compartidos, y las dos
acciones que hoy no tienen ninguna otra vía que tocar la base a mano — sacar a un miembro y
transferir la propiedad de un equipo.

## Estado de partida, medido el 2026-09-02

No inferido: consultado contra producción antes de escribir esta spec.

| Qué | Valor |
|---|---|
| Lecturas del contrato | Sanas: `manifest` 200, `accounts` 200 con **81 cuentas** |
| `PUT /accounts/:id/plan` | **Ya implementado y deployado**, con audit de actor y motivo |
| `DELETE /accounts/:id` | **Ya implementado y deployado**, sin consumidor (ver *Fuera de alcance*) |
| Rutas de equipos | **No existen** en el router |
| Equipos en la base | 9 equipos · 12 miembros · 6 dueños distintos |
| `admin_audit_log` | 16 filas, **8 columnas**, ninguna es `actor`/`motivo`/`ok`/`error` |

### Los tres hallazgos que condicionan el diseño

**1. `teams.owner_id` es `ON DELETE CASCADE`.** Borrar un usuario dueño de un equipo borra el
equipo, y con él caen en cascada `team_members`, `team_repos` y `team_chat_messages`. El caso
real: **STI-PROJECTS tiene 5 miembros y 28 repos compartidos**. Esto no bloquea nada de lo que
se construye acá, pero es la razón por la que la transferencia de propiedad existe como
capacidad propia y no como un detalle.

**2. Hay dos nociones de "líder" y no coinciden.** `teams.owner_id` es el dueño real, uno solo;
`team_members.role = 'leader'` lo tienen varios a la vez — **STI-PROJECTS tiene 4 leaders entre
sus 5 miembros** y RENEMED.com 3 de 3. Transferir la propiedad mueve `owner_id`; el `role` de
`team_members` no es la propiedad y no se usa para decidirla.

**3. `team_members.user_email` está vacía en las 12 filas.** El email poblado es `email`. El
mapeo usa `email` y no toca la otra. Hoy los 12 miembros están en `status = 'active'`; el
modelo admite invitaciones pendientes (`invited_at` / `accepted_at`) y el mapeo las tolera
aunque no haya ninguna viva.

## Alcance

**Entra:** cambiar el plan de un usuario; ver los equipos de un usuario con sus miembros y repos;
sacar a un miembro o cancelar una invitación; transferir la propiedad de un equipo.

**Fuera de alcance, decidido el 2026-09-02:** **borrar usuarios.** La ruta `DELETE` existe,
está deployada y auditada, pero el back-office no la expone. Si se decide exponerla más
adelante, el diseño que quedó acordado y no se implementó es: bloquear el borrado cuando el
usuario es dueño de un equipo con otros miembros, y obligar a transferir primero. Junto con
eso haría falta un permiso `cuentas:borrar` que arranque sólo para el rol Dueño; mientras el
borrado no esté expuesto, **no se agrega ningún permiso nuevo al core**.

## El contrato: tres rutas nuevas

Todas exigen `Authorization: Bearer`, `X-Admin-Actor`, y las dos escrituras además
`X-Admin-Motivo` — el guard existente (`verificarAuth`) ya lo impone y no se toca.

`rutaDe()` devuelve hoy `{ nombre, id? }`, con un solo id. La ruta de miembros necesita dos
(`teamId` y `memberId`), así que `Ruta` suma esos dos campos opcionales en vez de reutilizar
`id` para significar cosas distintas según la ruta. Los nombres nuevos son `equipos`,
`equipo_miembro` y `equipo_owner`.

### `GET /api/internal/accounts/:id/equipos`

Los equipos donde el usuario es **dueño** y donde es **miembro**, en una sola lista.

```jsonc
{
  "equipos": [
    {
      "id": "uuid",
      "name": "STI-PROJECTS",
      "creado": "2026-05-…",
      "es_dueno": true,           // el usuario de la ficha es teams.owner_id
      "dueno": { "id": "uuid", "email": "…" },
      "miembros": [
        {
          "id": "uuid",           // team_members.id — es lo que se manda para sacarlo
          "user_id": "uuid|null", // null si la cuenta se borró (FK ON DELETE SET NULL)
          "email": "…",
          "role": "leader|member",
          "status": "active|pending",
          "es_dueno": false,
          "invitado": "2026-…|null",
          "acepto": "2026-…|null"
        }
      ],
      "repos": [{ "full_name": "…", "provider": "github|gitlab", "agregado": "2026-…" }],
      "mensajes": 3               // conteo, no contenido
    }
  ]
}
```

Es lectura: no se audita, igual que el resto de las lecturas del contrato salvo las
grabaciones de AiraMed, que son un caso propio de ese producto.

**`user_id` puede ser `null`.** La FK es `ON DELETE SET NULL`, así que un miembro cuya cuenta
se borró sigue en la tabla ocupando un seat. El mapeo no lo esconde: lo devuelve con
`user_id: null` y su email, que es justamente la fila que alguien tiene que poder sacar.

### `DELETE /api/internal/equipos/:teamId/miembros/:memberId`

Saca un miembro activo o cancela una invitación pendiente — es la misma fila de
`team_members`, así que es la misma ruta.

Devuelve **el equipo entero actualizado**, no un `{ ok: true }`: la pantalla se redibuja
completa en vez de parchear estado local. Es lo que ya hacen las tres escrituras de
`vapi-orgs`, y evita que la UI muestre una lista que no volvió a leer.

Rechaza con **409** sacar al dueño del equipo: dejar un equipo sin `owner_id` válido no es un
estado que la app sepa dibujar. Para eso está la transferencia.

### `PUT /api/internal/equipos/:teamId/owner`

Body: `{ "owner_id": "uuid" }`. Transfiere la propiedad. Devuelve el equipo actualizado.

## Reglas de la transferencia

1. El nuevo dueño **tiene que ser ya miembro `active`** del equipo. El back-office transfiere
   entre quienes ya están; no invita gente. Si el `owner_id` pedido no es miembro activo → **400**.
2. Se mueve `teams.owner_id`. Si el nuevo dueño tenía `role = 'member'`, pasa a `'leader'`.
3. **El dueño viejo queda como miembro**, con el `role` que tuviera. No se lo saca ni se lo
   degrada: la transferencia no le quita el acceso a nadie y **no cambia la cantidad de seats
   facturados**.
4. Si el equipo no tiene ningún otro miembro activo, la ruta responde **409** con un mensaje que
   dice exactamente eso, y la UI lo muestra en vez de ofrecer un selector vacío. Es el caso de
   los 3 equipos sin miembros que hay hoy en la base. Un miembro cuya cuenta se borró
   (`user_id: null`) no cuenta como candidato.
5. Transferirle a quien **ya es el dueño** responde **400** en vez de ser idempotente: no cambia
   nada, y dejarlo pasar llenaría el audit de transferencias que no ocurrieron.
6. El orden de las validaciones es **409 antes que 400**. Sin candidatos, el problema no es el id
   que mandaron sino que no hay ninguno posible, y la UI necesita saber que el camino está
   cerrado en vez de invitar a probar con otro.

## Auditoría

`auditar()` hoy escribe `target_type: 'user'` fijo. Pasa a recibirlo como parámetro, porque
estas dos escrituras tienen como objetivo un **equipo**. El resto de su comportamiento no
cambia: sigue registrando el intento fallido igual que el exitoso, y sigue devolviendo `false`
cuando no pudo escribir.

| Acción | `target_type` | `target_id` | `before` / `after` |
|---|---|---|---|
| `team_member_removed` | `team` | `teams.id` | email y rol del miembro sacado / `null` |
| `team_owner_transferred` | `team` | `teams.id` | dueño anterior / dueño nuevo |

**Ninguna de las dos guarda contenido de mensajes ni paths locales de repos**, sólo
identificadores y emails, igual que el audit de `delete_user`.

### El aviso de `auditado: false` es hoy la regla, no la excepción

La migración `20260828000000_admin_audit_actor.sql` **no está aplicada en producción**: la tabla
no tiene las columnas `actor`, `actor_email`, `motivo`, `ok` ni `error`. Hasta que se corra en el
SQL editor del proyecto `qkqlsytxtshgjxwmafpw`, **toda** escritura del contrato aplica el cambio
y devuelve `auditado: false`, sin dejar una sola fila de auditoría.

Los paneles nuevos muestran eso como **advertencia visible sobre la acción realizada** —"el
cambio se aplicó pero no quedó auditado"— y no como una línea en la consola. Es la única señal
que tiene el operador de que falta ese paso.

## UI, en `aira-admin`

Dos paneles bespoke en `src/products/nest/`, siguiendo el patrón que ya usa AiraMed: componente
`"use client"` que recibe `PropsSeccion`, un `acciones.ts` propio con las server actions, y el
`DialogMotivo` del core para pedir el motivo.

- **`PanelPlan`** — plan actual, selector de los cuatro tiers, motivo obligatorio. Muestra los
  `cambios` que devuelve el contrato (`de` → `a`), no un "guardado" genérico.
- **`PanelEquipos`** — los equipos del usuario, cada uno con sus miembros (rol, y si está
  pendiente de aceptar) y sus repos compartidos. "Sacar" por miembro y "Transferir" por equipo,
  ambos con motivo. El dueño aparece marcado y sin botón de sacar.

Se suman al `REGISTRO_SECCIONES` de `src/products/registro.ts` como `nest/plan` y `nest/equipos`,
y el manifest de Nest declara la sección de plan además de la de equipos que ya declara.

**Lo único que se toca del core es `ProductClient`**: tres métodos aditivos (`equiposDe`,
`sacarMiembro`, `transferirEquipo`) más `cambiarPlan`. Es el patrón que ese archivo ya arrastra
con `vapi-config`, `grabaciones` y `republish`; seguirlo es más barato que refactorizarle el
cliente a Lucas de paso. **Ni una pantalla del core, ni un schema del core, ni el RBAC.**

## Permisos

Todo entra en **`acciones:ejecutar`**, que ya existe y tienen los roles Dueño y Soporte. No se
agrega ningún permiso nuevo, porque lo único que justificaba uno era el borrado de usuarios y
quedó fuera de alcance.

El chequeo va **dos veces**: se esconde el panel si el rol no alcanza, y se vuelve a exigir
dentro de cada server action. No es redundante — una server action es un endpoint HTTP y se
puede invocar a mano.

> Queda anotado, sin acción: `src/app/(staff)/layout.tsx:10` le pasa todos los productos al
> Sidebar sin filtrar por ámbito. Un rol de Soporte global sobre AiraMed alcanza también a Nest.
> Con dos productos de la misma sociedad no molesta; el día que entre un producto de otra, ese
> es el fix.

## Modos de falla

Las lecturas no auditan; todo lo de esta tabla salvo la primera fila son escrituras, y cada
intento fallido deja su fila igual que uno exitoso.

| Situación | Respuesta |
|---|---|
| `GET` de equipos de una cuenta inexistente | 404, sin audit (es lectura) |
| Equipo inexistente en una escritura | 404, auditado como intento fallido |
| Miembro que no pertenece a ese equipo | 404 — nunca se saca una fila por id suelto sin verificar el `team_id` |
| Sacar al dueño | 409 con el motivo explícito |
| Transferir a alguien que no es miembro activo | 400 |
| Transferir en un equipo sin otro miembro activo | 409 |
| El audit no se pudo escribir | La acción se aplica igual y la respuesta trae `auditado: false` |
| Falla una consulta que arma la lista de equipos | 500 con el error en el log, **nunca** una lista vacía |
| Falla sólo el conteo de mensajes | Se registra en el log y ese equipo va con `mensajes: 0` |

Las dos últimas filas son la misma regla que el contrato ya aplica a la facturación, donde
`monto_mensual_cents` y `seats` viajan en `null` con Stripe caído: **cero es un valor válido y
mentiría en la pantalla donde se decide sobre una cuenta.** Un equipo que aparece sin miembros
porque la base falló es esa misma mentira, así que lo que sostiene la respuesta falla ruidoso y
sólo lo decorativo degrada.

## Testing y verificación

**En `raven-nest`:** tests de `rutaDe` para las tres rutas nuevas (con y sin el prefijo
`/admin-api`, y los ids mal formados), tests del mapeo de equipos —incluido el miembro con
`user_id: null` y el equipo sin miembros—, y tests de las reglas de transferencia. Corren en
vitest como el resto de la función.

**Verificación real, antes de tocar el otro repo:** deploy de `admin-api` y smoke con `curl`
contra producción — listar los equipos de un usuario real, y ejercitar los rechazos contra los
equipos sin miembros y contra un equipo real con ids inexistentes, que no modifican nada.

**El camino feliz necesita datos que hoy no existen.** Una transferencia exitosa no se puede
smokear sobre los equipos vacíos: la regla 4 los rechaza con 409 justamente por no tener a quién
transferirle. Hace falta un equipo de prueba con **dos miembros aceptados**; hasta que exista, la
baja de un miembro y la transferencia quedan verificadas por sus tests unitarios y por los
rechazos en vivo, pero no ejecutadas contra la base real.

**En `aira-admin`:** tests de los dos paneles y de los métodos nuevos del client. Su CI corre
aislamiento, lint, typecheck, tests y build.

## Orden de entrega

1. `raven-nest`: rutas, mapeo, audit parametrizado, tests, deploy de la función, smoke con `curl`.
2. `aira-admin`: client, paneles, registro, manifest; PR al repo de Lucas.

El orden no es negociable por la misma razón que en la entrega anterior: verificar el contrato
contra la función deployada no puede depender de esperar una review.

## Pendiente que no bloquea esto

Correr `20260828000000_admin_audit_actor.sql` en el SQL editor del proyecto
`qkqlsytxtshgjxwmafpw`. Es idempotente. **Nunca por `db push`**: hay 30+ migraciones aplicadas
a mano y sin registrar. Hasta que se corra, todo lo que se escriba desde el back-office queda
sin registro de quién ni por qué.
