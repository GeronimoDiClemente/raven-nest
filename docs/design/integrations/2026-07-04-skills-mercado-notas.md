# Notas: las mejores skills del mercado y cómo Nest destaca con ellas

**Fecha:** 2026-07-04 · **Fuente:** conocimiento del modelo (cutoff ene-2026), NO research web verificado — validar con research fresco antes de decidir el catálogo. Complementa el spec V2 y las ideas previas: skill-generator ([memoria] natural-language → skill) y librería de presets de IA con harness SDD como 1er ítem.

## El ecosistema de skills hoy (lo que más tracción tiene)

**Frameworks de disciplina de workflow** — los más valorados porque cambian la calidad del output:
- **superpowers** (Jesse Vincent/obra): brainstorming → spec → plan → subagentes, TDD forzado, debugging sistemático. El estándar de facto de "proceso serio" con Claude Code.
- **cc-sdd / spec-driven development**: spec y plan como artefactos commiteados antes de codear (ya elegido como 1er preset de la librería de Nest).
- **compounding-engineering** (Every): cada tarea deja aprendizajes persistentes (CLAUDE.md/memoria).

**Skills oficiales de Anthropic** (repo `anthropics/skills` + plugins oficiales): creación de documentos (docx/xlsx/pptx/pdf), frontend-design, artifacts, code-review/security-review, claude-md management. Son la barra de calidad y vienen curadas.

**Categorías comunitarias con más adopción:**
1. **Review/PR toolkits** — code-reviewer, silent-failure-hunter, test-analyzer (multi-agente).
2. **Específicas de framework/stack** — Next.js, Supabase (con best practices de Postgres/RLS), Playwright E2E, n8n. Las skills de stack concreto retienen más que las genéricas.
3. **Generadores de documentación** — README, changelogs, ADRs.
4. **Commit/Git hygiene** — conventional commits, PR descriptions.
5. **Design systems** — frontend-design, dataviz.

**Dónde se descubren hoy (el punto débil del mercado):** GitHub repos dispersos (`awesome-claude-code`, `claude-code-templates`), marketplaces de plugins incipientes, agentskills.io. **No existe un lugar con discovery + install + update de calidad con UI.** La instalación es copiar archivos a `~/.claude/skills/` o agregar un plugin marketplace por CLI.

## Cómo destaca Nest (combinando con el marketplace de integraciones)

1. **Discovery con UI donde no la hay.** El mismo patrón del marketplace de integraciones (grid curado, detail-page "qué te da", un click) aplicado a skills/presets. Hoy instalar una skill es leer un README; en Nest sería visual, por repo y por agente. Es el mismo shell mental que ya diseñamos — costo incremental bajo.
2. **Distribución por equipo (nadie lo tiene).** Las skills son archivos por usuario; ningún CLI resuelve "todo mi equipo usa el mismo preset de review". Nest con Teams puede sincronizar presets a nivel team — y es coherente con el hallazgo del research (colaboración = el gap del 17%).
3. **Per-repo y per-agente.** Nest sabe qué agente corre en cada pane y en qué repo (la idea del skill-generator ya contempla detección de path por agente activo). Instalar "preset Supabase" solo en los repos que lo usan es algo que un CLI no ve.
4. **Skills que usan las integraciones conectadas** — el combo único: una skill "avisá al canal del worktree cuando termine el agente" que usa la integración Slack conectada del marketplace. Skills (comportamiento) × integraciones (superficies) es un cruce que ni los CLIs ni superset tienen.
5. **Curación como valor Pro.** Igual que integraciones: catálogo visible gratis, presets premium/curados (SDD harness, review multi-agente calibrado) como parte de Pro. Mismo patrón Raycast del research.

## Primer catálogo sugerido (curado, chico)

| Preset | Base | Por qué |
|---|---|---|
| SDD harness | cc-sdd (wrapper per-repo, diseño v1 ya presentado) | Ya decidido como 1er ítem |
| Review de PRs | pr-review multi-agente | Categoría #1 en adopción; ataca "casi correcto" (66%) |
| TDD + debugging | superpowers (subset) | Disciplina con mayor evidencia de valor |
| Stack: Supabase | skills oficiales Supabase | Nest ya es app Supabase; dogfooding |
| Conventional commits | comunitaria | Bajo costo, alto uso diario |

## Pendientes antes de decidir

- Research web fresco del estado de marketplaces de skills (esto es conocimiento a ene-2026; el espacio se mueve rápido).
- Licencias: qué se puede redistribuir (superpowers es open-source; verificar cada una).
- Decidir si "presets de IA" vive dentro del mismo marketplace (otra categoría junto a integraciones) o como sección propia — el shell de UI es reutilizable en ambos casos.
