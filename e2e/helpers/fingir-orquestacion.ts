// Siembra workers de orquestación en la app REAL sin lanzar agentes: un pane coordinador (una
// terminal común), cuatro panes worker —uno por estado del badge— y ramas en el store de
// revisión. Usa el gancho `__nestOrchestrationE2E` que main.ts expone sólo con RAVEN_E2E=1.
// Lo usan el guard de contraste (04) y las capturas de la Task 9.
import { expect } from '@playwright/test'
import type { Harness } from './harness'

export const WORKERS_FINGIDOS = [
  { label: 'api', status: 'working' },
  { label: 'ui', status: 'needs_input' },
  { label: 'docs', status: 'done' },
  { label: 'tests', status: 'exited' },
] as const

export async function fingirOrquestacion(h: Harness): Promise<void> {
  const { app, page } = h
  // El picker de carpeta es nativo: se contesta desde main (igual que 02-graph-in-app).
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, h.repoDir)
  await page.locator('.sidebar-repo').click()
  await expect(page.locator('.sidebar-repo')).toHaveAttribute('title', h.repoDir, { timeout: 10_000 })

  // El coordinador: una terminal común del tab.
  await page.getByRole('button', { name: '+ New Terminal' }).click()
  await page.locator('.ai-card', { hasText: /^Terminal$/ }).click()
  // En Windows "Terminal" abre un paso para elegir shell.
  const shellPorDefecto = page.locator('[title="System default shell"]')
  if (await shellPorDefecto.isVisible({ timeout: 1500 }).catch(() => false)) await shellPorDefecto.click()
  await expect(page.locator('.terminal-pane')).toHaveCount(1, { timeout: 10_000 })
  let coord: string | undefined
  await expect.poll(async () => {
    coord = await app.evaluate(() => {
      const g = globalThis as unknown as { __nestOrchestrationE2E?: { pty: { getAllPids(): Array<{ paneId: string }> } } }
      return g.__nestOrchestrationE2E?.pty.getAllPids()[0]?.paneId
    })
    return coord
  }, { timeout: 15_000 }).toBeTruthy()

  await app.evaluate(({ BrowserWindow }, { coord, repoDir, workers }) => {
    interface Gancho {
      wiring: { state: { addWorker(w: unknown, now: number): { colorIndex: number }; setStatus(id: string, s: string, now: number): void } }
      reviewStore: { upsert(e: unknown): void }
    }
    const g = (globalThis as unknown as { __nestOrchestrationE2E: Gancho }).__nestOrchestrationE2E
    const win = BrowserWindow.getAllWindows()[0]
    const now = Date.now()
    for (const { label, status } of workers) {
      const workerId = `e2e-${label}`
      const paneId = `e2e-pane-${label}`
      const branch = `nest/${label}-e2e`
      const baseBranch = label === 'docs' ? 'main' : 'feat/e2e'
      const rec = g.wiring.state.addWorker(
        { workerId, coordinatorPaneId: coord, paneId, label, branch, worktreePath: repoDir, baseBranch, agent: 'claude' },
        now,
      )
      g.wiring.state.setStatus(workerId, status, now)
      if (status === 'done' || status === 'exited') {
        g.reviewStore.upsert({ workerId, label, colorIndex: rec.colorIndex, branch, worktreePath: repoDir, baseBranch, status, finishedAt: now, repoPath: repoDir })
      }
      win.webContents.send('orchestration:launch-pane', {
        requestId: `e2e-${label}`, coordinatorPaneId: coord, paneId, aiType: 'claude', accountName: '', accountDir: '',
        cmd: '', repoPath: repoDir, label, colorIndex: rec.colorIndex, initialInput: '', workerId,
      })
    }
    // Una rama de un coordinador en detached HEAD: Merge apagado con su motivo.
    g.reviewStore.upsert({
      workerId: 'e2e-old', label: 'refactor', colorIndex: 3, branch: 'nest/refactor-e2e', worktreePath: repoDir,
      baseBranch: 'HEAD', status: 'stopped', finishedAt: now, repoPath: repoDir,
    })
    win.webContents.send('orchestration:changed')
  }, { coord: coord!, repoDir: h.repoDir, workers: WORKERS_FINGIDOS.map((w) => ({ ...w })) })

  await expect(page.locator('[data-testid="worker-badge"]')).toHaveCount(WORKERS_FINGIDOS.length, { timeout: 10_000 })
  await expect(page.locator('[data-testid="worker-review"]')).toBeVisible({ timeout: 10_000 })
}
