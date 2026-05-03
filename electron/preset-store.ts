import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, statSync } from 'fs'
import type { RavenPreset } from '../src/types'

const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
  return s || 'preset'
}

function validate(p: unknown): p is RavenPreset {
  if (!p || typeof p !== 'object') return false
  const obj = p as Record<string, unknown>
  if (typeof obj.id !== 'string' || !SLUG_RE.test(obj.id)) return false
  if (typeof obj.name !== 'string' || !obj.name.trim()) return false
  if (obj.description !== undefined && typeof obj.description !== 'string') return false
  if (obj.setup !== undefined && !Array.isArray(obj.setup)) return false
  if (obj.dev !== undefined && typeof obj.dev !== 'string') return false
  if (obj.ports !== undefined && !Array.isArray(obj.ports)) return false
  if (obj.env !== undefined && (typeof obj.env !== 'object' || Array.isArray(obj.env))) return false
  if (obj.postCreate !== undefined && !Array.isArray(obj.postCreate)) return false
  if (obj.spotlightIgnore !== undefined && !Array.isArray(obj.spotlightIgnore)) return false
  return true
}

export class PresetStore {
  private dirFor(repoPath: string): string {
    return join(repoPath, '.raven', 'presets')
  }

  list(repoPath: string): RavenPreset[] {
    const dir = this.dirFor(repoPath)
    if (!existsSync(dir)) return []
    const out: RavenPreset[] = []
    const seen = new Set<string>()
    let files: string[]
    try {
      files = readdirSync(dir)
    } catch {
      return []
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const fullPath = join(dir, file)
      try {
        if (!statSync(fullPath).isFile()) continue
        const raw = readFileSync(fullPath, 'utf8')
        const parsed = JSON.parse(raw)
        if (!validate(parsed)) {
          console.warn(`[preset-store] invalid schema: ${fullPath}`)
          continue
        }
        if (seen.has(parsed.id)) {
          console.warn(`[preset-store] duplicate preset id "${parsed.id}", last wins: ${fullPath}`)
        }
        seen.add(parsed.id)
        out.push(parsed)
      } catch (err) {
        console.warn(`[preset-store] skip ${fullPath}: ${(err as Error).message}`)
      }
    }
    return out
  }

  get(repoPath: string, presetId: string): RavenPreset | null {
    return this.list(repoPath).find((p) => p.id === presetId) ?? null
  }

  save(repoPath: string, preset: RavenPreset): RavenPreset {
    const id = SLUG_RE.test(preset.id) ? preset.id : slugify(preset.id || preset.name)
    const normalized: RavenPreset = { ...preset, id }
    if (!validate(normalized)) {
      throw new Error('Invalid preset schema')
    }
    const dir = this.dirFor(repoPath)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${id}.json`)
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(normalized, null, 2))
    // atomic rename
    try {
      writeFileSync(file, JSON.stringify(normalized, null, 2))
      unlinkSync(tmp)
    } catch {
      // ignore tmp cleanup error
    }
    return normalized
  }

  delete(repoPath: string, presetId: string): void {
    if (!SLUG_RE.test(presetId)) return
    const file = join(this.dirFor(repoPath), `${presetId}.json`)
    if (existsSync(file)) {
      try { unlinkSync(file) } catch {}
    }
  }
}
