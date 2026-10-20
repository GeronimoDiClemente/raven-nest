import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutosave } from '../../hooks/useAutosave'

const base = { title: 'T', content: 'c' }
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useAutosave', () => {
  it('guarda 1500 ms despues del ultimo cambio, una sola vez', async () => {
    const guardar = vi.fn().mockResolvedValue({ ok: true })
    const { rerender, result } = renderHook((p) => useAutosave(p), { initialProps: { valor: base, base, guardar, habilitado: true } })
    rerender({ valor: { title: 'T', content: 'c1' }, base, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(1000) })
    rerender({ valor: { title: 'T', content: 'c12' }, base, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(1499) })
    expect(guardar).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(guardar).toHaveBeenCalledTimes(1)
    expect(guardar).toHaveBeenCalledWith({ title: 'T', content: 'c12' })
    expect(result.current.estado).toBe('guardado')
  })
  it('titulo vacio no guarda', async () => {
    const guardar = vi.fn()
    const { rerender } = renderHook((p) => useAutosave(p), { initialProps: { valor: base, base, guardar, habilitado: true } })
    rerender({ valor: { title: '  ', content: 'x' }, base, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(guardar).not.toHaveBeenCalled()
  })
  it('superseded deja de guardar', async () => {
    const guardar = vi.fn().mockResolvedValue({ ok: false, reason: 'superseded' })
    const { rerender, result } = renderHook((p) => useAutosave(p), { initialProps: { valor: base, base, guardar, habilitado: true } })
    rerender({ valor: { title: 'T', content: 'x' }, base, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(result.current.estado).toBe('reemplazada')
    rerender({ valor: { title: 'T', content: 'xy' }, base, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(guardar).toHaveBeenCalledTimes(1)
  })
  it('unchanged es silencio; error de red es error con reintento', async () => {
    const guardar = vi.fn().mockResolvedValueOnce({ ok: false, reason: 'unchanged' }).mockRejectedValueOnce(new Error('disk')).mockResolvedValueOnce({ ok: true })
    const { rerender, result } = renderHook((p) => useAutosave(p), { initialProps: { valor: base, base, guardar, habilitado: true } })
    rerender({ valor: { title: 'T', content: 'a' }, base, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(result.current.estado).toBe('guardado')
    rerender({ valor: { title: 'T', content: 'ab' }, base, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(result.current.estado).toBe('error')
    await act(async () => { result.current.reintentar() })
    expect(guardar).toHaveBeenCalledTimes(3)
    expect(result.current.estado).toBe('guardado')
  })
  it('al desmontar con cambios sin guardar, guarda igual (Review Focus 2)', async () => {
    const guardar = vi.fn().mockResolvedValue({ ok: true })
    const { rerender, unmount } = renderHook((p) => useAutosave(p), { initialProps: { valor: base, base, guardar, habilitado: true } })
    rerender({ valor: { title: 'T', content: 'ultimo' }, base, guardar, habilitado: true })
    unmount()
    expect(guardar).toHaveBeenCalledWith({ title: 'T', content: 'ultimo' })
  })
  it('not_found deja la memoria como borrada y no vuelve a guardar', async () => {
    const guardar = vi.fn().mockResolvedValue({ ok: false, reason: 'not_found' })
    const { rerender, result } = renderHook((p) => useAutosave(p), { initialProps: { valor: base, base, guardar, habilitado: true } })
    rerender({ valor: { title: 'T', content: 'x' }, base, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(result.current.estado).toBe('borrada')
    rerender({ valor: { title: 'T', content: 'xy' }, base, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(guardar).toHaveBeenCalledTimes(1)
  })
  it('deshabilitado no guarda, ni al desmontar', async () => {
    const guardar = vi.fn().mockResolvedValue({ ok: true })
    const { rerender, unmount } = renderHook((p) => useAutosave(p), { initialProps: { valor: base, base, guardar, habilitado: false } })
    rerender({ valor: { title: 'T', content: 'x' }, base, guardar, habilitado: false })
    await act(async () => { vi.advanceTimersByTime(5000) })
    unmount()
    expect(guardar).not.toHaveBeenCalled()
  })
  it('despues de desmontar, el flush repetido no vuelve a mandar lo mismo', async () => {
    let responder!: (r: { ok: boolean }) => void
    const guardar = vi.fn().mockImplementationOnce(() => new Promise((r) => { responder = r })).mockResolvedValue({ ok: true })
    const { rerender, result, unmount } = renderHook((p) => useAutosave(p), { initialProps: { valor: base, base, guardar, habilitado: true } })
    rerender({ valor: { title: 'T', content: 'a' }, base, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(1500) })
    rerender({ valor: { title: 'T', content: 'ab' }, base, guardar, habilitado: true })
    await act(async () => { void result.current.flush() }) // en vuelo: queda para despues
    unmount() // el desmontaje manda 'ab'
    expect(guardar).toHaveBeenCalledTimes(2)
    await act(async () => { responder({ ok: true }) })
    expect(guardar).toHaveBeenCalledTimes(2)
  })
  it('un cambio externo de la base no se toma como cambio local', async () => {
    const guardar = vi.fn().mockResolvedValue({ ok: true })
    const nueva = { title: 'T2', content: 'c2' }
    const { rerender, result } = renderHook((p) => useAutosave(p), { initialProps: { valor: base, base, guardar, habilitado: true } })
    rerender({ valor: nueva, base: nueva, guardar, habilitado: true })
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(guardar).not.toHaveBeenCalled()
    expect(result.current.sucio).toBe(false)
  })
})
