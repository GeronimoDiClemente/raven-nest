// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMyTickets } from '../../hooks/useMyTickets'

const list = vi.fn()
beforeEach(() => {
  list.mockReset()
  ;(window as unknown as { tickets: { list: typeof list } }).tickets = { list }
})

describe('useMyTickets', () => {
  it('carga tickets del provider', async () => {
    list.mockResolvedValue([{ key: 'A-1', providerId: 'p', title: 't', url: 'u', state: 'todo', context: '' }])
    const { result } = renderHook(() => useMyTickets('jira'))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.tickets).toHaveLength(1)
    expect(list).toHaveBeenCalledWith('jira')
  })

  it('pluginId null no llama y devuelve vacío', async () => {
    const { result } = renderHook(() => useMyTickets(null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(list).not.toHaveBeenCalled()
    expect(result.current.tickets).toEqual([])
  })
})
