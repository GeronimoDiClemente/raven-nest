import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'fs'
import { ravenHome } from './raven-home'

const WS_DIR = join(ravenHome(), '.raven-nest', 'workspaces')

export interface WorkspaceRecord {
  id: string
  name: string
  layout: { rows: number; cols: number }
  cells: (unknown | null)[]
  resumeLastSession: boolean
  createdAt: number
  updatedAt: number
}

function ensureDir() {
  mkdirSync(WS_DIR, { recursive: true })
}

export class WorkspaceStore {
  list(): WorkspaceRecord[] {
    ensureDir()
    try {
      return (readdirSync(WS_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          try {
            return JSON.parse(readFileSync(join(WS_DIR, f), 'utf8')) as WorkspaceRecord
          } catch { return null }
        })
        .filter(Boolean) as WorkspaceRecord[])
        .sort((a, b) => a.createdAt - b.createdAt)
    } catch { return [] }
  }

  save(ws: WorkspaceRecord): void {
    if (!ws.id || !/^[a-zA-Z0-9_-]+$/.test(ws.id)) throw new Error(`Invalid id: ${ws.id}`)
    ensureDir()
    writeFileSync(join(WS_DIR, `${ws.id}.json`), JSON.stringify(ws))
  }

  delete(id: string): void {
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`Invalid id: ${id}`)
    const path = join(WS_DIR, `${id}.json`)
    if (existsSync(path)) unlinkSync(path)
  }
}
