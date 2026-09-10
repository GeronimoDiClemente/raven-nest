import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../../styles/global.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

describe('un solo acento, y es acromático', () => {
  // El barrido original buscaba hex y no vio nada escrito como rgba().
  // Este test cierra las DOS formas para que no vuelva a pasar.
  it('no queda el azul viejo en ninguna notación', () => {
    expect(css).not.toMatch(/#0066[fF][fF]/)
    expect(css).not.toMatch(/rgba?\(\s*0\s*,\s*102\s*,\s*255/)
  })

  it('no quedan los violetas viejos en ninguna notación', () => {
    expect(css).not.toMatch(/#7c3aed/i)
    expect(css).not.toMatch(/#[aA]78[bB][fF][aA]/)
    expect(css).not.toMatch(/rgba?\(\s*124\s*,\s*58\s*,\s*237/)
    expect(css).not.toMatch(/rgba?\(\s*167\s*,\s*139\s*,\s*250/)
  })
})
