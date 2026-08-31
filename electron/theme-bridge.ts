// Bridge de temas del main process: store de temas instalados en disco
// (RAVEN_HOME/.raven-nest/themes/*.json), scan/import desde la instalación
// local de VS Code y búsqueda/instalación desde Open VSX. Todo el networking
// vive acá (nunca en el renderer) y de un .vsix se extraen SOLO los JSONs
// referenciados por contributes.themes — jamás se ejecuta ni persiste JS de
// la extensión.
import { promises as fsp } from 'fs'
import { join, basename, posix } from 'path'
import AdmZip from 'adm-zip'
import {
  parseThemeJson,
  validateVSCodeTheme,
  themeDisplayName,
  themeIsDark,
  themeSlug,
  type VSCodeThemeJson,
} from '../src/lib/theme-registry'

export interface InstalledTheme {
  name: string        // slug, estable, es lo que se persiste en editorTheme
  displayName: string
  isDark: boolean
  theme: VSCodeThemeJson
}

export type ThemeOpResult = { ok: true; name: string } | { ok: false; error: string }

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

export async function listInstalledThemes(themesDir: string): Promise<InstalledTheme[]> {
  let entries: string[]
  try {
    entries = await fsp.readdir(themesDir)
  } catch {
    return []
  }
  const themes: InstalledTheme[] = []
  for (const file of entries.filter((f) => f.endsWith('.json')).sort()) {
    try {
      const content = await fsp.readFile(join(themesDir, file), 'utf8')
      const parsed = parseThemeJson(content)
      if (!parsed.ok) {
        // Tema corrupto: se saltea y se loguea, nunca rompe el listado
        console.warn(`[theme-bridge] skipping corrupt theme ${file}: ${parsed.error}`)
        continue
      }
      const name = basename(file, '.json')
      themes.push({
        name,
        displayName: themeDisplayName(parsed.theme, name),
        isDark: themeIsDark(parsed.theme),
        theme: parsed.theme,
      })
    } catch (err) {
      console.warn(`[theme-bridge] skipping unreadable theme ${file}:`, err)
    }
  }
  return themes
}

export async function saveInstalledTheme(
  themesDir: string,
  displayName: string,
  theme: VSCodeThemeJson,
): Promise<ThemeOpResult> {
  const validated = validateVSCodeTheme(theme)
  if (!validated.ok) return validated
  const name = themeSlug(themeDisplayName(validated.theme, displayName) || displayName)
  if (!SLUG_RE.test(name)) {
    return { ok: false, error: "This theme doesn't have a usable name." }
  }
  try {
    await fsp.mkdir(themesDir, { recursive: true })
    // Se persiste con el displayName como name para que el listado lo muestre
    // bien; el slug queda como identidad (nombre de archivo).
    const toStore = { ...validated.theme, name: themeDisplayName(validated.theme, displayName) }
    await fsp.writeFile(join(themesDir, `${name}.json`), JSON.stringify(toStore, null, 2), 'utf8')
    return { ok: true, name }
  } catch (err) {
    return { ok: false, error: `Couldn't save the theme: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export async function deleteInstalledTheme(
  themesDir: string,
  name: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // La identidad es siempre un slug — cualquier otra cosa (separadores,
  // "..", etc.) es un intento de escaparse del dir de temas.
  if (!SLUG_RE.test(name)) {
    return { ok: false, error: 'Invalid theme name.' }
  }
  try {
    await fsp.unlink(join(themesDir, `${name}.json`))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `Couldn't delete the theme: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export interface ScannedTheme {
  label: string
  path: string  // absoluto, listo para importVSCodeTheme
}

export async function scanVSCodeThemes(
  homeDir: string,
): Promise<{ ok: true; themes: ScannedTheme[] } | { ok: false; error: string }> {
  const extensionsDir = join(homeDir, '.vscode', 'extensions')
  let extDirs: string[]
  try {
    extDirs = await fsp.readdir(extensionsDir)
  } catch {
    return { ok: false, error: "We couldn't find a VS Code extensions folder on this machine." }
  }
  const themes: ScannedTheme[] = []
  for (const dir of extDirs) {
    const extDir = join(extensionsDir, dir)
    let pkg: unknown
    try {
      pkg = JSON.parse(await fsp.readFile(join(extDir, 'package.json'), 'utf8'))
    } catch {
      continue  // package.json roto o inexistente: no es una extensión usable
    }
    const contributed = (pkg as { contributes?: { themes?: unknown } })?.contributes?.themes
    if (!Array.isArray(contributed)) continue
    for (const entry of contributed) {
      const { label, path } = (entry ?? {}) as { label?: unknown; path?: unknown }
      if (typeof path !== 'string' || !path.trim()) continue
      const relPath = path.replace(/^\.\//, '')
      themes.push({
        label: typeof label === 'string' && label.trim() ? label : basename(relPath, '.json'),
        path: join(extDir, ...relPath.split('/')),
      })
    }
  }
  return { ok: true, themes }
}

export async function importVSCodeTheme(themesDir: string, themePath: string): Promise<ThemeOpResult> {
  let content: string
  try {
    content = await fsp.readFile(themePath, 'utf8')
  } catch {
    return { ok: false, error: "We couldn't read that theme file." }
  }
  const parsed = parseThemeJson(content)
  if (!parsed.ok) return parsed
  return saveInstalledTheme(themesDir, basename(themePath, '.json'), parsed.theme)
}

// Subconjunto de fetch que usa el bridge — inyectable para testear sin red.
export type FetchLike = (url: string) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
  arrayBuffer: () => Promise<ArrayBuffer>
}>

const OPEN_VSX_API = 'https://open-vsx.org/api'

export interface OpenVSXResult {
  namespace: string
  name: string
  displayName: string
  description: string
}

export async function searchOpenVSX(
  query: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: true; results: OpenVSXResult[] } | { ok: false; error: string }> {
  try {
    const url = `${OPEN_VSX_API}/-/search?query=${encodeURIComponent(query)}&category=Themes&size=20&sortBy=relevance`
    const res = await fetchImpl(url)
    if (!res.ok) {
      return { ok: false, error: `Open VSX search failed (HTTP ${res.status}). Try again.` }
    }
    const body = (await res.json()) as { extensions?: unknown }
    const extensions = Array.isArray(body.extensions) ? body.extensions : []
    const results: OpenVSXResult[] = extensions.map((e) => {
      const ext = (e ?? {}) as Record<string, unknown>
      return {
        namespace: String(ext.namespace ?? ''),
        name: String(ext.name ?? ''),
        displayName: String(ext.displayName ?? ext.name ?? ''),
        description: String(ext.description ?? ''),
      }
    }).filter((r) => r.namespace && r.name)
    return { ok: true, results }
  } catch (err) {
    return { ok: false, error: `Couldn't reach Open VSX (${err instanceof Error ? err.message : String(err)}). Check your connection and try again.` }
  }
}

export async function installOpenVSX(
  themesDir: string,
  namespace: string,
  name: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: true; installed: string[] } | { ok: false; error: string }> {
  try {
    const metaRes = await fetchImpl(`${OPEN_VSX_API}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`)
    if (!metaRes.ok) {
      return { ok: false, error: `Open VSX lookup failed (HTTP ${metaRes.status}). Try again.` }
    }
    const meta = (await metaRes.json()) as { files?: { download?: unknown } }
    const downloadUrl = meta?.files?.download
    if (typeof downloadUrl !== 'string') {
      return { ok: false, error: "This extension doesn't offer a downloadable package." }
    }
    const vsixRes = await fetchImpl(downloadUrl)
    if (!vsixRes.ok) {
      return { ok: false, error: `Download failed (HTTP ${vsixRes.status}). Try again.` }
    }
    const zip = new AdmZip(Buffer.from(await vsixRes.arrayBuffer()))

    const pkgEntry = zip.getEntry('extension/package.json')
    if (!pkgEntry) {
      return { ok: false, error: "The downloaded package isn't a valid VS Code extension." }
    }
    const pkg = JSON.parse(pkgEntry.getData().toString('utf8')) as { contributes?: { themes?: unknown } }
    const contributed = pkg?.contributes?.themes
    if (!Array.isArray(contributed) || contributed.length === 0) {
      return { ok: false, error: "This extension doesn't contain any color themes." }
    }

    const installed: string[] = []
    for (const entry of contributed) {
      const { label, path } = (entry ?? {}) as { label?: unknown; path?: unknown }
      if (typeof path !== 'string') continue
      // Se lee únicamente el JSON del tema referenciado por el manifest.
      // posix.normalize + guard de "..": un manifest malicioso no puede
      // apuntar fuera de extension/ ni colar otros archivos.
      const relPath = posix.normalize(path.replace(/\\/g, '/').replace(/^\.\//, ''))
      if (relPath.startsWith('..') || !relPath.endsWith('.json')) continue
      const themeEntry = zip.getEntry(`extension/${relPath}`)
      if (!themeEntry) continue
      const parsed = parseThemeJson(themeEntry.getData().toString('utf8'))
      if (!parsed.ok) continue
      const fallbackName = typeof label === 'string' && label.trim() ? label : posix.basename(relPath, '.json')
      const saved = await saveInstalledTheme(themesDir, fallbackName, { ...parsed.theme, name: themeDisplayName(parsed.theme, fallbackName) })
      if (saved.ok) installed.push(saved.name)
    }
    if (installed.length === 0) {
      return { ok: false, error: "We couldn't extract any valid color themes from this extension." }
    }
    return { ok: true, installed }
  } catch (err) {
    return { ok: false, error: `Install failed (${err instanceof Error ? err.message : String(err)}). Try again.` }
  }
}
