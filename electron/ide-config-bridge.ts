import { promises as fsp } from 'fs'
import { join, posix, win32 } from 'path'

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
