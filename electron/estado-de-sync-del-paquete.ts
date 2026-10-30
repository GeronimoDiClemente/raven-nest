// La línea de `npx @nestmux/memory status` sobre la nube. Aparte de la CLI para poder probarla:
// `cli-del-paquete.ts` corre el comando apenas se importa.
import { comando } from './nombre-del-paquete'

/**
 * Qué decir sobre la nube en `status`. Las cuatro situaciones piden cosas distintas, y por eso
 * no se colapsan en «sincronizado / no sincronizado».
 */
export function lineaDeSync(e: {
  modo: 'nest' | 'propia'
  enCola: number
  hayCredencial: boolean
  /** La cuenta cifra y esta máquina todavía no tiene la maestra: el push está frenado (el
   *  gate fail-closed del daemon) hasta que la autoricen. */
  esperandoAutorizacion?: boolean
}): string {
  const cambios = `${e.enCola} ${e.enCola === 1 ? 'change' : 'changes'}`
  // La base de Nest la sincroniza Nest: el paquete no la sube con su credencial porque
  // podría ser de otra cuenta (ver `comandoMcp`).
  if (e.modo === 'nest') {
    return e.enCola > 0 ? `${cambios} waiting for Nest to sync them.` : 'Nest syncs this memory when it runs.'
  }
  if (!e.hayCredencial) {
    return e.enCola > 0
      ? `Local only — ${cambios} queued. Run \`${comando('login')}\` to sync them.`
      : `Local only. Run \`${comando('login')}\` to sync across machines.`
  }
  // `servicioDelPaquete` siempre resuelve a algo — env, lo guardado, o el default de Nest —
  // así que "sin servicio configurado" no es un estado alcanzable acá.
  // Va ANTES de la cola normal: con la cuenta cifrada y sin la maestra no sube nada, así que
  // prometer que sube «la próxima vez» deja al usuario esperando algo que no va a pasar.
  if (e.esperandoAutorizacion) {
    return `Connected — ${cambios} held until this machine is authorized to encrypt. ` +
      `Run \`${comando('login')}\` to see its fingerprint.`
  }
  return e.enCola > 0
    ? `Connected — ${cambios} waiting to sync. They go up the next time an agent saves a memory.`
    : 'Connected — everything is synced.'
}

/**
 * El paquete no tiene claves de equipo: una memoria de un equipo que cifra la retiene el gate
 * del daemon (`team_key_missing`). Con la base de Nest no importa —la sube Nest, que sí tiene
 * la clave—, pero con la base propia no la sube nadie: ni el paquete, ni Nest si después se
 * instala, porque `decidirBase` pasa a la base de Nest y la propia queda sin leer. Por eso la
 * línea dice que se quedan acá y no promete que "abrir Nest" las mande.
 */
export function lineaDeEquipoRetenido(e: { modo: 'nest' | 'propia'; retenidas: number }): string | null {
  if (e.modo !== 'propia' || e.retenidas <= 0) return null
  const cuantas = e.retenidas === 1 ? '1 team memory stays' : `${e.retenidas} team memories stay`
  return `${cuantas} on this machine only: this team encrypts, and team keys live in the Nest app, not in this package.`
}
