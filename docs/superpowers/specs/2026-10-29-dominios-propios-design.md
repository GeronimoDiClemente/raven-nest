# Dominios propios para Supabase y el servicio de sync — diseño (paso 0)

Fecha: 2026-10-29 · Rama: `feat/memories-settings` · Antes de la beta cerrada de Nest Memories.

## 1. Para qué

Que ninguna app ni plugin que salga desde la beta tenga escrita la dirección de un proveedor.
Todo habla con nombres de `nestmux.com`. Dos razones de Gero:

- **Seriedad**: lo que ve un tester, un cliente enterprise o quien mira el tráfico de la app es
  `nestmux.com`, no `*.supabase.co` ni `*.up.railway.app`.
- **Libertad para mudarse**: el servicio de sync probablemente se mude de Railway (a AWS São Paulo
  o a un servidor propio) cuando aparezca un cliente que pida SLA. Con el dominio puesto, esa
  mudanza es cambiar un registro DNS en Vercel, sin publicar una versión nueva y sin que nadie lo
  note.

## 2. Objetivos, no-objetivos y anti-objetivos

**Objetivos**
- `sync.nestmux.com` delante del servicio de sync (hoy Railway prod `sync-production-54ba`).
- `api.nestmux.com` delante de Supabase (auth, REST, functions, realtime).
- La beta y todo lo posterior salen con esos nombres horneados.
- El cambio no le corta nada a nadie: las instalaciones 1.5.x y las máquinas ya conectadas siguen
  andando sin hacer nada.

**No-objetivos**
- Mudar el servicio de sync o Supabase a otro proveedor. Es el paso siguiente y este spec lo
  prepara.
- Cambiar el dominio de la landing ni de las páginas de checkout (ya están en `nestmux.com`).
- Las integraciones de repos (OAuth de GitHub/GitLab para conectar repos): vuelven a
  `nest://oauth/...` y no pasan por Supabase.

**Anti-objetivos** (sería un fracaso aunque "funcione")
- Que un usuario tenga que volver a loguearse o a conectar la nube por el cambio.
- Que el plugin portátil quede con un token "de otro servicio" y empiece a avisar que apunta al
  lugar equivocado.
- Que un mail de auth, un login con Google/GitHub o un webhook de Stripe se rompa en silencio.

## 3. Decisiones

| # | Decisión | Estado |
|---|---|---|
| D1 | Nombres: `api.nestmux.com` (Supabase) y `sync.nestmux.com` (servicio de sync). | Propuesta de Claude; Gero puede cambiarlos antes de ejecutar |
| D2 | El DNS se maneja en **Vercel**, donde ya está `nestmux.com`. | Dato de Gero |
| D3 | Supabase: pasar la org «Nest» (`adozwiewnyrzadtefdvd`) a **Pro** y sumar el add-on **Custom Domain**. Verificado el 29-10: hoy el dominio propio da `entitlement_required` y el proyecto tiene **0 backups diarios** (señal de plan Free); Pro también trae backups diarios de 7 días. | **Pendiente de Gero.** Si dice que no, se hace sólo la parte de sync (§4.1) y `api.nestmux.com` queda para después |
| D4 | Las direcciones viejas siguen vivas indefinidamente (Supabase y Railway las mantienen aunque haya dominio propio). No se apaga nada. | Decisión de diseño |
| D5 | **La beta no se bloquea por D3.** Si D3 no está aprobado cuando la beta esté lista, sale con `sync.nestmux.com` y Supabase en `supabase.co`; `api.nestmux.com` llega en una beta siguiente. | Decisión de Claude |
| D6 | **Sin re-login.** El cliente de Supabase pasa a un `storageKey` fijo (`nest-auth`) y en el primer arranque copia la sesión guardada bajo la clave vieja (`sb-<ref>-auth-token`). Sin esto el cambio de URL desloguea a todos: supabase-js arma la clave con el host. | Decisión de Claude (cumple el anti-objetivo) |
| D7 | **La URL de Supabase deja de depender sólo del secret global de CI.** Hoy `VITE_SUPABASE_URL` es un secret de repo y cualquier release desde `main` (por ejemplo un hotfix 1.5.x) lo tomaría. El secret no se cambia hasta que la rama llegue a `main`; los builds de la rama (la beta, por `workflow_dispatch --ref`) lo reciben con un override de `release.yml` para el canal beta. | Decisión de Claude |
| D8 | **Stripe sin solapamiento**: se **edita la URL del endpoint existente** (live y sandbox) en vez de crear uno nuevo. Editar la URL conserva el `whsec`, así que no hay dos endpoints ni dos secretos a la vez. Igual el handler ya es idempotente: hace upsert de lo que relee de la suscripción y el aviso al sync manda lo que quedó en `profiles`. | Decisión de Claude |
| D9 | **Quién ejecuta lo externo**: Claude, por CLI, con el OK de Gero paso por paso (como el runbook de 2b-2), y cada paso queda en `docs/RUNBOOK-DOMINIOS.md`. El back-office vive en otro repo: ahí sólo se deja anotado el cambio. | Decisión de Claude |
| D10 | **`MAIN_VITE_SUPABASE_URL` deja de ser base de sync.** Hoy `electron/main.ts:255` lo usa como origen `delBuild` de la base de sync, un resto de cuando el sync vivía en Supabase. Se renombra a `MAIN_VITE_SYNC_URL`; las recetas de desarrollo de `docs/` se actualizan. | Decisión de Claude |

## 4. Diseño

### 4.1 `sync.nestmux.com` (no depende de D3)

1. **Railway**: agregar el dominio propio `sync.nestmux.com` al servicio `sync` del proyecto
   `nest-memory-sync`. Railway da el CNAME destino y emite el certificado.
2. **Vercel DNS**: registro `CNAME sync → <destino que da Railway>`. Esperar a que Railway marque
   el dominio como activo y verificar `https://sync.nestmux.com/v1/sync/status` → 401 (ruta viva,
   sin token).
3. **Código**: `BASE_DE_SYNC_POR_DEFECTO` en `electron/base-de-sync.ts` pasa a
   `https://sync.nestmux.com`.
4. **Alias de la dirección vieja**: `normalizarBaseDeSync` (o una función nueva al lado) trata
   `https://sync-production-54ba.up.railway.app` como **la misma** base que
   `https://sync.nestmux.com` y la devuelve normalizada a la nueva. Es el mismo servidor, así que los
   tokens siguen valiendo. Esto cubre:
   - la base **guardada** por la app (Advanced › Sync server) si alguien escribió la de Railway;
   - el servicio que el **plugin** guardó al hacer `login` (`servicio-del-paquete.ts`): sin el alias,
     el plugin vería "tu token es de otro servicio".
   - Staging (`sync-production-75a4` u otras) **no** se aliasan: son otro servidor.
5. **Tests**: `base-de-sync` (alias → nueva; staging no; vacío → default nuevo) y
   `servicio-del-paquete` (login guardado contra Railway sigue resolviendo sin aviso).

### 4.2 `api.nestmux.com` (requiere D3)

1. **Supabase**: activar el add-on y registrar `api.nestmux.com` (`supabase domains create
   --custom-hostname api.nestmux.com`). Supabase pide un CNAME y un TXT de verificación.
2. **Vercel DNS**: el CNAME `api → <proyecto>.supabase.co` y el TXT que pida. Después
   `supabase domains reverify` y `supabase domains activate`.
3. **Callbacks de OAuth del login** (GitHub, Google, GitLab y el proveedor «claude» si es OAuth de
   Supabase): en cada app de OAuth, **sumar** `https://api.nestmux.com/auth/v1/callback` sin borrar el
   callback de `supabase.co`. La app vuelve a Nest por `nest://auth/callback` (`AuthScreen.tsx`) y eso
   no cambia.
4. **Supabase Auth**: `Site URL` y `Additional Redirect URLs` siguen permitiendo `nest://auth/callback`;
   revisar que los mails de confirmación y reset salgan con el dominio nuevo.
5. **Build**: el secret de CI `VITE_SUPABASE_URL` (lo usan los jobs de `release.yml`) pasa a
   `https://api.nestmux.com`. La anon key no cambia.
6. **Servicio de sync**: `SUPABASE_URL` de Railway prod pasa a `https://api.nestmux.com`. El servidor
   baja las claves de `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` y **no** chequea el `iss` del
   token (verificado en `server/src/jwks.ts` y `devices.ts`), así que acepta tokens emitidos por
   cualquiera de los dos nombres. Igual hay que probarlo (§5).
7. **Stripe**: el endpoint del webhook (live y sandbox) pasa a
   `https://api.nestmux.com/functions/v1/stripe-webhook`. Se crea el nuevo, se verifica que reciba, y
   recién ahí se desactiva el viejo. El `whsec` del endpoint nuevo reemplaza al viejo en los secrets.
8. **Back-office** (repo aparte) y `PLAN_SYNC_URL` de las functions: apuntar a los nombres nuevos.
9. **Plantillas de mail de Supabase** (confirmación, reset, invitación): revisar que no tengan la URL
   vieja escrita a mano.

### 4.2b Barrido del repo

Además de lo de arriba, la URL vieja aparece en `capture/vite.config.ts`, `scripts/test-signup.mjs`,
`src/lib/terminalJoinService.ts`, `server/README.md` y `docs/RUNBOOK-PAGAR-CLOUD.md`. Todo entra en
este trabajo: código, scripts y docs pasan a los nombres nuevos (o a leerlos de la configuración).
Un `git grep` de `supabase.co` y `railway.app` al final tiene que dar sólo el alias de §4.1 y los
docs históricos.

### 4.3 Qué pasa con cada cliente

| Cliente | Supabase | Sync |
|---|---|---|
| Nest 1.5.x instalado | Sigue en `supabase.co` (sigue vivo) | No tiene memoria |
| Beta y siguientes | `api.nestmux.com` | `sync.nestmux.com` |
| Máquina ya conectada con un build viejo de la rama | La URL del build | Railway; el alias la lleva al nombre nuevo al actualizar |
| Plugin con `login` hecho contra Railway | — | Alias: sigue valiendo sin aviso |

## 5. Verificación

- Antes de tocar código: `curl` a los dos nombres nuevos (sync: `/v1/sync/status` → 401; api:
  `/auth/v1/health` → 200).
- Smoke de login con cada proveedor OAuth y con email en un build que apunte a `api.nestmux.com`.
- Un token emitido por `api.nestmux.com` registra un device en el sync (`POST /v1/devices`) y otro
  emitido por `supabase.co` también.
- El webhook de Stripe sandbox llega al endpoint nuevo (`stripe trigger` sirve acá: sólo se mira que
  llegue y verifique la firma).
- e2e y unit de siempre; los tests nuevos de §4.1.

## 6. Orden de ejecución

Todo lo de §4.1 y §4.2 que no es código es una **acción externa con OK de Gero** (Railway, Vercel,
Supabase, apps OAuth, Stripe). Orden:

1. §4.1 pasos 1–2 (DNS de sync) y verificación.
2. §4.1 pasos 3–5 (código + tests), en la rama.
3. Con D3 aprobado: §4.2 pasos 1–4, verificación, después 5–8.
4. Recién entonces se buildea la beta.

## 7. Riesgos

- **Sesión de Supabase**: cubierto por D6. El smoke de §5 tiene que probarlo pasando de un build con
  `supabase.co` a uno con `api.nestmux.com` sin volver a loguearse.
- **Activación del add-on de dominio**: Supabase no publica cuánto tarda; se hace con días de margen.
- **Propagación de DNS**: horas. Se hace con margen antes de la beta.
- **Costo**: Pro USD 25/mes + add-on de dominio (≈ USD 10/mes) del lado de Supabase; Railway no
  cobra por dominio propio.

## 8. Lo que queda a criterio de quien lo construye

- Dónde vive la tabla de alias (constante en `base-de-sync.ts` está bien).
- Los textos de la UI no cambian: la dirección que muestra Advanced › Sync server va a ser la nueva.
