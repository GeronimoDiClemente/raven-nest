import { XMLParser } from 'fast-xml-parser'

export interface EditorPreferences {
  fontSize?: number
  fontFamily?: string
  fontWeight?: string
  fontLigatures?: boolean
  lineHeight?: number
  letterSpacing?: number
  tabSize?: number
  insertSpaces?: boolean
  detectIndentation?: boolean
  wordWrap?: 'on' | 'off'
  rulers?: number[]
  renderWhitespace?: 'none' | 'boundary' | 'selection' | 'trailing' | 'all'
  renderLineHighlight?: 'none' | 'gutter' | 'line' | 'all'
  lineNumbers?: 'on' | 'off' | 'relative' | 'interval'
  minimap?: { enabled?: boolean; side?: 'left' | 'right'; scale?: number }
  scrollBeyondLastLine?: boolean
  smoothScrolling?: boolean
  cursorStyle?: 'line' | 'block' | 'underline'
  cursorBlinking?: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid'
  cursorSmoothCaretAnimation?: 'off' | 'explicit' | 'on'
  mouseWheelZoom?: boolean
  matchBrackets?: 'always' | 'near' | 'never'
  bracketPairColorization?: { enabled?: boolean }
  guides?: { indentation?: boolean; bracketPairs?: boolean }
  autoClosingBrackets?: 'always' | 'languageDefined' | 'beforeWhitespace' | 'never'
  quickSuggestions?: boolean
  wordBasedSuggestions?: boolean
  stickyScroll?: { enabled?: boolean }
  colorDecorators?: boolean
}

export type EditorTheme = 'vs' | 'vs-dark'

export type ParseResult =
  | { ok: true; options: EditorPreferences; theme?: EditorTheme; unmappedTheme?: string }
  | { ok: false; error: string }

type NestedGroupKey = 'minimap' | 'bracketPairColorization' | 'guides' | 'stickyScroll'
const NESTED_GROUP_KEYS: readonly NestedGroupKey[] = ['minimap', 'bracketPairColorization', 'guides', 'stickyScroll']

function setNested(options: EditorPreferences, group: NestedGroupKey, field: string, value: unknown): void {
  const target = (options[group] ??= {} as never)
  ;(target as Record<string, unknown>)[field] = value
}

interface VSCodeMapping {
  vsCodeKey: string
  apply: (options: EditorPreferences, value: unknown) => void
}

const VSCODE_MAPPINGS: VSCodeMapping[] = [
  { vsCodeKey: 'editor.fontSize', apply: (o, v) => { o.fontSize = v as number } },
  { vsCodeKey: 'editor.fontFamily', apply: (o, v) => { o.fontFamily = v as string } },
  { vsCodeKey: 'editor.fontWeight', apply: (o, v) => { o.fontWeight = String(v) } },
  { vsCodeKey: 'editor.fontLigatures', apply: (o, v) => { o.fontLigatures = Boolean(v) } },
  { vsCodeKey: 'editor.lineHeight', apply: (o, v) => { o.lineHeight = v as number } },
  { vsCodeKey: 'editor.letterSpacing', apply: (o, v) => { o.letterSpacing = v as number } },
  { vsCodeKey: 'editor.tabSize', apply: (o, v) => { o.tabSize = v as number } },
  { vsCodeKey: 'editor.insertSpaces', apply: (o, v) => { o.insertSpaces = Boolean(v) } },
  { vsCodeKey: 'editor.detectIndentation', apply: (o, v) => { o.detectIndentation = Boolean(v) } },
  { vsCodeKey: 'editor.wordWrap', apply: (o, v) => { o.wordWrap = v === 'on' ? 'on' : 'off' } },
  { vsCodeKey: 'editor.rulers', apply: (o, v) => { o.rulers = v as number[] } },
  { vsCodeKey: 'editor.renderWhitespace', apply: (o, v) => { o.renderWhitespace = v as EditorPreferences['renderWhitespace'] } },
  { vsCodeKey: 'editor.renderLineHighlight', apply: (o, v) => { o.renderLineHighlight = v as EditorPreferences['renderLineHighlight'] } },
  { vsCodeKey: 'editor.lineNumbers', apply: (o, v) => { o.lineNumbers = v as EditorPreferences['lineNumbers'] } },
  { vsCodeKey: 'editor.minimap.enabled', apply: (o, v) => setNested(o, 'minimap', 'enabled', Boolean(v)) },
  { vsCodeKey: 'editor.minimap.side', apply: (o, v) => setNested(o, 'minimap', 'side', v) },
  { vsCodeKey: 'editor.minimap.scale', apply: (o, v) => setNested(o, 'minimap', 'scale', v) },
  { vsCodeKey: 'editor.scrollBeyondLastLine', apply: (o, v) => { o.scrollBeyondLastLine = Boolean(v) } },
  { vsCodeKey: 'editor.smoothScrolling', apply: (o, v) => { o.smoothScrolling = Boolean(v) } },
  { vsCodeKey: 'editor.cursorStyle', apply: (o, v) => { o.cursorStyle = v as EditorPreferences['cursorStyle'] } },
  { vsCodeKey: 'editor.cursorBlinking', apply: (o, v) => { o.cursorBlinking = v as EditorPreferences['cursorBlinking'] } },
  { vsCodeKey: 'editor.cursorSmoothCaretAnimation', apply: (o, v) => { o.cursorSmoothCaretAnimation = v as EditorPreferences['cursorSmoothCaretAnimation'] } },
  { vsCodeKey: 'editor.mouseWheelZoom', apply: (o, v) => { o.mouseWheelZoom = Boolean(v) } },
  { vsCodeKey: 'editor.matchBrackets', apply: (o, v) => { o.matchBrackets = v as EditorPreferences['matchBrackets'] } },
  { vsCodeKey: 'editor.bracketPairColorization.enabled', apply: (o, v) => setNested(o, 'bracketPairColorization', 'enabled', Boolean(v)) },
  { vsCodeKey: 'editor.guides.indentation', apply: (o, v) => setNested(o, 'guides', 'indentation', Boolean(v)) },
  { vsCodeKey: 'editor.guides.bracketPairs', apply: (o, v) => setNested(o, 'guides', 'bracketPairs', Boolean(v)) },
  { vsCodeKey: 'editor.autoClosingBrackets', apply: (o, v) => { o.autoClosingBrackets = v as EditorPreferences['autoClosingBrackets'] } },
  { vsCodeKey: 'editor.quickSuggestions', apply: (o, v) => { o.quickSuggestions = Boolean(v) } },
  { vsCodeKey: 'editor.wordBasedSuggestions', apply: (o, v) => { o.wordBasedSuggestions = typeof v === 'string' ? v !== 'off' : Boolean(v) } },
  { vsCodeKey: 'editor.stickyScroll.enabled', apply: (o, v) => setNested(o, 'stickyScroll', 'enabled', Boolean(v)) },
  { vsCodeKey: 'editor.colorDecorators', apply: (o, v) => { o.colorDecorators = Boolean(v) } },
]

function themeFromName(name: string): EditorTheme | undefined {
  const lower = name.toLowerCase()
  if (lower.includes('dark') || lower.includes('darcula') || lower.includes('black')) return 'vs-dark'
  if (lower.includes('light')) return 'vs'
  return undefined
}

export function parseVSCodeSettings(json: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    return { ok: false, error: `No pudimos leer tu configuración: JSON inválido (${err instanceof Error ? err.message : String(err)})` }
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'No pudimos leer tu configuración: el archivo no es un objeto JSON válido.' }
  }

  const settings = raw as Record<string, unknown>

  const options: EditorPreferences = {}
  for (const mapping of VSCODE_MAPPINGS) {
    if (Object.prototype.hasOwnProperty.call(settings, mapping.vsCodeKey)) {
      mapping.apply(options, settings[mapping.vsCodeKey])
    }
  }

  const themeName = settings['workbench.colorTheme']
  if (typeof themeName === 'string') {
    const theme = themeFromName(themeName)
    return theme ? { ok: true, options, theme } : { ok: true, options, unmappedTheme: themeName }
  }

  return { ok: true, options }
}

export function mergeEditorPreferences(base: EditorPreferences, patch: EditorPreferences): EditorPreferences {
  const merged: EditorPreferences = { ...base, ...patch }
  for (const key of NESTED_GROUP_KEYS) {
    if (base[key] || patch[key]) {
      merged[key] = { ...(base[key] as object | undefined), ...(patch[key] as object | undefined) } as never
    }
  }
  return merged
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' })

function findOptions(node: unknown): Array<{ name: string; value: string }> {
  // IntelliJ XML represents each setting as <option name="X" value="Y" />.
  // fast-xml-parser (attributeNamePrefix: '') turns that into
  // { name: 'X', value: 'Y' } objects, either a single object or an array
  // when there's more than one <option> under the same parent.
  const found: Array<{ name: string; value: string }> = []
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(visit); return }
    if (n && typeof n === 'object') {
      const obj = n as Record<string, unknown>
      if (typeof obj.name === 'string' && typeof obj.value === 'string') {
        found.push({ name: obj.name, value: obj.value })
      }
      for (const v of Object.values(obj)) visit(v)
    }
  }
  visit(node)
  return found
}

function optionValue(options: Array<{ name: string; value: string }>, name: string): string | undefined {
  return options.find((o) => o.name === name)?.value
}

export function parseIntelliJConfig(editorXml: string, codeStyleXml: string | null): ParseResult {
  let editorOptions: Array<{ name: string; value: string }>
  try {
    editorOptions = findOptions(xmlParser.parse(editorXml))
  } catch (err) {
    return { ok: false, error: `No pudimos leer tu configuración: XML inválido (${err instanceof Error ? err.message : String(err)})` }
  }

  const options: EditorPreferences = {}

  const fontSize = optionValue(editorOptions, 'FONT_SIZE')
  if (fontSize !== undefined) options.fontSize = Number(fontSize)
  const fontFamily = optionValue(editorOptions, 'FONT_FAMILY')
  if (fontFamily !== undefined) options.fontFamily = fontFamily
  const softWraps = optionValue(editorOptions, 'USE_SOFT_WRAPS')
  if (softWraps !== undefined) options.wordWrap = softWraps === 'true' ? 'on' : 'off'
  const lineNumbers = optionValue(editorOptions, 'LINE_NUMBERS_SHOWN')
  if (lineNumbers !== undefined) options.lineNumbers = lineNumbers === 'true' ? 'on' : 'off'

  if (codeStyleXml) {
    let codeStyleOptions: Array<{ name: string; value: string }>
    try {
      codeStyleOptions = findOptions(xmlParser.parse(codeStyleXml))
    } catch (err) {
      return { ok: false, error: `No pudimos leer tu configuración: XML de code style inválido (${err instanceof Error ? err.message : String(err)})` }
    }
    const tabSize = optionValue(codeStyleOptions, 'TAB_SIZE')
    if (tabSize !== undefined) options.tabSize = Number(tabSize)
    const useTabChar = optionValue(codeStyleOptions, 'USE_TAB_CHARACTER')
    if (useTabChar !== undefined) options.insertSpaces = useTabChar !== 'true'
  }

  return { ok: true, options }
}
