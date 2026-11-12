/**
 * Manifiesto de las tools del shim MCP de orquestación. Todo en inglés a propósito: es lo
 * que lee el modelo.
 *
 * Descripciones adaptadas de T3 Code (MIT, Copyright (c) 2026 T3 Tools Inc.):
 * apps/server/src/mcp/toolkits/orchestrator/tools.ts. Licencia completa en
 * THIRD_PARTY_NOTICES.md.
 */
import type { OrchMethod } from '../orchestration/protocol'

const STR = { type: 'string' } as const

export const TOOL_MANIFEST = [
  {
    name: 'nest_launch_worker',
    description:
      'Start one worker agent in its own pane, branch and worktree with only `task`: it gets no ' +
      'history of this conversation, so make the task stand alone. Keep the returned `workerId`. ' +
      'No secrets in `task`. After launching, end your turn: Nest wakes you when a worker reports.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { ...STR, description: 'Self-contained brief: goal, files or areas involved, what "done" means.' },
        label: { ...STR, description: 'Short name for the worker (shown on its pane).' },
        agent: { type: 'string', enum: ['claude', 'codex'], description: 'Only if the user asked for a specific agent.' },
      },
      required: ['task', 'label'],
    },
  },
  {
    name: 'nest_inbox',
    description:
      'Read the messages your workers have reported (done, question, blocked). Reading marks them ' +
      'delivered. Call it when Nest types a pointer into this terminal; do not poll it.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nest_wait',
    description:
      'Block until a worker message arrives or the timeout passes. Rare: only when you cannot ' +
      'continue without the next message. Prefer ending your turn. On timeout with nothing new, ' +
      'end your turn instead of calling it again.',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutMs: { type: 'number', description: 'Default 60000, max 240000. Keep it short.' },
      },
    },
  },
  {
    name: 'nest_list_workers',
    description: 'List the workers you started and their state. Not for polling: a report wakes you.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nest_read_worker',
    description:
      'Read one worker by `workerId`: state, branch, commits and diffstat. Keep reads small; the ' +
      'final result arrives as its report.',
    inputSchema: {
      type: 'object',
      properties: { workerId: { ...STR, description: 'The id returned by nest_launch_worker.' } },
      required: ['workerId'],
    },
  },
  {
    name: 'nest_send_worker',
    description:
      'Send a message to one worker by `workerId`, e.g. the answer to its question. It is typed ' +
      'into the worker pane. No secrets.',
    inputSchema: {
      type: 'object',
      properties: {
        workerId: { ...STR, description: 'The id returned by nest_launch_worker.' },
        text: { ...STR, description: 'The message to deliver.' },
      },
      required: ['workerId', 'text'],
    },
  },
  {
    name: 'nest_stop_worker',
    description:
      'Stop one worker by `workerId`, or all of yours if omitted. A finished worker keeps its ' +
      'branch and report. Do not stop a worker only because it is slow.',
    inputSchema: {
      type: 'object',
      properties: { workerId: { ...STR, description: 'Omit to stop every worker you started.' } },
    },
  },
  {
    name: 'nest_report',
    description:
      'Workers only: report to the coordinator that started you. `done` is final; `question` and ' +
      '`blocked` need its answer. Say what you did, or what you need.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['done', 'question', 'blocked'] },
        text: { ...STR, description: 'The report. For done: what changed and what to check.' },
      },
      required: ['kind', 'text'],
    },
  },
] as const

const TOOL_TO_METHOD: Record<string, OrchMethod> = {
  nest_launch_worker: 'worker.launch',
  nest_inbox: 'inbox.read',
  nest_wait: 'inbox.wait',
  nest_list_workers: 'worker.list',
  nest_read_worker: 'worker.read',
  nest_send_worker: 'worker.send',
  nest_stop_worker: 'worker.stop',
  nest_report: 'worker.report',
}

/** Lanza si la tool no existe (el caller lo devuelve como error de tool). */
export function toolToMethod(name: string): OrchMethod {
  const method = TOOL_TO_METHOD[name]
  if (!method) throw new Error(`Unknown tool: ${name}`)
  return method
}
