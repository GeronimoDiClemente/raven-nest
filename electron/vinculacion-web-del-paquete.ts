// La mitad web de `npx @nestmux/memory login` (spec 2026-11-02-login-y-compra-sin-nest §1).
//
// La terminal no puede abrir un login, así que imprime un link a `nestmux.com/link` con el
// código y —si hay dónde— abre el navegador. Lo que se puede equivocar está acá y probado; la
// CLI sólo imprime lo que esto arma.
//
// Sin dependencias nativas (ver `paquete-sin-nativas.test.ts`): `child_process` es de Node.
import { spawn } from 'child_process'
import { normalizarBaseDeSync } from './base-de-sync'

/** La página por defecto. Override por `NEST_MEMORY_WEB_URL`, igual que el sync por `NEST_MEMORY_SYNC_URL`. */
export const BASE_WEB_POR_DEFECTO = 'https://nestmux.com'

/**
 * La misma normalización que la base del sync: sólo http(s) y sin barra final. Un env con
 * `file:` o `javascript:` no puede convertirse en algo que la CLI le pasa al abridor del sistema.
 */
export function webDelPaquete(env: string | undefined): string {
  return normalizarBaseDeSync(env) ?? BASE_WEB_POR_DEFECTO
}

export function urlDeVinculacion(baseWeb: string, codigo: string): string {
  return `${baseWeb}/link?code=${encodeURIComponent(codigo)}`
}

export function urlDeUpgrade(baseWeb: string): string {
  return `${baseWeb}/upgrade`
}

/** Las tres líneas del spec §1. Quien llama les pone la sangría. */
export function textoDeVinculacion(e: { url: string; codigo: string; venceEnSeg: number }): string[] {
  const minutos = Math.max(1, Math.round(e.venceEnSeg / 60))
  return [
    'To connect this machine, open:',
    `  ${e.url}`,
    `and sign in with your Nest account. Code: ${e.codigo} (expires in ${minutos} ${minutos === 1 ? 'minute' : 'minutes'})`,
  ]
}

/** El cuerpo de `/v1/link/start`: lo que la página muestra para que la persona reconozca su máquina. */
export function cuerpoDeInicio(nombre: string, plataforma: string): { name: string; platform: string } {
  return { name: nombre, platform: plataforma }
}

/**
 * Si tiene sentido intentar abrir un navegador ACÁ. Por SSH abriría (con suerte) uno en la
 * máquina remota, que nadie está mirando; en un Linux sin pantalla, nada.
 */
export function hayDondeAbrir(env: Record<string, string | undefined>, plataforma: NodeJS.Platform): boolean {
  if (env.SSH_CONNECTION || env.SSH_TTY) return false
  if (plataforma === 'linux') return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY)
  return true
}

/**
 * Sin shell en ningún sistema: la URL viaja como argumento suelto y no se interpreta. Por eso
 * en Windows no es `start` (un builtin de `cmd.exe`) sino el manejador de URLs de rundll32.
 */
export function comandoParaAbrir(plataforma: NodeJS.Platform, url: string): { cmd: string; args: string[] } {
  if (plataforma === 'win32') return { cmd: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
  if (plataforma === 'darwin') return { cmd: 'open', args: [url] }
  return { cmd: 'xdg-open', args: [url] }
}

export interface ProcesoLanzado {
  on(evento: 'error', cb: (err: Error) => void): unknown
  unref(): void
}
export type Lanzador = (cmd: string, args: string[]) => ProcesoLanzado

const lanzarDesacoplado: Lanzador = (cmd, args) =>
  spawn(cmd, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: true })

/**
 * Intenta abrir `url`. **Nunca lanza**: el link ya está impreso, así que un navegador que no
 * aparece no es un error — la persona lo abre a mano en cualquier dispositivo.
 */
export function abrirNavegador(url: string, plataforma: NodeJS.Platform, lanzar: Lanzador = lanzarDesacoplado): boolean {
  try {
    const { cmd, args } = comandoParaAbrir(plataforma, url)
    const hijo = lanzar(cmd, args)
    // Sin este listener, un `ENOENT` (no hay xdg-open) llega como evento 'error' sin dueño y
    // tumba el proceso en medio de la espera.
    hijo.on('error', () => { /* sin navegador: el link ya está impreso */ })
    hijo.unref()
    return true
  } catch {
    return false
  }
}

export interface DepsDeInicio {
  /** La base del servicio de sync (`/v1/link/start` cuelga de acá). */
  base: string
  baseWeb: string
  nombre: string
  plataforma: NodeJS.Platform
  env: Record<string, string | undefined>
  fetch: typeof fetch
  /** Abre el navegador. Inyectado para probar el cableado sin lanzar nada. */
  abrir: (url: string) => unknown
  imprimir: (linea: string) => void
  /** Atenúa la nota final (el estilo de la CLI). */
  tenue: (texto: string) => string
}

export type ResultadoDeInicio =
  | { ok: true; codigo: string; deviceCode: string; venceEnSeg: number | undefined; intervaloSeg: number | undefined }
  | { ok: false; motivo: 'http'; status: number }
  | { ok: false; motivo: 'ilegible' }

/**
 * El arranque del `login`: pide el código mandando nombre y sistema, imprime el link y —si hay
 * dónde— intenta abrir el navegador. Un abridor que falla o tira NO corta: el link ya está
 * impreso y quien llama sigue con la espera.
 */
export async function iniciarVinculacion(d: DepsDeInicio): Promise<ResultadoDeInicio> {
  const inicio = await d.fetch(`${d.base}/v1/link/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // El nombre y el sistema los muestra la página que aprueba: así la persona reconoce SU
    // máquina y no aprueba un código que le mandó otro.
    body: JSON.stringify(cuerpoDeInicio(d.nombre, d.plataforma)),
  })
  if (!inicio.ok) return { ok: false, motivo: 'http', status: inicio.status }
  const a = (await inicio.json()) as {
    user_code?: string; device_code?: string; expires_in?: number; interval?: number
  }
  if (!a.user_code || !a.device_code) return { ok: false, motivo: 'ilegible' }

  const url = urlDeVinculacion(d.baseWeb, a.user_code)
  for (const linea of textoDeVinculacion({ url, codigo: a.user_code, venceEnSeg: a.expires_in ?? 600 })) {
    d.imprimir(`  ${linea}`)
  }
  d.imprimir(`  ${d.tenue('No browser here? Open the link on any device, or approve the code from Nest › Memory settings.')}`)
  d.imprimir('')
  if (hayDondeAbrir(d.env, d.plataforma)) {
    try { d.abrir(url) } catch { /* el link está impreso: se sigue esperando */ }
  }
  return { ok: true, codigo: a.user_code, deviceCode: a.device_code, venceEnSeg: a.expires_in, intervaloSeg: a.interval }
}
