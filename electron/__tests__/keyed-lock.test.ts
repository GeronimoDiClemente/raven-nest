// El mutex que pide la review final junto con C2/I3: hasta ahora el unico disparador del
// hilo era un click humano, asi que dos pasadas sobre el mismo rootDir no podian coexistir.
// Con debounce + poll + arranque x N worktrees si pueden, y `applyVaultPlan` lee el
// manifest al empezar y lo escribe entero al final: dos pasadas intercaladas se pisan.
import { describe, it, expect } from 'vitest'
import { KeyedLock } from '../integrations/keyed-lock'

function diferido<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('KeyedLock', () => {
  it('LO QUE PROTEGE: dos pasadas sobre la MISMA clave no se intercalan', async () => {
    const lock = new KeyedLock()
    const traza: string[] = []
    const a = diferido<void>()

    const p1 = lock.run('root', async () => { traza.push('a-in'); await a.promise; traza.push('a-out') })
    const p2 = lock.run('root', async () => { traza.push('b-in'); traza.push('b-out') })

    // La segunda no arranco todavia: la primera sigue adentro.
    await Promise.resolve()
    expect(traza).toEqual(['a-in'])

    a.resolve()
    await Promise.all([p1, p2])
    expect(traza).toEqual(['a-in', 'a-out', 'b-in', 'b-out'])
  })

  it('claves distintas corren en paralelo: un repo no espera al otro', async () => {
    const lock = new KeyedLock()
    const traza: string[] = []
    const a = diferido<void>()

    const p1 = lock.run('root-a', async () => { traza.push('a-in'); await a.promise })
    const p2 = lock.run('root-b', async () => { traza.push('b-in') })

    await p2
    expect(traza).toEqual(['a-in', 'b-in'])
    a.resolve()
    await p1
  })

  it('una pasada que falla no traba la clave para siempre', async () => {
    const lock = new KeyedLock()

    await expect(lock.run('root', async () => { throw new Error('git exploto') })).rejects.toThrow('git exploto')
    await expect(lock.run('root', async () => 'la que sigue')).resolves.toBe('la que sigue')
  })

  it('el error viaja al caller que lo produjo, no al siguiente', async () => {
    const lock = new KeyedLock()
    const primera = lock.run('root', async () => { throw new Error('mia') })
    const segunda = lock.run('root', async () => 'ok')

    await expect(primera).rejects.toThrow('mia')
    await expect(segunda).resolves.toBe('ok')
  })

  it('no acumula claves: al drenar, la clave se suelta', async () => {
    const lock = new KeyedLock()
    await lock.run('root', async () => undefined)
    await Promise.resolve()
    expect(lock.size).toBe(0)
  })
})
