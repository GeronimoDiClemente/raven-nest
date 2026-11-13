# Conectar las integraciones en el Nest local (feat/integrations)

Guía para probar los 5 motores contra servicios reales. Las claves build-time
van en `.env.local` (ya dejé las líneas listas, sólo faltan los valores).
**Tras editar `.env.local` hay que reiniciar/rebuild** — electron-vite inyecta
`MAIN_VITE_*` en el arranque, no en caliente.

## Estado (2026-08-05) — retomar acá

Andamiaje listo, **nada conectado todavía**. Se validó que el Nest local
levanta en dev (`npx electron-vite dev` desde este worktree: main+preload+renderer
compilan, proceso Electron vivo, sin crash de node-pty). Falta generar las
credenciales (secciones de abajo) y conectar cada panel.

- ✅ `.env.local` con las 4 claves OAuth (vacías, listas para pegar valores)
- ✅ Esta guía
- ⏳ **Notion / Jira** — token pegado en la UI (no necesitan tocar `.env` ni rebuild)
- ⏳ **GitHub / Slack / Calendar** — crear app OAuth + pegar Client ID (Slack: +Secret)
  en `.env.local` + rebuild empaquetado
- ⚠️ **Demo mode NO disponible**: `src/lib/demoMode.ts` y `docs/DEMO_MODE.md`
  quedaron como blobs git-crypt ilegibles en esta PC (y también en el commit de
  backup `55800e5`). El repo ya no usa git-crypt; la versión en texto plano se
  recupera sólo con la clave git-crypt o una copia de otra máquina. Por eso
  `VITE_DEMO_MODE` quedó comentado y probamos por credenciales reales.

## Relanzar el Nest local

```
cd .claude/worktrees/integrations
npx electron-vite dev          # Notion/Jira/Calendar andan así
# npm run package:win          # necesario para OAuth de GitHub/Slack (deep link nest://)
```

Cerrar el Nest instalado antes — comparten `%APPDATA%/nest` y el single-instance
lock cierra la 2da instancia. El marketplace vive dentro de **My Repos**.

## Cómo lanzar

- **GitHub y Slack** hacen el OAuth por deep link `nest://…`. Ese protocolo se
  registra de forma confiable sólo desde un **build empaquetado**
  (`npm run package:win` → `dist/`), no siempre desde `electron-vite dev` en
  Windows. → Para probar OAuth de GitHub/Slack, usar el build.
- **Calendar** usa loopback `127.0.0.1` y **Notion/Jira** token pegado: andan
  igual en `dev` que en build.

Recomendación: **build empaquetado** para probar las 5 sin sorpresas de protocolo.

---

## 1. Notion — fácil, sin rebuild (apiKey)

1. https://www.notion.so/my-integrations → **New integration** (internal).
2. Copiar el **Internal Integration Token** (`secret_…` / `ntn_…`).
3. En la página/DB que quieras usar: **···  → Connections → agregar la integración**
   (si no la conectás, la API no ve la página).
4. En Nest: Integrations → Notion → **Connect** → pegar el token.

## 2. Jira — fácil, sin rebuild (apiKey)

1. https://id.atlassian.com/manage-profile/security/api-tokens → **Create API token**.
2. En Nest: Integrations → Jira → **Connect** → pegar:
   - **Email**: tu cuenta Atlassian
   - **API token**: el del paso 1
   - **Site URL**: `https://TUEMPRESA.atlassian.net`

## 3. GitHub — H4 señales CI/reviews (OAuth, requiere rebuild)

1. https://github.com/settings/developers → **New OAuth App**
   - Homepage URL: cualquiera (`https://nestmux.com`)
   - **Authorization callback URL**: `nest://oauth/github`
2. Copiar el **Client ID** → `MAIN_VITE_GITHUB_CLIENT_ID` en `.env.local`.
3. Rebuild + Connect en la UI. Scopes que pide: `repo read:org read:user`.
   Sirve para los badges de CI y el chip changes-requested por worktree.

## 4. Slack — H5 notify + H7 @Nest (OAuth + Socket Mode, requiere rebuild)

1. https://api.slack.com/apps → **Create New App → From scratch**.
2. **OAuth & Permissions**:
   - Redirect URL: `nest://slack-callback`
   - **Bot Token Scopes**: `chat:write` `channels:read` `channels:history`
     `groups:read` `im:read` `users:read`
3. **Basic Information → App Credentials**: copiar **Client ID** y **Client Secret**
   → `MAIN_VITE_SLACK_CLIENT_ID` / `MAIN_VITE_SLACK_CLIENT_SECRET`.
4. Rebuild → Connect (instala el bot en tu workspace) → en config del panel
   poné el **channel** (ej. `#dev`).
5. **Sólo para H7 (@Nest desde Slack, Socket Mode):**
   - **Socket Mode** → ON
   - **Basic Information → App-Level Tokens** → generar uno con scope
     `connections:write` → copiar el `xapp-…`
   - **Event Subscriptions** → suscribir `app_mentions:read`
   - Ese `xapp-…` se guarda en la app como credencial `slack-app` (te digo dónde
     pegarlo cuando lleguemos; arranca el socket sólo si está presente).

## 5. Google Calendar — H6 (OAuth Desktop, requiere rebuild)

1. https://console.cloud.google.com → proyecto nuevo o existente.
2. **APIs & Services → Library** → habilitar **Google Calendar API**.
3. **OAuth consent screen** → External → agregarte como **test user** (con tu
   gmail) para saltar la verificación del scope sensible.
4. **Credentials → Create credentials → OAuth client ID → Application type: Desktop app**.
5. Copiar el **Client ID** → `MAIN_VITE_GCAL_CLIENT_ID` en `.env.local`.
6. Rebuild → Connect → se abre el browser (loopback + PKCE, sin secret).
   Scope: `calendar.events`.

---

## Qué necesito de vos vs qué hago yo

| Paso | Quién |
|------|-------|
| Generar tokens/apps en cada dashboard (arriba) | **vos** (login propio) |
| Pegar Client IDs/Secrets en `.env.local` | vos o yo (si me los pasás) |
| Rebuild + lanzar el Nest local | **yo** |
| Conectar cada panel + verificar que trae data real | juntos |

Orden sugerido: **Notion + Jira ya** (no necesitan nada de mi lado), y en
paralelo vas creando las 3 apps OAuth (GitHub/Slack/Calendar) para una segunda
tanda con rebuild.
