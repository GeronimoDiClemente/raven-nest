import { describe, it, expect } from 'vitest'
import { PLAN_LIMITS, type Plan } from '../../lib/stripe'

describe('el plan Cloud', () => {
  it('existe en PLAN_LIMITS', () => {
    expect(PLAN_LIMITS.cloud).toBeDefined()
  })

  it('tiene la nube prendida, igual que pro', () => {
    expect(PLAN_LIMITS.cloud.memoryCloud).toBe(true)
  })

  // Cloud es el tier INDIVIDUAL: paga por alojar SU memoria, no por compartirla.
  it('no puede compartir memoria con un equipo', () => {
    expect(PLAN_LIMITS.cloud.memoryTeamShare).toBe(false)
    expect(PLAN_LIMITS.team.memoryTeamShare).toBe(true)
  })

  it('acepta cloud como valor del tipo Plan', () => {
    const p: Plan = 'cloud'
    expect(PLAN_LIMITS[p]).toBeDefined()
  })
})

describe('lo local es gratis', () => {
  // La regla del pricing nuevo: lo que corre en la maquina del usuario no nos cuesta
  // nada, asi que no se cobra. Este test es esa regla, ejecutable.
  it('Free y Cloud tienen exactamente las mismas capacidades locales', () => {
    const { memoryCloud: _a, memoryTeamShare: _b, isEnterprise: _c, ...localFree } =
      PLAN_LIMITS.free
    const { memoryCloud: _d, memoryTeamShare: _e, isEnterprise: _f, ...localCloud } =
      PLAN_LIMITS.cloud
    expect(localFree).toEqual(localCloud)
  })

  it('PlanLimits ya no tiene ningun gate de features locales', () => {
    const gatesLocales = [
      'maxPanes', 'allowedAIs', 'allowBroadcast', 'allowVoice', 'allowSharing',
      'allowSnippets', 'allowWorkspaces', 'allowCreateWorktree', 'allowSpotlight',
      'allowDiffViewer', 'allowMyRepos', 'allowActions', 'allowGitHubGitLab',
      'allowMcpWrite', 'allowTeam',
    ]
    for (const gate of gatesLocales) {
      expect(Object.keys(PLAN_LIMITS.free)).not.toContain(gate)
    }
  })
})
