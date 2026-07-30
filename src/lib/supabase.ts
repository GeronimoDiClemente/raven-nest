// src/lib/supabase.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const realClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

let activeClient: SupabaseClient = realClient

/** TEST/DEMO ONLY — point the app's `supabase` at a mock client. */
export function __setSupabaseClient(client: SupabaseClient): void {
  activeClient = client
}

/** TEST/DEMO ONLY — restore the real client. */
export function __resetSupabaseClient(): void {
  activeClient = realClient
}

/**
 * Proxy that forwards every access to whichever client is currently active.
 * Lets the tutorial swap in a mock at runtime without changing the ~dozen
 * call sites that `import { supabase }`. Functions are bound to the active
 * client so chained calls (`.from(...).select(...)`) keep their `this`.
 */
export const supabase = new Proxy(realClient, {
  get(_target, prop, receiver) {
    const value = Reflect.get(activeClient as object, prop, receiver)
    return typeof value === 'function' ? value.bind(activeClient) : value
  },
}) as SupabaseClient
