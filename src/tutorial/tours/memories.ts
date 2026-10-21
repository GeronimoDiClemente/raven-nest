// src/tutorial/tours/memories.ts
import type { TourDef } from '../types'

// Task 7 (2026-10-19): copia solo en inglés por ahora — `es` repite el mismo
// texto en vez de traducirlo, igual que el resto de la UI de Memories.
const en = (en: string) => ({ en, es: en })

export const memoriesTour: TourDef = {
  id: 'memories',
  steps: [
    {
      id: 'status',
      anchor: '[data-tour-id="memories-status"]',
      title: en('Is it in step?'),
      body: en('Pending, synced or blocked — this line tells you if what agents wrote here already reached your other machines.'),
    },
    {
      id: 'explorer',
      anchor: '[data-tour-id="memories-explorer"]',
      title: en('Every memory, by project'),
      body: en('Global, one folder per repo, and Team. Search here — matches light up in the graph too.'),
      placement: 'right',
    },
    {
      id: 'graph',
      anchor: '[data-tour-id="memories-graph"]',
      title: en('This is everything your agents remember'),
      body: en('Each dot is one memory, coloured by kind. Solid lines are links someone wrote; dotted ones are guesses. Click a dot to open it — or open a memory and pick "Connect to another memory" in its ⋯ menu, then click the other.'),
    },
    {
      id: 'tabs',
      anchor: '[data-tour-id="memories-tabs"]',
      title: en('Read and edit in place'),
      body: en('Memories open as tabs and save as you type. [[Links]] take you to the memory they name.'),
      placement: 'bottom',
    },
    {
      id: 'new',
      anchor: '[data-tour-id="memories-new"]',
      title: en('Write one yourself'),
      body: en('Agents write most of them. When you want something on record — a decision, a gotcha — add it here.'),
    },
    {
      id: 'settings',
      anchor: '[data-tour-id="memories-settings"]',
      title: en('Everything else lives here'),
      body: en('Settings opens as a tab: sync between your machines, encryption, editor and graph options, and the settings of the project you have open.'),
      placement: 'left',
    },
  ],
}
