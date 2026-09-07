# Marketplace de Integraciones — Diseño

**Fecha:** 2026-06-01
**Branch / worktree:** `feat/integrations` (worktree `integrations`)
**Estado:** Diseño aprobado, pendiente de revisión del spec antes del plan de implementación.

## 1. Contexto y objetivo

Raven Nest es un terminal (Electron + Vite + React + TS) para orquestar agentes de IA
en worktrees git aislados. Este feature agrega un **marketplace de integraciones**: el
usuario conecta sus herramientas favoritas (Slack, Notion, Jira…) desde un catálogo, y
esas integraciones exponen acciones en un menú personalizado dentro de la app.

El marketplace tiene **dos caras**:

- **Personal** → self-serve. El usuario instala y configura sus integraciones.
- **Team · Enterprise** → NO self-serve. Vitrina + funnel de venta: el botón dice
  "Contactar Enterprise" y Raven construye integraciones a medida como servicio pago
  (atado al tier Enterprise + custom dev del pricing).

**Posicionamiento competitivo:** el competidor más directo (superset.sh) ya tiene
marketplace + Slack + plugins por manifest, pero es **solo macOS** y su marketplace es
cosmético (themes/configs). Las cuñas de Raven son: (1) multi-OS, (2) funnel Enterprise
de integraciones custom, (3) modelo de plugin "combo" más amplio. No competir por
amplitud el día 1; apoyarse en estas tres cuñas.

## 2. Decisiones de diseño (cerradas)

1. **Qué es un plugin:** combo — cada plugin declara su tipo (`action` / `panel` /
   `integration`). El marketplace soporta los tres.
2. **Origen del catálogo:** curado ahora, abierto después. MVP = catálogo curado por
   Raven; el modelo de datos (manifest) ya contempla terceros para abrir más adelante
   sin reescribir.
3. **Alcance:** personal self-serve + team como funnel Enterprise.
4. **Sección Team:** teaser visible para todos + CTA "Contactar Enterprise"; evolucionable
   a gestión-admin de integraciones activas cuando haya clientes Enterprise.
5. **Mensaje "miles de plugins":** el catálogo es **data servida remotamente**, no código.
   Se suman plugins insertando filas, sin release. Sección "Próximamente" como teaser.

**Enfoque arquitectónico elegido: C (híbrido).** Se adopta la *forma* del manifest desde
el día 1, pero el runtime solo carga handlers built-in y de confianza. Abrir a terceros
después = sumar un loader + sandbox, no reescribir.

## 3. Modelo de datos

### 3.1 Manifest (declarativo, no código)

```ts
type PluginType = 'action' | 'panel' | 'integration'

interface PluginManifest {
  id: string                 // 'slack', 'notion', 'jira'
  name: string
  description: string
  category: PluginCategory   // 'comms' | 'docs' | 'pm' | 'ci' | ...
  icon: string
  color: string
  type: PluginType
  publisher: 'raven' | string          // 'raven' = curado; el campo ya contempla terceros
  tier: 'free' | 'pro' | 'team-enterprise'
  auth?: AuthSpec                       // { kind: 'oauth' | 'apiKey' | 'none', ... }
  configSchema?: ConfigField[]          // qué pide para configurarse
  contributes?: {
    menuItems?: MenuContribution[]      // reusa el patrón RepoActionsMenu
    paneType?: PaneTypeContribution     // reusa el patrón BrowserCell / TerminalPane
    events?: EventHook[]                // ej: onAgentDone -> slack.notify
  }
}
```

### 3.2 Estado instalado (separado del manifest, SIN secrets)

```ts
interface InstalledPlugin {
  pluginId: string
  scope: 'personal' | 'team'
  enabled: boolean
  config: Record<string, unknown>       // valores del configSchema, sin credenciales
}
```

### 3.3 Catálogo (cómo escala a miles)

- **Fuente: tabla Supabase `plugin_catalog`** — cada fila es un `PluginManifest`. Sumar un
  plugin = insertar una fila, sin release de la app.
- **Runtime de handlers curado/built-in:** solo corre lo que la app conoce
  (Slack/Notion/Jira). Un manifest sin handler se lista como "Próximamente" (teaser).
- **Fallback:** si Supabase no responde, se usa el catálogo built-in bundleado (las 3
  conocidas) para que el marketplace funcione offline.

### 3.4 Persistencia

| Dato | Dónde | Patrón existente que reusa |
|---|---|---|
| Plugins personales instalados + config | `~/.raven-nest/plugins.json` (local, per-device) | `custom-clis.json` / filosofía v1.2 local-paths |
| Credenciales / tokens | OS keychain vía Electron `safeStorage` (NO Supabase, NO plugins.json) | — (nuevo, ver §6) |
| Team plugins | Supabase `shared_plugin_configs` | `shared_mcp_configs` |
| Catálogo | Supabase `plugin_catalog` (remoto) | — (nuevo) |

> El storage real de team queda **diferido**: en el MVP la sección Team es solo teaser, así
> que no hay configuración de team que persistir todavía.

## 4. UI

### 4.1 Acceso

Botón nuevo en el `Sidebar`, al lado de Teams / My Repos. Abre un modal (mismo patrón que
`TeamsWorkspace` / `MyReposPanel`) con dos tabs: **`Personal`** | **`Team · Enterprise`**.

Label de cara al usuario: **"Integraciones"** ("marketplace" = nombre interno/worktree).

### 4.2 Tab Personal

```
┌─ Integraciones ─────────────────────────────────[x]┐
│ [ Personal ]  [ Team · Enterprise ]                 │
│ 🔍 Buscar...                        [ Categorías ▾ ]│  ← search + filtro = clave para miles
│─────────────────────────────────────────────────────│
│ INSTALADAS    [ Slack ● ⚙ ]   [ GitHub ● ⚙ ]        │
│ DISPONIBLES   [ Notion + ]  [ Jira + ]  [ Linear + ]│
│ PRÓXIMAMENTE · sumamos integraciones cada semana    │  ← mensaje "miles de plugins"
│   [ Figma ]  [ Sentry ]  … +cientos  [ Pedir una → ]│  ← guarda en plugin_requests
└─────────────────────────────────────────────────────┘
```

- Cada card → **drawer de detalle/config**: descripción, permisos que pide, y el form
  generado desde `configSchema` (botón "Conectar" OAuth o campos de API key).
- "Instalar" = crea el `InstalledPlugin` + dispara el auth flow.
- "Pedir integración" → guarda la demanda en Supabase `plugin_requests` (prioriza qué
  construir y alimenta el funnel Enterprise).

### 4.3 Menú personalizado

Las integraciones instaladas exponen su `contributes.menuItems` en:

- Una sección **"Integraciones"** en el Sidebar (acciones rápidas).
- El menú contextual `RepoActionsMenu` por repo/worktree.
- Plugins `type: 'panel'` aparecen como tipo de pane en `NewPaneDialog`.

Reordenar / togglear qué acciones se muestran = **diferido** (post-MVP).

### 4.4 Tab Team · Enterprise (funnel)

```
┌─ Integraciones › Team · Enterprise ─────────────────┐
│  Integraciones a medida para tu equipo               │
│   🔗 Alerts de Slack centralizados para el team      │
│   🔗 Sync bidireccional Jira ↔ worktrees             │
│   🔗 Tu herramienta interna (lo que necesiten)        │
│  Las construimos a medida.   [ Contactar Enterprise →]│ → Calendly / mailto
└───────────────────────────────────────────────────────┘
```

- Visible **para todos** (máximo funnel). CTA → Calendly/mailto + registro opcional en
  Supabase `enterprise_leads`.
- **Evolución post-MVP:** si el team ya es Enterprise, el admin ve acá sus integraciones
  custom activas (la parte de gestión de la opción 4).

## 5. Las 3 integraciones del MVP (todas `type: 'integration'`, OAuth)

### Slack — awareness ambiente del multi-agente
- `contributes.events`: `onAgentDone`, `onWorktreeReady`, `onPrPushed` → postea a un
  canal/DM elegido.
- `contributes.menuItems`: "Notificar a Slack" manual desde un worktree.
- MVP: conectar OAuth → elegir canal → notificación al terminar un run.

### Notion — docs del trabajo del agente
- MVP (push): "Enviar a Notion" → crea página con el resumen del worktree/PR.
- Fast-follow (pull): traer una spec/page como contexto del agente. **Fuera del MVP.**

### Jira — issue → worktree (el mejor fit con el producto)
- MVP: elegir un issue Jira → crear worktree + branch `JIRA-123-slug`; el agente arranca
  con la descripción del issue como contexto.
- Acción extra: "Mover issue a In Progress / Done".

> Las 3 ejercitan el camino `integration`. Los tipos `panel` y `action` viven en el modelo
> pero no los necesita el MVP; quedan validados para el catálogo futuro.

## 6. Auth y seguridad

**No repetir el patrón `github_token` en texto plano de Supabase** (pendiente crítico en
CLAUDE.md). Para las nuevas integraciones:

- **Tokens en el keychain del SO vía Electron `safeStorage`** (Keychain / Windows
  Credential Manager / libsecret). Encriptados en reposo, **nunca en Supabase, nunca en
  `plugins.json`**, per-device.
- **Los tokens viven solo en el main process.** El renderer pide acciones por IPC
  (`window.pluginActions.run('slack.notify', …)`) y nunca ve el token crudo. El main hace
  las llamadas a las APIs externas → centraliza rate-limit y errores.
- **OAuth reusa el deep-link `nest://`** ya existente para GitHub/GitLab (`electron/main.ts`).
  Callback → intercambio code→token → `safeStorage`.
- **Caveat Linux (regla multi-SO):** si no hay keyring disponible, **no degradar a texto
  plano** — comunicar "conectar integraciones requiere un keyring del sistema" y
  deshabilitar la conexión. Documentar comportamiento en los tres SO.

## 7. Manejo de errores (sin silent failures)

- **Token vencido/revocado** → badge "Reconectar" en la card + CTA claro. No falla en silencio.
- **Falla de acción** (ej. Slack notify) → no rompe el flujo del agente, pero loguea
  visible + warning no-bloqueante. Nunca swallow.
- **Catálogo Supabase caído** → fallback al catálogo built-in (§3.3); aviso "no se pudo
  cargar el catálogo completo".
- **Rate-limit / red** → retry con backoff en eventos; error explícito en acciones manuales.

## 8. Testing (matchear la cultura actual: ~155 tests verde)

- **Unit:** validación del manifest (schema), merge catálogo remoto+built-in, render del
  form desde `configSchema`, wrapper del credential store (mock de `safeStorage`).
- **Integration:** flujo OAuth con deep-link mockeado; cada integración con su API externa
  mockeada (sin red real) — happy path + auth-failure + el event hook
  `onAgentDone → slack.notify`.
- **Smoke/E2E:** abrir Integraciones, flujo de instalar, render del teaser "Próximamente",
  CTA de Team.

## 9. Archivos (a crear / modificar)

**A crear:**
- `src/types.ts` (extender) → `PluginManifest`, `InstalledPlugin`, `PluginType`, etc.
- `src/components/IntegrationsMarketplace.tsx` — modal con tabs Personal / Team.
- `src/components/IntegrationCard.tsx` + `IntegrationConfigDrawer.tsx`.
- `src/hooks/usePluginCatalog.ts` — fetch `plugin_catalog` + fallback built-in.
- `src/hooks/useInstalledPlugins.ts` — CRUD local (IPC) de `plugins.json`.
- `src/lib/pluginRuntime.ts` — registro de handlers built-in + dispatch de acciones/eventos.
- `src/lib/integrations/{slack,notion,jira}.ts` — handlers built-in.
- `electron/plugins-store.ts` — persistencia local de `plugins.json`.
- `electron/plugin-credentials.ts` — wrapper `safeStorage` + IPC.
- `electron/plugin-actions.ts` — ejecuta llamadas a APIs externas en el main process.
- Catálogo built-in bundleado (las 3 + entradas "Próximamente").
- Tablas Supabase: `plugin_catalog`, `plugin_requests`, `enterprise_leads`
  (+ `shared_plugin_configs` diferida).

**A modificar:**
- `src/components/Sidebar.tsx` — botón "Integraciones" + sección de acciones instaladas.
- `src/App.tsx` — montar el modal (patrón Teams/MyRepos) + render de paneType plugins.
- `src/components/NewPaneDialog.tsx` — exponer plugins `type: 'panel'`.
- `src/components/RepoActionsMenu.tsx` — inyectar `menuItems` de plugins instalados.
- `electron/preload.ts` — exponer `window.pluginActions` / `window.pluginCreds` / store.
- `electron/main.ts` — extender el handler `nest://` para callbacks de OAuth nuevos.

## 10. Alcance MVP vs diferido

**En el MVP:**
- Modelo manifest + catálogo remoto con fallback.
- Tab Personal con instalar/configurar; las 3 integraciones (Slack/Notion/Jira).
- Credenciales en `safeStorage`, llamadas en main process.
- Tab Team = teaser + CTA Enterprise + `plugin_requests` / `enterprise_leads`.
- Mensaje "Próximamente".

**Diferido (YAGNI por ahora):**
- Migración de GitHub/GitLab al modelo de plugin. Siguen con su OAuth/storage actual; en
  el catálogo se muestran como "ya conectado" (read-only), sin tocar su persistencia.
- Loader + sandbox de plugins de terceros (la apertura real).
- Storage/gestión real de plugins de team (admin gestiona activas).
- Notion pull (spec → contexto del agente).
- Reordenar/personalizar el menú de acciones.

## 11. Riesgos

- **Seguridad de tokens:** `safeStorage` en Linux depende de keyring; manejar el caso sin
  keyring sin degradar a plano (§6).
- **Competitivo:** superset tiene momentum en esta idea exacta; el MVP debe diferenciarse
  por multi-OS + funnel Enterprise, no por amplitud de catálogo.
- **Scope creep:** el modelo combo + "miles de plugins" tienta a construir el runtime
  abierto antes de tiempo. Mantener handlers curados en el MVP.
