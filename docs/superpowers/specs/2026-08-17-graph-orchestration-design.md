# Graph Orchestration — diseño

> Fecha: 2026-08-17 · Rama: `feat/integrations` · Estado: aprobado por Gero (run autónomo)
> Research que lo respalda: memoria `graph-orchestration-research` (deep-research `w3ntr1cds`, 23 claims ✓).
> Contexto de producto: `INTEGRATIONS_ORCA_BACKLOG.md`, memorias `integrations-orchestration-redesign`, `competitor-orca`, `worker-spec-feature-wip`.

## 1. Objetivo

Hoy el motor de integrations resuelve **1 ticket → 1 worker** (`worker-run.ts`, una lista lineal de steps con handoff por `.nest/handoff.md`). Esta feature lo lleva a **1 ticket → un GRAFO de agentes con rol** que se coordinan: `Architect → Coder → N Reviewers (fan-out) → Gate (barrier) → Tester`. La home de Orchestration pasa a ser un **board auto-empaquetado** de todos los grafos en vuelo, con **drill-down** a un canvas por tarea y un **inspector por nodo**. Cada nodo es una **terminal real** gestionada bajo Integrations (no un workspace).

Diferencial vs Orca: Orca hace fan-out del *mismo* prompt sobre N worktrees y mergea el ganador; nosotros corremos un **grafo de roles topológico** con handoff estructurado y **cada transición sale al equipo** (Slack/Notion) vía el bus.

## 2. Alcance

**En el MVP:**
- Modelo de datos del grafo (template + run + estados de nodo).
- 3 plantillas built-in **modificables**: `full`, `quick-fix`, `review-only`.
- Motor de orquestación **puro y testeable** (`graph-runner.ts`): qué nodo arranca, fan-out, Gate/barrier, human-in-the-loop.
- Handoff por **artefactos estructurados** en `.nest/graph/` sobre un **worktree compartido por ticket**.
- Nuevos `DomainEvent`s + recipes default (Slack/Notion).
- UI: board (thumbnails estáticos) → canvas (React Flow, montado solo en drill-down) → inspector → abrir terminal.
- Editor de plantilla como **form/lista** (agregar/quitar reviewers, rol, modelo por nodo).

**Fuera del MVP (YAGNI, dejar la puerta abierta):**
- Editor de grafo libre con nodos flotantes drag&drop (el canvas es para *ver*, no para *dibujar*).
- Loops de feedback `Reviewer → Coder` automáticos (por ahora un review bloqueante = `needs_input` que resuelve el humano).
- Race de N modelos sobre el mismo nodo (cancha de Orca, ya conceded en el backlog).
- Worktree remoto / SSH.

## 3. Advertencia de diseño incorporada (research)

La guía de Anthropic marca que descomponer por **rol** (planner/coder/reviewer/tester) es riesgoso — "telephone game" que pierde contexto en cada handoff. **Mitigación adoptada:** el handoff NO es contexto conversacional; es por **artefactos versionados estructurados** (`plan.md`, el `diff` real en git, `review-<focus>.json`) sobre un **worktree compartido** donde el estado vive en el filesystem/git. Extiende el patrón que `worker-run.ts` ya usa (`composeStepInput` + `.nest/handoff.md`).

## 4. Modelo de datos

Módulo nuevo `electron/integrations/graph-template.ts`:

```ts
export type GraphRole = 'architect' | 'coder' | 'reviewer' | 'tester' | string // string = custom
export type GraphNodeKind = 'agent' | 'gate'

export interface GraphNode {
  id: string                 // único dentro del template
  role: GraphRole            // etiqueta semántica (y default de instrucciones)
  kind: GraphNodeKind        // 'agent' = corre una terminal; 'gate' = barrier, sin terminal
  agent?: WorkerAgent        // para kind 'agent': qué CLI (reusa WorkerAgent de worker-spec-store)
  model?: string             // model-per-task (ya existe)
  effort?: 'low' | 'medium' | 'high'
  focus?: string             // p.ej. 'security' para un reviewer (distingue nodos del mismo rol)
  instructions?: string      // override; si falta, se deriva del rol
  dependsOn: string[]        // ids upstream (aristas entrantes). fan-in = varios deps
}

export interface GraphTemplate {
  id: string
  name: string
  description?: string
  builtIn?: boolean          // true en las 3 semilla; una copia editada es builtIn=false
  nodes: GraphNode[]
  createdAt: number
  updatedAt: number
}
```

El DAG se expresa por `dependsOn` (no una lista de aristas aparte — más simple de validar y editar). **Fan-out** = varios nodos con el mismo `dependsOn`. **Fan-in/Gate** = un nodo `kind:'gate'` cuyos `dependsOn` son los N reviewers. Invariantes validadas: ids únicos, `dependsOn` referencia ids existentes, **sin ciclos** (DAG), al menos un nodo raíz (deps vacío).

Estado de ejecución (en `graph-runner.ts`):

```ts
export type NodeRunState = 'queued' | 'running' | 'needs_input' | 'blocked' | 'done' | 'failed' | 'skipped'

export interface NodeRuntime {
  state: NodeRunState
  paneId?: string            // pane/PTY que corre este nodo (kind 'agent')
  startedAt?: number
  endedAt?: number
  summary?: string           // línea de resumen para la tarjeta/inspector
  artifact?: string          // ruta del artefacto de handoff que dejó
}

export interface GraphRun {
  runId: string
  ticketId: string
  templateId: string
  worktreePath: string       // worktree compartido del ticket
  branch: string
  nodes: Record<string, NodeRuntime>   // por node.id
  startedAt: number
}
```

## 5. Plantillas built-in (modificables)

`defaultGraphTemplates()` devuelve las 3 semilla (`builtIn:true`). Al editar una, se guarda una **copia** con `builtIn:false` + id nuevo (semántica no-destructiva; la built-in siempre queda como base).

- **`full`**: `architect → coder → [reviewer·security, reviewer·types, reviewer·perf] → gate → tester`.
- **`quick-fix`**: `coder → reviewer → tester`.
- **`review-only`**: `[reviewer, reviewer] → gate` (para auditar sin editar).

Editables por ticket antes de correr: +/− reviewers, agregar/quitar un nodo, cambiar `agent`/`model`/`effort`/`focus` por nodo. El único parámetro que Gero pidió explícito es **N reviewers configurable**.

Store: `electron/integrations/graph-template-store.ts`, **mismo patrón atómico/versionado que `worker-spec-store.ts`** (`load` tolera archivo ausente→[]/corrupto→warn+[]; `save` tmp+rename; drop de entradas inválidas, nunca crash). `list()` = built-ins ⊕ custom del usuario.

## 6. Motor: `graph-runner.ts` (puro, sin fs/PTY/Electron)

Espejo de `agent-status.ts`/`automation-runner.ts`: lógica pura, 100% unit-testable, el caller (main, fuera de scope) inyecta el estado real.

API:
```ts
// Nodos 'queued' cuyos deps están TODOS 'done' → listos para arrancar.
export function readyNodes(t: GraphTemplate, run: GraphRun): string[]

// Estado de un gate dado el estado de sus deps:
//  - 'waiting'   : algún dep no terminó
//  - 'blocked'   : todos terminaron pero ≥1 quedó 'blocked'/'needs_input' → human-in-the-loop
//  - 'passed'    : todos 'done' sin bloqueos → habilita downstream
export function gateState(t, run, gateId): 'waiting' | 'blocked' | 'passed'

// Un tick del orquestador: computa el delta a partir del estado actual.
export function advanceGraph(t: GraphTemplate, run: GraphRun): {
  toStart: string[]                 // nodos a lanzar ahora (agent) / resolver (gate passed)
  events: DomainEvent[]             // node.started / node.done / node.needs_input / gate.blocked / graph.completed
  completed: boolean                // todos los nodos terminales 'done'
  blockedOn: string[]               // nodos/gates esperando al humano
}
```

Reglas:
- Un nodo `agent` arranca cuando `readyNodes` lo incluye; el orquestador crea su pane y marca `running`.
- El estado `running/needs_input/done` de cada nodo lo deriva `deriveAgentState` (agent-status.ts) del pane; el runner lo consume.
- Un **gate** no corre terminal: cuando `gateState==='passed'` pasa a `done` y desbloquea downstream; cuando `'blocked'` emite `gate.blocked` (→ Slack) y queda esperando input humano.
- **Human-in-the-loop:** `needs_input` en cualquier nodo pausa ese camino y emite evento; se resuelve cuando el humano actúa (approve → `done`; reply → sigue `running`).
- **Dedup:** `advanceGraph` sólo emite en transición (el caller pasa el estado previo o el runner compara contra el `run` persistido), mismo cuidado que `worktree-signals.ts` (set-antes-de-emit).
- **Fallo:** un nodo `failed` marca `skipped` a sus descendientes y emite `error.detected` (evento ya existente) → recipe notify.

## 7. Ejecución (main.ts — descrito, no en el MVP puro)

- **Un worktree compartido por ticket** (reusa `worktree-create`/`startWork`). Todos los nodos-agente corren su CLI con `cwd` = ese worktree.
- Coder **edita**; los N reviewers leen el **mismo diff** en paralelo (**read-only**, no editan); Tester corre los tests ahí.
- Cada nodo-agente = un pane/PTY (reusa `pty-manager`/`setup-runner`) **bajo Integrations, no como workspace** (no entra a My Repos).
- Handoff: `graph-handoff.ts` compone el input de cada nodo prependiendo los artefactos de sus `dependsOn`:
  - `architect → .nest/graph/plan.md`
  - `coder → .nest/graph/coder.md` (+ el diff real en git)
  - `reviewer·<focus> → .nest/graph/review-<focus>.json`
  - `composeNodeInput(node, upstreamArtifacts)` extiende `composeStepInput`.

## 8. Bus (nuevos eventos + recipes)

En `bus-types.ts` (+ guards en `bus-types.test.ts`), agregar al `DomainEvent`:
- `graph.node_started` `{ ticketId, nodeId, role }`
- `graph.node_done` `{ ticketId, nodeId, role, summary? }`
- `graph.node_needs_input` `{ ticketId, nodeId, role, question? }`
- `graph.gate_blocked` `{ ticketId, gateId, blockedBy: string[] }`
- `graph.completed` `{ ticketId, templateId }`

Recipes default en `recipes.ts` (mismo swap-not-merge intencional ya documentado):
- `graph.node_needs_input → notify` ("🙋 `<branch>`: el nodo `<role>` te espera")
- `graph.gate_blocked → notify` ("⛔ Gate de `<branch>` bloqueado por `<focus>`")
- `graph.completed → notify` + `logOutcome` a Calendar (reusa `GcalOutcomeSink`).

## 9. UI

Dependencias nuevas: **`@xyflow/react`** (MIT) + **`@dagrejs/dagre`** (auto-layout DAG). React Flow se monta **solo en el drill-down** (no en el board — ver perf).

- **`src/components/GraphBoard.tsx`** — board auto-empaquetado (`grid` con `auto-fill minmax`), cada tarea = una tile con su **mini-grafo estático** (SVG/CSS, NO React Flow → aguanta decenas de grafos). Estilo Minimal validado: color = estado (`#0066FF` working / `#22C55E` done / `#F59E0B` needs-you / gris queued), theme real de Nest (negro, Inter). Reusa datos del `GraphRun`.
- **`src/components/GraphCanvas.tsx`** — al entrar a una tarea: React Flow con custom nodes, auto-layout dagre (fan-out/gate), pan/zoom/minimap. Nodos ricos (rol, focus, modelo, estado, resumen).
- **`src/components/GraphInspector.tsx`** — panel del nodo seleccionado: qué espera, preview de las últimas líneas de su terminal, acciones (Open terminal / Reply / Approve).
- **`src/components/GraphTemplateEditor.tsx`** — antes de correr: elegir plantilla + editar (form/lista): +/− reviewers, modelo por nodo, guardar copia.
- **`src/lib/graph-view.ts`** — puro: mapea `GraphTemplate`+`GraphRun` → nodos/aristas de React Flow y corre dagre (testeable sin render).

Entrada desde el sidebar de Integrations (junto a `WorktreesSection`/`MyReposPanel`), NO en Workspaces.

## 10. Testing (vitest node/jsdom, patrón del repo)

- `graph-template.test.ts` — built-ins válidos; `toGraphTemplate` valida/dropea; detección de ciclos; editabilidad (add/remove reviewer preserva DAG).
- `graph-runner.test.ts` — `readyNodes` (lineal + fan-out: N reviewers listos juntos); `gateState` (waiting/blocked/passed); barrier espera a todos; gate blocked → `needs_input`; completion; `failed` → descendientes `skipped`; dedup de eventos.
- `graph-handoff.test.ts` — `composeNodeInput` con múltiples artefactos upstream; paths `.nest/graph/`.
- `graph-template-store.test.ts` — load/save atómico; built-in ⊕ custom; robustez (missing/corrupt/entradas inválidas).
- `graph-view.test.ts` — mapeo template→React Flow + layout determinista.
- `bus-types.test.ts` — guards de los 5 eventos nuevos.
- Componentes (`GraphBoard`/`GraphInspector`) con jsdom, ligero.
- **La suite existente (731) debe quedar verde** — no tocar contratos ajenos.

## 11. Fases (para el plan de implementación)

1. **F1 — Modelo + store** (puro): `graph-template.ts` (tipos, built-ins, validación, ciclos) + `graph-template-store.ts` + tests. Sin UI, sin main.
2. **F2 — Runner** (puro): `graph-runner.ts` (readyNodes/gateState/advanceGraph) + `graph-handoff.ts` + tests. Consume `AgentState`.
3. **F3 — Bus**: eventos nuevos en `bus-types.ts` + guards + recipes default + tests.
4. **F4 — UI board+canvas**: dep `@xyflow/react`+`dagre`; `graph-view.ts` (puro+test) → `GraphBoard` → `GraphCanvas` → `GraphInspector`. Con mock data del runner. **Requiere validación visual de Gero.**
5. **F5 — Editor de plantilla**: `GraphTemplateEditor` (form) + wiring al store.
6. **F6 — Cableado en main** (fuera del run puro; requiere Gero + smoke en vivo): orquestador que samplea panes, llama `advanceGraph`, crea worktree+panes, escribe artefactos. IPC. Es el equivalente a los "fast-follow" de las Épicas B/C/D del backlog.

F1–F3 y la parte pura de F4 (`graph-view`) son autónomas y verificables por tests. F4-UI/F5 quedan para revisión visual. F6 (main + smoke real) queda documentada para retomar con Gero.

## 12. Riesgos / open questions (del research)

- **Perf del board** con muchos grafos: mitigado renderizando el board con thumbnails estáticos y React Flow solo en drill-down. Validar si aún así hace falta virtualizar.
- **dagre vs elkjs**: arrancamos con dagre (simple, recomendado por React Flow); si el board anidado o el ruteo de aristas lo pide, migrar a elkjs (pesado, 1.45MB).
- **Telephone game**: mitigado por handoff estructurado; verificar en vivo (F6) que el contexto por artefactos alcanza vs re-inyección de prompt.
- **tldraw**: descartado por licencia no-MIT; React Flow cubre el MVP.
