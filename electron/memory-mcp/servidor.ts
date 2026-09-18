// El servidor MCP en sí: el bucle de JSON-RPC sobre stdin/stdout y el despacho de las
// herramientas.
//
// Vive aparte de `index.ts` porque lo usan DOS arranques distintos: el shim que Nest lanza
// adentro de Electron, y `npx nest-memory mcp` del paquete portátil. Lo único que cambia
// entre los dos es de dónde sale el cliente —el daemon por socket, o la lectura directa del
// disco— y por eso `runMcpServer` lo recibe en vez de resolverlo.
//
// No se extrajo importando `index.ts`: ese archivo corre `main()` al cargarse, así que
// importarlo desde el paquete habría arrancado el shim de Electron de rebote.
import { createInterface } from 'readline'
import { MCP_INSTRUCTIONS, TOOL_MANIFEST } from './tools'
import type { MemoryMethod, ObservationType } from '../memory-protocol'

function env(name: string): string | undefined {
  return process.env[name]
}

/** Lo mínimo que el servidor necesita de quien responde las consultas. */
export interface ClienteDeMemoria {
  call<T = unknown>(method: MemoryMethod, params: unknown): Promise<T>
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: Record<string, unknown>
}

export function writeMessage(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`)
}

export async function runMcpServer(client: ClienteDeMemoria, cwd: string): Promise<void> {

  const rl = createInterface({ input: process.stdin, terminal: false })
  rl.on('line', (line) => {
    if (!line.trim()) return
    void handleLine(line)
  })

  async function handleLine(line: string): Promise<void> {
    let msg: JsonRpcRequest
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.id === undefined) return // notification — nothing to reply to

    try {
      switch (msg.method) {
        case 'initialize':
          writeMessage({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'nest-memory', version: '1.0.0' },
              // M27: server-wide behavioral protocol — see tools.ts's MCP_INSTRUCTIONS
              // for why this channel (not just per-tool descriptions) is the primary
              // lever. Not every MCP client surfaces `instructions` the same way the spec
              // recommends (folding it into the system prompt), which is why the search
              // tool's own description in tools.ts also restates the "don't invent" rule
              // as a redundant, cheaper-to-drop backup.
              instructions: MCP_INSTRUCTIONS,
            },
          })
          return

        case 'tools/list':
          writeMessage({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOL_MANIFEST } })
          return

        case 'tools/call': {
          const params = msg.params as { name: string; arguments?: Record<string, unknown> }
          const args = params.arguments ?? {}
          const text = await callTool(client, cwd, params.name, args)
          writeMessage({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }] } })
          return
        }

        case 'ping':
          writeMessage({ jsonrpc: '2.0', id: msg.id, result: {} })
          return

        default:
          writeMessage({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Unknown method: ${msg.method}` } })
      }
    } catch (err) {
      writeMessage({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
      })
    }
  }
}

export async function callTool(client: ClienteDeMemoria, cwd: string, name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'memory_save': {
      const result = await client.call('memory.save', {
        cwd,
        title: String(args.title ?? ''),
        content: String(args.content ?? ''),
        type: (args.type as ObservationType) ?? 'discovery',
        topicKey: args.topic_key as string | undefined,
        tags: args.tags as string[] | undefined,
        source: 'mcp',
        originAi: env('NEST_MEMORY_AI'),
        originAccount: env('NEST_MEMORY_ACCOUNT'),
      })
      return JSON.stringify(result)
    }
    case 'memory_search': {
      const result = await client.call('memory.search', {
        cwd,
        query: String(args.query ?? ''),
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      })
      return JSON.stringify(result)
    }
    case 'memory_context': {
      const result = await client.call('memory.context', {
        cwd,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      })
      return JSON.stringify(result)
    }
    case 'memory_promote': {
      const result = await client.call('memory.promote', {
        cwd,
        syncId: String(args.sync_id ?? ''),
        reason: args.reason as string | undefined,
      })
      return JSON.stringify(result)
    }
    case 'memory_get': {
      const result = await client.call('memory.get', {
        cwd,
        syncId: String(args.sync_id ?? ''),
      })
      return JSON.stringify(result)
    }
    case 'memory_update': {
      const result = await client.call('memory.update', {
        cwd,
        syncId: String(args.sync_id ?? ''),
        title: args.title as string | undefined,
        content: args.content as string | undefined,
        tags: args.tags as string[] | undefined,
      })
      return JSON.stringify(result)
    }
    case 'memory_graph': {
      const result = await client.call<{ text: string }>('memory.graph', {
        cwd,
        tag: (args.tag as string | undefined) ?? null,
        projectKey: (args.project_key as string | undefined) ?? null,
        includeSimilar: Boolean(args.include_similar),
      })
      // Texto plano, no JSON: lo que devuelve ya ES el dibujo. Envolverlo en JSON obligaria
      // al agente a desescaparlo antes de imprimirlo, y ahi es donde se rompen los saltos de
      // linea que hacen al arbol.
      return result.text
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ── Hook mode ─────────────────────────────────────────────────────────────
