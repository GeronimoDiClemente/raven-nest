// La IP con la que se llavean los limitadores sin credencial (`/v1/link/start`, `/v1/devices`).
// Puro: no necesita Postgres.
import { describe, it, expect } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { ipDelCliente } from '../src/ip-del-cliente'

function req(remoteAddress: string | undefined, xff?: string | string[]): IncomingMessage {
  return {
    socket: { remoteAddress },
    headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
  } as unknown as IncomingMessage
}

const CONFIA = { TRUST_PROXY: '1' }

describe('ipDelCliente', () => {
  it('sin TRUST_PROXY el header se ignora: manda el socket', () => {
    expect(ipDelCliente(req('10.0.0.1', '203.0.113.7'), {})).toBe('10.0.0.1')
  })

  it('TRUST_PROXY distinto de 1 tampoco confía en el header', () => {
    expect(ipDelCliente(req('10.0.0.1', '203.0.113.7'), { TRUST_PROXY: 'true' })).toBe('10.0.0.1')
  })

  it('con TRUST_PROXY=1 usa la entrada de MÁS A LA DERECHA (la que agrega el proxy)', () => {
    expect(ipDelCliente(req('10.0.0.1', '198.51.100.1, 203.0.113.7'), CONFIA)).toBe('203.0.113.7')
  })

  it('las entradas de la izquierda las controla el cliente: cambiarlas no cambia la clave', () => {
    const a = ipDelCliente(req('10.0.0.1', '1.1.1.1, 203.0.113.7'), CONFIA)
    const b = ipDelCliente(req('10.0.0.1', '9.9.9.9, 8.8.8.8, 203.0.113.7'), CONFIA)
    expect(a).toBe(b)
  })

  it('header repetido (array): cuenta el último valor', () => {
    expect(ipDelCliente(req('10.0.0.1', ['1.1.1.1', '2.2.2.2, 203.0.113.7']), CONFIA)).toBe('203.0.113.7')
  })

  it('sin header, o vacío, cae al socket', () => {
    expect(ipDelCliente(req('10.0.0.1'), CONFIA)).toBe('10.0.0.1')
    expect(ipDelCliente(req('10.0.0.1', ''), CONFIA)).toBe('10.0.0.1')
    expect(ipDelCliente(req('10.0.0.1', ' , '), CONFIA)).toBe('10.0.0.1')
  })

  it('sin socket ni header da una clave fija, no undefined', () => {
    expect(ipDelCliente(req(undefined), {})).toBe('sin-ip')
  })
})
