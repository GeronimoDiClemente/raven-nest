import { defineConfig } from 'vitest/config'

// Standalone config so vitest does not walk up to the repo root's vitest.config.ts
// (this package lives nested inside the raven-nest worktree but is its own project).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
})
