// C1 de la review final de rama: NINGUNA fila del hilo tenia `gitBranch`, asi que todas
// caian en `general.md` y `ramas/` nunca se escribia. Sobrevivio diez reviews porque TODOS
// los fixtures del hilo pasan `gitBranch: 'main'` a mano — un fixture que siempre trae el
// campo lleno no prueba que alguien lo llene. Estos tests atan justamente eso: quien
// construye el input del `store.save()` de un handoff.
import { describe, it, expect, vi } from 'vitest'
import { buildHandoffSave } from '../integrations/handoff-capture'
import type { TeamThreadSettings } from '../integrations/team-thread-config'

const ON: TeamThreadSettings = { enabled: true, includedTypes: ['handoff', 'decision'], writeAgentsPointer: true }
const OFF: TeamThreadSettings = { enabled: false, includedTypes: ['handoff', 'decision'], writeAgentsPointer: true }

const BASE = {
  worktreePath: 'C:/dev/raven-nest',
  projectKey: 'proj1111aaaaaaaa',
  title: 'Handoff — raven-nest',
  content: 'Quedo la rama a medio hacer.',
}

describe('buildHandoffSave', () => {
  it('LO QUE ROMPIA C1: el input que se guarda TRAE la rama, resuelta del worktree', () => {
    const resolveGitInfo = vi.fn().mockReturnValue({ branch: 'smoke/memory-bridge', remoteUrl: null })

    const { input } = buildHandoffSave({ ...BASE, settings: ON }, { resolveGitInfo })

    expect(resolveGitInfo).toHaveBeenCalledWith('C:/dev/raven-nest')
    expect(input.gitBranch).toBe('smoke/memory-bridge')
  })

  it('sin la rama la fila cae en general.md — pero el handoff se guarda igual', () => {
    const { input } = buildHandoffSave({ ...BASE, settings: ON }, { resolveGitInfo: () => null })

    expect(input.gitBranch).toBeNull()
    expect(input.content).toBe(BASE.content)
  })

  it('si git tira, no se propaga: gitBranch queda null y el guardado sigue', () => {
    const resolveGitInfo = vi.fn(() => { throw new Error('git no esta instalado') })

    expect(() => buildHandoffSave({ ...BASE, settings: ON }, { resolveGitInfo })).not.toThrow()
    expect(buildHandoffSave({ ...BASE, settings: ON }, { resolveGitInfo }).input.gitBranch).toBeNull()
  })

  it('HEAD detached no es una rama: se guarda como null, no como la cadena "HEAD"', () => {
    const { input } = buildHandoffSave(
      { ...BASE, settings: ON },
      { resolveGitInfo: () => ({ branch: 'HEAD', remoteUrl: null }) },
    )

    expect(input.gitBranch).toBeNull()
  })

  it('una rama vacia tampoco es una rama', () => {
    const { input } = buildHandoffSave(
      { ...BASE, settings: ON },
      { resolveGitInfo: () => ({ branch: '   ', remoteUrl: null }) },
    )

    expect(input.gitBranch).toBeNull()
  })

  it('el scope sigue saliendo del gate: con el hilo prendido nace team', () => {
    const { input, heldBack } = buildHandoffSave(
      { ...BASE, settings: ON },
      { resolveGitInfo: () => ({ branch: 'main', remoteUrl: null }) },
    )

    expect(input.scope).toBe('team')
    expect(heldBack).toBe(false)
  })

  it('el scope sigue saliendo del gate: con el hilo apagado nace personal', () => {
    const { input } = buildHandoffSave(
      { ...BASE, settings: OFF },
      { resolveGitInfo: () => ({ branch: 'main', remoteUrl: null }) },
    )

    expect(input.scope).toBe('personal')
  })

  it('el gate de secreto sigue reteniendo — y la rama viaja igual', () => {
    const { input, heldBack } = buildHandoffSave(
      { ...BASE, settings: ON, content: 'el token es ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      { resolveGitInfo: () => ({ branch: 'main', remoteUrl: null }) },
    )

    expect(heldBack).toBe(true)
    expect(input.scope).toBe('personal')
    expect(input.gitBranch).toBe('main')
  })

  it('el resto del input no cambia de forma', () => {
    const { input } = buildHandoffSave(
      { ...BASE, settings: ON },
      { resolveGitInfo: () => ({ branch: 'main', remoteUrl: null }) },
    )

    expect(input.projectKey).toBe('proj1111aaaaaaaa')
    expect(input.type).toBe('handoff')
    expect(input.title).toBe('Handoff — raven-nest')
    expect(input.source).toBe('ui')
  })
})
