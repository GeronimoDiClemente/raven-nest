import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { PresetStore } from '../preset-store'
import type { RavenPreset } from '../../src/types'

describe('PresetStore', () => {
  let repo: string
  let store: PresetStore

  beforeEach(() => {
    repo = makeTmpDir('raven-preset-')
    store = new PresetStore()
  })

  afterEach(() => cleanupTmp(repo))

  it('returns [] when .raven/presets does not exist', () => {
    expect(store.list(repo)).toEqual([])
  })

  it('returns [] when .raven/presets is empty', () => {
    mkdirSync(join(repo, '.raven', 'presets'), { recursive: true })
    expect(store.list(repo)).toEqual([])
  })

  it('loads valid presets', () => {
    const dir = join(repo, '.raven', 'presets')
    mkdirSync(dir, { recursive: true })
    const preset: RavenPreset = {
      id: 'next-dev',
      name: 'Next.js dev',
      setup: ['pnpm install'],
      dev: 'pnpm dev',
      ports: [3000],
    }
    writeFileSync(join(dir, 'next-dev.json'), JSON.stringify(preset))
    expect(store.list(repo)).toEqual([preset])
  })

  it('skips invalid JSON without crashing', () => {
    const dir = join(repo, '.raven', 'presets')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'broken.json'), '{not json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(store.list(repo)).toEqual([])
    warn.mockRestore()
  })

  it('skips presets that fail schema validation', () => {
    const dir = join(repo, '.raven', 'presets')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'noname.json'), JSON.stringify({ id: 'noname' }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(store.list(repo)).toEqual([])
    warn.mockRestore()
  })

  it('persists with save() and re-reads with list()', () => {
    const preset: RavenPreset = { id: 'vite', name: 'Vite', setup: ['npm i'], ports: [5173] }
    store.save(repo, preset)
    expect(existsSync(join(repo, '.raven', 'presets', 'vite.json'))).toBe(true)
    expect(store.list(repo)).toEqual([preset])
  })

  it('save() normalizes invalid id to slug', () => {
    const preset = { id: 'My Cool Preset!', name: 'cool' } as RavenPreset
    const saved = store.save(repo, preset)
    expect(saved.id).toBe('my-cool-preset')
    expect(store.list(repo)[0]?.id).toBe('my-cool-preset')
  })

  it('save() rejects schema violation', () => {
    expect(() => store.save(repo, { id: 'x' } as RavenPreset)).toThrow()
  })

  it('delete() removes the file', () => {
    store.save(repo, { id: 'tmp', name: 'tmp' } as RavenPreset)
    store.delete(repo, 'tmp')
    expect(store.list(repo)).toEqual([])
  })

  it('delete() ignores invalid id (path traversal guard)', () => {
    store.save(repo, { id: 'safe', name: 'safe' } as RavenPreset)
    store.delete(repo, '../../etc')
    expect(store.list(repo).length).toBe(1)
  })

  it('get() returns matching preset or null', () => {
    store.save(repo, { id: 'a', name: 'A' } as RavenPreset)
    expect(store.get(repo, 'a')?.name).toBe('A')
    expect(store.get(repo, 'missing')).toBeNull()
  })

  it('warns and keeps last on duplicate id across files', () => {
    const dir = join(repo, '.raven', 'presets')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '1.json'), JSON.stringify({ id: 'dup', name: 'first' }))
    writeFileSync(join(dir, '2.json'), JSON.stringify({ id: 'dup', name: 'second' }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const list = store.list(repo)
    expect(list.length).toBe(2)
    warn.mockRestore()
  })
})
