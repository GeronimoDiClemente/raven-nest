// Spec 2b-3: el estado de la cuenta que Settings › Account dibuja, FINGIDO desde el proceso
// main (sin servicio de sync en el e2e). Mismo patrón que `fingirFreeConUnProyecto` en
// e2e/03: se reemplazan los handlers de IPC; lo demás de la app corre de verdad.
// Las máquinas se fingen ANTES que el status: la sección las pide en cuanto ve el sync
// conectado, y con el handler real esa primera lectura da error.
//
// `app.evaluate` serializa la función: lo que no vaya por el argumento no llega a main.
import type { Harness } from './harness'

/**
 * Conectado con 2 proyectos en la nube y un tope de 1 (bajó de plan): `overLimit` y el que
 * sigue subiendo es `k-nest`. El doctor suma un repo local only (`api`).
 */
export async function fingirCloudSobreElTope(h: Harness): Promise<void> {
  await h.app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('memory:status')
    ipcMain.handle('memory:status', () => ({
      connected: true, deviceId: 'e2e-device', itemCount: 12, pendingCount: 0, daemonStatus: 'idle',
      quota: { used_bytes: 1024 * 1024, max_bytes: 100 * 1024 * 1024 },
      limits: { max_projects: 1 },
      cloudProjects: [{ projectKey: 'k-nest', name: 'raven-nest' }, { projectKey: 'k-web', name: 'web' }],
      keptProjectKey: 'k-nest',
      overLimit: true,
    }))
    ipcMain.removeHandler('memory:doctor')
    ipcMain.handle('memory:doctor', () => ({
      ok: true, blockedTotal: 5,
      groups: [{ reason: 'project_limit_reached', count: 5, oldestAt: 1, reversible: true }],
      localOnlyProjects: [{ projectKey: 'k-api', name: 'api', count: 5 }],
    }))
  })
  await avisarStatus(h)
}

/**
 * El `useMemory` de SettingsPanel monta con la app, no al abrir Settings: ya leyó el status
 * real. El evento `memory:status` (el mismo que manda `memory:refreshStatus`) lo hace releer.
 */
async function avisarStatus(h: Harness): Promise<void> {
  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('memory:status', 'idle')
  })
}

/** Tres máquinas de la cuenta, la primera es ésta. `revokeDevice` contesta ok sin red. */
export async function fingirMaquinas(h: Harness): Promise<void> {
  const ahora = Date.now()
  const maquinas = [
    { id: 'e2e-device', name: 'Studio', platform: 'darwin', lastSeenAt: ahora, current: true },
    { id: 'dev-macbook', name: 'MacBook', platform: 'darwin', lastSeenAt: ahora - 3 * 24 * 60 * 60_000, current: false },
    { id: 'dev-win', name: 'Desktop', platform: 'win32', lastSeenAt: null, current: false },
  ]
  await h.app.evaluate(({ ipcMain }, lista) => {
    ipcMain.removeHandler('memory:devices')
    ipcMain.handle('memory:devices', () => ({ ok: true, devices: lista }))
    ipcMain.removeHandler('memory:revokeDevice')
    ipcMain.handle('memory:revokeDevice', () => ({ ok: true }))
  }, maquinas)
}
