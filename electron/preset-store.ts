import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, statSync, renameSync } from 'fs'
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

const sonStrings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string')

/**
 * Variables que cambian QUÉ se ejecuta, no con qué datos: un preset que viene en un repo ajeno
 * podría usarlas para correr otra cosa detrás de un `npm install` que se ve inocente (un
 * `NODE_OPTIONS=--require ./x.js`, un `PATH` con un `npm` propio). Un preset que las trae se
 * rechaza entero.
 */
const ENV_PROHIBIDO = /^(PATH|NODE_OPTIONS|NODE_PATH|BASH_ENV|ENV|ZDOTDIR|SHELL|IFS|PS4|PROMPT_COMMAND|ELECTRON_RUN_AS_NODE|PYTHONPATH|PYTHONSTARTUP|PERL5OPT|PERL5LIB|RUBYOPT|RUBYLIB|GIT_SSH|GIT_SSH_COMMAND|GIT_EXEC_PATH|LD_.*|DYLD_.*)$/i

export function envProhibido(env: Record<string, unknown>): string[] {
  return Object.keys(env).filter((k) => ENV_PROHIBIDO.test(k))
}

function validate(p: unknown): p is RavenPreset {
  if (!p || typeof p !== 'object') return false
  const obj = p as Record<string, unknown>
  if (typeof obj.id !== 'string' || !SLUG_RE.test(obj.id)) return false
  if (typeof obj.name !== 'string' || !obj.name.trim()) return false
  if (obj.description !== undefined && typeof obj.description !== 'string') return false
  // Cada comando se le pasa a `/bin/sh -c`: algo que no sea un string no tiene nada que hacer ahí.
  if (obj.setup !== undefined && !sonStrings(obj.setup)) return false
  if (obj.dev !== undefined && typeof obj.dev !== 'string') return false
  if (obj.ports !== undefined && !Array.isArray(obj.ports)) return false
  if (obj.env !== undefined) {
    if (!obj.env || typeof obj.env !== 'object' || Array.isArray(obj.env)) return false
    const env = obj.env as Record<string, unknown>
    if (!Object.values(env).every((v) => typeof v === 'string')) return false
    if (envProhibido(env).length > 0) return false
  }
  if (obj.postCreate !== undefined && !sonStrings(obj.postCreate)) return false
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
    renameSync(tmp, file)
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
