import { describe, it, expect } from 'vitest'
import {
  parseThemeJson,
  validateVSCodeTheme,
  themeDisplayName,
  themeIsDark,
  themeSlug,
  matchThemeName,
} from '../../lib/theme-registry'

const dracula = {
  name: 'Dracula',
  type: 'dark',
  colors: { 'editor.background': '#282a36', 'editor.foreground': '#f8f8f2' },
  tokenColors: [{ scope: 'comment', settings: { foreground: '#6272a4' } }],
}

describe('validateVSCodeTheme', () => {
  it('accepts a well-formed VS Code theme', () => {
    const res = validateVSCodeTheme(dracula)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.theme.name).toBe('Dracula')
  })

  it('accepts a theme with only tokenColors (no colors block)', () => {
    const res = validateVSCodeTheme({ name: 'Min', tokenColors: [] })
    expect(res.ok).toBe(true)
  })

  it('accepts a theme with only colors (no tokenColors block)', () => {
    const res = validateVSCodeTheme({ name: 'Flat', colors: { 'editor.background': '#fff' } })
    expect(res.ok).toBe(true)
  })

  it('rejects non-object JSON with an actionable error', () => {
    for (const bad of [null, 42, 'hello', ['a']]) {
      const res = validateVSCodeTheme(bad)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toMatch(/VS Code color theme/)
    }
  })

  it('rejects an object that is not a theme (e.g. a settings.json)', () => {
    const res = validateVSCodeTheme({ 'editor.fontSize': 14 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/colors|tokenColors/)
  })

  it('rejects a theme whose colors is not an object or tokenColors not an array', () => {
    expect(validateVSCodeTheme({ colors: 'nope' }).ok).toBe(false)
    expect(validateVSCodeTheme({ tokenColors: 'nope' }).ok).toBe(false)
  })
})

describe('parseThemeJson', () => {
  it('parses plain JSON', () => {
    const res = parseThemeJson(JSON.stringify(dracula))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.theme.name).toBe('Dracula')
  })

  it('tolerates JSONC comments and trailing commas (common in real theme files)', () => {
    const jsonc = `{
      // línea de comentario
      "name": "Commented", /* bloque */
      "colors": { "editor.background": "#111111", },
      "tokenColors": [],
    }`
    const res = parseThemeJson(jsonc)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.theme.name).toBe('Commented')
  })

  it('does not mangle // or /* inside string values', () => {
    const jsonc = '{ "name": "http://a/*b", "tokenColors": [] }'
    const res = parseThemeJson(jsonc)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.theme.name).toBe('http://a/*b')
  })

  it('returns an inline-displayable error for invalid JSON', () => {
    const res = parseThemeJson('not json at all {')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/isn't valid JSON/)
  })

  it('returns a not-a-theme error for valid JSON that is not a theme', () => {
    const res = parseThemeJson('{"foo": 1}')
    expect(res.ok).toBe(false)
  })
})

describe('themeDisplayName', () => {
  it('prefers the name field', () => {
    expect(themeDisplayName(dracula, 'fallback')).toBe('Dracula')
  })
  it('falls back when name is missing or empty', () => {
    expect(themeDisplayName({ tokenColors: [] }, 'my-file')).toBe('my-file')
    expect(themeDisplayName({ name: '  ', tokenColors: [] }, 'my-file')).toBe('my-file')
  })
})

describe('themeIsDark', () => {
  it('uses the explicit type field when present', () => {
    expect(themeIsDark({ type: 'dark', tokenColors: [] })).toBe(true)
    expect(themeIsDark({ type: 'light', tokenColors: [] })).toBe(false)
    expect(themeIsDark({ type: 'hc', tokenColors: [] })).toBe(true)
  })

  it('infers from editor.background luminance when type is absent', () => {
    expect(themeIsDark({ colors: { 'editor.background': '#1e1e1e' } })).toBe(true)
    expect(themeIsDark({ colors: { 'editor.background': '#ffffff' } })).toBe(false)
  })

  it('defaults to dark when nothing is known (app is dark-first)', () => {
    expect(themeIsDark({ tokenColors: [] })).toBe(true)
  })
})

describe('themeSlug', () => {
  it('produces a monaco-safe name (defineTheme rejects spaces/symbols)', () => {
    expect(themeSlug('One Dark Pro')).toBe('one-dark-pro')
    expect(themeSlug('Catppuccin Mocha (v2)')).toBe('catppuccin-mocha-v2')
    expect(themeSlug('  Nord  ')).toBe('nord')
  })
})

describe('matchThemeName', () => {
  const available = [
    { name: 'one-dark-pro', displayName: 'One Dark Pro' },
    { name: 'dracula', displayName: 'Dracula' },
  ]

  it('matches an unmapped VS Code theme name against display names (case-insensitive)', () => {
    expect(matchThemeName('one dark pro', available)).toBe('one-dark-pro')
    expect(matchThemeName('Dracula', available)).toBe('dracula')
  })

  it('matches against the slug form too', () => {
    expect(matchThemeName('one-dark-pro', available)).toBe('one-dark-pro')
  })

  it('returns undefined when nothing matches', () => {
    expect(matchThemeName('Solarized Dark', available)).toBeUndefined()
  })
})
