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
      id: 'graph',
      anchor: '[data-tour-id="memories-graph"]',
      title: en('This is everything your agents remember'),
      body: en('Each dot is one memory, coloured by kind. Lines join memories that belong together — agents link them as they work, or you click "Connect to another memory" on one and then click the other. Click a dot to read it.'),
    },
    {
      id: 'list',
      anchor: '[data-tour-id="memories-list"]',
      title: en('Search it like you would ask'),
      body: en('Type any words, in any order. Matches light up in the graph too.'),
      placement: 'top',
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
      body: en('Sync between machines, encryption, sharing with your team. "How Memories works" in there walks you through it.'),
      placement: 'left',
    },
  ],
}
