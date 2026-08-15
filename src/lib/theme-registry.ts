// Validación pura de temas de VS Code (color themes) — sin IO, sin Monaco.
// Consumido por el theme-bridge del main process y por la UI de Settings.

export interface VSCodeThemeJson {
  name?: string
  type?: string
  colors?: Record<string, string>
  tokenColors?: unknown[]
  // el resto del JSON del tema pasa tal cual (semanticTokenColors, include…)
  [key: string]: unknown
}

export type ThemeValidation =
  | { ok: true; theme: VSCodeThemeJson }
  | { ok: false; error: string }

const NOT_A_THEME = "This file doesn't look like a VS Code color theme (expected a JSON object with colors and/or tokenColors)."

export function validateVSCodeTheme(raw: unknown): ThemeValidation {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: NOT_A_THEME }
  }
  const obj = raw as Record<string, unknown>
  const hasColors = obj.colors !== undefined
  const hasTokenColors = obj.tokenColors !== undefined
  if (!hasColors && !hasTokenColors) {
    return { ok: false, error: NOT_A_THEME }
  }
  if (hasColors && (obj.colors === null || typeof obj.colors !== 'object' || Array.isArray(obj.colors))) {
    return { ok: false, error: "This theme's colors field isn't an object — the file isn't a valid VS Code color theme." }
  }
  if (hasTokenColors && !Array.isArray(obj.tokenColors)) {
    return { ok: false, error: "This theme's tokenColors field isn't an array — the file isn't a valid VS Code color theme." }
  }
  return { ok: true, theme: obj as VSCodeThemeJson }
}

// Los .json de temas reales suelen ser JSONC (comentarios + trailing commas),
// igual que settings.json. JSON.parse pelado los rechazaría, así que se
// limpian primero con un walker consciente de strings — un regex ingenuo
// rompería valores como "http://...".
function stripJsonc(text: string): string {
  let out = ''
  let inString = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const n = text[i + 1]
    if (inLine) {
      if (c === '\n') { inLine = false; out += c }
      continue
    }
    if (inBlock) {
      if (c === '*' && n === '/') { inBlock = false; i++ }
      continue
    }
    if (inString) {
      out += c
      if (c === '\\') { out += n ?? ''; i++ }
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') { inString = true; out += c; continue }
    if (c === '/' && n === '/') { inLine = true; continue }
    if (c === '/' && n === '*') { inBlock = true; i++; continue }
    out += c
  }
  // Trailing commas: borrar toda coma cuyo próximo carácter no-whitespace
  // cierre un objeto/array. Fuera de strings (ya garantizado arriba no, así
  // que se repite el walker mínimo para no tocar strings).
  let cleaned = ''
  inString = false
  for (let i = 0; i < out.length; i++) {
    const c = out[i]
    if (inString) {
      cleaned += c
      if (c === '\\') { cleaned += out[i + 1] ?? ''; i++ }
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') { inString = true; cleaned += c; continue }
    if (c === ',') {
      let j = i + 1
      while (j < out.length && /\s/.test(out[j])) j++
      if (out[j] === '}' || out[j] === ']') continue
    }
    cleaned += c
  }
  return cleaned
}

export function parseThemeJson(text: string): ThemeValidation {
  let raw: unknown
  try {
    raw = JSON.parse(stripJsonc(text))
  } catch (err) {
    return { ok: false, error: `This file isn't valid JSON (${err instanceof Error ? err.message : String(err)}).` }
  }
  return validateVSCodeTheme(raw)
}

export function themeDisplayName(theme: VSCodeThemeJson, fallback: string): string {
  const name = typeof theme.name === 'string' ? theme.name.trim() : ''
  return name || fallback
}

export function themeIsDark(theme: VSCodeThemeJson): boolean {
  if (theme.type === 'dark' || theme.type === 'hc' || theme.type === 'hc-black') return true
  if (theme.type === 'light' || theme.type === 'hc-light') return false
  const bg = theme.colors?.['editor.background']
  if (typeof bg === 'string') {
    const hex = bg.replace('#', '')
    if (/^[0-9a-f]{6}/i.test(hex)) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      // luminancia relativa aproximada; alcanza para agrupar dark/light
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128
    }
  }
  // sin datos: la app es dark-first
  return true
}

// Monaco's defineTheme (que @shikijs/monaco llama con theme.name) rechaza
// nombres con espacios o símbolos — los temas se registran siempre por slug.
export function themeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Cierra el loop que dejó abierto el import de config: si el
// workbench.colorTheme importado (unmappedTheme) coincide con un tema
// bundled o instalado, se aplica directo en vez de descartarse.
export function matchThemeName(
  unmapped: string,
  available: Array<{ name: string; displayName: string }>,
): string | undefined {
  const slug = themeSlug(unmapped)
  const lower = unmapped.trim().toLowerCase()
  return available.find(
    (t) => t.name === slug || t.displayName.trim().toLowerCase() === lower,
  )?.name
}
