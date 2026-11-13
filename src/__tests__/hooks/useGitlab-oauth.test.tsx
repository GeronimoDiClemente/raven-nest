// `gitlab.onOAuthCode` apila handlers (preload: `ipcRenderer.on` sin limpiar antes), y
// connectGitlab no sacaba el de un intento anterior: un Connect abandonado seguido de
// otro canjeaba el MISMO código dos veces. El puente falso imita al preload real: on
// suma, removeOAuthListener borra todos, y emitir recorre una copia (como EventEmitter,
// así que sacar oyentes mientras se emite no frena a los que ya estaban en la lista).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const supabaseMock = vi.hoisted(() => ({
  functions: { invoke: vi.fn() },
  auth: { getUser: vi.fn() },
  from: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

import { useGitlab } from '../../hooks/useGitlab'

type Oyente = (code: string) => void
let oyentes: Oyente[] = []
const emitirCodigo = (code: string) => { for (const cb of [...oyentes]) cb(code) }

beforeEach(() => {
  vi.clearAllMocks()
  oyentes = []
  supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    maybeSingle: async () => ({ data: { gitlab_token: 'tok', gitlab_login: 'yo' }, error: null }),
  }
  supabaseMock.from.mockReturnValue(consulta)
  supabaseMock.functions.invoke.mockResolvedValue({ data: { username: 'yo' }, error: null })
  ;(window as unknown as { gitlab: unknown }).gitlab = {
    openOAuth: vi.fn(async () => {}),
    onOAuthCode: (cb: Oyente) => {
      oyentes.push(cb)
      return () => { oyentes = oyentes.filter((o) => o !== cb) }
    },
    removeOAuthListener: () => { oyentes = [] },
  }
})

describe('useGitlab · un solo flujo OAuth pendiente', () => {
  it('dos Connect seguidos canjean el código una sola vez', async () => {
    const { result } = renderHook(() => useGitlab())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { await result.current.connectGitlab() })
    await act(async () => { await result.current.connectGitlab() })
    expect(oyentes).toHaveLength(1)

    await act(async () => { emitirCodigo('code-1') })
    await waitFor(() => expect(result.current.isConnected).toBe(true))
    expect(supabaseMock.functions.invoke).toHaveBeenCalledTimes(1)
    expect(supabaseMock.functions.invoke).toHaveBeenCalledWith('gitlab-oauth', { body: { code: 'code-1' } })
    expect(result.current.error).toBeNull()
    expect(oyentes).toHaveLength(0)
  })
})
