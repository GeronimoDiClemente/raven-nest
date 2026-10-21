// Spec 2026-10-21 §4: las tarjetas de Memory settings se reescriben en filas con shadcn +
// utilidades — ningún sp-* ni estilo inline. La barra de cuota es la única excepción (D18):
// su ancho es un dato.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PERMITIDOS: Record<string, number> = {
  'CloudMemoryCard.tsx': 1,
  'LinkDeviceCard.tsx': 0,
  'SyncServiceCard.tsx': 0,
  'SyncTokenRow.tsx': 0,
  'MemoryEncryptionCard.tsx': 0,
  'TeamEncryptionCard.tsx': 0,
}

describe.each(Object.entries(PERMITIDOS))('%s', (archivo, estilos) => {
  const src = readFileSync(resolve(process.cwd(), 'src/components', archivo), 'utf8')
  it('no usa clases sp-*', () => { expect(src).not.toMatch(/\bsp-[a-z]/) })
  it(`tiene a lo sumo ${estilos} style inline`, () => { expect((src.match(/style=\{/g) ?? []).length).toBeLessThanOrEqual(estilos) })
  it('arma sus filas con SettingRow', () => { expect(src).toMatch(/SettingRow/) })
})
