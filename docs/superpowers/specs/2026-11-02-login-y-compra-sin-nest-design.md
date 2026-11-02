# Login y compra sin Nest — diseño

**Fecha:** 2026-11-02 · **Rama:** `feat/memories-settings` (+ rama nueva en `pagina-nest`) ·
**Estado:** para revisión de Gero · **Fase 1, punto 4** del lanzamiento de Nest Memories

## Objetivo

Nest Memories se vende en Nest **y en cualquier IDE/ADE**. Alguien con Cursor, VS Code o
cualquier agente, sin Nest instalado, corre `npx @nestmux/memory login`, abre un link, entra
con su cuenta, aprueba la máquina y —si quiere la nube completa— paga Cloud (US$15/mes,
US$144/año) en la misma página. Después del login rige el cifrado obligatorio
(`2026-11-02-cifrado-obligatorio-design.md`) sin cambios.

## Problema

- `login` del paquete (`electron/cli-del-paquete.ts:483-574`) crea un pedido de vinculación
  (`/v1/link/start`) e imprime "Open Nest on a machine where you are signed in… Memory
  settings → Add a machine that has no browser". **El único que aprueba es una app Nest
  abierta** (`LinkDeviceCard.tsx` → `memory:linkApprove` en `main.ts:3280`).
- No existe la página web que el spec portátil §7 dibujaba (`…/link?code=`); `link.ts:9-11`
  lo deja dicho.
- El plugin no tiene ningún camino a pagar: el daemon detecta `plan_required` /
  `project_limit_reached` pero sólo la UI de Nest lo convierte en botón Upgrade.
- Durante la beta, alguien fuera de la allowlist aprueba y recién al reclamar el token la CLI
  le dice "the service refused this machine: not_in_beta".

Lo que ya sirve sin Nest y se reusa: `/v1/link/approve` acepta cualquier JWT de Supabase
(`verificarJwtDeSupabase`, `devices.ts:123`), la edge function `stripe-checkout` también
(identidad sólo del JWT, CORS `*`), y `pagina-nest` ya tiene `@supabase/supabase-js`
(`src/lib/supabase.ts`), React y Astro.

## Decisiones (Gero, 2026-11-02)

1. La página vive en **`nestmux.com/link`** (repo `pagina-nest`), al lado de las páginas de
   checkout del PR #10.
2. La compra se ofrece **después de aprobar, opcional**; además el plugin imprime un link a
   `nestmux.com/upgrade` cuando choca con el límite.
3. **Los mismos métodos de login que Nest** (email + contraseña y los OAuth de
   `AuthScreen.tsx`), contra el mismo Supabase: una sola cuenta.
4. Beta: **aviso antes de aprobar** si la cuenta no entra, con la salida de pagar (pagar ya
   te mete en la allowlist, `plan-sync.ts`).

## Diseño

### 1. CLI (`npx @nestmux/memory login`)

- `/v1/link/start` manda también `name` (hostname) y `platform` (`win32`/`darwin`/`linux`).
- Imprime:
  ```
  To connect this machine, open:
    https://nestmux.com/link?code=WXYZ-1234
  and sign in with your Nest account. Code: WXYZ-1234 (expires in 10 minutes)
  ```
  e intenta abrir el navegador (`rundll32 url.dll,FileProtocolHandler` en Windows —`start` es un
  builtin de `cmd.exe` y exigiría shell—, `open` en Mac, `xdg-open` en Linux; sin shell, ignorando
  errores). La CLI imprime `?code=`; la página acepta también `?link_code=` (ver §4).
  Si no hay navegador (SSH, contenedor) la persona abre el link en cualquier dispositivo.
- La base de la URL sale de una constante de build (`NEST_WEB_BASE`, default
  `https://nestmux.com`), con override por env `NEST_MEMORY_WEB_URL` para desarrollo, igual
  que la base del sync.
- El resto del bucle (`login-del-paquete.ts`) no cambia. La tarjeta de Nest sigue aprobando
  como alternativa.

### 2. Upgrade desde el plugin

- `estado-de-sync-del-paquete.ts` (`status`) y el resumen del MCP, ante `plan_required` o
  `project_limit_reached`, suman: `Upgrade to Cloud ($15/mo) to sync every project:
  https://nestmux.com/upgrade`. `device_limit_reached` dice cuántas máquinas permite el plan y
  apunta al mismo link.

### 3. Servidor de sync

- **Migración 014:** `link_requests` suma `device_name text` y `platform text` (nullables;
  clientes viejos no los mandan). `/v1/link/start` los acepta (largo máximo 100, se recortan;
  `platform` sólo de una lista conocida o null).
- **Ruta nueva `POST /v1/link/check`** (JWT de Supabase + `{ code }`): devuelve
  `{ device_name, platform, created_at, expires_at, expires_in, eligibility, plan }` con
  `eligibility ∈ ok | not_in_beta | plan_required | device_limit_reached`. `expires_in` son los
  segundos que le quedan medidos con el reloj del servidor; `plan` es el plan efectivo de la
  cuenta (la página adapta el copy del tope de máquinas: en Cloud no ofrece "Upgrade"). Corre **el mismo
  control** que `registerDevice` (extraído a una función compartida, para que no haya dos
  verdades) pero sin crear `users` ni emitir token. Código desconocido → 404 `unknown_code`;
  vencido → 400 `expired`; ya aprobado → 409 `already_approved`. Rate limit de 20 por hora
  **por `userId` verificado** (no por IP: detrás del proxy de Railway todos comparten IP, y un
  401 no gasta el cupo).
- `/v1/link/approve` no cambia de contrato, pero aplica la red de seguridad del plan pago de
  Supabase (la misma que `registerDevice` con el JWT) antes de atar el pedido, para que el `ok`
  de `check` y el reclamo coincidan.
- **CORS** en `/v1/link/check` y `/v1/link/approve` (preflight `OPTIONS` incluido): origen
  permitido `https://nestmux.com` y, fuera de producción, `http://localhost:4321`; lista por
  env `LINK_WEB_ORIGINS`. Sólo `POST`, headers `authorization, content-type`, sin
  credenciales (no hay cookies). El resto de las rutas sigue sin CORS.

### 4. Página `nestmux.com/link` (pagina-nest)

Una isla React (`src/components/link/LinkFlow.tsx`) en `src/pages/link.astro`, en inglés,
`noindex`, fuera del sitemap. Estados:

1. **Sign in** — si no hay sesión: email + contraseña y los mismos OAuth que Nest, con
   `redirectTo` a `https://nestmux.com/link?link_code=…` (el código sobrevive al viaje; se usa
   `link_code` y no `code` porque `code` es el parámetro del intercambio PKCE de Supabase). Sin
   registro aparte: "Create account" usa el mismo `signUp` que Nest.
2. **Confirm** — llama `/v1/link/check`. Muestra: código, nombre de la máquina, sistema,
   "requested N minutes ago", y el aviso *"Approve only if you just ran `login` yourself.
   Never approve a code someone sent you."* Botones **Approve this machine** / **Cancel**.
   - `eligibility = not_in_beta` → en lugar de Approve: *"Nest Memories Cloud is in private
     beta. Your local memory already works on this machine. Upgrade to Cloud to get in
     now."* con el botón de checkout; al volver del pago se re-chequea.
   - `device_limit_reached` → explica el límite y ofrece Upgrade.
3. **Done** — después de `/v1/link/approve` ok: *"This machine is connected. Go back to your
   terminal."* + tarjeta de plan: en Free, *"You're on Free — 1 cloud project. Upgrade to
   Cloud: $15/mo or $144/yr"*; en Cloud, *"You're on Cloud."*
4. **Errores** — `expired`, `unknown_code`, `already_approved`: qué pasó y "Run
   `npx @nestmux/memory login` again". Un error que el mapa de copy no conoce se muestra tal
   cual (misma regla que `LinkDeviceCard`).

Sin `?code=` la página pide el código a mano (mismo `normalizarCodigo` permisivo, sin validar
contra el alfabeto del servidor).

**Checkout:** llama a la edge function `stripe-checkout` con el JWT y el intervalo, y
redirige a la `url` que devuelve. `already_subscribed` (409) abre `stripe-portal`. Las
páginas de vuelta son las del PR #10 (`/checkout/success`, `/cancelled`); `success` suma un
"Back to your terminal" cuando el pago vino de `/link` o `/upgrade` (parámetro `from`).

**Plan y precios:** la página lee el plan de `profiles.plan` con la sesión (RLS: el propio
usuario) y los precios de una constante que espeja `src/lib/stripe.ts` de Nest (15 / 144).

### 5. Página `nestmux.com/upgrade`

La misma isla en modo sin código: sign in → tarjeta de plan → checkout. Es el link que
imprime el plugin y el que puede usar cualquiera desde la landing.

### 6. Configuración externa (cada paso con OK de Gero)

- Supabase prod: sumar `https://nestmux.com/link**` y `https://nestmux.com/upgrade**` a las
  Redirect URLs de Auth. Con comodín: la vuelta lleva query (`?link_code=…`) y sin él Supabase
  cae al Site URL.
- Railway: env `LINK_WEB_ORIGINS=https://nestmux.com` en el servicio de sync; migración 014.
- Vercel (`pagina-nest`): `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` (ya están para la
  encuesta) y `PUBLIC_SYNC_BASE_URL=https://sync.nestmux.com`.
- Mergear PR #10 (checkout pages) antes que esta rama de `pagina-nest`.

## Seguridad

- **Phishing por código** (alguien manda su código para que la víctima lo apruebe): el
  código vence a los 10 minutos y se aprueba una sola vez; la confirmación muestra máquina,
  sistema y antigüedad con el aviso explícito. Y aunque la víctima apruebe, el cifrado
  obligatorio limita el daño: la máquina del atacante recibe un token **sin la maestra**;
  contra una cuenta que ya cifra queda en `esperando-autorizacion` y sólo otra máquina de la
  víctima, comparando la huella, puede darle la clave. La memoria existente sigue ilegible.
- **Dos códigos** como hoy: la página sólo ve el `user_code`; el `device_code` nunca sale de
  la máquina que lo pidió.
- `/v1/link/check` no revela nada sin JWT válido y sólo devuelve datos del pedido, no de otras
  cuentas. Desconocido/vencido se distinguen (ya lo hacía `approve`), no habilita enumerar:
  38 bits de espacio + rate limit.
- CORS cerrado a orígenes conocidos; el JWT viaja en `Authorization`, nunca en la URL.
- Nada del contenido de la memoria pasa por la página ni por `pagina-nest`.

## Tests

- **Servidor:** `link-check.test.ts` — elegibilidad igual que `registerDevice` (allowlist,
  plan, límite de devices) y que **no** crea `users` ni token; 404/400/409; `name`/`platform`
  recortados y validados en `start`; CORS: preflight y `POST` desde `https://nestmux.com`
  llevan los headers, desde otro origen no; las demás rutas no tienen CORS.
- **CLI:** `login` imprime la URL con el código y llama al abridor; si el abridor falla,
  sigue esperando; manda `name`/`platform`. Status con `plan_required` imprime el link de
  upgrade.
- **pagina-nest:** la lógica de estados del flujo como función pura (`siguienteEstado`) con
  tests (vitest, nuevo en el repo); `astro build` en verde; smoke manual: `astro dev` contra el
  sync local (`:8099`) y Supabase local, login → check → approve → la CLI recibe el token y
  activa el cifrado.

## Fuera de alcance

- Página en español (`/es/link`): el producto va en inglés.
- Teams (sale después del lanzamiento).
- Login completamente en la terminal (OTP por email).
- Que la extensión de VS Code tenga su propio botón de login: usa la misma CLI.
