import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'electron/__tests__/**/*.test.ts',
            'src/__tests__/**/*.test.ts',
          ],
          setupFiles: ['electron/__tests__/setup.ts'],
        },
      },
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/__tests__/components/**/*.test.tsx', 'src/__tests__/hooks/**/*.test.tsx'],
          setupFiles: [
            'electron/__tests__/setup.ts',
            'src/__tests__/setup-dom.ts',
          ],
        },
      },
    ],
  },
})
