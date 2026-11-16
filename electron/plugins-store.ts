import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { ravenHome } from './raven-home'

export interface InstalledPlugin {
  pluginId: string
  scope: 'personal' | 'team'
  enabled: boolean
  config: Record<string, unknown>
}

export class PluginsStore {
  private dir: string
  private file: string
  constructor(baseDir: string = join(ravenHome(), '.raven-nest')) {
    this.dir = baseDir
    this.file = join(baseDir, 'plugins.json')
  }
  private load(): InstalledPlugin[] {
    try { return JSON.parse(readFileSync(this.file, 'utf8')) } catch { return [] }
  }
  private persist(list: InstalledPlugin[]): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.file, JSON.stringify(list))
  }
  list(): InstalledPlugin[] { return this.load() }
  save(p: InstalledPlugin): void {
    const all = this.load()
    const idx = all.findIndex(x => x.pluginId === p.pluginId && x.scope === p.scope)
    if (idx >= 0) all[idx] = p; else all.push(p)
    this.persist(all)
  }
  delete(pluginId: string, scope: 'personal' | 'team' = 'personal'): void {
    this.persist(this.load().filter(x => !(x.pluginId === pluginId && x.scope === scope)))
  }
}
