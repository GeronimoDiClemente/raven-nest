// Smoke del camino de escritura del memory bridge: evento -> bridge -> adapter -> SQLite real.
// No cubre la UI ni el bus (eso necesita la app corriendo y sesion iniciada); cubre lo que nunca
// se ejercito: que el adapter mapee bien y que las filas queden de verdad en la base.
//
// Correr con:  ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe smoke-check.cjs
// (better-sqlite3 solo tiene compilado el ABI de Electron en este worktree)
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from './electron/memory-store'
import { bridgeEvent, bridgeDecision } from './electron/integrations/memory-bridge'
import { resolveProjectKey, GLOBAL_PROJECT_KEY } from './electron/memory-project-key'
import type { GraphRun } from './electron/integrations/graph-runner'
import type { GraphTemplate } from './electron/integrations/graph-template'
import { defaultGraphTemplates } from './electron/integrations/graph-template'
import type { MemorySaveInput } from './electron/integrations/memory-port'

const ok = (label: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '  OK  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`)
  if (!cond) process.exitCode = 1
}

const dir = mkdtempSync(join(tmpdir(), 'nest-smoke-'))
const store = new MemoryStore(join(dir, 'memory.db'))

// Replica EXACTA del adapter de main.ts (no es importable: vive inline ahi).
// Sin el gate de conexion, que es lo unico que no aplica fuera de la app.
function sink(input: MemorySaveInput): void {
  const projectKey = resolveProjectKey({ remoteUrl: null, rootPath: input.cwd || null })
  store.ensureProject({
    projectKey,
    displayName: input.cwd ? (input.cwd.split(/[\\/]/).filter(Boolean).pop() ?? input.cwd) : GLOBAL_PROJECT_KEY,
    rootPath: input.cwd || null,
    remoteUrl: null,
  })
  store.save({
    projectKey,
    scope: 'personal',
    type: input.type,
    title: input.title,
    content: input.content,
    source: 'pty',
    topicKey: input.topicKey,
    tags: input.tags,
    sourceRef: input.sourceRef,
    originAi: input.originAi,
    gitBranch: input.gitBranch,
  })
}

// ── El escenario del mockup: ENG-412, el token que se loguea en claro ──────────
const full: GraphTemplate = defaultGraphTemplates().find((t) => t.id === 'full')!

const run: GraphRun = {
  runId: 'a7f3c1', ticketId: 'ENG-412', templateId: 'full',
  worktreePath: 'C:/tmp/wt-eng-412', repoPath: 'C:/Users/gerod/Dev/raven-nest',
  branch: 'feat/eng-412', startedAt: Date.now() - 7_200_000, mode: 'auto', round: 1,
  nodes: {
    architect: { state: 'done' },
    coder: { state: 'done' },
    'rev-security': {
      state: 'done',
      verdict: { blocking: true, concerns: [
        'el retry sigue imprimiendo el header Authorization',
        'falta redactar el token en el log de reconexion',
      ] },
    },
    'rev-types': { state: 'done', verdict: { blocking: false, concerns: [] } },
    'rev-perf': { state: 'done', verdict: { blocking: false, concerns: [] } },
    gate: { state: 'blocked' },
    tester: { state: 'queued' },
  },
}

const ctx = {
  getRun: (key: string) => (key === run.ticketId || key === run.branch ? run : null),
  getTemplate: (id: string) => (id === full.id ? full : null),
  resolveRepo: () => null,
}

const drain = (inputs: MemorySaveInput[]) => { for (const i of inputs) sink(i); return inputs }

console.log('\n=== 1. gate_blocked: una memoria por concern bloqueante ===')
const blocked = drain(bridgeEvent(
  { type: 'graph.gate_blocked', ticketId: 'ENG-412', gateId: 'gate', blockedBy: ['rev-security', 'rev-types', 'rev-perf'] } as any,
  ctx as any
))
ok('produce 2 memorias (solo del reviewer que bloqueo)', blocked.length === 2, `produjo ${blocked.length}`)
ok('tipo bugfix para el foco de seguridad', blocked.every((b) => b.type === 'bugfix'))
ok('sourceRef determinista por concern', blocked[0]?.sourceRef === 'graph:a7f3c1:rev-security:0')
ok('lleva el wikilink del run', !!blocked[0]?.content.includes('[[run-a7f3c1]]'))
ok('lleva el agente en el texto de la procedencia', !!blocked[0]?.content.includes('claude'))
ok('el veredicto sale en espanol', !!blocked[0]?.content.includes('bloqueante'))

console.log('\n=== 2. approve: el juicio humano sobre el de la maquina ===')
const approved = drain(bridgeDecision({ kind: 'approve', gateId: 'gate' } as any, run, full))
ok('produce 1 memoria de decision', approved.length === 1 && approved[0].type === 'decision')
ok('sourceRef incluye la ronda', approved[0]?.sourceRef === 'graph:a7f3c1:approve:gate:1')
ok('cita los concerns que se anularon', !!approved[0]?.content.includes('Authorization'))

console.log('\n=== 3. cierre de run y confirmacion por merge ===')
const closed = drain(bridgeEvent({ type: 'graph.completed', ticketId: 'ENG-412', templateId: 'full' } as any, ctx as any))
ok('produce la memoria de cierre', closed.length === 1 && closed[0].type === 'session')
const beforeMerge = store.count()
const merged = drain(bridgeEvent({ type: 'pr.merged', branch: 'feat/eng-412', repoFullName: 'o/r' } as any, ctx as any))
ok('pr.merged reusa la sourceRef del cierre', merged[0]?.sourceRef === closed[0]?.sourceRef)
ok('pr.merged ACTUALIZA, no duplica', store.count() === beforeMerge, `antes ${beforeMerge}, despues ${store.count()}`)

console.log('\n=== 4. lo que quedo en SQLite ===')
const total = store.count()
ok('4 memorias en la base', total === 4, `hay ${total}`)
const projectKey = resolveProjectKey({ remoteUrl: null, rootPath: 'C:/Users/gerod/Dev/raven-nest' })
const rows = store.context(projectKey, 50)
ok('las 4 se leen desde el proyecto correcto', rows.length === 4, `leyo ${rows.length}`)
const first = store.get(blocked[0].sourceRef ? rows.find((r) => r.title.includes('Authorization'))!.syncId : '')
ok("source='pty' (la Layer C reservada del diseno)", (first as any)?.source === 'pty', `es '${(first as any)?.source}'`)
ok('la de cierre quedo marcada como mergeada',
  !!rows.find((r) => r.type === 'session')?.content.includes('Mergeado'))

console.log('\n=== 5. idempotencia: re-emitir todo no duplica ===')
drain(bridgeEvent({ type: 'graph.gate_blocked', ticketId: 'ENG-412', gateId: 'gate', blockedBy: ['rev-security'] } as any, ctx as any))
drain(bridgeDecision({ kind: 'approve', gateId: 'gate' } as any, run, full))
drain(bridgeEvent({ type: 'graph.completed', ticketId: 'ENG-412', templateId: 'full' } as any, ctx as any))
ok('sigue habiendo 4 memorias', store.count() === 4, `hay ${store.count()}`)

console.log('\n=== 6. la cola de sync ===')
const pending = store.pendingMutationCount()
ok('hay mutaciones encoladas para pushear', pending > 0, `${pending} pendientes`)

console.log('\n=== 7. eventos que NO deben producir memoria ===')
const noise = [
  { type: 'graph.node_started', ticketId: 'ENG-412', nodeId: 'coder', role: 'coder' },
  { type: 'graph.node_needs_input', ticketId: 'ENG-412', nodeId: 'coder', role: 'coder' },
  { type: 'pr.opened', branch: 'feat/eng-412', repoFullName: 'o/r' },
  { type: 'session.opened', branch: 'feat/eng-412', repoPath: '/x' },
]
const before = store.count()
for (const ev of noise) drain(bridgeEvent(ev as any, ctx as any))
ok('los 4 eventos de ruido no escriben nada', store.count() === before)

console.log('\n=== muestra de una memoria real ===\n')
const sample = rows.find((r) => r.title.includes('Authorization'))!
console.log(`  ${sample.title}\n`)
console.log(sample.content.split('\n').map((l) => '  ' + l).join('\n'))

store.close()
rmSync(dir, { recursive: true, force: true })
console.log(`\n${process.exitCode ? 'HUBO FALLAS' : 'TODO OK'}\n`)
