// El paquete portátil con Nest ABIERTO: le delega todo, y lo que guarda aparece en la app.
//
// Es el caso de un editor que lanza `npx nest-memory mcp` por su cuenta —Cursor, VS Code,
// Codex— en una máquina con Nest abierto. Ese proceso NO hereda `NEST_MEMORY_SOCKET` ni
// `NEST_MEMORY_TOKEN` (Nest sólo los pone en sus terminales), así que tiene que encontrar a
// Nest por el disco y confirmar con un `ping` que está vivo. Hasta el 2026-10-02 la sonda era
// `() => false`: abría la base por al lado, sin el daemon que sincroniza en vivo, y lo que
// guardaba no aparecía en la pantalla de Memories hasta reabrirla.
//
// Necesita el paquete compilado: `packages/nest-memory/dist` (se arma en el beforeAll).
import { test, expect } from '@playwright/test'
import { spawn, execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { launchHarness, teardown } from './helpers/harness'

const REPO = join(__dirname, '..')
const PAQUETE = join(REPO, 'packages', 'nest-memory')
const CLI = join(PAQUETE, 'dist', 'cli-del-paquete.js')

test.beforeAll(() => {
  execFileSync(process.execPath, [join(REPO, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(PAQUETE, 'tsconfig.json')], { stdio: 'pipe' })
})

/** Un MCP del paquete como lo lanzaría un editor: sin ninguna variable de Nest. */
function mcpDelPaquete(homeDir: string) {
  const env: Record<string, string | undefined> = { ...process.env, RAVEN_HOME: homeDir, HOME: homeDir, USERPROFILE: homeDir, NODE_NO_WARNINGS: '1' }
  delete env.NEST_MEMORY_SOCKET
  delete env.NEST_MEMORY_TOKEN
  const p = spawn(process.execPath, [CLI, 'mcp'], { env, cwd: homeDir })
  let buf = ''
  let id = 0
  let stderr = ''
  const pendientes = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>()
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
  const rpc = (method: string, params: unknown) => new Promise<{ result?: unknown; error?: { message: string } }>((resolve) => {
    const n = ++id
    pendientes.set(n, resolve)
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n')
  })
  return { rpc, cerrar: () => p.stdin.end(), stderr: () => stderr }
}

async function abrirMemories(page: import('@playwright/test').Page) {
  const toggle = page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ })
  await expect(toggle).toBeVisible({ timeout: 15_000 })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await page.getByTitle(/^Memories/).first().click()
  await expect(page.locator('.memories-workspace')).toBeVisible({ timeout: 15_000 })
}

test('con Nest abierto, el MCP del paquete le delega y lo guardado aparece en la app', async () => {
  test.skip(!existsSync(join(REPO, 'dist-electron', 'main.js')), 'hace falta `npm run build`')
  const h = await launchHarness({ withRepo: false })
  try {
    await abrirMemories(h.page)
    await expect(h.page.getByText('No memories yet')).toBeVisible({ timeout: 15_000 })

    const mcp = mcpDelPaquete(h.homeDir)
    try {
      const init = await mcp.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } })
      expect(init.error, mcp.stderr()).toBeUndefined()
      const r = await mcp.rpc('tools/call', {
        name: 'memory_save',
        arguments: { title: 'Guardada desde un editor externo', content: 'por el paquete, con Nest abierto', type: 'decision' },
      })
      expect(r.error, mcp.stderr()).toBeUndefined()
    } finally {
      mcp.cerrar()
    }

    // La prueba de que delegó: la escribió el DAEMON de la app, que avisa a la pantalla al
    // instante. Si el paquete hubiera abierto la base por al lado, la app no se enteraría.
    await expect(h.page.getByText('Guardada desde un editor externo').first()).toBeVisible({ timeout: 15_000 })
    // Y no creó una base propia: la memoria vive en la de Nest, no en `~/.nest-memory`.
    expect(existsSync(join(h.homeDir, '.nest-memory', 'memory.db'))).toBe(false)
  } finally {
    await teardown(h)
  }
})
