import { describe, it, expect } from 'vitest'
import {
  COORDINATOR_INSTRUCTIONS,
  workerPreamble,
  pointerLine
} from '../orchestration/prompts'

const params = {
  label: 'fix-login',
  branch: 'nest/fix-login',
  baseBranch: 'feat/x',
  task: 'Fix the login bug.\nSecond line.'
}

describe('prompts de orquestación', () => {
  it('instrucciones prohíben polling', () => {
    expect(COORDINATOR_INSTRUCTIONS).toContain('end your turn')
    expect(COORDINATOR_INSTRUCTIONS).toContain('do not poll')
    expect(COORDINATOR_INSTRUCTIONS).toContain('nest_inbox')
    expect(COORDINATOR_INSTRUCTIONS).toContain('nest_launch_worker')
  })

  it('preámbulo nombra rama y base', () => {
    const t = workerPreamble(params)
    expect(t).toContain('nest/fix-login')
    expect(t).toContain('feat/x')
    expect(t).toContain('fix-login')
  })

  it('preámbulo exige commit antes de done', () => {
    const t = workerPreamble(params)
    expect(t).toMatch(/commit/i)
    expect(t).toContain('worktree_dirty')
    expect(t).toContain('nest_report')
  })

  it('preámbulo termina con la tarea literal', () => {
    expect(workerPreamble(params).endsWith(params.task)).toBe(true)
  })

  it('pointerLine singular y plural', () => {
    expect(pointerLine(1)).toBe('You have 1 worker message. Call nest_inbox.')
    expect(pointerLine(3)).toBe('You have 3 worker messages. Call nest_inbox.')
  })
})
