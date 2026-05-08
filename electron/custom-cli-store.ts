import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { ravenHome } from './raven-home'

const CONFIG_DIR = join(ravenHome(), '.raven-nest')
const FILE = join(CONFIG_DIR, 'custom-clis.json')

interface CustomCLI {
  id: string
  label: string
  cmd: string
  color: string
}

function load(): CustomCLI[] {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}

function persist(clis: CustomCLI[]): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(clis))
}

export class CustomCLIStore {
  list(): CustomCLI[] {
    return load()
  }

  save(cli: CustomCLI): void {
    const clis = load()
    const idx = clis.findIndex((c) => c.id === cli.id)
    if (idx >= 0) clis[idx] = cli
    else clis.push(cli)
    persist(clis)
  }

  delete(id: string): void {
    persist(load().filter((c) => c.id !== id))
  }
}
