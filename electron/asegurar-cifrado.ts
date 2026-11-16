// Spec 2026-11-02 §3 y §5: conectar la nube asegura la cuenta en el mismo paso. Lo usan igual
// el main de Nest (`memory:connect`, `memory:encryption:secure`) y el `login` del paquete.
//
// Puro: la red y el disco entran por `deps`. El que llama guarda la maestra.
//
// El orden es el contrato:
//   1. ¿Ya tengo la maestra de la época vigente? → lista.
//   2. Adoptar (de paso enrola la clave pública, así otra máquina me ve pendiente).
//   3. Sólo con la época 0 LEÍDA del servidor, activar. Sin red no se activa nunca: activar
//      desde una máquina que no ve la época real rota la clave de todas las demás.
//   4. Un 409 (o 403 not_authorized_to_rotate) al activar es otra máquina que ganó la carrera: adoptar la suya.
import type { DeviceKeyPair } from './memory-key-wrap'
import { KeysHttpError } from './memory-keys-client'

export type ResultadoDeAsegurar =
  | { estado: 'lista'; master: string; keyEpoch: number; nueva: boolean }
  | { estado: 'activada'; master: string; keyEpoch: number; recoveryCode: string }
  | { estado: 'esperando-autorizacion'; huella: string }
  | { estado: 'sin-estado'; detalle: string }

export interface DepsDeAsegurar {
  material: () => { device: DeviceKeyPair; master: string | null; keyEpoch: number }
  adoptar: (device: DeviceKeyPair) => Promise<{ master: string; keyEpoch: number } | null>
  estadoRemoto: () => Promise<{ keyEpoch: number }>
  activar: (device: DeviceKeyPair) => Promise<{ master: string; keyEpoch: number; recoveryCode: string }>
  huella: (publicKey: string) => string
}

// Que otra máquina activara primero llega como 409, o como 403 `not_authorized_to_rotate` si
// ganó la carrera entre nuestra lectura y la relectura interna de `activateEncryption` (el
// cliente publica la época 2 en modo 'activate' y el servidor la rechaza por no ser la 1).
const perdioLaCarrera = (err: unknown) =>
  err instanceof KeysHttpError &&
  (err.status === 409 || (err.status === 403 && err.message === 'not_authorized_to_rotate'))

const mensaje = (err: unknown) => (err instanceof Error ? err.message : String(err))

export async function asegurarCifrado(d: DepsDeAsegurar): Promise<ResultadoDeAsegurar> {
  const propio = d.material()
  const esperar = (): ResultadoDeAsegurar => ({ estado: 'esperando-autorizacion', huella: d.huella(propio.device.publicKey) })

  let remoto: { keyEpoch: number }
  try {
    remoto = await d.estadoRemoto()
  } catch (err) {
    return { estado: 'sin-estado', detalle: mensaje(err) }
  }

  if (propio.master && propio.keyEpoch === remoto.keyEpoch && remoto.keyEpoch > 0) {
    return { estado: 'lista', master: propio.master, keyEpoch: propio.keyEpoch, nueva: false }
  }

  try {
    const adoptada = await d.adoptar(propio.device)
    if (adoptada) return { estado: 'lista', ...adoptada, nueva: true }
  } catch (err) {
    return { estado: 'sin-estado', detalle: mensaje(err) }
  }

  if (remoto.keyEpoch > 0) return esperar()

  try {
    const activada = await d.activar(propio.device)
    return { estado: 'activada', ...activada }
  } catch (err) {
    if (perdioLaCarrera(err)) {
      try {
        const adoptada = await d.adoptar(propio.device)
        return adoptada ? { estado: 'lista', ...adoptada, nueva: true } : esperar()
      } catch (err2) {
        return { estado: 'sin-estado', detalle: mensaje(err2) }
      }
    }
    return { estado: 'sin-estado', detalle: mensaje(err) }
  }
}
