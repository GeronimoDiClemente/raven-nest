# Free con un proyecto en la nube — diseño (2b-1)

Fecha: 2026-10-21 · Rama: `feat/memories-settings` (local) · Primer proyecto de 2b. El 2b se
partió en cuatro, en este orden: **2b-1** Free con 1 proyecto en la nube (este) → 2b-2 pagar
Cloud (Stripe) → 2b-3 UI de cuenta → 2b-4 Teams autoservicio.

## 1. Pricing vigente (decisión de Gero, 2026-10-21)

| Plan | Precio | Nube |
|---|---|---|
| Free | US$ 0 | todo lo local + **1 proyecto en la nube** |
| Cloud | US$ 10/asiento, US$ 8 anual | proyectos ilimitados, todas tus máquinas, individual (sin compartir) |
| Teams | US$ 20/asiento, US$ 15 anual, mínimo 2 | lo de Cloud + compartir memoria + cifrado de equipo, autoservicio |
| Enterprise | a medida | SSO, instancia dedicada |

Este spec sólo cubre la fila Free. Cloud y Teams vienen en 2b-2 y 2b-4.

## 2. Problema

El pricing del 02-09 promete a Free un proyecto en la nube, y el modal de planes lo dice
(«One project synced to the cloud»). El **servidor ya lo cumple**: `server/src/auth.ts`
acepta `free` y `server/src/limits.ts` le da `maxProjects: 1`; la partición `__global__`
(memoria sin repo) no cuenta contra el tope (`server/src/push.ts`, comentario de
`GLOBAL_PROJECT_KEY`). **La app no**: `src/lib/stripe.ts` tiene
`PLAN_LIMITS.free.memoryCloud = false`, así que Settings › Sync le muestra «Upgrade» a un
Free y nunca lo deja conectar (salvo el build beta, `nubeDeMemoriaDisponible`).

Además, cuando un Free con dos repos conecta, hoy pasa lo siguiente sin que nadie lo vea:
el primer repo que sube ocupa el lugar; las mutaciones de los demás se rechazan con
`project_limit_reached`, el daemon las reintenta (`REVERSIBLE_REJECTIONS`) y la fila de
estado de Memories las cuenta como «N blocked · project_limit_reached · waiting, will
retry». No dice qué repo está en la nube ni qué hacer.

## 3. Decisiones de Gero

1. El lugar de Free lo ocupa **el primer repo que sube** (como hoy). No se elige ni se
   cambia desde la app.
2. La app **muestra cuál** ocupa el lugar y cuáles quedaron sólo en esta máquina, con un
   camino a Cloud.

## 4. Diseño

### 4.1 Free puede conectar
- `PLAN_LIMITS.free.memoryCloud` pasa a `true`. Con eso, en Settings › Sync, un Free ve
  «Connect» como Cloud (`CloudMemoryCard`, `SyncTokenRow`). `nubeDeMemoriaDisponible` no
  cambia.
- El copy de la fila «Cloud sync» no cambia (spec 2a §5). El estado `disconnected` sin
  nube («Local memory active — cloud sync is a Cloud feature») deja de aparecer para Free;
  queda para planes desconocidos.
- La beta cerrada sigue mandando: si la cuenta no está en la allowlist del servidor, el
  connect devuelve `not_in_beta` y se muestra como hoy (`textoDeErrorDeMemoria`).
- Revisar todo otro uso de `memoryCloud` como gate (`grep memoryCloud`) y que ninguno
  vuelva a bloquear a Free.

### 4.2 El servidor informa el tope
- `GET /v1/sync/status` suma `limits: { max_projects: number }` desde
  `limitsFor(auth.plan).maxProjects`. Campo aditivo: un cliente viejo lo ignora.
- El daemon lo guarda junto al resto del status y lo expone al renderer por el mismo
  camino que `quota` (sin canal IPC nuevo).

### 4.3 Qué repos quedaron afuera
- El store local agrupa las mutaciones bloqueadas con `project_limit_reached` **por
  `project_key`** y devuelve, por proyecto, el nombre para mostrar (el `display_name`
  local; si no hay, el basename del repo) y la cantidad. Es una consulta de lectura nueva
  sobre datos que ya existen; sin migración de esquema.
- Se expone por el mismo snapshot de estado que hoy lleva `blocked` (sin canal nuevo).

### 4.4 Settings › Sync: fila «Projects in the cloud»
Sólo con la nube conectada (`connected`/`paused`). Una `SettingRow`:
- **Nombre:** `Projects in the cloud`
- **Descripción:**
  - con tope (`max_projects` finito y chico, hoy Free = 1): `N of M · <proyectos del roster>`
    (ej. `1 of 1 · raven-nest`). El roster sale de `status.projects` **sin** `__global__`.
  - sin tope visible (Cloud y arriba, `max_projects ≥ 100`): `N projects`.
- **Debajo, sólo si hay repos afuera:** `Local only: api, web — Cloud syncs all your
  projects.` y el control **Upgrade**, que abre el `UpgradeModal` existente (mismo camino
  que «See plans» en This project).
- Sin roster todavía (status sin cargar): la fila no se muestra.

### 4.5 Fila de estado de Memories
En `MemoriesStatusRow`, el grupo `project_limit_reached` deja de leerse como error:
- Badge: `N memories stay on this machine — your plan syncs one project` (con «one» o el
  número que diga `max_projects`) en `text-muted-foreground`, no `text-warn`.
- El semáforo (`src/lib/memories-status.ts`) no lo cuenta como `blocked` para el punto
  ámbar ni el texto «N blocked»: es el plan funcionando, no una falla. Los demás motivos
  siguen igual.
- Un botón chico `Upgrade` al lado, que abre el `UpgradeModal`.

### 4.6 Al pasar a Cloud
No cambia nada: el daemon ya trata `project_limit_reached` como reversible y destraba al
cambiar el plan (`memory-daemon.ts`, «might have lifted project_limit_reached»). Se agrega
un test que lo fije: con plan `cloud` en el status siguiente, las mutaciones bloqueadas
vuelven a la cola.

### 4.7 Copy (inglés, verbatim)
| Lugar | Texto |
|---|---|
| Fila | `Projects in the cloud` |
| Con tope | `{n} of {max} · {nombres}` |
| Sin tope | `{n} projects` (`1 project` en singular) |
| Afuera | `Local only: {nombres} — Cloud syncs all your projects.` |
| Botón | `Upgrade` |
| Estado | `{n} memories stay on this machine — your plan syncs {max === 1 ? 'one project' : max + ' projects'}` (`1 memory stays…` en singular) |

## 5. Tests
- Servidor (`server/__tests__`): `status` devuelve `limits.max_projects` = 1 para `free`,
  100 para `cloud`/`pro`, y el de `team` para `team`/`enterprise`.
- Store: agrupado de `project_limit_reached` por proyecto (dos repos afuera, uno con
  muchas mutaciones; `__global__` nunca aparece).
- Daemon: guarda `limits`; un status con plan nuevo destraba (4.6).
- Renderer: Free ve `Connect`; la fila muestra `1 of 1 · raven-nest`; con repos afuera
  muestra la línea y Upgrade abre el modal; Cloud ve `N projects`; sin conectar no hay
  fila; `MemoriesStatusRow` y `memories-status` con el nuevo trato del motivo.
- `la-app-es-en-ingles`, los dos `tsc` de CI. e2e: sólo los existentes, **headless**
  (Gero pidió no mostrar la ventana).

## 6. Fuera de alcance
- Elegir o cambiar qué proyecto ocupa el lugar.
- Cobro y precio de Cloud (2b-2), UI de cuenta (2b-3), Teams (2b-4).
- Cambiar los límites numéricos del servidor.
