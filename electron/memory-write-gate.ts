// Adversarial review, hallazgo (alto): memorySink.save() (main.ts) writes straight to
// memory.store without going through any swap protocol — unlike the MCP socket path
// (memory-ipc-server.ts's dispatch(), which rejects with 'store_swapping' while a swap is
// in flight, and memory-mcp/client.ts, which retries 8x150ms on exactly that error).
// During the window inside performUserSwap() between ctx.store.close() (swapMemoryStore)
// and the module-level `memory` variable being reassigned to the post-swap store, any
// write that reaches memorySink.save() (the event-bus observer, the gate approve/
// requestChanges handlers) would hit an already-closed store and be dropped silently by
// its own catch-and-warn.
//
// Same DI/testability discipline as memory-account-switch.ts: no `electron` import,
// generic over the item type, so this can be unit-tested with a plain fake type instead
// of a real MemorySaveInput / MemoryStore.
export class SwapWriteGate<T> {
  private swapping = false
  private pending: T[] = []

  constructor(private readonly maxPending = 200) {}

  beginSwap(): void {
    this.swapping = true
  }

  /**
   * Flushes whatever was deferred during the swap, in order, via the callback given.
   * Must be called exactly once per beginSwap(), after the caller has already re-wired
   * onto the post-swap store — flush() runs each deferred item through that new target.
   */
  endSwap(flush: (item: T) => void): void {
    this.swapping = false
    const items = this.pending.splice(0, this.pending.length)
    for (const item of items) flush(item)
  }

  /**
   * Returns true if the caller should proceed with the write immediately (no swap in
   * progress). Returns false if the write was deferred — queued to flush once endSwap()
   * runs — in which case the caller must NOT perform the write itself.
   *
   * The pending queue is bounded: once it's full, the oldest deferred write is dropped
   * (with a warning) to make room for the new one, rather than growing unbounded during
   * an unusually long or stuck swap.
   */
  offer(item: T): boolean {
    if (!this.swapping) return true
    if (this.pending.length >= this.maxPending) {
      console.warn('[memory-write-gate] pending queue full (%d), dropping oldest write', this.maxPending)
      this.pending.shift()
    }
    this.pending.push(item)
    return false
  }
}
