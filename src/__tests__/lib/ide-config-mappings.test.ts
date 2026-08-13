import { describe, it, expect } from 'vitest'
import { parseVSCodeSettings, mergeEditorPreferences, parseIntelliJConfig } from '../../lib/ide-config-mappings'

describe('parseVSCodeSettings', () => {
  it('maps flat editor.* keys to Monaco options', () => {
    const json = JSON.stringify({
      'editor.fontSize': 16,
      'editor.fontFamily': 'Fira Code',
      'editor.tabSize': 2,
      'editor.insertSpaces': false,
      'editor.wordWrap': 'on',
      'editor.lineNumbers': 'relative',
    })
    const result = parseVSCodeSettings(json)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.options).toMatchObject({
      fontSize: 16,
      fontFamily: 'Fira Code',
      tabSize: 2,
      insertSpaces: false,
      wordWrap: 'on',
      lineNumbers: 'relative',
    })
  })

  it('maps nested dot-groups (minimap, guides) into nested Monaco option objects', () => {
    const json = JSON.stringify({
      'editor.minimap.enabled': false,
      'editor.minimap.scale': 2,
      'editor.guides.indentation': false,
      'editor.bracketPairColorization.enabled': true,
      'editor.stickyScroll.enabled': true,
    })
    const result = parseVSCodeSettings(json)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.options.minimap).toEqual({ enabled: false, scale: 2 })
    expect(result.options.guides).toEqual({ indentation: false })
    expect(result.options.bracketPairColorization).toEqual({ enabled: true })
    expect(result.options.stickyScroll).toEqual({ enabled: true })
  })

  it('maps workbench.colorTheme to a Monaco theme via a dark/light name heuristic', () => {
    const dark = parseVSCodeSettings(JSON.stringify({ 'workbench.colorTheme': 'Dark+ (default dark)' }))
    expect(dark.ok && dark.theme).toBe('vs-dark')

    const light = parseVSCodeSettings(JSON.stringify({ 'workbench.colorTheme': 'Light+ (default light)' }))
    expect(light.ok && light.theme).toBe('vs')

    const unknown = parseVSCodeSettings(JSON.stringify({ 'workbench.colorTheme': 'Monokai Pro Custom' }))
    expect(unknown.ok && unknown.theme).toBeUndefined()
    expect(unknown.ok && unknown.unmappedTheme).toBe('Monokai Pro Custom')
  })

  it('returns an error result for malformed JSON, never throws', () => {
    const result = parseVSCodeSettings('{ not valid json')
    expect(result.ok).toBe(false)
    expect(result.ok || result.error).toContain('JSON')
  })

  it('ignores unknown keys and missing keys without error', () => {
    const result = parseVSCodeSettings(JSON.stringify({ 'some.random.key': 'x' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.options).toEqual({})
  })

  it('handles wordBasedSuggestions as boolean false correctly (not inverted) — maps to the "off" string Monaco expects', () => {
    const result = parseVSCodeSettings(JSON.stringify({ 'editor.wordBasedSuggestions': false }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.options.wordBasedSuggestions).toBe('off')
  })

  it('handles wordBasedSuggestions as boolean true correctly — maps to VS Code\'s own "currentDocument" default', () => {
    const result = parseVSCodeSettings(JSON.stringify({ 'editor.wordBasedSuggestions': true }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.options.wordBasedSuggestions).toBe('currentDocument')
  })

  it('handles wordBasedSuggestions as string "off" correctly', () => {
    const result = parseVSCodeSettings(JSON.stringify({ 'editor.wordBasedSuggestions': 'off' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.options.wordBasedSuggestions).toBe('off')
  })

  it('passes through wordBasedSuggestions string enum values unchanged (Monaco 0.55 union, not a boolean)', () => {
    for (const value of ['currentDocument', 'matchingDocuments', 'allDocuments'] as const) {
      const result = parseVSCodeSettings(JSON.stringify({ 'editor.wordBasedSuggestions': value }))
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.options.wordBasedSuggestions).toBe(value)
    }
  })

  it('returns error result for null JSON, never throws', () => {
    const result = parseVSCodeSettings('null')
    expect(result.ok).toBe(false)
    expect(result.ok || result.error).toContain('JSON object')
  })

  it('returns error result for JSON array, never throws', () => {
    const result = parseVSCodeSettings('[]')
    expect(result.ok).toBe(false)
    expect(result.ok || result.error).toContain('JSON object')
  })

  it('returns error result for JSON primitive, never throws', () => {
    const result = parseVSCodeSettings('"just a string"')
    expect(result.ok).toBe(false)
    expect(result.ok || result.error).toContain('JSON object')
  })
})

describe('mergeEditorPreferences', () => {
  it('merges scalar fields from base and patch', () => {
    const base = { fontSize: 14, tabSize: 4 }
    const patch = { tabSize: 2, insertSpaces: true }
    const result = mergeEditorPreferences(base, patch)
    expect(result).toEqual({ fontSize: 14, tabSize: 2, insertSpaces: true })
  })

  it('merges nested minimap objects field-by-field without clobbering', () => {
    const base = { minimap: { enabled: true, scale: 1 } }
    const patch = { minimap: { scale: 2 } }
    const result = mergeEditorPreferences(base, patch)
    expect(result.minimap).toEqual({ enabled: true, scale: 2 })
  })

  it('merges nested guides objects field-by-field without clobbering', () => {
    const base = { guides: { indentation: true } }
    const patch = { guides: { bracketPairs: true } }
    const result = mergeEditorPreferences(base, patch)
    expect(result.guides).toEqual({ indentation: true, bracketPairs: true })
  })

  it('merges nested bracketPairColorization objects field-by-field without clobbering', () => {
    const base = { bracketPairColorization: { enabled: true } }
    const patch = { bracketPairColorization: { enabled: false } }
    const result = mergeEditorPreferences(base, patch)
    expect(result.bracketPairColorization).toEqual({ enabled: false })
  })

  it('merges nested stickyScroll objects field-by-field without clobbering', () => {
    const base = { stickyScroll: { enabled: true } }
    const patch = { stickyScroll: { enabled: false } }
    const result = mergeEditorPreferences(base, patch)
    expect(result.stickyScroll).toEqual({ enabled: false })
  })

  it('handles undefined nested objects in base', () => {
    const base: any = {}
    const patch = { minimap: { scale: 2 } }
    const result = mergeEditorPreferences(base, patch)
    expect(result.minimap).toEqual({ scale: 2 })
  })

  it('handles undefined nested objects in patch', () => {
    const base = { minimap: { enabled: true } }
    const patch: any = {}
    const result = mergeEditorPreferences(base, patch)
    expect(result.minimap).toEqual({ enabled: true })
  })
})

describe('parseIntelliJConfig', () => {
  const EDITOR_XML = `<application>
    <component name="EditorSettings">
      <option name="FONT_SIZE" value="15" />
      <option name="FONT_FAMILY" value="JetBrains Mono" />
      <option name="USE_SOFT_WRAPS" value="true" />
      <option name="LINE_NUMBERS_SHOWN" value="false" />
    </component>
  </application>`

  const CODE_STYLE_XML = `<code_scheme name="Project">
    <option name="TAB_SIZE" value="4" />
    <option name="USE_TAB_CHARACTER" value="false" />
  </code_scheme>`

  it('maps editor.xml + code style scheme fields to Monaco options', () => {
    const result = parseIntelliJConfig(EDITOR_XML, CODE_STYLE_XML)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.options).toMatchObject({
      fontSize: 15,
      fontFamily: 'JetBrains Mono',
      wordWrap: 'on',
      lineNumbers: 'off',
      tabSize: 4,
      insertSpaces: true,
    })
  })

  it('works with editor.xml alone when no code style scheme is available', () => {
    const result = parseIntelliJConfig(EDITOR_XML, null)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.options.fontSize).toBe(15)
    expect(result.options.tabSize).toBeUndefined()
  })

  it('returns an error result for malformed XML, never throws', () => {
    const result = parseIntelliJConfig('<app><opt name="test value="bad" /></app>', null)
    expect(result.ok).toBe(false)
  })
})
