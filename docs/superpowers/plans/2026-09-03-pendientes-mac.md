# Pendientes al cerrar la tanda de la Mac (2026-09-03)

Todo lo de esta tanda está en `origin/smoke/memory-bridge`, siete commits, `1267de1..8634e1d`.
Desde la PC alcanza con `git pull`.

> **Lo primero, porque cuesta una tanda entera:** el handoff `2026-08-28-handoff-mac-a-pc.md` y el
> §5 del `MEMORY_INTEGRATIONS_CONTRACT.md` **están desactualizados**. Los dos dicen que
> `smoke/memory-bridge` es un merge descartable que no se mergea a ningún lado. Ya no: es la línea
> de trabajo activa, con 385 commits sobre `feat/integrations`, que quedó contenida entera en ella.
> Esta tanda arrancó sobre la base vieja y se arreglaron tres bugs de los que **uno ya estaba
> cerrado upstream, mejor resuelto** (`bc647ee`). Antes de tocar nada: `git fetch --all` y mirar la
> rama, no el handoff.

---

## 1. Lo que se hizo

| Commit | Qué |
|---|---|
| `231e6e3` | Contrato §3.1 y §3.2 — el flag de memoria dejaba nodos del graph afuera |
| `efcc966` | Corte comercial **Task 1** — `cloud` existe de punta a punta |
| `f3fb7f1` | **Task 2** — los catorce gates locales borrados |
| `7fc2745` | **Task 3** — la cuota sale del servidor y se ve en Settings |
| `e612f86` | **Task 4** — `UpgradeModal` de tres planes |
| `73a8083` | **Task 6 Step 1** — la migración `pro → cloud` escrita |
| `8634e1d` | **§9.2** — el token se emite contra el login |

Verificación al cerrar: **1847 tests verdes, 3 skipped** en el cliente; `npx tsc -b` con **3
errores**, los mismos tres `TS6307` preexistentes. En `server/`, los 11 tests de
`devices-jwt.test.ts` en verde.

---

## 2. Lo que te espera a vos (configuración)

Ninguno de estos cuatro se puede hacer desde acá. Están ordenados por lo que destraba más.

### 2.1 — El price ID de Stripe de $10 → destraba la Task 5 del corte comercial

Crear el precio de $10/mes y pegar el ID en `STRIPE_PRICES.cloud_monthly` (`src/lib/stripe.ts`).

**Está vacío a propósito.** Con el string vacío el botón Cloud del `UpgradeModal` queda
deshabilitado, con un `title` que lo explica. La alternativa tentadora era apuntarlo mientras tanto
al price de `pro`, y eso **cobraría $20 por una card que dice $10**.

Falta además mapear el price nuevo en `supabase/functions/stripe-webhook/eventos.ts`
(`PRECIO_A_PLAN`), que hoy sigue mapeando los IDs viejos a `'pro'`.

### 2.2 — Aplicar la migración a producción → destraba la Task 7

`supabase/migrations/20260902000000_plan_cloud.sql`, proyecto `qkqlsytxtshgjxwmafpw`, por el SQL
editor, y después marcarla como aplicada:

```sql
insert into supabase_migrations.schema_migrations (version) values ('20260902000000');
```

**No está verificada contra ninguna base.** El stack local de Supabase no levanta en la Mac: la CLI
instalada rechaza el `config.toml` del repo (`'api' has invalid keys: auto_expose_new_tables`,
`'config.config' has invalid keys: local_smtp`). Es un desajuste de versión de CLI, no del repo —
en la PC probablemente corre sin tocar nada.

Toca **una sola fila**: de los 17 perfiles pagos, 16 son `team` y se quedan.

⚠️ **La Task 7 (apagar `pro`) no puede arrancar hasta que esto esté aplicado y verificado con
`select count(*) from public.profiles where plan = 'pro'` devolviendo 0.** Si queda un perfil en
`pro` cuando `pro` sale del código, ese usuario cae a Free y pierde la nube en silencio.

### 2.3 — Bucket R2 y sus cuatro variables → destraba la Task 7 de backups

`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, más la regla de ciclo de
vida a 30 días. Las Tasks 1 a 6 de ese plan ya están hechas y verificadas con `--file`; lo único
que falta es la corrida real contra producción.

### 2.4 — `SUPABASE_JWT_SECRET` en el servicio de sync → sin esto §9.2 no emite nada

Lo nuevo de esta tanda. `POST /v1/devices` lee `process.env.SUPABASE_JWT_SECRET` en cada request y
responde **503 `issuer_unavailable`** si falta (no 401: con un 401 el usuario leería "tus
credenciales no sirven" cuando lo que falta es una variable). Es el *JWT secret* del proyecto de
Supabase, el mismo con el que Supabase firma los tokens de login.

Y sigue pendiente de antes: **apuntar el build al servicio de Railway**. `getMemorySyncBaseUrl()`
(`electron/main.ts:210`) todavía cae a `MAIN_VITE_SUPABASE_URL`.

---

## 3. Pendientes de código

### 3.1 — Correr los tests de `server/` que tocan la base

**Lo primero que hay que hacer en la PC.** `server/__tests__/devices-register.test.ts` son 7 tests
escritos y typechequeados que **nunca se ejecutaron**: en la Mac no hay Docker ni Postgres, y todos
los tests de `server/` corren contra una base real (`DATABASE_URL`, o el default
`postgres://postgres:nestmem@127.0.0.1:55432/nest_memory`).

Cubren el allowlist, que el token emitido pasa `authenticate`, que se guarda el hash y no el token,
que un plan existente no se pisa y que dos registros dan dos devices distintos.

Ojo con la clase de bug que vive ahí: escribiendo esto apareció que **`devices.id` es
`uuid primary key` SIN default** en `001_init.sql`, así que el insert tiene que generar el uuid.
Se arregló antes de commitear, pero sólo porque se leyó el schema — el typecheck no lo veía.

### 3.2 — Task 7 del corte comercial: apagar `pro`

Bloqueada por 2.2, no por código. Está toda escrita en el plan, paso por paso.

### 3.3 — La revocación no tiene contraparte en el servicio

`useMemory.disconnect()` con `deleteCloud` sigue llamando a
`supabase.functions.invoke('memory-token', { action: 'revoke' })` — la misma edge function que C7
sacó del camino de Connect **porque nunca se deployó a producción**. O sea: hoy el borrado de nube
revoca contra algo que no existe.

El servicio no tiene endpoint de revocación. Falta un `DELETE /v1/devices/:id` (o un
`POST /v1/devices/revoke`) y cambiar esa llamada. Es el gemelo de §9.2 y quedó afuera a propósito
para no mezclar dos caminos en un commit.

### 3.4 — El plan del usuario no se sincroniza con el servicio

`users.plan` en la base del servicio arranca en `'free'` y **nadie lo actualiza nunca**. El plan de
verdad vive en `profiles.plan` de Supabase y lo escribe el webhook de Stripe.

Hoy no se nota porque `free` es un plan de nube válido (1 proyecto), así que todo el mundo puede
conectar. Se va a notar el día que alguien pague: va a seguir con el tope de Free. Las salidas son
que el webhook de Stripe le pegue también al servicio, o que el servicio lea el plan del JWT si se
lo agregamos como claim.

### 3.5 — Registrar un device que después no va a poder sincronizar

`registerDevice` **no** aplica el tope de máquinas por plan; lo aplica `authenticate` en cada
request. Es a propósito (una sola fuente de esa regla, y es donde está testeada), pero significa
que alguien que ya llegó al tope registra una máquina más y recién se entera al sincronizar, con
`device_limit_reached`. Se lee bien gracias a la Task 9, pero el momento es raro. Si molesta, el
arreglo es un aviso en el registro, no mover el gate.

### 3.6 — Task 10: verificación en la app real

El **Step 2** (cuenta Free, comprobar que no queda ningún gate local: 12 panes, worktree, diff
viewer, Share, voice con F5, y que el `UpgradeModal` no aparezca ni una vez) es la que más vale y
se puede hacer ya. Necesita la receta del `--user-data-dir` propio por el lock de instancia única.

Los **Steps 3 y 4** no son verificables hasta que 2.4 y §9.2 estén desplegados.

### 3.7 — `worktree-path.test.ts` falla siempre en Mac

`stays case-sensitive for unix paths on linux`: `worktreeKey` lowercasea en darwin y el test no
está gateado por plataforma. **Es del test, no del código.** Preexistente; se dejó como estaba para
no mezclarlo con esta tanda, pero conviene gatearlo por `process.platform` antes de que alguien lo
tome por una regresión.

---

## 4. Cosas que costaron una corrida

- **El typecheck real es `npx tsc -b`** (`--noEmit` no chequea nada, tsconfig solution-style con
  `files: []`), y **emite `.js`/`.d.ts` al lado de los fuentes**: 754 archivos la primera vez.
  `git add` de los fuentes nuevos **antes** del `git clean -fd`, que no distingue un `.tsx` recién
  creado de un `.js` emitido.
- **La barra es el código de salida, no el conteo.** Un `npx vitest run | tail` devuelve 0 siempre
  porque el exit code es el del `tail`. Redirigir a archivo y leer `$?`.
- **El doble ABI de `better-sqlite3` ya no se hace a mano**: `npm run native:node` antes de los
  tests, `npm run native:electron` antes de levantar la app.
- **`node_modules` del worktree se queda viejo.** 359 commits trajeron dependencias nuevas
  (`@shikijs/themes`) y la suite ni compilaba hasta correr `npm install`. `server/` tiene su propio
  `package.json` y también hacía falta instalarlo aparte.
