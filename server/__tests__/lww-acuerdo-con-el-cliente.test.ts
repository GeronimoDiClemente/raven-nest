/**
 * Las DOS implementaciones del desempate, comparadas entre sí.
 *
 * La regla vive escrita dos veces —`server/src/lww.ts` y `electron/memory-merge.ts`— y tiene
 * que dar lo mismo en las dos, porque cada réplica la calcula por su cuenta: si dejan de
 * coincidir, dos máquinas eligen ganadores distintos para el mismo tema y ninguna se entera.
 * Convergen a estados distintos, en silencio y para siempre.
 *
 * No están unificadas a propósito: el servidor no importa nada del cliente en producción, y
 * compartir el módulo convertiría un despliegue del servicio en un cambio de comportamiento
 * de todos los clientes instalados. El acuerdo se sostiene con este test, que es lo que
 * faltaba — hasta la cuarta revisión adversarial (2026-09-23) nada comparaba las dos, y las
 * dos tenían además el MISMO punto ciego: el escalón del lamport no lo probaba ninguna.
 */
import { describe, it, expect } from 'vitest'
import { resolveTopicCollision as delServidor } from '../src/lww'
import { resolveTopicCollision as delCliente } from '../../electron/memory-merge'

const c = (syncId: string, updatedAt: number, lamport: number) => ({ syncId, updatedAt, lamport })

/** Cada caso toca un escalón distinto, y los escalones se contradicen a propósito. */
const CASOS = [
  ['updatedAt manda sobre todo lo demás', c('z', 1, 99), c('a', 2, 0)],
  ['empate de updatedAt: manda el lamport, aunque el syncId diga lo contrario', c('a', 5, 2), c('z', 5, 1)],
  ['empate de updatedAt y lamport: manda el syncId', c('a', 5, 5), c('z', 5, 5)],
  ['empate total salvo el syncId, al revés', c('z', 5, 5), c('a', 5, 5)],
  ['lamport en cero de los dos lados', c('b', 7, 0), c('a', 7, 0)],
  ['updatedAt iguales y lamport muy separados', c('zzz', 100, 1), c('aaa', 100, 1000)],
] as const

describe('el desempate del servidor y el del cliente son el mismo', () => {
  for (const [nombre, x, y] of CASOS) {
    it(nombre, () => {
      expect(delServidor(x, y).winner.syncId).toBe(delCliente(x, y).winner.syncId)
      // Y en el otro orden, que es como llegan cuando la colisión la detecta la otra máquina.
      expect(delServidor(y, x).winner.syncId).toBe(delCliente(y, x).winner.syncId)
      // El ganador no puede depender del orden en el que se miran los dos candidatos.
      expect(delServidor(x, y).winner.syncId).toBe(delServidor(y, x).winner.syncId)
    })
  }

  it('el perdedor es siempre el otro, en las dos implementaciones', () => {
    const [, x, y] = CASOS[1]
    for (const resolver of [delServidor, delCliente]) {
      const r = resolver(x, y)
      expect(r.loser.syncId).not.toBe(r.winner.syncId)
      expect([x.syncId, y.syncId]).toContain(r.loser.syncId)
    }
  })
})
