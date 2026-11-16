import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const selectMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: selectMock }) },
}))

import { usePluginCatalog } from '../../hooks/usePluginCatalog'
import { BUILTIN_CATALOG } from '../../lib/plugins/builtinCatalog'

describe('usePluginCatalog', () => {
  beforeEach(() => selectMock.mockReset())

  it('usa el catálogo remoto cuando hay manifests válidos', async () => {
    selectMock.mockResolvedValue({
      data: [{ manifest: { id: 'foo', name: 'Foo', type: 'integration', category: 'other' } }],
      error: null,
    })
    const { result } = renderHook(() => usePluginCatalog())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.source).toBe('remote')
    expect(result.current.catalog.map(p => p.id)).toEqual(['foo'])
  })

  it('cae al built-in si Supabase falla', async () => {
    selectMock.mockResolvedValue({ data: null, error: new Error('down') })
    const { result } = renderHook(() => usePluginCatalog())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.source).toBe('builtin')
    expect(result.current.catalog).toHaveLength(BUILTIN_CATALOG.length)
  })
})
