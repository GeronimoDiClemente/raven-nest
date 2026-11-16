// Ring buffer of the last N `DomainEvent`s emitted on the shared event bus,
// for the Integrations Hub Activity rail. Pure/DI: no clock in here — the
// caller (electron/main.ts, wired via EventBus#setOnEmit) passes `ts` in,
// same no-argless-Date convention as the rest of integrations/.
import type { DomainEvent } from './bus-types'

export interface ActivityEntry {
  ev: DomainEvent
  ts: number
}

const DEFAULT_CAPACITY = 50

export class ActivityLog {
  private entries: ActivityEntry[] = []

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {}

  /** Records `ev` at `ts`. Newest entry goes to the front; once over
   *  capacity the oldest entry is dropped. */
  record(ev: DomainEvent, ts: number): void {
    this.entries.unshift({ ev, ts })
    if (this.entries.length > this.capacity) this.entries.length = this.capacity
  }

  /** Newest-first snapshot (defensive copy — mutating it never affects the log). */
  list(): ActivityEntry[] {
    return [...this.entries]
  }
}
