import { describe, it, expect } from 'vitest'
import { orchestrationSocketPath, ORCH_ERRORS } from '../orchestration/protocol'

describe('orchestrationSocketPath', () => {
  it('Windows: named pipe con el pipeId', () => {
    expect(orchestrationSocketPath('C:\\Users\\g', true, 'abc123')).toBe('\\\\.\\pipe\\nest-orchestration-abc123')
  })

  it('unix: el pipeId va en el nombre, así dos Nest con el mismo home no se pisan', () => {
    const a = orchestrationSocketPath('/Users/g', false, 'aaaa1111')
    const b = orchestrationSocketPath('/Users/g', false, 'bbbb2222')
    expect(a).toBe('/Users/g/.raven-nest/orch-aaaa1111.sock')
    expect(a).not.toBe(b)
  })

  it('unix: un home largo cae a tmpdir para no pasar el límite de sun_path', () => {
    const largo = `/Users/${'x'.repeat(90)}`
    const p = orchestrationSocketPath(largo, false, '0123456789abcdef', '/tmp')
    expect(p).toBe('/tmp/nest-orch-0123456789abcdef.sock')
    const corto = orchestrationSocketPath('/Users/g', false, '0123456789abcdef', '/tmp')
    expect(corto.length).toBeLessThanOrEqual(100)
    expect(corto.startsWith('/Users/g/')).toBe(true)
  })
})

describe('ORCH_ERRORS', () => {
  it('documenta not_a_git_repo', () => {
    expect(ORCH_ERRORS).toContain('not_a_git_repo')
  })
})
