import { describe, it, expect } from 'vitest'
import {
  normalizeRemote,
  projectKeyFromRemote,
  projectKeyFromPath,
  resolveProjectKey,
  GLOBAL_PROJECT_KEY,
} from '../memory-project-key'

describe('normalizeRemote', () => {
  it('normalizes SSH scp-style GitHub remotes', () => {
    expect(normalizeRemote('git@github.com:acme/api.git')).toBe('github.com/acme/api')
  })

  it('normalizes HTTPS GitHub remotes', () => {
    expect(normalizeRemote('https://github.com/acme/api')).toBe('github.com/acme/api')
    expect(normalizeRemote('https://github.com/acme/api.git')).toBe('github.com/acme/api')
  })

  it('SSH and HTTPS forms of the same repo normalize identically', () => {
    expect(normalizeRemote('git@github.com:acme/api.git')).toBe(normalizeRemote('https://github.com/acme/api.git'))
  })

  it('normalizes GitLab and generic hosts too', () => {
    expect(normalizeRemote('git@gitlab.com:org/repo.git')).toBe('gitlab.com/org/repo')
    expect(normalizeRemote('ssh://git@example.com/org/repo.git')).toBe('example.com/org/repo')
  })

  it('returns null for garbage input', () => {
    expect(normalizeRemote('')).toBeNull()
    expect(normalizeRemote('not a url at all')).toBeNull()
  })
})

describe('projectKeyFromRemote', () => {
  it('is a 16-char hex sha256 prefix', () => {
    const key = projectKeyFromRemote('https://github.com/acme/api')!
    expect(key).toMatch(/^[0-9a-f]{16}$/)
  })

  it('two different repos never collide', () => {
    const a = projectKeyFromRemote('https://github.com/acme/api')
    const b = projectKeyFromRemote('https://github.com/acme/apix')
    expect(a).not.toBe(b)
  })

  it('SSH and HTTPS forms of the same repo produce the same project key', () => {
    const a = projectKeyFromRemote('git@github.com:acme/api.git')
    const b = projectKeyFromRemote('https://github.com/acme/api.git')
    expect(a).toBe(b)
  })
})

describe('projectKeyFromPath', () => {
  it('is case-insensitive and separator-insensitive on Windows-style paths', () => {
    const a = projectKeyFromPath('C:\\Users\\bauti\\raven-nest')
    const b = projectKeyFromPath('c:/users/bauti/raven-nest')
    expect(a).toBe(b)
  })

  it('two different local-only repos never collide', () => {
    const a = projectKeyFromPath('/home/bauti/project-a')
    const b = projectKeyFromPath('/home/bauti/project-b')
    expect(a).not.toBe(b)
  })
})

describe('resolveProjectKey', () => {
  it('prefers remote over path', () => {
    const key = resolveProjectKey({ remoteUrl: 'https://github.com/acme/api', rootPath: '/some/path' })
    expect(key).toBe(projectKeyFromRemote('https://github.com/acme/api'))
  })

  it('falls back to path when there is no remote', () => {
    const key = resolveProjectKey({ rootPath: '/some/path' })
    expect(key).toBe(projectKeyFromPath('/some/path'))
  })

  it('falls back to __global__ when neither is present', () => {
    expect(resolveProjectKey({})).toBe(GLOBAL_PROJECT_KEY)
  })
})
