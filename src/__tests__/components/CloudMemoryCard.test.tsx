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
}) {
  const memory = {
    ensureDeviceId: vi.fn().mockResolvedValue('dev-1'),
    connect: vi.fn().mockResolvedValue({ ok: true }),
    disconnect: vi.fn().mockResolvedValue({ ok: true }),
    status: vi.fn().mockResolvedValue(status),
    hubStats: vi.fn().mockResolvedValue({ itemCount: 0, projectCount: 0 }),
    registerDevice: vi.fn().mockResolvedValue({ ok: true, deviceId: 'dev-1', token: 'nmk_del_servicio' }),
    onStatus: vi.fn(),
    removeStatusListener: vi.fn(),
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

describe('CloudMemoryCard — memory token input stays reachable in the error state (C7 fix round 1)', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    // useProfile() also bails out on a null user and keeps its initial
    // `plan: 'free'` — PLAN_LIMITS.free.memoryCloud is false, which is exactly
    // the plan/state combination Finding 1 describes (downgraded-to-free user
    // whose daemon is in `error`).
    mockLocalPaths()
  })

  afterEach(() => {
    delete (window as unknown as { memory?: unknown }).memory
  })

  it('renders the sync-token input in the error state even without the memoryCloud entitlement', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 0, pendingCount: 0, daemonStatus: 'error' })
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByText(/Couldn't sync/)).toBeInTheDocument())
    expect(screen.getByPlaceholderText('Paste a sync token (optional)')).toBeInTheDocument()
    // Ya NO está deshabilitado sin token: desde §9.2, Retry sin nada pegado le pide uno al
    // servicio con el JWT del login. Este test sigue siendo sobre que el input exista.
  })
})

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

    await waitFor(() => expect(screen.getByText(/another instance/i)).toBeInTheDocument())
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument()
  })

  it('paused sin motivo sigue diciendo offline, que es el caso de siempre', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 3, pendingCount: 1, daemonStatus: 'paused' })
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByText(/offline/i)).toBeInTheDocument())
    expect(screen.queryByText(/another instance/i)).not.toBeInTheDocument()
  })

  it('disconnected on a free plan still shows only Upgrade, no Turn off', async () => {
    mockMemoryBridge({ connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByText('Upgrade')).toBeInTheDocument())
    expect(screen.queryByText('Turn off')).not.toBeInTheDocument()
    expect(screen.queryByText('Retry')).not.toBeInTheDocument()
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

  it('con un token pegado usa ese y no molesta al servicio', async () => {
    const memoria = mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 0, pendingCount: 0, daemonStatus: 'error' })
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByPlaceholderText(/Paste a sync token/i)).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/Paste a sync token/i), { target: { value: 'nmk_a_mano' } })
    fireEvent.click(screen.getByText('Retry'))

    await waitFor(() => expect(memoria.connect).toHaveBeenCalledWith('nmk_a_mano', expect.anything()))
    expect(memoria.registerDevice).not.toHaveBeenCalled()
  })
})

// El rename `pro` -> `cloud` (Task 1 del corte comercial) dejó esta linea desactualizada:
// seguia hablando de un plan que ya no existe.
describe('CloudMemoryCard — el plan pago se llama Cloud, no Pro', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    mockLocalPaths()
  })

  afterEach(() => {
    delete (window as unknown as { memory?: unknown }).memory
  })

  it('la memoria local sin nube dice "Cloud feature", no "Pro feature"', async () => {
    mockMemoryBridge({ connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByText(/cloud sync is a/)).toBeInTheDocument())
    expect(screen.getByText(/cloud sync is a Cloud feature/)).toBeInTheDocument()
    expect(screen.queryByText(/cloud sync is a Pro feature/)).not.toBeInTheDocument()
  })
})

describe('CloudMemoryCard — reabrir el hub de memoria', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    mockLocalPaths()
  })

  afterEach(() => {
    delete (window as unknown as { memory?: unknown }).memory
  })

  it('el link "Learn more" de la card de Nest Memory reabre el hub', async () => {
    mockMemoryBridge({ connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByText('Learn more')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Learn more'))

    await waitFor(() => expect(screen.getByText('Skip')).toBeInTheDocument())
  })
})
