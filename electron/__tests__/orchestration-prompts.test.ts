import { describe, it, expect } from 'vitest'
import { TOOL_MANIFEST } from '../orchestration-mcp/tools'
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

  // Prueba real con Gero: con "úsalas sólo si el usuario pide workers" el coordinador no las
  // lanzaba nunca por su cuenta. Como T3 Code, decide el agente; lo rápido va a su subagente nativo.
  it('el coordinador decide solo cuándo lanzar workers, sin esperar el pedido', () => {
    expect(COORDINATOR_INSTRUCTIONS).toMatch(/the user does not have to ask/)
    expect(COORDINATOR_INSTRUCTIONS).toMatch(/two or more independent parts/)
    expect(COORDINATOR_INSTRUCTIONS).toMatch(/Do it yourself for a single focused change/)
    expect(COORDINATOR_INSTRUCTIONS).toMatch(/own subagent tool/)
    expect(COORDINATOR_INSTRUCTIONS).not.toMatch(/use them only when/i)
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

  // Codex trunca entradas de más de ~4000 bytes (ver el comentario en prompts.ts).
  it('las instrucciones del coordinador pesan menos de 4000 bytes', () => {
    expect(Buffer.byteLength(COORDINATOR_INSTRUCTIONS, 'utf8')).toBeLessThan(4000)
  })

  // Revisión final: el texto no puede prometer lo que el servicio no hace. send rechaza a un
  // worker terminado (worker_finished) y su pane se cierra solo; read devuelve el registro y la
  // cola del pane, no commits ni diffstat.
  it('el preámbulo no promete mensajes después de done', () => {
    const t = workerPreamble(params)
    expect(t).not.toMatch(/may still message/i)
    expect(t).toMatch(/after done[^\n]*nothing more will arrive/i)
  })

  it('nest_read_worker no promete commits ni diffstat', () => {
    expect(COORDINATOR_INSTRUCTIONS).not.toMatch(/diffstat/i)
    const read = TOOL_MANIFEST.find((t) => t.name === 'nest_read_worker')!
    expect(read.description).not.toMatch(/diffstat|commits/i)
    expect(read.description).toMatch(/last lines of its pane/)
  })
})
