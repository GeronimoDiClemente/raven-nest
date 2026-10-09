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
// > **Verificado de verdad en macOS** (2026-09-18, contra el `security` real) **y en
// > Windows** (2026-10-02, Windows 11: lo guardado en el registro es un blob de DPAPI —
// > empieza con `01000000d08c9ddf…`— y no contiene el texto). Ver `llavero-real.test.ts`.
// > **Y en Linux** (2026-10-08, Ubuntu 26.04 en WSL con gnome-keyring: store, lookup,
// > actualizar y clear contra el binario real). Si no hay servicio de secretos, `disponible()`
// > da `false` y el paquete queda en modo local, que es la falla segura. Desde el
// > 2026-10-09 eso se decide antes de sondear (sin bus, o el bus dice que no hay servicio o
// > no hay colección por defecto): pasó de 10–30 s a 0–60 ms, o 2 s si el servicio se cuelga
// > al activarse. Y en un escritorio sin colección por defecto ya no se corre `store`, que le
// > abría al usuario el diálogo de gnome-keyring «Choose password for new keyring».
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
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
    //
    // `||` y no `??`: cuando el comando corre y falla, `stdout` es '' (no undefined), y con
    // `??` el stderr se perdía siempre. `dbus-send` escribe el error del bus SÓLO en stderr, y
    // la sonda de Linux necesita leerlo para distinguir «el bus dijo que no» de «no está
    // dbus-send».
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, salida: (e.stdout || e.stderr || e.message || '').toString() }
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

/** La entrada que usa la sonda de Linux. Se borra apenas se lee. */
const CUENTA_DE_LA_SONDA = '__sonda__'

/**
 * Lo que la sonda de Linux mira del entorno antes de correr nada. Inyectado por lo mismo que
 * `CorrerComando`: para probar el «no hay bus» sin depender de la máquina que corre el test.
 */
export interface EntornoDelLlavero {
  env: NodeJS.ProcessEnv
  existe: (ruta: string) => boolean
}

const ENTORNO_REAL: EntornoDelLlavero = { env: process.env, existe: existsSync }

/**
 * Cuánto se le espera al servicio de secretos en la pregunta previa. Contra un gnome-keyring
 * que ya corre contesta en ~5 ms; lo que puede tardar es la ACTIVACIÓN por D-Bus (KDE levanta
 * su servicio recién cuando alguien lo pide), y 2 s le sobra. Un keyring que se cuelga al
 * activarse —medido en WSL con `dbus-run-session`— cuesta esto y no 30 s.
 */
const ESPERA_DEL_BUS_MS = 2000

/**
 * Errores con los que el bus dice, sin ambigüedad, que ahí no hay un servicio de secretos que
 * vaya a contestar: nadie lo provee, no se pudo activar, no contestó a tiempo, o ni siquiera
 * hay bus. Cualquier OTRO fallo de `dbus-send` (que no esté instalado, un error que no
 * conocemos) no prueba nada, y entonces se cae a la sonda de siempre.
 */
const EL_BUS_DIJO_QUE_NO =
  /org\.freedesktop\.DBus\.Error\.(ServiceUnknown|NameHasNoOwner|NoReply|Spawn\.\w+)|Failed to open connection to "session" message bus/

/** Si hay un bus de sesión al que `secret-tool` se pueda conectar. */
function hayBusDeSesion({ env, existe }: EntornoDelLlavero): boolean {
  if (env.DBUS_SESSION_BUS_ADDRESS) return true
  // Sin la variable, GDBus (lo que usa libsecret) prueba `$XDG_RUNTIME_DIR/bus`, que es donde
  // systemd deja el bus de usuario. El autolaunch por X11 que queda después levantaría un bus
  // privado y vacío, sin ningún llavero desbloqueado: para esto es lo mismo que no tener bus.
  const runtime = env.XDG_RUNTIME_DIR
  return !!runtime && existe(`${runtime}/bus`)
}

/**
 * Preguntarle al servicio de secretos cuál es su colección por defecto, que es donde
 * `secret-tool store` escribe. `true`/`false` cuando la respuesta alcanza para decidir, `null`
 * cuando no prueba nada y hay que hacer la sonda completa.
 */
function preguntarAlBus(correr: CorrerComando): boolean | null {
  const r = correr('dbus-send', [
    '--session', '--print-reply', `--reply-timeout=${ESPERA_DEL_BUS_MS}`,
    '--dest=org.freedesktop.secrets', '/org/freedesktop/secrets',
    'org.freedesktop.Secret.Service.ReadAlias', 'string:default',
  ])
  if (!r.ok) return EL_BUS_DIJO_QUE_NO.test(r.salida) ? false : null
  const ruta = /object path "([^"]*)"/.exec(r.salida)?.[1]
  // «/» es la ruta nula de D-Bus: el servicio corre pero no tiene colección por defecto. Es
  // lo que da el gnome-keyring que systemd activa en un WSL o un servidor pelado, y ahí
  // `store` falla igual después de 3,5–7,6 s («Object does not exist at path …/login»).
  if (ruta === '/') return false
  // Hay colección (desbloqueada o no) o una respuesta que no entendemos: lo dice la sonda.
  return null
}

function llaveroDeLinux(correr: CorrerComando, entorno: EntornoDelLlavero): LlaveroDelSistema {
  let hayLlavero: boolean | null = null
  return {
    // Hasta el 2026-10-08 esto era `secret-tool --version`, que NO existe: sale 2 con el
    // texto de uso, así que el cifrado no se activaba nunca en Linux. Tampoco sirve un
    // comando de sólo lectura: `search` sale 0 haya o no servicio de secretos (medido en
    // Ubuntu 26.04 con gnome-keyring). Lo único que lo prueba es guardar, leer y borrar.
    // Son tres procesos, y sin servicio cada uno puede colgarse hasta el timeout: se mide una
    // vez por proceso. Si el llavero aparece después, lo ve el próximo arranque.
    //
    // Antes de la sonda se descarta lo que se puede descartar barato, porque un Linux sin
    // llavero (un servidor, un WSL pelado) pagaba hasta 30 s en CADA arranque del paquete:
    // sin bus de sesión no hay nada que sondear, y si el bus dice que el servicio no existe,
    // no se activa o no tiene colección, tampoco. Todo lo que no es un «no» claro —incluido
    // que falte `dbus-send`— sigue yendo a la sonda, así que esto no puede inventar un «sí».
    disponible() {
      if (hayLlavero !== null) return hayLlavero
      if (!hayBusDeSesion(entorno) || preguntarAlBus(correr) === false) {
        hayLlavero = false
        return hayLlavero
      }
      const centinela = randomBytes(8).toString('hex')
      correr('secret-tool', ['store', '--label', SERVICIO, 'service', SERVICIO, 'account', CUENTA_DE_LA_SONDA], centinela)
      const r = correr('secret-tool', ['lookup', 'service', SERVICIO, 'account', CUENTA_DE_LA_SONDA])
      correr('secret-tool', ['clear', 'service', SERVICIO, 'account', CUENTA_DE_LA_SONDA])
      hayLlavero = r.ok && r.salida.trim() === centinela
      return hayLlavero
    },
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

export function llaveroPorPlataforma(
  plataforma: NodeJS.Platform,
  correr: CorrerComando,
  entorno: EntornoDelLlavero = ENTORNO_REAL,
): LlaveroDelSistema {
  if (plataforma === 'darwin') return llaveroDeMac(correr)
  if (plataforma === 'linux') return llaveroDeLinux(correr, entorno)
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
    // `guardar` no informa si falló (un llavero bloqueado, un diálogo que vence). Cifrar con
    // una clave que no quedó en ningún lado deja `keys.bin` ilegible en el próximo arranque,
    // o sea la maestra perdida. Se relee y, si no está, se lanza: quien llama ya trata el
    // lanzamiento como «no hay dónde guardar».
    if (llavero.leer(CUENTA_DE_LA_CLAVE) !== nueva.toString('base64')) {
      throw new Error('The system keyring did not keep the local encryption key')
    }
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
