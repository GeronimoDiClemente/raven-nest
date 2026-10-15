// Las tres cosas que hace el leader de un equipo con su clave, contra `/v1/teams/key*`
// (server/src/team-keys.ts): activar, autorizar a otro device, y lo que hace cualquier
// miembro — adoptar la envoltura que el leader ya le dejó publicada.
//
// Mismo patrón que memory-keys-client.ts, sin épocas (spec §2/§8: v1 no rota la clave de
// equipo), así que no hay `key_epoch` ni `rotate_verifier`/`rotate_proof` en ningún lado.
import { generateMasterKey } from './memory-crypto'
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
  wrap: { wrapped: string; wrapMeta: Record<string, unknown> | null } | null
  pendingDevices: Array<{ deviceId: string; name: string; publicKey: string }>
}

export class TeamKeysHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'TeamKeysHttpError'
    this.status = status
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
    wrap: json.wrap ?? null,
    pendingDevices: Array.isArray(json.pendingDevices) ? json.pendingDevices : [],
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
      wraps: [
        { slot: deps.deviceId, kind: 'device', wrapped: wrapForDevice(device.publicKey, master) },
        { slot: 'recovery', kind: 'recovery', wrapped: recovery.wrapped, wrap_meta: { salt: recovery.salt } },
      ],
    },
  })
  return { master: master.toString('base64'), recoveryCode }
}

/** `null` es la respuesta normal mientras el equipo no tiene clave, o esta máquina espera
 * que el leader la autorice — no lanza en ninguno de los dos casos. */
export async function adoptExistingTeamKey(
  deps: TeamKeysClientDeps,
  teamId: string,
  device: DeviceKeyPair
): Promise<{ master: string } | null> {
  const estado = await fetchTeamKeyState(deps, teamId)
  if (!estado.activated || !estado.wrap) return null
  return { master: unwrapWithDevice(device.privateKey, estado.wrap.wrapped).toString('base64') }
}

/** Sólo lo llama el `leader` (gateado también server-side). Envuelve la maestra que YA tiene
 * con la pública del device objetivo. */
export async function authorizeTeamDeviceFromClient(
  deps: TeamKeysClientDeps,
  teamId: string,
  master: string,
  target: { deviceId: string; publicKey: string }
): Promise<void> {
  await pedir(deps, '/v1/teams/key/authorize', {
    method: 'POST',
    body: {
      team_id: teamId,
      wraps: [{
        slot: target.deviceId, kind: 'device',
        wrapped: wrapForDevice(target.publicKey, Buffer.from(master, 'base64')),
      }],
    },
  })
}

/** Recupera la clave de equipo usando un código de recuperación. Lanza ANTES de publicar
 * cualquier cosa si el código es incorrecto. */
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
  await authorizeTeamDeviceFromClient(deps, teamId, master.toString('base64'), {
    deviceId: deps.deviceId, publicKey: device.publicKey,
  })
  return { master: master.toString('base64') }
}
