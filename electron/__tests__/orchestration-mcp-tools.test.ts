// Shim MCP de orquestación: manifiesto de tools, JSON-RPC a mano y los args que registran el
// shim en claude / codex.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { TOOL_MANIFEST, toolToMethod } from '../orchestration-mcp/tools'
import { handleRpc } from '../orchestration-mcp/servidor'
import { orchestrationLaunchArgs } from '../orchestration/mcp-launch-args'
import { COORDINATOR_INSTRUCTIONS } from '../orchestration/prompts'

describe('orchestrationLaunchArgs', () => {
  let dir: string
  beforeEach(() => { dir = makeTmpDir('raven-orch-args-') })
  afterEach(() => cleanupTmp(dir))

  const paths = (configDir: string) => ({ execPath: '/Apps/Nest.app/MacOS/Nest', shimPath: '/Apps/Nest.app/dist-electron/orchestration-mcp.js', configDir })

  it('orchestrationLaunchArgs claude apunta al json', () => {
    const args = orchestrationLaunchArgs('claude', paths(dir))
    expect(args).toEqual(['--mcp-config', join(dir, 'orchestration-mcp.json')])
    const cfg = JSON.parse(readFileSync(join(dir, 'orchestration-mcp.json'), 'utf8'))
    expect(cfg).toEqual({
      mcpServers: {
        nest_orchestration: {
          command: '/Apps/Nest.app/MacOS/Nest',
          args: ['/Apps/Nest.app/dist-electron/orchestration-mcp.js'],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        },
      },
    })
  })

  it('codex usa tres -c', () => {
    const args = orchestrationLaunchArgs('codex', paths(dir))
    expect(args).toEqual([
      '-c', "mcp_servers.nest_orchestration.command='/Apps/Nest.app/MacOS/Nest'",
      '-c', "mcp_servers.nest_orchestration.args=['/Apps/Nest.app/dist-electron/orchestration-mcp.js']",
      '-c', "mcp_servers.nest_orchestration.env.ELECTRON_RUN_AS_NODE='1'",
    ])
  })

  it('gemini da []', () => {
    expect(orchestrationLaunchArgs('gemini', paths(dir))).toEqual([])
    expect(orchestrationLaunchArgs('opencode', paths(dir))).toEqual([])
  })
})

describe('shim MCP de orquestación', () => {
  const client = { call: vi.fn() }
  beforeEach(() => client.call.mockReset())

  it('tools/list trae las 8 tools', async () => {
    const res = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, client)
    const names = (res as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name)
    expect(names.sort()).toEqual([
      'nest_inbox', 'nest_launch_worker', 'nest_list_workers', 'nest_read_worker',
      'nest_report', 'nest_send_worker', 'nest_stop_worker', 'nest_wait',
    ])
    expect(TOOL_MANIFEST).toHaveLength(8)
    const launch = TOOL_MANIFEST.find((t) => t.name === 'nest_launch_worker')!
    expect(launch.description).toMatch(/end your turn/i)
  })

  it('initialize lleva COORDINATOR_INSTRUCTIONS', async () => {
    const res = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }, client)
    expect((res as { result: { instructions: string } }).result.instructions).toBe(COORDINATOR_INSTRUCTIONS)
  })

  it('tools/call traduce la tool al método del socket y devuelve el resultado', async () => {
    client.call.mockResolvedValue({ workerId: 'w1' })
    const res = await handleRpc(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nest_launch_worker', arguments: { task: 't', label: 'l' } } },
      client
    )
    expect(client.call).toHaveBeenCalledWith('worker.launch', { task: 't', label: 'l' })
    expect(res).toEqual({ jsonrpc: '2.0', id: 7, result: { content: [{ type: 'text', text: '{"workerId":"w1"}' }] } })
    expect(toolToMethod('nest_wait')).toBe('inbox.wait')
    expect(toolToMethod('nest_inbox')).toBe('inbox.read')
    expect(toolToMethod('nest_report')).toBe('worker.report')
  })

  it('un error del socket vuelve como resultado isError, y una notificación no responde', async () => {
    // Un cliente a mano (no vi.fn): el runner marca como fallo un mock que rechaza.
    const roto = { call: () => new Promise<never>((_, reject) => setTimeout(() => reject(new Error('invalid_params')), 0)) }
    const res = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nest_inbox', arguments: {} } }, roto)
    expect((res as { result: { isError: boolean } }).result.isError).toBe(true)
    expect(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, client)).toBeNull()
  })
})
