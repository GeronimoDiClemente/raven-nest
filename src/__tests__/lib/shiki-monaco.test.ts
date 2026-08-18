import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  extToLang,
  ensureLanguage,
  applyTheme,
  isMonacoBuiltinTheme,
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
  patchedSetTheme: null as ((name: string) => void) | null,
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
// El shikiToMonaco REAL pisa monaco.editor.setTheme con una versión que
// resuelve contra el registry de shiki y tira ShikiError para cualquier
// nombre no cargado — built-ins de Monaco ('vs-dark') incluidos. El mock
// tiene que emular ese patch: con un vi.fn() pelado, la suite entera pasaba
// mientras la app real desmontaba React al primer setTheme('vs-dark')
// post-patch (pantalla negra al cambiar de archivo, 2026-08-18).
vi.mock('@shikijs/monaco', () => ({
  shikiToMonaco: vi.fn((_highlighter: unknown, monaco: { editor: { setTheme: (name: string) => void } }) => {
    const patched = vi.fn((name: string) => {
      if (!shikiMock.loadedThemes.includes(name)) {
        throw new Error(`Theme \`${name}\` not found, you may need to load it first`)
      }
    })
    shikiMock.patchedSetTheme = patched
    monaco.editor.setTheme = patched
    // El shikiToMonaco REAL termina con monaco.editor.setTheme(themeIds[0])
    // incondicional. Con cero temas shiki cargados eso es setTheme(undefined)
    // → getTheme tira ShikiError → shikiToMonaco ENTERO tira, dejando el
    // patch instalado a medias. Emularlo es lo que expone que ensureLanguage
    // nunca registró tokenizers para usuarios en tema built-in (2026-08-18).
    monaco.editor.setTheme(shikiMock.loadedThemes[0] as string)
  }),
}))

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
  shikiMock.patchedSetTheme = null
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
    // El tema shiki tiene que llegar al setTheme QUE INSTALÓ shiki (la
    // identidad de monaco.editor.setTheme post-sync es detalle interno).
    expect(shikiMock.patchedSetTheme).toHaveBeenCalledWith('dracula')
  })

  it('loads an installed theme JSON (name forced to the slug) via getInstalled', async () => {
    const monaco = makeMonaco()
    const getInstalled = vi.fn().mockResolvedValue([
      { name: 'acme-dark', displayName: 'Acme Dark', isDark: true, theme: { name: 'Acme Dark', tokenColors: [] } },
    ])
    expect(await applyTheme(monaco, 'acme-dark', { getInstalled })).toBe(true)
    expect(shikiMock.loadedThemes).toContain('acme-dark')
    expect(shikiMock.patchedSetTheme).toHaveBeenCalledWith('acme-dark')
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

describe('setTheme post-patch de shikiToMonaco', () => {
  // El gesto que mataba la app: cualquier caller (el wrapper de
  // @monaco-editor/react al re-crear el widget, los fallbacks de applyTheme)
  // llama setTheme('vs-dark') DESPUÉS de que shiki patcheó — y el patch tira.
  it('keeps monaco built-in themes working after shikiToMonaco patches setTheme', async () => {
    const monaco = makeMonaco()
    const original = monaco.editor.setTheme
    await ensureLanguage(monaco, 'ts') // dispara syncToMonaco → patch
    expect(shikiMock.patchedSetTheme).not.toBeNull()
    expect(() => monaco.editor.setTheme('vs-dark')).not.toThrow()
    expect(original).toHaveBeenCalledWith('vs-dark')
  })

  it('still routes shiki themes through the patched setTheme', async () => {
    const monaco = makeMonaco()
    const original = monaco.editor.setTheme
    await applyTheme(monaco, 'dracula')
    vi.mocked(shikiMock.patchedSetTheme!).mockClear()
    vi.mocked(original).mockClear()
    monaco.editor.setTheme('dracula')
    expect(shikiMock.patchedSetTheme).toHaveBeenCalledWith('dracula')
    expect(original).not.toHaveBeenCalled()
  })

  it('falls back to the original vs-dark when the patched setTheme throws', async () => {
    const monaco = makeMonaco()
    const original = monaco.editor.setTheme
    await ensureLanguage(monaco, 'ts') // patch instalado, ningún tema shiki cargado
    expect(() => monaco.editor.setTheme('dracula')).not.toThrow()
    expect(original).toHaveBeenCalledWith('vs-dark')
  })

  // El shikiToMonaco real hace setTheme(themeIds[0]) al final. Con el usuario
  // en un tema built-in (cero temas shiki) eso: (a) tira dentro de
  // shikiToMonaco → sin contención, ensureLanguage devolvía null y NUNCA
  // registraba tokenizers (TextMate silenciosamente roto para temas built-in);
  // (b) si no tirara, resetearía Monaco a 'vs' (light) — visto en vivo como
  // líneas blancas y minimap claro sobre la UI oscura.
  it('ensureLanguage still returns the lang id when no shiki theme is loaded', async () => {
    const monaco = makeMonaco()
    expect(await ensureLanguage(monaco, 'ts')).toBe('typescript')
  })

  it('re-applies the tracked builtin theme after a grammar sync', async () => {
    const monaco = makeMonaco()
    const original = monaco.editor.setTheme
    await applyTheme(monaco, 'vs-dark')
    vi.mocked(original).mockClear()
    await ensureLanguage(monaco, 'ts')
    expect(original).toHaveBeenCalledWith('vs-dark')
  })

  it('re-applies the tracked shiki theme after a grammar sync', async () => {
    const monaco = makeMonaco()
    await applyTheme(monaco, 'dracula')
    await ensureLanguage(monaco, 'ts')
    expect(shikiMock.patchedSetTheme).toHaveBeenCalledWith('dracula')
  })
})

describe('isMonacoBuiltinTheme', () => {
  it('recognizes the native monaco themes (no shiki involved)', () => {
    expect(isMonacoBuiltinTheme('vs')).toBe(true)
    expect(isMonacoBuiltinTheme('vs-dark')).toBe(true)
    expect(isMonacoBuiltinTheme('hc-black')).toBe(true)
    expect(isMonacoBuiltinTheme('dracula')).toBe(false)
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
