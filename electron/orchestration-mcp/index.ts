#!/usr/bin/env node
// nest-orchestration — shim MCP por stdio. Lo lanza el CLI del agente (claude/codex) con el
// Electron de Nest en modo Node (ELECTRON_RUN_AS_NODE=1). No guarda estado: cada tool es un
// request al socket de orquestación de main, autenticado con el token del pane.
import { OrchestrationClient } from './client'
import { runMcpServer } from './servidor'

const socketPath = process.env.NEST_ORCH_SOCKET
const token = process.env.NEST_ORCH_TOKEN
if (!socketPath || !token) {
  console.error('[nest-orchestration] NEST_ORCH_SOCKET / NEST_ORCH_TOKEN not set — this pane is not an orchestration pane')
  process.exit(1)
}

runMcpServer(new OrchestrationClient(socketPath, token))
