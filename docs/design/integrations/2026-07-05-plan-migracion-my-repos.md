# Migración: integraciones dentro de My Repos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkboxes por task.

**Goal:** Las integraciones dejan de vivir en el menú general y pasan a vivir dentro de My Repos (spec §2: "ítem propio del menú en la sidebar de My Repos", "vista en el área de contenido con la sidebar siempre visible"). El ítem global "Integrations", `SidebarIntegrationItems` y los overlays `IntegrationsMarketplace`/`IntegrationPanelHost` a nivel App desaparecen.

**Decisiones:**
- El marketplace se embebe como sección `integrations` del nav interno de `MyReposPanel` (patrón `NAV_ITEMS` + `section`).
- Las integraciones instaladas con adapter se promueven a ítems del nav interno de `MyReposPanel` (debajo de los NAV_ITEMS, grupo "Integrations"), y al clickearlas renderizan `IntegrationPanelShell` embebido en `teams-workspace-content` (sin `.ip-overlay`/`.ip-window`).
- `App.tsx` pasa `activeRepoPath` a `MyReposPanel` para el `worktreeContext` del panel.
- `IntegrationPanelHost` y las clases CSS `.ip-overlay/.ip-window*` quedan obsoletas y se borran. `SidebarIntegrationItems` se borra (su lógica se reimplementa con las clases del nav interno).
- Gating: My Repos ya está gateado a Pro a nivel Sidebar; se acepta que el marketplace quede detrás de ese gate por ahora (revisar en hito 5).

### Task A: Marketplace embebido como sección de My Repos
- Refactor `IntegrationsMarketplace.tsx`: extraer el contenido del modal a `IntegrationsMarketplaceView` (export) que renderiza sin overlay; el default export overlay puede eliminarse si nadie más lo usa.
- `MyReposPanel.tsx`: `Section` + `NAV_ITEMS` ganan `integrations` (label "Integrations"); branch `{section === 'integrations' && <IntegrationsMarketplaceView />}`.
- Tests: la vista embebida lista el catálogo e instala/desinstala (mock de `window.plugins`); nav de MyReposPanel muestra "Integrations" y cambia de sección.

### Task B: Ítems instalados + panel embebido en My Repos
- `MyReposPanel.tsx`: grupo de nav "Installed" (solo si hay instaladas con `hasAdapter`), un ítem por integración instalada (patrón visual de los nav-items existentes); estado `section` admite `integration:<pluginId>`; branch que renderiza `IntegrationPanelShell` con `adapter=getAdapter(id)` (memoizado por id), `worktreeContext={{ repoPath: activeRepoPath, branch }}` — branch vía `useGitInfo(activeRepoPath ?? undefined)` — y `getTerminalOutput` placeholder como hoy.
- `App.tsx`: pasar `activeRepoPath={activeTab.repoPath ?? null}` a `MyReposPanel`.
- Al desinstalar la integración cuya sección está activa, volver a `section: 'integrations'`.
- Tests: instalación visible en nav sin remount (evento `nest:plugins-changed`), click abre el shell embebido, uninstall vuelve al marketplace.

### Task C: Remover entry points globales + limpieza
- `Sidebar.tsx`: quitar el botón "Integrations", el render de `SidebarIntegrationItems` y las props `onIntegrationsOpen`/`onIntegrationPanelOpen`.
- `App.tsx`: quitar `integrationsOpen`/`integrationPanelId`, sus overlays y props.
- Borrar `SidebarIntegrationItems.tsx`, `IntegrationPanelHost.tsx` y sus tests; borrar CSS `.ip-overlay`, `.ip-window`, `.ip-window-bar`, `.ip-window-close`; ajustar `Sidebar-integrations.test.tsx` (o borrarlo si pierde objeto) y cualquier test que referencie lo removido.
- `npx vitest run` + `npm run build` verdes (fallas preexistentes de worktree no cuentan).

### Task D: e2e + smoke
- Reescribir `e2e/01-integrations-demo.spec.ts`: My Repos → sección Integrations → Install Demo → ítem "Demo" en el nav → panel embebido (secciones, acción → Done, compose) → Remove → ítem desaparece. Verificar que el bypass e2e tenga acceso a My Repos (si el plan free lo bloquea, resolver en el harness/env, no debilitando el gate).
- Suite completa + build + e2e verdes.

## Qué NO entra
- Teams (misma migración para el scope team llega con el hito Team/Enterprise).
- Cambios al shell (`IntegrationPanelShell` no se toca).
- Detail-page del marketplace, gate Pro server-side (hitos posteriores).
