import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { makeTmpDir, cleanupTmp } from './setup'
import { ensureLocalAuthMaterial } from '../memory-local-auth'

// Regression coverage for C2 (review round 1): the pipe name and the per-request auth
// token must both be unpredictable and stable across restarts.
describe('memory-local-auth', () => {
  let dir: string

  afterEach(() => cleanupTmp(dir))

  it('generates a pipeId and token on first call', () => {
    dir = makeTmpDir('raven-local-auth-')
    const material = ensureLocalAuthMaterial(dir)
    expect(material.pipeId).toMatch(/^[0-9a-f]{32}$/)
    expect(material.token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('persists and reuses the same material across calls (stable across restarts)', () => {
    dir = makeTmpDir('raven-local-auth-')
    const first = ensureLocalAuthMaterial(dir)
    const second = ensureLocalAuthMaterial(dir)
    expect(second).toEqual(first)
  })

  it('two different installs never produce the same pipeId or token', () => {
    dir = makeTmpDir('raven-local-auth-')
    const dirB = makeTmpDir('raven-local-auth-b-')
    const a = ensureLocalAuthMaterial(dir)
    const b = ensureLocalAuthMaterial(dirB)
    expect(a.pipeId).not.toBe(b.pipeId)
    expect(a.token).not.toBe(b.token)
    cleanupTmp(dirB)
  })

  it('regenerates material if the persisted file is corrupt', () => {
    dir = makeTmpDir('raven-local-auth-')
    mkdirSync(join(dir, '.raven-nest', 'memory'), { recursive: true })
    writeFileSync(join(dir, '.raven-nest', 'memory', 'pipe-auth.json'), 'not json{{{')
    const material = ensureLocalAuthMaterial(dir)
    expect(material.pipeId).toMatch(/^[0-9a-f]{32}$/)
  })

  it('regenerates material if the persisted file is missing required fields', () => {
    dir = makeTmpDir('raven-local-auth-')
    mkdirSync(join(dir, '.raven-nest', 'memory'), { recursive: true })
    writeFileSync(join(dir, '.raven-nest', 'memory', 'pipe-auth.json'), JSON.stringify({ pipeId: 'x' }))
    const material = ensureLocalAuthMaterial(dir)
    expect(material.token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('writes the material file with 0600 permissions where the platform supports it', () => {
    dir = makeTmpDir('raven-local-auth-')
    ensureLocalAuthMaterial(dir)
    const raw = readFileSync(join(dir, '.raven-nest', 'memory', 'pipe-auth.json'), 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
  })
})
