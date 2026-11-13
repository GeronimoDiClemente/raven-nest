// Riesgo #2 de la spec §11: "el desfasaje del vault puede significar que la pantalla muestre
// datos viejos. Hay que resolverlo antes de que el grafo sea la cara del producto." Lo medido
// el 2026-09-09: DB escrita 22:19, vault regenerado 20:50 — 1,5 h atras y nadie lo dice.
// Esto lee esa marca de tiempo para poder mostrarla.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { makeTmpDir, cleanupTmp } from './setup'
import { readVaultHealth } from '../memory-vault-health'

describe('readVaultHealth', () => {
  let dir: string

  beforeEach(() => { dir = makeTmpDir('raven-vault-health-') })
  afterEach(() => { cleanupTmp(dir) })

  it('un vault que no existe reporta cero, no explota', () => {
    expect(readVaultHealth(join(dir, 'no-such-vault'))).toEqual({
      noteCount: 0, conflictCount: 0, lastGeneratedAt: null,
    })
  })

  it('cuenta las entradas del manifiesto y toma su mtime como ultima generacion', () => {
    mkdirSync(join(dir, '.nest-vault'), { recursive: true })
    writeFileSync(
      join(dir, '.nest-vault', 'manifest.json'),
      JSON.stringify({ entries: { a: { filePath: 'a.md' }, b: { filePath: 'b.md' } } })
    )

    const health = readVaultHealth(dir)

    expect(health.noteCount).toBe(2)
    expect(health.lastGeneratedAt).toBeGreaterThan(0)
  })

  it('cuenta los .md de _conflicts/ — la spec §4.5 los quiere en la fila de estado', () => {
    mkdirSync(join(dir, '_conflicts'), { recursive: true })
    writeFileSync(join(dir, '_conflicts', 'nota-1.md'), 'mine')
    writeFileSync(join(dir, '_conflicts', 'nota-2.md'), 'mine')
    // Un archivo que no es nota no cuenta como conflicto.
    writeFileSync(join(dir, '_conflicts', '.DS_Store'), '')

    expect(readVaultHealth(dir).conflictCount).toBe(2)
  })

  it('un manifiesto corrupto reporta cero notas en vez de tirar la pantalla abajo', () => {
    mkdirSync(join(dir, '.nest-vault'), { recursive: true })
    writeFileSync(join(dir, '.nest-vault', 'manifest.json'), '{ no es json')

    expect(readVaultHealth(dir).noteCount).toBe(0)
  })
})
