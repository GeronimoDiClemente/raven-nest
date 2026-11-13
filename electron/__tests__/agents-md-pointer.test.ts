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

  it('el round-trip deja el archivo BYTE A BYTE como estaba (con newline final)', () => {
    const original = '# Reglas\n\nCorrer npm test.\n'
    writeFileSync(join(wt, 'AGENTS.md'), original)
    ensureAgentsPointer(wt)
    removeAgentsPointer(wt)
    expect(readFileSync(join(wt, 'AGENTS.md'), 'utf8')).toBe(original)
  })

  it('el round-trip agrega un newline final a archivos sin newline (normalizacion)', () => {
    const original = '# Reglas'
    writeFileSync(join(wt, 'AGENTS.md'), original)
    ensureAgentsPointer(wt)
    removeAgentsPointer(wt)
    expect(readFileSync(join(wt, 'AGENTS.md'), 'utf8')).toBe(original + '\n')
  })

  it('NO se come una linea en blanco final del usuario', () => {
    const original = 'A\n\n'
    writeFileSync(join(wt, 'AGENTS.md'), original)
    ensureAgentsPointer(wt)
    removeAgentsPointer(wt)
    expect(readFileSync(join(wt, 'AGENTS.md'), 'utf8')).toBe(original)
  })

  it('NO se come multiples lineas en blanco finales del usuario', () => {
    const original = 'A\n\n\n'
    writeFileSync(join(wt, 'AGENTS.md'), original)
    ensureAgentsPointer(wt)
    removeAgentsPointer(wt)
    expect(readFileSync(join(wt, 'AGENTS.md'), 'utf8')).toBe(original)
  })

  it('citar el marcador dentro de un bloque no lo confunde con el puntero real', () => {
    // El marcador aqui esta indentado/precedido, no al inicio de la linea
    const conCita = '# Instrucciones\n\n```\nEste es un ejemplo: <!-- nest:team-thread --> referencia\n```\n'
    writeFileSync(join(wt, 'AGENTS.md'), conCita)
    expect(ensureAgentsPointer(wt)).toBe('written')

    const texto = readFileSync(join(wt, 'AGENTS.md'), 'utf8')
    expect(texto).toContain('Este es un ejemplo:')
    const count = (texto.match(/<!-- nest:team-thread -->/g) || []).length
    expect(count).toBe(2)
  })

  it('remove no elimina citas del usuario del marcador, solo la linea del puntero', () => {
    const conCita = '# Instrucciones\n\n```\nEste es un ejemplo: <!-- nest:team-thread --> referencia\n```\n'
    writeFileSync(join(wt, 'AGENTS.md'), conCita)
    ensureAgentsPointer(wt)
    removeAgentsPointer(wt)

    const texto = readFileSync(join(wt, 'AGENTS.md'), 'utf8')
    expect(texto).toContain('Este es un ejemplo:')
    expect(texto).not.toContain('El contexto vivo del equipo')
  })
})
