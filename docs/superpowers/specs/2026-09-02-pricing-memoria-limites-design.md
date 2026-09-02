# Nest Memory — pricing y límites · diseño

> Rama: `smoke/memory-bridge`
> Fecha: 2026-09-02
> Relacionados: `docs/superpowers/specs/2026-08-31-memory-sync-backend-design.md` (§9.3 el gate de plan, §11.4 el intervalo, §11.6 los límites), `src/lib/stripe.ts`, `server/src/auth.ts`
> Reemplaza: la estructura de 4 tiers publicada en v1.2.8 (Free / Pro $20 / Team $35 por asiento / Enterprise)

## 1. Qué decide esta spec

Qué se cobra en Nest y cuánto, ahora que existe un servicio propio que aloja la memoria de
los usuarios. Y los límites concretos de cada plan: cuántos proyectos, cuántos bytes,
cuántas máquinas, a qué ritmo, y **qué pasa exactamente cuando alguien choca uno**.

No decide el pricing de integrations, que queda abierto (§10).

## 2. La regla

**El precio sigue al costo marginal.**

- Lo que corre en la máquina del usuario y no nos cuesta nada: **gratis**.
- Lo que vive en nuestra nube y nos cuesta plata: **se paga**.
- Lo que se comparte entre personas: **Teams**.

Esto invierte el pricing anterior, que cobraba justo lo que la competencia regala (panes,
CLIs, worktrees, editor) y no cobraba nada por el diferencial. Un competidor OSS como Orca
convierte cada gate sobre lo local en un motivo para que nos comparen y perdamos; sobre lo
que hosteamos nosotros no hay comparación posible, porque el costo es real.

La regla también responde por sí sola la pregunta de si conviene cobrar por volumen de
memoria: no, porque el volumen no cuesta (§11).

## 3. Estructura de planes

| | **Free** | **Cloud** | **Teams** |
|---|---|---|---|
| Precio | $0 | $10/mes | A medida, por asiento |
| Venta | Self-serve | Self-serve | Sales-led |
| Qué comprás | — | Que alojemos tu memoria | Que la memoria sea del equipo |

`Pro` desaparece. El tier individual se llama **Cloud** porque dice literalmente qué se
compra. `Teams` deja de ser self-serve por asiento y pasa a ser el tier a medida, con
Enterprise como su extremo superior (SSO, instancia dedicada, SLA) en vez de un cuarto plan.

Todo lo local es gratis en los tres: panes, los CLIs, el editor, worktrees, diff viewer,
spotlight, voice, My Repos, y **la memoria local completa** — captura, búsqueda y consulta,
sin límite de cantidad.

## 4. Límites

| | Free | Cloud | Teams |
|---|---|---|---|
| Memoria local | Ilimitada | Ilimitada | Ilimitada |
| **Proyectos en la nube** | **1** | Sin límite comercial · tope técnico 100 | Sin límite comercial |
| Máquinas sincronizadas | 3 | Sin límite comercial · tope técnico 10 | Sin límite comercial |
| Cuota de almacenamiento | 100 MB | 1 GiB | 5 GiB por asiento |
| Tamaño por observación | 1 MB | 1 MB | 1 MB |
| Intervalo de sync (`next_poll_ms`) | 15 min | 5 min | 5 min |
| Rate limit por device | 60 push/min · 60 pull/min · tope de 500 mutaciones por request | igual | igual |
| Memoria compartida (`scope: 'team'`) | No | No | **Sí** |
| Instancia dedicada | No | No | Opcional |
| Retención de tombstones | 90 días | 90 días | 90 días |

### 4.1 Por qué el eje es proyectos y no bytes

El almacenamiento no es un costo: el corpus real más pesado que existe (559 memorias de uso
diario con agentes, sobre seis proyectos, durante meses) pesa **3,18 MB** — el 0,3% de la
cuota de 1 GiB. Cobrar por MB sería inventar una métrica que no cuesta y, peor, enseñarle al
usuario a guardar menos justo en el producto donde queremos que guarde todo.

Lo que sí varía entre usuarios es **cuántos proyectos** llevan a la nube: alguien con doce
repos saca doce veces más valor que alguien con uno. Y ya está modelado — tabla `projects`
con `project_key` por usuario, sin nada que inventar.

El proyecto gratis existe para que el aha se sienta entero: abrir la segunda máquina y
encontrar la memoria de la primera. El **segundo repo es el momento de pago**, mismo
razonamiento que el cuarto pane en el pricing viejo.

### 4.2 Por qué cada número

- **100 MB en Free** son ~28.000 memorias a la mediana medida (3,6 KB): treinta veces el
  corpus más grande que existe. No es un límite que se toque usando el producto, es un techo
  contra abuso. El 1 GiB de Cloud, al ritmo real medido, dura unas cuatro décadas.
- **1 MB por observación**, como pide §11.6. Es 17 veces la memoria más grande jamás escrita
  (59,4 KB). Un tope más ajustado no ahorra nada y rechazaría un pegado legítimo, y el
  producto promete "guardá todo".
- **15 minutos en Free** es la única palanca de costo real del diseño (§11.4) y ya vive en el
  servidor: se mueve sin actualizarle la app a nadie. El ~99% de los pulls vuelven vacíos.
- **60 requests por minuto por device** es 300 veces el ritmo real del cliente (0,2 pulls por
  minuto). El cliente empuja de a 200 mutaciones (`PUSH_BATCH_SIZE`, `memory-daemon.ts:22`) y
  el servidor ya acepta hasta 500 (`MAX_BATCH`, `http.ts:9`), así que una primera
  sincronización de 559 memorias entra en 3 requests. Es un límite que sólo toca un bug o un
  ataque.
- **3 máquinas en Free** cubren PC + Mac + una tercera; el límite no es la razón para pagar,
  el proyecto lo es.
- Los **topes técnicos** (100 proyectos, 10 máquinas) no se comunican como límite de
  producto ni aparecen en la web: son techos contra abuso, puestos donde ningún uso legítimo
  llega. Si un cliente real los toca, se suben — no es una conversación de venta.

## 5. Qué pasa al chocar un límite

**Regla dura: nunca se pierde nada, y nunca en silencio.**

| Límite | Comportamiento |
|---|---|
| Proyectos (Free, 2º repo) | El proyecto **no se rechaza: se queda local y funciona entero**. La UI dice qué desbloquea la nube. La captura local nunca se apaga |
| Cuota de bytes | El push devuelve `quota_exceeded` y frena. **Nunca borra para hacer lugar** |
| Tamaño de observación | Se rechaza esa observación con motivo explícito; el resto del batch se aplica |
| Rate limit | 429 con `Retry-After`; el daemon espera y reintenta |
| Máquinas | La máquina de más no sincroniza, pero conserva y usa su memoria local |
| Plan vencido o bajado | La nube deja de sincronizar. **Los datos ya subidos no se borran**: quedan a la espera, y el borrado sólo ocurre si el usuario lo pide (§5.5) |

Un producto de memoria que borra memoria para forzar un upgrade está muerto el día que se
sepa. Todos los límites frenan la escritura a la nube; ninguno toca lo que el usuario ya
tiene.

## 6. Cambios en el servicio (`server/`)

| Cambio | Estado hoy |
|---|---|
| Límites por plan | `MAX_BYTES_PER_USER` es **una sola env var global** (`status.ts:41`), igual para todos. Pasa a ser una tabla de límites por plan |
| Tope de proyectos | No existe ninguna verificación. Un `project_key` nuevo siempre se acepta |
| Tope por observación | No existe |
| Rate limit por device | No existe. Es el release blocker §11.6 |
| Gate de `scope: 'team'` | **No existe: hoy cualquier usuario puede marcar una memoria como `team` y el servidor la acepta** (`push.ts:236` lee el scope del payload sin validarlo contra el plan). Es un agujero comercial y de seguridad a la vez |
| Nombres de plan | `CLOUD_PLANS = {pro, team, enterprise}` (`auth.ts:15`) pasa a `{cloud, team, enterprise}` |
| Purga de tombstones | No existe |

Los límites viven en el servidor, no en el cliente: §9.3 ya establece que lo que se aplica
sólo en el renderer no está aplicado.

## 7. Cambios en el cliente

- `PlanLimits` (`src/lib/stripe.ts`) hoy tiene 14 flags que gatean **lo local** (panes,
  worktrees, voice, diff viewer, sharing). Todos esos gates se eliminan: pasan a estar
  siempre en true.
- El único gate nuevo es de nube: proyectos sincronizados y `scope: 'team'`.
- `UpgradeModal` se reescribe sobre tres planes, y el disparador deja de ser "querés un
  cuarto pane" para ser "querés que este segundo proyecto viva en la nube".
- El estado de cuota y plan ya llega del servidor por `status` (`used_bytes`, `max_bytes`,
  `plan`, `next_poll_ms`): la UI los muestra, no los calcula.

## 8. Stripe y la web

- Precio nuevo: **$10/mes**. Los Price IDs actuales ($20 Pro mensual, $180 anual, $35 Team,
  $312 anual) quedan obsoletos; hay que crear los nuevos y actualizar `PRICE_TO_PLAN` del
  webhook.
- `nestmux.com` pasa de 4 cards a 3, y el copy cambia de eje: de "cuántos panes" a "dónde
  vive tu memoria".
- Teams pierde su precio público y pasa a Book a demo, junto con Enterprise.

## 9. Migración

**No hay ninguna.** Medido el 2026-09-02 sobre la base de producción: 83 usuarios (66 free,
16 team, 1 pro) y **cero con `stripe_subscription_id`**. Los 17 en plan pago son asignaciones
manuales de testeo. No hay un solo cobro que romper, lo que hace de este momento la ventana
más limpia que va a haber para reestructurar.

Los 17 usuarios en `team`/`pro` se remapean a `cloud` salvo que se decida lo contrario.

## 10. Fuera de alcance / abierto

- **El pricing de integrations queda abierto**, por decisión explícita del 2026-09-02. Dato
  medido como insumo: integrations **no toca nuestra nube en ningún punto** — cero llamadas
  a Supabase o a un servidor nuestro en los 12 archivos que salen a la red; Slack, GitHub,
  Jira, Notion, GCal y Linear se hablan directo desde la máquina del usuario con sus propios
  tokens. Su único vínculo con memoria es `electron/integrations/memory-port.ts`, un sink
  hacia el store **local** cuyo default es `NULL_SINK`. Por la regla de §2 eso lo pondría en
  Free, pero la decisión no está tomada.
- **La escalera para subir Cloud de $10 a $20**: historial y restauración de una memoria (el
  modelo ya guarda `superseded_by` y tombstones), búsqueda del lado del servidor sobre todas
  las máquinas, y lectura desde el navegador. Ninguna es requisito de lanzamiento.
- **Instancia dedicada por cliente**: se ofrece como opción de Teams/Enterprise, donde el
  costo marginal es real. **No** es la arquitectura por defecto: a 10.000 usuarios la base
  entera pesaría 32 GB y 5,6 millones de filas, con 67 requests por segundo, y un Postgres
  solo lo maneja. Un servidor por usuario costaría más que el precio del plan.
- Precio anual y descuento: sin definir.

## 11. Datos que respaldan los números

Todos medidos el 2026-09-02, no estimados.

**Corpus real de memoria** (559 archivos, el uso más intenso que existe hoy):

| | Bytes |
|---|---|
| Total | 3.183.898 (3,18 MB) |
| Promedio | 5.705 |
| Mediana | 3.626 |
| p90 | 11.037 |
| p99 | 32.647 |
| Máximo | 59.408 |

**Escala proyectada**, a ese ritmo por usuario:

| Usuarios | Datos | Filas |
|---|---|---|
| 1 | 3,2 MB | 559 |
| 1.000 | 3,2 GB | 559.000 |
| 10.000 | 32 GB | 5,6 millones |

**Servicio en producción** (Railway, proyecto `nest-memory`, region `sfo`): 86 MB de RAM,
CPU por debajo de 0,01 vCPU, volumen 152 MB de 5 GB. El contract check de 19 propiedades da
19/19 contra HTTPS real.

**Base de usuarios**: 83 en total, 0 suscripciones de Stripe.
