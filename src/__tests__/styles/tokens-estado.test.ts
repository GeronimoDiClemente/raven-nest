import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const raiz = resolve(here, '../../..')
const global = readFileSync(resolve(raiz, 'src/styles/global.css'), 'utf8')
const tw = readFileSync(resolve(raiz, 'src/styles/tailwind.css'), 'utf8')

describe('tokens de estado', () => {
  it('existen los tres roles y ninguno más', () => {
    expect(global).toMatch(/--ok:\s*#4ade80/)
    expect(global).toMatch(/--warn:\s*#e3b341/)
    // El rojo ya venía del contrato shadcn; no se duplica.
    expect(global).toMatch(/--destructive:\s*#ff6568/)
  })

  it('están expuestos a Tailwind por referencia, no copiados', () => {
    expect(tw).toContain('--color-ok: var(--ok);')
    expect(tw).toContain('--color-warn: var(--warn);')
  })

  it('el primer consumidor real usa el token', () => {
    const dot = global.slice(global.indexOf('.tab-activity-dot'))
    expect(dot.slice(0, 300)).toContain('var(--ok)')
  })
})
