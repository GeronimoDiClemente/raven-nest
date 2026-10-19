// src/tutorial/tours/memory-settings.ts
import type { TourDef } from '../types'

// Task 7 (2026-10-19): copia solo en inglés por ahora — `es` repite el mismo
// texto en vez de traducirlo, igual que el resto de la UI de Memories.
const en = (en: string) => ({ en, es: en })

export const memorySettingsTour: TourDef = {
  id: 'memory-settings',
  steps: [
    {
      id: 'sync',
      anchor: '[data-tour-id="memory-settings-sync"]',
      placement: 'right',
      title: en('Sync: the same memory everywhere'),
      body: en('Turn on cloud sync and what an agent learns here is there when you open Nest on another machine. A server or SSH box with no browser connects with a code.'),
    },
    {
      id: 'encryption',
      anchor: '[data-tour-id="memory-settings-encryption"]',
      placement: 'right',
      title: en("Encryption: the server can't read it"),
      body: en('Once sync is on, turn this on too. Your memory is locked here before it travels and only your machines hold the key. Save the recovery code it gives you.'),
    },
    {
      id: 'project',
      anchor: '[data-tour-id="memory-settings-project"]',
      placement: 'right',
      title: en('Your team'),
      body: en("Share a project and your teammates' agents start with what yours learned. Branch notes put a summary per branch inside the repo."),
    },
    {
      id: 'disk',
      anchor: '[data-tour-id="memory-settings-disk"]',
      placement: 'right',
      title: en('Notes on disk'),
      body: en('Your memories as Markdown files, if you want to read them in Obsidian or any editor.'),
    },
  ],
}
