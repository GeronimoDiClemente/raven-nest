import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import CloudMemoryCard from '../../components/CloudMemoryCard'

// CloudMemoryCard talks to supabase directly (via useMemory/useUserRepos/useProfile) —
// mocked the same way SettingsPanel.test.tsx does it, resolving no user so those effects
// bail out early without hitting the network.
const supabaseMock = vi.hoisted(() => {
  // useUserRepos encadena from().select().order() y lo await-ea. Con `from` devolviendo
  // undefined la promesa rechazaba y vitest contaba un unhandled error por test: no
  // rompian, pero un rechazo suelto puede enmascarar un fallo real.
  const query = {
    select: vi.fn(() => query),
    order: vi.fn(() => Promise.resolve({ data: [], error: null })),
  }
  return {
    functions: { invoke: vi.fn() },
    auth: { getUser: vi.fn(), signOut: vi.fn(), getSession: vi.fn() },
    from: vi.fn(() => query),
  }
})
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

// Fix round 1 review, Finding 1 (Important): the token <input> used to require
// PLAN_LIMITS[plan].memoryCloud even in the `error` state. `error` is reachable
// while already connected (refresh() maps daemonStatus === 'error' to it), and
// useProfile() re-fetches plan on every window focus — so a Pro user downgraded
// to free while their daemon was erroring saw a permanently-disabled Retry
// button with no input to type a new token into, and no Disconnect escape
// hatch either. The fix widens the input's render condition so `error` always
// shows it, regardless of plan.
function mockMemoryBridge(status: {
  connected: boolean
  deviceId: string | null
  itemCount: number
  pendingCount: number
  daemonStatus: 'idle' | 'syncing' | 'paused' | 'error' | 'plan_required'
  // El código del último cambio de estado del daemon ('offline', 'lock_held', ...). Es lo
  // que deja distinguir DOS motivos distintos para el mismo 'paused'.
  daemonStatusDetail?: string
  quota?: { used_bytes: number; max_bytes: number }
  // Spec 2b-1 §4.4: el tope del plan y el roster de la nube.
  limits?: { max_projects: number }
  cloudProjects?: Array<{ projectKey: string; name: string }>
  // Spec 2b-2 §4.7: el proyecto elegido y si la nube pasa el tope.
  keptProjectKey?: string | null
  overLimit?: boolean
},
doctor: { ok: boolean; blockedTotal: number; groups: unknown[]; localOnlyProjects?: Array<{ projectKey: string; name: string; count: number }> } =
  { ok: true, blockedTotal: 0, groups: [], localOnlyProjects: [] }) {
  const memory = {
    ensureDeviceId: vi.fn().mockResolvedValue('dev-1'),
    connect: vi.fn().mockResolvedValue({ ok: true }),
    disconnect: vi.fn().mockResolvedValue({ ok: true }),
    status: vi.fn().mockResolvedValue(status),
    hubStats: vi.fn().mockResolvedValue({ itemCount: 0, projectCount: 0 }),
    registerDevice: vi.fn().mockResolvedValue({ ok: true, deviceId: 'dev-1', token: 'nmk_del_servicio' }),
    onStatus: vi.fn(),
    removeStatusListener: vi.fn(),
    doctor: vi.fn().mockResolvedValue(doctor),
    keepProject: vi.fn().mockResolvedValue({ ok: true }),
  }
  ;(window as unknown as { memory: typeof memory }).memory = memory
  return memory
}

function mockLocalPaths() {
  ;(window as unknown as { localPaths: { getAll: () => Promise<Record<string, string>> } })
    .localPaths = { getAll: async () => ({}) }
}

/** Abre el AlertDialog de confirmación clickeando "Turn off", y devuelve su región. */
async function abrirDialogoDeTurnOff() {
  fireEvent.click(screen.getByText('Turn off'))
  const dialog = await screen.findByRole('alertdialog')
  return within(dialog)
}

// smoke/memory-bridge task: a 403 plan_required is not an auth failure — the card must
// show an Upgrade path, not "Couldn't sync" / a Retry-a-token flow, and that Upgrade
// button must be the SAME affordance the free-plan disconnected branch already has
// (setMemoryUpgradeOpen), not a second one.
describe('CloudMemoryCard — plan_required reuses the existing Upgrade affordance', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    mockLocalPaths()
  })

  afterEach(() => {
    delete (window as unknown as { memory?: unknown }).memory
  })

  it('shows an Upgrade button (not Retry, not the token input) and opens the same UpgradeModal the free-plan path uses', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 5, pendingCount: 2, daemonStatus: 'plan_required' })
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByText(/doesn't include cloud sync/)).toBeInTheDocument())
    expect(screen.queryByPlaceholderText('Paste your sync token')).not.toBeInTheDocument()
    expect(screen.queryByText('Retry')).not.toBeInTheDocument()

    const upgradeButton = screen.getByText('Upgrade')
    fireEvent.click(upgradeButton)

    // UpgradeModal renders plan tiers, e.g. "Free" — proves the SAME modal component
    // mounts here as it does off the free-plan disconnected branch's Upgrade button.
    await waitFor(() => expect(screen.getByText('Free')).toBeInTheDocument())
  })
})

// plan-required-disconnect task: `plan_required` and `error` both describe a
// connection that's still real (valid token, registered device) — the server is
// just refusing pushes (plan) or the daemon is failing (error). Before this fix,
// `memory.disconnect(deleteCloudOnDisconnect)` — the only path to the delete-
// cloud-data call (§6.6/§7.5 "right to delete") — was unreachable from either
// state: plan_required only offered Upgrade, error only offered Retry.
//
// Task 3: "Disconnect" se rebautizó "Turn off" y ya no dispara el disconnect
// directo — abre un AlertDialog de confirmación con el checkbox de borrado adentro.
describe('CloudMemoryCard — Turn off is reachable from plan_required and error (right to delete)', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    mockLocalPaths()
  })

  afterEach(() => {
    delete (window as unknown as { memory?: unknown }).memory
  })

  it('plan_required shows a Turn off button (alongside Upgrade) that calls memory.disconnect', async () => {
    const memory = mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 5, pendingCount: 2, daemonStatus: 'plan_required' })
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByText(/doesn't include cloud sync/)).toBeInTheDocument())
    expect(screen.getByText('Upgrade')).toBeInTheDocument()

    const dialog = await abrirDialogoDeTurnOff()
    fireEvent.click(dialog.getByRole('button', { name: 'Turn off' }))
    await waitFor(() => expect(memory.disconnect).toHaveBeenCalledWith({ deleteCloud: false }))
  })

  it('plan_required also exposes the delete-cloud-data checkbox inside the confirmation dialog', async () => {
    const memory = mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 5, pendingCount: 2, daemonStatus: 'plan_required' })
    render(<CloudMemoryCard />)
    await waitFor(() => expect(screen.getByText(/doesn't include cloud sync/)).toBeInTheDocument())

    const dialog = await abrirDialogoDeTurnOff()
    fireEvent.click(dialog.getByLabelText(/Also delete my cloud memory/))
    fireEvent.click(dialog.getByRole('button', { name: 'Turn off' }))
    await waitFor(() => expect(memory.disconnect).toHaveBeenCalledWith({ deleteCloud: true }))
  })

  it('error shows a Turn off button (alongside Retry) that calls memory.disconnect', async () => {
    const memory = mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 0, pendingCount: 0, daemonStatus: 'error' })
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByText(/Couldn't sync/)).toBeInTheDocument())
    expect(screen.getByText('Retry')).toBeInTheDocument()

    const dialog = await abrirDialogoDeTurnOff()
    fireEvent.click(dialog.getByRole('button', { name: 'Turn off' }))
    await waitFor(() => expect(memory.disconnect).toHaveBeenCalledWith({ deleteCloud: false }))
  })
})

// Guards against the exact failure mode the ternary-chain warning calls out: adding
// a branch (or reordering one) can silently steal another state's rendering. These
// assert every OTHER memory-card state still renders precisely the control it did
// before plan_required/error were touched — one button, no stray Turn off/Upgrade/
// Retry leaking in from a neighbouring branch.
describe('CloudMemoryCard — neighbouring memory-card states are unaffected by the turn-off fix', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    mockLocalPaths()
  })

  afterEach(() => {
    delete (window as unknown as { memory?: unknown }).memory
  })

  it('connected still shows exactly one Turn off button', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 3, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)

    // getByText itself throws on more than one match — this proves there's exactly
    // one Turn off control, not a stray second one from the plan_required/error fix.
    await waitFor(() => expect(screen.getByText('Turn off')).toBeInTheDocument())
    expect(screen.queryByText('Upgrade')).not.toBeInTheDocument()
    expect(screen.queryByText('Retry')).not.toBeInTheDocument()
  })

  it('paused still shows exactly one Turn off button', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 3, pendingCount: 1, daemonStatus: 'paused' })
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByText('Turn off')).toBeInTheDocument())
    expect(screen.queryByText('Upgrade')).not.toBeInTheDocument()
    expect(screen.queryByText('Retry')).not.toBeInTheDocument()
  })

  // `paused` dejó de tener un solo significado cuando entró el candado de sincronización
  // (§6.3): ahora es "sin red" O "otra instancia tiene el candado". El texto estaba
  // hardcodeado en "Offline", así que el segundo caso le mentía al usuario — le decía que
  // no tiene internet cuando lo que pasa es que hay otro Nest abierto.
  it('paused por el candado dice que otra instancia sincroniza, no que estás offline', async () => {
    mockMemoryBridge({
      connected: true, deviceId: 'dev-1', itemCount: 3, pendingCount: 2,
      daemonStatus: 'paused', daemonStatusDetail: 'lock_held',
    })
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByText(/another nest is syncing/i)).toBeInTheDocument())
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument()
  })

  it('paused sin motivo sigue diciendo offline, que es el caso de siempre', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 3, pendingCount: 1, daemonStatus: 'paused' })
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByText(/offline/i)).toBeInTheDocument())
    expect(screen.queryByText(/another nest is syncing/i)).not.toBeInTheDocument()
  })

  // Spec 2b-1 §4.1: Free ve «Connect» como Cloud. La beta (not_in_beta) la sigue decidiendo el servidor.
  it('disconnected on a free plan shows Connect, no Upgrade, no Turn off', async () => {
    mockMemoryBridge({ connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument())
    expect(screen.queryByText('Upgrade')).not.toBeInTheDocument()
    expect(screen.queryByText('Turn off')).not.toBeInTheDocument()
    expect(screen.queryByText(/cloud sync is a Cloud feature/)).not.toBeInTheDocument()
  })

  it('unavailable (no memory bridge) still shows a disabled Unavailable button, no Turn off', async () => {
    // No mockMemoryBridge() call — window.memory stays undefined, which is exactly
    // what drives useMemory() to the 'unavailable' state (see its effect's `!api` guard).
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByText('Unavailable')).toBeInTheDocument())
    expect(screen.getByText('Unavailable')).toBeDisabled()
    expect(screen.queryByText('Turn off')).not.toBeInTheDocument()
  })
})

// Task 3 del corte comercial: los limites de nube los hace cumplir el servidor, y el
// cliente los MUESTRA. La cuota llega en la respuesta de `GET /v1/sync/status`; antes el
// daemon la leia para desbloquear mutaciones y la tiraba, asi que nunca llegaba a la
// pantalla. Ojo con la condicion de render: NO cuelga de PLAN_LIMITS[plan].memoryCloud —
// gatear el dato del servidor detras de una constante del cliente es justo lo que esta
// tarea saca del medio. Si el servidor reporto cuota, el usuario tiene nube.
describe('CloudMemoryCard — la cuota de memoria sale del servidor', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    mockLocalPaths()
  })

  afterEach(() => {
    delete (window as unknown as { memory?: unknown }).memory
  })

  it('muestra la cuota que devuelve el servidor, no una constante del cliente', async () => {
    mockMemoryBridge({
      connected: true,
      deviceId: 'dev-1',
      itemCount: 12,
      pendingCount: 0,
      daemonStatus: 'idle',
      quota: { used_bytes: 3_183_898, max_bytes: 1024 ** 3 },
    })
    render(<CloudMemoryCard />)

    // 3,18 MB de 1 GiB. El texto exacto lo define la implementacion; lo que este test fija
    // es que los dos numeros salen del servidor y llegan a la pantalla.
    expect(await screen.findByText(/3\.[0-9] MB/)).toBeInTheDocument()
    expect(await screen.findByText(/1 GB/)).toBeInTheDocument()
  })

  it('no inventa una cuota cuando el servidor todavia no reporto ninguna', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 12, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByText(/12 memories/)).toBeInTheDocument())
    // El formato de la cuota es "Cloud space: <usado> of <tope>" con unidades. El assert
    // que importa es que no aparezca una CUOTA, no la preposicion.
    expect(screen.queryByText(/\d+(\.\d+)?\s*(B|KB|MB|GB)\s+of\s/i)).toBeNull()
  })

  it('la barra de cuota es la cuota, no el progreso de subida', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'd', itemCount: 48, pendingCount: 1, daemonStatus: 'idle',
      quota: { used_bytes: 3.1 * 1024 * 1024, max_bytes: 1024 ** 3 } })
    render(<CloudMemoryCard />)
    const barra = await screen.findByRole('meter', { name: /Cloud space/ })
    expect(Number(barra.getAttribute('aria-valuenow'))).toBeLessThan(1)
    expect(screen.getByText(/Uploading 1 change/)).toBeInTheDocument()
  })

  // Nuevo pedido G del review final: "Uploading N changes…" lleva el mismo punto ambar que
  // la fila de estado de la sidebar — antes era sólo texto, sin la señal visual que el
  // spec §3.2 describe.
  it('"Uploading" lleva el punto ambar (bg-warn, redondo)', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'd', itemCount: 48, pendingCount: 1, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)
    const texto = await screen.findByText(/Uploading 1 change/)
    const punto = texto.parentElement!.querySelector('span[aria-hidden]')
    expect(punto).not.toBeNull()
    expect(punto!.className).toMatch(/bg-warn/)
    expect(punto!.className).toMatch(/rounded-full/)
  })

  it('sin pendientes no dice que sube nada', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'd', itemCount: 48, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)
    await screen.findByText(/48 memories/)
    expect(screen.queryByText(/Uploading/)).toBeNull()
  })
})

// §9.2: el token deja de pegarse a mano. Connect (y Retry) le piden uno al servicio con el
// JWT del login; el input de token sigue existiendo como escape — para el beta de una
// cuenta, y para cuando el emisor está caído — pero ya no es obligatorio.
describe('CloudMemoryCard — Connect pide el token al servicio (§9.2)', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-de-login' } } })
    mockLocalPaths()
  })

  afterEach(() => {
    delete (window as unknown as { memory?: unknown }).memory
  })

  it('Retry ya no esta deshabilitado sin token, y pide uno con el login', async () => {
    const memoria = mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 0, pendingCount: 0, daemonStatus: 'error' })
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByText(/Couldn't sync/)).toBeInTheDocument())
    const retry = screen.getByText('Retry')
    expect(retry).not.toBeDisabled()

    fireEvent.click(retry)

    await waitFor(() => expect(memoria.registerDevice).toHaveBeenCalledWith('jwt-de-login'))
  })
})

describe('CloudMemoryCard — filas del spec 2026-10-21', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    mockLocalPaths()
  })
  afterEach(() => { delete (window as unknown as { memory?: unknown }).memory })

  it('la fila dice qué es, sin repetir lo del cifrado ni ofrecer Learn more', async () => {
    mockMemoryBridge({ connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)
    expect(await screen.findByText('Keeps a copy in the cloud so what your agents learn here is there on your other machines.')).toBeInTheDocument()
    expect(screen.queryByText(/encrypt/i)).toBeNull()
    expect(screen.queryByText('Learn more')).toBeNull()
    expect(screen.queryByPlaceholderText(/sync token/i)).toBeNull()
  })

  it('conectado y al día dice «Up to date · N memories»', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'd', itemCount: 1, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)
    expect(await screen.findByText('Up to date · 1 memory')).toBeInTheDocument()
  })

  it('offline dice cuántos cambios esperan', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'd', itemCount: 3, pendingCount: 2, daemonStatus: 'paused' })
    render(<CloudMemoryCard />)
    expect(await screen.findByText('Offline — 2 changes waiting')).toBeInTheDocument()
  })

  it('sin repos vinculados, el aviso corto', async () => {
    mockMemoryBridge({ connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)
    expect(await screen.findByText('Link your repos before connecting — memory imported without them goes to Global and stays there.')).toBeInTheDocument()
  })

  it('la cuota es una fila «Cloud space» con «X of Y»', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'd', itemCount: 12, pendingCount: 0, daemonStatus: 'idle', quota: { used_bytes: 1024 ** 2, max_bytes: 1024 ** 3 } })
    render(<CloudMemoryCard />)
    expect(await screen.findByText('1 MB of 1 GB')).toBeInTheDocument()
    expect(screen.getByText('Cloud space', { selector: 'p' })).toBeInTheDocument()
  })

  it('«Machine without a browser» sólo con la nube conectada', async () => {
    const memoria = mockMemoryBridge({ connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle' })
    ;(memoria as unknown as { linkApprove: unknown }).linkApprove = vi.fn()
    const { unmount } = render(<CloudMemoryCard />)
    await screen.findByText(/Keeps a copy in the cloud/)
    expect(screen.queryByText('Machine without a browser')).toBeNull()
    unmount()
    const conectada = mockMemoryBridge({ connected: true, deviceId: 'd', itemCount: 0, pendingCount: 0, daemonStatus: 'idle' })
    ;(conectada as unknown as { linkApprove: unknown }).linkApprove = vi.fn()
    render(<CloudMemoryCard />)
    expect(await screen.findByText('Machine without a browser')).toBeInTheDocument()
  })
})

// Minor del review final: `max_bytes = 0` (tope todavia sin asignar del lado del servidor)
// dividia por cero y mandaba NaN% al meter y al ancho de la barra.
describe('CloudMemoryCard — la cuota con max_bytes en 0 no rompe en NaN', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    mockLocalPaths()
  })

  afterEach(() => {
    delete (window as unknown as { memory?: unknown }).memory
  })

  it('muestra 0%, no NaN%, cuando el servidor todavia no informo un tope', async () => {
    mockMemoryBridge({
      connected: true, deviceId: 'dev-1', itemCount: 1, pendingCount: 0, daemonStatus: 'idle',
      quota: { used_bytes: 0, max_bytes: 0 },
    })
    render(<CloudMemoryCard />)

    const barra = await screen.findByRole('meter', { name: /Cloud space/ })
    expect(Number.isNaN(Number(barra.getAttribute('aria-valuenow')))).toBe(false)
    expect(barra.getAttribute('aria-valuenow')).toBe('0')
  })
})

// Minor del review final: el checkbox "Also delete my cloud memory" vive ADENTRO del
// AlertDialog de Turn off, y antes del fix sobrevivia a un Cancel — tildarlo, cancelar, y
// volver a abrir el dialogo lo mostraba todavia tildado, listo para borrar la nube sin que
// el usuario lo haya pedido esta vez.
describe('CloudMemoryCard — el checkbox de borrado se resetea cada vez que se abre Turn off', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    mockLocalPaths()
  })

  afterEach(() => {
    delete (window as unknown as { memory?: unknown }).memory
  })

  it('tildar, cancelar y reabrir deja el checkbox destildado', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 3, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByText('Turn off')).toBeInTheDocument())

    let dialog = await abrirDialogoDeTurnOff()
    const checkbox = () => dialog.getByLabelText(/Also delete my cloud memory/) as HTMLInputElement
    fireEvent.click(checkbox())
    expect(checkbox().checked).toBe(true)

    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    dialog = await abrirDialogoDeTurnOff()
    expect(checkbox().checked).toBe(false)
  })
})

// Review final de rama, E: el boton de confirmar era SIEMPRE rojo ("destructive"), aunque
// un "Turn off" sin el checkbox de borrado tildado no borra nada en la nube — es el MISMO
// peso visual que un turn-off que SI borra datos permanentemente.
describe('CloudMemoryCard — el boton de confirmar solo es destructivo si va a borrar la nube', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    mockLocalPaths()
  })

  afterEach(() => {
    delete (window as unknown as { memory?: unknown }).memory
  })

  it('sin tildar el checkbox, el boton de confirmar NO es destructivo', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 3, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)
    await waitFor(() => expect(screen.getByText('Turn off')).toBeInTheDocument())

    const dialog = await abrirDialogoDeTurnOff()
    const confirmar = dialog.getByRole('button', { name: 'Turn off' })
    expect(confirmar.className).not.toMatch(/bg-destructive/)
  })

  it('con el checkbox tildado, el boton de confirmar SI es destructivo', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 3, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)
    await waitFor(() => expect(screen.getByText('Turn off')).toBeInTheDocument())

    const dialog = await abrirDialogoDeTurnOff()
    fireEvent.click(dialog.getByLabelText(/Also delete my cloud memory/))
    const confirmar = dialog.getByRole('button', { name: 'Turn off' })
    expect(confirmar.className).toMatch(/bg-destructive/)
  })
})

describe('CloudMemoryCard — Projects in the cloud (spec 2b-1 §4.4)', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    mockLocalPaths()
  })
  afterEach(() => { delete (window as unknown as { memory?: unknown }).memory })

  const freeConectado = {
    connected: true, deviceId: 'd', itemCount: 3, pendingCount: 0, daemonStatus: 'idle' as const,
    limits: { max_projects: 1 }, cloudProjects: [{ projectKey: 'k-nest', name: 'raven-nest' }],
  }

  it('Free conectado: «1 of 1 · raven-nest», sin línea de afuera ni Upgrade', async () => {
    mockMemoryBridge(freeConectado)
    render(<CloudMemoryCard />)
    expect(await screen.findByText('1 of 1 · raven-nest')).toBeInTheDocument()
    expect(screen.getByText('Projects in the cloud')).toBeInTheDocument()
    expect(screen.queryByText(/Local only/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })

  it('con repos afuera: la línea, y Upgrade abre el modal de planes', async () => {
    mockMemoryBridge(freeConectado, {
      ok: true, blockedTotal: 7, groups: [],
      localOnlyProjects: [{ projectKey: 'k-api', name: 'api', count: 5 }, { projectKey: 'k-web', name: 'web', count: 2 }],
    })
    render(<CloudMemoryCard />)
    expect(await screen.findByText('Local only: api, web — Cloud syncs all your projects.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    // El UpgradeModal de siempre: lista los planes ("Free" entre ellos).
    await waitFor(() => expect(screen.getByText('Free')).toBeInTheDocument())
  })

  it('Cloud ve «N projects»', async () => {
    mockMemoryBridge({ ...freeConectado, limits: { max_projects: 100 }, cloudProjects: [{ projectKey: 'a', name: 'a' }, { projectKey: 'b', name: 'b' }] })
    render(<CloudMemoryCard />)
    expect(await screen.findByText('2 projects')).toBeInTheDocument()
  })

  it('sin conectar no hay fila', async () => {
    mockMemoryBridge({ connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle', limits: { max_projects: 1 }, cloudProjects: [] })
    render(<CloudMemoryCard />)
    await screen.findByText(/Keeps a copy in the cloud/)
    expect(screen.queryByText('Projects in the cloud')).toBeNull()
  })

  it('sin roster todavía (status sin cargar) no hay fila', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'd', itemCount: 3, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)
    await screen.findByText('Up to date · 3 memories')
    expect(screen.queryByText('Projects in the cloud')).toBeNull()
  })
})

describe('CloudMemoryCard — 2b-2', () => {
  const flagsAntes = window.appFlags
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
  })
  afterEach(() => {
    (window as { appFlags?: unknown }).appFlags = flagsAntes
    delete (window as unknown as { memory?: unknown }).memory
  })

  const conectadaSobreElTope = {
    connected: true, deviceId: 'dev-1', itemCount: 3, pendingCount: 0, daemonStatus: 'idle' as const,
    limits: { max_projects: 1 },
    cloudProjects: [{ projectKey: 'k-a', name: 'api' }, { projectKey: 'k-b', name: 'web' }],
    keptProjectKey: null, overLimit: true,
  }

  it('por encima del tope: Keep syncing y elegir llama al daemon', async () => {
    mockLocalPaths()
    const memory = mockMemoryBridge(conectadaSobreElTope)
    render(<CloudMemoryCard />)
    expect(await screen.findByText('Your plan syncs 1 of 2 projects.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('combobox', { name: 'Keep syncing' }))
    fireEvent.click(await screen.findByRole('option', { name: 'web' }))
    await waitFor(() => expect(memory.keepProject).toHaveBeenCalledWith('k-b'))
  })

  // Ruling P8: el error del daemon llega a la fila.
  it('si el daemon no puede elegir, la fila muestra el error', async () => {
    mockLocalPaths()
    const memory = mockMemoryBridge(conectadaSobreElTope)
    memory.keepProject.mockResolvedValue({ ok: false, error: 'network' })
    render(<CloudMemoryCard />)
    await screen.findByText('Your plan syncs 1 of 2 projects.')
    fireEvent.click(screen.getByRole('combobox', { name: 'Keep syncing' }))
    fireEvent.click(await screen.findByRole('option', { name: 'web' }))
    expect(await screen.findByText("Couldn't change the synced project. Try again.")).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Keep syncing' })).toHaveTextContent('api')
  })

  it('con plan cloud, Manage subscription abre el portal (D10)', async () => {
    ;(window as unknown as { appFlags: unknown }).appFlags = { e2eBypass: true, e2ePlan: 'cloud' }
    supabaseMock.functions.invoke.mockResolvedValue({ data: { url: 'https://billing.stripe.test/p' }, error: null })
    const openExternal = vi.fn()
    ;(window as unknown as { electronShell: unknown }).electronShell = { openExternal }
    mockLocalPaths()
    mockMemoryBridge({ ...conectadaSobreElTope, overLimit: false })
    render(<CloudMemoryCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage subscription' }))
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith('https://billing.stripe.test/p'))
  })

  it('con plan free no hay Manage subscription', async () => {
    mockLocalPaths()
    mockMemoryBridge({ ...conectadaSobreElTope, overLimit: false })
    render(<CloudMemoryCard />)
    await screen.findByText('Cloud sync')
    expect(screen.queryByRole('button', { name: 'Manage subscription' })).toBeNull()
  })
})
