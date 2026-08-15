# Integrations — Plan de ejecución del backlog Orca (run autónomo)

> Fecha: 2026-08-15. Autor: sesión autónoma (Gero se fue "sin freno" tras aprobar alcance).
> Spec de features = `docs/INTEGRATIONS_ORCA_BACKLOG.md` (este doc NO lo duplica: define orden, reglas y estado).

## Objetivo

Ejecutar los pendientes de código de `feat/integrations` uno atrás del otro, con TDD, dejando cada pieza pusheada a `origin/feat/integrations` para que Gero valide en vivo cuando vuelva.

## Reglas del run autónomo (aprobadas por Gero antes de irse)

1. **Orden barato→caro:** Higiene + sync CLAUDE.md → Épica A (quota bar) → terminar Épica C (automations C2+C4) → Épica B (Needs You dashboard) → Épica D (fan-out).
2. **Git:** TDD por épica → commit + push a `origin/feat/integrations`. **NADA a `main`. NADA de releases/tags.**
3. **Seguridad — FUERA de scope:** los 3 release-blockers (Slack OAuth exchange→Edge Function, gate Pro server-side, `github_token` plano/RLS) NO se tocan; requieren Supabase/OAuth/infra + decisiones de Gero. Quedan como TODO.
4. **Ante bloqueo:** marcar la épica `BLOCKED` + motivo, seguir con la siguiente, resumen final.
5. **Disciplina:** cada épica trae sus tests de aceptación del backlog. Correr la suite antes de pushear. No romper los 731 tests existentes.
6. **Working dir:** todo en el worktree `.claude/worktrees/integrations` (`feat/integrations`), nunca en `review/hub-stats`.

## Estado de partida (verificado 2026-08-15)

- `feat/integrations` @ `8cc5575`, limpio, sincronizado con origin, 170 commits adelante de main.
- Cambio suelto: `M CLAUDE.md` en el worktree (versión vieja de "Hacer una release" apuntando a `build.yml`).

## Fases

### Fase 0 — Higiene + CLAUDE.md (XS)
- **H1.** `loadRecipes` (`recipes.ts`): verificado → es **swap-not-merge intencional y documentado** (líneas ~311-316). No es bug. Cerrar el follow-up dejando una nota explícita en el backlog (marcar `[x]` con la conclusión).
- **H2.** Dedup CI (`worktree-signals.ts:166`): `ciNotified.set` va **antes** del emit a propósito (prioriza no-duplicar; persistencia tmp+rename). No es bug. Cerrar follow-up igual que H1.
- **H3.** Sincronizar el `CLAUDE.md` del worktree con el de `main` (que ya tiene la advertencia de NUNCA usar `build.yml`). Resuelve el `M CLAUDE.md` suelto.
- **Salida:** commit "chore(integrations): close hygiene follow-ups + sync CLAUDE.md".

### Fase 1 — Épica A · Quota bar (H9, S) — ⛔ BLOCKED (2026-08-15)
**No se implementa en el run autónomo.** El research en disco confirmó que **ningún CLI persiste localmente cuota/rate-limit con reset** (Claude solo deja tier estático + tokens por-mensaje sin límite; Codex/Gemini/Copilot/OpenCode nada). Sin fuente no hay `pct` ni warning 80% → A1 inviable como está especificado. Requiere decisión de producto de Gero (usage-counter Claude-only vs parsear en vivo vs esperar). Detalle completo en el backlog, sección Épica A. Se saltea y se sigue con Fase 2.

### Fase 2 — Épica C · terminar Automations (H11, M) — ✅ DONE (2026-08-15)
Research reveló que C1/C3/C4 **ya existían** (scheduler + handler `scheduleBlock` + `AutomationsView` con IPC end-to-end). Único gap real = **C2 (ejecución headless)**, implementado:
- Nuevo `electron/integrations/automation-runner.ts` (lógica pura: create→run→summarize→remove, nunca throws, cleanup en finally). 27 tests. Firma: `buildAgentArgv`/`summarize`/`makeRunAutomation(ports)`.
- Puertos reales en `main.ts` (reemplazan `runAutomationStub`): worktree efímero (`nest-auto/<id>-<hex>`, sin persistir meta), `runAgent` (spawn, prompt por **stdin** = no shell injection, shell:true para `.cmd` en Win, timeout 10min), cleanup best-effort (remove --force + borra branch).
- Alcance: solo `claude -p` confirmado; codex/gemini/copilot/opencode degradan a "unsupported" (no adivinar flags).
- Commits: `54baeec`. Typecheck sin errores nuevos (47, baseline 48). 68 tests verdes con scheduler.
- **Fast-follows:** (1) smoke test en vivo del child-process en Windows; (2) render de `lastResult`/`lastSummary` en la UI (+CSS).

### Fase 3 — Épica B · Agent Dashboard "Needs You" (H10, M) — 🟡 PARCIAL (2026-08-15)
**B1+B2 hechos:** `electron/integrations/agent-status.ts` (`deriveAgentState` + `detectNeedsInput` conservador). Lógica pura, 21 tests. Commit `9deb408`. Typecheck sin regresión (47).
**Deferido a fast-follow (requiere validación en vivo de la heurística antes de activar notificaciones — riesgo de spam a Slack):** el tick en main (muestrea panes + emite eventos con dedup por-transición), `lastOutputAt` en pty-manager, los 2 eventos de bus + recipes (B4), la UI `AgentDashboard` (B3) y la acción Slack (B5). Research completo en el backlog.

### Fase 4 — Épica D · Fan-out race-and-merge (H12, L)
Ver backlog D1-D4. Empezar por **D1** (multi-issue → multi-worktree, puro integrations, encaja con ticket-loop). D2 (race same-prompt) y D3 (UI comparación + merge/discard) son lo pesado; si el contexto/tiempo no alcanza, dejar D1 cerrado y D2/D3 planificados. Tests: extender `worktree-integration.test.ts` para D1.

## Criterio de "hecho" por fase
- Tests de la fase en verde + suite completa sin regresiones.
- Commit atómico + push a `origin/feat/integrations`.
- Checkbox del backlog actualizado.
