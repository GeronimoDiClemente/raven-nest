import { describe, it, expect } from 'vitest'
import { parseVSCodeSettings } from '../../lib/ide-config-mappings'

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
})
