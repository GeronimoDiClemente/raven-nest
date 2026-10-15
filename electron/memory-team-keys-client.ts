// Las tres cosas que hace el leader de un equipo con su clave, contra `/v1/teams/key*`
// (server/src/team-keys.ts): activar, autorizar a otro device, y lo que hace cualquier
// miembro — adoptar la envoltura que el leader ya le dejó publicada.
//
// Mismo patrón que memory-keys-client.ts, sin épocas (spec §2/§8: v1 no rota la clave de
// equipo). Lo que SÍ tiene desde Task 15 (C2 de la review final) es prueba de posesión: el
// servidor guarda el verificador de la maestra al activar, exige la prueba para autorizar y
// migrar, y el cliente compara contra el verificador toda maestra que desenvuelve antes de
// adoptarla.
import { generateMasterKey, teamKeyProof, teamKeyVerifier } from './memory-crypto'
import {
  wrapForDevice, unwrapWithDevice, wrapForRecovery, generateRecoveryCode, unwrapWithRecovery, type DeviceKeyPair,
} from './memory-key-wrap'

export interface TeamKeysClientDeps {
  baseUrl: string
  token: string
  deviceId: string
  fetchImpl?: typeof fetch
}

export interface RemoteTeamKeyState {
  activated: boolean
  /** SHA-256 de la prueba de posesión, o null si el equipo no está activado. */
  verifier: string | null
  wrap: { wrapped: string; wrapMeta: Record<string, unknown> | null } | null
  pendingDevices: Array<{ deviceId: string; name: string; publicKey: string }>
  /** Task 15b (Minor 3): si este usuario es leader del equipo, según el servidor. Ausente
   * (servicio anterior) es false: lo único que se pierde es el conteo de pendientes. */
  isLeader: boolean
}

export class TeamKeysHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'TeamKeysHttpError'
    this.status = status
  }
}

/**
 * La maestra que se desenvolvió NO es la del equipo: no coincide con el verificador que se
 * publicó al activar. Alguien escribió una envoltura (o una copia de recuperación) con otra
 * maestra. No se adopta nunca: adoptarla es cifrar todo lo de equipo para quien la plantó.
 */
export class TeamKeyMismatchError extends Error {
  constructor() {
    super('The team key offered to this machine is not this team’s key, so it was not used. Ask your team leader to authorise this machine again.')
    this.name = 'TeamKeyMismatchError'
  }
}

async function pedir(
  deps: TeamKeysClientDeps,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown }
): Promise<unknown> {
  const f = deps.fetchImpl ?? fetch
  const response = await f(`${deps.baseUrl}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${deps.token}`,
      'Content-Type': 'application/json',
      'X-Device-Test': deps.deviceId,
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new TeamKeysHttpError(response.status, String((json as { error?: string }).error ?? response.status))
  }
  return json
}

export async function fetchTeamKeyState(
  deps: TeamKeysClientDeps,
  teamId: string,
  slot?: string
): Promise<RemoteTeamKeyState> {
  const qs = slot ? `&slot=${encodeURIComponent(slot)}` : ''
  const json = (await pedir(deps, `/v1/teams/key?team_id=${encodeURIComponent(teamId)}${qs}`, { method: 'GET' })) as Partial<RemoteTeamKeyState>
  return {
    activated: Boolean(json.activated),
    verifier: typeof json.verifier === 'string' && json.verifier !== '' ? json.verifier : null,
    wrap: json.wrap ?? null,
    pendingDevices: Array.isArray(json.pendingDevices) ? json.pendingDevices : [],
    isLeader: json.isLeader === true,
  }
}

/**
 * Lanza `TeamKeyMismatchError` si `master` no es la maestra cuyo verificador publicó el
 * servidor. Un equipo activado SIN verificador también lanza: sin nada contra qué comparar no
 * hay forma de saber si la envoltura es legítima, y adoptar a ciegas es justo el agujero.
 */
function exigirMaestraDelEquipo(master: Buffer, teamId: string, verifier: string | null): void {
  if (!verifier || teamKeyVerifier(teamKeyProof(master, teamId)) !== verifier) {
    throw new TeamKeyMismatchError()
  }
}

/** Sólo el `leader` puede llamar a esto (el servidor lo re-verifica igual: spec §9.2). */
export async function activateTeamEncryption(
  deps: TeamKeysClientDeps,
  teamId: string,
  device: DeviceKeyPair
): Promise<{ master: string; recoveryCode: string }> {
  const master = generateMasterKey()
  const recoveryCode = generateRecoveryCode()
  const recovery = wrapForRecovery(recoveryCode, master)
  await pedir(deps, '/v1/teams/key/activate', {
    method: 'POST',
    body: {
      team_id: teamId,
      // Lo que `authorize`/`recrypt` van a exigir probar de acá en adelante, y lo que todo
      // miembro compara al adoptar. Derivado de la maestra: sólo lo calcula quien la tiene.
      verifier: teamKeyVerifier(teamKeyProof(master, teamId)),
      wraps: [
        { slot: deps.deviceId, kind: 'device', wrapped: wrapForDevice(device.publicKey, master) },
        { slot: 'recovery', kind: 'recovery', wrapped: recovery.wrapped, wrap_meta: { salt: recovery.salt } },
      ],
    },
  })
  return { master: master.toString('base64'), recoveryCode }
}

/** `null` es la respuesta normal mientras el equipo no tiene clave, o esta máquina espera
 * que el leader la autorice — no lanza en ninguno de los dos casos. Lanza
 * `TeamKeyMismatchError` si la envoltura abre una maestra que no es la del equipo. */
export async function adoptExistingTeamKey(
  deps: TeamKeysClientDeps,
  teamId: string,
  device: DeviceKeyPair
): Promise<{ master: string } | null> {
  const estado = await fetchTeamKeyState(deps, teamId)
  if (!estado.activated || !estado.wrap) return null
  const master = unwrapWithDevice(device.privateKey, estado.wrap.wrapped)
  exigirMaestraDelEquipo(master, teamId, estado.verifier)
  return { master: master.toString('base64') }
}

/** Sólo lo llama el `leader` (gateado también server-side). Envuelve la maestra que YA tiene
 * con la pública del device objetivo, y prueba que la tiene. */
export async function authorizeTeamDeviceFromClient(
  deps: TeamKeysClientDeps,
  teamId: string,
  master: string,
  target: { deviceId: string; publicKey: string }
): Promise<void> {
  const m = Buffer.from(master, 'base64')
  await pedir(deps, '/v1/teams/key/authorize', {
    method: 'POST',
    body: {
      team_id: teamId,
      proof: teamKeyProof(m, teamId),
      wraps: [{
        slot: target.deviceId, kind: 'device',
        wrapped: wrapForDevice(target.publicKey, m),
      }],
    },
  })
}

/** Recupera la clave de equipo usando un código de recuperación. Lanza ANTES de publicar
 * cualquier cosa si el código es incorrecto, o si la copia de recuperación abre una maestra
 * que no es la del equipo. */
export async function recoverTeamWithCode(
  deps: TeamKeysClientDeps,
  teamId: string,
  device: DeviceKeyPair,
  code: string
): Promise<{ master: string }> {
  const estado = await fetchTeamKeyState(deps, teamId, 'recovery')
  const wrap = estado.wrap
  if (!wrap?.wrapMeta?.salt || typeof wrap.wrapMeta.salt !== 'string') {
    throw new Error('There is no recovery copy for this team.')
  }
  // Lanza MemoryUnwrapError con el código equivocado, ANTES de publicar nada — mismo orden
  // que `recoverWithCode` personal.
  const master = unwrapWithRecovery(code, { wrapped: wrap.wrapped, salt: wrap.wrapMeta.salt })
  // Y la copia tiene que ser LA del equipo: una reemplazada por otra maestra (con un código que
  // quien la plantó conoce) abre sin error, y autorizarse con ella sería adoptarla.
  exigirMaestraDelEquipo(master, teamId, estado.verifier)
  await authorizeTeamDeviceFromClient(deps, teamId, master.toString('base64'), {
    deviceId: deps.deviceId, publicKey: device.publicKey,
  })
  return { master: master.toString('base64') }
}
