import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { ravenHome } from './raven-home'

const CONFIG_DIR = join(ravenHome(), '.raven-nest')
const FILE = join(CONFIG_DIR, 'snippets.json')

export interface Snippet {
  id: string
  name: string
  content: string
}

function load(): Snippet[] {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}

function persist(snippets: Snippet[]): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(snippets))
}

export class SnippetStore {
  list(): Snippet[] {
    return load()
  }

  save(snippet: Snippet): void {
    const snippets = load()
    const idx = snippets.findIndex((s) => s.id === snippet.id)
    if (idx >= 0) snippets[idx] = snippet
    else snippets.push(snippet)
    persist(snippets)
  }

  delete(id: string): void {
    persist(load().filter((s) => s.id !== id))
  }
}
