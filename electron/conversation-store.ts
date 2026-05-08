import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'fs'
import { ravenHome } from './raven-home'

const CONV_DIR = join(ravenHome(), '.raven-nest', 'conversations')
const INDEX_FILE = join(CONV_DIR, '_index.json')

export interface ConversationMeta {
  id: string       // filename without extension
  aiType: string
  accountName: string
  timestamp: number
  preview: string  // first 120 chars
  displayName?: string  // user-set custom name, overrides auto-generated
  iconEmoji?: string    // user-set single-char emoji
}

interface IndexEntry {
  displayName?: string
  iconEmoji?: string
}

type Index = Record<string, IndexEntry>

function ensureDir() {
  mkdirSync(CONV_DIR, { recursive: true })
}

function loadIndex(): Index {
  try {
    return JSON.parse(readFileSync(INDEX_FILE, 'utf8')) as Index
  } catch {
    return {}
  }
}

function saveIndex(idx: Index): void {
  ensureDir()
  writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2))
}

const isValidId = (id: string): boolean =>
  Boolean(id) && /^[a-zA-Z0-9_-]+$/.test(id)

export class ConversationStore {
  list(): ConversationMeta[] {
    ensureDir()
    const idx = loadIndex()
    try {
      return readdirSync(CONV_DIR)
        .filter((f) => f.endsWith('.md'))
        .map((f) => {
          const id = f.replace('.md', '')
          const parts = id.split('--')
          const timestamp = parseInt(parts[0] ?? '0', 10)
          const aiType = parts[1] ?? 'unknown'
          const accountName = (parts[2] ?? '').replace(/_/g, ' ')
          let preview = ''
          try {
            const content = readFileSync(join(CONV_DIR, f), 'utf8')
            const lines = content.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
            preview = lines[0]?.slice(0, 120) ?? ''
          } catch { /* ignore */ }
          const meta: ConversationMeta = { id, aiType, accountName, timestamp, preview }
          const extra = idx[id]
          if (extra?.displayName) meta.displayName = extra.displayName
          if (extra?.iconEmoji) meta.iconEmoji = extra.iconEmoji
          return meta
        })
        .sort((a, b) => b.timestamp - a.timestamp)
    } catch {
      return []
    }
  }

  save(aiType: string, accountName: string, content: string): string {
    ensureDir()
    const ts = Date.now()
    const safeName = accountName.replace(/[^a-zA-Z0-9]/g, '_')
    const id = `${ts}--${aiType}--${safeName}`
    const date = new Date(ts).toLocaleString()
    const header = `# ${aiType}${accountName ? ` · ${accountName}` : ''}\n_${date}_\n\n---\n\n`
    writeFileSync(join(CONV_DIR, `${id}.md`), header + content)
    return id
  }

  get(id: string): string {
    if (!isValidId(id)) throw new Error(`Invalid id: ${id}`)
    const path = join(CONV_DIR, `${id}.md`)
    if (!existsSync(path)) return ''
    return readFileSync(path, 'utf8')
  }

  rename(id: string, displayName: string): void {
    if (!isValidId(id)) throw new Error(`Invalid id: ${id}`)
    ensureDir()
    const idx = loadIndex()
    const trimmed = displayName.trim()
    if (!trimmed) {
      // Empty name removes the override (revert to auto-generated)
      if (idx[id]) {
        const { displayName: _ignored, ...rest } = idx[id]
        if (Object.keys(rest).length === 0) delete idx[id]
        else idx[id] = rest
      }
    } else {
      idx[id] = { ...(idx[id] ?? {}), displayName: trimmed.slice(0, 120) }
    }
    saveIndex(idx)
  }

  updateIcon(id: string, iconEmoji: string | null): void {
    if (!isValidId(id)) throw new Error(`Invalid id: ${id}`)
    ensureDir()
    const idx = loadIndex()
    if (!iconEmoji) {
      if (idx[id]) {
        const { iconEmoji: _ignored, ...rest } = idx[id]
        if (Object.keys(rest).length === 0) delete idx[id]
        else idx[id] = rest
      }
    } else {
      // Cap to 8 chars to allow multi-codepoint emojis (ZWJ sequences,
      // skin tones) while bounding storage.
      idx[id] = { ...(idx[id] ?? {}), iconEmoji: iconEmoji.slice(0, 8) }
    }
    saveIndex(idx)
  }

  delete(id: string): void {
    if (!isValidId(id)) throw new Error(`Invalid id: ${id}`)
    const path = join(CONV_DIR, `${id}.md`)
    if (existsSync(path)) unlinkSync(path)
    const idx = loadIndex()
    if (idx[id]) {
      delete idx[id]
      saveIndex(idx)
    }
  }
}
