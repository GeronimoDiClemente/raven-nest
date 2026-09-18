// Guardar las claves del cifrado sin Electron y sin compilar nada.
//
// El paquete portátil corre bajo Node pelado, así que no tiene `electron.safeStorage`. Y no
// puede simplemente escribir la maestra en un archivo con permisos 0600: `memory-key-store.ts`
// **lanza** cuando no hay cifrado del sistema, y el motivo está escrito ahí — «guardar una
// clave maestra en texto plano sería peor que no cifrar nada, porque la promesa de la landing
// pasaría a ser falsa». Esa invariante no se negocia por conveniencia del paquete.
//
// La salida es la misma que usa Electron por debajo, sólo que por línea de comandos en vez de
// por API nativa: **el llavero del sistema operativo**. En el llavero vive una clave al azar
// de 32 bytes, y con ella se cifra el archivo con AES-256-GCM. O sea que `keys.bin` sigue
// siendo ilegible sin la sesión del usuario, igual que en Nest.
//
// | | qué se usa | viene con el sistema |
// |---|---|---|
// | macOS | `security add/find/delete-generic-password` | sí |
// | Windows | DPAPI por PowerShell | sí |
// | Linux | `secret-tool` (libsecret) | no siempre |
//
// **Cuando no hay llavero, no hay cifrado, y eso NO es un error del paquete**: significa que
// esta máquina puede guardar y buscar lo local pero no puede abrir lo cifrado de la nube, que
// es un estado que el §7 del spec ya describe como legítimo. Falla cerrado por diseño.
//
// > **Verificado de verdad sólo en macOS** (2026-09-18, contra el `security` real de la
// > máquina donde se escribió). Las recetas de Windows y Linux están escritas contra su
// > documentación pero no ejecutadas; si alguna está mal, `disponible()` da `false` y el
// > paquete queda en modo local, que es la falla segura y no una corrupción.
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { execFileSync } from 'child_process'
import type { SafeStorageLike } from './memory-key-store'

/** Bajo qué nombre se guarda en el llavero del sistema. */
export const SERVICIO = 'nest-memory'

/** La entrada del llavero que guarda la clave con la que se cifra `keys.bin`. */
export const CUENTA_DE_LA_CLAVE = 'local-encryption-key'

/**
 * Correr un comando del sistema. Inyectado para que todo esto se pueda probar sin tocar el
 * llavero real de nadie.
 *
 * `entrada` es lo que se le manda por stdin, y existe por una razón de seguridad concreta:
 * los argumentos de un proceso los ve cualquier usuario de la máquina con un `ps`, así que un
 * secreto pasado como argumento queda expuesto mientras el comando corre.
 */
export type CorrerComando = (
  comando: string,
  args: string[],
  entrada?: string,
) => { ok: boolean; salida: string }

/**
 * El `CorrerComando` de verdad.
 *
 * Nunca lanza: un comando que no existe, uno que falla y uno que devuelve un código distinto
 * de cero son todos «no se pudo», y quien llama ya sabe qué hacer con eso — dar `null` al
 * leer, o `false` en `disponible()`. Dejar que una excepción de `execFileSync` suba apagaría
 * la memoria entera por un llavero ausente.
 */
export const correrComando: CorrerComando = (comando, args, entrada) => {
  try {
    const salida = execFileSync(comando, args, {
      input: entrada,
      encoding: 'utf8',
      // El llavero puede abrir un diálogo del sistema; sin techo, un prompt que nadie
      // contesta cuelga al proceso para siempre.
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { ok: true, salida: typeof salida === 'string' ? salida : '' }
  } catch (err) {
    // `security find-generic-password` sale con 44 cuando el ítem no está, y eso no es un
    // fallo: es la respuesta. Por eso el mensaje se devuelve igual, para que quien llama
    // pueda distinguir si le interesa.
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, salida: (e.stdout ?? e.stderr ?? e.message ?? '').toString() }
  }
}

export interface LlaveroDelSistema {
  disponible(): boolean
  leer(cuenta: string): string | null
  guardar(cuenta: string, secreto: string): void
  borrar(cuenta: string): void
}

function llaveroDeMac(correr: CorrerComando): LlaveroDelSistema {
  return {
    disponible: () => correr('security', ['list-keychains']).ok,
    leer(cuenta) {
      const r = correr('security', ['find-generic-password', '-a', cuenta, '-s', SERVICIO, '-w'])
      return r.ok ? r.salida.trim() : null
    },
    guardar(cuenta, secreto) {
      // `-w` SIN valor hace que `security` pida el secreto por stdin — y lo pida DOS VECES,
      // porque además lo confirma («password data for new item: retype password for new
      // item:»). Mandarlo una sola vez guarda una entrada VACÍA sin dar error, que es la
      // peor forma de fallar: el llavero queda escrito y lo que se lee después es ''.
      // Verificado contra el `security` real; un test de integración lo fija.
      //
      // El secreto no va como argumento a propósito: `ps` muestra los argumentos de
      // cualquier proceso a cualquier usuario de la máquina. `-U` actualiza si ya existe,
      // en vez de fallar con "item already exists".
      correr('security', ['add-generic-password', '-a', cuenta, '-s', SERVICIO, '-U', '-w'], `${secreto}\n${secreto}\n`)
    },
    borrar(cuenta) {
      correr('security', ['delete-generic-password', '-a', cuenta, '-s', SERVICIO])
    },
  }
}

function llaveroDeLinux(correr: CorrerComando): LlaveroDelSistema {
  return {
    disponible: () => correr('secret-tool', ['--version']).ok,
    leer(cuenta) {
      const r = correr('secret-tool', ['lookup', 'service', SERVICIO, 'account', cuenta])
      return r.ok && r.salida !== '' ? r.salida.trim() : null
    },
    guardar(cuenta, secreto) {
      // Una sola vez, al revés que `security`: `secret-tool store` lee stdin hasta el EOF y
      // no confirma nada.
      correr('secret-tool', ['store', '--label', SERVICIO, 'service', SERVICIO, 'account', cuenta], secreto)
    },
    borrar(cuenta) {
      correr('secret-tool', ['clear', 'service', SERVICIO, 'account', cuenta])
    },
  }
}

/**
 * En Windows no hay un llavero con esta forma, pero hay DPAPI, que es lo que Electron usa
 * ahí abajo: cifra contra las credenciales de la sesión del usuario. Se guarda el blob
 * cifrado en el registro de usuario, que es escribible sin permisos de administrador.
 */
function llaveroDeWindows(correr: CorrerComando): LlaveroDelSistema {
  const clave = `HKCU:\\Software\\${SERVICIO}`
  const ps = (script: string, entrada?: string) =>
    correr('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], entrada)
  return {
    disponible: () => ps('exit 0').ok,
    leer(cuenta) {
      const r = ps(
        `$v = (Get-ItemProperty -Path '${clave}' -Name '${cuenta}' -ErrorAction SilentlyContinue).'${cuenta}';` +
        `if ($null -eq $v) { exit 1 };` +
        `$s = ConvertTo-SecureString $v;` +
        `[Runtime.InteropServices.Marshal]::PtrToStringAuto(` +
        `[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))`
      )
      return r.ok && r.salida.trim() !== '' ? r.salida.trim() : null
    },
    guardar(cuenta, secreto) {
      ps(
        `$p = [Console]::In.ReadToEnd().Trim();` +
        `$e = ConvertFrom-SecureString (ConvertTo-SecureString $p -AsPlainText -Force);` +
        `New-Item -Path '${clave}' -Force | Out-Null;` +
        `Set-ItemProperty -Path '${clave}' -Name '${cuenta}' -Value $e`,
        secreto
      )
    },
    borrar(cuenta) {
      ps(`Remove-ItemProperty -Path '${clave}' -Name '${cuenta}' -ErrorAction SilentlyContinue`)
    },
  }
}

/** Un llavero que nunca está disponible, para una plataforma que no sabemos manejar. */
const SIN_LLAVERO: LlaveroDelSistema = {
  disponible: () => false,
  leer: () => null,
  guardar: () => { /* no hay dónde */ },
  borrar: () => { /* no hay qué */ },
}

export function llaveroPorPlataforma(plataforma: NodeJS.Platform, correr: CorrerComando): LlaveroDelSistema {
  if (plataforma === 'darwin') return llaveroDeMac(correr)
  if (plataforma === 'linux') return llaveroDeLinux(correr)
  if (plataforma === 'win32') return llaveroDeWindows(correr)
  // Inventar un comando para una plataforma que no conocemos terminaría en un `disponible()`
  // que da true y un `leer()` que devuelve basura. Mejor decir que no hay.
  return SIN_LLAVERO
}

const LARGO_DE_CLAVE = 32
const LARGO_DE_NONCE = 12

/**
 * Un `SafeStorageLike` —lo que `memory-key-store.ts` ya sabe consumir— cuya clave vive en el
 * llavero del sistema.
 *
 * Es la misma arquitectura que `electron.safeStorage`: el archivo se cifra con una clave que
 * no está en el archivo, y esa clave la guarda el sistema operativo atada a la sesión del
 * usuario. Lo que cambia es cómo se llega al llavero, no la propiedad que se obtiene.
 */
export function cifradoDeLlavero(llavero: LlaveroDelSistema): SafeStorageLike {
  const clave = (): Buffer => {
    const guardada = llavero.leer(CUENTA_DE_LA_CLAVE)
    if (guardada) {
      const bytes = Buffer.from(guardada, 'base64')
      if (bytes.length === LARGO_DE_CLAVE) return bytes
      // Una entrada del largo equivocado es basura, no una clave: regenerar es lo único
      // sensato, y el costo es que haya que volver a autorizar esta máquina.
    }
    const nueva = randomBytes(LARGO_DE_CLAVE)
    llavero.guardar(CUENTA_DE_LA_CLAVE, nueva.toString('base64'))
    return nueva
  }

  return {
    isEncryptionAvailable: () => llavero.disponible(),

    encryptString(texto) {
      // Lanza en vez de devolver el texto: quien llama (`saveKeyMaterial`) toma esto como la
      // señal de que no hay dónde guardar una maestra, y devolverle algo legible lo haría
      // escribirla en claro creyendo que la cifró.
      if (!llavero.disponible()) {
        throw new Error('No system keyring available — keys are never written in the clear')
      }
      const nonce = randomBytes(LARGO_DE_NONCE)
      const c = createCipheriv('aes-256-gcm', clave(), nonce)
      const cuerpo = Buffer.concat([c.update(texto, 'utf8'), c.final()])
      // nonce ‖ tag ‖ cuerpo. El nonce por operación es lo que hace que dos textos iguales
      // no den los mismos bytes.
      return Buffer.concat([nonce, c.getAuthTag(), cuerpo])
    },

    decryptString(cifrado) {
      const nonce = cifrado.subarray(0, LARGO_DE_NONCE)
      const tag = cifrado.subarray(LARGO_DE_NONCE, LARGO_DE_NONCE + 16)
      const cuerpo = cifrado.subarray(LARGO_DE_NONCE + 16)
      const d = createDecipheriv('aes-256-gcm', clave(), nonce)
      d.setAuthTag(tag)
      // GCM verifica el tag en `final()`: un archivo manoseado lanza en vez de devolver
      // medio texto, que es lo que hace que `loadKeyMaterial` lo trate como "no hay claves".
      return Buffer.concat([d.update(cuerpo), d.final()]).toString('utf8')
    },
  }
}
