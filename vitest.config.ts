import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['electron/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    setupFiles: ['electron/__tests__/setup.ts'],
  },
})
