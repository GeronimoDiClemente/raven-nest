import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { SpotlightEngine, _internals } from '../spotlight-engine'

describe('SpotlightEngine', () => {
  describe('isIgnored', () => {
    it('skips .git, node_modules, dist by default', () => {
      const ig = new Set(['.git', 'node_modules', 'dist'])
      expect(_internals.isIgnored('.git/HEAD', ig)).toBe(true)
      expect(_internals.isIgnored('node_modules/foo/index.js', ig)).toBe(true)
      expect(_internals.isIgnored('dist/bundle.js', ig)).toBe(true)
      expect(_internals.isIgnored('src/index.ts', ig)).toBe(false)
    })

    it('respects custom ignore list', () => {
      const ig = new Set(['.git', 'private'])
      expect(_internals.isIgnored('private/secret.env', ig)).toBe(true)
      expect(_internals.isIgnored('public/index.html', ig)).toBe(false)
    })

    it('treats empty path as ignored', () => {
      const ig = new Set<string>()
      expect(_internals.isIgnored('', ig)).toBe(true)
    })
  })

  describe('start/stop lifecycle', () => {
    let wt: string
    let root: string
    let engine: SpotlightEngine

    beforeEach(() => {
      wt = makeTmpDir('raven-spot-wt-')
      root = makeTmpDir('raven-spot-root-')
      engine = new SpotlightEngine()
    })

    afterEach(async () => {
      await engine.stop()
      cleanupTmp(wt)
      cleanupTmp(root)
    })

    it('isActive() reflects start/stop', async () => {
      expect(engine.isActive()).toBe(false)
      await engine.start(wt, root)
      expect(engine.isActive()).toBe(true)
      await engine.stop()
      expect(engine.isActive()).toBe(false)
    })

    it('switching to a different worktree stops the previous', async () => {
      const wt2 = makeTmpDir('raven-spot-wt2-')
      try {
        await engine.start(wt, root)
        await engine.start(wt2, root)
        const status = engine.status()
        expect(status.active).toBe(true)
        expect(status.worktreePath).toBe(wt2)
      } finally {
        await engine.stop()
        cleanupTmp(wt2)
      }
    })

    it('status() reports basic counters', async () => {
      await engine.start(wt, root)
      const s = engine.status()
      expect(s.active).toBe(true)
      expect(s.worktreePath).toBe(wt)
      expect(typeof s.events).toBe('number')
    })
  })
})
