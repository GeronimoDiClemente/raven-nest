// Dónde está la base y qué se puede hacer con ella, sin tocar la red. Vive acá (y no en
// `cli-del-paquete.ts`) para que la TUI y el CLI decidan la base con el mismo código.
import { homedir } from 'os'
import { existsSync } from 'fs'
import { decidirBase } from './base-para-el-paquete'
import { buscarNestVivo } from './nest-vivo-del-paquete'
import { readActivePointer } from './memory-active-store'
import { ravenHome } from './raven-home'

/**
 * Lo de Nest se busca bajo `ravenHome()` y no bajo `homedir()`: adentro de una terminal de
 * Nest el HOME está redirigido a la carpeta de la cuenta (`~/.raven-nest/accounts/...`), y
 * con `homedir()` el paquete no encontraría ni el puntero ni el pipe — parecería no haber
 * Nest justo en la máquina donde está abierto.
 */
export async function dondeEstaLaBase() {
  const raven = ravenHome()
  return decidirBase({
    home: homedir(),
    existe: (p) => existsSync(p),
    nestVivo: await buscarNestVivo(process.env, raven, process.platform === 'win32'),
    // El mismo puntero que Nest escribe, y no una heurística nuestra: adivinar cuál base es
    // la buena cuando hay varias cuentas es exactamente la clase de cosa que un día devuelve
    // las memorias de otra persona.
    punteroDeNest: () => readActivePointer(raven)?.storePath ?? null,
  })
}
