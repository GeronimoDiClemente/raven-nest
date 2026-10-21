// El handler de `memory:updateFromUi` sin Electron ni SQLite (final review, minor): el `saved`
// que devuelve es lo que quedó en la base, no lo que se mandó.
import { describe, it, expect, vi } from 'vitest'
import { actualizarDesdeUi, type StoreParaActualizar } from '../memory-update-from-ui'
import type { UpdateMemoryResult } from '../memory-store'

type Fila = { title: string; content: string | null; deleted: number }

function store(res: UpdateMemoryResult, fila: Fila | null): StoreParaActualizar & { update: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> } {
  return { update: vi.fn().mockReturnValue(res), get: vi.fn().mockReturnValue(fila) }
}

describe('actualizarDesdeUi', () => {
  it('devuelve lo que QUEDO guardado (trim y redact del store), no lo que se mando', () => {
    const s = store({ updated: true, syncId: 's1' }, { title: 'Titulo', content: 'token [REDACTED]', deleted: 0 })
    const alCambiar = vi.fn()
    const r = actualizarDesdeUi(s, { syncId: ' s1 ', title: ' Titulo ', content: 'token sk-123  ' }, alCambiar)
    expect(s.update).toHaveBeenCalledWith({ syncId: 's1', title: 'Titulo', content: 'token sk-123', tags: undefined })
    expect(r).toEqual({ ok: true, reason: null, saved: { title: 'Titulo', content: 'token [REDACTED]' } })
    expect(alCambiar).toHaveBeenCalledTimes(1)
  })
  it('sin cambios: ok false con reason unchanged, trae saved y no programa el push', () => {
    const s = store({ updated: false, reason: 'unchanged' }, { title: 'T', content: null, deleted: 0 })
    const alCambiar = vi.fn()
    expect(actualizarDesdeUi(s, { syncId: 's1', title: 'T' }, alCambiar)).toEqual({ ok: false, reason: 'unchanged', saved: { title: 'T', content: '' } })
    expect(alCambiar).not.toHaveBeenCalled()
  })
  it('lee la fila del syncId que devuelve el store', () => {
    const s = store({ updated: true, syncId: 'nuevo' }, { title: 'T', content: 'c', deleted: 0 })
    actualizarDesdeUi(s, { syncId: 'viejo', content: 'c' }, () => {})
    expect(s.get).toHaveBeenCalledWith('nuevo')
  })
  it('borrada o reemplazada: sin saved', () => {
    expect(actualizarDesdeUi(store({ updated: true }, { title: 'T', content: 'c', deleted: 1 }), { syncId: 's1' }, () => {})).toEqual({ ok: true, reason: null })
    const sup = store({ updated: false, reason: 'superseded' }, { title: 'T', content: 'c', deleted: 0 })
    expect(actualizarDesdeUi(sup, { syncId: 's1' }, () => {})).toEqual({ ok: false, reason: 'superseded' })
    expect(sup.get).not.toHaveBeenCalled()
  })
  it('sin syncId no toca el store; un throw vuelve como error', () => {
    const s = store({ updated: true }, null)
    expect(actualizarDesdeUi(s, { syncId: '  ' }, () => {})).toEqual({ ok: false, error: 'missing_sync_id' })
    expect(actualizarDesdeUi(s, null, () => {})).toEqual({ ok: false, error: 'missing_sync_id' })
    expect(s.update).not.toHaveBeenCalled()
    s.update.mockImplementation(() => { throw new Error('disk full') })
    expect(actualizarDesdeUi(s, { syncId: 's1' }, () => {})).toEqual({ ok: false, error: 'disk full' })
  })
})
