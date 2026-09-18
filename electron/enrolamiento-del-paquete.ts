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
// - **la cuenta no cifra** → no hay nada que esperar, y mostrar una huella acá manda a
//   alguien a buscar un botón de autorizar que no existe;
// - **la cuenta cifra y esta máquina todavía no está autorizada** → hay que mostrar la huella
//   y esperar.
//
// La huella se muestra SIEMPRE que se esté esperando, y no sólo cuando algo falla: es el
// mecanismo que hace visible la sustitución de clave —el ataque que la tercera revisión
// encontró— porque el usuario compara dos strings cortos antes de autorizar.
import type { DeviceKeyPair } from './memory-key-wrap'
import type { RemoteKeyState } from './memory-keys-client'

export type ResultadoDeEnrolamiento =
  /** No hay llavero del sistema: no hay dónde guardar una maestra, así que no se pide. */
  | { estado: 'sin-llavero' }
  /** La cuenta no tiene el cifrado activado. No hay nada que autorizar. */
  | { estado: 'cuenta-sin-cifrado' }
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
}

export async function enrolarEstaMaquina(d: DepsDeEnrolamiento): Promise<ResultadoDeEnrolamiento> {
  // Sin llavero no se publica nada. La privada tampoco se puede persistir, así que una
  // envoltura que llegara después no se podría abrir nunca: enrolar dejaría una clave pública
  // muerta en la cuenta y al usuario esperando una autorización que no sirve para nada.
  if (!d.hayLlavero()) return { estado: 'sin-llavero' }

  const propio = d.material()
  try {
    const remoto = await d.estadoRemoto()
    if (remoto.keyEpoch === 0) return { estado: 'cuenta-sin-cifrado' }

    // La época tiene que coincidir, no alcanza con tener UNA maestra. Rotar sube la época y
    // borra todas las envolturas; una máquina que se quedara con la vieja descifraría basura
    // y concluiría que la base está corrupta, que es un diagnóstico mucho peor que el real.
    if (propio.master && propio.keyEpoch === remoto.keyEpoch) {
      return { estado: 'lista', keyEpoch: remoto.keyEpoch }
    }

    // Enrolar es idempotente del lado del servidor: republicar la misma pública no rompe
    // nada, y es lo que hace que una máquina que estuvo apagada durante una rotación vuelva
    // sola a la cola de autorización.
    await d.enrolar(propio.device.publicKey)
    const conSobre = await d.estadoRemoto()
    if (!conSobre.wrap) {
      return { estado: 'esperando-autorizacion', huella: d.huella(propio.device.publicKey) }
    }

    const maestra = d.desenvolver(propio.device.privateKey, conSobre.wrap.wrapped).toString('base64')
    d.guardarMaestra(maestra, conSobre.keyEpoch)
    return { estado: 'lista', keyEpoch: conSobre.keyEpoch }
  } catch (err) {
    // Un error acá NO se traduce a «esperando autorización»: el usuario se quedaría mirando
    // una huella y esperando a alguien que ya autorizó. Se dice que falló y por qué.
    return { estado: 'error', detalle: err instanceof Error ? err.message : String(err) }
  }
}
