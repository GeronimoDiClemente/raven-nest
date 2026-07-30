# Tutorial interactivo de Raven Nest — Spec de diseño

- **Fecha:** 2026-05-26
- **Estado:** Diseño aprobado en brainstorming, pendiente de revisión final
- **Alcance de este spec:** Sub-proyecto 1 (tutorial dentro de la app), con el core diseñado **web-ready** para habilitar el Sub-proyecto 2 (embed en la página Nest), que se especifica aparte.

---

## 1. Objetivo y problema

Muchos usuarios se pierden la primera vez que abren Raven Nest. Queremos un tutorial que:

1. **Active** al usuario nuevo: llegar a su primer "win" (un pane de AI corriendo sobre un repo).
2. **Enseñe cada sección** principal (My Repos, Teams, Worktrees), incluyendo flujos completos como hacer un **merge**.

El tutorial **no** son coachmarks señalando la app real con los datos reales del usuario. Es un **mockup interactivo de alta fidelidad**: una simulación usable que **reutiliza los componentes reales** de la app en "modo demo" (datos y acciones simuladas), guiada por coachmarks interactivos. El usuario "usa" la app de mentira para aprender, sin tocar nada real.

---

## 2. Decisiones validadas en el brainstorming

| Tema | Decisión |
|---|---|
| Objetivo | Activación **+** orientación por sección (ambas) |
| Formato | Coachmarks interactivos sobre un mockup usable |
| Comportamiento | **Interactivo no-bloqueante**: avanza al hacer la acción real en el demo **o** con "Siguiente". Nunca obliga. |
| Disparo | Auto la **1ª vez** que entrás a cada sección **+** botón **Ayuda (?)** para re-jugar |
| Fidelidad | **Alta fidelidad** (réplica visual real) |
| Construcción | **Reutilizar los componentes reales en "modo demo"** con backend simulado (no re-dibujar) |
| Activación | **Enfocada en first-win** (pane → AI → cuenta → repo → tabs); cierra invitando a las secciones |
| Destinos | App ahora (este spec); web después (core desacoplado de Electron) |

---

## 3. Arquitectura

### 3.1 Modo demo (`DemoProvider` + harness de mocks)

El tutorial monta los **componentes reales** (`MyReposPanel`, `TeamsWorkspace`, `WorktreesSection`, `NewPaneDialog`, `PRReview`, etc.) dentro de un `DemoProvider` que les provee un **backend simulado** en vez del real.

El backend simulado reemplaza, mientras el tutorial corre, las dependencias de datos/acciones que consumen los componentes:

- `window.git`, `window.worktree`, `window.pty`, `window.metrics`, `window.accounts`, `window.session`, `window.dialog`, `window.localPaths`, `window.port` → implementaciones fake con datos de ejemplo.
- Cliente `supabase` → cliente mock (auth/queries/realtime fake) para Teams.
- `fetch` a `api.github.com` / `gitlab.com` → interceptado, devuelve fixtures (PRs, reviews, merge).

**Estrategia de intercepción (reto técnico principal):** al entrar al tutorial se guardan las referencias reales de `window.*` y `window.fetch`, se sustituyen por los mocks, y se **restauran en el cleanup** al salir. Para `supabase`, se inyecta el cliente mock vía el módulo/contexto que ya usan los hooks de Teams. Es una intercepción global y, por lo tanto, **frágil**: debe quedar encapsulada en un único módulo (`demo/harness`), con restauración garantizada y tests que verifiquen que ninguna API real se invoca durante el tutorial.

> Alternativa más limpia (fuera de alcance ahora): inyección de dependencias por contexto en los componentes, eliminando los `window.*` directos. Es un refactor mayor; lo dejamos anotado para el futuro.

### 3.2 Web-ready (para el Sub-proyecto 2)

Como en modo demo los componentes **no tocan Electron** (todo pasa por mocks), el mismo árbol (componentes + harness + coachmarks) podrá empaquetarse como **bundle web** sin Electron. Requisitos de diseño para no acoplarse:

- Ninguna dependencia de plataforma (node/electron) debe importarse directamente en el árbol de componentes del demo; toda dependencia de plataforma va detrás de la capa de mocks.
- `xterm.js` corre en web; el PTY se **simula** (stream de salida pre-grabado), así que no hay dependencia de `node-pty` en demo.

### 3.3 Motor de coachmarks

Componente `OnboardingTour` reutilizable (look ya validado en prototipo):

- Overlay con dimming + **spotlight** posicionado sobre el `getBoundingClientRect()` del elemento objetivo (recalculado en resize/scroll).
- Tooltip: badge "Paso X / N", título, texto, **[Atrás] · [Saltar tour] · [Siguiente]**, dots de progreso, y un hint ("o tocá el elemento resaltado").
- **No-bloqueante:** "Siguiente" siempre avanza; hacer la acción real en el demo (clic en el elemento) también avanza.
- **Anclas:** se agregan `data-tour-id` a los elementos que el mapeo marcó sin selector estable (viven en los componentes reales, reutilizados por el demo).
- **Browser panes:** en el demo el pane tipo *browser* se simula con un placeholder/iframe (no `WebContentsView` nativo), así que el overlay no se ocluye. (Fuera del demo no corremos coachmarks sobre la app real.)

### 3.4 Registro de tours, triggers y persistencia

- **Registro** `tours`: `{ id, sectionKey, steps[] }` para `activation`, `my-repos`, `teams`, `worktrees`.
- Hook **`useTourSeen(tourId)`** → `[seen, markSeen]`, respaldado en `localStorage` con clave `nest:tour-seen:<tourId>` (per-máquina, consistente con `nest:remembered-email` etc.).
- **Trigger:** al montar una sección por 1ª vez (`!seen`) se auto-abre su tutorial-demo; el botón **Ayuda (?)** lo abre siempre (ignora el flag).
- **Ubicación de los botones Ayuda:** `tw-header-right` (My Repos y Teams), `wt-section-header` (Worktrees), sidebar (activación).
- **z-index:** overlay del tutorial sobre secciones full-screen (`teams-workspace`, z-index 1000) → usar 1500; sobre worktrees en sidebar → 1200.

---

## 4. Los cuatro tours (pasos)

Basados en el mapeo del código. Cada paso = anclar a un elemento + texto + (opcional) acción demo que auto-avanza.

**Activación (≈5 pasos):** New Terminal → grid de AI → crear cuenta → linkear repo (sidebar) → workspaces en tabs. Cierra invitando a My Repos/Teams/Worktrees.

**My Repos (≈7 pasos):** ítem "My Repos" (Pro gate) → conectar GitHub/GitLab → "+ Add repo" → picker → Clone vs Link → abrir Terminal/PRs → **flujo de PR/merge** (`PRList` → `PRReview`): revisar y **mergear (simulado)**.

**Teams (≈8 pasos):** empty state → crear team → unirse por código → switcher → Members (invitar / join code) → Repos compartidos → Chat → presencia. Incluye demo de colaboración con **merge** vía `PRReview`.

**Worktrees (≈14 pasos, el más completo):** header → ítem raíz → "+" crear → modal (branch / from-branch / preset / banner .env) → estados de setup (amarillo→verde) → `PortsBanner` → abrir/IDE → diff chip → `DiffViewerPanel` → PR chip → context menu "Push to GitHub" → "Remove worktree".

> Los textos finales de cada paso se afinan durante la implementación.

---

## 5. Datos de ejemplo (fixtures)

Módulo `demo/fixtures` con: 2-3 repos demo (GitHub + GitLab, con y sin `local_path`), un team demo con miembros y presencia, worktrees demo en varios `setupState`, un **PR demo mergeable** con archivos/reviews, puertos declarados/detectados, y un buffer de salida de terminal pre-grabado.

## 6. Acciones simuladas

- **merge:** marca el PR demo como `merged` en el estado del harness y refleja el resultado en `PRReview`.
- **clone / link:** agrega un `local_path` fake al repo demo.
- **crear worktree:** agrega el ítem y transiciona `running → done` con timers fake; emite logs/puertos fake.
- **push:** muestra un `compareUrl` fake.
- **pty:** stream de texto pre-grabado en el `xterm` del pane demo.

## 7. Aislamiento y seguridad

El harness intercepta **todas** las dependencias de datos/red/IPC; nada se escribe a Supabase, disco ni red reales. Al salir del tutorial se restauran las APIs reales. Tests garantizan que ninguna API real se invoca durante el tutorial.

## 8. Riesgos y consideraciones

- **Intercepción global** de `window.*`/`fetch`/supabase: frágil. Mitigación: encapsular en `demo/harness`, restaurar en cleanup, cubrir con tests.
- **Acoplamiento a Electron** de algún componente: puede requerir pequeños puntos de inyección; identificarlo temprano.
- **Mantenimiento:** al reutilizar componentes reales, la UI del demo se actualiza sola; el costo se traslada a mantener los **mocks** (cuando cambia el shape de una API) y los `data-tour-id`.
- **Señal contradictoria sobre browser panes** entre sondeos: irrelevante en demo (pane simulado); a verificar solo si en el futuro se hicieran coachmarks sobre la app real.

## 9. Testing

- **Unit:** `useTourSeen`, harness de mocks (intercepción + restauración), transiciones de cada tour.
- **Integration:** montar cada tour en modo demo y recorrer todos los pasos (vía acción real y vía "Siguiente"); spies que **fallan** si se invoca una API real.
- **Smoke:** abrir cada tour desde su botón Ayuda y desde el auto-launch de 1ª vez.

## 10. Alcance

**En alcance (Sub-proyecto 1):** motor de coachmarks, `useTourSeen`, `DemoProvider` + harness de mocks + fixtures, los 4 tours, botones Ayuda, auto-launch de 1ª vez, `data-tour-id` en los componentes. Core diseñado web-ready.

**Fuera de alcance (Sub-proyecto 2, spec aparte):** bundle web del demo + sección "Aprendé a usar Nest" en la página Nest.

## 11. Archivos (nuevos / a modificar)

**Nuevos:**
- `src/tutorial/OnboardingTour.tsx` — motor de coachmarks (overlay/spotlight/tooltip).
- `src/tutorial/tours/*.ts` — definición de pasos por tour (activation, my-repos, teams, worktrees).
- `src/tutorial/DemoProvider.tsx` — monta el modo demo.
- `src/tutorial/demo/harness.ts` — intercepción/restauración de `window.*`, `fetch`, supabase.
- `src/tutorial/demo/fixtures.ts` — datos de ejemplo.
- `src/hooks/useTourSeen.ts` — flag `nest:tour-seen:<id>`.

**Modificados:**
- `data-tour-id` en `MyReposPanel`, `TeamsWorkspace`, `WorktreesSection`, `NewWorktreeModal`, `NewPaneDialog`, `Sidebar`, `PRList`/`PRReview`.
- Botón Ayuda (?) en `tw-header-right` (My Repos/Teams), `wt-section-header` (Worktrees), y sidebar (activación).
- Auto-launch de 1ª vez al montar cada sección.

## 12. Fases de implementación (alto nivel)

1. Motor de coachmarks + `useTourSeen` + tour de **activación** (sobre un demo mínimo).
2. `DemoProvider` + harness de mocks + fixtures (intercepción `window`/`fetch`/supabase).
3. Tours **My Repos**, **Teams**, **Worktrees** (con merge demo).
4. Botones Ayuda + auto-launch 1ª vez + `data-tour-id`.
5. Tests (unit + integration + smoke).
