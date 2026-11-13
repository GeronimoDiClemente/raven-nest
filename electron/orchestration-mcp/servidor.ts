// JSON-RPC a mano sobre stdio, igual que memory-mcp/servidor.ts. `handleRpc` es pura (recibe
// el mensaje y el cliente) para poder probarla sin procesos.
import { createInterface } from 'readline'
import { COORDINATOR_INSTRUCTIONS } from '../orchestration/prompts'
import type { OrchMethod } from '../orchestration/protocol'
import { TOOL_MANIFEST, toolToMethod } from './tools'

export interface ClienteDeOrquestacion {
  call<T = unknown>(method: OrchMethod, params: unknown): Promise<T>
}

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: Record<string, unknown>
}

/** Devuelve la respuesta, o `null` si el mensaje es una notificación. */
export async function handleRpc(msg: JsonRpcRequest, client: ClienteDeOrquestacion): Promise<unknown | null> {
  if (msg.id === undefined) return null
  const id = msg.id
  try {
    switch (msg.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'nest-orchestration', version: '1.0.0' },
            instructions: COORDINATOR_INSTRUCTIONS,
          },
        }
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOL_MANIFEST } }
      case 'tools/call': {
        const params = msg.params as { name: string; arguments?: Record<string, unknown> }
        let method: OrchMethod
        try {
          method = toolToMethod(params.name)
        } catch (err) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: (err as Error).message } }
        }
        try {
          const result = await client.call(method, params.arguments ?? {})
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } }
        } catch (err) {
          // Error del socket (p.ej. invalid_params, límite de workers): vuelve como resultado
          // isError para que el modelo lo vea. Una tool desconocida es -32602 (arriba).
          const text = `Error: ${err instanceof Error ? err.message : String(err)}`
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } }
        }
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${msg.method}` } }
    }
  } catch (err) {
    return { jsonrpc: '2.0', id, error: { code: -32000, message: err instanceof Error ? err.message : String(err) } }
  }
}

export function runMcpServer(client: ClienteDeOrquestacion): void {
  const rl = createInterface({ input: process.stdin, terminal: false })
  rl.on('line', (line) => {
    if (!line.trim()) return
    let msg: JsonRpcRequest
    try { msg = JSON.parse(line) } catch { return }
    void handleRpc(msg, client).then((res) => {
      if (res !== null) process.stdout.write(`${JSON.stringify(res)}\n`)
    })
  })
}
