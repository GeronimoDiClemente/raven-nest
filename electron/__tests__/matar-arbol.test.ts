// matarArbol con un sistema de procesos falso: quién recibe qué señal y cuándo.
import { describe, it, expect } from 'vitest'
import { matarArbol, type DepsDeMatar } from '../matar-arbol'

function sistema(arbol: number[], opts: { ignoranTerm?: number[]; muertos?: number[] } = {}) {
  const vivos = new Set(arbol.filter((p) => !(opts.muertos ?? []).includes(p)))
  const senales: Array<[number, string]> = []
  let reloj = 0
  const deps: DepsDeMatar = {
    arbolDe: async () => arbol,
    senal: (pid, s) => {
      if (!vivos.has(pid)) throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
      senales.push([pid, s])
      if (s === 'SIGKILL' || !(opts.ignoranTerm ?? []).includes(pid)) vivos.delete(pid)
    },
    vivo: (pid) => vivos.has(pid),
    esperar: async (ms) => { reloj += ms },
  }
  return { deps, senales, vivos, reloj: () => reloj }
}

describe('matarArbol', () => {
  it('manda SIGTERM a la raíz y a todos sus descendientes, no sólo al shell', async () => {
    const s = sistema([10, 11, 12])
    expect(await matarArbol(10, s.deps)).toEqual({ ok: true })
    expect(s.senales).toEqual([[10, 'SIGTERM'], [11, 'SIGTERM'], [12, 'SIGTERM']])
    expect(s.vivos.size).toBe(0)
  })

  it('lo que ignora SIGTERM recibe SIGKILL después de la gracia', async () => {
    const s = sistema([10, 11], { ignoranTerm: [11] })
    expect(await matarArbol(10, s.deps, { graciaMs: 500, pasoMs: 100 })).toEqual({ ok: true })
    expect(s.senales).toEqual([[10, 'SIGTERM'], [11, 'SIGTERM'], [11, 'SIGKILL']])
    expect(s.reloj()).toBe(500)
  })

  it('si todo muere con SIGTERM no espera la gracia', async () => {
    const s = sistema([10, 11])
    await matarArbol(10, s.deps, { graciaMs: 3000 })
    expect(s.reloj()).toBe(0)
  })

  it('una raíz que ya no existe, sin hijos, es error', async () => {
    const s = sistema([10], { muertos: [10] })
    expect(await matarArbol(10, s.deps)).toEqual({ ok: false, error: 'kill ESRCH' })
  })

  it('una raíz muerta con hijos vivos igual los mata', async () => {
    const s = sistema([10, 11], { muertos: [10] })
    expect(await matarArbol(10, s.deps)).toEqual({ ok: true })
    expect(s.senales).toEqual([[11, 'SIGTERM']])
  })

  it('sin tabla de procesos, al menos la raíz', async () => {
    const s = sistema([10])
    s.deps.arbolDe = async () => { throw new Error('ps no anda') }
    expect(await matarArbol(10, s.deps)).toEqual({ ok: true })
    expect(s.senales).toEqual([[10, 'SIGTERM']])
  })
})
