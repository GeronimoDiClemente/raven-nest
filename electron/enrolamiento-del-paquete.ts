// Que esta máquina pueda leer las memorias cifradas de la cuenta (spec del portátil §7).
//
// El §7 describe el momento exacto: el paquete se conecta, y lo primero que tiene que decir
// es si puede o no puede abrir lo que hay en la nube. «Lo que no puede leer, lo dice» es el
// punto 3 de esa sección, y el motivo está escrito ahí: bajar filas cifradas y mostrarlas
// vacías —o peor, no mostrarlas— es el modo de falla que más confianza destruye.
//
// **Casi todo esto ya existía**: `enrollPublicKey`, `fetchKeyState` y `unwrapWithDevice` son
// los mismos que usa Nest. Lo que falta del lado del paquete es distinguir dos situaciones
// que `adoptExistingKey` colapsa en `null` y que para el usuario son opuestas:
//
// - **la cuenta todavía no cifra** → conectar la activa (spec 2026-11-02): se guarda la maestra
//   y se muestra el código de recuperación. «La cuenta no cifra» ya no es un estado final;
// - **la cuenta cifra y esta máquina todavía no está autorizada** → hay que mostrar la huella
//   y esperar.
//
// La huella se muestra SIEMPRE que se esté esperando, y no sólo cuando algo falla: es el
// mecanismo que hace visible la sustitución de clave, porque el usuario compara dos strings
// cortos antes de autorizar.
import type { DeviceKeyPair } from './memory-key-wrap'
import type { RemoteKeyState } from './memory-keys-client'
import { comando } from './nombre-del-paquete'
import { asegurarCifrado } from './asegurar-cifrado'

export type ResultadoDeEnrolamiento =
  /** No hay llavero del sistema: no hay dónde guardar una maestra, así que no se pide. */
  | { estado: 'sin-llavero' }
  /** La cuenta no cifraba: esta conexión lo activó. La maestra ya quedó guardada; el código
   *  se muestra UNA vez y el servidor no puede regenerarlo. */
  | { estado: 'activada'; keyEpoch: number; recoveryCode: string }
  /** Publicada la pública, falta que otra máquina autorice esta. */
  | { estado: 'esperando-autorizacion'; huella: string }
  /** Esta máquina puede leer lo cifrado. */
  | { estado: 'lista'; keyEpoch: number }
  | { estado: 'error'; detalle: string }

export interface DepsDeEnrolamiento {
  /** Si el sistema tiene dónde guardar una clave. Ver `llavero-del-sistema.ts`. */
  hayLlavero: () => boolean
  /** El par de esta máquina y la maestra que ya tenga, si tiene. */
  material: () => { device: DeviceKeyPair; master: string | null; keyEpoch: number }
  guardarMaestra: (master: string, keyEpoch: number) => void
  enrolar: (publicKey: string) => Promise<void>
  estadoRemoto: () => Promise<RemoteKeyState>
  desenvolver: (privateKey: string, wrapped: string) => Buffer
  huella: (publicKey: string) => string
  /** Activa el cifrado de una cuenta en época 0 (`activateEncryption`). */
  activar: (device: DeviceKeyPair) => Promise<{ master: string; keyEpoch: number; recoveryCode: string }>
}

export function mensajeDeEnrolamiento(resultado: ResultadoDeEnrolamiento): string[] {
  switch (resultado.estado) {
    case 'lista':
      return ['This machine can read your encrypted memory now.']
    case 'activada':
      return [
        "Encryption is on. Only you hold the key — we can't read your memory.",
        '',
        `  Recovery code:  ${resultado.recoveryCode}`,
        '',
        "Save this recovery code. It's the only way back in if you lose every machine. We can't recover it for you.",
      ]
    case 'esperando-autorizacion':
      return [
        'This machine cannot read your encrypted memory yet.',
        `Its fingerprint is: ${resultado.huella}`,
        'Authorize it from Nest on another machine (Memories → Settings → Encryption → Authorize),',
        'comparing this fingerprint before authorizing.',
        `Then run \`${comando('login')}\` again to check access.`,
        `Or use your recovery code: \`${comando('recover')}\`.`,
        'Recovery spends your one emergency copy; authorizing from another machine is preferred.',
        'Local memory keeps working while you wait.',
      ]
    case 'sin-llavero':
      return [
        'Your credential is saved, but no system keyring is available to store encryption keys safely.',
        'This machine cannot read encrypted cloud memory. Local memory keeps working.',
        `Restore access to your system keyring and run \`${comando('login')}\` again.`,
      ]
    case 'error':
      return [
        `Your credential is saved, but encryption enrollment failed: ${resultado.detalle}`,
        'Encrypted memory access could not be confirmed. Local memory keeps working.',
        `Run \`${comando('login')}\` again to retry.`,
      ]
    default: {
      const nuncaLlega: never = resultado
      throw new Error(`Unhandled enrollment result: ${JSON.stringify(nuncaLlega)}`)
    }
  }
}

export async function enrolarEstaMaquina(d: DepsDeEnrolamiento): Promise<ResultadoDeEnrolamiento> {
  // Sin llavero no se publica nada. La privada tampoco se puede persistir, así que una
  // envoltura que llegara después no se podría abrir nunca: enrolar dejaría una clave pública
  // muerta en la cuenta y al usuario esperando una autorización que no sirve para nada.
  if (!d.hayLlavero()) return { estado: 'sin-llavero' }

  try {
    const propio = d.material()
    const r = await asegurarCifrado({
      material: () => propio,
      // Enrolar es idempotente del lado del servidor: republicar la misma pública no rompe
      // nada, y es lo que hace que una máquina que estuvo apagada durante una rotación vuelva
      // sola a la cola de autorización.
      adoptar: async (device) => {
        await d.enrolar(device.publicKey)
        const conSobre = await d.estadoRemoto()
        if (conSobre.keyEpoch === 0 || !conSobre.wrap) return null
        return { master: d.desenvolver(device.privateKey, conSobre.wrap.wrapped).toString('base64'), keyEpoch: conSobre.keyEpoch }
      },
      estadoRemoto: () => d.estadoRemoto(),
      activar: (device) => d.activar(device),
      huella: d.huella,
    })
    // La maestra se guarda ANTES de que el que llama muestre el código: si falla el guardado
    // se dice (cae al catch), no se anuncia un cifrado que esta máquina no puede abrir.
    switch (r.estado) {
      case 'lista':
        // `asegurarCifrado` ya comprueba que la época coincida; `nueva` distingue la maestra
        // recién adoptada de la que ya estaba guardada.
        if (r.nueva) d.guardarMaestra(r.master, r.keyEpoch)
        return { estado: 'lista', keyEpoch: r.keyEpoch }
      case 'activada':
        d.guardarMaestra(r.master, r.keyEpoch)
        return { estado: 'activada', keyEpoch: r.keyEpoch, recoveryCode: r.recoveryCode }
      case 'esperando-autorizacion':
        return { estado: 'esperando-autorizacion', huella: r.huella }
      case 'sin-estado':
        // Un error acá NO se traduce a «esperando autorización»: el usuario se quedaría
        // mirando una huella y esperando a alguien que ya autorizó. Se dice qué falló.
        return { estado: 'error', detalle: r.detalle }
    }
  } catch (err) {
    return { estado: 'error', detalle: err instanceof Error ? err.message : String(err) }
  }
}
