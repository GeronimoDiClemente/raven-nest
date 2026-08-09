import { promises as fsp } from 'fs'
import { join, posix, win32 } from 'path'
import { parseVSCodeSettings, parseIntelliJConfig, EditorPreferences, EditorTheme } from '../src/lib/ide-config-mappings'

function joinPath(homeDir: string, platform: NodeJS.Platform, ...parts: string[]): string {
  if (platform === 'win32') {
    return win32.join(homeDir, ...parts)
  }
  return posix.join(homeDir, ...parts)
}

export function resolveVSCodeSettingsPath(homeDir: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return joinPath(homeDir, platform, 'AppData', 'Roaming', 'Code', 'User', 'settings.json')
  if (platform === 'darwin') return joinPath(homeDir, platform, 'Library', 'Application Support', 'Code', 'User', 'settings.json')
  return joinPath(homeDir, platform, '.config', 'Code', 'User', 'settings.json')
}

export function resolveJetBrainsRoot(homeDir: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return joinPath(homeDir, platform, 'AppData', 'Roaming', 'JetBrains')
  if (platform === 'darwin') return joinPath(homeDir, platform, 'Library', 'Application Support', 'JetBrains')
  return joinPath(homeDir, platform, '.config', 'JetBrains')
}

export async function findIntelliJConfigDir(jetbrainsRoot: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await fsp.readdir(jetbrainsRoot)
  } catch {
    return null
  }
  const candidates = entries.filter((name) => name.startsWith('IntelliJIdea'))
  if (candidates.length === 0) return null

  const withMtime = await Promise.all(
    candidates.map(async (name) => {
      const full = join(jetbrainsRoot, name)
      const stat = await fsp.stat(full)
      return { full, mtimeMs: stat.mtimeMs }
    }),
  )
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return withMtime[0].full
}

export type ImportResult =
  | { ok: true; options: EditorPreferences; theme?: EditorTheme; unmappedTheme?: string }
  | { ok: false; error: string }

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await fsp.readFile(path, 'utf8')
  } catch {
    return null
  }
}

export async function importVSCodeConfig(homeDir: string, platform: NodeJS.Platform): Promise<ImportResult> {
  const path = resolveVSCodeSettingsPath(homeDir, platform)
  const content = await readIfExists(path)
  if (content === null) {
    return { ok: false, error: "We couldn't find your VS Code configuration on this machine." }
  }
  return parseVSCodeSettings(content)
}

export async function importIntelliJConfig(homeDir: string, platform: NodeJS.Platform): Promise<ImportResult> {
  const jetbrainsRoot = resolveJetBrainsRoot(homeDir, platform)
  const versionDir = await findIntelliJConfigDir(jetbrainsRoot)
  if (!versionDir) {
    return { ok: false, error: "We couldn't find your IntelliJ configuration on this machine." }
  }
  const editorXml = await readIfExists(join(versionDir, 'options', 'editor.xml'))
  if (editorXml === null) {
    return { ok: false, error: "We couldn't find your IntelliJ configuration on this machine." }
  }
  const codeStyleXml = await readIfExists(join(versionDir, 'codestyles', 'Project.xml'))
  return parseIntelliJConfig(editorXml, codeStyleXml)
}
