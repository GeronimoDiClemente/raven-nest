import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  extToLang,
  ensureLanguage,
  applyTheme,
  BUNDLED_THEMES,
  __resetShikiForTests,
  type MonacoLike,
} from '../../lib/shiki-monaco'
import { shikiToMonaco } from '@shikijs/monaco'

// Todo shiki se mockea: estos tests validan el mapeo ext→lang, la carga lazy
// y — sobre todo — que CUALQUIER falla degrade a Monarch + vs-dark sin tirar.
const shikiMock = vi.hoisted(() => ({
  createFail: false,
  loadThemeFail: false,
  loadLangFail: false,
  loadedLangs: [] as string[],
  loadedThemes: [] as string[],
}))

vi.mock('shiki/core', () => ({
  createHighlighterCore: vi.fn(async () => {
    if (shikiMock.createFail) throw new Error('wasm boom')
    return {
      loadTheme: vi.fn(async (theme: { name?: string }) => {
        if (shikiMock.loadThemeFail) throw new Error('theme boom')
        shikiMock.loadedThemes.push(theme?.name ?? 'anon')
      }),
      loadLanguage: vi.fn(async (...grammars: Array<{ name?: string }>) => {
        if (shikiMock.loadLangFail) throw new Error('lang boom')
        for (const g of grammars.flat()) if (g?.name) shikiMock.loadedLangs.push(g.name)
      }),
      getLoadedLanguages: vi.fn(() => shikiMock.loadedLangs),
      getLoadedThemes: vi.fn(() => shikiMock.loadedThemes),
    }
  }),
}))
vi.mock('shiki/engine/oniguruma', () => ({ createOnigurumaEngine: vi.fn(() => ({})) }))
vi.mock('shiki/wasm', () => ({ default: {} }))
vi.mock('@shikijs/monaco', () => ({ shikiToMonaco: vi.fn() }))

function makeMonaco(): MonacoLike {
  return { editor: { setTheme: vi.fn() } } as unknown as MonacoLike
}

beforeEach(() => {
  vi.clearAllMocks()
  shikiMock.createFail = false
  shikiMock.loadThemeFail = false
  shikiMock.loadLangFail = false
  shikiMock.loadedLangs = []
  shikiMock.loadedThemes = []
  __resetShikiForTests()
})

describe('extToLang', () => {
  it('maps common extensions to shiki language ids', () => {
    expect(extToLang('ts')).toBe('typescript')
    expect(extToLang('tsx')).toBe('tsx')
    expect(extToLang('py')).toBe('python')
    expect(extToLang('rs')).toBe('rust')
    expect(extToLang('yml')).toBe('yaml')
  })
  it('is case-insensitive and tolerates a leading dot', () => {
    expect(extToLang('TS')).toBe('typescript')
    expect(extToLang('.tsx')).toBe('tsx')
  })
  it('returns null for unknown extensions', () => {
    expect(extToLang('xyzzy')).toBeNull()
  })
})

describe('ensureLanguage', () => {
  it('loads the grammar lazily, re-runs shikiToMonaco and returns the lang id', async () => {
    const monaco = makeMonaco()
    const lang = await ensureLanguage(monaco, 'ts')
    expect(lang).toBe('typescript')
    expect(shikiMock.loadedLangs).toContain('typescript')
    expect(shikiToMonaco).toHaveBeenCalled()
  })

  it('does not reload an already-loaded language', async () => {
    const monaco = makeMonaco()
    await ensureLanguage(monaco, 'ts')
    const calls = vi.mocked(shikiToMonaco).mock.calls.length
    await ensureLanguage(monaco, 'ts')
    expect(vi.mocked(shikiToMonaco).mock.calls.length).toBe(calls)
  })

  it('returns null for an unknown extension', async () => {
    expect(await ensureLanguage(makeMonaco(), 'xyzzy')).toBeNull()
  })

  it('returns null (Monarch fallback) when the highlighter fails to create', async () => {
    shikiMock.createFail = true
    expect(await ensureLanguage(makeMonaco(), 'ts')).toBeNull()
  })

  it('returns null (Monarch fallback) when the grammar fails to load', async () => {
    shikiMock.loadLangFail = true
    expect(await ensureLanguage(makeMonaco(), 'ts')).toBeNull()
  })
})

describe('applyTheme', () => {
  it('passes monaco built-in themes straight to setTheme without shiki', async () => {
    const monaco = makeMonaco()
    expect(await applyTheme(monaco, 'vs-dark')).toBe(true)
    expect(monaco.editor.setTheme).toHaveBeenCalledWith('vs-dark')
    expect(shikiMock.loadedThemes).toEqual([])
  })

  it('loads a bundled shiki theme and sets it', async () => {
    const monaco = makeMonaco()
    expect(await applyTheme(monaco, 'dracula')).toBe(true)
    expect(shikiMock.loadedThemes).toContain('dracula')
    expect(shikiToMonaco).toHaveBeenCalled()
    expect(monaco.editor.setTheme).toHaveBeenCalledWith('dracula')
  })

  it('loads an installed theme JSON (name forced to the slug) via getInstalled', async () => {
    const monaco = makeMonaco()
    const getInstalled = vi.fn().mockResolvedValue([
      { name: 'acme-dark', displayName: 'Acme Dark', isDark: true, theme: { name: 'Acme Dark', tokenColors: [] } },
    ])
    expect(await applyTheme(monaco, 'acme-dark', { getInstalled })).toBe(true)
    expect(shikiMock.loadedThemes).toContain('acme-dark')
    expect(monaco.editor.setTheme).toHaveBeenCalledWith('acme-dark')
  })

  it('falls back to vs-dark for an unknown theme name', async () => {
    const monaco = makeMonaco()
    const getInstalled = vi.fn().mockResolvedValue([])
    expect(await applyTheme(monaco, 'no-existe', { getInstalled })).toBe(false)
    expect(monaco.editor.setTheme).toHaveBeenCalledWith('vs-dark')
  })

  it('falls back to vs-dark when the highlighter cannot load the theme', async () => {
    shikiMock.loadThemeFail = true
    const monaco = makeMonaco()
    expect(await applyTheme(monaco, 'dracula')).toBe(false)
    expect(monaco.editor.setTheme).toHaveBeenCalledWith('vs-dark')
  })

  it('falls back to vs-dark when the highlighter itself fails to create', async () => {
    shikiMock.createFail = true
    const monaco = makeMonaco()
    expect(await applyTheme(monaco, 'dracula')).toBe(false)
    expect(monaco.editor.setTheme).toHaveBeenCalledWith('vs-dark')
  })
})

describe('BUNDLED_THEMES', () => {
  it('ships the pack of well-known themes with display names', () => {
    const names = BUNDLED_THEMES.map((t) => t.name)
    expect(names).toContain('dracula')
    expect(names).toContain('one-dark-pro')
    expect(names).toContain('github-light')
    expect(BUNDLED_THEMES.length).toBeGreaterThanOrEqual(15)
    for (const t of BUNDLED_THEMES) {
      expect(t.displayName.trim()).not.toBe('')
      expect(typeof t.isDark).toBe('boolean')
    }
  })
})
