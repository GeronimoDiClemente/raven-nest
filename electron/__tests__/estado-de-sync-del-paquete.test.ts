import { describe, it, expect } from 'vitest'
import { lineaDeSync } from '../estado-de-sync-del-paquete'

const base = { modo: 'propia' as const, enCola: 0, hayCredencial: true, hayServicio: true }

describe('lineaDeSync', () => {
  it('con la base de Nest, sincroniza Nest — nunca el paquete', () => {
    expect(lineaDeSync({ ...base, modo: 'nest', enCola: 3 })).toBe('3 changes waiting for Nest to sync them.')
    expect(lineaDeSync({ ...base, modo: 'nest' })).toMatch(/Nest syncs/)
  })

  it('sin cuenta dice cuántos esperan y cómo conectarse', () => {
    expect(lineaDeSync({ ...base, hayCredencial: false, enCola: 1 })).toBe('Local only — 1 change queued. Run `npx nest-memory login` to sync them.')
    expect(lineaDeSync({ ...base, hayCredencial: false })).toMatch(/^Local only\. Run `npx nest-memory login`/)
  })

  it('conectado pero sin servicio configurado lo dice, en vez de prometer un sync que no va a pasar', () => {
    expect(lineaDeSync({ ...base, hayServicio: false, enCola: 2 })).toMatch(/NEST_MEMORY_SYNC_URL is not set — 2 changes queued/)
  })

  it('cuenta cifrada y máquina sin autorizar: NO promete que va a subir — falta autorizarla', () => {
    // Visto contra el servicio real el 2026-10-02: el gate fail-closed frena el push (bien) y
    // `status` decía «They go up the next time an agent saves a memory», que es falso. Quien
    // lo leía se quedaba esperando un sync que no iba a pasar nunca.
    const linea = lineaDeSync({ ...base, enCola: 1, esperandoAutorizacion: true })
    expect(linea).toMatch(/^Connected — 1 change held until this machine is authorized/)
    expect(linea).toMatch(/npx nest-memory login/)
    expect(linea).not.toMatch(/next time an agent saves/)
  })

  it('conectado: la cola, o que está todo arriba', () => {
    expect(lineaDeSync({ ...base, enCola: 5 })).toMatch(/^Connected — 5 changes waiting to sync/)
    expect(lineaDeSync(base)).toBe('Connected — everything is synced.')
  })
})
