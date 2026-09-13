// Las tres cosas que un usuario hace con el cifrado, contra `/v1/keys*` (Task 4):
//   activar (esta cuenta todavia no tiene clave), adoptar (esta maquina ya fue autorizada)
//   y recuperar (no queda ninguna maquina viva).
// Mas la cuarta que hace desde la app: autorizar a otra maquina.
//
// `fetch` entra inyectado: todo el flujo se prueba de punta a punta contra un servidor de
// mentira, sin red, sin Postgres y sin Electron.
import { generateMasterKey, rotateVerifier } from './memory-crypto'
import {
  wrapForDevice, unwrapWithDevice, wrapForRecovery, unwrapWithRecovery,
  generateRecoveryCode, MemoryUnwrapError, type DeviceKeyPair,
} from './memory-key-wrap'

export interface KeysClientDeps {
  baseUrl: string
  token: string
  deviceId: string
  fetchImpl?: typeof fetch
}

export interface RemoteKeyState {
  keyEpoch: number
  wrap: { wrapped: string; wrapMeta: Record<string, unknown> | null } | null
  devices: Array<{ deviceId: string; name: string; publicKey: string; hasWrap: boolean }>
}

export class KeysHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'KeysHttpError'
    this.status = status
  }
}

async function pedir(
  deps: KeysClientDeps,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown }
): Promise<unknown> {
  const f = deps.fetchImpl ?? fetch
  const response = await f(`${deps.baseUrl}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${deps.token}`,
      'Content-Type': 'application/json',
      // Solo lo lee el servidor falso de los tests; el real saca el device del token.
      'X-Device-Test': deps.deviceId,
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new KeysHttpError(response.status, String((json as { error?: string }).error ?? response.status))
  }
  return json
}

export async function enrollPublicKey(deps: KeysClientDeps, publicKey: string): Promise<void> {
  await pedir(deps, '/v1/keys/enroll', {
    method: 'POST',
    body: { public_key: publicKey, device_id_test: deps.deviceId },
  })
}

export async function fetchKeyState(deps: KeysClientDeps): Promise<RemoteKeyState> {
  const json = (await pedir(deps, '/v1/keys', { method: 'GET' })) as Partial<RemoteKeyState>
  return {
    keyEpoch: Number(json.keyEpoch ?? 0),
    wrap: json.wrap ?? null,
    devices: Array.isArray(json.devices) ? json.devices : [],
  }
}

/**
 * Enciende el cifrado para la cuenta. La maestra se genera ACÁ y no sale de acá sin
 * envolver: lo que se publica son dos sobres, uno para esta maquina y otro para el codigo
 * de recuperacion.
 *
 * El codigo se devuelve al llamador para que lo MUESTRE una vez. No se guarda en ningun
 * lado — guardarlo lo convertiria en el camino C de la spec, que es justo el que se
 * descarto por escrito.
 */
export async function activateEncryption(
  deps: KeysClientDeps,
  device: DeviceKeyPair
): Promise<{ master: string; keyEpoch: number; recoveryCode: string }> {
  // Primero la publica: si publicaramos las envolturas antes, una falla en el medio dejaria
  // una cuenta con cifrado activo y un device sin clave publica, o sea imposible de
  // autorizar desde otro lado.
  await enrollPublicKey(deps, device.publicKey)

  const estado = await fetchKeyState(deps)
  const master = generateMasterKey()
  const recoveryCode = generateRecoveryCode()
  const recovery = wrapForRecovery(recoveryCode, master)
  const keyEpoch = estado.keyEpoch + 1

  await pedir(deps, '/v1/keys/publish', {
    method: 'POST',
    body: {
      key_epoch: keyEpoch,
      // La intencion, explicita. Sin esto el servidor la inferia comparando epocas, y dos
      // maquinas activando a la vez terminaban con maestras DISTINTAS en la misma epoca: la
      // segunda no rotaba (no era `>`) ni era rechazada (no era `<`), asi que pisaba el slot
      // de recuperacion con el suyo.
      mode: 'activate',
      // El verificador de la epoca NUEVA: es lo que la proxima rotacion va a tener que
      // probar que conoce. Derivado de la maestra, asi que solo lo puede calcular quien la
      // tiene — y al servidor no le sirve para abrir nada.
      rotate_verifier: rotateVerifier(master, keyEpoch),
      wraps: [
        { slot: deps.deviceId, kind: 'device', wrapped: wrapForDevice(device.publicKey, master) },
        { slot: 'recovery', kind: 'recovery', wrapped: recovery.wrapped, wrap_meta: { salt: recovery.salt } },
      ],
    },
  })

  return { master: master.toString('base64'), keyEpoch, recoveryCode }
}

/**
 * "Esta maquina, ¿ya tiene la clave de la cuenta?". `null` es una respuesta legitima y
 * frecuente — la cuenta no cifra todavia, o esta maquina espera que otra la autorice — asi
 * que no lanza. De paso deja publicada la propia clave publica, que es la precondicion
 * para que la otra maquina pueda autorizarla.
 */
export async function adoptExistingKey(
  deps: KeysClientDeps,
  device: DeviceKeyPair
): Promise<{ master: string; keyEpoch: number } | null> {
  await enrollPublicKey(deps, device.publicKey)
  const estado = await fetchKeyState(deps)
  if (estado.keyEpoch === 0 || !estado.wrap) return null
  return {
    master: unwrapWithDevice(device.privateKey, estado.wrap.wrapped).toString('base64'),
    keyEpoch: estado.keyEpoch,
  }
}

/**
 * Autoriza a otra maquina: envuelve la maestra que YA tenemos con la publica de ella. La
 * epoca no cambia — autorizar no es rotar — asi que las envolturas que ya existen quedan
 * donde estan (el servidor solo borra al SUBIR de epoca).
 */
export async function authorizeDevice(
  deps: KeysClientDeps,
  master: string,
  keyEpoch: number,
  target: { deviceId: string; publicKey: string }
): Promise<void> {
  await pedir(deps, '/v1/keys/publish', {
    method: 'POST',
    body: {
      key_epoch: keyEpoch,
      // Autorizar NO rota: suma una envoltura a la maestra que ya existe. Sin declararlo, el
      // servidor lo infería de la época y una autorización con una época adelantada habría
      // borrado TODAS las envolturas de la cuenta, incluida la de recuperación.
      mode: 'authorize',
      wraps: [{
        slot: target.deviceId, kind: 'device',
        wrapped: wrapForDevice(target.publicKey, Buffer.from(master, 'base64')),
      }],
    },
  })
}

/**
 * El camino sin ninguna maquina viva (D8). Abre la copia de recuperacion con el codigo y
 * despues se auto-autoriza, para que el proximo arranque no vuelva a pedirlo.
 */
export async function recoverWithCode(
  deps: KeysClientDeps,
  device: DeviceKeyPair,
  code: string
): Promise<{ master: string; keyEpoch: number }> {
  await enrollPublicKey(deps, device.publicKey)
  const estado = await fetchKeyState(deps)
  const wrap = estado.keyEpoch > 0 ? await copiaDeRecuperacion(deps) : null
  if (!wrap) {
    throw new Error('No hay una copia de recuperación para esta cuenta.')
  }
  // Lanza MemoryUnwrapError con el codigo equivocado, ANTES de publicar nada.
  const master = unwrapWithRecovery(code, wrap)
  await authorizeDevice(deps, master.toString('base64'), estado.keyEpoch, {
    deviceId: deps.deviceId, publicKey: device.publicKey,
  })
  return { master: master.toString('base64'), keyEpoch: estado.keyEpoch }
}

/**
 * La envoltura de recuperacion no viene en `GET /v1/keys` (ese endpoint devuelve la del
 * device que llama), asi que se pide por el mismo camino con el slot explicito.
 */
async function copiaDeRecuperacion(
  deps: KeysClientDeps
): Promise<{ wrapped: string; salt: string } | null> {
  const json = (await pedir(deps, '/v1/keys?slot=recovery', { method: 'GET' })) as {
    wrap?: { wrapped?: string; wrapMeta?: { salt?: string } | null } | null
  }
  const wrapped = json.wrap?.wrapped
  const salt = json.wrap?.wrapMeta?.salt
  if (typeof wrapped !== 'string' || typeof salt !== 'string') return null
  return { wrapped, salt }
}
