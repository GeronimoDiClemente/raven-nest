# Continuación — sesión del 2026-07-11/12

Resumen de todo lo que se hizo hoy y qué falta, para retomar desde otra máquina.
Todo está pusheado a `origin`. Este doc vive en `main`.

## Cómo retomar en la otra PC

```bash
git clone https://github.com/GeronimoDiClemente/raven-nest.git   # o git pull si ya está
cd raven-nest
git fetch origin
npm install
# Config: NO hay .env — se usa Doppler (ver sección Doppler abajo)
```

Ramas que importan en `origin`:
- `main` — releases, CI, guías, docs.
- `feat/integrations` — **el trabajo grande de integraciones (H3 hecho)**. Es la rama de Gero.
- `fix/*` — 3 PRs de fixes abiertos (#16, #17, #18).

---

## 1. Ecosistema de equipo (HECHO)

Se armó todo el flujo de trabajo para los 2 devs nuevos (Matías = analytics/Teams,
Bautista = memoria de contextos + editor embebido).

- **`main` protegida**: PR obligatorio + 1 review, 3 checks required (typecheck/test/build
  vía `.github/workflows/ci.yml`), squash-only, CODEOWNERS (rutas críticas → Gero),
  secret scanning + push protection activos.
- **Guías en el repo** (leer en este orden):
  - `docs/GUIA-EQUIPO.md` — arquitectura, convenciones, flujo de PRs.
  - `docs/GUIA-TESTEO-MATIAS.md` / `docs/GUIA-TESTEO-BAUTISTA.md` — setup + testeo por dev.
- **Comando de review**: `/revisar-pr <n>` (`.claude/commands/revisar-pr.md`) — trae el PR,
  corre typecheck+tests, guía el smoke, lanza code-review + security-review.

## 2. Doppler (config de entornos)

- Workplace `Nestmux`, proyecto `nest`, configs `dev` (localhost, para los devs) y `prd`
  (Supabase real, solo Gero). No existe `.env`: se corre `doppler run -- npm run dev`.
- Verificado seguro: no hay `service_role` en ningún config; `dev` usa la anon key demo local.
- **PENDIENTE (Gero)**: invitar a Matías y Bautista desde el dashboard
  (Team → Invite, rol Collaborator). Faltan sus emails. También faltan cargar en `prd`:
  `MAIN_VITE_SLACK_CLIENT_SECRET` y `MAIN_VITE_GITLAB_CLIENT_ID` (están en la otra PC).

## 3. Fixes abiertos (PRs, CI verde, esperando merge)

- **#18 `fix/supabase-local-grants`** — migración `025` que repone los grants default +
  `supabase/config.toml` versionado. **Prod NO está afectada** (los grants ya estaban a
  mano); esto es para que los entornos nuevos nazcan bien. **Matías tiene que validarlo**
  en su local (`supabase db reset` + ver que la app lee `profiles`) → después Gero mergea.
- **#17 `fix/rls-leader-recursion`** — migración `024`, arregla recursión en políticas
  UPDATE/DELETE de líder sobre `team_members`. Validar en Supabase local antes de mergear.
- **#16 `fix/pty-account-local-bin`** — fix chico: `accountDir/.local/bin` al PATH de
  panes AI en Mac (mata el warning de /doctor). Listo para mergear.
- Ya mergeados hoy: **#14** (guard de account-store) y **#15** (sesión atómica) →
  **release v1.3.2** (ver sección 5).
- **#12** (externo, dmitrymaranik, RLS perf) — tratar con cuidado, revisar política por
  política antes de aceptar. **#13** (Matías, Team Stats) — rebaseado, CI verde, espera
  review de Gero + smoke Mac/Linux.
- **#10** (restyle masivo de Matías) — cerrado; se retoma en PRs chicos apilados. Matías
  va a mandar: (a) fix de `.rb-bullet-logo` sin cerrar en global.css, (b) tokenización de
  azules a `--raven-blue`, (c) sidebar rehecho sobre main, (d) harness de preview de Teams.

## 4. Integraciones — el trabajo grande (rama `feat/integrations`)

### Visión (documentada en `docs/superpowers/specs/2026-07-11-integrations-task-loop-design.md`)
- **Principio**: el worktree es la primitiva; cada integración es entrada o salida del
  worktree. Nada solo-visual entra al marketplace.
- **4 motores** (se construyen 1 vez, cada integración nueva es un mapper):
  1. Ticket loop (ticket→worktree→estado inferido) — **HECHO (H3)**.
  2. Spec-to-worktree (doc→contexto del agente).
  3. Señal→fix (error/CI/vuln→worktree, con lotes paralelos — el mayor diferencial).
  4. Notificar/reflejar (Slack/Calendar/etc. como salida).
- **Bus de eventos** (capa enterprise): las integraciones se comunican y se mandan tareas
  vía eventos+comandos+recetas por team.
- **Catálogo ~35 integraciones** por tiers y tandas (ver la spec).

### H3 — Ticket Loop (IMPLEMENTADO, en `feat/integrations`)
Plan: `docs/superpowers/plans/2026-07-12-h3-ticket-loop.md` (Tasks A-K, TDD completo).
Construido: providers Jira/Linear/GitHub Issues, `ticketBranchName`, `TicketLoop` registry,
IPC `tickets:*`, hook `useMyTickets`, vista `MyTicketsView` con "Work on this" →
worktree + `.nest/TASK.md` con contexto, polling de PRs → In Review/Done.
Un review adversarial encontró y arregló 8 problemas (2 graves: polling cruzaba repos,
transición re-disparada cada 90s). 358 tests verdes, tsc limpio.

### PRÓXIMO PASO de H3 (lo que quedó pendiente): SMOKE en la app real
No se hizo porque necesita credenciales reales + la ventana en la pantalla de Gero
(no se puede lanzar la GUI desde el entorno de Claude). Pasos:
1. En `feat/integrations`: `npm run dev` (en terminal propia, la GUI necesita tu sesión).
2. Conectar GitHub o Jira en integraciones.
3. Abrir "My tickets" → ver los asignados.
4. "Work on this" en uno → verificar: crea worktree `user/KEY-slug`, abre pane, y existe
   `.nest/TASK.md` con el contexto + línea "Fixes KEY".
5. (Opcional) abrir PR de esa rama → el ticket pasa a In Review en ~2 min.
Si da verde → PR de `feat/integrations` a `main` + `/revisar-pr`.

### Después de H3
H4 (badge CI por worktree + "arreglá el rojo"), H5 (Slack + Notion spec-to-worktree),
H6 (Calendar — empezar por registro de outcomes), H7 (@Nest desde Slack), H8 (bus).
Cada uno con su plan, como H3. **No arrancar H4 hasta que el smoke de H3 pase y se mergee.**

## 5. Release v1.3.2 (Mac sin notarizar)

- v1.3.2 publicada (fixes #14/#15). Build de las 3 plataformas OK, 11 artifacts arriba.
- **PROBLEMA**: la notarización de Mac falló — `403: agreement missing/expired` de Apple.
  NO es un bug del build: hay un **acuerdo legal pendiente de firmar** en la cuenta de
  Apple Developer. El DMG de Mac quedó sin notarizar (Gatekeeper lo bloquea).
- **PENDIENTE (Gero)**: entrar a developer.apple.com/account, aceptar el agreement, y
  correr el workflow `renotarize-mac` (no recompila, solo re-notariza el DMG existente).

## 6. Investigaciones hechas (por si sirven)

- Plugins/skills útiles: MCP oficiales de GitHub/Slack/Jira/Notion (doble uso: referencia
  de contrato + oráculo en tests), `supabase`, `typescript-lsp`, Playwright-Electron.
  Instalar con `--scope project` en `.mcp.json`.
- 5 researches de integraciones (Jira, Slack, GitHub, Notion, Calendar) — conclusiones
  ya volcadas en la spec de integraciones.

## Checklist de pendientes de Gero

- [ ] Pasar emails de Matías y Bautista → invitar a Doppler.
- [ ] Cargar Slack secret + GitLab client ID en Doppler `prd` (desde la otra PC).
- [ ] Revocar el token de Supabase que se usó hoy (se pegó en el chat).
- [ ] Aceptar el agreement de Apple → re-notarizar Mac v1.3.2.
- [ ] Esperar validación de Matías en #18 → mergear #18 (y #16, #17).
- [ ] Hacer el smoke de H3 → PR de feat/integrations a main.
- [ ] Mandar los mensajes a Matías/Bautista (armados en la sesión).
