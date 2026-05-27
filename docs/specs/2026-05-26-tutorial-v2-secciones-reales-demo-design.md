# Tutorial interactivo v2 — secciones reales en modo demo — Spec de diseño

- **Fecha:** 2026-05-26
- **Estado:** Diseño aprobado en brainstorming, pendiente de revisión final.
- **Reemplaza:** el enfoque del `DemoActivationStage` esquelético de `docs/specs/2026-05-26-tutorial-interactivo-design.md` (Plan 1). Ese mockup dibujado a mano no representaba la app real y fue rechazado.
- **Alcance de este spec:** Sub-proyecto **Worktrees** (primera sección). El patrón se replica luego a My Repos, Teams y la activación (specs/planes aparte).

---

## 1. Objetivo y problema

Los usuarios nuevos se pierden. Queremos un tutorial **interactivo dentro de la app real** que los guíe por cada sección **sin tocar sus repos, proyectos ni datos reales**.

El enfoque anterior (un "stage" de demo dibujado a mano) falló: no parecía la app real, la estética era pobre, y el swap global de `supabase` rompía los hooks reales de la app de fondo (`maybeSingle is not a function`).

Este rediseño monta los **componentes reales** de cada sección en un sandbox aislado con datos de demostración y coachmarks. Empezamos por **Worktrees** (el flujo más completo) para validar el patrón end-to-end antes de replicarlo.

---

## 2. Decisiones validadas

| Tema | Decisión |
|---|---|
| Enfoque | **B — secciones reales en modo demo** (componentes reales + datos demo + coachmarks), no un mockup esquelético ni la app entera en sandbox |
| Sección inicial | **Worktrees** |
| Aislamiento | Sandbox overlay; componentes del tutorial usan `bridge.*` (mocks), la app de fondo usa `window.*` directo (intacta) |
| supabase | **No se swappea** para Worktrees (no lo usa). El swap pasa a ser **opcional por-tour** (solo para tours que tocan Teams) |
| Coachmarks | Reutilizar el motor `OnboardingTour` existente (interactivo, no-bloqueante) |
| Entrada | Apartado **"Tutorial"** en **Settings** + auto la **1ª vez** que se abre Worktrees. Se **quita el botón "?"** del sidebar |
| Reúso | `OnboardingTour`, `useTourSeen`, `bridge`, fixtures. **Se descarta** `DemoActivationStage` y el `TutorialController`/auto-launch de activación del Plan 1 |

---

## 3. Arquitectura

### 3.1 Aislamiento (la clave)

La app de fondo llama `window.git`/`window.worktree`/etc. **directamente**; los componentes que el tutorial reutiliza se **migran a `bridge.*`**. Como los overrides del `bridge` (ya existente, `src/lib/bridge.ts`) solo afectan a quien lee por `bridge`, **la app de fondo no se ve afectada** por el modo demo. El sandbox es un overlay full-screen que la cubre y la oculta; al cerrar, se desmonta y se limpian los overrides.

Esto resuelve el bug de `supabase`: el tutorial de Worktrees **no** llama `__setSupabaseClient`, así que los hooks reales de la app (`useProfile`, `useGitHub`, etc.) siguen usando el cliente real y no se rompen.

### 3.2 `TutorialSandbox`

Componente overlay (`z-index` por encima de todo, ≥2000) que:
1. Activa el harness de demo **selectivo** (setea `bridge` overrides para las APIs que la sección usa; supabase solo si el tour lo declara).
2. Monta los **componentes reales** de la sección con props demo.
3. Renderiza `OnboardingTour` con los pasos del tour.
4. En cleanup: limpia overrides (`__clearBridgeOverrides`), resetea supabase si lo había swappeado, desmonta.

### 3.3 Harness de demo (ajuste del existente)

`createDemoHarness(state, opts)` con `opts` que declara **qué** interceptar:
- `bridge` overrides: siempre (las window.* APIs que la sección usa).
- `supabase`: solo si `opts.supabase === true` (Worktrees: `false`).
- `fetch`: solo si la sección hace fetch a GitHub/GitLab (Worktrees usa `window.git`, no fetch directo → `false`).

Se elimina el `DemoActivationStage`. El `harness` ya inyecta vía `bridge` (hecho en el rework anterior).

### 3.4 Migración a `bridge.*`

Componentes a migrar (mecánico, behavior-preserving en producción porque `bridge` delega a `window` cuando no hay overrides):
- `WorktreesSection`, `NewWorktreeModal`, `DiffViewerPanel`, `PortsBanner`, y cualquier helper que esos usen para `window.worktree`/`window.git`/`window.dialog`/`window.port`/`window.ide`/`window.preset`.
- **No** se migra `window.addEventListener`/`localStorage`/`location` (DOM nativo).

### 3.5 Coachmarks

Se reutiliza `src/tutorial/OnboardingTour.tsx` (spotlight + tooltip + Atrás/Saltar/Siguiente + click-to-advance), anclando a `data-tour-id` agregados a los componentes reales de Worktrees.

---

## 4. Componentes reales reutilizados (props conocidas)

- `WorktreesSection` (named): `{ repoPath, activeRepoPath, onSelect, onNewClick, refreshKey? }`
- `NewWorktreeModal` (named): `{ open, repoPath, onClose, onCreated }`
- `DiffViewerPanel` (named): `{ open, worktreePath, onClose }`
- `PortsBanner` (named): `{ cells: CellRef[], rootRepoPath, onOpenInternal? }`

El sandbox les pasa props demo (`repoPath` = ruta demo, handlers que operan sobre el estado del harness).

---

## 5. Flujo del tutorial Worktrees (pasos)

Interactivo, no-bloqueante (hacés la acción real-en-demo **o** "Siguiente"). Pasos:

1. **Header de Worktrees** — qué es un worktree (rama aislada en su carpeta).
2. **Crear** ("+") → abre `NewWorktreeModal`.
3. **Modal**: elegir branch / from-branch / preset / banner de `.env` no trackeados.
4. **Confirmar** → aparece el worktree en estado **setup (amarillo)**.
5. **Setup → done (verde)** — transición simulada con timers fake.
6. **`PortsBanner`** — puertos detectados del worktree demo.
7. **Abrir / IDE** — abrir el worktree (acción demo).
8. **Diff chip** → abre `DiffViewerPanel` con un diff demo.
9. **PR chip** — PR asociada (demo).
10. **Context menu → "Push to GitHub"** — muestra un `compareUrl` fake.
11. **"Remove worktree"** — quita el worktree demo del estado.

Los textos finales se afinan en implementación.

---

## 6. Datos de ejemplo (fixtures)

Extender `src/tutorial/demo/fixtures.ts`: un repo demo con `localPath`, 2-3 worktrees demo en `setupState` variados (`running`/`done`), puertos declarados/detectados, un diff demo (archivos + hunks), una PR demo asociada a una rama. El harness muta este estado en las acciones simuladas (crear/remove worktree, push).

---

## 7. Acciones simuladas (mocks `window.worktree`/`git`/etc.)

- **crear worktree:** agrega el ítem y transiciona `running → done` con timers fake; emite puertos fake.
- **remove:** quita el ítem del estado.
- **diff:** `DiffViewerPanel` lee el diff demo.
- **push:** devuelve un `compareUrl` fake.
- **abrir/IDE:** no-op visible (toast/log demo), sin abrir nada real.

---

## 8. Entrada y persistencia

- **Settings:** nuevo tab/apartado **"Tutorial"** en `src/components/SettingsPanel.tsx` (junto a keybinds/presets/…), con una lista de tutoriales por sección y un botón "Iniciar" cada uno. Lanza el `TutorialSandbox` del tour elegido.
- **Auto 1ª vez:** al abrir Worktrees por primera vez (`!useTourSeen('worktrees').seen`), ofrecer/abrir el tutorial. Marcar visto al cerrar.
- **Quitar** el botón "?" del `Sidebar` (se reemplaza por el apartado en Settings).

---

## 9. Aislamiento y seguridad

- El sandbox cubre la app; la app de fondo (que usa `window.*` directo) no se altera.
- Worktrees **no** swappea supabase → no rompe hooks reales.
- Las acciones operan sobre el estado del harness; **nada** se escribe a disco, git real, red ni supabase.
- Cleanup garantizado al cerrar (limpiar overrides, desmontar).

---

## 10. Reúso vs descarte del Plan 1

**Reúso:** `src/tutorial/OnboardingTour.tsx`, `src/hooks/useTourSeen.ts`, `src/lib/bridge.ts`, `src/tutorial/demo/fixtures.ts` + `mocks.ts` (ampliados), el harness (ajustado a overrides selectivos).

**Descarte / cambio:**
- `src/tutorial/DemoActivationStage.tsx` — eliminar.
- `src/tutorial/TutorialController.tsx` — reemplazar su lógica de auto-launch de activación por el nuevo modelo (sandbox por sección, trigger desde Settings + auto 1ª vez de Worktrees).
- Botón "?" en `Sidebar.tsx` — quitar.
- `harness.ts` — `supabase`/`fetch` pasan a ser opt-in por tour.

---

## 11. Alcance

**En alcance (este spec):** `TutorialSandbox`, harness selectivo, fixtures de Worktrees, migración a `bridge.*` de los 4 componentes de Worktrees, `data-tour-id`, el tour de Worktrees, apartado "Tutorial" en Settings, auto-launch 1ª vez de Worktrees, quitar "?".

**Fuera de alcance (replicar después, specs/planes aparte):** tours de My Repos (con PR/merge), Teams (con supabase mock completo + merge colaborativo), y activación/primer pane.

---

## 12. Riesgos

- **Migración a `bridge` incompleta:** si un componente de Worktrees deja una llamada `window.*` sin migrar, en demo usaría la API real. Mitigación: grep de `window.<api>` en los 4 componentes tras migrar; test que falle si una API real se invoca durante el tour.
- **Props demo insuficientes:** los componentes reales pueden requerir props/contexto que no anticipamos. Mitigación: montarlos temprano en un test de integración.
- **Mock fidelity:** el shape de `window.worktree`/`git` debe matchear lo que los componentes esperan; afinarlo contra las firmas reales del preload.
- **App de fondo visible al abrir/cerrar:** asegurar que el overlay cubre completamente y que el cleanup es inmediato.

---

## 13. Archivos (nuevos / a modificar)

**Nuevos:**
- `src/tutorial/TutorialSandbox.tsx` — overlay que monta la sección real + coachmarks en demo.
- `src/tutorial/tours/worktrees.ts` — pasos del tour de Worktrees.
- (posible) `src/tutorial/demo/worktree-mocks.ts` o ampliación de `mocks.ts`.

**Modificados:**
- `src/tutorial/demo/harness.ts` — overrides selectivos (supabase/fetch opt-in).
- `src/tutorial/demo/fixtures.ts` — datos demo de worktrees/puertos/diff/PR.
- `src/components/WorktreesSection.tsx`, `NewWorktreeModal.tsx`, `DiffViewerPanel.tsx`, `PortsBanner.tsx` — `window.*` → `bridge.*` + `data-tour-id`.
- `src/components/SettingsPanel.tsx` — apartado "Tutorial".
- `src/components/Sidebar.tsx` — quitar el botón "?".
- `src/tutorial/registry.ts` — registrar el tour `worktrees`.
- `src/tutorial/TutorialController.tsx` — nuevo modelo de trigger (o reemplazo).
- Eliminar `src/tutorial/DemoActivationStage.tsx` y el tour/anclas de activación si quedan colgados.

---

## 14. Testing

- **Unit:** harness con overrides selectivos (supabase NO tocado cuando `opts.supabase` es false); acciones simuladas mutan el estado.
- **Integration:** montar `TutorialSandbox` del tour Worktrees, recorrer todos los pasos (acción real-en-demo y "Siguiente"); **spies que fallan si se invoca una `window.*`/supabase real** durante el tour.
- **Regresión:** confirmar que la app de fondo (window directo) y los tests existentes siguen verdes.
- **Manual (Electron):** abrir el tutorial desde Settings y desde el auto-launch; verificar consola sin errores y que no se tocan repos/worktrees reales.
