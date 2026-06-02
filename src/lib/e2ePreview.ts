// src/lib/e2ePreview.ts
// Dev-only preview gate. True only when the e2e/preview harness launched Electron
// with RAVEN_E2E=1 (electron/preload.ts exposes window.appFlags.e2eBypass).
// Production builds never set RAVEN_E2E, so this is always false for real users.
export function isE2EPreview(): boolean {
  return Boolean(
    (window as unknown as { appFlags?: { e2eBypass?: boolean } }).appFlags?.e2eBypass
  )
}
