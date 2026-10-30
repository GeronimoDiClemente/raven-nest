# Handoff 2026-10-21 — Memories estilo Obsidian (CERRADO)

**Rama:** `feat/memories-settings` (worktree `memory-smoke`), local, sin push. HEAD: `202b189`.

## Estado
- Spec `docs/superpowers/specs/2026-10-20-memories-estilo-obsidian-design.md`, plan `docs/superpowers/plans/2026-10-20-memories-estilo-obsidian.md`.
- 11 tareas (`10e3d5c`..`ea485c7`) + fix wave final (`94a431e`, `e705946`, `e21426e`) + residual de deshacer (`202b189`), todo revisado.
- Typecheck (los 2 de CI): 0 errores. Unit: 3930 passed, 1 fallo de entorno (`memory-store-dos-procesos`). e2e 08+04: 8/8.
- Las capturas de V3 (encuadre del grafo) sólo valen con `RAVEN_E2E_SHOW=1`: headless la simulación no avanza.
- **No se mergeó a main** (decisión de Gero 21-10): la rama trae 836 commits sobre main (integrations, memories, cifrado, plugin, terminal UI) y versión 1.6.0-beta.1; pushear main dispara release.yml.

## Minors diferidos (para un pase futuro)
- Cerrar el overlay entero con una New memory sucia no pide confirmación (F4 cubre sólo pestañas).
- `zoomDeEncuadre` queda null si se mueve el grafo antes del primer `onEngineStop` → sin etiquetas al hacer zoom.
- El keymap de `markdown()` continúa lista/quote al Enter (`> x` tras un ítem da `- > x`).
- Descartar historial en recarga externa pierde el undo previo del usuario (sólo sin cambios locales).
- Resto en el ledger `.superpowers/sdd/2026-10-20-memories-estilo-obsidian/progress.md` (líneas `minor (deferred)`).

## Entorno (esta PC)
- `electron.exe` vivos del MCP `nest_memory` traban better-sqlite3 (EBUSY en `native:*`). No matarlos. Tests SQLite: `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts <archivo>`.
- Después de instalar deps: `node .superpowers/sdd/2026-10-20-memories-estilo-obsidian/tools/restaurar-libc.mjs`.
- Las capturas `.superpowers/sdd/shots/memory-graph/*.png` no se commitean.

## Siguiente
Memory settings → idioma de Nest (ojo: test `la-app-es-en-ingles`) → tema claro → TUI del plugin estilo Engram → panel del `.vsix`. Pendientes viejos: org npm `nestmux` + 2FA, deploy a prod (54ba) con OK de Gero.

---

# Addendum 2026-10-21 — Subproyecto 2a: Memory settings como pestaña (TERMINADO)

- Spec `docs/superpowers/specs/2026-10-21-memory-settings-como-pestana-design.md` (`383bde1`), plan `docs/superpowers/plans/2026-10-21-memory-settings-como-pestana.md` (`911c062`).
- 13 tareas SDD + fix wave final, todo revisado: `9351adb`..`7d25220` (HEAD). Rama local, sin push, sin merge (decisión de Gero).
- Typecheck 0; unit (config bs3) 4055 ok / 1 fallo de entorno; e2e 03/04/08 verdes HEADLESS. **e2e/12 (cifrado dos máquinas) sin correr**: necesita el servicio de sync (`NEST_E2E_SYNC_URL`).
- Gero pidió e2e siempre headless (no `RAVEN_E2E_SHOW=1`): la ventana le aparece en el medio de la pantalla.
- Copy fuera de la tabla del spec que quedó: «This is the address that comes with Nest.» (Advanced › Sync server).
- Gaps del spec resueltos por el plan: fila «Re-upload» siempre visible con cifrado activo; MemoryHub sólo en el primer arranque; Share oculto mientras el permiso es desconocido.
- Siguiente: 2b (equipo y cuenta: plan/upgrade, compartir, vincular máquinas) → idioma de Nest → tema claro.

---

# Addendum 2026-10-21 (2) — 2b-1: Free con un proyecto en la nube (TERMINADO)

- Pricing vigente (Gero, 21-10): Free 1 proyecto en la nube · Cloud US$10/asiento (8 anual) individual · Teams US$20 (15 anual) mín. 2, autoservicio · Enterprise a medida.
- Spec `docs/superpowers/specs/2026-10-21-free-un-proyecto-en-la-nube-design.md`, plan `docs/superpowers/plans/2026-10-21-free-un-proyecto-en-la-nube.md`. Commits `05b5640`..`be16176` (HEAD), local.
- Free conecta; el lugar lo ocupa el primer repo que sube; Settings › Sync muestra «Projects in the cloud» (`1 of 1 · repo`, `Local only: … — Upgrade`); la fila de estado lo muestra en gris, sin ámbar. El daemon destraba lo retenido apenas hay lugar (también tras reinicio/cambio de cuenta).
- Verificado: tsc 0; unit 4118 ok / 1 fallo de entorno; server 459 ok (Postgres `nest-memory-pg`); e2e 03 (Projects in the cloud) y 04 headless.
- **Pendiente:** smoke manual Free + 2 repos contra staging (ningún test lo cubre de punta a punta; el e2e finge el status). La beta cerrada sigue mandando (`not_in_beta`).
- Siguiente: 2b-2 pagar Cloud (crear precios de Stripe: acción externa, con OK de Gero) → 2b-3 UI de cuenta → 2b-4 Teams autoservicio.

---

# Addendum 2026-10-21 (3) — 2b-2: pagar Cloud con Stripe (CÓDIGO TERMINADO, sin salir)

- Spec `docs/superpowers/specs/2026-10-21-pagar-cloud-stripe-design.md` (`3f8f143`), plan `docs/superpowers/plans/2026-10-21-pagar-cloud-stripe.md` (`bfc5045`). Commits `2ede456`..`2be6257` (HEAD), local, sin push.
- Qué hay: `stripe-checkout` endurecido (JWT, `{interval}`, sin trial, 409/503); `stripe-portal` nueva; webhook mapea Cloud desde secrets, chequea que la suscripción siga viva antes de activar y avisa al servidor por `POST /internal/plan` firmado (HMAC, `PLAN_SYNC_URL`/`PLAN_SYNC_SECRET`); baja a free en dos pasos (no pierde el aviso). Servidor: `/internal/plan` (plan + allowlist), el registro relee el plan pago de Supabase (sólo sube), migración 011 `kept_project_key`, `POST /v1/projects/keep`, status con `kept_project_key`/`over_limit`. App: modal Monthly/Annual + Manage subscription, toast «Cloud is active», `Keep syncing` en Settings › Sync.
- Verificado: tsc 0 (los dos de CI y server); supabase/functions 209 ok; server 499 ok (Postgres); unit 4223 ok / 1 fallo de entorno; e2e/04 headless.
- **NADA externo hecho.** Salida paso a paso en `docs/RUNBOOK-PAGAR-CLOUD.md`, cada paso con OK de Gero. **BLOQUEANTE: no mergear a main sin cargar antes los secrets de prod y deployar el server nuevo en Railway** — `release.yml` despliega el webhook nuevo solo y sin eso toda activación da 500.
- Páginas `/checkout/success|cancelled|portal-return` van en `pagina-nest` (deploy de Gero).
- Pendiente anotado: el back-office puede poner `cloud` a mano sin avisar al sync (2b-3); customer de Stripe borrado → 502 en checkout (2b-3); e2e/04 no renderiza el toast ni `Keep syncing`.
- Siguiente: ejecutar el runbook en modo test (con OK) → 2b-3 UI de cuenta → 2b-4 Teams autoservicio.

---

# Addendum 2026-10-22 — runbook 2b-2 en modo test, TODO LOCAL (a medio camino)

Decisiones de Gero: **no hay Supabase de staging** → se prueba con Supabase local + Stripe test +
servidor de sync local (nada de Railway). Gero **no entrega su `sk_test`** por chat ni archivo.

**Hecho:**
- Stripe CLI 1.55.0 instalado con winget. Quedó en el perfil de la sesión, no en el PATH de `!`:
  `~/AppData/Local/Microsoft/WinGet/Packages/Stripe*/stripe.exe`. Login OK contra **Nest · sandbox**
  (`acct_1TJkZ8JarRYFmNbK`, el "Modo de prueba"; nunca elegir "Nest" = live). El login por dispositivo
  vence en minutos: correr `login` y enseguida `login --complete-device` en background y abrirle el link.
  La sesión del CLI vence a la hora (re-login de un clic).
- En el sandbox: producto **Nest Cloud** `prod_VUM5ZyvtzfQL9U`, precios `price_1UTNMtJarRYFmNbKg0hY6xse`
  ($10/mes, lookup `cloud_monthly`) y `price_1UTNMuJarRYFmNbKabIiPPVH` ($96/año, `cloud_annual`).
  Los `price_` no son secretos.
- Supabase local de raven-nest **en otros puertos** para convivir con el de `sti-booking-desk`: copia de
  `supabase/` en un dir temporal, `sed -E 's/^(\s*#?\s*[a-z_]*port\s*=\s*)54([0-9]{3})/\155\2/'` sobre
  su `config.toml`, y `npx supabase start --workdir <dir> -x vector,logflare` → API 55321, DB 55322,
  migraciones al día. (Reiniciar Docker dejó abajo el stack de `sti-booking-desk`: se levanta con
  `supabase start` en ese proyecto.)
- Servidor de sync local: `docker start nest-memory-pg` y `server/` con `PORT=8787`,
  `SUPABASE_URL=http://127.0.0.1:55321`, anon key y `SUPABASE_JWT_SECRET` locales, `PLAN_SYNC_SECRET`
  generado al momento (no guardado en ningún lado: regenerar). `POST /internal/plan` sin firma → **401** ✓.
- `stripe listen --print-secret` da el `whsec_` para el webhook local (no hace falta endpoint en el
  dashboard).

**Bloqueado / pendiente:**
1. **Clave para las functions.** El login del CLI NO da API key: guarda un token OAuth del usuario
   (Super Admin) en el llavero de Windows (`StripeCLI:uat`, `oauth_refresh_token`) — **no usarlo** como
   `STRIPE_SECRET_KEY`. Propuesta pendiente de Gero: **restricted key** `nest-local-smoke` en el sandbox
   (Checkout Sessions W, Customers W, Customer portal W, Subscriptions R, resto None) que él pega con
   notepad en un archivo local; se revoca al terminar.
2. **Portal de clientes**: `stripe-portal` no pasa `configuration`, usa la **default**, y ésa sólo se
   guarda desde el dashboard (no hay ninguna en el sandbox). Gero tiene que guardarla: cancelar al fin
   del período, actualizar pago, facturas, cambiar de plan sólo entre los dos precios de Cloud.
3. Después: `supabase functions serve` con env file (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRICE_CLOUD_*`, `PLAN_SYNC_URL=http://host.docker.internal:8787` —las functions corren en
   Docker—, `PLAN_SYNC_SECRET`), `stripe listen --forward-to http://127.0.0.1:55321/functions/v1/stripe-webhook`,
   Nest dev apuntado a ese Supabase y a `http://127.0.0.1:8787`, y la §3 del runbook (tarjeta 4242).
4. La PC se quedó **sin memoria** con todo arriba (Claude Code mató el server de sync). Antes de seguir,
   cerrar cosas; Docker Desktop es lo más pesado.
5. Al cerrar la prueba: revocar la restricted key, borrar los archivos de secretos temporales,
   `npx supabase stop --workdir <dir>`, `docker stop nest-memory-pg`.

---

# Addendum 2026-10-29 — 2b-3 cuenta en Settings: SPEC ESCRITO (sin plan, sin código)

Gero sigue **desde la Mac**. La rama `feat/memories-settings` está pusheada a origin (primer push el
29-10; antes era sólo local). En la Mac: `git fetch && git switch feat/memories-settings`,
`npm i`, `npm run native:electron`. Credenciales de Doppler/1Password, nada en el repo.

- Spec: `docs/superpowers/specs/2026-10-29-cuenta-en-settings-design.md`. Decisiones D1-D4 de Gero
  en su §2 (alcance plan+uso, vive en Settings › Account, fechas guardadas por el webhook,
  Disconnect por máquina).
- **Estado del gate de brainstorming:** el diseño se aprobó sección por sección en el chat; **falta
  que Gero revise el spec escrito**. Recién con ese OK → `superpowers:writing-plans` → elegir modo
  de ejecución.
- Incluye los huecos de 2b-2 (back-office sin avisar al sync, customer borrado → 502) y el e2e/04
  que no renderizaba el toast ni `Keep syncing`.
- La prueba de 2b-2 en modo test (addendum 22-10) sigue frenada en las dos acciones de Gero en
  el sandbox de Stripe (restricted key y portal default). Su entorno era de la PC Windows (Supabase
  local en 55xxx, CLI de Stripe por winget): en la Mac hay que levantarlo de nuevo con la receta.
  Las migraciones y deploys de 2b-3 salen junto con los de 2b-2.
- Notas de entorno Windows (`restaurar-libc`, EBUSY por `electron.exe` del MCP) no aplican a la Mac;
  ojo con el ABI de Node para el binding de tests (CLAUDE.md).

---

# Addendum 2026-10-29 (2) — 2b-3 cuenta en Settings: CÓDIGO TERMINADO, sin salir

Rama `feat/memories-settings`, commits `839954e..1a374a0` (spec y plan:
`docs/superpowers/{specs,plans}/2026-10-29-cuenta-en-settings*`). **Nada se desplegó ni se mergeó**:
no hubo `db push`, deploys, secrets ni llamadas a Stripe. La salida va en `docs/RUNBOOK-PAGAR-CLOUD.md`
§6, junto con la de 2b-2 y con el mismo bloqueante (no mergear a main sin secrets de prod y servidor nuevo).

- **Qué hay:** migración `20261029000000_profiles_billing_period.sql` (intervalo, fin de período y
  cancelación en `profiles`, protegidas por el trigger); `stripe-webhook` las guarda; `PUT /plan` de
  `admin-api` avisa al sync (`PLAN_SYNC_URL`/`PLAN_SYNC_SECRET` ahora también los lee admin-api);
  customer borrado ya no traba checkout (sesión con email) ni portal (404 `no_subscription`); servidor
  de sync con `GET /v1/devices` y revoke por `deviceId`; daemon con `devices()`/`revokeDevice()`;
  Settings › Account con Plan, Usage y Machines; `Keep syncing` abre Memory settings › Sync y
  `Plan & billing` abre Account.
- **Verificado (corridas finales):** supabase/functions **227 tests**; server **514 tests** contra
  Postgres real + `tsc` 0; proyecto jsdom **1015 tests** (140 archivos); e2e 03+04 **15/15** headless
  tras `npm run build`; los dos `tsc` de CI **0 errores**. Cada tarea pasó revisión sin pendientes.
- **NO verificado:** el smoke contra Supabase local y Stripe sandbox (pasos en el runbook §6). El
  entorno de 2b-2 vivía en la PC Windows y hay que rehacerlo en la Mac. Los shells Deno (`index.ts`
  de las functions) no tienen test ni typecheck; la forma `resource_missing`/`param: customer` de
  Stripe es la documentada pero nunca se vio en vivo.
- **Desvíos del spec:** portal con customer borrado = 404 `no_subscription` (no 409); `last seen 3d
  ago`; trial muestra Upgrade; `plan_required` = "Cloud sync is off."; `GET`+`POST` en `/v1/devices`.
  Bug previo arreglado en `1a374a0`: `memory:status` del preload admitía un solo oyente (lo destapó el
  e2e: al desmontar la tarjeta Cloud, Account quedaba sorda).
- **Menores diferidos que conviene mirar (el ledger vive en `.superpowers/` git-ignored y se borra):**
  - `stripe-webhook`: en `subscription.updated` el plan sale del precio del EVENTO y el período de la
    sub releída; en un reintento viejo pueden diferir (derivar el precio de `sub` lo unifica). El
    cableado Deno (upsert con período, `bajar_a_free`) y la secuencia limpiar+reintentar de checkout
    y portal no tienen test.
  - `stripe-portal/portal.ts` importa `esClienteInexistente` de `../stripe-checkout` (único import
    cruzado entre functions; la convención es `_shared/`).
  - `PUT /plan` espera hasta 10 s al sync si está caído.
  - Test de migración sólo por texto (regex): lo cubre el smoke.
  - Servidor: `deviceId: null` → 400 sin test. Daemon: `listDevices` mapea id faltante a `"undefined"`;
    sin tests de body no-JSON ni fetch que lanza.
  - UI: el `disconnected` inicial de `useMemory` puede mostrar "Cloud sync is off." un instante (el
    hook no expone "primer status leído"); `seccionPedida`/`pedidoDeSettings` son props separados con
    `eslint-disable` (mejor un objeto `{n, seccion}`); sin test unitario de que Keep syncing pasa
    `('settings','sync')` (lo cubre el e2e).
  - e2e: el toast-cloud depende de que el perfil cargue antes del evento; fake de status sin tipo;
    `useMemory.test` no restaura `onStatus`/`window.memory` en `afterEach`.
- **Entorno Mac:** node de Homebrew = 26 y rompe `electron-rebuild`; usar
  `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`. Tests del server: Postgres 16 nativo en :55432.

## Addendum 29-10 (3): seguridad e infraestructura de prod

- **Policy abierta en `profiles` (Supabase prod):** la policy «Service role can upsert profiles», creada en el dashboard, valía para `public` con `using (true)`. Con la anon key se podían leer `github_token`/`gitlab_token` de los 94 perfiles y modificar o borrar cualquiera. **Cerrada el 29-10** con `supabase/migrations/20261030000000_close_open_profiles_policy.sql`, aplicada por `supabase db query --linked -f` (no queda en el historial de migraciones; es idempotente).
- **PENDIENTE (decisión de Gero, postergada): revocar los tokens de GitHub y GitLab** que pudieron haberse leído. En GitHub: OAuth App de Nest › Revoke all user tokens. En GitLab: la Application › Renew secret. Después, los usuarios reconectan desde Settings.
- **Sync de prod:** `sync.nestmux.com` activo. Se rotaron `BETA_LINK_SECRET` y la contraseña de Postgres (incidente de Railway del 20 al 22-10). Hay backup diario a R2 con restore verificado. Ver `docs/RUNBOOK-DOMINIOS.md` §C.
- **Supabase sigue sin backups** (Free). Gero está evaluando opciones.
