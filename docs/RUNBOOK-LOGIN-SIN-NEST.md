# Runbook — login y compra de Nest Memories sin Nest

Spec: `docs/superpowers/specs/2026-11-02-login-y-compra-sin-nest-design.md`.
Plan: `docs/superpowers/plans/2026-11-02-login-y-compra-sin-nest.md`.

Código en dos repos: raven-nest (`feat/memories-settings`: servidor, CLI, `stripe-checkout`) y
pagina-nest (`feat/link-page`, sobre el PR #10). **Cada paso externo, con OK de Gero.**

## 1. Orden de salida

1. Mergear el PR #10 de pagina-nest (`feat/checkout-pages`). `feat/link-page` sale de él.
2. Servidor de sync (Railway): deploy de la rama con la migración 014 (corre sola al arrancar)
   y la variable `LINK_WEB_ORIGINS=https://nestmux.com`. Verificar:
   `curl -i -X OPTIONS https://sync.nestmux.com/v1/link/check -H 'Origin: https://nestmux.com' -H 'Access-Control-Request-Method: POST'`
   → `204` con `access-control-allow-origin: https://nestmux.com`. Con
   `-H 'Origin: https://evil.example'` → sin esa cabecera.
3. Supabase prod — Auth → URL Configuration → Redirect URLs: sumar
   `https://nestmux.com/link**` y `https://nestmux.com/upgrade**`. Los comodines son
   obligatorios: la vuelta del OAuth lleva `?link_code=…`, y una URL sin comodín no coincide
   con la lista y Supabase cae al Site URL.
4. Supabase prod: `supabase functions deploy stripe-checkout` (acepta `from`). Sin este deploy
   la compra funciona igual, pero la página de vuelta no ofrece volver a la terminal.
5. Vercel (`pagina-nest`): confirmar `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY` (ya
   están por la encuesta) y sumar `PUBLIC_SYNC_BASE_URL=https://sync.nestmux.com`. Mergear
   `feat/link-page` y deployar (Vercel bloquea commits de colaboradores: lo hace Gero).
6. Publicar `@nestmux/memory` con el `login` nuevo (flujo de release del paquete, aparte).

## 2. Smoke local de punta a punta (sin tocar prod)

Requisitos: Docker, Supabase local (`npx supabase start` en raven-nest), Postgres
`nest-memory-pg` en 55432.

1. **Supabase local**: anotar `API URL`, `anon key` y el JWT secret de `npx supabase status`.
   Crear un usuario con email y contraseña desde Studio (Auth → Add user, auto-confirm).
   OAuth no se prueba en local salvo que se configuren los proveedores: si se quiere, sumar
   `http://localhost:4321/**` a `additional_redirect_urls` de `supabase/config.toml` **sin
   commitearlo**.
2. **Servidor de sync en 8099** (desde `server/`):
   `SUPABASE_URL=<API URL> SUPABASE_ANON_KEY=<anon> SUPABASE_JWT_SECRET=<jwt secret> DATABASE_URL=postgres://postgres:nestmem@127.0.0.1:55432/nest_memory PORT=8099 npx tsx src/index.ts`
   (sin `LINK_WEB_ORIGINS`: vale `http://localhost:4321`).
3. **pagina-nest** (en `C:\Users\gerod\Dev\pagina-nest-link`): `.env` con
   `PUBLIC_SUPABASE_URL=<API URL>`, `PUBLIC_SUPABASE_ANON_KEY=<anon>`,
   `PUBLIC_SYNC_BASE_URL=http://127.0.0.1:8099`; `npm run dev` (puerto 4321).
4. **Paquete**: `npm --prefix packages/nest-memory run build` y, en una terminal con un HOME
   aislado (ver la trampa del llavero en `docs/HANDOFF-2026-10-19-prueba-plugin.md`):
   `NEST_MEMORY_SYNC_URL=http://127.0.0.1:8099 NEST_MEMORY_WEB_URL=http://localhost:4321 node packages/nest-memory/dist/cli-del-paquete.js login`

Checklist (cada punto, visto):

- [ ] La CLI imprime `To connect this machine, open:` / `  http://localhost:4321/link?code=XXXX-XXXX` / `and sign in… (expires in 10 minutes)` y abre el navegador (en Windows con `rundll32`, no `start`).
- [ ] La página pide login; entrar con email y contraseña vuelve a la misma página con el código (la vuelta usa `?link_code=`, la CLI imprime `?code=`: ambos valen).
- [ ] Usuario **fuera** de la allowlist: la confirmación muestra el aviso de beta privada y el botón de checkout, sin Approve.
- [ ] Insertar el usuario en `allowlist` (`docker exec -i nest-memory-pg psql -U postgres nest_memory -c "insert into users (id) values ('<uuid>') on conflict do nothing; insert into allowlist (user_id) values ('<uuid>');"`) y apretar "I already paid — check again": aparece Approve.
- [ ] La confirmación muestra el nombre de la máquina (hostname), el sistema y "requested … ago".
- [ ] Approve → "This machine is connected." + tarjeta "You're on Free — 1 cloud project." con $15/mo y $144/yr.
- [ ] La CLI pasa a `Connected` y corre el enrolamiento del cifrado (muestra el código de recuperación y pide `saved`).
- [ ] Recargar la página con el mismo `?code=` → "That code was already approved…".
- [ ] Correr `login` otra vez en otro HOME, dejar pasar 10 minutos en la confirmación → "That code expired…" sin poder aprobar.
- [ ] `http://localhost:4321/link?code=xxxx1111` (minúsculas, sin guión, inventado) → se normaliza y el servicio contesta "That code doesn't exist…".
- [ ] `http://localhost:4321/link` sin código → pide el código a mano.
- [ ] `http://localhost:4321/upgrade` → login → tarjeta de plan.
- [ ] Desde la consola del navegador en otra página (`https://example.com`):
      `fetch('http://127.0.0.1:8099/v1/link/check',{method:'POST'})` → bloqueado por CORS.
- [ ] `status` del paquete con `users.plan = 'legacy'` en esa cuenta (después de un push que
      devuelva `plan_required`) muestra la fila `Upgrade` con `http://localhost:4321/upgrade`.
      Esa fila **persiste hasta el próximo sync exitoso después de pagar**; y un error de red
      en el último intento puede ocultarla (no es que ya no haga falta).

Checkout real (Stripe en modo test) se prueba contra staging con `docs/RUNBOOK-PAGAR-CLOUD.md`
§3, sumando: pagar desde `/link` con un usuario fuera de la beta → la vuelta muestra
"Finish connecting →" → vuelve a `/link?code=…` → Approve habilitado.

## 3. Recuperación

- Página caída o mal deployada: la tarjeta de Nest (Memory settings → "Machine without a
  browser") sigue aprobando códigos; el `login` lo dice en su línea tenue.
- CORS mal configurado (`LINK_WEB_ORIGINS` sin el origen real): la página muestra
  "Couldn't reach the Nest sync service". Corregir la variable en Railway; no hace falta deploy
  de la página.
- Revertir: la migración 014 sólo agrega columnas nullables; un servidor viejo las ignora.

## 4. Pendientes que dejaron las revisiones (no bloquean la salida)

- pagina-nest: evaluar `flowType: 'pkce'` en supabase-js. Hoy el flujo es implícito y el token
  del OAuth vuelve en el fragmento de la URL.
- Gestión de máquinas en la web: un usuario Cloud que sólo usa el paquete y llegó al tope de
  máquinas no tiene dónde quitar una (hoy sólo desde Nest → Account).
- `fetchPlanDeSupabase` (red de seguridad del plan pago) no tiene timeout: ponerle uno corto.
