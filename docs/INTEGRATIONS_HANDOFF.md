# Integrations — Handoff (continuar desde otra PC)

> **Para retomar:** en la otra PC, abrí Claude en el repo y decí **"seguir integrations"**.
> Este doc es la fuente de verdad autocontenida (viaja por git). Última actualización: **2026-08-07**.

---

## 0. TL;DR

El rediseño de **integrations → Hub de orquestación** (estilo Orca) está **implementado y con la
suite verde**, pero era todo local. Ahora está **pusheado** a `origin/feat/integrations`.
Faltan **3 épicas** del backlog, **2 minors de higiene** y **3 release-blockers de seguridad**.

- **Rama:** `feat/integrations`
- **Suite:** 676 tests / 82 files — **verde** (`npx vitest run`)
- **Baseline anterior (marketplace):** `259ed01` · **este rediseño:** +5039 / −530 sobre esa base
- **Backlog completo y canónico:** `docs/INTEGRATIONS_ORCA_BACKLOG.md`
- **Setup de creds en vivo:** `docs/INTEGRATIONS_SETUP.md`

---

## 1. Levantar el entorno en la otra PC

```bash
git fetch origin
git checkout feat/integrations
git pull
npm install
npm run dev        # levanta Nest en dev (integrations anda en dev)
npx vitest run     # confirmar 676/82 verde antes de tocar nada
```

**⚠️ Si es la 2da PC Windows:** `node-pty` no compila sin 3 fixes (VS BuildTools+VCTools,
libs Spectre vía bootstrapper `vs_BuildTools.exe --add`, y quitar `NoDefaultCurrentDirectoryInExePath`).
Reaparece en cada `npm install`. (Está documentado en la memoria `windows-node-pty-build-secondary-pc`.)

**⚠️ Archivos untracked que NO hay que commitear:** `src/lib/demoMode.ts` y `docs/DEMO_MODE.md`
son **blobs git-crypt cifrados sin clave activa** (rompen el typecheck web). Si aparecen tras un
checkout, dejalos untracked o borralos — no son recuperables acá. Los `_render_*.cjs` son scripts
de captura temporales.

---

## 2. Qué está HECHO (commiteado + pusheado)

El rediseño movió integrations de "marketplace en My Repos" a un **Hub de orquestación** propio.
Se sacó la UI de integrations de **My Repos** y de **Teams**; ahora vive dentro del hub.

- **Board de orquestación** — `OrchestrationBoard` + `useBoardRows` + `projectBoard`
  (join de tickets ↔ worktrees ↔ señales) + `deriveStatus` / `deriveScope` (org vs personal por owner).
- **Connections tab** — conectar cada integración dentro del hub; cards por integración con
  logos de marca reales (+ Linear agregado).
- **IntegrationsRail** — bot widget @Nest, lista **"Needs-you"**, **Activity feed**,
  **team presence por worktree** (mostrar al compañero parado en la branch de una task).
- **Épica C — Automations (cron) COMPLETA** — `scheduler` + persistencia + IPC + `AutomationsView`
  (crear/listar agentes programados).
- **@Nest bot** — intents de orquestación desde Slack (grab ticket → worktree, list).
- **Recipes view** (read-only, expone las recipes activas del bus) + **event-bus observer** + **activity log**.
- **Worktree picker** — crear/abrir un worktree desde una task del board.
- **Calendar block→session** recableado en el rail (restore H6).

---

## 3. Qué FALTA (en orden sugerido)

### Épicas del backlog (`docs/INTEGRATIONS_ORCA_BACKLOG.md`)
- [ ] **Épica A — Model Usage / Quota bar (H9, esfuerzo S).** Sin empezar. Reader de state files de
      los CLIs (`~/.claude`, `~/.codex`, gemini/copilot/opencode) → chip de cuota + warning 80% →
      evento `quota.threshold` al bus → notify a Slack. *Es el pick de menor esfuerzo / mayor enganche.*
- [ ] **Épica B — Agent Status "Needs You" (H10, esfuerzo M).** Existe el **widget** en el rail,
      pero falta el motor: `agent-status.ts` (inferir working/needs_input/idle/done por pane),
      la heurística "needs input", el `AgentDashboard` completo y los eventos `agent.needs_input`/`agent.done`.
- [ ] **Épica D — Fan-out + race-and-merge (H12, esfuerzo L).** Sin empezar. Multi-issue → N worktrees,
      race del mismo prompt sobre N agentes, UI de comparación + merge del ganador / discard.

### Higiene (esfuerzo XS)
- [ ] **`recipes.ts` `loadRecipes` — mergear defaults en vez de reemplazar.** Verificar que las recipes
      custom del user no pisen las default; mergear default+custom por `id`.
- [ ] **`checkCi` — `ciNotified.set` antes del `emit`.** Revisar orden de dedup para no perder/duplicar
      una notificación si el emit falla.

### Release-blockers de seguridad (antes de mergear a main / release)
- [ ] **Slack OAuth exchange → Edge Function** (hoy el exchange corre client-side).
- [ ] **Gate Pro server-side** (validación del tier no confiable en cliente).
- [ ] **`github_token` en plano** en la tabla `profiles` de Supabase → confirmar RLS `auth.uid() = id`
      y plan de encriptación (ver CLAUDE.md, sección "Seguridad — pendiente crítico").

---

## 4. Testeo en vivo (lo único que los mocks no cubren)

Todos los motores están **unit-tested con mocks** — ningún engine tocó una API real todavía.
Para el humo real:
- Creds y guía por integración: **`docs/INTEGRATIONS_SETUP.md`** + `.env.local` (untracked, no commitear).
- **Notion/Jira** = token pegado en la UI. **GitHub/Slack** = OAuth deep link `nest://` (necesita build
  empaquetado, no anda en dev puro). **Calendar** = loopback + PKCE (anda en dev).
- Gero está generando las creds y tirando feedback.

---

## 5. Decisiones de diseño (contexto para no re-litigar)

- Integrations **ya no es marketplace**: es LA feature de Nest = **orquestación de agentes**
  (conectás fuentes + bot → agarra tickets → crea terminales → board estilo Orca).
- **My Repos = workspaces**, no se toca. **Sin separación team/personal** (todo junto).
- **Desarrollo custom de integraciones = Enterprise.**
- **Principio del bus:** todo estado nuevo emite un `DomainEvent` al `EventBus` y se resuelve por
  recipe a un `Command` (`notify` Slack, `logOutcome` Calendar). Eso es el diferencial vs Orca:
  ellos lo dejan single-dev, nosotros lo sacamos al equipo. Cada épica agrega su evento a
  `electron/integrations/bus-types.ts` y su recipe default a `electron/integrations/recipes.ts`.
- **Look & feel:** verde medio no-genérico (ver skill `nest-ui` / memoria de rediseño visual).

---

## 6. Próximo paso recomendado

Arrancar por **Épica A (Quota bar)**: menor esfuerzo, alto enganche, y ejercita el patrón
evento→recipe→notify de punta a punta (buen calentamiento antes de B y D). Todo el detalle
(A1–A5) está en `docs/INTEGRATIONS_ORCA_BACKLOG.md`.
