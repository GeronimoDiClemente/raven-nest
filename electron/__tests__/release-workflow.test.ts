// La release estable sólo sale a mano: un push a main que toque package.json ya no
// dispara `release.yml`, y el cron de staple (que re-grapaba DMGs) no existe más.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as { load: (s: string) => unknown }

const raiz = resolve(__dirname, '..', '..')
const workflows = resolve(raiz, '.github', 'workflows')

type Disparadores = Record<string, unknown> | null
interface Workflow {
  on?: Disparadores
  true?: Disparadores
}

// js-yaml 4 (YAML 1.2) deja `on` como string; un parser YAML 1.1 lo vuelve el booleano
// `true`. Se leen las dos formas para no depender de la versión del parser.
function disparadores(archivo: string): Record<string, unknown> {
  const doc = yaml.load(readFileSync(resolve(workflows, archivo), 'utf8')) as Workflow
  const on = doc.on ?? doc.true
  if (on === null || typeof on !== 'object') {
    throw new Error(`${archivo}: no se encontró un bloque \`on:\` con disparadores`)
  }
  return on
}

describe('release.yml', () => {
  it('no tiene disparador push: la release estable no sale sola al tocar package.json', () => {
    expect(Object.keys(disparadores('release.yml'))).not.toContain('push')
  })

  it('sólo queda workflow_dispatch como disparador', () => {
    expect(Object.keys(disparadores('release.yml'))).toEqual(['workflow_dispatch'])
  })

  it('workflow_dispatch sigue con el input canal y sus opciones estable y beta', () => {
    const dispatch = disparadores('release.yml').workflow_dispatch as {
      inputs?: { canal?: { options?: string[] } }
    }
    expect(dispatch?.inputs?.canal?.options).toEqual(['estable', 'beta'])
  })
})

describe('staple-pending-releases.yml', () => {
  it('no existe', () => {
    expect(existsSync(resolve(workflows, 'staple-pending-releases.yml'))).toBe(false)
  })
})
