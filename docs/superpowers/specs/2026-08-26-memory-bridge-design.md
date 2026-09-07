# Memory Bridge — diseño

> Rama: `feat/integrations`
> Fecha: 2026-08-26
> Contrato con la rama de memoria: `docs/MEMORY_INTEGRATIONS_CONTRACT.md`

## 1. Qué es

El puente entre la orquestación de agentes de Integrations y Nest Memory. Convierte lo
que pasa en un run del graph (verdicts de review, escalaciones, decisiones humanas,
resultados de tests) en observaciones persistentes, sin depender de que un modelo se
acuerde de llamar a `memory_save`.

Es la implementación de la **Layer C** que `docs/nest-memory-architecture.md` §2.3 diseñó
y dejó sin construir. El riesgo R-1 de ese doc ("model non-compliance") es el más alto del
producto: hoy la memoria depende de que el agente decida escribir. Un evento de bus no
depende de nadie.

**Alcance de este spec**: solo el puente. La vista de grafo y el vault markdown son
documentos aparte y consumen lo que este produce.

## 2. Restricción de base

Cero modificaciones a `electron/memory-*.ts`, a `supabase/migrations/20260730000000_nest_memory.sql`
y a las edge functions. Todo lo nuestro vive en `electron/integrations/` y en archivos
nuevos. Escribimos únicamente por `store.save()`.

## 3. Arquitectura

### 3.1 Los dos puertos

Integrations no tiene el store: `memory-store.ts` vive en la otra rama. Usamos el mismo
patrón que Bauti aplicó a `PtyMemoryIntegration`: una interface inyectada con
implementación no-op por default, para que Integrations compile y testee sin la otra rama,
sin `better-sqlite3` y sin Electron.

```ts
// electron/integrations/memory-port.ts

export interface MemorySaveInput {
  cwd: string            // el adapter resuelve projectKey, igual que memory-ipc-server
  title: string
  content: string
  type: 'decision' | 'bugfix' | 'architecture' | 'discovery' | 'pattern' | 'config' | 'preference' | 'session'
  topicKey?: string
  tags?: string[]
  sourceRef: string      // identidad estable, ver §6
  originAi?: string
  gitBranch?: string
}

export interface MemorySink {
  save(input: MemorySaveInput): void
}

/** No-op por default: sin la rama de memoria mergeada, el puente corre y no escribe. */
export const NULL_SINK: MemorySink = { save: () => {} }
```

Del lado de la rama de memoria, el adapter real son unas veinte líneas sobre
`MemoryStore.save()` con `source: 'pty'`.

### 3.2 El punto de enganche

**`EventBus.setOnEmit(cb)` ya existe** (`event-bus.ts:66`) y su comentario dice literalmente
que está para *"capture the event stream without coupling the bus itself to storage"*. Es
exactamente lo que necesitamos y no hay que agregar nada al bus.

**Pero está ocupado**: `main.ts:2415` lo usa para el Activity log del Hub, y acepta un solo
callback. No lo cambiamos a `addOnEmit` (sería tocar el bus y romper su test); en su lugar
el callback existente en `main.ts` hace fan-out a los dos consumidores. Es una línea y
mantiene al bus con una sola responsabilidad.

### 3.3 Las dos fuentes: el bus dice cuándo, el run dice qué

Los eventos son deliberadamente pobres. `graph.gate_blocked` trae
`{ticketId, gateId, blockedBy: string[]}` y nada más: no trae los concerns. "El gate fue
bloqueado por rev-security" es un log, no una memoria.

El contenido vive en el `GraphRun` persistido. **`NodeRuntime` ya guarda `verdict?: Verdict`
(el `{concerns, blocking}` parseado), `summary?`, `artifact?` y `exitCode?`**
(`graph-runner.ts:26-35`), así que el puente resuelve casi todo desde `GraphRunStore.get(runId)`
sin tocar el disco. Solo va al worktree para el cuerpo largo de un artefacto markdown
(el plan del architect, por ejemplo).

```
DomainEvent (cuándo)  ->  GraphRunStore.get / getByTicket (qué)  ->  MemorySink.save
```

`GraphRunStore` ya expone `get(runId)` y `getByTicket(ticketId)`, y los eventos de graph
llevan `ticketId`. La resolución es directa.

### 3.4 Las decisiones humanas no pasan por el bus

`changes.requested` viaja por IPC directo, no por el bus (comentario en `bus-types.ts:70`),
y el `approve` del gate tampoco emite evento. Los handlers IPC en `main.ts:3050` y `:3054`
solo setean `run.pendingDecision`; `planTick` la aplica después
(`graph-orchestrator.ts:186`).

El puente se engancha **en los handlers IPC**, no en el tick, porque ahí el `feedback` y el
`gateId` están frescos y el run todavía tiene el estado previo a la decisión (los concerns
que el humano acaba de aceptar o rechazar). Después del tick ese estado ya se sobreescribió.

## 4. Las nueve formas de memoria

| # | Disparador | Contenido | `type` | `sourceRef` |
|---|---|---|---|---|
| 1 | `graph.gate_blocked` | Un concern por memoria, de `run.nodes[id].verdict.concerns` | `bugfix` si el nodo tiene focus de correctitud, si no `discovery` | `graph:{runId}:{nodeId}:{i}` |
| 2 | `graph.escalated` | Rondas agotadas, qué se intentó en cada una (`run.round`, `revisionNotes`) | `discovery` | `graph:{runId}:escalated` |
| 3 | IPC `approve` del gate | Los concerns que el humano aceptó igual, con el gate y los reviewers que bloqueaban | `decision` | `graph:{runId}:approve:{gateId}` |
| 4 | IPC `requestChanges` | El texto que escribió el humano (`feedback`) | `decision` | `graph:{runId}:changes:{round}` |
| 5 | Nodo tester a `done` o `failed` | `exitCode` y, si existe, el artefacto (ver §7) | `bugfix` | `graph:{runId}:test` |
| 6 | `ci.failed` / `error.detected` | El `summary` que el evento ya trae, más `runUrl` | `bugfix` | `ci:{repo}:{branch}:{runUrl}` |
| 7 | `graph.completed` | Cierre del run: qué se hizo, qué bloqueó, cuántas rondas, el ticket que lo originó | `session` | `graph:{runId}:run` |
| 8 | Alta o edición de template custom | El pipeline elegido para ese repo y por qué difiere del built-in | `config` | `template:{repoPath}:{templateId}` |
| 9 | `meeting.transcribed`, **opt-in** | `items[]` | `decision` | `meeting:{title}:{ts}` |

Y una que no crea memoria sino que **actualiza**:

**`pr.merged`** vuelve a guardar la memoria de cierre de run (misma `sourceRef`) agregando
"mergeado a `{branch}`". El `save()` de Bauti resuelve identidad por `source_ref` antes que
nada y devuelve `source_ref_updated`, así que es una actualización in-place y no un
duplicado. Eso es lo que separa "un reviewer dijo X" de "un reviewer dijo X y el cambio
terminó en main igual".

### 4.1 Las que no se capturan, y por qué

`graph.node_started` y `graph.node_needs_input` son estado transitorio, no hechos.
`task.created`, `pr.opened`, `review.requested`, `session.opened` y `block.started` son
hitos sin conocimiento adentro; el contexto del ticket entra igual, dentro de la memoria de
cierre de run (#7).

`graph.node_done` de un reviewer que **no** bloqueó queda fuera a propósito: guardar un
"revisé y está bien" por reviewer por run llena la base de ruido en días. Vale solo cuando
contradice un run anterior sobre el mismo archivo, y eso requiere leer memoria para decidir
si escribir. Queda para una segunda iteración, con datos reales de volumen.

Las conversaciones del bot en Slack tampoco se capturan. Es el R-9 del doc de memoria
("Nest lee todo"), y capturar chat sin opt-in explícito es el camino más rápido a perder la
confianza del usuario. `meeting.transcribed` está en la lista por la misma razón marcada
como opt-in, no por default.

## 5. Procedencia

Toda memoria que escribe el puente lleva un bloque de procedencia al final del `content`:

```
---
Origen: run {runId} · nodo {nodeId} ({role}{/focus}) · template {templateId}
Branch: {branch} · Ticket: {ticketId} · Ronda: {round}
Veredicto: bloqueante | no bloqueante | aprobado por humano
```

No es decoración. Si Integrations va a **decidir** en base a memorias, una memoria mal
escrita se propaga a todos los runs siguientes. La procedencia es lo que permite que un
agente (o una persona) le baje el peso a "esto lo dijo un reviewer automático en un run que
después se aprobó igual" frente a "esto lo escribió un humano al rechazar el cambio".

Es la mitigación del riesgo de envenenamiento de contexto, que ningún memory provider tiene
resuelto y que se agrava en un sistema que decide solo.

## 6. Idempotencia

`sourceRef` con el índice `UNIQUE (source, source_ref)` del store da idempotencia gratis: el
mismo evento re-emitido actualiza en vez de duplicar. Por eso todas las claves de la tabla
de §4 son determinísticas y no llevan timestamp.

Segunda red: `dedupePersistentSignals` ya dedupea `gate_blocked` y `needs_input` contra el
`seen` persistido por run, así que un gate que sigue bloqueado tick tras tick no vuelve a
llegar al puente.

## 7. El problema del tester

`composeNodeInput` solo pide escribir el artefacto de handoff `if (!isLeaf)`
(`graph-handoff.ts`), y el tester es el nodo hoja del template `full`. Hoy lo único que
queda de él es `exitCode`.

"Los tests pasaron" es la validación de todo lo demás del run, así que hace falta decidir:

- **(a)** Pedirle el artefacto igual aunque sea hoja. Cambia `composeNodeInput` para que el
  rol `tester` siempre escriba, sin tocar la lógica de `isLeaf` para los demás.
- **(b)** Conformarse con `exitCode`, que dice si pasó pero no qué falló.

Recomendación: **(a)**. Un test que falla sin decir qué falló no sirve como memoria, y el
cambio está acotado a un rol. La memoria #5 degrada a (b) si el artefacto falta.

## 8. Módulos

| Archivo | Qué |
|---|---|
| `electron/integrations/memory-port.ts` | Los puertos y el `NULL_SINK`. Puro |
| `electron/integrations/memory-bridge.ts` | `DomainEvent` + `GraphRun` a `MemorySaveInput[]`. **Puro**: sin fs, sin Electron, sin bus |
| `electron/integrations/memory-provenance.ts` | El bloque de §5 y los wikilinks. Puro |
| `electron/main.ts` | Fan-out del `setOnEmit` existente, enganche en los dos handlers IPC de decisión, e inyección del sink |
| `electron/__tests__/memory-bridge.test.ts` | Un caso por forma de memoria, más los descartes |

El grueso es puro y testeable con vitest sin `better-sqlite3`, igual que `graph-runner`,
`graph-orchestrator` y el resto del motor. Solo `main.ts` toca efectos.

## 9. Testing

- Una prueba por forma de memoria: evento más run fabricado a mano, se afirma el
  `MemorySaveInput` resultante (título, tipo, `sourceRef`, procedencia).
- Pruebas negativas para los ocho eventos descartados: no producen nada.
- Idempotencia: el mismo evento dos veces produce el mismo `sourceRef`.
- `pr.merged` sobre un run cerrado produce una entrada con la `sourceRef` de la #7, no una
  nueva.
- Un run sin verdicts (todos los reviewers fallaron al escribir JSON) no rompe: produce cero
  memorias, no una memoria vacía.

## 10. Dependencias y qué queda afuera

**Depende de**: nada de la otra rama para construirse y testearse. Para *funcionar* necesita
que la rama de memoria se merge y que `main.ts` inyecte el adapter real.

**Queda afuera de este spec**: la vista de grafo, el vault markdown, la memoria fuera de
Nest, y los tres bugs de la rama de Bauti (documentados en el contrato, son suyos).

## 11. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| B-1 | **Volumen.** Un run del template `full` con tres reviewers puede dejar diez memorias. Veinte runs por semana son doscientas | Solo concerns bloqueantes (§4.1), `sourceRef` determinística, y medir el volumen real antes de ampliar a `node_done` |
| B-2 | **Envenenamiento.** Una memoria errónea se propaga a los runs siguientes | Procedencia obligatoria (§5), y que lo que alimente decisiones automáticas sean las de origen humano (#3, #4) antes que las de reviewer |
| B-3 | **Los verdicts son de modelos.** Un reviewer alucina un concern y queda escrito como hecho | El tipo y la procedencia dicen que salió de un reviewer. `pr.merged` sobre el run le baja el peso retroactivamente |
| B-4 | El puente escribe cuando la memoria está desconectada | `NULL_SINK` por default. El adapter real chequea el estado de conexión igual que el resto |
