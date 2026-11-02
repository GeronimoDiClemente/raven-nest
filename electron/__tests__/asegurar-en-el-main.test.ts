// F4 y F9 de la review final del cifrado obligatorio: lo que el main hace con el resultado
// de `asegurarCifrado`.
import { describe, it, expect, vi } from 'vitest'
import { asegurarEnElMain, CUENTA_CAMBIO_DURANTE_ASEGURAR, type DepsDeAsegurarEnElMain } from '../asegurar-en-el-main'
import type { ResultadoDeAsegurar } from '../asegurar-cifrado'

function deps(resultado: ResultadoDeAsegurar, opts: { cuentaDespues?: string | null; guardarTira?: boolean } = {}) {
  let cuenta: string | null = 'user-a'
  const d = {
    cuentaActual: vi.fn(() => cuenta),
    asegurar: vi.fn(async () => {
      if (opts.cuentaDespues !== undefined) cuenta = opts.cuentaDespues
      return resultado
    }),
    tomarMaestra: vi.fn(),
    guardarClaves: vi.fn(() => { if (opts.guardarTira) throw new Error('safeStorage is locked') }),
    guardarCodigoPendiente: vi.fn(),
    aplicarHasher: vi.fn(),
    store: {
      backfillTopicHmacs: vi.fn(),
      rememberKeyEpoch: vi.fn(),
      resetPullCursors: vi.fn(),
      clearUndecryptable: vi.fn(),
      reencolarRechazadosPorCifrado: vi.fn(() => 0),
    },
    reuploadUnaVez: vi.fn(),
  } satisfies DepsDeAsegurarEnElMain
  return d
}

const ACTIVADA: ResultadoDeAsegurar = { estado: 'activada', master: 'm', keyEpoch: 1, recoveryCode: 'CODE' }
const ADOPTADA: ResultadoDeAsegurar = { estado: 'lista', master: 'm', keyEpoch: 2, nueva: true }

describe('asegurarEnElMain', () => {
  describe('F9: la cuenta cambia mientras espera la red', () => {
    it.each([['activada', ACTIVADA], ['adoptada', ADOPTADA]] as const)('%s: descarta el resultado sin tocar claves ni store', async (_n, resultado) => {
      const d = deps(resultado, { cuentaDespues: 'user-b' })
      const r = await asegurarEnElMain(d)
      expect(r).toEqual({ estado: 'sin-estado', detalle: CUENTA_CAMBIO_DURANTE_ASEGURAR })
      expect(d.tomarMaestra).not.toHaveBeenCalled()
      expect(d.guardarClaves).not.toHaveBeenCalled()
      expect(d.guardarCodigoPendiente).not.toHaveBeenCalled()
      expect(d.store.rememberKeyEpoch).not.toHaveBeenCalled()
      expect(d.store.resetPullCursors).not.toHaveBeenCalled()
      expect(d.reuploadUnaVez).not.toHaveBeenCalled()
    })

    it('salir de la cuenta (null) también cuenta como cambio', async () => {
      const d = deps(ACTIVADA, { cuentaDespues: null })
      expect((await asegurarEnElMain(d)).estado).toBe('sin-estado')
      expect(d.guardarClaves).not.toHaveBeenCalled()
    })
  })

  describe('F4: con la maestra recién conseguida, re-encola lo rechazado y re-sube una vez', () => {
    it('al activar', async () => {
      const d = deps(ACTIVADA)
      expect(await asegurarEnElMain(d)).toEqual({ estado: 'activada', recoveryCode: 'CODE', aviso: null })
      expect(d.tomarMaestra).toHaveBeenCalledWith('m', 1)
      expect(d.guardarCodigoPendiente).toHaveBeenCalledWith('CODE')
      expect(d.store.reencolarRechazadosPorCifrado).toHaveBeenCalledTimes(1)
      expect(d.reuploadUnaVez).toHaveBeenCalledTimes(1)
      expect(d.store.resetPullCursors).not.toHaveBeenCalled()
    })

    it('al adoptar, después de resetear los cursores', async () => {
      const d = deps(ADOPTADA)
      expect(await asegurarEnElMain(d)).toEqual({ estado: 'lista' })
      expect(d.store.resetPullCursors).toHaveBeenCalledTimes(1)
      expect(d.store.clearUndecryptable).toHaveBeenCalledTimes(1)
      expect(d.reuploadUnaVez).toHaveBeenCalledTimes(1)
      expect(d.store.resetPullCursors.mock.invocationCallOrder[0])
        .toBeLessThan(d.reuploadUnaVez.mock.invocationCallOrder[0])
    })

    it('aunque guardar las claves falle: la maestra está en memoria y el push sella', async () => {
      const d = deps(ACTIVADA, { guardarTira: true })
      const r = await asegurarEnElMain(d)
      expect(r.estado === 'activada' && r.aviso).toMatch(/could not be saved/)
      expect(d.reuploadUnaVez).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['ya lista (no nueva)', { estado: 'lista', master: 'm', keyEpoch: 1, nueva: false }],
      ['esperando autorización', { estado: 'esperando-autorizacion', huella: 'ab:cd' }],
      ['sin estado', { estado: 'sin-estado', detalle: 'offline' }],
    ] as const)('%s: no toca nada', async (_n, resultado) => {
      const d = deps(resultado as ResultadoDeAsegurar)
      await asegurarEnElMain(d)
      expect(d.tomarMaestra).not.toHaveBeenCalled()
      expect(d.store.reencolarRechazadosPorCifrado).not.toHaveBeenCalled()
      expect(d.reuploadUnaVez).not.toHaveBeenCalled()
    })
  })
})
