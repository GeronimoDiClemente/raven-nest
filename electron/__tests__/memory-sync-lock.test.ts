import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { writeFileSync, existsSync, readFileSync } from 'fs'
import { makeTmpDir, cleanupTmp } from './setup'
import {
  tomarCandadoDeSync, leerCandado, candadoDepsDelProceso, lockPathParaBase,
  type CandadoDeps,
} from '../memory-sync-lock'

/**
 * §6.3 del spec `2026-09-13-nest-memory-portable-design.md`: un candado por base que
 * toma quien va a SINCRONIZAR. Quien lo encuentra vivo escribe local y encola.
 *
 * Cubre tres casos que hoy están abiertos: dos Nest (la app instalada y un build de
 * desarrollo comparten `~/.raven-nest` — ya pasa, sin paquete portátil de por medio),
 * Nest + paquete, y dos paquetes.
 */
describe('candado de sincronización', () => {
  let dir: string
  let lockPath: string

  beforeEach(() => {
    dir = makeTmpDir()
    lockPath = join(dir, 'sync.lock')
  })
  afterEach(() => cleanupTmp(dir))

  /** Deps con reloj y sonda de PID inyectados, para no depender de procesos reales. */
  const deps = (over: Partial<CandadoDeps> = {}): CandadoDeps => ({
    pid: 1000,
    host: 'maquina-a',
    now: () => 10_000,
    pidVivo: () => true,
    ttlMs: 60_000,
    ...over,
  })

  it('sin candado previo lo toma y deja el pid, el host y el momento en el archivo', () => {
    const r = tomarCandadoDeSync(lockPath, deps())

    expect(r.ok).toBe(true)
    expect(existsSync(lockPath)).toBe(true)
    expect(JSON.parse(readFileSync(lockPath, 'utf8'))).toEqual({
      pid: 1000, host: 'maquina-a', at: 10_000,
    })
  })

  it('con un candado VIVO del mismo host no lo toma, y dice quién lo tiene', () => {
    writeFileSync(lockPath, JSON.stringify({ pid: 777, host: 'maquina-a', at: 9_000 }))

    const r = tomarCandadoDeSync(lockPath, deps({ pidVivo: (pid) => pid === 777 }))

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.holder).toEqual({ pid: 777, host: 'maquina-a', at: 9_000 })
    // Y no lo pisó: el archivo sigue siendo del otro.
    expect(leerCandado(lockPath)?.pid).toBe(777)
  })

  it('un candado del mismo host con un PID que ya no existe está muerto: lo roba', () => {
    writeFileSync(lockPath, JSON.stringify({ pid: 777, host: 'maquina-a', at: 9_000 }))

    const r = tomarCandadoDeSync(lockPath, deps({ pidVivo: () => false }))

    expect(r.ok).toBe(true)
    expect(leerCandado(lockPath)?.pid).toBe(1000)
  })

  // El directorio de memoria se sincroniza entre máquinas, así que un candado puede
  // venir de OTRA máquina — donde el PID no significa nada local. Ahí la única señal
  // que queda es la antigüedad.
  it('un candado de otro host todavía fresco se respeta: su PID no se puede sondear', () => {
    writeFileSync(lockPath, JSON.stringify({ pid: 1000, host: 'maquina-b', at: 9_000 }))

    // Mismo pid que el nuestro y pidVivo=false: si mirara el PID, lo robaría.
    const r = tomarCandadoDeSync(lockPath, deps({ pidVivo: () => false }))

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.holder.host).toBe('maquina-b')
  })

  it('un candado de otro host vencido por antigüedad se toma', () => {
    writeFileSync(lockPath, JSON.stringify({ pid: 1000, host: 'maquina-b', at: 9_000 }))

    const r = tomarCandadoDeSync(lockPath, deps({ now: () => 9_000 + 60_001 }))

    expect(r.ok).toBe(true)
    expect(leerCandado(lockPath)?.host).toBe('maquina-a')
  })

  it('un archivo de candado ilegible se considera muerto, no bloquea para siempre', () => {
    writeFileSync(lockPath, 'no es json {{{')

    const r = tomarCandadoDeSync(lockPath, deps())

    expect(r.ok).toBe(true)
    expect(leerCandado(lockPath)?.pid).toBe(1000)
  })

  it('release borra el archivo, para que el siguiente no espere el ttl', () => {
    const r = tomarCandadoDeSync(lockPath, deps())
    if (!r.ok) throw new Error('debería haberlo tomado')

    r.lock.release()

    expect(existsSync(lockPath)).toBe(false)
  })

  it('heartbeat refresca el momento, así un sync largo no se lo roban por antigüedad', () => {
    let ahora = 10_000
    const r = tomarCandadoDeSync(lockPath, deps({ now: () => ahora }))
    if (!r.ok) throw new Error('debería haberlo tomado')

    ahora = 50_000
    r.lock.heartbeat()

    expect(leerCandado(lockPath)?.at).toBe(50_000)
    // Y ahora otra máquina ya no lo ve vencido.
    const otra = tomarCandadoDeSync(lockPath, deps({
      host: 'maquina-b', pid: 2000, now: () => 60_000, pidVivo: () => false,
    }))
    expect(otra.ok).toBe(false)
  })

  it('heartbeat de un candado que otro ya robó no se lo pisa', () => {
    const r = tomarCandadoDeSync(lockPath, deps())
    if (!r.ok) throw new Error('debería haberlo tomado')
    // Otro proceso nos vio muertos y lo tomó.
    writeFileSync(lockPath, JSON.stringify({ pid: 2000, host: 'maquina-b', at: 20_000 }))

    r.lock.heartbeat()

    expect(leerCandado(lockPath)).toEqual({ pid: 2000, host: 'maquina-b', at: 20_000 })
  })

  it('release de un candado que otro ya robó no borra el del otro', () => {
    const r = tomarCandadoDeSync(lockPath, deps())
    if (!r.ok) throw new Error('debería haberlo tomado')
    // Otro proceso lo roba (nuestro pid dejó de existir para él).
    writeFileSync(lockPath, JSON.stringify({ pid: 2000, host: 'maquina-b', at: 20_000 }))

    r.lock.release()

    expect(existsSync(lockPath)).toBe(true)
    expect(leerCandado(lockPath)?.pid).toBe(2000)
  })
})

describe('las deps reales del proceso', () => {
  it('se ve viva a sí misma', () => {
    const d = candadoDepsDelProceso()
    expect(d.pid).toBe(process.pid)
    expect(d.pidVivo(process.pid)).toBe(true)
  })

  it('un pid que no existe está muerto', () => {
    const d = candadoDepsDelProceso()
    // Arriba del máximo de pid de macOS y Linux: nunca va a existir.
    expect(d.pidVivo(4_000_000)).toBe(false)
  })

  // process.kill(pid, 0) tira ESRCH si el proceso no existe, pero EPERM si existe y es de
  // OTRO usuario. Tratar EPERM como muerto haría que un Nest corriendo bajo otra cuenta del
  // sistema se considere abandonado y se le robe el candado.
  it('EPERM significa VIVO, no muerto', () => {
    const d = candadoDepsDelProceso({
      kill: () => { const e = new Error('no permitido') as NodeJS.ErrnoException; e.code = 'EPERM'; throw e },
    })
    expect(d.pidVivo(1)).toBe(true)
  })

  // `process.kill(0, 0)` NO pregunta por el pid 0: sondea el GRUPO de procesos del que
  // llama, así que siempre diría "vivo". Un candado corrupto con pid 0 (o negativo, que es
  // otro grupo) bloquearía la sincronización para siempre.
  it('un pid que no es positivo no se sondea: está muerto', () => {
    const d = candadoDepsDelProceso({
      kill: () => { throw new Error('no se debería haber llamado') },
    })
    expect(d.pidVivo(0)).toBe(false)
    expect(d.pidVivo(-1)).toBe(false)
  })

  it('ESRCH significa muerto', () => {
    const d = candadoDepsDelProceso({
      kill: () => { const e = new Error('no existe') as NodeJS.ErrnoException; e.code = 'ESRCH'; throw e },
    })
    expect(d.pidVivo(1)).toBe(false)
  })
})

describe('el path del candado', () => {
  it('va al lado de la base, no adentro', () => {
    expect(lockPathParaBase(join('a', 'b', 'memory.db'))).toBe(join('a', 'b', 'sync.lock'))
  })
})
