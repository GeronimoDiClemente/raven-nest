# Integrations v3 — Task Loop, motores y bus de eventos

**Fecha**: 2026-07-11
**Estado**: aprobado en conversación (Gero + Claude), pendiente de plan de implementación
**Base**: hito 1 (shell + mock) y hito 2 (adapters reales Slack/GitHub/Jira/Notion) ya mergeados en `feat/integrations`.
**Research**: 5 informes (task→branch→PR, Slack, GitHub, Notion, Calendar) — conclusiones incorporadas acá.

## 1. Principio rector

**El worktree es la primitiva. Toda integración es una entrada o una salida del worktree.**

- *Entrada*: algo externo se convierte en una sesión de trabajo con contexto (un ticket,
  un thread de Slack, una spec de Notion, un error de Sentry, un bloque de calendario).
- *Salida*: lo que pasó en la sesión se refleja afuera (estado del ticket, draft PR,
  resumen al calendario, notificación accionable).
- Una integración que solo muestra datos y no crea ni refleja sesiones **no entra al
  marketplace**, por más vistosa que sea.

Patrón validado por la industria (Linear es la referencia): el ID de la tarea viaja
embebido en el artefacto git (branch/PR) y **el estado se infiere de eventos git — el
humano nunca actualiza el tablero a mano**.

## 2. Arquitectura: 4 motores + bus

Casi todas las integraciones son variaciones de 4 motores. Cada motor se construye una
vez; cada integración nueva es un mapper (auth + mapeo de campos) encima.

### Motor 1 — Ticket loop (entrada + salida)
`ticket → worktree → estado inferido`. Componentes:
- **Panel "My tickets"**: los tickets asignados al usuario conectado. Lista simple +
  acciones rápidas (patrón jira-cli, 10k stars). NUNCA replicar el tablero (la extensión
  de Atlassian para VS Code, 3★, es la prueba del fracaso de ese camino).
- **Acción "Work on this"**: crea worktree con branch `<user>/<TICKET-ID>-<slug>`,
  abre pane con el agente y le inyecta título/descripción/comentarios del ticket como
  contexto inicial.
- **Estado inferido**: branch creado → *In Progress*; PR abierto → *In Review*; merge →
  *Done*. Transiciones vía el adapter (API del tracker). "Fixes <ID>" automático en la
  descripción del PR.
- Consumidores: Jira, Linear, GitHub Issues, Asana, ClickUp, Trello, Monday, Shortcut,
  Azure DevOps Boards.

### Motor 2 — Spec-to-worktree (entrada)
`doc → contexto del agente`. Al crear tarea/worktree se adjunta la URL de un doc; el
adapter lo baja como markdown y lo escribe en el worktree (`.nest/spec.md`) y/o lo
inyecta al prompt inicial. Es el flujo interno de Notion con Codex ("Boxy"), con el
worktree de Nest como el entorno.
- Consumidores: Notion, Confluence, Google Docs, Obsidian (local), Figma (variante
  visual: export del frame + specs de diseño para tareas de UI).
- Nota técnica: adapter con apiKey directo, NO el MCP genérico de Notion (~26k tokens de
  overhead por 21 tools).

### Motor 3 — Señal → fix (entrada, la de mayor diferencial)
`algo se rompió → worktree con el contexto del error`. La entrada más rica para un
agente (stack trace, log del build, CVE) y la que habilita **lotes paralelos**: N
issues seleccionados → N worktrees con N agentes visibles en la grilla. Cursor/Copilot
procesan de a uno en cloud; la flota visible es exclusiva del multiplexor.
- Consumidores: Sentry (error de prod → PR que lo resuelve), Dependabot/Snyk (vulns en
  lote), CI providers (build rojo → "arreglalo" con el log inyectado), Datadog/Grafana
  (alerta → sesión de investigación), PostHog (session replay como contexto de bug).

### Motor 4 — Notificar/reflejar (salida)
Eventos del ciclo propio hacia afuera, **dirigidos y accionables**:
- Solo eventos del worktree propio ("tu agente terminó X, PR listo", "CI rojo en tu
  branch") como DM/thread por tarea con botones (Ver diff / Abrir en Nest / Relanzar).
  NUNCA un canal global de actividad (espejo de commits = queja #1 universal, se mutea).
- Status/DND automático con la señal que solo Nest tiene: actividad real del terminal
  ("🔨 focus: PROJ-142"), auto-clear confiable, override manual siempre.
- Consumidores: Slack, Discord, MS Teams, Google/Outlook Calendar (registro de
  outcomes), Vercel/Netlify (deploy preview + estado por worktree).

### Bus de eventos (la capa enterprise)
Las integraciones se comunican entre sí y se mandan tareas. Diseño:
- **Eventos estándar** que emiten los adapters y el core:
  `task.created`, `session.opened`, `session.closed`, `pr.opened`, `pr.merged`,
  `ci.failed`, `error.detected`, `block.started`, `meeting.transcribed`.
- **Comandos estándar** que aceptan los adapters:
  `createTask`, `openSession`, `notify`, `updateStatus`, `logOutcome`, `scheduleBlock`.
- **Recetas** (reglas configurables, por usuario o por team vía Supabase): pares
  evento→comandos. Ejemplos:
  - `error.detected` (Sentry, sev alta) → `createTask` (Jira) + `openSession` (worktree
    con stack trace) + `notify` (Slack DM al on-call).
  - `pr.merged` → `updateStatus` (ticket → Done) + `notify` (thread de Slack) +
    `logOutcome` (Calendar).
  - `meeting.transcribed` (Zoom/Meet) → `createTask` × N (action items) → cada una
    lista para "Work on this".
- Los teams enterprise comparten recetas (tabla en Supabase, RLS por team). El shell de
  integraciones del hito 1-2 ya centraliza los adapters vía `plugins:panel:call`; el bus
  es una capa de routing sobre eso, en el main process (tokens nunca salen de main).
- v1 del bus: routing local en main + recetas por usuario. v2: recetas compartidas por
  team. La UI de recetas puede ser un JSON editable antes que un builder visual.

## 3. Hitos

- **H3 — Ticket loop** (Motor 1 con Jira + Linear + GitHub Issues): panel My tickets,
  Work on this, branch naming con ID, estado inferido, Fixes automático.
  *Linear entra en tanda 1: mismo motor que Jira, duplica el mercado early-adopter, y su
  API de Agents permite registrar a Nest en su ecosistema (distribución).*
- **H4 — GitHub señales**: badge de CI por worktree (cada worktree = un branch = un
  estado de checks), interrupciones solo por CI rojo propio / review request / changes
  requested, botón "que el agente arregle el rojo" con el log del run inyectado, ciclo
  draft-PR-con-plan (el agente pushea temprano y publica su plan como checklist).
- **H5 — Slack accionable + Notion spec-to-worktree** (Motor 4 v1 + Motor 2 v1).
- **H6 — Calendar** (adapter nuevo): empezar por la INVERSA — registro de outcomes
  ("45 min en RAV-123, 3 commits, PR #456, tests verdes" en la description del evento) —
  porque la agenda miente pero el registro real no. "Block → Session" como prompt de un
  click, JAMÁS automático (Serene y Centered murieron por abrir el workspace solos).
  OAuth desktop loopback+PKCE; scopes sensitive (verificación Google en semanas, no
  CASA); extended properties privadas para `{taskId, repo, branch}` sin DB extra;
  arrancar readonly para reducir fricción de verificación.
- **H7 — `@Nest` desde Slack + agente asignable**: mención en thread → worktree + agente
  local, updates al thread, link "Abrir en Nest". Diferencial vs Cursor/Devin (VMs
  remotas): el dev puede tomar el control del terminal cuando el agente se traba.
  Modelo de responsabilidad Linear: humano assignee, agente contributor.
- **H8 — Bus de eventos v1** (recetas locales) y **v2** (recetas por team).

## 4. Catálogo (~35, por tiers)

- **Tier A** (mecánica fuerte, se anuncian con ella): GitHub, GitLab, Jira, Linear,
  Slack, Notion, Sentry, Dependabot/Snyk, Vercel, Google Calendar, Figma, Confluence,
  Azure DevOps, Supabase, PostHog, Obsidian, Zoom/Meet (transcript→tareas), Discord.
- **Tier B** (mecánica mínima honesta de su motor, suman catálogo casi gratis): Asana,
  ClickUp, Trello, Monday, Shortcut, Bitbucket, Google Docs, MS Teams, Outlook Calendar,
  Netlify, Railway, CircleCI, Jenkins, SonarQube, Datadog, Grafana, Firebase, MongoDB
  Atlas, Stripe, Toggl/Harvest, PagerDuty, Opsgenie.
- **Tandas de release**: T1 = GitHub, Jira, Linear, Slack, Notion (H3-H5). T2 = Sentry,
  Dependabot, Vercel, Calendar (H6). T3 = Confluence, GDocs, Figma, Discord, ClickUp,
  Asana. T4 (enterprise) = Azure DevOps, MS Teams, Monday, Datadog, Outlook, PagerDuty.
- Regla: antes de implementar cada tanda, research de validación por integración (mismo
  formato que los 5 de hoy) — si no tiene mecánica de worktree, no entra.

## 5. Seguridad y restricciones

- Tokens y secretos SOLO en main process (patrón hito 2, `pluginCreds`); el bus vive en
  main por la misma razón.
- El exchange de Slack migra a Edge Function antes de release pública (pendiente
  conocido; el client secret no puede vivir en el binario).
- Recetas por team en Supabase con RLS por team.
- El repo es público: nada de detalles de infraestructura en issues/PRs de este feature.

## 6. Fuera de alcance (explícito)

- Replicar tableros/inboxes/chats de las plataformas dentro de Nest.
- Espejos de actividad a canales (commit-by-commit).
- Sync bidireccional de docs (editar Notion/Confluence desde Nest).
- Sistema de billing propio (solo export con evidencia).
- Builder visual de recetas en v1 (JSON editable primero).
