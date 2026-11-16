// El cableado real de `status` y `doctor` del paquete, compartido por el CLI y la TUI para que
// los dos lean el estado exactamente igual.
import { homedir, userInfo } from 'os'
import type { DecisionDeBase } from './base-para-el-paquete'
import type { DependenciasDeStatus } from './status-del-paquete'
import type { DependenciasDeDoctor } from './doctor-del-paquete'
import { abrirBaseSoloLectura } from './sqlite-sin-compilar'
import { llaveroPorPlataforma, correrComando } from './llavero-del-sistema'
import { leerCredencial } from './credencial-del-paquete'
import { loadKeyMaterial } from './memory-key-store'
import { readActivePointer } from './memory-active-store'
import { ravenHome } from './raven-home'
import { cifradoDelSistema, urlDelServicio, urlDeUpgradeDelPaquete } from './sync-del-paquete-tras-escribir'

export function dependenciasDeStatus(base: DecisionDeBase): DependenciasDeStatus {
  const llavero = cifradoDelSistema()
  // Una sola lectura: en macOS `security` puede pedir el secreto en cada una.
  let credencialLeida: ReturnType<typeof leerCredencial> | undefined
  const credencial = () => (credencialLeida ??= leerCredencial(homedir(), llavero))
  return {
    home: homedir(),
    homes: [homedir(), userInfo().homedir],
    base,
    abrirSoloLectura: abrirBaseSoloLectura,
    llaveroDisponible: llavero.isEncryptionAvailable(),
    credencial,
    tieneMaestra: () => Boolean(loadKeyMaterial(homedir(), null, llavero)?.master),
    urlDelServicio,
    urlUpgrade: urlDeUpgradeDelPaquete(),
  }
}

export function dependenciasDeDoctor(base: DecisionDeBase): DependenciasDeDoctor {
  return {
    home: homedir(),
    homeReal: userInfo().homedir,
    homes: [homedir(), userInfo().homedir],
    versionDeNode: process.version,
    base,
    hayPunteroDeNest: readActivePointer(ravenHome()) !== null,
    llaveroDisponible: llaveroPorPlataforma(process.platform, correrComando).disponible(),
    abrirSoloLectura: abrirBaseSoloLectura,
  }
}
