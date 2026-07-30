// src/lib/bridge.ts
import { createContext, useContext } from 'react'

/**
 * Indirection over the contextBridge `window.*` APIs. Components that the
 * tutorial reuses in demo mode read APIs through `useBridge()` instead of
 * `window`, so demo mode can inject mocks WITHOUT mutating window (contextBridge
 * props are read-only / non-configurable and cannot be reassigned).
 *
 * Isolation is per React subtree: outside any `BridgeProvider` (the whole live
 * app) `useBridge()` returns the real `window`; inside the tutorial sandbox's
 * provider it returns the demo mocks. The live app is therefore never touched,
 * even while a sandbox is open rendering the SAME component modules.
 */
export type Bridge = Window & typeof globalThis

// Default value: delegate live to window so the real app is byte-for-byte
// unchanged. A Proxy (rather than a snapshot) keeps reads live.
const windowBridge = new Proxy({} as Record<PropertyKey, unknown>, {
  get(_target, prop) {
    return (window as unknown as Record<PropertyKey, unknown>)[prop]
  },
}) as unknown as Bridge

const BridgeContext = createContext<Bridge>(windowBridge)

/**
 * Read the bridge for the current subtree. Outside a `BridgeProvider` this is
 * `window`; inside the tutorial sandbox it is the demo mock object.
 */
export function useBridge(): Bridge {
  return useContext(BridgeContext)
}

/** Wrap a subtree to override its bridge (DEMO/TEST ONLY). */
export const BridgeProvider = BridgeContext.Provider

/**
 * Non-React consumers (and components not reused by the tutorial) keep importing
 * `bridge`; it always delegates to `window`. Demo isolation only applies to
 * components that call `useBridge()`.
 */
export const bridge: Bridge = windowBridge
