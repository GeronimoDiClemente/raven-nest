import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Node.js 25 ships a built-in `localStorage` global that lacks `.clear()`.
// Vitest's jsdom environment populates window.* onto the global, but skips
// keys that already exist in the Node global unless they are in its hardcoded
// KEYS list — `localStorage` is not in that list.
// Fix: grab jsdom's Storage from the jsdom instance and install it directly
// so bare `localStorage` in tests resolves to the full jsdom implementation.
{
  const jsdomInstance = (globalThis as unknown as Record<string, { window?: { localStorage?: Storage } }>)['jsdom']
  const jsdomLocalStorage = jsdomInstance?.window?.localStorage
  if (jsdomLocalStorage && typeof jsdomLocalStorage.clear === 'function') {
    Object.defineProperty(globalThis, 'localStorage', {
      value: jsdomLocalStorage,
      writable: true,
      configurable: true,
    })
  }
}

// jsdom no implementa ResizeObserver y los componentes que miden su caja
// (EditorPane para el minimap, TerminalPane, BrowserCell) lo instancian al
// montar. Stub inerte: en jsdom nada cambia de tamano, asi que nunca tendria
// que disparar; lo que importa es que construirlo no explote.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

// jsdom no implementa Element.prototype.scrollIntoView ni la Pointer Capture API.
// El Select de Radix (src/components/ui/select.tsx) llama a las dos sin guardarlas
// detras de un `typeof === 'function'` (a diferencia de TabBar.tsx, que si se cuida):
// SelectContent hace `candidate.scrollIntoView(...)` al posicionar el item activo, y
// el trigger llama `target.hasPointerCapture(event.pointerId)` en su onPointerDown.
// Sin esto cualquier test que abra un <Select> revienta con
// "scrollIntoView is not a function" / "hasPointerCapture is not a function".
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}
if (typeof Element.prototype.hasPointerCapture !== 'function') {
  Element.prototype.hasPointerCapture = function hasPointerCapture() { return false }
}
if (typeof Element.prototype.setPointerCapture !== 'function') {
  Element.prototype.setPointerCapture = function setPointerCapture() {}
}
if (typeof Element.prototype.releasePointerCapture !== 'function') {
  Element.prototype.releasePointerCapture = function releasePointerCapture() {}
}

afterEach(() => {
  cleanup()
})
