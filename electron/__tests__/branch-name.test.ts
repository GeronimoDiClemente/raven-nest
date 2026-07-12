import { describe, it, expect } from 'vitest'
import { ticketBranchName } from '../integrations/branch-name'

describe('ticketBranchName', () => {
  it('arma user/KEY-slug en kebab', () => {
    expect(ticketBranchName('gero', 'PROJ-142', 'Fix auth bug in login'))
      .toBe('gero/PROJ-142-fix-auth-bug-in-login')
  })

  it('sanitiza chars fuera del regex de worktree:create', () => {
    // worktree:create valida /^[a-zA-Z0-9._/\-]+$/
    expect(ticketBranchName('gero', '#123', '¡Añadir ñandú & co.!'))
      .toBe('gero/123-anadir-nandu-co')
  })

  it('trunca el slug a 40 chars sin cortar palabra a la mitad del guion', () => {
    const b = ticketBranchName('gero', 'ENG-1', 'a'.repeat(80))
    expect(b.length).toBeLessThanOrEqual('gero/ENG-1-'.length + 40)
    expect(b.endsWith('-')).toBe(false)
  })

  it('usuario vacío cae a "nest"', () => {
    expect(ticketBranchName('', 'X-1', 'y')).toBe('nest/X-1-y')
  })
})
