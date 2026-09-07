import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { ravenHome } from './raven-home'

const CONFIG_DIR = join(ravenHome(), '.raven-nest')
const FILE = join(CONFIG_DIR, 'settings.json')

export interface Keybindings {
  voiceInput: string
  newPane: string
  globalSearch: string
  commandPalette: string
  nextPane: string
  prevPane: string
  nextTab: string
  prevTab: string
  toggleZoom: string
  fontSizeUp: string
  fontSizeDown: string
  fontSizeReset: string
}

export interface AppSettings {
  keybindings: Keybindings
  voiceLanguage: string
  hasSeenMemoryHub: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  voiceLanguage: 'es',
  hasSeenMemoryHub: false,
  keybindings: {
    voiceInput: 'F5',
    newPane: 'Meta+t',
    globalSearch: 'Meta+f',
    commandPalette: 'Meta+k',
    nextPane: 'Meta+ArrowRight',
    prevPane: 'Meta+ArrowLeft',
    nextTab: 'Ctrl+Tab',
    prevTab: 'Ctrl+Shift+Tab',
    toggleZoom: 'Meta+Shift+Z',
    fontSizeUp: 'Meta+=',
    fontSizeDown: 'Meta+-',
    fontSizeReset: 'Meta+0',
  }
}

function load(): AppSettings {
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf8'))
    return {
      voiceLanguage: data.voiceLanguage ?? DEFAULT_SETTINGS.voiceLanguage,
      hasSeenMemoryHub: data.hasSeenMemoryHub ?? DEFAULT_SETTINGS.hasSeenMemoryHub,
      keybindings: { ...DEFAULT_SETTINGS.keybindings, ...(data.keybindings ?? {}) }
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function persist(settings: AppSettings): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(settings, null, 2))
}

export class SettingsStore {
  get(): AppSettings {
    return load()
  }
  set(settings: AppSettings): void {
    persist(settings)
  }
}
