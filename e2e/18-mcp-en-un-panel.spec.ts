// El MCP de Nest (`dist-electron/memory-mcp.js`) GUARDA con la app abierta.
//
// Es el binario que corren las sesiones de Claude: Nest lo lanza con el binario de Electron y
// `ELECTRON_RUN_AS_NODE=1`. Dos casos:
//
//   1. Adentro de un pane de Nest: el proceso hereda `NEST_MEMORY_SOCKET` + `NEST_MEMORY_TOKEN`
//      (los inyecta `pty-manager.ts`). Se arman con la misma fórmula que usa `main.ts` —el
//      `pipe-auth.json` de la app y `daemonSocketPath`—, que es exactamente lo que recibe un pane.
//   2. Fuera de un pane (Claude desktop, VS Code, Cursor) con Nest abierto: SIN esas variables.
//      Hasta el 2026-11-02 este caso caía en sólo lectura y `memory_save` fallaba con
//      "Nest is not running"; ahora el MCP encuentra a Nest por el disco, como el paquete.
//
// En los dos, lo guardado tiene que volver por `memory_search`, `memory_context` y `memory_get`,
// y estar en la base de la app. No usa red ni servidor de sync.
//
// Necesita `npm run build` (corre contra `dist-electron/`) y el binding nativo de Electron.
import { test, expect } from '@playwright/test'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { launchHarness, teardown } from './helpers/harness'
import { leerLocalAuthMaterial } from '../electron/memory-local-auth'
import { daemonSocketPath } from '../electron/memory-protocol'
import { readActivePointer } from '../electron/memory-active-store'
import { buscarNestVivo } from '../electron/nest-vivo-del-paquete'

const REPO = join(__dirname, '..')
const MCP = join(REPO, 'dist-electron', 'memory-mcp.js')
const isWin = process.platform === 'win32'
// El paquete `electron` resuelve, desde Node, a la ruta de su binario.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ELECTRON_BIN = require('electron') as unknown as string

type Respuesta = { result?: { content?: Array<{ text: string }> } & Record<string, unknown>; error?: { message: string } }

/** Lanza el MCP de Nest como lo lanza una sesión: binario de Electron en modo Node. */
function mcpDeNest(homeDir: string, cwd: string, extra: Record<string, string>) {
  const env: Record<string, string | undefined> = {
    ...process.env, RAVEN_HOME: homeDir, HOME: homeDir, USERPROFILE: homeDir, ELECTRON_RUN_AS_NODE: '1',
  }
  delete env.NEST_MEMORY_SOCKET
  delete env.NEST_MEMORY_TOKEN
  Object.assign(env, extra)
  const p = spawn(ELECTRON_BIN, [MCP], { env, cwd })
  let buf = ''
  let id = 0
  let stderr = ''
  const pendientes = new Map<number, (m: Respuesta) => void>()
  p.stdout.on('data', (d) => {
    buf += d
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const linea = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!linea) continue
      const m = JSON.parse(linea)
      pendientes.get(m.id)?.(m)
    }
  })
  p.stderr.on('data', (d) => { stderr += d })
  const rpc = (method: string, params: unknown) => new Promise<Respuesta>((resolve) => {
    const n = ++id
    pendientes.set(n, resolve)
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n')
  })
  /** `tools/call` y el JSON que devuelve la herramienta. */
  const herramienta = async (name: string, args: Record<string, unknown>) => {
    const r = await rpc('tools/call', { name, arguments: args })
    expect(r.error, `${name}: ${r.error?.message}\n${stderr}`).toBeUndefined()
    return JSON.parse(r.result!.content![0].text)
  }
  return { rpc, herramienta, cerrar: () => { p.stdin.end(); p.kill() }, stderr: () => stderr }
}

async function esperarDaemon(homeDir: string): Promise<void> {
  await expect.poll(async () => (await buscarNestVivo({}, homeDir, isWin)) !== null, { timeout: 20_000 }).toBe(true)
}

/** Guarda y lee de vuelta por las tres lecturas, y mira la base de la app. */
async function guardarYLeer(mcp: ReturnType<typeof mcpDeNest>, homeDir: string, titulo: string) {
  const init = await mcp.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } })
  expect(init.error, mcp.stderr()).toBeUndefined()

  const guardada = await mcp.herramienta('memory_save', {
    title: titulo, content: 'guardada por el MCP de Nest con la app abierta', type: 'decision',
  })
  expect(guardada.syncId, JSON.stringify(guardada)).toEqual(expect.any(String))
  const syncId: string = guardada.syncId

  const busqueda = await mcp.herramienta('memory_search', { query: titulo.split(' ')[0] })
  expect(busqueda.items.map((i: { syncId: string }) => i.syncId)).toContain(syncId)
  // Sin la marca `offline`: la respuesta es del daemon, no de una foto del disco.
  expect(busqueda.offline).toBeUndefined()

  const contexto = await mcp.herramienta('memory_context', {})
  expect(contexto.items.map((i: { syncId: string }) => i.syncId)).toContain(syncId)

  const una = await mcp.herramienta('memory_get', { sync_id: syncId })
  expect(una.item?.title).toBe(titulo)

  // Y está en la base de la app (la del puntero que escribe Nest), no en otra.
  const storePath = readActivePointer(homeDir)?.storePath
  expect(storePath).toBeTruthy()
  const db = new DatabaseSync(storePath!, { readOnly: true })
  try {
    const fila = db.prepare('SELECT title FROM observations WHERE sync_id = ?').get(syncId) as { title: string } | undefined
    expect(fila?.title).toBe(titulo)
  } finally {
    db.close()
  }
}

test.beforeAll(() => {
  test.skip(!existsSync(MCP), 'hace falta `npm run build`')
})

test('adentro de un pane de Nest (con las variables), el MCP guarda y lee', async () => {
  const h = await launchHarness({ withRepo: false })
  try {
    await esperarDaemon(h.homeDir)
    const auth = leerLocalAuthMaterial(h.homeDir)
    expect(auth).not.toBeNull()
    const mcp = mcpDeNest(h.homeDir, h.homeDir, {
      NEST_MEMORY_SOCKET: daemonSocketPath(h.homeDir, isWin, auth!.pipeId),
      NEST_MEMORY_TOKEN: auth!.token,
    })
    try {
      await guardarYLeer(mcp, h.homeDir, 'Panelazo guardado desde un pane de Nest')
    } finally {
      mcp.cerrar()
    }
  } finally {
    await teardown(h)
  }
})

test('fuera de un pane (sin las variables), con Nest abierto, el MCP lo encuentra por el disco y guarda', async () => {
  const h = await launchHarness({ withRepo: false })
  try {
    await esperarDaemon(h.homeDir)
    const mcp = mcpDeNest(h.homeDir, h.homeDir, {})
    try {
      await guardarYLeer(mcp, h.homeDir, 'Discovery guardada desde un editor externo')
      expect(mcp.stderr()).not.toMatch(/read-only mode/)
    } finally {
      mcp.cerrar()
    }
  } finally {
    await teardown(h)
  }
})
