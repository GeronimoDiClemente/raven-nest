import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        resolve: {
          // `cn` -> @/lib/utils: los componentes stock de shadcn (src/components/ui/)
          // importan el paquete "cn", no @/lib/utils. Sin este alias los tests medirían
          // una implementación de merge distinta de la que corre en la app real (ver
          // src/lib/utils.ts y src/__tests__/lib/cn-escala.test.ts).
          alias: { '@': resolve(__dirname, 'src'), cn: resolve(__dirname, 'src/lib/utils.ts') },
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
          alias: { '@': resolve(__dirname, 'src'), cn: resolve(__dirname, 'src/lib/utils.ts') },
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
