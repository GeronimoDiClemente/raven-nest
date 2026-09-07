import { describe, it, expect } from 'vitest'
import {
  vaultSlug,
  vaultFileName,
  resolveVaultFileNames,
  projectFolderName,
  isForbiddenVaultRoot,
} from '../integrations/vault-naming'
import type { MemoryProject } from '../integrations/memory-port'

describe('vaultSlug', () => {
  it('lowercases and dashes spaces', () => {
    expect(vaultSlug('Webhook de Stripe rechazado por JWT')).toBe('webhook-de-stripe-rechazado-por-jwt')
  })

  it('strips Windows-invalid chars and other punctuation', () => {
    expect(vaultSlug('a<b>c:d"e/f\\g|h?i*j')).toBe('a-b-c-d-e-f-g-h-i-j')
  })

  it('strips a bare slash (the case chunker.ts\'s slugify lets through)', () => {
    expect(vaultSlug('Git & worktrees/Worktree commits')).toBe('git-worktrees-worktree-commits')
  })

  it('collapses Unicode/emoji titles to untitled', () => {
    expect(vaultSlug('日本語のタイトル')).toBe('untitled')
    expect(vaultSlug('🎉🎉🎉')).toBe('untitled')
  })

  it('collapses an empty or whitespace-only title to untitled', () => {
    expect(vaultSlug('')).toBe('untitled')
    expect(vaultSlug('   ')).toBe('untitled')
  })

  it('cuts at 60 chars on the last dash, never mid-word', () => {
    const long = 'a'.repeat(58) + ' b c d e'
    const slug = vaultSlug(long)
    expect(slug.length).toBeLessThanOrEqual(60)
    expect(slug.endsWith('-')).toBe(false)
  })

  it('a title that starts with an underscore-like word still slugs cleanly', () => {
    expect(vaultSlug('_private note')).toBe('private-note')
  })

  it('is stable across repeated dashes and mixed case', () => {
    expect(vaultSlug('Foo---Bar   Baz')).toBe('foo-bar-baz')
  })
})

describe('vaultFileName / resolveVaultFileNames', () => {
  it('default name is slug + last 8 hex of sync_id', () => {
    expect(vaultFileName('Release flow', 'obs-3f9a12c7d4e5b6a7')).toBe('release-flow--d4e5b6a7.md')
  })

  it('no collision: every item keeps its short 8-hex name', () => {
    const items = [
      { syncId: 'obs-aaaaaaaaaaaaaaaa', title: 'Alpha' },
      { syncId: 'obs-bbbbbbbbbbbbbbbb', title: 'Beta' },
    ]
    const names = resolveVaultFileNames(items)
    expect(names.get(items[0].syncId)).toBe('alpha--aaaaaaaa.md')
    expect(names.get(items[1].syncId)).toBe('beta--bbbbbbbb.md')
  })

  it('same slug + same 8-hex suffix: lexicographically smaller sync_id keeps the short name, the other falls back to full', () => {
    const items = [
      { syncId: 'obs-zzzzzzzz11111111', title: 'Release flow' },
      { syncId: 'obs-aaaaaaaa11111111', title: 'Release flow' },
    ]
    const names = resolveVaultFileNames(items)
    expect(names.get('obs-aaaaaaaa11111111')).toBe('release-flow--11111111.md')
    expect(names.get('obs-zzzzzzzz11111111')).toBe('release-flow--obs-zzzzzzzz11111111.md')
  })

  it('collision resolution does not depend on input array order', () => {
    const items = [
      { syncId: 'obs-zzzzzzzz11111111', title: 'Release flow' },
      { syncId: 'obs-aaaaaaaa11111111', title: 'Release flow' },
    ]
    const forward = resolveVaultFileNames(items)
    const shuffled = resolveVaultFileNames([...items].reverse())
    expect(shuffled.get('obs-aaaaaaaa11111111')).toBe(forward.get('obs-aaaaaaaa11111111'))
    expect(shuffled.get('obs-zzzzzzzz11111111')).toBe(forward.get('obs-zzzzzzzz11111111'))
  })

  it('different slug or different 8-hex suffix never collides', () => {
    const items = [
      { syncId: 'obs-aaaaaaaaaaaaaaaa', title: 'Release flow' },
      { syncId: 'obs-bbbbbbbbbbbbbbbb', title: 'Release flow v2' },
    ]
    const names = resolveVaultFileNames(items)
    expect(new Set(names.values()).size).toBe(2)
  })
})

describe('projectFolderName', () => {
  const project = (over: Partial<MemoryProject>): MemoryProject => ({
    projectKey: '3f9a12c7d4e5b6a7',
    displayName: 'nest-memory',
    remoteSlug: null,
    enrolled: true,
    ...over,
  })

  it('prefers the last segment of the remote over display_name', () => {
    const p = project({ remoteSlug: 'github.com/GeronimoDiClemente/raven-nest', displayName: 'integrations' })
    expect(projectFolderName('3f9a12c7d4e5b6a7', p)).toBe('raven-nest--3f9a12c7')
  })

  it('falls back to display_name when there is no remote', () => {
    const p = project({ remoteSlug: null, displayName: 'nest-memory' })
    expect(projectFolderName('3f9a12c7d4e5b6a7', p)).toBe('nest-memory--3f9a12c7')
  })

  it('__global__ maps to _global with no hash suffix, regardless of project row', () => {
    expect(projectFolderName('__global__', null)).toBe('_global')
    expect(projectFolderName('__global__', project({}))).toBe('_global')
  })

  it('a project_key with no projects row falls back to the raw key', () => {
    expect(projectFolderName('deadbeefcafebabe', null)).toBe('deadbeefcafebabe')
  })

  it('two repos with the same name in different orgs do not collide (8-hex suffix differs)', () => {
    const a = project({ remoteSlug: 'github.com/org-a/api', displayName: 'api' })
    const b = project({ remoteSlug: 'github.com/org-b/api', displayName: 'api' })
    expect(projectFolderName('11111111aaaaaaaa', a)).not.toBe(projectFolderName('22222222bbbbbbbb', b))
  })
})

describe('isForbiddenVaultRoot', () => {
  const baseCtx = {
    ravenHomeDir: '/home/gero',
    accountClaudeDirs: ['/home/gero/.raven-nest/accounts/claude/Gero Personal'],
    enrolledRepoRoots: ['/home/gero/Dev/raven-nest'],
    platform: 'linux' as NodeJS.Platform,
  }

  it('rejects the memory dir itself and anything nested inside it', () => {
    expect(isForbiddenVaultRoot('/home/gero/.raven-nest/memory', baseCtx).forbidden).toBe(true)
    expect(isForbiddenVaultRoot('/home/gero/.raven-nest/memory/user-123', baseCtx).forbidden).toBe(true)
  })

  it('rejects the global .claude dir', () => {
    expect(isForbiddenVaultRoot('/home/gero/.claude', baseCtx).forbidden).toBe(true)
  })

  it('rejects a known account .claude dir', () => {
    expect(isForbiddenVaultRoot('/home/gero/.raven-nest/accounts/claude/Gero Personal/.claude', baseCtx).forbidden).toBe(true)
  })

  it('rejects the root of an enrolled repo', () => {
    expect(isForbiddenVaultRoot('/home/gero/Dev/raven-nest', baseCtx).forbidden).toBe(true)
    expect(isForbiddenVaultRoot('/home/gero/Dev/raven-nest/electron', baseCtx).forbidden).toBe(true)
  })

  it('rejects a path with a .git ancestor when hasGitDir says so', () => {
    const result = isForbiddenVaultRoot('/home/gero/some/random/repo/notes', {
      ...baseCtx,
      hasGitDir: (dir) => dir === '/home/gero/some/random/repo',
    })
    expect(result.forbidden).toBe(true)
  })

  it('accepts a plain, unrelated directory with no injected hasGitDir', () => {
    expect(isForbiddenVaultRoot('/home/gero/.raven-nest/memory-vault/user-123', baseCtx).forbidden).toBe(false)
  })

  it('is case-insensitive and separator-insensitive (mixed / and \\, mixed case)', () => {
    const winCtx = { ...baseCtx, ravenHomeDir: 'C:\\Users\\gero', platform: 'win32' as NodeJS.Platform, accountClaudeDirs: [], enrolledRepoRoots: [] }
    expect(isForbiddenVaultRoot('C:\\USERS\\gero\\.raven-nest\\MEMORY', winCtx).forbidden).toBe(true)
    expect(isForbiddenVaultRoot('c:/users/gero/.raven-nest/memory/sub', winCtx).forbidden).toBe(true)
  })

  it('rejects a custom root over 120 chars only on Windows', () => {
    const longRoot = 'C:\\Users\\gero\\' + 'a'.repeat(120)
    const winCtx = { ...baseCtx, platform: 'win32' as NodeJS.Platform, accountClaudeDirs: [], enrolledRepoRoots: [] }
    const linuxCtx = { ...baseCtx, platform: 'linux' as NodeJS.Platform, accountClaudeDirs: [], enrolledRepoRoots: [] }
    expect(isForbiddenVaultRoot(longRoot, winCtx).forbidden).toBe(true)
    expect(isForbiddenVaultRoot('/home/gero/' + 'a'.repeat(120), linuxCtx).forbidden).toBe(false)
  })
})
