import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ensureAgentsPointer, removeAgentsPointer, POINTER_MARKER } from '../integrations/agents-md-pointer'

let wt: string

beforeEach(() => {
  wt = mkdtempSync(join(tmpdir(), 'pointer-'))
})

describe('ensureAgentsPointer', () => {
  it('agrega la linea al AGENTS.md que ya existe, sin tocar lo demas', () => {
    writeFileSync(join(wt, 'AGENTS.md'), '# Reglas del repo\n\nCorrer npm test.\n')
    expect(ensureAgentsPointer(wt)).toBe('written')

    const texto = readFileSync(join(wt, 'AGENTS.md'), 'utf8')
    expect(texto).toContain('# Reglas del repo')
    expect(texto).toContain('Correr npm test.')
    expect(texto).toContain(POINTER_MARKER)
    expect(texto).toContain('.nest/team/_index.md')
  })

  it('es idempotente: dos pasadas dejan UNA sola linea', () => {
    writeFileSync(join(wt, 'AGENTS.md'), '# Reglas\n')
    ensureAgentsPointer(wt)
    expect(ensureAgentsPointer(wt)).toBe('already')

    const texto = readFileSync(join(wt, 'AGENTS.md'), 'utf8')
    expect(texto.split(POINTER_MARKER)).toHaveLength(2)
  })

  it('si no hay AGENTS.md usa CLAUDE.md', () => {
    writeFileSync(join(wt, 'CLAUDE.md'), '# Instrucciones\n')
    expect(ensureAgentsPointer(wt)).toBe('written')
    expect(readFileSync(join(wt, 'CLAUDE.md'), 'utf8')).toContain('.nest/team/_index.md')
  })

  it('prefiere AGENTS.md cuando estan los dos', () => {
    writeFileSync(join(wt, 'AGENTS.md'), '# A\n')
    writeFileSync(join(wt, 'CLAUDE.md'), '# C\n')
    ensureAgentsPointer(wt)
    expect(readFileSync(join(wt, 'AGENTS.md'), 'utf8')).toContain(POINTER_MARKER)
    expect(readFileSync(join(wt, 'CLAUDE.md'), 'utf8')).not.toContain(POINTER_MARKER)
  })

  it('NO crea el archivo si no existe ninguno: no le inventamos convenciones al repo ajeno', () => {
    expect(ensureAgentsPointer(wt)).toBe('skipped')
    expect(existsSync(join(wt, 'AGENTS.md'))).toBe(false)
    expect(existsSync(join(wt, 'CLAUDE.md'))).toBe(false)
  })
})

describe('removeAgentsPointer', () => {
  it('saca la linea y deja el resto intacto', () => {
    writeFileSync(join(wt, 'AGENTS.md'), '# Reglas\n\nCorrer npm test.\n')
    ensureAgentsPointer(wt)
    removeAgentsPointer(wt)

    const texto = readFileSync(join(wt, 'AGENTS.md'), 'utf8')
    expect(texto).not.toContain(POINTER_MARKER)
    expect(texto).toContain('Correr npm test.')
  })
})
