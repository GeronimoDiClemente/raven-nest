// Safe clipboard helpers.
//
// `navigator.clipboard.writeText` requires an active user gesture and a focused
// document. In edge cases (xterm consuming a keyboard event before React sees
// it, a webContentsView losing focus, programmatic invocations from useEffect)
// the browser rejects the call with `NotAllowedError: Failed to execute
// 'writeText' on 'Clipboard': Write permission denied.` The error surfaces in
// DevTools as "Uncaught (in promise)" because most callers don't await the
// returned promise.
//
// These wrappers swallow that specific failure mode so it never bubbles up,
// while still returning a boolean so callers can react (e.g. show "Copy
// failed" instead of "Copied!" if they care).

export async function safeWriteText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[clipboard] writeText denied:', err)
    }
    return false
  }
}

export async function safeReadText(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText()
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[clipboard] readText denied:', err)
    }
    return null
  }
}
