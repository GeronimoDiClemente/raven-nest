import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadTeamThreadSettings, saveTeamThreadSettings } from '../integrations/team-thread-config'

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
