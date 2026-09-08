import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { enabledTeamThreadProjectKeys, loadTeamThreadSettings, planAllowsTeamSharing, saveTeamThreadSettings, teamThreadSettingsPath } from '../integrations/team-thread-config'

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-config-'))
  path = join(dir, 'team-thread.json')
})

describe('loadTeamThreadSettings', () => {
  it('el default es conservador: apagado', () => {
    const s = loadTeamThreadSettings(path, 'proj1')
    expect(s.enabled).toBe(false)
    expect(s.includedTypes).toEqual(['handoff', 'decision'])
    expect(s.writeAgentsPointer).toBe(true)
  })

  it('un archivo corrupto no rompe: cae al default', () => {
    writeFileSync(path, '{ esto no es json')
    expect(loadTeamThreadSettings(path, 'proj1').enabled).toBe(false)
  })

  it('cada proyecto tiene su propia config', () => {
    saveTeamThreadSettings(path, 'proj1', { enabled: true })
    expect(loadTeamThreadSettings(path, 'proj1').enabled).toBe(true)
    expect(loadTeamThreadSettings(path, 'proj2').enabled).toBe(false)
  })

  it('enabled: string en disco cae al default (no truthy/falsy)', () => {
    writeFileSync(path, JSON.stringify({ proj1: { enabled: 'yes' } }))
    expect(loadTeamThreadSettings(path, 'proj1').enabled).toBe(false)
  })

  it('enabled: number en disco cae al default', () => {
    writeFileSync(path, JSON.stringify({ proj1: { enabled: 1 } }))
    expect(loadTeamThreadSettings(path, 'proj1').enabled).toBe(false)
  })

  it('includedTypes: no-array en disco cae al default', () => {
    writeFileSync(path, JSON.stringify({ proj1: { includedTypes: 'handoff' } }))
    expect(loadTeamThreadSettings(path, 'proj1').includedTypes).toEqual(['handoff', 'decision'])
  })

  it('campos desconocidos no persisten', () => {
    writeFileSync(path, JSON.stringify({ proj1: { enabled: true, campoViejo: 42 } }))
    const loaded = loadTeamThreadSettings(path, 'proj1')
    expect(loaded).not.toHaveProperty('campoViejo')
    saveTeamThreadSettings(path, 'proj1', {})
    const raw = JSON.parse(require('fs').readFileSync(path, 'utf8'))
    expect(raw.proj1).not.toHaveProperty('campoViejo')
  })
})

describe('saveTeamThreadSettings', () => {
  it('el patch es parcial y no pisa lo que no toca', () => {
    saveTeamThreadSettings(path, 'proj1', { enabled: true, includedTypes: ['handoff', 'decision', 'architecture'] })
    const s = saveTeamThreadSettings(path, 'proj1', { writeAgentsPointer: false })
    expect(s.enabled).toBe(true)
    expect(s.includedTypes).toEqual(['handoff', 'decision', 'architecture'])
    expect(s.writeAgentsPointer).toBe(false)
  })
})

describe('teamThreadSettingsPath', () => {
  it('un archivo por cuenta, bajo team-thread-settings', () => {
    const p = teamThreadSettingsPath('/home/gero', 'user-123')
    expect(p).toBe(join('/home/gero', '.raven-nest', 'team-thread-settings', 'user-123.json'))
  })

  it('sin userId cae en _local', () => {
    const p = teamThreadSettingsPath('/home/gero', null)
    expect(p).toBe(join('/home/gero', '.raven-nest', 'team-thread-settings', '_local.json'))
  })

  it('userId vacio/blanco tambien cae en _local', () => {
    expect(teamThreadSettingsPath('/home/gero', '')).toBe(join('/home/gero', '.raven-nest', 'team-thread-settings', '_local.json'))
    expect(teamThreadSettingsPath('/home/gero', '   ')).toBe(join('/home/gero', '.raven-nest', 'team-thread-settings', '_local.json'))
  })
})

// C2: el gate barato de los disparadores 3 y 4 (poll de 60s y arranque). Con el hilo
// apagado en todos lados —el default— esos dos no pueden hacer NADA mas que esta lectura.
describe('enabledTeamThreadProjectKeys', () => {
  it('sin archivo todavia no hay ningun proyecto prendido', () => {
    expect(enabledTeamThreadProjectKeys(path)).toEqual([])
  })

  it('devuelve solo los prendidos', () => {
    saveTeamThreadSettings(path, 'proj-on', { enabled: true })
    saveTeamThreadSettings(path, 'proj-off', { enabled: false })
    saveTeamThreadSettings(path, 'proj-on-2', { enabled: true })

    expect(enabledTeamThreadProjectKeys(path).sort()).toEqual(['proj-on', 'proj-on-2'])
  })

  it('un `enabled` que no es booleano NO prende nada (misma validacion que load)', () => {
    writeFileSync(path, JSON.stringify({ proj1: { enabled: 'yes' }, proj2: { enabled: 1 } }), 'utf8')
    expect(enabledTeamThreadProjectKeys(path)).toEqual([])
  })

  it('un archivo ilegible no rompe el poll', () => {
    writeFileSync(path, 'no soy json', 'utf8')
    expect(enabledTeamThreadProjectKeys(path)).toEqual([])
  })
})

// I1: prender el toggle con un plan que no permite `scope: 'team'` produce filas que el
// servidor rechaza con `team_scope_not_allowed` — terminal, o sea que se descartan — y el
// usuario ve el hilo local poblado creyendo que compartio.
describe('planAllowsTeamSharing', () => {
  it('team y enterprise si', () => {
    expect(planAllowsTeamSharing('team')).toBe(true)
    expect(planAllowsTeamSharing('enterprise')).toBe(true)
  })

  it('free, pro y cualquier otro no', () => {
    expect(planAllowsTeamSharing('free')).toBe(false)
    expect(planAllowsTeamSharing('pro')).toBe(false)
    expect(planAllowsTeamSharing('cloud')).toBe(false)
  })

  it('no saber el plan NO bloquea: recien arrancada la app todavia no hubo status()', () => {
    expect(planAllowsTeamSharing(undefined)).toBe(true)
    expect(planAllowsTeamSharing(null)).toBe(true)
    expect(planAllowsTeamSharing('')).toBe(true)
  })
})
