import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        resolve: {
          alias: { '@': resolve(__dirname, 'src') },
        },
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'electron/__tests__/**/*.test.ts',
            'src/__tests__/**/*.test.ts',
            'supabase/functions/**/__tests__/**/*.test.ts',
          ],
          exclude: ['src/__tests__/tutorial/**'],
          setupFiles: ['electron/__tests__/setup.ts'],
        },
      },
      {
        resolve: {
          alias: { '@': resolve(__dirname, 'src') },
        },
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: [
            'src/__tests__/components/**/*.test.tsx',
            'src/__tests__/hooks/**/*.test.tsx',
            'src/__tests__/tutorial/**/*.test.ts',
          ],
          setupFiles: [
            'electron/__tests__/setup.ts',
            'src/__tests__/setup-dom.ts',
          ],
        },
      },
    ],
  },
})
