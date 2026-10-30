// La huella se ata a lo que efectivamente se envuelve.
//
// Al autorizar (personal o de equipo) el handler vuelve a pedir la lista de públicas antes de
// envolver. Si envolviera para lo que diga ESE segundo fetch, un servidor hostil podría mostrar
// la pública real para la comparación y servir la suya para el envoltorio: el usuario
// verificaría una clave y autorizaría otra. Por eso la UI manda la huella que mostró, y si la
// pública del fetch no da esa misma huella no se envuelve nada.
import { huellaDeClave } from './memory-key-wrap'

export interface DestinoDeAutorizacion {
  deviceId: string
  publicKey: string
}

const normalizar = (h: string) => h.trim().toUpperCase()

export function elegirDestinoVerificado<T extends DestinoDeAutorizacion>(
  devices: T[],
  deviceId: string,
  huellaMostrada: string | null | undefined
): { ok: true; target: T } | { ok: false; error: string } {
  if (typeof huellaMostrada !== 'string' || huellaMostrada.trim() === '') {
    return { ok: false, error: 'Compare the machine’s code before authorising it.' }
  }
  const target = devices.find((d) => d.deviceId === deviceId)
  if (!target) return { ok: false, error: 'That machine has not published its key yet.' }
  if (normalizar(huellaDeClave(target.publicKey)) !== normalizar(huellaMostrada)) {
    return {
      ok: false,
      error: 'That machine’s key changed since you compared it. Nothing was authorised — compare the code again.',
    }
  }
  return { ok: true, target }
}
