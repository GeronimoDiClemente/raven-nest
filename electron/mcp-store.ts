import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { ravenHome } from './raven-home'

export class MCPStore {
  read(filePath: string): Record<string, unknown> {
    try {
      const home = ravenHome()
      const resolved = resolve(filePath)
      if (!resolved.startsWith(home)) return {}
      if (!existsSync(resolved)) return {}
      const raw = readFileSync(resolved, 'utf8')
      const parsed = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return {}
      return (parsed.mcpServers ?? {}) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  write(filePath: string, servers: Record<string, unknown>): void {
    const home = ravenHome()
    const resolved = resolve(filePath)
    if (!resolved.startsWith(home)) {
      throw new Error(`Invalid filePath: must be within home directory`)
    }
    let existing: Record<string, unknown> = {}
    try {
      if (existsSync(resolved)) {
        const raw = readFileSync(resolved, 'utf8')
        const parsed = JSON.parse(raw)
        if (typeof parsed === 'object' && parsed !== null) existing = parsed
      }
    } catch {}
    existing.mcpServers = servers
    writeFileSync(resolved, JSON.stringify(existing, null, 2))
  }
}
