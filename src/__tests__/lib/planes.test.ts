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
