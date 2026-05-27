// src/lib/bridge.ts
/**
 * Indirection over the contextBridge `window.*` APIs. Components that the
 * tutorial reuses in demo mode read APIs through `bridge` instead of `window`,
 * so demo mode can inject mocks WITHOUT mutating window — contextBridge props
 * are read-only / non-configurable and cannot be reassigned. In production,
 * `bridge.x` is identical to `window.x` (zero behavior change).
 */
let overrides: Record<string, unknown> | null = null

/** DEMO/TEST ONLY — make `bridge.*` return these mocks instead of `window.*`. */
export function __setBridgeOverrides(mocks: Record<string, unknown>): void {
  overrides = mocks
}

/** DEMO/TEST ONLY — restore delegation to the real `window.*`. */
export function __clearBridgeOverrides(): void {
  overrides = null
}

export const bridge = new Proxy({} as Record<string, unknown>, {
  get(_target, prop) {
    if (typeof prop === 'string' && overrides && prop in overrides) {
      return overrides[prop]
    }
    return (window as unknown as Record<PropertyKey, unknown>)[prop]
  },
}) as unknown as Window & typeof globalThis
