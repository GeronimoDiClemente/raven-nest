// LIVE smoke del launch HEADLESS a través de la PTY real — la prueba de que los
// blockers A y B del handoff (2026-08-22) están efectivamente muertos.
//
// `graph-eval-loop.live.test.ts` NO cubre esto: ese spawnea `claude` con
// spawnSync directo, así que nunca pasa por `launchCommand` ni por la PTY. Los
// dos blockers viven justo ahí:
//   A — la pty no cerraba (shell interactivo sobreviviendo a la CLI) → ningún
//       nodo llegaba nunca a 'done' ni tenía exit code.
//   B — la CLI arrancaba interactiva y sandboxeada → pedía permisos y nunca
//       escribía su artifact sola.
// Este test ejercita el camino completo: composeNodeInput → archivo .prompt →
// launchCommand → PtyManager.create (zsh -l -i / powershell) → CLI headless →
// evento 'exit' con el código de la CLI.
//
// Gated con GRAPH_PTY_SMOKE=1 (gasta tokens, necesita `claude` autenticado en
// PATH y es no-determinístico). Correr:
//   GRAPH_PTY_SMOKE=1 npx vitest run electron/__tests__/graph-pty-launch.live.test.ts
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { PtyManager } from '../pty-manager'
import { launchCommand } from '../integrations/graph-tick'
import { composeNodeInput, artifactPath } from '../integrations/graph-handoff'
import type { GraphNode } from '../integrations/graph-template'

const LIVE = process.env.GRAPH_PTY_SMOKE === '1'
const isWin = process.platform === 'win32'

/** Espera el evento 'exit' de un pane y devuelve su código. */
function waitExit(pm: PtyManager, paneId: string, ms: number): Promise<number> {
  return new Promise((resolve, reject) => {
    pm.on('exit', (id: string, code: number) => { if (id === paneId) resolve(code) })
    setTimeout(() => reject(new Error(`timeout ${ms}ms — la pty nunca cerró`)), ms)
  })
}

describe.skipIf(!LIVE)('graph headless launch LIVE smoke (pty real)', () => {
  it('propaga el exit code de la CLI a través de la forma `exec …`', async () => {
    // Sin LLM: aísla el mecanismo (A) del agente. Si esto falla, el camino
    // exit-code→failed de planTick no puede funcionar en la app.
    const pm = new PtyManager()
    for (const want of [0, 3, 42]) {
      const paneId = `exit:${want}`
      const cmd = isWin ? `& cmd /c exit ${want}; exit $LASTEXITCODE` : `exec sh -c 'exit ${want}'`
      const exited = waitExit(pm, paneId, 30_000)
      const res = await pm.create(paneId, cmd, '', tmpdir())
      expect(res.ok).toBe(true)
      expect(await exited).toBe(want)
      expect(pm.exists(paneId)).toBe(false)
    }
  }, 120_000)

  it('un nodo claude corre desatendido, escribe su artifact y cierra la pty', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'graph-pty-smoke-'))
    const sh = (c: string) => spawnSync('/bin/sh', ['-c', c], { cwd: wt, encoding: 'utf8' })
    sh('git init -q && git config user.email s@s.s && git config user.name s')
    writeFileSync(join(wt, 'README.md'), '# smoke\n')
    sh('git add -A && git commit -qm init')

    const node = {
      id: 'coder', role: 'coder', kind: 'agent', agent: 'claude', dependsOn: [],
      instructions: 'Create a file `add.js` in the current working directory that exports an add function: `module.exports = { add: (a, b) => a + b }`. Keep it minimal — just that one file.',
    } as GraphNode
    const input = composeNodeInput(node, [], false)

    // Exactamente lo que hace graphOrchestratorTick antes de spawnear.
    const paneId = 'smoke:coder'
    const promptPath = join(wt, '.nest', 'graph', 'coder.prompt')
    mkdirSync(dirname(promptPath), { recursive: true })
    writeFileSync(promptPath, input, 'utf8')
    const cmd = launchCommand({ agent: 'claude' }, { promptPath, isWin })
    expect(cmd).not.toBe('')
    process.stdout.write(`\n── cmd: ${cmd}\n── worktree: ${wt}\n`)

    const pm = new PtyManager()
    const exited = waitExit(pm, paneId, 300_000)
    const res = await pm.create(paneId, cmd, '', wt)
    expect(res.ok).toBe(true)

    const code = await exited
    process.stdout.write(`── exit ${code} · artifact ${existsSync(join(wt, artifactPath(node))) ? 'escrito' : 'AUSENTE'}\n`)

    // A: la pty cerró → deriveAgentState puede llegar a 'done'.
    expect(pm.exists(paneId)).toBe(false)
    expect(code).toBe(0)
    // B: corrió sin pedir permisos → escribió el artifact y el archivo pedido.
    expect(existsSync(join(wt, artifactPath(node)))).toBe(true)
    expect(existsSync(join(wt, 'add.js'))).toBe(true)
  }, 360_000)
})
