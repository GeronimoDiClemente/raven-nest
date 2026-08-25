import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Standalone Vite app that boots the REAL Nest worktree components (via the
// tutorial demo bridge) in a plain browser — no Electron. Used only to capture
// authentic UI footage with Playwright. Not part of the shipped app.
export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://demo.supabase.co'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('demo-anon-key'),
  },
  server: { port: 5199, strictPort: true },
})
