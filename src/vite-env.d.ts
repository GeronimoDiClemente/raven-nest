/// <reference types="vite/client" />

declare module '*.svg' {
  const src: string
  export default src
}

interface Window {
  plugins: {
    list(): Promise<import('./types').InstalledPlugin[]>
    save(p: import('./types').InstalledPlugin): Promise<void>
    delete(pluginId: string): Promise<void>
  }
  pluginCreds: {
    set(pluginId: string, token: string): Promise<{ ok: boolean; error?: string }>
    has(pluginId: string): Promise<boolean>
    delete(pluginId: string): Promise<void>
  }
  pluginActions: {
    run(pluginId: string, actionId: string, params: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>
  }
  slack: {
    openOAuth(): Promise<void>
    // Devuelve un unsubscribe (fix Hito 2+ F1: antes apilaba listeners).
    onOAuthCode(cb: (code: string) => void): () => void
    removeOAuthListener(): void
    exchangeCode(code: string): Promise<{ ok: boolean; error?: string }>
  }
  pluginPanels: {
    call(pluginId: string, method: string, args: unknown[]): Promise<
      | { ok: true; data: unknown }
      | { ok: false; error: 'NOT_CONNECTED' | 'NOT_FOUND' | 'API_ERROR'; message?: string }
    >
  }
}
